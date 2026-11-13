# G8 — Used hybrid (petrol), paid cash, through a toll ring (spec 029 R1, R3, R4)

Inputs (scenarios/golden/g8_hybrid_used_cash.yaml): G1's deal, resale path,
insurance, service and tyres (see g1_used_cash.md), with a full hybrid that
burns petrol:

- 5,0 l/100 km, winter factor 1,00, own weight 1 100 kg;
- petrol 20 kr/l (diesel 22 kr/l, not used);
- a fixture toll ring: electric 10 / 10 kr, petrol 20 / 30 kr, diesel 30 / 40 kr
  per passage (off-peak / rush), no monthly cap; 10 passages a week.

Fixture rules: traffic tax 10 kr/day for every energy type; re-registration
5 000 kr, or 3 000 kr at or under 1 200 kg own weight.

**Energy.** 1 000 km a month × 5,0 / 100 × 1,00 = 50 l × 20 kr = **1 000 kr a
month**. The charging mix is ignored.

**Tolls.** 10 × 52 / 12 = 43,333… passages a month, half off-peak and half rush
at the *petrol* rate: (20 + 30) × 43,333… / 2 = 1 083,333… → **1 083,33 kr a
month** (half-up to the øre). The electric rate (10 / 10) would give 433,33,
so the line proves the fuel rate is used.

**Re-registration.** 1 100 kg ≤ 1 200 kg → light table → **3 000 kr**.

Cash up front = 200 000 + 10 000 (tyres) + 3 000 = **213 000 kr**.

Against G1 (TCO 63 250 at 12, 134 250 at 36), the changes are energy
(+1 000 − 200 a month), tolls (+1 083,33 a month) and re-registration (−2 000):

- TCO(12) = 63 250 − 2 400 + 12 000 − 2 000 + 12 × 1 083,33 (12 999,96) =
  **83 849,96 kr**.
- TCO(36) = 134 250 − 7 200 + 36 000 − 2 000 + 36 × 1 083,33 (38 999,88) =
  **200 049,88 kr**.

NPC equals TCO (r = 0). Per month: 83 849,96 / 12 = 6 987,50 (6 987,4967
half-up); 200 049,88 / 36 = 5 556,94. Per km: 83 849,96 / 12 000 = 6,99;
200 049,88 / 36 000 = 5,56.

Expected TCO, 50 % at 12 and 50 % at 36 = (83 849,96 + 200 049,88) / 2 =
**141 949,92 kr**. No input has a range, so every draw equals the
deterministic path.

Display at 36: value lost 61 490; insurance 36 000; fees and taxes 3 000 +
10 960 = 13 960; energy 36 000; tyres 10 000; service 3 600; tolls 38 999,88.
Sum = 200 049,88 ✓.
