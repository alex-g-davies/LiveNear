"""Load rules/tax_rules.yaml into the engine's TaxRuleSet (spec 022 R6)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from ..engine.models import TaxRule, TaxRuleSet

RULES_FILE = Path(__file__).with_name("tax_rules.yaml")


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


def _check_no_overlap(rules: tuple[TaxRule, ...]) -> None:
    by_kind: dict[str, list[TaxRule]] = {}
    for r in rules:
        by_kind.setdefault(r.kind, []).append(r)
    for kind, rs in by_kind.items():
        rs.sort(key=lambda r: r.effective_from)
        for a, b in zip(rs, rs[1:], strict=False):
            if a.effective_to is None or a.effective_to > b.effective_from:
                raise ValueError(f"tax rules {a.id} and {b.id} ({kind}) overlap")
