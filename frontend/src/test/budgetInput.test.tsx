import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BudgetInput from "../components/BudgetInput";

describe("BudgetInput (R4)", () => {
  it("emits the parsed number on change", () => {
    const onChange = vi.fn();
    render(<BudgetInput budget={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "800000" },
    });
    expect(onChange).toHaveBeenCalledWith(800000);
  });

  it("strips non-numeric characters", () => {
    const onChange = vi.fn();
    render(<BudgetInput budget={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "$1,250,000" },
    });
    expect(onChange).toHaveBeenCalledWith(1250000);
  });

  it("clears to 0 when emptied", () => {
    const onChange = vi.fn();
    render(<BudgetInput budget={800000} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("displays thousands separators (015 R2)", () => {
    render(<BudgetInput budget={800000} onChange={() => {}} />);
    expect(screen.getByLabelText("Budget in dollars")).toHaveValue("800,000");
  });

  it("parses pasted formatted values", () => {
    const onChange = vi.fn();
    render(<BudgetInput budget={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "1,200,000" },
    });
    expect(onChange).toHaveBeenCalledWith(1200000);
  });

  it("shows the hint only while no budget is set (new-user onboarding)", () => {
    const { rerender } = render(
      <BudgetInput budget={0} onChange={() => {}} hint="Areas over budget fade" />,
    );
    expect(screen.getByText("Areas over budget fade")).toBeInTheDocument();
    rerender(<BudgetInput budget={800000} onChange={() => {}} hint="Areas over budget fade" />);
    expect(screen.queryByText("Areas over budget fade")).toBeNull();
  });

  it("renders a custom label when given", () => {
    render(<BudgetInput budget={0} onChange={() => {}} label="Your max home price (optional)" />);
    expect(screen.getByText("Your max home price (optional)")).toBeInTheDocument();
  });
});
