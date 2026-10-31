"""Tesla configurator new prices (spec 022 R8). GATED.

Opens https://www.tesla.com/no_NO/model3/design with Playwright and extracts
trim names and prices. Until the terms check is recorded in
docs/cars/sources.md the adapter raises `SourceDisabled` unless the
environment sets `CARS_ALLOW_TESLA_SCRAPE=1`. It never runs in the web
container (`STATIC_DIR` set => disabled). Playwright is imported lazily, so
the parser is unit-testable on a stored HTML fixture without it.

The parser reads the trim/price pairs the page embeds as JSON
(`"name": ..., "price": ...` objects) and falls back to `data-trim-name` /
`data-price` attributes. The real page structure must be confirmed on the
first gated run; a parse that finds nothing fails the run loudly (zero rows).
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from ...engine.money import nok
from .. import SourceDisabled
from ..fetch import archive_bytes
from . import SourceContext, SourceOutput, stamp

SOURCE = "tesla_configurator"
URL = "https://www.tesla.com/no_NO/model3/design"
ENV_ALLOW = "CARS_ALLOW_TESLA_SCRAPE"
COLUMNS = (
    "make",
    "model",
    "trim_as_listed",
    "price_ore",
    "currency",
    "valid_from",
    "source_url",
    "snapshot_sha256",
    "ingested_on",
)
_JSON_PAIR = re.compile(
    r'"(?:trimName|trim_name|name)"\s*:\s*"(?P<name>[^"]{3,80})"[^{}]{0,400}?'
    r'"(?:price|basePrice|base_price|totalPrice)"\s*:\s*(?P<price>\d{5,8})'
)
_ATTR_PAIR = re.compile(
    r'data-trim-name="(?P<name>[^"]+)"[^>]*data-price="(?P<price>[\d\s.,]+)"', re.IGNORECASE
)


@dataclass(frozen=True)
class TrimPrice:
    name: str
    price_ore: int
    currency: str = "NOK"


def parse_configurator_html(text: str) -> list[TrimPrice]:
    found: dict[str, TrimPrice] = {}
    for m in _JSON_PAIR.finditer(text):
        name = html.unescape(m.group("name")).strip()
        if (
            "model" not in name.lower()
            and "range" not in name.lower()
            and "performance" not in name.lower()
        ):
            continue
        found.setdefault(name, TrimPrice(name, nok(Decimal(m.group("price")))))
    for m in _ATTR_PAIR.finditer(text):
        name = html.unescape(m.group("name")).strip()
        digits = re.sub(r"[^\d]", "", m.group("price"))
        if digits:
            found.setdefault(name, TrimPrice(name, nok(Decimal(digits))))
    return list(found.values())


def guard(env: dict[str, str]) -> None:
    if str(env.get("STATIC_DIR", "")).strip():
        raise SourceDisabled("tesla_configurator never runs in the web container (STATIC_DIR set)")
    if str(env.get(ENV_ALLOW, "")).strip() != "1":
        raise SourceDisabled("terms check pending; see docs/cars/sources.md")


def scrape(url: str = URL, timeout_ms: int = 45_000) -> str:
    """Rendered HTML of the configurator page via Playwright (chromium)."""
    from playwright.sync_api import sync_playwright  # lazy: ingestion extra

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(
                user_agent="LiveNear-cars/0.1 (+https://github.com/alex-g-davies/LiveNear)"
            )
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            return page.content()
        finally:
            browser.close()


def records(trims: list[TrimPrice], model: str, today_iso: str, url: str) -> list[dict[str, Any]]:
    return [
        {
            "make": "Tesla",
            "model": model,
            "trim_as_listed": t.name,
            "price_ore": t.price_ore,
            "currency": t.currency,
            "valid_from": today_iso,
            "source_url": url,
        }
        for t in trims
    ]


def run_source(ctx: SourceContext) -> SourceOutput:
    guard(ctx.env)
    text = scrape(URL)
    snap = archive_bytes(
        text.encode("utf-8"),
        source=SOURCE,
        raw_dir=ctx.raw_dir,
        url=URL,
        fetched_at=datetime.now(UTC),
        ext="html",
        r2_upload=ctx.r2_upload,
        r2_client=ctx.r2_client,
    )
    trims = parse_configurator_html(text)
    rows = stamp(records(trims, "Model 3", ctx.today.isoformat(), URL), snap, ctx.today)
    return SourceOutput(SOURCE, rows_in=len(rows), stored=rows, snapshot=snap, columns=COLUMNS)
