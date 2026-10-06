"""Set/2026 · Laudo de Transformador (formulário padrão Energisa) por equipamento: dados + 8 fotos + PDF A4 fiel ao modelo."""
import asyncio
import io
import os
import secrets
from datetime import datetime, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, ImageOps
from branding_cache import brand_name
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas

TZ = ZoneInfo("America/Cuiaba")
ASSETS = os.path.join(os.path.dirname(__file__), "assets")
SLOTS = ["aterr_a", "aterr_b", "aterr_c", "tensao_a", "tensao_b", "tensao_c", "placa", "instalado"]
SLOT_LABELS = {
    "aterr_a": "Leitura aterramento · Fase A", "aterr_b": "Leitura aterramento · Fase B", "aterr_c": "Leitura aterramento · Fase C",
    "tensao_a": "Leitura tensão BT · Fase A", "tensao_b": "Leitura tensão BT · Fase B", "tensao_c": "Leitura tensão BT · Fase C",
    "placa": "Placa do transformador instalado", "instalado": "Transformador instalado com patrimônio",
}
TIPOS = ["instalacao", "queima", "remanejamento", "defeito"]
TIPO_LABELS = {"instalacao": "INSTALAÇÃO", "queima": "QUEIMA", "remanejamento": "REMANEJAMENTO", "defeito": "DEFEITO"}
FIELDS = ["tipo_laudo", "data", "projeto", "localizacao", "topologia", "endereco", "configuracao", "classe_tensao", "posicao_tap", "qtd_tap",
          "numero_serie", "patrimonio", "impedancia", "data_fabricacao", "massa_kg", "marca", "volume_oleo", "reformado", "tipo_oleo",
          "aterr_leituras", "tensao_leituras", "observacao", "encarregado"]

BLUE = colors.HexColor("#1F3FBF")
RED = colors.HexColor("#D0021B")
GRAY = colors.HexColor("#D9D9D9")

_FONTS = {"regular": "Helvetica", "bold": "Helvetica-Bold"}
try:
    _lib = "/usr/share/fonts/truetype/liberation"
    pdfmetrics.registerFont(TTFont("Lib", os.path.join(_lib, "LiberationSans-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("LibB", os.path.join(_lib, "LiberationSans-Bold.ttf")))
    _FONTS = {"regular": "Lib", "bold": "LibB"}
except Exception:
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _br(iso: str) -> str:
    s = (iso or "")[:10]
    if len(s) == 10 and s[4] == "-":
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    return iso or ""


class LaudoBody(BaseModel):
    tipo_laudo: Optional[str] = None
    data: Optional[str] = None
    projeto: Optional[str] = None
    localizacao: Optional[str] = None
    topologia: Optional[str] = None
    endereco: Optional[str] = None
    configuracao: Optional[str] = None
    classe_tensao: Optional[str] = None
    posicao_tap: Optional[str] = None
    qtd_tap: Optional[str] = None
    numero_serie: Optional[str] = None
    patrimonio: Optional[str] = None
    impedancia: Optional[str] = None
    data_fabricacao: Optional[str] = None
    massa_kg: Optional[str] = None
    marca: Optional[str] = None
    volume_oleo: Optional[str] = None
    reformado: Optional[str] = None
    tipo_oleo: Optional[str] = None
    aterr_leituras: Optional[List[str]] = None
    tensao_leituras: Optional[List[str]] = None
    observacao: Optional[str] = None
    encarregado: Optional[str] = None


class FromPhotoBody(BaseModel):
    photo_id: str


def _prepare_image(content: bytes) -> tuple:
    img = Image.open(io.BytesIO(content))
    img = ImageOps.exif_transpose(img).convert("RGB")
    img.thumbnail((1600, 1600))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85, optimize=True)
    return out.getvalue(), "image/jpeg"


# ------------------------------------------------------------------ PDF
def build_laudo_pdf(v: dict, photos: dict, logo_bytes: Optional[bytes]) -> bytes:
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    F, FB = _FONTS["regular"], _FONTS["bold"]

    def Y(top):  # mm do topo → pontos
        return H - top * mm

    def X(x):
        return x * mm

    def text(x, top, s, size=7.5, bold=False, color=colors.black, align="left"):
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

    def value(x, top, s, size=7.5, align="left"):
        text(x, top, s, size=size, bold=True, color=BLUE, align=align)

    def hline(x1, x2, top, w=0.5, col=colors.black):
        c.setStrokeColor(col)
        c.setLineWidth(w)
        c.line(X(x1), Y(top), X(x2), Y(top))

    def vline(x, top1, top2, w=0.5):
        c.setStrokeColor(colors.black)
        c.setLineWidth(w)
        c.line(X(x), Y(top1), X(x), Y(top2))

    def rect(x, top, w, h, lw=0.5, fill=None):
        c.setStrokeColor(colors.black)
        c.setLineWidth(lw)
        if fill is not None:
            c.setFillColor(fill)
            c.rect(X(x), Y(top + h), w * mm, h * mm, stroke=1, fill=1)
            c.setFillColor(colors.black)
        else:
            c.rect(X(x), Y(top + h), w * mm, h * mm, stroke=1, fill=0)

    def checkbox(x, top, label, checked, color=BLUE, size=7.5, bold=False):
        rect(x, top, 4, 4, lw=0.6)
        if checked:
            c.setFont(FB, 8)
            c.setFillColor(color)
            c.drawCentredString(X(x + 2), Y(top + 3.1), "X")
            c.setFillColor(colors.black)
        text(x + 5, top + 3.1, label, size=size, bold=bold)

    def underline_value(lx, top, label, vx, vx2, val, label_bold=False, val_align="left"):
        text(lx, top, label, bold=label_bold)
        hline(vx, vx2, top + 0.8, w=0.4)
        if val:
            value(vx + 1 if val_align == "left" else (vx + vx2) / 2, top, val, align=val_align)

    def box_value(lx, top, label, bx, bw, val):
        text(lx, top + 3, label)
        rect(bx, top, bw, 4.2, lw=0.6)
        if val:
            value(bx + bw / 2, top + 3.1, val, align="center")

    def fit_image(data: bytes, x, top, w, h, pad=0.6):
        try:
            img = ImageReader(io.BytesIO(data))
            iw, ih = img.getSize()
            bw, bh = (w - 2 * pad) * mm, (h - 2 * pad) * mm
            scale = min(bw / iw, bh / ih)
            dw, dh = iw * scale, ih * scale
            c.drawImage(img, X(x + pad) + (bw - dw) / 2, Y(top + h - pad) + (bh - dh) / 2, width=dw, height=dh, mask="auto")
        except Exception:
            text(x + w / 2, top + h / 2, "imagem inválida", size=6, color=colors.grey, align="center")

    def photo_box(slot, x, top, w, h, placeholder):
        rect(x, top, w, h, lw=0.8)
        data = photos.get(slot)
        if data:
            fit_image(data, x, top, w, h)
        else:
            lines = placeholder.split("\n")
            base = top + h / 2 - (len(lines) - 1) * 1.6
            for i, ln in enumerate(lines):
                text(x + w / 2, base + i * 3.4, ln, size=6.5, align="center")

    # ---------- moldura + cabeçalho
    L, R = 10, 200
    rect(L, 10, R - L, 262, lw=1)
    if logo_bytes:
        try:
            lg = ImageReader(io.BytesIO(logo_bytes))
            iw, ih = lg.getSize()
            lw = 34 * mm
            c.drawImage(lg, X(12), Y(23), width=lw, height=lw * ih / iw, mask="auto")
        except Exception:
            text(12, 19, "energisa", size=14, bold=True, color=colors.HexColor("#00913F"))
    text(122, 19, "LAUDO DE TRANSFORMADOR", size=11, bold=True, align="center")
    tipo = v.get("tipo_laudo") or "instalacao"
    for lbl_key, xx in (("instalacao", 50), ("queima", 88), ("remanejamento", 122), ("defeito", 164)):
        checkbox(xx, 24.3, TIPO_LABELS[lbl_key], tipo == lbl_key, color=RED, size=8, bold=True)

    underline_value(12, 34, "PROJETO/OBRA", 38, 82, v.get("projeto"), val_align="center")
    underline_value(86, 34, "LOCALIZAÇÃO", 108, 198, v.get("localizacao"))
    underline_value(12, 39.5, "DATA", 22, 44, _br(v.get("data")), val_align="center")
    underline_value(48, 39.5, "TOPOLOGIA", 66, 82, v.get("topologia"), val_align="center")
    underline_value(86, 39.5, "ENDEREÇO", 104, 198, v.get("endereco"))

    # ---------- TRAFO INSTALADO
    hline(L, R, 42.5, w=0.8)
    rect(L, 42.5, R - L, 4.5, lw=0.8, fill=GRAY)
    text(105, 45.8, "TRAFO INSTALADO", size=7.5, bold=True, align="center")
    vline(114, 47, 95)
    text(30, 51.5, "CONFIGURAÇÃO", bold=True, align="center")
    text(72, 51.5, "CLASSE TENSÃO DA REDE", bold=True, align="center")
    conf = v.get("configuracao") or ""
    classe = str(v.get("classe_tensao") or "").replace(",", ".")
    checkbox(20, 53.5, "TRIFASICO", conf == "trifasico")
    checkbox(20, 60.5, "MONOFASICO", conf == "monofasico")
    checkbox(60, 53.5, "13,8KV", classe.startswith("13"))
    checkbox(60, 60.5, "34,5KV", classe.startswith("34"))
    underline_value(12, 69.5, "NÚMERO DE SÉRIE:", 38, 64, v.get("numero_serie"))
    text(66, 69.5, "Nº ENERGISA (PATRIMÔNIO):", size=6.3)
    hline(98, 113, 70.3, w=0.4)
    if v.get("patrimonio"):
        value(105.5, 69.5, v.get("patrimonio"), size=6.8, align="center")
    underline_value(12, 76.5, "DATA DE FABRICAÇÃO:", 42, 112, v.get("data_fabricacao"))
    underline_value(12, 83.5, "MARCA/MODELO/TIPO:", 42, 112, v.get("marca"))
    text(12, 90.5, "EQUIPAMENTO REFORMADO:")
    ref = (v.get("reformado") or "nao").lower()
    checkbox(54, 87.5, "SIM", ref == "sim", color=RED)
    checkbox(72, 87.5, "NÃO", ref != "sim", color=RED)

    box_value(118, 50.5, "POSIÇÃO DE TAP", 168, 8, v.get("posicao_tap"))
    box_value(118, 57.5, "QTD DE TAP", 168, 8, v.get("qtd_tap"))
    box_value(118, 64.5, "IMPEDANCIA %", 168, 12, v.get("impedancia"))
    box_value(118, 71.5, "MASSA/PESO (KG)", 168, 12, v.get("massa_kg"))
    box_value(118, 78.5, "VOLUME ÓLEO ISOLANTE (L)", 168, 12, v.get("volume_oleo"))
    text(118, 90.5, "TIPO ÓLEO ISOLANTE")
    oleo = (v.get("tipo_oleo") or "ovi").lower()
    checkbox(168, 87.5, "OVI", oleo == "ovi", bold=True)
    checkbox(182, 87.5, "OMI", oleo == "omi", bold=True)

    # ---------- leituras
    hline(L, R, 95, w=0.8)
    text(60, 98.5, "LEITURA DA RESISTÊNCIA DE ATERRAMENTO", size=7, bold=True, align="center")
    text(155, 98.5, "LEITURA DA TENSÃO SECUNDÁRIA INSTANTÂNEA DO TRAFO OU DA REDE BT", size=6.3, bold=True, align="center")
    hline(L, R, 100.5, w=0.8)
    vline(110, 95, 152)
    for i, (slot, ph) in enumerate((("aterr_a", "COLAR AQUI IMAGEM DA\nLEITURA FASE A"), ("aterr_b", "COLAR AQUI IMAGEM DA\nLEITURA FASE B"), ("aterr_c", "COLAR AQUI IMAGEM DA\nLEITURA FASE C"))):
        photo_box(slot, 12 + i * 31.5, 103, 31, 30, ph)
    for i, (slot, ph) in enumerate((("tensao_a", "COLAR AQUI IMAGEM DA\nLEITURA FASE A"), ("tensao_b", "COLAR AQUI IMAGEM DA\nLEITURA FASE B"), ("tensao_c", "COLAR AQUI IMAGEM DA\nLEITURA FASE C"))):
        photo_box(slot, 112 + i * 29, 103, 28.5, 30, ph)

    def readings_table(x, top, vals, unit):
        for i in range(3):
            rect(x, top + i * 4.2, 20, 4.2, lw=0.5)
            rect(x + 20, top + i * 4.2, 24, 4.2, lw=0.5)
            text(x + 1, top + i * 4.2 + 3.1, f"LEITURA 0{i + 1}", size=6.8)
            val = (vals[i] if i < len(vals) else "") or ""
            if val:
                value(x + 32, top + i * 4.2 + 3.1, f"{val} {unit}".strip(), size=6.8, align="center")

    readings_table(44, 136, v.get("aterr_leituras") or [], "Ω")
    readings_table(140, 136, v.get("tensao_leituras") or [], "V")

    # ---------- fotos grandes
    hline(L, R, 152, w=0.8)
    text(57.5, 155.3, "FOTO DA PLACA DO TRANSFORMADOR INSTALADO", size=7, bold=True, align="center")
    text(152.5, 155.3, "FOTO DO TRANSFORMADOR INSTALADO COM PATRIMÔNIO", size=7, bold=True, align="center")
    hline(L, R, 157, w=0.8)
    vline(105, 152, 237)
    photo_box("placa", L, 157, 95, 80, "COLAR AQUI FOTOS DOS DADOS DE PLACA\nDO EQUIPAMENTO INSTALADO")
    photo_box("instalado", 105, 157, 95, 80, "COLAR AQUI FOTO DO TRANSFORMADOR\nINSTALADO COM PATRIMÔNIO")

    # ---------- observação + assinatura
    hline(L, R, 237, w=0.8)
    text(12, 241, "OBSERVAÇÃO:", bold=True)
    obs_lines = [ln for ln in str(v.get("observacao") or "").replace("\r", "").split("\n")]
    flat: List[str] = []
    for ln in obs_lines:
        while len(ln) > 120:
            flat.append(ln[:120])
            ln = ln[120:]
        flat.append(ln)
    for i in range(3):
        top = 246 + i * 5
        hline(12, 198, top + 0.8, w=0.3, col=colors.grey)
        if i < len(flat) and flat[i]:
            value(13, top, flat[i], size=7)
    hline(70, 140, 264.5, w=0.6)
    if v.get("encarregado"):
        value(105, 263.5, str(v["encarregado"]).upper(), align="center")
    text(105, 267.5, "NOME DO ENCARREGADO POR EXTENSO", size=6.5, align="center")

    text(12, 276, f"Gerado por {brand_name()} · {datetime.now(TZ).strftime('%d/%m/%Y %H:%M')} · Patrimônio {v.get('patrimonio') or '—'} · Série {v.get('numero_serie') or '—'}", size=6, color=colors.grey)
    c.showPage()
    c.save()
    return buf.getvalue()


# ------------------------------------------------------------------ API
def build_router(db, get_current_user, safe_object_id, storage_put, storage_get, app_name: str, watermark_fn=None):
    router = APIRouter(prefix="/api")

    async def _equip(eid: str, user) -> dict:
        eq = await db.equipamentos.find_one({"_id": safe_object_id(eid), "user_id": user["_id"]})
        if not eq:
            raise HTTPException(status_code=404, detail="Equipamento não encontrado")
        return eq

    async def _prefill(eq: dict) -> dict:
        p = {
            "tipo_laudo": "instalacao", "data": _today(), "projeto": eq.get("project_code") or "", "localizacao": "", "topologia": "", "endereco": "",
            "configuracao": "monofasico", "classe_tensao": "13.8", "posicao_tap": "", "qtd_tap": "",
            "numero_serie": eq.get("numero_serie") or "", "patrimonio": eq.get("patrimonio") or "", "impedancia": "",
            "data_fabricacao": eq.get("data_fabricacao") or "", "massa_kg": "", "marca": eq.get("fabricante") or "", "volume_oleo": "",
            "reformado": "sim" if (eq.get("condicao") or "") == "reforma" else "nao", "tipo_oleo": "ovi",
            "aterr_leituras": ["", "", ""], "tensao_leituras": ["", "", ""], "observacao": "", "encarregado": "",
        }
        if eq.get("project_id"):
            try:
                proj = await db.projects.find_one({"_id": safe_object_id(eq["project_id"])}, {"location": 1, "team_id": 1, "team_name": 1, "project_code": 1, "name": 1})
            except Exception:
                proj = None
            if proj:
                p["localizacao"] = proj.get("location") or ""
                p["projeto"] = proj.get("project_code") or p["projeto"]
                if proj.get("team_id"):
                    try:
                        team = await db.teams.find_one({"_id": safe_object_id(proj["team_id"])}, {"supervisor": 1})
                    except Exception:
                        team = None
                    if team and team.get("supervisor"):
                        p["encarregado"] = team["supervisor"]
        return p

    async def _effective(eq: dict) -> dict:
        pre = await _prefill(eq)
        stored = eq.get("laudo") or {}
        out = {}
        for k in FIELDS:
            sv = stored.get(k)
            if k in ("aterr_leituras", "tensao_leituras"):
                sv = [str(x or "") for x in (sv or [])][:3] if isinstance(sv, list) else None
                out[k] = (sv + ["", "", ""])[:3] if sv else pre[k]
            else:
                out[k] = sv if sv not in (None, "") else pre[k]
        return out

    def _photos_meta(eq: dict, eid: str) -> dict:
        ph = (eq.get("laudo") or {}).get("photos") or {}
        return {s: ({**{k: v for k, v in ph[s].items() if k != "storage_path"}, "url": f"/api/equipamentos/{eid}/laudo/photos/{s}"} if ph.get(s) else None) for s in SLOTS}

    @router.get("/equipamentos/{eid}/laudo")
    async def get_laudo(eid: str, current_user: dict = Depends(get_current_user)):
        eq = await _equip(eid, current_user)
        return {"laudo": await _effective(eq), "photos": _photos_meta(eq, eid), "slots": SLOT_LABELS, "saved": bool(eq.get("laudo")),
                "updated_at": (eq.get("laudo") or {}).get("updated_at"),
                "equip_photos": [{"id": p["id"], "filename": p.get("filename", "")} for p in (eq.get("photos") or []) if not p.get("is_deleted")]}

    @router.put("/equipamentos/{eid}/laudo")
    async def put_laudo(eid: str, body: LaudoBody, current_user: dict = Depends(get_current_user)):
        eq = await _equip(eid, current_user)
        data = body.model_dump(exclude_none=True)
        if "tipo_laudo" in data and data["tipo_laudo"] not in TIPOS:
            raise HTTPException(status_code=400, detail=f"tipo_laudo inválido. Use: {TIPOS}")
        if "configuracao" in data and data["configuracao"] not in ("trifasico", "monofasico", ""):
            raise HTTPException(status_code=400, detail="configuracao inválida")
        if "tipo_oleo" in data and data["tipo_oleo"] not in ("ovi", "omi", ""):
            raise HTTPException(status_code=400, detail="tipo_oleo inválido")
        if "reformado" in data and data["reformado"] not in ("sim", "nao", ""):
            raise HTTPException(status_code=400, detail="reformado inválido")
        for k in ("aterr_leituras", "tensao_leituras"):
            if k in data:
                data[k] = ([str(x or "").strip() for x in data[k]] + ["", "", ""])[:3]
        upd = {f"laudo.{k}": (v.strip() if isinstance(v, str) else v) for k, v in data.items()}
        upd["laudo.updated_at"] = _now()
        upd["laudo.updated_by"] = current_user.get("name", "") or current_user.get("email", "")
        await db.equipamentos.update_one({"_id": eq["_id"]}, {"$set": upd})
        eq = await _equip(eid, current_user)
        return {"status": "ok", "laudo": await _effective(eq)}

    async def _save_slot(eq: dict, slot: str, meta: dict):
        await db.equipamentos.update_one({"_id": eq["_id"]}, {"$set": {f"laudo.photos.{slot}": meta, "laudo.updated_at": _now()}})

    @router.post("/equipamentos/{eid}/laudo/photos/{slot}")
    async def upload_slot(eid: str, slot: str, file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
        if slot not in SLOTS:
            raise HTTPException(status_code=400, detail=f"Espaço inválido. Use: {SLOTS}")
        eq = await _equip(eid, current_user)
        content = await file.read()
        if not content or len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Imagem vazia ou maior que 15MB")
        try:
            data, ct = await asyncio.to_thread(_prepare_image, content)
        except Exception:
            raise HTTPException(status_code=400, detail="Arquivo não é uma imagem válida")
        if watermark_fn and slot in ("placa", "instalado"):
            try:
                data, ct = watermark_fn(data, ct, (eq.get("patrimonio") or "").strip() or "SEM PATRIMÔNIO", "TRAFO")
            except Exception:
                pass
        path = f"{app_name}/equipamentos/{current_user['_id']}/laudo/{eid}/{slot}-{secrets.token_urlsafe(4)}.jpg"
        res = await storage_put(path, data, ct)
        meta = {"storage_path": res.get("path", path), "content_type": ct, "size": len(data), "uploaded_at": _now(), "source": "upload"}
        await _save_slot(eq, slot, meta)
        return {"status": "ok", "slot": slot, "url": f"/api/equipamentos/{eid}/laudo/photos/{slot}", "uploaded_at": meta["uploaded_at"]}

    @router.post("/equipamentos/{eid}/laudo/photos/{slot}/from-photo")
    async def slot_from_photo(eid: str, slot: str, body: FromPhotoBody, current_user: dict = Depends(get_current_user)):
        if slot not in SLOTS:
            raise HTTPException(status_code=400, detail=f"Espaço inválido. Use: {SLOTS}")
        eq = await _equip(eid, current_user)
        ph = next((p for p in (eq.get("photos") or []) if p.get("id") == body.photo_id and not p.get("is_deleted")), None)
        if not ph:
            raise HTTPException(status_code=404, detail="Foto do equipamento não encontrada")
        meta = {"storage_path": ph["storage_path"], "content_type": ph.get("content_type") or "image/jpeg", "uploaded_at": _now(), "source": "photo", "photo_id": ph["id"]}
        await _save_slot(eq, slot, meta)
        return {"status": "ok", "slot": slot, "url": f"/api/equipamentos/{eid}/laudo/photos/{slot}", "photo_id": ph["id"]}

    @router.get("/equipamentos/{eid}/laudo/photos/{slot}")
    async def slot_file(eid: str, slot: str, current_user: dict = Depends(get_current_user)):
        eq = await _equip(eid, current_user)
        meta = ((eq.get("laudo") or {}).get("photos") or {}).get(slot)
        if not meta:
            raise HTTPException(status_code=404, detail="Sem imagem neste espaço")
        data, ct = await storage_get(meta["storage_path"])
        return Response(content=data, media_type=meta.get("content_type") or ct, headers={"Cache-Control": "private, max-age=3600"})

    @router.delete("/equipamentos/{eid}/laudo/photos/{slot}")
    async def slot_delete(eid: str, slot: str, current_user: dict = Depends(get_current_user)):
        eq = await _equip(eid, current_user)
        await db.equipamentos.update_one({"_id": eq["_id"]}, {"$unset": {f"laudo.photos.{slot}": ""}, "$set": {"laudo.updated_at": _now()}})
        return {"status": "deleted", "slot": slot}

    @router.get("/equipamentos/{eid}/laudo/pdf")
    async def laudo_pdf(eid: str, current_user: dict = Depends(get_current_user)):
        eq = await _equip(eid, current_user)
        v = await _effective(eq)
        photos = {}
        for slot, meta in (((eq.get("laudo") or {}).get("photos") or {}).items()):
            if not meta:
                continue
            try:
                data, _ = await storage_get(meta["storage_path"])
                Image.open(io.BytesIO(data)).verify()
                photos[slot] = data
            except Exception:
                continue
        logo = None
        try:
            with open(os.path.join(ASSETS, "energisa_logo.png"), "rb") as fh:
                logo = fh.read()
        except Exception:
            logo = None
        pdf = await asyncio.to_thread(build_laudo_pdf, v, photos, logo)
        code = "".join(ch for ch in (v.get("projeto") or v.get("patrimonio") or eid) if ch.isalnum()) or eid
        return Response(content=pdf, media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="Laudo_Transformador_{code}.pdf"'})

    return router
