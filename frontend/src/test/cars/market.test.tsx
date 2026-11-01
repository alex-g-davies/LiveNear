import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { addPairs, togglePair, withYears, yearRangeLabel } from "../../cars/lib/market";
import { DEFAULT_STATE } from "../../cars/lib/profile";
import { WAIT, renderCars } from "./helpers";

const pointsMode = { value: "fixture" as "fixture" | "unavailable" };

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  type F = import("../../cars/api").MarketFilters;
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    getCohorts: vi.fn(async (f: F) => fixture.buildCohorts(f)),
    getMarketPoints: vi.fn(async (f: F) => {
      if (pointsMode.value === "unavailable") {
        return { bundle_as_of: "2026-10-24", listings_mode: "unavailable" as const, n_points: 0, points: [] };
      }
      return fixture.buildMarketPoints(f);
    }),
  };
});

const EMPTY = { ...DEFAULT_STATE, selection: [] };

describe("Market map (spec 023 R2/R3)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    pointsMode.value = "fixture";
  });

  it("renders one dot per listing from the fixture with the count and date", async () => {
    renderCars("/cars/market", { ...EMPTY, selection: [{ variant_id: "renault-5-52", year_from: 2025, year_to: 2026 }] });
    expect(screen.getByRole("heading", { level: 1, name: "Market map" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("market-dot").length).toBeGreaterThan(50), WAIT);
    expect(screen.getByTestId("market-count").textContent).toMatch(/^\d+ listings · as of 2026-10-24/);
    expect(screen.queryByTestId("market-fallback")).toBeNull();
    // Selected dots are pressed; others are not.
    const dots = screen.getAllByTestId("market-dot");
    const pressed = dots.filter((d) => d.getAttribute("aria-pressed") === "true");
    expect(pressed.length).toBeGreaterThan(0);
    expect(pressed.every((d) => d.getAttribute("data-variant") === "renault-5-52")).toBe(true);
    expect(screen.getByRole("img", { name: /Scatter plot of \d+ listings/ })).toBeInTheDocument();
  });

  it("the search filter narrows the dots to the matching model", async () => {
    renderCars("/cars/market", EMPTY);
    await waitFor(() => expect(screen.getAllByTestId("market-dot").length).toBeGreaterThan(50), WAIT);
    const before = screen.getAllByTestId("market-dot").length;
    fireEvent.change(screen.getByLabelText("Find a model"), { target: { value: "renault" } });
    await waitFor(() => {
      const dots = screen.getAllByTestId("market-dot");
      expect(dots.length).toBeLessThan(before);
      expect(dots.every((d) => d.getAttribute("data-variant") === "renault-5-52")).toBe(true);
    }, WAIT);
  });

  it("clicking a dot adds its model year; the chip can be removed; Compare navigates", async () => {
    // Start with one chip (an empty selection is auto-filled by the provider once the
    // catalogue lands), remove it, and work from an empty tray.
    renderCars("/cars/market", { ...EMPTY, selection: [{ variant_id: "kia-ev6-lr-rwd", year_from: 2021, year_to: 2026 }] });
    await waitFor(() => expect(screen.getAllByTestId("market-dot").length).toBeGreaterThan(50), WAIT);
    fireEvent.click(screen.getByRole("button", { name: "Remove Kia EV6 Long Range RWD" }));
    await waitFor(() => expect(screen.queryByTestId("selection-chip")).toBeNull(), WAIT);
    expect(screen.getByText("Pick at least one car to compare.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare selection" })).toBeDisabled();

    const dot = screen.getAllByTestId("market-dot").find((d) => d.getAttribute("data-variant") === "mg4-xpower" && d.getAttribute("data-year") === "2024")!;
    fireEvent.click(dot);
    const chip = await screen.findByTestId("selection-chip");
    expect(within(chip).getByText("MG MG4 XPower")).toBeInTheDocument();
    expect(within(chip).getByText(/^2024 · \d+ listings$/)).toBeInTheDocument();
    expect(screen.getByTestId("selection-summary").textContent).toMatch(/^1 model · \d+ listings$/);

    // Clicking the same year again removes it; clicking another year adds a second range.
    fireEvent.click(dot);
    await waitFor(() => expect(screen.queryByTestId("selection-chip")).toBeNull(), WAIT);
    fireEvent.click(dot);
    const dot2026 = screen.getAllByTestId("market-dot").find((d) => d.getAttribute("data-variant") === "mg4-xpower" && d.getAttribute("data-year") === "2026")!;
    fireEvent.click(dot2026);
    await waitFor(() => expect(screen.getByText(/^2024, 2026 · \d+ listings$/)).toBeInTheDocument(), WAIT);

    fireEvent.click(screen.getByRole("button", { name: "Remove MG MG4 XPower" }));
    await waitFor(() => expect(screen.queryByTestId("selection-chip")).toBeNull(), WAIT);

    // Add model picker gives the full year range.
    fireEvent.click(screen.getByRole("button", { name: "Add model" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Renault 5 52 kWh" }));
    await waitFor(() => expect(screen.getByText(/^2025–2026 · \d+ listings$/)).toBeInTheDocument(), WAIT);

    fireEvent.click(screen.getByRole("button", { name: "Compare selection" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Compare options" })).toBeInTheDocument();
  });

  it("falls back to cohort medians with a visible note when listings are unavailable", async () => {
    pointsMode.value = "unavailable";
    renderCars("/cars/market", EMPTY);
    await waitFor(() => expect(screen.getByTestId("market-fallback")).toBeInTheDocument(), WAIT);
    const dots = screen.getAllByTestId("market-dot");
    // One dot per cohort: 6 fixture variants, 29 model years in total.
    expect(dots.length).toBe(29);
    expect(screen.getByRole("img", { name: /Scatter plot of 29 cohort medians/ })).toBeInTheDocument();
  });

  it("axis and colour controls change the plot description", async () => {
    renderCars("/cars/market", EMPTY);
    await waitFor(() => expect(screen.getAllByTestId("market-dot").length).toBeGreaterThan(50), WAIT);
    fireEvent.change(screen.getByLabelText("X axis"), { target: { value: "km" } });
    fireEvent.change(screen.getByLabelText("Y axis"), { target: { value: "range" } });
    fireEvent.click(screen.getByRole("button", { name: "Drive" }));
    await waitFor(
      () => expect(screen.getByRole("img", { name: /range against km driven, coloured by drive/ })).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Range by km driven" })).toBeInTheDocument();
  });
});

describe("selection arithmetic (spec 023 R2)", () => {
  it("merges contiguous years and splits gaps", () => {
    const sel = withYears([], "a", new Set([2021, 2022, 2024]));
    expect(sel).toEqual([
      { variant_id: "a", year_from: 2021, year_to: 2022 },
      { variant_id: "a", year_from: 2024, year_to: 2024 },
    ]);
    expect(yearRangeLabel(sel, "a")).toBe("2021–2022, 2024");
    const toggled = togglePair(sel, "a", 2023);
    expect(toggled).toEqual([{ variant_id: "a", year_from: 2021, year_to: 2024 }]);
    expect(togglePair(toggled, "a", 2021)).toEqual([{ variant_id: "a", year_from: 2022, year_to: 2024 }]);
  });

  it("box-select adds pairs for several variants without touching others", () => {
    const base = [{ variant_id: "z", year_from: 2020, year_to: 2020 }];
    const out = addPairs(base, [
      ["a", 2022],
      ["b", 2023],
      ["a", 2023],
    ]);
    expect(out).toEqual([
      { variant_id: "z", year_from: 2020, year_to: 2020 },
      { variant_id: "a", year_from: 2022, year_to: 2023 },
      { variant_id: "b", year_from: 2023, year_to: 2023 },
    ]);
  });
});
