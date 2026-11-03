// Car state context (spec 022 R2). One provider owns the browser-held state,
// mirrors it to localStorage and the `c` URL parameter (debounced
// replaceState, like the map app), and runs the scenario request once for
// every screen so navigating between Compare, Curves and Detail never
// refetches.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

import type { ScenarioRequest } from "./api";
import { useScenario, type ScenarioState } from "./hooks/useScenario";
import { useVehicles, type VehiclesState } from "./hooks/useVehicles";
import { capSelection } from "./lib/market";
import {
  DEFAULT_STATE,
  URL_PARAM,
  applyWhatIf,
  decodeState,
  encodeState,
  loadState,
  saveState,
  type CarProfile,
  type CarState,
  type Measure,
  type SelectionItem,
  type WhatIf,
} from "./lib/profile";

export const SCENARIO_SEED = 42;
export const SCENARIO_DRAWS = 2000;
/** 2.5 years: the exit point both Compare curves and Detail start on. */
export const DEFAULT_EXIT_MONTH = 30;

export interface CarStateApi {
  state: CarState;
  updateProfile: (patch: Partial<CarProfile>) => void;
  setProfile: (updater: (p: CarProfile) => CarProfile) => void;
  setSelection: (selection: SelectionItem[]) => void;
  setWhatIf: (whatIf: WhatIf | null) => void;
  /** Fold the what-if values into the saved profile and clear them. */
  saveWhatIf: () => void;
  setOverride: (id: string, value: string | number) => void;
  clearOverride: (id: string) => void;
  setMeasure: (measure: Measure) => void;
  /** Tick / untick a newcomer-checklist item (023 R5). */
  toggleChecklist: (id: string) => void;
  /** Explicit persist (the Save draft button); returns false if storage failed. */
  saveDraft: () => boolean;
  /** Exit point marked on Compare curves and Detail (months 6..60); shared so
   *  the two screens show the same month. Session-only, never persisted. */
  exitMonth: number;
  setExitMonth: (month: number) => void;
  request: ScenarioRequest | null;
  scenario: ScenarioState;
  vehicles: VehiclesState;
}

const Ctx = createContext<CarStateApi | null>(null);

function readInitial(): CarState {
  try {
    const token = new URLSearchParams(window.location.search).get(URL_PARAM);
    if (token) return decodeState(token);
  } catch {
    /* fall through */
  }
  return loadState() ?? DEFAULT_STATE;
}

export function buildRequest(state: CarState): ScenarioRequest {
  return {
    profile: state.profile,
    selection: state.selection,
    what_if: state.whatIf,
    overrides: state.overrides,
    measure: state.measure,
    seed: SCENARIO_SEED,
    draws: SCENARIO_DRAWS,
  };
}

interface ProviderProps {
  children: ReactNode;
  /** Tests: start from a given state instead of the URL / localStorage. */
  initialState?: CarState;
}

export function CarStateProvider({ children, initialState }: ProviderProps) {
  const [state, setState] = useState<CarState>(() => initialState ?? readInitial());
  const location = useLocation();

  // Persist: debounced localStorage write + `?c=` in the address bar.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      saveState(state);
      try {
        const params = new URLSearchParams(window.location.search);
        const token = encodeState(state);
        if (token) params.set(URL_PARAM, token);
        else params.delete(URL_PARAM);
        const qs = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
      } catch {
        /* history unavailable */
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [state]);

  const updateProfile = useCallback(
    (patch: Partial<CarProfile>) => setState((s) => ({ ...s, profile: { ...s.profile, ...patch } })),
    [],
  );
  const setProfile = useCallback(
    (updater: (p: CarProfile) => CarProfile) => setState((s) => ({ ...s, profile: updater(s.profile) })),
    [],
  );
  // Every entry point disables itself at the cap; this clamp is the backstop
  // (a Market-map box select can propose many models at once) so the request
  // never exceeds what the server accepts (024 R18).
  const setSelection = useCallback(
    (selection: SelectionItem[]) => setState((s) => ({ ...s, selection: capSelection(selection) })),
    [],
  );
  const setWhatIf = useCallback((whatIf: WhatIf | null) => setState((s) => ({ ...s, whatIf })), []);
  // Save: return, km and pay mode have homes in the profile; loan rate and
  // used-price drift do not, so they persist as engine overrides.
  const saveWhatIf = useCallback(
    () =>
      setState((s) => {
        const overrides = { ...s.overrides };
        if (s.whatIf?.loan_rate_pct !== undefined) overrides.loan_rate = s.whatIf.loan_rate_pct;
        if (s.whatIf?.used_price_drift_pct !== undefined)
          overrides.used_price_drift_pct = s.whatIf.used_price_drift_pct;
        return { ...s, profile: applyWhatIf(s.profile, s.whatIf), overrides, whatIf: null };
      }),
    [],
  );
  const setOverride = useCallback(
    (id: string, value: string | number) =>
      setState((s) => ({ ...s, overrides: { ...s.overrides, [id]: value } })),
    [],
  );
  const clearOverride = useCallback(
    (id: string) =>
      setState((s) => {
        const next = { ...s.overrides };
        delete next[id];
        return { ...s, overrides: next };
      }),
    [],
  );
  const setMeasure = useCallback(
    (measure: Measure) =>
      setState((s) => ({ ...s, measure, profile: { ...s.profile, preferred_measure: measure } })),
    [],
  );
  const toggleChecklist = useCallback(
    (id: string) =>
      setState((s) => ({
        ...s,
        checklist: s.checklist.includes(id) ? s.checklist.filter((x) => x !== id) : [...s.checklist, id],
      })),
    [],
  );
  const saveDraft = useCallback(() => saveState(state), [state]);
  const [exitMonth, setExitMonthRaw] = useState(DEFAULT_EXIT_MONTH);
  const setExitMonth = useCallback(
    (month: number) => setExitMonthRaw(Math.min(60, Math.max(6, Math.round(month)))),
    [],
  );

  // The scenario runs on every screen except the form itself (typing there
  // would spam the backend for results nobody is looking at yet).
  const onForm = /^\/cars\/?$/.test(location.pathname);
  const request = useMemo(
    () => (onForm || state.selection.length === 0 ? null : buildRequest(state)),
    [onForm, state],
  );
  const scenario = useScenario(request);
  const vehicles = useVehicles();

  // Default selection for a first visit: the first four variants over their
  // full model-year range, applied once when the catalogue lands while the
  // user is on the Situation form and has picked nothing. On Market and
  // Compare an empty selection stays empty (023 R3: Clear means clear).
  const defaulted = useRef(false);
  useEffect(() => {
    if (defaulted.current || !vehicles.data || !onForm) return;
    defaulted.current = true;
    if (state.selection.length > 0) return;
    const first = vehicles.data.slice(0, 4).map<SelectionItem>((v) => ({
      variant_id: v.variant_id,
      year_from: Math.min(...v.model_years),
      year_to: Math.max(...v.model_years),
    }));
    if (first.length) setState((s) => (s.selection.length ? s : { ...s, selection: first }));
  }, [vehicles.data, state.selection.length, onForm]);

  const api = useMemo<CarStateApi>(
    () => ({
      state,
      updateProfile,
      setProfile,
      setSelection,
      setWhatIf,
      saveWhatIf,
      setOverride,
      clearOverride,
      setMeasure,
      toggleChecklist,
      saveDraft,
      exitMonth,
      setExitMonth,
      request,
      scenario,
      vehicles,
    }),
    [
      state,
      updateProfile,
      setProfile,
      setSelection,
      setWhatIf,
      saveWhatIf,
      setOverride,
      clearOverride,
      setMeasure,
      toggleChecklist,
      saveDraft,
      exitMonth,
      setExitMonth,
      request,
      scenario,
      vehicles,
    ],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCarState(): CarStateApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCarState must be used inside CarStateProvider");
  return ctx;
}
