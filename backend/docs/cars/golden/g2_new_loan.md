# G2 — Buy new with the textbook loan (100 000 at 12 % over 12 months)

Inputs: price 300 000 kr, down payment 200 000 kr → principal 100 000 kr at
12 % nominal (1 % a month) over 12 months, no fees, no exit friction, resale
270 000 kr at 12 months. 100 % odds of leaving at 12.

The standard amortisation example: constant payment
`100 000 × 0,01 × 1,01^12 / (1,01^12 − 1) = 8 884,88 kr`. Month 1 interest
1 000,00, principal 7 884,88, balance 92 115,12. Month 2 interest 921,15.
With exact arithmetic the 12 payments total 106 618,55 kr (interest
6 618,55). The engine follows the bank convention of rounding each month's
interest to the øre and letting the final payment absorb the residual: the
last payment is 8 884,85 kr, the 12 payments total **106 618,53 kr** and total
interest is **6 618,53 kr**; the balance ends at exactly 0.

Cash up front = 200 000 + 10 000 (tyres) = **210 000 kr**.

Cash to 12: 200 000 + 10 000 + 106 618,53 + 12 000 + 3 650 + 2 400 + 1 200 =
335 868,53. Exit terms: payoff after 12 payments 0; value back −270 000.
TCO(12) = **65 868,53 kr**.

Display at 12: value lost = 300 000 − 270 000 = 30 000; financing = payments
106 618,53 + payoff 0 − principal 100 000 = 6 618,53.
