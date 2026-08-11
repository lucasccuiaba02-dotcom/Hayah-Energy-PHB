"""Backend tests for backlog alerts endpoints (iteration 17)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    tok = data.get("access_token") or data.get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


def test_get_backlog_alerts_shape(client):
    r = client.get(f"{BASE_URL}/api/faturamento/backlog-alerts", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert set(["count", "threshold_days", "total_value", "items"]).issubset(d.keys())
    assert d["threshold_days"] == 15
    assert isinstance(d["items"], list)
    assert isinstance(d["count"], int)
    assert d["count"] == len(d["items"])
    for it in d["items"]:
        for k in ("id", "project_code", "name", "billing_stage", "days_in_stage", "programmed_value", "entered_stage_at"):
            assert k in it, f"missing {k} in item"
        assert it["days_in_stage"] >= 15
        assert it["billing_stage"] != "pago"


def test_post_backlog_notify(client):
    r = client.post(f"{BASE_URL}/api/faturamento/backlog-alerts/notify", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("status") == "triggered"


def test_pipeline_still_has_stuck_projects(client):
    r = client.get(f"{BASE_URL}/api/faturamento/pipeline", timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "stuck_projects" in d
    assert "stuck_threshold_days" in d
    assert d["stuck_threshold_days"] == 15
    assert isinstance(d["stuck_projects"], list)


def test_backlog_alerts_requires_auth():
    r = requests.get(f"{BASE_URL}/api/faturamento/backlog-alerts", timeout=15)
    assert r.status_code in (401, 403)
