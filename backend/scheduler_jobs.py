"""Scheduler cron job definitions extracted from server.py.

These functions receive `db`, `logger`, `send_email_via_resend`, `broadcast_push`
via a small `context` dict to keep imports clean while allowing testing.
"""
import os
from datetime import datetime, timezone, timedelta


def _fmt_row(p: dict) -> str:
    return f"""
    <tr>
      <td style="padding:10px;border-bottom:1px solid #333;color:#fff;">{p.get('project_code','') or '-'}</td>
      <td style="padding:10px;border-bottom:1px solid #333;color:#fff;">{p.get('name','')}</td>
      <td style="padding:10px;border-bottom:1px solid #333;color:#a1a1aa;">{p.get('team_name','') or '-'}</td>
      <td style="padding:10px;border-bottom:1px solid #333;color:#a1a1aa;">{p.get('location','') or '-'}</td>
      <td style="padding:10px;border-bottom:1px solid #333;color:#FF5E00;">{(p.get('start_date') or '')[:10]}</td>
    </tr>
    """


def build_anexo_iv_html(target: str, projects: list) -> str:
    rows = "".join(_fmt_row(p) for p in projects)
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;background:#050505;color:#fff;padding:24px;">
      <h1 style="color:#E0FF00;margin:0;">HAYAH ENERGY</h1>
      <h2 style="color:#FF5E00;margin:8px 0 16px;">⚠️ LEMBRETE ANEXO IV — 2 DIAS ATÉ EXECUÇÃO ({target})</h2>
      <p style="color:#a1a1aa;font-size:13px;">Garanta equipe, acesso ao local e materiais para as obras abaixo:</p>
      <table width="100%" style="border-collapse:collapse;margin-top:12px;">
        <thead><tr style="background:#111;">
          <th style="padding:10px;color:#E0FF00;text-align:left;">Código</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Obra</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Equipe</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Localidade</th>
          <th style="padding:10px;color:#E0FF00;text-align:left;">Início</th>
        </tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="color:#71717a;font-size:11px;margin-top:24px;">Sistema Hayah — Lembrete automático D-2 para Anexo IV.</p>
    </div>"""


def anexo_iv_recipients() -> list:
    raw = os.environ.get("NOTIFICATION_EMAILS", "")
    return [e.strip() for e in raw.split(",") if e.strip()]


def target_date_d2() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
