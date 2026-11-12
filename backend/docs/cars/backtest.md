# Market model backtest (eb-v1)

Rendered by `app.cars.market.report` from **owner listings CSV (listings.csv)**, as of 2026-11-12. Model status: `live`.

Leave-one-listing-out CV on the cohort fit set (one row per listing, latest
`listed` snapshot): the cohort intercept is refitted without the listing
(beta* and the dealer term kept) and its log asking price is predicted at
its own km. MAPE is on price; coverage is the share of listings inside the
single-car 80 % interval (|resid| <= 1.2816 * sigma_car), with a Wilson 95 %
interval on that share.

**Gate: PASS** (fails only when the Wilson upper bound of overall coverage is below 70 %).

## Data

- Distinct listings in the fit: 1773
- Cohorts (variant x model year): 52
- Weekly snapshots: 3
- Variants with a fitted cohort: 21

## Overall

| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| all listings | 1773 | 5.0 % | 76.6 % | 74.6 % to 78.5 % |

## By segment

| Segment | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| ev-mid | 559 | 5.1 % | 76.0 % | 72.3 % to 79.4 % |
| ev-small | 590 | 6.2 % | 78.5 % | 75.0 % to 81.6 % |
| ev-suv | 624 | 3.9 % | 75.3 % | 71.8 % to 78.5 % |

## By age band

| Age at as-of | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| <2y | 4 | 3.0 % | 100.0 % | 51.0 % to 100.0 % |
| 2-4y | 823 | 4.4 % | 76.9 % | 73.9 % to 79.7 % |
| 4y+ | 946 | 5.6 % | 76.2 % | 73.4 % to 78.8 % |

## Temporal backtest

Not run: fewer than 100 listings were removed after the cutoff week. Leave-one-out CV stands in until the removed set reaches 100 (R7).

## Thin cohorts (n < 5, status estimate)

- `byd-dolphin-60:2025`: 4 listing(s)
- `fiat-500e-42:2021`: 4 listing(s)
- `kia-ev6-lr-rwd:2024`: 2 listing(s)
- `renault-zoe-ze50:2021`: 4 listing(s)
- `vw-id3-pro-58:2023`: 2 listing(s)

## Fitted global terms

- Dealer premium delta: 0.0187 log points (`live`, Market model: price gap between dealer and private sales)
- Used-price drift: 0 % per year (`estimate`, P10-P90 -6 to 2)
- Ask-to-sale discount: 0 % (`estimate`, Placeholder until removed listings are tracked)
- Fleet / taxi and warranty terms: not fitted in v1 (columns carried through).

## Segment retention curves (log r = a + b * age + c * log(km + KM_OFFSET))

| Segment | a | b | c | sigma_resid | sigma_per_year | beta_logkm |
|---|---:|---:|---:|---:|---:|---:|
| ev-mid | 2.5359 | -0.0983 | -0.2299 | 0.050 | 0.080 | -0.2299 |
| ev-small | 1.7006 | -0.0699 | -0.1767 | 0.091 | 0.090 | -0.1767 |
| ev-suv | 2.3495 | -0.1168 | -0.2058 | 0.050 | 0.080 | -0.2058 |

## Notes

- drift and ask-to-sale kept at the priors: 3 weekly snapshot(s) < 8
- temporal backtest skipped: fewer than 100 listings removed after the cutoff week
