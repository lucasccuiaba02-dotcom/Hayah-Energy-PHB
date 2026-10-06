"""Out/2026 · Marca branca: nome exibido nas telas/PDFs (cache em memória; atualizado por licenca.py)."""
_BRAND = {"app_name": "Hayah Energy", "company_name": "", "tagline": "ENERGY", "logo_data_url": ""}


def brand_name() -> str:
    return _BRAND.get("app_name") or "Hayah Energy"


def brand() -> dict:
    return dict(_BRAND)


def set_brand(doc: dict | None) -> None:
    for k in _BRAND:
        if doc and doc.get(k) is not None:
            _BRAND[k] = doc.get(k) or ("Hayah Energy" if k == "app_name" else "")
