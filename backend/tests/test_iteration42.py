"""Iteration 42 — License/branding/Stripe/impacto/NF/PDF/warehouse_status tests."""
import io
import os
import base64
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MASTER_KEY = "hayah-master-BEi_yAhwwVtd"  # from /app/backend/.env
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PW = "Hayah$152610"

# tiny 1x1 PNG
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
TINY_PNG_DATA_URL = "data:image/png;base64," + base64.b64encode(TINY_PNG).decode()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PW}, timeout=20)
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module", autouse=True)
def _cleanup(session):
    """Ensure license disabled at end so app isn't blocked."""
    yield
    try:
        session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "enabled": False})
        session.put(f"{BASE_URL}/api/branding", json={
            "master_key": MASTER_KEY, "app_name": "Hayah Energy", "tagline": "ENERGY",
            "company_name": "", "logo_data_url": ""
        })
    except Exception:
        pass


# ---------- LICENSE ----------
class TestLicense:
    def test_status_fields(self, session):
        r = session.get(f"{BASE_URL}/api/licenca/status")
        assert r.status_code == 200
        d = r.json()
        for k in ["enabled", "paid_until", "days_left", "expired", "blocked", "warning",
                  "valor", "ciclo_dias", "stripe_enabled", "master_configured", "history", "is_admin"]:
            assert k in d, f"missing {k}"
        assert d["is_admin"] is True
        assert d["master_configured"] is True

    def test_master_verify_ok(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/verificar-mestra", json={"master_key": MASTER_KEY})
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_master_verify_bad(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/verificar-mestra", json={"master_key": "wrong"})
        assert r.status_code == 403

    def test_config_requires_master(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": "wrong", "enabled": True})
        assert r.status_code == 403

    def test_checkout_requires_master(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/checkout", json={"origin_url": BASE_URL, "master_key": "wrong"})
        assert r.status_code == 403

    def test_manual_payment_requires_master(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/pagamento-manual", json={"master_key": "wrong", "dias": 30})
        assert r.status_code == 403

    def test_branding_requires_master(self, session):
        r = session.put(f"{BASE_URL}/api/branding", json={"master_key": "wrong", "app_name": "X"})
        assert r.status_code == 403

    def test_config_warning_days_left(self, session):
        future = (date.today() + timedelta(days=3)).isoformat()
        r = session.post(f"{BASE_URL}/api/licenca/config", json={
            "master_key": MASTER_KEY, "enabled": True, "valor": 490, "ciclo_dias": 30,
            "empresa": "Empresa Teste LTDA", "paid_until": future})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["warning"] is True
        assert d["days_left"] == 3
        assert d["blocked"] is False
        # cleanup to disabled
        session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "enabled": False})

    def test_config_validations(self, session):
        r = session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "ciclo_dias": 999})
        assert r.status_code == 400
        r = session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "valor": -10})
        assert r.status_code == 400
        r = session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "paid_until": "not-a-date"})
        assert r.status_code == 400

    def test_block_and_unblock(self, session):
        # Block
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        r = session.post(f"{BASE_URL}/api/licenca/config", json={
            "master_key": MASTER_KEY, "enabled": True, "paid_until": yesterday})
        assert r.status_code == 200
        assert r.json()["blocked"] is True

        # Status still accessible
        assert session.get(f"{BASE_URL}/api/licenca/status").status_code == 200
        assert session.get(f"{BASE_URL}/api/branding").status_code == 200

        # Other endpoint should 402
        r = session.get(f"{BASE_URL}/api/projects")
        assert r.status_code == 402
        assert r.json().get("detail") == "licenca_expirada"

        # Unblock with manual payment
        r = session.post(f"{BASE_URL}/api/licenca/pagamento-manual",
                         json={"master_key": MASTER_KEY, "dias": 30, "obs": "PIX teste"})
        assert r.status_code == 200
        d = r.json()
        expected_until = (date.today() + timedelta(days=30)).isoformat()
        assert d["paid_until"] == expected_until
        assert any(h.get("method") == "manual" for h in d["history"])

        # Now /api/projects returns 200
        assert session.get(f"{BASE_URL}/api/projects").status_code == 200

        # cleanup -> disabled
        session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "enabled": False})


# ---------- STRIPE ----------
class TestStripe:
    def test_checkout_requires_valor(self, session):
        # ensure valor=0
        session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "valor": 0})
        r = session.post(f"{BASE_URL}/api/licenca/checkout",
                         json={"origin_url": BASE_URL, "master_key": MASTER_KEY})
        assert r.status_code == 400

    def test_checkout_creates_session(self, session):
        session.post(f"{BASE_URL}/api/licenca/config", json={"master_key": MASTER_KEY, "valor": 490})
        r = session.post(f"{BASE_URL}/api/licenca/checkout",
                         json={"origin_url": BASE_URL, "master_key": MASTER_KEY})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["checkout_url"].startswith("https://checkout.stripe.com")
        assert d["session_id"].startswith("cs_test_")

        # Status for session
        r2 = session.get(f"{BASE_URL}/api/licenca/pagamento/status/{d['session_id']}")
        assert r2.status_code == 200
        s = r2.json()
        assert s["status"] == "initiated"
        assert s["payment_status"] == "pending"

    def test_payment_status_not_found(self, session):
        r = session.get(f"{BASE_URL}/api/licenca/pagamento/status/cs_test_does_not_exist")
        assert r.status_code == 404


# ---------- BRANDING ----------
class TestBranding:
    def test_update_and_restore(self, session):
        r = session.put(f"{BASE_URL}/api/branding", json={
            "master_key": MASTER_KEY, "app_name": "Energia Teste",
            "company_name": "Empresa Teste LTDA", "tagline": "OBRAS",
            "logo_data_url": TINY_PNG_DATA_URL})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["app_name"] == "Energia Teste"
        assert d["tagline"] == "OBRAS"
        # No auth GET reflects
        pub = requests.get(f"{BASE_URL}/api/branding").json()
        assert pub["app_name"] == "Energia Teste"
        # Restore
        r = session.put(f"{BASE_URL}/api/branding", json={
            "master_key": MASTER_KEY, "app_name": "Hayah Energy",
            "company_name": "", "tagline": "ENERGY", "logo_data_url": ""})
        assert r.status_code == 200

    def test_invalid_logo(self, session):
        r = session.put(f"{BASE_URL}/api/branding",
                        json={"master_key": MASTER_KEY, "logo_data_url": "notadata"})
        assert r.status_code == 400

    def test_logo_too_big(self, session):
        huge = "data:image/png;base64," + ("A" * (301 * 1024))
        r = session.put(f"{BASE_URL}/api/branding",
                        json={"master_key": MASTER_KEY, "logo_data_url": huge})
        assert r.status_code == 400


# ---------- ALMOXARIFADO IMPACTO ----------
class TestImpacto:
    def test_full_flow(self, session):
        # Config
        r = session.put(f"{BASE_URL}/api/almoxarifado/impacto/config", json={"hh_rate": 55.5})
        assert r.status_code == 200
        assert r.json()["hh_rate"] == 55.5

        # Get a project
        pr = session.get(f"{BASE_URL}/api/projects").json()
        projs = pr if isinstance(pr, list) else pr.get("items", [])
        project_id = projs[0]["id"] if projs else None

        # Create ocorrencia
        body = {"project_id": project_id, "tipo": "nao_atendida", "hours": 4,
                "members": 3, "description": "TEST_impacto_42"}
        r = session.post(f"{BASE_URL}/api/almoxarifado/impacto/ocorrencias", json=body)
        assert r.status_code == 200, r.text
        oc = r.json()
        oid = oc["id"]
        # cost = 4*3*55.5 = 666
        assert oc["cost"] == 666.0
        assert oc["basis"] == "hh_rate"

        # List
        r = session.get(f"{BASE_URL}/api/almoxarifado/impacto")
        assert r.status_code == 200
        d = r.json()
        assert d["totals"]["ocorrencias"] >= 1
        assert any(it["id"] == oid for it in d["items"])

        # Patch
        r = session.patch(f"{BASE_URL}/api/almoxarifado/impacto/ocorrencias/{oid}",
                          json={"tipo": "espera_doca", "hours": 2, "members": 2,
                                "description": "TEST_impacto_42_updated"})
        assert r.status_code == 200
        assert r.json()["cost"] == 222.0

        # Delete
        r = session.delete(f"{BASE_URL}/api/almoxarifado/impacto/ocorrencias/{oid}")
        assert r.status_code == 200

        # Reset config
        session.put(f"{BASE_URL}/api/almoxarifado/impacto/config", json={"hh_rate": None})

    def test_invalid_tipo(self, session):
        r = session.post(f"{BASE_URL}/api/almoxarifado/impacto/ocorrencias",
                         json={"tipo": "xxx", "hours": 1})
        assert r.status_code == 400


# ---------- NF da requisição + PDF + warehouse_status ----------
class TestRequisitionNF:
    @pytest.fixture(scope="class")
    def project_with_req(self, session):
        projs = session.get(f"{BASE_URL}/api/projects").json()
        projs = projs if isinstance(projs, list) else projs.get("items", [])
        for p in projs:
            full = session.get(f"{BASE_URL}/api/projects/{p['id']}").json()
            if full.get("material_requisitions"):
                return p["id"], full["material_requisitions"][0]["id"]
        pytest.skip("No project with material_requisitions")

    def test_set_get_delete_nf(self, session, project_with_req):
        pid, rid = project_with_req
        # Set with PDF
        files = {"file": ("nf.pdf", b"%PDF-1.4\n%EOF", "application/pdf")}
        data = {"numero": "NF-TEST-42"}
        r = session.post(f"{BASE_URL}/api/projects/{pid}/requisitions/{rid}/nota-fiscal",
                        files=files, data=data)
        assert r.status_code == 200, r.text
        assert r.json()["nota_fiscal"]["numero"] == "NF-TEST-42"
        assert r.json()["nota_fiscal"]["has_file"] is True

        # Get file
        r = session.get(f"{BASE_URL}/api/projects/{pid}/requisitions/{rid}/nota-fiscal/file")
        assert r.status_code == 200
        assert r.content.startswith(b"%PDF")

        # Documentos lists NF
        r = session.get(f"{BASE_URL}/api/projects/{pid}/documentos")
        assert r.status_code == 200
        d = r.json()
        assert any(nf.get("numero") == "NF-TEST-42" for nf in d.get("notas_fiscais", []))
        assert d["counts"]["notas_fiscais"] >= 1

        # Delete
        r = session.delete(f"{BASE_URL}/api/projects/{pid}/requisitions/{rid}/nota-fiscal")
        assert r.status_code == 200

    def test_requisition_pdf_labels(self, session, project_with_req):
        pid, rid = project_with_req
        r = session.get(f"{BASE_URL}/api/projects/{pid}/requisitions/{rid}/pdf")
        assert r.status_code == 200, r.text
        content = r.content
        assert content[:4] == b"%PDF"
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        assert "ENCARREGADO" in text, text[:500]
        assert "ALMOXARIFADO" in text
        assert "SOLICITANTE" not in text
        assert "ALMOXARIFE" not in text


class TestWarehouseStatus:
    def test_despadronizado(self, session):
        projs = session.get(f"{BASE_URL}/api/projects").json()
        projs = projs if isinstance(projs, list) else projs.get("items", [])
        for p in projs:
            full = session.get(f"{BASE_URL}/api/projects/{p['id']}").json()
            mats = full.get("materials_list") or full.get("materials") or []
            if mats:
                item_id = mats[0]["id"]
                r = session.patch(f"{BASE_URL}/api/projects/{p['id']}/materials/{item_id}",
                                 json={"warehouse_status": "despadronizado"})
                assert r.status_code in (200, 204), r.text
                # verify
                full2 = session.get(f"{BASE_URL}/api/projects/{p['id']}").json()
                m2 = next(m for m in (full2.get("materials_list") or full2.get("materials") or []) if m["id"] == item_id)
                assert m2.get("warehouse_status") == "despadronizado"
                return
        pytest.skip("No project with materials")


class TestAttachmentKinds:
    def test_upload_kinds(self, session):
        projs = session.get(f"{BASE_URL}/api/projects").json()
        projs = projs if isinstance(projs, list) else projs.get("items", [])
        if not projs:
            pytest.skip("no projects")
        pid = projs[0]["id"]
        for kind in ["nota_fiscal", "laudo_trafo", "laudo_medidor", "ditais"]:
            files = {"file": (f"{kind}.pdf", b"%PDF-1.4\ntest\n%%EOF", "application/pdf")}
            data = {"kind": kind}
            if kind == "nota_fiscal":
                data["nf_numero"] = f"NF-TEST-{kind}"
            r = session.post(f"{BASE_URL}/api/projects/{pid}/attachments",
                            files=files, data=data)
            assert r.status_code in (200, 201), f"{kind}: {r.status_code} {r.text}"
            att_id = r.json().get("id") or r.json().get("attachment", {}).get("id")
            # cleanup
            if att_id:
                session.delete(f"{BASE_URL}/api/projects/{pid}/attachments/{att_id}")
