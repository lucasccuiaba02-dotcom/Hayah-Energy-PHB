"""Out/2026 · E-mail transacional via proxy gerenciado da Emergent (sem conta Resend própria).
Anexos não são suportados pelo proxy → PDFs viram links seguros de download (token, expira em 30 dias)."""
import asyncio
import ipaddress
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
from typing import List, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from branding_cache import brand_name

logger = logging.getLogger(__name__)

# Proxy da Emergent — constante (não vem do ambiente para sobreviver ao deploy)
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO", "")
LINK_TTL_DAYS = 30
_SEND_GAP_S = 2.5  # o proxy devolve 429 em rajadas (≥2 envios em ~2 s) → serializa os envios
_send_lock = None
_last_send_at = 0.0

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    """Gate estrutural (G2/G3): sem formulários, sem pedir credenciais, só links https do próprio app."""
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} ≠ real link host {real!r} (G3)")


def email_ready() -> bool:
    return bool(EMAIL_KEY)


def sender_name() -> str:
    return brand_name() or EMAIL_FROM_NAME


async def send_email(*, to: List[str], subject: str, html: str, reply_to: Optional[str] = None) -> dict:
    """Envia pelo proxy. Retorna {status: sent|error|skipped, id?, error?, to}. Nunca levanta exceção."""
    to = [t.strip() for t in (to or []) if t and t.strip()]
    if not EMAIL_KEY:
        logger.warning(f"[EMAIL SKIPPED - sem EMERGENT_EMAIL_KEY] To={to} Subject={subject}")
        return {"status": "skipped", "reason": "no_api_key", "to": to}
    if not to:
        return {"status": "skipped", "reason": "no_recipients", "to": to}
    try:
        _assert_safe_email(subject, html)
    except ValueError as e:
        logger.error(f"email gate: {e}")
        return {"status": "error", "error": str(e), "to": to}
    payload = {"to": to, "subject": subject, "html": html, "from_name": sender_name()}
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    global _send_lock, _last_send_at
    if _send_lock is None:
        _send_lock = asyncio.Lock()
    try:
        async with _send_lock:
            wait = _SEND_GAP_S - (time.monotonic() - _last_send_at)
            if wait > 0:
                await asyncio.sleep(wait)
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json=payload)
            _last_send_at = time.monotonic()
        resp.raise_for_status()
        mid = (resp.json() or {}).get("id")
        logger.info(f"Email sent to {to}: id={mid}")
        return {"status": "sent", "id": mid, "to": to}
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text[:300]}")
        return {"status": "error", "error": f"proxy {e.response.status_code}: {e.response.text[:200]}", "to": to}
    except Exception as e:  # noqa: BLE001
        logger.error(f"Email send error: {e}")
        return {"status": "error", "error": str(e)[:300], "to": to}


# ---------------------------------------------------------------- anexos → links seguros
def _to_bytes(content) -> bytes:
    if isinstance(content, (bytes, bytearray)):
        return bytes(content)
    if isinstance(content, str):
        import base64
        return base64.b64decode(content)
    return bytes(content)


async def attachments_to_links(db, storage_put, app_url: str, attachments: list, app_name: str) -> List[dict]:
    """Grava cada anexo no Object Storage e devolve [{filename, url, size}] com link público por token."""
    out = []
    base = (app_url or "").rstrip("/")
    if not base.startswith("https://"):
        logger.warning(f"email links: FRONTEND_URL não é https ({app_url!r}) — anexos omitidos")
        return out
    now = datetime.now(timezone.utc)
    for a in attachments or []:
        try:
            data = _to_bytes(a.get("content"))
            filename = (a.get("filename") or "documento.pdf")[:120]
            ct = a.get("content_type") or ("application/pdf" if filename.lower().endswith(".pdf") else "application/octet-stream")
            token = secrets.token_urlsafe(24)
            path = f"{app_name}/email-files/{token}"
            await storage_put(path, data, ct)
            await db.email_files.insert_one({"token": token, "filename": filename, "storage_path": path, "content_type": ct, "size": len(data),
                                             "created_at": now.isoformat(), "expires_at": (now + timedelta(days=LINK_TTL_DAYS)).isoformat(), "downloads": 0})
            out.append({"filename": filename, "url": f"{base}/api/public/files/{token}", "size": len(data)})
        except Exception as e:  # noqa: BLE001
            logger.warning(f"email attachment → link failed: {e}")
    return out


def links_html(links: List[dict]) -> str:
    if not links:
        return ""
    items = "".join(
        f"<li style='margin:6px 0'><a href='{l['url']}' style='color:#00F0FF;font-weight:bold'>{escape(l['filename'])}</a>"
        f" <span style='color:#71717a;font-size:11px'>({max(1, l.get('size', 0) // 1024)} KB)</span></li>" for l in links)
    return (f"<div style='margin-top:20px;padding:14px;border:1px solid #333;border-radius:8px;background:#0f0f10'>"
            f"<p style='margin:0 0 6px;color:#E0FF00;font-size:12px;font-weight:bold;letter-spacing:.08em'>DOCUMENTOS (LINKS SEGUROS)</p>"
            f"<ul style='margin:0;padding-left:18px;color:#fff;font-size:13px'>{items}</ul>"
            f"<p style='margin:8px 0 0;color:#71717a;font-size:10px'>Links válidos por {LINK_TTL_DAYS} dias. Enviado por {escape(sender_name())}.</p></div>")


def build_public_router(db, storage_get) -> APIRouter:
    router = APIRouter(prefix="/api/public")

    @router.get("/files/{token}")
    async def public_file(token: str):
        rec = await db.email_files.find_one({"token": token})
        if not rec:
            raise HTTPException(status_code=404, detail="Arquivo não encontrado")
        if rec.get("expires_at", "") < datetime.now(timezone.utc).isoformat():
            raise HTTPException(status_code=410, detail="Link expirado")
        try:
            data, ct = await storage_get(rec["storage_path"])
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Falha ao obter arquivo: {e}")
        await db.email_files.update_one({"token": token}, {"$inc": {"downloads": 1}})
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", rec.get("filename") or "documento.pdf")
        return Response(content=data, media_type=rec.get("content_type") or ct or "application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="{safe}"', "Cache-Control": "private, max-age=0"})

    return router
