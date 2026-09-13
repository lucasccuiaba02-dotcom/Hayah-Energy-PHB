"""Fev/2026 · Gerador do PDF da APR (Análise Preliminar de Risco).
Layout profissional para impressão A4 — estilo engenharia elétrica.
Checkboxes selecionados destacados com fundo colorido (não só ☒).
Resposta Sim/Não/N.A com célula colorida sólida (verde/vermelho/amarelo).
"""
import io
import base64
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)
from apr_pdf_constants import EPI_ITEMS, EPC_ITEMS, RISK_ITEMS, PROCEDIMENTOS

BLACK = colors.HexColor("#111827")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
LIGHT = colors.HexColor("#f3f4f6")
BORDER = colors.HexColor("#9ca3af")
HEADER_BG = colors.HexColor("#0f172a")
YELLOW_HL = colors.HexColor("#fde68a")
GREEN_HL = colors.HexColor("#bbf7d0")
GREEN_DK = colors.HexColor("#065f46")
RED_HL = colors.HexColor("#fecaca")
RED_DK = colors.HexColor("#991b1b")
AMBER_HL = colors.HexColor("#fef3c7")
AMBER_DK = colors.HexColor("#92400e")
LIVE_RED = colors.HexColor("#dc2626")
DEAD_GREEN = colors.HexColor("#059669")


def _styles():
    return {
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=13, alignment=1, textColor=colors.white, leading=15),
        "sub": ParagraphStyle("s", fontName="Helvetica", fontSize=8, alignment=1, textColor=colors.white, leading=10),
        "sec": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white, alignment=0, leading=10),
        "cell": ParagraphStyle("c", fontName="Helvetica", fontSize=8, textColor=INK, leading=10),
        "cellb": ParagraphStyle("cb", fontName="Helvetica-Bold", fontSize=8, textColor=INK, leading=10),
        "small": ParagraphStyle("sm", fontName="Helvetica", fontSize=7, textColor=INK, leading=8.5),
        "footer": ParagraphStyle("f", fontName="Helvetica-Oblique", fontSize=6.5, textColor=MUTED),
    }


def _sig_img(data_url: str, w_mm=45, h_mm=15):
    if not data_url or "," not in data_url:
        return ""
    try:
        _, b64 = data_url.split(",", 1)
        img = Image(io.BytesIO(base64.b64decode(b64)), width=w_mm * mm, height=h_mm * mm)
        img.hAlign = "CENTER"
        return img
    except Exception:
        return ""


def build_apr_pdf(apr: dict, project: dict, team: dict | None = None) -> bytes:
    S = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=8 * mm, bottomMargin=12 * mm,
        title=f"APR {apr.get('os_number', '')}",
    )
    story = []
    H = apr.get("header", {}) or {}
    line_type = apr.get("line_type", "morta")
    is_live = line_type == "viva"
    line_color = LIVE_RED if is_live else DEAD_GREEN

    # ── Cabeçalho principal ─────────────────────────────────────────────────
    header_left = [
        [Paragraph("<b>HAYAH ENERGY</b>", ParagraphStyle("l", fontName="Helvetica-Bold", fontSize=14, textColor=colors.white, alignment=0))],
        [Paragraph("ANÁLISE PRELIMINAR DE RISCO — SERVIÇOS EM REDE DE DISTRIBUIÇÃO", S["sub"])],
        [Paragraph(f"Documento nº <b>APR-{apr.get('os_number','') or '________'}</b> · Rev. 01 · Fev/2026", S["sub"])],
    ]
    tl = Table(header_left, colWidths=[135 * mm])
    tl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    tr = Table([[Paragraph(f"<b>LINHA<br/>{'VIVA' if is_live else 'MORTA'}</b>",
                            ParagraphStyle("lt", fontName="Helvetica-Bold", fontSize=15, alignment=1, textColor=colors.white, leading=17))]],
               colWidths=[55 * mm], rowHeights=[24 * mm])
    tr.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), line_color),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("BOX", (0, 0), (-1, -1), 1.2, colors.white),
    ]))
    story.append(Table([[tl, tr]], colWidths=[135 * mm, 55 * mm],
                       style=TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("BOX", (0, 0), (-1, -1), 1.0, BLACK)])))
    story.append(Spacer(1, 3 * mm))

    # ── Identificação ───────────────────────────────────────────────────────
    ident_rows = [
        [Paragraph("<b>Data</b>", S["cellb"]), Paragraph(H.get("date", ""), S["cell"]),
         Paragraph("<b>OS Nº</b>", S["cellb"]), Paragraph(H.get("os_number", "") or apr.get("os_number", ""), S["cell"])],
        [Paragraph("<b>Tarefa</b>", S["cellb"]), Paragraph(H.get("task", ""), S["cell"]),
         Paragraph("<b>Área</b>", S["cellb"]), Paragraph(H.get("area", "Rural"), S["cell"])],
        [Paragraph("<b>Nº Equipe</b>", S["cellb"]), Paragraph(H.get("team_number", "") or (team.get("name") if team else ""), S["cell"]),
         Paragraph("<b>Local</b>", S["cellb"]), Paragraph(H.get("location", "") or project.get("location", ""), S["cell"])],
        [Paragraph("<b>Nº profissionais</b>", S["cellb"]), Paragraph(str(H.get("professionals_count", "")), S["cell"]),
         Paragraph("<b>Empresa</b>", S["cellb"]), Paragraph(H.get("company", "HAYAH ENERGY"), S["cell"])],
    ]
    t = Table(ident_rows, colWidths=[35 * mm, 62 * mm, 25 * mm, 68 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT), ("BACKGROUND", (2, 0), (2, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── EPIs + EPCs em 2 colunas ────────────────────────────────────────────
    def _checklist_cell(k, lbl, checked):
        if checked:
            return Paragraph(f'<b><font backColor="#065f46" color="white">&nbsp;✓&nbsp;</font> <b>{lbl}</b></b>', S["small"])
        return Paragraph(f'<font color="#6b7280">☐ {lbl}</font>', S["small"])

    epis = apr.get("epis", {}) or {}
    epcs = apr.get("epcs", {}) or {}

    def _column(items, dic):
        rows = []
        for k, lbl in items:
            rows.append([_checklist_cell(k, lbl, bool(dic.get(k)))])
        return rows

    epi_rows = _column(EPI_ITEMS, epis)
    epc_rows = _column(EPC_ITEMS, epcs)

    max_len = max(len(epi_rows), len(epc_rows))
    while len(epi_rows) < max_len:
        epi_rows.append([""])
    while len(epc_rows) < max_len:
        epc_rows.append([""])

    epi_col = Table(epi_rows, colWidths=[90 * mm])
    epi_col.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e5e7eb")),
    ]))
    epc_col = Table(epc_rows, colWidths=[90 * mm])
    epc_col.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -2), 0.25, colors.HexColor("#e5e7eb")),
    ]))

    epi_epc_hdr = [
        [Paragraph("EPI — EQUIPAMENTOS DE PROTEÇÃO INDIVIDUAL", S["sec"]),
         Paragraph("EPC / FERRAMENTAS COLETIVAS", S["sec"])],
        [epi_col, epc_col],
        [Paragraph(f"<b>Outros EPI:</b> {epis.get('outros', '') or '_' * 40}", S["small"]),
         Paragraph(f"<b>Outros:</b> {epcs.get('outros', '') or '_' * 40}", S["small"])],
    ]
    t = Table(epi_epc_hdr, colWidths=[95 * mm, 95 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, 0), 4), ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
        ("LEFTPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 2), (-1, 2), 4), ("BOTTOMPADDING", (0, 2), (-1, 2), 4),
        ("LEFTPADDING", (0, 2), (-1, 2), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── Riscos Potenciais ──────────────────────────────────────────────────
    riscos = apr.get("riscos", {}) or {}
    r_cells = [_checklist_cell(k, lbl, bool(riscos.get(k))) for k, lbl in RISK_ITEMS]
    while len(r_cells) % 3 != 0:
        r_cells.append("")
    risco_grid = [r_cells[i:i + 3] for i in range(0, len(r_cells), 3)]
    risco_data = [[Paragraph("RISCOS POTENCIAIS DA ATIVIDADE", S["sec"])] + [""] * 2]
    for row in risco_grid:
        risco_data.append(row)
    risco_data.append([Paragraph(f"<b>Outros riscos:</b> {riscos.get('outros', '') or '_' * 100}", S["small"])] + [""] * 2)
    t = Table(risco_data, colWidths=[63.3 * mm, 63.3 * mm, 63.3 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("SPAN", (0, 0), (2, 0)),
        ("SPAN", (0, -1), (2, -1)),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 1), (-1, -2), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── Procedimentos preliminares (checkbox destacado por cor) ─────────────
    proc = apr.get("procedimentos", {}) or {}
    proc_rows = [[Paragraph("PROCEDIMENTOS PRELIMINARES / MEDIDAS GERAIS DE CONTROLE", S["sec"]),
                  Paragraph("SIM", S["sec"]), Paragraph("NÃO", S["sec"]), Paragraph("N/A", S["sec"])]]
    styles_extra = []
    for idx, (k, q) in enumerate(PROCEDIMENTOS, start=1):
        v = (proc.get(k) or "").lower()
        row = [Paragraph(f"<b>{idx}.</b> {q}", S["small"]),
               Paragraph("<b>✓</b>" if v == "sim" else "", S["cellb"]),
               Paragraph("<b>✗</b>" if v == "nao" else "", S["cellb"]),
               Paragraph("<b>—</b>" if v == "na" else "", S["cellb"])]
        proc_rows.append(row)
        # célula colorida somente na coluna selecionada
        r_idx = idx
        if v == "sim":
            styles_extra.append(("BACKGROUND", (1, r_idx), (1, r_idx), GREEN_HL))
            styles_extra.append(("TEXTCOLOR", (1, r_idx), (1, r_idx), GREEN_DK))
        elif v == "nao":
            styles_extra.append(("BACKGROUND", (2, r_idx), (2, r_idx), RED_HL))
            styles_extra.append(("TEXTCOLOR", (2, r_idx), (2, r_idx), RED_DK))
        elif v == "na":
            styles_extra.append(("BACKGROUND", (3, r_idx), (3, r_idx), AMBER_HL))
            styles_extra.append(("TEXTCOLOR", (3, r_idx), (3, r_idx), AMBER_DK))
    t = Table(proc_rows, colWidths=[147 * mm, 14 * mm, 14 * mm, 15 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (0, -1), 6),
    ] + styles_extra))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── Medidas de controle não pré-identificadas ───────────────────────────
    extra_rows = apr.get("medidas_extra", []) or []
    mc = [[Paragraph("ETAPA DA ATIVIDADE", S["sec"]),
           Paragraph("RISCOS IDENTIFICADOS NO LOCAL", S["sec"]),
           Paragraph("MEDIDAS DE CONTROLE ADOTADAS", S["sec"])]]
    for r in extra_rows[:6]:
        mc.append([Paragraph(r.get("etapa", ""), S["small"]),
                   Paragraph(r.get("risco", ""), S["small"]),
                   Paragraph(r.get("medida", ""), S["small"])])
    while len(mc) < 5:
        mc.append([Paragraph("&nbsp;", S["small"])] * 3)
    t = Table(mc, colWidths=[55 * mm, 65 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── Observações ─────────────────────────────────────────────────────────
    obs_paragraphs = []
    for line in (apr.get("observacoes") or "").split("\n"):
        if line.strip():
            obs_paragraphs.append(Paragraph(line, S["small"]))
    obs_body = obs_paragraphs or [Paragraph("&nbsp;", S["small"])]
    obs_table = Table([[Paragraph("OBSERVAÇÕES GERAIS", S["sec"])], [obs_body]], colWidths=[190 * mm])
    obs_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), HEADER_BG),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("VALIGN", (0, 1), (-1, 1), "TOP"),
        ("TOPPADDING", (0, 1), (-1, 1), 8), ("BOTTOMPADDING", (0, 1), (-1, 1), 12),
        ("LEFTPADDING", (0, 1), (-1, 1), 8), ("RIGHTPADDING", (0, 1), (-1, 1), 8),
    ]))
    story.append(obs_table)
    story.append(Spacer(1, 4 * mm))

    # ── Bloco de assinaturas ────────────────────────────────────────────────
    sup = apr.get("supervisor", {}) or {}
    execs = apr.get("executores", []) or []
    sig_rows = [
        [Paragraph("FUNÇÃO", S["sec"]), Paragraph("MATRÍCULA", S["sec"]),
         Paragraph("NOME COMPLETO", S["sec"]), Paragraph("ASSINATURA", S["sec"])],
        [Paragraph("<b>Supervisor / Encarregado</b>", S["cellb"]),
         Paragraph(f"<b>{sup.get('matricula', '')}</b>", S["cellb"]),
         Paragraph(f"<b>{sup.get('nome', '').upper()}</b>", S["cellb"]),
         _sig_img(sup.get("assinatura", "")) or Paragraph("&nbsp;", S["cell"])],
    ]
    for i, ex in enumerate(execs[:8]):
        sig_rows.append([
            Paragraph(f"Executor / Eletricista {i + 1}", S["cell"]),
            Paragraph(ex.get("matricula", ""), S["cell"]),
            Paragraph((ex.get("nome", "") or "").upper(), S["cellb"]),
            _sig_img(ex.get("assinatura", "")) or Paragraph("&nbsp;", S["cell"]),
        ])
    while len(sig_rows) < 6:
        sig_rows.append([Paragraph(f"Executor {len(sig_rows) - 1}", S["cell"]), "", "", ""])
    t = Table(sig_rows, colWidths=[38 * mm, 22 * mm, 65 * mm, 65 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#fef9c3")),  # supervisor destacado
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("MINROWHEIGHT", (0, 1), (-1, -1), 18 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)

    # ── Rodapé ──────────────────────────────────────────────────────────────
    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setStrokeColor(BLACK)
        canvas.setLineWidth(0.5)
        canvas.line(10 * mm, 8 * mm, 200 * mm, 8 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica-Oblique", 6.5)
        canvas.drawString(
            10 * mm, 5 * mm,
            f"Documento emitido eletronicamente em {datetime.now().strftime('%d/%m/%Y %H:%M')} · HAYAH ENERGY · "
            f"Obra: {project.get('name', '')} ({project.get('project_code', '') or '—'}) · "
            f"Linha {'VIVA (energizada — risco elevado)' if is_live else 'MORTA (desenergizada)'}",
        )
        canvas.drawRightString(200 * mm, 5 * mm, f"Pág. {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buf.seek(0)
    return buf.getvalue()
