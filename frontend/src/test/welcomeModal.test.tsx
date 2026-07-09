import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WelcomeModal from "../components/WelcomeModal";

describe("WelcomeModal (017 R1)", () => {
  it("explains the product and the three core actions", () => {
    render(<WelcomeModal onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/see where you could live/i);
    expect(dialog).toHaveTextContent(/budget/i);
    expect(dialog).toHaveTextContent(/pin/i);
    expect(dialog).toHaveTextContent(/click or tap any area/i);
  });

  it("closes via the CTA, the close button, Esc, and the backdrop", () => {
    const onClose = vi.fn();
    render(<WelcomeModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Explore the map" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog")); // backdrop, not the card
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("does not close when the card itself is clicked", () => {
    const onClose = vi.fn();
    render(<WelcomeModal onClose={onClose} />);
    fireEvent.click(screen.getByText(/see where you could live/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("captures an optional budget when wired (new-user onboarding)", () => {
    const onBudgetChange = vi.fn();
    render(<WelcomeModal onClose={() => {}} budget={0} onBudgetChange={onBudgetChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "650,000" },
    });
    expect(onBudgetChange).toHaveBeenCalledWith(650000);
  });

  it("hides the budget field when no handler is wired", () => {
    render(<WelcomeModal onClose={() => {}} />);
    expect(screen.queryByLabelText("Budget in dollars")).toBeNull();
  });

  it("tells the user the intro can be reopened", () => {
    render(<WelcomeModal onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveTextContent(/reopen this intro anytime/i);
  });
});
