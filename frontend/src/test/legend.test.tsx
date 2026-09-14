import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Legend from "../components/Legend";
import { METRICS } from "../config";

const VALUE = METRICS.find((m) => m.key === "value")!;
const YOY = METRICS.find((m) => m.key === "yoy")!;
// Resolved stops the parent would pass (per-region quantiles for value).
const VALUE_STOPS = VALUE.colors.map((color, i) => ({ value: i * 100_000, color }));

describe("Legend (R2/002)", () => {
  it("renders a swatch per resolved stop plus a no-data entry", () => {
    const { container } = render(<Legend metric={VALUE} stops={VALUE_STOPS} budget={0} />);
    const swatches = container.querySelectorAll(".legend-swatch");
    expect(swatches.length).toBe(VALUE_STOPS.length + 1);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("Median value")).toBeInTheDocument();
  });

  it("shows the over-budget entry whenever a budget is set, on any metric (R4)", () => {
    const { rerender } = render(<Legend metric={VALUE} stops={VALUE_STOPS} budget={0} />);
    expect(screen.queryByText("Over budget")).not.toBeInTheDocument();
    rerender(<Legend metric={VALUE} stops={VALUE_STOPS} budget={800000} />);
    expect(screen.getByText("Over budget")).toBeInTheDocument();
    rerender(<Legend metric={YOY} stops={YOY.fixedStops!} budget={800000} />);
    expect(screen.getByText("Over budget")).toBeInTheDocument();
  });

  it("states the data vintage when known, and stays silent otherwise (review)", () => {
    const { rerender } = render(
      <Legend metric={VALUE} stops={VALUE_STOPS} budget={0} asOf="2026-04-30" />,
    );
    expect(screen.getByText(/Values as of Apr 2026/)).toBeInTheDocument();
    rerender(<Legend metric={VALUE} stops={VALUE_STOPS} budget={0} asOf={null} />);
    expect(screen.queryByText(/Values as of/)).not.toBeInTheDocument();
    rerender(<Legend metric={VALUE} stops={VALUE_STOPS} budget={0} asOf="garbage" />);
    expect(screen.queryByText(/Values as of/)).not.toBeInTheDocument();
  });

  it("formats boundaries with the metric's formatter (percent for YoY)", () => {
    const { container } = render(<Legend metric={YOY} stops={YOY.fixedStops!} budget={0} />);
    expect(screen.getByText("YoY change")).toBeInTheDocument();
    expect(within(container).getAllByText(/%/).length).toBeGreaterThan(0);
  });
});
