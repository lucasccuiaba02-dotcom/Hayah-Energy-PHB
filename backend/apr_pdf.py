"""Fev/2026 · Gerador do PDF da APR (Análise Preliminar de Risco).
Fiel ao modelo físico anexado pelo usuário: cabeçalho + checklists de EPI/EPC/Riscos +
procedimentos (Sim/Não/N/A) + medidas de controle não pré-identificadas + observações
+ bloco de assinaturas (com imagens de assinatura em base64 vindas do canvas).
"""
import io
import base64
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak,
)
from apr_pdf_constants import EPI_ITEMS, EPC_ITEMS, RISK_ITEMS, PROCEDIMENTOS


def _styles():
    ss = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=12, alignment=1),
        "h": ParagraphStyle("h", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=8, textColor=colors.white, alignment=1),
        "cell": ParagraphStyle("c", parent=ss["Normal"], fontName="Helvetica", fontSize=7, leading=9),
        "cellb": ParagraphStyle("cb", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=7, leading=9),
        "small": ParagraphStyle("s", parent=ss["Normal"], fontName="Helvetica", fontSize=6.5, leading=8),
    }


def _sig_img(data_url: str, w_mm=38, h_mm=14):
    if not data_url or "," not in data_url:
        return ""
    try:
        header, b64 = data_url.split(",", 1)
        raw = base64.b64decode(b64)
        img = Image(io.BytesIO(raw), width=w_mm * mm, height=h_mm * mm)
        img.hAlign = "CENTER"
        return img
    except Exception:
        return ""


def _cb(checked: bool) -> str:
    return "☒" if checked else "☐"


def _yna(val: str) -> str:
    """Renderiza os 3 checkboxes Sim/Não/N.A com o correto marcado."""
    v = (val or "").lower()
    parts = []
    for opt, label in (("sim", "Sim"), ("nao", "Não"), ("na", "N/A")):
        parts.append(f"{'☒' if v == opt else '☐'} {label}")
    return "  ".join(parts)


def build_apr_pdf(apr: dict, project: dict, team: dict | None = None) -> bytes:
    S = _styles()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=8 * mm, bottomMargin=8 * mm,
        title=f"APR {apr.get('os_number', '')}",
    )
    story = []
    H = apr.get("header", {}) or {}
    line_type = apr.get("line_type", "morta")  # 'viva' | 'morta'

    # ── Cabeçalho ───────────────────────────────────────────────────────────
    header_data = [
        [Paragraph("<b>ANÁLISE PRELIMINAR DE RISCO — OBRAS</b>", S["title"]),
         Paragraph(f"<b>LINHA {'VIVA' if line_type == 'viva' else 'MORTA'}</b>", S["title"])],
    ]
    t = Table(header_data, colWidths=[135 * mm, 55 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
        ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#FF003C") if line_type == "viva" else colors.HexColor("#00795c")),
        ("TEXTCOLOR", (1, 0), (1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # ── Identificação ───────────────────────────────────────────────────────
    ident_rows = [
        ["Data:", H.get("date", ""), "OS Nº:", H.get("os_number", "") or apr.get("os_number", "")],
        ["Tarefa:", H.get("task", ""), "Área:", H.get("area", "Rural")],
        ["Nº Equipe:", H.get("team_number", "") or (team.get("name") if team else ""),
         "Local:", H.get("location", "") or project.get("location", "")],
        ["Nº profissionais na tarefa:", str(H.get("professionals_count", "")),
         "Empresa:", H.get("company", "HAYAH ENERGY")],
    ]
    t = Table(ident_rows, colWidths=[38 * mm, 60 * mm, 30 * mm, 62 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eee")),
        ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#eee")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # ── EPIs e EPCs (duas colunas lado a lado) ──────────────────────────────
    epis = apr.get("epis", {}) or {}
    epcs = apr.get("epcs", {}) or {}
    epi_rows = [[Paragraph("<b>O QUE SERÁ UTILIZADO? — EPIs</b>", S["h"]),
                 Paragraph("<b>O QUE SERÁ UTILIZADO? — EPCs / Ferramentas</b>", S["h"])]]
    for i in range(max(len(EPI_ITEMS), len(EPC_ITEMS))):
        left = ""
        right = ""
        if i < len(EPI_ITEMS):
            k, lbl = EPI_ITEMS[i]
            left = f"{_cb(bool(epis.get(k)))} {lbl}"
        if i < len(EPC_ITEMS):
            k, lbl = EPC_ITEMS[i]
            right = f"{_cb(bool(epcs.get(k)))} {lbl}"
        epi_rows.append([left, right])
    # Others
    epi_rows.append([f"Outros EPI: {epis.get('outros', '') or '_'*30}",
                     f"Outros: {epcs.get('outros', '') or '_'*30}"])
    t = Table(epi_rows, colWidths=[95 * mm, 95 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # ── Riscos Potenciais ──────────────────────────────────────────────────
    riscos = apr.get("riscos", {}) or {}
    risco_rows = [[Paragraph("<b>RISCOS POTENCIAIS</b>", S["h"])]]
    for row_start in range(0, len(RISK_ITEMS), 3):
        chunk = RISK_ITEMS[row_start:row_start + 3]
        cells = " ".join(f"{_cb(bool(riscos.get(k)))} {lbl}" for k, lbl in chunk)
        risco_rows.append([cells])
    risco_rows.append([f"Outros riscos: {riscos.get('outros', '') or '_'*80}"])
    t = Table(risco_rows, colWidths=[190 * mm])
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # ── Procedimentos preliminares (28 perguntas Sim/Não/N.A) ───────────────
    proc = apr.get("procedimentos", {}) or {}
    proc_data = [[Paragraph("<b>PROCEDIMENTOS PRELIMINARES / MEDIDAS GERAIS DE CONTROLE</b>", S["h"]),
                  Paragraph("<b>RESPOSTA</b>", S["h"])]]
    for k, q in PROCEDIMENTOS:
        proc_data.append([Paragraph(q, S["small"]), Paragraph(_yna(proc.get(k)), S["small"])])
    t = Table(proc_data, colWidths=[145 * mm, 45 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # ── Medidas de controle não pré-identificadas + Observações ─────────────
    extra_rows = apr.get("medidas_extra", []) or []
    if not extra_rows:
        extra_rows = [{"etapa": "", "risco": "", "medida": ""}]
    mc = [[Paragraph("<b>ETAPA DA ATIVIDADE</b>", S["h"]),
           Paragraph("<b>RISCOS</b>", S["h"]),
           Paragraph("<b>MEDIDAS DE CONTROLE</b>", S["h"])]]
    for r in extra_rows[:6]:
        mc.append([r.get("etapa", ""), r.get("risco", ""), r.get("medida", "")])
    while len(mc) < 5:
        mc.append(["", "", ""])
    t = Table(mc, colWidths=[55 * mm, 65 * mm, 70 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 7),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(t)
    story.append(Spacer(1, 2 * mm))

    # Observações gerais
    obs = apr.get("observacoes", "")
    ob = Table([[Paragraph("<b>OBSERVAÇÕES GERAIS</b>", S["h"])], [Paragraph(obs or "&nbsp;", S["small"])]],
               colWidths=[190 * mm])
    ob.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (0, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("TOPPADDING", (0, 1), (-1, 1), 8), ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
    ]))
    story.append(ob)
    story.append(Spacer(1, 3 * mm))

    # ── Bloco de assinaturas ────────────────────────────────────────────────
    sup = apr.get("supervisor", {}) or {}
    execs = apr.get("executores", []) or []
    sig_rows = [
        [Paragraph("<b>SUPERVISOR DA ATIVIDADE</b>", S["h"]),
         Paragraph("<b>MATRÍCULA</b>", S["h"]),
         Paragraph("<b>NOME</b>", S["h"]),
         Paragraph("<b>ASSINATURA</b>", S["h"])],
        [Paragraph("Encarregado", S["cell"]),
         Paragraph(sup.get("matricula", ""), S["cell"]),
         Paragraph(sup.get("nome", ""), S["cellb"]),
         _sig_img(sup.get("assinatura", "")) or ""],
    ]
    for i, ex in enumerate(execs[:8]):
        sig_rows.append([
            Paragraph(f"Executor {i+1}", S["cell"]),
            Paragraph(ex.get("matricula", ""), S["cell"]),
            Paragraph(ex.get("nome", ""), S["cellb"]),
            _sig_img(ex.get("assinatura", "")) or "",
        ])
    while len(sig_rows) < 6:
        sig_rows.append([Paragraph(f"Executor {len(sig_rows)-1}", S["cell"]), "", "", ""])
    t = Table(sig_rows, colWidths=[35 * mm, 25 * mm, 65 * mm, 65 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.black),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("MINROWHEIGHT", (0, 0), (-1, -1), 16 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(t)

    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        f"<font size=6 color='#666'>Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} · "
        f"HAYAH ENERGY · Obra: {project.get('name', '')} ({project.get('project_code', '') or '—'})</font>",
        S["small"],
    ))

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()
