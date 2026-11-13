import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { energyName } from "../../cars/lib/market";
import { resetLanguage, setLanguage } from "../../i18n/core";
import { renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    postRecommend: vi.fn(async (req: import("../../cars/api").RecommendRequest) => fixture.buildRecommend(req)),
  };
});

describe("Fuel cars on screen (spec 029 R10-R12)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => act(() => resetLanguage()));

  it("names a car's energy: electric, hybrid, petrol or diesel", () => {
    expect(energyName("ev")).toBe("Electric");
    expect(energyName(undefined)).toBe("Electric"); // older servers send no energy type
    expect(energyName("hybrid", "petrol")).toBe("Hybrid");
    expect(energyName("ice", "petrol")).toBe("Petrol");
    expect(energyName("ice", "diesel")).toBe("Diesel");
  });

  it("names fuels in Norwegian and Turkish", async () => {
    await act(() => setLanguage("nb", false));
    expect(energyName("ice", "petrol")).toBe("Bensin");
    expect(energyName("ice", "diesel")).toBe("Diesel");
    await act(() => setLanguage("tr", false));
    expect(energyName("ice", "diesel")).toBe("Dizel");
  });

  it("says the charging questions apply to electric cars only (R11)", () => {
    renderCars("/drive-cheap");
    expect(screen.getByText(/Electric cars only\. Hybrids and petrol or diesel cars/)).toBeInTheDocument();
  });
});
