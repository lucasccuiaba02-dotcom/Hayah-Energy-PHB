"""Set/2026 · Modo Campo: perfil encarregado (equipes), pacote do dia p/ offline, check-in de turno/obra,
resumo de requisição de material e enriquecimento do painel Operacional."""
from datetime import datetime, timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

TZ = ZoneInfo("America/Cuiaba")
TURNOS = {"manha": "Manhã", "tarde": "Tarde", "integral": "Integral", "noturno": "Noturno"}
CHECKIN_STATUS = {"a_caminho": "A caminho", "no_local": "No local", "concluido": "Serviço concluído"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_str() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def is_encarregado(user: dict) -> bool:
    return bool(user.get("is_encarregado")) and user.get("role") != "admin"


def hot_line_on(p: dict, date: str) -> bool:
    """Set/2026 · Linha viva por data: se a obra tem `hot_line_dates`, só nesses dias; legado → `requires_hot_line`."""
    dates = p.get("hot_line_dates") or []
    if dates:
        return date in dates
    return bool(p.get("requires_hot_line"))


async def allowed_team_names(db, user: dict) -> Optional[set]:
    """None = sem restrição; set(nomes) = encarregado restrito às suas equipes."""
    if not is_encarregado(user):
        return None
    ids = [str(t) for t in (user.get("team_ids") or [])]
    if not ids:
        return set()
    from bson import ObjectId
    oids = []
    for t in ids:
        try:
            oids.append(ObjectId(t))
        except Exception:
            continue
    names = set()
    async for t in db.teams.find({"_id": {"$in": oids}}, {"name": 1}):
        names.add(t.get("name", ""))
    return names


def requisition_summary(p: dict) -> Optional[dict]:
    reqs = [r for r in (p.get("material_requisitions") or []) if r.get("id")]
    if not reqs:
        return None
    reqs.sort(key=lambda r: r.get("created_at") or "")
    last = reqs[-1]
    wr = last.get("warehouse_response") or None
    rc = last.get("receipt") or None
    return {
        "id": last.get("id"), "created_at": last.get("created_at"), "created_by": last.get("created_by", ""),
        "requisition_type": last.get("requisition_type", "total"), "seq": last.get("seq"), "is_resend": bool(last.get("is_resend")),
        "items_count": len(last.get("items") or []), "email_status": last.get("email_status", ""),
        "warehouse_response": wr, "receipt": rc, "total_requisitions": len(reqs),
        "stage": "recebido" if rc else ("separado" if wr and wr.get("status") in ("separado", "na_doca", "baixado") else
                                        ("parcial" if wr and wr.get("status") == "separado_parcial" else
                                         ("pendencia" if wr else "enviada"))),
    }


async def checkins_by_project(db, workspace_id, date: str, project_ids: Optional[List[str]] = None) -> Dict[str, list]:
    q = {"user_id": workspace_id, "date": date}
    if project_ids is not None:
        q["project_id"] = {"$in": project_ids}
    out: Dict[str, list] = {}
    async for c in db.checkins.find(q).sort("at", 1):
        out.setdefault(c["project_id"], []).append({k: v for k, v in c.items() if k not in ("_id", "user_id")})
    return out


async def apr_counts(db, workspace_id, project_ids: List[str]) -> Dict[str, dict]:
    out: Dict[str, dict] = {}
    if not project_ids:
        return out
    async for a in db.aprs.find({"user_id": workspace_id, "project_id": {"$in": project_ids}}, {"project_id": 1, "line_type": 1}):
        d = out.setdefault(a["project_id"], {"total": 0, "viva": 0, "morta": 0})
        d["total"] += 1
        d["viva" if a.get("line_type") == "viva" else "morta"] += 1
    return out


def enrich_item(item: dict, p: dict, checkins: Dict[str, list], aprs: Dict[str, dict]) -> dict:
    pid = item.get("id") or str(p.get("_id"))
    item["last_requisition"] = requisition_summary(p)
    item["checkins_today"] = checkins.get(pid, [])
    item["aprs"] = aprs.get(pid, {"total": 0, "viva": 0, "morta": 0})
    latest = item["checkins_today"][-1] if item["checkins_today"] else None
    item["confirmed_today"] = bool(latest and latest.get("status") in ("no_local", "concluido"))
    item["turno_label"] = TURNOS.get((latest or {}).get("shift", ""), "") if latest else ""
    return item


async def scan_today(db, workspace_id, today: str, safe_object_id):
    """Obras com programação para `today` → lista de (doc, teams_today)."""
    projects = await db.projects.find({
        "user_id": workspace_id, "is_scheduled": True,
        "execution_status": {"$nin": ["concluido", "cancelado", "suspenso"]},
    }).to_list(2000)
    out = []
    team_cache: Dict[str, str] = {}
    for p in projects:
        entries = p.get("schedule_entries") or []
        teams_today: list = []
        if entries:
            for e in entries:
                if (e.get("date") or "")[:10] != today:
                    continue
                names = e.get("team_names") or []
                ids = e.get("team_ids") or []
                if not names and ids:
                    names = []
                    for t in ids:
                        if t not in team_cache:
                            team_cache[t] = (await db.teams.find_one({"_id": safe_object_id(t)}) or {}).get("name", "")
                        names.append(team_cache[t])
                teams_today.extend([n for n in names if n] or ["Sem equipe"])
        elif (p.get("start_date") or "")[:10] == today:
            teams_today = [n for n in [p.get("team_name"), p.get("additional_team_name")] if n] or ["Sem equipe"]
        if teams_today:
            out.append((p, sorted(set(teams_today))))
    return out


class CheckinBody(BaseModel):
    project_id: str
    date: Optional[str] = None
    shift: str = "integral"
    status: str = "no_local"
    lat: Optional[float] = None
    lng: Optional[float] = None
    note: str = ""
    client_ts: Optional[str] = None


def build_router(db, get_current_user, safe_object_id, build_project_response, photo_public):
    router = APIRouter(prefix="/api")

    @router.get("/projects/{project_id}/campo/historico")
    async def campo_historico(project_id: str, current_user: dict = Depends(get_current_user)):
        """Set/2026 · Tudo que as equipes de campo registraram na obra, agrupado por DATA (sem depender da programação):
        check-ins, fotos, APRs, requisições/recebimento de material, devoluções, lançamentos de avanço e retornos de programação."""
        p = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": current_user["_id"]})
        if not p:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        pid = str(p["_id"])
        days: Dict[str, dict] = {}

        def day(d: str) -> dict:
            d = (d or "")[:10] or "sem-data"
            if d not in days:
                days[d] = {"date": d, "checkins": [], "photos": [], "aprs": [], "requisitions": [], "receipts": [], "returns": [], "progress": [], "daily_returns": [], "count": 0}
            days[d]["count"] += 1
            return days[d]

        async for c in db.checkins.find({"user_id": current_user["_id"], "project_id": pid}).sort("at", 1):
            day(c.get("date") or c.get("at")).get("checkins").append({"by_name": c.get("by_name", ""), "by_email": c.get("by_email", ""), "shift": c.get("shift", ""),
                                                                       "status": c.get("status", ""), "at": c.get("at", ""), "note": c.get("note", ""), "lat": c.get("lat"), "lng": c.get("lng")})
        for ph in (p.get("photos") or []):
            pub = photo_public(pid, ph)
            if (pub.get("data_url") or "").startswith("data:image") and len(pub["data_url"]) > 300000:
                pub["data_url"] = f"/api/operacional/photos/{pid}/{ph.get('id')}/file"
            day(ph.get("uploaded_at")).get("photos").append({"id": ph.get("id"), "point": ph.get("point", ""), "label": ph.get("label", ""), "uploaded_at": ph.get("uploaded_at", ""),
                                                             "uploaded_by": ph.get("uploaded_by", ""), "url": pub.get("data_url", "")})
        async for a in db.aprs.find({"project_id": pid, "user_id": current_user["_id"]}).sort("created_at", 1):
            sup = a.get("supervisor") or {}
            day(a.get("date") or a.get("created_at")).get("aprs").append({"id": str(a["_id"]), "line_type": a.get("line_type", "morta"), "os_number": a.get("os_number", ""),
                                                                           "supervisor": sup.get("nome") or sup.get("name", ""), "signed": bool(sup.get("assinatura")),
                                                                           "created_at": a.get("created_at", ""), "pdf_url": f"/api/aprs/{str(a['_id'])}/pdf"})
        for r in (p.get("material_requisitions") or []):
            if r.get("is_resend"):
                continue
            day(r.get("created_at")).get("requisitions").append({"id": r.get("id"), "created_by": r.get("created_by", ""), "requisition_type": r.get("requisition_type", "total"),
                                                                  "seq": r.get("seq"), "items_count": len(r.get("items") or r.get("materials_snapshot") or []),
                                                                  "warehouse_status": (r.get("warehouse_response") or {}).get("status", ""), "pdf_url": f"/api/projects/{pid}/requisitions/{r.get('id')}/pdf"})
            rc = r.get("receipt") or {}
            if rc.get("received_at"):
                day(rc["received_at"]).get("receipts").append({"requisition_id": r.get("id"), "received_by": rc.get("received_by", ""), "received_at": rc.get("received_at", ""),
                                                               "notes": rc.get("notes", ""), "photo_url": f"/api/projects/{pid}/requisitions/{r.get('id')}/receipt-photo" if rc.get("photo_path") else ""})
        for ret in (p.get("material_returns") or []):
            day(ret.get("date") or ret.get("created_at")).get("returns").append({"id": ret.get("id"), "returned_by": ret.get("returned_by", ""), "reason": ret.get("reason", ""),
                                                                                 "total_qty": ret.get("total_qty", 0), "items": [{"item": i.get("item"), "qty": i.get("qty"), "unit": i.get("unit")} for i in (ret.get("items") or [])]})
        for e in (p.get("progress_entries") or []):
            day(e.get("date")).get("progress").append({"item_key": e.get("item_key", ""), "qty": e.get("qty", 0), "notes": e.get("notes", ""), "registered_by": e.get("registered_by", "")})
        for dr in (p.get("daily_returns") or []):
            day(dr.get("date")).get("daily_returns").append({"executed": bool(dr.get("executed")), "reason": dr.get("reason", ""), "notes": dr.get("notes", ""), "by": dr.get("registered_by") or dr.get("by", "")})
        ordered = sorted(days.values(), key=lambda d: d["date"], reverse=True)
        cl = p.get("checklist") or {}
        totals = {k: sum(len(d[k]) for d in ordered) for k in ("checkins", "photos", "aprs", "requisitions", "receipts", "returns", "progress", "daily_returns")}
        return {"project_id": pid, "project_code": p.get("project_code", ""), "name": p.get("name", ""), "days": ordered, "totals": totals,
                "checklist": {"team_confirmed": bool(cl.get("team_confirmed")), "team": cl.get("team", ""), "turno": cl.get("turno", ""), "team_confirmed_by": cl.get("team_confirmed_by", ""),
                              "team_confirmed_at": cl.get("team_confirmed_at", ""), "material_confirmed": bool(cl.get("material_confirmed")), "shutdown_confirmed": bool(cl.get("shutdown_confirmed")),
                              "hotline_confirmed": bool(cl.get("hotline_confirmed")), "notes": cl.get("notes", "")},
                "scheduled_dates": sorted({(e.get("date") or "")[:10] for e in (p.get("schedule_entries") or []) if e.get("date")})}

    @router.get("/campo/hoje")
    async def campo_hoje(date: str = "", current_user: dict = Depends(get_current_user)):
        today = (date or today_str())[:10]
        ws = current_user["_id"]
        allowed = await allowed_team_names(db, current_user)
        rows = await scan_today(db, ws, today, safe_object_id)
        if allowed is not None:
            rows = [(p, t) for p, t in rows if set(t) & allowed]
        pids = [str(p["_id"]) for p, _ in rows]
        checkins = await checkins_by_project(db, ws, today, pids)
        counts = await apr_counts(db, ws, pids)
        aprs_by: Dict[str, list] = {}
        if pids:
            async for a in db.aprs.find({"user_id": ws, "project_id": {"$in": pids}}).sort("created_at", -1):
                a["id"] = str(a.pop("_id"))
                a.pop("user_id", None)
                aprs_by.setdefault(a["project_id"], []).append(a)
        equips_by: Dict[str, list] = {}
        if pids:
            async for e in db.equipamentos.find({"user_id": ws, "project_id": {"$in": pids}}, {"tipo": 1, "patrimonio": 1, "numero_serie": 1, "potencia": 1, "project_id": 1}):
                equips_by.setdefault(e["project_id"], []).append({"id": str(e["_id"]), "tipo": e.get("tipo"), "patrimonio": e.get("patrimonio"), "numero_serie": e.get("numero_serie"), "potencia": e.get("potencia")})
        projects = []
        for p, teams_today in rows:
            item = build_project_response(p).model_dump()
            pid = item["id"]
            item["teams_today"] = teams_today
            item["shutdown_today"] = today in (p.get("shutdown_dates") or []) or (not p.get("shutdown_dates") and bool(p.get("shutdown_info")))
            item["hot_line_today"] = hot_line_on(p, today)
            item["checklist"] = p.get("checklist") or {}
            item["photos"] = [photo_public(pid, ph) for ph in (p.get("photos") or [])]
            item["attachments"] = [{k: v for k, v in a.items() if k not in ("data", "content")} for a in (p.get("attachments") or []) if not a.get("is_deleted")]
            item["materials_list"] = p.get("materials_list") or p.get("materials") or []
            item["apr_list"] = aprs_by.get(pid, [])
            item["equipamentos"] = equips_by.get(pid, [])
            enrich_item(item, p, checkins, counts)
            projects.append(item)
        teams = []
        async for t in db.teams.find({"user_id": ws}):
            teams.append({"id": str(t["_id"]), "name": t.get("name", ""), "members": t.get("members", []), "supervisor": t.get("supervisor", ""), "tipo": t.get("tipo", "linha_morta")})
        my_team_ids = [str(t) for t in (current_user.get("team_ids") or [])]
        return {
            "date": today, "generated_at": _now(),
            "user": {"id": current_user.get("actor_id") or str(ws), "name": current_user.get("name", ""), "email": current_user.get("email", ""),
                     "role": current_user.get("role", "user"), "is_encarregado": bool(current_user.get("is_encarregado")),
                     "team_ids": my_team_ids, "team_names": sorted(allowed) if allowed is not None else [],
                     "hot_line_team": any(t["tipo"] in ("linha_viva", "mista") for t in teams if t["id"] in my_team_ids)},
            "teams": teams, "projects": projects,
            "turnos": TURNOS, "checkin_status": CHECKIN_STATUS,
        }

    @router.post("/campo/checkin")
    async def campo_checkin(body: CheckinBody, current_user: dict = Depends(get_current_user)):
        if body.shift not in TURNOS:
            raise HTTPException(status_code=400, detail=f"Turno inválido. Use: {list(TURNOS)}")
        if body.status not in CHECKIN_STATUS:
            raise HTTPException(status_code=400, detail=f"Status inválido. Use: {list(CHECKIN_STATUS)}")
        ws = current_user["_id"]
        project = await db.projects.find_one({"_id": safe_object_id(body.project_id), "user_id": ws}, {"name": 1, "project_code": 1, "team_name": 1})
        if not project:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        date = (body.date or today_str())[:10]
        actor = current_user.get("actor_id") or str(ws)
        doc = {
            "user_id": ws, "project_id": body.project_id, "date": date, "actor_id": actor,
            "by_name": current_user.get("name", ""), "by_email": current_user.get("email", ""),
            "shift": body.shift, "status": body.status, "lat": body.lat, "lng": body.lng, "note": (body.note or "").strip()[:500],
            "at": _now(), "client_ts": body.client_ts, "project_code": project.get("project_code", ""), "project_name": project.get("name", ""),
        }
        await db.checkins.update_one({"user_id": ws, "project_id": body.project_id, "date": date, "actor_id": actor}, {"$set": doc}, upsert=True)
        await db.projects.update_one({"_id": project["_id"]}, {"$set": {"checklist.team": body.status in ("no_local", "concluido"),
                                                                        "checklist.team_confirmed_by": doc["by_name"], "checklist.team_confirmed_at": doc["at"],
                                                                        "checklist.turno": body.shift}})
        lst = (await checkins_by_project(db, ws, date, [body.project_id])).get(body.project_id, [])
        return {"status": "ok", "checkin": {k: v for k, v in doc.items() if k != "user_id"}, "checkins_today": lst,
                "turno_label": TURNOS[body.shift], "status_label": CHECKIN_STATUS[body.status]}

    @router.get("/campo/checkins")
    async def campo_checkins(date: str = "", current_user: dict = Depends(get_current_user)):
        d = (date or today_str())[:10]
        return {"date": d, "by_project": await checkins_by_project(db, current_user["_id"], d)}

    return router
