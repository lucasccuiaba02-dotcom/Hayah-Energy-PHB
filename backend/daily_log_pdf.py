"""Diário de Obra — Relatório profissional de turno.
Fev/2026 · Redesenhado para impressão A4, estilo engenharia elétrica.
Checklists destacados com ícone colorido + fundo verde/vermelho.
Fotos organizadas por ponto (P1, P2…) em galeria 2 colunas.
"""
import io
import base64
import re as _re
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether,
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER

BLACK = colors.HexColor("#111827")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#9ca3af")
LIGHT = colors.HexColor("#f3f4f6")
HEADER_BG = colors.HexColor("#0f172a")
YELLOW = colors.HexColor("#eab308")
GREEN_HL = colors.HexColor("#bbf7d0")
GREEN_DK = colors.HexColor("#065f46")
RED_HL = colors.HexColor("#fecaca")
RED_DK = colors.HexColor("#991b1b")


def _styles():
    return {
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=15, textColor=colors.white, leading=17),
        "sub": ParagraphStyle("s", fontName="Helvetica", fontSize=8.5, textColor=colors.white, leading=10),
        "sec": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=9, textColor=colors.white, alignment=0, leading=11),
        "cell": ParagraphStyle("c", fontName="Helvetica", fontSize=9, textColor=INK, leading=11),
        "cellb": ParagraphStyle("cb", fontName="Helvetica-Bold", fontSize=9, textColor=INK, leading=11),
        "small": ParagraphStyle("sm", fontName="Helvetica", fontSize=7.5, textColor=INK, leading=9.5),
        "cap": ParagraphStyle("cap", fontName="Helvetica", fontSize=7.5, textColor=MUTED, alignment=TA_CENTER, leading=9),
        "body": ParagraphStyle("b", fontName="Helvetica", fontSize=9.5, textColor=INK, leading=12.5),
    }


def build_daily_log_pdf(project: dict, checklist: dict, photos: list, notes: str = "") -> bytes:
    S = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=8 * mm, bottomMargin=14 * mm,
        title=f"Diário de Obra — {project.get('name', '')}",
    )
    story = []
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")

    # ── Cabeçalho ────────────────────────────────────────────────────────
    hdr = [[Paragraph("<b>HAYAH ENERGY</b>", S["title"]),
            Paragraph("<b>DIÁRIO DE OBRA</b><br/>Relatório de Turno · Fev/2026", S["sub"])]]
    t = Table(hdr, colWidths=[110 * mm, 76 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 10), ("RIGHTPADDING", (1, 0), (1, 0), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 1.0, BLACK),
    ]))
    story.append(t)
    story.append(Spacer(1, 3 * mm))

    # ── Dados da Obra ────────────────────────────────────────────────────
    story.append(Table([[Paragraph("IDENTIFICAÇÃO DA OBRA", S["sec"])]], colWidths=[186 * mm],
                       style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
                                         ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                         ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                         ("BOX", (0, 0), (-1, -1), 0.7, BLACK)])))
    kv_rows = [
        [Paragraph("<b>Código</b>", S["cellb"]), Paragraph(project.get("project_code") or "—", S["cell"]),
         Paragraph("<b>Tipo</b>", S["cellb"]), Paragraph(project.get("project_type") or "—", S["cell"])],
        [Paragraph("<b>Nome</b>", S["cellb"]), Paragraph(project.get("name") or "—", S["cell"]),
         Paragraph("<b>Equipe</b>", S["cellb"]), Paragraph(project.get("team_name") or "—", S["cell"])],
        [Paragraph("<b>Localidade</b>", S["cellb"]), Paragraph(project.get("location") or "—", S["cell"]),
         Paragraph("<b>UTM</b>", S["cellb"]),
         Paragraph(f"{project.get('utm_x') or '—'}  /  {project.get('utm_y') or '—'}", S["cell"])],
        [Paragraph("<b>Data programada</b>", S["cellb"]), Paragraph((project.get("start_date") or "")[:10] or "—", S["cell"]),
         Paragraph("<b>Valor</b>", S["cellb"]),
         Paragraph(f"R$ {float(project.get('programmed_value') or 0):,.2f}", S["cell"])],
        [Paragraph("<b>Emissão do diário</b>", S["cellb"]), Paragraph(generated_at, S["cell"]),
         Paragraph("<b>Turno</b>", S["cellb"]), Paragraph(project.get("shift") or "Diurno", S["cell"])],
    ]
    t = Table(kv_rows, colWidths=[36 * mm, 60 * mm, 30 * mm, 60 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), LIGHT), ("BACKGROUND", (2, 0), (2, -1), LIGHT),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 4 * mm))

    # ── Checklist Operacional (destaque colorido) ────────────────────────
    story.append(Table([[Paragraph("CHECKLIST OPERACIONAL DE SEGURANÇA", S["sec"])]], colWidths=[186 * mm],
                       style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
                                         ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                         ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                         ("BOX", (0, 0), (-1, -1), 0.7, BLACK)])))
    items = [
        ("Linha Viva confirmada", checklist.get("hotline_confirmed")),
        ("Desligamento confirmado", checklist.get("shutdown_confirmed")),
        ("Material separado no almoxarifado", checklist.get("material_confirmed")),
        ("Equipe presente no local da obra", checklist.get("team_confirmed")),
    ]
    check_rows = []
    styles_extra = []
    for idx, (label, checked) in enumerate(items):
        icon = Paragraph("<b>✓ CONFERIDO</b>" if checked else "<b>✗ PENDENTE</b>",
                         ParagraphStyle("ic", fontName="Helvetica-Bold", fontSize=8.5, alignment=TA_CENTER,
                                        textColor=GREEN_DK if checked else RED_DK))
        check_rows.append([Paragraph(f"<b>{idx + 1}.</b> {label}", S["cell"]), icon])
        styles_extra.append(("BACKGROUND", (1, idx), (1, idx), GREEN_HL if checked else RED_HL))
    t = Table(check_rows, colWidths=[140 * mm, 46 * mm])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (0, -1), 8),
    ] + styles_extra))
    story.append(t)
    story.append(Spacer(1, 4 * mm))

    # ── Observações da Equipe ────────────────────────────────────────────
    if notes and notes.strip():
        story.append(Table([[Paragraph("OBSERVAÇÕES DA EQUIPE", S["sec"])]], colWidths=[186 * mm],
                           style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
                                             ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                             ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                             ("BOX", (0, 0), (-1, -1), 0.7, BLACK)])))
        obs_body = []
        for line in notes.split("\n"):
            if line.strip():
                obs_body.append(Paragraph(line.replace("<", "&lt;").replace(">", "&gt;"), S["body"]))
                obs_body.append(Spacer(1, 3))
        wrapper = Table([[obs_body]], colWidths=[186 * mm])
        wrapper.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(wrapper)
        story.append(Spacer(1, 4 * mm))

    # ── Fotos por ponto — galeria 2 colunas ──────────────────────────────
    if photos:
        def _sort_key(ph):
            pt = (ph.get("point") or "").upper().strip()
            m = _re.search(r"(\d+)", pt) if pt else None
            n = int(m.group(1)) if m else 99999
            return (0 if pt else 1, n, pt)

        sorted_photos = sorted(photos, key=_sort_key)
        story.append(Table([[Paragraph(f"REGISTRO FOTOGRÁFICO ({len(sorted_photos)} imagens)", S["sec"])]],
                           colWidths=[186 * mm],
                           style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), HEADER_BG),
                                             ("LEFTPADDING", (0, 0), (-1, -1), 8),
                                             ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                                             ("BOX", (0, 0), (-1, -1), 0.7, BLACK)])))
        story.append(Spacer(1, 2 * mm))

        def _photo_cell(ph):
            data_url = ph.get("data_url") or ""
            if not ph.get("path") and not ph.get("bytes") and not data_url.startswith("data:image"):
                return None
            try:
                # Out/2026 · caminho em disco (JPEG) → reportlab embute o DCT direto, sem decodificar para RGB (183 fotos em BytesIO = ~850 MB → OOM)
                if ph.get("path"):
                    img = Image(ph["path"])
                else:
                    img_bytes = ph["bytes"] if ph.get("bytes") else base64.b64decode(data_url.split(",", 1)[1])
                    img = Image(io.BytesIO(img_bytes))
                img._restrictSize(88 * mm, 70 * mm)
                point = (ph.get("point") or "").strip()
                label = (ph.get("label") or "").upper()
                when = (ph.get("uploaded_at") or "")[:19].replace("T", " ")
                caption = f"<b>{point or '—'}</b> · {label or 'FOTO'} · <font color='#6b7280'>{when}</font>"
                inner = Table([[img], [Paragraph(caption, S["cap"])]], colWidths=[90 * mm])
                inner.setStyle(TableStyle([
                    ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                    ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("BACKGROUND", (0, 1), (-1, 1), LIGHT),
                ]))
                return inner
            except Exception:
                return None

        # 2 fotos por linha
        row_pair = []
        for ph in sorted_photos:
            cell = _photo_cell(ph)
            if cell is None:
                continue
            row_pair.append(cell)
            if len(row_pair) == 2:
                gt = Table([row_pair], colWidths=[93 * mm, 93 * mm])
                gt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                        ("TOPPADDING", (0, 0), (-1, -1), 2),
                                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
                story.append(gt)
                row_pair = []
        if row_pair:
            row_pair.append("")
            gt = Table([row_pair], colWidths=[93 * mm, 93 * mm])
            gt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story.append(gt)

    # ── Assinatura do encarregado ────────────────────────────────────────
    story.append(Spacer(1, 6 * mm))
    sig = Table([
        [Paragraph("ASSINATURA DO ENCARREGADO / RESPONSÁVEL", S["sec"])],
        [Paragraph(f"<br/><br/><br/><br/>_________________________________________________<br/>"
                   f"<b>{project.get('team_name') or 'Encarregado da Equipe'}</b>", S["cell"])],
    ], colWidths=[186 * mm])
    sig.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 3), ("BOTTOMPADDING", (0, 0), (-1, 0), 3),
        ("TOPPADDING", (0, 1), (-1, 1), 8), ("BOTTOMPADDING", (0, 1), (-1, 1), 12),
        ("VALIGN", (0, 1), (-1, 1), "MIDDLE"),
        ("ALIGN", (0, 1), (-1, 1), "CENTER"),
    ]))
    story.append(sig)

    # ── Rodapé ───────────────────────────────────────────────────────────
    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setStrokeColor(BLACK)
        canvas.setLineWidth(0.5)
        canvas.line(12 * mm, 10 * mm, 198 * mm, 10 * mm)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica-Oblique", 6.5)
        canvas.drawString(12 * mm, 6 * mm,
                          f"Documento emitido eletronicamente em {generated_at} · HAYAH ENERGY · "
                          f"{project.get('name', '')} ({project.get('project_code', '') or '—'})")
        canvas.drawRightString(198 * mm, 6 * mm, f"Pág. {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buf.seek(0)
    return buf.read()
