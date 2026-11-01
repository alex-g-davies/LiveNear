"""Market-model constants with no third-party imports.

The web image installs numpy but not pandas/statsmodels (dev and ingest
only), so anything the engine or the API needs at runtime from the market
package must import from here or from `predict.py`, never from `schema.py`,
`fit.py` or `cohorts.py`. `tests/cars/test_runtime_imports.py` enforces it.
"""

from __future__ import annotations

# Mileage enters every fit as log(km + KM_OFFSET). Why 10 000 and not 1 000:
# the slope is identified on used cars (roughly 20 000-150 000 km) and is then
# extrapolated to a brand-new car at 0 km for the "buy new" path. With an
# offset of 1 000 the first 15 000 km alone cost exp(c * 2.7) ~ 40 % of the
# value (2026-11-01 fit on 971 listings), which no Norwegian EV loses in
# year one; 10 000 caps that first-year mileage term at ~15 %. Recorded in
# docs/cars/decisions.md.
KM_OFFSET = 10_000.0
