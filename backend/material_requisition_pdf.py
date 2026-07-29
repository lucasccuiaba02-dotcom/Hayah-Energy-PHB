"""Material requisition PDF generator — includes header, table with 4 qty columns, signature line and QR."""
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
import qrcode


def _qr_image(data: str, size_mm: float = 22) -> Image:
    qr = qrcode.QRCode(version=1, box_size=6, border=1)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return Image(buf, width=size_mm * mm, height=size_mm * mm)


def build_requisition_pdf(project: dict, signature_name: str, notes: str, requisition_id: str, requested_by: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4,
                            topMargin=12 * mm, bottomMargin=12 * mm,
                            leftMargin=14 * mm, rightMargin=14 * mm,
                            title=f"Requisicao {project.get('project_code','') or ''}")

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="TitleHY", parent=styles["Title"], textColor=colors.HexColor("#050505"),
                              alignment=1, fontSize=18, spaceAfter=2))
    styles.add(ParagraphStyle(name="Sub", parent=styles["Normal"], textColor=colors.HexColor("#666666"),
                              alignment=1, fontSize=9, spaceAfter=8))
    styles.add(ParagraphStyle(name="Small", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#333333")))
    styles.add(ParagraphStyle(name="Muted", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#888888")))

    story = []

    story.append(Paragraph("HAYAH ENERGY — Requisição de Almoxarifado", styles["TitleHY"]))
    story.append(Paragraph(f"Documento nº {requisition_id} · Emitido em {datetime.now().strftime('%d/%m/%Y %H:%M')}", styles["Sub"]))

    # HEADER (obra + equipe + data + localidade + QR)
    period = f"{(project.get('start_date') or '')[:10]} → {(project.get('end_date') or '')[:10]}"
    equipe = project.get('team_name') or '-'
    if project.get('additional_team_name'):
        equipe += f" + {project['additional_team_name']}"
    header_data = [
        [Paragraph("<b>Nº Obra</b>", styles["Small"]), Paragraph(project.get("project_code") or "-", styles["Small"]),
         Paragraph("<b>Nome</b>", styles["Small"]), Paragraph(project.get("name") or "-", styles["Small"])],
        [Paragraph("<b>Equipe</b>", styles["Small"]), Paragraph(equipe, styles["Small"]),
         Paragraph("<b>Data</b>", styles["Small"]), Paragraph(datetime.now().strftime("%d/%m/%Y"), styles["Small"])],
        [Paragraph("<b>Localidade</b>", styles["Small"]), Paragraph(project.get("location") or "-", styles["Small"]),
         Paragraph("<b>Período</b>", styles["Small"]), Paragraph(period, styles["Small"])],
        [Paragraph("<b>Solicitado por</b>", styles["Small"]), Paragraph(requested_by or "-", styles["Small"]),
         Paragraph("<b>Tipo</b>", styles["Small"]), Paragraph((project.get("project_type") or "").upper(), styles["Small"])],
    ]
    header_tbl = Table(header_data, colWidths=[26 * mm, 66 * mm, 22 * mm, 66 * mm])
    header_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#050505")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F7F7F7")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F7F7F7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))

    # QR code linking to project (id or code)
    qr_data = f"HAYAH:{project.get('project_code') or project.get('_id', '')}:{requisition_id}"
    try:
        qr_img = _qr_image(qr_data, 24)
        top = Table([[header_tbl, qr_img]], colWidths=[145 * mm, 30 * mm])
        top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(top)
    except Exception:
        story.append(header_tbl)

    story.append(Spacer(1, 8))

    # MATERIALS TABLE
    materials = project.get("materials_list", []) or []
    if materials:
        rows = [["Item", "Un", "Solicitado", "Separado", "Baixado", "Entregue"]]
        tot_s = tot_sep = tot_bx = tot_ent = 0.0
        for m in materials:
            qs = float(m.get("qty_requested", m.get("quantity", 0)) or 0)
            qsep = float(m.get("qty_separated", 0) or 0)
            qbx = float(m.get("qty_written_off", 0) or 0)
            qent = float(m.get("qty_delivered", 0) or 0)
            tot_s += qs; tot_sep += qsep; tot_bx += qbx; tot_ent += qent
            rows.append([
                Paragraph(str(m.get("item", "")), styles["Small"]),
                m.get("unit", "un"),
                f"{qs:g}", f"{qsep:g}", f"{qbx:g}", f"{qent:g}",
            ])
        rows.append(["TOTAIS", "", f"{tot_s:g}", f"{tot_sep:g}", f"{tot_bx:g}", f"{tot_ent:g}"])

        mat_tbl = Table(rows, colWidths=[70 * mm, 12 * mm, 25 * mm, 22 * mm, 22 * mm, 25 * mm])
        mat_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#050505")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#E0FF00")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("FONTSIZE", (0, 1), (-1, -1), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#FAFAFA")]),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#EDEDED")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#050505")),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
            ("TEXTCOLOR", (3, 1), (3, -1), colors.HexColor("#00A050")),
            ("TEXTCOLOR", (4, 1), (4, -1), colors.HexColor("#E55400")),
            ("TEXTCOLOR", (5, 1), (5, -1), colors.HexColor("#005EE0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(mat_tbl)
    else:
        story.append(Paragraph("<i>Sem itens de material cadastrados.</i>", styles["Muted"]))

    if notes:
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"<b>Observações:</b> {notes}", styles["Small"]))

    story.append(Spacer(1, 16))

    # SIGNATURE BLOCK
    sig_data = [
        [Paragraph("<b>SOLICITANTE</b>", styles["Muted"]), Paragraph("<b>ALMOXARIFE</b>", styles["Muted"])],
        [Paragraph("<br/><br/>_________________________________<br/>Nome: " + (signature_name or ""), styles["Small"]),
         Paragraph("<br/><br/>_________________________________<br/>Nome: __________________________", styles["Small"])],
        [Paragraph("Data: ____ /____ /_______", styles["Muted"]),
         Paragraph("Data: ____ /____ /_______", styles["Muted"])],
    ]
    sig_tbl = Table(sig_data, colWidths=[85 * mm, 85 * mm])
    sig_tbl.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#050505")),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CCCCCC")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F7F7F7")),
    ]))
    story.append(sig_tbl)

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "Documento gerado automaticamente pela Matriz Hayah Energy. Este documento é válido como comprovante interno.",
        styles["Muted"]
    ))

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()
