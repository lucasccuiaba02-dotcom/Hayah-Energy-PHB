"""Avanço Físico — obras de ticket grande (Set/2026).
Router montado em server.py via build_router(). Dados ficam no doc da obra:
  avanco_custom_items: [{key,label,unit,planned_qty}]  · avanco_weights: {key: peso}
  progress_entries: [{id,date,item_key,qty,notes,registered_by,created_at}]
Threshold em app_settings {user_id, key:'avanco_threshold', value}.
"""
from datetime import datetime, timezone
from typing import List
from uuid import uuid4
import base64

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from avanco_pdf import build_avanco_pdf

DEFAULT_THRESHOLD = 45000.0


def _brl(v):
    return "R$ " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


# Set/2026: removidos ligações novas / religações / desligamentos; adicionados estruturas e equipamentos
BASE_ITEMS = [
    ("postes", "Postes", "un", "postes_qty"),
    ("km_rede", "Km de Rede", "km", "km_rede"),
    ("estruturas_primarias", "Estruturas Primárias", "un", "estruturas_primarias"),
    ("estruturas_secundarias", "Estruturas Secundárias", "un", "estruturas_secundarias"),
    ("transformadores", "Transformadores", "un", "transformadores_qty"),
    ("religadores", "Religadores", "un", "religadores_qty"),
    ("reguladores", "Reguladores", "un", "reguladores_qty"),
]
LEGACY_ITEMS = [("ligacoes", "Ligações Novas (legado)", "un", "ligacoes_novas"),
                ("religacoes", "Religações (legado)", "un", "religacoes"),
                ("desligamentos", "Desligamentos (legado)", "un", "desligamentos")]
EXCLUDED_STATUS = ("cancelado", "suspenso")
# Regra (Set/2026, pedido do usuário): mostrar TODAS as obras acima do limite exceto canceladas/suspensas;
# aguardando programação entra com aviso "não programada"; concluídas ficam ocultas (toggle).
ACTIVE_STATUS = ("aguardando_programacao", "programado", "a_reprogramar", "em_execucao")
COMPLETED_STATUS = ("concluido", "executada")


class ThresholdBody(BaseModel):
    threshold: float


class EntryBody(BaseModel):
    date: str
    item_key: str
    qty: float
    notes: str = ""


class CustomItem(BaseModel):
    key: str = ""
    label: str
    unit: str = "un"
    planned_qty: float = 0.0


class ItemsConfigBody(BaseModel):
    custom_items: List[CustomItem] = []
    weights: dict = {}


def _d(v):
    return (v or "")[:10]


def _status(p):
    """Status efetivo: obra programada no calendário sem status explícito conta como 'programado'."""
    s = p.get("execution_status") or "aguardando_programacao"
    if s == "aguardando_programacao" and p.get("is_scheduled") and (p.get("schedule_entries") or p.get("start_date")):
        return "programado"
    return s


SCHEDULED_NO_STATUS_Q = {"is_scheduled": True, "execution_status": {"$in": [None, "", "aguardando_programacao"]},
                         "$or": [{"schedule_entries.0": {"$exists": True}}, {"start_date": {"$nin": [None, ""]}}]}


def _first_sched(p):
    dates = sorted(_d(e.get("date")) for e in (p.get("schedule_entries") or []) if e.get("date"))
    return dates[0] if dates else _d(p.get("start_date"))


def _build_items(p):
    weights = p.get("avanco_weights") or {}
    items = []
    for key, label, unit, field in BASE_ITEMS:
        planned = float(p.get(field) or 0)
        if planned > 0:
            items.append({"key": key, "label": label, "unit": unit, "planned_qty": planned, "custom": False})
    entries = p.get("progress_entries") or []
    used_keys = {e.get("item_key") for e in entries}
    for key, label, unit, field in LEGACY_ITEMS:
        planned = float(p.get(field) or 0)
        if planned > 0 and key in used_keys:
            items.append({"key": key, "label": label, "unit": unit, "planned_qty": planned, "custom": False, "legacy": True})
    for c in (p.get("avanco_custom_items") or []):
        items.append({"key": c.get("key"), "label": c.get("label", ""), "unit": c.get("unit", "un"),
                      "planned_qty": float(c.get("planned_qty") or 0), "custom": True})
    for it in items:
        it["executed_qty"] = round(sum(float(e.get("qty") or 0) for e in entries if e.get("item_key") == it["key"]), 3)
        it["pct"] = round(min(100.0, 100.0 * it["executed_qty"] / it["planned_qty"]), 1) if it["planned_qty"] > 0 else 0.0
        it["weight"] = float(weights.get(it["key"], 1.0) or 0)
    return items


def _pct_fisico(items):
    tw = sum(i["weight"] for i in items)
    if tw <= 0:
        return 0.0
    return round(sum(i["weight"] * min(1.0, i["executed_qty"] / i["planned_qty"] if i["planned_qty"] > 0 else 0) for i in items) / tw * 100, 1)


def _materials_summary(p):
    mats = p.get("materials_list") or []
    req = sum(float(m.get("qty_requested") or m.get("quantity") or 0) for m in mats)
    dlv = sum(float(m.get("qty_delivered") or 0) for m in mats)
    app = sum(float(m.get("qty_applied") or 0) for m in mats)
    pending = sum(1 for m in mats if float(m.get("qty_delivered") or 0) < float(m.get("qty_requested") or m.get("quantity") or 0))
    return {
        "items": len(mats),
        "qty_requested": round(req, 2), "qty_delivered": round(dlv, 2), "qty_applied": round(app, 2),
        "pct_delivered": round(100 * dlv / req, 1) if req > 0 else 0.0,
        "pct_applied": round(100 * app / dlv, 1) if dlv > 0 else 0.0,
        "pending_items": pending,
        "total_value": round(sum(float(m.get("total_cost") or 0) for m in mats), 2),
    }


def _summary(p, today, team_target):
    items = _build_items(p)
    entries = p.get("progress_entries") or []
    prog = float(p.get("programmed_value") or 0)
    actual = float(p.get("actual_value") or 0)
    pct_fis = _pct_fisico(items)
    pct_fin = round(100 * actual / prog, 1) if prog > 0 else 0.0
    start = _first_sched(p)
    end = _d(p.get("expiry_date")) or _d(p.get("end_date"))
    pct_tempo = None
    total_days = None
    if start and end and end > start:
        total_days = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
        elapsed = (datetime.fromisoformat(min(today, end)) - datetime.fromisoformat(start)).days
        pct_tempo = round(max(0.0, min(100.0, 100 * elapsed / total_days)), 1)
    eficiencia = round(pct_fis / pct_tempo, 2) if pct_tempo else None
    worked = {_d(e.get("date")) for e in (p.get("schedule_entries") or []) if e.get("date") and _d(e["date"]) <= today}
    worked |= {_d(e.get("date")) for e in entries if e.get("date")}
    dias = len(worked)
    por_dia = round(actual / dias, 2) if dias else 0.0
    return {
        "id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""),
        "team_name": p.get("team_name") or "", "location": p.get("location", ""),
        "execution_status": _status(p),
        "not_scheduled": _status(p) == "aguardando_programacao",
        "programmed_value": prog, "actual_value": actual,
        "pct_fisico": pct_fis, "pct_financeiro": pct_fin, "pct_tempo": pct_tempo, "eficiencia": eficiencia,
        "start": start, "end": end, "total_days": total_days,
        "dias_trabalhados": dias, "produzido_por_dia": por_dia, "meta_diaria": team_target,
        "aderencia_diaria": round(100 * por_dia / team_target, 1) if team_target else 0.0,
        "items_count": len(items), "entries_count": len(entries),
        "last_entry": max((e.get("date", "") for e in entries), default=""),
        "materials": _materials_summary(p),
    }


def _curve(p, items, today):
    """Curva S: % físico acumulado por data de lançamento + linha planejada linear."""
    entries = sorted((e for e in (p.get("progress_entries") or []) if e.get("date")), key=lambda e: e["date"])
    start = _first_sched(p) or (entries[0]["date"] if entries else today)
    end = _d(p.get("expiry_date")) or _d(p.get("end_date")) or today
    tw = sum(i["weight"] for i in items) or 1.0
    planned = {i["key"]: i["planned_qty"] for i in items}
    weight = {i["key"]: i["weight"] for i in items}
    dates = sorted({start, end, today} | {_d(e["date"]) for e in entries})
    cum = {k: 0.0 for k in planned}
    idx = 0
    out = []
    for d in dates:
        while idx < len(entries) and _d(entries[idx]["date"]) <= d:
            e = entries[idx]
            if e.get("item_key") in cum:
                cum[e["item_key"]] += float(e.get("qty") or 0)
            idx += 1
        real = sum(weight[k] * min(1.0, cum[k] / planned[k] if planned[k] > 0 else 0) for k in planned) / tw * 100
        if end > start:
            span = (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
            el = (datetime.fromisoformat(d) - datetime.fromisoformat(start)).days
            plan = max(0.0, min(100.0, 100 * el / span))
        else:
            plan = 100.0 if d >= end else 0.0
        out.append({"date": d, "real_pct": round(real, 1) if d <= today else None, "planned_pct": round(plan, 1)})
    return out


def build_router(db, get_current_user, require_admin, safe_object_id, today_fn, storage_get=None):
    router = APIRouter(prefix="/api")

    async def _threshold(user_id):
        doc = await db.app_settings.find_one({"user_id": user_id, "key": "avanco_threshold"})
        return float(doc.get("value")) if doc and doc.get("value") else DEFAULT_THRESHOLD

    async def _team_target(user_id, p):
        if p.get("team_id"):
            try:
                t = await db.teams.find_one({"_id": safe_object_id(p["team_id"]), "user_id": user_id})
                if t:
                    return float(t.get("daily_target") or 4000.0)
            except HTTPException:
                pass
        return 4000.0

    async def _get_project(project_id, user):
        p = await db.projects.find_one({"_id": safe_object_id(project_id), "user_id": user["_id"]})
        if not p:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        return p

    @router.get("/avanco/threshold")
    async def get_threshold(current_user: dict = Depends(get_current_user)):
        return {"threshold": await _threshold(current_user["_id"]), "default": DEFAULT_THRESHOLD}

    @router.post("/avanco/threshold")
    async def set_threshold(body: ThresholdBody, current_user: dict = Depends(require_admin)):
        if body.threshold <= 0:
            raise HTTPException(status_code=400, detail="Limite deve ser maior que zero")
        await db.app_settings.update_one(
            {"user_id": current_user["_id"], "key": "avanco_threshold"},
            {"$set": {"value": float(body.threshold), "updated_by": current_user.get("email", ""), "updated_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        return {"status": "ok", "threshold": float(body.threshold)}

    @router.get("/avanco/projects")
    async def list_projects(current_user: dict = Depends(get_current_user), include_completed: int = 0):
        """Só obras programadas / a reprogramar / em execução. Concluídas ficam ocultas (include_completed=1 mostra)."""
        th = await _threshold(current_user["_id"])
        today = today_fn()
        base_q = {"user_id": current_user["_id"], "programmed_value": {"$gte": th}}
        statuses = list(ACTIVE_STATUS) + (list(COMPLETED_STATUS) if include_completed else [])
        # None/"" (legado) contam como aguardando_programacao
        projects = await db.projects.find({**base_q, "execution_status": {"$in": statuses + [None, ""]}}).to_list(2000)
        hidden_completed = 0 if include_completed else await db.projects.count_documents({**base_q, "execution_status": {"$in": list(COMPLETED_STATUS)}})
        out = [_summary(p, today, await _team_target(current_user["_id"], p)) for p in projects]
        out.sort(key=lambda s: (s["execution_status"] in COMPLETED_STATUS, s["not_scheduled"], -s["programmed_value"]))
        totals = {
            "count": len(out),
            "not_scheduled": sum(1 for s in out if s["not_scheduled"]),
            "programmed_value": round(sum(s["programmed_value"] for s in out), 2),
            "actual_value": round(sum(s["actual_value"] for s in out), 2),
            "avg_pct_fisico": round(sum(s["pct_fisico"] for s in out) / len(out), 1) if out else 0.0,
            "avg_eficiencia": round(sum(s["eficiencia"] for s in out if s["eficiencia"] is not None) / max(1, sum(1 for s in out if s["eficiencia"] is not None)), 2),
            "critical": sum(1 for s in out if s["eficiencia"] is not None and s["eficiencia"] < 0.8),
            "hidden_completed": hidden_completed,
        }
        return {"threshold": th, "today": today, "include_completed": bool(include_completed), "totals": totals, "projects": out}

    @router.get("/avanco/lookup")
    async def lookup(q: str = "", current_user: dict = Depends(get_current_user)):
        """Diagnóstico: por que uma obra não aparece no Avanço Físico."""
        q = q.strip()
        if len(q) < 2:
            return {"results": []}
        th = await _threshold(current_user["_id"])
        rx = {"$regex": q.replace("(", "\\(").replace(")", "\\)"), "$options": "i"}
        docs = await db.projects.find({"user_id": current_user["_id"], "$or": [{"project_code": rx}, {"name": rx}]}).limit(10).to_list(10)
        labels = {"aguardando_programacao": "Aguardando Programação", "programado": "Programado", "em_execucao": "Em Execução", "a_reprogramar": "A Reprogramar",
                  "executada": "Executada", "concluido": "Concluído", "suspenso": "Suspenso", "cancelado": "Cancelado"}
        results = []
        for p in docs:
            st = _status(p)
            val = float(p.get("programmed_value") or 0)
            reasons = []
            if val < th:
                reasons.append(f"Valor programado {_brl(val)} abaixo do limite de {_brl(th)} (ajuste no Admin ou edite o valor da obra)")
            if st in COMPLETED_STATUS:
                reasons.append("Obra concluída — marque 'Mostrar concluídas' para visualizar")
            elif st in EXCLUDED_STATUS:
                reasons.append(f"Status {labels.get(st, st)} — obras suspensas/canceladas ficam fora do Avanço Físico")
            results.append({"id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""), "execution_status": st,
                            "status_label": labels.get(st, st), "programmed_value": val, "is_scheduled": bool(p.get("is_scheduled")),
                            "eligible": not reasons, "hidden_completed": st in COMPLETED_STATUS and val >= th, "reasons": reasons})
        return {"threshold": th, "results": results}

    async def _detail_payload(p, current_user):
        today = today_fn()
        items = _build_items(p)
        entries = sorted((p.get("progress_entries") or []), key=lambda e: (e.get("date", ""), e.get("created_at", "")), reverse=True)
        mats = []
        for m in (p.get("materials_list") or []):
            req = float(m.get("qty_requested") or m.get("quantity") or 0)
            dlv = float(m.get("qty_delivered") or 0)
            mats.append({
                "id": m.get("id"), "code": m.get("code", ""), "item": m.get("item") or m.get("description", ""),
                "unit": m.get("unit", ""), "qty_requested": req, "qty_delivered": dlv,
                "qty_applied": float(m.get("qty_applied") or 0), "total_cost": float(m.get("total_cost") or 0),
                "pct_delivered": round(100 * dlv / req, 1) if req > 0 else 0.0,
            })
        th = await _threshold(current_user["_id"])
        status = _status(p)
        return {
            "summary": _summary(p, today, await _team_target(current_user["_id"], p)),
            "eligible": float(p.get("programmed_value") or 0) >= th and status not in EXCLUDED_STATUS,
            "threshold": th,
            "items": items,
            "custom_items": p.get("avanco_custom_items") or [],
            "weights": p.get("avanco_weights") or {},
            "entries": entries,
            "curve": _curve(p, items, today),
            "materials": mats,
        }

    @router.get("/projects/{project_id}/avanco")
    async def project_detail(project_id: str, current_user: dict = Depends(get_current_user)):
        p = await _get_project(project_id, current_user)
        return await _detail_payload(p, current_user)

    def _photo_catalog(p):
        """Fotos disponíveis para o relatório: diário/checklist (base64) + anexos de imagem."""
        out = []
        for ph in sorted((p.get("photos") or []), key=lambda x: x.get("uploaded_at", ""), reverse=True):
            du = ph.get("data_url") or ""
            if du.startswith("data:image") and "," in du:
                out.append({"id": ph.get("id") or "", "source": "photo", "point": (ph.get("point") or "").strip(), "label": (ph.get("label") or "").upper(),
                            "uploaded_at": ph.get("uploaded_at") or "", "thumb": du,
                            "caption": f"{(ph.get('point') or '').strip() or 'Obra'} · {(ph.get('label') or 'FOTO').upper()} · {(ph.get('uploaded_at') or '')[:10]}"})
        for att in sorted((p.get("attachments") or []), key=lambda a: a.get("uploaded_at", ""), reverse=True):
            if (att.get("content_type") or "").startswith("image/") and att.get("storage_path"):
                out.append({"id": att.get("id") or "", "source": "attachment", "point": "", "label": "ANEXO", "filename": att.get("filename") or "imagem",
                            "uploaded_at": att.get("uploaded_at") or "", "thumb": "",
                            "caption": f"Anexo · {att.get('filename') or 'imagem'} · {(att.get('uploaded_at') or '')[:10]}"})
        return [x for x in out if x["id"]]

    @router.get("/projects/{project_id}/avanco/photos")
    async def project_photos(project_id: str, current_user: dict = Depends(get_current_user)):
        p = await _get_project(project_id, current_user)
        cat = _photo_catalog(p)
        return {"photos": cat, "default_ids": [x["id"] for x in cat[:6]]}

    @router.get("/projects/{project_id}/avanco/pdf")
    async def project_pdf(project_id: str, current_user: dict = Depends(get_current_user), max_photos: int = 6, photo_ids: str = ""):
        p = await _get_project(project_id, current_user)
        detail = await _detail_payload(p, current_user)
        catalog = _photo_catalog(p)
        if photo_ids.strip():
            wanted = [x for x in photo_ids.split(",") if x.strip()]
            chosen = [c for c in catalog if c["id"] in wanted] if wanted else []
        else:
            chosen = catalog[:max_photos]
        photos = []
        for c in chosen:
            try:
                if c["source"] == "photo":
                    data = base64.b64decode(c["thumb"].split(",", 1)[1])
                else:
                    att = next(a for a in (p.get("attachments") or []) if a.get("id") == c["id"])
                    data, _ = await storage_get(att["storage_path"])
                photos.append({"bytes": data, "caption": c["caption"]})
            except Exception:
                continue
        pdf = build_avanco_pdf(p, detail, photos=photos)
        code = "".join(ch if ch.isalnum() else "_" for ch in (p.get("project_code") or project_id))[:24]
        filename = f"avanco_fisico_{code}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}.pdf"
        return Response(content=pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    @router.post("/projects/{project_id}/avanco/entries")
    async def add_entry(project_id: str, body: EntryBody, current_user: dict = Depends(get_current_user)):
        p = await _get_project(project_id, current_user)
        keys = {i["key"] for i in _build_items(p)}
        if body.item_key not in keys:
            raise HTTPException(status_code=400, detail="Item de avanço inválido para esta obra")
        if body.qty == 0:
            raise HTTPException(status_code=400, detail="Quantidade deve ser diferente de zero")
        entry = {
            "id": uuid4().hex[:12], "date": body.date[:10], "item_key": body.item_key, "qty": float(body.qty),
            "notes": body.notes or "", "registered_by": current_user.get("name", "") or current_user.get("email", ""),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.projects.update_one({"_id": p["_id"]}, {"$push": {"progress_entries": entry}})
        p["progress_entries"] = (p.get("progress_entries") or []) + [entry]
        return {"status": "ok", "entry": entry, "pct_fisico": _pct_fisico(_build_items(p))}

    @router.delete("/projects/{project_id}/avanco/entries/{entry_id}")
    async def delete_entry(project_id: str, entry_id: str, current_user: dict = Depends(get_current_user)):
        p = await _get_project(project_id, current_user)
        await db.projects.update_one({"_id": p["_id"]}, {"$pull": {"progress_entries": {"id": entry_id}}})
        return {"status": "deleted"}

    @router.put("/projects/{project_id}/avanco/items")
    async def set_items(project_id: str, body: ItemsConfigBody, current_user: dict = Depends(get_current_user)):
        p = await _get_project(project_id, current_user)
        customs = []
        for c in body.custom_items:
            if not c.label.strip():
                continue
            customs.append({"key": c.key or f"c_{uuid4().hex[:8]}", "label": c.label.strip(), "unit": c.unit or "un", "planned_qty": float(c.planned_qty or 0)})
        weights = {k: float(v) for k, v in (body.weights or {}).items() if v is not None and float(v) >= 0}
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"avanco_custom_items": customs, "avanco_weights": weights}})
        p["avanco_custom_items"], p["avanco_weights"] = customs, weights
        return {"status": "ok", "items": _build_items(p)}

    return router
