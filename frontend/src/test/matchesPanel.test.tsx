import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MatchesPanel from "../components/MatchesPanel";
import type { MatchResult } from "../lib/matches";

const RESULT: MatchResult = {
  matches: [
    { zip: "98001", name: "Auburn", median_value: 450_000, price_to_income: 4.2 },
    { zip: "98002", name: null, median_value: 520_000, price_to_income: null },
  ],
  total: 11,
};

describe("MatchesPanel (019 R2/R3)", () => {
  it("renders nothing without a result (no reach overlay yet)", () => {
    const { container } = render(
      <MatchesPanel result={null} budget={0} onZipChosen={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists ranked matches with value and ratio, and the true total", () => {
    render(<MatchesPanel result={RESULT} budget={600_000} onZipChosen={() => {}} />);
    expect(screen.getByText(/Your matches/)).toBeInTheDocument();
    expect(screen.getByText("(11)")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Auburn");
    expect(rows[0]).toHaveTextContent("$450k");
    expect(rows[0]).toHaveTextContent("4.2×");
    // Name-less ZIPs fall back to the code; no ratio -> no × badge.
    expect(rows[1]).toHaveTextContent("98002");
    expect(rows[1]).not.toHaveTextContent("×");
  });

  it("fires onZipChosen with the row's zip", () => {
    const onZipChosen = vi.fn();
    render(<MatchesPanel result={RESULT} budget={0} onZipChosen={onZipChosen} />);
    fireEvent.click(screen.getByRole("button", { name: /Auburn/ }));
    expect(onZipChosen).toHaveBeenCalledWith("98001");
  });

  it("shows the budget-aware empty nudge", () => {
    render(
      <MatchesPanel result={{ matches: [], total: 0 }} budget={500_000} onZipChosen={() => {}} />,
    );
    expect(screen.getByText(/within both budget and reach/)).toBeInTheDocument();
  });

  it("shows the reach-only empty nudge without a budget", () => {
    render(<MatchesPanel result={{ matches: [], total: 0 }} budget={0} onZipChosen={() => {}} />);
    expect(screen.getByText(/within commute reach — try a longer time/)).toBeInTheDocument();
  });

  it("is a collapsible fold that starts expanded", () => {
    const { container } = render(
      <MatchesPanel result={RESULT} budget={0} onZipChosen={() => {}} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.open).toBe(true);
  });
});
