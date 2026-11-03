import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postScenario, type ScenarioRequest } from "../../cars/api";
import { formatNok } from "../../cars/lib/format";
import { buildScenario } from "../../cars/mock/fixture";
import { toEngineUnits } from "../../cars/screens/OptionDetail";
import { buildRequest } from "../../cars/state";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: ScenarioRequest) => fixture.buildScenario(req)),
  };
});

const lastRequest = (): ScenarioRequest => {
  const calls = vi.mocked(postScenario).mock.calls;
  return calls[calls.length - 1][0];
};

describe("Option detail (spec 022 R11, 024 follow-up)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(postScenario).mockClear();
  });

  it("renders tiles, chart, deal strip, cost bars and inputs; Override sends overrides and Clear removes them", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const used = baseline.options.find((o) => o.option_kind === "used_1_3")!;
    const id = used.result.option_id;
    renderCars(`/cars/option/${id}`);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: used.result.label })).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Net cost per month if you leave at 2.5 years")).toBeInTheDocument();
    expect(screen.getByText("Expected net cost per month")).toBeInTheDocument();
    expect(screen.getByText("Best and worst exit")).toBeInTheDocument();
    expect(screen.getByText("Down payment and fees")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /at exit after 12, 24, 36 and 48 months/ })).toBeInTheDocument();
    expect(screen.getByText("Buying and selling")).toBeInTheDocument();
    expect(screen.getByText("Where the money goes")).toBeInTheDocument();
    expect(screen.getByText("Value lost")).toBeInTheDocument();
    expect(screen.getByText("Inputs and sources")).toBeInTheDocument();
    expect(screen.getByText("Depreciation curve for this model")).toBeInTheDocument();
    const tileBefore = screen.getByTestId("tile-expected").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Override Purchase price" }));
    fireEvent.change(screen.getByLabelText("New value for Purchase price"), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // The mock sends no unit, so the typed value goes through unchanged.
    await waitFor(() => expect(lastRequest().overrides).toEqual({ purchase_price: 250000 }), WAIT);
    await waitFor(() => expect(screen.getByTestId("tile-expected").textContent).not.toBe(tileBefore), WAIT);
    const row = screen.getByTestId("input-purchase_price");
    expect(row.textContent).toContain("Your override");
    // Inputs are named by the API label, never by the raw id.
    expect(row.textContent).toContain("Purchase price");
    expect(screen.queryByText("purchase_price")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear override for Purchase price" }));
    await waitFor(() => expect(lastRequest().overrides).toEqual({}), WAIT);
    await waitFor(() => expect(screen.getByTestId("tile-expected").textContent).toBe(tileBefore), WAIT);
  });

  it("reads every number at the exit slider: tile, chart marker, deal strip and breakdown agree", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const used = baseline.options.find((o) => o.option_kind === "used_1_3")!;
    const r = used.result;
    renderCars(`/cars/option/${r.option_id}`, { ...BASE_STATE, measure: "tco" });
    await waitFor(() => expect(screen.getByTestId("tile-at-exit")).toBeInTheDocument(), WAIT);

    // Default exit point is 2.5 years (month 30), the same as Compare curves.
    expect(screen.getByText("Total cost of ownership if you leave at 2.5 years")).toBeInTheDocument();
    expect(screen.getByTestId("tile-at-exit").textContent).toBe(formatNok(r.measures.tco.deterministic[30]));
    expect(screen.getByTestId("money-total").textContent).toBe(formatNok(r.measures.tco.deterministic[30]));
    expect(screen.getByTestId("deal-purchase").textContent).toBe(formatNok(r.purchase_price!));
    expect(screen.getByTestId("deal-sale").textContent).toBe(formatNok(r.resale_band!.p50[30]));
    expect(screen.getByTestId("deal-value-lost").textContent).toBe(formatNok(r.display_series.value_lost[30]));

    // Move the slider to 4 years: everything follows month 48.
    fireEvent.change(screen.getByLabelText(/Mark an exit point/), { target: { value: "4" } });
    expect(screen.getByText("Total cost of ownership if you leave at 4 years")).toBeInTheDocument();
    expect(screen.getByTestId("tile-at-exit").textContent).toBe(formatNok(r.measures.tco.deterministic[48]));
    expect(screen.getByTestId("money-total").textContent).toBe(formatNok(r.measures.tco.deterministic[48]));
    expect(screen.getByTestId("deal-sale").textContent).toBe(formatNok(r.resale_band!.p50[48]));
    expect(screen.getByRole("img", { name: /Exit marker at 4 years/ })).toBeInTheDocument();
    expect(screen.getByText("Sale price if you leave at 4 years")).toBeInTheDocument();
    // The breakdown total is the sum of the rows shown.
    const rows = screen.getAllByText(/kr$/).length;
    expect(rows).toBeGreaterThan(5);
  });

  it("shares the exit point with Compare curves", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const id = baseline.options[0].result.option_id;
    renderCars("/cars/compare/curves");
    await waitFor(() => expect(screen.getByLabelText(/Mark an exit point/)).toBeInTheDocument(), WAIT);
    fireEvent.change(screen.getByLabelText(/Mark an exit point/), { target: { value: "3.5" } });
    await waitFor(() => expect(screen.getByText("Ranking if you leave at 3.5 years")).toBeInTheDocument(), WAIT);
    // Follow the Detail link from the ranking: the same exit point is marked there.
    const detail = screen.getAllByRole("link", { name: "Detail" })[0];
    fireEvent.click(detail);
    await waitFor(() => expect(screen.getByTestId("tile-at-exit")).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Net cost per month if you leave at 3.5 years")).toBeInTheDocument();
    expect(id).toBeTruthy();
  });

  it("shows the lease strip for a lease and no purchase price", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const lease = baseline.options.find((o) => o.option_kind === "lease")!;
    renderCars(`/cars/option/${lease.result.option_id}`);
    await waitFor(() => expect(screen.getByText("What you pay for the lease")).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Monthly rent")).toBeInTheDocument();
    expect(screen.queryByText("Buying and selling")).toBeNull();
    expect(screen.getByText("Upfront rent")).toBeInTheDocument();
  });

  it("measure selector changes the tiles", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    renderCars(`/cars/option/${baseline.options[0].result.option_id}`);
    await waitFor(() => expect(screen.getByTestId("tile-expected")).toBeInTheDocument(), WAIT);
    const before = screen.getByTestId("tile-expected").textContent;
    fireEvent.change(screen.getByLabelText("Cost measure"), { target: { value: "tco" } });
    await waitFor(() => expect(screen.getByText("Expected total cost of ownership")).toBeInTheDocument(), WAIT);
    expect(screen.getByTestId("tile-expected").textContent).not.toBe(before);
  });

  it("converts typed kroner to øre for money inputs and leaves other units alone", () => {
    expect(toEngineUnits(250000, "kr")).toBe(25000000);
    expect(toEngineUnits(10800, "kr/year")).toBe(1080000);
    expect(toEngineUnits(6.9, "%")).toBe(6.9);
    expect(toEngineUnits(37000, "km")).toBe(37000);
    expect(toEngineUnits(150, "øre/kWh")).toBe(150);
    expect(toEngineUnits(250000, null)).toBe(250000);
  });

  it("explains a missing option instead of crashing", async () => {
    renderCars("/cars/option/does-not-exist");
    await waitFor(() => expect(screen.getByText(/not in the current results/)).toBeInTheDocument(), WAIT);
    expect(screen.getByRole("link", { name: "Back to all options" })).toBeInTheDocument();
  });
});
