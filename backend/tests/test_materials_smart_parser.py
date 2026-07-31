"""Test the smart materials-import parser with a Satelite-like Excel template
(rows 1-5 are logo/metadata, row 6 is the header, data starts at row 7).
Also tests that TOTAL/SUBTOTAL rows are skipped and that non-material sheets are ignored."""
import io
import os
import pytest
import httpx
from openpyxl import Workbook

BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
if not BACKEND_URL.endswith("/api"):
    API = BACKEND_URL.rstrip("/") + "/api"
else:
    API = BACKEND_URL

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PWD = "Admin@123"


def _login():
    r = httpx.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _make_satelite_like_workbook() -> bytes:
    """Simulates the Satelite template:
    - Sheet 1 "CAPA" (no material list)
    - Sheet 2 "RESUMO OBRA" (has material list with logo/header on rows 1-5)
    - Sheet 3 "LISTA MATERIAIS" (has bigger list — should be chosen because len > CAPA)
    """
    wb = Workbook()
    # Sheet 1 — CAPA (no material list)
    capa = wb.active
    capa.title = "CAPA"
    capa["A1"] = "PROJETO EXECUTIVO"
    capa["A2"] = "Obra: TEST_SATELITE"
    capa["A3"] = "Data: 2026-02-01"

    # Sheet 2 — RESUMO OBRA (small list, 3 items)
    resumo = wb.create_sheet("RESUMO OBRA")
    resumo["A1"] = "LOGO HAYAH ENERGY"  # logo row
    resumo["A2"] = "OBRA XYZ"
    resumo["A3"] = ""  # blank
    resumo["A4"] = "RESUMO DE MATERIAL"
    resumo["A5"] = ""
    # header on row 6
    resumo["A6"] = "Código"
    resumo["B6"] = "Descrição"
    resumo["C6"] = "Unidade"
    resumo["D6"] = "Quantidade"
    resumo["E6"] = "Preço Unitário"
    # data starts row 7
    resumo.append([])  # this shifts, but let's just write cells explicitly
    resumo["A7"] = "MAT001"
    resumo["B7"] = "Poste de concreto DT 10/300"
    resumo["C7"] = "un"
    resumo["D7"] = 5
    resumo["E7"] = 850.5
    resumo["A8"] = "MAT002"
    resumo["B8"] = "Cabo de alumínio 4/0"
    resumo["C8"] = "m"
    resumo["D8"] = 250
    resumo["E8"] = 12.75
    # TOTAL row — must be skipped
    resumo["A9"] = ""
    resumo["B9"] = "TOTAL"
    resumo["C9"] = ""
    resumo["D9"] = ""
    resumo["E9"] = 999999

    # Sheet 3 — LISTA MATERIAIS (bigger list, 5 items) — this should be the CHOSEN sheet
    lista = wb.create_sheet("LISTA MATERIAIS")
    lista["A1"] = "COD"
    lista["B1"] = "DESCRICAO"
    lista["C1"] = "UN"
    lista["D1"] = "QTD"
    lista["E1"] = "VALOR"
    data = [
        ("L001", "Isolador polimérico 15kV", "un", 12, 45.30),
        ("L002", "Cruzeta metálica 2,5m", "un", 6, 320.00),
        ("L003", "Conector cunha 4/0", "un", 24, 18.50),
        ("L004", "Chave fusível 15kV 100A", "un", 3, 780.90),
        ("L005", "Transformador 30kVA", "un", 1, 4200.00),
        # SUBTOTAL row — must be skipped
        ("", "SUBTOTAL", "", "", 999),
    ]
    for row in data:
        lista.append(list(row))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _create_project(token, name):
    r = httpx.post(f"{API}/projects", json={
        "name": name,
        "project_code": f"TEST-SP-{name[:8]}",
        "programmed_value": 1000,
    }, headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    d = r.json()
    return d.get("id") or d.get("_id")


def _delete_project(token, pid):
    httpx.delete(f"{API}/projects/{pid}", headers={"Authorization": f"Bearer {token}"}, timeout=15)


def test_smart_parser_picks_biggest_sheet_and_skips_totals():
    token = _login()
    pid = _create_project(token, "TEST_SMART_PARSER")
    try:
        xlsx = _make_satelite_like_workbook()
        files = {"file": ("Satelite-atualxxMODELO.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = httpx.post(
            f"{API}/projects/{pid}/materials-import",
            files=files,
            data={"replace": "true"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        # LISTA MATERIAIS has 5 real items — TOTAL/SUBTOTAL rows must be filtered
        assert d["imported"] == 5, f"Expected 5 items, got {d['imported']}: {d}"
        items = d["items"]
        codes = [i["item"] for i in items]
        assert "Isolador polimérico 15kV" in codes
        assert "Transformador 30kVA" in codes
        # No TOTAL/SUBTOTAL rows leaked
        assert not any((i["item"] or "").lower().startswith(("total", "subtotal")) for i in items)
        # Quantities parsed as numbers
        transformer = next(i for i in items if i["item"] == "Transformador 30kVA")
        assert transformer["quantity"] == 1
        assert transformer["unit_cost"] == 4200.0
        assert transformer["total_cost"] == 4200.0
    finally:
        _delete_project(token, pid)


def test_smart_parser_detects_header_below_logo():
    """Test that when header is NOT on row 1 (has logo rows above), parser still finds it."""
    token = _login()
    pid = _create_project(token, "TEST_HEADER_DETECT")
    try:
        wb = Workbook()
        ws = wb.active
        ws.title = "MATERIAIS"
        # Simulate typical logo/metadata block above
        ws["A1"] = "== HAYAH ENERGY =="
        ws["A2"] = "Obra: X"
        ws["A3"] = "Data: 2026-02-01"
        ws["A4"] = ""
        # Actual header on row 5
        ws["A5"] = "Item"
        ws["B5"] = "Quantidade"
        ws["C5"] = "Unidade"
        ws["A6"] = "Cabo isolado 25mm2"
        ws["B6"] = 100
        ws["C6"] = "m"
        ws["A7"] = "Poste madeira 9m"
        ws["B7"] = 2
        ws["C7"] = "un"
        buf = io.BytesIO()
        wb.save(buf)

        files = {"file": ("test.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = httpx.post(
            f"{API}/projects/{pid}/materials-import",
            files=files,
            data={"replace": "true"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["imported"] == 2, f"Expected 2 items, got {d}"
    finally:
        _delete_project(token, pid)


def test_smart_parser_falls_back_to_row1_header():
    """Backward compatibility: sheet with header on row 1 still works."""
    token = _login()
    pid = _create_project(token, "TEST_FALLBACK_ROW1")
    try:
        wb = Workbook()
        ws = wb.active
        ws["A1"] = "item"
        ws["B1"] = "quantidade"
        ws["C1"] = "preco"
        ws["A2"] = "Item A"
        ws["B2"] = 10
        ws["C2"] = 5.5
        ws["A3"] = "Item B"
        ws["B3"] = 3
        ws["C3"] = 2.0
        buf = io.BytesIO()
        wb.save(buf)
        files = {"file": ("simple.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        r = httpx.post(
            f"{API}/projects/{pid}/materials-import",
            files=files,
            data={"replace": "true"},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["imported"] == 2
    finally:
        _delete_project(token, pid)
