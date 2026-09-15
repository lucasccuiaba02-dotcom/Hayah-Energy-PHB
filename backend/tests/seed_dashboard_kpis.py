"""Seed idempotente de obras para validar KPIs do Dashboard (prefixo DASHKPI-)."""
import os, asyncio
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
ADMIN = os.environ.get("ADMIN_EMAIL", "lucasc.cuiaba02@gmail.com")


def d(offset):
    return (datetime.now(timezone.utc) + timedelta(days=offset)).strftime("%Y-%m-%d")


def iso(offset):
    return (datetime.now(timezone.utc) + timedelta(days=offset)).isoformat()


def base(code, name, status, prog, actual=0.0, **extra):
    doc = {
        "name": name, "project_code": code, "execution_status": status,
        "programmed_value": prog, "actual_value": actual, "billing_value": 0.0,
        "project_type": "anexo_iv", "team_name": "Equipe Alpha", "location": "CUIABÁ",
        "start_date": d(-10), "end_date": d(-5), "expiry_date": "", "received_date": "",
        "status": "active", "priority": "medium", "is_scheduled": status in ("programado", "em_execucao", "executada", "concluido"),
        "created_at": datetime.now(timezone.utc), "billing_history": [], "schedule_entries": [],
    }
    doc.update(extra)
    return doc


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    u = await db.users.find_one({"email": ADMIN})
    uid = str(u["_id"])
    await db.projects.delete_many({"user_id": uid, "project_code": {"$regex": "^DASHKPI-"}})
    month_start = datetime.now(timezone.utc).strftime("%Y-%m-01")
    docs = [
        # Vencidas (expiry passado, status ativo)
        base("DASHKPI-01", "Vencida aguardando", "aguardando_programacao", 50000, expiry_date=d(-12), received_date=d(-40)),
        base("DASHKPI-02", "Vencida a reprogramar", "a_reprogramar", 30000, expiry_date=d(-3)),
        # NÃO vencidas apesar de expiry passado (status inativos)
        base("DASHKPI-03", "Concluída expirada", "concluido", 40000, 42000, expiry_date=d(-20), execution_finished_at=iso(-25), billing_stage="pago",
             received_date=d(-60), schedule_entries=[{"date": d(-35)}, {"date": d(-30)}],
             billing_history=[{"stage": "recebimento_tecnico", "changed_at": iso(-24)}, {"stage": "em_fechamento", "changed_at": iso(-20)}, {"stage": "pago", "changed_at": iso(-2)}]),
        base("DASHKPI-04", "Suspensa expirada", "suspenso", 15000, expiry_date=d(-5), cancel_reason="Aguardando liberação"),
        base("DASHKPI-05", "Cancelada expirada", "cancelado", 25000, expiry_date=d(-8), cancel_reason="Cliente desistiu"),
        base("DASHKPI-06", "Executada expirada", "executada", 20000, 19000, expiry_date=d(-2), execution_finished_at=iso(-1)),
        # Vencendo amanhã / no prazo
        base("DASHKPI-07", "Vence amanhã", "programado", 60000, expiry_date=d(1), start_date=d(0), end_date=d(0)),
        base("DASHKPI-08", "No prazo em execução", "em_execucao", 70000, 20000, expiry_date=d(30)),
        # Sem expiry_date com end_date passado → NÃO conta como vencida
        base("DASHKPI-09", "Sem vencimento cadastrado", "aguardando_programacao", 10000, end_date=d(-30)),
        # Concluída no mês, ainda não paga (pendente)
        base("DASHKPI-10", "Concluída pendente", "concluido", 80000, 78000, expiry_date=d(15), execution_finished_at=iso(-3), billing_stage="em_fechamento",
             received_date=d(-30), schedule_entries=[{"date": d(-8)}],
             billing_history=[{"stage": "recebimento_tecnico", "changed_at": iso(-3)}, {"stage": "em_fechamento", "changed_at": iso(-1)}]),
    ]
    for x in docs:
        x["user_id"] = uid
    await db.projects.insert_many(docs)
    print(f"seeded {len(docs)} projects for {ADMIN}")


asyncio.run(main())
