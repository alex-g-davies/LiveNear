import type { ChangeEvent } from "react";

import { formatBudgetInput } from "../lib/format";

interface Props {
  budget: number;
  onChange: (budget: number) => void;
  /** Overrides the "Budget" label (the welcome modal asks a fuller question). */
  label?: string;
  /** Muted nudge under the field, shown only while no budget is set. */
  hint?: string;
}

/**
 * Numeric budget input (R4). Displays thousands separators (015 R2) while
 * emitting a parsed number; non-numeric input clears the budget to 0.
 */
export default function BudgetInput({ budget, onChange, label, hint }: Props) {
  function handle(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    onChange(raw === "" ? 0 : Number(raw));
  }

  return (
    <label className="budget-input">
      <span className="budget-input__label">{label ?? "Budget"}</span>
      <span className="budget-input__field">
        <span aria-hidden="true">$</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Budget in dollars"
          placeholder="e.g. 800,000"
          value={formatBudgetInput(budget)}
          onChange={handle}
        />
      </span>
      {hint && budget === 0 && <span className="budget-input__hint">{hint}</span>}
    </label>
  );
}
