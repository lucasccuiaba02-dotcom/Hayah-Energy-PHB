"""
Iteration 14 tests — Message 208 features:
- Dashboard KPIs (financeiro, operacional, tempo_medio, servicos_por_dia, vencidas, vencendo_amanha_list)
- Project metric fields (postes_qty, transformadores_qty, km_rede, ligacoes_novas, religacoes, desligamentos)
- additional_team_id / additional_team_name on projects
- Team unavailability CRUD (GET/POST/DELETE /api/team-unavailability)
- Retorno de programação (POST /api/programacao/return, GET /api/programacao/pending-returns)
- Admin permissions granular update (PUT /api/admin/users/{id}/permissions)
- Permissions enforcement via /api/auth/me
"""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def test_team(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/teams", json={"name": "TEST_iter14_teamA", "members": ["m1"], "supervisor": "SupA"})
    assert r.status_code == 200
    team_a = r.json()
    r2 = admin_session.post(f"{BASE_URL}/api/teams", json={"name": "TEST_iter14_teamB", "members": ["m2"], "supervisor": "SupB"})
    assert r2.status_code == 200
    team_b = r2.json()
    yield team_a, team_b
    admin_session.delete(f"{BASE_URL}/api/teams/{team_a['id']}")
    admin_session.delete(f"{BASE_URL}/api/teams/{team_b['id']}")


class TestDashboardKPIs:
    def test_kpis_shape(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/dashboard/kpis")
        assert r.status_code == 200, r.text
        data = r.json()
        for key in ["counts", "financeiro", "operacional", "tempo_medio", "servicos_por_dia", "vencidas", "vencendo_amanha_list"]:
            assert key in data, f"missing key: {key}"
        # counts sub-keys
        for k in ["total", "em_andamento", "concluidas_mes", "atrasadas", "vencidas", "vencendo_amanha"]:
            assert k in data["counts"], f"missing counts.{k}"
        # financeiro sub-keys
        for k in ["perc_conclusao", "valor_faturado", "receita_prevista_mes", "meta_total"]:
            assert k in data["financeiro"]
        # operacional sub-keys
        for k in ["postes", "transformadores", "km_rede", "ligacoes_novas", "religacoes", "desligamentos"]:
            assert k in data["operacional"], f"missing operacional.{k}"
        # tempo_medio
        for k in ["recebimento_programacao", "programacao_execucao"]:
            assert k in data["tempo_medio"]
        assert isinstance(data["servicos_por_dia"], list)


class TestProjectMetrics:
    def test_create_project_with_metrics_and_additional_team(self, admin_session, test_team):
        team_a, team_b = test_team
        today = datetime.now(timezone.utc)
        plus2 = (today + timedelta(days=2)).strftime("%Y-%m-%d")
        payload = {
            "name": "TEST_iter14_metrics",
            "project_code": f"TESTIT14-{int(today.timestamp())}",
            "team_id": team_a["id"],
            "team_name": team_a["name"],
            "additional_team_id": team_b["id"],
            "additional_team_name": team_b["name"],
            "start_date": plus2,
            "end_date": plus2,
            "is_scheduled": True,
            "postes_qty": 10,
            "transformadores_qty": 2,
            "km_rede": 3.5,
            "ligacoes_novas": 5,
            "religacoes": 1,
            "desligamentos": 2,
            "programmed_value": 5000,
        }
        r = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["postes_qty"] == 10
        assert p["transformadores_qty"] == 2
        assert p["km_rede"] == 3.5
        assert p["ligacoes_novas"] == 5
        assert p["religacoes"] == 1
        assert p["desligamentos"] == 2
        assert p["additional_team_id"] == team_b["id"]
        assert p["additional_team_name"] == team_b["name"]

        # GET back
        rg = admin_session.get(f"{BASE_URL}/api/projects/{p['id']}")
        assert rg.status_code == 200
        gp = rg.json()
        assert gp["postes_qty"] == 10
        assert gp["additional_team_id"] == team_b["id"]

        # cleanup at end of class via yield-less: keep for retorno tests below
        pytest.project_id = p["id"]
        pytest.project_start = plus2

    def test_project_persistence_list(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/projects")
        assert r.status_code == 200
        found = [p for p in r.json() if p["id"] == pytest.project_id]
        assert len(found) == 1
        assert found[0]["postes_qty"] == 10


class TestTeamUnavailability:
    def test_crud(self, admin_session, test_team):
        team_a, _ = test_team
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Create
        r = admin_session.post(f"{BASE_URL}/api/team-unavailability", json={
            "team_id": team_a["id"], "date": today_str, "reason": "chuva", "notes": "TEST"
        })
        assert r.status_code == 200, r.text
        # List
        rl = admin_session.get(f"{BASE_URL}/api/team-unavailability")
        assert rl.status_code == 200
        items = rl.json()
        match = [i for i in items if i["team_id"] == team_a["id"] and i["date"] == today_str]
        assert len(match) >= 1
        uid = match[0]["id"]
        assert match[0]["reason"] == "chuva"
        # Delete
        rd = admin_session.delete(f"{BASE_URL}/api/team-unavailability/{uid}")
        assert rd.status_code == 200
        # Verify gone
        rl2 = admin_session.get(f"{BASE_URL}/api/team-unavailability")
        match2 = [i for i in rl2.json() if i["id"] == uid]
        assert len(match2) == 0


class TestRetornoProgramacao:
    def test_pending_returns_and_register(self, admin_session, test_team):
        # Use a fresh project scheduled for a past date so it appears in pending
        team_a, team_b = test_team
        past_date = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        payload = {
            "name": "TEST_iter14_retorno",
            "project_code": f"TESTRET14-{int(datetime.now().timestamp())}",
            "team_id": team_a["id"],
            "team_name": team_a["name"],
            "start_date": past_date,
            "end_date": past_date,
            "is_scheduled": True,
        }
        rc = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
        assert rc.status_code == 200, rc.text
        pid = rc.json()["id"]

        # Pending returns for yesterday should include this project
        rp = admin_session.get(f"{BASE_URL}/api/programacao/pending-returns", params={"date": past_date})
        assert rp.status_code == 200, rp.text
        ids = [x["id"] for x in rp.json()]
        assert pid in ids, f"expected pending, got {ids}"

        # Register a NOT-executed return
        rr = admin_session.post(f"{BASE_URL}/api/programacao/return", json={
            "project_id": pid, "date": past_date, "executed": False, "reason": "chuva"
        })
        assert rr.status_code == 200, rr.text
        assert rr.json()["new_status"] == "a_reprogramar"

        # Verify project execution_status
        rg = admin_session.get(f"{BASE_URL}/api/projects/{pid}")
        assert rg.json()["execution_status"] == "a_reprogramar"

        # Now register executed=true (2nd entry)
        rr2 = admin_session.post(f"{BASE_URL}/api/programacao/return", json={
            "project_id": pid, "date": past_date, "executed": True
        })
        assert rr2.status_code == 200
        assert rr2.json()["new_status"] == "executada"
        rg2 = admin_session.get(f"{BASE_URL}/api/projects/{pid}")
        assert rg2.json()["execution_status"] == "executada"

        # cleanup
        admin_session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestAdminPermissions:
    def test_permissions_flow(self, admin_session):
        # Register a fresh limited user (idempotent-ish: use timestamp)
        ts = int(datetime.now().timestamp())
        email = f"TEST_limited_{ts}@test.com"
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "password": "Limit@123", "name": "Limitado"
        })
        assert reg.status_code == 200, reg.text
        uid = reg.json()["id"]

        # Admin approves with only ["dashboard","carteira"]
        appr = admin_session.post(f"{BASE_URL}/api/admin/users/{uid}/approve",
                                  json={"permissions": ["dashboard", "carteira"], "role": "user"})
        assert appr.status_code == 200, appr.text
        assert set(appr.json()["permissions"]) == {"dashboard", "carteira"}

        # Verify via admin/users list
        lst = admin_session.get(f"{BASE_URL}/api/admin/users").json()
        limited = next((u for u in lst if u["id"] == uid), None)
        assert limited is not None
        assert set(limited["permissions"]) == {"dashboard", "carteira"}

        # Login as limited user, hit /auth/me and verify permissions
        s2 = requests.Session()
        s2.headers.update({"Content-Type": "application/json"})
        lr = s2.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": "Limit@123"})
        assert lr.status_code == 200, lr.text
        assert set(lr.json()["permissions"]) == {"dashboard", "carteira"}
        tok = lr.json().get("access_token")
        if tok:
            s2.headers.update({"Authorization": f"Bearer {tok}"})
        me = s2.get(f"{BASE_URL}/api/auth/me")
        assert me.status_code == 200
        assert set(me.json()["permissions"]) == {"dashboard", "carteira"}

        # Admin updates permissions via PUT
        upd = admin_session.put(f"{BASE_URL}/api/admin/users/{uid}/permissions",
                                json={"permissions": ["dashboard", "carteira", "programacao"], "role": "user"})
        assert upd.status_code == 200
        assert set(upd.json()["permissions"]) == {"dashboard", "carteira", "programacao"}

        # Reject unknown permission (should be filtered out)
        upd2 = admin_session.put(f"{BASE_URL}/api/admin/users/{uid}/permissions",
                                 json={"permissions": ["dashboard", "notavalidperm"], "role": "user"})
        assert upd2.status_code == 200
        assert set(upd2.json()["permissions"]) == {"dashboard"}

        # cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/users/{uid}")


def teardown_module(module):
    # Cleanup created test project for metrics
    try:
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        pid = getattr(pytest, "project_id", None)
        if pid:
            s.delete(f"{BASE_URL}/api/projects/{pid}")
    except Exception:
        pass
