import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { postScenario, type ScenarioRequest } from "../../cars/api";
import { WAIT, renderCars } from "./helpers";

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

describe("What-if sliders (spec 022 R11)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(postScenario).mockClear();
  });

  it("sends slider values as what_if without touching the profile, then Save moves them in", async () => {
    renderCars("/cars/compare/curves");
    await waitFor(() => expect(postScenario).toHaveBeenCalled(), WAIT);
    expect(lastRequest().what_if).toBeNull();

    fireEvent.change(screen.getByLabelText(/Km per year/), { target: { value: "20000" } });
    fireEvent.change(screen.getByLabelText(/Loan rate/), { target: { value: "7.5" } });
    await waitFor(() => {
      expect(lastRequest().what_if).toEqual({ km_per_year: 20000, loan_rate_pct: 7.5 });
    }, WAIT);
    expect(lastRequest().profile.km_per_year).toBe(12000);
    expect(screen.getByText("What-if active")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save as my assumptions" }));
    await waitFor(() => {
      const req = lastRequest();
      expect(req.what_if).toBeNull();
      expect(req.profile.km_per_year).toBe(20000);
      expect(req.overrides.loan_rate).toBe(7.5);
    }, WAIT);
    expect(screen.queryByText("What-if active")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
  });

  it("Reset clears the what-if and reruns with the saved profile", async () => {
    renderCars("/cars/compare/curves");
    await waitFor(() => expect(postScenario).toHaveBeenCalled(), WAIT);
    fireEvent.click(screen.getByLabelText("Cash"));
    fireEvent.change(screen.getByLabelText(/Return your cash earns/), { target: { value: "6" } });
    await waitFor(
      () => expect(lastRequest().what_if).toEqual({ pay_mode: "cash", return_on_cash_pct: 6 }),
      WAIT,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(lastRequest().what_if).toBeNull(), WAIT);
    expect(lastRequest().profile.pay_mode).toBe("loan");
    expect(lastRequest().profile.return_on_cash_pct).toBe(4);
  });
});
