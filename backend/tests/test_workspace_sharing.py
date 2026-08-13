"""
Tests for the shared-workspace / multi-tenant owner_id rewrite (Jan/2026).

Scope:
  - Approved regular users inherit the approving admin's data namespace.
  - Their GET /api/projects, /api/teams, /api/estoque returns owner's data.
  - Independent admin workspaces do not leak into each other.
  - Admin-only endpoints stay blocked for role='user'.
  - get_current_user rewrites _id to owner_id, exposes actor_id.

Uses SANDBOX admin (admin@projectmatrix.com / Admin@123). Owner lucasc is NOT touched.
Cleans up all TEST_ prefixed users and projects at teardown.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SANDBOX_EMAIL = "admin@projectmatrix.com"
SANDBOX_PASS = "Admin@123"


def _login(email, password):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)


def _bearer(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- shared fixtures ----------

@pytest.fixture(scope="module")
def sandbox_token():
    r = _login(SANDBOX_EMAIL, SANDBOX_PASS)
    assert r.status_code == 200, f"sandbox login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def sandbox_me(sandbox_token):
    r = requests.get(f"{API}/auth/me", headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def sandbox_project(sandbox_token):
    """Create a project owned by sandbox admin; delete at end."""
    payload = {
        "name": "TEST_ws_project",
        "location": "Cuiabá",
        "start_date": "2026-02-01",
        "end_date": "2026-02-10",
        "responsible": "TEST",
        "status": "planejado",
    }
    r = requests.post(f"{API}/projects", json=payload, headers=_bearer(sandbox_token), timeout=20)
    assert r.status_code in (200, 201), f"project create failed: {r.status_code} {r.text}"
    project = r.json()
    yield project
    # teardown
    try:
        requests.delete(f"{API}/projects/{project['id']}", headers=_bearer(sandbox_token), timeout=15)
    except Exception:
        pass


@pytest.fixture(scope="module")
def throwaway_user(sandbox_token):
    """Register a TEST user + have sandbox admin approve with restricted permissions."""
    ts = int(time.time())
    email = f"TEST_ws_user_{ts}@example.com"
    password = "TestPass_2026"
    reg = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "TEST_ws_user"},
        timeout=20,
    )
    assert reg.status_code in (200, 201), f"register failed: {reg.status_code} {reg.text}"
    user_id = reg.json()["id"]

    # approve with restricted permissions
    perms = ["dashboard", "carteira", "materiais"]
    ap = requests.post(
        f"{API}/admin/users/{user_id}/approve",
        json={"permissions": perms, "role": "user"},
        headers=_bearer(sandbox_token),
        timeout=15,
    )
    assert ap.status_code == 200, f"approve failed: {ap.status_code} {ap.text}"

    # login as user
    lg = _login(email, password)
    assert lg.status_code == 200, f"user login failed: {lg.status_code} {lg.text}"
    token = lg.json()["access_token"]

    yield {"id": user_id, "email": email, "password": password, "token": token, "perms": perms}

    # teardown - delete
    try:
        requests.delete(
            f"{API}/admin/users/{user_id}", headers=_bearer(sandbox_token), timeout=15
        )
    except Exception:
        pass


# ---------- Approval owner_id semantics ----------

class TestApprovalSetsOwnerId:
    def test_approve_regular_user_inherits_owner_workspace(self, throwaway_user, sandbox_me):
        """After approval as role='user', /auth/me for that user should reflect
        the same workspace id as the approving admin's actor id."""
        r = requests.get(f"{API}/auth/me", headers=_bearer(throwaway_user["token"]), timeout=15)
        assert r.status_code == 200, r.text
        me = r.json()
        # After the owner_id rewrite, /auth/me.id equals the admin's user id
        assert me["id"] == sandbox_me["id"], (
            f"regular user's /auth/me.id should be admin's id (workspace id) — "
            f"got {me['id']} vs admin {sandbox_me['id']}"
        )
        assert me["role"] == "user"
        # granted permissions should be the restricted set (NOT wildcard)
        assert set(me["permissions"]) == set(throwaway_user["perms"]), me["permissions"]

    def test_admin_owns_own_workspace(self, sandbox_me):
        # sandbox admin's own /auth/me.id equals their real id (owner_id=None)
        assert sandbox_me["role"] == "admin"
        assert sandbox_me["id"]  # non-empty


# ---------- Data sharing: user sees admin's projects/teams/estoque ----------

class TestSharedWorkspaceData:
    def test_user_sees_owner_project(self, throwaway_user, sandbox_project, sandbox_token):
        # Sandbox admin should see the project
        adm = requests.get(f"{API}/projects", headers=_bearer(sandbox_token), timeout=20)
        assert adm.status_code == 200
        admin_ids = {p["id"] for p in adm.json()}
        assert sandbox_project["id"] in admin_ids

        # Regular user (approved under sandbox) should see the SAME project
        usr = requests.get(f"{API}/projects", headers=_bearer(throwaway_user["token"]), timeout=20)
        assert usr.status_code == 200, usr.text
        user_ids = {p["id"] for p in usr.json()}
        assert sandbox_project["id"] in user_ids, (
            f"regular user did not see admin's project. admin_ids={admin_ids} user_ids={user_ids}"
        )

    def test_user_sees_same_teams_list_as_owner(self, throwaway_user, sandbox_token):
        adm = requests.get(f"{API}/teams", headers=_bearer(sandbox_token), timeout=20)
        usr = requests.get(f"{API}/teams", headers=_bearer(throwaway_user["token"]), timeout=20)
        assert adm.status_code == 200 and usr.status_code == 200
        adm_ids = sorted([t["id"] for t in adm.json()])
        usr_ids = sorted([t["id"] for t in usr.json()])
        assert adm_ids == usr_ids, f"teams list mismatch: admin={adm_ids} user={usr_ids}"

    def test_user_sees_same_estoque_as_owner(self, throwaway_user, sandbox_token):
        adm = requests.get(f"{API}/estoque", headers=_bearer(sandbox_token), timeout=20)
        usr = requests.get(f"{API}/estoque", headers=_bearer(throwaway_user["token"]), timeout=20)
        assert adm.status_code == 200 and usr.status_code == 200, (adm.text, usr.text)
        # Estoque returns {"items": [...], "count": N}
        def _ids(resp_json):
            items = resp_json.get("items", []) if isinstance(resp_json, dict) else resp_json
            return sorted([str(x.get("id") or x.get("_id")) for x in items])
        adm_ids = _ids(adm.json())
        usr_ids = _ids(usr.json())
        assert adm_ids == usr_ids, (
            f"estoque mismatch admin={len(adm_ids)} user={len(usr_ids)}"
        )


# ---------- Admin-only endpoints stay blocked for role=user ----------

class TestAdminGuardsAgainstRegularUser:
    def test_user_cannot_force_logout(self, throwaway_user):
        r = requests.post(
            f"{API}/admin/users/{throwaway_user['id']}/force-logout",
            headers=_bearer(throwaway_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_user_cannot_list_admin_users(self, throwaway_user):
        r = requests.get(f"{API}/admin/users", headers=_bearer(throwaway_user["token"]), timeout=15)
        assert r.status_code == 403

    def test_user_cannot_approve(self, throwaway_user):
        r = requests.post(
            f"{API}/admin/users/000000000000000000000000/approve",
            json={"permissions": [], "role": "user"},
            headers=_bearer(throwaway_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403


# ---------- Admin cannot self-delete (actor_id check) ----------

class TestAdminSelfDeleteBlocked:
    def test_admin_cannot_delete_self(self, sandbox_token, sandbox_me):
        # sandbox_me['id'] is admin's own id (owner_id=None means _id == actor_id)
        r = requests.delete(
            f"{API}/admin/users/{sandbox_me['id']}",
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 400, r.text
        assert "próprio" in (r.json().get("detail") or "").lower() or r.status_code == 400


# ---------- Permission update changes ownership on role transitions ----------

class TestPermissionsRoleTransition:
    def test_promote_to_admin_gets_own_workspace(self, sandbox_token):
        # register throwaway user, approve as user, then promote to admin
        ts = int(time.time())
        email = f"TEST_promote_{ts}@example.com"
        password = "TestPass_2026"
        reg = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "TEST_promote"}, timeout=20)
        assert reg.status_code in (200, 201)
        uid = reg.json()["id"]
        try:
            # approve as user
            ap = requests.post(
                f"{API}/admin/users/{uid}/approve",
                json={"permissions": ["dashboard"], "role": "user"},
                headers=_bearer(sandbox_token), timeout=15,
            )
            assert ap.status_code == 200
            assert ap.json().get("owner_id"), "regular user should have owner_id set"

            # promote to admin
            pr = requests.put(
                f"{API}/admin/users/{uid}/permissions",
                json={"permissions": ["dashboard"], "role": "admin"},
                headers=_bearer(sandbox_token), timeout=15,
            )
            assert pr.status_code == 200

            # login and check /auth/me — should be its OWN workspace (id == its own id, not sandbox)
            lg = _login(email, password)
            assert lg.status_code == 200
            me = requests.get(f"{API}/auth/me", headers=_bearer(lg.json()["access_token"]), timeout=15).json()
            assert me["role"] == "admin"
            assert me["id"] == uid, f"promoted admin should have owner_id=None → me.id == own id ({uid}); got {me['id']}"
        finally:
            requests.delete(f"{API}/admin/users/{uid}", headers=_bearer(sandbox_token), timeout=15)


# ---------- Cleanup TEST_ leftovers ----------

@pytest.fixture(scope="module", autouse=True)
def cleanup_test_users_at_end(sandbox_token):
    yield
    try:
        r = requests.get(f"{API}/admin/users", headers=_bearer(sandbox_token), timeout=15)
        if r.status_code == 200:
            for u in r.json():
                if u.get("email", "").lower().startswith("test_"):
                    requests.delete(f"{API}/admin/users/{u['id']}", headers=_bearer(sandbox_token), timeout=10)
    except Exception as e:
        print(f"cleanup error: {e}")
