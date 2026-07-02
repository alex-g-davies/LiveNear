import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RegionInfo } from "../api/client";
import RegionPicker from "../components/RegionPicker";

const regions: RegionInfo[] = [
  { code: "CA", name: "California", bbox: null, center: null, zip_count: 1536 },
  { code: "WA", name: "Washington", bbox: null, center: null, zip_count: 484 },
];

describe("RegionPicker (national)", () => {
  it("lists regions with counts and reflects the active state", () => {
    render(<RegionPicker regions={regions} state="WA" onStateChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Washington · 484 ZIPs" })).toBeInTheDocument();
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("WA");
  });

  it("emits the chosen state code", () => {
    const onChange = vi.fn();
    render(<RegionPicker regions={regions} state="WA" onStateChange={onChange} />);
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "CA" } });
    expect(onChange).toHaveBeenCalledWith("CA");
  });
});
