"""Out/2026 · Licença de uso (cópia white-label para outra empresa): ciclo de 30 dias, bloqueio total ao expirar,
pagamento manual (senha-mestra do licenciante) ou online via Stripe (sandbox reivindicável). Marca branca (nome/logo)."""
import os
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from branding_cache import brand, set_brand

TZ = ZoneInfo("America/Cuiaba")
LICENSE_KEY = "license"
BRANDING_KEY = "branding"
PRICE_LOOKUP = "licenca_mensal"
PRODUCT_ID = "licenca_mensal_app"
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY") or "sk_test_emergent"
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

_cache = {"blocked": False, "at": 0.0}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> date:
    return datetime.now(TZ).date()


def _master_ok(key: str) -> bool:
    master = os.environ.get("LICENSE_MASTER_KEY", "")
    return bool(master) and (key or "") == master


class ConfigBody(BaseModel):
    master_key: str
    enabled: Optional[bool] = None
    empresa: Optional[str] = None
    cnpj: Optional[str] = None
    contato_email: Optional[str] = None
    valor: Optional[float] = None  # R$ por ciclo
    ciclo_dias: Optional[int] = None
    paid_until: Optional[str] = None  # YYYY-MM-DD (ajuste manual)


class ManualPaymentBody(BaseModel):
    master_key: str
    dias: Optional[int] = None
    obs: str = ""


class CheckoutBody(BaseModel):
    origin_url: str
    master_key: str = ""


class MasterKeyBody(BaseModel):
    master_key: str


class BrandingBody(BaseModel):
    master_key: str = ""
    app_name: Optional[str] = None
    company_name: Optional[str] = None
    tagline: Optional[str] = None
    logo_data_url: Optional[str] = None  # PNG/JPEG/SVG em data URL (≤ 300 KB) · "" remove


def status_of(doc: dict) -> dict:
    doc = doc or {}
    enabled = bool(doc.get("enabled"))
    paid_until = (doc.get("paid_until") or "")[:10]
    days_left = None
    expired = False
    if enabled and paid_until:
        try:
            days_left = (date.fromisoformat(paid_until) - _today()).days
            expired = days_left < 0
        except ValueError:
            days_left, expired = None, False
    elif enabled and not paid_until:
        expired = True
    return {"enabled": enabled, "empresa": doc.get("empresa", ""), "cnpj": doc.get("cnpj", ""), "contato_email": doc.get("contato_email", ""),
            "valor": float(doc.get("valor") or 0), "ciclo_dias": int(doc.get("ciclo_dias") or 30), "paid_until": paid_until, "days_left": days_left,
            "expired": expired, "blocked": enabled and expired, "warning": enabled and days_left is not None and 0 <= days_left <= 5,
            "stripe_enabled": bool(os.environ.get("STRIPE_SECRET_KEY")), "master_configured": bool(os.environ.get("LICENSE_MASTER_KEY")),
            "history": list(reversed((doc.get("history") or [])[-12:])), "updated_at": doc.get("updated_at", "")}


async def is_blocked(db) -> bool:
    if time.time() - _cache["at"] < 60:
        return _cache["blocked"]
    doc = await db.app_settings.find_one({"key": LICENSE_KEY})
    _cache.update({"blocked": status_of(doc)["blocked"], "at": time.time()})
    return _cache["blocked"]


def _invalidate():
    _cache["at"] = 0.0


async def extend_license(db, days: int, method: str, by: str = "", obs: str = "", session_id: str = "") -> dict:
    doc = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
    base = _today()
    cur = (doc.get("paid_until") or "")[:10]
    try:
        if cur and date.fromisoformat(cur) > base:
            base = date.fromisoformat(cur)
    except ValueError:
        pass
    new_until = (base + timedelta(days=int(days))).isoformat()
    entry = {"at": _now(), "by": by, "method": method, "days": int(days), "until": new_until, "obs": obs, "session_id": session_id}
    await db.app_settings.update_one({"key": LICENSE_KEY}, {"$set": {"paid_until": new_until, "enabled": True, "updated_at": _now()}, "$push": {"history": entry}}, upsert=True)
    _invalidate()
    return entry


async def load_branding(db) -> dict:
    doc = await db.app_settings.find_one({"key": BRANDING_KEY}, {"_id": 0, "app_name": 1, "company_name": 1, "tagline": 1, "logo_data_url": 1})
    set_brand(doc or {})
    return brand()


def reminder_html(st: dict, app_url: str, from_name: str) -> str:
    from html import escape
    days = st.get("days_left")
    when = "HOJE" if days == 0 else (f"em {days} dia(s)" if (days or 0) > 0 else f"há {-(days or 0)} dia(s)")
    headline = "Licença de uso vencida" if st.get("expired") else f"Licença de uso vence {when}"
    paid = (st.get("paid_until") or "")[:10]
    paid_br = f"{paid[8:10]}/{paid[5:7]}/{paid[0:4]}" if len(paid) == 10 else "—"
    valor = f"R$ {float(st.get('valor') or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    link = f"{app_url.rstrip('/')}/licenca"
    return (f'<table role="presentation" width="100%" style="max-width:640px;margin:0 auto;font-family:Arial,sans-serif;background:#050505;color:#fff"><tr><td style="padding:24px">'
            f'<p style="margin:0 0 4px;color:#E0FF00;font-size:12px;letter-spacing:.2em;font-weight:bold">{escape(from_name.upper())}</p>'
            f'<h1 style="margin:0 0 12px;font-size:20px">{headline}</h1>'
            f'<p style="margin:0 0 8px;color:#d4d4d8;font-size:14px">Empresa: <b style="color:#fff">{escape(st.get("empresa") or "—")}</b></p>'
            f'<p style="margin:0 0 8px;color:#d4d4d8;font-size:14px">Pago até: <b style="color:#fff">{paid_br}</b> · Ciclo: {int(st.get("ciclo_dias") or 30)} dias · Valor: <b style="color:#fff">{valor}</b></p>'
            f'<p style="margin:16px 0;color:#a1a1aa;font-size:13px">Ao vencer, o acesso de todos os usuários é suspenso até a regularização. Os dados ficam preservados.</p>'
            f'<p style="margin:16px 0"><a href="{link}" style="display:inline-block;padding:12px 20px;background:#E0FF00;color:#000;font-weight:bold;border-radius:999px;text-decoration:none">Abrir página da licença e renovar</a></p>'
            f'<p style="margin:16px 0 0;color:#555;font-size:10px">Aviso automático enviado por {escape(from_name)}. Nunca pedimos senha ou dados de cartão por e-mail.</p>'
            f'</td></tr></table>')


async def reminder_tick(db, app_url: str, send_email) -> dict | None:
    """Lembrete diário (após 08:00 Cuiabá) quando faltam ≤ 5 dias ou já venceu — para contato da licença + admins."""
    now = datetime.now(TZ)
    if now.hour < 8:
        return None
    doc = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
    st = status_of(doc)
    if not st["enabled"] or st["days_left"] is None or st["days_left"] > 5 or st["days_left"] < -7:
        return None
    today = now.strftime("%Y-%m-%d")
    if doc.get("reminder_sent_on") == today or not (app_url or "").startswith("https://"):
        return None
    admins = await db.users.find({"role": "admin"}, {"email": 1}).to_list(50)
    recipients = sorted({e.strip().lower() for e in [st.get("contato_email", "")] + [a.get("email", "") for a in admins] if e and "@" in e})
    if not recipients:
        return None
    from branding_cache import brand_name
    res = await send_email(to=recipients, subject=f"[{brand_name()}] " + ("Licença vencida — acesso suspenso" if st["expired"] else f"Licença vence em {st['days_left']} dia(s)"),
                           html=reminder_html(st, app_url, brand_name()))
    await db.app_settings.update_one({"key": LICENSE_KEY}, {"$set": {"reminder_sent_on": today, "reminder_last": {"at": _now(), "to": recipients, "status": res.get("status"), "error": res.get("error", "")}}})
    return res


def _ensure_price(valor_brl: float) -> "stripe.Price":
    cents = int(round(valor_brl * 100))
    product = None
    for p in stripe.Product.list(active=True, limit=100).auto_paging_iter():
        if (p.to_dict().get("metadata") or {}).get("emergent_product_id") == PRODUCT_ID:
            product = p
            break
    if not product:
        product = stripe.Product.create(name="Licença de uso mensal — plataforma de gestão de obras", tax_code="txcd_10103001",
                                        metadata={"managed_by": "emergent", "emergent_product_id": PRODUCT_ID})
    existing = stripe.Price.list(lookup_keys=[PRICE_LOOKUP], active=True, limit=1).data
    if existing and (existing[0].unit_amount != cents or existing[0].currency != "brl"):
        stripe.Price.modify(existing[0].id, active=False)
        existing = []
    if existing:
        return existing[0]
    return stripe.Price.create(product=product.id, unit_amount=cents, currency="brl", lookup_key=PRICE_LOOKUP, transfer_lookup_key=True)


async def _credit_session(db, session_id: str, extra: dict | None = None) -> bool:
    """Marca a transação como paga e estende a licença — idempotente (só credita uma vez)."""
    tx = await db.payment_transactions.find_one_and_update(
        {"session_id": session_id, "credited": {"$ne": True}},
        {"$set": {"status": "completed", "payment_status": "paid", "credited": True, "updated_at": datetime.now(timezone.utc), **(extra or {})}})
    if not tx:
        return False
    lic = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
    await extend_license(db, int(lic.get("ciclo_dias") or 30), "stripe", by=tx.get("user_name") or "", obs=f"Pagamento online {tx.get('currency', '').upper()} {float(tx.get('amount') or 0) / 100:.2f}", session_id=session_id)
    return True


def build_router(db, get_current_user):
    router = APIRouter(prefix="/api")

    # ---- status / branding
    @router.get("/licenca/status")
    async def licenca_status(current_user: dict = Depends(get_current_user)):
        doc = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
        return {**status_of(doc), "is_admin": current_user.get("role") == "admin"}

    @router.get("/branding")
    async def get_branding():
        return await load_branding(db)

    @router.put("/branding")
    async def put_branding(body: BrandingBody, current_user: dict = Depends(get_current_user)):
        if not _master_ok(body.master_key):
            raise HTTPException(status_code=403, detail="Senha-mestra inválida")
        upd = {}
        if body.app_name is not None:
            upd["app_name"] = body.app_name.strip()[:60] or "Hayah Energy"
        if body.company_name is not None:
            upd["company_name"] = body.company_name.strip()[:120]
        if body.tagline is not None:
            upd["tagline"] = body.tagline.strip()[:40]
        if body.logo_data_url is not None:
            logo = body.logo_data_url.strip()
            if logo and not logo.startswith("data:image/"):
                raise HTTPException(status_code=400, detail="Logo deve ser uma imagem (data URL)")
            if len(logo) > 300 * 1024:
                raise HTTPException(status_code=400, detail="Logo maior que 300 KB — reduza a imagem")
            upd["logo_data_url"] = logo
        if not upd:
            raise HTTPException(status_code=400, detail="Nada para atualizar")
        upd.update({"updated_at": _now(), "updated_by": current_user.get("name", "")})
        await db.app_settings.update_one({"key": BRANDING_KEY}, {"$set": upd}, upsert=True)
        return await load_branding(db)

    # ---- configuração e pagamento manual (senha-mestra do licenciante)
    @router.post("/licenca/verificar-mestra")
    async def verificar_mestra(body: MasterKeyBody, current_user: dict = Depends(get_current_user)):
        if not _master_ok(body.master_key):
            raise HTTPException(status_code=403, detail="Senha-mestra inválida")
        return {"ok": True}

    @router.post("/licenca/config")
    async def licenca_config(body: ConfigBody, current_user: dict = Depends(get_current_user)):
        if not _master_ok(body.master_key):
            raise HTTPException(status_code=403, detail="Senha-mestra inválida")
        upd = {}
        for f in ("enabled", "empresa", "cnpj", "contato_email", "valor", "ciclo_dias", "paid_until"):
            v = getattr(body, f)
            if v is not None:
                upd[f] = v.strip() if isinstance(v, str) else v
        if "ciclo_dias" in upd and not (1 <= int(upd["ciclo_dias"]) <= 365):
            raise HTTPException(status_code=400, detail="Ciclo deve ter entre 1 e 365 dias")
        if "valor" in upd and float(upd["valor"]) < 0:
            raise HTTPException(status_code=400, detail="Valor inválido")
        if upd.get("paid_until"):
            try:
                date.fromisoformat(upd["paid_until"][:10])
            except ValueError:
                raise HTTPException(status_code=400, detail="Data 'pago até' inválida (AAAA-MM-DD)")
        upd.update({"updated_at": _now(), "updated_by": current_user.get("name", "")})
        await db.app_settings.update_one({"key": LICENSE_KEY}, {"$set": upd, "$push": {"history": {"at": _now(), "by": current_user.get("name", ""), "method": "config", "obs": "Configuração alterada"}}}, upsert=True)
        _invalidate()
        return status_of(await db.app_settings.find_one({"key": LICENSE_KEY}))

    @router.post("/licenca/pagamento-manual")
    async def pagamento_manual(body: ManualPaymentBody, current_user: dict = Depends(get_current_user)):
        if not _master_ok(body.master_key):
            raise HTTPException(status_code=403, detail="Senha-mestra inválida")
        lic = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
        days = int(body.dias or lic.get("ciclo_dias") or 30)
        if not (1 <= days <= 400):
            raise HTTPException(status_code=400, detail="Dias inválidos")
        entry = await extend_license(db, days, "manual", by=current_user.get("name", ""), obs=body.obs or "Pagamento registrado manualmente")
        return {"status": "ok", "entry": entry, **status_of(await db.app_settings.find_one({"key": LICENSE_KEY}))}

    # ---- Stripe (Flow A · sandbox reivindicável)
    @router.post("/licenca/checkout")
    async def licenca_checkout(body: CheckoutBody, current_user: dict = Depends(get_current_user)):
        if not _master_ok(body.master_key):
            raise HTTPException(status_code=403, detail="Senha-mestra inválida")
        if not os.environ.get("STRIPE_SECRET_KEY"):
            raise HTTPException(status_code=400, detail="Pagamento online não configurado")
        lic = await db.app_settings.find_one({"key": LICENSE_KEY}) or {}
        valor = float(lic.get("valor") or 0)
        if valor <= 0:
            raise HTTPException(status_code=400, detail="Valor da licença não definido — peça ao licenciante para configurar")
        origin = body.origin_url.rstrip("/")
        try:
            price = _ensure_price(valor)
            kwargs = dict(line_items=[{"price": price.id, "quantity": 1}], mode="payment",
                          success_url=f"{origin}/payment/success?session_id={{CHECKOUT_SESSION_ID}}", cancel_url=f"{origin}/payment/cancel",
                          metadata={"user_id": str(current_user["_id"]), "lookup_key": PRICE_LOOKUP, "kind": "licenca"})
            try:
                session = stripe.checkout.Session.create(**kwargs, automatic_tax={"enabled": True}, billing_address_collection="required")
            except stripe.error.InvalidRequestError:
                session = stripe.checkout.Session.create(**kwargs)
        except stripe.error.StripeError as e:
            raise HTTPException(status_code=502, detail=f"Stripe: {getattr(e, 'user_message', None) or str(e)}")
        await db.payment_transactions.insert_one({
            "session_id": session.id, "kind": "licenca", "user_id": str(current_user["_id"]), "user_name": current_user.get("name", ""), "lookup_key": PRICE_LOOKUP,
            "amount": float(price.unit_amount or 0), "currency": price.currency, "status": "initiated", "payment_status": "pending", "credited": False,
            "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
        return {"checkout_url": session.url, "session_id": session.id}

    @router.get("/licenca/pagamento/status/{session_id}")
    async def pagamento_status(session_id: str):
        rec = await db.payment_transactions.find_one({"session_id": session_id})
        if not rec:
            raise HTTPException(status_code=404, detail="Transação não encontrada")
        if rec.get("payment_status") != "paid":
            try:
                s = stripe.checkout.Session.retrieve(session_id)
                if s.payment_status == "paid" or s.status == "complete":
                    await _credit_session(db, session_id, {"stripe_payment_intent_id": s.payment_intent})
                    rec = await db.payment_transactions.find_one({"session_id": session_id})
            except stripe.error.StripeError:
                pass
        return {"session_id": rec["session_id"], "status": rec.get("status"), "payment_status": rec.get("payment_status")}

    @router.post("/stripe/webhook")
    async def stripe_webhook(request: Request):
        payload = await request.body()
        sig = request.headers.get("stripe-signature", "")
        try:
            event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
        except (stripe.error.SignatureVerificationError, ValueError):
            raise HTTPException(status_code=400, detail="Invalid signature")
        obj, t = event["data"]["object"], event["type"]
        now = datetime.now(timezone.utc)
        if t == "checkout.session.completed" and obj.get("payment_status", "paid") == "paid":
            await _credit_session(db, obj["id"], {"stripe_payment_intent_id": obj.get("payment_intent")})
        elif t == "checkout.session.async_payment_succeeded":
            await _credit_session(db, obj["id"], {"stripe_payment_intent_id": obj.get("payment_intent")})
        elif t == "checkout.session.async_payment_failed":
            await db.payment_transactions.update_one({"session_id": obj["id"]}, {"$set": {"status": "failed", "payment_status": "failed", "updated_at": now}})
        elif t == "checkout.session.expired":
            await db.payment_transactions.update_one({"session_id": obj["id"], "payment_status": {"$ne": "paid"}}, {"$set": {"status": "expired", "payment_status": "expired", "updated_at": now}})
        elif t == "charge.refunded":
            await db.payment_transactions.update_one({"stripe_payment_intent_id": obj.get("payment_intent")}, {"$set": {"status": "refunded", "payment_status": "refunded", "updated_at": now}})
        return {"status": "ok"}

    return router
