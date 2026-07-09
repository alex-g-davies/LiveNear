import { useEffect } from "react";

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
  const steps = [
    { key: "budget", label: "Set your budget", done: budgetSet },
    { key: "work", label: "Put the pin on your workplace", done: workSet },
    { key: "explore", label: "Click an area that looks good", done: explored },
  ];
  const allDone = steps.every((s) => s.done);

  // Linger just long enough for the last tick to register, then leave.
  useEffect(() => {
    if (!allDone) return;
    const t = window.setTimeout(onDone, 1600);
    return () => window.clearTimeout(t);
  }, [allDone, onDone]);

  return (
    <aside className="checklist" aria-label="Getting started checklist">
      <div className="checklist__head">
        <span className="checklist__title">{allDone ? "You’re set 🎉" : "Getting started"}</span>
        <button
          type="button"
          className="checklist__dismiss"
          aria-label="Dismiss checklist"
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
            {s.done && <span className="sr-only"> (done)</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
