import glob, json, os, re, sys

BASE = os.path.dirname(__file__)
UPS_VALUE = 91.61
UPS_VALUE_LV = 251.61
index = {e["file"].replace(".png", ""): e["rows"] for e in json.load(open(f"{BASE}/strips/index.json"))}


def num(s):
    s = (s or "").strip().replace("R$", "").replace(" ", "")
    if not s:
        return None
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def check(path):
    name = os.path.basename(path).replace(".tsv", "")
    rows = [l.rstrip("\n") for l in open(path, encoding="utf-8") if l.strip()]
    problems = []
    expected = index.get(name)
    if expected is not None and len(rows) != expected:
        problems.append(f"row count {len(rows)} != expected {expected}")
    for i, line in enumerate(rows, 1):
        cells = line.split("\t")
        if len(cells) != 6:
            problems.append(f"L{i}: {len(cells)} cols -> {line[:60]}")
            continue
        code, desc, unit, action, ups, price = [c.strip() for c in cells]
        if not re.fullmatch(r"\d{4,5}", code):
            problems.append(f"L{i}: bad code {code!r}")
        if action.upper() not in ("INSTALAR", "RETIRAR"):
            problems.append(f"L{i}: bad action {action!r}")
        u, p = num(ups), num(price)
        factor = UPS_VALUE if int(name[1:3]) <= 6 else UPS_VALUE_LV
        if u is None or p is None:
            problems.append(f"L{i}: bad numbers {ups!r} {price!r}")
        elif abs(u * factor - p) > 0.02 * max(1, p) + 0.06:
            problems.append(f"L{i}: {code} ups {ups} x {factor} = {u*factor:.2f} != price {price}")
    return len(rows), problems


if __name__ == "__main__":
    files = sorted(glob.glob(f"{BASE}/strips_tsv/*.tsv"))
    total = 0
    bad = 0
    for f in files:
        n, probs = check(f)
        total += n
        if probs:
            bad += 1
            print(f"== {os.path.basename(f)} ({n} rows)")
            for p in probs:
                print("   ", p)
    print(f"files={len(files)} rows={total} files_with_problems={bad}")
    missing = [k for k in index if not os.path.exists(f"{BASE}/strips_tsv/{k}.tsv")]
    print("missing strips:", missing)
