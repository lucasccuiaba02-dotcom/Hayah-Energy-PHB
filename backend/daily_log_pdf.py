"""Diário de Obra — Generates a daily-shift PDF combining checklist, photos and notes."""
import io
import base64
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak,
)
from reportlab.lib.enums import TA_LEFT

HAYAH_YELLOW = colors.HexColor("#E0FF00")
HAYAH_CYAN = colors.HexColor("#00F0FF")
HAYAH_BG = colors.HexColor("#050505")
HAYAH_MUTED = colors.HexColor("#71717a")


def _kv_table(rows):
    t = Table(rows, colWidths=[4 * cm, 12 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HAYAH_BG),
        ("TEXTCOLOR", (0, 0), (0, -1), HAYAH_MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#222")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def build_daily_log_pdf(project: dict, checklist: dict, photos: list, notes: str = "") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        title=f"Diário de Obra — {project.get('name', '')}",
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="H1H", fontName="Helvetica-Bold", fontSize=20, textColor=HAYAH_YELLOW))
    styles.add(ParagraphStyle(name="H2H", fontName="Helvetica-Bold", fontSize=13, textColor=HAYAH_CYAN, spaceBefore=12, spaceAfter=6))
    styles.add(ParagraphStyle(name="Muted", fontName="Helvetica", fontSize=8, textColor=HAYAH_MUTED))
    styles.add(ParagraphStyle(name="Body", fontName="Helvetica", fontSize=10, textColor=colors.white, alignment=TA_LEFT))

    story = []

    # Header
    story.append(Paragraph("HAYAH ENERGY", styles["H1H"]))
    story.append(Paragraph("DIÁRIO DE OBRA — RELATÓRIO DE TURNO", styles["Muted"]))
    story.append(Spacer(1, 12))

    # Project details
    story.append(Paragraph("Dados da Obra", styles["H2H"]))
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")
    kv = [
        ["Código", project.get("project_code") or "—"],
        ["Nome", project.get("name") or "—"],
        ["Tipo", project.get("project_type") or "—"],
        ["Localidade", project.get("location") or "—"],
        ["UTM (X / Y)", f"{project.get('utm_x') or '—'}  /  {project.get('utm_y') or '—'}"],
        ["Equipe", project.get("team_name") or "—"],
        ["Data programada", (project.get("start_date") or "")[:10] or "—"],
        ["Valor programado", f"R$ {float(project.get('programmed_value') or 0):,.2f}"],
        ["Emissão do diário", generated_at],
    ]
    story.append(_kv_table(kv))

    # Checklist
    story.append(Paragraph("Checklist Operacional", styles["H2H"]))
    check_items = [
        ("Linha Viva confirmada", checklist.get("hotline_confirmed")),
        ("Desligamento confirmado", checklist.get("shutdown_confirmed")),
        ("Material separado", checklist.get("material_confirmed")),
        ("Equipe no local", checklist.get("team_confirmed")),
    ]
    check_rows = [[Paragraph(f"<font color='{'#39FF14' if v else '#FF003C'}'>{'✓' if v else '✗'}</font>", styles["Body"]),
                   Paragraph(label, styles["Body"])] for label, v in check_items]
    ct = Table(check_rows, colWidths=[1 * cm, 15 * cm])
    ct.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 11),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#222")),
    ]))
    story.append(ct)

    # Notes
    if notes and notes.strip():
        story.append(Paragraph("Observações da Equipe", styles["H2H"]))
        for line in notes.split("\n"):
            if line.strip():
                story.append(Paragraph(line.replace("<", "&lt;").replace(">", "&gt;"), styles["Body"]))
                story.append(Spacer(1, 4))

    # Photos — sorted by point (P1, P2, P3...) for dossier presentation
    if photos:
        def _sort_key(ph):
            pt = (ph.get("point") or "").upper().strip()
            m = None
            if pt:
                import re as _re
                m = _re.search(r"(\d+)", pt)
            n = int(m.group(1)) if m else 99999
            return (0 if pt else 1, n, pt)
        sorted_photos = sorted(photos, key=_sort_key)
        story.append(Paragraph(f"Fotos do Dossiê ({len(sorted_photos)})", styles["H2H"]))
        story.append(Paragraph(
            "Registro fotográfico ordenado por ponto (P1, P2, P3...) para composição do dossiê de obra.",
            styles["Muted"]
        ))
        story.append(Spacer(1, 6))
        for ph in sorted_photos:
            data_url = ph.get("data_url") or ""
            if not data_url.startswith("data:image"):
                continue
            try:
                b64 = data_url.split(",", 1)[1]
                img_bytes = base64.b64decode(b64)
                img = Image(io.BytesIO(img_bytes))
                img._restrictSize(15 * cm, 12 * cm)
                point = (ph.get("point") or "").strip()
                label = (ph.get("label") or "").upper()
                when = (ph.get("uploaded_at") or ph.get("created_at") or "")[:19].replace("T", " ")
                caption_parts = []
                if point:
                    caption_parts.append(f"<b><font color='#E0FF00'>{point}</font></b>")
                if label:
                    caption_parts.append(label)
                if when:
                    caption_parts.append(f"<font color='#71717a'>{when}</font>")
                caption = " · ".join(caption_parts)
                story.append(img)
                story.append(Paragraph(caption, styles["Body"]))
                story.append(Spacer(1, 10))
            except Exception:
                continue

    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFillColor(HAYAH_YELLOW)
        canvas.rect(0, 0, A4[0], 0.15 * cm, fill=1, stroke=0)
        canvas.setFillColor(HAYAH_MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(1.5 * cm, 0.4 * cm, f"Diário gerado em {generated_at} — Hayah Energy")
        canvas.drawRightString(A4[0] - 1.5 * cm, 0.4 * cm, f"Página {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buf.seek(0)
    return buf.read()
