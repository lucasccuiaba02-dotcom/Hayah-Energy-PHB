"""Relatório de Avanço Físico (PDF) — obras de ticket grande. Set/2026.
Curva S desenhada com reportlab.graphics (sem matplotlib)."""
import io
from datetime import datetime, timezone, timedelta
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, Image
from reportlab.graphics.shapes import Drawing, Rect, String, Line
from reportlab.graphics.charts.lineplots import LinePlot
from reportlab.graphics.widgets.markers import makeMarker

BLACK = colors.HexColor("#111827")
INK = colors.HexColor("#1f2937")
MUTED = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#9ca3af")
LIGHT = colors.HexColor("#f3f4f6")
HEADER_BG = colors.HexColor("#0f172a")
GREEN = colors.HexColor("#15803d")
GREEN_HL = colors.HexColor("#bbf7d0")
YELLOW = colors.HexColor("#ca8a04")
YELLOW_HL = colors.HexColor("#fef08a")
RED = colors.HexColor("#b91c1c")
RED_HL = colors.HexColor("#fecaca")
BLUE = colors.HexColor("#0369a1")

STATUS_LABEL = {
    "aguardando_programacao": "Aguardando Programação", "programado": "Programado", "em_execucao": "Em Execução",
    "a_reprogramar": "A Reprogramar", "executada": "Executada", "concluido": "Concluído", "suspenso": "Suspenso", "cancelado": "Cancelado",
}


def _S():
    return {
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=15, textColor=colors.white, leading=17),
        "sub": ParagraphStyle("s", fontName="Helvetica", fontSize=8.5, textColor=colors.white, leading=10, alignment=TA_RIGHT),
        "sec": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=9, textColor=colors.white, leading=11),
        "cell": ParagraphStyle("c", fontName="Helvetica", fontSize=8.5, textColor=INK, leading=10.5),
        "cellb": ParagraphStyle("cb", fontName="Helvetica-Bold", fontSize=8.5, textColor=INK, leading=10.5),
        "cellr": ParagraphStyle("cr", fontName="Helvetica", fontSize=8.5, textColor=INK, leading=10.5, alignment=TA_RIGHT),
        "kpi_l": ParagraphStyle("kl", fontName="Helvetica", fontSize=7, textColor=MUTED, leading=8.5, alignment=TA_CENTER),
        "kpi_v": ParagraphStyle("kv", fontName="Helvetica-Bold", fontSize=15, textColor=INK, leading=17, alignment=TA_CENTER),
        "kpi_s": ParagraphStyle("ks", fontName="Helvetica", fontSize=6.8, textColor=MUTED, leading=8, alignment=TA_CENTER),
        "small": ParagraphStyle("sm", fontName="Helvetica", fontSize=7.5, textColor=MUTED, leading=9.5),
        "th": ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=7.5, textColor=colors.white, leading=9),
        "thr": ParagraphStyle("thr", fontName="Helvetica-Bold", fontSize=7.5, textColor=colors.white, leading=9, alignment=TA_RIGHT),
    }


def _brl(v):
    return "R$ " + f"{float(v or 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _dt(s):
    s = (s or "")[:10]
    return "/".join(reversed(s.split("-"))) if s else "—"


def _pct(v):
    return "—" if v is None else f"{v:.1f}%".replace(".", ",")


def _section(title, S, width=186 * mm):
    return Table([[Paragraph(title, S["sec"])]], colWidths=[width], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), HEADER_BG), ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3), ("BOX", (0, 0), (-1, -1), 0.7, BLACK)]))


def _eff_colors(e):
    if e is None:
        return LIGHT, MUTED
    if e >= 1:
        return GREEN_HL, GREEN
    if e >= 0.8:
        return YELLOW_HL, YELLOW
    return RED_HL, RED


def _bar(pct, width=40 * mm, height=4.5 * mm, color=GREEN):
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=LIGHT, strokeColor=BORDER, strokeWidth=0.4))
    w = max(0.0, min(100.0, float(pct or 0))) / 100.0 * width
    if w > 0:
        d.add(Rect(0, 0, w, height, fillColor=color, strokeColor=None))
    return d


def _curve_drawing(curve, width=186 * mm, height=56 * mm):
    """Curva S: planejado (azul tracejado) × realizado (verde)."""
    pts = [c for c in curve if c.get("date")]
    if len(pts) < 2:
        d = Drawing(width, 12 * mm)
        d.add(String(4, 4, "Sem dados suficientes para a Curva S (defina 1ª data programada e Data Vencimento).", fontName="Helvetica", fontSize=8, fillColor=MUTED))
        return d
    dates = [c["date"] for c in pts]
    x0 = datetime.fromisoformat(dates[0])
    xs = [(datetime.fromisoformat(dd) - x0).days for dd in dates]
    planned = [(x, float(c["planned_pct"])) for x, c in zip(xs, pts)]
    real = [(x, float(c["real_pct"])) for x, c in zip(xs, pts) if c.get("real_pct") is not None]
    d = Drawing(width, height)
    lp = LinePlot()
    lp.x, lp.y, lp.width, lp.height = 14 * mm, 9 * mm, width - 20 * mm, height - 14 * mm
    lp.data = [planned, real if real else [(xs[0], 0.0)]]
    lp.lines[0].strokeColor = BLUE
    lp.lines[0].strokeWidth = 1.2
    lp.lines[0].strokeDashArray = [3, 2]
    lp.lines[1].strokeColor = GREEN
    lp.lines[1].strokeWidth = 2.2
    lp.lines[1].symbol = makeMarker("FilledCircle")
    lp.lines[1].symbol.size = 3.5
    lp.lines[1].symbol.fillColor = GREEN
    lp.xValueAxis.valueMin, lp.xValueAxis.valueMax = xs[0], max(xs[-1], xs[0] + 1)
    lp.yValueAxis.valueMin, lp.yValueAxis.valueMax, lp.yValueAxis.valueStep = 0, 100, 25
    lp.yValueAxis.labelTextFormat = "%d%%"
    lp.yValueAxis.labels.fontSize = 6.5
    lp.xValueAxis.labels.fontSize = 6.5
    lp.xValueAxis.labels.angle = 0
    step = max(1, (xs[-1] - xs[0]) // 6 or 1)
    lp.xValueAxis.valueSteps = sorted(set(list(range(xs[0], xs[-1] + 1, step)) + [xs[-1]]))
    lp.xValueAxis.labelTextFormat = lambda v: (x0 + timedelta(days=int(v))).strftime("%d/%m")
    lp.yValueAxis.visibleGrid = True
    lp.yValueAxis.gridStrokeColor = colors.HexColor("#e5e7eb")
    d.add(lp)
    d.add(Line(width - 60 * mm, height - 4 * mm, width - 52 * mm, height - 4 * mm, strokeColor=BLUE, strokeWidth=1.2, strokeDashArray=[3, 2]))
    d.add(String(width - 50 * mm, height - 5.2 * mm, "Planejado", fontName="Helvetica", fontSize=7, fillColor=INK))
    d.add(Line(width - 30 * mm, height - 4 * mm, width - 22 * mm, height - 4 * mm, strokeColor=GREEN, strokeWidth=2.2))
    d.add(String(width - 20 * mm, height - 5.2 * mm, "Realizado", fontName="Helvetica", fontSize=7, fillColor=INK))
    return d


def build_avanco_pdf(project: dict, detail: dict, photos: list | None = None) -> bytes:
    S = _S()
    s = detail["summary"]
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=8 * mm, bottomMargin=14 * mm,
                            title=f"Avanço Físico — {project.get('name', '')}")
    story = []
    generated_at = datetime.now(timezone.utc).astimezone().strftime("%d/%m/%Y %H:%M")

    hdr = Table([[Paragraph("<b>HAYAH ENERGY</b>", S["title"]),
                  Paragraph(f"<b>RELATÓRIO DE AVANÇO FÍSICO</b><br/>Obra de ticket grande · Emitido em {generated_at}", S["sub"])]],
                colWidths=[90 * mm, 96 * mm])
    hdr.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), HEADER_BG), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                             ("LEFTPADDING", (0, 0), (0, 0), 10), ("RIGHTPADDING", (1, 0), (1, 0), 10),
                             ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6), ("BOX", (0, 0), (-1, -1), 1.0, BLACK)]))
    story += [hdr, Spacer(1, 3 * mm), _section("IDENTIFICAÇÃO DA OBRA", S)]

    kv = [
        [Paragraph("<b>Código</b>", S["cellb"]), Paragraph(project.get("project_code") or "—", S["cell"]),
         Paragraph("<b>Status</b>", S["cellb"]), Paragraph(STATUS_LABEL.get(s.get("execution_status"), s.get("execution_status") or "—"), S["cell"])],
        [Paragraph("<b>Obra</b>", S["cellb"]), Paragraph(project.get("name") or "—", S["cell"]),
         Paragraph("<b>Equipe</b>", S["cellb"]), Paragraph(project.get("team_name") or "—", S["cell"])],
        [Paragraph("<b>Localidade</b>", S["cellb"]), Paragraph(project.get("location") or "—", S["cell"]),
         Paragraph("<b>Período</b>", S["cellb"]), Paragraph(f"{_dt(s.get('start'))} → {_dt(s.get('end'))}" + (f" ({s.get('total_days')} dias)" if s.get("total_days") else ""), S["cell"])],
        [Paragraph("<b>Valor programado</b>", S["cellb"]), Paragraph(_brl(s.get("programmed_value")), S["cell"]),
         Paragraph("<b>Produção realizada</b>", S["cellb"]), Paragraph(_brl(s.get("actual_value")), S["cell"])],
    ]
    t = Table(kv, colWidths=[36 * mm, 60 * mm, 34 * mm, 56 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), LIGHT), ("BACKGROUND", (2, 0), (2, -1), LIGHT), ("BOX", (0, 0), (-1, -1), 0.7, BLACK),
                           ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5), ("LEFTPADDING", (0, 0), (-1, -1), 6)]))
    story += [t, Spacer(1, 4 * mm), _section("INDICADORES DE DESEMPENHO", S)]

    eff_bg, eff_fg = _eff_colors(s.get("eficiencia"))
    eff_txt = "—" if s.get("eficiencia") is None else f"{s['eficiencia']:.2f}".replace(".", ",")
    eff_hint = "sem prazo definido" if s.get("eficiencia") is None else ("no ritmo" if s["eficiencia"] >= 1 else "atenção" if s["eficiencia"] >= 0.8 else "crítico")
    kpis = [
        ("% FÍSICO", _pct(s.get("pct_fisico")), f"{s.get('items_count', 0)} item(ns) · {s.get('entries_count', 0)} lançamento(s)"),
        ("% FINANCEIRO", _pct(s.get("pct_financeiro")), "produção ÷ programado"),
        ("% TEMPO", _pct(s.get("pct_tempo")), f"{s.get('dias_trabalhados', 0)} dia(s) trabalhado(s)"),
        ("EFICIÊNCIA", eff_txt, f"% físico ÷ % tempo · {eff_hint}"),
        ("R$ / DIA", _brl(s.get("produzido_por_dia")), f"meta {_brl(s.get('meta_diaria'))} · {_pct(s.get('aderencia_diaria'))}"),
    ]
    row_l = [Paragraph(l, S["kpi_l"]) for l, _, _ in kpis]
    row_v = [Paragraph(v, ParagraphStyle("kv2", parent=S["kpi_v"], textColor=(eff_fg if l == "EFICIÊNCIA" else INK))) for l, v, _ in kpis]
    row_s = [Paragraph(h, S["kpi_s"]) for _, _, h in kpis]
    kt = Table([row_l, row_v, row_s], colWidths=[37.2 * mm] * 5)
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.7, BLACK), ("INNERGRID", (0, 0), (-1, -1), 0.35, BORDER),
                            ("BACKGROUND", (3, 0), (3, -1), eff_bg), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("TOPPADDING", (0, 0), (-1, 0), 4), ("BOTTOMPADDING", (0, -1), (-1, -1), 4),
                            ("TOPPADDING", (0, 1), (-1, 1), 1), ("BOTTOMPADDING", (0, 1), (-1, 1), 1)]))
    story += [kt, Spacer(1, 4 * mm)]

    story += [KeepTogether([_section("CURVA S · PLANEJADO × REALIZADO", S), Spacer(1, 1.5 * mm), _curve_drawing(detail.get("curve") or [])]), Spacer(1, 4 * mm)]

    items = detail.get("items") or []
    story.append(_section("ITENS DE AVANÇO (QUANTITATIVOS E ETAPAS)", S))
    if not items:
        story.append(Paragraph("Nenhum quantitativo/etapa cadastrado para esta obra.", S["small"]))
    else:
        rows = [[Paragraph("Item", S["th"]), Paragraph("Un.", S["th"]), Paragraph("Planejado", S["thr"]), Paragraph("Executado", S["thr"]), Paragraph("Saldo", S["thr"]), Paragraph("Peso", S["thr"]), Paragraph("Avanço", S["th"]), Paragraph("%", S["thr"])]]
        for i in items:
            pct = float(i.get("pct") or 0)
            col = GREEN if pct >= 100 else YELLOW if pct >= 50 else RED
            rows.append([
                Paragraph(i.get("label", "") + (" <font color='#0369a1'>(etapa)</font>" if i.get("custom") else ""), S["cell"]),
                Paragraph(i.get("unit", ""), S["cell"]),
                Paragraph(f"{i.get('planned_qty', 0):g}", S["cellr"]), Paragraph(f"{i.get('executed_qty', 0):g}", S["cellr"]),
                Paragraph(f"{max(0.0, float(i.get('planned_qty', 0)) - float(i.get('executed_qty', 0))):g}", S["cellr"]),
                Paragraph(f"{i.get('weight', 1):g}", S["cellr"]), _bar(pct, color=col), Paragraph(_pct(pct), S["cellr"])])
        it = Table(rows, colWidths=[50 * mm, 11 * mm, 19 * mm, 19 * mm, 17 * mm, 11 * mm, 42 * mm, 17 * mm], repeatRows=1)
        it.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), HEADER_BG), ("BOX", (0, 0), (-1, -1), 0.7, BLACK), ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        story.append(it)
    story.append(Spacer(1, 4 * mm))

    mats = detail.get("materials") or []
    ms = s.get("materials") or {}
    story.append(_section(f"CONTROLE DE MATERIAIS · {ms.get('items', 0)} item(ns) · {_pct(ms.get('pct_delivered'))} entregue · {ms.get('pending_items', 0)} pendente(s) · lista {_brl(ms.get('total_value'))}", S))
    if not mats:
        story.append(Paragraph("Sem lista de materiais cadastrada nesta obra.", S["small"]))
    else:
        rows = [[Paragraph("Código", S["th"]), Paragraph("Descrição", S["th"]), Paragraph("Un.", S["th"]), Paragraph("Solicitado", S["thr"]), Paragraph("Entregue", S["thr"]), Paragraph("Aplicado", S["thr"]), Paragraph("Saldo campo", S["thr"]), Paragraph("% Entr.", S["thr"])]]
        style_extra = []
        for idx, m in enumerate(mats, start=1):
            saldo = float(m.get("qty_delivered") or 0) - float(m.get("qty_applied") or 0)
            rows.append([Paragraph(m.get("code") or "—", S["cell"]), Paragraph(m.get("item") or "—", S["cell"]), Paragraph(m.get("unit") or "", S["cell"]),
                         Paragraph(f"{float(m.get('qty_requested') or 0):g}", S["cellr"]), Paragraph(f"{float(m.get('qty_delivered') or 0):g}", S["cellr"]),
                         Paragraph(f"{float(m.get('qty_applied') or 0):g}", S["cellr"]), Paragraph(f"{saldo:g}", S["cellr"]), Paragraph(_pct(m.get("pct_delivered")), S["cellr"])])
            if float(m.get("pct_delivered") or 0) < 100:
                style_extra.append(("TEXTCOLOR", (4, idx), (4, idx), RED))
            if saldo < 0:
                style_extra.append(("BACKGROUND", (6, idx), (6, idx), RED_HL))
        mt = Table(rows, colWidths=[18 * mm, 68 * mm, 10 * mm, 18 * mm, 18 * mm, 18 * mm, 20 * mm, 16 * mm], repeatRows=1)
        mt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), HEADER_BG), ("BOX", (0, 0), (-1, -1), 0.7, BLACK), ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                                ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)] + style_extra))
        story.append(mt)
    story.append(Spacer(1, 4 * mm))

    # ── Registro fotográfico (fotos anexadas à obra) — 3 por linha ──────
    photo_cells = []
    for ph in (photos or []):
        try:
            img = Image(io.BytesIO(ph["bytes"]))
            img._restrictSize(58 * mm, 44 * mm)
            cap = Paragraph(ph.get("caption") or "Foto", ParagraphStyle("pc", parent=S["small"], alignment=TA_CENTER, fontSize=6.8, leading=8))
            inner = Table([[img], [cap]], colWidths=[60 * mm])
            inner.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.4, BORDER), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                                       ("BACKGROUND", (0, 1), (-1, 1), LIGHT), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
            photo_cells.append(inner)
        except Exception:
            continue
    if photo_cells:
        blocks = [_section(f"REGISTRO FOTOGRÁFICO · {len(photo_cells)} foto(s) anexada(s) à obra", S), Spacer(1, 1.5 * mm)]
        for i in range(0, len(photo_cells), 3):
            row = photo_cells[i:i + 3] + [""] * (3 - len(photo_cells[i:i + 3]))
            gt = Table([row], colWidths=[62 * mm] * 3)
            gt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 1), ("RIGHTPADDING", (0, 0), (-1, -1), 1),
                                    ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
            blocks.append(gt)
        story += [KeepTogether(blocks[:3]), *blocks[3:], Spacer(1, 4 * mm)]

    entries = list(detail.get("entries") or [])[:25]
    label = {i["key"]: (i.get("label"), i.get("unit", "")) for i in items}
    story.append(_section(f"HISTÓRICO DE LANÇAMENTOS · últimos {len(entries)} de {s.get('entries_count', 0)}", S))
    if not entries:
        story.append(Paragraph("Nenhum lançamento registrado.", S["small"]))
    else:
        rows = [[Paragraph("Data", S["th"]), Paragraph("Item", S["th"]), Paragraph("Qtd.", S["thr"]), Paragraph("Observação", S["th"]), Paragraph("Registrado por", S["th"])]]
        for e in entries:
            lb, un = label.get(e.get("item_key"), (e.get("item_key"), ""))
            rows.append([Paragraph(_dt(e.get("date")), S["cell"]), Paragraph(lb or "—", S["cell"]), Paragraph(f"{float(e.get('qty') or 0):g} {un}", S["cellr"]),
                         Paragraph(e.get("notes") or "—", S["cell"]), Paragraph(e.get("registered_by") or "—", S["cell"])])
        et = Table(rows, colWidths=[20 * mm, 42 * mm, 22 * mm, 66 * mm, 36 * mm], repeatRows=1)
        et.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), HEADER_BG), ("BOX", (0, 0), (-1, -1), 0.7, BLACK), ("INNERGRID", (0, 0), (-1, -1), 0.3, BORDER),
                                ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
                                ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)]))
        story.append(et)

    story += [Spacer(1, 5 * mm)]
    sig = Table([[Paragraph("_______________________________<br/>Responsável Hayah Energy", ParagraphStyle("sg", parent=S["cell"], alignment=TA_CENTER)),
                  Paragraph("_______________________________<br/>Fiscal / Cliente", ParagraphStyle("sg2", parent=S["cell"], alignment=TA_CENTER))]], colWidths=[93 * mm, 93 * mm])
    story.append(KeepTogether([sig, Spacer(1, 2 * mm),
                               Paragraph(f"Hayah Energy · Relatório gerado automaticamente pelo sistema em {generated_at}. % físico ponderado pelos pesos dos itens; eficiência = % físico ÷ % tempo decorrido.", S["small"])]))

    def _footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 12 * mm, 8 * mm, f"Página {d.page}")
        canvas.drawString(12 * mm, 8 * mm, f"{project.get('project_code') or ''} · {project.get('name') or ''}"[:110])
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
