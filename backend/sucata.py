"""Set/2026 · Controle de materiais SUCATA (aba Estoque): itens com entradas (vindas da obra) e saídas
(venda / descarte / devolução à concessionária / reaproveitamento), saldo por item, KPIs e CSV."""
import csv
import io
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

REASONS = {"retirado_rede": "Retirado da rede", "danificado": "Danificado", "sobra_inservivel": "Sobra inservível", "outro": "Outro"}
DESTINATIONS = {"venda": "Venda", "descarte": "Descarte", "devolucao_concessionaria": "Devolução à concessionária", "reaproveitamento": "Reaproveitamento", "outro": "Outro"}


def _now():
    return datetime.now(timezone.utc).isoformat()


class MovementBody(BaseModel):
    type: str  # entrada | saida
    qty: float = 0
    weight_kg: float = 0
    date: Optional[str] = None
    project_id: str = ""
    project_code: str = ""
    team_name: str = ""
    reason: str = ""        # entrada
    destination: str = ""   # saída
    responsible: str = ""
    value: float = 0        # R$ (venda / valor estimado da remessa)
    notes: str = ""


class ScrapItemBody(BaseModel):
    code: str = ""
    description: str
    unit: str = "UN"
    unit_value: float = 0       # R$ estimado por unidade
    kg_value: float = 0         # R$ estimado por kg (se informado, prevalece no valor estimado)
    family: str = ""
    notes: str = ""
    initial: Optional[MovementBody] = None


class ScrapItemUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_value: Optional[float] = None
    kg_value: Optional[float] = None
    family: Optional[str] = None
    notes: Optional[str] = None


def _serialize(doc: dict) -> dict:
    movs = sorted(doc.get("movements") or [], key=lambda m: (m.get("date") or "", m.get("created_at") or ""))
    q_in = sum(float(m.get("qty") or 0) for m in movs if m.get("type") == "entrada")
    q_out = sum(float(m.get("qty") or 0) for m in movs if m.get("type") == "saida")
    kg_in = sum(float(m.get("weight_kg") or 0) for m in movs if m.get("type") == "entrada")
    kg_out = sum(float(m.get("weight_kg") or 0) for m in movs if m.get("type") == "saida")
    qty, kg = round(q_in - q_out, 3), round(kg_in - kg_out, 3)
    uv, kv = float(doc.get("unit_value") or 0), float(doc.get("kg_value") or 0)
    est = round(kg * kv, 2) if kv > 0 else round(qty * uv, 2)
    last_in = next((m for m in reversed(movs) if m.get("type") == "entrada"), None)
    sold = sum(float(m.get("value") or 0) for m in movs if m.get("type") == "saida" and m.get("destination") == "venda")
    return {
        "id": str(doc["_id"]), "code": doc.get("code", ""), "description": doc.get("description", ""), "unit": (doc.get("unit") or "UN").upper(),
        "unit_value": uv, "kg_value": kv, "family": doc.get("family", ""), "notes": doc.get("notes", ""),
        "qty_in": round(q_in, 3), "qty_out": round(q_out, 3), "qty": qty, "kg_in": round(kg_in, 3), "kg_out": round(kg_out, 3), "weight_kg": kg,
        "estimated_value": est, "sold_value": round(sold, 2), "movements_count": len(movs), "movements": list(reversed(movs)),
        "last_origin": {k: last_in.get(k, "") for k in ("project_code", "team_name", "reason", "date")} if last_in else None,
        "created_at": doc.get("created_at", ""), "updated_at": doc.get("updated_at", ""),
    }


def build_router(db, get_current_user, safe_object_id):
    router = APIRouter(prefix="/api/sucata")

    async def _get(item_id, user):
        doc = await db.scrap_items.find_one({"_id": safe_object_id(item_id), "user_id": user["_id"]})
        if not doc:
            raise HTTPException(status_code=404, detail="Item de sucata não encontrado")
        return doc

    def _mov_doc(body: MovementBody, user) -> dict:
        if body.type not in ("entrada", "saida"):
            raise HTTPException(status_code=400, detail="Tipo deve ser 'entrada' ou 'saida'")
        if float(body.qty or 0) <= 0 and float(body.weight_kg or 0) <= 0:
            raise HTTPException(status_code=400, detail="Informe quantidade ou peso (kg) maior que zero")
        if body.type == "entrada" and body.reason and body.reason not in REASONS:
            raise HTTPException(status_code=400, detail=f"Motivo inválido. Use: {list(REASONS)}")
        if body.type == "saida" and body.destination and body.destination not in DESTINATIONS:
            raise HTTPException(status_code=400, detail=f"Destino inválido. Use: {list(DESTINATIONS)}")
        return {
            "id": uuid4().hex[:12], "type": body.type, "qty": float(body.qty or 0), "weight_kg": float(body.weight_kg or 0),
            "date": (body.date or _now())[:10], "project_id": body.project_id, "project_code": body.project_code.strip(), "team_name": body.team_name.strip(),
            "reason": body.reason if body.type == "entrada" else "", "destination": body.destination if body.type == "saida" else "",
            "responsible": body.responsible.strip() or user.get("name", ""), "value": float(body.value or 0), "notes": (body.notes or "").strip()[:500],
            "created_at": _now(), "created_by": user.get("email", ""),
        }

    @router.get("")
    async def list_items(q: str = "", reason: str = "", only_balance: int = 0, current_user: dict = Depends(get_current_user)):
        items = [_serialize(d) for d in await db.scrap_items.find({"user_id": current_user["_id"]}).sort("description", 1).to_list(5000)]
        if q:
            ql = q.lower()
            items = [i for i in items if ql in (i["code"] or "").lower() or ql in (i["description"] or "").lower() or ql in (i["family"] or "").lower()
                     or any(ql in (m.get("project_code") or "").lower() for m in i["movements"])]
        if reason:
            items = [i for i in items if any(m.get("reason") == reason for m in i["movements"])]
        if only_balance:
            items = [i for i in items if i["qty"] > 0 or i["weight_kg"] > 0]
        return {"items": items, "reasons": REASONS, "destinations": DESTINATIONS}

    @router.get("/kpis")
    async def kpis(current_user: dict = Depends(get_current_user)):
        items = [_serialize(d) for d in await db.scrap_items.find({"user_id": current_user["_id"]}).to_list(5000)]
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        movs = [m for i in items for m in i["movements"]]
        return {
            "items": len(items), "items_with_balance": sum(1 for i in items if i["qty"] > 0 or i["weight_kg"] > 0),
            "qty_total": round(sum(i["qty"] for i in items), 3), "kg_total": round(sum(i["weight_kg"] for i in items), 3),
            "estimated_value": round(sum(i["estimated_value"] for i in items), 2), "sold_value": round(sum(i["sold_value"] for i in items), 2),
            "entries_month": sum(1 for m in movs if m.get("type") == "entrada" and (m.get("date") or "").startswith(month)),
            "exits_month": sum(1 for m in movs if m.get("type") == "saida" and (m.get("date") or "").startswith(month)),
            "kg_in_month": round(sum(float(m.get("weight_kg") or 0) for m in movs if m.get("type") == "entrada" and (m.get("date") or "").startswith(month)), 3),
            "by_reason": {k: round(sum(float(m.get("weight_kg") or 0) for m in movs if m.get("type") == "entrada" and m.get("reason") == k), 3) for k in REASONS},
        }

    @router.post("")
    async def create_item(body: ScrapItemBody, current_user: dict = Depends(get_current_user)):
        if not body.description.strip():
            raise HTTPException(status_code=400, detail="Descrição obrigatória")
        doc = {
            "user_id": current_user["_id"], "code": body.code.strip(), "description": body.description.strip(), "unit": (body.unit or "UN").upper(),
            "unit_value": float(body.unit_value or 0), "kg_value": float(body.kg_value or 0), "family": body.family.strip(), "notes": body.notes.strip(),
            "movements": [], "created_at": _now(), "updated_at": _now(), "created_by": current_user.get("email", ""),
        }
        if body.initial:
            doc["movements"].append(_mov_doc(body.initial, current_user))
        r = await db.scrap_items.insert_one(doc)
        doc["_id"] = r.inserted_id
        return _serialize(doc)

    @router.patch("/{item_id}")
    async def update_item(item_id: str, body: ScrapItemUpdate, current_user: dict = Depends(get_current_user)):
        await _get(item_id, current_user)
        upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "unit" in upd:
            upd["unit"] = (upd["unit"] or "UN").upper()
        upd["updated_at"] = _now()
        await db.scrap_items.update_one({"_id": safe_object_id(item_id)}, {"$set": upd})
        return _serialize(await _get(item_id, current_user))

    @router.delete("/{item_id}")
    async def delete_item(item_id: str, current_user: dict = Depends(get_current_user)):
        await _get(item_id, current_user)
        await db.scrap_items.delete_one({"_id": safe_object_id(item_id)})
        return {"status": "deleted"}

    @router.post("/{item_id}/movements")
    async def add_movement(item_id: str, body: MovementBody, current_user: dict = Depends(get_current_user)):
        doc = await _get(item_id, current_user)
        mov = _mov_doc(body, current_user)
        if mov["type"] == "saida":
            cur = _serialize(doc)
            if mov["qty"] > cur["qty"] + 1e-9 and cur["qty_in"] > 0:
                raise HTTPException(status_code=400, detail=f"Saída ({mov['qty']:g}) maior que o saldo em sucata ({cur['qty']:g})")
            if mov["weight_kg"] > cur["weight_kg"] + 1e-9 and cur["kg_in"] > 0:
                raise HTTPException(status_code=400, detail=f"Saída ({mov['weight_kg']:g} kg) maior que o peso em sucata ({cur['weight_kg']:g} kg)")
        await db.scrap_items.update_one({"_id": doc["_id"]}, {"$push": {"movements": mov}, "$set": {"updated_at": _now()}})
        return {"status": "ok", "movement": mov, "item": _serialize(await _get(item_id, current_user))}

    @router.delete("/{item_id}/movements/{mov_id}")
    async def delete_movement(item_id: str, mov_id: str, current_user: dict = Depends(get_current_user)):
        doc = await _get(item_id, current_user)
        await db.scrap_items.update_one({"_id": doc["_id"]}, {"$pull": {"movements": {"id": mov_id}}, "$set": {"updated_at": _now()}})
        return {"status": "deleted", "item": _serialize(await _get(item_id, current_user))}

    @router.get("/export")
    async def export_csv(current_user: dict = Depends(get_current_user)):
        items = [_serialize(d) for d in await db.scrap_items.find({"user_id": current_user["_id"]}).sort("description", 1).to_list(5000)]
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(["Código", "Descrição", "Un", "Família", "Saldo Qtd", "Saldo Kg", "Entradas Qtd", "Saídas Qtd", "Entradas Kg", "Saídas Kg", "Valor Estimado (R$)", "Vendido (R$)", "Última origem (obra)", "Última equipe", "Último motivo"])
        for i in items:
            lo = i["last_origin"] or {}
            w.writerow([i["code"], i["description"], i["unit"], i["family"], f"{i['qty']:g}", f"{i['weight_kg']:g}", f"{i['qty_in']:g}", f"{i['qty_out']:g}", f"{i['kg_in']:g}", f"{i['kg_out']:g}",
                        f"{i['estimated_value']:.2f}".replace(".", ","), f"{i['sold_value']:.2f}".replace(".", ","), lo.get("project_code", ""), lo.get("team_name", ""), REASONS.get(lo.get("reason", ""), lo.get("reason", ""))])
        w.writerow([])
        w.writerow(["MOVIMENTAÇÕES"])
        w.writerow(["Data", "Tipo", "Código", "Descrição", "Qtd", "Kg", "Obra", "Equipe", "Motivo", "Destino", "Responsável", "Valor (R$)", "Obs"])
        for i in items:
            for m in sorted(i["movements"], key=lambda x: x.get("date") or ""):
                w.writerow([m.get("date", ""), "Entrada" if m.get("type") == "entrada" else "Saída", i["code"], i["description"], f"{float(m.get('qty') or 0):g}", f"{float(m.get('weight_kg') or 0):g}",
                            m.get("project_code", ""), m.get("team_name", ""), REASONS.get(m.get("reason", ""), m.get("reason", "")), DESTINATIONS.get(m.get("destination", ""), m.get("destination", "")),
                            m.get("responsible", ""), f"{float(m.get('value') or 0):.2f}".replace(".", ","), m.get("notes", "")])
        data = ("\ufeff" + buf.getvalue()).encode("utf-8")
        fn = f"sucata_{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
        return Response(content=data, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{fn}"'})

    return router
