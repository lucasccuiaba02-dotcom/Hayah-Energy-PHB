"""
Iteration 10 backend tests - Hayah Energy

Covers:
  - GET /api/analytics/top-expensive filters only allowed statuses
    (aguardando_programacao, aguardando_inicio, programado, em_execucao)
  - GET /api/geo/projects returns only projects with utm_x AND utm_y non-empty
  - Regression: /api/alerts/anexo-iv, POST/PUT /api/projects (reschedule_history)
"""
import os
import pytest
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0]
).rstrip("/")
ADMIN = {"email": "admin@projectmatrix.com", "password": "Admin@123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, f"login failed: {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def created_ids(client):
    ids = []
    yield ids
    for pid in ids:
        try:
            client.delete(f"{BASE_URL}/api/projects/{pid}")
        except Exception:
            pass


# ---------- top-expensive status filter ----------
def test_top_expensive_only_allowed_statuses(client, created_ids):
    """Create 6 projects covering all statuses; assert excluded ones don't appear."""
    statuses_all = [
        "aguardando_programacao",
        "aguardando_inicio",
        "programado",
        "em_execucao",
        "concluido",
        "cancelado",
    ]
    allowed = set(statuses_all[:4])
    marker = "TEST_IT10_TOPEXP"

    created_codes = []
    for i, st in enumerate(statuses_all):
        code = f"{marker}_{st}_{i}"
        # Use large value so they appear in top 10; each unique
        payload = {
            "name": f"{marker} {st}",
            "project_code": code,
            "programmed_value": 900000 + i,
            "execution_status": st,
            "start_date": "2026-02-01",
            "end_date": "2026-02-05",
            "is_scheduled": st in ("programado", "em_execucao"),
        }
        r = client.post(f"{BASE_URL}/api/projects", json=payload)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        created_ids.append(pid)
        created_codes.append((code, st))

    r = client.get(f"{BASE_URL}/api/analytics/top-expensive")
    assert r.status_code == 200, r.text
    data = r.json()
    returned_codes = {p["project_code"]: p["execution_status"] for p in data}

    for code, st in created_codes:
        if st in allowed:
            # It may not appear if user has >10 higher-value active projects, but
            # our injected values (~900k) are very high; verify they are present.
            assert code in returned_codes, f"expected {code} ({st}) in top-expensive"
        else:
            assert code not in returned_codes, (
                f"{code} ({st}) should NOT be in top-expensive"
            )

    # All returned statuses must be in allowed
    for p in data:
        assert p["execution_status"] in allowed, (
            f"unexpected status {p['execution_status']}"
        )


# ---------- geo/projects filter utm ----------
def test_geo_projects_only_with_utm(client, created_ids):
    marker = "TEST_IT10_GEO"
    utm_a = {"utm_x": "601000", "utm_y": "8281000"}
    utm_b = {"utm_x": "602500", "utm_y": "8282500"}
    codes_with = []
    for i, utm in enumerate([utm_a, utm_b]):
        code = f"{marker}_WITH_{i}"
        payload = {
            "name": f"{marker} with {i}",
            "project_code": code,
            "programmed_value": 1000 + i,
            "start_date": "2026-02-10",
            "end_date": "2026-02-11",
            **utm,
        }
        r = client.post(f"{BASE_URL}/api/projects", json=payload)
        assert r.status_code == 200, r.text
        created_ids.append(r.json()["id"])
        codes_with.append(code)

    # One without UTM
    code_no = f"{marker}_NO"
    r = client.post(f"{BASE_URL}/api/projects", json={
        "name": f"{marker} no utm",
        "project_code": code_no,
        "programmed_value": 500,
        "start_date": "2026-02-10",
        "end_date": "2026-02-11",
    })
    assert r.status_code == 200
    created_ids.append(r.json()["id"])

    r = client.get(f"{BASE_URL}/api/geo/projects")
    assert r.status_code == 200
    data = r.json()
    codes = {p["project_code"] for p in data}
    for c in codes_with:
        assert c in codes, f"{c} should be present with UTM"
    assert code_no not in codes, "project without UTM should not appear"

    # All returned must have non-empty utm
    for p in data:
        assert p["utm_x"] and p["utm_y"], f"empty UTM in returned {p['project_code']}"


# ---------- regression: alerts/anexo-iv ----------
def test_alerts_anexo_iv_smoke(client):
    r = client.get(f"{BASE_URL}/api/alerts/anexo-iv")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ---------- regression: reschedule history with reason ----------
def test_reschedule_history_with_reason(client, created_ids):
    marker = "TEST_IT10_RESCHED"
    payload = {
        "name": f"{marker} obra",
        "project_code": f"{marker}_CODE",
        "programmed_value": 10000,
        "start_date": "2026-03-01",
        "end_date": "2026-03-05",
        "is_scheduled": True,
        "execution_status": "programado",
    }
    r = client.post(f"{BASE_URL}/api/projects", json=payload)
    assert r.status_code == 200
    pid = r.json()["id"]
    created_ids.append(pid)

    # Update start_date with a reschedule_reason
    upd = {"start_date": "2026-03-10", "reschedule_reason": "chuva"}
    r = client.put(f"{BASE_URL}/api/projects/{pid}", json=upd)
    assert r.status_code == 200

    r = client.get(f"{BASE_URL}/api/projects/{pid}")
    assert r.status_code == 200
    j = r.json()
    hist = j.get("reschedule_history", [])
    assert len(hist) >= 1, "reschedule_history should have one entry"
    entry = hist[-1]
    assert entry["reason"] == "chuva", entry
    assert entry["old_start"].startswith("2026-03-01")
    assert entry["new_start"] == "2026-03-10"


# ---------- regression: project_code uniqueness on POST ----------
def test_project_code_unique(client, created_ids):
    code = "TEST_IT10_DUP_CODE"
    payload = {
        "name": "dup1",
        "project_code": code,
        "programmed_value": 100,
    }
    r1 = client.post(f"{BASE_URL}/api/projects", json=payload)
    assert r1.status_code == 200
    created_ids.append(r1.json()["id"])
    r2 = client.post(f"{BASE_URL}/api/projects", json={**payload, "name": "dup2"})
    assert r2.status_code == 409, r2.text
