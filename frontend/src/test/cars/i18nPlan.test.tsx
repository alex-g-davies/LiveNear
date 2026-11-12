// Spec 028 R5/R13 for the DriveCheap plan screens: Your situation, Market and
// Checklist rendered in Bokmål and Turkish show no English UI text, no raw
// keys and no unfilled placeholders, and the Markdown checklist translates.

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHECKLIST_GROUPS, CHECKLIST_ITEMS, checklistMarkdown, type DueInfo } from "../../cars/lib/checklist";
import type { CarState } from "../../cars/lib/profile";
import { resetLanguage, t, type Lang } from "../../i18n/core";
import { englishLeftovers, rawKeys, useLanguage } from "../i18nHelpers";
import { BASE_STATE, WAIT, renderCars } from "./helpers";

vi.mock("../../cars/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../cars/api")>();
  const fixture = await import("../../cars/mock/fixture");
  type F = import("../../cars/api").MarketFilters;
  return {
    ...actual,
    getVehicles: vi.fn(async () => fixture.buildVehicles()),
    postScenario: vi.fn(async (req: import("../../cars/api").ScenarioRequest) => fixture.buildScenario(req)),
    postRecommend: vi.fn(async (req: import("../../cars/api").RecommendRequest) => fixture.buildRecommend(req)),
    getCohorts: vi.fn(async (f: F) => fixture.buildCohorts(f)),
    getMarketPoints: vi.fn(async (f: F) => fixture.buildMarketPoints(f)),
    getSources: vi.fn(async () => ({
      bundle_as_of: "2026-10-31",
      listings_mode: "fixture",
      sources: [],
      pending_rules: [{ id: "ev_vat_2027_proposed", kind: "ev_vat", effective_from: "2027-01-01" }],
      unverified_rules: [],
    })),
  };
});

// Every optional block visible: quotes, must-haves, dated checklist items and
// the "only if" notes (modes without lease or used).
const FULL: CarState = {
  ...BASE_STATE,
  profile: {
    ...BASE_STATE.profile,
    arrival_date: "2026-03-15",
    start_date: "2026-12-01",
    limits: { ...BASE_STATE.profile.limits, must_haves: ["heat_pump"], modes: ["new"] },
  },
  checklist: ["claims_free_letter"],
};

// Car names come from the catalogue (R8: makes and models stay as they are),
// e.g. "Tesla Model 3 Long Range RWD" or a "Remove …" label built from one.
const CAR_NAME = /Tesla|Renault|Volkswagen|Skoda|Kia|Hyundai|Polestar|Volvo|BYD|MG|Toyota|Nissan/;

afterEach(() => {
  cleanup();
  resetLanguage();
  window.localStorage.clear();
});

const LANGS: Lang[] = ["nb", "tr"];

describe.each(LANGS)("plan screens in %s (028 R5, R13)", (lang) => {
  it("Your situation has no English UI text or raw keys", async () => {
    await useLanguage(lang);
    const { container } = renderCars("/drive-cheap", FULL);
    await waitFor(() => expect(screen.getAllByTestId("tray-chip").length).toBe(2), WAIT);
    // Show the per-car quote fields too.
    fireEvent.click(screen.getByRole("checkbox", { name: t("carsPlan.situation.ins.ownQuotes") }));
    expect(englishLeftovers(container, [CAR_NAME])).toEqual([]);
    expect(rawKeys(container)).toEqual([]);
  });

  it("Market has no English UI text or raw keys", async () => {
    await useLanguage(lang);
    const { container } = renderCars("/drive-cheap/market", FULL);
    await waitFor(() => expect(screen.getAllByTestId("market-dot").length).toBeGreaterThan(10), WAIT);
    expect(englishLeftovers(container, [CAR_NAME])).toEqual([]);
    expect(rawKeys(container)).toEqual([]);
  });

  it("Checklist has no English UI text or raw keys", async () => {
    await useLanguage(lang);
    const { container } = renderCars("/drive-cheap/checklist", FULL);
    await waitFor(() => expect(screen.getByTestId("check-ev_tax_changes").textContent).toMatch(/2027/), WAIT);
    await waitFor(() => expect(screen.getByTestId("impact-insurance_quotes")).toBeInTheDocument(), WAIT);
    // The impact tooltips repeat the backend's sensitivity note, English prose
    // with no key (R7); it carries the "(English)" tag in the current language.
    const tagged = new RegExp(`${t("common.englishTag").replace(/[()]/g, "\\$&")}$`);
    expect(screen.getByTestId("impact-insurance_quotes").parentElement!.getAttribute("title")).toMatch(tagged);
    expect(englishLeftovers(container, [tagged])).toEqual([]);
    expect(rawKeys(container)).toEqual([]);
  });

  it("switching language re-renders the checklist without a reload (R3)", async () => {
    renderCars("/drive-cheap/checklist", FULL);
    const english = CHECKLIST_GROUPS[0].title;
    expect(screen.getByRole("heading", { level: 2, name: english })).toBeInTheDocument();
    await useLanguage(lang);
    expect(screen.queryByRole("heading", { level: 2, name: english })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: CHECKLIST_GROUPS[0].title })).toBeInTheDocument();
  });

  it("the Markdown checklist is translated, with the ISO date kept", async () => {
    await useLanguage(lang);
    const dues = new Map<string, DueInfo | null>([
      ["licence_exchange", { kind: "date", iso: "2027-03-15", basis: "x", url: null }],
      ["ev_tax_changes", { kind: "missing", text: "y", to: "/drive-cheap" }],
    ]);
    const md = checklistMarkdown({ ticked: [], dues, modes: ["new"], generatedOn: "2026-11-01" });
    expect(md).toContain("2026-11-01");
    expect(md).not.toMatch(/Norway car checklist|Generated|Due|estimate|only if/);
    for (const g of CHECKLIST_GROUPS) expect(md).toContain(`## ${g.title}`);
    for (const i of CHECKLIST_ITEMS) expect(md).toContain(`${i.title} — ${i.why}`);
    expect(md).not.toMatch(/\{\w+\}|carsPlan\./);
    expect(md.match(/^- \[[ x]\] /gm)).toHaveLength(11);
  });
});
