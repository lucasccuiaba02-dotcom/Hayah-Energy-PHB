"""Verifies Resend is ACTIVE (not skipped) — sends to delivered@resend.dev which is
the special Resend test recipient. Returns status='sent' with an 'id'."""
import asyncio
import os
import sys
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
sys.path.insert(0, '/app/backend')

from server import send_email_via_resend  # noqa: E402


def test_resend_key_present():
    assert os.environ.get("RESEND_API_KEY", "").startswith("re_"), "RESEND_API_KEY missing or invalid"


def test_resend_sends_to_delivered_recipient():
    result = asyncio.run(send_email_via_resend(
        ["delivered@resend.dev"],
        "[HAYAH TEST] iteration_16 smoke",
        "<p>Automated test — safe to ignore</p>",
    ))
    assert result["status"] == "sent", f"Expected sent, got {result}"
    assert result.get("id"), f"Missing id in response: {result}"
