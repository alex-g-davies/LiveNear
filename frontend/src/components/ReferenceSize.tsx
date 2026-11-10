import { useState } from "react";

import {
  DEFAULT_REFERENCE_M2,
  MAX_REFERENCE_M2,
  MIN_REFERENCE_M2,
  validReferenceM2,
} from "../lib/referenceSize";

interface Props {
  value: number;
  onChange: (m2: number) => void;
}

/** The home size Norwegian price estimates use (026 R9). The draft lets someone
 * type "120" without "1" being rejected on the way. */
export default function ReferenceSize({ value, onChange }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="reference-size">
      <label className="budget-input__assumption">
        <span>Home size</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_REFERENCE_M2}
          max={MAX_REFERENCE_M2}
          step={5}
          aria-label="Home size for price estimates, in square metres"
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number(e.target.value);
            if (validReferenceM2(next)) onChange(next);
          }}
          onBlur={() => setDraft(null)}
        />
        <span aria-hidden="true">m²</span>
      </label>
      <span className="budget-input__assumes">
        Prices are estimates: average kr/m² × this size.
        {value === DEFAULT_REFERENCE_M2 && ` ${DEFAULT_REFERENCE_M2} m² is an assumed default.`}
      </span>
    </div>
  );
}
