"""Iteration 40 — Catálogo de M.O. carregado da Tabela Contratual (LM/LV, +6%)."""
import os
import pytest
import requests

def _load_env():
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return os.environ.get("REACT_APP_BACKEND_URL", "")

BASE_URL = _load_env().rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
ADMIN_MAIN = {"email": "lucasc.cuiaba02@gmail.com", "password": "Hayah$152610"}
ADMIN_SANDBOX = {"email": "admin@projectmatrix.com", "password": "Admin@123"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_MAIN)


@pytest.fixture(scope="module")
def sandbox():
    return _login(ADMIN_SANDBOX)


# ── Info endpoint ────────────────────────────────────────────────────────────
def test_tabela_info_admin(admin):
    r = admin.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["rows"] == 707
    assert d["lm"] == 453
    assert d["lv"] == 254
    assert d["loaded"] == 707
    assert d["pct"] == 6.0
    assert d["seeded_at"]


def test_tabela_info_requires_auth():
    r = requests.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30)
    assert r.status_code == 401


# ── Catalog shape and math ──────────────────────────────────────────────────
def test_catalog_707_and_math(admin):
    r = admin.get(f"{BASE_URL}/api/medicao/catalogo", timeout=60)
    assert r.status_code == 200
    d = r.json()
    assert d["count"] == 707
    items = d["items"]
    assert len(items) == 707

    # Field assertions on each
    bad_math = []
    bad_lm_ups = []
    bad_lv_ups = []
    missing_fields = []
    bad_codes = []
    for it in items:
        for f in ["code", "description", "unit", "unit_price", "group", "action", "linha",
                  "ups", "base_price", "adjust_pct", "source"]:
            if f not in it:
                missing_fields.append((it.get("code"), f))
        if not (it["code"].endswith("-I") or it["code"].endswith("-R")):
            bad_codes.append(it["code"])
        if it["action"] not in ("INSTALAR", "RETIRAR"):
            bad_codes.append((it["code"], "action", it["action"]))
        if it["linha"] not in ("LM", "LV"):
            bad_codes.append((it["code"], "linha", it["linha"]))
        if it["source"] != "tabela_contrato_2026":
            bad_codes.append((it["code"], "source", it["source"]))
        if it["adjust_pct"] != 6:
            bad_codes.append((it["code"], "pct", it["adjust_pct"]))
        expected = round(float(it["base_price"]) * 1.06, 2)
        if abs(expected - float(it["unit_price"])) > 0.01:
            bad_math.append((it["code"], it["base_price"], it["unit_price"], expected))
        if it["linha"] == "LM":
            ref = float(it["ups"]) * 91.61
            tol = max(0.5, ref * 0.02)
            if abs(ref - float(it["base_price"])) > tol:
                bad_lm_ups.append((it["code"], it["ups"], it["base_price"], ref))
        else:
            ref = float(it["ups"]) * 251.61
            tol = max(1.3, ref * 0.02)
            if abs(ref - float(it["base_price"])) > tol:
                bad_lv_ups.append((it["code"], it["ups"], it["base_price"], ref))

    assert not missing_fields, f"Missing fields: {missing_fields[:5]}"
    assert not bad_codes, f"Bad code/action/linha/source/pct: {bad_codes[:5]}"
    assert not bad_math, f"Bad math (unit_price != base*1.06): {bad_math[:5]}"
    assert not bad_lm_ups, f"Bad LM ups math: {bad_lm_ups[:5]}"
    assert not bad_lv_ups, f"Bad LV ups math: {bad_lv_ups[:5]}"


def test_catalog_known_samples(admin):
    r = admin.get(f"{BASE_URL}/api/medicao/catalogo", timeout=60)
    items = r.json()["items"]
    by_code = {it["code"]: it for it in items}

    # No raw '6243' (old catalog removed)
    assert "6243" not in by_code

    # 6950-I LM: base 1705.78 → 1808.13, group CONDUTORES/CONEXÕES, unit KM
    a = by_code.get("6950-I")
    assert a is not None, "6950-I missing"
    assert abs(a["base_price"] - 1705.78) < 0.01
    assert abs(a["unit_price"] - 1808.13) < 0.01
    assert "CONDUTORES/CONEX" in a["group"].upper()
    assert a["linha"] == "LM"
    assert a["action"] == "INSTALAR"

    # 6950-R: base 731.05 → 774.91
    b = by_code.get("6950-R")
    assert b is not None
    assert abs(b["base_price"] - 731.05) < 0.01
    assert abs(b["unit_price"] - 774.91) < 0.01
    assert b["action"] == "RETIRAR"

    # 6724-I LV: base 1132.25 → 1200.19, group starts with 'LV · '
    c = by_code.get("6724-I")
    assert c is not None
    assert abs(c["base_price"] - 1132.25) < 0.01
    assert abs(c["unit_price"] - 1200.19) < 0.01
    assert c["linha"] == "LV"
    assert c["group"].startswith("LV ·")
    assert "POSTE" in c["group"].upper()

    # 6243-I LM, POSTE
    d = by_code.get("6243-I")
    assert d is not None
    assert d["linha"] == "LM"
    assert "POSTE" in d["group"].upper()
    assert not d["group"].startswith("LV ·")


# ── Reload endpoint (restore to 6% after modifications) ─────────────────────
def test_reload_pct_10_then_6(admin):
    r = admin.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                   json={"pct": 10, "replace": True}, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["imported"] == 707
    assert d["total"] == 707
    assert d["pct"] == 10

    # Verify unit_price now base*1.10
    cat = admin.get(f"{BASE_URL}/api/medicao/catalogo", timeout=60).json()["items"]
    sample = next(i for i in cat if i["code"] == "6950-I")
    assert abs(sample["unit_price"] - round(1705.78 * 1.10, 2)) < 0.02
    assert sample["adjust_pct"] == 10

    info = admin.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30).json()
    assert info["pct"] == 10
    assert info["seeded_at"]

    # Restore to 6%
    r2 = admin.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                    json={"pct": 6, "replace": True}, timeout=60)
    assert r2.status_code == 200
    assert r2.json()["pct"] == 6
    cat2 = admin.get(f"{BASE_URL}/api/medicao/catalogo", timeout=60).json()["items"]
    s2 = next(i for i in cat2 if i["code"] == "6950-I")
    assert abs(s2["unit_price"] - 1808.13) < 0.01


def test_reload_pct_out_of_range(admin):
    r = admin.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                   json={"pct": 150, "replace": True}, timeout=30)
    assert r.status_code == 400


def test_reload_requires_auth():
    r = requests.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                      json={"pct": 6, "replace": True}, timeout=30)
    assert r.status_code == 401


# ── Workspace isolation ─────────────────────────────────────────────────────
def test_sandbox_admin_isolated(sandbox, admin):
    r = sandbox.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["loaded"] == 707
    assert d["pct"] == 6.0

    # Change sandbox pct to 8, verify admin remains 6
    s2 = sandbox.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                      json={"pct": 8, "replace": True}, timeout=60)
    assert s2.status_code == 200
    assert s2.json()["pct"] == 8

    admin_info = admin.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30).json()
    assert admin_info["pct"] == 6.0

    # Restore sandbox
    sandbox.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
                 json={"pct": 6, "replace": True}, timeout=60)
    si = sandbox.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30).json()
    assert si["pct"] == 6.0


# ── Integration: medicao realizado with catalog item ────────────────────────
def test_medicao_integration_with_catalog(admin):
    # Pick any admin project
    pr = admin.get(f"{BASE_URL}/api/medicao/projects", timeout=30).json()
    projects = pr.get("projects") or []
    if not projects:
        pytest.skip("No admin projects to test integration")
    pid = projects[0]["id"]

    # Save original state so we can restore
    orig = admin.get(f"{BASE_URL}/api/projects/{pid}/medicao", timeout=30).json()
    orig_measured = orig.get("measured") or []

    # Get catalog_id for 6950-I
    cat = admin.get(f"{BASE_URL}/api/medicao/catalogo", timeout=60).json()["items"]
    item = next(i for i in cat if i["code"] == "6950-I")

    body = {"items": [{
        "catalog_id": item["id"], "code": "6950-I",
        "description": item["description"], "unit": item["unit"],
        "unit_price": 1808.13, "qty": 2, "group": item["group"],
    }]}
    try:
        r = admin.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", json=body, timeout=30)
        assert r.status_code == 200, r.text

        g = admin.get(f"{BASE_URL}/api/projects/{pid}/medicao", timeout=30).json()
        measured = g["measured"]
        assert len(measured) == 1
        assert abs(measured[0]["total"] - 3616.26) < 0.01

        # PDF
        pdf = admin.get(f"{BASE_URL}/api/projects/{pid}/medicao/pdf", timeout=60)
        assert pdf.status_code == 200
        assert pdf.headers.get("content-type", "").startswith("application/pdf")
        assert len(pdf.content) > 500
    finally:
        # Restore original measured state
        restore = {"items": [{
            "catalog_id": m.get("catalog_id", ""), "code": m.get("code", ""),
            "description": m.get("description", ""), "unit": m.get("unit", "UN"),
            "unit_price": float(m.get("unit_price") or 0), "qty": float(m.get("qty") or 0),
            "group": m.get("group", ""),
        } for m in orig_measured]}
        admin.put(f"{BASE_URL}/api/projects/{pid}/medicao/realizado", json=restore, timeout=30)


# ── Final cleanup: ensure both admins at 6% ─────────────────────────────────
def test_final_restore_both_at_6pct(admin, sandbox):
    for s in (admin, sandbox):
        s.post(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato",
               json={"pct": 6, "replace": True}, timeout=60)
        info = s.get(f"{BASE_URL}/api/medicao/catalogo/tabela-contrato", timeout=30).json()
        assert info["pct"] == 6.0
        assert info["loaded"] == 707
