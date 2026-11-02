"""Load rules/tax_rules.yaml into the engine's TaxRuleSet (spec 022 R6)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from ..engine.models import In, TaxRule, TaxRuleSet, TollRing
from ..engine.money import nok

RULES_FILE = Path(__file__).with_name("tax_rules.yaml")
TOLLS_FILE = Path(__file__).with_name("toll_rings.yaml")


def _read(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict) or "rules" not in data:
        raise ValueError(f"{path} must contain a top-level 'rules' list")
    return data


@lru_cache(maxsize=8)
def load_tax_rules(path: Path = RULES_FILE) -> TaxRuleSet:
    data = _read(path)
    rules = tuple(TaxRule.model_validate(r) for r in data["rules"])
    _check_no_overlap(rules)
    return TaxRuleSet(rules=rules)


def pending_rules(path: Path = RULES_FILE) -> list[dict]:
    """Reported-but-unapplied entries, for the sources report."""
    return list(_read(path).get("pending") or [])


@lru_cache(maxsize=8)
def load_toll_rings(path: Path = TOLLS_FILE) -> dict[str, TollRing]:
    """Municipality (lower-case) -> toll ring with electric-car rates (024 R5).
    The ring's `source` is an estimate on purpose: the engine blends the
    off-peak and rush rates 50/50, which no user drives exactly."""
    with open(path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    as_of = data["as_of"]
    out: dict[str, TollRing] = {}
    for r in data["rings"]:
        rid = r["id"]
        status = r.get("status", "live")
        ring = TollRing(
            name=str(r["name"]),
            offpeak_ore=In[int](
                id=f"tolls.{rid}.toll_offpeak",
                value=nok(str(r["offpeak_nok"])),
                source=str(r["source_url"]),
                as_of=r.get("effective_from", as_of),
                status=status,
                basis=r.get("note") if status != "live" else None,
            ),
            rush_ore=In[int](
                id=f"tolls.{rid}.toll_rush",
                value=nok(str(r["rush_nok"])),
                source=str(r["source_url"]),
                as_of=r.get("effective_from", as_of),
                status=status,
                basis=r.get("note") if status != "live" else None,
            ),
            monthly_cap_passages=int(r.get("monthly_cap_passages", 0)),
            source=In[str](
                id=f"tolls.{rid}.toll_ring",
                value=str(r["name"]),
                source=str(r["source_url"]),
                as_of=r.get("effective_from", as_of),
                status="estimate",
                basis=(
                    "Passages per week × 52/12 at a 50/50 blend of the off-peak and rush "
                    "electric-car rates, capped at the monthly cap; AutoPASS tag discount "
                    "and the hour rule are not modelled. " + str(r.get("note") or "")
                ).strip(),
            ),
        )
        for muni in r["municipalities"]:
            out[str(muni).strip().lower()] = ring
    return out


def toll_ring_for(municipality: str, path: Path = TOLLS_FILE) -> TollRing | None:
    key = (municipality or "").strip().lower()
    return load_toll_rings(path).get(key) if key else None


def _check_no_overlap(rules: tuple[TaxRule, ...]) -> None:
    by_kind: dict[str, list[TaxRule]] = {}
    for r in rules:
        by_kind.setdefault(r.kind, []).append(r)
    for kind, rs in by_kind.items():
        rs.sort(key=lambda r: r.effective_from)
        for a, b in zip(rs, rs[1:], strict=False):
            if a.effective_to is None or a.effective_to > b.effective_from:
                raise ValueError(f"tax rules {a.id} and {b.id} ({kind}) overlap")
