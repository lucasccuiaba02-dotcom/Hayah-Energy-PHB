"""Out/2026 · Impacto do almoxarifado em HH — programações não atendidas por material, obras separadas e não atendidas,
espera na doca etc. Custo = horas × pessoas × R$/HH fixo (se configurado) ou horas × (meta diária da equipe ÷ 8)."""
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

TZ = ZoneInfo("America/Cuiaba")
TIPOS = {
    "nao_atendida": "Programação não atendida (material)",
    "separada_nao_atendida": "Obra separada e não atendida",
    "espera_doca": "Equipe aguardando na doca",
    "material_errado": "Material errado / incompleto",
    "retrabalho": "Retrabalho por material",
    "outro": "Outra situação (HH)",
}
SETTINGS_KEY = "almox_impacto"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImpactoConfig(BaseModel):
    hh_rate: Optional[float] = None  # R$ por homem-hora (vazio = usar meta diária ÷ 8)


class OcorrenciaBody(BaseModel):
    project_id: Optional[str] = None
    team_id: Optional[str] = None
    date: Optional[str] = None
    tipo: str = "outro"
    hours: float = 0.0
    members: Optional[int] = None
    description: str = ""


async def get_config(db, user_id) -> dict:
    doc = await db.app_settings.find_one({"key": SETTINGS_KEY, "user_id": user_id}, {"_id": 0, "hh_rate": 1})
    return {"hh_rate": (doc or {}).get("hh_rate")}


def compute_cost(hours: float, members: int, hh_rate: Optional[float], daily_target: float) -> dict:
    hours = float(hours or 0)
    members = max(1, int(members or 1))
    if hh_rate:
        return {"hh": round(hours * members, 2), "cost": round(hours * members * float(hh_rate), 2), "basis": "hh_rate"}
    return {"hh": round(hours * members, 2), "cost": round(hours * (float(daily_target or 4000.0) / 8.0), 2), "basis": "meta_diaria"}


async def _team_info(db, team_id: Optional[str]) -> dict:
    if not team_id:
        return {}
    try:
        t = await db.teams.find_one({"_id": ObjectId(team_id)}, {"name": 1, "daily_target": 1, "member_count": 1, "members": 1})
    except Exception:
        t = None
    if not t:
        return {}
    return {"team_id": str(t["_id"]), "team_name": t.get("name", ""), "daily_target": float(t.get("daily_target") or 4000.0),
            "members": int(t.get("member_count") or len(t.get("members") or []) or 1)}


async def register_ocorrencia(db, user, *, project: Optional[dict], tipo: str, hours: float, description: str, date: Optional[str] = None,
                              team_id: Optional[str] = None, members: Optional[int] = None, source: str = "manual", ref: Optional[dict] = None) -> dict:
    cfg = await get_config(db, user["_id"])
    team = await _team_info(db, team_id or (project or {}).get("team_id"))
    members_n = int(members or team.get("members") or 1)
    calc = compute_cost(hours, members_n, cfg.get("hh_rate"), team.get("daily_target", 4000.0))
    doc = {"user_id": user["_id"], "project_id": str(project["_id"]) if project else "", "project_code": (project or {}).get("project_code", ""), "project_name": (project or {}).get("name", ""),
           "team_id": team.get("team_id", ""), "team_name": team.get("team_name") or (project or {}).get("team_name", ""), "daily_target": team.get("daily_target", 4000.0),
           "date": (date or datetime.now(TZ).strftime("%Y-%m-%d"))[:10], "tipo": tipo if tipo in TIPOS else "outro", "hours": float(hours or 0), "members": members_n,
           "description": (description or "").strip()[:500], "source": source, "ref": ref or {}, **calc, "hh_rate": cfg.get("hh_rate"),
           "created_at": _now(), "created_by": user.get("name") or user.get("email", "")}
    r = await db.almox_ocorrencias.insert_one(doc)
    doc["_id"] = r.inserted_id
    return doc


def _pub(d: dict) -> dict:
    return {"id": str(d["_id"]), **{k: v for k, v in d.items() if k not in ("_id", "user_id")}, "tipo_label": TIPOS.get(d.get("tipo"), d.get("tipo"))}


def build_router(db, get_current_user, safe_object_id):
    router = APIRouter(prefix="/api/almoxarifado/impacto")

    @router.get("/config")
    async def read_config(current_user: dict = Depends(get_current_user)):
        return {**(await get_config(db, current_user["_id"])), "tipos": TIPOS}

    @router.put("/config")
    async def write_config(body: ImpactoConfig, current_user: dict = Depends(get_current_user)):
        if body.hh_rate is not None and (body.hh_rate < 0 or body.hh_rate > 10000):
            raise HTTPException(status_code=400, detail="R$/HH inválido")
        await db.app_settings.update_one({"key": SETTINGS_KEY, "user_id": current_user["_id"]},
                                         {"$set": {"hh_rate": body.hh_rate, "updated_at": _now(), "updated_by": current_user.get("name", "")}}, upsert=True)
        return await get_config(db, current_user["_id"])

    @router.get("")
    async def resumo(month: str = "", current_user: dict = Depends(get_current_user)):
        month = (month or datetime.now(TZ).strftime("%Y-%m"))[:7]
        q = {"user_id": current_user["_id"], "date": {"$gte": f"{month}-01", "$lte": f"{month}-31"}}
        items = [_pub(d) async for d in db.almox_ocorrencias.find(q).sort([("date", -1), ("created_at", -1)])]
        cfg = await get_config(db, current_user["_id"])

        def agg(key):
            out = {}
            for it in items:
                k = it.get(key) or "—"
                o = out.setdefault(k, {"label": it.get("tipo_label") if key == "tipo" else k, "ocorrencias": 0, "horas": 0.0, "hh": 0.0, "custo": 0.0})
                o["ocorrencias"] += 1
                o["horas"] = round(o["horas"] + float(it.get("hours") or 0), 2)
                o["hh"] = round(o["hh"] + float(it.get("hh") or 0), 2)
                o["custo"] = round(o["custo"] + float(it.get("cost") or 0), 2)
            return sorted(out.values(), key=lambda x: -x["custo"])

        totals = {"ocorrencias": len(items), "horas": round(sum(float(i.get("hours") or 0) for i in items), 2),
                  "hh": round(sum(float(i.get("hh") or 0) for i in items), 2), "custo": round(sum(float(i.get("cost") or 0) for i in items), 2),
                  "obras": len({i.get("project_id") for i in items if i.get("project_id")})}
        por_obra = agg("project_code")
        for o in por_obra:
            o["label"] = next((f"{i.get('project_code') or ''} · {i.get('project_name') or ''}".strip(" ·") for i in items if (i.get("project_code") or "—") == o["label"]), o["label"])
        return {"month": month, "config": cfg, "tipos": TIPOS, "totals": totals, "por_tipo": agg("tipo"), "por_obra": por_obra, "por_equipe": agg("team_name"), "items": items}

    @router.post("/ocorrencias")
    async def criar(body: OcorrenciaBody, current_user: dict = Depends(get_current_user)):
        if body.tipo not in TIPOS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {list(TIPOS)}")
        if body.hours < 0 or body.hours > 500:
            raise HTTPException(status_code=400, detail="Horas inválidas")
        project = None
        if body.project_id:
            project = await db.projects.find_one({"_id": safe_object_id(body.project_id), "user_id": current_user["_id"]}, {"project_code": 1, "name": 1, "team_id": 1, "team_name": 1})
            if not project:
                raise HTTPException(status_code=404, detail="Obra não encontrada")
        doc = await register_ocorrencia(db, current_user, project=project, tipo=body.tipo, hours=body.hours, description=body.description, date=body.date,
                                        team_id=body.team_id, members=body.members, source="manual")
        return _pub(doc)

    @router.patch("/ocorrencias/{oid}")
    async def editar(oid: str, body: OcorrenciaBody, current_user: dict = Depends(get_current_user)):
        doc = await db.almox_ocorrencias.find_one({"_id": safe_object_id(oid), "user_id": current_user["_id"]})
        if not doc:
            raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
        if body.tipo not in TIPOS:
            raise HTTPException(status_code=400, detail="Tipo inválido")
        cfg = await get_config(db, current_user["_id"])
        members_n = int(body.members or doc.get("members") or 1)
        calc = compute_cost(body.hours, members_n, cfg.get("hh_rate"), doc.get("daily_target", 4000.0))
        upd = {"tipo": body.tipo, "hours": float(body.hours or 0), "members": members_n, "description": (body.description or "").strip()[:500],
               "date": (body.date or doc.get("date"))[:10], **calc, "hh_rate": cfg.get("hh_rate"), "updated_at": _now(), "updated_by": current_user.get("name", "")}
        await db.almox_ocorrencias.update_one({"_id": doc["_id"]}, {"$set": upd})
        return _pub(await db.almox_ocorrencias.find_one({"_id": doc["_id"]}))

    @router.delete("/ocorrencias/{oid}")
    async def excluir(oid: str, current_user: dict = Depends(get_current_user)):
        r = await db.almox_ocorrencias.delete_one({"_id": safe_object_id(oid), "user_id": current_user["_id"]})
        if not r.deleted_count:
            raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
        return {"status": "deleted"}

    return router
