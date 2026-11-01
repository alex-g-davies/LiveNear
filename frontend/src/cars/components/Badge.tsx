// Live / Estimate badge (spec 022 R5/R11). The tooltip lists the material
// estimates behind an Estimate badge so the status is never a bare word.
// Labels come from the API (`material_estimate_labels`), never from ids.

import type { Status } from "../api";

interface Props {
  status: Status;
  /** Readable labels of the material estimates (shown in the tooltip). */
  estimates?: string[];
}

export default function Badge({ status, estimates = [] }: Props) {
  const title =
    status === "live"
      ? "Every key input pulled from a dated source."
      : estimates.length
        ? `Estimated: ${estimates.join(", ")}`
        : "At least one key input is modelled or a default.";
  return (
    <span className={`cars-badge cars-badge--${status}`} title={title}>
      {status === "live" ? "Live" : "Estimate"}
    </span>
  );
}
