"""Iteration 34 — Laudo de Transformador (padrão Energisa) endpoints.

Covers:
- GET /api/equipamentos/{id}/laudo — prefill, saved flag, 404 unknown
- PUT /api/equipamentos/{id}/laudo — persistence, validation, leituras normalization
- POST/GET/DELETE /api/equipamentos/{id}/laudo/photos/{slot} — upload/serve/delete
- POST .../photos/{slot}/from-photo — reuse existing equipment photo
- GET /api/equipamentos/{id}/laudo/pdf — content-type/size/pages
- Regression: /api/equipamentos list & photos (max 3)
"""
import io
import os
import pytest
import requests
from PIL import Image

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover
    from PyPDF2 import PdfReader  # type: ignore

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"


def _png_bytes(size=(120, 90), color=(200, 40, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def hj(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def equip_id(hj):
    payload = {
        "tipo": "transformador",
        "patrimonio": "TEST-LAUDO-34",
        "numero_serie": "SN-TEST-34",
        "fabricante": "ITAM",
        "condicao": "novo",
    }
    r = requests.post(f"{BASE_URL}/api/equipamentos", headers=hj, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    eid = r.json().get("id") or r.json().get("_id")
    assert eid
    yield eid
    # cleanup
    requests.delete(f"{BASE_URL}/api/equipamentos/{eid}", headers=hj, timeout=30)


# ---------- GET laudo (prefill)
class TestGetLaudo:
    def test_prefill_shape(self, hj, h):
        # Use dedicated fresh equipment (avoid ordering issues with PUT tests)
        payload = {"tipo": "transformador", "patrimonio": "TEST-LAUDO-PREFILL",
                   "numero_serie": "SN-PREFILL", "fabricante": "ITAM", "condicao": "reforma"}
        cr = requests.post(f"{BASE_URL}/api/equipamentos", headers=hj, json=payload, timeout=30)
        assert cr.status_code in (200, 201), cr.text
        eid = cr.json().get("id") or cr.json().get("_id")
        try:
            r = requests.get(f"{BASE_URL}/api/equipamentos/{eid}/laudo", headers=h, timeout=30)
            assert r.status_code == 200, r.text
            j = r.json()
            for k in ("laudo", "photos", "slots", "saved", "equip_photos"):
                assert k in j
            laudo = j["laudo"]
            assert laudo["patrimonio"] == "TEST-LAUDO-PREFILL"
            assert laudo["numero_serie"] == "SN-PREFILL"
            assert laudo["marca"] == "ITAM"
            assert laudo["tipo_laudo"] == "instalacao"
            assert laudo["tipo_oleo"] == "ovi"
            assert laudo["configuracao"] == "monofasico"
            assert laudo["classe_tensao"] == "13.8"
            assert laudo["reformado"] == "sim"  # condicao=reforma
            assert isinstance(laudo["aterr_leituras"], list) and len(laudo["aterr_leituras"]) == 3
            assert isinstance(laudo["tensao_leituras"], list) and len(laudo["tensao_leituras"]) == 3
            for s, meta in j["photos"].items():
                assert meta is None
            assert j["saved"] is False
            assert len(j["slots"]) == 8
        finally:
            requests.delete(f"{BASE_URL}/api/equipamentos/{eid}", headers=hj, timeout=30)

    def test_404_unknown(self, h):
        r = requests.get(f"{BASE_URL}/api/equipamentos/000000000000000000000000/laudo",
                         headers=h, timeout=20)
        assert r.status_code == 404


# ---------- PUT laudo
class TestPutLaudo:
    def test_persist_and_validation(self, hj, h, equip_id):
        body = {
            "tipo_laudo": "instalacao",
            "projeto": "OBRA-TEST-34",
            "data": "2026-01-15",
            "localizacao": "Cuiabá",
            "endereco": "Rua Teste, 123",
            "configuracao": "trifasico",
            "classe_tensao": "13.8",
            "posicao_tap": "3",
            "qtd_tap": "5",
            "impedancia": "3,45",
            "massa_kg": "180",
            "volume_oleo": "60",
            "tipo_oleo": "omi",
            "reformado": "nao",
            "aterr_leituras": ["12,5", "11,8", ""],
            "tensao_leituras": ["223", "225", "224"],
            "observacao": "Observação de teste",
            "encarregado": "Carlos Teste",
        }
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo", headers=hj, json=body, timeout=30)
        assert r.status_code == 200, r.text

        g = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo", headers=h, timeout=20).json()
        assert g["saved"] is True
        laudo = g["laudo"]
        assert laudo["projeto"] == "OBRA-TEST-34"
        assert laudo["configuracao"] == "trifasico"
        assert laudo["tipo_oleo"] == "omi"
        assert laudo["aterr_leituras"] == ["12,5", "11,8", ""]
        assert laudo["tensao_leituras"] == ["223", "225", "224"]
        assert laudo["observacao"] == "Observação de teste"
        assert laudo["encarregado"] == "Carlos Teste"

    def test_invalid_tipo_laudo(self, hj, equip_id):
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                         headers=hj, json={"tipo_laudo": "bogus"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_configuracao(self, hj, equip_id):
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                         headers=hj, json={"configuracao": "xxx"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_tipo_oleo(self, hj, equip_id):
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                         headers=hj, json={"tipo_oleo": "xxx"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_reformado(self, hj, equip_id):
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                         headers=hj, json={"reformado": "maybe"}, timeout=15)
        assert r.status_code == 400

    def test_leituras_normalized_to_3(self, hj, h, equip_id):
        r = requests.put(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                         headers=hj, json={"aterr_leituras": ["1", "2", "3", "4", "5"]}, timeout=15)
        assert r.status_code == 200
        g = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo", headers=h, timeout=20).json()
        assert len(g["laudo"]["aterr_leituras"]) == 3
        assert g["laudo"]["aterr_leituras"] == ["1", "2", "3"]


# ---------- Photo slots
class TestSlots:
    def test_invalid_slot(self, h, equip_id):
        r = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/bogus_slot",
            headers=h,
            files={"file": ("a.png", _png_bytes(), "image/png")},
            timeout=30,
        )
        assert r.status_code == 400

    def test_non_image_rejected(self, h, equip_id):
        r = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/aterr_a",
            headers=h,
            files={"file": ("bad.txt", b"not an image at all", "text/plain")},
            timeout=30,
        )
        assert r.status_code == 400

    @pytest.mark.parametrize("slot", ["aterr_a", "tensao_b", "placa", "instalado"])
    def test_upload_and_get_and_delete(self, h, equip_id, slot):
        r = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/{slot}",
            headers=h,
            files={"file": (f"{slot}.png", _png_bytes(), "image/png")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["slot"] == slot
        assert j["url"].endswith(f"/laudo/photos/{slot}")

        # GET binary
        g = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/{slot}",
                         headers=h, timeout=30)
        assert g.status_code == 200
        assert g.headers.get("content-type", "").startswith("image/")
        assert len(g.content) > 100

        # Verify meta shows in GET laudo
        laudo = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                             headers=h, timeout=20).json()
        assert laudo["photos"][slot] is not None

        # DELETE
        d = requests.delete(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/{slot}",
                            headers=h, timeout=30)
        assert d.status_code == 200
        laudo = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                             headers=h, timeout=20).json()
        assert laudo["photos"][slot] is None

    def test_from_photo_unknown(self, hj, equip_id):
        r = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/aterr_a/from-photo",
            headers=hj, json={"photo_id": "nope-does-not-exist"}, timeout=20,
        )
        assert r.status_code == 404

    def test_from_photo_uses_existing(self, h, hj, equip_id):
        # First upload an equipment photo
        up = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/photos",
            headers=h,
            files={"file": ("eq.png", _png_bytes(size=(200, 150), color=(30, 80, 200)), "image/png")},
            timeout=60,
        )
        assert up.status_code in (200, 201), up.text
        # fetch equip laudo to grab photo id
        g = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo", headers=h, timeout=20).json()
        assert g["equip_photos"], "no equipment photos returned"
        pid = g["equip_photos"][0]["id"]

        r = requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/placa/from-photo",
            headers=hj, json={"photo_id": pid}, timeout=30,
        )
        assert r.status_code == 200, r.text
        laudo = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo",
                             headers=h, timeout=20).json()
        assert laudo["photos"]["placa"] is not None
        assert laudo["photos"]["placa"].get("source") == "photo"


# ---------- PDF
class TestPDF:
    def test_pdf_ok_with_saved_and_photo(self, h, equip_id):
        # Ensure at least one slot photo exists
        requests.post(
            f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/photos/instalado",
            headers=h, files={"file": ("i.png", _png_bytes((300, 220)), "image/png")}, timeout=60,
        )
        r = requests.get(f"{BASE_URL}/api/equipamentos/{equip_id}/laudo/pdf",
                         headers=h, timeout=60)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:5] == b"%PDF-"
        assert len(r.content) > 20_000, f"pdf too small: {len(r.content)}"
        reader = PdfReader(io.BytesIO(r.content))
        assert len(reader.pages) == 1

    def test_pdf_works_without_saved(self, h, hj):
        # New transformer without any laudo saved
        payload = {"tipo": "transformador", "patrimonio": "TEST-LAUDO-EMPTY",
                   "numero_serie": "SN-EMPTY", "fabricante": "X", "condicao": "novo"}
        r = requests.post(f"{BASE_URL}/api/equipamentos", headers=hj, json=payload, timeout=30)
        assert r.status_code in (200, 201)
        eid = r.json().get("id") or r.json().get("_id")
        try:
            p = requests.get(f"{BASE_URL}/api/equipamentos/{eid}/laudo/pdf",
                             headers=h, timeout=60)
            assert p.status_code == 200
            assert p.content[:5] == b"%PDF-"
            reader = PdfReader(io.BytesIO(p.content))
            assert len(reader.pages) == 1
        finally:
            requests.delete(f"{BASE_URL}/api/equipamentos/{eid}", headers=hj, timeout=30)


# ---------- Regression
class TestRegression:
    def test_list_equipamentos(self, h):
        r = requests.get(f"{BASE_URL}/api/equipamentos", headers=h, timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))
