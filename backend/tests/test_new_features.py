"""Backend tests for Hayah Energy iteration 4 new features.

Covers:
- Project new fields: billing_value, project_type, requires_hot_line, shutdown_info
- GET /api/projects filters (start_date, end_date, team_id)
- Dashboard stats now includes total_billing
- NEW: GET /api/analytics/production with filters
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


@pytest.fixture(scope="module")
def team_id(admin_session):
    """Create a dedicated team for the tests."""
    r = admin_session.post(
        f"{API}/teams",
        json={"name": f"TEST_HayahTeam_{uuid.uuid4().hex[:6]}", "members": ["Op1", "Op2"]},
        timeout=30,
    )
    assert r.status_code == 200
    tid = r.json()["id"]
    yield tid
    admin_session.delete(f"{API}/teams/{tid}", timeout=30)


def _project_payload(team_id=None, team_name=None, **overrides):
    today = datetime.now(timezone.utc).date()
    payload = {
        "name": f"TEST_HayahProj_{uuid.uuid4().hex[:6]}",
        "team_id": team_id,
        "team_name": team_name,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=6)).isoformat(),
        "programmed_value": 10000.0,
        "daily_goal": 1000.0,
        "status": "active",
        "priority": "high",
        "actual_value": 500.0,
        "billing_value": 8500.5,
        "project_type": "manutencao_corretiva",
        "requires_hot_line": True,
        "shutdown_info": "Alimentador 05 - 08:00 às 17:00",
    }
    payload.update(overrides)
    return payload


# --------- New Project fields ---------
class TestProjectNewFields:
    def test_create_project_with_all_new_fields(self, admin_session, team_id):
        payload = _project_payload(team_id=team_id, team_name="TEST_HayahTeam")
        r = admin_session.post(f"{API}/projects", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            # Assert all new fields returned
            assert p["billing_value"] == 8500.5
            assert p["project_type"] == "manutencao_corretiva"
            assert p["requires_hot_line"] is True
            assert p["shutdown_info"] == "Alimentador 05 - 08:00 às 17:00"

            # GET verifies persistence
            g = admin_session.get(f"{API}/projects/{p['id']}", timeout=30)
            assert g.status_code == 200
            gd = g.json()
            assert gd["billing_value"] == 8500.5
            assert gd["project_type"] == "manutencao_corretiva"
            assert gd["requires_hot_line"] is True
            assert gd["shutdown_info"] == "Alimentador 05 - 08:00 às 17:00"
        finally:
            admin_session.delete(f"{API}/projects/{p['id']}", timeout=30)

    def test_create_project_defaults_for_new_fields(self, admin_session):
        # Omit new fields entirely -> defaults must apply
        today = datetime.now(timezone.utc).date()
        r = admin_session.post(f"{API}/projects", json={
            "name": f"TEST_Defaults_{uuid.uuid4().hex[:6]}",
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=3)).isoformat(),
            "programmed_value": 1000.0,
            "daily_goal": 100.0,
        }, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        try:
            assert p["billing_value"] == 0.0
            assert p["project_type"] == "manutencao_preventiva"
            assert p["requires_hot_line"] is False
            assert p["shutdown_info"] == ""
        finally:
            admin_session.delete(f"{API}/projects/{p['id']}", timeout=30)

    def test_update_project_new_fields(self, admin_session):
        # Create baseline
        r = admin_session.post(f"{API}/projects", json=_project_payload(), timeout=30)
        assert r.status_code == 200
        pid = r.json()["id"]
        try:
            # Update new fields
            ru = admin_session.put(f"{API}/projects/{pid}", json={
                "billing_value": 12345.67,
                "project_type": "obra_nova",
                "requires_hot_line": False,
                "shutdown_info": "Sem desligamento",
            }, timeout=30)
            assert ru.status_code == 200
            up = ru.json()
            assert up["billing_value"] == 12345.67
            assert up["project_type"] == "obra_nova"
            assert up["requires_hot_line"] is False
            assert up["shutdown_info"] == "Sem desligamento"

            # Persistence
            g = admin_session.get(f"{API}/projects/{pid}", timeout=30)
            assert g.status_code == 200
            gd = g.json()
            assert gd["billing_value"] == 12345.67
            assert gd["project_type"] == "obra_nova"
            assert gd["requires_hot_line"] is False
        finally:
            admin_session.delete(f"{API}/projects/{pid}", timeout=30)


# --------- GET /api/projects filters ---------
class TestProjectListFilters:
    def test_filter_by_team_id(self, admin_session, team_id):
        # Create 1 project WITH team, 1 WITHOUT team
        p_with = admin_session.post(f"{API}/projects", json=_project_payload(team_id=team_id, team_name="TEST_HayahTeam"), timeout=30).json()
        p_wo = admin_session.post(f"{API}/projects", json=_project_payload(team_id=None, team_name=None), timeout=30).json()
        try:
            r = admin_session.get(f"{API}/projects", params={"team_id": team_id}, timeout=30)
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()]
            assert p_with["id"] in ids
            assert p_wo["id"] not in ids
        finally:
            admin_session.delete(f"{API}/projects/{p_with['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p_wo['id']}", timeout=30)

    def test_filter_by_date_range(self, admin_session):
        # Create 3 projects with disjoint date ranges
        p_far_past = admin_session.post(f"{API}/projects", json=_project_payload(
            start_date="2020-01-01", end_date="2020-01-10"
        ), timeout=30).json()
        p_mid = admin_session.post(f"{API}/projects", json=_project_payload(
            start_date="2025-06-01", end_date="2025-06-10"
        ), timeout=30).json()
        p_future = admin_session.post(f"{API}/projects", json=_project_payload(
            start_date="2030-01-01", end_date="2030-01-10"
        ), timeout=30).json()
        try:
            # Only middle should match window 2025-01-01 -> 2025-12-31
            r = admin_session.get(f"{API}/projects", params={
                "start_date": "2025-01-01", "end_date": "2025-12-31"
            }, timeout=30)
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()]
            assert p_mid["id"] in ids
            assert p_far_past["id"] not in ids
            assert p_future["id"] not in ids
        finally:
            for pid in (p_far_past["id"], p_mid["id"], p_future["id"]):
                admin_session.delete(f"{API}/projects/{pid}", timeout=30)


# --------- Dashboard stats: total_billing ---------
class TestDashboardBilling:
    def test_total_billing_included_and_summed(self, admin_session):
        pre = admin_session.get(f"{API}/dashboard/stats", timeout=30).json()
        assert "total_billing" in pre  # new field must exist
        assert isinstance(pre["total_billing"], (int, float))

        # Create 2 projects with billing_value totaling 500 + 750.25
        p1 = admin_session.post(f"{API}/projects", json=_project_payload(billing_value=500.0), timeout=30).json()
        p2 = admin_session.post(f"{API}/projects", json=_project_payload(billing_value=750.25), timeout=30).json()
        try:
            post = admin_session.get(f"{API}/dashboard/stats", timeout=30).json()
            delta = round(post["total_billing"] - pre["total_billing"], 2)
            assert delta == 1250.25, f"expected +1250.25, got {delta}"
        finally:
            admin_session.delete(f"{API}/projects/{p1['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p2['id']}", timeout=30)


# --------- NEW: /api/analytics/production ---------
class TestAnalyticsProduction:
    def test_analytics_endpoint_exists_and_shape(self, admin_session):
        r = admin_session.get(f"{API}/analytics/production", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Required keys
        for k in ["by_team", "by_type", "by_status", "hot_line_count", "total_projects"]:
            assert k in data, f"missing key: {k}"
        assert isinstance(data["by_team"], list)
        assert isinstance(data["by_type"], list)
        assert isinstance(data["by_status"], dict)
        assert "active" in data["by_status"]
        assert "paused" in data["by_status"]
        assert isinstance(data["hot_line_count"], int)
        assert isinstance(data["total_projects"], int)

    def test_analytics_groups_by_team_and_type(self, admin_session, team_id):
        # Create 2 projects on the team with different types + one hot line
        p1 = admin_session.post(f"{API}/projects", json=_project_payload(
            team_id=team_id, team_name="TEST_HayahTeam",
            project_type="obra_nova", requires_hot_line=True,
            programmed_value=2000, actual_value=1000, billing_value=1500,
        ), timeout=30).json()
        p2 = admin_session.post(f"{API}/projects", json=_project_payload(
            team_id=team_id, team_name="TEST_HayahTeam",
            project_type="poda", requires_hot_line=False,
            programmed_value=3000, actual_value=1500, billing_value=2500,
        ), timeout=30).json()
        try:
            r = admin_session.get(f"{API}/analytics/production", params={"team_id": team_id}, timeout=30)
            assert r.status_code == 200
            data = r.json()

            # Only our 2 team projects should be counted since filter=team_id
            assert data["total_projects"] == 2
            assert data["hot_line_count"] == 1

            # by_team should contain a single entry for our team (name TEST_HayahTeam)
            teams = {t["team"]: t for t in data["by_team"]}
            assert "TEST_HayahTeam" in teams
            row = teams["TEST_HayahTeam"]
            assert row["count"] == 2
            assert row["programmed"] == 5000
            assert row["actual"] == 2500
            assert row["billing"] == 4000

            # by_type should have 2 labels: Obra Nova + Poda de Vegetação
            labels = {t["type"] for t in data["by_type"]}
            assert "Obra Nova" in labels
            assert "Poda de Vegetação" in labels
        finally:
            admin_session.delete(f"{API}/projects/{p1['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p2['id']}", timeout=30)

    def test_analytics_date_filter_excludes_out_of_range(self, admin_session, team_id):
        p_out = admin_session.post(f"{API}/projects", json=_project_payload(
            team_id=team_id, team_name="TEST_HayahTeam",
            start_date="2020-01-01", end_date="2020-01-10",
        ), timeout=30).json()
        p_in = admin_session.post(f"{API}/projects", json=_project_payload(
            team_id=team_id, team_name="TEST_HayahTeam",
            start_date="2025-06-01", end_date="2025-06-10",
        ), timeout=30).json()
        try:
            r = admin_session.get(f"{API}/analytics/production", params={
                "team_id": team_id, "start_date": "2025-01-01", "end_date": "2025-12-31"
            }, timeout=30)
            assert r.status_code == 200
            data = r.json()
            assert data["total_projects"] == 1
        finally:
            admin_session.delete(f"{API}/projects/{p_out['id']}", timeout=30)
            admin_session.delete(f"{API}/projects/{p_in['id']}", timeout=30)

    def test_analytics_requires_auth(self):
        r = requests.get(f"{API}/analytics/production", timeout=30)
        assert r.status_code == 401
