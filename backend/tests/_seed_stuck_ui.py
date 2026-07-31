"""Seed a stuck project (billing_stage=ajuste_material for 20+ days) and print its ID.
Used for manual UI E2E verification of Radar de Backlog."""
import asyncio, os, sys
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "seed"
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    if mode == "cleanup":
        r = await db.projects.delete_many({"name": {"$regex": "^TEST_UI_STUCK"}})
        print(f"cleaned {r.deleted_count}")
        client.close()
        return
    admin = await db.users.find_one({"email": "admin@projectmatrix.com"})
    admin_id = str(admin["_id"])
    now = datetime.now(timezone.utc)
    hist = [
        {"stage": "recebimento_tecnico", "changed_at": (now - timedelta(days=40)).isoformat(), "changed_by": admin_id, "notes": "seed"},
        {"stage": "em_fechamento",       "changed_at": (now - timedelta(days=30)).isoformat(), "changed_by": admin_id, "notes": "seed"},
        {"stage": "ajuste_material",     "changed_at": (now - timedelta(days=22)).isoformat(), "changed_by": admin_id, "notes": "seed"},
    ]
    doc = {
        "name": "TEST_UI_STUCK_RADAR",
        "project_code": f"TSTUCK-UI-{int(now.timestamp()) % 10**8}",
        "team_id": "", "team_name": "", "user_id": admin_id,
        "programmed_value": 42500.0, "actual_value": 0, "billing_value": 0,
        "start_date": (now - timedelta(days=60)).strftime("%Y-%m-%d"),
        "end_date": (now - timedelta(days=45)).strftime("%Y-%m-%d"),
        "execution_status": "concluido", "priority": "normal",
        "billing_stage": "ajuste_material",
        "billing_history": hist,
        "invoice_number": "", "invoice_date": "", "invoice_value": 0,
        "photos": [], "materials": [], "schedule_entries": [],
    }
    res = await db.projects.insert_one(doc)
    print(str(res.inserted_id))
    client.close()

asyncio.run(main())
