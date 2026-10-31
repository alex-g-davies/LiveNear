# Cars module — decisions log (spec 022)

Dated decisions that are not derivable from the code. Newest first.

## 2026-10-31 — Engine conventions (M1)

- **Opportunity cost base.** Compounded forgone return on every krone paid
  out, from the month it is paid: `C_opp(t) = Σ_{k<t} CF_k·((1+r)^{(t−k)/12} − 1)`.
  This is the exact mirror of the discounting in net present cost, so the
  two measures never double-count. The alternative (return on capital tied
  up in the car, `V(t) − loan balance`) was rejected because it makes a
  lease look free of opportunity cost while its payments are still cash out.
- **Loan convention.** Nominal annual rate, monthly compounding, payments in
  arrears, each month's interest rounded half-up to the øre, constant payment
  from the closed-form annuity, final payment absorbs the residual. Golden
  case G2 documents the 2 øre difference from the textbook exact total.
- **Lease timing.** Month index k ≥ 1 means "during month k"; the payment for
  month k is booked in month k whether the quote says in advance or in
  arrears (the monthly grid cannot resolve intra-month timing). A repeat
  lease past the term starts the month after the term ends (upfront rent in
  month term+1) so an exit exactly at term end never pays for a new lease.
- **Excess km.** Pro-rated cap `cap × months_into_term / 12`, reset each term.
- **Default early-exit rule.** Remaining payments less a recovery share
  (default 60 %, Estimate) until the contract's own terms are entered.
- **Monte Carlo boundary.** Deterministic schedules are integer øre; the
  simulation converts once to float64 and rescales base vectors per draw.
  Loan payments in the simulation use the closed-form annuity, so with all
  ranges collapsed the P50 path matches the integer path to within 100 øre
  for loan options and 1 øre otherwise (property test).
- **Materiality.** An input is material when the expected (odds-weighted)
  amount of the line items that used it is ≥ 5 % of expected TCO
  (threshold itself an Estimate input). An option is Live only when no
  material input is an Estimate.
- **Resale drift.** The used-price drift slider shifts both the P50 path
  (`exp(drift × t/12)`) and the band, so the chart's centre line and its
  band move together.

## 2026-10-31 — Hosting, state and data (M0)

- The module lives inside LiveNear (Render, single container). Profiles,
  selections and overrides live in the browser and a URL parameter; the
  backend stores nothing per user.
- Derived data (vehicles, cohort points, retention, prices, rates) is
  committed under `backend/data/cars/`. Hand-collected listings and raw
  fetched pages go to the owner's private R2 bucket, never the public repo.
- **No FINN automation.** FINN's robots.txt and terms (§6) forbid automated
  collection without written consent (checked 2026-10-31). The owner is
  sending a consent request; the importer takes CSV meanwhile.
- Market model v1 is empirical Bayes with statsmodels; PyMC/Bambi deferred.
- Charts use d3 micro-packages on React-owned SVG (box-select on the market
  map needs a brush); data fetching uses the repo's hook pattern rather than
  TanStack Query. Both are deliberate deviations from the owner's build spec
  for consistency with LiveNear.

## Open

- Tax-rule values in `rules/tax_rules.yaml` are `unverified` placeholders
  except the 2023 EV VAT rule. Verify against Skatteetaten and set `live`.
- Default insurance table (`engine/defaults.py`) is a rough estimate; the
  owner's quotes replace it (build spec open decision 5).
- App name (build spec open decision 6): screens say "Cars" for now.
