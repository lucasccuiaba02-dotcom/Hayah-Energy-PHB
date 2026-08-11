"""Iteration 18 - Validate materials-related features:
- PATCH /api/projects/{id}/materials/{item_id} accepts unit, warehouse_status, code, item, notes + numeric fields
- POST /api/materials/preview returns valid PDF with 7 columns (Código, Descrição, Un, Solicitado, Separado, Baixado, Entregue)
- POST /api/projects/{id}/materials-import accepts EN header (code,item,quantity,unit,cost) AND PT header (codigo,descricao,quantidade,unidade,preco)
- Regression: /api/faturamento/pipeline, /api/faturamento/backlog-alerts remain OK
"""
import io
import os
import time
import random
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASS = "Admin@123"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def project_id(client):
    # Create a fresh test project
    code = f"OB-IT18-{random.randint(1000,9999)}"
    payload = {
        "project_code": code,
        "name": f"TEST_ITER18 {code}",
        "location": "Cuiabá/MT",
        "project_type": "obra",
        "start_date": "2026-01-10",
        "end_date": "2026-01-20",
    }
    r = client.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    pid = data.get("id") or data.get("_id")
    assert pid, f"no id in {data}"
    yield pid
    # Teardown
    try:
        client.delete(f"{API}/projects/{pid}", timeout=15)
    except Exception:
        pass


# ---------- CSV Import: English headers ----------
def test_import_csv_english_headers(client, project_id):
    csv = "code,item,quantity,unit,cost\n1234,POSTE CONCRETO 12/300,10,UN,850.50\n5678,CABO XLPE 35MM,25,M,42.30\n"
    files = {"file": ("materials_en.csv", csv.encode("utf-8"), "text/csv")}
    r = client.post(f"{API}/projects/{project_id}/materials-import", files=files, timeout=30)
    assert r.status_code == 200, f"EN import failed: {r.status_code} {r.text[:500]}"
    body = r.json()
    # Verify persisted
    r2 = client.get(f"{API}/projects/{project_id}", timeout=15)
    assert r2.status_code == 200
    mats = r2.json().get("materials_list") or []
    assert len(mats) >= 2, f"expected >=2 items after EN import; got {len(mats)}: {mats}"
    codes = [str(m.get("code", "")) for m in mats]
    items = [str(m.get("item", "")) for m in mats]
    assert any("1234" in c for c in codes), f"code 1234 missing: {codes}"
    assert any("POSTE" in i.upper() for i in items), f"POSTE missing: {items}"
    units = [str(m.get("unit", "")).upper() for m in mats]
    assert any(u in ("UN", "M") for u in units), f"units not mapped: {units}"


# ---------- CSV Import: PT-BR headers ----------
def test_import_csv_pt_headers(client, project_id):
    # Overwrite materials with PT headers
    csv = "codigo,descricao,quantidade,unidade,preco\n9999,POSTE MADEIRA 11M,5,PC,320.00\n8888,ISOLADOR DISCO,50,PÇ,15.75\n"
    files = {"file": ("materiais_pt.csv", csv.encode("utf-8"), "text/csv")}
    r = client.post(f"{API}/projects/{project_id}/materials-import", files=files, timeout=30)
    assert r.status_code == 200, f"PT import failed: {r.status_code} {r.text[:500]}"
    r2 = client.get(f"{API}/projects/{project_id}", timeout=15)
    mats = r2.json().get("materials_list") or []
    assert len(mats) >= 2
    codes = [str(m.get("code", "")) for m in mats]
    items = [str(m.get("item", "")).upper() for m in mats]
    assert any("9999" in c for c in codes), f"9999 missing: {codes}"
    assert any("POSTE MADEIRA" in i for i in items), f"desc missing: {items}"


# ---------- PATCH material item ----------
def test_patch_material_unit_and_warehouse_status(client, project_id):
    r = client.get(f"{API}/projects/{project_id}", timeout=15)
    mats = r.json().get("materials_list") or []
    assert mats, "need materials to test patch"
    item_id = mats[0].get("id")
    assert item_id

    # Change unit to KG
    r = client.patch(f"{API}/projects/{project_id}/materials/{item_id}",
                     json={"unit": "KG"}, timeout=15)
    assert r.status_code == 200, f"unit patch failed: {r.status_code} {r.text[:200]}"

    # Change warehouse_status
    r = client.patch(f"{API}/projects/{project_id}/materials/{item_id}",
                     json={"warehouse_status": "na_doca"}, timeout=15)
    assert r.status_code == 200

    # Change numeric qty_separated
    r = client.patch(f"{API}/projects/{project_id}/materials/{item_id}",
                     json={"qty_separated": 3.5}, timeout=15)
    assert r.status_code == 200

    # Verify persistence
    r = client.get(f"{API}/projects/{project_id}", timeout=15)
    mats2 = r.json().get("materials_list") or []
    target = next((m for m in mats2 if m.get("id") == item_id), None)
    assert target, "item not found after patch"
    assert str(target.get("unit", "")).upper() == "KG", f"unit not KG: {target}"
    assert target.get("warehouse_status") == "na_doca", f"ws not na_doca: {target}"
    assert float(target.get("qty_separated", 0)) == 3.5


def test_patch_material_rejects_only_when_no_valid_fields(client, project_id):
    r = client.get(f"{API}/projects/{project_id}", timeout=15)
    mats = r.json().get("materials_list") or []
    item_id = mats[0].get("id")
    # Unknown field only -> 400
    r = client.patch(f"{API}/projects/{project_id}/materials/{item_id}",
                     json={"foo": "bar", "banana": 1}, timeout=15)
    assert r.status_code == 400, f"expected 400 for no valid fields, got {r.status_code}"

    # Mixed: unknown + valid -> 200 (accepts silently)
    r = client.patch(f"{API}/projects/{project_id}/materials/{item_id}",
                     json={"foo": "bar", "notes": "TEST_NOTE"}, timeout=15)
    assert r.status_code == 200, f"expected 200 with valid + unknown; got {r.status_code} {r.text[:200]}"


# ---------- PDF preview ----------
def test_materials_preview_pdf(client, project_id):
    # Ensure at least one material exists and has known code/desc/unit
    r = client.get(f"{API}/projects/{project_id}", timeout=15)
    mats = r.json().get("materials_list") or []
    assert mats

    data = {"project_id": project_id, "notes": "TEST preview", "signature_name": "Test User"}
    r = client.post(f"{API}/materials/preview", data=data, timeout=45)
    assert r.status_code == 200, f"preview failed: {r.status_code} {r.text[:400]}"
    assert r.headers.get("content-type", "").startswith("application/pdf")
    pdf_bytes = r.content
    assert pdf_bytes.startswith(b"%PDF"), "not a valid PDF"
    assert len(pdf_bytes) > 2000, f"PDF suspiciously small: {len(pdf_bytes)}"

    # Extract text and verify columns/content
    try:
        from pypdf import PdfReader
    except ImportError:
        import subprocess
        subprocess.run(["pip", "install", "-q", "pypdf"], check=True)
        from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    text = ""
    for p in reader.pages:
        text += (p.extract_text() or "")
    # Column headers
    for hdr in ["Código", "Descrição", "Un", "Solicitado", "Separado", "Baixado", "Entregue"]:
        assert hdr in text, f"header '{hdr}' missing in PDF text. got: {text[:800]}"
    # Some content assertions - codes/descriptions
    assert "9999" in text or "1234" in text or "8888" in text, f"no known code in PDF: {text[:800]}"
    assert "POSTE" in text.upper(), "POSTE missing in PDF"


# ---------- Regression ----------
def test_regression_faturamento_pipeline(client):
    r = client.get(f"{API}/faturamento/pipeline", timeout=20)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert "stuck_projects" in body
    assert body.get("stuck_threshold_days") == 15


def test_regression_backlog_alerts(client):
    r = client.get(f"{API}/faturamento/backlog-alerts", timeout=20)
    assert r.status_code == 200, r.text[:200]
    body = r.json()
    assert "count" in body and body.get("threshold_days") == 15 and "items" in body
