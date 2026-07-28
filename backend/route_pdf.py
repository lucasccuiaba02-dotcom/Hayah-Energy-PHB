"""Optimized route PDF (roteiro) — used for exporting Geolocalização itinerary."""
import io
from datetime import datetime, timezone
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)

HAYAH_YELLOW = colors.HexColor("#E0FF00")
HAYAH_CYAN = colors.HexColor("#00F0FF")
HAYAH_MUTED = colors.HexColor("#71717a")


def build_route_pdf(payload: dict) -> bytes:
    """
    payload: {
      team_name?: str,
      origin: {label, lat, lng},
      distance_km?: float,
      duration_min?: float,
      route_mode?: str ("osrm" | "haversine"),
      stops: [
        {order, project_code, name, project_type, location, programmed_value, lat, lng, execution_status}
      ]
    }
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
        title="Roteiro Otimizado — Hayah Energy",
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="H1H", fontName="Helvetica-Bold", fontSize=20, textColor=HAYAH_YELLOW))
    styles.add(ParagraphStyle(name="H2H", fontName="Helvetica-Bold", fontSize=12, textColor=HAYAH_CYAN, spaceBefore=10, spaceAfter=4))
    styles.add(ParagraphStyle(name="Muted", fontName="Helvetica", fontSize=8, textColor=HAYAH_MUTED))
    styles.add(ParagraphStyle(name="Body", fontName="Helvetica", fontSize=10, textColor=colors.white))

    story = []
    story.append(Paragraph("HAYAH ENERGY", styles["H1H"]))
    story.append(Paragraph("ROTEIRO OTIMIZADO DE OBRAS", styles["Muted"]))
    story.append(Spacer(1, 8))

    team = payload.get("team_name") or "Todas as equipes"
    origin = payload.get("origin") or {}
    generated = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")

    header_rows = [
        ["Equipe", team],
        ["Origem", origin.get("label") or f"{origin.get('lat','?')}, {origin.get('lng','?')}"],
        ["Distância total", f"{payload.get('distance_km', 0):.1f} km  ({payload.get('route_mode') or 'nearest-neighbor'})"],
        ["Tempo estimado", f"{int(round(payload.get('duration_min') or 0))} min"],
        ["Paradas", f"{len(payload.get('stops') or [])}"],
        ["Gerado em", generated],
    ]
    ht = Table(header_rows, colWidths=[4 * cm, 12 * cm])
    ht.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0a0a0a")),
        ("TEXTCOLOR", (0, 0), (0, -1), HAYAH_MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#222")),
    ]))
    story.append(ht)

    story.append(Paragraph("Ordem de Visita", styles["H2H"]))

    header = ["#", "Código", "Obra", "Tipo", "Localidade", "Coord.", "Valor Prog."]
    body = [header]
    for i, s in enumerate(payload.get("stops") or [], start=1):
        body.append([
            str(i),
            s.get("project_code") or "—",
            (s.get("name") or "")[:40],
            (s.get("project_type") or "—")[:16],
            (s.get("location") or "—")[:20],
            f"{s.get('lat', 0):.4f}, {s.get('lng', 0):.4f}",
            f"R$ {float(s.get('programmed_value') or 0):,.2f}",
        ])
    t = Table(body, colWidths=[0.8 * cm, 2.6 * cm, 5 * cm, 2.6 * cm, 2.6 * cm, 3 * cm, 2.4 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), HAYAH_YELLOW),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.white),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#050505")),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#222")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(t)

    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Roteiro otimizado por proximidade (Nearest-Neighbor). Valide condições de estrada, "
        "linhas vivas e disponibilidade de material antes de despachar as equipes.",
        styles["Muted"],
    ))

    def _footer(canvas, doc_):
        canvas.saveState()
        canvas.setFillColor(HAYAH_YELLOW)
        canvas.rect(0, 0, A4[0], 0.15 * cm, fill=1, stroke=0)
        canvas.setFillColor(HAYAH_MUTED)
        canvas.setFont("Helvetica", 7)
        canvas.drawString(1.5 * cm, 0.4 * cm, f"Roteiro gerado em {generated} — Hayah Energy")
        canvas.drawRightString(A4[0] - 1.5 * cm, 0.4 * cm, f"Página {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    buf.seek(0)
    return buf.read()
