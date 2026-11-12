import { METRICS, type MetricDef, type MetricKey } from "../config";
import { useT } from "../i18n/react";

interface Props {
  active: MetricKey;
  onChange: (key: MetricKey) => void;
  /** What this region can show (026 R10). */
  metrics?: MetricDef[];
}

/** Segmented control to choose which metric the choropleth shades by. */
export default function MetricSwitcher({ active, onChange, metrics = METRICS }: Props) {
  const { t } = useT();
  return (
    <div className="switcher switcher--grid" role="group" aria-label={t("map.metric.shadeBy")}>
      {metrics.map((m) => (
        <button
          key={m.key}
          type="button"
          className={m.key === active ? "switcher__btn switcher__btn--active" : "switcher__btn"}
          aria-pressed={m.key === active}
          aria-label={m.label}
          title={m.label}
          onClick={() => onChange(m.key)}
        >
          {m.short}
        </button>
      ))}
    </div>
  );
}
