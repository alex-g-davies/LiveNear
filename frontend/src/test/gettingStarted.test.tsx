import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import GettingStarted from "../components/GettingStarted";

describe("GettingStarted (new-user onboarding)", () => {
  afterEach(() => vi.useRealTimers());

  it("lists the three setup steps, unticked by default", () => {
    render(
      <GettingStarted budgetSet={false} workSet={false} explored={false} onDone={() => {}} />,
    );
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Set your budget")).toBeInTheDocument();
    expect(screen.getByText("Put the pin on your workplace")).toBeInTheDocument();
    expect(screen.getByText("Click an area that looks good")).toBeInTheDocument();
    expect(screen.queryAllByText("✓")).toHaveLength(0);
  });

  it("ticks steps from app state, not clicks", () => {
    render(
      <GettingStarted budgetSet={true} workSet={true} explored={false} onDone={() => {}} />,
    );
    expect(screen.getAllByText("✓")).toHaveLength(2);
    expect(screen.getAllByText("○")).toHaveLength(1);
  });

  it("dismisses via the close button", () => {
    const onDone = vi.fn();
    render(
      <GettingStarted budgetSet={false} workSet={false} explored={false} onDone={onDone} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss checklist" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("celebrates and auto-finishes shortly after the last step completes", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(<GettingStarted budgetSet={true} workSet={true} explored={true} onDone={onDone} />);
    expect(screen.getByText(/You’re set/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(onDone).toHaveBeenCalledOnce();
  });
});
