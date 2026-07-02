import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AboutPanel from "../components/AboutPanel";

describe("AboutPanel (012 R5)", () => {
  it("opens from the trigger and lists all seven sources", () => {
    render(<AboutPanel />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    const dialog = screen.getByRole("dialog");
    for (const source of [
      "Zillow ZHVI",
      "U.S. Census Bureau",
      "Redfin Data Center",
      "GeoNames (CC BY 4.0)",
      "Wikipedia (CC BY-SA 4.0)",
      /OpenStreetMap contributors/,
      "Mapbox",
    ]) {
      expect(screen.getByRole("link", { name: source })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent(/not financial or real-estate advice/);
  });

  it("closes via the close button, Esc, and the backdrop", () => {
    render(<AboutPanel />);
    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    fireEvent.click(screen.getByRole("dialog")); // backdrop, not the card
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'How it works' closes the popover and reopens the intro (017 R1)", () => {
    const onShowIntro = vi.fn();
    render(<AboutPanel onShowIntro={onShowIntro} />);
    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    fireEvent.click(screen.getByRole("button", { name: "How it works" }));
    expect(onShowIntro).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hides the intro link when no handler is wired", () => {
    render(<AboutPanel />);
    fireEvent.click(screen.getByRole("button", { name: /About & data/ }));
    expect(screen.queryByRole("button", { name: "How it works" })).toBeNull();
  });
});
