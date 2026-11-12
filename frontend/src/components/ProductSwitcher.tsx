// Moves between the two products (spec 025 R7). The current product is plain
// text; the other is a link back to wherever the user left it (R8).

import { Link } from "react-router-dom";

import { useT } from "../i18n/react";
import { DRIVE_NAME, MAP_NAME, driveHref, loadDriveApp, loadMapApp, mapHref } from "../lib/productRoutes";

interface Props {
  current: "map" | "drive";
}

const PRODUCTS = [
  { key: "map", name: MAP_NAME, href: mapHref, preload: loadMapApp },
  { key: "drive", name: DRIVE_NAME, href: driveHref, preload: loadDriveApp },
] as const;

export default function ProductSwitcher({ current }: Props) {
  const { t } = useT();
  return (
    <nav aria-label={t("common.products")} className="product-switcher">
      {PRODUCTS.map((p) =>
        p.key === current ? (
          <span key={p.key} className="product-switcher__link product-switcher__link--current" aria-current="page">
            {p.name}
          </span>
        ) : (
          <Link
            key={p.key}
            to={p.href()}
            className="product-switcher__link"
            onMouseEnter={() => void p.preload()}
            onFocus={() => void p.preload()}
          >
            {p.name}
          </Link>
        ),
      )}
    </nav>
  );
}
