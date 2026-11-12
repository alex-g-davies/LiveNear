// Live / Estimate badge (spec 022 R5/R11). The tooltip lists the material
// estimates behind an Estimate badge so the status is never a bare word.
// Labels come from the API (`material_estimate_labels`), never from ids;
// callers translate them by key with `estimateLabels` (028 R6).

import type { Status } from "../api";
import { useT } from "../../i18n/react";

interface Props {
  status: Status;
  /** Readable labels of the material estimates (shown in the tooltip). */
  estimates?: string[];
}

export default function Badge({ status, estimates = [] }: Props) {
  const { t } = useT();
  const title =
    status === "live"
      ? t("carsCompare.badge.liveTitle")
      : estimates.length
        ? t("carsCompare.badge.estimatedTitle", { list: estimates.join(", ") })
        : t("carsCompare.badge.estimateTitle");
  return (
    <span className={`cars-badge cars-badge--${status}`} title={title}>
      {status === "live" ? t("carsCompare.badge.live") : t("carsCompare.badge.estimate")}
    </span>
  );
}
