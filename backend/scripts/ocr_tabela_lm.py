"""OCR da Tabela de Preços Linha Morta (Energisa, Anexo 06) → JSON de serviços {code, description, unit, operation, ups, value}.
Validação: value ≈ ups × UPS_LM (91,61). Uso: python3 ocr_tabela_lm.py <pdf> <out.json>"""
import json
import re
import subprocess
import sys
import tempfile

import pymupdf

UPS_LM = 91.61
UNITS = {"UN", "KM", "HEC", "M.LINEAR", "CONS", "PEÇ", "PEC", "CJ", "M", "M2", "M3", "KG", "TON", "DIA", "H", "HR", "VB", "VERBA", "LT", "ML"}
ROW_RE = re.compile(
    r"^\s*(?P<code>\d{4,6})\s+(?P<desc>.+?)\s+(?P<unit>UN|KM|HEC|M\.?\s?LINEAR|CONS|PE[ÇC]|CJ|M2|M3|M|KG|TON|DIA|HR?|VB|LT|ML)\s+(?P<op>INSTALAR|RETIRAR|INSTALAR/RETIRAR|SERVI[ÇC]O|OUTROS|TRANSPORTE|MANUTEN[ÇC][AÃ]O)\s+(?P<ups>[\d.,]+)\s+(?P<val>[\d.,]+)\s*$",
    re.IGNORECASE)


def _num(s: str) -> float:
    s = s.strip().replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def ocr_page(page, dpi=300) -> str:
    pix = page.get_pixmap(dpi=dpi)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
        pix.save(fh.name)
        out = subprocess.run(["tesseract", fh.name, "stdout", "-l", "por", "--psm", "6", "-c", "preserve_interword_spaces=1"], capture_output=True, text=True)
    return out.stdout


def parse(text: str, page_no: int):
    rows, rejects = [], []
    for raw in text.splitlines():
        line = re.sub(r"[|]", " ", raw).strip()
        if not line or not re.match(r"^\d{4,6}\s", line):
            continue
        line = re.sub(r"\s{2,}", "  ", line)
        m = ROW_RE.match(line)
        if not m:
            rejects.append({"page": page_no, "line": line})
            continue
        ups, val = _num(m["ups"]), _num(m["val"])
        unit = m["unit"].upper().replace(" ", "")
        unit = {"PEC": "PEÇ", "M.LINEAR": "M.LINEAR", "MLINEAR": "M.LINEAR"}.get(unit, unit)
        rows.append({"page": page_no, "code": m["code"], "description": re.sub(r"\s+", " ", m["desc"]).strip(), "unit": unit, "operation": m["op"].upper(),
                     "ups": ups, "value": val, "expected": round(ups * UPS_LM, 2) if ups == ups else None})
    return rows, rejects


def main(pdf_path: str, out_path: str):
    doc = pymupdf.open(pdf_path)
    all_rows, all_rejects = [], []
    for i, page in enumerate(doc):
        text = ocr_page(page)
        rows, rejects = parse(text, i + 1)
        all_rows += rows
        all_rejects += rejects
        print(f"page {i + 1}: {len(rows)} rows, {len(rejects)} rejects", file=sys.stderr)
    for r in all_rows:
        exp = r["expected"]
        r["ok"] = exp is not None and r["value"] == r["value"] and abs(r["value"] - exp) <= max(0.05, 0.015 * exp)
    json.dump({"rows": all_rows, "rejects": all_rejects}, open(out_path, "w"), ensure_ascii=False, indent=1)
    ok = sum(1 for r in all_rows if r["ok"])
    print(f"TOTAL rows={len(all_rows)} ok={ok} mismatch={len(all_rows) - ok} rejects={len(all_rejects)}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
