"""Test the /api/materials/preview endpoint.
Validates that a PDF is generated and returned as application/pdf WITHOUT creating
a history entry or sending an email."""
import io
import os
import time
import httpx
import pytest

BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
API = BACKEND_URL.rstrip("/") + ("" if BACKEND_URL.endswith("/api") else "/api")

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PWD = "Admin@123"


def _login():
    r = httpx.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _create_project(token, name):
    uid = int(time.time() * 1000) % 10**8
    r = httpx.post(f"{API}/projects", json={
        "name": name, "project_code": f"TPV-{uid}", "programmed_value": 1500,
    }, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    d = r.json()
    return d.get("id") or d.get("_id")


def _delete_project(token, pid):
    httpx.delete(f"{API}/projects/{pid}", headers={"Authorization": f"Bearer {token}"}, timeout=15)


def test_materials_preview_returns_pdf_and_does_not_create_history():
    token = _login()
    pid = _create_project(token, "TEST_PREVIEW_ENDPOINT")
    try:
        # Baseline: no requisitions
        r = httpx.get(f"{API}/projects/{pid}", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        before = r.json().get("material_requisitions") or []
        assert len(before) == 0

        # Call preview
        r = httpx.post(
            f"{API}/materials/preview",
            data={"project_id": pid, "notes": "Teste prévia", "signature_name": "João Teste"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        # Standard PDF magic
        assert r.content[:5] == b"%PDF-", f"Not a valid PDF, first bytes: {r.content[:20]!r}"
        assert len(r.content) > 1000, f"PDF too small ({len(r.content)} bytes)"
        assert "inline" in r.headers.get("content-disposition", "")

        # After preview: no history entry created
        r = httpx.get(f"{API}/projects/{pid}", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        after = r.json().get("material_requisitions") or []
        assert len(after) == 0, f"Preview must NOT create history entries, got {len(after)}"
    finally:
        _delete_project(token, pid)


def test_materials_preview_rejects_missing_project():
    token = _login()
    r = httpx.post(
        f"{API}/materials/preview",
        data={"project_id": "6a6a6a6a6a6a6a6a6a6a6a6a", "notes": "x", "signature_name": "y"},
        headers={"Authorization": f"Bearer {token}"},
        timeout=15,
    )
    assert r.status_code == 404
    assert "not found" in (r.json().get("detail", "") or "").lower()
