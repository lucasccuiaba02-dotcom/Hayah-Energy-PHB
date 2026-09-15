"""Iteration 26 — Avanço Físico backend tests.
Covers: GET/POST /api/avanco/threshold, /api/avanco/projects, GET /api/projects/{id}/avanco,
POST/DELETE /api/projects/{id}/avanco/entries, PUT /api/projects/{id}/avanco/items,
PATCH /api/projects/{id}/materials/{item_id} qty_applied.
Uses DASHKPI-08 (enriched w/ quantitativos+materials+lançamentos).
"""
import os
import pytest
import requests

def _load_base_url():
    u = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if not u:
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        u = line.split("=", 1)[1].strip()
                        break
        except Exception:
            pass
    return u.rstrip("/")

BASE_URL = _load_base_url()
EMAIL = "lucasc.cuiaba02@gmail.com"
PASSWORD = "Hayah$152610"


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def dashkpi08_id(auth):
    # DASHKPI-08 known project id (per prompt)
    pid = "6aa964cdf355fbf64d8e03ea"
    # sanity — try list projects and find by code
    r = auth.get(f"{BASE_URL}/api/projects", timeout=15)
    assert r.status_code == 200
    for p in r.json():
        if p.get("project_code") == "DASHKPI-08":
            return p.get("id") or p.get("_id") or pid
    return pid


class TestThreshold:
    def test_default_threshold(self, auth):
        r = auth.get(f"{BASE_URL}/api/avanco/threshold")
        assert r.status_code == 200
        j = r.json()
        assert j["default"] == 45000
        # Reset any leftover
        auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": 45000})
        r = auth.get(f"{BASE_URL}/api/avanco/threshold")
        assert r.json()["threshold"] == 45000

    def test_update_threshold_and_filter(self, auth):
        r = auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": 60000})
        assert r.status_code == 200
        assert r.json()["threshold"] == 60000

        r = auth.get(f"{BASE_URL}/api/avanco/threshold")
        assert r.json()["threshold"] == 60000

        r = auth.get(f"{BASE_URL}/api/avanco/projects")
        assert r.status_code == 200
        j = r.json()
        codes = [p["project_code"] for p in j["projects"]]
        assert "DASHKPI-08" in codes
        assert "DASHKPI-01" not in codes  # 50k excluded

        # Restore
        r = auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": 45000})
        assert r.status_code == 200
        assert r.json()["threshold"] == 45000

    def test_invalid_threshold(self, auth):
        r = auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": 0})
        assert r.status_code == 400
        r = auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": -5})
        assert r.status_code == 400


class TestProjectsList:
    def test_avanco_projects_shape(self, auth):
        r = auth.get(f"{BASE_URL}/api/avanco/projects")
        assert r.status_code == 200
        j = r.json()
        assert "projects" in j and "totals" in j and "threshold" in j
        t = j["totals"]
        for k in ["count", "programmed_value", "actual_value", "avg_pct_fisico", "critical"]:
            assert k in t
        for p in j["projects"]:
            for k in ["pct_fisico", "pct_financeiro", "dias_trabalhados", "produzido_por_dia",
                      "meta_diaria", "materials"]:
                assert k in p, f"missing {k}"
            for k in ["items", "pct_delivered", "pending_items", "total_value"]:
                assert k in p["materials"]
            assert (p["execution_status"] or "") != "cancelado"


class TestProjectDetail:
    def test_detail_dashkpi08(self, auth, dashkpi08_id):
        r = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["eligible"] is True
        items = {i["key"]: i for i in j["items"]}
        # postes 30 planned, exec 8 → 26.7
        assert "postes" in items
        assert items["postes"]["planned_qty"] == 30
        assert items["postes"]["executed_qty"] == 8
        assert abs(items["postes"]["pct"] - 26.7) < 0.5
        assert items["postes"]["weight"] == 2.0
        # km_rede 5 planned, exec 2.5 → 50
        assert abs(items["km_rede"]["executed_qty"] - 2.5) < 0.01
        assert abs(items["km_rede"]["pct"] - 50.0) < 0.5
        # locação custom
        loc = [i for i in j["items"] if i["label"].lower().startswith("loca")]
        assert loc, "custom Locação item missing"
        # pct_fisico ~17.2
        assert abs(j["summary"]["pct_fisico"] - 17.2) < 1.5
        # curve
        assert isinstance(j["curve"], list) and len(j["curve"]) >= 2
        for pt in j["curve"]:
            assert "date" in pt and "planned_pct" in pt
        # materials with qty_applied field
        assert all("qty_applied" in m for m in j["materials"])


class TestEntries:
    def test_entry_invalid_key(self, auth, dashkpi08_id):
        r = auth.post(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries",
                      json={"date": "2026-09-15", "item_key": "not_exist_xyz", "qty": 1})
        assert r.status_code == 400

    def test_entry_zero_qty(self, auth, dashkpi08_id):
        r = auth.post(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries",
                      json={"date": "2026-09-15", "item_key": "postes", "qty": 0})
        assert r.status_code == 400

    def test_entry_create_and_delete(self, auth, dashkpi08_id):
        # Baseline pct
        before = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco").json()["summary"]["pct_fisico"]
        r = auth.post(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries",
                      json={"date": "2026-09-14", "item_key": "postes", "qty": 3, "notes": "TEST-IT26"})
        assert r.status_code == 200, r.text
        entry = r.json()["entry"]
        eid = entry["id"]
        pct_after = r.json()["pct_fisico"]
        assert pct_after > before
        # Delete
        r = auth.delete(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries/{eid}")
        assert r.status_code == 200
        after = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco").json()["summary"]["pct_fisico"]
        assert abs(after - before) < 0.5


class TestItemsConfig:
    def test_put_items_creates_custom_and_ignores_empty_label(self, auth, dashkpi08_id):
        # fetch current to preserve seed's Locação
        cur = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco").json()
        existing = cur.get("custom_items") or []
        weights = cur.get("weights") or {}
        # Append test custom + one empty label (should be ignored)
        payload_customs = list(existing) + [
            {"label": "TEST-IT26 Etapa", "unit": "un", "planned_qty": 10},
            {"label": "   ", "unit": "un", "planned_qty": 5},
        ]
        r = auth.put(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/items",
                     json={"custom_items": payload_customs, "weights": weights})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        labels = [i["label"] for i in items]
        assert "TEST-IT26 Etapa" in labels
        assert not any(l.strip() == "" for l in labels)
        # find test key
        test_item = next(i for i in items if i["label"] == "TEST-IT26 Etapa")
        assert test_item["key"].startswith("c_")
        test_key = test_item["key"]

        # Entry on newly created custom item
        r = auth.post(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries",
                      json={"date": "2026-09-15", "item_key": test_key, "qty": 5, "notes": "TEST-IT26"})
        assert r.status_code == 200
        eid = r.json()["entry"]["id"]

        # Cleanup: remove test entry
        auth.delete(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/entries/{eid}")
        # Cleanup: restore custom_items to only 'Locação' from seed
        preserved = [c for c in existing if c.get("label", "").lower().startswith("loca")]
        if not preserved and existing:
            preserved = existing  # fallback
        r = auth.put(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco/items",
                     json={"custom_items": preserved, "weights": weights})
        assert r.status_code == 200


class TestMaterials:
    def test_patch_qty_applied(self, auth, dashkpi08_id):
        # find material m1
        j = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco").json()
        mats = j["materials"]
        assert mats
        m = next((x for x in mats if x["id"] == "m1"), mats[0])
        original = m["qty_applied"]

        r = auth.patch(f"{BASE_URL}/api/projects/{dashkpi08_id}/materials/{m['id']}",
                       json={"qty_applied": 12})
        assert r.status_code == 200, r.text

        j2 = auth.get(f"{BASE_URL}/api/projects/{dashkpi08_id}/avanco").json()
        m2 = next(x for x in j2["materials"] if x["id"] == m["id"])
        assert m2["qty_applied"] == 12
        assert j2["summary"]["materials"]["qty_applied"] >= 12

        # restore to 8 (per prompt)
        r = auth.patch(f"{BASE_URL}/api/projects/{dashkpi08_id}/materials/{m['id']}",
                       json={"qty_applied": original if m["id"] != "m1" else 8})
        assert r.status_code == 200


class TestRegression:
    def test_regression_endpoints(self, auth):
        assert auth.get(f"{BASE_URL}/api/dashboard/kpis").status_code == 200
        assert auth.get(f"{BASE_URL}/api/operacional/today").status_code == 200
        assert auth.get(f"{BASE_URL}/api/equipamentos").status_code == 200


@pytest.fixture(scope="module", autouse=True)
def restore_threshold(auth):
    yield
    try:
        auth.post(f"{BASE_URL}/api/avanco/threshold", json={"threshold": 45000})
    except Exception:
        pass
