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

## 2026-11-01 — Market map and checklist (spec 023)

- **One dot per listing, hashed.** `GET /api/cars/market/points` serves the
  latest `listed` snapshot per listing with the same fields the per-cohort
  listings endpoint already exposed (hashed id, price, km, year, seller
  type, first-registration month). In `unavailable` mode it returns 200 and
  an empty list and the screen falls back to cohort medians with a visible
  note, so the map never 503s.
- **Checklist content is the owner's wireframe list**, held in the frontend
  (`lib/checklist.ts`); ticks live in `CarState.checklist` and travel in the
  `c` URL parameter. Due dates are estimates with a written basis: licence
  exchange = arrival + 12 months (non-EEA rule of thumb), winter tyres =
  next 1 November, EV tax change = the pending rule's effective date only
  while `tax_rules.yaml` lists a pending `ev_vat` entry.
- **Default selection only on the Situation form.** The first-visit default
  (first four variants) no longer re-fills an emptied selection on Market or
  Compare, so Clear means clear.
- Box-select is built on d3-brush and is covered by unit tests of the pure
  selection arithmetic; jsdom cannot drive a brush drag, so the drag itself
  is part of the manual walkthrough.

## 2026-11-01 — First real data (owner exports)

- **Owner exports are converted, not scraped.** The owner supplied three
  private exports (used listings with their own cohort labels, private-lease
  offers, new/near-new stock). `app/cars/ingest/owner_export.py` re-shapes
  them into the CSV contracts; the files live under
  `backend/data/cars/private/` (gitignored, also excluded from the Docker
  image) and a root `.gitignore` now blocks any CSV dropped in the repo root.
- **Asking price excludes the re-registration fee.** The engine charges that
  fee as its own line item and a seller never receives it, so cohort values
  are fitted on `price_excl_rereg` where the export has it (`price_basis`
  column; 123 of 974 rows fall back to the total price).
- **Retention km coefficient is tied to the within-cohort slope.** A free
  three-coefficient WLS on 3–8 cohort points per segment gave positive km
  coefficients on real data (age and median km are collinear across
  cohorts). `c` now equals the pooled within-cohort slope `beta_logkm`; only
  level and age slope are fitted.
- **Mileage offset is 10 000 km** (`KM_OFFSET`), not 1 000. With 1 000 the
  used-car slope extrapolated to 0 km made a new car lose ~44 % in year one;
  with 10 000 the fitted curves give 74–82 % after one year and 43–59 % after
  four at 15 000 km/yr, in line with the Norwegian EV market. The synthetic
  fixture was regenerated under the new offset.
- **A variant without listings is never valued above its new price.** The
  segment curve extrapolated to a nearly new, low-km car can give r > 1;
  prior-based anchors (`predict.anchor_value`, no cohort fit) are capped at
  the list price.
- **"Buy new" exists only while the model year is current.** A variant whose
  last model year is two or more years before the start date (2020 Kona,
  2023 Model 3 RWD) gets no new option; the scenario notes say why.
- **Raw snapshots are filed under the run date**, so a replayed
  `--today` run lands in that day's folder (the Norges Bank/SSB fetchers
  previously used the wall clock).
- **Two variants added**: `mg-mg4-64` (the owner collected MG4 64 kWh
  cohorts) and `tesla-modely-lr-awd-juniper` (2025 facelift; the 2026 lease
  offers and near-new stock are that car, not the 2022–2024 cohort).
- **Re-registration fee bands** split into 2025 and 2026 rules with the
  values dealers quote on the listings (7 505 / 4 532 kr in 2026). Still
  `unverified` until checked on Skatteetaten.
- **New-price history is still missing.** The new-stock export holds dealer
  asking prices for other brands; none of the catalogue variants appears in
  `new` condition. Seed list prices remain placeholders flagged estimate.
- **Owner decisions on the spec's open comments (2026-11-01):** default
  measure stays net cost per month; MAPE 10 % stays a reported target, the
  build gates only on 80 % interval coverage (Wilson upper bound ≥ 70 %).
  First real backtest: MAPE 4.6 %, coverage 76.2 %, gate PASS.

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
- Manufacturer list prices by model year for the nine starting variants
  (`data/cars/seed/new_prices.csv`) are placeholders; the retention level
  per variant depends on them.
- Lease offers: establishment/invoice fees, excess-km charge and return fee
  are not in the offer export and are flagged estimates until a written
  quote confirms them.
- Default insurance table (`engine/defaults.py`) is a rough estimate; the
  owner's quotes replace it (build spec open decision 5).
- App name (build spec open decision 6): screens say "Cars" for now.
