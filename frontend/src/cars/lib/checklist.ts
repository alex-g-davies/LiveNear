// Newcomer checklist content and derivations (spec 023 R4–R7). Pure
// functions: the item table, due dates with their bases, the impact rows
// taken from the scenario's sensitivity, and the Markdown export. No I/O.

import type { ScenarioResponse, SensitivityRow } from "../api";
import { formatDate, formatNok, formatNokSigned, formatPerKm } from "./format";
import type { Measure, Mode } from "./profile";
import { t, tDynamic } from "../../i18n/core";
import { DRIVE_PATH } from "../../lib/productRoutes";

export type ChecklistGroupId = "before_choose" | "before_sign" | "after";

export interface ChecklistGroup {
  id: ChecklistGroupId;
  readonly title: string;
}

export type DueKind = "licence" | "winter_tyres" | "ev_tax";

export interface ChecklistItem {
  id: string;
  group: ChecklistGroupId;
  readonly title: string;
  readonly why: string;
  readonly tag: string;
  /** Ways to get the car this item applies to; undefined = always. */
  modes?: Mode[];
  due?: DueKind;
}

// Words are getters read at call time, so they follow the site language
// (spec 028); ids, groups and modes stay fixed.
function group(id: ChecklistGroupId): ChecklistGroup {
  return {
    id,
    get title() {
      return tDynamic(`carsPlan.check.group.${id}`);
    },
  };
}

type TagId =
  | "insurance" | "deadline" | "financing" | "price" | "resale" | "risk" | "exit" | "tyres" | "running" | "energy";

function item(
  id: string,
  groupId: ChecklistGroupId,
  tag: TagId,
  extra: { modes?: Mode[]; due?: DueKind } = {},
): ChecklistItem {
  return {
    id,
    group: groupId,
    ...extra,
    get title() {
      return tDynamic(`carsPlan.check.${id}.title`);
    },
    get why() {
      return tDynamic(`carsPlan.check.${id}.why`);
    },
    get tag() {
      return tDynamic(`carsPlan.check.tag.${tag}`);
    },
  };
}

export const CHECKLIST_GROUPS: ChecklistGroup[] = [group("before_choose"), group("before_sign"), group("after")];

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  item("claims_free_letter", "before_choose", "insurance"),
  item("licence_exchange", "before_choose", "deadline", { due: "licence" }),
  item("id_and_bankid", "before_choose", "financing"),
  item("ev_tax_changes", "before_choose", "price", { due: "ev_tax" }),
  item("insurance_quotes", "before_sign", "insurance"),
  item("battery_health_report", "before_sign", "resale", { modes: ["used_1_3", "used_5_plus"] }),
  item("prefer_dealer", "before_sign", "risk", { modes: ["used_1_3", "used_5_plus"] }),
  item("lease_terms", "before_sign", "exit", { modes: ["lease"] }),
  item("winter_tyres", "after", "tyres", { due: "winter_tyres" }),
  item("toll_tag", "after", "running"),
  item("charging_accounts", "after", "energy"),
];

export const CHECKLIST_IDS: string[] = CHECKLIST_ITEMS.map((i) => i.id);

/** Note shown when an item only applies to a way the user has not kept. */
export function appliesNote(item: ChecklistItem, modes: Mode[]): string | null {
  if (!item.modes) return null;
  if (item.modes.some((m) => modes.includes(m))) return null;
  return item.modes.includes("lease") ? t("carsPlan.check.onlyLease") : t("carsPlan.check.onlyUsed");
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

export const licenceBasis = (): string => t("carsPlan.check.licenceBasis");
export const LICENCE_URL = "https://www.vegvesen.no/en/driving-licences/";
export const winterBasis = (): string => t("carsPlan.check.winterBasis");
export const WINTER_URL = "https://www.vegvesen.no/en/vehicles/own-and-maintain/tyres-and-wheels/";
export const EV_TAX_URL = "https://www.skatteetaten.no/bedrift-og-organisasjon/avgifter/mva/kjop-og-salg-av-elbil/";

export function dueFor(item: ChecklistItem, inputs: DueInputs): DueInfo | null {
  switch (item.due) {
    case "licence": {
      const a = inputs.arrivalDate && ISO.test(inputs.arrivalDate) ? inputs.arrivalDate : null;
      if (!a) {
        return {
          kind: "missing",
          text: t("carsPlan.check.addArrival"),
          to: DRIVE_PATH,
        };
      }
      return { kind: "date", iso: addMonths(a, 12), basis: licenceBasis(), url: LICENCE_URL };
    }
    case "winter_tyres": {
      const from = inputs.startDate && ISO.test(inputs.startDate) ? inputs.startDate : inputs.today;
      return { kind: "date", iso: nextAnniversary(from, 11, 1), basis: winterBasis(), url: WINTER_URL };
    }
    case "ev_tax": {
      const p = inputs.pendingEvRule;
      if (p === undefined) return null;
      if (p === "unknown") return { kind: "unknown", text: t("carsPlan.check.couldNotCheck") };
      if (p === null) return null;
      const iso =
        p.effective_from && ISO.test(p.effective_from)
          ? p.effective_from
          : nextAnniversary(inputs.today, 1, 1);
      return {
        kind: "date",
        iso,
        basis: t("carsPlan.check.evTaxBasis"),
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
  /** True when `note` is backend prose, still English (028 R7). */
  noteIsBackend: boolean;
}

function money(value: number, measure: Measure): string {
  if (measure === "per_km") return formatPerKm(value);
  if (measure === "per_month") return t("carsPlan.impact.perYear", { value: formatNok(value * 12) });
  return formatNok(value);
}

function signed(value: number, measure: Measure): string {
  if (measure === "per_km") return formatPerKm(value);
  if (measure === "per_month") return t("carsPlan.impact.perYear", { value: formatNokSigned(value * 12) });
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
      label: t("carsPlan.impact.insurance"),
      text: `± ${money(half, measure)}`,
      note: insurance.note || t("carsPlan.impact.insuranceNote"),
      noteIsBackend: Boolean(insurance.note),
    });
    out.push({
      id: "claims_free_letter",
      label: t("carsPlan.impact.letter"),
      text: t("carsPlan.impact.upTo", { value: signed(insurance.low, measure) }),
      note: t("carsPlan.impact.letterNote"),
      noteIsBackend: false,
    });
  }
  if (exit && option?.option_kind === "lease") {
    out.push({
      id: "lease_terms",
      label: t("carsPlan.impact.lease"),
      text: t("carsPlan.impact.upTo", { value: signed(exit.high, measure) }),
      note: exit.note || t("carsPlan.impact.leaseNote"),
      noteIsBackend: Boolean(exit.note),
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
  // The date stays ISO (machine metadata, 028 R11); the words translate.
  const lines: string[] = [
    `# ${t("carsPlan.md.title")}`,
    "",
    t("carsPlan.md.generated", { date: generatedOn }),
    "",
  ];
  for (const g of CHECKLIST_GROUPS) {
    lines.push(`## ${g.title}`, "");
    for (const item of CHECKLIST_ITEMS.filter((i) => i.group === g.id)) {
      const box = ticked.includes(item.id) ? "[x]" : "[ ]";
      const note = appliesNote(item, modes);
      lines.push(`- ${box} ${item.title} — ${item.why} (${item.tag}${note ? `; ${note}` : ""})`);
      const d = dues.get(item.id);
      if (d?.kind === "date") {
        const due = formatDate(d.iso).replace(/ /g, " ");
        lines.push(`  ${t("carsPlan.md.due", { date: due, basis: d.basis })}`);
      }
      else if (d?.kind === "missing") lines.push(`  ${t("carsPlan.md.dueDate", { text: d.text })}`);
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
