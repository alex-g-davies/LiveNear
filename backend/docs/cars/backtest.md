# Market model backtest (eb-v1)

Rendered by `app.cars.market.report` from **the synthetic fixture data/cars/fixtures/listings_fixture.csv**, as of 2026-10-31. Model status: `live`.

Leave-one-listing-out CV on the cohort fit set (one row per listing, latest
`listed` snapshot): the cohort intercept is refitted without the listing
(beta* and the dealer term kept) and its log asking price is predicted at
its own km. MAPE is on price; coverage is the share of listings inside the
single-car 80 % interval (|resid| <= 1.2816 * sigma_car), with a Wilson 95 %
interval on that share.

**Gate: PASS** (fails only when the Wilson upper bound of overall coverage is below 70 %).

## Data

- Distinct listings in the fit: 264
- Cohorts (variant x model year): 22
- Weekly snapshots: 10
- Variants with a fitted cohort: 8

## Overall

| Set | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| all listings | 264 | 7.9 % | 81.4 % | 76.3 % to 85.7 % |

## By segment

| Segment | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| ev-mid | 204 | 7.9 % | 82.4 % | 76.5 % to 87.0 % |
| ev-small | 24 | 7.9 % | 70.8 % | 50.8 % to 85.1 % |
| ev-suv | 36 | 8.0 % | 83.3 % | 68.1 % to 92.1 % |

## By age band

| Age at as-of | n | MAPE | 80 % PI coverage | Wilson 95 % |
|---|---:|---:|---:|---|
| <2y | 24 | 7.4 % | 83.3 % | 64.1 % to 93.3 % |
| 2-4y | 84 | 8.4 % | 85.7 % | 76.7 % to 91.6 % |
| 4y+ | 156 | 7.8 % | 78.8 % | 71.8 % to 84.5 % |

## Temporal backtest

Not run: fewer than 100 listings were removed after the cutoff week. Leave-one-out CV stands in until the removed set reaches 100 (R7).

## Thin cohorts (n < 5, status estimate)

None.

## Fitted global terms

- Dealer premium delta: 0.0535 log points (`live`, Pooled dealer term of within-cohort residuals (eb-v1))
- Used-price drift: 1.18 % per year (`estimate`, P10-P90 -12.35 to 14.72)
- Ask-to-sale discount: 2.0 % (`estimate`, Median last/first ask of 199 removed listings (proxy for sale price))
- Fleet / taxi and warranty terms: not fitted in v1 (columns carried through).

## Segment retention curves (log r = a + b * age + c * log(km + 1000))

| Segment | a | b | c | sigma_resid | sigma_per_year | beta_logkm |
|---|---:|---:|---:|---:|---:|---:|
| ev-mid | 0.6340 | -0.1020 | -0.0896 | 0.050 | 0.080 | -0.0976 |
| ev-small | 0.6103 | -0.1161 | -0.0868 | 0.050 | 0.090 | -0.2600 |
| ev-suv | 0.7287 | -0.0845 | -0.1019 | 0.050 | 0.080 | -0.0630 |

## Notes

- segment ev-small: 2 fitted cohort(s) < 4, prior pseudo-observations added
- segment ev-suv: 3 fitted cohort(s) < 4, prior pseudo-observations added
- temporal backtest skipped: fewer than 100 listings removed after the cutoff week
