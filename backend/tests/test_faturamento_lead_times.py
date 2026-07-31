"""Integration test: validates lead_times + stuck_projects fields returned by
GET /api/faturamento/pipeline. Seeds a project with billing_history entries backdated
20+ days to trigger the stuck flag."""
import os
import asyncio
from datetime import datetime, timezone, timedelta

import httpx
import pytest
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')

BACKEND_URL = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
API = BACKEND_URL.rstrip("/") + ("" if BACKEND_URL.endswith("/api") else "/api")
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

ADMIN_EMAIL = "admin@projectmatrix.com"
ADMIN_PWD = "Admin@123"


def _login():
    r = httpx.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    r.raise_for_status()
    return r.json()


async def _seed_stuck_project(admin_id: str) -> str:
    """Insert a project directly with 3 billing_history entries at fixed dates
    so that today - entered_stage_at > 15 days. Returns project _id."""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    now = datetime.now(timezone.utc)
    hist = [
        {"stage": "recebimento_tecnico", "changed_at": (now - timedelta(days=40)).isoformat(), "changed_by": admin_id, "notes": "seed"},
        {"stage": "em_fechamento",       "changed_at": (now - timedelta(days=30)).isoformat(), "changed_by": admin_id, "notes": "seed"},
        {"stage": "ajuste_material",     "changed_at": (now - timedelta(days=20)).isoformat(), "changed_by": admin_id, "notes": "seed"},
    ]
    doc = {
        "name": "TEST_LEAD_STUCK",
        "project_code": f"TSTUCK-{int(now.timestamp()) % 10**8}",
        "team_id": "",
        "team_name": "",
        "user_id": admin_id,
        "programmed_value": 25000.0,
        "actual_value": 0,
        "billing_value": 0,
        "start_date": (now - timedelta(days=60)).strftime("%Y-%m-%d"),
        "end_date": (now - timedelta(days=45)).strftime("%Y-%m-%d"),
        "execution_status": "concluido",
        "priority": "normal",
        "billing_stage": "ajuste_material",
        "billing_history": hist,
        "invoice_number": "",
        "invoice_date": "",
        "invoice_value": 0,
        "photos": [],
        "materials": [],
        "schedule_entries": [],
    }
    res = await db.projects.insert_one(doc)
    client.close()
    return str(res.inserted_id)


async def _cleanup(pid: str):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.projects.delete_one({"_id": ObjectId(pid)})
    client.close()


def test_faturamento_pipeline_exposes_lead_times_and_stuck():
    auth = _login()
    token = auth["access_token"]
    admin_id = auth["id"]
    pid = asyncio.run(_seed_stuck_project(admin_id))
    try:
        r = httpx.get(f"{API}/faturamento/pipeline", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()

        # Schema
        assert "lead_buckets" in d
        assert "lead_times" in d
        assert "stuck_projects" in d
        assert d.get("stuck_threshold_days") == 15

        # Our seeded transitions: recebimento_tecnico→em_fechamento=10d, em_fechamento→ajuste_material=10d
        lt = d["lead_times"]
        assert "recebimento_tecnico→em_fechamento" in lt, f"Missing key: {list(lt.keys())}"
        assert lt["recebimento_tecnico→em_fechamento"]["avg_days"] == 10, lt
        assert lt["em_fechamento→ajuste_material"]["avg_days"] == 10, lt

        # Aggregate bucket for Rec→Fech should reflect 10 days (avg of the 2 transitions)
        assert d["lead_buckets"]["recebimento_to_fechamento"] == 10

        # Stuck: our project is in ajuste_material since 20d ago
        stuck = d["stuck_projects"]
        our = next((s for s in stuck if s["id"] == pid), None)
        assert our is not None, f"seeded project not found in stuck list: {[(s['id'], s['name']) for s in stuck]}"
        assert our["days_in_stage"] >= 15
        assert our["billing_stage"] == "ajuste_material"
        assert our["programmed_value"] == 25000.0

        # Also the pipeline card should carry days_in_stage + is_stuck=True
        cards = d["pipeline"].get("ajuste_material", [])
        card = next((c for c in cards if c["id"] == pid), None)
        assert card is not None
        assert card.get("is_stuck") is True
        assert card.get("days_in_stage", 0) >= 15
    finally:
        asyncio.run(_cleanup(pid))


def test_faturamento_pipeline_pago_is_not_stuck():
    """Even if a project has been in 'pago' for 100 days, it should NOT appear in stuck_projects."""
    auth = _login()
    token = auth["access_token"]
    admin_id = auth["id"]
    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        now = datetime.now(timezone.utc)
        doc = {
            "name": "TEST_PAID_NOT_STUCK",
            "project_code": f"TPAID-{int(now.timestamp()) % 10**8}",
            "team_id": "", "team_name": "", "user_id": admin_id,
            "programmed_value": 10000.0, "actual_value": 0, "billing_value": 0,
            "start_date": (now - timedelta(days=200)).strftime("%Y-%m-%d"),
            "end_date": (now - timedelta(days=150)).strftime("%Y-%m-%d"),
            "execution_status": "concluido", "priority": "normal",
            "billing_stage": "pago",
            "billing_history": [{"stage": "pago", "changed_at": (now - timedelta(days=100)).isoformat(), "changed_by": admin_id}],
            "invoice_number": "", "invoice_date": "", "invoice_value": 0,
            "photos": [], "materials": [], "schedule_entries": [],
        }
        res = await db.projects.insert_one(doc)
        client.close()
        return str(res.inserted_id)
    pid = asyncio.run(seed())
    try:
        r = httpx.get(f"{API}/faturamento/pipeline", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        stuck_ids = {s["id"] for s in d["stuck_projects"]}
        assert pid not in stuck_ids, "Paid projects should not appear in stuck radar"
    finally:
        asyncio.run(_cleanup(pid))
