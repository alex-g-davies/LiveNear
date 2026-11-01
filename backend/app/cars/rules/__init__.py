"""Tax rules with effective dates (spec 022 R6). I/O lives here, not in engine/."""

from .loader import load_tax_rules, pending_rules

__all__ = ["load_tax_rules", "pending_rules"]
