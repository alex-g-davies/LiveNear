import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatKm,
  formatMonths,
  formatNok,
  formatNokSigned,
  formatPct,
  formatPerKm,
  plainSource,
} from "../../cars/lib/format";

const NB = " ";

describe("cars NOK formatting (spec 022 R11)", () => {
  it("formats øre as whole kroner with a no-break space separator", () => {
    expect(formatNok(1_234_500)).toBe(`12${NB}345${NB}kr`);
    expect(formatNok(99_949)).toBe(`999${NB}kr`);
    expect(formatNok(99_950)).toBe(`1${NB}000${NB}kr`);
    expect(formatNok(0)).toBe(`0${NB}kr`);
    expect(formatNok(-123_400)).toBe(`-1${NB}234${NB}kr`);
    expect(formatNok(123_456_789_00)).toBe(`123${NB}456${NB}789${NB}kr`);
  });

  it("signs deltas", () => {
    expect(formatNokSigned(123_400)).toBe(`+1${NB}234${NB}kr`);
    expect(formatNokSigned(-123_400)).toBe(`-1${NB}234${NB}kr`);
    expect(formatNokSigned(0)).toBe(`0${NB}kr`);
  });

  it("formats øre per km with a decimal comma", () => {
    expect(formatPerKm(527)).toBe(`5,27${NB}kr/km`);
    expect(formatPerKm(1_000)).toBe(`10,00${NB}kr/km`);
  });

  it("formats percentages, km, months and dates", () => {
    expect(formatPct(15)).toBe(`15${NB}%`);
    expect(formatPct(4.5, 1)).toBe(`4,5${NB}%`);
    expect(formatKm(12_000)).toBe(`12${NB}000${NB}km`);
    expect(formatMonths(12)).toBe("1 year");
    expect(formatMonths(24)).toBe("2 years");
    expect(formatMonths(30)).toBe("2.5 years");
    expect(formatMonths(6)).toBe("6 months");
    // 027 R7: readable dates, never ISO.
    expect(formatDate("2026-10-24")).toBe(`24${NB}Oct${NB}2026`);
    expect(formatDate("2027-01-01T00:00:00Z")).toBe(`1${NB}Jan${NB}2027`);
    expect(formatDate("2026-13-01")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("renames placeholder and owner provenance for readers (027 R6)", () => {
    expect(plainSource("Placeholder")).toBe("Typical value");
    expect(plainSource("Placeholder: Oslo household price")).toBe("Typical value: Oslo household price");
    expect(plainSource("Placeholder winter uplift")).toBe("Typical value: winter uplift");
    expect(plainSource("Placeholder until 12 weekly snapshots exist")).toBe(
      "Typical value until 12 weekly snapshots exist",
    );
    expect(plainSource("Owner input")).toBe("Your input");
    expect(plainSource("Owner enters the bank's quoted rate")).toBe("You enter the bank's quoted rate");
    expect(plainSource("SSB table 14545")).toBe("SSB table 14545");
    expect(plainSource("Smarte Penger (updated 2026-08-06)")).toBe(`Smarte Penger (updated 6${NB}Aug${NB}2026)`);
    expect(plainSource(null)).toBe("");
  });
});
