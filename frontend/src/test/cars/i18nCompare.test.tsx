// Spec 028 R5-R7/R13 for DriveCheap Compare and Option detail: the table, the
// curves, the detail screen and the recommendations strip rendered in Bokmål
// and Turkish show no English UI text, no raw keys and no unfilled
// placeholders; keyed backend labels are translated and English backend
// prose is marked.

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildScenario } from "../../cars/mock/fixture";
import { buildRequest } from "../../cars/state";
import { resetLanguage, t, type Lang } from "../../i18n/core";
import { englishLeftovers, rawKeys, useLanguage } from "../i18nHelpers";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

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

// Car names come from the catalogue (R8: makes, models and trims stay as they
// are), e.g. "Tesla Model 3 Long Range RWD" or "Legg til Renault 5 52 kWh 2025".
const CAR_NAME = /Tesla|Renault|Volkswagen|Skoda|Kia|Hyundai|Polestar|Volvo|BYD|MG|Toyota|Nissan/;

afterEach(() => {
  cleanup();
  resetLanguage();
  window.localStorage.clear();
});

const LANGS: Lang[] = ["nb", "tr"];

// The mock fixture uses a few ids and keys the real backend never sends
// (`exit_cost`, `rent`, `insurance_year_nok`, `energy_price_nok_kwh`,
// `lease_rent`), so they have no catalogue key and fall back to the fixture's
// English label, as R6 says a new backend item should. The real keys
// (`exit_costs`, `lease_payments`, `insurance_annual`, `lease_monthly` …) are
// translated in backend.ts.
const MOCK_ONLY = /Cost to exit|Lease payments|Lease monthly payment|Insurance \(per year\)|Energy price/;

function check(container: HTMLElement) {
  expect(englishLeftovers(container, [CAR_NAME, MOCK_ONLY])).toEqual([]);
  expect(rawKeys(container)).toEqual([]);
}

describe.each(LANGS)("compare and detail in %s (028 R5-R7, R13)", (lang) => {
  it("Compare table and the recommendations strip", async () => {
    await useLanguage(lang);
    const { container } = renderCars("/drive-cheap/compare");
    await waitFor(() => expect(screen.getAllByTestId("option-row").length).toBeGreaterThan(0), WAIT);
    await waitFor(() => expect(screen.getAllByTestId("strip-row").length).toBeGreaterThan(0), WAIT);
    expect(screen.getByRole("heading", { level: 1, name: t("carsCompare.header.title") })).toBeInTheDocument();
    // Reason chips are keyed; ruled-out reasons and skipped notes are marked English (R7).
    expect(screen.getAllByText(t("carsCompare.reason.lowest")).length).toBeGreaterThan(0);
    const skipped = screen.getByText(/No used 5\+ yr cohort for Renault 5/);
    expect(skipped.closest('[lang="en"]')).not.toBeNull();
    check(container);

    // Every measure and filter, so all units, blurbs and pills are covered.
    for (const measure of ["tco", "npc", "cash_up_front", "per_km"]) {
      fireEvent.change(screen.getByLabelText(t("carsCompare.measure.select")), { target: { value: measure } });
      check(container);
    }
    fireEvent.click(screen.getByRole("button", { name: t("carsCompare.modeFilter.lease") }));
    check(container);
  });

  it("Compare curves", async () => {
    await useLanguage(lang);
    const { container } = renderCars("/drive-cheap/compare/curves");
    await waitFor(() => expect(screen.getByTestId("curves-y-label")).toBeInTheDocument(), WAIT);
    expect(screen.getByTestId("curves-y-label").textContent).toBe(
      `${t("carsCompare.measure.per_month.label")} (${t("carsCompare.measure.per_month.unit")})`,
    );
    check(container);
    fireEvent.click(screen.getByLabelText(t("carsCompare.curves.showBands")));
    check(container);
  });

  it("Option detail for a used car and a lease", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    for (const kind of ["used_1_3", "lease", "new"] as const) {
      const option = baseline.options.find((o) => o.option_kind === kind);
      if (!option) continue;
      await useLanguage(lang);
      const { container, unmount } = renderCars(`/drive-cheap/option/${option.result.option_id}`);
      await waitFor(
        () => expect(screen.getByRole("heading", { level: 1, name: option.result.label })).toBeInTheDocument(),
        WAIT,
      );
      check(container);
      if (kind === "used_1_3") {
        // A keyed cost line shows in the chosen language (R6).
        expect(screen.getByText(t("backend.display.value_lost"))).toBeInTheDocument();
        expect(t("backend.display.value_lost")).not.toBe("Value lost");
        // Open an override form so its labels are checked too.
        fireEvent.click(screen.getAllByText(t("carsCompare.detail.override"))[0]);
        check(container);
      }
      unmount();
    }
  });

  it("Start here card on Your situation", async () => {
    await useLanguage(lang);
    renderCars("/drive-cheap", { ...BASE_STATE, selection: [] });
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
    const card = screen.getByRole("region", { name: t("carsCompare.rec.startHere") });
    check(card);
    expect(screen.getByRole("button", { name: t("carsCompare.rec.addThree") })).toBeInTheDocument();
  });
});

describe("keyed lines in Bokmål (028 R6)", () => {
  it("shows Verditap for the value-lost line", async () => {
    await useLanguage("nb");
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const used = baseline.options.find((o) => o.option_kind === "used_1_3")!;
    renderCars(`/drive-cheap/option/${used.result.option_id}`);
    await waitFor(() => expect(screen.getByText("Verditap")).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Kjøp og salg")).toBeInTheDocument();
  });
});
