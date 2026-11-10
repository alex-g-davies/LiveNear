# CLAUDE.md

Standing context for the **LiveNear** project (formerly "tradespace"; only
the Render URL keeps the old name). This file describes *how we
work here*. It is loaded into every session, so keep it lean and durable.
Feature requirements, acceptance criteria, and scope do **not** belong here —
those live in `specs/`.

## What this is

LiveNear helps people decide where they could live by overlaying housing
cost and commute time around fixed constraints (a work location and a budget).
It renders a map that shades areas by median home value and overlays drive-time
**isochrones** — contours of equal travel time — so a user can see which areas
are both affordable and commutable. Later work adds a blended cost surface,
optimization, and forecasting.

## Tech stack

- **Backend:** Python 3.11+, FastAPI, run with uvicorn. Numerical/analytical
  work uses numpy/scipy.
- **Frontend:** React + Vite. MapLibre GL for map rendering; d3-contour /
  turf.js for derived surfaces.
- **Data:** static aggregate datasets (Zillow ZHVI, Redfin Data Center),
  committed as small preprocessed files. **No database for the MVP.**
- **External APIs:** Mapbox Isochrone API for commute contours — called from
  the backend only.

## Repository layout

```
backend/      FastAPI app, isochrone proxy, data loading, tests
  app/cars/   Norway car TCO module (specs 022-024): engine/, market/, ingest/, rules/
frontend/     React + Vite SPA, MapLibre map; src/cars/ for the car screens
specs/        One spec per feature (the source of truth for what to build)
```

## Cars module (specs 022-024)

DriveCheap, the second product, at `/drive-cheap`: total cost of owning a car
in Norway for newcomers (the code and API keep the name `cars`; old `/cars`
links redirect). The map is LiveNear at `/live-near`, and `/` is a landing
page for both (spec 025). Rules that apply inside `backend/app/cars/` and
`frontend/src/cars/`, on top of everything else in this file:

- **Engine purity.** `app/cars/engine` and `app/cars/market` do no I/O,
  read no clock and touch no network; dates, rules and seeds are inputs.
- **Money is integer øre** in the engine and stored data; floats only inside
  the Monte Carlo arrays. Round for display only.
- **No silent defaults.** Every default is `status: estimate` with a written
  `basis`; tax rules live only in `app/cars/rules/tax_rules.yaml` with
  effective dates and source URLs (toll rings in `rules/toll_rings.yaml`).
- **Tests before formulas.** Add or update a golden case
  (`scenarios/golden/`, worked in `docs/cars/golden/`) or a property test
  before changing a line item.
- **Data terms.** Check and record terms in `docs/cars/sources.md` before
  automating any source. FINN.no is never scraped (see that file); used-car
  listings arrive as owner-collected CSV until FINN consents in writing.
  Listings and raw snapshots go to the owner's private R2 bucket, never
  this public repo; only derived bundles are committed under
  `backend/data/cars/`.
  Owner exports dropped in the repo root go straight to
  `backend/data/cars/private/` (gitignored); convert them with
  `scripts/cars_convert_owner_export.py`, never commit them.
- **No personal data server-side.** Profiles, selections and overrides live
  in the browser and the URL; scenario runs are stateless.
- Commands (from `backend/`): engine CLI
  `python -m app.cars.engine.cli scenarios/example.yaml`; ingestion
  `python -m app.cars.ingest.runner --help` (needs `requirements-ingest.txt`).

## Commands

Backend (run from `backend/`):
- Install: `pip install -r requirements-dev.txt` (runtime-only: `requirements.txt`)
- Dev server: `uvicorn app.main:app --reload`
- Test: `pytest`
- Lint/format: `ruff check .` and `ruff format .`

Frontend (run from `frontend/`):
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Test: `npm run test`

## Conventions

- Python: type hints on all public functions; format with ruff; small,
  single-purpose modules. Prefer pure functions for analytical/transform logic
  so they are unit-testable.
- React: functional components and hooks; keep components focused.
- Commits: reference the active spec's requirement ID where relevant
  (e.g. `R3: overlay drive-time isochrone`).
- When building UI, commit to a deliberate aesthetic rather than defaulting to
  generic patterns; the map is the product, so prioritize legibility of the
  cost/commute layers.

## Hard constraints (do not violate)

- Use **only free/aggregate** housing data. Never scrape listing sites or use
  any data source whose terms forbid it.
- API keys and tokens are read **only on the backend** from environment
  variables. They must never appear in the frontend bundle or in any
  client-side network request.
- No personal user data is persisted in the MVP.

## How we work (spec-driven)

- Every feature has a spec in `specs/`. **Read the relevant spec before
  planning or writing code.**
- The loop is: **spec → plan → implement → review → test**, with a human review
  between phases.
- Build the thinnest end-to-end slice first; generalize only once it works.
- **Definition of done** = the spec's Acceptance Criteria all pass and each
  traces to a requirement ID. Do not self-declare done — the human verifies the
  implementation against the spec.