"""Tabela contratual de preços (Linha Morta + Linha Viva) → catálogo de mão de obra da Medição."""
import csv
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

TABELA_PATH = Path(__file__).parent / "data" / "tabela_precos_contrato.tsv"
SOURCE = "tabela_contrato_2026"
DEFAULT_PCT = 6.0
UPS_VALUE = {"LM": 91.61, "LV": 251.61}

# ordem importa: a primeira regra que casar define o grupo
GROUP_RULES = [
    ("TRANSPORTE/DESLOCAMENTO", ["TRANSPORTE", "CAVALO MEC", "KM RODADO", "DIARIA", "HOSPEDAGEM", "HORA DO COLAB"]),
    ("PODA/FAIXA", ["PODA", "FAIXA", "ARVORE", "VEGETAC"]),
    ("CAVA/FUNDACAO/CALCADA", ["CAVA", "BASE CONC", "CALC", "VALETA", "VAL ATER", "CXS PASS", "SOLO CIMENTO", "SAPATA", "CX CP", "CX OP"]),
    ("CERCA", ["CERCA"]),
    ("ATERRAMENTO", ["ATER", "HASTE", "HST "]),
    ("ILUMINACAO PUBLICA", ["ILUM", "LUMIN", "REATOR", "RELE FOTO"]),
    ("MEDICAO/CONSUMIDOR", ["MEDICAO", "MED ", "MEDIDOR", "PADRAO", "PADR ", "KIT INST", "LACRE", "CX MED", "BAIX RENDA"]),
    ("CONDUTORES/CONEXOES", ["CABO", "CONDUT", "COND ", "CB ", "MULTIPLEX", "EMEND", "CONEC", "CONEX", "JUMPER", "JUMP", "FLY TAP", "CRUZAM ",
                            "CRUZAMENTO", "RAMAL", "ESPAC", "SEPARADOR", "AMARR", "COBERT", "AFAST", "GRAMPO", "ESP LO", "BALANC", "ELETRODUTO"]),
    ("CHAVES/FUSIVEIS", ["CHAVE", "CHAV ", "CH ", "FUSIVEL", "FUSIV", "FUS ", "SECCIONADORA", "ELO FUS", "PORTA FUS"]),
    ("PARA-RAIOS", ["PARA-RAIO", "PARA RAIO", "PARARAIO"]),
    ("ESTRUTURAS", ["ESTRUT", "ESTR ", "ESTR.", "EST PRIM", "EST SEC", "EST N", "EST TIPO", "CRUZ", "CRZ", "ISOLADOR", "CADEIA", "ESTAI", "MAO FRANC",
                    "OLHAL", "PINO", "ESTRIBO", "MUFLA", "PLATAFORMA", "BRACO", "TRANSFORMAR", "BISSETRIZ", "APRUMAR", "SEQU FASE", "SEQUENCIA FASE"]),
    ("POSTE", ["POSTE", "PST", "LOCACAO"]),
    ("TRANSFORMADORES", ["TRANSF", "TRAFO"]),
    ("EQUIPAMENTOS (RELIG/REGUL/CAPACITOR)", ["RELIG", "REGUL", "REG TENS", "CAPACIT", "BCO CAPAC"]),
]
GROUP_FALLBACK = "SERVICOS GERAIS"
GROUP_LABEL = {
    "CAVA/FUNDACAO/CALCADA": "CAVA/FUNDAÇÃO/CALÇADA", "ILUMINACAO PUBLICA": "ILUMINAÇÃO PÚBLICA", "MEDICAO/CONSUMIDOR": "MEDIÇÃO/CONSUMIDOR",
    "CONDUTORES/CONEXOES": "CONDUTORES/CONEXÕES", "CHAVES/FUSIVEIS": "CHAVES/FUSÍVEIS", "SERVICOS GERAIS": "SERVIÇOS GERAIS",
}


def _plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn").upper()


def _num(s: str) -> float:
    s = (s or "").strip().replace("R$", "").replace(" ", "")
    return float(s.replace(".", "").replace(",", ".")) if s else 0.0


def classify_group(description: str) -> str:
    d = f" {_plain(description)} "
    for group, keys in GROUP_RULES:
        if any(k in d for k in keys):
            return GROUP_LABEL.get(group, group)
    return GROUP_LABEL[GROUP_FALLBACK]


def load_tabela() -> list[dict]:
    with open(TABELA_PATH, encoding="utf-8", newline="") as fh:
        rows = list(csv.DictReader(fh, delimiter="\t"))
    out = []
    for r in rows:
        action = (r["acao"] or "").strip().upper()
        out.append({"code": r["codigo"].strip(), "description": re.sub(r"\s+", " ", r["descricao"]).strip(), "unit": (r["unidade"] or "UN").strip().upper()[:10],
                    "action": action, "ups": _num(r["ups"]), "base_price": round(_num(r["preco"]), 2), "linha": (r["linha"] or "LM").strip().upper()})
    return out


def build_catalog_docs(user_id, pct: float = DEFAULT_PCT, now: str | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc).isoformat()
    factor = 1 + float(pct) / 100
    docs = []
    for r in load_tabela():
        group = classify_group(r["description"])
        docs.append({
            "user_id": user_id,
            "code": f"{r['code']}-{'I' if r['action'] == 'INSTALAR' else 'R'}",
            "base_code": r["code"], "action": r["action"], "linha": r["linha"],
            "description": r["description"], "unit": r["unit"],
            "unit_price": round(r["base_price"] * factor, 2), "base_price": r["base_price"], "ups": r["ups"],
            "ups_value": UPS_VALUE.get(r["linha"], UPS_VALUE["LM"]), "adjust_pct": float(pct),
            "group": group if r["linha"] == "LM" else f"LV · {group}",
            "source": SOURCE, "created_at": now, "updated_at": now,
        })
    return docs


async def seed_catalog(db, user_id, pct: float = DEFAULT_PCT, replace: bool = True) -> dict:
    """Carrega a tabela contratual no catálogo do usuário (+pct%). replace=True apaga o catálogo atual antes."""
    docs = build_catalog_docs(user_id, pct)
    if replace:
        removed = (await db.labor_catalog.delete_many({"user_id": user_id})).deleted_count
    else:
        removed = (await db.labor_catalog.delete_many({"user_id": user_id, "source": SOURCE})).deleted_count
    if docs:
        await db.labor_catalog.insert_many(docs)
    total = await db.labor_catalog.count_documents({"user_id": user_id})
    return {"imported": len(docs), "removed": removed, "total": total, "pct": float(pct),
            "lm": sum(1 for d in docs if d["linha"] == "LM"), "lv": sum(1 for d in docs if d["linha"] == "LV")}


async def seed_once_for_admins(db, logger=None) -> None:
    """Startup: 1ª carga automática (substitui o catálogo) por workspace admin, controlada por app_settings."""
    async for u in db.users.find({"role": "admin"}, {"_id": 1, "email": 1}):
        uid = str(u["_id"])
        flag = {"key": "labor_catalog_seed", "user_id": uid, "source": SOURCE}
        if await db.app_settings.find_one(flag):
            continue
        res = await seed_catalog(db, uid, DEFAULT_PCT, replace=True)
        await db.app_settings.insert_one({**flag, "result": res, "at": datetime.now(timezone.utc).isoformat()})
        if logger:
            logger.info(f"Catálogo de M.O. carregado da tabela contratual (+{DEFAULT_PCT:.0f}%) para {u.get('email')}: {res}")
