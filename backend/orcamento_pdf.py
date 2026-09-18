"""Set/2026 · PDFs do módulo Orçamentos: Proposta Comercial (layout da proposta modelo) e Relatório de Conclusão."""
import io
from datetime import datetime

from num2words import num2words
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

DARK = colors.HexColor("#1F2937")
ACCENT = colors.HexColor("#F59E0B")
MUTED = colors.HexColor("#6B7280")
LIGHT = colors.HexColor("#F3F4F6")
MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]


def brl(v) -> str:
    return f"R$ {float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def extenso(v) -> str:
    try:
        return num2words(round(float(v or 0), 2), lang="pt_BR", to="currency").upper()
    except Exception:
        return ""


def _date_long(iso: str) -> str:
    try:
        d = datetime.strptime((iso or "")[:10], "%Y-%m-%d")
        return f"{d.day:02d} de {MONTHS[d.month - 1]} de {d.year}"
    except Exception:
        return iso or ""


def _date_br(iso: str) -> str:
    s = (iso or "")[:10]
    return f"{s[8:10]}/{s[5:7]}/{s[0:4]}" if len(s) == 10 else (iso or "—")


def _styles():
    st = getSampleStyleSheet()
    st.add(ParagraphStyle(name="TitleP", parent=st["Title"], fontSize=26, leading=30, textColor=DARK, alignment=TA_CENTER, spaceAfter=10))
    st.add(ParagraphStyle(name="H", parent=st["Heading2"], fontSize=12, leading=15, textColor=DARK, spaceBefore=10, spaceAfter=5, fontName="Helvetica-Bold", alignment=TA_CENTER))
    st.add(ParagraphStyle(name="HL", parent=st["Heading2"], fontSize=11, leading=14, textColor=DARK, spaceBefore=8, spaceAfter=3, fontName="Helvetica-Bold"))
    st.add(ParagraphStyle(name="Body", parent=st["Normal"], fontSize=10, leading=14, alignment=TA_JUSTIFY))
    st.add(ParagraphStyle(name="BodyU", parent=st["Normal"], fontSize=10, leading=14))
    st.add(ParagraphStyle(name="BodyC", parent=st["Normal"], fontSize=10, leading=14, alignment=TA_CENTER))
    st.add(ParagraphStyle(name="Small", parent=st["Normal"], fontSize=8.5, leading=11, textColor=MUTED))
    st.add(ParagraphStyle(name="Cell", parent=st["Normal"], fontSize=8.5, leading=10.5))
    st.add(ParagraphStyle(name="CellB", parent=st["Normal"], fontSize=8.5, leading=10.5, fontName="Helvetica-Bold"))
    st.add(ParagraphStyle(name="Money", parent=st["Normal"], fontSize=11, leading=15, fontName="Helvetica-Bold", textColor=DARK))
    st.add(ParagraphStyle(name="Cap", parent=st["Normal"], fontSize=8, leading=10, alignment=TA_CENTER, textColor=MUTED))
    return st


def _H(text, st):
    return Paragraph(f"<u>{text}</u>", st["H"])


def _footer_lines(company: dict):
    l1 = company.get("footer") or " – ".join([x for x in [company.get("address"), company.get("city")] if x])
    parts = []
    if company.get("cnpj"):
        parts.append(f"CNPJ: {company['cnpj']}")
    if company.get("phone"):
        parts.append(f"FONE: {company['phone']}")
    if company.get("email"):
        parts.append(company["email"])
    return l1, " – ".join(parts)


def _page_decor(company: dict, logo_bytes):
    img = None
    if logo_bytes:
        try:
            img = ImageReader(io.BytesIO(logo_bytes))
        except Exception:
            img = None

    def draw(canvas, doc):
        canvas.saveState()
        w, h = A4
        top = h - 12 * mm
        if img:
            try:
                iw, ih = img.getSize()
                lh = 16 * mm
                lw = min(lh * iw / ih, 70 * mm)
                lh = lw * ih / iw
                canvas.drawImage(img, (w - lw) / 2, top - lh, width=lw, height=lh, mask="auto")
                canvas.saveState()
                canvas.setFillAlpha(0.06)
                ww = 120 * mm
                wh = ww * ih / iw
                canvas.drawImage(img, (w - ww) / 2, (h - wh) / 2, width=ww, height=wh, mask="auto")
                canvas.restoreState()
                top -= lh + 2 * mm
            except Exception:
                pass
        else:
            canvas.setFont("Helvetica-Bold", 18)
            canvas.setFillColor(DARK)
            canvas.drawCentredString(w / 2, top - 6 * mm, company.get("name", ""))
            top -= 9 * mm
        canvas.setFont("Helvetica-Oblique", 9)
        canvas.setFillColor(MUTED)
        canvas.drawCentredString(w / 2, top - 3 * mm, company.get("tagline", ""))
        canvas.setStrokeColor(ACCENT)
        canvas.setLineWidth(1.2)
        canvas.line(14 * mm, h - 36 * mm, w - 14 * mm, h - 36 * mm)
        canvas.setStrokeColor(colors.HexColor("#D1D5DB"))
        canvas.setLineWidth(0.5)
        canvas.line(14 * mm, 16 * mm, w - 14 * mm, 16 * mm)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        l1, l2 = _footer_lines(company)
        canvas.drawCentredString(w / 2, 11.5 * mm, l1)
        canvas.drawCentredString(w / 2, 7.5 * mm, l2)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawRightString(w - 14 * mm, 7.5 * mm, f"Página {doc.page}")
        canvas.restoreState()
    return draw


def _doc(buf, title):
    return SimpleDocTemplate(buf, pagesize=A4, topMargin=42 * mm, bottomMargin=22 * mm, leftMargin=18 * mm, rightMargin=18 * mm, title=title)


def _kv_table(rows, st, col1=38 * mm):
    data = [[Paragraph(f"<b>{k}</b>", st["BodyU"]), Paragraph(v or "—", st["BodyU"])] for k, v in rows]
    t = Table(data, colWidths=[col1, 174 * mm - col1])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 2)]))
    return t


def _items_table(items, st, kind):
    if kind == "labor":
        head = ["Item", "Descrição do serviço", "Un", "Qtd", "Preço unit.", "Total"]
        widths = [10 * mm, 88 * mm, 12 * mm, 16 * mm, 24 * mm, 24 * mm]
    else:
        head = ["Código", "Descrição do material", "Un", "Qtd", "Preço unit.", "Total"]
        widths = [22 * mm, 76 * mm, 12 * mm, 16 * mm, 24 * mm, 24 * mm]
    rows = [head]
    for i, it in enumerate(items, start=1):
        first = str(i) if kind == "labor" else (it.get("code") or "—")
        rows.append([Paragraph(first, st["Cell"]), Paragraph(it.get("description", ""), st["Cell"]), (it.get("unit") or "UN").upper(),
                     f"{it.get('qty', 0):g}", brl(it.get("unit_price")), brl(it.get("total"))])
    total = sum(float(it.get("total") or 0) for it in items)
    rows.append(["", Paragraph("TOTAL", st["CellB"]), "", "", "", brl(total)])
    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8.5), ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, LIGHT]), ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E5E7EB")),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("BOX", (0, 0), (-1, -1), 0.6, DARK), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _photo_grid(photos, st, cols=2, w=84 * mm, h=62 * mm):
    cells, row = [], []
    for p in photos:
        try:
            img = Image(io.BytesIO(p["bytes"]))
            img._restrictSize(w, h)
            cap = p.get("caption") or {"antes": "Antes", "depois": "Depois", "servico": "Serviço", "croqui": "Croqui"}.get(p.get("kind"), "")
            cell = Table([[img], [Paragraph(cap, st["Cap"])]], colWidths=[w + 2 * mm])
            cell.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#D1D5DB")),
                                      ("BACKGROUND", (0, 1), (-1, 1), LIGHT), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
            row.append(cell)
        except Exception:
            continue
        if len(row) == cols:
            cells.append(row)
            row = []
    if row:
        while len(row) < cols:
            row.append("")
        cells.append(row)
    if not cells:
        return None
    t = Table(cells, colWidths=[(w + 4 * mm)] * cols, hAlign="CENTER")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    return t


def _money_block(label, value, st):
    return KeepTogether([
        Paragraph(label, st["Body"]),
        Spacer(1, 2),
        Paragraph(f"{brl(value)} <font size='9'>({extenso(value)})</font>", st["Money"]),
    ])


def build_proposta_pdf(o: dict, company: dict, logo_bytes, photos: list) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"Proposta Comercial {o.get('code', '')}")
    c = o.get("client") or {}
    story = []

    # ---- Página 1: capa
    story += [Spacer(1, 10 * mm), Paragraph("PROPOSTA COMERCIAL", st["TitleP"]), Spacer(1, 8 * mm)]
    story.append(_kv_table([
        ("SOLICITANTE:", f"{c.get('name', '')}" + (f" – {c.get('city')}" if c.get("city") else "")),
        ("CONTATOS:", " · ".join([x for x in [c.get("contact"), c.get("phone"), c.get("email")] if x])),
        ("LOCAL DO PROJETO:", o.get("location") or c.get("city") or ""),
        ("SOLICITADA:", f"{company.get('legal_name', '')}<br/><font color='#6B7280'>Doravante denominada: {company.get('name', '')} {company.get('tagline', '')}</font>"),
    ], st, col1=42 * mm))
    story += [Spacer(1, 10 * mm), Paragraph(f"<b>OBJETO:</b> {(o.get('objeto') or '').upper()}", st["Body"]), Spacer(1, 16 * mm)]
    story.append(_kv_table([("Data base:", _date_long(o.get("base_date"))), ("N.º da proposta:", f"<b>{o.get('code', '')}</b>")], st, col1=42 * mm))
    story.append(PageBreak())

    # ---- Página 2: apresentação + dados da empresa + fotos
    story.append(Paragraph(o.get("intro_text") or "", st["BodyC"]))
    story += [Spacer(1, 6 * mm), _H("DADOS GERAIS DA EMPRESA", st)]
    story.append(_kv_table([("Razão Social:", company.get("legal_name", "")), ("CNPJ:", company.get("cnpj", "")),
                            ("Endereço:", " – ".join([x for x in [company.get("address"), company.get("city")] if x])), ("Telefone:", company.get("phone", ""))], st))
    servico = [p for p in photos if p.get("kind") in ("servico", "antes")][:4]
    if servico:
        story += [Spacer(1, 6 * mm), _H("REGISTRO FOTOGRÁFICO DO LOCAL / SERVIÇO", st)]
        g = _photo_grid(servico, st)
        if g:
            story.append(g)
    story.append(PageBreak())

    # ---- Página 3: escopo + mão de obra
    story.append(_H("ESCOPO DO FORNECIMENTO", st))
    story.append(Paragraph((o.get("objeto") or "").upper(), st["Body"]))
    story.append(Spacer(1, 3 * mm))
    scope = o.get("scope_items") or []
    if scope:
        rows = [[Paragraph(str(i), st["CellB"]), Paragraph(s.upper(), st["Cell"])] for i, s in enumerate(scope, start=1)]
        t = Table(rows, colWidths=[10 * mm, 164 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.2, colors.HexColor("#E5E7EB"))]))
        story.append(t)
    story += [Spacer(1, 6 * mm), _H("PROJETOS E MÃO DE OBRA", st)]
    story.append(_money_block("O VALOR PARA O PROJETO E EXECUÇÃO DA OBRA É DE:", o.get("labor_total"), st))
    story += [Spacer(1, 2 * mm), Paragraph(o.get("labor_notes") or "", st["Body"])]
    if o.get("include_labor_table") and o.get("labor_items"):
        story += [Spacer(1, 4 * mm), Paragraph("Composição dos serviços", st["Small"]), Spacer(1, 1 * mm), _items_table(o["labor_items"], st, "labor")]

    # ---- Materiais + condições
    story += [Spacer(1, 6 * mm), _H("MATERIAIS", st)]
    story.append(Paragraph(o.get("material_notes") or "", st["Body"]))
    story += [Spacer(1, 2 * mm), _money_block("VALOR DOS MATERIAIS:", o.get("material_total"), st)]
    if o.get("include_material_table") and o.get("material_items"):
        story += [Spacer(1, 4 * mm), Paragraph("Lista de materiais", st["Small"]), Spacer(1, 1 * mm), _items_table(o["material_items"], st, "material")]

    story += [Spacer(1, 6 * mm), _H("CONDIÇÕES DE PAGAMENTO", st)]
    story.append(_money_block("Total da obra (mão de obra + materiais):", o.get("grand_total"), st))
    story.append(Spacer(1, 2 * mm))
    for line in (o.get("payment_terms") or "").split("\n"):
        if line.strip():
            story.append(Paragraph(f"• {line.strip()}", st["BodyU"]))
    for title, key in [("VALIDADE DA PROPOSTA", "validity_text"), ("PRAZO DE MOBILIZAÇÃO", "mobilization_text"),
                       ("PRAZO DE ENTREGA / INÍCIO", "delivery_text"), ("IMPOSTOS", "taxes_text")]:
        if o.get(key):
            story.append(KeepTogether([_H(title, st), Paragraph(o[key], st["Body"])]))

    # ---- Fecho + assinaturas
    story += [Spacer(1, 10 * mm), Paragraph("ATENCIOSAMENTE,", st["Body"]), Spacer(1, 14 * mm)]
    sig = Table([
        ["_" * 38, "_" * 38],
        [Paragraph(f"<b>{company.get('responsible_name', '')}</b><br/>{company.get('responsible_title', '')}<br/>{company.get('responsible_phone', '')}", st["Cap"]),
         Paragraph(f"<b>ACEITE DO CLIENTE</b><br/>{c.get('name', '')}<br/>Data: ____/____/______", st["Cap"])],
    ], colWidths=[87 * mm, 87 * mm])
    sig.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(KeepTogether([sig]))

    decor = _page_decor(company, logo_bytes)
    doc.build(story, onFirstPage=decor, onLaterPages=decor)
    return buf.getvalue()


def build_conclusao_pdf(o: dict, company: dict, logo_bytes, photos: list) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    doc = _doc(buf, f"Relatorio de Conclusao {o.get('code', '')}")
    c = o.get("client") or {}
    story = [Spacer(1, 4 * mm), Paragraph("RELATÓRIO DE CONCLUSÃO DE SERVIÇOS", st["TitleP"])]
    story.append(_kv_table([
        ("Proposta n.º:", f"<b>{o.get('code', '')}</b>  ·  Data base {_date_br(o.get('base_date'))}"),
        ("Cliente:", f"{c.get('name', '')}" + (f" · {c.get('document')}" if c.get("document") else "")),
        ("Contato:", " · ".join([x for x in [c.get("contact"), c.get("phone"), c.get("email")] if x])),
        ("Local:", o.get("location") or c.get("address") or ""),
        ("Objeto:", o.get("objeto") or ""),
        ("Período de execução:", f"{_date_br(o.get('started_at'))} a {_date_br(o.get('finished_at'))}"),
        ("Executado por:", o.get("executed_by") or company.get("legal_name", "")),
    ], st, col1=40 * mm))

    kp = [["Mão de obra", "Materiais", "Total geral"], [brl(o.get("labor_total")), brl(o.get("material_total")), brl(o.get("grand_total"))]]
    kt = Table(kp, colWidths=[58 * mm] * 3)
    kt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), DARK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("FONTNAME", (0, 0), (-1, -1), "Helvetica-Bold"),
                            ("FONTSIZE", (0, 0), (-1, 0), 8.5), ("FONTSIZE", (0, 1), (-1, 1), 12), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                            ("BOX", (0, 0), (-1, -1), 0.6, DARK), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D1D5DB")),
                            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    story += [Spacer(1, 5 * mm), kt]

    scope = o.get("scope_items") or []
    if scope:
        story.append(_H("SERVIÇOS EXECUTADOS (ESCOPO)", st))
        rows = [[Paragraph(str(i), st["CellB"]), Paragraph(s, st["Cell"]), Paragraph("✔ concluído", st["Cell"])] for i, s in enumerate(scope, start=1)]
        t = Table(rows, colWidths=[10 * mm, 134 * mm, 30 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -1), 0.2, colors.HexColor("#E5E7EB")),
                               ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
        story.append(t)
    if o.get("labor_items"):
        story += [_H("MÃO DE OBRA APLICADA", st), _items_table(o["labor_items"], st, "labor")]
    if o.get("material_items"):
        story += [_H("MATERIAIS APLICADOS", st), _items_table(o["material_items"], st, "material")]
    if o.get("completion_notes"):
        story += [_H("OBSERVAÇÕES DA EXECUÇÃO", st), Paragraph(o["completion_notes"].replace("\n", "<br/>"), st["Body"])]

    antes = [p for p in photos if p.get("kind") == "antes"]
    depois = [p for p in photos if p.get("kind") == "depois"]
    servico = [p for p in photos if p.get("kind") == "servico"]
    croquis = [p for p in photos if p.get("kind") == "croqui"]
    if antes or depois or servico:
        story += [PageBreak(), _H("REGISTRO FOTOGRÁFICO", st)]
        for title, lst in [("Antes", antes), ("Durante / serviço", servico), ("Depois", depois)]:
            if lst:
                story.append(Paragraph(title, st["HL"]))
                g = _photo_grid(lst, st)
                if g:
                    story += [g, Spacer(1, 3 * mm)]
    if croquis:
        story += [PageBreak(), _H("CROQUI / DESENHO DO SERVIÇO", st)]
        for p in croquis:
            try:
                img = Image(io.BytesIO(p["bytes"]))
                img._restrictSize(170 * mm, 120 * mm)
                story += [img, Paragraph(p.get("caption") or "Croqui", st["Cap"]), Spacer(1, 4 * mm)]
            except Exception:
                continue

    story += [Spacer(1, 12 * mm)]
    sig = Table([
        ["_" * 38, "_" * 38],
        [Paragraph(f"<b>{company.get('responsible_name', '')}</b><br/>{company.get('legal_name', '')}<br/>{company.get('responsible_phone', '')}", st["Cap"]),
         Paragraph(f"<b>RECEBIDO / ACEITE DO CLIENTE</b><br/>{c.get('name', '')}<br/>Data: ____/____/______", st["Cap"])],
    ], colWidths=[87 * mm, 87 * mm])
    sig.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(KeepTogether([sig]))
    decor = _page_decor(company, logo_bytes)
    doc.build(story, onFirstPage=decor, onLaterPages=decor)
    return buf.getvalue()
