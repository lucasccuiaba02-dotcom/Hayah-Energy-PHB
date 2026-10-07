"""Set/2026 · Central de Notificações: alertas diários (obras vencidas, faturamento preso, estoque baixo)
via Push (VAPID), e-mail (Resend) e WhatsApp (Twilio) + integrações configuráveis pelo admin."""
import asyncio
import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from push_notifications import ensure_vapid_keys, send_push

logger = logging.getLogger(__name__)
TZ = ZoneInfo("America/Cuiaba")
KINDS = ("vencidas", "faturamento", "estoque")
KIND_LABELS = {"vencidas": "Obras vencidas", "faturamento": "Faturamento preso", "estoque": "Estoque baixo"}
INACTIVE_STATUS = ("executada", "concluido", "cancelado", "suspenso")
BILLING_LABELS = {
    "recebimento_tecnico": "Recebimento Técnico", "em_fechamento": "Em Fechamento", "ajuste_material": "Ajuste de Material",
    "pendencia_construtiva": "Pendência Construtiva", "aguardando_fiscalizacao": "Aguardando Fiscalização", "digitada": "Digitada",
    "aprovada": "Aprovada", "pago": "Pago",
}
DEFAULT_CHANNELS = {"push": True, "email": True, "whatsapp": True}
DEFAULT_SETTINGS = {
    "vencidas": {"enabled": True, "time": "08:00"},
    "faturamento": {"enabled": True, "time": "08:00", "threshold_days": 15},
    "estoque": {"enabled": True, "time": "08:00", "near_pct": 20, "instant": True},
}
INTEGRATION_FIELDS = ("reply_to_email", "notification_emails", "warehouse_email",
                      "twilio_account_sid", "twilio_auth_token", "twilio_whatsapp_from", "whatsapp_numbers")
SECRET_FIELDS = ("twilio_auth_token",)
ENV_MAP = {
    "reply_to_email": "EMAIL_REPLY_TO", "notification_emails": "NOTIFICATION_EMAILS",
    "warehouse_email": "WAREHOUSE_EMAIL", "twilio_account_sid": "TWILIO_ACCOUNT_SID", "twilio_auth_token": "TWILIO_AUTH_TOKEN",
    "twilio_whatsapp_from": "TWILIO_WHATSAPP_FROM", "whatsapp_numbers": "WHATSAPP_NUMBERS",
}
MASK = "••••••••"


def _split(s) -> List[str]:
    return [x.strip() for x in str(s or "").replace(";", ",").replace("\n", ",").split(",") if x.strip()]


def _brl(v) -> str:
    return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _d(s) -> str:
    return (s or "")[:10]


def _br(s) -> str:
    s = _d(s)
    return f"{s[8:10]}/{s[5:7]}/{s[0:4]}" if len(s) == 10 else "—"


def _today() -> str:
    return datetime.now(TZ).strftime("%Y-%m-%d")


def _days_since(iso: str) -> Optional[int]:
    try:
        return (date.fromisoformat(_today()) - date.fromisoformat(_d(iso))).days
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- integrações (admin, global)
async def get_integrations(db) -> dict:
    doc = await db.settings.find_one({"_id": "integrations"}) or {}
    out = {}
    for f in INTEGRATION_FIELDS:
        v = str(doc.get(f) or "").strip() or os.environ.get(ENV_MAP[f], "").strip()
        out[f] = v
    return out


async def reply_to_email(db) -> str:
    return (await get_integrations(db))["reply_to_email"]


async def notification_emails(db) -> List[str]:
    return _split((await get_integrations(db))["notification_emails"])


async def warehouse_emails(db) -> List[str]:
    i = await get_integrations(db)
    return _split(i["warehouse_email"]) or _split(i["notification_emails"])


async def send_email(db, recipients: List[str], subject: str, html: str) -> dict:
    """Out/2026 · proxy gerenciado da Emergent (email_service). Reply-To vem das integrações ou do .env."""
    import email_service
    return await email_service.send_email(to=recipients, subject=subject, html=html, reply_to=await reply_to_email(db) or None)


def _wa(n: str) -> str:
    n = str(n or "").strip()
    if n.startswith("whatsapp:"):
        n = n[len("whatsapp:"):]
    digits = re.sub(r"\D", "", n)
    return f"whatsapp:+{digits}"


async def send_whatsapp(db, numbers: Optional[List[str]], text: str) -> dict:
    i = await get_integrations(db)
    if not (i["twilio_account_sid"] and i["twilio_auth_token"] and i["twilio_whatsapp_from"]):
        return {"status": "skipped", "reason": "no_credentials"}
    numbers = numbers or _split(i["whatsapp_numbers"])
    if not numbers:
        return {"status": "skipped", "reason": "no_numbers"}
    try:
        from twilio.rest import Client
        client = Client(i["twilio_account_sid"], i["twilio_auth_token"])
    except Exception as e:
        return {"status": "error", "error": str(e)[:300]}
    body = text[:1500]
    results = []
    for n in numbers:
        try:
            msg = await asyncio.to_thread(lambda: client.messages.create(from_=_wa(i["twilio_whatsapp_from"]), to=_wa(n), body=body))
            results.append({"to": n, "status": "sent", "sid": msg.sid})
        except Exception as e:
            logger.warning(f"Twilio WhatsApp error to {n}: {e}")
            results.append({"to": n, "status": "error", "error": str(e)[:200]})
    ok = any(r["status"] == "sent" for r in results)
    return {"status": "sent" if ok else "error", "results": results}


async def push_workspace(db, user_id, payload: dict) -> dict:
    keys = await ensure_vapid_keys(db)
    subs = await db.push_subscriptions.find({"user_id": user_id}).to_list(500)
    sent = removed = 0
    for s in subs:
        if not s.get("subscription"):
            continue
        ok = await asyncio.to_thread(send_push, s["subscription"], payload, keys["private_pem"])
        if ok:
            sent += 1
        else:
            await db.push_subscriptions.delete_one({"_id": s["_id"]})
            removed += 1
    return {"status": "sent" if sent else ("no_devices" if not subs else "error"), "sent": sent, "removed": removed, "devices": len(subs)}


# ---------------------------------------------------------------- alertas
async def alert_vencidas(db, user_id) -> dict:
    today = _today()
    cur = db.projects.find({"user_id": user_id, "expiry_date": {"$nin": [None, ""]}, "execution_status": {"$nin": list(INACTIVE_STATUS)}},
                           {"project_code": 1, "name": 1, "team_name": 1, "expiry_date": 1, "programmed_value": 1, "execution_status": 1, "location": 1})
    items = []
    for p in await cur.to_list(5000):
        exp = _d(p.get("expiry_date"))
        if exp and exp < today:
            items.append({"id": str(p["_id"]), "project_code": p.get("project_code") or "", "name": p.get("name") or "", "team_name": p.get("team_name") or "",
                          "expiry_date": exp, "days": _days_since(exp) or 0, "value": float(p.get("programmed_value") or 0), "status": p.get("execution_status") or ""})
    items.sort(key=lambda x: -x["days"])
    total = sum(i["value"] for i in items)
    n = len(items)
    top = " · ".join(f"{i['project_code'] or i['name']} ({i['days']}d)" for i in items[:3])
    return {"kind": "vencidas", "count": n, "total_value": total, "items": items[:60], "url": "/carteira?filter=vencidas",
            "title": f"⚠️ {n} obra(s) vencida(s)" if n else "Nenhuma obra vencida",
            "body": f"{_brl(total)} em obras com vencimento passado. {top}" if n else "Tudo em dia."}


async def alert_faturamento(db, user_id, threshold_days: int = 15) -> dict:
    today = date.fromisoformat(_today())
    cur = db.projects.find({"user_id": user_id, "billing_stage": {"$nin": [None, "", "pago"]}, "execution_status": {"$nin": ["cancelado", "suspenso"]}},
                           {"project_code": 1, "name": 1, "team_name": 1, "billing_stage": 1, "billing_history": 1, "closed_at": 1, "updated_at": 1,
                            "actual_value": 1, "programmed_value": 1})
    items = []
    for p in await cur.to_list(5000):
        stage = p.get("billing_stage") or ""
        entered = ""
        for h in reversed(p.get("billing_history") or []):
            if h.get("stage") == stage:
                entered = h.get("changed_at") or ""
                break
        entered = entered or p.get("closed_at") or p.get("updated_at") or ""
        try:
            days = (today - date.fromisoformat(_d(entered))).days
        except Exception:
            continue
        if days >= threshold_days:
            items.append({"id": str(p["_id"]), "project_code": p.get("project_code") or "", "name": p.get("name") or "", "team_name": p.get("team_name") or "",
                          "billing_stage": stage, "stage_label": BILLING_LABELS.get(stage, stage), "days": days,
                          "value": float(p.get("actual_value") or p.get("programmed_value") or 0)})
    items.sort(key=lambda x: -x["days"])
    total = sum(i["value"] for i in items)
    n = len(items)
    top = " · ".join(f"{i['project_code'] or i['name']} ({i['days']}d · {i['stage_label']})" for i in items[:3])
    return {"kind": "faturamento", "count": n, "total_value": total, "items": items[:60], "url": "/faturamento?view=backlog", "threshold_days": threshold_days,
            "title": f"💰 Faturamento preso — {n} obra(s)" if n else "Esteira de faturamento fluindo",
            "body": f"{_brl(total)} parados há mais de {threshold_days} dias no mesmo estágio. {top}" if n else "Nenhuma obra parada."}


async def alert_estoque(db, user_id, near_pct: float = 20) -> dict:
    docs = await db.stock_items.find({"user_id": user_id, "min_stock": {"$gt": 0}}).to_list(20000)
    items = []
    for d in docs:
        ms = float(d.get("min_stock") or 0)
        qp = float(d.get("qty_physical") or 0)
        if ms <= 0:
            continue
        if qp <= ms:
            level = "critico"
        elif qp <= ms * (1 + float(near_pct or 0) / 100.0):
            level = "perto"
        else:
            continue
        items.append({"id": str(d["_id"]), "code": d.get("code") or "", "description": d.get("description") or "", "unit": (d.get("unit") or "UN").upper(),
                      "qty_physical": qp, "min_stock": ms, "level": level, "pct": round(qp / ms * 100) if ms else 0})
    items.sort(key=lambda x: (0 if x["level"] == "critico" else 1, x["pct"]))
    crit = sum(1 for i in items if i["level"] == "critico")
    near = len(items) - crit
    n = len(items)
    top = " · ".join(f"{i['code'] or i['description'][:18]} ({i['qty_physical']:g}/{i['min_stock']:g})" for i in items[:3])
    return {"kind": "estoque", "count": n, "critical_count": crit, "near_count": near, "items": items[:80], "url": "/estoque?low=1", "near_pct": near_pct,
            "title": f"📦 Estoque baixo — {crit} crítico(s), {near} perto do mínimo" if n else "Estoque acima do mínimo",
            "body": f"Itens no mínimo ou até {near_pct:g}% acima. {top}" if n else "Nenhum item em alerta."}


async def build_alert(db, user_id, kind: str, cfg: dict) -> dict:
    if kind == "vencidas":
        return await alert_vencidas(db, user_id)
    if kind == "faturamento":
        return await alert_faturamento(db, user_id, int(cfg.get("threshold_days") or 15))
    return await alert_estoque(db, user_id, float(cfg.get("near_pct") or 0))


# ---------------------------------------------------------------- formatação
def whatsapp_text(alert: dict, app_url: str = "") -> str:
    k = alert["kind"]
    lines = [f"*HAYAH ENERGY · {alert['title']}*", f"_{datetime.now(TZ).strftime('%d/%m/%Y %H:%M')}_", ""]
    for i in alert["items"][:15]:
        if k == "vencidas":
            lines.append(f"• *{i['project_code'] or '—'}* {i['name'][:40]} — venceu {_br(i['expiry_date'])} (há {i['days']}d) · {_brl(i['value'])}")
        elif k == "faturamento":
            lines.append(f"• *{i['project_code'] or '—'}* {i['name'][:40]} — {i['stage_label']} há {i['days']}d · {_brl(i['value'])}")
        else:
            flag = "🔴" if i["level"] == "critico" else "🟠"
            lines.append(f"{flag} *{i['code']}* {i['description'][:40]} — {i['qty_physical']:g} {i['unit']} (mín. {i['min_stock']:g})")
    if alert["count"] > 15:
        lines.append(f"… e mais {alert['count'] - 15} item(ns)")
    if k in ("vencidas", "faturamento"):
        lines += ["", f"Total: *{_brl(alert.get('total_value'))}*"]
    if app_url:
        lines += ["", f"Abrir no sistema: {app_url.rstrip('/')}{alert['url']}"]
    return "\n".join(lines)


def email_html(alert: dict, app_url: str = "") -> str:
    k = alert["kind"]
    if k == "vencidas":
        head, rows = ["Código", "Obra", "Equipe", "Venceu em", "Dias", "Valor"], [
            [i["project_code"], i["name"], i["team_name"], _br(i["expiry_date"]), str(i["days"]), _brl(i["value"])] for i in alert["items"]]
    elif k == "faturamento":
        head, rows = ["Código", "Obra", "Equipe", "Estágio", "Dias parado", "Valor"], [
            [i["project_code"], i["name"], i["team_name"], i["stage_label"], str(i["days"]), _brl(i["value"])] for i in alert["items"]]
    else:
        head, rows = ["Código", "Descrição", "Físico", "Mínimo", "Situação"], [
            [i["code"], i["description"], f"{i['qty_physical']:g} {i['unit']}", f"{i['min_stock']:g}", "CRÍTICO" if i["level"] == "critico" else "perto do mínimo"] for i in alert["items"]]
    th = "".join(f"<th style='text-align:left;padding:6px 8px;border-bottom:2px solid #E0FF00;color:#E0FF00;font-size:11px'>{h}</th>" for h in head)
    trs = "".join("<tr>" + "".join(f"<td style='padding:6px 8px;border-bottom:1px solid #222;font-size:12px'>{c}</td>" for c in r) + "</tr>" for r in rows)
    link = f"<p style='margin-top:18px'><a href='{app_url.rstrip('/')}{alert['url']}' style='color:#00F0FF'>Abrir no sistema →</a></p>" if app_url else ""
    return f"""<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;background:#050505;color:#fff;padding:24px">
      <h1 style="color:#E0FF00;margin:0 0 4px;font-size:20px">HAYAH ENERGY</h1>
      <h2 style="margin:0 0 6px;font-size:16px">{alert['title']}</h2>
      <p style="color:#a1a1aa;font-size:13px;margin:0 0 16px">{alert['body']}</p>
      <table style="width:100%;border-collapse:collapse"><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>{link}
      <p style="color:#555;font-size:10px;margin-top:18px">Alerta automático · {datetime.now(TZ).strftime('%d/%m/%Y %H:%M')} (Cuiabá)</p></div>"""


def push_payload(alert: dict) -> dict:
    return {"title": alert["title"], "body": alert["body"][:180], "url": alert["url"], "tag": f"hayah-{alert['kind']}", "requireInteraction": True}


# ---------------------------------------------------------------- settings por workspace
async def get_settings(db, user_id):
    doc = await db.app_settings.find_one({"user_id": user_id, "key": "notification_settings"}) or {}
    val = doc.get("value") or {}
    merged = {}
    for k in KINDS:
        v = val.get(k) or {}
        merged[k] = {**DEFAULT_SETTINGS[k], **{x: y for x, y in v.items() if x != "channels"}, "channels": {**DEFAULT_CHANNELS, **(v.get("channels") or {})}}
    return merged, doc.get("last_sent") or {}


async def dispatch(db, user_id, alert: dict, channels: dict, app_url: str, trigger: str = "scheduled") -> dict:
    res: Dict[str, dict] = {}
    if channels.get("push", True):
        res["push"] = await push_workspace(db, user_id, push_payload(alert))
    if channels.get("email"):
        res["email"] = await send_email(db, await notification_emails(db), f"[HAYAH] {alert['title']}", email_html(alert, app_url))
    if channels.get("whatsapp"):
        res["whatsapp"] = await send_whatsapp(db, None, whatsapp_text(alert, app_url))
    await db.notification_log.insert_one({"user_id": user_id, "kind": alert["kind"], "at": _now_iso(), "count": alert["count"],
                                          "title": alert["title"], "trigger": trigger, "results": res})
    return res


async def stock_instant_alert(db, user_id, items: List[dict], app_url: str) -> Optional[dict]:
    """Push imediato quando itens caem para ≤ mínimo (edição/importação)."""
    if not items:
        return None
    settings, _ = await get_settings(db, user_id)
    cfg = settings["estoque"]
    if not (cfg.get("enabled") and cfg.get("instant")):
        return None
    names = " · ".join(f"{(i.get('code') or i.get('description') or '')[:20]} ({float(i.get('qty_physical') or 0):g}/{float(i.get('min_stock') or 0):g})" for i in items[:3])
    alert = {"kind": "estoque", "count": len(items), "items": [], "url": "/estoque?low=1",
             "title": f"📦 {len(items)} item(ns) atingiu o estoque mínimo", "body": names}
    res = {"push": await push_workspace(db, user_id, push_payload(alert))}
    await db.notification_log.insert_one({"user_id": user_id, "kind": "estoque", "at": _now_iso(), "count": len(items), "title": alert["title"], "trigger": "instant", "results": res})
    return res


async def notifications_tick(db, app_url: str):
    """Roda a cada 5 min: dispara os alertas diários de cada workspace no horário configurado (1x por dia)."""
    now = datetime.now(TZ)
    today, hhmm = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")
    try:
        owners = await db.users.find({"role": "admin", "owner_id": None}, {"_id": 1}).to_list(500)
    except Exception as e:
        logger.warning(f"notifications_tick: users query failed: {e}")
        return
    for u in owners:
        uid = u["_id"]
        try:
            settings, last_sent = await get_settings(db, uid)
            for kind in KINDS:
                cfg = settings[kind]
                if not cfg.get("enabled") or hhmm < (cfg.get("time") or "08:00") or last_sent.get(kind) == today:
                    continue
                alert = await build_alert(db, uid, kind, cfg)
                if alert["count"] > 0:
                    await dispatch(db, uid, alert, cfg.get("channels") or {}, app_url, trigger="scheduled")
                    logger.info(f"Notification {kind} sent for workspace {uid}: {alert['count']} item(s)")
                await db.app_settings.update_one({"user_id": uid, "key": "notification_settings"},
                                                 {"$set": {f"last_sent.{kind}": today}, "$setOnInsert": {"value": {}}}, upsert=True)
        except Exception as e:
            logger.error(f"notifications_tick workspace {uid}: {e}")


# ---------------------------------------------------------------- API
class ChannelsBody(BaseModel):
    push: Optional[bool] = None
    email: Optional[bool] = None
    whatsapp: Optional[bool] = None


class KindSettings(BaseModel):
    enabled: Optional[bool] = None
    time: Optional[str] = None
    threshold_days: Optional[int] = None
    near_pct: Optional[float] = None
    instant: Optional[bool] = None
    channels: Optional[ChannelsBody] = None


class SettingsBody(BaseModel):
    vencidas: Optional[KindSettings] = None
    faturamento: Optional[KindSettings] = None
    estoque: Optional[KindSettings] = None


class TestBody(BaseModel):
    channels: Optional[ChannelsBody] = None


class IntegrationsBody(BaseModel):
    reply_to_email: Optional[str] = None
    notification_emails: Optional[str] = None
    warehouse_email: Optional[str] = None
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_whatsapp_from: Optional[str] = None
    whatsapp_numbers: Optional[str] = None


class TestTarget(BaseModel):
    to: str = ""


def build_router(db, get_current_user, app_url: str):
    router = APIRouter(prefix="/api")

    def _admin(user):
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Apenas administradores")

    async def _status(db):
        import email_service
        i = await get_integrations(db)
        return {
            "email_ready": email_service.email_ready(), "email_sender": email_service.sender_name(), "email_reply_to": i["reply_to_email"],
            "email_recipients": _split(i["notification_emails"]), "warehouse_recipients": _split(i["warehouse_email"]),
            "whatsapp_ready": bool(i["twilio_account_sid"] and i["twilio_auth_token"] and i["twilio_whatsapp_from"]),
            "whatsapp_numbers": _split(i["whatsapp_numbers"]),
        }

    @router.get("/notifications/settings")
    async def get_notification_settings(current_user: dict = Depends(get_current_user)):
        settings, last_sent = await get_settings(db, current_user["_id"])
        devices = await db.push_subscriptions.count_documents({"user_id": current_user["_id"]})
        return {"settings": settings, "last_sent": last_sent, "push_devices": devices, "integrations": await _status(db), "kinds": KIND_LABELS}

    @router.put("/notifications/settings")
    async def put_notification_settings(body: SettingsBody, current_user: dict = Depends(get_current_user)):
        settings, _ = await get_settings(db, current_user["_id"])
        for kind in KINDS:
            ks = getattr(body, kind)
            if not ks:
                continue
            data = ks.model_dump(exclude_none=True)
            ch = data.pop("channels", None)
            if "time" in data and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", data["time"]):
                raise HTTPException(status_code=400, detail=f"Horário inválido em {kind}: use HH:MM")
            if "threshold_days" in data and data["threshold_days"] < 1:
                raise HTTPException(status_code=400, detail="threshold_days deve ser ≥ 1")
            if "near_pct" in data and not (0 <= data["near_pct"] <= 500):
                raise HTTPException(status_code=400, detail="near_pct deve estar entre 0 e 500")
            settings[kind].update(data)
            if ch:
                settings[kind]["channels"] = {**settings[kind]["channels"], **ch}
        await db.app_settings.update_one({"user_id": current_user["_id"], "key": "notification_settings"},
                                         {"$set": {"value": settings, "updated_at": _now_iso()}}, upsert=True)
        return {"status": "ok", "settings": settings}

    @router.get("/notifications/preview")
    async def preview(current_user: dict = Depends(get_current_user)):
        settings, _ = await get_settings(db, current_user["_id"])
        out = {}
        for kind in KINDS:
            a = await build_alert(db, current_user["_id"], kind, settings[kind])
            a["whatsapp_text"] = whatsapp_text(a, app_url)
            out[kind] = a
        return out

    @router.post("/notifications/test/{kind}")
    async def test_kind(kind: str, body: TestBody = None, current_user: dict = Depends(get_current_user)):
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail=f"Tipo inválido. Use: {list(KINDS)}")
        settings, _ = await get_settings(db, current_user["_id"])
        cfg = settings[kind]
        channels = {**cfg["channels"], **((body.channels.model_dump(exclude_none=True) if body and body.channels else {}))}
        alert = await build_alert(db, current_user["_id"], kind, cfg)
        if alert["count"] == 0:
            alert = {**alert, "title": f"✅ Teste · {KIND_LABELS[kind]}", "body": "Nenhum item em alerta agora — notificação de teste."}
        res = await dispatch(db, current_user["_id"], alert, channels, app_url, trigger="manual")
        return {"count": alert["count"], "title": alert["title"], "results": res}

    @router.get("/notifications/log")
    async def get_log(limit: int = 30, current_user: dict = Depends(get_current_user)):
        docs = await db.notification_log.find({"user_id": current_user["_id"]}).sort("at", -1).to_list(min(max(limit, 1), 200))
        return [{k: v for k, v in d.items() if k not in ("_id", "user_id")} for d in docs]

    # ---------------- integrações (admin)
    @router.get("/integrations")
    async def get_integrations_view(current_user: dict = Depends(get_current_user)):
        _admin(current_user)
        doc = await db.settings.find_one({"_id": "integrations"}) or {}
        merged = await get_integrations(db)
        values = {}
        for f in INTEGRATION_FIELDS:
            v = merged[f]
            values[f] = (MASK if v else "") if f in SECRET_FIELDS else v
        return {"values": values, "from_env": {f: bool(not str(doc.get(f) or "").strip() and os.environ.get(ENV_MAP[f], "").strip()) for f in INTEGRATION_FIELDS},
                "status": await _status(db), "updated_at": doc.get("updated_at")}

    @router.put("/integrations")
    async def put_integrations(body: IntegrationsBody, current_user: dict = Depends(get_current_user)):
        _admin(current_user)
        upd = {}
        for f, v in body.model_dump(exclude_none=True).items():
            v = str(v).strip()
            if f in SECRET_FIELDS and v == MASK:
                continue
            upd[f] = v
        if not upd:
            raise HTTPException(status_code=400, detail="Nada para atualizar")
        upd["updated_at"] = _now_iso()
        upd["updated_by"] = current_user.get("email", "")
        await db.settings.update_one({"_id": "integrations"}, {"$set": upd}, upsert=True)
        return {"status": "ok", "status_flags": await _status(db)}

    @router.post("/integrations/test-email")
    async def test_email(body: TestTarget, current_user: dict = Depends(get_current_user)):
        _admin(current_user)
        # G4: destinatários só de registros do servidor (e-mails cadastrados) ou o próprio admin
        allowed = {e.lower() for e in await notification_emails(db) + await warehouse_emails(db) + [current_user.get("email", "")] if e}
        requested = [e.lower() for e in _split(body.to)]
        if any(e not in allowed for e in requested):
            raise HTTPException(status_code=400, detail="O teste só pode ser enviado para e-mails cadastrados nas integrações ou para o seu próprio e-mail")
        to = requested or await notification_emails(db) or [current_user.get("email", "")]
        from branding_cache import brand_name
        from html import escape
        res = await send_email(db, to, f"[{brand_name()}] Teste de e-mail",
                               f"<div style='font-family:Arial;background:#050505;color:#fff;padding:24px'><h2 style='color:#E0FF00;margin:0 0 8px'>{escape(brand_name())}</h2>"
                               f"<p>E-mail de teste — integração de e-mail funcionando ✅</p><p style='color:#71717a;font-size:11px'>Enviado por {escape(brand_name())} · {datetime.now(TZ).strftime('%d/%m/%Y %H:%M')}</p></div>")
        if res.get("status") == "error":
            raise HTTPException(status_code=502, detail=res.get("error"))
        if res.get("status") == "skipped":
            raise HTTPException(status_code=400, detail="Envio de e-mail não configurado no servidor (EMERGENT_EMAIL_KEY) ou sem destinatários")
        return res

    @router.post("/integrations/test-whatsapp")
    async def test_whatsapp(body: TestTarget, current_user: dict = Depends(get_current_user)):
        _admin(current_user)
        res = await send_whatsapp(db, _split(body.to) or None, f"*HAYAH ENERGY*\nMensagem de teste — WhatsApp (Twilio) funcionando ✅\n{datetime.now(TZ).strftime('%d/%m/%Y %H:%M')}")
        if res.get("status") == "skipped":
            raise HTTPException(status_code=400, detail="Configure SID, token, número remetente e destinatários do WhatsApp antes de testar")
        if res.get("status") == "error":
            raise HTTPException(status_code=502, detail="; ".join(r.get("error", "") for r in res.get("results", []))[:300] or res.get("error", "erro"))
        return res

    return router
