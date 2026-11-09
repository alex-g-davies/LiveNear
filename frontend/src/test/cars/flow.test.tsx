import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE } from "../../cars/lib/profile";
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

describe("Cars flow across the four screens (spec 022 R1/R11/R12)", () => {
  beforeEach(() => window.localStorage.clear());

  it("situation -> compare table -> curves -> detail -> back", async () => {
    // Start with no selection: the default (first four variants) is applied
    // once the vehicle catalogue lands.
    renderCars("/drive-cheap", DEFAULT_STATE);
    expect(screen.getByRole("heading", { level: 1, name: "Your situation" })).toBeInTheDocument();
    expect(screen.getByText("Car costs for newcomers to Norway")).toBeInTheDocument();
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Remove Tesla Model 3 Long Range RWD" })).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.queryByRole("button", { name: "Remove MG MG4 XPower" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compare options" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Compare options" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("option-row").length).toBeGreaterThan(3), WAIT);
    expect(screen.getByText("Selection: 4 cars")).toBeInTheDocument();
    expect(screen.getAllByText("Estimate").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("link", { name: "Curves" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /years of ownership/ })).toBeInTheDocument(), WAIT);
    expect(screen.getByText("What if")).toBeInTheDocument();

    const ranking = screen.getByText(/Ranking if you leave at/).parentElement!;
    const firstName = within(ranking).getAllByRole("listitem")[0].querySelector(".cars-strong")!.textContent!;
    fireEvent.click(within(ranking).getAllByRole("link", { name: "Detail" })[0]);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: firstName })).toBeInTheDocument(), WAIT);
    expect(screen.getByText("Inputs and sources")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Steps" }).textContent).toContain("4 Detail");

    fireEvent.click(screen.getByRole("link", { name: "Back to all options" }));
    await waitFor(() => expect(screen.getAllByTestId("option-row").length).toBeGreaterThan(3), WAIT);

    fireEvent.click(screen.getByRole("link", { name: "Edit" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Your situation" })).toBeInTheDocument();
  });

  it("redirects unknown /cars paths to the form", async () => {
    renderCars("/drive-cheap/nope/deeper");
    expect(await screen.findByRole("heading", { level: 1, name: "Your situation" })).toBeInTheDocument();
  });
});
