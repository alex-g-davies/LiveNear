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

## 2026-11-02 — Second vehicle batch (spec 024 R0)

- Twelve variants added from the owner's second used-listings export
  (`finn_used_target_models_2026-11-02.csv`, 589 rows, 577 kept): Nissan Leaf
  40 kWh 2018–2020, Volvo XC40 Recharge Single Motor 69 kWh 2022–2023 and
  Extended Range 82 kWh 2024, Kia EV6 Long Range RWD 2022–2024, VW ID.3 Pro
  Performance 58 kWh 2021–2023 and Pro 58 kWh (107 kW) 2022–2023, Tesla
  Model Y RWD 2023–2024, Peugeot e-208 50 kWh and Opel Corsa-e 50 kWh
  2020–2023, Renault Zoe ZE50 2020–2021, Fiat 500e 42 kWh 2021–2023, BYD
  Dolphin 60 kWh 2024–2025. Catalogue is now 22 variants, 52 cohorts.
- **Zoe R110 and R135 share one variant.** The owner labelled them
  separately (3 and 13 listings); the motors differ (80 vs 100 kW) but the
  battery, body and price band are the same, and 3 listings cannot carry a
  cohort. Recorded here so the split can be restored if volumes grow.
- **The XC40 Extended Range (82 kWh, RWD) is its own variant**, not pooled
  with the 69 kWh FWD car: different battery, drive and list price.
- **Second export shape.** The new file carries a `target_variant` label and
  no `trim_match` column (the owner filtered by trim before exporting), and a
  `sale_form` column where `Leasing` (lease take-overs) and `Auksjon`
  (auctions) are not asking prices and are skipped. The converter accepts
  both shapes and several files in one run.
- Specs for the new variants (power, range, 0–100, tyre size, warranty) are
  manufacturer figures recalled for the Norwegian trims; efficiency, tyre
  set and fun score are placeholders flagged `estimate`, as for the first
  batch. List prices in `seed/new_prices.csv` are placeholders too (the
  anchor is capped at the new price, so a wrong placeholder can only pull a
  cohort value down, never invent value).
- Fit `eb-v1` on 1 548 listings: LOO MAPE 5.2 %, 80 % coverage 77.5 %
  (Wilson 75.3–79.5 %), gate PASS. Thin cohorts (estimate): EV6 2024 (2),
  ID.3 Pro 107 kW 2023 (2), Zoe 2021 (4), 500e 2021 (4), Dolphin 2025 (4).
- The 33 ads present in both exports were `trim_match: no` rows in the
  first (not in the catalogue then), so no ad has two snapshots yet; the
  ask→sale and drift estimates still wait for repeat sightings.

## 2026-11-02 — Maintenance model, running costs, recommendations (spec 024)

User feedback said the maintenance numbers looked low. They were: one
3 000 kr/yr placeholder for every car, no age or km dependence, and no wear,
repairs, inspection, wheel changes or tolls at all. Sources read on
2026-11-02 are listed in `sources.md`.

- **Service is an event, not a spread.** Each variant carries the importer's
  interval (months and km) and a price per visit; a visit is booked when
  either interval elapses since the previous one, counting from month 0.
  Kia (7 990 kr, 2 yr/30 000 km; 3 690 kr for cars 7+ years) and Peugeot
  (2 490 kr first service at 1 yr, then 4 290 kr every 2 yr/25 000 km) are
  published prices and `live`; the other brands publish intervals but no
  Norwegian price, so their price is an estimate anchored on the published
  sister-brand or dealer-range figure. Tesla has no fixed schedule and is
  costed through the wear allowance only. A used car from a private seller
  flags the service item Estimate (service history unknown).
- **Wear and repairs.** A per-year wear amount (wipers, cabin filter, brake
  fluid, 12 V battery, from the BEMA 2025 parts list plus labour) and a
  repair allowance per km from Smarte Penger's odometer table (0.11 kr/km at
  20 000 km to 0.96 at 110 000+), scaled by 0.65 (OFV 2026: EV service and
  repairs are 65 % of petrol) and by 0.3 while the brand warranty runs
  (repairs are near zero under warranty; wear is not covered). The 40 000
  and 60 000 km points are interpolated. All estimates; OFV publishes no
  age split, so the odometer curve is the only age signal available.
- **Inspection** follows Statens vegvesen's cycle (within 48 months of
  first registration, then every 24) as a dated rule in `tax_rules.yaml`
  (`periodic_inspection`), with the fee (1 400 kr, station range 1 070 to
  1 619) in `rates.yaml`. Model-year mid-year stands in for the
  first-registration month.
- **Tyres**: life 37 000 km (OFV assumption) and two wheel changes a year
  at 600 kr (NAF/BOS/Noddi range).
- **Tolls** are opt-in through a new profile field (passages per week) and a
  per-municipality table (`rules/toll_rings.yaml`: Oslo/Bærum, Bergen,
  Trondheim, Nord-Jæren) at the published electric-car rates, blended 50/50
  off-peak/rush and capped at the monthly cap. The blend is an assumption,
  so the item is always Estimate. AutoPASS tag discounts, the hour rule,
  parking and ferries are not modelled.
- **Tax rules corrected** against Skatteetaten: traffic-insurance tax for
  EVs 8.96 kr/day from 1 Mar 2025 and 9.16 from 1 Mar 2026 (`live`; the
  2027 proposal 9.41 is `pending`); 2026 re-registration bands 7 505 / 4 532
  / 1 942 kr (`live`). The earlier placeholders (10.34/10.60 kr/day,
  1 700 kr oldest band) were wrong. Rates apply to policies from 1 March,
  so the rule windows start on 1 March rather than 1 January.
- **Display**: Compare and Detail show one "Service and repairs" row
  (service + wear and repairs + inspection) and a "Tolls" row; the line
  items stay separate on Detail.
- **Golden g7** works the service events, the 7-year price, the warranty
  boundary of the repair curve, inspections at 48 and 72 months of age,
  wheel changes and a capped toll charge by hand; g1–g6 keep their expected
  values with the new items set to zero in their fixtures.
- **Recommendations** (`POST /api/cars/recommend`) rank every option the
  catalogue and the user's limits allow (all variants × model years ×
  allowed modes) by the chosen measure and return the top n plus the
  holders of three more tags (narrowest band, best fun score, lowest cash up
  front). Draws are capped at 1 000 so the full catalogue stays inside the
  two-second budget; the response reuses `OptionSummary`, so every row
  carries its Live/Estimate status and material-estimate labels.
- **Selection UI**: the Situation picker became a chip tray with a
  typeahead, the Market map gained a brand select on the existing `make`
  filter.

## Open

- Tax-rule values in `rules/tax_rules.yaml` are `unverified` placeholders
  except the 2023 EV VAT rule. Verify against Skatteetaten and set `live`.
- Manufacturer list prices by model year for the 22 catalogue variants
  (`data/cars/seed/new_prices.csv`) are placeholders; the retention level
  per variant depends on them.
- Lease offers: establishment/invoice fees, excess-km charge and return fee
  are not in the offer export and are flagged estimates until a written
  quote confirms them.
- Default insurance table (`engine/defaults.py`) is a rough estimate; the
  owner's quotes replace it (build spec open decision 5).
- App name (build spec open decision 6): screens say "Cars" for now.
