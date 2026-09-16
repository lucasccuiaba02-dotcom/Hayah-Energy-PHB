"""
Iteration 30 - Material returns (devolucao de sobras) + Requisition fulfillment (baixa por remessa).

Covers:
- GET /api/projects/{id}/materials/requisition-balance (qty_returned/net_requisitioned/return_count)
- POST /api/projects/{id}/materials/returns (validations, saldo update, no qty_delivered change)
- DELETE /api/projects/{id}/materials/returns/{return_id}
- POST /api/materials/preview partial reflects net (bruto - devolvido)
- GET /api/projects/{id}/requisitions/{req_id}/items (partial + total)
- POST /api/projects/{id}/requisitions/{req_id}/fulfillment (validations, materials_list sums)
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
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                return ln.split("=", 1)[1].strip().rstrip("/")
    return ""


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, f"login: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def project(session):
    suffix = str(int(time.time()))
    payload = {
        "name": f"TEST_DEVOL_{suffix}",
        "project_code": f"TSTDEV-{suffix}",
        "start_date": date.today().isoformat(),
        "end_date": (date.today() + timedelta(days=30)).isoformat(),
        "programmed_value": 100000,
        "daily_goal": 5000,
    }
    r = session.post(f"{API}/projects", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create project: {r.status_code} {r.text}"
    pj = r.json()
    pid = pj.get("id") or pj.get("_id")

    mats = [
        {"item": "Poste 11m", "code": "P11", "quantity": 20, "unit": "un", "unit_cost": 500.0},
        {"item": "Cabo 35mm", "code": "C35", "quantity": 500, "unit": "m", "unit_cost": 12.0},
    ]
    for m in mats:
        rr = session.post(f"{API}/projects/{pid}/materials/add-manual", json=m, timeout=30)
        assert rr.status_code in (200, 201), rr.text

    r = session.get(f"{API}/projects/{pid}", timeout=30)
    full = r.json()
    ids = [m["id"] for m in full["materials_list"]]
    ctx = {"id": pid, "material_ids": ids, "mat_poste": ids[0], "mat_cabo": ids[1]}
    yield ctx
    try:
        session.delete(f"{API}/projects/{pid}", timeout=30)
    except Exception:
        pass


# -- Balance base fields --------------------------------------------------
def test_balance_returns_new_fields(session, project):
    r = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30)
    assert r.status_code == 200
    b = r.json()
    assert b["return_count"] == 0
    assert b["returned_qty"] == 0
    for it in b["items"]:
        assert "qty_requisitioned" in it
        assert "qty_returned" in it and it["qty_returned"] == 0
        assert "net_requisitioned" in it and it["net_requisitioned"] == 0
        assert it["saldo"] == it["qty_total"]


# -- Return with nothing in field -> 400 ---------------------------------
def test_return_400_when_nothing_in_field(session, project):
    r = session.post(
        f"{API}/projects/{project['id']}/materials/returns",
        json={"returned_by": "Joao", "reason": "sobra", "items": [{"material_id": project["mat_poste"], "qty": 1}]},
        timeout=30,
    )
    assert r.status_code == 400


def test_return_400_empty_items(session, project):
    r = session.post(f"{API}/projects/{project['id']}/materials/returns", json={"items": []}, timeout=30)
    assert r.status_code == 400


# -- Create a partial requisition so that items are "in field" -----------
def test_create_partial_requisition(session, project):
    items = json.dumps([{"id": project["mat_poste"], "qty": 10}, {"id": project["mat_cabo"], "qty": 300}])
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "T", "requisition_type": "parcial", "items": items},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    project["_req_partial"] = r.json()["requisition_id"]
    b = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    m = {i["id"]: i for i in b["items"]}
    assert m[project["mat_poste"]]["net_requisitioned"] == 10
    assert m[project["mat_cabo"]]["net_requisitioned"] == 300


# -- Return more than in-field -> 400 -------------------------------------
def test_return_400_qty_exceeds_net(session, project):
    r = session.post(
        f"{API}/projects/{project['id']}/materials/returns",
        json={"returned_by": "X", "items": [{"material_id": project["mat_poste"], "qty": 999}]},
        timeout=30,
    )
    assert r.status_code == 400


# -- Successful return: saldo goes up, qty_delivered untouched -----------
def test_return_success_updates_balance_not_delivered(session, project):
    pj_before = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    delivered_before = {m["id"]: m.get("qty_delivered", 0) for m in pj_before["materials_list"]}

    r = session.post(
        f"{API}/projects/{project['id']}/materials/returns",
        json={"date": date.today().isoformat(), "returned_by": "Almox", "reason": "sobra", "notes": "n1",
              "items": [{"material_id": project["mat_poste"], "qty": 3}, {"material_id": project["mat_cabo"], "qty": 50}]},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert "return" in body and body["return"]["id"]
    assert body["return"]["total_qty"] == 53
    assert body["return"]["registered_by"]
    project["_return_id"] = body["return"]["id"]

    # balance reflects
    b = body["balance"]
    m = {i["id"]: i for i in b["items"]}
    assert m[project["mat_poste"]]["qty_requisitioned"] == 10  # bruto
    assert m[project["mat_poste"]]["qty_returned"] == 3
    assert m[project["mat_poste"]]["net_requisitioned"] == 7
    assert m[project["mat_cabo"]]["net_requisitioned"] == 250
    assert b["return_count"] == 1
    assert b["returned_qty"] == 53

    # GET project shows material_returns AND qty_delivered unchanged
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    assert len(pj.get("material_returns", [])) == 1
    for m in pj["materials_list"]:
        assert m.get("qty_delivered", 0) == delivered_before.get(m["id"], 0)


# -- Preview partial: Ja Req shows net (bruto - devolvido) --------------
def test_preview_partial_shows_net(session, project):
    items = json.dumps([{"id": project["mat_poste"], "qty": 1}])
    r = session.post(
        f"{API}/materials/preview",
        data={"project_id": project["id"], "signature_name": "Fu", "requisition_type": "parcial", "items": items},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    txt = "".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(r.content)).pages)
    # net for poste = 7 (10 - 3)
    assert "7" in txt


# -- GET items on partial requisition ------------------------------------
def test_get_partial_req_items(session, project):
    rid = project["_req_partial"]
    r = session.get(f"{API}/projects/{project['id']}/requisitions/{rid}/items", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["fulfillment"] is None
    ids = {i["material_id"] for i in d["items"]}
    assert project["mat_poste"] in ids and project["mat_cabo"] in ids
    for i in d["items"]:
        assert i["qty_separated"] == 0 and i["qty_delivered"] == 0
        assert i["code"] and i["item"] and i["unit"]


# -- Save fulfillment: partial 2 shipments -> sum -----------------------
def test_fulfillment_partial(session, project):
    rid = project["_req_partial"]
    body = {"responsible": "Almox", "notes": "", "items": [
        {"material_id": project["mat_poste"], "qty_separated": 8, "qty_delivered": 6},
        {"material_id": project["mat_cabo"], "qty_separated": 300, "qty_delivered": 300},
    ]}
    r = session.post(f"{API}/projects/{project['id']}/requisitions/{rid}/fulfillment", json=body, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "ok"
    assert d["totals_updated"] == 2

    # materials_list totals reflect this shipment
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    m = {x["id"]: x for x in pj["materials_list"]}
    assert m[project["mat_poste"]]["qty_separated"] == 8
    assert m[project["mat_poste"]]["qty_delivered"] == 6
    assert m[project["mat_cabo"]]["qty_delivered"] == 300

    # GET items now returns fulfillment
    r2 = session.get(f"{API}/projects/{project['id']}/requisitions/{rid}/items", timeout=30).json()
    assert r2["fulfillment"] is not None
    m2 = {i["material_id"]: i for i in r2["items"]}
    assert m2[project["mat_poste"]]["qty_delivered"] == 6


# -- Fulfillment invalid ids -> 400 --------------------------------------
def test_fulfillment_400_no_valid_ids(session, project):
    rid = project["_req_partial"]
    r = session.post(
        f"{API}/projects/{project['id']}/requisitions/{rid}/fulfillment",
        json={"items": [{"material_id": "nonexistent_xxx", "qty_separated": 1, "qty_delivered": 1}]},
        timeout=30,
    )
    assert r.status_code == 400


# -- Fulfillment on resend -> 400 ----------------------------------------
def test_fulfillment_resend_400(session, project):
    rid = project["_req_partial"]
    r = session.post(f"{API}/projects/{project['id']}/requisitions/{rid}/resend", timeout=60)
    assert r.status_code == 200
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    resend = [x for x in pj["material_requisitions"] if x.get("is_resend")][-1]
    r2 = session.post(
        f"{API}/projects/{project['id']}/requisitions/{resend['id']}/fulfillment",
        json={"items": [{"material_id": project["mat_poste"], "qty_separated": 1, "qty_delivered": 1}]},
        timeout=30,
    )
    assert r2.status_code == 400


# -- Total requisition: GET items reads from snapshot -------------------
def test_total_requisition_items_and_fulfillment_sum(session, project):
    r = session.post(
        f"{API}/materials/request",
        data={"project_id": project["id"], "signature_name": "Total"},
        timeout=60,
    )
    assert r.status_code == 200
    total_rid = r.json()["requisition_id"]

    ri = session.get(f"{API}/projects/{project['id']}/requisitions/{total_rid}/items", timeout=30)
    assert ri.status_code == 200
    d = ri.json()
    ids = {i["material_id"] for i in d["items"]}
    assert project["mat_poste"] in ids and project["mat_cabo"] in ids

    # Register fulfillment on the total shipment
    body = {"responsible": "A", "items": [
        {"material_id": project["mat_poste"], "qty_separated": 5, "qty_delivered": 4},
        {"material_id": project["mat_cabo"], "qty_separated": 100, "qty_delivered": 100},
    ]}
    r2 = session.post(f"{API}/projects/{project['id']}/requisitions/{total_rid}/fulfillment", json=body, timeout=30)
    assert r2.status_code == 200

    # materials_list totals = SUM of partial (test_fulfillment_partial) + total
    pj = session.get(f"{API}/projects/{project['id']}", timeout=30).json()
    m = {x["id"]: x for x in pj["materials_list"]}
    assert m[project["mat_poste"]]["qty_separated"] == 13   # 8 + 5
    assert m[project["mat_poste"]]["qty_delivered"] == 10   # 6 + 4
    assert m[project["mat_cabo"]]["qty_delivered"] == 400   # 300 + 100


# -- Delete return: saldo restores ---------------------------------------
def test_delete_return_restores_balance(session, project):
    b_before = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    rid = project["_return_id"]
    r = session.delete(f"{API}/projects/{project['id']}/materials/returns/{rid}", timeout=30)
    assert r.status_code == 200
    b_after = session.get(f"{API}/projects/{project['id']}/materials/requisition-balance", timeout=30).json()
    assert b_after["return_count"] == b_before["return_count"] - 1
    assert b_after["returned_qty"] < b_before["returned_qty"]
    m = {i["id"]: i for i in b_after["items"]}
    assert m[project["mat_poste"]]["qty_returned"] == 0
    # after partial (10) + total (20 full) = 30 gross; net = 30 after delete
    assert m[project["mat_poste"]]["net_requisitioned"] == 30
