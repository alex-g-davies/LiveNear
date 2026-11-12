import { useState } from "react";

import {
  DEFAULT_REFERENCE_M2,
  MAX_REFERENCE_M2,
  MIN_REFERENCE_M2,
  validReferenceM2,
} from "../lib/referenceSize";
import { useT } from "../i18n/react";

interface Props {
  value: number;
  onChange: (m2: number) => void;
}

/** The home size Norwegian price estimates use (026 R9). The draft lets someone
 * type "120" without "1" being rejected on the way. */
export default function ReferenceSize({ value, onChange }: Props) {
  const { t } = useT();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="reference-size">
      <label className="budget-input__assumption">
        <span>{t("map.size.label")}</span>
        <input
          type="number"
          inputMode="numeric"
          min={MIN_REFERENCE_M2}
          max={MAX_REFERENCE_M2}
          step={5}
          aria-label={t("map.size.input")}
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
        {t("map.size.note")}
        {value === DEFAULT_REFERENCE_M2 && ` ${t("map.size.default", { m2: DEFAULT_REFERENCE_M2 })}`}
      </span>
    </div>
  );
}
