"""Iteration 28 — Regra Avanço Físico atualizada: aguardando_programacao ENTRA na lista com badge."""
import os
import pytest
import requests
import asyncio
from motor.motor_asyncio import AsyncIOMotorClient


def _base():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    return ""


BASE_URL = _base()
EMAIL = "lucasc.cuiaba02@gmail.com"
PASSWORD = "Hayah$152610"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_id(auth):
    r = auth.get(f"{BASE_URL}/api/auth/me")
    j = r.json()
    return j.get("id") or j.get("_id") or j.get("user_id")


def _find(auth, code):
    for p in auth.get(f"{BASE_URL}/api/projects").json():
        if p.get("project_code") == code:
            return p
    return None


def _delete(auth, pid):
    if pid:
        auth.delete(f"{BASE_URL}/api/projects/{pid}")


class TestAwaitingListing:
    def test_dashkpi01_listed_as_not_scheduled(self, auth):
        j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
        m = [p for p in j["projects"] if p["project_code"] == "DASHKPI-01"]
        assert m, f"DASHKPI-01 must be listed. codes={[p['project_code'] for p in j['projects']]}"
        assert m[0]["not_scheduled"] is True
        assert m[0]["execution_status"] == "aguardando_programacao"
        # totals.not_scheduled >= 1
        assert j["totals"]["not_scheduled"] >= 1

    def test_totals_not_scheduled_count(self, auth):
        j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
        awaiting = [p for p in j["projects"] if p["not_scheduled"]]
        assert j["totals"]["not_scheduled"] == len(awaiting)

    def test_ordering_active_then_awaiting_then_completed(self, auth):
        j = auth.get(f"{BASE_URL}/api/avanco/projects?include_completed=1").json()
        projs = j["projects"]
        # active(non-completed, non-awaiting) → awaiting → completed
        def rank(p):
            if p["execution_status"] in ("concluido", "executada"):
                return 2
            if p["not_scheduled"]:
                return 1
            return 0
        ranks = [rank(p) for p in projs]
        assert ranks == sorted(ranks), f"ordering broken: {ranks}"


class TestExclusions:
    def test_suspenso_not_listed(self, auth):
        existing = _find(auth, "TEST-SUSP")
        if existing:
            _delete(auth, existing.get("id") or existing.get("_id"))
        r = auth.post(f"{BASE_URL}/api/projects", json={
            "project_code": "TEST-SUSP", "name": "susp", "programmed_value": 60000,
            "is_scheduled": False, "execution_status": "suspenso",
        })
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id") or r.json().get("_id")
        try:
            j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
            codes = [p["project_code"] for p in j["projects"]]
            assert "TEST-SUSP" not in codes
            j2 = auth.get(f"{BASE_URL}/api/avanco/projects?include_completed=1").json()
            assert "TEST-SUSP" not in [p["project_code"] for p in j2["projects"]]
        finally:
            _delete(auth, pid)

    def test_completed_hidden_by_default(self, auth):
        j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
        codes = [p["project_code"] for p in j["projects"]]
        assert "DASHKPI-10" not in codes
        assert j["totals"]["hidden_completed"] >= 1

        j2 = auth.get(f"{BASE_URL}/api/avanco/projects?include_completed=1").json()
        codes2 = [p["project_code"] for p in j2["projects"]]
        assert "DASHKPI-10" in codes2
        assert j2["totals"]["hidden_completed"] == 0


class TestLegacyDoc:
    def test_legacy_no_status_listed_as_awaiting(self, auth, admin_id):
        async def _seed():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            await db.projects.delete_many({"project_code": "TEST-LEG2", "user_id": admin_id})
            doc = {
                "user_id": admin_id,
                "project_code": "TEST-LEG2",
                "name": "Legacy no status",
                "programmed_value": 70000,
                "is_scheduled": False,
                # NO execution_status, NO schedule_entries
            }
            r = await db.projects.insert_one(doc)
            cli.close()
            return str(r.inserted_id)

        async def _cleanup():
            cli = AsyncIOMotorClient(MONGO_URL)
            await cli[DB_NAME].projects.delete_many({"project_code": "TEST-LEG2", "user_id": admin_id})
            cli.close()

        pid = asyncio.new_event_loop().run_until_complete(_seed())
        try:
            j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
            m = [p for p in j["projects"] if p["project_code"] == "TEST-LEG2"]
            assert m, f"TEST-LEG2 ausente. codes={[p['project_code'] for p in j['projects']]}"
            assert m[0]["execution_status"] == "aguardando_programacao"
            assert m[0]["not_scheduled"] is True

            det = auth.get(f"{BASE_URL}/api/projects/{pid}/avanco").json()
            assert det["eligible"] is True
        finally:
            asyncio.new_event_loop().run_until_complete(_cleanup())


class TestLookupNewRules:
    def test_awaiting_is_now_eligible(self, auth):
        lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=DASHKPI-01").json()
        res = next((r for r in lk["results"] if r["project_code"] == "DASHKPI-01"), None)
        assert res, lk
        assert res["eligible"] is True, res
        assert res["reasons"] == [], res["reasons"]

    def test_dashkpi04_suspended_below(self, auth):
        # DASHKPI-04: 15k suspenso → reasons contain 'limite' e 'suspens'
        lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=DASHKPI-04").json()
        res = next((r for r in lk["results"] if r["project_code"] == "DASHKPI-04"), None)
        assert res, lk
        assert any("limite" in x.lower() for x in res["reasons"]), res
        assert any(("suspens" in x.lower() or "cancel" in x.lower()) for x in res["reasons"]), res

    def test_completed_reason(self, auth):
        lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=DASHKPI-10").json()
        res = next((r for r in lk["results"] if r["project_code"] == "DASHKPI-10"), None)
        assert res
        assert any("conclu" in x.lower() for x in res["reasons"])
        assert res["hidden_completed"] is True


class TestRegression:
    def test_put_auto_programado(self, auth):
        existing = _find(auth, "TEST-BUG-A")
        if existing:
            _delete(auth, existing.get("id") or existing.get("_id"))
        r = auth.post(f"{BASE_URL}/api/projects", json={
            "project_code": "TEST-BUG-A", "name": "A", "programmed_value": 80000,
            "is_scheduled": False, "execution_status": "aguardando_programacao",
        })
        pid = r.json().get("id") or r.json().get("_id")
        try:
            r = auth.put(f"{BASE_URL}/api/projects/{pid}", json={
                "is_scheduled": True,
                "schedule_entries": [{"date": "2026-09-20", "team_ids": [], "team_names": ["Equipe 1"]}],
            })
            assert r.status_code == 200
            assert r.json()["execution_status"] == "programado"
        finally:
            _delete(auth, pid)

    def test_kpis_ok(self, auth):
        assert auth.get(f"{BASE_URL}/api/dashboard/kpis").status_code == 200
