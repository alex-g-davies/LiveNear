import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("Situation (spec 022 R11, 024 R5/R10)", () => {
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

  it("shows one chip per selected car with year selects (024 R10)", async () => {
    renderCars("/cars");
    await waitFor(() => expect(screen.getAllByTestId("tray-chip")).toHaveLength(BASE_STATE.selection.length), WAIT);
    expect(screen.getByRole("button", { name: "Remove Tesla Model 3 Long Range RWD" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Renault 5 52 kWh" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Kia EV6 Long Range RWD" })).toBeNull();
    expect(screen.getAllByLabelText("From")).toHaveLength(BASE_STATE.selection.length);
    expect(screen.getByText("2 selected.", { exact: false })).toBeInTheDocument();
  });

  it("adds a car from the typeahead with the keyboard, grouped by make", async () => {
    renderCars("/cars");
    await waitFor(() => expect(screen.getAllByTestId("tray-chip")).toHaveLength(2), WAIT);
    const box = screen.getByRole("combobox", { name: "Add a car" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "ev6" } });
    const list = screen.getByRole("listbox", { name: "Catalogue" });
    expect(within(list).getByRole("group", { name: "Kia" })).toBeInTheDocument();
    expect(within(list).queryByRole("group", { name: "Tesla" })).toBeNull();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove Kia EV6 Long Range RWD" })).toBeInTheDocument();
    expect(screen.getAllByTestId("tray-chip")).toHaveLength(3);
    expect(box).toHaveValue("");
    expect(screen.queryByRole("listbox")).toBeNull();
    // Already-selected cars are listed but disabled.
    fireEvent.focus(box);
    const taken = within(screen.getByRole("listbox", { name: "Catalogue" })).getByRole("option", {
      name: /Kia EV6 Long Range RWD/,
    });
    expect(taken).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("removes a chip, clamps year edits and gates on an empty selection", async () => {
    renderCars("/cars");
    await waitFor(() => expect(screen.getAllByTestId("tray-chip")).toHaveLength(2), WAIT);
    const [from, to] = [screen.getAllByLabelText("From")[0], screen.getAllByLabelText("To")[0]];
    fireEvent.change(to, { target: { value: "2023" } });
    fireEvent.change(from, { target: { value: "2025" } });
    expect(from).toHaveValue("2025");
    expect(to).toHaveValue("2025");

    fireEvent.click(screen.getByRole("button", { name: "Remove Renault 5 52 kWh" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Tesla Model 3 Long Range RWD" }));
    expect(screen.queryAllByTestId("tray-chip")).toHaveLength(0);
    expect(screen.getByText(/No cars yet\. Add one here or/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "browse the market" })).toHaveAttribute("href", "/cars/market");
    expect(screen.getByText("Pick at least one car to compare.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare options" })).toBeDisabled();
  });

  it("keeps the toll passages field in the profile (024 R5)", async () => {
    renderCars("/cars");
    const field = screen.getByLabelText(/Toll ring passages per week/);
    expect(field).toHaveValue(0);
    fireEvent.change(field, { target: { value: "12" } });
    expect(field).toHaveValue(12);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    const raw = JSON.parse(window.localStorage.getItem("livenear.cars.state")!);
    expect(raw.profile.toll_passages_per_week).toBe(12);
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
