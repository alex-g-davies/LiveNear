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
