# Market model backtest (eb-v1)

Rendered by `app.cars.market.report` from **owner listings CSV (listings.csv)**, as of 2026-10-31. Model status: `live`.

Leave-one-listing-out CV on the cohort fit set (one row per listing, latest
`listed` snapshot): the cohort intercept is refitted without the listing
(beta* and the dealer term kept) and its log asking price is predicted at
its own km. MAPE is on price; coverage is the share of listings inside the
single-car 80 % interval (|resid| <= 1.2816 * sigma_car), with a Wilson 95 %
interval on that share.

**Gate: PASS** (fails only when the Wilson upper bound of overall coverage is below 70 %).

## Data

- Distinct listings in the fit: 971
- Cohorts (variant x model year): 21
- Weekly snapshots: 1
- Variants with a fitted cohort: 9

## Overall

| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| all listings | 971 | 4.5 % | 76.2 % | 73.4 % to 78.8 % |

## By segment

| Segment | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| ev-mid | 450 | 5.0 % | 78.7 % | 74.6 % to 82.2 % |
| ev-small | 113 | 5.1 % | 76.1 % | 67.5 % to 83.0 % |
| ev-suv | 408 | 3.8 % | 73.5 % | 69.0 % to 77.6 % |

## By age band

| Age at as-of | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| 2-4y | 468 | 3.7 % | 78.0 % | 74.0 % to 81.5 % |
| 4y+ | 503 | 5.2 % | 74.6 % | 70.6 % to 78.2 % |

## Temporal backtest

Not run: fewer than 100 listings were removed after the cutoff week. Leave-one-out CV stands in until the removed set reaches 100 (R7).

## Thin cohorts (n < 5, status estimate)

None.

## Fitted global terms

- Dealer premium delta: 0.0084 log points (`live`, Pooled dealer term of within-cohort residuals (eb-v1))
- Used-price drift: 0 % per year (`estimate`, P10-P90 -6 to 2)
- Ask-to-sale discount: 0 % (`estimate`, Placeholder until removed listings are tracked)
- Fleet / taxi and warranty terms: not fitted in v1 (columns carried through).

## Segment retention curves (log r = a + b * age + c * log(km + KM_OFFSET))

| Segment | a | b | c | sigma_resid | sigma_per_year | beta_logkm |
|---|---:|---:|---:|---:|---:|---:|
| ev-mid | 2.4661 | -0.1017 | -0.2222 | 0.051 | 0.080 | -0.2222 |
| ev-small | 1.4046 | -0.0605 | -0.1463 | 0.050 | 0.090 | -0.1463 |
| ev-suv | 2.1806 | -0.0842 | -0.2058 | 0.050 | 0.080 | -0.2058 |

## Notes

- segment ev-suv: 3 fitted cohort(s) < 4, prior pseudo-observations added
- drift and ask-to-sale kept at the priors: 1 weekly snapshot(s) < 8
- temporal backtest skipped: fewer than 100 listings removed after the cutoff week
