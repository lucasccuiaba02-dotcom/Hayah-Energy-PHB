"""
Iteration 29 - Partial material requisition tests.

Covers:
- GET /api/projects/{id}/materials/requisition-balance
- POST /api/materials/preview (parcial → PDF)
- POST /api/materials/request (parcial + total, history, saldo)
- GET /api/projects/{id}/requisitions/{req_id}/pdf
- POST .../resend (parcial → is_resend, saldo inalterado)
"""
import io
import json
import os
import time
import pytest
import requests
from datetime import date, timedelta
from pypdf import PdfReader

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def project(session):
    """Create fresh project with 3 materials. Cleanup at end."""
    suffix = str(int(time.time()))
    payload = {
        "name": f"TEST_PARCIAL_{suffix}",
        "project_code": f"TSTPARC-{suffix}",
        "start_date": date.today().isoformat(),
        "end_date": (date.today() + timedelta(days=30)).isoformat(),
        "programmed_value": 100000,
        "daily_goal": 5000,
    }
    r = session.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create project: {r.status_code} {r.text}"
    pj = r.json()
    pid = pj.get("id") or pj.get("_id")

    # Add 3 materials
    mats = [
        {"item": "Cabo 2,5mm", "code": "C25", "quantity": 100, "unit": "m", "unit_cost": 2.5},
        {"item": "Disjuntor 20A", "code": "D20", "quantity": 10, "unit": "un", "unit_cost": 15.0},
        {"item": "Eletroduto 3/4", "code": "EL34", "quantity": 50, "unit": "m", "unit_cost": 3.0},
    ]
    for m in mats:
        rr = session.post(f"{API}/projects/{pid}/materials/add-manual", json=m, timeout=30)
        assert rr.status_code in (200, 201), f"add mat: {rr.status_code} {rr.text}"

    # Get material ids
    r = session.get(f"{API}/projects/{pid}", timeout=30)
    assert r.status_code == 200
    full = r.json()
    ids = [m["id"] for m in full["materials_list"]]
    assert len(ids) == 3
    yield {"id": pid, "material_ids": ids}
    # cleanup
    try:
        session.delete(f"{API}/projects/{pid}", timeout=30)
    except Exception:
        pass


def test_balance_new_project(session, project):
    r = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert data["fully_requisitioned"] is False
    assert data["partial_count"] == 0
    assert data["next_seq"] == 1
    assert len(data["items"]) == 3
    for it in data["items"]:
        assert it["qty_requisitioned"] == 0
        assert it["saldo"] == it["qty_total"]
        assert it["over"] == 0


def test_partial_empty_items_400(session, project):
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "T", "notes": "", "requisition_type": "parcial", "items": "[]"},
        timeout=30,
    )
    assert r.status_code == 400
    assert "elecione" in r.text or "ítem" in r.text.lower() or "item" in r.text.lower()


def test_partial_zero_qty_400(session, project):
    payload_items = json.dumps([{"id": project["material_ids"][0], "qty": 0}])
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "T", "requisition_type": "parcial", "items": payload_items},
        timeout=30,
    )
    assert r.status_code == 400


def test_partial_nonexistent_id_400(session, project):
    items = json.dumps([{"id": "does_not_exist_xxx", "qty": 5}])
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "T", "requisition_type": "parcial", "items": items},
        timeout=30,
    )
    assert r.status_code == 400


def test_preview_partial_returns_pdf(session, project):
    items = json.dumps([{"id": project["material_ids"][0], "qty": 30}])
    r = session.post(
        f"{API}/materials/preview",
        data={"project_id": project["id"], "signature_name": "Fulano", "notes": "teste", "requisition_type": "parcial", "items": items},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith("application/pdf")
    pdf = PdfReader(io.BytesIO(r.content))
    txt = "".join((p.extract_text() or "") for p in pdf.pages)
    assert "PARCIAL" in txt
    assert "Qtd. Obra" in txt
    assert "Já Req" in txt
    assert "Nesta Req" in txt
    assert "Saldo" in txt

    # verify preview did NOT create history
    b = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    assert b["partial_count"] == 0


def test_partial_1_creates_history_and_updates_balance(session, project):
    mid = project["material_ids"][0]
    items = json.dumps([{"id": mid, "qty": 30}])
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "Fulano", "notes": "primeira parcial", "requisition_type": "parcial", "items": items},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # mocked email
    assert body["status"] in ("skipped", "sent", "error")
    assert "requisition_id" in body
    project["_req1_id"] = body["requisition_id"]

    b = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    assert b["partial_count"] == 1
    assert b["next_seq"] == 2
    assert b["fully_requisitioned"] is False
    it_map = {i["id"]: i for i in b["items"]}
    assert it_map[mid]["qty_requisitioned"] == 30
    assert it_map[mid]["saldo"] == 70

    # verify history entry via GET project
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    reqs = pj.get("material_requisitions", [])
    assert len(reqs) == 1
    r0 = reqs[0]
    assert r0["requisition_type"] == "parcial"
    assert r0["seq"] == 1
    assert len(r0["items"]) == 1
    assert r0["items"][0]["material_id"] == mid
    assert r0["items"][0]["qty"] == 30
    assert r0["items"][0]["qty_total"] == 100
    assert r0["items"][0]["qty_done_before"] == 0
    assert r0["items"][0]["saldo_after"] == 70
    # snapshot only chosen items
    assert len(r0["materials_snapshot"]) == 1
    assert r0["materials_snapshot"][0]["qty_requested"] == 30


def test_partial_2_gets_seq_2(session, project):
    mid = project["material_ids"][1]
    items = json.dumps([{"id": mid, "qty": 5}])
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "F", "requisition_type": "parcial", "items": items},
        timeout=60,
    )
    assert r.status_code == 200
    b = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    assert b["partial_count"] == 2
    assert b["next_seq"] == 3


def test_download_partial_pdf(session, project):
    req_id = project.get("_req1_id")
    assert req_id
    r = session.get(f"{API}/projects/{project['id']}/requisitions/{req_id}/pdf", timeout=60)
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    pdf = PdfReader(io.BytesIO(r.content))
    txt = "".join((p.extract_text() or "") for p in pdf.pages)
    assert "PARCIAL" in txt


def test_resend_partial_does_not_affect_balance(session, project):
    req_id = project.get("_req1_id")
    b_before = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    r = session.post(f"{API}/projects/{project['id']}/requisitions/{req_id}/resend", timeout=60)
    assert r.status_code == 200, r.text
    b_after = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    assert b_before["requisitioned_qty"] == b_after["requisitioned_qty"]
    assert b_before["partial_count"] == b_after["partial_count"]

    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    resend_entries = [r for r in pj.get("material_requisitions", []) if r.get("is_resend")]
    assert len(resend_entries) >= 1
    assert any(r.get("requisition_type") == "parcial" for r in resend_entries)


def test_total_requisition_marks_fully_requisitioned(session, project):
    # remaining balance after 2 partials: cabo 70, disjuntor 5, eletroduto 50
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "Total", "notes": "final"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    b = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    # total counts the FULL qty_requested (all materials at their full quantities)
    assert b["fully_requisitioned"] is True
    # each item saldo should be 0 (done >= total)
    for it in b["items"]:
        assert it["saldo"] == 0
    # snapshot in total should have material_id
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    total_reqs = [r for r in pj.get("material_requisitions", []) if r.get("requisition_type") == "total" and not r.get("is_resend")]
    assert len(total_reqs) >= 1
    for m in total_reqs[-1]["materials_snapshot"]:
        assert "material_id" in m
        assert m["material_id"]
