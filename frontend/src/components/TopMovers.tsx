import { useMemo, useState } from "react";

import type { ZipValue } from "../api/client";
import { useT } from "../i18n/react";
import { formatPct } from "../lib/format";
import { topMovers } from "../lib/zipStats";

interface Props {
  records: Map<string, ZipValue>;
  onZipChosen: (zip: string) => void;
}

/** Clickable top YoY gainers/losers for the selected state (009 R6) — the
 * invitation to start exploring ZIP details. Hidden when no YoY data exists. */
export default function TopMovers({ records, onZipChosen }: Props) {
  const { t } = useT();
  const [tab, setTab] = useState<"gainers" | "losers">("gainers");
  const movers = useMemo(() => topMovers(records), [records]);
  const rows = movers[tab];
  if (movers.gainers.length === 0) return null;

  return (
    <details className="movers panel-fold" open>
      <summary>{t("map.movers.title")}</summary>
      <div className="movers__tabs" role="group" aria-label={t("map.movers.group")}>
        {(["gainers", "losers"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`movers__tab${tab === key ? " movers__tab--active" : ""}`}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {key === "gainers" ? t("map.movers.rising") : t("map.movers.falling")}
          </button>
        ))}
      </div>
      <ul className="movers__list">
        {rows.map((r) => (
          <li key={r.zip}>
            <button type="button" className="movers__row" onClick={() => onZipChosen(r.zip)}>
              <span className="movers__zip">{r.name ?? r.zip}</span>
              <span
                className={`movers__pct ${
                  (r.yoy_pct ?? 0) >= 0 ? "tip__metric--up" : "tip__metric--down"
                }`}
              >
                {formatPct(r.yoy_pct ?? 0)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
