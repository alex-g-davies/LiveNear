// Option names in the site language (spec 028 R5). The backend builds them in
// English as "<car> <year>, <how you get it>" (scenario_builder.py); the car
// stays as it is (R8) and the "how" part is translated. Anything that doesn't
// match is shown unchanged.

import type { OptionSummary, RecommendResponse, ScenarioResponse } from "../api";
import { getLang, t } from "../../i18n/core";

const PATTERN = /^(.*), (?:(buy new)|(\d+)-month lease|used from a (dealer)|used from a (private seller))$/;

export function optionLabel(label: string): string {
  if (getLang() === "en") return label;
  const m = PATTERN.exec(label);
  if (!m) return label;
  const car = m[1];
  if (m[2]) return t("carsCompare.option.buyNew", { car });
  if (m[3]) return t("carsCompare.option.lease", { car, months: m[3] });
  if (m[4]) return t("carsCompare.option.usedDealer", { car });
  return t("carsCompare.option.usedPrivate", { car });
}

function summary(s: OptionSummary): OptionSummary {
  return { ...s, result: { ...s.result, label: optionLabel(s.result.label) } };
}

/** A scenario response with its option names translated (call per language). */
export function localizeScenario(data: ScenarioResponse): ScenarioResponse {
  if (getLang() === "en") return data;
  return {
    ...data,
    options: data.options.map(summary),
    ruled_out: data.ruled_out.map((r) => ({ ...r, label: optionLabel(r.label) })),
  };
}

export function localizeRecommend(data: RecommendResponse): RecommendResponse {
  if (getLang() === "en") return data;
  return { ...data, rows: data.rows.map((r) => ({ ...r, summary: summary(r.summary) })) };
}
