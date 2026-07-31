"""Iteration 15 tests — Faturamento pipeline (esteira financeira):
- Auto-transition on execution_status=concluido → billing_stage=recebimento_tecnico
- PUT /api/projects/{id}/billing-stage advances through all 8 stages
- Invoice fields (invoice_number/date/value) persist
- GET /api/faturamento/pipeline returns pipeline grouped by stage + backlog_value/paid_value
- Date filter start_date/end_date works
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASSWORD = "Admin@123"

BILLING_STAGES = [
    "recebimento_tecnico",
    "em_fechamento",
    "ajuste_material",
    "pendencia_construtiva",
    "aguardando_fiscalizacao",
    "aprovada",
    "digitada",
    "pago",
]


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def team_id(admin_session):
    r = admin_session.post(f"{BASE_URL}/api/teams", json={"name": "TEST_iter15_team", "members": ["m1"], "supervisor": "S"})
    assert r.status_code == 200
    tid = r.json()["id"]
    yield tid, r.json()["name"]
    admin_session.delete(f"{BASE_URL}/api/teams/{tid}")


@pytest.fixture
def project_concluded(admin_session, team_id):
    tid, tname = team_id
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = {
        "name": "TEST_iter15_billing",
        "project_code": f"TESTIT15-{uuid.uuid4().hex[:8]}",
        "team_id": tid,
        "team_name": tname,
        "start_date": today,
        "end_date": today,
        "programmed_value": 12345.67,
    }
    r = admin_session.post(f"{BASE_URL}/api/projects", json=payload)
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    # Mark concluido → auto-transition
    ru = admin_session.put(f"{BASE_URL}/api/projects/{pid}", json={"execution_status": "concluido"})
    assert ru.status_code == 200, ru.text
    yield pid
    admin_session.delete(f"{BASE_URL}/api/projects/{pid}")


class TestBillingAutoTransition:
    def test_concluido_moves_to_recebimento_tecnico(self, admin_session, project_concluded):
        r = admin_session.get(f"{BASE_URL}/api/projects/{project_concluded}")
        assert r.status_code == 200
        p = r.json()
        assert p.get("billing_stage") == "recebimento_tecnico", f"Expected recebimento_tecnico, got {p.get('billing_stage')}"
        # Verify history entry exists
        hist = p.get("billing_history") or []
        assert any(h.get("stage") == "recebimento_tecnico" for h in hist), "No billing_history entry"


class TestBillingStageAdvance:
    def test_advance_through_all_stages_and_invoice_persist(self, admin_session, project_concluded):
        pid = project_concluded
        # From recebimento_tecnico advance forward through all stages
        for i, stage in enumerate(BILLING_STAGES[1:], start=1):
            body = {"stage": stage, "notes": f"move to {stage}"}
            # Add invoice fields at aprovada
            if stage == "aprovada":
                body["invoice_number"] = "NF-2026-001"
                body["invoice_date"] = "2026-01-15"
                body["invoice_value"] = 12000.00
            r = admin_session.put(f"{BASE_URL}/api/projects/{pid}/billing-stage", json=body)
            assert r.status_code == 200, f"Failed at {stage}: {r.status_code} {r.text}"
            p = r.json()
            assert p.get("billing_stage") == stage
        # Verify persistence via GET
        r = admin_session.get(f"{BASE_URL}/api/projects/{pid}")
        p = r.json()
        assert p.get("billing_stage") == "pago"
        assert p.get("invoice_number") == "NF-2026-001"
        assert p.get("invoice_date") == "2026-01-15"
        assert float(p.get("invoice_value") or 0) == 12000.00

    def test_invalid_stage_returns_400(self, admin_session, project_concluded):
        r = admin_session.put(f"{BASE_URL}/api/projects/{project_concluded}/billing-stage",
                              json={"stage": "invalid_stage_x"})
        assert r.status_code == 400


class TestPipelineEndpoint:
    def test_pipeline_shape_and_grouping(self, admin_session, project_concluded):
        # project_concluded is at recebimento_tecnico
        r = admin_session.get(f"{BASE_URL}/api/faturamento/pipeline")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pipeline" in data
        assert "stages" in data
        assert "totals" in data
        assert "backlog_value" in data
        assert "paid_value" in data
        # All 8 stages present as keys
        for s in BILLING_STAGES:
            assert s in data["pipeline"], f"Missing stage {s}"
        # stages list has 8 entries with key+label
        assert len(data["stages"]) == 8
        assert all("key" in s and "label" in s for s in data["stages"])
        # Our project is in recebimento_tecnico
        ids_rt = [x["id"] for x in data["pipeline"]["recebimento_tecnico"]]
        assert project_concluded in ids_rt, f"Project not in recebimento_tecnico: {ids_rt}"
        # totals count > 0
        assert data["totals"]["count"] >= 1

    def test_pipeline_backlog_and_paid_split(self, admin_session, team_id):
        tid, tname = team_id
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Create 2 projects, move one to pago, keep other in recebimento_tecnico
        pids = []
        for i in range(2):
            r = admin_session.post(f"{BASE_URL}/api/projects", json={
                "name": f"TEST_iter15_split_{i}",
                "project_code": f"TESTSPLIT15-{i}-{uuid.uuid4().hex[:8]}",
                "team_id": tid, "team_name": tname,
                "start_date": today, "end_date": today,
                "programmed_value": 1000.0,
            })
            assert r.status_code == 200
            pid = r.json()["id"]
            pids.append(pid)
            admin_session.put(f"{BASE_URL}/api/projects/{pid}", json={"execution_status": "concluido"})
        # Move second one all the way to pago
        for s in BILLING_STAGES[1:]:
            admin_session.put(f"{BASE_URL}/api/projects/{pids[1]}/billing-stage", json={"stage": s})

        r = admin_session.get(f"{BASE_URL}/api/faturamento/pipeline")
        d = r.json()
        # backlog should include our first project's value (1000)
        assert d["backlog_value"] >= 1000.0
        assert d["paid_value"] >= 1000.0

        # cleanup
        for p in pids:
            admin_session.delete(f"{BASE_URL}/api/projects/{p}")

    def test_pipeline_date_filter(self, admin_session):
        # Far-future date should yield zero
        r = admin_session.get(f"{BASE_URL}/api/faturamento/pipeline",
                              params={"start_date": "2099-01-01", "end_date": "2099-12-31"})
        assert r.status_code == 200
        d = r.json()
        assert d["totals"]["count"] == 0
        for s in BILLING_STAGES:
            assert d["pipeline"][s] == []
