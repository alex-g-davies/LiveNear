import { useEffect } from "react";

import { useT } from "../i18n/react";

interface Props {
  budgetSet: boolean;
  workSet: boolean;
  explored: boolean;
  /** Fired on dismiss or shortly after all steps complete; the caller
   * persists the flag so the checklist never returns. */
  onDone: () => void;
}

/** First-visit "Getting started" checklist (new-user onboarding): the three
 * moves from the welcome modal as live progress, each ticked from real app
 * state rather than clicks — so a user who already did the thing gets credit.
 * Renders at the top of the controls panel; first session only. */
export default function GettingStarted({ budgetSet, workSet, explored, onDone }: Props) {
  const { t } = useT();
  const steps = [
    { key: "budget", label: t("map.checklist.budget"), done: budgetSet },
    { key: "work", label: t("map.checklist.work"), done: workSet },
    { key: "explore", label: t("map.checklist.explore"), done: explored },
  ];
  const allDone = steps.every((s) => s.done);

  // Linger just long enough for the last tick to register, then leave.
  useEffect(() => {
    if (!allDone) return;
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [allDone, onDone]);

  return (
    <aside className="checklist" aria-label={t("map.checklist.label")}>
      <div className="checklist__head">
        <span className="checklist__title">{allDone ? t("map.checklist.allDone") : t("map.checklist.title")}</span>
        <button
          type="button"
          className="checklist__dismiss"
          aria-label={t("map.checklist.dismiss")}
          onClick={onDone}
        >
          ×
        </button>
      </div>
      <ul className="checklist__list">
        {steps.map((s) => (
          <li
            key={s.key}
            className={s.done ? "checklist__item checklist__item--done" : "checklist__item"}
          >
            <span className="checklist__mark" aria-hidden="true">
              {s.done ? "✓" : "○"}
            </span>
            {s.label}
            {s.done && <span className="sr-only"> {t("map.checklist.done")}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
