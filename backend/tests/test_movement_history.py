"""
Iteration 23 - Movement history + team_splits + billing pipeline (actual_value) regression tests.
Covers P0/P1 features:
 1) POST /api/projects with team_splits persists + movement_history[0]=created
 2) PUT /api/projects/{id} generates movement entries per changed field group
 3) PUT /api/projects/{id}/billing-stage appends billing_stage_changed movement
 4) GET /api/faturamento/pipeline uses actual_value + returns programmed_value alongside
 5) GET /api/faturamento/backlog-alerts.total_value uses actual_value
"""
import os
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PASS = "Admin@123"

TEAM_A = "6a625e11592149428e288fbe"
TEAM_B = "6a625e21592149428e288fbf"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    if r.status_code != 200:
        pytest.skip(f"Login failed: {r.status_code} {r.text[:200]}")
    tok = r.json().get("token") or r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def created_project(client):
    """Create a project with team_splits and yield its id + response payload. Cleanup after."""
    payload = {
        "name": "TEST_mov_history_project",
        "project_code": f"TEST_MOV_{int(datetime.now().timestamp())}",
        "programmed_value": 10000.0,
        "actual_value": 0.0,
        "execution_status": "programado",
        "is_scheduled": True,
        "start_date": "2026-01-15",
        "end_date": "2026-01-20",
        "team_id": TEAM_A,
        "team_name": "Equipe 1",
        "team_splits": [
            {"team_id": TEAM_A, "team_name": "Equipe 1", "programmed_value": 6000.0, "actual_value": 0.0},
            {"team_id": TEAM_B, "team_name": "Equipe 2", "programmed_value": 4000.0, "actual_value": 0.0},
        ],
    }
    r = client.post(f"{BASE_URL}/api/projects", json=payload, timeout=20)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text[:400]}"
    data = r.json()
    pid = data["id"]
    yield pid, data
    # Cleanup
    client.delete(f"{BASE_URL}/api/projects/{pid}", timeout=15)


class TestCreateWithTeamSplits:
    def test_team_splits_persisted(self, created_project):
        pid, data = created_project
        assert isinstance(data.get("team_splits"), list) and len(data["team_splits"]) == 2
        assert data["team_splits"][0]["team_id"] == TEAM_A
        assert data["team_splits"][0]["programmed_value"] == 6000.0
        assert data["team_splits"][1]["team_id"] == TEAM_B
        assert data["team_splits"][1]["programmed_value"] == 4000.0

    def test_movement_history_created_event(self, created_project):
        pid, data = created_project
        mh = data.get("movement_history") or []
        assert len(mh) >= 1, "movement_history must have >=1 entry after create"
        assert mh[0]["event_type"] == "created"
        assert "changed_at" in mh[0] and "new" in mh[0]

    def test_get_project_returns_team_splits(self, client, created_project):
        pid, _ = created_project
        r = client.get(f"{BASE_URL}/api/projects", timeout=15)
        assert r.status_code == 200
        found = next((p for p in r.json() if p["id"] == pid), None)
        assert found is not None
        assert len(found["team_splits"]) == 2


class TestUpdateGeneratesMovements:
    def test_multi_field_update_appends_movements(self, client, created_project):
        pid, initial = created_project
        initial_len = len(initial.get("movement_history") or [])
        payload = {
            "execution_status": "em_andamento",  # status_changed
            "team_id": TEAM_B,                    # team_changed
            "team_name": "Equipe 2",
            "shutdown_info": "desligamento programado 08h-12h",  # shutdown_info
            "team_splits": [                                     # team_splits_changed
                {"team_id": TEAM_A, "team_name": "Equipe 1", "programmed_value": 6000.0, "actual_value": 3000.0},
                {"team_id": TEAM_B, "team_name": "Equipe 2", "programmed_value": 4000.0, "actual_value": 2000.0},
            ],
        }
        r = client.put(f"{BASE_URL}/api/projects/{pid}", json=payload, timeout=20)
        assert r.status_code == 200, f"update failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        mh = data.get("movement_history") or []
        added = len(mh) - initial_len
        assert added == 4, f"expected 4 new movements got {added} (total={len(mh)}); types={[m.get('event_type') for m in mh]}"
        types = [m["event_type"] for m in mh[-4:]]
        for expected in ("status_changed", "team_changed", "shutdown_info", "team_splits_changed"):
            assert expected in types, f"missing movement {expected} in {types}"


class TestBillingStageMovement:
    def test_billing_stage_appends_movement(self, client, created_project):
        pid, _ = created_project
        # First need billing_stage set — set it directly
        r = client.put(f"{BASE_URL}/api/projects/{pid}/billing-stage",
                       json={"stage": "recebimento_tecnico", "notes": "TEST init"}, timeout=15)
        assert r.status_code == 200, r.text[:300]
        before = r.json().get("movement_history") or []
        prev_len = len(before)
        # Change stage
        r2 = client.put(f"{BASE_URL}/api/projects/{pid}/billing-stage",
                        json={"stage": "em_fechamento", "notes": "TEST advance"}, timeout=15)
        assert r2.status_code == 200
        mh = r2.json().get("movement_history") or []
        assert len(mh) == prev_len + 1
        last = mh[-1]
        assert last["event_type"] == "billing_stage_changed"
        assert last["old"] == "recebimento_tecnico"
        assert last["new"] == "em_fechamento"


class TestFaturamentoPipelineActualValue:
    def test_pipeline_returns_actual_and_programmed(self, client, created_project):
        pid, _ = created_project
        # Update the project so actual_value != programmed_value to verify totals use actual
        client.put(f"{BASE_URL}/api/projects/{pid}", json={"actual_value": 8000.0}, timeout=15)
        r = client.get(f"{BASE_URL}/api/faturamento/pipeline", timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        # find our project in em_fechamento stage
        item = None
        for stage_items in body["pipeline"].values():
            for it in stage_items:
                if it["id"] == pid:
                    item = it
                    break
        assert item is not None, "created project must appear in pipeline"
        assert "actual_value" in item and "programmed_value" in item
        assert item["actual_value"] == 8000.0
        assert item["programmed_value"] == 10000.0

    def test_totals_use_actual_value(self, client, created_project):
        r = client.get(f"{BASE_URL}/api/faturamento/pipeline", timeout=20)
        body = r.json()
        # sum all items' actual_value should equal totals.value
        total_actual = 0.0
        for items in body["pipeline"].values():
            for it in items:
                total_actual += float(it.get("actual_value") or 0)
        assert abs(body["totals"]["value"] - total_actual) < 0.01, (
            f"totals.value ({body['totals']['value']}) should equal sum(actual_value)={total_actual}"
        )
        # backlog + paid = totals.value
        assert abs(body["backlog_value"] + body["paid_value"] - body["totals"]["value"]) < 0.01

    def test_stuck_projects_have_both_values(self, client):
        r = client.get(f"{BASE_URL}/api/faturamento/pipeline", timeout=20)
        stuck = r.json().get("stuck_projects", [])
        for s in stuck:
            assert "actual_value" in s
            assert "programmed_value" in s


class TestBacklogAlertsActualValue:
    def test_backlog_alerts_total_value_uses_actual(self, client):
        r = client.get(f"{BASE_URL}/api/faturamento/backlog-alerts", timeout=20)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "total_value" in body
        items = body.get("stuck_projects") or body.get("items") or []
        expected = sum(
            (s.get("actual_value") or s.get("programmed_value") or 0)
            for s in items
        )
        assert abs(body["total_value"] - expected) < 0.01
