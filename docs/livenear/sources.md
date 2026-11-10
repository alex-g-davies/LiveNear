# LiveNear data sources: Norway (issue #14)

Terms log for Norwegian map data, modelled on `backend/docs/cars/sources.md`.
Automating a source requires a row here first. Checked 2026-11-09 from primary
metadata. `backend/scripts/build_data_norway.py` ingests SSB 14545, SSB 06944,
Oslo BOL018, KLASS 460 and the Geonorge kommuner and grunnkretser.

| Source | Data | Access | Terms decision | Date |
|---|---|---|---|---|
| SSB 14545 (annual), 14310 (quarterly) | NOK/m² and sales by kommune, 2025 onward | PxWeb API | Cleared: CC BY 4.0, credit SSB, link ssb.no and the licence, indicate changes, imply no endorsement | 2026-11-09 |
| SSB 06035, 05963 | Freeholder NOK/m² to 2024 | PxWeb API | Cleared, same licence. Not directly comparable with 2025 onward (m² definition changed to BRA-i) | 2026-11-09 |
| SSB 06944 | Median household income after tax: kommune, plus bydel for Oslo, Bergen, Stavanger, Trondheim | PxWeb API | Cleared, same licence | 2026-11-09 |
| Oslo statistics bank BOL018, BOL013 | Price per m², median price and sales by bydel, delbydel, grunnkretsområde, 2018-2025 | PxWeb API (json-stat2) | **Accepted by owner, relying on the open-data listing:** data.norge.no lists NLOD 2.0 for the bank, which is the basis for use. Only the city's published aggregates are used; no listing data is collected. Residual risk: NLOD excludes third-party rights the licensor can't license, and the sales data comes via Boligmappa from FINN.no and grunnboken. Keep this layer removable, and remove it if the city or a rights holder objects | 2026-11-09 |
| Geonorge kommuner, grunnkretser, postnummerområder | National boundaries as GeoJSON, EPSG:25833 | Geonorge download | Cleared: CC BY 4.0, "Åpne data". Zips of 11.5, 54.0 and 11.1 MB before simplification | 2026-11-09 |
| SSB KLASS 460 (Delbydeler i Oslo 2017), correspondence to grunnkretser 2026 | Delbydel names, and which grunnkretser make up each. Codes match BOL018 once zero-padded (98 of 98; 591 grunnkretser, all with boundaries) | KLASS API | Cleared: CC BY 4.0 under SSB's licence page, same credit terms. Replaces Oslo's XLSX crosswalk, which has no stated licence and is not used | 2026-11-10 |
| FINN.no, private price reports (OBOS, Eiendom Norge) | Listings and market statistics | n/a | Not used. FINN is never scraped; private reports need terms that allow reuse | 2026-11-09 |

## Findings that shape the spec

- **Finest cleared level:** the kommune. 278 of 358 kommuner had a 2025 price
  in table 14545; the rest are blank. SSB calls those values too unreliable to
  publish, and in practice no kommune with fewer than 10 sales has a value.
- **Oslo is one polygon at that level,** so spec 026 uses the Oslo row above
  for delbydeler. No public price table below kommune level was found for
  Bergen, Trondheim or Stavanger (brief check only).
- **Mixed series:** 2024 and 2025 prices can't be joined into one trend without
  a stated caveat, so year-on-year figures need care at the 2025 boundary.
- **Commute:** Mapbox lists Norway for real-time and typical traffic, and the
  Isochrone API takes `driving-traffic` with `depart_at`. Live check on
  2026-11-10 (21 calls): a 30-min Oslo S isochrone shrinks 60% at peak; Asker to
  Oslo S took 33-49 min inbound (worst 07:45-08:15) and 26-36 min outbound
  (worst near 15:30, easing by 17:00), so the PM window is 15:00-16:15, in line
  with the Oslo toll ring's 15:00-17:00 rush. One route on one day, so still a
  sample rather than a survey. Horten-Moss routes over the ferry.
- **Mixed price bases:** Oslo delbydel prices include housing co-ops' shared debt,
  so they read somewhat differently from the SSB kommune prices beside them in
  the Oslo & Akershus region. About says so.
- **Mortgage rules (forskrift 2020-12-09-2648):** at least 10% equity, debt at
  most 5x income, must withstand a 3-point rate rise with a 7% minimum.
  Re-check for amendments before shipping defaults.

Sources: [SSB 14545](https://data.ssb.no/api/v0/en/table/14545),
[SSB 14310](https://data.ssb.no/api/v0/en/table/14310),
[SSB 06944](https://data.ssb.no/api/v0/en/table/06944),
[SSB licence](https://www.ssb.no/en/diverse/lisens),
[Oslo statistics bank](https://data.norge.no/en/datasets/fc22c19b-5347-3b20-aa1b-ae534f178f57/oslo-kommunes-statistikkbank),
[Geonorge kommuner](https://kartkatalog.geonorge.no/metadata/administrative-enheter-kommuner/041f1e6e-bdbc-4091-b48f-8a5990f3cc5b),
[Mapbox directions](https://docs.mapbox.com/help/dive-deeper/directions/),
[Lovdata](https://lovdata.no/dokument/SF/forskrift/2020-12-09-2648).
