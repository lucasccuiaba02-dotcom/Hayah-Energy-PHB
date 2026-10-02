"""Corta cada página da tabela em tiras de até N linhas (nas linhas horizontais da grade) para transcrição por visão-LLM.
Saída: data/strips/pXX_sYY.png + data/strips/index.json [{file, page, rows}]."""
import json
import os
import sys

import numpy as np
from PIL import Image

PAGES_DIR = "/app/backend/data/pages"
OUT = "/app/backend/data/strips"
ROWS_PER_STRIP = int(sys.argv[1]) if len(sys.argv) > 1 else 20


def hlines(im):
    a = np.array(im.convert("L")) < 110
    w = a.shape[1]
    counts = a.sum(axis=1)
    idx = [i for i in range(len(counts)) if counts[i] > w * 0.55]
    groups = []
    for c in idx:
        if not groups or c - groups[-1][-1] > 2:
            groups.append([c])
        else:
            groups[-1].append(c)
    return [int(np.mean(g)) for g in groups]


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for pno in range(1, 11):
        im = Image.open(os.path.join(PAGES_DIR, f"p{pno:02d}.png"))
        hl = hlines(im)
        # linhas de dados = intervalos entre linhas horizontais com altura típica (18..60 px na imagem 3x)
        rows = [(hl[i], hl[i + 1]) for i in range(len(hl) - 1) if 18 <= hl[i + 1] - hl[i] <= 70]
        # descarta a 1ª faixa se for o cabeçalho (mais alta) — cabeçalho tem ~2 linhas de texto; aqui filtramos por altura já
        w, h = im.size
        s = 0
        for start in range(0, len(rows), ROWS_PER_STRIP):
            chunk = rows[start:start + ROWS_PER_STRIP]
            y0, y1 = chunk[0][0] - 2, chunk[-1][1] + 2
            strip = im.crop((0, max(0, y0), w, min(h, y1)))
            fn = f"p{pno:02d}_s{s:02d}.png"
            strip.save(os.path.join(OUT, fn), optimize=True)
            index.append({"file": fn, "page": pno, "rows": len(chunk), "y0": y0, "y1": y1})
            s += 1
        print(f"page {pno}: {len(rows)} data rows → {s} strips (hlines={len(hl)})")
    json.dump(index, open(os.path.join(OUT, "index.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
