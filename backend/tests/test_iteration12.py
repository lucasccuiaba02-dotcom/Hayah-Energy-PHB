"""Iteration 12 — retest geo/geocode via backend proxy (Photon primary + Nominatim fallback)."""
import os
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


@pytest.mark.parametrize("q", ["Cuiaba", "Cuiaba MT", "Varzea Grande MT", "Rondonopolis MT", "Praca Republica Cuiaba"])
def test_geocode_returns_results(session, q):
    r = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": q, "limit": 5}, timeout=15)
    assert r.status_code == 200, r.text[:200]
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1, f"No results for {q!r}"
    first = data[0]
    for k in ("display", "lat", "lng"):
        assert k in first and first[k] not in (None, ""), f"Missing/empty {k}: {first}"
    assert isinstance(first["lat"], (int, float))
    assert isinstance(first["lng"], (int, float))


def test_geocode_cuiaba_lat_in_mt_range(session):
    r = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": "Cuiaba MT"}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    # MT latitude approx -20 .. -8; Cuiabá ~ -15.6
    assert -20.0 <= data[0]["lat"] <= -8.0, f"lat out of range: {data[0]}"
    assert -62.0 <= data[0]["lng"] <= -50.0, f"lng out of range: {data[0]}"


def test_geocode_short_query_returns_empty(session):
    r = session.get(f"{BASE_URL}/api/geo/geocode", params={"q": "X"}, timeout=15)
    assert r.status_code == 200
    assert r.json() == []


def test_geocode_requires_auth():
    r = requests.get(f"{BASE_URL}/api/geo/geocode", params={"q": "Cuiaba"}, timeout=15)
    assert r.status_code in (401, 403)


# Regression: /api/geo/projects
def test_geo_projects_regression(session):
    r = session.get(f"{BASE_URL}/api/geo/projects", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


# Regression: /api/geo/route-pdf
def test_route_pdf_regression(session):
    payload = {
        "team_name": "TEST_team",
        "origin": {"label": "Origem", "lat": -15.601, "lng": -56.097},
        "stops": [
            {"lat": -15.601, "lng": -56.097, "name": "A", "project_code": "TEST_A"},
            {"lat": -15.65, "lng": -56.12, "name": "B", "project_code": "TEST_B"},
        ],
    }
    r = session.post(f"{BASE_URL}/api/geo/route-pdf", json=payload, timeout=20)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert r.content[:4] == b"%PDF"
