# Cars module — data sources and terms decisions (spec 022 R8)

Every source the module reads, how it is accessed, the terms check that was
done and its date. Automating a source requires a row here first.

| Source | Data | Access | Terms decision | Date |
|---|---|---|---|---|
| FINN.no | Used-car listings | **Not automated.** CSV hand-collected by the owner for private use; consent request drafted in `finn-consent-request.md` | robots.txt header: "Crawling FINN.no is prohibited unless you have written permission"; user terms §6 forbid automated/systematic copying without explicit written consent; API is for business partners only. No adapter until written consent exists. | 2026-10-31 |
| Statens vegvesen — Kjøretøyopplysninger API | Technical data by registration number (first registration, power, fuel, weight) | REST API with a free personal key obtained via BankID; cached locally | Open data under the Norwegian Licence for Open Government Data (NLOD); personal key, rate limits apply. Owner obtains the key. | pending key |
| Norges Bank | Policy rate, exchange rates | Open JSON/CSV API (data.norges-bank.no) | Open data, attribution. | 2026-10-31 |
| Statistics Norway (SSB) | CPI, electricity prices | PxWeb open API | Open data (NLOD), attribution. | 2026-10-31 |
| Tesla configurator (tesla.com/no_NO) | New prices and trims | Playwright, from the owner's laptop or GitHub Actions, weekly | To check: tesla.com terms of use before the first automated run; manual entry until then. | open |
| Brand price lists (Hyundai, Skoda, VW, Renault, MG) | New prices and trims | PDF or web page, weekly | To check per brand before automating; manual entry until then. | open |
| Lease portals / dealer quotes | Lease terms | Manual entry (CSV) in this spec; per-site adapter only after a terms check | — | — |
| Skatteetaten | Traffic insurance tax, re-registration fee, EV VAT | Hand-maintained `rules/tax_rules.yaml` with effective dates and URLs | Public rules; values must be verified on the official page before `status: live`. | 2026-10-31 |
| NAF El Prix | Winter range / efficiency factors | Manual, twice a year | Published test results; cite the article. | — |
| Owner-supplied CSVs | Listings, new-price history, lease quotes, own scenario | Local path or R2 | Private; never committed to the public repo. | 2026-10-31 |

## CSV contracts

**Listings** (`listings.csv`, one row per listing per weekly snapshot):

```
snapshot_date, ad_id_or_url, make, model, trim_as_listed, model_year,
first_reg_month, battery_kwh, drive, power_kw_or_hp, km, asking_price_nok,
seller_type, location, ex_fleet_or_taxi, warranty_note, heat_pump,
reg_number, status
```

- `drive`: RWD | FWD | AWD. `seller_type`: dealer | private.
  `ex_fleet_or_taxi`, `heat_pump`: y | n | unknown. `status`: listed | removed.
- `reg_number` is optional and is hashed (SHA-256 with a local salt) before
  storage; it never appears in the bundle or any API response.
- Re-visit the same ads weekly and mark `removed` with the last asking price.

**New-price history** (`new_prices.csv`): `make, model, trim_group,
model_year, list_price_nok_incl_vat, valid_from, source_url`.

**Lease quotes** (`lease_quotes.csv`): `make, model, trim, term_months,
km_per_year_cap, monthly_nok, upfront_nok, fees_nok, excess_km_fee_nok,
early_exit_terms, includes, source, date`.

## Terms decisions added in M2 (ingestion core, R8)

| Source | Data | Access | Terms decision | Date |
|---|---|---|---|---|
| Tesla configurator (tesla.com/no_NO/model3/design) | Trim names and prices | `ingest/sources/tesla_configurator.py` (Playwright, laptop or GitHub Actions only) | **Gated.** The adapter raises `SourceDisabled("terms check pending")` unless `CARS_ALLOW_TESLA_SCRAPE=1` is set, and refuses to run when `STATIC_DIR` is set (web container). The flag stays unset until tesla.com's terms of use have been read and the decision is recorded in this table. Parser is unit-tested on a stored fixture only. | 2026-10-31 |
| Norges Bank — policy rate | `IR/B.KPRA.SD.R` via data.norges-bank.no (SDMX-JSON) | `ingest/sources/norges_bank.py`, `fetch()` with User-Agent `LiveNear-cars/0.1` | Open data, attribution. The car-loan rate derived from it is a **heuristic** (`policy rate + 2.5 pp`, P10–P90 ±1.5 pp) and is stored `status: estimate` with that basis; the owner's quoted bank rate overrides it. | 2026-10-31 |
| SSB PxWeb — CPI 03013, electricity 09387 | Monthly all-item CPI (2015 = 100); quarterly household electricity price incl. grid rent and taxes (øre/kWh) | `ingest/sources/ssb.py`, POST JSON-stat 2 | Open data (NLOD), attribution "Statistisk sentralbyrå". CPI feeds the retention `PriceAdjustment` hook (not wired in v1: factor 1). | 2026-10-31 |
| Statens vegvesen — kjøretøydata | First registration, power kW, fuel, weight by registration number | `ingest/sources/vegvesen.py`; key from `CARS_VEGVESEN_API_KEY`, header `SVV-Authorization: Apikey …`; disk cache keyed by the **hashed** registration number | NLOD with a personal key; skipped cleanly when the key is absent. Used only as an enricher on the owner's listing rows before the reconciler drops the clear-text `reg_number`. | pending key |
| Owner CSVs (listings, new prices, lease quotes) | As in the CSV contracts above | `ingest/sources/listings_csv.py`, `new_prices_csv.py`, `lease_csv.py`; raw file archived with sha256 under `raw/<source>/<date>/` (R2 when `--r2`) | Private. Rows failing validation go to `quarantine/`, never the store; `reg_number`/`vin` are hashed and dropped before storage. | 2026-10-31 |
| FINN.no | — | **No adapter.** `tests/cars/test_ingest.py` fails if any module under `app/cars/ingest/` mentions finn.no. | Unchanged: written consent required first. | 2026-10-31 |

Market model v1 notes (R7): fleet/taxi and warranty terms are carried through
the listing rows but **not fitted** in `eb-v1`; the drift and ask→sale
estimates need ≥ 8 weekly snapshots to be computed and are `estimate` until
12 exist (spec R7); the ask→sale figure is a proxy (last ask before removal).

## Owner exports (2026-11-01)

| Source | Data | Access | Terms decision | Date |
|---|---|---|---|---|
| Owner used-listings export | One row per listing with the owner's cohort label and trim match (974 sale rows kept, 971 stored, 3 quarantined for km vs age) | `app/cars/ingest/owner_export.py` -> listings contract -> `ingest.runner` -> `scripts/cars_build_bundle.py --listings` | Private file under `data/cars/private/`; the module only re-shapes what the owner provides and never fetches. Only the derived cohort aggregates are committed. | 2026-11-01 |
| Owner private-lease export (Ayvens offers) | 47 offers; 6 map to catalogue variants and are committed in `data/cars/seed/lease_quotes.csv` with their offer URLs | Same converter -> lease contract | Public offer prices with source URLs; fees not in the export are flagged estimate. Portal automation still needs a terms check first. | 2026-11-01 |
| Owner new/near-new stock export | 711 dealer listings across all brands | Same converter -> new-price contract (only `new` condition, as `estimate`) | No catalogue variant appears as `new`; used only to bound list prices for the 2026 facelift Model Y and MG4. Manufacturer list prices remain to be sourced. | 2026-11-01 |

Run order: `scripts/cars_convert_owner_export.py` -> `python -m app.cars.ingest.runner --sources listings_csv --listings data/cars/private/contract/listings.csv --out data/cars/private/ingest --raw-dir data/cars/private/raw` -> `scripts/cars_build_bundle.py --listings data/cars/private/ingest/store/listings.csv --report docs/cars/backtest.md`. For the live site, upload the converted `listings.csv` to R2 at `CARS_R2_LISTINGS_KEY` (default `listings/listings.csv`) so the per-cohort listing drill-down works; the bundle itself ships with the repo.

## Owner exports (2026-11-02)

| Source | Data | Access | Terms decision | Date |
|---|---|---|---|---|
| Owner used-listings export, second batch (`target_variant` shape) | 589 rows pre-filtered by trim for 12 new variants; 577 sale rows kept (8 auctions, 4 lease take-overs skipped), 1 548 listings stored in total | Same converter (both shapes, several files per run) -> `ingest.runner` -> bundle | As above: private file, only derived cohort aggregates committed. | 2026-11-02 |

## Running-cost sources (spec 024, read 2026-11-02)

| Source | Used for | Figure as published | Terms decision |
|---|---|---|---|
| OFV, "Kostnader ved bilhold – eksempler på beregning 2026" (press release and PDF, 16 Jun 2026): https://kommunikasjon.ntb.no/pressemelding/18952851/ | EV repair factor, tyre life | EV service and repairs 3 366–5 786 kr/yr by price class vs petrol 5 666 kr at 550 000 kr; tyre life 37 000 km incl. two wheel changes; incl. VAT, new car over three years, no age split | Public report; figures cited, not redistributed |
| Smarte Penger, "Bilkostnader – reparasjon" (updated 2026-08-06): https://www.smartepenger.no/bilokonomi/2231-bilkostnader-reparasjon | Repair allowance by odometer | Mid-size car 0.11 kr/km at 20 000 km, 0.45 at 80 000, 0.79 at 100 000, 0.96 at 110 000+; near zero under warranty | Editorial estimate; marked `estimate` with the interpolation noted |
| Kia Norway veiledende servicepriser (valid from 2026-07-01): https://www.kia.no/min-kia/service-og-vedlikehold/kia-veiledende-servicepriser | EV6 service price | EV5/EV6/Niro EV 7 990 kr per service every 2 yr/30 000 km; cars 7+ years liten 1 990 / stor 3 690 kr; incl. VAT | Published price list, `live` |
| Bertel O. Steen, elbilservice Peugeot / Stellantis: https://www.bos.no/bilverksted/elbilservice-peugeot, https://www.bos.no/bilverksted/elbilservice, https://www.bos.no/bilverksted/service-elbil-pris-og-vedlikeholdsbehov | Stellantis service prices, dealer EV range | First service 2 490 kr (1 yr/12 500 km), e-208 main service 4 290 kr (2 yr/25 000 km), brake fluid 1 490 kr every 2 yr; typical EV service 2 490–8 990 kr | Published dealer prices; Peugeot `live`, Opel/Fiat `estimate` (sister brand) |
| Brand pages for intervals and warranties: Tesla NO warranty PDF (2024-07-08) and owner manual; hyundai.com/no; kia.no; skoda-auto.no and mollerbil.no; volkswagen.no; MG warranty statement (14.08.2025); nissan.no; volvocars.com (SE support page); peugeot.no; opel.no; fiat.no; BYD NO warranty handbook (2025-10-21); xpeng.com/dk | `service_interval_*`, `warranty_*` per variant | See `seed/vehicles.yaml` sources per variant | Public pages; intervals without a Norwegian price are `estimate` |
| BEMA / mekke.no "Elbilsortiment 2025" parts list (Jan 2025, ex VAT): https://admin.mekke.no/data/images/3389/PDF%20kataloger/Elbilbrosjyre%202025-01-15.pdf | Wear items per year | 12 V battery 954–1 281 kr, wipers 505–825 kr, cabin filter 242–790 kr (parts, ex VAT) | Wholesale list; `estimate` with labour added |
| Statens vegvesen, EU-kontroll cycle: https://www.vegvesen.no/kjoretoy/eie-og-vedlikeholde/eu-kontroll/nar-kan-du-ta-eu-kontroll/ ; station prices NAF (1 419/1 619), Bertel O. Steen (from 1 390), Viking (1 070) | `periodic_inspection` rule, `inspection_fee_nok` | Within four years of first registration, then every second year | Rule `live`; fee `estimate` (station range) |
| NAF Oslo hjulskift (from 525/675 kr), Bertel O. Steen dekkhotell (699 kr), Noddi (699–799 kr) | `wheel_change_nok` | Two changes a year | `estimate` |
| Toll companies: Fjellinjen (Oslo, 2026-01-01), Ferde (Bergen 2026-03-25; Nord-Jæren 2026-08-04), Vegamot (Trondheim) | `rules/toll_rings.yaml` | Electric car per passage: Oslo 21/26, Bergen 17.60/35.20, Trondheim 12.32/24.64, Nord-Jæren 16.80; monthly caps 120/60/110/75 | Published tariffs; the 50/50 blend makes the item `estimate` |
| Skatteetaten, trafikkforsikringsavgift and omregistreringsavgift 2026; regjeringen.no 2027 proposal (7 Oct 2026) | `tax_rules.yaml` | EV 8.96 kr/day (from 2025-03-01), 9.16 (from 2026-03-01), 9.41 proposed 2027; re-registration over 1 200 kg 7 505 / 4 532 / 1 942 kr | Official; 2026 rules `live`, 2025 `unverified` (petrol figure not read) |
