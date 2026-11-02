import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WAIT, renderCars } from "./helpers";

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

describe("Compare table (spec 022 R11)", () => {
  beforeEach(() => window.localStorage.clear());

  it("switching the measure changes the expected column and its unit", async () => {
    renderCars("/cars/compare");
    await waitFor(() => expect(screen.getAllByTestId("option-row").length).toBeGreaterThan(0), WAIT);
    expect(screen.getByRole("columnheader", { name: "Expected (kr per month)" })).toBeInTheDocument();
    const before = screen.getAllByTestId("expected").map((el) => el.textContent);
    expect(before[0]).toMatch(/kr$/);

    fireEvent.change(screen.getByLabelText("Cost measure"), { target: { value: "tco" } });
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Expected (kr)" })).toBeInTheDocument();
      const after = screen.getAllByTestId("expected").map((el) => el.textContent);
      expect(after[0]).not.toBe(before[0]);
    }, WAIT);

    fireEvent.change(screen.getByLabelText("Cost measure"), { target: { value: "per_km" } });
    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: "Expected (kr per km)" })).toBeInTheDocument();
      expect(screen.getAllByTestId("expected")[0].textContent).toMatch(/kr\/km$/);
    }, WAIT);
  });

  it("filters by way to get the car and lists ruled-out / skipped notes", async () => {
    renderCars("/cars/compare");
    await waitFor(() => expect(screen.getAllByTestId("option-row").length).toBeGreaterThan(0), WAIT);
    const all = screen.getAllByTestId("option-row").length;
    fireEvent.click(screen.getByRole("button", { name: "Lease" }));
    const leases = screen.getAllByTestId("option-row");
    expect(leases.length).toBeLessThan(all);
    for (const row of leases) expect(row.textContent).toContain("Lease");
    expect(screen.getByRole("button", { name: "Lease" })).toHaveAttribute("aria-pressed", "true");
    // Renault 5 has no 5+ year cohort in the fixture -> a skipped note.
    expect(screen.getByText(/No used 5\+ yr cohort for Renault 5/)).toBeInTheDocument();
    expect(screen.getByText("What moves the top result")).toBeInTheDocument();
  });
});

describe("Compare curves (spec 022 R11)", () => {
  it("relabels the y axis when the measure changes and draws one line per option", async () => {
    renderCars("/cars/compare/curves");
    await waitFor(() => expect(screen.getByTestId("curves-y-label")).toBeInTheDocument(), WAIT);
    expect(screen.getByTestId("curves-y-label").textContent).toBe("Net cost per month (kr per month)");
    const lines = screen.getAllByTestId("curve-line").length;
    expect(lines).toBeGreaterThan(1);
    expect(screen.getAllByTestId("curve-band")).toHaveLength(lines);

    fireEvent.change(screen.getByLabelText("Cost measure"), { target: { value: "npc" } });
    await waitFor(
      () => expect(screen.getByTestId("curves-y-label").textContent).toBe("Net present cost (kr (today's money))"),
      WAIT,
    );

    fireEvent.click(screen.getByLabelText(/Show uncertainty bands/));
    expect(screen.queryAllByTestId("curve-band")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Mark an exit point/), { target: { value: "4" } });
    expect(screen.getByText("Ranking if you leave at 4 years")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /exit marker at 4 years/ })).toBeInTheDocument();
  });
});
