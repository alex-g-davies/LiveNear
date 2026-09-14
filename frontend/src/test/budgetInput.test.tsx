import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BudgetInput from "../components/BudgetInput";
import { type BudgetSpec, DEFAULT_BUDGET_SPEC } from "../lib/affordability";

const PRICE: BudgetSpec = { ...DEFAULT_BUDGET_SPEC };
const PAYMENT: BudgetSpec = { ...DEFAULT_BUDGET_SPEC, mode: "payment", payment: 3000 };

describe("BudgetInput (R4)", () => {
  it("emits the parsed price on change", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={PRICE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "800000" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...PRICE, price: 800000 });
  });

  it("strips non-numeric characters", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={PRICE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "$1,250,000" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...PRICE, price: 1250000 });
  });

  it("clears to 0 when emptied", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={{ ...PRICE, price: 800000 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...PRICE, price: 0 });
  });

  it("displays thousands separators (015 R2)", () => {
    render(<BudgetInput spec={{ ...PRICE, price: 800000 }} onChange={() => {}} />);
    expect(screen.getByLabelText("Budget in dollars")).toHaveValue("800,000");
  });

  it("parses pasted formatted values", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={PRICE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Budget in dollars"), {
      target: { value: "1,200,000" },
    });
    expect(onChange).toHaveBeenCalledWith({ ...PRICE, price: 1200000 });
  });
});

describe("BudgetInput payment mode (020 R2)", () => {
  it("toggles between price and payment modes, keeping the typed price", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={{ ...PRICE, price: 800000 }} onChange={onChange} />);
    const modes = screen.getByRole("group", { name: "Budget as" });
    expect(modes).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home price" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(onChange).toHaveBeenCalledWith({ ...PRICE, price: 800000, mode: "payment" });
  });

  it("shows payment + assumption fields and the derived max price", () => {
    render(<BudgetInput spec={PAYMENT} onChange={() => {}} />);
    expect(screen.queryByLabelText("Budget in dollars")).toBeNull();
    expect(screen.getByLabelText("Monthly payment in dollars")).toHaveValue("3,000");
    expect(screen.getByLabelText("Down payment percent")).toHaveValue(20);
    expect(screen.getByLabelText("Interest rate percent")).toHaveValue(6.5);
    // Hand-checked in the spec: $3,000/mo, 20% down, 6.5% -> $476,000.
    expect(screen.getByText("$476,000")).toBeInTheDocument();
    expect(screen.getByText(/assumes 30-yr, 1.5%\/yr tax \+ insurance/)).toBeInTheDocument();
  });

  it("emits payment, down-payment and rate edits", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={PAYMENT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Monthly payment in dollars"), {
      target: { value: "3,500" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...PAYMENT, payment: 3500 });
    fireEvent.change(screen.getByLabelText("Down payment percent"), { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PAYMENT, downPct: 10 });
    fireEvent.change(screen.getByLabelText("Interest rate percent"), { target: { value: "7" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PAYMENT, ratePct: 7 });
  });

  it("clamps assumptions to their valid ranges", () => {
    const onChange = vi.fn();
    render(<BudgetInput spec={PAYMENT} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Down payment percent"), { target: { value: "150" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PAYMENT, downPct: 99 });
    fireEvent.change(screen.getByLabelText("Interest rate percent"), { target: { value: "-3" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...PAYMENT, ratePct: 0 });
  });

  it("prompts for a payment instead of showing a $0 price", () => {
    render(<BudgetInput spec={{ ...PAYMENT, payment: 0 }} onChange={() => {}} />);
    expect(screen.getByText(/Enter a monthly payment/)).toBeInTheDocument();
    expect(screen.queryByText(/max price/)).toBeNull();
  });
});
