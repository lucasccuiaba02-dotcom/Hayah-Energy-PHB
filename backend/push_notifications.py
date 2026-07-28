"""Web Push (VAPID) helpers for Hayah Energy PWA."""
import os
import json
import base64
import logging
from typing import List, Dict
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid
from pywebpush import webpush, WebPushException

logger = logging.getLogger(__name__)

VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@hayahenergy.com.br")


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


async def ensure_vapid_keys(db) -> Dict[str, str]:
    """Fetch or generate the VAPID keypair once and store in Mongo `settings`."""
    doc = await db.settings.find_one({"_id": "vapid"})
    if doc and doc.get("private_pem") and doc.get("public_b64u"):
        return doc

    priv = ec.generate_private_key(ec.SECP256R1())
    private_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    pub_numbers = priv.public_key().public_numbers()
    raw = b"\x04" + pub_numbers.x.to_bytes(32, "big") + pub_numbers.y.to_bytes(32, "big")
    public_b64u = _b64u(raw)

    payload = {"_id": "vapid", "private_pem": private_pem, "public_b64u": public_b64u}
    await db.settings.replace_one({"_id": "vapid"}, payload, upsert=True)
    return payload


def send_push(subscription: dict, payload: dict, private_pem: str) -> bool:
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload),
            vapid_private_key=private_pem,
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=3600,
        )
        return True
    except WebPushException as e:
        logger.warning(f"WebPush failed: {e}")
        return False
    except Exception as e:
        logger.error(f"WebPush error: {e}")
        return False


async def broadcast_push(db, payload: dict) -> Dict[str, int]:
    """Send push to all stored subscriptions. Cleans expired/gone ones."""
    keys = await ensure_vapid_keys(db)
    priv = keys["private_pem"]
    subs = await db.push_subscriptions.find({}).to_list(1000)
    sent = 0
    removed = 0
    for s in subs:
        sub_info = s.get("subscription")
        if not sub_info:
            continue
        ok = send_push(sub_info, payload, priv)
        if ok:
            sent += 1
        else:
            await db.push_subscriptions.delete_one({"_id": s["_id"]})
            removed += 1
    logger.info(f"Broadcast push: sent={sent} removed={removed} total={len(subs)}")
    return {"sent": sent, "removed": removed, "total": len(subs)}
