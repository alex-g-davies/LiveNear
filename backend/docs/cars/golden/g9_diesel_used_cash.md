# G9 — Used diesel, paid cash, toll cap and winter uplift (spec 029 R1, R4)

Inputs (scenarios/golden/g9_diesel_used_cash.yaml): G1's deal, resale path,
insurance, service and tyres (see g1_used_cash.md), with a diesel car:

- 6,0 l/100 km, winter factor 1,10, own weight 1 600 kg;
- diesel 22 kr/l (petrol 20 kr/l, not used);
- the G8 fixture ring (diesel 30 / 40 kr per passage), capped at 40 passages a
  month; 10 passages a week.

**Energy.** 1 000 km × 6,0 / 100 × 1,10 = 66 l × 22 kr = **1 452 kr a month**.

**Tolls.** 10 × 52 / 12 = 43,33 passages, capped at 40; half off-peak and half
rush at the *diesel* rate: (30 + 40) × 40 / 2 = **1 400 kr a month**.

**Re-registration.** 1 600 kg > 1 200 kg → ordinary table → **5 000 kr**.

Cash up front = 200 000 + 10 000 + 5 000 = **215 000 kr**.

- TCO(12) = 63 250 − 2 400 + 12 × 1 452 (17 424) + 12 × 1 400 (16 800) =
  **95 074 kr**.
- TCO(36) = 134 250 − 7 200 + 36 × 1 452 (52 272) + 36 × 1 400 (50 400) =
  **229 722 kr**.

NPC equals TCO. Per month: 95 074 / 12 = 7 922,83; 229 722 / 36 = 6 381,17.
Per km: 95 074 / 12 000 = 7,92; 229 722 / 36 000 = 6,38.

Expected TCO = (95 074 + 229 722) / 2 = **162 398 kr**.

Display at 36: value lost 61 490; insurance 36 000; fees and taxes 5 000 +
10 960 = 15 960; energy 52 272; tyres 10 000; service 3 600; tolls 50 400.
Sum = 229 722 ✓.
