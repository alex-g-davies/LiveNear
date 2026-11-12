import type { CommuteVariation } from "../api/client";
import { COMMUTE_STEPS, SCENARIO_STYLES, TRAVEL_MODES, type TravelMode } from "../config";
import { useT } from "../i18n/react";
import { type Locale, US_LOCALE } from "../lib/locale";
import { rich } from "../lib/rich";

interface Props {
  minutes: number;
  onMinutesChange: (minutes: number) => void;
  variation: CommuteVariation | null;
  /** Dual-workplace mode (016 R5): areas are the shared-reach intersection. */
  dual: boolean;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  locale?: Locale;
}

/** Commute controls: travel mode (013 R2), time (15/30/45/60), and — for
 * driving — the time-of-day reach-variation breakdown. */
export default function CommuteControl({
  minutes,
  onMinutesChange,
  variation,
  dual,
  mode,
  onModeChange,
  locale = US_LOCALE,
}: Props) {
  const { t } = useT();
  return (
    <div className="commute">
      <span className="section-label">{t("map.commute.label")}</span>
      <div className="switcher" role="group" aria-label={t("map.commute.modeGroup")}>
        {TRAVEL_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={m.key === mode ? "switcher__btn switcher__btn--active" : "switcher__btn"}
            aria-pressed={m.key === mode}
            aria-label={m.label}
            title={m.label}
            onClick={() => onModeChange(m.key)}
          >
            {m.icon}
          </button>
        ))}
      </div>
      <span className="section-label">{t("map.commute.time")}</span>
      <div className="switcher" role="group" aria-label={t("map.commute.timeGroup")}>
        {COMMUTE_STEPS.map((m) => (
          <button
            key={m}
            type="button"
            className={m === minutes ? "switcher__btn switcher__btn--active" : "switcher__btn"}
            aria-pressed={m === minutes}
            aria-label={t("map.commute.minutes", { count: m, value: m })}
            onClick={() => onMinutesChange(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Traffic scenarios only exist for driving (013 R2): walk/cycle reach
          is time-invariant and renders as a single contour. */}
      {mode !== "drive" ? null : (
      <details className="panel-fold" open>
        <summary>{dual ? t("map.commute.shared") : t("map.commute.scenarios")}</summary>
        <ul className="scenarios">
          {SCENARIO_STYLES.map((s) => (
            <li key={s.key} className="scenarios__row">
              <span className="scenarios__line" style={{ background: s.line }} />
              {s.label}
              {variation && (
                <span className="scenarios__area">
                  {locale.reachArea(variation[`${s.key}_sqmi` as const])}
                </span>
              )}
            </li>
          ))}
        </ul>
        {variation?.peak_shrink_pct != null ? (
          <p className="commute__summary">
            {rich(t("map.commute.shrink", { minutes }), {
              pct: <strong>{locale.decimal(String(variation.peak_shrink_pct))}%</strong>,
            })}
          </p>
        ) : (
          <p className="commute__summary commute__summary--muted">
            {t("map.commute.noVariation")}
          </p>
        )}
        <p className="commute__note">
          {t("map.commute.note")}
          {locale.country === "NO" && ` ${t("map.commute.ferries")}`}
        </p>
      </details>
      )}
    </div>
  );
}
