import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STATE, type CarState } from "../../cars/lib/profile";
import {
  CHECKLIST_ITEMS,
  addMonths,
  checklistMarkdown,
  dueFor,
  impactRows,
  nextAnniversary,
  type DueInfo,
} from "../../cars/lib/checklist";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    postRecommend: vi.fn(async (req: import("../../cars/api").RecommendRequest) => fixture.buildRecommend(req)),
    getSources: vi.fn(async () => ({
      bundle_as_of: "2026-10-31",
      listings_mode: "fixture",
      sources: [],
      pending_rules: [{ id: "ev_vat_2027_proposed", kind: "ev_vat", effective_from: "2027-01-01" }],
      unverified_rules: [],
    })),
  };
});

const WITH_ARRIVAL: CarState = {
  ...BASE_STATE,
  profile: { ...BASE_STATE.profile, arrival_date: "2026-03-15", start_date: "2026-12-01" },
  checklist: ["claims_free_letter", "toll_tag"],
};

describe("Newcomer checklist (spec 023 R4-R7)", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the eleven items in three groups with ticks from state", async () => {
    renderCars("/drive-cheap/checklist", WITH_ARRIVAL);
    expect(screen.getByRole("heading", { level: 1, name: "Newcomer checklist" })).toBeInTheDocument();
    for (const title of ["Before you choose", "Before you sign", "After you get the car"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getAllByRole("checkbox")).toHaveLength(11);
    expect(screen.getByRole("checkbox", { name: "Get a toll tag" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Fit winter tyres" })).not.toBeChecked();
    expect(screen.getByTestId("progress").textContent).toBe("2 of 11 done");

    fireEvent.click(screen.getByRole("checkbox", { name: "Fit winter tyres" }));
    expect(screen.getByRole("checkbox", { name: "Fit winter tyres" })).toBeChecked();
    expect(screen.getByTestId("progress").textContent).toBe("3 of 11 done");
    fireEvent.click(screen.getByRole("checkbox", { name: "Get a toll tag" }));
    expect(screen.getByRole("checkbox", { name: "Get a toll tag" })).not.toBeChecked();
    // Persisted: the provider mirrors state to localStorage.
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem("livenear.cars.state") ?? "{}") as CarState;
      expect(saved.checklist).toEqual(["claims_free_letter", "winter_tyres"]);
    }, WAIT);
  });

  it("derives due dates from the arrival and start dates and the pending EV rule", async () => {
    renderCars("/drive-cheap/checklist", WITH_ARRIVAL);
    const licence = screen.getByTestId("check-licence_exchange");
    expect(licence.textContent).toMatch(/Due 15\sMar\s2027/);
    expect(licence.textContent).toContain("Statens vegvesen");
    expect(screen.getByTestId("check-winter_tyres").textContent).toMatch(/Due 1\sNov\s2027/);
    await waitFor(
      () => expect(screen.getByTestId("check-ev_tax_changes").textContent).toMatch(/Due 1\sJan\s2027/),
      WAIT,
    );
    // 027 R5: the rule is described in words, never by its id.
    expect(screen.getByTestId("check-ev_tax_changes").textContent).toContain("Proposed change, not yet law");
    expect(screen.getByTestId("check-ev_tax_changes").textContent).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/);
    expect(screen.getByTestId("next-due").textContent).toContain("Check upcoming tax changes");
  });

  it("asks for the arrival date when it is missing and marks items for ways not kept", () => {
    const state: CarState = {
      ...BASE_STATE,
      profile: { ...BASE_STATE.profile, limits: { ...BASE_STATE.profile.limits, modes: ["new"] } },
    };
    renderCars("/drive-cheap/checklist", state);
    const licence = screen.getByTestId("check-licence_exchange");
    expect(licence.textContent).not.toMatch(/Due \d/);
    expect(screen.getByRole("link", { name: /Add your arrival date/ })).toHaveAttribute("href", "/drive-cheap");
    expect(screen.getByTestId("check-lease_terms").textContent).toContain("only if you lease");
    expect(screen.getByTestId("check-prefer_dealer").textContent).toContain("only if you go used");
    expect(screen.getByTestId("check-toll_tag").textContent).not.toContain("only if");
  });

  it("shows the impact panel from the scenario's sensitivity rows", async () => {
    renderCars("/drive-cheap/checklist", BASE_STATE);
    await waitFor(() => expect(screen.getByTestId("impact-insurance_quotes")).toBeInTheDocument(), WAIT);
    expect(screen.getByTestId("impact-insurance_quotes").textContent).toMatch(/^± [\d  ]+ kr \/ yr$/);
    expect(screen.getByTestId("impact-claims_free_letter").textContent).toMatch(/^up to [-+][\d  ]+ kr \/ yr$/);
    expect(screen.getByRole("link", { name: "See how each changes your ranking" })).toHaveAttribute(
      "href",
      "/drive-cheap/compare",
    );
  });

  it("points to Compare when no scenario has run", () => {
    renderCars("/drive-cheap/checklist", { ...DEFAULT_STATE, selection: [] });
    expect(screen.getByRole("link", { name: "Run a comparison" })).toHaveAttribute("href", "/drive-cheap/compare");
  });

  it("download reports when object URLs are unavailable and otherwise builds the file", () => {
    renderCars("/drive-cheap/checklist", WITH_ARRIVAL);
    fireEvent.click(screen.getByRole("button", { name: "Download checklist" }));
    expect(screen.getByRole("status").textContent).toMatch(/Saved norway-car-checklist\.md|not available/);
  });
});

describe("checklist helpers (spec 023 R5, R7)", () => {
  it("date arithmetic is calendar-safe", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", 12)).toBe("2027-03-15");
    expect(nextAnniversary("2026-10-31", 11, 1)).toBe("2026-11-01");
    expect(nextAnniversary("2026-11-01", 11, 1)).toBe("2026-11-01");
    expect(nextAnniversary("2026-11-02", 11, 1)).toBe("2027-11-01");
  });

  it("dueFor covers the three dated items and their missing/unknown states", () => {
    const licence = CHECKLIST_ITEMS.find((i) => i.id === "licence_exchange")!;
    const ev = CHECKLIST_ITEMS.find((i) => i.id === "ev_tax_changes")!;
    const base = { arrivalDate: null, startDate: null, today: "2026-11-01", pendingEvRule: undefined };
    expect(dueFor(licence, base)).toMatchObject({ kind: "missing", to: "/drive-cheap" });
    expect(dueFor(licence, { ...base, arrivalDate: "2026-05-01" })).toMatchObject({ kind: "date", iso: "2027-05-01" });
    expect(dueFor(ev, base)).toBeNull();
    expect(dueFor(ev, { ...base, pendingEvRule: null })).toBeNull();
    expect(dueFor(ev, { ...base, pendingEvRule: "unknown" })).toMatchObject({ kind: "unknown" });
    expect(dueFor(ev, { ...base, pendingEvRule: { id: "x" } })).toMatchObject({ kind: "date", iso: "2027-01-01" });
  });

  it("impactRows reads the insurance band and the exit band for a lease", () => {
    const data = {
      ranking_measure: "per_month",
      sensitivity: [
        { driver: "insurance", label: "Insurance", low: -10_000, high: 30_000, note: "" },
        { driver: "exit_timing", label: "When you leave", low: -5_000, high: 120_000, note: "" },
      ],
      sensitivity_option_id: "L",
      options: [{ option_kind: "lease", result: { option_id: "L" } }],
    } as unknown as import("../../cars/api").ScenarioResponse;
    const rows = impactRows(data);
    expect(rows.map((r) => r.id)).toEqual(["insurance_quotes", "claims_free_letter", "lease_terms"]);
    expect(rows[0].text).toBe("± 2 400 kr / yr"); // half of 40 000 øre/month = 20 000 øre x 12
    expect(rows[1].text).toBe("up to -1 200 kr / yr");
    expect(rows[2].text).toBe("up to +14 400 kr / yr");
    expect(impactRows({ ...data, options: [{ option_kind: "new", result: { option_id: "L" } }] } as never)).toHaveLength(2);
    expect(impactRows(null)).toEqual([]);
  });

  it("checklistMarkdown lists every item with ticks, dues and mode notes", () => {
    const dues = new Map<string, DueInfo | null>([
      ["licence_exchange", { kind: "date", iso: "2027-03-15", basis: "basis text", url: null }],
    ]);
    const md = checklistMarkdown({
      ticked: ["claims_free_letter"],
      dues,
      modes: ["new"],
      generatedOn: "2026-11-01",
    });
    expect(md.startsWith("# Norway car checklist\n\nGenerated 2026-11-01.")).toBe(true);
    expect(md).toContain("## Before you choose");
    expect(md).toContain("- [x] Ask your previous insurer for a claims-free letter — ");
    expect(md).toContain("- [ ] Find your driving licence exchange deadline — ");
    expect(md).toContain("  Due 15 Mar 2027 (estimate: basis text)");
    expect(md).toContain("(Cost to exit; only if you lease)");
    expect(md.match(/^- \[[ x]\] /gm)).toHaveLength(11);
  });
});

describe("Situation additions (spec 023 R3, R5)", () => {
  it("has the arrival date field and a Browse the market link", () => {
    renderCars("/drive-cheap", WITH_ARRIVAL);
    const field = screen.getByLabelText(/arrive in Norway/) as HTMLInputElement;
    expect(field.value).toBe("2026-03-15");
    fireEvent.change(field, { target: { value: "2026-04-01" } });
    expect((screen.getByLabelText(/arrive in Norway/) as HTMLInputElement).value).toBe("2026-04-01");
    expect(screen.getByRole("link", { name: "Browse the market" })).toHaveAttribute("href", "/drive-cheap/market");
    expect(screen.getByRole("button", { name: "Compare options" })).toBeInTheDocument();
  });
});
