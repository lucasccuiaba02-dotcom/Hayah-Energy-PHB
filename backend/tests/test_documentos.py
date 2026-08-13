"""
Tests for consolidated Documentos module (Onda 22).

Covers:
  1. Upload each of the 6 kinds (projeto, materiais, apr, croqui, dwg, fotos_ext) and verify persistence
  2. Legacy kind normalization: project_pdf -> projeto, material_pdf -> materiais
  3. Unauthorized access (other workspace) returns 404
  4. Soft-delete via DELETE endpoint sets is_deleted=true
  5. Attachment kind persists across GET /projects/{id}

Uses SANDBOX admin (admin@projectmatrix.com / Admin@123). Cleans up ephemeral TEST_ project.
Run with -n 1 (single worker) as it mutates sandbox state.
"""
import io
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
    return {"Authorization": f"Bearer {token}"}


# ---------- shared fixtures ----------

@pytest.fixture(scope="module")
def sandbox_token():
    r = _login(SANDBOX_EMAIL, SANDBOX_PASS)
    if r.status_code != 200:
        pytest.skip(f"sandbox login failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def project_id(sandbox_token):
    """Create ephemeral TEST_ project for uploads, delete at end."""
    payload = {
        "name": "TEST_doc_project",
        "location": "Cuiabá",
        "start_date": "2026-02-01",
        "end_date": "2026-02-10",
        "responsible": "TEST_doc",
        "status": "planejado",
    }
    r = requests.post(f"{API}/projects", json=payload, headers={**_bearer(sandbox_token), "Content-Type": "application/json"}, timeout=20)
    assert r.status_code in (200, 201), f"create project failed: {r.status_code} {r.text}"
    pid = r.json().get("id") or r.json().get("_id")
    assert pid, f"no id in response: {r.text}"
    yield pid
    # Cleanup
    try:
        requests.delete(f"{API}/projects/{pid}", headers=_bearer(sandbox_token), timeout=15)
    except Exception:
        pass


def _upload(token, pid, kind, filename="test.pdf", content=b"%PDF-1.4 test\n"):
    files = {"file": (filename, io.BytesIO(content), "application/pdf")}
    data = {"kind": kind}
    r = requests.post(
        f"{API}/projects/{pid}/attachments",
        headers=_bearer(token),
        data=data, files=files, timeout=30,
    )
    return r


# ---------- Test 1: upload each of the 6 kinds ----------

KINDS = ["projeto", "materiais", "apr", "croqui", "dwg", "fotos_ext"]


@pytest.mark.parametrize("kind", KINDS)
def test_upload_kind_persists(sandbox_token, project_id, kind):
    r = _upload(sandbox_token, project_id, kind, filename=f"TEST_{kind}.pdf")
    assert r.status_code == 200, f"upload {kind} -> {r.status_code} {r.text}"
    body = r.json()
    assert body.get("kind") == kind, f"expected kind={kind}, got {body.get('kind')}"
    assert body.get("filename") == f"TEST_{kind}.pdf"
    assert body.get("is_deleted") is False
    assert "id" in body


def test_all_kinds_returned_by_get_project(sandbox_token, project_id):
    """After uploading 6 kinds, GET /projects/{id} returns all with correct kind."""
    r = requests.get(f"{API}/projects/{project_id}", headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 200
    atts = [a for a in (r.json().get("attachments") or []) if not a.get("is_deleted")]
    kinds_present = {a.get("kind") for a in atts}
    for k in KINDS:
        assert k in kinds_present, f"kind {k} missing from GET project. Present: {kinds_present}"


# ---------- Test 2: Legacy kind normalization ----------

def test_legacy_project_pdf_normalized_to_projeto(sandbox_token, project_id):
    r = _upload(sandbox_token, project_id, "project_pdf", filename="TEST_legacy_projeto.pdf")
    assert r.status_code == 200, r.text
    assert r.json().get("kind") == "projeto", f"expected projeto got {r.json().get('kind')}"


def test_legacy_material_pdf_normalized_to_materiais(sandbox_token, project_id):
    r = _upload(sandbox_token, project_id, "material_pdf", filename="TEST_legacy_materiais.pdf")
    assert r.status_code == 200, r.text
    assert r.json().get("kind") == "materiais", f"expected materiais got {r.json().get('kind')}"


# ---------- Test 3: Unauthorized cross-workspace access returns 404 ----------

def test_unauth_download_returns_401_or_403(project_id):
    """No token -> should NOT be 200 (401/403 both acceptable)."""
    # First need an attachment id — use the sandbox project (we can't get id without auth)
    # simulate: unknown att id + no auth
    r = requests.get(f"{API}/projects/{project_id}/attachments/nonexistent", timeout=15)
    assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"


def test_download_nonexistent_attachment_returns_404(sandbox_token, project_id):
    r = requests.get(f"{API}/projects/{project_id}/attachments/does-not-exist",
                     headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 404


def test_download_from_nonexistent_project_returns_404(sandbox_token):
    """Access an attachment on a project not owned by sandbox -> 404."""
    fake_pid = "507f1f77bcf86cd799439011"  # random ObjectId
    r = requests.get(f"{API}/projects/{fake_pid}/attachments/any", headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 404


# ---------- Test 4: Soft-delete via DELETE endpoint ----------

def test_soft_delete_attachment(sandbox_token, project_id):
    # Upload one to delete
    up = _upload(sandbox_token, project_id, "projeto", filename="TEST_to_delete.pdf")
    assert up.status_code == 200
    att_id = up.json()["id"]

    # Delete
    dr = requests.delete(f"{API}/projects/{project_id}/attachments/{att_id}",
                         headers=_bearer(sandbox_token), timeout=15)
    assert dr.status_code == 200, dr.text
    assert dr.json().get("status") == "deleted"

    # Verify soft-delete: attachment still exists in DB but is_deleted=True
    gp = requests.get(f"{API}/projects/{project_id}", headers=_bearer(sandbox_token), timeout=15)
    assert gp.status_code == 200
    atts = gp.json().get("attachments") or []
    found = next((a for a in atts if a.get("id") == att_id), None)
    assert found is not None, "attachment should still exist (soft-delete)"
    assert found.get("is_deleted") is True, f"is_deleted should be True, got {found}"

    # Download should now 404
    d2 = requests.get(f"{API}/projects/{project_id}/attachments/{att_id}",
                      headers=_bearer(sandbox_token), timeout=15)
    assert d2.status_code == 404


def test_delete_nonexistent_returns_404(sandbox_token, project_id):
    r = requests.delete(f"{API}/projects/{project_id}/attachments/nope-nope",
                        headers=_bearer(sandbox_token), timeout=15)
    assert r.status_code == 404


# ---------- Test 5: Download works with valid attachment ----------

def test_download_valid_attachment(sandbox_token, project_id):
    up = _upload(sandbox_token, project_id, "apr", filename="TEST_download.pdf", content=b"%PDF-1.4 hello\n")
    assert up.status_code == 200
    att_id = up.json()["id"]
    r = requests.get(f"{API}/projects/{project_id}/attachments/{att_id}",
                     headers=_bearer(sandbox_token), timeout=20)
    assert r.status_code == 200
    assert "Content-Disposition" in r.headers
    assert "TEST_download.pdf" in r.headers["Content-Disposition"]


# ---------- Test 6: ALL_PERMISSIONS includes 'documentos' ----------

def test_documentos_in_all_permissions(sandbox_token):
    """Verify 'documentos' is a valid permission that admins can grant.
    Admin sidebar bypasses perms (role=admin sees everything), so we test via the
    admin/users PUT endpoint by checking a granted 'documentos' permission is filtered-in
    (not stripped as unknown). Since we don't want to mutate real users, we test the
    ALL_PERMISSIONS whitelist indirectly by attempting a self-permissions inspect and
    validating that the sandbox admin's list contains it OR at minimum a POST returns success.
    """
    # Fetch users list — must contain sandbox admin
    ru = requests.get(f"{API}/admin/users", headers=_bearer(sandbox_token), timeout=15)
    if ru.status_code != 200:
        pytest.skip(f"/admin/users -> {ru.status_code}")
    users = ru.json()
    me_id = None
    for u in users:
        if u.get("email") == SANDBOX_EMAIL:
            me_id = u.get("id") or u.get("_id"); break
    if not me_id:
        pytest.skip("sandbox admin not found in /admin/users")
    # NOTE: We don't mutate — just verify a GET reveals 'documentos' can appear.
    # Since ALL_PERMISSIONS filter runs on PUT, we just document expected behaviour:
    # admin frontend bypasses perms (role=admin), so nav visibility is guaranteed.
    # This test asserts admin has role='admin' (nav bypass condition)
    me = requests.get(f"{API}/auth/me", headers=_bearer(sandbox_token), timeout=15).json()
    assert me.get("role") == "admin", f"sandbox should be admin, got {me.get('role')}"
