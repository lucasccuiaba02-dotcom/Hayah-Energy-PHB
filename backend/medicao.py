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
    medicao_id: str = ""


class FecharBody(BaseModel):
    period_from: str = ""
    period_to: str = ""
    notes: str = ""


def _period_label(a: str, b: str) -> str:
    a, b = (a or "")[:10], (b or "")[:10]
    br = lambda s: "/".join(reversed(s.split("-"))) if s else ""  # noqa: E731
    if a and b:
        return f"{br(a)} a {br(b)}"
    return br(a) or br(b) or ""


def _line(l: LaborLine) -> dict:
    qty, price = float(l.qty or 0), float(l.unit_price or 0)
    return {"id": l.id or uuid4().hex[:10], "catalog_id": l.catalog_id or "", "code": (l.code or "").strip(), "description": l.description.strip(),
            "unit": (l.unit or "UN").upper()[:10], "unit_price": price, "qty": qty, "total": round(qty * price, 2), "notes": (l.notes or "").strip()[:300],
            "group": (l.group or "").strip()[:80]}


def _total(items) -> float:
    return round(sum(float(i.get("total") or 0) for i in (items or [])), 2)


def _cat(doc: dict) -> dict:
    return {"id": str(doc["_id"]), "code": doc.get("code", ""), "description": doc.get("description", ""), "unit": doc.get("unit", "UN"),
            "unit_price": float(doc.get("unit_price") or 0), "group": doc.get("group", ""), "updated_at": doc.get("updated_at", ""),
            "action": doc.get("action", ""), "linha": doc.get("linha", ""), "ups": doc.get("ups"), "base_price": doc.get("base_price"),
            "adjust_pct": doc.get("adjust_pct"), "source": doc.get("source", "")}


class TabelaContratoBody(BaseModel):
    pct: float = 6.0
    replace: bool = True


def build_router(db, get_current_user, safe_object_id, build_project_response=None, company_loader=None, send_email=None, app_url: str = ""):
    router = APIRouter(prefix="/api")

    async def _project(pid, user):
        p = await db.projects.find_one({"_id": safe_object_id(pid), "user_id": user["_id"]})
        if not p:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        return p

    def _detail(p: dict) -> dict:
        budget, measured, medicoes = p.get("labor_budget") or [], p.get("labor_measured") or [], p.get("medicoes") or []
        tb, draft = _total(budget), _total(measured)
        fechado = round(sum(float(m.get("total") or 0) for m in medicoes), 2)
        tm = round(fechado + draft, 2)
        envios = p.get("medicao_envios") or []
        return {
            "project": {"id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""), "team_name": p.get("team_name", ""),
                        "execution_status": p.get("execution_status", ""), "billing_stage": p.get("billing_stage", ""), "programmed_value": float(p.get("programmed_value") or 0),
                        "actual_value": float(p.get("actual_value") or 0), "labor_cost": float(p.get("labor_cost") or 0), "project_type": p.get("project_type", ""),
                        "location": p.get("location", "")},
            "budget": budget, "measured": measured,
            "medicoes": [{**m, "envios": sum(1 for e in envios if e.get("medicao_id") == m.get("id"))} for m in medicoes],
            "next_number": len(medicoes) + 1,
            "totals": {"orcado": tb, "realizado": tm, "fechado": fechado, "em_aberto": draft, "diff": round(tm - tb, 2), "pct": round(100 * tm / tb, 1) if tb > 0 else None,
                       "orcado_count": len(budget), "realizado_count": len(measured), "medicoes_count": len(medicoes)},
            "applied": {"labor_cost": float(p.get("labor_cost") or 0), "actual_value": float(p.get("actual_value") or 0),
                        "at": p.get("medicao_applied_at", ""), "by": p.get("medicao_applied_by", "")},
            "fiscais": p.get("fiscais") or [],
            "envios": list(reversed(envios[-10:])),
        }

    def _fechado(p: dict) -> float:
        return round(sum(float(m.get("total") or 0) for m in (p.get("medicoes") or [])), 2)

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

    async def _render_pdf(p: dict, user: dict, meta: dict, medicao: dict | None = None) -> tuple:
        from medicao_pdf import build_medicao_pdf, group_items
        items = (medicao or {}).get("items") if medicao else (p.get("labor_measured") or [])
        groups = group_items(items, await _groups_map(user["_id"]))
        company, logo = (await company_loader(user["_id"])) if company_loader else ({"name": "HAYAH ENERGY"}, None)
        medicoes = p.get("medicoes") or []
        if medicao:
            meta = {**meta, "number": medicao.get("number"), "period": meta.get("period") or _period_label(medicao.get("period_from"), medicao.get("period_to")),
                    "notes": meta.get("notes") or medicao.get("notes") or "", "closed_at": medicao.get("closed_at"),
                    "accumulated": round(sum(float(m.get("total") or 0) for m in medicoes if int(m.get("number") or 0) <= int(medicao.get("number") or 0)), 2)}
        elif medicoes:
            meta = {**meta, "number": len(medicoes) + 1, "draft": True, "accumulated": round(_fechado(p) + _total(items), 2)}
        pdf = await asyncio.to_thread(build_medicao_pdf, p, items, groups, company, logo, meta)
        code = re.sub(r"[^A-Za-z0-9_-]+", "_", p.get("project_code") or p.get("name") or "obra")[:40]
        suffix = f"_med{medicao['number']:02d}" if medicao else ""
        return pdf, f"medicao_{code}{suffix}_{datetime.now(timezone.utc).strftime('%Y%m%d')}.pdf", groups, company, meta

    def _find_medicao(p: dict, mid: str) -> dict | None:
        if not mid:
            return None
        m = next((m for m in (p.get("medicoes") or []) if m.get("id") == mid), None)
        if not m:
            raise HTTPException(status_code=404, detail="Medição não encontrada")
        return m

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

    @router.get("/medicao/catalogo/tabela-contrato")
    async def tabela_contrato_info(current_user: dict = Depends(get_current_user)):
        from tabela_precos import SOURCE, load_tabela
        rows = load_tabela()
        loaded = await db.labor_catalog.count_documents({"user_id": current_user["_id"], "source": SOURCE})
        flag = await db.app_settings.find_one({"key": "labor_catalog_seed", "user_id": str(current_user["_id"]), "source": SOURCE}, {"_id": 0, "at": 1, "result": 1})
        return {"rows": len(rows), "lm": sum(1 for r in rows if r["linha"] == "LM"), "lv": sum(1 for r in rows if r["linha"] == "LV"),
                "loaded": loaded, "seeded_at": (flag or {}).get("at", ""), "pct": ((flag or {}).get("result") or {}).get("pct")}

    @router.post("/medicao/catalogo/tabela-contrato")
    async def tabela_contrato_load(body: TabelaContratoBody, current_user: dict = Depends(get_current_user)):
        from tabela_precos import SOURCE, seed_catalog
        if body.pct < 0 or body.pct > 100:
            raise HTTPException(status_code=400, detail="Percentual de reajuste deve ficar entre 0 e 100")
        res = await seed_catalog(db, current_user["_id"], body.pct, replace=body.replace)
        await db.app_settings.update_one({"key": "labor_catalog_seed", "user_id": str(current_user["_id"]), "source": SOURCE},
                                         {"$set": {"result": res, "at": _now()}}, upsert=True)
        return res

    # ── Lista de obras para a aba ─────────────────────────────────────────
    @router.get("/medicao/projects")
    async def list_projects(q: str = "", current_user: dict = Depends(get_current_user)):
        proj = {"project_code": 1, "name": 1, "team_name": 1, "execution_status": 1, "billing_stage": 1, "programmed_value": 1, "actual_value": 1,
                "labor_cost": 1, "labor_budget": 1, "labor_measured": 1, "medicao_applied_at": 1, "project_type": 1, "location": 1, "medicoes.total": 1}
        docs = await db.projects.find({"user_id": current_user["_id"]}, proj).sort("created_at", -1).to_list(5000)
        out = []
        ql = q.lower().strip()
        for p in docs:
            if ql and ql not in (p.get("project_code") or "").lower() and ql not in (p.get("name") or "").lower() and ql not in (p.get("team_name") or "").lower():
                continue
            fechado = round(sum(float(m.get("total") or 0) for m in (p.get("medicoes") or [])), 2)
            tb, tm = _total(p.get("labor_budget")), round(fechado + _total(p.get("labor_measured")), 2)
            out.append({"id": str(p["_id"]), "project_code": p.get("project_code", ""), "name": p.get("name", ""), "team_name": p.get("team_name", ""),
                        "execution_status": p.get("execution_status", ""), "billing_stage": p.get("billing_stage", ""), "project_type": p.get("project_type", ""),
                        "programmed_value": float(p.get("programmed_value") or 0), "actual_value": float(p.get("actual_value") or 0), "labor_cost": float(p.get("labor_cost") or 0),
                        "orcado": tb, "realizado": tm, "fechado": fechado, "medicoes_count": len(p.get("medicoes") or []),
                        "orcado_count": len(p.get("labor_budget") or []), "realizado_count": len(p.get("labor_measured") or []) + len(p.get("medicoes") or []),
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
        total = round(_fechado(p) + _total(items), 2)
        old = float(p.get("actual_value") or 0)
        upd = {"labor_measured": items, "actual_value": total, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")}
        push = {"movement_history": {"event": "medicao_aplicada", "field": "actual_value", "old": old, "new": total, "at": _now(), "by": current_user.get("name", ""),
                                     "note": f"Medição de mão de obra nº {len(p.get('medicoes') or []) + 1} (em aberto): {len(items)} item(ns)"}}
        await db.projects.update_one({"_id": p["_id"]}, {"$set": upd, "$push": push})
        return _detail(await _project(project_id, current_user))

    @router.post("/projects/{project_id}/medicao/realizado/from-orcado")
    async def copy_budget(project_id: str, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        items = [{**i, "id": uuid4().hex[:10]} for i in (p.get("labor_budget") or [])]
        if not items:
            raise HTTPException(status_code=400, detail="Esta obra não tem lista orçada")
        old = float(p.get("actual_value") or 0)
        total = round(_fechado(p) + _total(items), 2)
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"labor_measured": items, "actual_value": total, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")},
                                                          "$push": {"movement_history": {"event": "medicao_aplicada", "field": "actual_value", "old": old, "new": total, "at": _now(), "by": current_user.get("name", ""), "note": "Realizado copiado do orçado"}}})
        return _detail(await _project(project_id, current_user))

    # ── Medições parciais (fechamentos numerados) ─────────────────────────
    @router.post("/projects/{project_id}/medicao/fechar")
    async def fechar_medicao(project_id: str, body: FecharBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        items = p.get("labor_measured") or []
        if not items:
            raise HTTPException(status_code=400, detail="A medição em aberto não tem itens para fechar")
        if body.period_from and body.period_to and body.period_to[:10] < body.period_from[:10]:
            raise HTTPException(status_code=400, detail="Período inválido: data final anterior à inicial")
        medicoes = p.get("medicoes") or []
        number = len(medicoes) + 1
        total = _total(items)
        entry = {"id": uuid4().hex[:10], "number": number, "period_from": body.period_from[:10], "period_to": body.period_to[:10],
                 "period": _period_label(body.period_from, body.period_to), "notes": body.notes.strip()[:1000], "items": items, "total": total,
                 "qty_total": round(sum(float(i.get("qty") or 0) for i in items), 2), "items_count": len(items),
                 "closed_at": _now(), "closed_by": current_user.get("name", "")}
        fechado = round(_fechado(p) + total, 2)
        await db.projects.update_one({"_id": p["_id"]}, {
            "$push": {"medicoes": entry, "movement_history": {"event": "medicao_fechada", "field": "actual_value", "old": float(p.get("actual_value") or 0), "new": fechado, "at": _now(),
                                                              "by": current_user.get("name", ""), "note": f"Medição nº {number} fechada ({entry['period'] or 'sem período'}): {len(items)} item(ns) · R$ {total:,.2f}"}},
            "$set": {"labor_measured": [], "actual_value": fechado, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")}})
        return {"fechada": entry, **_detail(await _project(project_id, current_user))}

    @router.post("/projects/{project_id}/medicao/{medicao_id}/reabrir")
    async def reabrir_medicao(project_id: str, medicao_id: str, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        medicoes = p.get("medicoes") or []
        m = _find_medicao(p, medicao_id)
        if not medicoes or medicoes[-1].get("id") != medicao_id:
            raise HTTPException(status_code=400, detail="Só a última medição fechada pode ser reaberta")
        if p.get("labor_measured"):
            raise HTTPException(status_code=400, detail="A medição em aberto já tem itens — salve-a vazia ou feche-a antes de reabrir a anterior")
        rest = medicoes[:-1]
        fechado = round(sum(float(x.get("total") or 0) for x in rest), 2)
        new_actual = round(fechado + float(m.get("total") or 0), 2)
        await db.projects.update_one({"_id": p["_id"]}, {
            "$set": {"medicoes": rest, "labor_measured": m.get("items") or [], "actual_value": new_actual, "medicao_applied_at": _now(), "medicao_applied_by": current_user.get("name", "")},
            "$push": {"movement_history": {"event": "medicao_reaberta", "field": "actual_value", "old": float(p.get("actual_value") or 0), "new": new_actual, "at": _now(),
                                           "by": current_user.get("name", ""), "note": f"Medição nº {m.get('number')} reaberta para correção"}}})
        return _detail(await _project(project_id, current_user))

    # ── Fiscais da obra · PDF · envio por e-mail ───────────────────────────
    @router.put("/projects/{project_id}/medicao/fiscais")
    async def save_fiscais(project_id: str, body: FiscaisBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        fiscais = [{"name": f.name.strip()[:80], "email": f.email.strip().lower()[:120], "phone": f.phone.strip()[:30]} for f in body.fiscais if (f.name or f.email).strip()]
        await db.projects.update_one({"_id": p["_id"]}, {"$set": {"fiscais": fiscais}})
        return _detail(await _project(project_id, current_user))

    @router.get("/projects/{project_id}/medicao/pdf")
    async def medicao_pdf(project_id: str, notes: str = "", period: str = "", number: str = "", medicao_id: str = "", current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        m = _find_medicao(p, medicao_id)
        pdf, filename, _g, _c, _m = await _render_pdf(p, current_user, {"notes": notes[:1000], "period": period[:60]}, m)
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Content-Length": str(len(pdf)), "Cache-Control": "no-store"})

    @router.post("/projects/{project_id}/medicao/enviar")
    async def enviar_medicao(project_id: str, body: EnvioBody, current_user: dict = Depends(get_current_user)):
        p = await _project(project_id, current_user)
        m = _find_medicao(p, body.medicao_id)
        items = (m or {}).get("items") if m else (p.get("labor_measured") or [])
        if not items:
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
        # Só destinatários registrados na obra (fiscais) ou o próprio usuário — nunca endereços avulsos
        allowed = {(f.get("email") or "").strip().lower() for f in (p.get("fiscais") or [])} | {(current_user.get("email") or "").strip().lower()}
        if any(r not in allowed for r in recipients):
            raise HTTPException(status_code=400, detail="Cadastre o fiscal na obra (Fiscais) antes de enviar — só e-mails cadastrados recebem a medição")
        pdf, filename, groups, company, meta = await _render_pdf(p, current_user, {"notes": body.notes[:1000], "period": body.period[:60]}, m)
        from html import escape as _esc
        from medicao_pdf import medicao_email_html
        total_qty = sum(float(i.get("qty") or 0) for i in items)
        total_val = _total(items)
        med_label = f"Medição nº {meta['number']}" if meta.get("number") else "Resumo de Mão de Obra"
        default_msg = (f"Prezado(a) fiscal,\n\nSegue o Resumo de Mão de Obra — {med_label} da obra {p.get('project_code') or ''} — {p.get('name') or ''}"
                       + (f", período {meta['period']}" if meta.get("period") else "") + f", totalizando {len(items)} serviço(s) e R$ {total_val:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
                       + ".\n\nO PDF está disponível no link seguro ao final deste e-mail. Ficamos à disposição para conferência e validação.")
        html = medicao_email_html(p, groups, total_qty, total_val, company, _esc(body.message.strip()[:2000]) if body.message.strip() else default_msg, meta=meta)
        subject = f"[{company.get('name', 'HAYAH ENERGY')}] {med_label} · {p.get('project_code') or p.get('name') or ''}"
        if not send_email:
            raise HTTPException(status_code=503, detail="Envio de e-mail não configurado")
        result = await send_email(recipients, subject, html, [{"filename": filename, "content": base64.b64encode(pdf).decode("ascii")}])
        entry = {"id": uuid4().hex[:10], "at": _now(), "by": current_user.get("name", ""), "recipients": recipients, "status": result.get("status"),
                 "email_id": result.get("id", ""), "error": result.get("error", "") or result.get("reason", ""), "total": total_val, "items": len(items),
                 "filename": filename, "period": meta.get("period") or "", "number": str(meta.get("number") or ""), "medicao_id": (m or {}).get("id", "")}
        await db.projects.update_one({"_id": p["_id"]}, {"$push": {"medicao_envios": entry}})
        if result.get("status") == "error":
            raise HTTPException(status_code=502, detail=f"Falha ao enviar e-mail: {result.get('error')}")
        if result.get("status") == "skipped":
            raise HTTPException(status_code=503, detail="Envio de e-mail não configurado no servidor (EMERGENT_EMAIL_KEY)")
        return {"status": "sent", "recipients": recipients, "filename": filename, "envio": entry, **_detail(await _project(project_id, current_user))}

    return router
