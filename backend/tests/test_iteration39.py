"""Iteration 39 — Medições parciais numeradas (fechar / reabrir / acumulado / PDF por medição)."""
import os
import pytest
import requests
import pymupdf

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"


# ── Fixtures ─────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def catalog(h):
    r = requests.get(f"{BASE_URL}/api/medicao/catalogo", headers=h)
    assert r.status_code == 200
    items = r.json().get("items") or []
    if len(items) < 2:
        pytest.skip("Catalog needs >=2 items")
    return items


def _new_project(h, code):
    for p in requests.get(f"{BASE_URL}/api/projects", headers=h).json() or []:
        if p.get("project_code") == code:
            requests.delete(f"{BASE_URL}/api/projects/{p.get('id') or p.get('_id')}", headers=h)
    r = requests.post(f"{BASE_URL}/api/projects", headers=h, json={"project_code": code, "name": f"TEST {code}", "project_type": "manutencao"})
    assert r.status_code in (200, 201), r.text
    return r.json().get("id") or r.json().get("_id")


def _line_from_cat(c, qty):
    return {"catalog_id": c["id"], "code": c["code"], "description": c["description"],
            "unit": c["unit"], "unit_price": c["unit_price"], "qty": qty, "group": c.get("group", "")}


@pytest.fixture
def pid(h):
    pid = _new_project(h, "TEST-MED-ITER39")
    yield pid
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=h)


# ── Detail shape ─────────────────────────────────────────────────────────
class TestDetail:
    def test_detail_shape_empty(self, h, pid):
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/medicao", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert d["medicoes"] == []
        assert d["next_number"] == 1
        t = d["totals"]
        assert t["fechado"] == 0 and t["em_aberto"] == 0 and t["realizado"] == 0
        assert t["medicoes_count"] == 0


# ── Fechar / reabrir / acumulado ─────────────────────────────────────────
class TestFecharReabrir:
    def test_fechar_vazio(self, h, pid):
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": ""})
        assert r.status_code == 400
        assert "em aberto" in r.json()["detail"]

    def test_fechar_periodo_invalido(self, h, pid, catalog):
        items = [_line_from_cat(catalog[0], 2)]
        r = requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items})
        assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-09-30", "period_to": "2026-09-01", "notes": ""})
        assert r.status_code == 400
        assert "Período" in r.json()["detail"] or "inválido" in r.json()["detail"]

    def test_full_flow(self, h, pid, catalog):
        # 1ª medição
        items1 = [_line_from_cat(catalog[0], 3)]
        total1 = round(items1[0]["qty"] * items1[0]["unit_price"], 2)
        r = requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        assert r.status_code == 200
        proj = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=h).json()
        # actual_value should equal draft (no fechadas yet)
        assert abs(float(proj["actual_value"]) - total1) < 0.01

        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": "primeira medição"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["fechada"]["number"] == 1
        assert d["fechada"]["period"] == "01/09/2026 a 30/09/2026"
        assert d["measured"] == []
        assert d["next_number"] == 2
        assert abs(d["totals"]["fechado"] - total1) < 0.01
        assert d["totals"]["em_aberto"] == 0
        proj = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=h).json()
        assert abs(float(proj["actual_value"]) - total1) < 0.01
        # movement_history recebeu evento
        mh = proj.get("movement_history") or []
        assert any(e.get("event") == "medicao_fechada" for e in mh)

        m1_id = d["medicoes"][0]["id"]

        # 2ª medição
        items2 = [_line_from_cat(catalog[1], 2)]
        total2 = round(items2[0]["qty"] * items2[0]["unit_price"], 2)
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items2})
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-10-01", "period_to": "2026-10-31", "notes": ""})
        assert r.status_code == 200
        d2 = r.json()
        assert d2["fechada"]["number"] == 2
        assert d2["next_number"] == 3
        assert abs(d2["totals"]["fechado"] - (total1 + total2)) < 0.01
        proj = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=h).json()
        assert abs(float(proj["actual_value"]) - (total1 + total2)) < 0.01

        # reabrir última: ok
        m2_id = d2["medicoes"][-1]["id"]
        # not-last fails
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/{m1_id}/reabrir", headers=h)
        assert r.status_code == 400
        assert "última" in r.json()["detail"]

        # inexistente
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/xxxxx/reabrir", headers=h)
        assert r.status_code == 404

        # reabrir última
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/{m2_id}/reabrir", headers=h)
        assert r.status_code == 200
        d3 = r.json()
        assert d3["next_number"] == 2
        assert len(d3["measured"]) == 1
        assert abs(d3["totals"]["fechado"] - total1) < 0.01
        assert abs(d3["totals"]["em_aberto"] - total2) < 0.01
        assert abs(d3["totals"]["realizado"] - (total1 + total2)) < 0.01
        proj = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=h).json()
        assert abs(float(proj["actual_value"]) - (total1 + total2)) < 0.01

        # tentar reabrir com rascunho em aberto cheio → 400
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/{m1_id}/reabrir", headers=h)
        assert r.status_code == 400

    def test_copy_budget_includes_fechado(self, h, pid, catalog):
        # feche 1 medição
        items1 = [_line_from_cat(catalog[0], 1)]
        total1 = round(items1[0]["qty"] * items1[0]["unit_price"], 2)
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                      json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": ""})
        # orcado
        items_b = [_line_from_cat(catalog[1], 2)]
        total_b = round(items_b[0]["qty"] * items_b[0]["unit_price"], 2)
        r = requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/orcado", headers=h, json={"items": items_b})
        assert r.status_code == 200
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/realizado/from-orcado", headers=h)
        assert r.status_code == 200
        proj = requests.get(f"{BASE_URL}/api/projects/{pid}", headers=h).json()
        assert abs(float(proj["actual_value"]) - (total1 + total_b)) < 0.01


# ── PDF por medição ──────────────────────────────────────────────────────
class TestPdfMedicao:
    def test_pdf_closed_and_draft(self, h, pid, catalog):
        items1 = [_line_from_cat(catalog[0], 2)]
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": "obs1"})
        mid = r.json()["medicoes"][0]["id"]
        number = r.json()["fechada"]["number"]
        total1 = r.json()["fechada"]["total"]

        # PDF da medição fechada
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/medicao/pdf", headers=h, params={"medicao_id": mid})
        assert r.status_code == 200
        cd = r.headers.get("content-disposition", "")
        assert f"_med{number:02d}_" in cd
        doc = pymupdf.open(stream=r.content, filetype="pdf")
        text = "\n".join(p.get_text() for p in doc).upper()
        doc.close()
        assert "MEDIÇÃO Nº 1" in text or "MEDICAO Nº 1" in text or "N° 1" in text or "Nº 1" in text
        assert "ACUMULADO" in text
        assert "01/09/2026" in text or "30/09/2026" in text

        # inexistente
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/medicao/pdf", headers=h, params={"medicao_id": "nope"})
        assert r.status_code == 404

        # Rascunho com medições fechadas
        items2 = [_line_from_cat(catalog[1], 1)]
        total2 = round(items2[0]["qty"] * items2[0]["unit_price"], 2)
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items2})
        r = requests.get(f"{BASE_URL}/api/projects/{pid}/medicao/pdf", headers=h)
        assert r.status_code == 200
        doc = pymupdf.open(stream=r.content, filetype="pdf")
        text = "\n".join(p.get_text() for p in doc)
        doc.close()
        up = text.upper()
        assert "Nº 2" in text or "N° 2" in up or "MEDIÇÃO Nº 2" in up
        assert "aberto" in text.lower() or "ABERTO" in up


# ── Envio com medicao_id ─────────────────────────────────────────────────
class TestEnvio:
    def test_envio_medicao_id_skipped(self, h, pid, catalog):
        items1 = [_line_from_cat(catalog[0], 1)]
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                          json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": ""})
        mid = r.json()["medicoes"][0]["id"]

        body = {"recipients": ["delivered@resend.dev"], "message": "", "notes": "obs", "period": "", "number": "",
                "copy_me": False, "save_fiscais": False, "medicao_id": mid}
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/enviar", headers=h, json=body)
        assert r.status_code == 503
        # verify envios registry
        d = requests.get(f"{BASE_URL}/api/projects/{pid}/medicao", headers=h).json()
        envios = d["envios"]
        assert len(envios) >= 1
        latest = envios[0]
        assert latest.get("medicao_id") == mid
        assert latest.get("number") == "1"
        assert "01/09/2026" in (latest.get("period") or "")
        assert latest.get("status") == "skipped"
        # medicoes[0].envios == 1
        assert d["medicoes"][0]["envios"] == 1

    def test_envio_sem_medicao_id_rascunho_vazio(self, h, pid, catalog):
        # feche uma, rascunho vazio
        items1 = [_line_from_cat(catalog[0], 1)]
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                      json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": ""})
        body = {"recipients": ["delivered@resend.dev"], "copy_me": False, "save_fiscais": False}
        r = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/enviar", headers=h, json=body)
        assert r.status_code == 400
        assert "Lance e salve" in r.json()["detail"]


# ── /api/medicao/projects aggregates ─────────────────────────────────────
class TestMedicaoProjects:
    def test_fields(self, h, pid, catalog):
        items1 = [_line_from_cat(catalog[0], 2)]
        total1 = round(items1[0]["qty"] * items1[0]["unit_price"], 2)
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items1})
        requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/fechar", headers=h,
                      json={"period_from": "2026-09-01", "period_to": "2026-09-30", "notes": ""})
        # add rascunho
        items2 = [_line_from_cat(catalog[1], 1)]
        total2 = round(items2[0]["qty"] * items2[0]["unit_price"], 2)
        requests.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", headers=h, json={"items": items2})

        r = requests.get(f"{BASE_URL}/api/medicao/projects", headers=h)
        assert r.status_code == 200
        rows = r.json().get("projects") or []
        row = next((p for p in rows if p["id"] == pid), None)
        assert row is not None
        assert abs(row["fechado"] - total1) < 0.01
        assert abs(row["realizado"] - (total1 + total2)) < 0.01
        assert row["medicoes_count"] == 1
        # realizado_count = em-aberto itens + nº de medições fechadas
        assert row["realizado_count"] == len(items2) + 1
