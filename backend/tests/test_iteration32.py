"""Iteration 32 - Orçamentos module tests."""
import io
import os
import pytest
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"
EMAIL = "lucasc.cuiaba02@gmail.com"
PASSWORD = "Hayah$152610"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    return []


# --- Unauth guard
def test_unauth_list():
    r = requests.get(f"{BASE}/api/orcamentos", timeout=15)
    assert r.status_code in (401, 403)


# --- Company defaults & put & logo
def test_company_defaults_and_update(client):
    r = client.get(f"{BASE}/api/orcamentos/company", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("name") == "HAYAH ENERGY"
    # update
    payload = {"name": "HAYAH ENERGY", "cnpj": "12.345.678/0001-99", "responsible_name": "Lucas C"}
    r = client.put(f"{BASE}/api/orcamentos/company", json=payload, timeout=15)
    assert r.status_code == 200
    r = client.get(f"{BASE}/api/orcamentos/company", timeout=15)
    assert r.json().get("cnpj") == "12.345.678/0001-99"
    assert r.json().get("responsible_name") == "Lucas C"


def test_company_logo_upload(client):
    # minimal 1x1 PNG
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000005000106000d61e2f70000000049454e44ae426082"
    )
    files = {"file": ("logo.png", png, "image/png")}
    r = client.post(f"{BASE}/api/orcamentos/company/logo", files=files, timeout=30)
    assert r.status_code == 200, r.text
    r = client.get(f"{BASE}/api/orcamentos/company", timeout=15)
    assert r.json().get("logo_url")
    r = client.get(f"{BASE}/api/orcamentos/company/logo/file", timeout=30)
    assert r.status_code == 200
    assert r.content[:8].startswith(b"\x89PNG")


# --- CRUD
def test_create_empty_and_sequential(client, created_ids):
    r1 = client.post(f"{BASE}/api/orcamentos", json={}, timeout=15)
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["status"] == "rascunho"
    assert d1["include_labor_table"] is False
    assert d1["include_material_table"] is False
    assert "/" in d1["code"]
    created_ids.append(d1["id"])

    r2 = client.post(f"{BASE}/api/orcamentos", json={"client": {"name": "TEST_ACME"}, "objeto": "Test obj",
                                                      "scope_items": ["a", "", "b"]}, timeout=15)
    d2 = r2.json()
    created_ids.append(d2["id"])
    seq1 = int(d1["code"].split("/")[0])
    seq2 = int(d2["code"].split("/")[0])
    assert seq2 == seq1 + 1


def test_list_filters(client):
    r = client.get(f"{BASE}/api/orcamentos", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list) and len(items) >= 1
    keys = {"id", "code", "status", "status_label", "client_name", "grand_total",
            "labor_count", "material_count", "photos_count"}
    assert keys.issubset(items[0].keys())
    r = client.get(f"{BASE}/api/orcamentos?status=rascunho", timeout=15)
    assert all(x["status"] == "rascunho" for x in r.json())
    r = client.get(f"{BASE}/api/orcamentos?q=TEST_ACME", timeout=15)
    assert any("TEST_ACME" in (x["client_name"] or "") for x in r.json())


def test_update_totals(client, created_ids):
    oid = created_ids[1]
    body = {
        "client": {"phone": "111"},
        "material_markup_pct": 10,
        "labor_items": [{"description": "SVC A", "unit": "SV", "qty": 2, "unit_price": 100}],
        "material_items": [{"code": "M1", "description": "Cable", "unit": "M", "qty": 10, "unit_cost": 5}],
        "scope_items": ["Item 1", "  ", "Item 2"],
    }
    r = client.put(f"{BASE}/api/orcamentos/{oid}", json=body, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["labor_total"] == 200.0
    assert d["material_total"] == round(10 * 5 * 1.10, 2)  # 55
    assert d["grand_total"] == 255.0
    assert all(it.get("id") for it in d["labor_items"])
    assert all(it.get("id") for it in d["material_items"])
    assert d["scope_items"] == ["Item 1", "Item 2"]
    assert d["client"]["phone"] == "111"


def test_status_flow(client, created_ids):
    oid = created_ids[1]
    for st in ["enviado", "aprovado", "em_execucao", "concluido"]:
        r = client.post(f"{BASE}/api/orcamentos/{oid}/status", json={"status": st}, timeout=15)
        assert r.status_code == 200, f"{st}: {r.text}"
    # invalid
    r = client.post(f"{BASE}/api/orcamentos/{oid}/status", json={"status": "bogus"}, timeout=15)
    assert r.status_code == 400
    # verify started_at + finished_at + history
    r = client.get(f"{BASE}/api/orcamentos/{oid}", timeout=15)
    d = r.json()
    assert d.get("started_at")
    assert d.get("finished_at")
    assert isinstance(d.get("status_history"), list) and len(d["status_history"]) >= 4


def test_duplicate(client, created_ids):
    oid = created_ids[1]
    r = client.post(f"{BASE}/api/orcamentos/{oid}/duplicate", timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "rascunho"
    assert len(d["labor_items"]) == 1
    assert len(d["photos"]) == 0
    created_ids.append(d["id"])


# --- Materials import
def test_materials_import_csv_and_invalid(client, created_ids):
    oid = created_ids[0]
    csv_bytes = (
        "CÓDIGO;DESCRIÇÃO;UN;QTD;PREÇO UNIT\n"
        "M-01;Fio 2,5mm;M;100;3,50\n"
        "M-02;Disjuntor;UN;5;25,00\n"
    ).encode("utf-8")
    files = {"file": ("mat.csv", csv_bytes, "text/csv")}
    r = client.post(f"{BASE}/api/orcamentos/{oid}/materials/import",
                    data={"supplier": "SUP1", "replace": "false"}, files=files, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 2

    # invalid file (no recognizable header)
    bad = b"just some random text\nwith nothing meaningful\n"
    files2 = {"file": ("bad.csv", bad, "text/csv")}
    r = client.post(f"{BASE}/api/orcamentos/{oid}/materials/import",
                    data={"replace": "false"}, files=files2, timeout=30)
    assert r.status_code == 400

    # replace=true
    csv2 = ("codigo;descricao;un;qtd;preco unit\nX;Item X;UN;1;10,00\n").encode("utf-8")
    files3 = {"file": ("mat2.csv", csv2, "text/csv")}
    r = client.post(f"{BASE}/api/orcamentos/{oid}/materials/import",
                    data={"supplier": "SUP2", "replace": "true"}, files=files3, timeout=30)
    assert r.status_code == 200
    d = client.get(f"{BASE}/api/orcamentos/{oid}", timeout=15).json()
    assert len(d["material_items"]) == 1


# --- Photos
def test_photos_flow(client, created_ids):
    oid = created_ids[0]
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c62000100000005000106000d61e2f70000000049454e44ae426082"
    )
    files = {"file": ("photo.png", png, "image/png")}
    r = client.post(f"{BASE}/api/orcamentos/{oid}/photos",
                    data={"kind": "antes", "caption": "TESTcap"}, files=files, timeout=30)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # invalid kind
    r = client.post(f"{BASE}/api/orcamentos/{oid}/photos",
                    data={"kind": "invalid", "caption": ""}, files={"file": ("p.png", png, "image/png")}, timeout=30)
    assert r.status_code == 400
    # get file
    r = client.get(f"{BASE}/api/orcamentos/{oid}/photos/{pid}/file", timeout=30)
    assert r.status_code == 200
    assert r.content[:4] == b"\x89PNG"
    # patch
    r = client.patch(f"{BASE}/api/orcamentos/{oid}/photos/{pid}",
                     json={"caption": "new cap", "kind": "depois"}, timeout=15)
    assert r.status_code == 200
    # verify
    d = client.get(f"{BASE}/api/orcamentos/{oid}", timeout=15).json()
    p = [p for p in d["photos"] if p["id"] == pid][0]
    assert p["caption"] == "new cap" and p["kind"] == "depois"
    # delete
    r = client.delete(f"{BASE}/api/orcamentos/{oid}/photos/{pid}", timeout=15)
    assert r.status_code == 200


# --- PDFs
def test_pdfs(client, created_ids):
    oid = created_ids[1]
    for kind in ["proposta", "conclusao"]:
        r = client.get(f"{BASE}/api/orcamentos/{oid}/pdf/{kind}", timeout=60)
        assert r.status_code == 200, f"{kind}: {r.status_code} {r.text[:200]}"
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"
        assert len(r.content) > 3000
        assert "attachment" in r.headers.get("content-disposition", "").lower()


# --- Delete + 404
def test_delete_and_404(client, created_ids):
    # delete test-created (keep the first one - user has 00001)
    for oid in created_ids[1:]:
        r = client.delete(f"{BASE}/api/orcamentos/{oid}", timeout=15)
        assert r.status_code == 200
        r = client.get(f"{BASE}/api/orcamentos/{oid}", timeout=15)
        assert r.status_code == 404
    # also delete first if it's not the pre-existing 00001
    for oid in created_ids[:1]:
        client.delete(f"{BASE}/api/orcamentos/{oid}", timeout=15)
