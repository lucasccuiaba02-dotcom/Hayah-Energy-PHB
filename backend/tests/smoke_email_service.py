"""Smoke: anexos → links públicos, gate de segurança, lembrete de licença (roda com o .env do backend)."""
import asyncio
import os
import sys

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")
import httpx  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import email_service as es  # noqa: E402
import licenca  # noqa: E402

APP_URL = os.environ["FRONTEND_URL"].strip('"')


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    from server import storage_put  # noqa: E402

    # 1) gate
    for subj, html, expect in [
        ("ok", "<p>oi</p><a href='https://x.com/a'>x.com</a>", True),
        ("form", "<form><input/></form>", False),
        ("http", "<a href='http://x.com'>x</a>", False),
        ("cred", "<p>reply with your password</p>", False),
    ]:
        try:
            es._assert_safe_email(subj, html)
            ok = True
        except ValueError:
            ok = False
        print("gate", subj, "PASS" if ok == expect else "FAIL")

    # 2) anexo → link
    links = await es.attachments_to_links(db, storage_put, APP_URL, [{"filename": "teste requisição.pdf", "content": list(b"%PDF-1.4 teste")}], "hayah-energy")
    print("links", links)
    assert links and links[0]["url"].startswith("https://")
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(links[0]["url"])
        print("download", r.status_code, r.headers.get("content-type"), r.headers.get("content-disposition"), r.content[:12])
        r2 = await c.get(links[0]["url"].rsplit("/", 1)[0] + "/tokeninvalido")
        print("invalid token", r2.status_code)
    html = "<p>corpo</p>" + es.links_html(links)
    es._assert_safe_email("x", html)
    print("links_html passes gate PASS")

    # 3) lembrete de licença (sem alterar o estado real): simula status
    st = licenca.status_of({"enabled": True, "paid_until": "2026-10-09", "valor": 490, "ciclo_dias": 30, "empresa": "Empresa Teste"})
    html = licenca.reminder_html(st, APP_URL, "Hayah Energy")
    es._assert_safe_email("lembrete", html)
    print("reminder html passes gate PASS · days_left", st["days_left"], "warning", st["warning"])
    await db.email_files.delete_many({"filename": "teste requisição.pdf"})


asyncio.run(main())
