import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postScenario, type ScenarioRequest } from "../../cars/api";
import { buildScenario } from "../../cars/mock/fixture";
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

describe("Option detail (spec 022 R11)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(postScenario).mockClear();
  });

  it("renders tiles, chart, cost bars and inputs; Override sends overrides and Clear removes them", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    const used = baseline.options.find((o) => o.option_kind === "used_1_3")!;
    const id = used.result.option_id;
    renderCars(`/cars/option/${id}`);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: used.result.label })).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Expected net cost per month")).toBeInTheDocument();
    expect(screen.getByText("Best exit")).toBeInTheDocument();
    expect(screen.getByText("Worst exit")).toBeInTheDocument();
    expect(screen.getByText("Down payment and fees")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /at exit after 12, 24, 36 and 48 months/ })).toBeInTheDocument();
    expect(screen.getByText("Where the money goes")).toBeInTheDocument();
    expect(screen.getByText("Value lost")).toBeInTheDocument();
    expect(screen.getByText("Inputs and sources")).toBeInTheDocument();
    expect(screen.getByText("Depreciation curve for this model")).toBeInTheDocument();
    const tileBefore = screen.getByTestId("tile-expected").textContent;

    fireEvent.click(screen.getByRole("button", { name: "Override Purchase price" }));
    fireEvent.change(screen.getByLabelText("New value for Purchase price"), { target: { value: "250000" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

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

  it("measure selector changes the tiles", async () => {
    const baseline = buildScenario(buildRequest(BASE_STATE));
    renderCars(`/cars/option/${baseline.options[0].result.option_id}`);
    await waitFor(() => expect(screen.getByTestId("tile-expected")).toBeInTheDocument(), WAIT);
    const before = screen.getByTestId("tile-expected").textContent;
    fireEvent.change(screen.getByLabelText("Cost measure"), { target: { value: "tco" } });
    await waitFor(() => expect(screen.getByText("Expected total cost of ownership")).toBeInTheDocument(), WAIT);
    expect(screen.getByTestId("tile-expected").textContent).not.toBe(before);
  });

  it("explains a missing option instead of crashing", async () => {
    renderCars("/cars/option/does-not-exist");
    await waitFor(() => expect(screen.getByText(/not in the current results/)).toBeInTheDocument(), WAIT);
    expect(screen.getByRole("link", { name: "Back to all options" })).toBeInTheDocument();
  });
});
