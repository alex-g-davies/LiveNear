"""Statens vegvesen vehicle data by registration number (spec 022 R8).

    GET https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata?kjennemerke=XX12345
    header SVV-Authorization: Apikey <CARS_VEGVESEN_API_KEY>

Open data (NLOD) with a personal key; the key is read from the environment
and never logged. Responses are cached on disk under
`<cache_dir>/vegvesen/<hashed reg>.json` (hash = `hash_listing_id("vegvesen", reg)`,
so no clear-text registration number appears on disk). Skipped cleanly when
the key is absent. Used as an enricher on listing rows that carry a
`reg_number` before the reconciler drops it.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import httpx

from ...data_bundle import hash_listing_id
from .. import SourceDisabled
from ..fetch import fetch
from . import SourceContext, SourceOutput

SOURCE = "vegvesen"
URL = "https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata"
ENV_KEY = "CARS_VEGVESEN_API_KEY"
COLUMNS = (
    "reg_hash",
    "first_reg_date",
    "power_kw",
    "fuel",
    "weight_kg",
    "cached",
    "snapshot_sha256",
    "ingested_on",
)


@dataclass(frozen=True)
class VehicleFacts:
    first_reg_date: str | None
    power_kw: int | None
    fuel: str | None
    weight_kg: int | None


def _dig(d: Any, *path: Any) -> Any:
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and len(d) > p:
            d = d[p]
        else:
            return None
    return d


def parse_kjoretoydata(doc: dict[str, Any]) -> VehicleFacts | None:
    items = doc.get("kjoretoydataListe") or []
    if not items:
        return None
    k = items[0]
    first = _dig(k, "forstegangsregistrering", "registrertForstegangNorgeDato") or _dig(
        k, "godkjenning", "forstegangsGodkjenning", "forstegangRegistrertDato"
    )
    tek = _dig(k, "godkjenning", "tekniskGodkjenning", "tekniskeData") or {}
    motors = _dig(tek, "motorOgDrivverk", "motor") or []
    power = None
    fuel = None
    for m in motors:
        p = m.get("maksNettoEffekt")
        if p is not None:
            power = max(power or 0, int(round(float(p))))
        for d in m.get("drivstoff") or []:
            name = _dig(d, "drivstoffKode", "kodeNavn")
            if name:
                fuel = str(name)
    weight = _dig(tek, "vekter", "egenvekt")
    return VehicleFacts(
        first_reg_date=str(first) if first else None,
        power_kw=power,
        fuel=fuel,
        weight_kg=int(weight) if weight is not None else None,
    )


def cache_path(cache_dir: Path, reg_number: str) -> Path:
    return Path(cache_dir) / SOURCE / f"{hash_listing_id('vegvesen', reg_number)}.json"


def lookup(
    reg_number: str,
    api_key: str,
    cache_dir: Path,
    raw_dir: Path,
    client: httpx.Client | None = None,
) -> tuple[VehicleFacts | None, bool, str]:
    """(facts, from_cache, snapshot sha). Caches the raw response by hashed reg."""
    reg = reg_number.strip().upper().replace(" ", "")
    cp = cache_path(cache_dir, reg)
    if cp.exists():
        cached = json.loads(cp.read_text(encoding="utf-8"))
        return parse_kjoretoydata(cached["doc"]), True, cached.get("sha256", "")
    snap = fetch(
        URL,
        SOURCE,
        raw_dir,
        params={"kjennemerke": reg},
        headers={"SVV-Authorization": f"Apikey {api_key}"},
        ext="json",
        client=client,
    )
    doc = json.loads(snap.read_text())
    cp.parent.mkdir(parents=True, exist_ok=True)
    cp.write_text(json.dumps({"sha256": snap.sha256, "doc": doc}), encoding="utf-8")
    return parse_kjoretoydata(doc), False, snap.sha256


def make_enricher(ctx: SourceContext) -> Callable[[list[dict[str, Any]]], list[dict[str, Any]]]:
    """Fill first_reg_month / power_kw / weight_kg from Vegvesen on rows that
    carry a reg_number. Records lookups in `ctx.scratch["vegvesen"]`."""
    api_key = str(ctx.env.get(ENV_KEY, "")).strip()
    if not api_key:
        raise SourceDisabled(f"{ENV_KEY} not set; Vegvesen lookups skipped")
    log: list[dict[str, Any]] = ctx.scratch.setdefault("vegvesen", [])

    def enrich(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for r in rows:
            reg = str(r.get("reg_number") or "").strip()
            if not reg:
                continue
            try:
                facts, cached, sha = lookup(
                    reg, api_key, ctx.cache_dir, ctx.raw_dir, client=ctx.http
                )
            except httpx.HTTPError as exc:
                log.append(
                    {"reg_hash": hash_listing_id("vegvesen", reg), "error": type(exc).__name__}
                )
                continue
            log.append(
                {
                    "reg_hash": hash_listing_id("vegvesen", reg),
                    **(asdict(facts) if facts else {}),
                    "cached": cached,
                    "snapshot_sha256": sha,
                    "ingested_on": ctx.today.isoformat(),
                }
            )
            if facts is None:
                continue
            if facts.first_reg_date and not r.get("first_reg_month"):
                r["first_reg_month"] = facts.first_reg_date[:7]
            if facts.power_kw and not r.get("power_kw"):
                r["power_kw"] = facts.power_kw
            if facts.weight_kg and not r.get("weight_kg"):
                r["weight_kg"] = facts.weight_kg
            if facts.fuel and not r.get("fuel"):
                r["fuel"] = facts.fuel
        return rows

    return enrich


def run_source(ctx: SourceContext) -> SourceOutput:
    """Reports the lookups made by the enricher during this run (the
    enricher itself runs inside the listings pipeline)."""
    if not str(ctx.env.get(ENV_KEY, "")).strip():
        raise SourceDisabled(f"{ENV_KEY} not set")
    rows = list(ctx.scratch.get("vegvesen", []))
    note = "" if ctx.listings_path else "no listings to enrich"
    return SourceOutput(
        SOURCE,
        rows_in=len(rows),
        stored=[r for r in rows if "error" not in r],
        columns=COLUMNS,
        status="ok" if rows or not ctx.listings_path else "ok",
        note=note or f"{sum(1 for r in rows if r.get('cached'))} from cache",
    )
