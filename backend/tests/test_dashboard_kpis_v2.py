"""Backend tests for the iter24 Dashboard KPIs revamp.

Covers:
- counts.vencidas based on expiry_date (excluding concluido/executada/suspenso/cancelado
  and projects without expiry_date)
- carteira block: apta / nao_apta / programadas / concluidas + total
- financeiro: valor_faturado, valor_pendente_faturamento, meta_mes/receita_realizada
- tempo_medio.* = {avg, samples}
- /api/analytics/manager-kpis regression (overdue uses expiry_date)
"""
import os
import datetime as dt
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back for local runs
    from dotenv import load_dotenv
    load_dotenv("/app/frontend/.env")
    BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN_EMAIL = "lucasc.cuiaba02@gmail.com"
ADMIN_PASSWORD = "Hayah$152610"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def kpis(headers):
    r = requests.get(f"{BASE_URL}/api/dashboard/kpis", headers=headers, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Vencidas ----------
class TestVencidas:
    def test_counts_present(self, kpis):
        assert "counts" in kpis
        assert "vencidas" in kpis["counts"]
        assert "vencendo_amanha" in kpis["counts"]

    def test_vencidas_only_expiry_based_and_active(self, kpis):
        today = dt.date.today().isoformat()
        INACTIVE = {"executada", "concluido", "cancelado", "suspenso"}
        for v in kpis["vencidas"]:
            assert v.get("expiry_date"), f"vencida item missing expiry_date: {v.get('project_code')}"
            assert v["expiry_date"][:10] < today, v
            assert v.get("execution_status") not in INACTIVE, v
            assert "dias_vencida" in v
            assert v["dias_vencida"] >= 1

    def test_seed_vencidas_expected(self, kpis):
        codes = {v["project_code"] for v in kpis["vencidas"]}
        # Expected from seed: DASHKPI-01 and DASHKPI-02
        assert "DASHKPI-01" in codes
        assert "DASHKPI-02" in codes
        # Not vencidas because status is inactive
        for c in ("DASHKPI-03", "DASHKPI-04", "DASHKPI-05", "DASHKPI-06"):
            assert c not in codes, f"{c} should not be listed as vencida (inactive status)"
        # No expiry_date → not vencida
        assert "DASHKPI-09" not in codes

    def test_vencendo_amanha(self, kpis):
        tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
        codes = {v["project_code"] for v in kpis.get("vencendo_amanha_list", [])}
        assert "DASHKPI-07" in codes
        for v in kpis.get("vencendo_amanha_list", []):
            assert v["expiry_date"][:10] == tomorrow


# ---------- Carteira ----------
class TestCarteira:
    def test_shape(self, kpis):
        c = kpis["carteira"]
        for key in ("apta", "nao_apta", "programadas", "concluidas", "total"):
            assert key in c, key
        for key in ("apta", "nao_apta", "programadas", "concluidas"):
            for f in ("count", "value", "actual_value", "pct_count", "pct_value", "statuses"):
                assert f in c[key], f"{key}.{f}"

    def test_counts_partition_total(self, kpis):
        c = kpis["carteira"]
        parts = c["apta"]["count"] + c["nao_apta"]["count"] + c["programadas"]["count"] + c["concluidas"]["count"]
        assert parts == c["total"]["count"], f"sum={parts} total={c['total']['count']}"

    def test_pct_count_sum(self, kpis):
        c = kpis["carteira"]
        if c["total"]["count"]:
            s = c["apta"]["pct_count"] + c["nao_apta"]["pct_count"] + c["programadas"]["pct_count"] + c["concluidas"]["pct_count"]
            assert 99.0 <= s <= 101.0, s


# ---------- Financeiro ----------
class TestFinanceiro:
    def test_shape(self, kpis):
        f = kpis["financeiro"]
        for k in ("valor_faturado", "faturado_count", "valor_pendente_faturamento",
                  "pendente_count", "receita_realizada", "receita_pct",
                  "meta_mes", "pago_mes", "pago_mes_count"):
            assert k in f, k

    def test_meta_mes_default(self, kpis):
        # No contract_targets seeded → default 336000
        assert kpis["financeiro"]["meta_mes"] == 336000.0

    def test_pago_and_pendente_from_seed(self, kpis):
        f = kpis["financeiro"]
        # DASHKPI-03 is paid (actual_value 42000)
        assert f["faturado_count"] >= 1
        assert f["valor_faturado"] >= 42000
        # DASHKPI-10 is concluido and NOT paid (actual 78000) → pendente
        assert f["pendente_count"] >= 1
        assert f["valor_pendente_faturamento"] >= 78000


# ---------- Tempo Médio ----------
class TestTempoMedio:
    def test_shape(self, kpis):
        tm = kpis["tempo_medio"]
        for k in ("recebimento_programacao", "programacao_execucao",
                  "execucao_fechamento", "fechamento_faturamento"):
            assert k in tm
            assert "avg" in tm[k] and "samples" in tm[k]
            assert isinstance(tm[k]["samples"], int)

    def test_samples_positive_with_seed(self, kpis):
        tm = kpis["tempo_medio"]
        # Seed DASHKPI-03 has received_date, schedule_entries, execution_finished_at,
        # billing_history covering em_fechamento and pago → all 4 windows should have samples>=1
        for k in ("recebimento_programacao", "programacao_execucao",
                  "execucao_fechamento", "fechamento_faturamento"):
            assert tm[k]["samples"] >= 1, f"{k} samples=0 (expected >=1 from DASHKPI-03)"


# ---------- Regression: manager-kpis still works ----------
class TestManagerKpisRegression:
    def test_endpoint_200(self, headers):
        r = requests.get(f"{BASE_URL}/api/analytics/manager-kpis", headers=headers, timeout=20)
        assert r.status_code == 200, r.text
        js = r.json()
        # Should contain 'operational' with 'overdue'
        assert "operational" in js
        assert "overdue" in js["operational"]
