"""Seed idempotente: obras com schedule_entries de HOJE (prefixo OPHOJE-) + 1 equipamento vinculado."""
import os, asyncio
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
ADMIN = os.environ.get("ADMIN_EMAIL", "lucasc.cuiaba02@gmail.com")


def d(offset=0):
    return (datetime.now(ZoneInfo("America/Cuiaba")) + timedelta(days=offset)).strftime("%Y-%m-%d")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    u = await db.users.find_one({"email": ADMIN})
    uid = str(u["_id"])
    teams = await db.teams.find({"user_id": uid}).to_list(10)
    if len(teams) < 2:
        for n in ["Equipe Alpha", "Equipe Bravo"]:
            if not any(t["name"] == n for t in teams):
                r = await db.teams.insert_one({"name": n, "members": ["A", "B"], "supervisor": "Sup", "member_count": 2, "daily_target": 4000.0, "created_at": datetime.now(timezone.utc), "user_id": uid})
                teams.append({"_id": r.inserted_id, "name": n})
    t1, t2 = teams[0], teams[1]
    await db.projects.delete_many({"user_id": uid, "project_code": {"$regex": "^OPHOJE-"}})
    await db.equipamentos.delete_many({"user_id": uid, "patrimonio": "PAT-OPHOJE"})

    def base(code, name, status, entries, **extra):
        doc = {
            "user_id": uid, "name": name, "project_code": code, "execution_status": status,
            "programmed_value": 10000.0, "actual_value": 0.0, "project_type": "anexo_iv",
            "team_id": str(entries[0]["team_ids"][0]), "team_name": entries[0]["team_names"][0],
            "start_date": entries[0]["date"], "end_date": entries[-1]["date"], "expiry_date": d(20),
            "location": "CUIABÁ", "status": "active", "priority": "medium", "is_scheduled": True,
            "schedule_entries": entries, "created_at": datetime.now(timezone.utc), "billing_history": [],
        }
        doc.update(extra)
        return doc

    e = lambda day, *ts: {"date": day, "team_ids": [str(t["_id"]) for t in ts], "team_names": [t["name"] for t in ts]}
    docs = [
        # Hoje com 2 equipes
        base("OPHOJE-01", "Hoje duas equipes", "programado", [e(d(0), t1, t2)], requires_hot_line=True, shutdown_dates=[d(0)], shutdown_info="Desligamento 8h-12h"),
        # Multi-data: ontem + hoje (só equipe t2 hoje)
        base("OPHOJE-02", "Multi-data ontem e hoje", "em_execucao", [e(d(-1), t1), e(d(0), t2)]),
        # Intervalo que inclui hoje mas SEM entrada de hoje → NÃO deve aparecer
        base("OPHOJE-03", "Intervalo sem hoje", "programado", [e(d(-2), t1), e(d(2), t1)]),
        # Hoje mas concluída → NÃO deve aparecer
        base("OPHOJE-04", "Hoje concluida", "concluido", [e(d(0), t1)]),
        # Amanhã → não aparece
        base("OPHOJE-05", "Amanha", "programado", [e(d(1), t2)]),
    ]
    res = await db.projects.insert_many(docs)
    p1_id = str(res.inserted_ids[0])
    await db.equipamentos.insert_one({
        "user_id": uid, "tipo": "transformador", "patrimonio": "PAT-OPHOJE", "numero_serie": "SN-1", "codigo_material": "90588",
        "descricao": "Trafo 75kVA vinculado", "potencia": "75 kVA", "data_fabricacao": "", "condicao": "novo", "fabricante": "WEG",
        "tensao_primaria": "13.8", "tensao_secundaria": "220", "notas": "", "project_id": p1_id, "project_code": "OPHOJE-01",
        "project_name": "Hoje duas equipes", "photos": [], "created_at": datetime.now(timezone.utc), "created_by": "seed",
    })
    print("seeded", len(docs), "projects; teams:", t1["name"], t2["name"], "; today", d(0), "; p1", p1_id)


asyncio.run(main())
