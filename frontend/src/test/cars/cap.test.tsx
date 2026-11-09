import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { describeValidation, type RecommendRequest } from "../../cars/api";
import { CAP_HINT, MAX_COMPARE_VARIANTS, capSelection, variantCount, wouldExceedCap } from "../../cars/lib/market";
import type { SelectionItem } from "../../cars/lib/profile";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    postRecommend: vi.fn(async (req: RecommendRequest) => fixture.buildRecommend(req)),
  };
});

const fake = (n: number, from = 0): SelectionItem[] =>
  Array.from({ length: n }, (_, i) => ({ variant_id: `fake-${from + i}`, year_from: 2022, year_to: 2023 }));

describe("Selection cap (spec 024 R18)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("counts distinct variants, not year ranges", () => {
    const split: SelectionItem[] = [
      { variant_id: "a", year_from: 2019, year_to: 2019 },
      { variant_id: "a", year_from: 2021, year_to: 2021 },
      { variant_id: "b", year_from: 2020, year_to: 2022 },
    ];
    expect(variantCount(split)).toBe(2);
    expect(wouldExceedCap(fake(MAX_COMPARE_VARIANTS), ["fake-0"])).toBe(false);
    expect(wouldExceedCap(fake(MAX_COMPARE_VARIANTS), ["new-one"])).toBe(true);
    expect(wouldExceedCap(fake(MAX_COMPARE_VARIANTS - 1), ["new-one"])).toBe(false);
  });

  it("clamps to the first variants seen and keeps every range of a kept variant", () => {
    const within = fake(MAX_COMPARE_VARIANTS);
    expect(capSelection(within)).toBe(within);
    const extra = [...fake(MAX_COMPARE_VARIANTS), { variant_id: "fake-0", year_from: 2025, year_to: 2025 }, ...fake(2, 100)];
    const capped = capSelection(extra);
    expect(variantCount(capped)).toBe(MAX_COMPARE_VARIANTS);
    expect(capped.filter((s) => s.variant_id === "fake-0")).toHaveLength(2);
    expect(capped.some((s) => s.variant_id === "fake-100")).toBe(false);
  });

  it("turns FastAPI's validation list into a sentence", () => {
    expect(
      describeValidation([
        { loc: ["body", "selection"], msg: "Value error, you can compare up to 30 cars at once, not 31; remove some" },
      ]),
    ).toBe("selection: you can compare up to 30 cars at once, not 31; remove some");
    expect(describeValidation([{ loc: ["body", "profile", "km_per_year"], msg: "Input should be greater than 0" }])).toBe(
      "profile.km_per_year: Input should be greater than 0",
    );
    expect(describeValidation([])).toBe("invalid request");
  });

  it("the tray stops adding at the cap and says so; the Start here button follows", async () => {
    renderCars("/drive-cheap", { ...BASE_STATE, selection: fake(MAX_COMPARE_VARIANTS) });
    await waitFor(() => expect(screen.getAllByTestId("tray-chip")).toHaveLength(MAX_COMPARE_VARIANTS), WAIT);
    expect(screen.getByText(`${MAX_COMPARE_VARIANTS} of ${MAX_COMPARE_VARIANTS} cars selected.`, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Add a car" })).toBeDisabled();
    expect(screen.getByTestId("tray-full")).toHaveTextContent(CAP_HINT);
    // The recommendation card cannot add three more either.
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
    expect(screen.getByRole("button", { name: "Add these three to my selection" })).toBeDisabled();
    expect(screen.getAllByText(CAP_HINT).length).toBeGreaterThanOrEqual(2);
    // Removing one car reopens the tray.
    fireEvent.click(screen.getByRole("button", { name: "Remove fake-0" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Add a car" })).toBeEnabled(), WAIT);
    expect(screen.queryByTestId("tray-full")).toBeNull();
  });

  it("below the cap the tray and the card behave as before", async () => {
    renderCars("/drive-cheap", BASE_STATE);
    await waitFor(() => expect(screen.getAllByTestId("tray-chip")).toHaveLength(BASE_STATE.selection.length), WAIT);
    expect(screen.getByRole("combobox", { name: "Add a car" })).toBeEnabled();
    expect(screen.queryByTestId("tray-full")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
    expect(screen.getByRole("button", { name: "Add these three to my selection" })).toBeEnabled();
  });
});
