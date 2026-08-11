"""Iteration 19 — Estoque (Onda 2) backend tests.

Covers:
1. CRUD lifecycle (POST/GET/PATCH/DELETE + 404/409)
2. KPIs + families endpoint
3. Filters (q, family, group, low_stock, divergent)
4. CSV import (merge + replace_system_only)
5. XLSX import from synthetic openpyxl workbook
6. Accuracy/net/value/is_low_stock/is_divergent computations
7. Export CSV structure (13 columns + UTF-8 BOM)
8. Regression: Faturamento pipeline still exposes stuck_threshold_days
"""
import io
import os
import csv
import pytest
import requests
import openpyxl
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("access_token") or r.json().get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(autouse=True)
def _cleanup_test_items(session):
    """Delete any items with TEST_ prefix code before/after each test."""
    def _wipe():
        r = session.get(f"{API}/estoque", params={"limit": 5000})
        if r.status_code == 200:
            for it in r.json().get("items", []):
                if it.get("code", "").startswith("TEST_"):
                    session.delete(f"{API}/estoque/{it['id']}")
    _wipe()
    yield
    _wipe()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
class TestEstoqueCRUD:
    def test_create_then_get(self, session):
        payload = {
            "code": "TEST_A1", "description": "Cabo XLPE 25mm",
            "unit": "m", "family": "CABOS", "group": "BT",
            "qty_system": 100, "qty_physical": 95, "unit_value": 25.5,
            "min_stock": 10, "notes": "ok",
        }
        r = session.post(f"{API}/estoque", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["code"] == "TEST_A1"
        assert data["unit"] == "M"  # normalized upper
        assert data["net"] == -5.0
        assert 0.94 < data["accuracy"] <= 1.0
        assert data["value_physical"] == round(95 * 25.5, 2)
        assert data["value_system"] == round(100 * 25.5, 2)
        assert data["is_divergent"] is True
        assert data["is_low_stock"] is False

        # GET list must contain it
        r2 = session.get(f"{API}/estoque", params={"q": "TEST_A1"})
        assert r2.status_code == 200
        items = r2.json()["items"]
        assert any(i["code"] == "TEST_A1" for i in items)

    def test_duplicate_returns_409(self, session):
        session.post(f"{API}/estoque", json={"code": "TEST_DUP", "description": "d"})
        r = session.post(f"{API}/estoque", json={"code": "TEST_DUP", "description": "d2"})
        assert r.status_code == 409

    def test_patch_recomputes(self, session):
        r = session.post(f"{API}/estoque", json={
            "code": "TEST_PATCH", "description": "d", "qty_system": 10, "qty_physical": 10, "unit_value": 5,
        })
        item_id = r.json()["id"]
        # Update physical + min_stock to trigger divergent+low_stock
        r2 = session.patch(f"{API}/estoque/{item_id}", json={"qty_physical": 3, "min_stock": 5})
        assert r2.status_code == 200
        d = r2.json()
        assert d["qty_physical"] == 3
        assert d["net"] == -7.0
        assert d["is_divergent"] is True
        assert d["is_low_stock"] is True
        assert d["value_physical"] == 15.0
        assert d["value_system"] == 50.0
        assert d["value_diff"] == -35.0

    def test_delete_then_404(self, session):
        r = session.post(f"{API}/estoque", json={"code": "TEST_DEL", "description": "x"})
        item_id = r.json()["id"]
        r2 = session.delete(f"{API}/estoque/{item_id}")
        assert r2.status_code == 200
        r3 = session.delete(f"{API}/estoque/{item_id}")
        assert r3.status_code == 404


# ---------------------------------------------------------------------------
# KPIs + families
# ---------------------------------------------------------------------------
class TestKpisFamilies:
    def test_kpis_and_families(self, session):
        session.post(f"{API}/estoque", json={
            "code": "TEST_K1", "description": "a", "family": "FAM_A", "group": "G1",
            "qty_system": 10, "qty_physical": 10, "unit_value": 2, "min_stock": 0,
        })
        session.post(f"{API}/estoque", json={
            "code": "TEST_K2", "description": "b", "family": "FAM_B", "group": "G2",
            "qty_system": 20, "qty_physical": 5, "unit_value": 3, "min_stock": 10,
        })
        r = session.get(f"{API}/estoque/kpis")
        assert r.status_code == 200
        k = r.json()
        assert k["total_items"] >= 2
        for key in ["value_physical_total", "value_system_total", "value_diff_total",
                    "accuracy_global", "low_stock_count", "divergent_count",
                    "families_count", "groups_count"]:
            assert key in k
        assert k["low_stock_count"] >= 1
        assert k["divergent_count"] >= 1

        r2 = session.get(f"{API}/estoque/families")
        assert r2.status_code == 200
        f = r2.json()
        assert "FAM_A" in f["families"] and "FAM_B" in f["families"]
        assert "G1" in f["groups"] and "G2" in f["groups"]


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------
class TestFilters:
    def test_filters_combined(self, session):
        session.post(f"{API}/estoque", json={
            "code": "TEST_F1", "description": "Cabo BT", "family": "F_CAB", "group": "GBT",
            "qty_system": 10, "qty_physical": 10, "min_stock": 20,  # low stock, not divergent
        })
        session.post(f"{API}/estoque", json={
            "code": "TEST_F2", "description": "Poste", "family": "F_POS", "group": "GBT",
            "qty_system": 5, "qty_physical": 1, "min_stock": 0,  # divergent, not low
        })
        # family filter
        r = session.get(f"{API}/estoque", params={"family": "F_CAB"})
        codes = [i["code"] for i in r.json()["items"]]
        assert "TEST_F1" in codes and "TEST_F2" not in codes
        # group filter
        r = session.get(f"{API}/estoque", params={"group": "GBT"})
        codes = [i["code"] for i in r.json()["items"]]
        assert "TEST_F1" in codes and "TEST_F2" in codes
        # low_stock only
        r = session.get(f"{API}/estoque", params={"low_stock": "true"})
        codes = [i["code"] for i in r.json()["items"]]
        assert "TEST_F1" in codes and "TEST_F2" not in codes
        # divergent only
        r = session.get(f"{API}/estoque", params={"divergent": "true"})
        codes = [i["code"] for i in r.json()["items"]]
        assert "TEST_F2" in codes and "TEST_F1" not in codes
        # q search
        r = session.get(f"{API}/estoque", params={"q": "poste"})
        codes = [i["code"] for i in r.json()["items"]]
        assert "TEST_F2" in codes


# ---------------------------------------------------------------------------
# Import CSV + XLSX
# ---------------------------------------------------------------------------
class TestImport:
    def test_csv_merge(self, session):
        csv_content = "COD,DESCRIÇÃO,UNID,SOMA\nTEST_I1,Item1,UN,50\nTEST_I2,Item2,KG,25\n"
        files = {"file": ("teste.csv", csv_content.encode("utf-8"), "text/csv")}
        r = session.post(f"{API}/estoque/import", files=files, data={"mode": "merge"})
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["imported"] == 2
        assert result["created"] == 2

        # Verify persistence
        r2 = session.get(f"{API}/estoque", params={"q": "TEST_I1"})
        items = [i for i in r2.json()["items"] if i["code"] == "TEST_I1"]
        assert len(items) == 1
        assert items[0]["qty_system"] == 50
        assert items[0]["unit"] == "UN"

    def test_csv_replace_system_only(self, session):
        # Seed one item manually
        session.post(f"{API}/estoque", json={"code": "TEST_ORPH", "description": "orphan", "qty_system": 99, "qty_physical": 10})
        # Import CSV that does NOT contain TEST_ORPH
        csv_content = "COD,DESCRIÇÃO,UNID,SOMA\nTEST_I3,Item3,UN,10\n"
        files = {"file": ("t.csv", csv_content.encode("utf-8"), "text/csv")}
        r = session.post(f"{API}/estoque/import", files=files, data={"mode": "replace_system_only"})
        assert r.status_code == 200
        result = r.json()
        assert result["mode"] == "replace_system_only"
        assert result["zeroed_when_absent"] >= 1

        # TEST_ORPH must have qty_system=0 but qty_physical preserved
        r2 = session.get(f"{API}/estoque", params={"q": "TEST_ORPH"})
        item = next((i for i in r2.json()["items"] if i["code"] == "TEST_ORPH"), None)
        assert item is not None
        assert item["qty_system"] == 0
        assert item["qty_physical"] == 10

    def test_xlsx_import(self, session):
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "APOIO MAT DESAT"
        # Simulate the Satelite.xlsx layout with a couple garbage rows first
        ws.append(["Relatório", "", "", "", ""])
        ws.append(["", "", "", "", ""])
        ws.append(["SITUAÇÃO MATERIAL", "COD", "DESCRIÇÃO", "UNID", "SOMA"])
        ws.append(["ATIVO", "TEST_X1", "Material X1", "UN", 40])
        ws.append(["ATIVO", "TEST_X2", "Material X2", "PC", 15])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        files = {"file": ("satelite.xlsx", buf.getvalue(),
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = session.post(f"{API}/estoque/import", files=files, data={"mode": "merge"})
        assert r.status_code == 200, r.text
        result = r.json()
        assert result["imported"] == 2
        # Verify data
        r2 = session.get(f"{API}/estoque", params={"q": "TEST_X1"})
        item = next((i for i in r2.json()["items"] if i["code"] == "TEST_X1"), None)
        assert item is not None
        assert item["qty_system"] == 40
        assert item["description"] == "Material X1"


# ---------------------------------------------------------------------------
# Export CSV
# ---------------------------------------------------------------------------
class TestExport:
    def test_export_csv_headers(self, session):
        session.post(f"{API}/estoque", json={"code": "TEST_EXP", "description": "exp"})
        r = session.get(f"{API}/estoque/export")
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("Content-Type", "").lower()
        # UTF-8 BOM
        assert r.content.startswith(b"\xef\xbb\xbf")
        text = r.content.decode("utf-8-sig")
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
        expected = ["codigo","descricao","unidade","familia","grupo","qty_sistema",
                    "qty_fisica","net","valor_unit","valor_fisico","valor_sistemico",
                    "min_stock","notas"]
        assert rows[0] == expected
        assert len(rows[0]) == 13


# ---------------------------------------------------------------------------
# Regression: Onda 1 endpoints
# ---------------------------------------------------------------------------
class TestOnda1Regression:
    def test_faturamento_pipeline(self, session):
        r = session.get(f"{API}/faturamento/pipeline")
        assert r.status_code == 200
        assert r.json().get("stuck_threshold_days") == 15

    def test_backlog_alerts(self, session):
        r = session.get(f"{API}/faturamento/backlog-alerts")
        assert r.status_code == 200
        b = r.json()
        assert b.get("threshold_days") == 15
        assert "count" in b and "items" in b
