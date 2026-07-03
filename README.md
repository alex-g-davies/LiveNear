# LiveNear

**Live at [tradespace-x5xj.onrender.com](https://tradespace-x5xj.onrender.com/)**
*(formerly "tradespace" — only the onrender.com subdomain keeps the old name;
Render subdomains are fixed at service creation)*

Decide where you could live by overlaying **housing cost** and **commute
time**, nationwide. The map shades every ZIP in a selected state by median
home value (or YoY change, $/sqft, or a price-to-income affordability
multiple), hatches ZIPs over your budget, and overlays live traffic-aware
commute contours — driving, cycling, or walking — around a work pin you can
drag or set by address search; add a **second workplace** and the map shows
only where *both* can commute. A **"Your matches"** panel ranks the ZIPs
that are simultaneously within budget and within reach. Clicking a ZIP opens
a detail panel with a price-history chart, Census population/income and
affordability multiple, state percentile context, routed rush-hour commute
ranges (e.g. "55–73 min"), and a Wikipedia area summary — pin one ZIP to
compare it against another, jump around via the top YoY movers list, and
share any view as a URL. First-time visitors are geolocated to their own
state (with a clean fallback).

Built spec-by-spec (see [`specs/`](specs/)): Seattle MVP
([`001`](specs/001-mvp)) → metric enrichment ([`002`](specs/002-data-enrichment))
→ commute depth ([`003`](specs/003-commute-depth)) → abuse-hardened backend
([`004`](specs/004-backend-hardening)) → frontend resilience
([`005`](specs/005-frontend-resilience)) → single-container deployment
([`006`](specs/006-deployment)) → all 50 states + DC
([`007`](specs/007-national-coverage)) → Census ACS enrichment
([`008`](specs/008-acs-enrichment)) → ZIP explorer
([`009`](specs/009-zip-explorer)) → national UX + branding
([`010`](specs/010-ui-refresh-branding)) → commute accuracy
([`011`](specs/011-commute-accuracy)) → area context
([`012`](specs/012-area-context)) → travel modes + routed ranges
([`013`](specs/013-commute-modes-and-ranges)) → affordability metric
([`014`](specs/014-affordability-metric)) → pin address + panel polish
([`015`](specs/015-pin-address-and-panel-polish)) → dual workplaces
([`016`](specs/016-dual-workplaces)) → orientation & clarity
([`017`](specs/017-orientation-and-clarity)) → LiveNear rebrand
([`018`](specs/018-livenear-rebrand)) → matches shortlist
([`019`](specs/019-matches-shortlist)).

The map is the product: a FastAPI backend serves preprocessed aggregate data
and proxies the (token-bearing) Mapbox calls; a React + MapLibre frontend
renders the layers on a keyless basemap with stable, per-state **equal-count**
color buckets (each legend color ≈ the same number of ZIPs).

## Prerequisites

- **Python 3.11+.** A 3.13 interpreter is present at
  `C:\Users\Alex\AppData\Local\Programs\Python\Python313\python.exe` (not on PATH).
- **Node.js 18+ / npm** — required to run the frontend (install from nodejs.org).
- **Mapbox token** — *optional*. Without one, the isochrone overlay is served
  from a committed fixture and geocoding is disabled. With one, both are live.
  The token is read only on the backend and never reaches the browser (R5).
- **Census API key** — *optional*, only for rebuilding data with ACS fields
  (free signup: https://api.census.gov/data/key_signup.html).

## Backend (`backend/`)

```powershell
cd backend
# Create a venv with the Python 3.13 interpreter, then install deps:
& "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# Run the API (http://localhost:8000):
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload

# Test & lint:
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check . ; .\.venv\Scripts\python.exe -m ruff format .
```

Endpoints (rate-limited per IP; data responses carry strong ETags + gzip):

| Method/Path             | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `GET /api/health`       | Probe: verifies the region index + one state store load.      |
| `GET /api/regions`      | Selectable states with bounds/centers for the picker.         |
| `GET /api/housing`      | Per-ZIP metrics: value, YoY, CAGR, $/sqft, history, ACS.      |
| `GET /api/zips.geojson` | ZIP polygons with scalar metrics merged in.                   |
| `GET /api/isochrone`    | 15/30/45/60-min traffic-aware bands — fixture or live Mapbox. |
| `GET /api/geocode`      | Address search, biased to the selected region's center.       |
| `GET /api/geocode/reverse` | Nearest address for a dropped work pin.                    |
| `GET /api/commute`      | Routed rush-window commute ranges for a (home, work) pair.    |

### Configuration

Copy `backend/.env.example` to `backend/.env` and set values (`.env` is
gitignored). Highlights: `MAPBOX_TOKEN` (blank = fixture mode),
`MAPBOX_DAILY_CALL_BUDGET` (hard daily cap on upstream Mapbox calls),
`RATE_LIMIT_UPSTREAM`/`RATE_LIMIT_DATA`, `LOG_FORMAT=json` for cloud logs,
and `CENSUS_API_KEY` (data builds only).

## Frontend (`frontend/`)

```powershell
cd frontend
npm install
npm run dev      # http://localhost:5173 (proxies /api -> backend on :8000)
npm run test     # vitest
npm run build
```

Run the backend first so the frontend's `/api` proxy has something to talk to.
Brand assets live in `frontend/public/brand/` — the committed files are
optimized derivatives; the large source masters stay local (gitignored).

## Data

The app is **national, region-on-demand**: all 50 states + DC are committed
(~107 MB; largest state TX ≈ 6.6 MB) and only the selected state is fetched.
`backend/scripts/build_data.py` processes the national ZHVI (grouped by
state), joins each state's value→geometry on a 5-char ZIP, simplifies, and
writes `backend/data/states/{ST}.geojson` + `{ST}.zhvi.json` plus a
`regions.json` index. Per ZIP it derives: **YoY %**, **5-year CAGR**, a
quarterly **price-history** series, **$/sqft** (Redfin), and **population /
median household income / price-to-income** (Census ACS).

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\build_data.py                  # full rebuild, ALL states (~1 GB DL)
.\.venv\Scripts\python.exe scripts\build_data.py --states WA,OR   # subset (dev)
.\.venv\Scripts\python.exe scripts\build_data.py --enrich-acs     # refresh ACS fields in place
.\.venv\Scripts\python.exe scripts\build_data.py --enrich-redfin  # refresh $/sqft in place (big DL)
```

The `--enrich-*` modes rewrite the existing `{ST}.zhvi.json` files without
re-downloading ZHVI or geometry — use them for supplemental-data refreshes.
A full rebuild does **not** include Redfin by default; run `--enrich-redfin`
after one (this bit us once — see commit `bf9b205`).

Sources (free / aggregate):

- **Zillow ZHVI** by ZIP — median home value + history. © Zillow Research.
  (ZHVI is smoothed/seasonally adjusted and may **restate** prior months on
  re-download, so historical YoY/CAGR can shift slightly between builds.)
- **ZCTA ZIP boundaries** — © U.S. Census Bureau (via the OpenDataDE mirror).
- **Census ACS 5-Year Estimates** (ZCTA level) — population (B01003) and
  median household income (B19013); requires a free `CENSUS_API_KEY`.
  © U.S. Census Bureau.
- **Redfin** `zip_code_market_tracker` — median **sold** $/sqft (All
  Residential). © Redfin Data Center. Large (>4 GB uncompressed); streamed
  and filtered.
- **GeoNames** postal data — primary place name per ZIP. © GeoNames,
  licensed CC BY 4.0 (geonames.org). Refresh via `--enrich-names`.

The committed `backend/data/isochrone_fixture.json` is a single drive-time
polygon served only in **fixture mode** (no `MAPBOX_TOKEN`) as one "typical"
band. With a token, `/api/isochrone` returns three live traffic-aware bands
(off-peak / midday / rush hour) for the selected time.

## Deployment (spec [`006`](specs/006-deployment)) — live on Render

The app ships as **one container, one origin**: a multi-stage
[`backend/Dockerfile`](backend/Dockerfile) builds the SPA and serves it from
the FastAPI app (`STATIC_DIR`), so production needs no CORS and the relative
`/api` calls work unchanged. [`render.yaml`](render.yaml) deploys it to
Render (Starter plan) with health checks and autodeploy from `main`;
[CI](.github/workflows/ci.yml) gates every push with lint, tests, and a
Docker smoke run in fixture mode. Production:
**https://tradespace-x5xj.onrender.com** (`MAPBOX_TOKEN` lives only in the
Render dashboard).

```powershell
# Local production-image smoke test (from the repo root):
docker build -f backend/Dockerfile -t livenear .
docker run --rm -p 8000:8000 -e MAPBOX_TOKEN=$env:MAPBOX_TOKEN livenear
# -> http://localhost:8000 serves the SPA; /api/* the API.
```

To reproduce the setup from scratch: create a Render **Blueprint** pointing
at the repo (`render.yaml` is picked up automatically) and set `MAPBOX_TOKEN`
in the dashboard. **Mapbox spend guardrails:** Mapbox offers no hard billing
cap, so the backend's own protections are the real ceiling — per-IP rate
limits, ~500 m isochrone-origin snapping, and the `MAPBOX_DAILY_CALL_BUDGET`
breaker (spec 004) keep worst-case usage inside the free tier. Watch the
Mapbox Statistics page early on; rotate the token if it ever leaks.

## License & data attribution

Code is licensed under **AGPL-3.0** (see [LICENSE](LICENSE)): you may use and
modify it, but a service run on a modified version must publish its source.

Data and tiles are third-party, free/aggregate, **research-and-attribution
use** — commercial use of this app would require revisiting these terms:

- Housing values: **Zillow Home Value Index (ZHVI)** © Zillow Research.
- ZIP boundaries: **ZCTA** geometries © U.S. Census Bureau (OpenDataDE mirror).
- Demographics: **American Community Survey 5-Year Estimates** © U.S. Census Bureau.
- $/sqft: © **Redfin** Data Center.
- Place names: © **GeoNames**, CC BY 4.0.
- Area summaries: **Wikipedia**, CC BY-SA 4.0 (fetched client-side, attributed in-app).
- Basemap tiles: © **CARTO**, © OpenStreetMap contributors.
- Isochrones & geocoding: **Mapbox** APIs (server-side, token required).

## Verifying a release

Each spec in [`specs/`](specs/) carries its own acceptance criteria — the
human walks them against the running app; the implementer does not
self-certify done. Quick smoke for any deploy:

1. The choropleth + legend render for a distant state (try HI or AK); the
   legend's five colors each cover ≈20% of the state's ZIPs.
2. A budget de-emphasizes over-budget ZIPs; the drive-time bands redraw for
   15/30/45/60 min and are road-bounded (not circles) with a live token; the
   "Your matches" fold lists only in-budget, in-reach ZIPs and updates as
   either constraint changes.
3. Clicking a ZIP opens the detail panel (chart, ACS fields, percentile,
   commute reach); pin + click another ZIP compares them.
4. A copied URL (`?state=…&zip=…&budget=…`) reproduces the view in a fresh
   tab; the browser Network tab shows no Mapbox token anywhere.
5. `pytest` (backend) and `npm run test` (frontend) pass; CI is green.
