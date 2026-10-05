"""Testing DITAIS feature (iteration 41) — prefill, CRUD/upsert, photo upload (auto-create for client_id), 
step photo file (w resize), delete photo, from-photo (project photo), PATCH toggling N/A, PDF generation, auth isolation."""
import io
import os
import re
import secrets
import time
import pytest
import requests
from PIL import Image

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://team-scheduler-230.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"

CREATED_IDS = []  # list of (session, ditais_id)


def _jpeg(w=400, h=300, color=(200, 100, 50)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    yield s
    # cleanup
    for sess, did in CREATED_IDS:
        try:
            sess.delete(f"{BASE_URL}/api/ditais/{did}", timeout=10)
        except Exception:
            pass


@pytest.fixture(scope="module")
def project_id(session):
    r = session.get(f"{BASE_URL}/api/projects", timeout=20)
    assert r.status_code == 200, r.text[:200]
    projs = r.json()
    assert projs, "no projects available for user"
    # prefer specific one if exists
    target = "6a625e61592149428e288fc1"
    for p in projs:
        if p.get("id") == target or p.get("_id") == target:
            return target
    return projs[0].get("id") or projs[0].get("_id")


class TestPrefill:
    def test_prefill_returns_defaults(self, session, project_id):
        r = session.get(f"{BASE_URL}/api/projects/{project_id}/ditais/prefill", timeout=15)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["regional"] == "DCMD"
        assert d["prestadora"] == "GRUPO ATUAL"
        assert re.match(r"\d{4}-\d{2}-\d{2}", d["data_execucao"])
        assert "steps" in d
        for k in ["D", "I1", "T", "A", "I2", "S"]:
            assert k in d["steps"]
            assert "letter" in d["steps"][k] and "name" in d["steps"][k] and "label" in d["steps"][k]
        assert isinstance(d.get("project_photos"), list)

    def test_prefill_unauth(self):
        r = requests.get(f"{BASE_URL}/api/projects/anyid/ditais/prefill", timeout=15)
        assert r.status_code == 401


class TestCRUDAndUpsert:
    def test_create_upsert_list_get(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        body = {"client_id": cid, "responsavel": "Fulano Teste",
                "steps_na": {"S": {"na": True, "motivo": "não requer sinalização"}}}
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json=body, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["counts"] == {"fotos": 0, "na": 1, "pendentes": 5}
        assert d["steps"]["S"]["status"] == "na"
        assert d["steps"]["S"]["na_motivo"] == "não requer sinalização"
        assert d["client_id"] == cid
        did = d["id"]
        CREATED_IDS.append((session, did))

        # upsert same client_id — should not duplicate; should update
        body2 = dict(body)
        body2["responsavel"] = "Fulano Atualizado"
        r2 = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json=body2, timeout=20)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["id"] == did
        assert d2["responsavel"] == "Fulano Atualizado"

        # list
        rl = session.get(f"{BASE_URL}/api/projects/{project_id}/ditais", timeout=15)
        assert rl.status_code == 200
        items = rl.json()
        assert any(it["id"] == did for it in items)

        # get by id and by client_id
        rg1 = session.get(f"{BASE_URL}/api/ditais/{did}", timeout=15)
        assert rg1.status_code == 200
        rg2 = session.get(f"{BASE_URL}/api/ditais/{cid}", timeout=15)
        assert rg2.status_code == 200
        assert rg2.json()["id"] == did

    def test_patch_toggle_na_back(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais",
                         json={"client_id": cid, "steps_na": {"D": {"na": True, "motivo": "x"}}}, timeout=20)
        assert r.status_code == 200
        did = r.json()["id"]
        CREATED_IDS.append((session, did))
        # PATCH: na false → pendente
        rp = session.patch(f"{BASE_URL}/api/ditais/{cid}", json={
            "observacao": "linha1\nlinha2\nlinha3",
            "assinatura_nome": "Assinante Teste",
            "steps_na": {"D": {"na": False, "motivo": ""}}
        }, timeout=15)
        assert rp.status_code == 200
        d = rp.json()
        assert d["steps"]["D"]["status"] == "pendente"
        assert d["observacao"].startswith("linha1")

    def test_delete(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        did = r.json()["id"]
        rd = session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)
        assert rd.status_code == 200
        rg = session.get(f"{BASE_URL}/api/ditais/{did}", timeout=10)
        assert rg.status_code == 404


class TestPhotos:
    def test_upload_with_existing_client_id(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        assert r.status_code == 200
        did = r.json()["id"]
        CREATED_IDS.append((session, did))
        files = {"file": ("d.jpg", _jpeg(), "image/jpeg")}
        ru = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/D/photo",
                          files=files, data={"taken_at": ""}, timeout=30)
        assert ru.status_code == 200, ru.text[:300]
        d = ru.json()
        assert d["steps"]["D"]["status"] == "foto"
        assert d["steps"]["D"]["photo"]["url"].endswith("/steps/D/photo")

        # GET raw image
        rg = session.get(f"{BASE_URL}/api/ditais/{cid}/steps/D/photo", timeout=15)
        assert rg.status_code == 200
        assert "image" in rg.headers.get("content-type", "")
        full_size = len(rg.content)
        # GET reduced
        rg2 = session.get(f"{BASE_URL}/api/ditais/{cid}/steps/D/photo?w=600", timeout=15)
        assert rg2.status_code == 200
        assert rg2.headers.get("content-type", "").startswith("image/")
        # not strictly smaller because original jpeg is tiny, just make sure returns
        assert len(rg2.content) > 0

        # Delete photo
        rd = session.delete(f"{BASE_URL}/api/ditais/{cid}/steps/D/photo", timeout=15)
        assert rd.status_code == 200
        assert rd.json()["steps"]["D"]["status"] == "pendente"

    def test_upload_auto_create_with_nonexistent_client_id(self, session, project_id):
        cid = f"TEST_offline_{secrets.token_urlsafe(6)}"
        files = {"file": ("t.jpg", _jpeg(), "image/jpeg")}
        ru = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/T/photo",
                          files=files, timeout=30)
        assert ru.status_code == 200, ru.text[:300]
        d = ru.json()
        assert d["client_id"] == cid
        assert d["steps"]["T"]["status"] == "foto"
        CREATED_IDS.append((session, d["id"]))

    def test_upload_nonexistent_objectid_returns_404(self, session, project_id):
        fake = "0" * 24
        files = {"file": ("x.jpg", _jpeg(), "image/jpeg")}
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{fake}/steps/D/photo",
                         files=files, timeout=15)
        assert r.status_code == 404

    def test_invalid_step_returns_400(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        files = {"file": ("x.jpg", _jpeg(), "image/jpeg")}
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/X/photo",
                         files=files, timeout=15)
        assert r.status_code == 400
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)

    def test_non_image_returns_400(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        files = {"file": ("x.txt", b"not an image", "text/plain")}
        r = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/D/photo",
                         files=files, timeout=15)
        assert r.status_code == 400
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)

    def test_na_removes_photo(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        files = {"file": ("x.jpg", _jpeg(), "image/jpeg")}
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/A/photo", files=files, timeout=30)
        # mark N/A
        rp = session.patch(f"{BASE_URL}/api/ditais/{cid}", json={"steps_na": {"A": {"na": True, "motivo": "removido"}}}, timeout=15)
        assert rp.status_code == 200
        d = rp.json()
        assert d["steps"]["A"]["status"] == "na"
        assert d["steps"]["A"]["photo"] is None
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)

    def test_from_photo_404_when_no_project_photo(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        r = session.post(f"{BASE_URL}/api/ditais/{cid}/steps/D/from-photo",
                         json={"photo_id": "nope-xyz"}, timeout=15)
        assert r.status_code == 404
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)


class TestPDF:
    def test_pdf_no_photos(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={
            "client_id": cid,
            "observacao": "linha1\nlinha2\nlinha3\nlinha4 bem longa " * 3,
            "assinatura": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "assinatura_nome": "Teste Assinante",
            "steps_na": {"S": {"na": True, "motivo": "x"}}
        }, timeout=15)
        r = session.get(f"{BASE_URL}/api/ditais/{cid}/pdf", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd and "DITAIS_" in cd and ".pdf" in cd
        assert len(r.content) > 1000
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=10)

    def test_pdf_with_photos_over_50kb(self, session, project_id):
        cid = f"TEST_{secrets.token_urlsafe(6)}"
        session.post(f"{BASE_URL}/api/projects/{project_id}/ditais", json={"client_id": cid}, timeout=15)
        for step, color in [("D", (255, 0, 0)), ("I1", (0, 255, 0)), ("T", (0, 0, 255))]:
            files = {"file": ("x.jpg", _jpeg(800, 600, color), "image/jpeg")}
            rr = session.post(f"{BASE_URL}/api/projects/{project_id}/ditais/{cid}/steps/{step}/photo",
                              files=files, timeout=30)
            assert rr.status_code == 200
        r = session.get(f"{BASE_URL}/api/ditais/{cid}/pdf", timeout=60)
        assert r.status_code == 200
        assert len(r.content) > 50 * 1024, f"pdf size {len(r.content)}"
        session.delete(f"{BASE_URL}/api/ditais/{cid}", timeout=15)


class TestAuth:
    def test_unauthenticated_list(self, project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{project_id}/ditais", timeout=15)
        assert r.status_code == 401
