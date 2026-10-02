"""Set/2026 · Medição de Mão de Obra.
Base geral do contrato (catálogo de serviços com preço unitário) + por obra: lista ORÇADA (vira `labor_cost`) e lista
REALIZADA no fechamento (vira `actual_value` = Produção Realizada → alimenta a esteira de Faturamento)."""
import asyncio
import base64
import csv
import io
import re
from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
HEADER_KEYWORDS = {
    "code": ["cod", "código", "codigo", "item", "ref", "sap", "code"],
    "unit_price": ["preço unit", "preco unit", "valor unit", "vlr unit", "p. unit", "unitário", "unitario", "preço", "preco", "valor", "price"],
    "qty": ["quant", "qtd", "qtde", "qty"],
    "unit": ["unid", "un.", "un", "um", "unit"],
    "description": ["descri", "serviço", "servico", "mão de obra", "mao de obra", "atividade", "description"],
    "group": ["grupo", "família", "familia", "categoria", "group"],
}
ORDER = ["unit_price", "qty", "code", "unit", "group", "description"]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _num(v) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("R$", "").replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    s = re.sub(r"[^0-9.\-]", "", s)
    try:
        return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError:
        return 0.0


def _match(header: str) -> Optional[str]:
    h = str(header or "").strip().lower()
    if not h:
        return None
    if "total" in h:
        return None
    for field in ORDER:
        if any(k in h for k in HEADER_KEYWORDS[field]):
            if field == "code" and any(k in h for k in HEADER_KEYWORDS["description"]):
                continue
            if field == "unit" and h not in ("un", "und", "unid", "unid.", "unidade", "um", "unit", "un."):
                continue
            return field
    return None


def parse_labor_sheet(content: bytes, filename: str) -> List[dict]:
    """Lê xlsx/csv: detecta cabeçalho por palavras-chave (código / descrição / un / preço / qtd) em qualquer linha/aba."""
    rows: List[List] = []
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
        for ws in wb.worksheets:
            for r in ws.iter_rows(values_only=True):
                rows.append(list(r))
            rows.append(["__SHEET_BREAK__"])
    else:
        text = content.decode("utf-8-sig", errors="ignore")
        sample = text[:4000]
        delim = ";" if sample.count(";") >= sample.count(",") else ","
        rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim)]
    out: List[dict] = []
    mapping: dict = {}
    for r in rows:
        if r and r[0] == "__SHEET_BREAK__":
            mapping = {}
            continue
        cells = [("" if c is None else str(c).strip()) for c in (r or [])]
        if not any(cells):
            continue
        fields = {i: _match(c) for i, c in enumerate(cells)}
        found = {f for f in fields.values() if f}
        if "description" in found and ("unit_price" in found or "code" in found) and len(found) >= 2:
            mapping = {f: i for i, f in fields.items() if f}
            continue
        if not mapping or "description" not in mapping:
            continue
        desc = cells[mapping["description"]] if mapping["description"] < len(cells) else ""
        if not desc or desc.lower().startswith("total"):
            continue
        get = lambda f: (cells[mapping[f]] if f in mapping and mapping[f] < len(cells) else "")  # noqa: E731
        out.append({"code": get("code"), "description": desc, "unit": (get("unit") or "UN").upper()[:10], "unit_price": _num(get("unit_price")),
                    "qty": _num(get("qty")), "group": get("group")})
    return out


class CatalogItem(BaseModel):
    code: str = ""
    description: str
    unit: str = "UN"
    unit_price: float = 0
    group: str = ""


class CatalogUpdate(BaseModel):
    code: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = None
    unit_price: Optional[float] = None
    group: Optional[str] = None


class LaborLine(BaseModel):
    id: Optional[str] = None
    catalog_id: str = ""
    code: str = ""
    description: str
    unit: str = "UN"
    unit_price: float = 0
    qty: float = 0
    notes: str = ""
    group: str = ""


class LinesBody(BaseModel):
    items: List[LaborLine]


class Fiscal(BaseModel):
    name: str = ""
    email: str = ""
    phone: str = ""


class FiscaisBody(BaseModel):
    fiscais: List[Fiscal]


class EnvioBody(BaseModel):
    recipients: List[str]
    message: str = ""
    notes: str = ""
    period: str = ""
    number: str = ""
    copy_me: bool = True
    save_fiscais: bool = True


def _line(l: LaborLine) -> dict:
    qty, price = float(l.qty or 0), float(l.unit_price or 0)
    return {"id": l.id or uuid4().hex[:10], "catalog_id": l.catalog_id or "", "code": (l.code or "").strip(), "description": l.description.strip(),
            "unit": (l.unit or "UN").upper()[:10], "unit_price": price, "qty": qty, "total": round(qty * price, 2), "notes": (l.notes or "").strip()[:300],
            "group": (l.group or "").strip()[:80]}


def _total(items) -> float:
    return round(sum(float(i.get("total") or 0) for i in (items or [])), 2)


def _cat(doc: dict) -> dict:
    return {"id": str(doc["_id"]), "code": doc.get("code", ""), "description": doc.get("description", ""), "unit": doc.get("unit", "UN"),
            "unit_price": float(doc.get("unit_price") or 0), "group": doc.get("group", ""), "updated_at": doc.get("updated_at", "")}


def build_router(db, get_current_user, safe_object_id, build_project_response=None, company_loader=None, send_email=None, app_url: str = ""):
    router = APIRouter(prefix="/api")

    async def _project(pid, user):
        p = await db.projects.find_one({"_id": safe_object_id(pid), "user_id": user["_id"]})
        if not p:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        return p

    def _detail(p: dict) -> dict:
        budget, measured = p.get("labor_budget") or [], p.get("labor_measured") or []
        tb, tm = _total(budget), _total(measured)
        return {
            "project": {"id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""), "team_name": p.get("team_name", ""),
                        "execution_status": p.get("execution_status", ""), "billing_stage": p.get("billing_stage", ""), "programmed_value": float(p.get("programmed_value") or 0),
                        "actual_value": float(p.get("actual_value") or 0), "labor_cost": float(p.get("labor_cost") or 0), "project_type": p.get("project_type", ""),
                        "location": p.get("location", "")},
            "budget": budget, "measured": measured,
            "totals": {"orcado": tb, "realizado": tm, "diff": round(tm - tb, 2), "pct": round(100 * tm / tb, 1) if tb > 0 else None,
                       "orcado_count": len(budget), "realizado_count": len(measured)},
            "applied": {"labor_cost": float(p.get("labor_cost") or 0), "actual_value": float(p.get("actual_value") or 0),
                        "at": p.get("medicao_applied_at", ""), "by": p.get("medicao_applied_by", "")},
            "fiscais": p.get("fiscais") or [],
            "envios": list(reversed((p.get("medicao_envios") or [])[-10:])),
        }

    async def _groups_map(user_id) -> dict:
        """catalog_id → grupo e ("code", código) → grupo, para agrupar linhas antigas sem `group`."""
        out = {}
        async for c in db.labor_catalog.find({"user_id": user_id}, {"code": 1, "group": 1}):
            g = (c.get("group") or "").strip()
            if g:
                out[str(c["_id"])] = g
                if c.get("code"):
                    out[("code", str(c["code"]).strip())] = g
        return out

    async def _render_pdf(p: dict, user: dict, meta: dict) -> tuple:
        from medicao_pdf import build_medicao_pdf, group_items
        items = p.get("labor_measured") or []
        groups = group_items(items, await _groups_map(user["_id"]))
        company, logo = (await company_loader(user["_id"])) if company_loader else ({"name": "HAYAH ENERGY"}, None)
        pdf = await asyncio.to_thread(build_medicao_pdf, p, items, groups, company, logo, meta)
        code = re.sub(r"[^A-Za-z0-9_-]+", "_", p.get("project_code") or p.get("name") or "obra")[:40]
        return pdf, f"medicao_{code}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf", groups, company

    # ── Catálogo (base geral do contrato) ─────────────────────────────────
    @router.get("/medicao/catalogo")
    async def list_catalog(q: str = "", current_user: dict = Depends(get_current_user)):
        docs = await db.labor_catalog.find({"user_id": current_user["_id"]}).sort([("group", 1), ("code", 1)]).to_list(10000)
        items = [_cat(d) for d in docs]
        if q:
            ql = q.lower()
            items = [i for i in items if ql in i["code"].lower() or ql in i["description"].lower() or ql in i["group"].lower()]
        return {"items": items, "count": len(items)}

    @router.post("/medicao/catalogo")
    async def create_catalog(body: CatalogItem, current_user: dict = Depends(get_current_user)):
        if not body.description.strip():
            raise HTTPException(status_code=400, detail="Descrição obrigatória")
        doc = {"user_id": current_user["_id"], "code": body.code.strip(), "description": body.description.strip(), "unit": (body.unit or "UN").upper()[:10],
               "unit_price": float(body.unit_price or 0), "group": body.group.strip(), "created_at": _now(), "updated_at": _now()}
        r = await db.labor_catalog.insert_one(doc)
        doc["_id"] = r.inserted_id
        return _cat(doc)

    @router.patch("/medicao/catalogo/{item_id}")
    async def update_catalog(item_id: str, body: CatalogUpdate, current_user: dict = Depends(get_current_user)):
        upd = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
        if "unit" in upd:
            upd["unit"] = (upd["unit"] or "UN").upper()[:10]
        upd["updated_at"] = _now()
        r = await db.labor_catalog.update_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]}, {"$set": upd})
        if r.matched_count == 0:
            raise HTTPException(status_code=404, detail="Item não encontrado")
        return _cat(await db.labor_catalog.find_one({"_id": safe_object_id(item_id)}))

    @router.delete("/medicao/catalogo/{item_id}")
    async def delete_catalog(item_id: str, current_user: dict = Depends(get_current_user)):
        r = await db.labor_catalog.delete_one({"_id": safe_object_id(item_id), "user_id": current_user["_id"]})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Item não encontrado")
        return {"status": "deleted"}

    @router.post("/medicao/catalogo/import")
    async def import_catalog(file: UploadFile = File(...), replace: bool = Form(False), current_user: dict = Depends(get_current_user)):
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Arquivo maior que 10MB")
        parsed = parse_labor_sheet(content, file.filename or "")
        if not parsed:
            raise HTTPException(status_code=400, detail="Não encontrei colunas de Código/Descrição/Preço na planilha")
        if replace:
            await db.labor_catalog.delete_many({"user_id": current_user["_id"]})
        created = updated = 0
        for it in parsed:
            key = {"user_id": current_user["_id"], "code": it["code"]} if it["code"] else {"user_id": current_user["_id"], "description": it["description"]}
            existing = await db.labor_catalog.find_one(key)
            doc = {"code": it["code"], "description": it["description"], "unit": it["unit"], "unit_price": it["unit_price"], "group": it["group"], "updated_at": _now()}
            if existing:
                await db.labor_catalog.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                await db.labor_catalog.insert_one({**doc, "user_id": current_user["_id"], "created_at": _now()})
                created += 1
        total = await db.labor_catalog.count_documents({"user_id": current_user["_id"]})
        return {"imported": len(parsed), "created": created, "updated": updated, "total": total}

    # ── Lista de obras para a aba ─────────────────────────────────────────
    @router.get("/medicao/projects")
    async def list_projects(q: str = "", current_user: dict = Depends(get_current_user)):
        proj = {"project_code": 1, "name": 1, "team_name": 1, "execution_status": 1, "billing_stage": 1, "programmed_value": 1, "actual_value": 1,
                "labor_cost": 1, "labor_budget": 1, "labor_measured": 1, "medicao_applied_at": 1, "project_type": 1, "location": 1}
        docs = await db.projects.find({"user_id": current_user["_id"]}, proj).sort("created_at", -1).to_list(5000)
        out = []
        ql = q.lower().strip()
        for p in docs:
            if ql and ql not in (p.get("project_code") or "").lower() and ql not in (p.get("name") or "").lower() and ql not in (p.get("team_name") or "").lower():
                continue
            tb, tm = _total(p.get("labor_budget")), _total(p.get("labor_measured"))
            out.append({"id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""), "team_name": p.get("team_name", ""),
                        "execution_status": p.get("execution_status", ""), "billing_stage": p.get("billing_stage", ""), "project_type": p.get("project_type", ""),
                        "programmed_value": float(p.get("programmed_value") or 0), "actual_value": float(p.get("actual_value") or 0), "labor_cost": float(p.get("labor_cost") or 0),
                        "orcado": tb, "realizado": tm, "orcado_count": len(p.get("labor_budget") or []), "realizado_count": len(p.get("labor_measured") or []),
                        "applied_at": p.get("medicao_applied_at", "")})
        totals = {"projects": len(out), "orcado": round(sum(o["orcado"] for o in out), 2), "realizado": round(sum(o["realizado"] for o in out), 2),
                  "with_measurement": sum(1 for o in out if o["realizado_count"])}
        return {"projects": out, "totals": totals}

    # ── Por obra ───────────────────────────────────────────────────────────
    @router.get("/projects/{project_id}/medicao")
    async def get_medicao(project_id: str, current_user: dict = Depends(get_current_user)):
        return _detail(await _project(project_id, current_user))

    @router.put("/projects/{project_id}/medicao/orcado")
    async def save_budget(project_id: str, body: LinesBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        items = [_line(l) for l in body.items if l.description.strip()]
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"labor_budget": items, "labor_cost": _total(items), "labor_budget_updated_at": _now()}})
        return _detail(await _project(project_id, current_user))

    @router.post("/projects/{project_id}/medicao/orcado/import")
    async def import_budget(project_id: str, file: UploadFile = File(...), replace: bool = Form(True), current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        content = await file.read()
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Arquivo maior que 10MB")
        parsed = parse_labor_sheet(content, file.filename or "")
        if not parsed:
            raise HTTPException(status_code=400, detail="Não encontrei colunas de Descrição/Preço/Quantidade na planilha")
        new_items = [_line(LaborLine(code=it["code"], description=it["description"], unit=it["unit"], unit_price=it["unit_price"], qty=it["qty"] or 1)) for it in parsed]
        items = new_items if replace else (p.get("labor_budget") or []) + new_items
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"labor_budget": items, "labor_cost": _total(items), "labor_budget_updated_at": _now()}})
        return {"imported": len(new_items), **_detail(await _project(project_id, current_user))}

    @router.put("/projects/{project_id}/medicao/realizado")
    async def save_measured(project_id: str, body: LinesBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        items = [_line(l) for l in body.items if l.description.strip()]
        total = _total(items)
        old = float(p.get("actual_value") or 0)
        upd = {"labor_measured": items, "actual_value": total, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")}
        push = {"movement_history": {"event": "medicao_aplicada", "field": "actual_value", "old": old, "new": total, "at": _now(), "by": current_user.get("name", ""),
                                     "note": f"Medição de mão de obra: {len(items)} item(ns)"}}
        await db.projects.update_one({"_id": p["_id"]}, {"$set": upd, "$push": push})
        return _detail(await _project(project_id, current_user))

    @router.post("/projects/{project_id}/medicao/realizado/from-orcado")
    async def copy_budget(project_id: str, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        items = [{**i, "id": uuid4().hex[:10]} for i in (p.get("labor_budget") or [])]
        if not items:
            raise HTTPException(status_code=400, detail="Esta obra não tem lista orçada")
        old = float(p.get("actual_value") or 0)
        total = _total(items)
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"labor_measured": items, "actual_value": total, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")},
                                                          "$push": {"movement_history": {"event": "medicao_aplicada", "field": "actual_value", "old": old, "new": total, "at": _now(), "by": current_user.get("name", ""), "note": "Realizado copiado do orçado"}}})
        return _detail(await _project(project_id, current_user))

    # ── Fiscais da obra · PDF · envio por e-mail ───────────────────────────
    @router.put("/projects/{project_id}/medicao/fiscais")
    async def save_fiscais(project_id: str, body: FiscaisBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        fiscais = [{"name": f.name.strip()[:80], "email": f.email.strip().lower()[:120], "phone": f.phone.strip()[:30]} for f in body.fiscais if (f.name or f.email).strip()]
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"fiscais": fiscais}})
        return _detail(await _project(project_id, current_user))

    @router.get("/projects/{project_id}/medicao/pdf")
    async def medicao_pdf(project_id: str, notes: str = "", period: str = "", number: str = "", current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        pdf, filename, _g, _c = await _render_pdf(p, current_user, {"notes": notes[:1000], "period": period[:60], "number": number[:30]})
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Content-Length": str(len(pdf)), "Cache-Control": "no-store"})

    @router.post("/projects/{project_id}/medicao/enviar")
    async def enviar_medicao(project_id: str, body: EnvioBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        if not (p.get("labor_measured") or []):
            raise HTTPException(status_code=400, detail="Lance e salve a medição (lista realizada) antes de enviar")
        recipients = sorted({r.strip().lower() for r in body.recipients if EMAIL_RE.match(r.strip())})
        if not recipients:
            raise HTTPException(status_code=400, detail="Informe ao menos um e-mail válido de fiscal")
        if body.copy_me and EMAIL_RE.match(current_user.get("email") or ""):
            recipients = sorted(set(recipients) | {current_user["email"].strip().lower()})
        if body.save_fiscais:
            known = {f.get("email") for f in (p.get("fiscais") or [])}
            new = [{"name": "", "email": r, "phone": ""} for r in recipients if r not in known and r != (current_user.get("email") or "").lower()]
            if new:
                await db.projects.update_one({"_id": p["_id"]}, {"$set": {"fiscais": (p.get("fiscais") or []) + new}})
                p["fiscais"] = (p.get("fiscais") or []) + new
        pdf, filename, groups, company = await _render_pdf(p, current_user, {"notes": body.notes[:1000], "period": body.period[:60], "number": body.number[:30]})
        from medicao_pdf import medicao_email_html
        total_qty = sum(float(i.get("qty") or 0) for i in p["labor_measured"])
        total_val = _total(p["labor_measured"])
        default_msg = (f"Prezado(a) fiscal,\n\nSegue em anexo o Resumo de Mão de Obra da obra {p.get('project_code') or ''} — {p.get('name') or ''}, "
                       f"totalizando {len(p['labor_measured'])} serviço(s) e R$ {total_val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + ".\n\nFicamos à disposição para conferência e validação.")
        html = medicao_email_html(p, groups, total_qty, total_val, company, body.message.strip() or default_msg)
        subject = f"[{company.get('name', 'HAYAH ENERGY')}] Medição de Mão de Obra · {p.get('project_code') or p.get('name') or ''}"
        if not send_email:
            raise HTTPException(status_code=503, detail="Envio de e-mail não configurado")
        result = await send_email(recipients, subject, html, [{"filename": filename, "content": base64.b64encode(pdf).decode("ascii")}])
        entry = {"id": uuid4().hex[:10], "at": _now(), "by": current_user.get("name", ""), "recipients": recipients, "status": result.get("status"),
                 "email_id": result.get("id", ""), "error": result.get("error", "") or result.get("reason", ""), "total": total_val, "items": len(p["labor_measured"]),
                 "filename": filename, "period": body.period[:60], "number": body.number[:30]}
        await db.projects.update_one({"_id": p["_id"]}, {"$push": {"medicao_envios": entry}})
        if result.get("status") == "error":
            raise HTTPException(status_code=502, detail=f"Falha ao enviar e-mail: {result.get('error')}")
        if result.get("status") == "skipped":
            raise HTTPException(status_code=503, detail="RESEND_API_KEY não configurada — cadastre em Configurações › Integrações para enviar e-mails")
        return {"status": "sent", "recipients": recipients, "filename": filename, "envio": entry, **_detail(await _project(project_id, current_user))}

    return router
