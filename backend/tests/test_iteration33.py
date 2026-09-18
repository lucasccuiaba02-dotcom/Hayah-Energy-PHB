"""Iteration 33 — Central de Notificações + Integrações (Resend/Twilio).
Tests: /api/notifications/* and /api/integrations/* plus estoque/vencidas alert logic.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"
MASK = "••••••••"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ------------------------------------------------------ SETTINGS
class TestNotificationSettings:
    def test_get_settings_shape(self, h):
        r = requests.get(f"{BASE_URL}/api/notifications/settings", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        for key in ("settings", "last_sent", "push_devices", "integrations", "kinds"):
            assert key in j
        for kind in ("vencidas", "faturamento", "estoque"):
            s = j["settings"][kind]
            assert "enabled" in s and "time" in s and "channels" in s
            for ch in ("push", "email", "whatsapp"):
                assert ch in s["channels"]
        assert "threshold_days" in j["settings"]["faturamento"]
        assert "near_pct" in j["settings"]["estoque"]
        assert "instant" in j["settings"]["estoque"]
        integ = j["integrations"]
        for k in ("email_ready", "whatsapp_ready", "email_recipients"):
            assert k in integ

    def test_put_merge_persist(self, h):
        body = {"estoque": {"time": "07:30", "near_pct": 25, "channels": {"whatsapp": False}}}
        r = requests.put(f"{BASE_URL}/api/notifications/settings", headers=h, json=body, timeout=20)
        assert r.status_code == 200, r.text
        # verify GET
        g = requests.get(f"{BASE_URL}/api/notifications/settings", headers=h, timeout=20).json()
        est = g["settings"]["estoque"]
        assert est["time"] == "07:30"
        assert est["near_pct"] == 25
        assert est["channels"]["whatsapp"] is False
        # push/email defaults preserved
        assert est["channels"]["push"] is True
        # restore defaults
        requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                     json={"estoque": {"time": "08:00", "near_pct": 20, "channels": {"whatsapp": True}}}, timeout=20)

    def test_put_invalid_time(self, h):
        r = requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                         json={"vencidas": {"time": "25:99"}}, timeout=20)
        assert r.status_code == 400

    def test_put_invalid_threshold(self, h):
        r = requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                         json={"faturamento": {"threshold_days": 0}}, timeout=20)
        assert r.status_code == 400

    def test_put_invalid_nearpct(self, h):
        r = requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                         json={"estoque": {"near_pct": 600}}, timeout=20)
        assert r.status_code == 400


# ------------------------------------------------------ PREVIEW
class TestPreview:
    def test_preview_shape(self, h):
        r = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        for kind in ("vencidas", "faturamento", "estoque"):
            a = j[kind]
            assert "count" in a and "title" in a and "body" in a and "items" in a and "url" in a
            assert a["whatsapp_text"].startswith("*HAYAH ENERGY")


# ------------------------------------------------------ TEST endpoints
class TestTestKind:
    def test_invalid_kind(self, h):
        r = requests.post(f"{BASE_URL}/api/notifications/test/bogus", headers=h, json={}, timeout=20)
        assert r.status_code == 400

    @pytest.mark.parametrize("kind", ["vencidas", "faturamento", "estoque"])
    def test_test_kind_ok(self, h, kind):
        r = requests.post(f"{BASE_URL}/api/notifications/test/{kind}", headers=h, json={}, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "count" in j and "title" in j and "results" in j
        res = j["results"]
        assert "push" in res
        # email must be skipped no_api_key (no Resend key configured)
        if "email" in res:
            assert res["email"]["status"] in ("skipped", "sent", "error")
        if "whatsapp" in res:
            assert res["whatsapp"]["status"] in ("skipped", "sent", "error")

    def test_log_populated(self, h):
        # trigger one then check log
        requests.post(f"{BASE_URL}/api/notifications/test/vencidas", headers=h, json={}, timeout=30)
        r = requests.get(f"{BASE_URL}/api/notifications/log?limit=10", headers=h, timeout=20)
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list) and len(logs) > 0
        assert any(l.get("trigger") == "manual" for l in logs)


# ------------------------------------------------------ INTEGRATIONS (admin)
class TestIntegrations:
    def test_get_masked(self, h):
        r = requests.get(f"{BASE_URL}/api/integrations", headers=h, timeout=20)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "values" in j and "from_env" in j and "status" in j
        # secrets masked or empty
        for secret in ("resend_api_key", "twilio_auth_token"):
            v = j["values"][secret]
            assert v in (MASK, "")

    def test_put_and_mask_preservation(self, h):
        # set notification_emails and whatsapp_numbers
        r = requests.put(f"{BASE_URL}/api/integrations", headers=h,
                         json={"notification_emails": "test@example.com", "whatsapp_numbers": "5565999990000"}, timeout=20)
        assert r.status_code == 200
        flags = r.json()["status_flags"]
        assert "test@example.com" in flags["email_recipients"]

        # Set a fake resend key first
        requests.put(f"{BASE_URL}/api/integrations", headers=h, json={"resend_api_key": "re_fakekey_TEST123"}, timeout=20)
        # Send MASK — should NOT overwrite
        r2 = requests.put(f"{BASE_URL}/api/integrations", headers=h, json={"resend_api_key": MASK}, timeout=20)
        assert r2.status_code in (200, 400)  # 400 if nothing to update after skipping mask
        # confirm masked value still present (email_ready true because key set)
        g = requests.get(f"{BASE_URL}/api/integrations", headers=h, timeout=20).json()
        assert g["status"]["email_ready"] is True
        # cleanup: clear fake resend key & clear overrides so env fallback applies
        requests.put(f"{BASE_URL}/api/integrations", headers=h,
                     json={"resend_api_key": "", "notification_emails": "", "whatsapp_numbers": ""}, timeout=20)

    def test_test_email_no_key(self, h):
        # ensure no key
        requests.put(f"{BASE_URL}/api/integrations", headers=h, json={"resend_api_key": ""}, timeout=20)
        r = requests.post(f"{BASE_URL}/api/integrations/test-email", headers=h, json={"to": "x@y.com"}, timeout=20)
        assert r.status_code == 400
        assert "Resend" in r.text or "chave" in r.text.lower()

    def test_test_whatsapp_no_creds(self, h):
        r = requests.post(f"{BASE_URL}/api/integrations/test-whatsapp", headers=h, json={"to": "5565999990000"}, timeout=20)
        assert r.status_code == 400


# ------------------------------------------------------ ESTOQUE alert logic
class TestEstoqueAlert:
    _stock_id = None

    def test_create_and_near_pct_thresholds(self, h):
        # Create item: qp=10 vs min=8 → 25% above min
        payload = {"code": "TEST_IT33_A", "description": "Item teste iter33", "unit": "UN",
                   "qty_system": 10, "qty_physical": 10, "min_stock": 8, "unit_value": 1.5}
        r = requests.post(f"{BASE_URL}/api/estoque", headers=h, json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        TestEstoqueAlert._stock_id = r.json().get("id") or r.json().get("_id")

        # near_pct=20 → 8*1.20=9.6, qp=10 not included
        requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                     json={"estoque": {"near_pct": 20}}, timeout=20)
        prev = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30).json()
        codes = [i["code"] for i in prev["estoque"]["items"]]
        assert "TEST_IT33_A" not in codes, f"expected not included at 20%, got {codes}"

        # near_pct=30 → 8*1.30=10.4, qp=10 included as 'perto'
        requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                     json={"estoque": {"near_pct": 30}}, timeout=20)
        prev = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30).json()
        entry = next((i for i in prev["estoque"]["items"] if i["code"] == "TEST_IT33_A"), None)
        assert entry is not None, "expected included at 30%"
        assert entry["level"] == "perto"

    def test_patch_to_critical(self, h):
        if not TestEstoqueAlert._stock_id:
            pytest.skip("no stock id")
        r = requests.patch(f"{BASE_URL}/api/estoque/{TestEstoqueAlert._stock_id}",
                           headers=h, json={"qty_physical": 5}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # is_low_stock should reflect
        assert data.get("is_low_stock") is True or float(data.get("qty_physical", 0)) <= float(data.get("min_stock", 0))
        prev = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30).json()
        entry = next((i for i in prev["estoque"]["items"] if i["code"] == "TEST_IT33_A"), None)
        assert entry is not None and entry["level"] == "critico"

    def test_cleanup_stock(self, h):
        if TestEstoqueAlert._stock_id:
            r = requests.delete(f"{BASE_URL}/api/estoque/{TestEstoqueAlert._stock_id}", headers=h, timeout=20)
            assert r.status_code in (200, 204)
        # restore default near_pct
        requests.put(f"{BASE_URL}/api/notifications/settings", headers=h,
                     json={"estoque": {"near_pct": 20}}, timeout=20)


# ------------------------------------------------------ VENCIDAS alert logic
class TestVencidasAlert:
    _pid = None

    def test_create_vencida(self, h):
        payload = {"name": "TEST_IT33 vencida", "project_code": "TEST-IT33-V1",
                   "expiry_date": "2024-01-01", "execution_status": "programado",
                   "programmed_value": 1000.0, "team_name": "Equipe X"}
        r = requests.post(f"{BASE_URL}/api/projects", headers=h, json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text
        TestVencidasAlert._pid = r.json().get("id") or r.json().get("_id")
        prev = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30).json()
        entry = next((i for i in prev["vencidas"]["items"] if i.get("project_code") == "TEST-IT33-V1"), None)
        assert entry is not None, "expected vencida in preview"
        assert entry["days"] > 0

    def test_concluido_not_vencida(self, h):
        # Update to concluido → should disappear
        if not TestVencidasAlert._pid:
            pytest.skip("no pid")
        r = requests.put(f"{BASE_URL}/api/projects/{TestVencidasAlert._pid}",
                         headers=h, json={"execution_status": "concluido"}, timeout=20)
        assert r.status_code in (200, 204), r.text
        prev = requests.get(f"{BASE_URL}/api/notifications/preview", headers=h, timeout=30).json()
        assert not any(i.get("project_code") == "TEST-IT33-V1" for i in prev["vencidas"]["items"])

    def test_cleanup_project(self, h):
        if TestVencidasAlert._pid:
            requests.delete(f"{BASE_URL}/api/projects/{TestVencidasAlert._pid}", headers=h, timeout=20)


# ------------------------------------------------------ REGRESSION
class TestRegression:
    def test_dashboard_kpis(self, h):
        r = requests.get(f"{BASE_URL}/api/dashboard/kpis", headers=h, timeout=30)
        assert r.status_code == 200

    def test_faturamento_pipeline(self, h):
        r = requests.get(f"{BASE_URL}/api/faturamento/pipeline", headers=h, timeout=30)
        assert r.status_code == 200
