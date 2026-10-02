"""Out/2026 · PDF "Resumo de Mão de Obra — Medição" (modelo do fiscal): itens agrupados por categoria com código, descrição,
UM, preço unitário, quantidade e valor; subtotal por grupo; quadro FECHAMENTO; dados da obra; assinaturas Hayah / Fiscal."""
import io
from datetime import datetime, timezone, timedelta

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle, KeepTogether

NAVY = colors.HexColor("#1F3864")
NAVY_SOFT = colors.HexColor("#2E4A7F")
GROUP_BG = colors.HexColor("#DDE3EE")
CODE_BG = colors.HexColor("#FFF4C2")
ZEBRA = colors.HexColor("#F6F8FB")
LINE = colors.HexColor("#C9D1DE")
MUTED = colors.HexColor("#6B7280")
INK = colors.HexColor("#111827")
ACCENT = colors.HexColor("#B8CC00")
NO_GROUP = "OUTROS SERVIÇOS"

TYPE_LABEL = {"anexo_iv": "Anexo IV", "anexo_iv_ligacao_nova": "Anexo IV · Ligação Nova", "anexo_iv_obra": "Anexo IV · Obra",
              "manutencao": "Manutenção", "lpt": "LPT", "emergencial": "Emergencial", "ligacao_nova": "Ligação Nova", "pequenas_obras": "Pequenas Obras"}


def _brl(v):
    return "R$ " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _num(v):
    return f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _dt(s):
    s = (s or "")[:10]
    return "/".join(reversed(s.split("-"))) if s else "—"


def _now_br():
    return datetime.now(timezone(timedelta(hours=-4))).strftime("%d/%m/%Y %H:%M")


def group_items(items: list, groups_by_key: dict) -> list:
    """[{name, items, qty, total}] na ordem de aparição; grupo vem da linha ou do catálogo (catalog_id / código)."""
    out, idx = [], {}
    for it in items or []:
        g = (it.get("group") or groups_by_key.get(it.get("catalog_id") or "") or groups_by_key.get(("code", (it.get("code") or "").strip())) or NO_GROUP).strip().upper() or NO_GROUP
        if g not in idx:
            idx[g] = len(out)
            out.append({"name": g, "items": [], "qty": 0.0, "total": 0.0})
        grp = out[idx[g]]
        grp["items"].append(it)
        grp["qty"] += float(it.get("qty") or 0)
        grp["total"] += float(it.get("total") or 0)
    return out


def build_medicao_pdf(project: dict, items: list, groups: list, company: dict, logo_bytes, meta: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=30 * mm, bottomMargin=18 * mm,
                            title=f"Medição de Mão de Obra — {project.get('project_code') or project.get('name', '')}", author=company.get("name", "HAYAH ENERGY"))
    W = A4[0] - 24 * mm
    st_cell = ParagraphStyle("c", fontName="Helvetica", fontSize=7.4, leading=8.6, textColor=INK)
    st_cell_c = ParagraphStyle("cc", parent=st_cell, alignment=TA_CENTER)
    st_cell_r = ParagraphStyle("cr", parent=st_cell, alignment=TA_RIGHT)
    st_head = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=7.2, leading=8.4, textColor=colors.white, alignment=TA_CENTER)
    st_group = ParagraphStyle("g", fontName="Helvetica-Bold", fontSize=7.6, leading=9, textColor=NAVY)
    st_small = ParagraphStyle("s", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=MUTED)
    st_info_lbl = ParagraphStyle("il", fontName="Helvetica-Bold", fontSize=6.6, leading=8, textColor=MUTED)
    st_info_val = ParagraphStyle("iv", fontName="Helvetica-Bold", fontSize=8.6, leading=10.5, textColor=INK)
    st_sig = ParagraphStyle("sig", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=INK, alignment=TA_CENTER)

    total_qty = sum(float(i.get("qty") or 0) for i in items)
    total_val = sum(float(i.get("total") or 0) for i in items)
    accumulated = meta.get("accumulated")
    med_label = f"MEDIÇÃO Nº {meta['number']}" if meta.get("number") else "MEDIÇÃO"
    story = []

    # ── Quadro da obra + FECHAMENTO (como no modelo)
    fiscais = ", ".join(f"{f.get('name') or ''}".strip() or (f.get("email") or "") for f in (project.get("fiscais") or [])) or "—"
    info = [
        [Paragraph("OBRA / PROJETO", st_info_lbl), Paragraph("CÓDIGO", st_info_lbl), Paragraph("TIPO", st_info_lbl), Paragraph("EQUIPE", st_info_lbl)],
        [Paragraph(project.get("name") or "—", st_info_val), Paragraph(project.get("project_code") or "—", st_info_val),
         Paragraph(TYPE_LABEL.get(project.get("project_type") or "", project.get("project_type") or "—"), st_info_val), Paragraph(project.get("team_name") or "—", st_info_val)],
        [Paragraph("LOCAL", st_info_lbl), Paragraph("PERÍODO DA MEDIÇÃO", st_info_lbl), Paragraph("Nº MEDIÇÃO", st_info_lbl), Paragraph("FISCAL(IS) DA OBRA", st_info_lbl)],
        [Paragraph(project.get("location") or "—", st_info_val), Paragraph(meta.get("period") or _dt(meta.get("closed_at") or project.get("medicao_applied_at")), st_info_val),
         Paragraph((f"{meta['number']}ª" if meta.get("number") else "EM ABERTO") + (" · em aberto" if meta.get("draft") else "") + (" · " + _dt(meta["closed_at"]) if meta.get("closed_at") else ""), st_info_val), Paragraph(fiscais, st_info_val)],
    ]
    info_w = W * 0.66
    info_t = Table(info, colWidths=[info_w * 0.30, info_w * 0.26, info_w * 0.18, info_w * 0.26])
    info_t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, NAVY), ("INNERGRID", (0, 0), (-1, -1), 0.3, LINE),
        ("BACKGROUND", (0, 0), (-1, 0), ZEBRA), ("BACKGROUND", (0, 2), (-1, 2), ZEBRA),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5), ("LEFTPADDING", (0, 0), (-1, -1), 4),
    ]))
    fw = W * 0.34 - 2
    fech_rows = [[Paragraph("FECHAMENTO" + (f" · {med_label}" if meta.get("number") else ""), ParagraphStyle("f", parent=st_head, fontSize=8.5))],
                 [Table([[Paragraph("QUANT. TOTAL", st_info_lbl), Paragraph("VALOR DESTA MEDIÇÃO" if accumulated is not None else "VALOR TOTAL", st_info_lbl)],
                         [Paragraph(_num(total_qty), ParagraphStyle("q", parent=st_info_val, fontSize=11, alignment=TA_CENTER)),
                          Paragraph(_brl(total_val), ParagraphStyle("v", parent=st_info_val, fontSize=11, alignment=TA_CENTER, textColor=NAVY))]],
                        colWidths=[fw * 0.42, fw * 0.58],
                        style=TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("LINEAFTER", (0, 0), (0, -1), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))]]
    if accumulated is not None:
        fech_rows.append([Table([[Paragraph("ACUMULADO DA OBRA", st_info_lbl), Paragraph(_brl(accumulated), ParagraphStyle("acc", parent=st_info_val, fontSize=9.5, alignment=TA_RIGHT, textColor=NAVY))]],
                                colWidths=[fw * 0.5, fw * 0.5], style=TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.3, LINE), ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))])
    fech_rows.append([Paragraph(f"{len(items)} item(ns) · {len(groups)} grupo(s)", ParagraphStyle("n", parent=st_small, alignment=TA_CENTER, fontSize=6.8))])
    fech = Table(fech_rows, colWidths=[fw])
    fech.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, NAVY), ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                              ("TOPPADDING", (0, 0), (-1, 0), 3), ("BOTTOMPADDING", (0, 0), (-1, 0), 3), ("TOPPADDING", (0, 1), (-1, -1), 1), ("BOTTOMPADDING", (0, 1), (-1, -1), 2)]))
    top = Table([[info_t, fech]], colWidths=[info_w, W - info_w], style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LEFTPADDING", (1, 0), (1, 0), 2)]))
    story += [top, Spacer(1, 4 * mm)]

    # ── Tabela principal
    cw = [W * 0.085, W * 0.455, W * 0.08, W * 0.12, W * 0.1, W * 0.16]
    rows = [[Paragraph("CÓDIGO", st_head), Paragraph("DESCRIÇÃO DO SERVIÇO", st_head), Paragraph("UM", st_head), Paragraph("R$ UNIT.", st_head), Paragraph("QUANT.", st_head), Paragraph("VALOR TOTAL", st_head)]]
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, NAVY), ("BOX", (0, 0), (-1, -1), 0.6, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 2.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
    ]
    r = 1
    for g in groups:
        rows.append([Paragraph(g["name"], st_group), "", "", "", Paragraph(_num(g["qty"]), ParagraphStyle("gq", parent=st_group, alignment=TA_RIGHT)), Paragraph(_brl(g["total"]), ParagraphStyle("gt", parent=st_group, alignment=TA_RIGHT))])
        style += [("SPAN", (0, r), (3, r)), ("BACKGROUND", (0, r), (-1, r), GROUP_BG), ("LINEABOVE", (0, r), (-1, r), 0.5, NAVY_SOFT)]
        r += 1
        for k, it in enumerate(g["items"]):
            rows.append([Paragraph(it.get("code") or "—", st_cell_c), Paragraph((it.get("description") or "").upper(), st_cell), Paragraph(it.get("unit") or "UN", st_cell_c),
                         Paragraph(_brl(it.get("unit_price")), st_cell_r), Paragraph(_num(it.get("qty")), st_cell_r), Paragraph(_brl(it.get("total")), st_cell_r)])
            style += [("BACKGROUND", (0, r), (0, r), CODE_BG), ("LINEBELOW", (0, r), (-1, r), 0.25, LINE)]
            if k % 2:
                style.append(("BACKGROUND", (1, r), (-1, r), ZEBRA))
            r += 1
    rows.append([Paragraph("TOTAL GERAL DA MEDIÇÃO", ParagraphStyle("tg", parent=st_head, alignment=TA_LEFT, fontSize=8)), "", "", "",
                 Paragraph(_num(total_qty), ParagraphStyle("tq", parent=st_head, alignment=TA_RIGHT, fontSize=8)), Paragraph(_brl(total_val), ParagraphStyle("tv", parent=st_head, alignment=TA_RIGHT, fontSize=8.4))])
    style += [("SPAN", (0, r), (3, r)), ("BACKGROUND", (0, r), (-1, r), NAVY), ("TOPPADDING", (0, r), (-1, r), 4), ("BOTTOMPADDING", (0, r), (-1, r), 4)]
    t = Table(rows, colWidths=cw, repeatRows=1)
    t.setStyle(TableStyle(style))
    story.append(t)

    if not items:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph("Nenhum serviço medido lançado para esta obra.", st_small))

    # ── Observações + assinaturas
    story.append(Spacer(1, 5 * mm))
    if meta.get("notes"):
        story.append(Paragraph("<b>Observações:</b> " + meta["notes"].replace("\n", "<br/>"), ParagraphStyle("obs", parent=st_small, textColor=INK)))
        story.append(Spacer(1, 4 * mm))
    resp = company.get("responsible_name") or project.get("medicao_applied_by") or ""
    sig = Table([
        ["", "", ""],
        [Paragraph(f"<b>{company.get('name', 'HAYAH ENERGY')}</b><br/>{resp}<br/>{company.get('responsible_title') or 'Responsável pela medição'}", st_sig), "",
         Paragraph("<b>FISCAL DA OBRA</b><br/>" + (fiscais if fiscais != "—" else "Nome / Matrícula") + "<br/>De acordo", st_sig)],
    ], colWidths=[W * 0.42, W * 0.16, W * 0.42], rowHeights=[14 * mm, None])
    sig.setStyle(TableStyle([("LINEBELOW", (0, 0), (0, 0), 0.7, INK), ("LINEBELOW", (2, 0), (2, 0), 0.7, INK), ("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("TOPPADDING", (0, 1), (-1, 1), 3)]))
    story.append(KeepTogether([Paragraph(f"Cuiabá/MT, {_now_br()[:10]}", ParagraphStyle("dt", parent=st_small, alignment=TA_RIGHT)), Spacer(1, 2 * mm), sig]))

    logo = None
    if logo_bytes:
        try:
            logo = ImageReader(io.BytesIO(logo_bytes))
            logo.getSize()
        except Exception:  # noqa: BLE001
            logo = None

    def decor(canvas, d):
        canvas.saveState()
        w, h = A4
        canvas.setFillColor(NAVY)
        canvas.rect(0, h - 22 * mm, w, 22 * mm, stroke=0, fill=1)
        canvas.setFillColor(ACCENT)
        canvas.rect(0, h - 23 * mm, w, 1 * mm, stroke=0, fill=1)
        x = 12 * mm
        if logo:
            try:
                iw, ih = logo.getSize()
                lh = 14 * mm
                lw = min(lh * iw / ih, 48 * mm)
                lh = lw * ih / iw
                canvas.drawImage(logo, x, h - 22 * mm + (22 * mm - lh) / 2, width=lw, height=lh, mask="auto")
                x += lw + 5 * mm
            except Exception:  # noqa: BLE001
                pass
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 14)
        canvas.drawString(x, h - 11 * mm, "RESUMO DE MÃO DE OBRA")
        canvas.setFont("Helvetica", 8.5)
        sub = f"{med_label}" + (f" · {meta['period']}" if meta.get("period") else "") + f" · {company.get('name', 'HAYAH ENERGY')}"
        canvas.drawString(x, h - 16.5 * mm, sub)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawRightString(w - 12 * mm, h - 10 * mm, project.get("project_code") or "")
        canvas.setFont("Helvetica", 7.5)
        canvas.drawRightString(w - 12 * mm, h - 15 * mm, f"Emitido em {_now_br()}")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(12 * mm, 13 * mm, w - 12 * mm, 13 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7)
        foot = " · ".join(x for x in [company.get("legal_name") or company.get("name"), f"CNPJ {company['cnpj']}" if company.get("cnpj") else "", company.get("phone"), company.get("email"), company.get("city")] if x)
        canvas.drawString(12 * mm, 9 * mm, foot[:150])
        canvas.drawRightString(w - 12 * mm, 9 * mm, f"Página {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=decor, onLaterPages=decor)
    return buf.getvalue()


def medicao_email_html(project: dict, groups: list, total_qty: float, total_val: float, company: dict, message: str, logo_url: str = "", meta: dict | None = None) -> str:
    meta = meta or {}
    med_title = f"Medição nº {meta['number']}" if meta.get("number") else "Medição de Mão de Obra"
    period_html = f"<div style='font-size:12px;margin-top:2px;opacity:.9'>Período: {meta['period']}</div>" if meta.get("period") else ""
    acc_html = (f"<tr style='background:#f3f4f6'><td style='padding:7px 8px;font-size:11px;color:#374151' colspan='3'>Acumulado da obra (medições fechadas)</td>"
                f"<td style='padding:7px 8px;text-align:right;font-weight:bold;font-size:12px;color:#1F3864'>{_brl(meta['accumulated'])}</td></tr>") if meta.get("accumulated") is not None else ""
    rows = "".join(
        f"<tr><td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px'>{g['name']}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right'>{len(g['items'])}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right'>{_num(g['qty'])}</td>"
        f"<td style='padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;font-weight:bold'>{_brl(g['total'])}</td></tr>"
        for g in groups)
    msg_html = (message or "").replace("\n", "<br/>")
    logo_html = f"<img src='{logo_url}' alt='' style='max-height:44px;max-width:180px;display:block;margin-bottom:8px'/>" if logo_url else ""
    return f"""
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:0 auto;color:#111827;background:#ffffff">
      <div style="background:#1F3864;color:#fff;padding:18px 22px;border-bottom:4px solid #B8CC00">
        {logo_html}
        <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;opacity:.85">{company.get('name', 'HAYAH ENERGY')}</div>
        <div style="font-size:20px;font-weight:bold;margin-top:4px">{med_title}</div>
        <div style="font-size:13px;margin-top:2px">{project.get('project_code') or ''} · {project.get('name') or ''}</div>
        {period_html}
      </div>
      <div style="padding:20px 22px">
        <p style="font-size:14px;line-height:1.5;margin:0 0 14px">{msg_html}</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb">
          <thead><tr style="background:#f3f4f6">
            <th style="text-align:left;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#6b7280">Grupo</th>
            <th style="text-align:right;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#6b7280">Itens</th>
            <th style="text-align:right;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#6b7280">Quant.</th>
            <th style="text-align:right;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#6b7280">Valor</th>
          </tr></thead>
          <tbody>{rows}</tbody>
          <tfoot><tr style="background:#1F3864;color:#fff">
            <td style="padding:8px;font-weight:bold;font-size:12px" colspan="2">TOTAL {('DA ' + med_title.upper()) if meta.get('number') else 'DA MEDIÇÃO'}</td>
            <td style="padding:8px;text-align:right;font-weight:bold;font-size:12px">{_num(total_qty)}</td>
            <td style="padding:8px;text-align:right;font-weight:bold;font-size:13px">{_brl(total_val)}</td>
          </tr>{acc_html}</tfoot>
        </table>
        <p style="font-size:12px;color:#6b7280;margin:14px 0 0">O resumo completo (por serviço, código e preço unitário) segue em anexo em PDF.</p>
        <p style="font-size:13px;margin:18px 0 0;line-height:1.5">Atenciosamente,<br/><b>{company.get('responsible_name') or company.get('name', 'HAYAH ENERGY')}</b><br/>
          <span style="color:#6b7280">{company.get('responsible_title') or company.get('name', '')}{' · ' + company['responsible_phone'] if company.get('responsible_phone') else ''}{' · ' + company['email'] if company.get('email') else ''}</span></p>
      </div>
      <div style="padding:10px 22px;background:#f9fafb;color:#9ca3af;font-size:10px;border-top:1px solid #e5e7eb">
        {company.get('legal_name') or company.get('name', '')}{' · CNPJ ' + company['cnpj'] if company.get('cnpj') else ''}{' · ' + company['city'] if company.get('city') else ''}
      </div>
    </div>"""
