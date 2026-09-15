"""Iteration 27 — Bug fix: obra programada via PUT deve entrar no Avanço Físico.
Covers:
  - PUT /api/projects/{id} auto-set execution_status='programado' quando programa via drawer.
  - PUT preserva status explícito no payload.
  - PUT sem programar não altera status aguardando_programacao.
  - Legacy doc (is_scheduled sem execution_status) aparece via _status/$or.
  - GET /api/avanco/lookup: reasons por valor, aguardando, concluída, q curto.
  - Regressão: dashboard/kpis, operacional/today, projects → 200; DASHKPI-02/10 intactos.
"""
import os
import pytest
import requests
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio


def _base():
    u = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not u:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    u = line.split("=", 1)[1].strip()
    return u.rstrip("/")


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


class TestBugReproduction:
    """Reproduz o bug 00699/00622 usando código TEST-BUG-A."""

    def test_put_auto_programs(self, auth):
        # Cleanup pre-existente
        existing = _find(auth, "TEST-BUG-A")
        if existing:
            _delete(auth, existing.get("id") or existing.get("_id"))

        # 1) Cria aguardando
        payload = {
            "project_code": "TEST-BUG-A",
            "name": "Bug repro A",
            "programmed_value": 80000,
            "is_scheduled": False,
            "execution_status": "aguardando_programacao",
        }
        r = auth.post(f"{BASE_URL}/api/projects", json=payload)
        assert r.status_code in (200, 201), r.text
        proj = r.json()
        pid = proj.get("id") or proj.get("_id")
        assert pid

        try:
            # 2) NÃO deve aparecer no avanço
            avlist = auth.get(f"{BASE_URL}/api/avanco/projects").json()["projects"]
            codes = [p["project_code"] for p in avlist]
            assert "TEST-BUG-A" not in codes

            # 3) Lookup diagnóstico
            lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=TEST-BUG-A").json()
            assert lk["results"], lk
            res = lk["results"][0]
            assert res["eligible"] is False
            assert any("programada" in r.lower() for r in res["reasons"]), res["reasons"]

            # 4) PUT programando (sem execution_status no payload)
            upd = {
                "is_scheduled": True,
                "schedule_entries": [
                    {"date": "2026-09-20", "team_ids": [], "team_names": ["Equipe 1"]}
                ],
            }
            r = auth.put(f"{BASE_URL}/api/projects/{pid}", json=upd)
            assert r.status_code == 200, r.text
            updated = r.json()
            assert updated.get("execution_status") == "programado", updated

            # 5) Agora aparece no avanço
            avlist2 = auth.get(f"{BASE_URL}/api/avanco/projects").json()["projects"]
            match = [p for p in avlist2 if p["project_code"] == "TEST-BUG-A"]
            assert match, "TEST-BUG-A não aparece no /api/avanco/projects"
            assert match[0]["execution_status"] == "programado"
        finally:
            _delete(auth, pid)

    def test_put_preserves_explicit_status(self, auth):
        existing = _find(auth, "TEST-BUG-A2")
        if existing:
            _delete(auth, existing.get("id") or existing.get("_id"))

        r = auth.post(f"{BASE_URL}/api/projects", json={
            "project_code": "TEST-BUG-A2", "name": "explicit", "programmed_value": 80000,
            "is_scheduled": False, "execution_status": "aguardando_programacao",
        })
        pid = r.json().get("id") or r.json().get("_id")
        try:
            r = auth.put(f"{BASE_URL}/api/projects/{pid}", json={
                "is_scheduled": True,
                "schedule_entries": [{"date": "2026-09-20", "team_ids": [], "team_names": ["Equipe 1"]}],
                "execution_status": "em_execucao",
            })
            assert r.status_code == 200
            assert r.json()["execution_status"] == "em_execucao"
        finally:
            _delete(auth, pid)

    def test_put_non_scheduling_keeps_awaiting(self, auth):
        existing = _find(auth, "TEST-BUG-A3")
        if existing:
            _delete(auth, existing.get("id") or existing.get("_id"))

        r = auth.post(f"{BASE_URL}/api/projects", json={
            "project_code": "TEST-BUG-A3", "name": "notes only", "programmed_value": 80000,
            "is_scheduled": False, "execution_status": "aguardando_programacao",
        })
        pid = r.json().get("id") or r.json().get("_id")
        try:
            r = auth.put(f"{BASE_URL}/api/projects/{pid}", json={"location": "TEST loc"})
            assert r.status_code == 200
            assert r.json().get("execution_status") == "aguardando_programacao"
        finally:
            _delete(auth, pid)


class TestLegacyDoc:
    def test_legacy_scheduled_no_status(self, auth, admin_id):
        # Insere direto no mongo
        async def _seed():
            cli = AsyncIOMotorClient(MONGO_URL)
            db = cli[DB_NAME]
            await db.projects.delete_many({"project_code": "TEST-BUG-B", "user_id": admin_id})
            doc = {
                "user_id": admin_id,
                "project_code": "TEST-BUG-B",
                "name": "Legacy no status",
                "programmed_value": 100000,
                "is_scheduled": True,
                "start_date": "2026-09-10",
                "schedule_entries": [{"date": "2026-09-10"}],
                # NOTE: sem execution_status
            }
            r = await db.projects.insert_one(doc)
            cli.close()
            return str(r.inserted_id)

        pid = asyncio.get_event_loop().run_until_complete(_seed()) if False else asyncio.new_event_loop().run_until_complete(_seed())
        try:
            # Deve listar como programado (via _status/$or) sem depender do backfill
            j = auth.get(f"{BASE_URL}/api/avanco/projects").json()
            m = [p for p in j["projects"] if p["project_code"] == "TEST-BUG-B"]
            assert m, "TEST-BUG-B ausente"
            assert m[0]["execution_status"] == "programado"

            lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=TEST-BUG-B").json()
            assert lk["results"]
            res = lk["results"][0]
            assert res["eligible"] is True
            assert res["status_label"] == "Programado"

            det = auth.get(f"{BASE_URL}/api/projects/{pid}/avanco").json()
            assert det["eligible"] is True
        finally:
            async def _cleanup():
                cli = AsyncIOMotorClient(MONGO_URL)
                await cli[DB_NAME].projects.delete_many({"project_code": "TEST-BUG-B", "user_id": admin_id})
                cli.close()
            asyncio.new_event_loop().run_until_complete(_cleanup())


class TestLookupReasons:
    def test_below_threshold(self, auth):
        lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=OPHOJE-01").json()
        assert lk["results"]
        res = next((r for r in lk["results"] if r["project_code"] == "OPHOJE-01"), None)
        assert res, lk
        assert any("limite" in r.lower() for r in res["reasons"])

    def test_completed(self, auth):
        lk = auth.get(f"{BASE_URL}/api/avanco/lookup?q=DASHKPI-10").json()
        res = next((r for r in lk["results"] if r["project_code"] == "DASHKPI-10"), None)
        assert res, lk
        assert any("conclu" in r.lower() for r in res["reasons"])
        assert res["hidden_completed"] is True

    def test_short_query(self, auth):
        j = auth.get(f"{BASE_URL}/api/avanco/lookup?q=D").json()
        assert j["results"] == []


class TestRegression:
    def test_endpoints_ok(self, auth):
        assert auth.get(f"{BASE_URL}/api/dashboard/kpis").status_code == 200
        assert auth.get(f"{BASE_URL}/api/operacional/today").status_code == 200
        assert auth.get(f"{BASE_URL}/api/projects").status_code == 200

    def test_dashkpi_statuses_intact(self, auth):
        p2 = _find(auth, "DASHKPI-02")
        assert p2 and p2.get("execution_status") == "a_reprogramar", p2 and p2.get("execution_status")
        p10 = _find(auth, "DASHKPI-10")
        assert p10 and p10.get("execution_status") == "concluido", p10 and p10.get("execution_status")
