import { type FormEvent, useState } from "react";

import { getGeocode } from "../api/client";
import { useT } from "../i18n/react";

interface Props {
  /** Called with the geocoded work location and a human-readable label. */
  onLocated: (lat: number, lon: number, label: string) => void;
  /** Bias point for the search — the selected region's center (010 R3). */
  proximity: { lat: number; lon: number } | null;
  /** Which pin the search moves (016 R1); null hides the toggle (single mode). */
  target?: "A" | "B" | null;
  onTargetChange?: (target: "A" | "B") => void;
}

type Status = "idle" | "loading" | "error";

/** Free-text address search that geocodes via the backend and moves the work
 * location to the result. Success shows no message of its own — the located
 * address appears on the pin's address row right below, so echoing it here
 * would print the same text twice. */
export default function AddressSearch({ onLocated, proximity, target, onTargetChange }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // Kept as a key so a language switch re-translates it (spec 028).
  const [msg, setMsg] = useState<"" | "map.address.noMatch" | "map.address.unavailable">("");
  const { t } = useT();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setStatus("loading");
    setMsg("");
    try {
      const r = await getGeocode(query, proximity ?? undefined);
      onLocated(r.lat, r.lon, r.place_name);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      setMsg(
        (err as Error).message === "not_found"
          ? "map.address.noMatch"
          : "map.address.unavailable",
      );
    }
  }

  return (
    <form className="address" onSubmit={submit}>
      <label className="address__label" htmlFor="address-input">
        {t("map.address.label")}
      </label>
      <div className="address__row">
        {target != null && onTargetChange && (
          <div className="switcher address__target" role="group" aria-label={t("map.address.target")}>
            {(["A", "B"] as const).map((pin) => (
              <button
                key={pin}
                type="button"
                className={
                  pin === target ? "switcher__btn switcher__btn--active" : "switcher__btn"
                }
                aria-pressed={pin === target}
                onClick={() => onTargetChange(pin)}
              >
                {pin}
              </button>
            ))}
          </div>
        )}
        <input
          id="address-input"
          className="address__input"
          type="text"
          enterKeyHint="search"
          placeholder={t("map.address.placeholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            // A stale "no match" under a corrected query reads as a failure.
            if (status === "error") {
              setStatus("idle");
              setMsg("");
            }
          }}
        />
        <button className="address__btn" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "…" : t("map.address.go")}
        </button>
      </div>
      {msg && (
        <span
          role={status === "error" ? "alert" : undefined}
          className={status === "error" ? "address__msg address__msg--error" : "address__msg"}
        >
          {t(msg)}
        </span>
      )}
    </form>
  );
}
