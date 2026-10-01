"""Iteration 37 - Medição / PDF Jobs / Campo histórico / Documentos / Attachment ?auth= / regressão"""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASS = "Hayah$152610"
CAMPO_PROJECT_CODE = "CAMPO-LV-01"


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def campo_project_id(h):
    r = requests.get(f"{BASE_URL}/api/projects", headers=h)
    assert r.status_code == 200
    projs = r.json() if isinstance(r.json(), list) else r.json().get("projects", [])
    for p in projs:
        if p.get("project_code") == CAMPO_PROJECT_CODE or p.get("code") == CAMPO_PROJECT_CODE:
            return p.get("id") or p.get("_id")
    pytest.skip("CAMPO-LV-01 not found")


@pytest.fixture(scope="session")
def test_project(h):
    """Create a disposable project for medicao write tests."""
    payload = {
        "project_code": "TEST-MED-37",
        "name": "TEST Medição Iteration 37",
        "project_type": "manutencao",
        "contracted_value": 10000,
    }
    r = requests.post(f"{BASE_URL}/api/projects", headers=h, json=payload)
    if r.status_code not in (200, 201):
        # try minimal
        r = requests.post(f"{BASE_URL}/api/projects", headers=h, json={"project_code": "TEST-MED-37", "name": "TEST Med"})
    assert r.status_code in (200, 201), r.text
    pid = r.json().get("id") or r.json().get("_id")
    yield pid
    try:
        requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=h)
    except Exception:
        pass


# ---------------- Regression ----------------
class TestRegression:
    def test_auth_me(self, h):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h)
        assert r.status_code == 200

    def test_dashboard_kpis(self, h):
        r = requests.get(f"{BASE_URL}/api/dashboard/kpis", headers=h)
        assert r.status_code == 200
        data = r.json()
        # vencidas items should have project_type (if any items)
        venc = data.get("vencidas") or data.get("overdue") or []
        if isinstance(venc, dict):
            venc = venc.get("items", [])
        for item in venc[:3]:
            assert "project_type" in item or "projectType" in item or "type" in item

    def test_projects_list(self, h):
        r = requests.get(f"{BASE_URL}/api/projects", headers=h)
        assert r.status_code == 200


# ---------------- Medição catálogo ----------------
class TestMedicaoCatalogo:
    created_id = None

    def test_list_catalog(self, h):
        r = requests.get(f"{BASE_URL}/api/medicao/catalogo", headers=h)
        assert r.status_code == 200
        assert isinstance(r.json(), (list, dict))

    def test_create_catalog(self, h):
        payload = {"code": "TEST37-C1", "description": "TEST Serviço 37", "unit": "m", "unit_price": 10.5, "group": "MO"}
        r = requests.post(f"{BASE_URL}/api/medicao/catalogo", headers=h, json=payload)
        assert r.status_code in (200, 201), r.text
        data = r.json()
        TestMedicaoCatalogo.created_id = data.get("id") or data.get("_id")
        assert TestMedicaoCatalogo.created_id
        assert data["description"] == "TEST Serviço 37"

    def test_create_catalog_empty_desc(self, h):
        r = requests.post(f"{BASE_URL}/api/medicao/catalogo", headers=h, json={"code": "X", "description": "", "unit": "m", "unit_price": 1})
        assert r.status_code == 400

    def test_patch_catalog(self, h):
        assert TestMedicaoCatalogo.created_id
        r = requests.patch(f"{BASE_URL}/api/medicao/catalogo/{TestMedicaoCatalogo.created_id}", headers=h, json={"unit_price": 22.5})
        assert r.status_code == 200
        assert float(r.json()["unit_price"]) == 22.5

    def test_import_catalog(self, h):
        csv = "Código;Descrição;Un;Preço Unit\nTEST37-A;TEST Imp A;m;5.0\nTEST37-B;TEST Imp B;un;7.5\n"
        files = {"file": ("cat.csv", csv.encode("utf-8"), "text/csv")}
        r = requests.post(f"{BASE_URL}/api/medicao/catalogo/import", headers=h, files=files, data={"replace": "false"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "imported" in d or "total" in d

    def test_import_catalog_bad(self, h):
        csv = "foo;bar\n1;2\n"
        files = {"file": ("bad.csv", csv.encode("utf-8"), "text/csv")}
        r = requests.post(f"{BASE_URL}/api/medicao/catalogo/import", headers=h, files=files, data={"replace": "false"})
        assert r.status_code == 400

    def test_delete_catalog(self, h):
        assert TestMedicaoCatalogo.created_id
        r = requests.delete(f"{BASE_URL}/api/medicao/catalogo/{TestMedicaoCatalogo.created_id}", headers=h)
        assert r.status_code in (200, 204)

    def test_delete_missing(self, h):
        r = requests.delete(f"{BASE_URL}/api/medicao/catalogo/000000000000000000000000", headers=h)
        assert r.status_code == 404

    def test_cleanup_import(self, h):
        # clean TEST37-* leftovers
        r = requests.get(f"{BASE_URL}/api/medicao/catalogo", headers=h)
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        for it in items:
            if (it.get("code") or "").startswith("TEST37-"):
                iid = it.get("id") or it.get("_id")
                requests.delete(f"{BASE_URL}/api/medicao/catalogo/{iid}", headers=h)


# ---------------- Medição por obra ----------------
class TestMedicaoProjects:
    def test_projects_summary(self, h):
        r = requests.get(f"{BASE_URL}/api/medicao/projects", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert "projects" in d and "totals" in d

    def test_project_medicao_get(self, h, campo_project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{campo_project_id}/medicao", headers=h)
        assert r.status_code == 200
        d = r.json()
        for k in ("project", "budget", "measured", "totals"):
            assert k in d

    def test_project_medicao_404(self, h):
        r = requests.get(f"{BASE_URL}/api/projects/000000000000000000000000/medicao", headers=h)
        assert r.status_code == 404

    def test_put_orcado_and_labor_cost(self, h, test_project):
        payload = {"items": [
            {"description": "TEST Serv A", "unit": "m", "unit_price": 10, "qty": 5, "code": "A"},
            {"description": "TEST Serv B", "unit": "un", "unit_price": 20, "qty": 2, "code": "B"},
        ]}
        r = requests.put(f"{BASE_URL}/api/projects/{test_project}/medicao/orcado", headers=h, json=payload)
        assert r.status_code == 200, r.text
        # verify labor_cost
        rp = requests.get(f"{BASE_URL}/api/projects/{test_project}", headers=h)
        assert rp.status_code == 200
        lc = rp.json().get("labor_cost")
        assert lc is not None
        assert abs(float(lc) - 90.0) < 0.01, f"labor_cost={lc}"

    def test_import_orcado(self, h, test_project):
        csv = "Descrição;Preço;Qtd\nTEST Imp Serv;15;3\n"
        files = {"file": ("orc.csv", csv.encode("utf-8"), "text/csv")}
        r = requests.post(f"{BASE_URL}/api/projects/{test_project}/medicao/orcado/import",
                          headers=h, files=files, data={"replace": "true"})
        assert r.status_code == 200, r.text

    def test_realizado_from_orcado(self, h, test_project):
        r = requests.post(f"{BASE_URL}/api/projects/{test_project}/medicao/realizado/from-orcado", headers=h)
        assert r.status_code in (200, 201)

    def test_put_realizado_and_actual_value(self, h, test_project):
        payload = {"items": [
            {"description": "TEST Real A", "unit": "m", "unit_price": 10, "qty": 4, "code": "RA"},
        ]}
        r = requests.put(f"{BASE_URL}/api/projects/{test_project}/medicao/realizado", headers=h, json=payload)
        assert r.status_code == 200, r.text
        rp = requests.get(f"{BASE_URL}/api/projects/{test_project}", headers=h)
        av = rp.json().get("actual_value")
        assert av is not None
        assert abs(float(av) - 40.0) < 0.01, f"actual_value={av}"

    def test_from_orcado_empty_project(self, h):
        # Create a fresh empty project
        r = requests.post(f"{BASE_URL}/api/projects", headers=h,
                          json={"project_code": "TEST-MED-37B", "name": "TEST Empty"})
        if r.status_code not in (200, 201):
            pytest.skip("cannot create empty project")
        pid = r.json().get("id") or r.json().get("_id")
        try:
            rr = requests.post(f"{BASE_URL}/api/projects/{pid}/medicao/realizado/from-orcado", headers=h)
            assert rr.status_code == 400
        finally:
            requests.delete(f"{BASE_URL}/api/projects/{pid}", headers=h)


# ---------------- Campo histórico ----------------
class TestCampoHistorico:
    def test_historico(self, h, campo_project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{campo_project_id}/campo/historico", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert "days" in d and "totals" in d
        totals = d["totals"]
        assert totals.get("photos") == 22, f"photos={totals.get('photos')}"
        assert totals.get("aprs") == 2
        assert totals.get("requisitions") == 1
        assert totals.get("receipts") == 1
        assert totals.get("checkins") == 1

    def test_historico_404(self, h):
        r = requests.get(f"{BASE_URL}/api/projects/000000000000000000000000/campo/historico", headers=h)
        assert r.status_code == 404


# ---------------- Documentos ----------------
class TestDocumentos:
    def test_documentos(self, h, campo_project_id):
        r = requests.get(f"{BASE_URL}/api/projects/{campo_project_id}/documentos", headers=h)
        assert r.status_code == 200
        d = r.json()
        for k in ("attachments", "aprs", "requisitions", "photos", "counts"):
            assert k in d, f"missing {k}"
        counts = d["counts"]
        assert counts.get("aprs") == 2
        assert counts.get("requisitions") == 1
        assert counts.get("photos") == 22


# ---------------- Attachment ?auth= ----------------
class TestAttachmentAuth:
    def test_dwg_download_with_query_auth(self, h, token, campo_project_id):
        content = os.urandom(3000)
        files = {"file": ("teste.dwg", content, "application/acad")}
        r = requests.post(f"{BASE_URL}/api/projects/{campo_project_id}/attachments",
                          headers=h, files=files, data={"kind": "dwg"})
        assert r.status_code in (200, 201), r.text
        att = r.json()
        att_id = att.get("id") or att.get("_id")
        try:
            # no auth header
            url = f"{BASE_URL}/api/projects/{campo_project_id}/attachments/{att_id}?download=1&auth={token}"
            r2 = requests.get(url)
            assert r2.status_code == 200, r2.text
            assert "attachment" in (r2.headers.get("Content-Disposition") or "").lower()
            assert "teste.dwg" in (r2.headers.get("Content-Disposition") or "")
            assert r2.content == content

            # no auth at all
            r3 = requests.get(f"{BASE_URL}/api/projects/{campo_project_id}/attachments/{att_id}?download=1")
            assert r3.status_code == 401
        finally:
            requests.delete(f"{BASE_URL}/api/projects/{campo_project_id}/attachments/{att_id}", headers=h)


# ---------------- PDF jobs ----------------
class TestPdfJobs:
    def test_daily_log_photos(self, h, campo_project_id):
        r = requests.get(f"{BASE_URL}/api/operacional/daily-log/{campo_project_id}/photos", headers=h)
        assert r.status_code == 200
        d = r.json()
        assert d.get("count") == 22

    def test_daily_log_job_flow(self, h, token, campo_project_id):
        payload = {"notes": "TEST37", "max_photos": 500}
        r = requests.post(f"{BASE_URL}/api/operacional/daily-log/{campo_project_id}/job", headers=h, json=payload)
        assert r.status_code in (200, 201), r.text
        job = r.json()
        job_id = job.get("id")
        assert job_id
        assert job.get("status") in ("queued", "running", "done")

        # poll
        done = False
        for _ in range(60):
            rr = requests.get(f"{BASE_URL}/api/pdf-jobs/{job_id}", headers=h)
            assert rr.status_code == 200
            jd = rr.json()
            if jd.get("status") == "done":
                assert jd.get("pct") == 100
                assert (jd.get("size") or 0) > 0
                assert jd.get("download_url")
                done = True
                break
            if jd.get("status") == "error":
                pytest.fail(f"Job failed: {jd}")
            time.sleep(1.5)
        assert done, "PDF job did not finish in time"

        # download with Authorization
        rd = requests.get(f"{BASE_URL}/api/pdf-jobs/{job_id}/download", headers=h)
        assert rd.status_code == 200
        assert rd.headers.get("Content-Type", "").startswith("application/pdf")
        assert "attachment" in (rd.headers.get("Content-Disposition") or "").lower()
        assert rd.content[:4] == b"%PDF"

        # download with ?auth=
        rd2 = requests.get(f"{BASE_URL}/api/pdf-jobs/{job_id}/download?auth={token}")
        assert rd2.status_code == 200
        assert rd2.content[:4] == b"%PDF"

    def test_pdf_job_missing(self, h):
        r = requests.get(f"{BASE_URL}/api/pdf-jobs/nope-missing", headers=h)
        assert r.status_code == 404

    def test_pdf_job_not_ready_409(self, h, campo_project_id):
        # start new job, immediately try download
        r = requests.post(f"{BASE_URL}/api/operacional/daily-log/{campo_project_id}/job", headers=h,
                          json={"notes": "TEST37-409", "max_photos": 500})
        assert r.status_code in (200, 201)
        jid = r.json().get("id")
        # try download fast
        rd = requests.get(f"{BASE_URL}/api/pdf-jobs/{jid}/download", headers=h)
        # may be done quickly; accept 200 or 409
        assert rd.status_code in (200, 409)

    def test_avanco_pdf_job(self, h, campo_project_id):
        r = requests.post(f"{BASE_URL}/api/projects/{campo_project_id}/avanco/pdf/job",
                          headers=h, json={"photo_ids": None})
        assert r.status_code in (200, 201), r.text
        job_id = r.json().get("id")
        done = False
        for _ in range(60):
            rr = requests.get(f"{BASE_URL}/api/pdf-jobs/{job_id}", headers=h)
            jd = rr.json()
            if jd.get("status") == "done":
                done = True
                break
            if jd.get("status") == "error":
                pytest.fail(f"Avanço job failed: {jd}")
            time.sleep(1.5)
        assert done
        rd = requests.get(f"{BASE_URL}/api/pdf-jobs/{job_id}/download", headers=h)
        assert rd.status_code == 200
        assert rd.content[:4] == b"%PDF"
