# G1 — Used 1–3 years, paid cash, return on cash 0 %

Inputs (scenarios/golden/g1_used_cash.yaml): price 200 000 kr, dealer, 5 % exit
friction, explicit resale path 180 000 / 162 000 / 145 800 / 131 220 kr at
12/24/36/48 months. Fixture rules: traffic tax 10 kr/day, re-registration
5 000 kr. Common fixture: 1 000 km/month, 200 Wh/km at 1,00 kr/kWh (200 kr
energy a month), insurance 12 000 kr/yr, service 1 200 kr/yr, one 10 000 kr
tyre set, no return on cash.

Cash up front = 200 000 + 10 000 (tyres) + 5 000 (re-registration) = **215 000 kr**.

Exit at 12 (calendar 2027, 365 days of traffic tax = 3 650 kr):

| Cash to 12 | kr |
|---|---|
| purchase | 200 000 |
| tyres | 10 000 |
| re-registration | 5 000 |
| insurance 12 × 1 000 | 12 000 |
| traffic tax | 3 650 |
| energy 12 × 200 | 2 400 |
| service 12 × 100 | 1 200 |
| **cumulative** | **234 250** |

Exit terms: value back −180 000, friction 5 % × 180 000 = 9 000 → −171 000.
TCO(12) = 234 250 − 171 000 = **63 250 kr**. NPC equals TCO because r = 0.
Per month = 63 250 / 12 = 5 270,83 kr. Per km = 63 250 / 12 000 = 5,27 kr/km
(527 øre, half-up).

Exit at 36 (traffic tax 2027 + 2028 leap + 2029 = 3 650 + 3 660 + 3 650 = 10 960):
cumulative = 200 000 + 10 000 + 5 000 + 36 000 + 10 960 + 7 200 + 3 600 = 272 760;
exit terms −145 800 + 7 290 = −138 510; TCO(36) = **134 250 kr**; per month
3 729,17; per km 3,73.

Expected TCO with odds 50 % at 12 and 50 % at 36 = (63 250 + 134 250) / 2 =
**98 750 kr**.

Display at 36: value lost = 200 000 − 145 800 + 7 290 = 61 490; insurance
36 000; fees and taxes = 5 000 + 10 960 = 15 960; energy 7 200; tyres 10 000;
service 3 600; financing, exit costs, delay and opportunity cost 0. Sum = 134 250 ✓.
