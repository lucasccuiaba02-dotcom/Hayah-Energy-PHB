"""Iteration 6 backend tests: project_code, /schedule/calendar, /operacional/today, /materials/request."""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://team-scheduler-230.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def sample_project(client):
    # Create a scheduled project with project_code, spanning today
    from datetime import datetime, timezone, timedelta
    today = datetime.now(timezone.utc).date().isoformat()
    end = (datetime.now(timezone.utc).date() + timedelta(days=2)).isoformat()
    payload = {
        "name": "TEST_It6 Project",
        "project_code": "IT6-001",
        "start_date": today,
        "end_date": end,
        "programmed_value": 15000.0,
        "project_type": "anexo_iv",
        "requires_hot_line": True,
        "shutdown_info": "Ramal 12kV bloqueio prévio",
        "location": "Cuiabá / Bairro Centro",
        "is_scheduled": True,
        "execution_status": "programado",
    }
    r = client.post(f"{API}/projects", json=payload)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    yield r.json()
    client.delete(f"{API}/projects/{pid}")


# --------- Project.project_code ---------
class TestProjectCode:
    def test_create_project_with_code(self, sample_project):
        assert sample_project["project_code"] == "IT6-001"
        assert "id" in sample_project

    def test_get_project_persists_code(self, client, sample_project):
        r = client.get(f"{API}/projects/{sample_project['id']}")
        assert r.status_code == 200
        assert r.json()["project_code"] == "IT6-001"

    def test_update_project_code(self, client, sample_project):
        r = client.put(f"{API}/projects/{sample_project['id']}", json={"project_code": "IT6-002"})
        assert r.status_code == 200
        assert r.json()["project_code"] == "IT6-002"
        # revert
        client.put(f"{API}/projects/{sample_project['id']}", json={"project_code": "IT6-001"})

    def test_default_project_code_empty(self, client):
        r = client.post(f"{API}/projects", json={"name": "TEST_It6 NoCode"})
        assert r.status_code == 200
        assert r.json()["project_code"] == ""
        client.delete(f"{API}/projects/{r.json()['id']}")


# --------- /schedule/calendar ---------
class TestScheduleCalendar:
    def test_default_range(self, client):
        r = client.get(f"{API}/schedule/calendar")
        assert r.status_code == 200
        data = r.json()
        assert "dates" in data and "teams" in data and "grid" in data
        assert len(data["dates"]) == 14  # default Mon + 13 = 14 days
        # teams must include "Sem equipe"
        assert any(t["name"] == "Sem equipe" for t in data["teams"])

    def test_custom_range(self, client):
        r = client.get(f"{API}/schedule/calendar?start_date=2026-01-05&end_date=2026-01-11")
        assert r.status_code == 200
        d = r.json()
        assert d["dates"][0] == "2026-01-05" and d["dates"][-1] == "2026-01-11"
        assert len(d["dates"]) == 7

    def test_grid_contains_project(self, client, sample_project):
        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone.utc).date()
        start = (today - timedelta(days=1)).isoformat()
        end = (today + timedelta(days=5)).isoformat()
        r = client.get(f"{API}/schedule/calendar?start_date={start}&end_date={end}")
        assert r.status_code == 200
        grid = r.json()["grid"]
        # project has no team_id -> bucket 'unassigned'
        today_iso = today.isoformat()
        cells = grid.get("unassigned", {}).get(today_iso, [])
        found = [c for c in cells if c["id"] == sample_project["id"]]
        assert len(found) == 1, f"expected project in unassigned/{today_iso}"
        assert found[0]["code"] == "IT6-001"
        assert found[0]["requires_hot_line"] is True


# --------- /operacional/today ---------
class TestOperacionalToday:
    def test_shape(self, client, sample_project):
        r = client.get(f"{API}/operacional/today")
        assert r.status_code == 200
        d = r.json()
        for k in ("date", "total_projects", "total_value", "hot_line_count", "by_team"):
            assert k in d
        assert d["total_projects"] >= 1
        assert d["hot_line_count"] >= 1
        assert d["total_value"] >= 15000
        assert isinstance(d["by_team"], dict)


# --------- /materials/request ---------
class TestMaterialsRequest:
    def test_404_on_bad_project(self, client):
        pdf_bytes = b"%PDF-1.4\nfake"
        files = {
            "material_pdf": ("mat.pdf", io.BytesIO(pdf_bytes), "application/pdf"),
        }
        data = {"project_id": "000000000000000000000000", "notes": "test"}
        r = client.post(f"{API}/materials/request", files=files, data=data)
        assert r.status_code == 404

    def test_skipped_when_no_api_key(self, client, sample_project):
        pdf_bytes = b"%PDF-1.4\nfake pdf content"
        files = {
            "material_pdf": ("materials.pdf", io.BytesIO(pdf_bytes), "application/pdf"),
            "project_pdf": ("project.pdf", io.BytesIO(pdf_bytes), "application/pdf"),
        }
        data = {"project_id": sample_project["id"], "notes": "Urgent material"}
        r = client.post(f"{API}/materials/request", files=files, data=data)
        assert r.status_code == 200, r.text
        body = r.json()
        # RESEND_API_KEY is empty -> should return skipped
        assert body.get("status") == "skipped"
        assert body.get("attachments_count") == 2

    def test_no_attachments_still_works(self, client, sample_project):
        r = client.post(
            f"{API}/materials/request",
            data={"project_id": sample_project["id"], "notes": "no pdf"},
        )
        assert r.status_code == 200
        assert r.json().get("status") == "skipped"
