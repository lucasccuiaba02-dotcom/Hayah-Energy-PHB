"""
Iteration 9 backend tests - Hayah Energy
Covers:
  - Web Push (VAPID) endpoints: vapid-key, subscribe (idempotent), unsubscribe, test
  - Daily-log PDF endpoint (magic %PDF, headers)
  - Anexo IV reminder job broadcasts push without 500
  - Smoke re-check of /alerts/anexo-iv
"""
import os
import time
import base64
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN = {"email": "admin@projectmatrix.com", "password": "Admin@123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, f"login failed: {r.text}"
    j = r.json()
    tok = j.get("access_token") or j.get("token")
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def created_ids():
    ids = []
    yield ids
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    tok = (r.json().get("access_token") or r.json().get("token"))
    if tok:
        s.headers["Authorization"] = f"Bearer {tok}"
    for pid in ids:
        try:
            s.delete(f"{BASE_URL}/api/projects/{pid}")
        except Exception:
            pass


def _mk_anexo_iv(code, offset=2):
    start = (datetime.now(timezone.utc) + timedelta(days=offset)).strftime("%Y-%m-%d")
    end = (datetime.now(timezone.utc) + timedelta(days=offset + 1)).strftime("%Y-%m-%d")
    return {
        "name": f"TEST_iter9_{code}",
        "project_code": code,
        "project_type": "anexo_iv",
        "location": "CUIABÁ",
        "start_date": start,
        "end_date": end,
        "programmed_value": 1000.0,
        "is_scheduled": True,
    }


# --- VAPID key ---
def test_vapid_key_returns_base64url(client):
    r = client.get(f"{BASE_URL}/api/push/vapid-key")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "public_key" in data
    pub = data["public_key"]
    assert isinstance(pub, str) and len(pub) >= 80  # base64url of 65 bytes -> ~87 chars
    # base64url: no padding, uses -/_ instead of +/
    assert "=" not in pub and "+" not in pub and "/" not in pub
    # Decoded raw pubkey should be 65 bytes (0x04 || X || Y for P-256)
    padded = pub + "=" * ((4 - len(pub) % 4) % 4)
    raw = base64.urlsafe_b64decode(padded)
    assert len(raw) == 65
    assert raw[0] == 0x04


def test_vapid_key_stable_across_calls(client):
    r1 = client.get(f"{BASE_URL}/api/push/vapid-key").json()["public_key"]
    r2 = client.get(f"{BASE_URL}/api/push/vapid-key").json()["public_key"]
    assert r1 == r2


# --- Subscribe / Unsubscribe idempotency ---
FAKE_ENDPOINT = f"https://fcm.googleapis.com/fcm/send/TEST-iter9-{int(time.time())}"
FAKE_KEYS = {
    "p256dh": "BOgqQZzsvL4ZQ7z9m0zjP0J-N5xM1_TEST_p256dh_key_placeholder_valuexxxxxxxxxxxxxxxxxxx",
    "auth": "TEST_auth_placeholder"
}


def test_subscribe_push_creates(client):
    r = client.post(f"{BASE_URL}/api/push/subscribe",
                    json={"endpoint": FAKE_ENDPOINT, "keys": FAKE_KEYS})
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "subscribed"


def test_subscribe_push_is_idempotent(client):
    # second call same endpoint must not duplicate and must not 500
    r = client.post(f"{BASE_URL}/api/push/subscribe",
                    json={"endpoint": FAKE_ENDPOINT, "keys": FAKE_KEYS})
    assert r.status_code == 200
    assert r.json().get("status") == "subscribed"


def test_push_test_broadcast(client):
    # broadcast_push must not 500 even if send fails to fake endpoint
    r = client.post(f"{BASE_URL}/api/push/test")
    assert r.status_code == 200, r.text
    data = r.json()
    for k in ("sent", "removed", "total"):
        assert k in data
        assert isinstance(data[k], int)
    assert data["total"] >= 0


def test_unsubscribe_push(client):
    r = client.post(f"{BASE_URL}/api/push/unsubscribe",
                    json={"endpoint": FAKE_ENDPOINT})
    assert r.status_code == 200
    assert r.json().get("status") == "unsubscribed"


def test_unsubscribe_unknown_endpoint_is_noop(client):
    r = client.post(f"{BASE_URL}/api/push/unsubscribe",
                    json={"endpoint": "https://nonexistent.example/xyz"})
    assert r.status_code == 200


# --- Anexo IV reminder job with push branch ---
def test_anexo_iv_reminder_triggers_without_500(client, created_ids):
    code = f"TEST-IT9-AIV-{int(time.time())}"
    rc = client.post(f"{BASE_URL}/api/projects", json=_mk_anexo_iv(code, offset=2))
    assert rc.status_code == 200, rc.text
    created_ids.append(rc.json()["id"])

    r = client.post(f"{BASE_URL}/api/schedule/anexo-iv-reminder")
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "triggered"


def test_anexo_iv_alerts_smoke(client, created_ids):
    code = f"TEST-IT9-ALERT-{int(time.time())}"
    rc = client.post(f"{BASE_URL}/api/projects", json=_mk_anexo_iv(code, offset=2))
    assert rc.status_code == 200
    pid = rc.json()["id"]
    created_ids.append(pid)

    r = client.get(f"{BASE_URL}/api/alerts/anexo-iv")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()]
    assert pid in ids


# --- Daily log PDF ---
def test_daily_log_pdf_endpoint(client, created_ids):
    code = f"TEST-IT9-PDF-{int(time.time())}"
    rc = client.post(f"{BASE_URL}/api/projects", json=_mk_anexo_iv(code, offset=1))
    assert rc.status_code == 200
    pid = rc.json()["id"]
    created_ids.append(pid)

    r = client.get(f"{BASE_URL}/api/operacional/daily-log/{pid}",
                   params={"notes": "Teste de diario de obra iter9\nSegunda linha"})
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd.lower()
    assert ".pdf" in cd.lower()
    body = r.content
    assert len(body) > 500
    assert body[:4] == b"%PDF"


def test_daily_log_pdf_project_not_found(client):
    r = client.get(f"{BASE_URL}/api/operacional/daily-log/nonexistent_id_iter9",
                   params={"notes": ""})
    # Either 404 (safe_object_id + not found) or 400 for bad id
    assert r.status_code in (400, 404, 422), r.text


# --- Auth negatives ---
def test_push_endpoints_require_auth():
    s = requests.Session()
    for path, method in [
        ("/api/push/vapid-key", "get"),
        ("/api/push/subscribe", "post"),
        ("/api/push/unsubscribe", "post"),
        ("/api/push/test", "post"),
    ]:
        fn = getattr(s, method)
        r = fn(f"{BASE_URL}{path}", json={} if method == "post" else None)
        assert r.status_code in (401, 403), f"{path} -> {r.status_code}"
