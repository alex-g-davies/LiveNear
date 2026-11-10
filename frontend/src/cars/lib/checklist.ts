// Newcomer checklist content and derivations (spec 023 R4–R7). Pure
// functions: the item table, due dates with their bases, the impact rows
// taken from the scenario's sensitivity, and the Markdown export. No I/O.

import type { ScenarioResponse, SensitivityRow } from "../api";
import { formatNok, formatNokSigned, formatPerKm } from "./format";
import type { Measure, Mode } from "./profile";
import { DRIVE_PATH } from "../../lib/productRoutes";

export type ChecklistGroupId = "before_choose" | "before_sign" | "after";

export interface ChecklistGroup {
  id: ChecklistGroupId;
  title: string;
}

export type DueKind = "licence" | "winter_tyres" | "ev_tax";

export interface ChecklistItem {
  id: string;
  group: ChecklistGroupId;
  title: string;
  why: string;
  tag: string;
  /** Ways to get the car this item applies to; undefined = always. */
  modes?: Mode[];
  due?: DueKind;
}

export const CHECKLIST_GROUPS: ChecklistGroup[] = [
  { id: "before_choose", title: "Before you choose" },
  { id: "before_sign", title: "Before you sign" },
  { id: "after", title: "After you get the car" },
];

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: "claims_free_letter",
    group: "before_choose",
    title: "Ask your previous insurer for a claims-free letter",
    why: "Some Norwegian insurers accept it, which can raise your starting bonus.",
    tag: "Insurance",
  },
  {
    id: "licence_exchange",
    group: "before_choose",
    title: "Find your driving licence exchange deadline",
    why: "Missing it can mean taking a Norwegian driving test.",
    tag: "Deadline",
    due: "licence",
  },
  {
    id: "id_and_bankid",
    group: "before_choose",
    title: "Get a Norwegian ID number and BankID",
    why: "Most lenders and lease companies need both before they will quote.",
    tag: "Financing",
  },
  {
    id: "ev_tax_changes",
    group: "before_choose",
    title: "Check upcoming tax changes for new EVs",
    why: "Registration timing can change the price of a new car.",
    tag: "Price",
    due: "ev_tax",
  },
  {
    id: "insurance_quotes",
    group: "before_sign",
    title: "Get real insurance quotes",
    why: "Replaces the estimate in your results with your actual number.",
    tag: "Insurance",
  },
  {
    id: "battery_health_report",
    group: "before_sign",
    title: "Used car: ask for a battery health report",
    why: "The biggest unknown in an older EV.",
    tag: "Resale",
    modes: ["used_1_3", "used_5_plus"],
  },
  {
    id: "prefer_dealer",
    group: "before_sign",
    title: "Used car: prefer a dealer over a private seller",
    why: "Dealer sales come with stronger complaint rights.",
    tag: "Risk",
    modes: ["used_1_3", "used_5_plus"],
  },
  {
    id: "lease_terms",
    group: "before_sign",
    title: "Lease: check the km cap, excess-km charge and early-exit fee",
    why: "The early-exit fee decides the cost if you leave before the term ends.",
    tag: "Cost to exit",
    modes: ["lease"],
  },
  {
    id: "winter_tyres",
    group: "after",
    title: "Fit winter tyres",
    why: "A second set is a real cost in Norway; check what your lease includes.",
    tag: "Tyres",
    due: "winter_tyres",
  },
  {
    id: "toll_tag",
    group: "after",
    title: "Get a toll tag",
    why: "Needed for EV toll rates on most roads.",
    tag: "Running cost",
  },
  {
    id: "charging_accounts",
    group: "after",
    title: "Set up charging accounts at work and on your routes",
    why: "Lets the app use your actual charging prices.",
    tag: "Energy",
  },
];

export const CHECKLIST_IDS: string[] = CHECKLIST_ITEMS.map((i) => i.id);

/** Note shown when an item only applies to a way the user has not kept. */
export function appliesNote(item: ChecklistItem, modes: Mode[]): string | null {
  if (!item.modes) return null;
  if (item.modes.some((m) => modes.includes(m))) return null;
  return item.modes.includes("lease") ? "only if you lease" : "only if you go used";
}

// ---------------------------------------------------------------------------
// Dates. ISO strings in, ISO strings out; arithmetic in UTC so a local
// timezone never shifts a day.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

function toIso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // Clamp the day to the target month's length (31 Jan + 1 month -> 28/29 Feb).
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return toIso(ny, nm, Math.min(d, last));
}

/** The next occurrence of `month`/`day` on or after `fromIso`. */
export function nextAnniversary(fromIso: string, month: number, day: number): string {
  const [y, m, d] = parts(fromIso);
  const sameYear = toIso(y, month, day);
  return m < month || (m === month && d <= day) ? sameYear : toIso(y + 1, month, day);
}

export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export interface PendingRule {
  id: string;
  kind?: string;
  effective_from?: string;
}

export interface DueInputs {
  arrivalDate: string | null;
  startDate: string | null;
  today: string;
  /** null = none pending; "unknown" = the check failed; undefined = not loaded yet. */
  pendingEvRule: PendingRule | null | "unknown" | undefined;
}

export type DueInfo =
  | { kind: "date"; iso: string; basis: string; url: string | null }
  | { kind: "missing"; text: string; to: string }
  | { kind: "unknown"; text: string };

export const LICENCE_BASIS =
  "Most non-EEA licences must be exchanged within one year of taking residence; " +
  "EEA licences need no exchange. Check Statens vegvesen for your country.";
export const LICENCE_URL = "https://www.vegvesen.no/en/driving-licences/";
export const WINTER_BASIS =
  "Studded-tyre season and typical first snow; the legal duty is to have adequate tyres " +
  "for the conditions.";
export const WINTER_URL = "https://www.vegvesen.no/en/vehicles/own-and-maintain/tyres-and-wheels/";
export const EV_TAX_URL = "https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/kjop-og-salg-av-elbil/";

export function dueFor(item: ChecklistItem, inputs: DueInputs): DueInfo | null {
  switch (item.due) {
    case "licence": {
      const a = inputs.arrivalDate && ISO.test(inputs.arrivalDate) ? inputs.arrivalDate : null;
      if (!a) {
        return {
          kind: "missing",
          text: "Add your arrival date on Your situation to see the deadline",
          to: DRIVE_PATH,
        };
      }
      return { kind: "date", iso: addMonths(a, 12), basis: LICENCE_BASIS, url: LICENCE_URL };
    }
    case "winter_tyres": {
      const from = inputs.startDate && ISO.test(inputs.startDate) ? inputs.startDate : inputs.today;
      return { kind: "date", iso: nextAnniversary(from, 11, 1), basis: WINTER_BASIS, url: WINTER_URL };
    }
    case "ev_tax": {
      const p = inputs.pendingEvRule;
      if (p === undefined) return null;
      if (p === "unknown") return { kind: "unknown", text: "could not check pending rules" };
      if (p === null) return null;
      const iso =
        p.effective_from && ISO.test(p.effective_from)
          ? p.effective_from
          : nextAnniversary(inputs.today, 1, 1);
      return {
        kind: "date",
        iso,
        basis:
          `Pending rule ${p.id}: a reported change to EV VAT, not yet enacted. ` +
          "Applied in the results only once an official source is cited.",
        url: EV_TAX_URL,
      };
    }
    default:
      return null;
  }
}

export interface NextDue {
  item: ChecklistItem;
  iso: string;
}

/** Earliest dated due among unticked items, ignoring dates already past. */
export function nextDue(
  dues: Map<string, DueInfo | null>,
  ticked: string[],
  today: string,
): NextDue | null {
  let best: NextDue | null = null;
  for (const item of CHECKLIST_ITEMS) {
    const d = dues.get(item.id);
    if (!d || d.kind !== "date" || ticked.includes(item.id) || d.iso < today) continue;
    if (!best || d.iso < best.iso) best = { item, iso: d.iso };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Impact panel: from the scenario's sensitivity rows (022 R10).

export interface ImpactRow {
  id: string;
  label: string;
  /** e.g. "± 2 340 kr / yr" or "up to 12 000 kr". */
  text: string;
  note: string;
}

function money(value: number, measure: Measure): string {
  if (measure === "per_km") return formatPerKm(value);
  if (measure === "per_month") return `${formatNok(value * 12)} / yr`;
  return formatNok(value);
}

function signed(value: number, measure: Measure): string {
  if (measure === "per_km") return formatPerKm(value);
  if (measure === "per_month") return `${formatNokSigned(value * 12)} / yr`;
  return formatNokSigned(value);
}

export function impactRows(data: ScenarioResponse | null): ImpactRow[] {
  if (!data) return [];
  const measure = data.ranking_measure;
  const rows: SensitivityRow[] = data.sensitivity ?? [];
  const insurance = rows.find((r) => r.driver === "insurance");
  const exit = rows.find((r) => r.driver === "exit_timing");
  const option = data.options.find((o) => o.result.option_id === data.sensitivity_option_id);
  const out: ImpactRow[] = [];
  if (insurance) {
    const half = Math.round((insurance.high - insurance.low) / 2);
    out.push({
      id: "insurance_quotes",
      label: "Real insurance quotes",
      text: `± ${money(half, measure)}`,
      note: insurance.note || "Quote range for your profile",
    });
    out.push({
      id: "claims_free_letter",
      label: "Claims-free letter",
      text: `up to ${signed(insurance.low, measure)}`,
      note: "Low end of the insurance range if your bonus carries over",
    });
  }
  if (exit && option?.option_kind === "lease") {
    out.push({
      id: "lease_terms",
      label: "Lease early-exit terms",
      text: `up to ${signed(exit.high, measure)}`,
      note: exit.note || "Worst exit point for the top lease",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Markdown export (R7).

export interface MarkdownInputs {
  ticked: string[];
  dues: Map<string, DueInfo | null>;
  modes: Mode[];
  generatedOn: string;
}

export function checklistMarkdown({ ticked, dues, modes, generatedOn }: MarkdownInputs): string {
  const lines: string[] = ["# Norway car checklist", "", `Generated ${generatedOn}.`, ""];
  for (const g of CHECKLIST_GROUPS) {
    lines.push(`## ${g.title}`, "");
    for (const item of CHECKLIST_ITEMS.filter((i) => i.group === g.id)) {
      const box = ticked.includes(item.id) ? "[x]" : "[ ]";
      const note = appliesNote(item, modes);
      lines.push(`- ${box} ${item.title} — ${item.why} (${item.tag}${note ? `; ${note}` : ""})`);
      const d = dues.get(item.id);
      if (d?.kind === "date") lines.push(`  Due ${d.iso} (estimate: ${d.basis})`);
      else if (d?.kind === "missing") lines.push(`  Due date: ${d.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export const CHECKLIST_FILENAME = "norway-car-checklist.md";

/** Trigger a browser download; no-op where object URLs are unavailable (tests). */
export function downloadText(text: string, filename: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
