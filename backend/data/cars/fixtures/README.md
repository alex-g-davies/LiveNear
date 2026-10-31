# Synthetic listings fixture (spec 022 R7, R9)

`listings_fixture.csv` is **generated, not collected**. It contains no real
advertisements, no registration numbers and no personal data. The app uses
it in local development when no R2 credentials are configured (`listings:
"fixture"` in `/api/health`); production without R2 reports `unavailable`
instead of serving it.

Generator: `app/cars/market/synthetic.py` (seed 22) via

    python scripts/cars_build_bundle.py --write-fixture

Known parameters: per-cohort level from the seed retention priors and new
prices, within-cohort km slope beta = -0.08, single-car sigma = 0.10 log
points, dealer premium +0.06, about 12 listings per cohort for the 8 seed
variants, 10 weekly snapshots, 15 % weekly removal hazard with the last ask
2 % lower on the removal week. Ad ids are `fx-000001` style.

Columns follow the listings CSV contract in `docs/cars/sources.md`
(`trim_as_listed` carries the catalogue trim group; a `trim_group` column is
added so the fixture maps to `seed/vehicles.yaml` without the reconciler's
bucket match). `reg_number` is always empty.

`docs/cars/backtest.md` is rendered from this fixture; the parameter-recovery
and coverage tests in `tests/cars/test_market_fit.py` regenerate the data in
memory from the same generator.
