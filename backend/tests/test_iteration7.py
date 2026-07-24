"""Iteration 7 - Operational checklist, photos, and PWA endpoint tests."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:3000').rstrip('/')
if not BASE_URL.endswith('/api'):
    API_URL = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"

# Minimal 1x1 PNG
PNG_1X1 = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
    "0000000D49444154789C63F80F00000100010065A2FBAF0000000049454E44AE426082"
)


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API_URL}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def project_id(session):
    payload = {
        "name": "TEST_iter7_project",
        "project_type": "anexo_iv",
        "start_date": "2026-01-15",
        "end_date": "2026-01-20",
        "programmed_value": 1000.0,
        "requires_hot_line": True,
        "shutdown_info": "Desligamento parcial",
        "is_scheduled": True,
    }
    r = session.post(f"{API_URL}/projects", json=payload)
    assert r.status_code == 200, f"Create project failed: {r.text}"
    pid = r.json()["id"]
    yield pid
    session.delete(f"{API_URL}/projects/{pid}")


class TestChecklist:
    def test_get_checklist_empty(self, session, project_id):
        r = session.get(f"{API_URL}/operacional/checklist/{project_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["project_id"] == project_id
        assert "checklist" in data
        assert "photos" in data
        assert isinstance(data["photos"], list)

    def test_put_checklist_partial(self, session, project_id):
        payload = {"hotline_confirmed": True, "notes": "EPI OK"}
        r = session.put(f"{API_URL}/operacional/checklist/{project_id}", json=payload)
        assert r.status_code == 200
        cl = r.json()["checklist"]
        assert cl["hotline_confirmed"] is True
        assert cl["notes"] == "EPI OK"
        assert "updated_at" in cl
        assert "updated_by" in cl

    def test_put_checklist_persists(self, session, project_id):
        # Set another field
        session.put(f"{API_URL}/operacional/checklist/{project_id}", json={"shutdown_confirmed": True})
        r = session.get(f"{API_URL}/operacional/checklist/{project_id}")
        cl = r.json()["checklist"]
        # Both from previous test and this test should persist
        assert cl.get("hotline_confirmed") is True
        assert cl.get("shutdown_confirmed") is True

    def test_get_checklist_invalid_project(self, session):
        r = session.get(f"{API_URL}/operacional/checklist/507f1f77bcf86cd799439011")
        assert r.status_code == 404

    def test_put_checklist_invalid_project(self, session):
        r = session.put(f"{API_URL}/operacional/checklist/507f1f77bcf86cd799439011", json={"team_confirmed": True})
        assert r.status_code == 404

    def test_get_checklist_bad_id_format(self, session):
        r = session.get(f"{API_URL}/operacional/checklist/not-a-valid-id")
        assert r.status_code == 404


class TestPhotos:
    photo_id = None

    def test_upload_photo(self, session, project_id):
        files = {"file": ("test.png", io.BytesIO(PNG_1X1), "image/png")}
        data = {"label": "antes"}
        r = session.post(f"{API_URL}/operacional/photos/{project_id}", files=files, data=data)
        assert r.status_code == 200, f"Upload failed: {r.text}"
        photo = r.json()
        assert "id" in photo
        assert photo["label"] == "antes"
        assert photo["data_url"].startswith("data:image/png;base64,")
        TestPhotos.photo_id = photo["id"]

    def test_photo_persisted_in_get(self, session, project_id):
        r = session.get(f"{API_URL}/operacional/checklist/{project_id}")
        photos = r.json()["photos"]
        assert any(p["id"] == TestPhotos.photo_id for p in photos)

    def test_upload_photo_too_large(self, session, project_id):
        # 11MB
        big = b"A" * (11 * 1024 * 1024)
        files = {"file": ("big.jpg", io.BytesIO(big), "image/jpeg")}
        data = {"label": "depois"}
        r = session.post(f"{API_URL}/operacional/photos/{project_id}", files=files, data=data)
        assert r.status_code == 400

    def test_upload_photo_invalid_project(self, session):
        files = {"file": ("t.png", io.BytesIO(PNG_1X1), "image/png")}
        r = session.post(
            f"{API_URL}/operacional/photos/507f1f77bcf86cd799439011",
            files=files,
            data={"label": "antes"},
        )
        assert r.status_code == 404

    def test_delete_photo(self, session, project_id):
        assert TestPhotos.photo_id, "No photo to delete"
        r = session.delete(f"{API_URL}/operacional/photos/{project_id}/{TestPhotos.photo_id}")
        assert r.status_code == 200
        # Verify removed
        g = session.get(f"{API_URL}/operacional/checklist/{project_id}")
        assert not any(p["id"] == TestPhotos.photo_id for p in g.json()["photos"])

    def test_delete_photo_invalid_project(self, session):
        r = session.delete(f"{API_URL}/operacional/photos/507f1f77bcf86cd799439011/abc")
        assert r.status_code == 404


class TestPWAAssets:
    def test_manifest_json(self):
        r = requests.get(f"{BASE_URL}/manifest.json")
        assert r.status_code == 200
        m = r.json()
        assert m.get("display") == "standalone"
        assert m.get("theme_color") == "#050505"

    def test_service_worker(self):
        r = requests.get(f"{BASE_URL}/sw.js")
        assert r.status_code == 200
        assert "hayah" in r.text.lower() or "cache" in r.text.lower()
