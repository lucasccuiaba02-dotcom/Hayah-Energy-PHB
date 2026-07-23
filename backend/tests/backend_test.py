"""Backend API tests for Project Matrix app.

Covers: auth (register/login/me/logout), teams CRUD, projects CRUD,
dashboard stats, and protected-endpoint 401s.
"""

import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


# --------- Fixtures ---------
@pytest.fixture(scope="session")
def admin_session():
    """Login as admin and return a requests.Session with cookies."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin_bearer_token():
    """Extract token from Set-Cookie for pure Authorization-header calls."""
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200
    token = r.cookies.get("access_token")
    assert token, "access_token cookie not set"
    return token


# --------- Auth Tests ---------
class TestAuth:
    def test_login_admin_success_sets_cookies(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"
        assert data["name"]
        # cookies set
        assert s.cookies.get("access_token"), "access_token cookie missing"
        assert s.cookies.get("refresh_token"), "refresh_token cookie missing"

    def test_login_wrong_password_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "WrongPass!"}, timeout=30)
        assert r.status_code == 401

    def test_login_unknown_email_401(self):
        r = requests.post(f"{API}/auth/login", json={"email": f"noone_{uuid.uuid4().hex[:6]}@x.com", "password": "whatever"}, timeout=30)
        assert r.status_code == 401

    def test_me_returns_user(self, admin_session):
        r = admin_session.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_me_without_cookie_401(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_register_new_user_creates_and_sets_cookies(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        s = requests.Session()
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!", "name": "TEST_User"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == email
        assert d["role"] == "user"
        assert s.cookies.get("access_token")

        # /me should work with same session
        me = s.get(f"{API}/auth/me", timeout=30)
        assert me.status_code == 200
        assert me.json()["email"] == email

    def test_register_duplicate_email_400(self):
        email = f"dup_{uuid.uuid4().hex[:6]}@example.com"
        payload = {"email": email, "password": "Passw0rd!", "name": "Dup"}
        r1 = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register", json=payload, timeout=30)
        assert r2.status_code == 400

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert s.cookies.get("access_token")
        r = s.post(f"{API}/auth/logout", timeout=30)
        assert r.status_code == 200


# --------- Protected endpoints ---------
class TestProtectedRoutes:
    @pytest.mark.parametrize("path", [
        "/teams", "/projects", "/dashboard/stats"
    ])
    def test_unauthenticated_401(self, path):
        r = requests.get(f"{API}{path}", timeout=30)
        assert r.status_code == 401


# --------- Teams CRUD ---------
class TestTeamsCRUD:
    def test_full_team_lifecycle(self, admin_session):
        # CREATE
        payload = {"name": f"TEST_Team_{uuid.uuid4().hex[:6]}", "members": ["Alice", "Bob"]}
        r = admin_session.post(f"{API}/teams", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        team = r.json()
        assert team["name"] == payload["name"]
        assert team["members"] == ["Alice", "Bob"]
        assert team["id"]
        team_id = team["id"]

        # LIST includes it
        rlist = admin_session.get(f"{API}/teams", timeout=30)
        assert rlist.status_code == 200
        ids = [t["id"] for t in rlist.json()]
        assert team_id in ids

        # GET by id
        rget = admin_session.get(f"{API}/teams/{team_id}", timeout=30)
        assert rget.status_code == 200
        assert rget.json()["name"] == payload["name"]

        # UPDATE
        new_name = f"TEST_Team_upd_{uuid.uuid4().hex[:4]}"
        rupd = admin_session.put(f"{API}/teams/{team_id}", json={"name": new_name, "members": ["Alice"]}, timeout=30)
        assert rupd.status_code == 200
        assert rupd.json()["name"] == new_name
        assert rupd.json()["members"] == ["Alice"]

        # DELETE
        rdel = admin_session.delete(f"{API}/teams/{team_id}", timeout=30)
        assert rdel.status_code == 200

        # GET after delete -> 404
        rget2 = admin_session.get(f"{API}/teams/{team_id}", timeout=30)
        assert rget2.status_code == 404


# --------- Projects CRUD ---------
class TestProjectsCRUD:
    def _make_payload(self, name_suffix="", **overrides):
        today = datetime.now(timezone.utc).date()
        payload = {
            "name": f"TEST_Project_{name_suffix or uuid.uuid4().hex[:6]}",
            "team_name": "TEST_Team_X",
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=6)).isoformat(),
            "programmed_value": 10000.0,
            "daily_goal": 1000.0,
            "status": "active",
            "priority": "high",
            "actual_value": 500.0,
        }
        payload.update(overrides)
        return payload

    def test_create_list_update_delete(self, admin_session):
        payload = self._make_payload()
        r = admin_session.post(f"{API}/projects", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == payload["name"]
        assert p["programmed_value"] == 10000.0
        assert p["actual_value"] == 500.0
        pid = p["id"]

        # LIST
        rlist = admin_session.get(f"{API}/projects", timeout=30)
        assert rlist.status_code == 200
        assert any(x["id"] == pid for x in rlist.json())

        # UPDATE actual_value
        rupd = admin_session.put(f"{API}/projects/{pid}", json={"actual_value": 3500.0, "priority": "medium"}, timeout=30)
        assert rupd.status_code == 200
        assert rupd.json()["actual_value"] == 3500.0
        assert rupd.json()["priority"] == "medium"

        # GET verifies persistence
        rget = admin_session.get(f"{API}/projects/{pid}", timeout=30)
        assert rget.status_code == 200
        assert rget.json()["actual_value"] == 3500.0

        # DELETE
        rdel = admin_session.delete(f"{API}/projects/{pid}", timeout=30)
        assert rdel.status_code == 200

        rget2 = admin_session.get(f"{API}/projects/{pid}", timeout=30)
        assert rget2.status_code == 404

    def test_update_empty_400(self, admin_session):
        # Create a project first
        r = admin_session.post(f"{API}/projects", json=self._make_payload(), timeout=30)
        pid = r.json()["id"]
        try:
            rupd = admin_session.put(f"{API}/projects/{pid}", json={}, timeout=30)
            assert rupd.status_code == 400
        finally:
            admin_session.delete(f"{API}/projects/{pid}", timeout=30)


# --------- Dashboard stats ---------
class TestDashboardStats:
    def test_stats_calculation_on_track_vs_lagging(self, admin_session):
        # Cleanup existing projects for this user? We only create new, but existing may skew.
        # Instead, snapshot counts, create 2 specific projects, verify deltas.
        pre = admin_session.get(f"{API}/dashboard/stats", timeout=30).json()

        today = datetime.now(timezone.utc).date()
        # Project 1: on-track (actual >= daily_goal * 1 day)
        p1_payload = {
            "name": f"TEST_OnTrack_{uuid.uuid4().hex[:4]}",
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=4)).isoformat(),
            "programmed_value": 5000.0,
            "daily_goal": 1000.0,
            "status": "active",
            "priority": "high",
            "actual_value": 2000.0,  # >= 1000
        }
        # Project 2: lagging (actual < daily_goal * 1)
        p2_payload = {
            "name": f"TEST_Lagging_{uuid.uuid4().hex[:4]}",
            "start_date": today.isoformat(),
            "end_date": (today + timedelta(days=4)).isoformat(),
            "programmed_value": 5000.0,
            "daily_goal": 1000.0,
            "status": "active",
            "priority": "high",
            "actual_value": 100.0,  # < 1000
        }
        r1 = admin_session.post(f"{API}/projects", json=p1_payload, timeout=30)
        r2 = admin_session.post(f"{API}/projects", json=p2_payload, timeout=30)
        assert r1.status_code == 200 and r2.status_code == 200
        p1_id, p2_id = r1.json()["id"], r2.json()["id"]

        try:
            post = admin_session.get(f"{API}/dashboard/stats", timeout=30).json()
            # Basic keys present
            for k in ["total_projects", "active_projects", "total_programmed", "total_actual",
                      "total_teams", "projects_on_track", "projects_lagging"]:
                assert k in post

            assert post["total_projects"] == pre["total_projects"] + 2
            assert post["projects_on_track"] == pre["projects_on_track"] + 1
            assert post["projects_lagging"] == pre["projects_lagging"] + 1
            assert round(post["total_programmed"] - pre["total_programmed"], 2) == 10000.0
            assert round(post["total_actual"] - pre["total_actual"], 2) == 2100.0
        finally:
            admin_session.delete(f"{API}/projects/{p1_id}", timeout=30)
            admin_session.delete(f"{API}/projects/{p2_id}", timeout=30)


# --------- Bearer token auth ---------
class TestBearerAuth:
    def test_bearer_header_works(self, admin_bearer_token):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {admin_bearer_token}"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL
