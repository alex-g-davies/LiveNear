import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ZipValue } from "../api/client";
import ZipDetailPanel, { type ZipContext } from "../components/ZipDetailPanel";

const FULL: ZipValue = {
  zip: "98103",
  median_value: 937500,
  yoy_pct: -2.5,
  cagr5_pct: 1.6,
  ppsf: 612,
  history: [
    ["2024-Q1", 890000],
    ["2026-Q2", 937500],
  ],
  population: 48000,
  median_income: 112000,
  price_to_income: 8.4,
  name: "Fremont",
};

const OTHER: ZipValue = {
  zip: "99201",
  median_value: 450000,
  yoy_pct: 3.5,
  cagr5_pct: 4.0,
  ppsf: 280,
  history: null,
  population: 22000,
  median_income: 70000,
  price_to_income: 6.4,
  name: "Spokane",
};

const CONTEXT: ZipContext = {
  percentile: 82,
  vsStateMedianPct: 31.4,
  commuteReach: "Within a 30-min drive of work in typical midday — bad days run longer",
  driveToWork: "Drive to work: ~52 min (Mon 8:00 AM)",
  driveHome: "Drive home: ~64 min (Mon 5:30 PM)",
  driveToWork2: null,
  driveHome2: null,
};

const EMPTY_CONTEXT: ZipContext = {
  percentile: null,
  vsStateMedianPct: null,
  commuteReach: null,
  driveToWork: null,
  driveHome: null,
  driveToWork2: null,
  driveHome2: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ZipDetailPanel>[0]> = {}) {
  const props = {
    zip: "98103",
    record: FULL as ZipValue | undefined,
    metroLabel: "Washington",
    stateCode: "WA",
    budget: 0,
    context: CONTEXT,
    estimating: false,
    wiki: null as Parameters<typeof ZipDetailPanel>[0]["wiki"],
    onClose: vi.fn(),
    pinnedZip: null as string | null,
    pinnedRecord: undefined as ZipValue | undefined,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    ...overrides,
  };
  render(<ZipDetailPanel {...props} />);
  return props;
}

describe("ZipDetailPanel (009 R2/R9)", () => {
  it("renders the full record with ACS fields and context", () => {
    renderPanel();
    expect(screen.getByText("Fremont, WA 98103")).toBeInTheDocument(); // 012 R2
    expect(screen.getByText("$937,500")).toBeInTheDocument();
    expect(screen.getByText("-2.5%")).toBeInTheDocument();
    expect(screen.getByText("48,000")).toBeInTheDocument();
    expect(screen.getByText("$112,000")).toBeInTheDocument();
    expect(screen.getByText("8.4×")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText(/Within a 30-min drive/)).toBeInTheDocument();
    expect(screen.getByText(/Drive to work: ~52 min/)).toBeInTheDocument();
    expect(screen.getByText(/Drive home: ~64 min/)).toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument(); // price chart
  });

  it("omits the routed drive lines when no estimate exists (011 R6)", () => {
    renderPanel({ context: EMPTY_CONTEXT });
    expect(screen.queryByText(/Drive to work/)).toBeNull();
    expect(screen.queryByText(/Drive home/)).toBeNull();
  });

  it("shows the estimating line while the commute fetch is in flight (013 R3)", () => {
    renderPanel({ context: EMPTY_CONTEXT, estimating: true });
    expect(screen.getByText("Estimating commute…")).toBeInTheDocument();
  });

  it("collapse toggle flips state and aria-expanded (015 R5)", () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: "Collapse details" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    const expanded = screen.getByRole("button", { name: "Expand details" });
    expect(expanded).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".zip-detail--collapsed")).not.toBeNull();
  });

  it("shows budget fit when a budget is set", () => {
    renderPanel({ budget: 1000000, context: EMPTY_CONTEXT });
    expect(screen.getByText("Under budget by $62,500")).toBeInTheDocument();
  });

  it("echoes the ZIP's monthly payment in payment mode only (020 R4)", () => {
    const spec = { mode: "payment" as const, price: 0, payment: 5000, downPct: 20, ratePct: 6.5 };
    renderPanel({ budget: 1000000, budgetSpec: spec, context: EMPTY_CONTEXT });
    // 937,500 × 0.0063064 ≈ 5,912/mo under the same assumptions.
    expect(screen.getByText(/Under budget by \$62,500 · ≈ \$5,912\/mo/)).toBeInTheDocument();
  });

  it("omits the monthly echo in price mode", () => {
    const spec = { mode: "price" as const, price: 1000000, payment: 0, downPct: 20, ratePct: 6.5 };
    renderPanel({ budget: 1000000, budgetSpec: spec, context: EMPTY_CONTEXT });
    expect(screen.getByText("Under budget by $62,500")).toBeInTheDocument();
    expect(screen.queryByText(/\/mo/)).toBeNull();
  });

  it("degrades to dashes without a record (R9)", () => {
    renderPanel({ zip: "99999", record: undefined, budget: 500000, context: EMPTY_CONTEXT });
    expect(screen.getByText("ZIP 99999")).toBeInTheDocument(); // no name -> ZIP label
    expect(screen.getByText("No price data")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText(/budget by/)).toBeNull(); // no value -> no badge
    expect(screen.getByText("No price history for this ZIP.")).toBeInTheDocument();
  });

  it("fires onClose", () => {
    const props = renderPanel({ context: EMPTY_CONTEXT });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("renders the wiki section with mandatory attribution when present (012)", () => {
    renderPanel({
      wiki: {
        extract: "Fremont is a neighborhood in Seattle.",
        thumbnailUrl: "https://example.org/t.jpg",
        pageUrl: "https://en.wikipedia.org/wiki/Fremont,_Seattle",
      },
    });
    expect(screen.getByText(/neighborhood in Seattle/)).toBeInTheDocument();
    const attrib = screen.getByRole("link", { name: /From Wikipedia \(CC BY-SA\)/ });
    expect(attrib).toHaveAttribute("href", "https://en.wikipedia.org/wiki/Fremont,_Seattle");
  });

  it("omits the wiki section entirely when null", () => {
    renderPanel({ wiki: null });
    expect(screen.queryByText(/From Wikipedia/)).toBeNull();
  });
});

describe("ZipDetailPanel compare (009 R7)", () => {
  it("pin button fires onPin", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Pin to compare" }));
    expect(props.onPin).toHaveBeenCalled();
  });

  it("shows the pinned hint when the selected ZIP is pinned", () => {
    const props = renderPanel({ pinnedZip: "98103", pinnedRecord: FULL });
    const btn = screen.getByRole("button", { name: /Pinned — click another ZIP/ });
    fireEvent.click(btn);
    expect(props.onUnpin).toHaveBeenCalled();
  });

  it("renders side-by-side with signed deltas when a different ZIP is pinned", () => {
    renderPanel({
      zip: "99201",
      record: OTHER,
      pinnedZip: "98103",
      pinnedRecord: FULL,
    });
    expect(screen.getByText("Compare")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("📌 Fremont 98103")).toBeInTheDocument(); // place label (012)
    expect(screen.getByText("$937,500")).toBeInTheDocument(); // pinned value
    expect(screen.getByText("$450,000")).toBeInTheDocument(); // selected value
    // 450000 vs 937500 -> -52.0% (selected relative to pinned)
    expect(screen.getByText("-52.0%")).toBeInTheDocument();
    // YoY: 3.5 vs -2.5 -> +6.0 percentage points
    expect(screen.getByText("+6.0% pt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpin 98103" })).toBeInTheDocument();
  });
});
