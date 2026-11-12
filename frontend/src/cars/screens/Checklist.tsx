// Newcomer checklist (spec 023 R4–R7): the eleven things a local never has
// to think about, grouped by when, with ticks held in the browser state,
// due dates derived from the profile (every one an estimate with a basis),
// an impact panel from the scenario's sensitivity rows, and a Markdown
// download built in the browser.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { getSources } from "../api";
import {
  CHECKLIST_FILENAME,
  CHECKLIST_GROUPS,
  CHECKLIST_ITEMS,
  appliesNote,
  checklistMarkdown,
  downloadText,
  dueFor,
  impactRows,
  nextDue,
  todayIso,
  type DueInfo,
  type PendingRule,
} from "../lib/checklist";
import { formatDate } from "../lib/format";
import { useCarState } from "../state";
import "../checklist.css";
import { useT } from "../../i18n/react";
import { drivePath } from "../../lib/productRoutes";

export default function Checklist() {
  const { t, lang } = useT();
  const { state, toggleChecklist, scenario } = useCarState();
  const { profile, checklist } = state;
  const today = todayIso();

  // Pending EV tax rule: fetched once; the due date only appears while the
  // backend lists a pending ev_vat entry.
  const [pending, setPending] = useState<PendingRule | null | "unknown" | undefined>(undefined);
  useEffect(() => {
    const ctrl = new AbortController();
    getSources(ctrl.signal)
      .then((s) => {
        const rule = (s.pending_rules ?? []).find((r) => r.kind === "ev_vat") ?? null;
        setPending(rule ? { id: rule.id, kind: rule.kind, effective_from: rule.effective_from } : null);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPending("unknown");
      });
    return () => ctrl.abort();
  }, []);

  const dues = useMemo(() => {
    const m = new Map<string, DueInfo | null>();
    for (const item of CHECKLIST_ITEMS) {
      m.set(
        item.id,
        dueFor(item, {
          arrivalDate: profile.arrival_date,
          startDate: profile.start_date,
          today,
          pendingEvRule: pending,
        }),
      );
    }
    return m;
    // `lang`: the bases and notes are text in the site language.
  }, [profile.arrival_date, profile.start_date, today, pending, lang]);

  const ticked = checklist.filter((id) => CHECKLIST_ITEMS.some((i) => i.id === id));
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((ticked.length / total) * 100);
  const next = nextDue(dues, ticked, today);
  const impact = impactRows(scenario.data);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [runBefore, runAfter = ""] = t("carsPlan.checklist.runHint").split("{link}");

  const onDownload = () => {
    const text = checklistMarkdown({
      ticked,
      dues,
      modes: profile.limits.modes,
      generatedOn: today,
    });
    const ok = downloadText(text, CHECKLIST_FILENAME);
    setDownloaded(ok);
  };

  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">{t("carsPlan.checklist.title")}</h1>
          <p className="cars-lede">{t("carsPlan.checklist.lede")}</p>
        </div>
        <div className="cars-titlebar__tools">
          {downloaded !== null && (
            <span className="cars-hint" role="status">
              {downloaded
                ? t("carsPlan.checklist.saved", { file: CHECKLIST_FILENAME })
                : t("carsPlan.checklist.downloadUnavailable")}
            </span>
          )}
          <button type="button" className="cars-btn" onClick={onDownload}>
            {t("carsPlan.checklist.download")}
          </button>
        </div>
      </div>

      <div className="cars-layout">
        <div className="cars-layout__main cars-checklist">
          {CHECKLIST_GROUPS.map((g) => (
            <section
              key={g.id}
              className="cars-card cars-card--flush cars-checklist__group"
              aria-labelledby={`group-${g.id}`}
            >
              <div className="cars-card__bar">
                <h2 id={`group-${g.id}`} className="cars-h2">
                  {g.title}
                </h2>
              </div>
              {CHECKLIST_ITEMS.filter((i) => i.group === g.id).map((item) => {
                const done = ticked.includes(item.id);
                const due = dues.get(item.id) ?? null;
                const only = appliesNote(item, profile.limits.modes);
                return (
                  <label
                    key={item.id}
                    className={`cars-checklist__row${done ? " cars-checklist__row--done" : ""}`}
                    data-testid={`check-${item.id}`}
                  >
                    <input
                      type="checkbox"
                      className="cars-checklist__box"
                      aria-label={item.title}
                      checked={done}
                      onChange={() => toggleChecklist(item.id)}
                    />
                    <span className="cars-checklist__body">
                      <span className="cars-checklist__title">{item.title}</span>
                      <span className="cars-checklist__why">{item.why}</span>
                      {due?.kind === "date" && (
                        <span className="cars-checklist__basis">
                          {t("carsPlan.checklist.estimate")} {due.basis}
                          {due.url && (
                            <a href={due.url} target="_blank" rel="noreferrer">
                              {t("carsPlan.checklist.official")}
                            </a>
                          )}
                        </span>
                      )}
                      {due?.kind === "missing" && (
                        <span className="cars-checklist__basis">
                          <Link to={due.to}>{due.text}</Link>
                        </span>
                      )}
                      {due?.kind === "unknown" && (
                        <span className="cars-checklist__basis">{t("carsPlan.checklist.dueDate", { text: due.text })}</span>
                      )}
                    </span>
                    <span className="cars-checklist__side">
                      <span className="cars-checklist__tag">{item.tag}</span>
                      {due?.kind === "date" && (
                        <span className="cars-checklist__due" title={due.basis}>
                          {t("carsPlan.checklist.dueEstimate", { date: formatDate(due.iso) })}
                        </span>
                      )}
                      {only && <span className="cars-checklist__only">{only}</span>}
                    </span>
                  </label>
                );
              })}
            </section>
          ))}
        </div>

        <aside className="cars-layout__aside">
          <section className="cars-card" aria-labelledby="progress">
            <h2 id="progress" className="cars-h3">
              {t("carsPlan.checklist.progress")}
            </h2>
            <span className="cars-checklist__progress-n" data-testid="progress">
              {t("carsPlan.checklist.done", { done: ticked.length, total })}
            </span>
            <div className="cars-checklist__bar" aria-hidden="true">
              <div className="cars-checklist__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="cars-checklist__next">
              <span className="cars-hint">{t("carsPlan.checklist.next")}</span>
              <span className="cars-strong" data-testid="next-due">
                {next ? `${next.item.title} · ${formatDate(next.iso)}` : t("carsPlan.checklist.noNext")}
              </span>
            </div>
          </section>

          <section className="cars-card" aria-labelledby="impact">
            <h2 id="impact" className="cars-h3">
              {t("carsPlan.checklist.impact")}
            </h2>
            {scenario.data === null ? (
              <p className="cars-hint">
                {runBefore}
                <Link to={drivePath("/compare")}>{t("carsPlan.checklist.runLink")}</Link>
                {runAfter}
              </p>
            ) : impact.length === 0 ? (
              <p className="cars-hint">{t("carsPlan.checklist.noRows")}</p>
            ) : (
              <div className="cars-checklist__impact">
                {impact.map((r) => (
                  <div
                    key={r.id}
                    className="cars-checklist__impact-row"
                    // A backend note is English prose (028 R7): say so in the tooltip.
                    title={r.noteIsBackend && lang !== "en" ? `${r.note} ${t("common.englishTag")}` : r.note}
                  >
                    <Link to={drivePath("/compare")}>{r.label}</Link>
                    <span data-testid={`impact-${r.id}`}>{r.text}</span>
                  </div>
                ))}
                <Link to={drivePath("/compare")} className="cars-link">
                  {t("carsPlan.checklist.seeRanking")}
                </Link>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
