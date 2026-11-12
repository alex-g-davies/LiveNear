// Selection tray (spec 024 R10): the compact replacement for the per-variant
// checkbox list. One chip per selected variant with editable model-year
// range and a remove button, plus an "Add a car" combobox over the catalogue
// grouped by make. State stays the shared `selection`; this component only
// proposes the next list.

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import type { VehicleOut } from "../api";
import { MAX_COMPARE_VARIANTS, capHint, variantCount } from "../lib/market";
import type { SelectionItem } from "../lib/profile";
import EnglishText from "../../components/EnglishText";
import { useT } from "../../i18n/react";
import { drivePath } from "../../lib/productRoutes";

interface Props {
  vehicles: VehicleOut[];
  selection: SelectionItem[];
  onChange: (next: SelectionItem[]) => void;
  loading?: boolean;
  error?: string | null;
}

export const vehicleName = (v: VehicleOut): string => `${v.make} ${v.model} ${v.trim_group}`;

/** Clamp a year edit so from <= to, moving the other end when needed. */
export function withYearEdit(item: SelectionItem, patch: Partial<SelectionItem>): SelectionItem {
  const next = { ...item, ...patch };
  if (next.year_from > next.year_to) {
    if (patch.year_from !== undefined) next.year_to = next.year_from;
    else next.year_from = next.year_to;
  }
  return next;
}

export function matchingVehicles(vehicles: VehicleOut[], query: string): VehicleOut[] {
  const q = query.trim().toLowerCase();
  if (!q) return vehicles;
  return vehicles.filter((v) => vehicleName(v).toLowerCase().includes(q));
}

export default function SelectionTray({ vehicles, selection, onChange, loading, error }: Props) {
  const { t } = useT();
  const [emptyBefore, emptyAfter = ""] = t("carsPlan.tray.empty").split("{link}");
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const byId = useMemo(() => new Map(vehicles.map((v) => [v.variant_id, v])), [vehicles]);
  const selectedIds = useMemo(() => new Set(selection.map((s) => s.variant_id)), [selection]);
  const matches = useMemo(() => matchingVehicles(vehicles, query), [vehicles, query]);
  const groups = useMemo(() => {
    const map = new Map<string, VehicleOut[]>();
    for (const v of matches) map.set(v.make, [...(map.get(v.make) ?? []), v]);
    return [...map.entries()];
  }, [matches]);
  const full = variantCount(selection) >= MAX_COMPARE_VARIANTS;
  const activeIdx = Math.min(active, Math.max(0, matches.length - 1));
  const activeId = matches[activeIdx]?.variant_id;

  const add = (v: VehicleOut) => {
    if (selectedIds.has(v.variant_id) || full) return;
    onChange([
      ...selection,
      { variant_id: v.variant_id, year_from: Math.min(...v.model_years), year_to: Math.max(...v.model_years) },
    ]);
    setQuery("");
    setActive(0);
    setOpen(false);
  };
  const remove = (id: string) => onChange(selection.filter((s) => s.variant_id !== id));
  const setYears = (id: string, patch: Partial<SelectionItem>) =>
    onChange(selection.map((s) => (s.variant_id === id ? withYearEdit(s, patch) : s)));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && matches[activeIdx]) {
        e.preventDefault();
        add(matches[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="cars-tray">
      {selection.length === 0 && !loading && (
        <p className="cars-tray__empty" role="status">
          {emptyBefore}
          <Link to={drivePath("/market")} className="cars-link">
            {t("carsPlan.tray.emptyLink")}
          </Link>
          {emptyAfter}
        </p>
      )}
      {loading && <p className="cars-hint">{t("carsPlan.tray.loading")}</p>}
      {error && (
        <div className="status status--error" role="alert">
          {t("carsPlan.tray.error")} <EnglishText>{error}</EnglishText>
        </div>
      )}
      <ul className="cars-tray__chips" aria-label={t("carsPlan.tray.label")}>
        {selection.map((s) => {
          const v = byId.get(s.variant_id);
          const name = v ? vehicleName(v) : s.variant_id;
          const years = v ? v.model_years : [s.year_from, s.year_to];
          return (
            <li key={s.variant_id} className="cars-tray__chip" data-testid="tray-chip">
              <span className="cars-tray__name">{name}</span>
              <span className="cars-tray__years">
                <label className="cars-field cars-field--inline">
                  <span className="cars-field__label cars-field__label--muted">{t("carsPlan.tray.from")}</span>
                  <select
                    className="cars-select cars-select--sm"
                    value={s.year_from}
                    onChange={(e) => setYears(s.variant_id, { year_from: Number(e.target.value) })}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cars-field cars-field--inline">
                  <span className="cars-field__label cars-field__label--muted">{t("carsPlan.tray.to")}</span>
                  <select
                    className="cars-select cars-select--sm"
                    value={s.year_to}
                    onChange={(e) => setYears(s.variant_id, { year_to: Number(e.target.value) })}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              </span>
              <button
                type="button"
                className="cars-tray__remove"
                aria-label={t("carsPlan.tray.remove", { name })}
                onClick={() => remove(s.variant_id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <div className="cars-tray__add">
        <label className="cars-field">
          <span className="cars-field__label">{t("carsPlan.tray.add")}</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            className="cars-input"
            placeholder={full ? t("carsPlan.tray.full") : t("carsPlan.tray.placeholder")}
            disabled={full}
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && activeId ? `${listId}-${activeId}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKey}
          />
        </label>
        {full && (
          <p className="cars-hint" role="status" data-testid="tray-full">
            {capHint()}
          </p>
        )}
        {open && !full && (
          <ul id={listId} role="listbox" className="cars-tray__list" aria-label={t("carsPlan.tray.catalogue")}>
            {groups.map(([make, list]) => (
              <li key={make} role="group" aria-label={make} className="cars-tray__group">
                <span className="cars-tray__make" aria-hidden="true">
                  {make}
                </span>
                <ul>
                  {list.map((v) => {
                    const taken = selectedIds.has(v.variant_id);
                    const isActive = v.variant_id === activeId;
                    return (
                      <li
                        key={v.variant_id}
                        id={`${listId}-${v.variant_id}`}
                        role="option"
                        aria-selected={isActive}
                        aria-disabled={taken || undefined}
                        className={`cars-tray__option${isActive ? " cars-tray__option--active" : ""}${taken ? " cars-tray__option--taken" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => !taken && add(v)}
                      >
                        <span>{vehicleName(v)}</span>
                        <span className="cars-hint">
                          {Math.min(...v.model_years)}–{Math.max(...v.model_years)}
                          {taken ? t("carsPlan.tray.selected") : v.has_lease_offer ? "" : t("carsPlan.tray.noLease")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="cars-tray__none" role="option" aria-disabled="true" aria-selected={false}>
                {t("carsPlan.tray.none", { query })}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
