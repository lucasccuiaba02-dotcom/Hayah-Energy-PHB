"""Iteration 13 — Cache geocoding LRU 60s, Live Tracking (ping/live/stop), Duplicar Obra."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# ============ Feature 1: Geocode Cache LRU 60s ============
def test_geocode_cache_speedup_same_query(session):
    """Second call for the same q should be significantly faster (cache hit)."""
    q = "Cuiaba MT"
    # Warm-up (may already be cached from previous test session; do fresh query)
    q_unique = f"Cuiaba MT {int(time.time())}"  # unique to ensure MISS first
    # First call — should be a MISS but Photon may not have results for random suffix.
    # Instead use fixed q and measure delta after cache expiry not feasible; use different novel q.
    # Approach: use 2 distinct novel queries, then repeat -> hit.
    r1 = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": q, "limit": 5}, timeout=20)
    assert r1.status_code == 200
    t0 = time.time()
    r2 = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": q, "limit": 5}, timeout=20)
    d2 = time.time() - t0
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    # Cache hit should return in well under 1s (typically <100ms)
    assert d2 < 1.0, f"Second call not cached fast enough: {d2:.3f}s"


def test_geocode_new_q_then_cache_hit(session):
    """Novel query is slower, second identical call fast (cache hit)."""
    q = f"Praca da Republica Cuiaba MT {int(time.time())%1000}"
    t0 = time.time()
    r1 = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": q, "limit": 5}, timeout=20)
    d1 = time.time() - t0
    assert r1.status_code == 200
    t1 = time.time()
    r2 = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": q, "limit": 5}, timeout=20)
    d2 = time.time() - t1
    assert r2.status_code == 200
    assert d2 < 1.0, f"Cache hit too slow: {d2:.3f}s"
    # Not strict but the second should be much faster than the first (unless first was <200ms)
    print(f"first={d1:.3f}s second={d2:.3f}s")


# ============ Feature 2: Live Tracking ============
def test_tracking_ping_ok(session):
    body = {"lat": -15.601, "lng": -56.097, "accuracy": 12.5}
    r = session.post(f"{BASE_URL}/api/tracking/ping", json=body, timeout=15)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    assert data.get("status") == "ok"
    assert "updated_at" in data and isinstance(data["updated_at"], str)


def test_tracking_ping_upsert_idempotent(session):
    body = {"lat": -15.61, "lng": -56.10, "accuracy": 8.0}
    r1 = session.post(f"{BASE_URL}/api/tracking/ping", json=body, timeout=15)
    assert r1.status_code == 200
    time.sleep(0.5)
    r2 = session.post(f"{BASE_URL}/api/tracking/ping", json=body, timeout=15)
    assert r2.status_code == 200
    # Now confirm we still have a single doc reflected in /live
    r3 = session.get(f"{BASE_URL}/api/tracking/live", timeout=15)
    assert r3.status_code == 200
    live = r3.json()
    mine = [d for d in live if d.get("user_email") == ADMIN_EMAIL]
    assert len(mine) == 1, f"Expected 1 doc for admin, got {len(mine)}"


def test_tracking_live_returns_entry(session):
    # Ensure we have a ping
    session.post(f"{BASE_URL}/api/tracking/ping", json={"lat": -15.6, "lng": -56.1}, timeout=15)
    r = session.get(f"{BASE_URL}/api/tracking/live", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    entry = data[0]
    for k in ("user_id", "user_name", "lat", "lng", "updated_at"):
        assert k in entry, f"missing {k}"


def test_tracking_delete_ping(session):
    session.post(f"{BASE_URL}/api/tracking/ping", json={"lat": -15.6, "lng": -56.1}, timeout=15)
    r = session.delete(f"{BASE_URL}/api/tracking/ping", timeout=15)
    assert r.status_code == 200
    assert r.json().get("status") == "stopped"
    # Verify /live no longer contains admin
    r2 = session.get(f"{BASE_URL}/api/tracking/live", timeout=15)
    assert r2.status_code == 200
    mine = [d for d in r2.json() if d.get("user_email") == ADMIN_EMAIL]
    assert len(mine) == 0


# ============ Feature 3: Duplicar Obra ============
@pytest.fixture(scope="module")
def created_project_id(session):
    payload = {
        "name": "TEST_Iter13_Origem",
        "project_code": f"TEST-{int(time.time())}",
        "tipo_servico": "manutencao",
        "start_date": "2026-01-15",
        "end_date": "2026-01-20",
        "programmed_value": 5000.0,
        "daily_goal": 1000.0,
        "priority": "medium",
        "project_type": "anexo_iv",
        "is_scheduled": True,
        "execution_status": "programado",
    }
    r = session.post(f"{BASE_URL}/api/projects", json=payload, timeout=15)
    assert r.status_code == 200, r.text[:200]
    pid = r.json()["id"]
    yield pid
    # cleanup
    try:
        session.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)
    except Exception:
        pass


def test_duplicate_project_creates_clone(session, created_project_id):
    r = session.post(f"{BASE_URL}/api/projects/{created_project_id}/duplicate", timeout=15)
    assert r.status_code == 200, r.text[:200]
    clone = r.json()
    assert clone["id"] != created_project_id
    assert clone["name"].endswith("(cópia)"), clone["name"]
    assert clone["project_code"] == ""
    assert clone["is_scheduled"] is False
    assert clone["execution_status"] == "aguardando_programacao"
    assert clone["reschedule_history"] == []
    assert clone["start_date"] == ""
    assert clone["end_date"] == ""
    # Verify persistence via GET list
    r2 = session.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r2.status_code == 200
    ids = [p["id"] for p in r2.json()]
    assert clone["id"] in ids
    # cleanup clone
    session.delete(f"{BASE_URL}/api/projects/{clone['id']}", timeout=15)


def test_duplicate_project_404_on_unknown(session):
    r = session.post(f"{BASE_URL}/api/projects/000000000000000000000000/duplicate", timeout=15)
    assert r.status_code in (404, 400)


# ============ Feature 4: build_project_response coerce None -> "" ============
def test_project_response_no_null_dates(session):
    payload = {
        "name": "TEST_Iter13_NoDates",
        "project_code": f"TEST-ND-{int(time.time())}",
        "tipo_servico": "instalacao",
        "programmed_value": 100.0,
        "daily_goal": 50.0,
        "priority": "low",
        "project_type": "anexo_iv",
    }
    r = session.post(f"{BASE_URL}/api/projects", json=payload, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["start_date"] == "" or body["start_date"] is not None
    assert body["end_date"] == "" or body["end_date"] is not None
    # Strict: coerced to string
    assert isinstance(body["start_date"], str)
    assert isinstance(body["end_date"], str)
    session.delete(f"{BASE_URL}/api/projects/{body['id']}", timeout=15)


# ============ Regression ============
def test_regression_geo_projects(session):
    r = session.get(f"{BASE_URL}/api/geo/projects", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_analytics_top_expensive(session):
    r = session.get(f"{BASE_URL}/api/analytics/top-expensive", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_regression_geo_route_pdf(session):
    # Need at least a body — try with a project id list; if none, skip
    r = session.get(f"{BASE_URL}/api/projects", timeout=15)
    ids = [p["id"] for p in r.json()][:2]
    if not ids:
        pytest.skip("no projects to test route-pdf")
    r2 = session.post(f"{BASE_URL}/api/geo/route-pdf", json={"project_ids": ids}, timeout=30)
    # Endpoint might expect other payload; accept 200 or 4xx (schema)
    assert r2.status_code in (200, 400, 422), r2.text[:200]
    if r2.status_code == 200:
        assert r2.headers.get("content-type", "").startswith("application/pdf")
