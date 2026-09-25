"""Iteration 36 (Set/2026) — Sucata + Linha Viva por data + Avanço PDF/materiais"""
import os
from datetime import date, timedelta
from zoneinfo import ZoneInfo
from datetime import datetime

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN = {"email": "lucasc.cuiaba02@gmail.com", "password": "Hayah$152610"}
PROJ_ID = "6aade9e554f9f5aa51348a8d"  # CAMPO-LV-01 (22 photos, 1 requisition)


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


# =====================================================================
# SUCATA (backend)
# =====================================================================
class TestSucata:
    _created_ids: list = []

    def test_01_list_returns_enums(self, admin):
        r = admin.get(f"{BASE_URL}/api/sucata", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "reasons" in data and "destinations" in data
        assert set(data["reasons"].keys()) >= {"retirado_rede", "danificado", "sobra_inservivel", "outro"}
        assert set(data["destinations"].keys()) >= {"venda", "descarte", "devolucao_concessionaria", "reaproveitamento"}

    def test_02_create_missing_description(self, admin):
        r = admin.post(f"{BASE_URL}/api/sucata", json={"description": "  "}, timeout=30)
        assert r.status_code == 400

    def test_03_create_item(self, admin):
        payload = {"code": "TEST_36_CABO", "description": "TEST_iter36 Cabo Al 2 AWG",
                   "unit": "kg", "family": "cabos", "kg_value": 18.5}
        r = admin.post(f"{BASE_URL}/api/sucata", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["description"] == payload["description"]
        assert d["unit"] == "KG"
        assert d["kg_value"] == 18.5
        assert d["qty"] == 0 and d["weight_kg"] == 0
        assert d["estimated_value"] == 0
        TestSucata._created_ids.append(d["id"])

    def test_04_entrada_movement(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "entrada", "qty": 120, "weight_kg": 36,
                "date": date.today().isoformat(), "project_code": "TEST-OBRA",
                "team_name": "TEST-EQ", "reason": "retirado_rede", "responsible": "TEST Resp"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 200, r.text[:300]
        item = r.json()["item"]
        assert item["qty"] == 120
        assert item["weight_kg"] == 36
        # kg_value=18.5 → 36*18.5 = 666
        assert item["estimated_value"] == 666.0

    def test_05_entrada_invalid_reason(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "entrada", "qty": 1, "reason": "invalid_reason"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 400

    def test_06_bad_type(self, admin):
        item_id = TestSucata._created_ids[0]
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements",
                       json={"type": "xxx", "qty": 1}, timeout=30)
        assert r.status_code == 400

    def test_07_zero_qty_and_weight(self, admin):
        item_id = TestSucata._created_ids[0]
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements",
                       json={"type": "entrada", "qty": 0, "weight_kg": 0}, timeout=30)
        assert r.status_code == 400

    def test_08_saida_invalid_destination(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "saida", "qty": 1, "destination": "not_valid"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 400

    def test_09_saida_exceeding_balance(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "saida", "qty": 500, "destination": "venda"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 400
        assert "Saída" in r.text or "saldo" in r.text.lower()

    def test_10_saida_kg_exceeding(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "saida", "weight_kg": 999, "destination": "descarte"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 400

    def test_11_saida_ok(self, admin):
        item_id = TestSucata._created_ids[0]
        body = {"type": "saida", "qty": 50, "weight_kg": 15,
                "destination": "venda", "value": 250,
                "date": date.today().isoformat(), "responsible": "TEST Resp"}
        r = admin.post(f"{BASE_URL}/api/sucata/{item_id}/movements", json=body, timeout=30)
        assert r.status_code == 200, r.text[:300]
        item = r.json()["item"]
        assert item["qty"] == 70
        assert item["weight_kg"] == 21
        assert item["estimated_value"] == 388.5  # 21 * 18.5
        assert item["sold_value"] == 250.0

    def test_12_kpis(self, admin):
        r = admin.get(f"{BASE_URL}/api/sucata/kpis", timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("items", "items_with_balance", "qty_total", "kg_total",
                  "estimated_value", "sold_value", "entries_month",
                  "exits_month", "kg_in_month", "by_reason"):
            assert k in d, f"missing kpi key {k}"
        assert d["items"] >= 1
        assert d["sold_value"] >= 250.0
        assert d["entries_month"] >= 1
        assert d["exits_month"] >= 1
        assert d["by_reason"]["retirado_rede"] >= 36.0

    def test_13_filter_only_balance_and_reason(self, admin):
        r = admin.get(f"{BASE_URL}/api/sucata", params={"only_balance": 1, "reason": "retirado_rede"}, timeout=30)
        assert r.status_code == 200
        ids = [i["id"] for i in r.json()["items"]]
        assert TestSucata._created_ids[0] in ids

    def test_14_search_q(self, admin):
        r = admin.get(f"{BASE_URL}/api/sucata", params={"q": "TEST_iter36"}, timeout=30)
        assert r.status_code == 200
        assert any(i["id"] == TestSucata._created_ids[0] for i in r.json()["items"])

    def test_15_patch_update(self, admin):
        item_id = TestSucata._created_ids[0]
        r = admin.patch(f"{BASE_URL}/api/sucata/{item_id}",
                        json={"family": "CABOS_ALUM"}, timeout=30)
        assert r.status_code == 200
        assert r.json()["family"] == "CABOS_ALUM"

    def test_16_export_csv(self, admin):
        r = admin.get(f"{BASE_URL}/api/sucata/export", timeout=30)
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        body = r.content
        assert body.startswith(b"\xef\xbb\xbf"), "missing UTF-8 BOM"
        txt = body.decode("utf-8")
        assert ";" in txt
        assert "MOVIMENTAÇÕES" in txt
        assert "TEST_iter36" in txt

    def test_17_delete_movement(self, admin):
        item_id = TestSucata._created_ids[0]
        r = admin.get(f"{BASE_URL}/api/sucata", timeout=30)
        movs = next(i for i in r.json()["items"] if i["id"] == item_id)["movements"]
        # find the "saida" mov
        saida = next(m for m in movs if m.get("type") == "saida")
        r2 = admin.delete(f"{BASE_URL}/api/sucata/{item_id}/movements/{saida['id']}", timeout=30)
        assert r2.status_code == 200
        item = r2.json()["item"]
        assert item["qty"] == 120  # back to full entrada
        assert item["sold_value"] == 0

    def test_18_cleanup_delete_item(self, admin):
        for iid in TestSucata._created_ids:
            r = admin.delete(f"{BASE_URL}/api/sucata/{iid}", timeout=30)
            assert r.status_code == 200
        # verify gone
        r = admin.get(f"{BASE_URL}/api/sucata", timeout=30)
        ids = [i["id"] for i in r.json()["items"]]
        for iid in TestSucata._created_ids:
            assert iid not in ids


# =====================================================================
# LINHA VIVA POR DATA
# =====================================================================
class TestLinhaVivaPorData:
    _proj_id: str = ""
    _hoje: str = ""
    _amanha: str = ""

    def test_01_setup_project(self, admin):
        cuiaba_today = datetime.now(ZoneInfo("America/Cuiaba")).date()
        TestLinhaVivaPorData._hoje = cuiaba_today.isoformat()
        TestLinhaVivaPorData._amanha = (cuiaba_today + timedelta(days=1)).isoformat()
        # get a team id
        rt = admin.get(f"{BASE_URL}/api/teams", timeout=30)
        assert rt.status_code == 200
        teams = rt.json()
        assert teams, "need at least one team"
        team = teams[0]
        team_id = team.get("id") or team.get("_id")
        team_name = team.get("name", "")

        payload = {
            "name": "TEST_iter36 LV Projeto",
            "project_code": "TEST-LV-36",
            "team_name": team_name,
            "team_id": team_id,
            "programmed_value": 1000,
            "is_scheduled": True,
            "requires_hot_line": True,
            "hot_line_dates": [TestLinhaVivaPorData._amanha],
            "schedule_entries": [
                {"date": TestLinhaVivaPorData._hoje, "team_names": [team_name], "team_ids": [team_id]},
                {"date": TestLinhaVivaPorData._amanha, "team_names": [team_name], "team_ids": [team_id]},
            ],
            "start_date": TestLinhaVivaPorData._hoje,
            "execution_status": "programado",
        }
        r = admin.post(f"{BASE_URL}/api/projects", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text[:400]
        d = r.json()
        TestLinhaVivaPorData._proj_id = d.get("id") or d.get("_id")
        assert TestLinhaVivaPorData._proj_id

    def test_02_get_project_persists_dates(self, admin):
        r = admin.get(f"{BASE_URL}/api/projects/{TestLinhaVivaPorData._proj_id}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("hot_line_dates") == [TestLinhaVivaPorData._amanha]
        assert d.get("requires_hot_line") is True

    def test_03_operacional_hot_line_false_when_not_today(self, admin):
        r = admin.get(f"{BASE_URL}/api/operacional/today", timeout=30)
        assert r.status_code == 200
        d = r.json()
        found = None
        for team_name, projects in (d.get("by_team") or {}).items():
            for p in projects:
                if p.get("id") == TestLinhaVivaPorData._proj_id:
                    found = p
                    break
            if found:
                break
        assert found is not None, "test project not in operacional today"
        assert found.get("hot_line_today") is False

    def test_04_update_to_today_and_verify_true(self, admin):
        r = admin.put(f"{BASE_URL}/api/projects/{TestLinhaVivaPorData._proj_id}",
                      json={"requires_hot_line": True,
                            "hot_line_dates": [TestLinhaVivaPorData._hoje]}, timeout=30)
        assert r.status_code == 200, r.text[:400]
        r2 = admin.get(f"{BASE_URL}/api/projects/{TestLinhaVivaPorData._proj_id}", timeout=30)
        assert r2.json().get("hot_line_dates") == [TestLinhaVivaPorData._hoje]

        r3 = admin.get(f"{BASE_URL}/api/operacional/today", timeout=30)
        d = r3.json()
        found = None
        for _team, projects in (d.get("by_team") or {}).items():
            for p in projects:
                if p.get("id") == TestLinhaVivaPorData._proj_id:
                    found = p; break
            if found: break
        assert found is not None
        assert found.get("hot_line_today") is True

    def test_05_campo_hoje_respects_hot_line_dates(self, admin):
        # admin: allowed=None → sees all today's projects
        r = admin.get(f"{BASE_URL}/api/campo/hoje", timeout=30)
        assert r.status_code == 200
        d = r.json()
        proj = next((p for p in d.get("projects", []) if p["id"] == TestLinhaVivaPorData._proj_id), None)
        assert proj is not None, "test project not in campo/hoje"
        assert proj.get("hot_line_today") is True

    def test_06_cleanup(self, admin):
        if TestLinhaVivaPorData._proj_id:
            r = admin.delete(f"{BASE_URL}/api/projects/{TestLinhaVivaPorData._proj_id}", timeout=30)
            assert r.status_code in (200, 204)


# =====================================================================
# AVANÇO FÍSICO — materials + PDF
# =====================================================================
class TestAvanco:
    def test_01_photos_catalog_22(self, admin):
        r = admin.get(f"{BASE_URL}/api/projects/{PROJ_ID}/avanco/photos", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert len(d["photos"]) == 22, f"expected 22 photos, got {len(d['photos'])}"
        TestAvanco.photo_ids = [p["id"] for p in d["photos"]]

    def test_02_materials_from_requisicoes(self, admin):
        r = admin.get(f"{BASE_URL}/api/projects/{PROJ_ID}/avanco", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["summary"]["materials"]["source"] == "requisicoes"
        assert len(d["materials"]) == 2
        for m in d["materials"]:
            for k in ("qty_list", "qty_requisitioned", "qty_delivered", "qty_applied", "saldo_requisitar"):
                assert k in m

    def test_03_pdf_all_22_photos(self, admin):
        ids = ",".join(TestAvanco.photo_ids)
        r = admin.get(f"{BASE_URL}/api/projects/{PROJ_ID}/avanco/pdf",
                      params={"photo_ids": ids}, timeout=120)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.headers.get("X-Photos-Included") == "22"
        assert r.headers.get("X-Photos-Skipped") == "0"
        assert len(r.content) > 1_000_000, f"pdf too small: {len(r.content)} bytes"

    def test_04_pdf_none(self, admin):
        r = admin.get(f"{BASE_URL}/api/projects/{PROJ_ID}/avanco/pdf",
                      params={"photo_ids": "none"}, timeout=60)
        assert r.status_code == 200
        assert r.headers.get("X-Photos-Included") == "0"
