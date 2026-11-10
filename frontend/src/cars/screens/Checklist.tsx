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
import { drivePath } from "../../lib/productRoutes";

export default function Checklist() {
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
  }, [profile.arrival_date, profile.start_date, today, pending]);

  const ticked = checklist.filter((id) => CHECKLIST_ITEMS.some((i) => i.id === id));
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((ticked.length / total) * 100);
  const next = nextDue(dues, ticked, today);
  const impact = impactRows(scenario.data);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  const onDownload = () => {
    const text = checklistMarkdown({
      ticked,
      dues,
      modes: profile.limits.modes,
      generatedOn: today,
    });
    const ok = downloadText(text, CHECKLIST_FILENAME);
    setDownloadMsg(ok ? `Saved ${CHECKLIST_FILENAME}` : "Download is not available in this browser.");
  };

  return (
    <>
      <div className="cars-titlebar">
        <div className="cars-titlebar__text">
          <h1 className="cars-h1">Newcomer checklist</h1>
          <p className="cars-lede">
            Things locals don't have to think about. Each one shows which part of your cost it
            affects.
          </p>
        </div>
        <div className="cars-titlebar__tools">
          {downloadMsg && (
            <span className="cars-hint" role="status">
              {downloadMsg}
            </span>
          )}
          <button type="button" className="cars-btn" onClick={onDownload}>
            Download checklist
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
              <div className="cars-card__head">
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
                          Estimate: {due.basis}
                          {due.url && (
                            <a href={due.url} target="_blank" rel="noreferrer">
                              Official page
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
                        <span className="cars-checklist__basis">Due date: {due.text}</span>
                      )}
                    </span>
                    <span className="cars-checklist__side">
                      <span className="cars-checklist__tag">{item.tag}</span>
                      {due?.kind === "date" && (
                        <span className="cars-checklist__due" title={due.basis}>
                          Due {formatDate(due.iso)} · estimate
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
              Progress
            </h2>
            <span className="cars-checklist__progress-n" data-testid="progress">
              {ticked.length} of {total} done
            </span>
            <div className="cars-checklist__bar" aria-hidden="true">
              <div className="cars-checklist__bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="cars-checklist__next">
              <span className="cars-hint">Next deadline</span>
              <span className="cars-strong" data-testid="next-due">
                {next ? `${next.item.title} · ${formatDate(next.iso)}` : "No dated items left"}
              </span>
            </div>
          </section>

          <section className="cars-card" aria-labelledby="impact">
            <h2 id="impact" className="cars-h3">
              Biggest effect on your cost
            </h2>
            {scenario.data === null ? (
              <p className="cars-hint">
                <Link to={drivePath("/compare")}>Run a comparison</Link> to see what moves your cost.
              </p>
            ) : impact.length === 0 ? (
              <p className="cars-hint">No sensitivity rows for the current ranking.</p>
            ) : (
              <div className="cars-checklist__impact">
                {impact.map((r) => (
                  <div key={r.id} className="cars-checklist__impact-row" title={r.note}>
                    <Link to={drivePath("/compare")}>{r.label}</Link>
                    <span data-testid={`impact-${r.id}`}>{r.text}</span>
                  </div>
                ))}
                <Link to={drivePath("/compare")} className="cars-link">
                  See how each changes your ranking
                </Link>
              </div>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
