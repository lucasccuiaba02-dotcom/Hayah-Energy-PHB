"""Iteration 11: /api/geo/route-pdf + regression on analytics/geo/alerts."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:3000"
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@projectmatrix.com",
        "password": "Admin@123",
    })
    assert r.status_code == 200, r.text
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---- route-pdf ----
def test_route_pdf_valid_payload(auth):
    payload = {
        "team_name": "Equipe Alpha",
        "origin": {"label": "Origem", "lat": -15.6, "lng": -56.09},
        "distance_km": 10.5,
        "duration_min": 15,
        "route_mode": "haversine",
        "stops": [
            {"lat": -15.61, "lng": -56.1, "name": "Obra A", "programmed_value": 1000, "project_code": "P-1"},
            {"lat": -15.62, "lng": -56.08, "name": "Obra B", "programmed_value": 2500, "project_code": "P-2"},
        ],
    }
    r = requests.post(f"{BASE_URL}/api/geo/route-pdf", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower() and ".pdf" in cd.lower(), cd
    assert r.content[:4] == b"%PDF", r.content[:20]
    assert len(r.content) > 800


def test_route_pdf_empty_stops(auth):
    payload = {
        "team_name": "Vazia",
        "origin": {"label": "Origem", "lat": -15.6, "lng": -56.09},
        "distance_km": 0,
        "duration_min": 0,
        "route_mode": "haversine",
        "stops": [],
    }
    r = requests.post(f"{BASE_URL}/api/geo/route-pdf", json=payload, headers=auth)
    assert r.status_code == 200, r.text
    assert r.content[:4] == b"%PDF"


def test_route_pdf_requires_auth():
    r = requests.post(f"{BASE_URL}/api/geo/route-pdf", json={
        "origin": {"lat": 0, "lng": 0}, "stops": []
    })
    assert r.status_code in (401, 403)


# ---- Regression ----
def test_top_expensive(auth):
    r = requests.get(f"{BASE_URL}/api/analytics/top-expensive", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_geo_projects(auth):
    r = requests.get(f"{BASE_URL}/api/geo/projects", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_alerts_anexo_iv(auth):
    r = requests.get(f"{BASE_URL}/api/alerts/anexo-iv", headers=auth)
    assert r.status_code == 200
