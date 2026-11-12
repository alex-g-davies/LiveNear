// Cost-measure selector shared by Compare (table, curves) and Detail.

import { useT } from "../../i18n/react";
import { MEASURE_DEFS } from "../lib/measures";
import type { Measure } from "../lib/profile";

interface Props {
  value: Measure;
  onChange: (m: Measure) => void;
  id?: string;
}

export default function MeasureSelect({ value, onChange, id = "cars-measure" }: Props) {
  const { t } = useT();
  return (
    <label className="cars-measure">
      <span className="sr-only">{t("carsCompare.measure.select")}</span>
      <select
        id={id}
        className="cars-select cars-measure__select"
        value={value}
        onChange={(e) => onChange(e.target.value as Measure)}
      >
        {MEASURE_DEFS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
