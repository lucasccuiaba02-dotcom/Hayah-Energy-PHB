"""Iteration 38 — Medição PDF + Fiscais + Envio e-mail (Resend não configurado)"""
import os
import pytest
import requests
import pymupdf

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"
TEST_CODE = "TEST-MED-PDF"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def project_id(h):
    r = requests.get(f"{BASE_URL}/api/projects", headers=h)
    assert r.status_code == 200
    projs = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
    for p in projs:
        if p.get("project_code") == TEST_CODE or p.get("code") == TEST_CODE:
            return p.get("id") or p.get("_id")
    pytest.skip(f"{TEST_CODE} not found")


@pytest.fixture(scope="session")
def empty_project(h):
    """Create disposable project without any realizado to test empty PDF + 400 on enviar."""
    payload = {"project_code": "TEST-MED-EMPTY-38", "name": "TEST Empty Medicao", "project_type": "manutencao", "contracted_value": 1000}
    r = requests.post(f"{BASE_URL}/api/projects", headers=h, json=payload)
    if r.status_code not in (200, 201):
        r = requests.post(f"{BASE_URL}/api/projects", headers=h, json={"project_code": "TEST-MED-EMPTY-38", "name": "TEST Empty"})
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("_id")
    yield pid
    requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=h)


class TestFiscais:
    def test_get_detail_has_fiscais_envios(self, h, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao", headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "fiscais" in d and isinstance(d["fiscais"], list)
        assert "envios" in d and isinstance(d["envios"], list)
        assert len(d["envios"]) <= 10

    def test_save_fiscais_normalizes(self, h, project_id):
        body = {"fiscais": [
            {"name": "Fiscal Teste", "email": "DELIVERED@resend.dev", "phone": "11999999999"},
            {"name": "", "email": "", "phone": ""},  # should be discarded
            {"name": "Fiscal 2", "email": "fiscal2@resend.dev", "phone": ""},
            {"name": "Novo", "email": "novo.fiscal@resend.dev", "phone": ""},
        ]}
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/medicao/fiscais", headers=h, json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        emails = [f["email"] for f in d["fiscais"]]
        assert "delivered@resend.dev" in emails  # lowered
        assert all(e == e.lower() for e in emails)
        assert len(d["fiscais"]) == 3  # empty discarded


class TestPdf:
    def test_pdf_download(self, h, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao/pdf", headers=h, params={"period": "01/01-31/01", "number": "001", "notes": "obs teste"})
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and ".pdf" in cd and "medicao_" in cd
        pdf_bytes = r.content
        assert pdf_bytes.startswith(b"%PDF")
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        text = "\n".join(p.get_text() for p in doc)
        doc.close()
        assert "RESUMO DE MÃO DE OBRA" in text.upper()
        assert "FECHAMENTO" in text.upper()
        assert "TOTAL GERAL" in text.upper()
        assert "R$" in text
        # at least one grupo (POSTE or TRAFO or OUTROS)
        assert any(g in text.upper() for g in ("POSTE", "TRAFO", "OUTROS"))

    def test_pdf_auth_query(self, token, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao/pdf", params={"auth": token})
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")

    def test_pdf_empty_project(self, h, empty_project):
        r = requests.get(f"{BASE_URL}/api/projects/{empty_project}/medicao/pdf", headers=h)
        assert r.status_code == 200, r.text
        doc = pymupdf.open(stream=r.content, filetype="pdf")
        text = "\n".join(p.get_text() for p in doc)
        doc.close()
        assert "Nenhum serviço medido" in text or "nenhum" in text.lower()


class TestEnvio:
    def test_enviar_sem_realizado(self, h, empty_project):
        body = {"recipients": ["delivered@resend.dev"], "message": "", "notes": "", "period": "", "number": "", "copy_me": False, "save_fiscais": False}
        r = requests.post(f"{BASE_URL}/api/projects/{empty_project}/medicao/enviar", headers=h, json=body)
        assert r.status_code == 400, r.text
        assert "Lance e salve" in r.json().get("detail", "")

    def test_enviar_sem_email_valido(self, h, project_id):
        body = {"recipients": ["invalido", "bad@", ""], "copy_me": False, "save_fiscais": False}
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/medicao/enviar", headers=h, json=body)
        assert r.status_code == 400, r.text

    def test_enviar_skipped_resend_not_configured(self, h, project_id):
        # Count envios before
        d_before = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao", headers=h).json()
        envios_before = len(d_before.get("envios") or [])
        body = {"recipients": ["delivered@resend.dev", "novo.fiscal@resend.dev"], "message": "teste", "notes": "obs",
                "period": "01/2026", "number": "38", "copy_me": False, "save_fiscais": True}
        r = requests.post(f"{BASE_URL}/api/projects/{project_id}/medicao/enviar", headers=h, json=body)
        assert r.status_code == 503, r.text
        detail = r.json().get("detail", "")
        assert "RESEND_API_KEY" in detail

        # Verify envio was registered
        d_after = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao", headers=h).json()
        envios = d_after.get("envios") or []
        assert len(envios) == envios_before + 1
        latest = envios[0]  # most recent first
        assert latest.get("status") == "skipped"
        assert "delivered@resend.dev" in latest.get("recipients", [])
        assert float(latest.get("total") or 0) > 0


class TestLineGroup:
    def test_realizado_line_group_field(self, h, project_id):
        # Fetch current realizado, re-save w/ group on one line
        d = requests.get(f"{BASE_URL}/api/projects/{project_id}/medicao", headers=h).json()
        items = list(d.get("measured") or [])
        if not items:
            pytest.skip("no items")
        payload_items = []
        for i, it in enumerate(items):
            payload_items.append({
                "id": it.get("id"), "catalog_id": it.get("catalog_id", ""), "code": it.get("code", ""),
                "description": it.get("description") or "x", "unit": it.get("unit", "UN"),
                "unit_price": it.get("unit_price", 0), "qty": it.get("qty", 0),
                "notes": it.get("notes", ""), "group": "POSTE" if i == 0 else it.get("group", ""),
            })
        r = requests.put(f"{BASE_URL}/api/projects/{project_id}/medicao/realizado", headers=h, json={"items": payload_items})
        assert r.status_code == 200, r.text
        d2 = r.json()
        assert d2["measured"][0].get("group") == "POSTE"
        # actual_value == total
        assert abs(float(d2["project"]["actual_value"]) - float(d2["totals"]["realizado"])) < 0.01


class TestRegression:
    def test_medicao_projects(self, h):
        r = requests.get(f"{BASE_URL}/api/medicao/projects", headers=h)
        assert r.status_code == 200
        data = r.json()
        projs = data if isinstance(data, list) else data.get("projects")
        assert isinstance(projs, list)

    def test_catalogo(self, h):
        r = requests.get(f"{BASE_URL}/api/medicao/catalogo", headers=h)
        assert r.status_code == 200
