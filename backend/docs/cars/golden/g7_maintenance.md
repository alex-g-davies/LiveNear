# g7 — Service by interval, wear and repairs, inspection, wheel changes, tolls

Spec 024 R1–R5, R8. Same fixture car and resale path as g1, bought for cash
from a dealer at 36 months old with 40 000 km, 12 000 km a year (exactly
1 000 km a month), and the round-number maintenance inputs below. Only the
new items are worked here; price, insurance, energy and taxes are as in g1.

## Inputs that matter

| Input | Value |
|---|---|
| Service | every 24 months or 30 000 km, 6 000 kr per visit, 3 000 kr once the car is 7 years (84 months) old |
| Wear items | 1 200 kr a year (100 kr a month) |
| Repair allowance | øre per km by odometer: ≤20 000 km 11, ≤40 000 22, ≤60 000 34, ≤80 000 45, ≤100 000 79, above 96 |
| Repair factors | EV factor 0.5; in-warranty factor 0.5 (warranty 5 years / 100 000 km) |
| Inspection | first at 48 months of age, then every 24 months (fixture rule); fee 1 500 kr |
| Tyres | 10 000 kr winter set at purchase, never worn out; wheel change 500 kr twice a year (months 6, 12, 18, …) |
| Tolls | 10 passages a week; ring rates 20 kr off-peak / 30 kr rush; cap 120 passages a month |

## Service (R1)

Month 0 is the purchase; the car is assumed serviced at sale. Counting from
there, a service falls due when 24 months or 30 000 km have passed since
the previous one. 30 000 km takes 30 months, so the month rule wins:

- month 24: age 60 → 6 000 kr
- month 48: age 84 → the 7-year price, 3 000 kr

Cumulative: 0 at month 12, **6 000 kr at 36**, **9 000 kr at 48**.

## Wear and repairs (R2)

Wear: 100 kr a month.

Repairs: odometer at month k is 40 000 + 1 000·k. Under warranty while age
36 + k ≤ 60 (k ≤ 24) and odometer ≤ 100 000 (k ≤ 60), so months 1–24 are
in warranty with factor 0.5 × 0.5 = 0.25; from month 25 the factor is 0.5.

| Months | Odometer at month end | Band (øre/km) | Factor | Per month (øre) |
|---|---|---|---|---|
| 1–20 | 41 000–60 000 | 34 | 0.25 | 34 × 1 000 × 0.25 = 8 500 |
| 21–24 | 61 000–64 000 | 45 | 0.25 | 45 × 1 000 × 0.25 = 11 250 |
| 25–36 | 65 000–76 000 | 45 | 0.5 | 45 × 1 000 × 0.5 = 22 500 |

- At 12: 12 × 8 500 = 102 000 øre repairs + 120 000 øre wear = **222 000 øre** (2 220 kr).
- At 36: 20 × 8 500 + 4 × 11 250 + 12 × 22 500 = 170 000 + 45 000 + 270 000 = 485 000 øre repairs
  + 360 000 øre wear = **845 000 øre** (8 450 kr).

## Periodic inspection (R3)

Age at month 0 is 36. Inspections fall at ages 48, 72, 96 …, i.e. months 12,
36, 60. Cumulative: **1 500 kr at 12**, **3 000 kr at 36 and 48**.

## Tyres and wheel changes (R4)

10 000 kr at month 0 plus 500 kr at every sixth month: **11 000 kr at 12**,
**13 000 kr at 36**.

## Tolls (R5)

Passages a month: 10 × 52 / 12 = 43.33…, under the cap of 120. Blended rate
(20 + 30) / 2 = 25 kr. Monthly charge = 5 000 øre × 21.666… = 108 333.33 øre,
rounded to the øre: 108 333. Cumulative: 12 × 108 333 = **1 299 996 øre**;
36 × 108 333 = **3 899 988 øre**.

## Display row "Service and repairs" at 36 months (R7)

Service 600 000 + wear and repairs 845 000 + inspection 300 000 =
**1 745 000 øre** (17 450 kr). Tyres row 1 300 000 øre; Tolls row 3 899 988 øre.

The engine must reproduce every bold figure exactly (see
`scenarios/golden/g7_maintenance.yaml`).
