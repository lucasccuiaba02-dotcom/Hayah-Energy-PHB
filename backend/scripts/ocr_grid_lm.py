"""OCR célula-a-célula da Tabela de Preços LM (scan 640px): detecta a grade (linhas verticais/horizontais), recorta cada célula,
amplia e roda tesseract (dígitos p/ CÓDIGO, UPS, VALOR; texto p/ UNIDADE/OPERAÇÃO/DESCRIÇÃO).
Saída: data/grid/pXX.json com rows [{code, unit, oper, ups, value, desc_ocr, ok}]."""
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageFilter, ImageOps

UPS_LM = 91.61
PAGES_DIR = "/app/backend/data/pages"
OUT_DIR = "/app/backend/data/grid"


def _lines(mask_counts, length, min_frac, gap=3):
    idx = [i for i in range(len(mask_counts)) if mask_counts[i] > length * min_frac]
    groups = []
    for c in idx:
        if not groups or c - groups[-1][-1] > gap:
            groups.append([c])
        else:
            groups[-1].append(c)
    return [int(np.mean(g)) for g in groups]


def _ocr(img: Image.Image, digits: bool, scale: int = 4) -> str:
    w, h = img.size
    if w < 4 or h < 4:
        return ""
    img = img.resize((w * scale, h * scale), Image.LANCZOS)
    img = ImageOps.autocontrast(img, cutoff=1).filter(ImageFilter.UnsharpMask(radius=1.2, percent=150, threshold=2))
    img = img.point(lambda p: 255 if p > 150 else 0)
    img = ImageOps.expand(img, border=12, fill=255)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as fh:
        img.save(fh.name)
        args = ["tesseract", fh.name, "stdout", "-l", "por", "--psm", "7"]
        if digits:
            args += ["-c", "tessedit_char_whitelist=0123456789.,"]
        out = subprocess.run(args, capture_output=True, text=True).stdout
    os.unlink(fh.name)
    return out.strip()


def _num(s: str):
    s = re.sub(r"[^\d,\.]", "", s or "")
    if not s:
        return None
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return float(s)
    except ValueError:
        return None


def process_page(path: str):
    im = Image.open(path).convert("L")
    w, h = im.size
    a = np.array(im)
    dark = a < 110
    vlines = _lines(dark.sum(axis=0), h, 0.45)
    hlines = _lines(dark.sum(axis=1), w, 0.6, gap=2)
    # colunas: código | descrição | unidade | operação | ups | valor (ignora linhas espúrias muito próximas)
    vl = [vlines[0]]
    for v in vlines[1:]:
        if v - vl[-1] > 40:
            vl.append(v)
    rows = []
    for i in range(len(hlines) - 1):
        y0, y1 = hlines[i] + 2, hlines[i + 1] - 1
        if y1 - y0 < 14 or y1 - y0 > 90:
            continue
        cells = [(vl[k] + 2, vl[k + 1] - 2) for k in range(len(vl) - 1)]
        if len(cells) < 6:
            continue
        # última = valor, penúltima = ups, antepenúltima = operação, anterior = unidade; primeira = código; segunda = descrição
        c_code, c_desc = cells[0], cells[1]
        c_unit, c_oper, c_ups, c_val = cells[-4], cells[-3], cells[-2], cells[-1]
        crop = lambda c: im.crop((c[0], y0, c[1], y1))  # noqa: E731
        code = re.sub(r"\D", "", _ocr(crop(c_code), True))
        if not code:
            continue
        ups_s, val_s = _ocr(crop(c_ups), True), _ocr(crop(c_val), True)
        ups, val = _num(ups_s), _num(val_s)
        unit = _ocr(crop(c_unit), False).upper()
        oper = _ocr(crop(c_oper), False).upper()
        desc = _ocr(crop(c_desc), False, scale=3)
        exp = round(ups * UPS_LM, 2) if ups is not None else None
        ok = exp is not None and val is not None and abs(val - exp) <= max(0.06, 0.012 * exp)
        rows.append({"y": y0, "code": code, "unit": unit, "oper": oper, "ups": ups, "ups_raw": ups_s, "value": val, "value_raw": val_s,
                     "expected": exp, "ok": ok, "desc_ocr": desc})
    return rows, {"vlines": vl, "hlines": len(hlines)}


def main(pages):
    os.makedirs(OUT_DIR, exist_ok=True)
    for pno in pages:
        path = os.path.join(PAGES_DIR, f"p{pno:02d}.png")
        rows, meta = process_page(path)
        ok = sum(1 for r in rows if r["ok"])
        json.dump({"rows": rows, "meta": meta}, open(os.path.join(OUT_DIR, f"p{pno:02d}.json"), "w"), ensure_ascii=False, indent=1)
        print(f"page {pno}: rows={len(rows)} ok={ok} bad={len(rows) - ok} vlines={meta['vlines']}", flush=True)


if __name__ == "__main__":
    main([int(x) for x in sys.argv[1:]] or list(range(1, 11)))
