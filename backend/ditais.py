"""Out/2026 · DITAIS (Desligar · Interromper · Testar · Aterrar · Isolar · Sinalizar) — formulário fotográfico obrigatório por obra.
Vários registros por obra (um por dia de execução), 6 etapas com foto (carimbada com a letra + "DITAIS" + data/hora) ou N/A,
observação, assinatura do responsável e PDF A4 fiel ao modelo Energisa."""
import asyncio
import base64
import io
import os
import re
import secrets
from datetime import datetime, timezone
from typing import Dict, Optional
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageDraw, ImageFont, ImageOps
from pydantic import BaseModel
from branding_cache import brand_name
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

TZ = ZoneInfo("America/Cuiaba")
ASSETS = os.path.join(os.path.dirname(__file__), "assets")
_LIB = "/usr/share/fonts/truetype/liberation"
FONT_BOLD = os.path.join(_LIB, "LiberationSans-Bold.ttf")
FONT_REG = os.path.join(_LIB, "LiberationSans-Regular.ttf")

# (chave, letra, nome)
STEPS = [("D", "D", "Desligar"), ("I1", "I", "Interromper"), ("T", "T", "Testar"), ("A", "A", "Aterrar"), ("I2", "I", "Isolar"), ("S", "S", "Sinalizar")]
STEP_KEYS = [s[0] for s in STEPS]
STEP_INFO = {k: {"letter": l, "name": n, "label": f"{l} - {n.lower()}"} for k, l, n in STEPS}
FIELDS = ["data_execucao", "numero_obra", "regional", "municipio", "prestadora", "responsavel", "equipe", "observacao", "assinatura", "assinatura_nome"]
DEFAULT_REGIONAL = "DCMD"
DEFAULT_PRESTADORA = "GRUPO ATUAL"

NAVY = colors.HexColor("#0B1F3A")
YELLOW = colors.HexColor("#E0FF00")
BLUE = colors.HexColor("#1F3FBF")
GRAY = colors.HexColor("#D9D9D9")

_FONTS = {"regular": "Helvetica", "bold": "Helvetica-Bold"}
try:
    pdfmetrics.registerFont(TTFont("DitLib", FONT_REG))
    pdfmetrics.registerFont(TTFont("DitLibB", FONT_BOLD))
    _FONTS = {"regular": "DitLib", "bold": "DitLibB"}
except Exception:
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _br(iso: str) -> str:
    s = (iso or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[0:4]}" if len(s) == 10 and s[4] == "-" else (iso or "")


def _br_dt(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return _br(iso)


class StepNA(BaseModel):
    na: bool = False
    motivo: str = ""


class DitaisBody(BaseModel):
    client_id: Optional[str] = None
    data_execucao: Optional[str] = None
    numero_obra: Optional[str] = None
    regional: Optional[str] = None
    municipio: Optional[str] = None
    prestadora: Optional[str] = None
    responsavel: Optional[str] = None
    equipe: Optional[str] = None
    observacao: Optional[str] = None
    assinatura: Optional[str] = None
    assinatura_nome: Optional[str] = None
    steps_na: Optional[Dict[str, StepNA]] = None


class FromPhotoBody(BaseModel):
    photo_id: str
    taken_at: Optional[str] = None


def _prepare_image(content: bytes) -> bytes:
    img = Image.open(io.BytesIO(content))
    if img.format == "JPEG":
        img.draft("RGB", (1600, 1600))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((1600, 1600))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue()


def _font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def stamp_photo(data: bytes, letter: str, name: str, when: str, max_px: int = 1200) -> bytes:
    """Carimba a foto como no modelo: letra grande da etapa + faixa inferior 'DITAIS · etapa' com data/hora."""
    img = Image.open(io.BytesIO(data))
    if img.format == "JPEG":
        img.draft("RGB", (max_px, max_px))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((max_px, max_px))
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    fs = max(28, int(min(W, H) * 0.24))
    draw.text((int(W * 0.03), int(H * 0.01)), letter, font=_font(FONT_BOLD, fs), fill=(224, 255, 0, 255), stroke_width=max(2, fs // 14), stroke_fill=(0, 0, 0, 255))
    bh = max(22, int(H * 0.075))
    draw.rectangle([0, H - bh, W, H], fill=(0, 0, 0, 150))
    f2 = _font(FONT_BOLD, int(bh * 0.5))
    draw.text((int(W * 0.02), H - bh + int(bh * 0.22)), f"DITAIS · {name.upper()}", font=f2, fill=(255, 255, 255, 255))
    if when:
        f3 = _font(FONT_REG, int(bh * 0.42))
        tw = draw.textlength(when, font=f3)
        draw.text((W - tw - int(W * 0.02), H - bh + int(bh * 0.27)), when, font=f3, fill=(255, 255, 255, 255))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=80)
    return out.getvalue()


# ------------------------------------------------------------------ PDF
def build_ditais_pdf(d: dict, photos: Dict[str, bytes], logo_bytes: Optional[bytes], project: dict) -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    F, FB = _FONTS["regular"], _FONTS["bold"]

    def Y(top):
        return H - top * mm

    def X(x):
        return x * mm

    def text(x, top, s, size=8, bold=False, color=colors.black, align="left"):
        c.setFont(FB if bold else F, size)
        c.setFillColor(color)
        s = str(s if s is not None else "")
        if align == "center":
            c.drawCentredString(X(x), Y(top), s)
        elif align == "right":
            c.drawRightString(X(x), Y(top), s)
        else:
            c.drawString(X(x), Y(top), s)
        c.setFillColor(colors.black)

    def rect(x, top, w, h, lw=0.5, fill=None, stroke=colors.black):
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
        if fill is not None:
            c.setFillColor(fill)
            c.rect(X(x), Y(top + h), w * mm, h * mm, stroke=1 if lw else 0, fill=1)
            c.setFillColor(colors.black)
        else:
            c.rect(X(x), Y(top + h), w * mm, h * mm, stroke=1, fill=0)

    def hline(x1, x2, top, w=0.5, col=colors.black):
        c.setStrokeColor(col)
        c.setLineWidth(w)
        c.line(X(x1), Y(top), X(x2), Y(top))

    def fit_image(data: bytes, x, top, w, h, pad=0.8):
        try:
            img = ImageReader(io.BytesIO(data))
            iw, ih = img.getSize()
            bw, bh = (w - 2 * pad) * mm, (h - 2 * pad) * mm
            scale = min(bw / iw, bh / ih)
            dw, dh = iw * scale, ih * scale
            c.drawImage(img, X(x + pad) + (bw - dw) / 2, Y(top + h - pad) + (bh - dh) / 2, width=dw, height=dh, mask="auto")
            return True
        except Exception:
            return False

    def labeled(lx, top, label, vx, vx2, val):
        text(lx, top, label, size=7.5, bold=True)
        hline(vx, vx2, top + 0.8, w=0.4, col=colors.grey)
        if val:
            text(vx + 1, top, str(val).upper(), size=8, bold=True, color=BLUE)

    L, R = 10, 200
    rect(L, 10, R - L, 277, lw=1)

    # cabeçalho
    if logo_bytes:
        try:
            lg = ImageReader(io.BytesIO(logo_bytes))
            iw, ih = lg.getSize()
            lw = 30 * mm
            c.drawImage(lg, X(13), Y(21.5), width=lw, height=lw * ih / iw, mask="auto")
        except Exception:
            text(13, 18, "energisa", size=12, bold=True, color=colors.HexColor("#00913F"))
    text(112, 17.5, "FORMULÁRIO PARA FOTOS DOS DITAIS", size=12.5, bold=True, align="center")
    text(112, 22.5, "Procedimento obrigatório de segurança · registro fotográfico das 6 etapas", size=7, color=colors.grey, align="center")
    rect(163, 12.5, 35, 10, lw=0.6)
    text(180.5, 16.3, "DATA EXECUÇÃO", size=6.5, bold=True, align="center")
    text(180.5, 20.8, _br(d.get("data_execucao")), size=9, bold=True, color=BLUE, align="center")

    hline(L, R, 26, w=0.8)
    labeled(13, 31.5, "N.º DA OBRA:", 36, 105, d.get("numero_obra"))
    labeled(110, 31.5, "REGIONAL:", 130, 198, d.get("regional"))
    labeled(13, 37.5, "MUNICÍPIO:", 36, 105, d.get("municipio"))
    labeled(110, 37.5, "PRESTADORA:", 134, 198, d.get("prestadora"))
    labeled(13, 43.5, "RESPONSÁVEL:", 38, 105, d.get("responsavel"))
    labeled(110, 43.5, "EQUIPE:", 125, 198, d.get("equipe") or project.get("team_name"))
    if project.get("name"):
        text(13, 48.5, (project.get("name") or "")[:110], size=6.5, color=colors.grey)

    # faixa título
    rect(L, 50.5, R - L, 7, lw=0, fill=NAVY)
    text(105, 55.3, "DITAIS  -  Desligar  -  Interromper  -  Testar  -  Aterrar  -  Isolar  -  Sinalizar", size=9.5, bold=True, color=YELLOW, align="center")

    # grade 2 x 3
    steps = d.get("steps") or {}
    cell_w, cell_h, head_h = 92, 54, 5.5
    top0 = 59.5
    for i, (key, letter, name) in enumerate(STEPS):
        col, row = i % 2, i // 2
        x = 12 + col * (cell_w + 4)
        top = top0 + row * (cell_h + 2.5)
        st = steps.get(key) or {}
        status = st.get("status") or "pendente"
        rect(x, top, cell_w, head_h, lw=0.5, fill=GRAY)
        text(x + 2, top + 3.9, f"{letter} - {name.lower()}", size=8.5, bold=True)
        if status == "na":
            text(x + cell_w - 2, top + 3.9, "N/A", size=8.5, bold=True, color=colors.HexColor("#B45309"), align="right")
        elif status == "foto":
            text(x + cell_w - 2, top + 3.9, "DITAIS", size=7.5, bold=True, color=colors.HexColor("#15803D"), align="right")
        ph_top, ph_h = top + head_h, cell_h - head_h
        rect(x, ph_top, cell_w, ph_h, lw=0.6)
        if status == "foto" and photos.get(key) and fit_image(photos[key], x, ph_top, cell_w, ph_h):
            pass
        elif status == "na":
            text(x + cell_w / 2, ph_top + ph_h / 2 - 3, "N/A", size=26, bold=True, color=colors.HexColor("#B45309"), align="center")
            text(x + cell_w / 2, ph_top + ph_h / 2 + 4, "ETAPA NÃO APLICÁVEL", size=7, bold=True, color=colors.grey, align="center")
            if st.get("na_motivo"):
                text(x + cell_w / 2, ph_top + ph_h / 2 + 9, str(st["na_motivo"])[:90], size=6.5, color=colors.grey, align="center")
        else:
            text(x + cell_w / 2, ph_top + ph_h / 2, "SEM FOTO", size=12, bold=True, color=colors.HexColor("#B91C1C"), align="center")
            text(x + cell_w / 2, ph_top + ph_h / 2 + 5, "etapa pendente de registro", size=6.5, color=colors.grey, align="center")

    # observação
    obs_top = top0 + 3 * (cell_h + 2.5) + 1
    hline(L, R, obs_top, w=0.8)
    text(13, obs_top + 4.5, "OBSERVAÇÃO:", size=8, bold=True)
    flat = []
    for ln in str(d.get("observacao") or "").replace("\r", "").split("\n"):
        while len(ln) > 125:
            flat.append(ln[:125])
            ln = ln[125:]
        flat.append(ln)
    for i in range(3):
        t = obs_top + 10 + i * 4.6
        hline(13, 198, t + 0.8, w=0.3, col=colors.grey)
        if i < len(flat) and flat[i]:
            text(14, t, flat[i], size=7.5, color=BLUE)

    # assinatura
    sig_top = obs_top + 24
    hline(L, R, sig_top, w=0.8)
    sig = d.get("assinatura") or ""
    if sig.startswith("data:image"):
        try:
            raw = base64.b64decode(sig.split(",", 1)[1])
            fit_image(raw, 70, sig_top + 0.5, 70, 16, pad=0.3)
        except Exception:
            pass
    hline(60, 150, sig_top + 17.5, w=0.6)
    nome = d.get("assinatura_nome") or d.get("responsavel") or ""
    text(105, sig_top + 21, str(nome).upper(), size=8, bold=True, color=BLUE, align="center")
    text(105, sig_top + 24.3, "ASSINATURA DO RESPONSÁVEL PELA EXECUÇÃO", size=6.5, align="center")

    fotos = sum(1 for k in STEP_KEYS if (steps.get(k) or {}).get("status") == "foto")
    nas = sum(1 for k in STEP_KEYS if (steps.get(k) or {}).get("status") == "na")
    text(13, 285, f"Gerado por {brand_name()} · {datetime.now(TZ).strftime('%d/%m/%Y %H:%M')} · Obra {d.get('numero_obra') or '—'} · {fotos} foto(s) · {nas} N/A", size=6, color=colors.grey)
    text(198, 285, "DITAIS · Página 1/1", size=6, color=colors.grey, align="right")
    c.showPage()
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ API
def build_router(db, get_current_user, safe_object_id, storage_put, storage_get, app_name: str, shrink_fn=None):
    router = APIRouter(prefix="/api")

    def _pub(doc: dict) -> dict:
        did = str(doc["_id"])
        steps = {}
        for k in STEP_KEYS:
            st = (doc.get("steps") or {}).get(k) or {}
            ph = st.get("photo")
            steps[k] = {"status": st.get("status") or "pendente", "na_motivo": st.get("na_motivo") or "",
                        "photo": ({k2: v for k2, v in ph.items() if k2 != "storage_path"} | {"url": f"/api/ditais/{did}/steps/{k}/photo"}) if ph else None}
        fotos = sum(1 for k in STEP_KEYS if steps[k]["status"] == "foto")
        nas = sum(1 for k in STEP_KEYS if steps[k]["status"] == "na")
        out = {"id": did, "project_id": doc.get("project_id"), "client_id": doc.get("client_id") or "", "steps": steps,
               "counts": {"fotos": fotos, "na": nas, "pendentes": 6 - fotos - nas}, "complete": fotos + nas == 6,
               "created_at": doc.get("created_at"), "created_by": doc.get("created_by", ""), "updated_at": doc.get("updated_at")}
        for f in FIELDS:
            out[f] = doc.get(f) or ""
        return out

    async def _project(pid: str, user) -> dict:
        p = await db.projects.find_one({"_id": safe_object_id(pid), "user_id": user["_id"]}, {"project_code": 1, "name": 1, "location": 1, "team_id": 1, "team_name": 1, "photos": 1})
        if not p:
            raise HTTPException(status_code=404, detail="Obra não encontrada")
        return p

    async def _prefill(p: dict, user) -> dict:
        resp = ""
        if p.get("team_id"):
            try:
                team = await db.teams.find_one({"_id": ObjectId(p["team_id"])}, {"supervisor": 1})
                resp = (team or {}).get("supervisor") or ""
            except Exception:
                resp = ""
        return {"data_execucao": _today(), "numero_obra": p.get("project_code") or "", "regional": DEFAULT_REGIONAL, "municipio": p.get("location") or "",
                "prestadora": DEFAULT_PRESTADORA, "responsavel": resp or user.get("name") or "", "equipe": p.get("team_name") or "", "observacao": "",
                "assinatura": "", "assinatura_nome": resp or user.get("name") or ""}

    async def _find(key: str, user, pid: Optional[str] = None) -> Optional[dict]:
        q = {"user_id": user["_id"]}
        if pid:
            q["project_id"] = pid
        ors = [{"client_id": key}]
        if re.fullmatch(r"[0-9a-fA-F]{24}", key or ""):
            ors.append({"_id": ObjectId(key)})
        return await db.ditais.find_one({**q, "$or": ors})

    async def _get(key: str, user, pid: Optional[str] = None) -> dict:
        doc = await _find(key, user, pid)
        if not doc:
            raise HTTPException(status_code=404, detail="DITAIS não encontrado")
        return doc

    def _apply_body(doc_upd: dict, body: DitaisBody, existing: Optional[dict]):
        data = body.model_dump(exclude_none=True)
        for f in FIELDS:
            if f in data:
                doc_upd[f] = data[f].strip() if isinstance(data[f], str) and f != "assinatura" else data[f]
        if body.steps_na:
            steps = dict((existing or {}).get("steps") or {})
            for k, v in body.steps_na.items():
                if k not in STEP_KEYS:
                    raise HTTPException(status_code=400, detail=f"Etapa inválida: {k}. Use: {STEP_KEYS}")
                cur = dict(steps.get(k) or {})
                if v.na:
                    cur.update({"status": "na", "na_motivo": (v.motivo or "").strip()[:200]})
                    cur.pop("photo", None)
                elif cur.get("status") == "na":
                    cur.update({"status": "pendente", "na_motivo": ""})
                steps[k] = cur
            doc_upd["steps"] = steps

    async def _create(pid: str, p: dict, user, body: Optional[DitaisBody]) -> dict:
        doc = {**(await _prefill(p, user)), "user_id": user["_id"], "project_id": pid, "client_id": (body.client_id if body and body.client_id else secrets.token_urlsafe(8)),
               "steps": {k: {"status": "pendente", "na_motivo": ""} for k in STEP_KEYS}, "created_at": _now(), "created_by": user.get("name") or user.get("email") or "",
               "updated_at": _now()}
        if body:
            _apply_body(doc, body, doc)
        r = await db.ditais.insert_one(doc)
        doc["_id"] = r.inserted_id
        return doc

    # ---- listas / CRUD
    @router.get("/projects/{pid}/ditais")
    async def list_ditais(pid: str, current_user: dict = Depends(get_current_user)):
        await _project(pid, current_user)
        docs = await db.ditais.find({"user_id": current_user["_id"], "project_id": pid}).sort([("data_execucao", -1), ("created_at", -1)]).to_list(500)
        return [_pub(d) for d in docs]

    @router.get("/projects/{pid}/ditais/prefill")
    async def prefill_ditais(pid: str, current_user: dict = Depends(get_current_user)):
        p = await _project(pid, current_user)
        return {**(await _prefill(p, current_user)), "steps": STEP_INFO,
                "project_photos": [{"id": ph["id"], "label": ph.get("label", ""), "point": ph.get("point", ""), "uploaded_at": ph.get("uploaded_at", ""),
                                    "url": f"/api/operacional/photos/{pid}/{ph['id']}/file"} for ph in reversed(p.get("photos") or []) if not ph.get("is_deleted")][:120]}

    @router.post("/projects/{pid}/ditais")
    async def create_ditais(pid: str, body: DitaisBody, current_user: dict = Depends(get_current_user)):
        p = await _project(pid, current_user)
        existing = await _find(body.client_id, current_user, pid) if body.client_id else None
        if existing:
            upd = {"updated_at": _now(), "updated_by": current_user.get("name") or ""}
            _apply_body(upd, body, existing)
            await db.ditais.update_one({"_id": existing["_id"]}, {"$set": upd})
            return _pub(await db.ditais.find_one({"_id": existing["_id"]}))
        return _pub(await _create(pid, p, current_user, body))

    @router.get("/ditais/{key}")
    async def get_ditais(key: str, current_user: dict = Depends(get_current_user)):
        return _pub(await _get(key, current_user))

    @router.patch("/ditais/{key}")
    async def patch_ditais(key: str, body: DitaisBody, current_user: dict = Depends(get_current_user)):
        doc = await _get(key, current_user)
        upd = {"updated_at": _now(), "updated_by": current_user.get("name") or ""}
        _apply_body(upd, body, doc)
        await db.ditais.update_one({"_id": doc["_id"]}, {"$set": upd})
        return _pub(await db.ditais.find_one({"_id": doc["_id"]}))

    @router.delete("/ditais/{key}")
    async def delete_ditais(key: str, current_user: dict = Depends(get_current_user)):
        doc = await _get(key, current_user)
        await db.ditais.delete_one({"_id": doc["_id"]})
        return {"status": "deleted", "id": str(doc["_id"])}

    # ---- fotos por etapa
    def _check_step(step: str):
        if step not in STEP_KEYS:
            raise HTTPException(status_code=400, detail=f"Etapa inválida. Use: {STEP_KEYS}")

    async def _set_photo(doc: dict, step: str, meta: dict):
        await db.ditais.update_one({"_id": doc["_id"]}, {"$set": {f"steps.{step}": {"status": "foto", "na_motivo": "", "photo": meta}, "updated_at": _now()}})
        return _pub(await db.ditais.find_one({"_id": doc["_id"]}))

    @router.post("/projects/{pid}/ditais/{key}/steps/{step}/photo")
    async def upload_step_photo(pid: str, key: str, step: str, file: UploadFile = File(...), taken_at: str = Form(""), current_user: dict = Depends(get_current_user)):
        """`key` = id ou client_id. Se o registro ainda não existe (foto sincronizada do offline antes do formulário), cria com o pré-preenchimento da obra."""
        _check_step(step)
        p = await _project(pid, current_user)
        doc = await _find(key, current_user, pid)
        if not doc:
            if re.fullmatch(r"[0-9a-fA-F]{24}", key or ""):
                raise HTTPException(status_code=404, detail="DITAIS não encontrado")
            doc = await _create(pid, p, current_user, DitaisBody(client_id=key))
        content = await file.read()
        if not content or len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Imagem vazia ou maior que 15MB")
        try:
            data = await asyncio.to_thread(_prepare_image, content)
        except Exception:
            raise HTTPException(status_code=400, detail="Arquivo não é uma imagem válida")
        path = f"{app_name}/ditais/{current_user['_id']}/{pid}/{doc['_id']}/{step}-{secrets.token_urlsafe(4)}.jpg"
        res = await storage_put(path, data, "image/jpeg")
        meta = {"storage_path": res.get("path", path), "content_type": "image/jpeg", "size": len(data), "uploaded_at": _now(),
                "taken_at": (taken_at or "").strip() or _now(), "source": "upload", "by": current_user.get("name") or ""}
        return await _set_photo(doc, step, meta)

    @router.post("/ditais/{key}/steps/{step}/from-photo")
    async def step_from_photo(key: str, step: str, body: FromPhotoBody, current_user: dict = Depends(get_current_user)):
        _check_step(step)
        doc = await _get(key, current_user)
        p = await _project(doc["project_id"], current_user)
        ph = next((x for x in (p.get("photos") or []) if x.get("id") == body.photo_id and not x.get("is_deleted")), None)
        if not ph or not ph.get("storage_path"):
            raise HTTPException(status_code=404, detail="Foto da obra não encontrada")
        meta = {"storage_path": ph["storage_path"], "content_type": ph.get("content_type") or "image/jpeg", "uploaded_at": _now(),
                "taken_at": body.taken_at or ph.get("uploaded_at") or _now(), "source": "obra", "photo_id": ph["id"], "by": current_user.get("name") or ""}
        return await _set_photo(doc, step, meta)

    @router.get("/ditais/{key}/steps/{step}/photo")
    async def step_photo_file(key: str, step: str, w: int = 0, current_user: dict = Depends(get_current_user)):
        _check_step(step)
        doc = await _get(key, current_user)
        meta = ((doc.get("steps") or {}).get(step) or {}).get("photo")
        if not meta:
            raise HTTPException(status_code=404, detail="Sem foto nesta etapa")
        data, ct = await storage_get(meta["storage_path"])
        if w and 0 < w <= 1200 and shrink_fn:
            data, ct = await asyncio.to_thread(shrink_fn, data, w, 72), "image/jpeg"
        return Response(content=data, media_type=meta.get("content_type") or ct, headers={"Cache-Control": "private, max-age=86400"})

    @router.delete("/ditais/{key}/steps/{step}/photo")
    async def step_photo_delete(key: str, step: str, current_user: dict = Depends(get_current_user)):
        _check_step(step)
        doc = await _get(key, current_user)
        await db.ditais.update_one({"_id": doc["_id"]}, {"$set": {f"steps.{step}": {"status": "pendente", "na_motivo": ""}, "updated_at": _now()}})
        return _pub(await db.ditais.find_one({"_id": doc["_id"]}))

    # ---- PDF
    @router.get("/ditais/{key}/pdf")
    async def ditais_pdf(key: str, current_user: dict = Depends(get_current_user)):
        doc = await _get(key, current_user)
        p = await db.projects.find_one({"_id": safe_object_id(doc["project_id"])}, {"name": 1, "team_name": 1, "project_code": 1}) or {}
        photos: Dict[str, bytes] = {}
        for k, letter, name in STEPS:
            st = (doc.get("steps") or {}).get(k) or {}
            meta = st.get("photo")
            if st.get("status") != "foto" or not meta:
                continue
            try:
                raw, _ = await storage_get(meta["storage_path"])
                photos[k] = await asyncio.to_thread(stamp_photo, raw, letter, name, _br_dt(meta.get("taken_at") or meta.get("uploaded_at") or ""))
                del raw
            except Exception:
                continue
        logo = None
        try:
            with open(os.path.join(ASSETS, "energisa_logo.png"), "rb") as fh:
                logo = fh.read()
        except Exception:
            logo = None
        pdf = await asyncio.to_thread(build_ditais_pdf, doc, photos, logo, p)
        code = re.sub(r"[^A-Za-z0-9_-]+", "_", doc.get("numero_obra") or p.get("project_code") or "obra")[:40]
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="DITAIS_{code}_{(doc.get("data_execucao") or "")[:10].replace("-", "")}.pdf"'})

    return router
