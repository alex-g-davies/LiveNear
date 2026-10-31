import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BASE_STATE, WAIT, renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
  };
});

describe("Situation (spec 022 R11)", () => {
  beforeEach(() => window.localStorage.clear());

  it("disables Continue with a visible message until the exit odds sum to 100 %", async () => {
    renderCars("/cars");
    const button = screen.getByRole("button", { name: "Compare options" });
    expect(button).toBeEnabled();
    expect(screen.getByText("Odds add up to 100 %.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/About 1 year/), { target: { value: "10" } });
    expect(button).toBeDisabled();
    expect(screen.getByText("Odds add up to 95 %. They must total 100 %.")).toBeInTheDocument();
    expect(screen.getByText("Fix the exit odds to continue.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/4\+ years/), { target: { value: "20" } });
    expect(button).toBeEnabled();
    expect(screen.queryByText(/Fix the exit odds/)).not.toBeInTheDocument();
  });

  it("gates on the charging mix too", () => {
    renderCars("/cars");
    fireEvent.change(screen.getByLabelText(/Public fast/), { target: { value: "30" } });
    expect(screen.getByRole("button", { name: "Compare options" })).toBeDisabled();
    expect(screen.getByText("Charging shares add up to 120 %. They must total 100 %.")).toBeInTheDocument();
  });

  it("lists vehicles grouped by make and model with the selection checked", async () => {
    renderCars("/cars");
    await waitFor(() => expect(screen.getByText("Tesla Model 3")).toBeInTheDocument(), WAIT);
    expect(screen.getByRole("heading", { name: "Renault 5" })).toBeInTheDocument();
    const lr = screen.getByRole("checkbox", { name: "Tesla Model 3 Long Range RWD" });
    expect(lr).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Kia EV6 Long Range RWD" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Tesla Model 3 Performance AWD" })).not.toBeChecked();
    // Year range selects appear for selected variants only.
    expect(screen.getAllByLabelText("From")).toHaveLength(BASE_STATE.selection.length);
  });

  it("saves a draft to localStorage", () => {
    renderCars("/cars");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(screen.getByText("Draft saved on this device.")).toBeInTheDocument();
    const raw = window.localStorage.getItem("livenear.cars.state");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).selection).toEqual(BASE_STATE.selection);
  });
});
