import { describe, expect, it } from "vitest";

import { buildSparklineSvg } from "../lib/sparkline";

describe("buildSparklineSvg", () => {
  it("returns empty string for missing or too-short history", () => {
    expect(buildSparklineSvg(null)).toBe("");
    expect(buildSparklineSvg([])).toBe("");
    expect(buildSparklineSvg([["2024-Q1", 100]])).toBe("");
  });

  it("draws a polyline with one point per history entry", () => {
    const svg = buildSparklineSvg([
      ["2024-Q1", 100],
      ["2024-Q2", 150],
      ["2024-Q3", 120],
    ]);
    expect(svg).toContain("<polyline");
    const points = svg.match(/points="([^"]+)"/)?.[1].trim().split(" ") ?? [];
    expect(points).toHaveLength(3);
  });

  it("colors the line green when the series ends up, red when down", () => {
    const up = buildSparklineSvg([
      ["a", 100],
      ["b", 200],
    ]);
    const down = buildSparklineSvg([
      ["a", 200],
      ["b", 100],
    ]);
    // Colours come from the --positive / --negative tokens via classes (027 R10).
    expect(up).toContain("spark__line--up");
    expect(down).toContain("spark__line--down");
  });
});
