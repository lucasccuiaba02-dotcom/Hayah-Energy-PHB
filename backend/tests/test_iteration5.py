"""Backend tests for Hayah Energy iteration 5 new features.

Covers:
- Team fields: supervisor, member_count
- Project fields: labor_cost, material_cost, location, material_status, execution_status, is_scheduled
- GET /api/projects?is_scheduled=true filter
- NEW: GET /api/schedule/stats
- NEW: GET /api/analytics/advanced
- NEW: GET /api/reports/excel
- NEW: POST /api/schedule/notify-tomorrow (no RESEND_API_KEY -> skipped, no crash)
- Auto execution_status='programado' when is_scheduled=True
"""

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


def _project_payload(**overrides):
    today = datetime.now(timezone.utc).date()
    payload = {
        "name": f"TEST_It5_{uuid.uuid4().hex[:6]}",
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=3)).isoformat(),
        "programmed_value": 10000.0,
        "daily_goal": 1000.0,
        "status": "active",
        "priority": "high",
        "actual_value": 500.0,
        "billing_value": 8500.0,
        "project_type": "anexo_iv",
        "requires_hot_line": True,
        "shutdown_info": "Feeder 05",
        "location": "Cuiabá - Centro",
        "labor_cost": 2500.0,
        "material_cost": 1500.0,
        "material_status": "partial",
        "execution_status": "aguardando_inicio",
        "is_scheduled": True,
    }
    payload.update(overrides)
    return payload


# --------- Team supervisor & member_count ---------
class TestTeamNewFields:
    def test_create_team_with_supervisor_and_member_count(self, admin_session):
        r = admin_session.post(f"{API}/teams", json={
            "name": f"TEST_It5Team_{uuid.uuid4().hex[:6]}",
            "members": ["A", "B", "C"],
            "supervisor": "Encarregado João",
            "member_count": 5,
        }, timeout=30)
        assert r.status_code == 200, r.text
        team = r.json()
        try:
            assert team["supervisor"] == "Encarregado João"
            assert team["member_count"] == 5

            g = admin_session.get(f"{API}/teams/{team['id']}", timeout=30)
            assert g.status_code == 200
            assert g.json()["supervisor"] == "Encarregado João"
            assert g.json()["member_count"] == 5
        finally:
            admin_session.delete(f"{API}/teams/{team['id']}", timeout=30)

    def test_update_team_supervisor(self, admin_session):
        r = admin_session.post(f"{API}/teams", json={
            "name": f"TEST_It5Team_{uuid.uuid4().hex[:6]}",
            "members": ["X"],
            "supervisor": "Old",
            "member_count": 1,
        }, timeout=30)
        tid = r.json()["id"]
        try:
            ru = admin_session.put(f"{API}/teams/{tid}", json={
                "name": r.json()["name"],
                "members": ["X", "Y"],
                "supervisor": "New Sup",
                "member_count": 2,
            }, timeout=30)
            assert ru.status_code == 200
            assert ru.json()["supervisor"] == "New Sup"
            assert ru.json()["member_count"] == 2
        finally:
            admin_session.delete(f"{API}/teams/{tid}", timeout=30)

    def test_member_count_defaults_to_members_length_when_zero(self, admin_session):
        r = admin_session.post(f"{API}/teams", json={
            "name": f"TEST_It5Team_{uuid.uuid4().hex[:6]}",
            "members": ["A", "B"],
            "supervisor": "",
            "member_count": 0,
        }, timeout=30)
        tid = r.json()["id"]
        try:
            assert r.json()["member_count"] == 2  # falls back to len(members)
        finally:
            admin_session.delete(f"{API}/teams/{tid}", timeout=30)


# --------- Project new iteration 5 fields ---------
class TestProjectIt5Fields:
    def test_create_project_with_all_it5_fields(self, admin_session):
        r = admin_session.post(f"{API}/projects", json=_project_payload(), timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert p["location"] == "Cuiabá - Centro"
            assert p["labor_cost"] == 2500.0
            assert p["material_cost"] == 1500.0
            assert p["material_status"] == "partial"
            # is_scheduled=True should auto-flip execution_status from aguardando_inicio -> programado
            assert p["execution_status"] == "programado"
            assert p["is_scheduled"] is True
        finally:
            admin_session.delete(f"{API}/projects/{p['id']}", timeout=30)

    def test_new_project_types_accepted(self, admin_session):
        for pt in ["anexo_iv", "po", "nivel_tensao", "seguranca", "particular",
                   "extensao_rede_bt", "extensao_rede_mt", "extensao_rede_monofasica_rural",
                   "regulador", "religador", "troca_trafo_mono", "troca_trafo_tri"]:
            r = admin_session.post(f"{API}/projects", json=_project_payload(project_type=pt, is_scheduled=False), timeout=30)
            assert r.status_code == 200, f"type {pt} failed: {r.text}"
            pid = r.json()["id"]
            assert r.json()["project_type"] == pt
            admin_session.delete(f"{API}/projects/{pid}", timeout=30)

    def test_is_scheduled_false_keeps_execution_status(self, admin_session):
        r = admin_session.post(f"{API}/projects", json=_project_payload(is_scheduled=False, execution_status="aguardando_inicio"), timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        try:
            assert r.json()["execution_status"] == "aguardando_inicio"
            assert r.json()["is_scheduled"] is False
        finally:
            admin_session.delete(f"{API}/projects/{pid}", timeout=30)


# --------- GET /projects filter ---------
class TestIsScheduledFilter:
    def test_filter_is_scheduled_true(self, admin_session):
        p_sch = admin_session.post(f"{API}/projects", json=_project_payload(is_scheduled=True), timeout=30).json()
        p_cart = admin_session.post(f"{API}/projects", json=_project_payload(is_scheduled=False), timeout=30).json()
        try:
            r_sch = admin_session.get(f"{API}/projects", params={"is_scheduled": "true"}, timeout=30)
            assert r_sch.status_code == 200
            ids_sch = [x["id"] for x in r_sch.json()]
            assert p_sch["id"] in ids_sch
            assert p_cart["id"] not in ids_sch

            r_cart = admin_session.get(f"{API}/projects", params={"is_scheduled": "false"}, timeout=30)
            assert r_cart.status_code == 200
            ids_cart = [x["id"] for x in r_cart.json()]
            assert p_cart["id"] in ids_cart
            assert p_sch["id"] not in ids_cart
        finally:
            admin_session.delete(f"{API}/projects/{p_sch['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p_cart['id']}", timeout=30)


# --------- /api/schedule/stats ---------
class TestScheduleStats:
    def test_schedule_stats_shape_and_counts(self, admin_session):
        r = admin_session.get(f"{API}/schedule/stats", timeout=30)
        assert r.status_code == 200, r.text
        pre = r.json()
        for k in ["total_programmed", "total_billing", "total_labor", "total_material", "counts", "total_projects"]:
            assert k in pre
        # counts must expose all 5 labels
        for label in ["Aguardando Início", "Programado", "Em Execução", "Concluído", "Cancelado"]:
            assert label in pre["counts"]

        # Create 2 scheduled projects
        p1 = admin_session.post(f"{API}/projects", json=_project_payload(
            is_scheduled=True, execution_status="em_execucao",
            programmed_value=1000, billing_value=800, labor_cost=200, material_cost=100,
        ), timeout=30).json()
        p2 = admin_session.post(f"{API}/projects", json=_project_payload(
            is_scheduled=True, execution_status="concluido",
            programmed_value=2000, billing_value=1500, labor_cost=400, material_cost=200,
        ), timeout=30).json()
        try:
            r2 = admin_session.get(f"{API}/schedule/stats", timeout=30)
            post = r2.json()
            # deltas
            assert round(post["total_programmed"] - pre["total_programmed"], 2) == 3000.0
            assert round(post["total_billing"] - pre["total_billing"], 2) == 2300.0
            assert round(post["total_labor"] - pre["total_labor"], 2) == 600.0
            assert round(post["total_material"] - pre["total_material"], 2) == 300.0
            assert post["counts"]["Em Execução"] == pre["counts"]["Em Execução"] + 1
            assert post["counts"]["Concluído"] == pre["counts"]["Concluído"] + 1
        finally:
            admin_session.delete(f"{API}/projects/{p1['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p2['id']}", timeout=30)

    def test_schedule_stats_requires_auth(self):
        r = requests.get(f"{API}/schedule/stats", timeout=30)
        assert r.status_code == 401


# --------- /api/analytics/advanced ---------
class TestAnalyticsAdvanced:
    def test_advanced_endpoint_shape(self, admin_session):
        r = admin_session.get(f"{API}/analytics/advanced", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "monthly" in data
        assert "team_performance" in data
        assert isinstance(data["monthly"], list)
        assert isinstance(data["team_performance"], list)

    def test_advanced_productivity_calculation(self, admin_session):
        # Create team + 1 project
        tr = admin_session.post(f"{API}/teams", json={
            "name": f"TEST_It5AdvTeam_{uuid.uuid4().hex[:6]}",
            "members": ["A"], "supervisor": "S", "member_count": 1,
        }, timeout=30)
        tid = tr.json()["id"]
        tname = tr.json()["name"]
        p = admin_session.post(f"{API}/projects", json=_project_payload(
            team_id=tid, team_name=tname,
            programmed_value=1000, actual_value=750, billing_value=800,
        ), timeout=30).json()
        try:
            r = admin_session.get(f"{API}/analytics/advanced", timeout=30)
            data = r.json()
            perf = {t["team"]: t for t in data["team_performance"]}
            assert tname in perf
            row = perf[tname]
            assert row["productivity"] == 75.0
            assert row["programmed"] >= 1000
            assert row["actual"] >= 750
        finally:
            admin_session.delete(f"{API}/projects/{p['id']}", timeout=30)
            admin_session.delete(f"{API}/teams/{tid}", timeout=30)

    def test_advanced_requires_auth(self):
        r = requests.get(f"{API}/analytics/advanced", timeout=30)
        assert r.status_code == 401


# --------- /api/reports/excel ---------
class TestReportsExcel:
    @pytest.mark.parametrize("rtype", ["programacao", "carteira", "producao", "faturamento"])
    def test_excel_export_all_types(self, admin_session, rtype):
        r = admin_session.get(f"{API}/reports/excel", params={"report_type": rtype}, timeout=60)
        assert r.status_code == 200, f"{rtype} export failed: {r.status_code} {r.text[:200]}"
        # Content-Type: xlsx
        ct = r.headers.get("content-type", "")
        assert "spreadsheetml" in ct or "openxmlformats" in ct, f"unexpected content-type: {ct}"
        # Content-Disposition attachment
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd, f"missing attachment header: {cd}"
        assert f"hayah_{rtype}" in cd
        # xlsx zip magic bytes PK\x03\x04
        assert r.content[:2] == b"PK", "content is not a valid xlsx (missing PK magic)"

    def test_excel_requires_auth(self):
        r = requests.get(f"{API}/reports/excel", params={"report_type": "programacao"}, timeout=30)
        assert r.status_code == 401


# --------- /api/schedule/notify-tomorrow ---------
class TestNotifyTomorrow:
    def test_notify_tomorrow_returns_ok_when_no_key(self, admin_session):
        # RESEND_API_KEY is empty -> helper returns skipped, endpoint returns {status: triggered}
        r = admin_session.post(f"{API}/schedule/notify-tomorrow", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("status") == "triggered"

    def test_notify_tomorrow_requires_auth(self):
        r = requests.post(f"{API}/schedule/notify-tomorrow", timeout=30)
        assert r.status_code == 401


# --------- Auto scheduling side-effects ---------
class TestAutoScheduledSideEffect:
    def test_scheduled_project_does_not_crash_without_resend_key(self, admin_session):
        # Because we fire-and-forget email, request should still complete successfully.
        r = admin_session.post(f"{API}/projects", json=_project_payload(is_scheduled=True), timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        try:
            assert r.json()["execution_status"] == "programado"
        finally:
            admin_session.delete(f"{API}/projects/{pid}", timeout=30)
