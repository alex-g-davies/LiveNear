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

- Distinct listings in the fit: 2677
- Cohorts (variant x model year): 111
- Weekly snapshots: 3
- Variants with a fitted cohort: 35

## Overall

| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| all listings | 2673 | 5.7 % | 77.3 % | 75.6 % to 78.8 % |

## By segment

| Segment | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| ev-mid | 609 | 5.0 % | 76.8 % | 73.3 % to 80.0 % |
| ev-premium | 158 | 6.3 % | 75.3 % | 68.0 % to 81.4 % |
| ev-small | 590 | 6.2 % | 78.5 % | 75.0 % to 81.6 % |
| ev-suv | 724 | 4.2 % | 75.7 % | 72.4 % to 78.7 % |
| hybrid-small | 320 | 7.4 % | 80.9 % | 76.3 % to 84.9 % |
| hybrid-suv | 129 | 7.1 % | 86.0 % | 79.0 % to 91.0 % |
| ice-compact | 82 | 7.7 % | 65.9 % | 55.1 % to 75.2 % |
| ice-suv | 61 | 7.5 % | 70.5 % | 58.1 % to 80.4 % |

## By age band

| Age at as-of | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| <2y | 4 | 3.0 % | 100.0 % | 51.0 % to 100.0 % |
| 2-4y | 1195 | 4.9 % | 78.4 % | 76.0 % to 80.6 % |
| 4y+ | 1474 | 6.3 % | 76.3 % | 74.0 % to 78.4 % |

## Temporal backtest

Not run: fewer than 100 listings were removed after the cutoff week. Leave-one-out CV stands in until the removed set reaches 100 (R7).

## Thin cohorts (n < 5, status estimate)

- `byd-dolphin-60:2025`: 4 listing(s)
- `fiat-500e-42:2021`: 4 listing(s)
- `kia-ev6-lr-rwd:2024`: 2 listing(s)
- `renault-zoe-ze50:2021`: 4 listing(s)
- `skoda-kodiaq-20-tdi-4x4:2022`: 4 listing(s)
- `skoda-octavia-20-tdi-4x4:2021`: 2 listing(s)
- `skoda-octavia-20-tdi-4x4:2022`: 4 listing(s)
- `toyota-landcruiser-28-d4d:2022`: 1 listing(s)
- `toyota-landcruiser-28-d4d:2023`: 1 listing(s)
- `volvo-v60-d4:2021`: 1 listing(s)
- `vw-golf-etsi:2022`: 2 listing(s)
- `vw-golf-etsi:2024`: 3 listing(s)
- `vw-id3-pro-58:2023`: 2 listing(s)
- `vw-tiguan-20-tdi-4motion:2021`: 1 listing(s)
- `vw-tiguan-20-tdi-4motion:2022`: 3 listing(s)
- `vw-tiguan-20-tdi-4motion:2023`: 2 listing(s)

Cohorts with a single listing (no leave-one-out possible): `toyota-landcruiser-28-d4d:2022`, `toyota-landcruiser-28-d4d:2023`, `volvo-v60-d4:2021`, `vw-tiguan-20-tdi-4motion:2021`

## Fitted global terms

- Dealer premium delta: 0.0214 log points (`live`, Market model: price gap between dealer and private sales)
- Used-price drift: 0 % per year (`estimate`, P10-P90 -6 to 2)
- Ask-to-sale discount: 0 % (`estimate`, Placeholder until removed listings are tracked)
- Fleet / taxi and warranty terms: not fitted in v1 (columns carried through).

## Segment retention curves (log r = a + b * age + c * log(km + KM_OFFSET))

| Segment | a | b | c | sigma_resid | sigma_per_year | beta_logkm |
|---|---:|---:|---:|---:|---:|---:|
| ev-mid | 2.4877 | -0.0944 | -0.2278 | 0.056 | 0.080 | -0.2278 |
| ev-premium | 1.3590 | 0.0000 | -0.1954 | 0.114 | 0.090 | -0.1954 |
| ev-small | 1.6981 | -0.0698 | -0.1767 | 0.091 | 0.090 | -0.1767 |
| ev-suv | 2.4218 | -0.1114 | -0.2148 | 0.050 | 0.080 | -0.2148 |
| hybrid-small | 1.8982 | -0.0500 | -0.1801 | 0.063 | 0.070 | -0.1801 |
| hybrid-suv | 2.7065 | 0.0000 | -0.2681 | 0.050 | 0.070 | -0.2681 |
| ice-compact | 1.7912 | -0.0601 | -0.1761 | 0.128 | 0.080 | -0.1761 |
| ice-suv | 2.2936 | -0.0615 | -0.2114 | 0.060 | 0.080 | -0.2114 |

## Notes

- segment ev-premium: fitted age slope b=0.082 > 0, clamped to 0
- segment hybrid-suv: fitted age slope b=0.005 > 0, clamped to 0
- drift and ask-to-sale kept at the priors: 3 weekly snapshot(s) < 8
- temporal backtest skipped: fewer than 100 listings removed after the cutoff week
