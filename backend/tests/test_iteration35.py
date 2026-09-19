"""Iteration 35 · Modo Campo (Set/2026) — backend tests"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN = {"email": "lucasc.cuiaba02@gmail.com", "password": "Hayah$152610"}
ENC = {"email": "encarregado.teste@hayah.com", "password": "Campo@2026"}
PROJ_ID = "6aade9e554f9f5aa51348a8d"
TEAM_ID = "6aade9e554f9f5aa51348a8c"
REQ_ID = "91c57439-1f5a-49d7-abc2-0222cfc6e12e"


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def enc():
    return _login(ENC)


# ---------- /api/campo/hoje ----------
class TestCampoHoje:
    def test_encarregado_hoje(self, enc):
        r = enc.get(f"{BASE_URL}/api/campo/hoje", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert "date" in d and len(d["date"]) == 10
        u = d["user"]
        assert u["is_encarregado"] is True
        assert u["team_names"] == ["Equipe LV Campo"]
        assert u["hot_line_team"] is True
        pids = [p["id"] for p in d["projects"]]
        assert PROJ_ID in pids, f"CAMPO-LV-01 not in projects today: {pids}"
        p = next(p for p in d["projects"] if p["id"] == PROJ_ID)
        assert p.get("project_code") == "CAMPO-LV-01"
        assert p.get("requires_hot_line") is True
        assert "teams_today" in p and p["teams_today"]
        assert "checklist" in p
        assert isinstance(p.get("photos"), list)
        assert isinstance(p.get("attachments"), list)
        assert isinstance(p.get("materials_list"), list) and len(p["materials_list"]) == 2
        assert "apr_list" in p
        assert "aprs" in p and set(["total", "viva", "morta"]).issubset(p["aprs"].keys())
        lr = p.get("last_requisition")
        assert lr is not None
        assert lr.get("stage") in ("separado", "recebido")
        assert "warehouse_response" in lr
        assert "checkins_today" in p
        assert "turno_label" in p

    def test_encarregado_hoje_with_date_param(self, enc):
        d = enc.get(f"{BASE_URL}/api/campo/hoje", timeout=30).json()
        today = d["date"]
        r = enc.get(f"{BASE_URL}/api/campo/hoje", params={"date": today}, timeout=30)
        assert r.status_code == 200
        assert r.json()["date"] == today

    def test_admin_hoje_no_team_filter(self, admin):
        r = admin.get(f"{BASE_URL}/api/campo/hoje", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["user"]["team_names"] == []
        # admin sees CAMPO-LV-01 too
        pids = [p["id"] for p in d["projects"]]
        assert PROJ_ID in pids


# ---------- /api/campo/checkin ----------
class TestCheckin:
    def test_invalid_shift(self, enc):
        r = enc.post(f"{BASE_URL}/api/campo/checkin",
                     json={"project_id": PROJ_ID, "shift": "xxx", "status": "a_caminho"}, timeout=30)
        assert r.status_code == 400

    def test_invalid_status(self, enc):
        r = enc.post(f"{BASE_URL}/api/campo/checkin",
                     json={"project_id": PROJ_ID, "shift": "tarde", "status": "yyy"}, timeout=30)
        assert r.status_code == 400

    def test_project_not_found(self, enc):
        r = enc.post(f"{BASE_URL}/api/campo/checkin",
                     json={"project_id": "000000000000000000000000", "shift": "tarde", "status": "a_caminho"}, timeout=30)
        assert r.status_code == 404

    def test_checkin_and_upsert(self, enc):
        r1 = enc.post(f"{BASE_URL}/api/campo/checkin",
                      json={"project_id": PROJ_ID, "shift": "tarde", "status": "a_caminho", "client_ts": "2026-01-01T10:00:00Z"},
                      timeout=30)
        assert r1.status_code == 200, r1.text[:300]
        j1 = r1.json()
        assert j1["turno_label"] == "Tarde"
        assert j1["status_label"] == "A caminho"
        count1 = len(j1["checkins_today"])

        # second post upserts (same user/project/day)
        r2 = enc.post(f"{BASE_URL}/api/campo/checkin",
                      json={"project_id": PROJ_ID, "shift": "tarde", "status": "no_local"}, timeout=30)
        assert r2.status_code == 200
        j2 = r2.json()
        assert len(j2["checkins_today"]) == count1  # no dupe
        assert j2["status_label"] == "No local"

    def test_checkins_by_project(self, enc):
        r = enc.get(f"{BASE_URL}/api/campo/checkins", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "by_project" in d
        assert PROJ_ID in d["by_project"]

    def test_operacional_today_reflects_checkin(self, admin):
        r = admin.get(f"{BASE_URL}/api/operacional/today", timeout=30)
        assert r.status_code == 200
        d = r.json()
        items = []
        if isinstance(d, list):
            items = d
        elif "by_team" in d:
            for _team, projs in d["by_team"].items():
                items.extend(projs)
        else:
            items = d.get("projects") or d.get("items") or []
        p = next((x for x in items if x.get("id") == PROJ_ID), None)
        assert p is not None, "CAMPO-LV-01 not in /operacional/today"
        assert "checkins_today" in p
        assert "turno_label" in p
        assert p.get("confirmed_today") is True
        assert "aprs" in p
        assert "last_requisition" in p


# ---------- APRs ----------
class TestAPR:
    client_id = "teste_iter35_apr"

    def test_create_apr_viva_with_checklists(self, enc):
        # count before
        before = enc.get(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", timeout=30).json()
        n_before = len(before)

        body = {
            "line_type": "viva",
            "client_id": self.client_id,
            "observacoes": "obs inicial",
            "checklists": {
                "ferramental": {"items": {"escada": {"status": "nc", "obs": "corda"}}, "obs": ""},
                "epi": {"items": {"capacete": {"status": "c"}}, "obs": ""},
                "epc": {"items": {"cones": {"status": "na"}}, "obs": ""},
            },
        }
        r = enc.post(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", json=body, timeout=30)
        assert r.status_code == 200, r.text[:300]
        j = r.json()
        assert j.get("line_type") == "viva"
        assert j["checklists"]["ferramental"]["items"]["escada"]["status"] == "nc"
        assert j["checklists"]["ferramental"]["items"]["escada"]["obs"] == "corda"
        assert j["checklists"]["epi"]["items"]["capacete"]["status"] == "c"
        assert j["checklists"]["epc"]["items"]["cones"]["status"] == "na"
        TestAPR.apr_id = j["id"]

        after = enc.get(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", timeout=30).json()
        assert len(after) == n_before + 1

    def test_dedupe_same_client_id(self, enc):
        before = enc.get(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", timeout=30).json()
        n_before = len(before)
        body = {
            "line_type": "viva",
            "client_id": self.client_id,
            "observacoes": "obs atualizada",
            "checklists": {"ferramental": {"items": {"escada": {"status": "nc", "obs": "corda2"}}, "obs": ""}},
        }
        r = enc.post(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", json=body, timeout=30)
        assert r.status_code == 200
        j = r.json()
        assert "updated_at" in j
        assert j.get("observacoes") == "obs atualizada"
        after = enc.get(f"{BASE_URL}/api/projects/{PROJ_ID}/aprs", timeout=30).json()
        assert len(after) == n_before  # no duplicate

    def test_apr_pdf(self, enc):
        r = enc.get(f"{BASE_URL}/api/aprs/{TestAPR.apr_id}/pdf", timeout=60)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert len(r.content) > 8 * 1024, f"pdf too small: {len(r.content)}"

    def test_patch_apr(self, enc):
        r = enc.patch(f"{BASE_URL}/api/aprs/{TestAPR.apr_id}",
                      json={"line_type": "viva", "observacoes": "patched"}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("observacoes") == "patched"

    def test_delete_apr(self, enc):
        # cleanup: delete APR created by this test class
        r = enc.delete(f"{BASE_URL}/api/aprs/{TestAPR.apr_id}", timeout=30)
        assert r.status_code == 200


# ---------- Material receipt ----------
class TestMaterialReceipt:
    def test_confirm_receipt(self, enc):
        # check current stage
        cur = enc.get(f"{BASE_URL}/api/campo/hoje", timeout=30).json()
        p = next(p for p in cur["projects"] if p["id"] == PROJ_ID)
        stage = (p.get("last_requisition") or {}).get("stage")
        if stage == "recebido":
            # already received in previous run; just validate state
            assert p["last_requisition"].get("receipt") is not None
            return
        r = enc.post(
            f"{BASE_URL}/api/projects/{PROJ_ID}/requisitions/{REQ_ID}/confirm-receipt",
            data={"receiver_name": "TEST Encarregado", "notes": "teste iter35"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        # re-fetch
        after = enc.get(f"{BASE_URL}/api/campo/hoje", timeout=30).json()
        p2 = next(p for p in after["projects"] if p["id"] == PROJ_ID)
        assert p2["last_requisition"]["stage"] == "recebido"
        assert p2["last_requisition"]["receipt"]["received_by"] == "TEST Encarregado"


# ---------- Admin permissions & teams ----------
class TestAdminPerms:
    def test_me_encarregado(self, enc):
        r = enc.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        u = r.json()
        assert u.get("is_encarregado") is True
        assert TEAM_ID in (u.get("team_ids") or [])

    def test_admin_users_lists_encarregado_fields(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/users", timeout=30)
        assert r.status_code == 200
        users = r.json()
        target = next((u for u in users if u.get("email") == ENC["email"]), None)
        assert target is not None
        assert target.get("is_encarregado") is True
        assert TEAM_ID in (target.get("team_ids") or [])

    def test_update_permissions_preserves_enc(self, admin):
        # Get uid
        users = admin.get(f"{BASE_URL}/api/admin/users", timeout=30).json()
        uid = next(u["id"] for u in users if u.get("email") == ENC["email"])
        r = admin.put(f"{BASE_URL}/api/admin/users/{uid}/permissions",
                      json={"permissions": ["campo"], "role": "user",
                            "is_encarregado": True, "team_ids": [TEAM_ID]}, timeout=30)
        assert r.status_code == 200, r.text[:300]

    def test_teams_tipo(self, admin):
        r = admin.get(f"{BASE_URL}/api/teams", timeout=30)
        assert r.status_code == 200
        teams = r.json()
        t = next((t for t in teams if t.get("id") == TEAM_ID), None)
        assert t is not None
        assert t.get("tipo") == "linha_viva"

    def test_create_team_invalid_tipo_defaults(self, admin):
        r = admin.post(f"{BASE_URL}/api/teams",
                       json={"name": "TEST_ITER35_TIPO_INVALIDO", "tipo": "xyz"}, timeout=30)
        assert r.status_code in (200, 201)
        tid = r.json().get("id") or r.json().get("_id")
        assert r.json().get("tipo") == "linha_morta"
        # cleanup
        if tid:
            admin.delete(f"{BASE_URL}/api/teams/{tid}", timeout=30)

    def test_create_team_mista(self, admin):
        r = admin.post(f"{BASE_URL}/api/teams",
                       json={"name": "TEST_ITER35_MISTA", "tipo": "mista"}, timeout=30)
        assert r.status_code in (200, 201)
        j = r.json()
        assert j.get("tipo") == "mista"
        tid = j.get("id")
        # cleanup
        if tid:
            admin.delete(f"{BASE_URL}/api/teams/{tid}", timeout=30)
