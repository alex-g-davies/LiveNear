# G6 — Used car on a 24-month loan, sold after 12 months (balance repaid)

Inputs: price 200 000 kr, down payment 100 000 kr → principal 100 000 kr at
12 % over 24 months, no fees, no friction, resale 180 000 kr at 12. 100 % odds
at 12.

Payment = 100 000 × 0,01 × 1,01^24 / (1,01^24 − 1) = **4 707,35 kr**
(47,07 per 1 000, the standard table value).

Balance after 12 payments by the closed form
`100 000 × 1,01^12 − 4 707,35 × (1,01^12 − 1) / 0,01 = 112 682,50 − 59 700,93 ≈ 52 981,57 kr`.
The engine rounds interest monthly and lands on 52 981,53 kr; the test
allows 1 kr around the closed-form value.

Cash to 12: 100 000 + 10 000 + 5 000 + 12 × 4 707,35 (= 56 488,20) + 12 000 +
3 650 + 2 400 + 1 200 = 190 738,20. Exit terms: payoff ≈ 52 981,57 − 180 000.
TCO(12) ≈ **63 719,77 kr** (±1 kr).
