import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecommendRequest } from "../../cars/api";
import { DEFAULT_STATE } from "../../cars/lib/profile";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

const { postRecommend } = vi.hoisted(() => ({
  postRecommend: vi.fn(),
}));

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  postRecommend.mockImplementation(async (req: RecommendRequest) => fixture.buildRecommend(req));
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    postRecommend,
  };
});

const EMPTY_STATE = { ...DEFAULT_STATE, selection: [] };

describe("Start here card (spec 024 R12)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    postRecommend.mockClear();
    const fixture = await import("../../cars/mock/fixture");
    postRecommend.mockImplementation(async (req: RecommendRequest) => fixture.buildRecommend(req));
  });

  it("renders the top three with reason chips, the measure value and a badge", async () => {
    renderCars("/cars", EMPTY_STATE);
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
    const card = screen.getByRole("region", { name: "Start here" });
    expect(within(card).getByText(/Ranked from every car in the catalogue/)).toHaveTextContent(
      "by net cost per month",
    );
    const rows = screen.getAllByTestId("rec-row");
    expect(within(rows[0]).getByText("lowest expected cost")).toBeInTheDocument();
    for (const row of rows) {
      expect(within(row).getByTestId("rec-value").textContent).toMatch(/kr/);
      expect(within(row).getByText(/^(Live|Estimate)$/)).toBeInTheDocument();
    }
    // Each reason tag appears at most once across the card.
    const tags = rows.flatMap((r) => within(r).queryAllByText(/^(lowest expected cost|narrowest uncertainty band|best fun score|lowest cash up front)$/).map((el) => el.textContent));
    expect(new Set(tags).size).toBe(tags.length);
    // The request carried the profile and the measure, no selection.
    const calls = postRecommend.mock.calls;
    const req = calls[calls.length - 1][0] as RecommendRequest;
    expect(req.measure).toBe("per_month");
    expect(req.n).toBe(5);
    expect(req.profile.km_per_year).toBe(DEFAULT_STATE.profile.km_per_year);
  });

  it("adds the three cars to the selection and shows the added state", async () => {
    renderCars("/cars", BASE_STATE);
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
    const names = screen
      .getAllByTestId("rec-row")
      .map((r) => (r.querySelector(".cars-rec__name")?.textContent ?? "").replace(/ \d{4}$/, ""));
    expect(names.every((n) => n.length > 0)).toBe(true);
    const button = screen.getByRole("button", { name: "Add these three to my selection" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(
      () => expect(screen.getByRole("button", { name: "Added to your selection" })).toBeDisabled(),
      WAIT,
    );
    // Every recommended car now has a chip in the tray.
    const chips = screen.getAllByTestId("tray-chip").map((c) => c.textContent ?? "");
    for (const n of names) expect(chips.some((c) => c.includes(n))).toBe(true);
  });

  it("waits for a valid profile and shows the loading and error branches", async () => {
    const bad = { ...EMPTY_STATE, profile: { ...EMPTY_STATE.profile, exit_odds: { p12: 10, p24: 35, p36: 35, p48: 15 } } };
    renderCars("/cars", bad);
    expect(screen.getByTestId("rec-state")).toHaveTextContent("Fix the exit odds and charging shares");
    expect(postRecommend).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/About 1 year/), { target: { value: "15" } });
    expect(screen.getByTestId("rec-state")).toHaveTextContent("Ranking the catalogue…");
    await waitFor(() => expect(screen.getAllByTestId("rec-row")).toHaveLength(3), WAIT);
  });

  it("surfaces a failed request", async () => {
    postRecommend.mockImplementation(async () => {
      throw new Error("/cars/recommend -> 503: cars data unavailable");
    });
    renderCars("/cars", EMPTY_STATE);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not rank the catalogue"), WAIT);
    expect(screen.getByRole("alert")).toHaveTextContent("503");
  });

  it("explains an empty result with the ruled-out count", async () => {
    const fixture = await import("../../cars/mock/fixture");
    postRecommend.mockImplementation(async (req: RecommendRequest) => ({
      ...fixture.buildRecommend(req),
      rows: [],
      ruled_out: { "not AWD": 4, "over your max price": 8 },
    }));
    renderCars("/cars", EMPTY_STATE);
    await waitFor(() => expect(screen.getByTestId("rec-state")).toHaveTextContent("Nothing passed your limits"), WAIT);
    expect(screen.getByTestId("rec-state")).toHaveTextContent("12 options ruled out by your limits.");
  });
});

describe("Recommended for you strip on Compare (spec 024 R12)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    const fixture = await import("../../cars/mock/fixture");
    postRecommend.mockImplementation(async (req: RecommendRequest) => fixture.buildRecommend(req));
  });

  it("lists the rows, marks cars already compared and adds a single car", async () => {
    renderCars("/cars/compare", BASE_STATE);
    await waitFor(() => expect(screen.getAllByTestId("strip-row").length).toBeGreaterThan(0), WAIT);
    const strip = screen.getByRole("region", { name: "Recommended for you" });
    const addButtons = within(strip).getAllByRole("button", { name: /^Add / });
    expect(addButtons.length).toBeGreaterThan(0);
    const before = addButtons.length;
    const name = addButtons[0].getAttribute("aria-label")!.replace(/^Add /, "");
    fireEvent.click(addButtons[0]);
    await waitFor(() => {
      expect(within(strip).getAllByRole("button", { name: /^Add / })).toHaveLength(before - 1);
    }, WAIT);
    const row = screen.getAllByTestId("strip-row").find((r) => r.textContent?.includes(name.replace(/ \d{4}$/, "")));
    expect(row).toBeDefined();
    expect(within(row!).getByText("In your comparison")).toBeInTheDocument();
  });
});
