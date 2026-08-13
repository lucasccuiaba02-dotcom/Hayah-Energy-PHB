"""
Tests for session_version-based revocation + password management (Fev/2026).
Covers:
  - /api/auth/change-password (auth required, wrong pass, short pass, same-as-current, success)
  - /api/auth/logout-all-devices (revokes prior tokens, issues new)
  - /api/admin/users/{id}/force-logout (admin only)
  - /api/admin/users/{id}/reset-password (admin only, min length, revokes target)
  - JWT sv claim verified against DB user.session_version
Uses the SANDBOX admin admin@projectmatrix.com/Admin@123 (restored at end).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SANDBOX_EMAIL = "admin@projectmatrix.com"
SANDBOX_PASS = "Admin@123"
TEMP_PASS = "TempTest_2026"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    return r


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- fixtures ----------

@pytest.fixture()
def sandbox_token():
    r = _login(SANDBOX_EMAIL, SANDBOX_PASS)
    assert r.status_code == 200, f"sandbox login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "access_token" in data and data["access_token"]
    return data["access_token"]


@pytest.fixture()
def sandbox_user_id(sandbox_token):
    r = requests.get(f"{API}/auth/me", headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 200
    return r.json()["id"]


# ---------- auth guardrails ----------

class TestAuthGuardrails:
    def test_change_password_requires_auth(self):
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "x", "new_password": "yyyyyyyy"}, timeout=15)
        assert r.status_code == 401

    def test_logout_all_devices_requires_auth(self):
        r = requests.post(f"{API}/auth/logout-all-devices", timeout=15)
        assert r.status_code == 401

    def test_force_logout_requires_admin_unauth(self):
        r = requests.post(f"{API}/admin/users/000000000000000000000000/force-logout", timeout=15)
        assert r.status_code == 401

    def test_reset_password_requires_admin_unauth(self):
        r = requests.post(f"{API}/admin/users/000000000000000000000000/reset-password", json={"new_password": "abcdefgh"}, timeout=15)
        assert r.status_code == 401


# ---------- change-password validation ----------

class TestChangePasswordValidation:
    def test_wrong_current_password(self, sandbox_token):
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "totally-wrong", "new_password": "AnotherOne_2026"},
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 400
        assert "Senha atual incorreta" in r.text

    def test_short_new_password(self, sandbox_token):
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": SANDBOX_PASS, "new_password": "short"},
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 400
        assert "pelo menos 8" in r.text

    def test_same_as_current(self, sandbox_token):
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": SANDBOX_PASS, "new_password": SANDBOX_PASS},
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 400


# ---------- non-admin cannot call admin endpoints ----------

class TestAdminOnlyEnforcement:
    """Register a fresh non-admin user, then verify admin endpoints reject them."""

    @pytest.fixture()
    def normal_user(self, sandbox_token):
        import time, uuid
        email = f"TEST_user_{int(time.time())}_{uuid.uuid4().hex[:6]}@example.com"
        password = "UserPass_2026"
        rr = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "TEST User"}, timeout=15)
        if rr.status_code not in (200, 201):
            pytest.skip(f"register failed ({rr.status_code}): {rr.text[:200]}")
        uid = rr.json().get("id")
        assert uid, "register did not return id"
        # approve as non-admin user with basic perms
        requests.post(f"{API}/admin/users/{uid}/approve",
                      json={"role": "user", "permissions": ["dashboard"]},
                      headers=_bearer(sandbox_token), timeout=15)
        lr = _login(email, password)
        if lr.status_code != 200:
            pytest.skip(f"post-approval login failed: {lr.status_code} {lr.text[:200]}")
        yield {"email": email, "password": password, "token": lr.json()["access_token"], "id": uid}
        try:
            requests.delete(f"{API}/admin/users/{uid}", headers=_bearer(sandbox_token), timeout=15)
        except Exception:
            pass

    def test_non_admin_cannot_force_logout(self, normal_user, sandbox_user_id):
        r = requests.post(
            f"{API}/admin/users/{sandbox_user_id}/force-logout",
            headers=_bearer(normal_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403

    def test_non_admin_cannot_reset_password(self, normal_user, sandbox_user_id):
        r = requests.post(
            f"{API}/admin/users/{sandbox_user_id}/reset-password",
            json={"new_password": "abcdefgh"},
            headers=_bearer(normal_user["token"]),
            timeout=15,
        )
        assert r.status_code == 403


# ---------- admin reset-password validation ----------

class TestAdminResetPasswordValidation:
    def test_short_password_rejected(self, sandbox_token, sandbox_user_id):
        r = requests.post(
            f"{API}/admin/users/{sandbox_user_id}/reset-password",
            json={"new_password": "short"},
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 400


# ---------- full logout-all-devices flow ----------

class TestLogoutAllDevices:
    def test_logout_all_invalidates_prior_token(self):
        # Fresh login → token A
        rA = _login(SANDBOX_EMAIL, SANDBOX_PASS)
        assert rA.status_code == 200
        token_a = rA.json()["access_token"]

        # /auth/me works
        m1 = requests.get(f"{API}/auth/me", headers=_bearer(token_a), timeout=15)
        assert m1.status_code == 200

        # revoke-all
        rev = requests.post(f"{API}/auth/logout-all-devices", headers=_bearer(token_a), timeout=15)
        assert rev.status_code == 200
        body = rev.json()
        assert body["status"] == "revoked"
        assert "session_version" in body and isinstance(body["session_version"], int)
        assert "access_token" in body and body["access_token"]
        new_token = body["access_token"]

        # Old token is dead
        m2 = requests.get(f"{API}/auth/me", headers=_bearer(token_a), timeout=15)
        assert m2.status_code == 401
        assert "Sessão revogada" in m2.text

        # New token works
        m3 = requests.get(f"{API}/auth/me", headers=_bearer(new_token), timeout=15)
        assert m3.status_code == 200


# ---------- full change-password flow + restore ----------

class TestChangePasswordFlow:
    def test_change_password_then_restore(self):
        # login with original
        r1 = _login(SANDBOX_EMAIL, SANDBOX_PASS)
        assert r1.status_code == 200
        old_token = r1.json()["access_token"]

        # change to TEMP_PASS
        ch = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": SANDBOX_PASS, "new_password": TEMP_PASS},
            headers=_bearer(old_token),
            timeout=15,
        )
        assert ch.status_code == 200, ch.text
        body = ch.json()
        assert body["status"] == "changed"
        assert body.get("access_token")
        assert isinstance(body.get("session_version"), int)
        new_token = body["access_token"]

        # old token revoked
        old = requests.get(f"{API}/auth/me", headers=_bearer(old_token), timeout=15)
        assert old.status_code == 401
        assert "Sessão revogada" in old.text

        # new token works
        m = requests.get(f"{API}/auth/me", headers=_bearer(new_token), timeout=15)
        assert m.status_code == 200
        assert m.json()["email"] == SANDBOX_EMAIL

        # login with old password must fail
        bad = _login(SANDBOX_EMAIL, SANDBOX_PASS)
        assert bad.status_code == 401

        # login with new password works
        good = _login(SANDBOX_EMAIL, TEMP_PASS)
        assert good.status_code == 200

        # ---- restore to original ----
        restore = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": TEMP_PASS, "new_password": SANDBOX_PASS},
            headers=_bearer(good.json()["access_token"]),
            timeout=15,
        )
        assert restore.status_code == 200, f"RESTORE FAILED — sandbox pw not restored! {restore.text}"

        # confirm restoration
        final = _login(SANDBOX_EMAIL, SANDBOX_PASS)
        assert final.status_code == 200, "sandbox pw not restored to Admin@123"


# ---------- admin force-logout + reset-password on a throwaway user ----------

class TestAdminForceLogoutAndResetOnThrowaway:
    @pytest.fixture()
    def throwaway(self, sandbox_token):
        import time, uuid
        email = f"TEST_throwaway_{int(time.time())}_{uuid.uuid4().hex[:6]}@example.com"
        password = "InitPass_2026"
        rr = requests.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "TEST Throwaway"}, timeout=15)
        if rr.status_code not in (200, 201):
            pytest.skip(f"register failed: {rr.status_code} {rr.text[:200]}")
        uid = rr.json().get("id")
        assert uid, "register did not return id"
        requests.post(f"{API}/admin/users/{uid}/approve",
                      json={"role": "user", "permissions": ["dashboard"]},
                      headers=_bearer(sandbox_token), timeout=15)
        lr = _login(email, password)
        if lr.status_code != 200:
            pytest.skip(f"post-approval login failed ({lr.status_code}): {lr.text[:200]}; can't test admin ops")
        user_id = lr.json()["id"]
        user_token = lr.json()["access_token"]
        yield {"email": email, "password": password, "id": user_id, "token": user_token}
        # cleanup
        try:
            requests.delete(f"{API}/admin/users/{user_id}", headers=_bearer(sandbox_token), timeout=15)
        except Exception:
            pass

    def test_admin_force_logout_bumps_sv_and_kills_token(self, sandbox_token, throwaway):
        # user token works
        m = requests.get(f"{API}/auth/me", headers=_bearer(throwaway["token"]), timeout=15)
        assert m.status_code == 200

        # admin force-logout
        f = requests.post(
            f"{API}/admin/users/{throwaway['id']}/force-logout",
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert f.status_code == 200
        assert f.json()["status"] == "forced_logout"
        assert isinstance(f.json()["session_version"], int)

        # user token dead
        m2 = requests.get(f"{API}/auth/me", headers=_bearer(throwaway["token"]), timeout=15)
        assert m2.status_code == 401
        assert "Sessão revogada" in m2.text

    def test_admin_reset_password(self, sandbox_token, throwaway):
        new_pw = "AdminReset_2026"
        r = requests.post(
            f"{API}/admin/users/{throwaway['id']}/reset-password",
            json={"new_password": new_pw},
            headers=_bearer(sandbox_token),
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "reset"

        # Old password no longer works
        old = _login(throwaway["email"], throwaway["password"])
        assert old.status_code == 401

        # New password works
        new_login = _login(throwaway["email"], new_pw)
        assert new_login.status_code == 200


# ---------- regression: /auth/me + /admin/users still work ----------

class TestRegression:
    def test_me(self, sandbox_token):
        r = requests.get(f"{API}/auth/me", headers=_bearer(sandbox_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == SANDBOX_EMAIL
        assert d["role"] == "admin"

    def test_admin_users_list(self, sandbox_token):
        r = requests.get(f"{API}/admin/users", headers=_bearer(sandbox_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert any(u["email"] == SANDBOX_EMAIL for u in r.json())

    def test_settings_permission_available(self, sandbox_token):
        # sandbox admin has ALL_PERMISSIONS (default when permissions empty) OR explicit list
        r = requests.get(f"{API}/auth/me", headers=_bearer(sandbox_token), timeout=15)
        perms = r.json().get("permissions", [])
        # admin bypasses perms in frontend; just check the field exists
        assert isinstance(perms, list)
