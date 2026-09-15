"""Iteration 25: Operacional/today + Equipamentos project link."""
import os, pytest, requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://team-scheduler-230.preview.emergentagent.com"
ADMIN = {"email": "lucasc.cuiaba02@gmail.com", "password": "Hayah$152610"}


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


def today_str():
    return datetime.now(ZoneInfo("America/Cuiaba")).strftime("%Y-%m-%d")


# ---------- Operacional today ----------
class TestOperacionalToday:
    def test_endpoint_200(self, h):
        r = requests.get(f"{BASE}/api/operacional/today", headers=h, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "by_team" in data
        assert "total_projects" in data

    def test_ophoje01_in_two_teams(self, h):
        data = requests.get(f"{BASE}/api/operacional/today", headers=h, timeout=30).json()
        by_team = data["by_team"]
        # Find OPHOJE-01 in both teams
        t1_codes = [p["project_code"] for p in by_team.get("Equipe 1", [])]
        t2_codes = [p["project_code"] for p in by_team.get("Equipe 2", [])]
        assert "OPHOJE-01" in t1_codes, f"OPHOJE-01 not in Equipe 1: {t1_codes}"
        assert "OPHOJE-01" in t2_codes, f"OPHOJE-01 not in Equipe 2: {t2_codes}"
        # verify shutdown_today + teams_today
        p1 = next(p for p in by_team["Equipe 1"] if p["project_code"] == "OPHOJE-01")
        assert p1.get("shutdown_today") is True
        assert set(p1.get("teams_today", [])) == {"Equipe 1", "Equipe 2"}

    def test_ophoje02_only_in_equipe2(self, h):
        data = requests.get(f"{BASE}/api/operacional/today", headers=h, timeout=30).json()
        by_team = data["by_team"]
        t1_codes = [p["project_code"] for p in by_team.get("Equipe 1", [])]
        t2_codes = [p["project_code"] for p in by_team.get("Equipe 2", [])]
        assert "OPHOJE-02" not in t1_codes
        assert "OPHOJE-02" in t2_codes

    def test_ophoje03_04_05_absent(self, h):
        data = requests.get(f"{BASE}/api/operacional/today", headers=h, timeout=30).json()
        all_codes = [p["project_code"] for team in data["by_team"].values() for p in team]
        assert "OPHOJE-03" not in all_codes
        assert "OPHOJE-04" not in all_codes
        assert "OPHOJE-05" not in all_codes

    def test_total_projects_distinct(self, h):
        data = requests.get(f"{BASE}/api/operacional/today", headers=h, timeout=30).json()
        # OPHOJE-01 counts once even though in 2 teams
        all_codes = set(p["project_code"] for team in data["by_team"].values() for p in team)
        assert data["total_projects"] == len(all_codes)


# ---------- Equipamentos with project link ----------
class TestEquipamentosProjectLink:
    def _get_ophoje01_id(self, h):
        r = requests.get(f"{BASE}/api/projects", headers=h, timeout=30)
        assert r.status_code == 200
        for p in r.json():
            if p.get("project_code") == "OPHOJE-01":
                return p["id"]
        pytest.fail("OPHOJE-01 project not found")

    def test_create_with_project_link(self, h):
        pid = self._get_ophoje01_id(h)
        payload = {
            "tipo": "religador", "patrimonio": "TEST-EQP-25", "numero_serie": "SN25",
            "codigo_material": "0", "descricao": "Test equip", "potencia": "",
            "condicao": "novo", "fabricante": "X", "tensao_primaria": "", "tensao_secundaria": "",
            "notas": "", "data_fabricacao": "",
            "project_id": pid, "project_code": "OPHOJE-01", "project_name": "Hoje duas equipes",
        }
        r = requests.post(f"{BASE}/api/equipamentos", headers=h, json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        assert d.get("project_id") == pid
        assert d.get("project_code") == "OPHOJE-01"
        eid = d["id"]

        # GET list has it with fields
        rl = requests.get(f"{BASE}/api/equipamentos", headers=h, timeout=30)
        assert rl.status_code == 200
        items = rl.json()
        got = next((x for x in items if x["id"] == eid), None)
        assert got and got.get("project_id") == pid

        # Filter by project_id
        rf = requests.get(f"{BASE}/api/equipamentos", headers=h, params={"project_id": pid}, timeout=30)
        assert rf.status_code == 200
        codes = [x["patrimonio"] for x in rf.json()]
        assert "TEST-EQP-25" in codes
        assert "PAT-OPHOJE" in codes  # seed equipamento
        for x in rf.json():
            assert x["project_id"] == pid

        # PATCH clear link
        rp = requests.patch(f"{BASE}/api/equipamentos/{eid}", headers=h, json={"project_id": "", "project_code": "", "project_name": ""}, timeout=30)
        assert rp.status_code in (200, 204), rp.text
        rg = requests.get(f"{BASE}/api/equipamentos", headers=h, timeout=30).json()
        got2 = next((x for x in rg if x["id"] == eid), None)
        assert got2.get("project_id") in ("", None)

        # cleanup
        requests.delete(f"{BASE}/api/equipamentos/{eid}", headers=h, timeout=30)

    def test_legacy_equipamento_has_empty_project(self, h):
        r = requests.get(f"{BASE}/api/equipamentos", headers=h, timeout=30)
        assert r.status_code == 200
        for x in r.json():
            assert "project_id" in x  # field must exist (empty string ok)


# ---------- Regression ----------
class TestRegression:
    def test_dashboard_kpis(self, h):
        r = requests.get(f"{BASE}/api/dashboard/kpis", headers=h, timeout=30)
        assert r.status_code == 200
