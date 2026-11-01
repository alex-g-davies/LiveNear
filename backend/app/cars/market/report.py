"""Render the backtest as Markdown for docs/cars/backtest.md (spec 022 R7).

Pure: returns a string. `scripts/cars_build_bundle.py --report` writes it.
"""

from __future__ import annotations

from ..bundle_schema import MarketModelParams
from .backtest import GATE_UPPER, BacktestReport, Cell


def _pct(x: float) -> str:
    return "n/a" if x != x else f"{100 * x:.1f} %"


def _row(label: str, c: Cell) -> str:
    return (
        f"| {label} | {c.n} | {_pct(c.mape)} | {_pct(c.coverage)} | "
        f"{_pct(c.wilson_low)} to {_pct(c.wilson_high)} |"
    )


def render_backtest_markdown(
    report: BacktestReport, params: MarketModelParams, data_label: str = "owner listings CSV"
) -> str:
    verdict = "PASS" if report.passes else "FAIL"
    lines = [
        "# Market model backtest (eb-v1)",
        "",
        f"Rendered by `app.cars.market.report` from **{data_label}**, as of "
        f"{report.as_of.isoformat()}. Model status: `{report.model_status}`.",
        "",
        "Leave-one-listing-out CV on the cohort fit set (one row per listing, latest",
        "`listed` snapshot): the cohort intercept is refitted without the listing",
        "(beta* and the dealer term kept) and its log asking price is predicted at",
        "its own km. MAPE is on price; coverage is the share of listings inside the",
        "single-car 80 % interval (|resid| <= 1.2816 * sigma_car), with a Wilson 95 %",
        "interval on that share.",
        "",
        f"**Gate: {verdict}** (fails only when the Wilson upper bound of overall "
        f"coverage is below {100 * GATE_UPPER:.0f} %).",
        "",
        "## Data",
        "",
        f"- Distinct listings in the fit: {report.n_listings}",
        f"- Cohorts (variant x model year): {report.n_cohorts}",
        f"- Weekly snapshots: {report.n_snapshots}",
        f"- Variants with a fitted cohort: {sum(1 for v in params.variants.values() if v.cohorts)}",
        "",
        "## Overall",
        "",
        "| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |",
        "|---|---:|---:|---:|---|",
        _row("all listings", report.overall),
        "",
        "## By segment",
        "",
        "| Segment | n | MAPE | 80 % PI coverage | Wilson 95 % |",
        "|---|---:|---:|---:|---|",
    ]
    lines += [_row(k, c) for k, c in report.by_segment.items()]
    lines += [
        "",
        "## By age band",
        "",
        "| Age at as-of | n | MAPE | 80 % PI coverage | Wilson 95 % |",
        "|---|---:|---:|---:|---|",
    ]
    lines += [_row(k, c) for k, c in report.by_age_band.items()]
    lines += ["", "## Temporal backtest", ""]
    if report.temporal is None:
        lines.append(
            "Not run: fewer than 100 listings were removed after the cutoff week. "
            "Leave-one-out CV stands in until the removed set reaches 100 (R7)."
        )
    else:
        t = report.temporal
        lines += [
            f"Fit on snapshots up to {t.cutoff.isoformat()} ({t.n_fit_listings} listings); "
            "predicted the last ask of listings removed after it.",
            "",
            "| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |",
            "|---|---:|---:|---:|---|",
            _row("removed after cutoff", t.cell),
        ]
    lines += ["", "## Thin cohorts (n < 5, status estimate)", ""]
    if report.thin_cohorts:
        lines += [f"- `{cid}`: {n} listing(s)" for cid, n in report.thin_cohorts]
    else:
        lines.append("None.")
    if report.skipped_cohorts:
        lines += [
            "",
            "Cohorts with a single listing (no leave-one-out possible): "
            + ", ".join(f"`{c}`" for c in report.skipped_cohorts),
        ]
    lines += ["", "## Fitted global terms", ""]
    lines += [
        f"- Dealer premium delta: {params.dealer_premium.value} log points "
        f"(`{params.dealer_premium.status}`, {params.dealer_premium.source})",
        f"- Used-price drift: {params.used_price_drift.value} % per year "
        f"(`{params.used_price_drift.status}`"
        + (
            f", P10-P90 {params.used_price_drift.range.low} to {params.used_price_drift.range.high}"
            if params.used_price_drift.range
            else ""
        )
        + ")",
        f"- Ask-to-sale discount: {params.ask_to_sale_discount.value} % "
        f"(`{params.ask_to_sale_discount.status}`, {params.ask_to_sale_discount.source})",
        "- Fleet / taxi and warranty terms: not fitted in v1 (columns carried through).",
        "",
        "## Segment retention curves (log r = a + b * age + c * log(km + KM_OFFSET))",
        "",
        "| Segment | a | b | c | sigma_resid | sigma_per_year | beta_logkm |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for name, s in sorted(params.segments.items()):
        lines.append(
            f"| {name} | {s.a:.4f} | {s.b:.4f} | {s.c:.4f} | {s.sigma_resid:.3f} | "
            f"{s.sigma_per_year:.3f} | {s.beta_logkm:.4f} |"
        )
    if report.notes:
        lines += ["", "## Notes", ""] + [f"- {n}" for n in report.notes]
    return "\n".join(lines) + "\n"
