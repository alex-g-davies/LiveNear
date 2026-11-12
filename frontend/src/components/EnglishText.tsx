// Backend prose with no translation key yet (spec 028 R7). In English it is
// plain text; in other languages it is marked `lang="en"` and tagged, so
// readers and screen readers know it is English.

import type { ReactNode } from "react";

import { useT } from "../i18n/react";

interface Props {
  children: ReactNode;
  /** Render as a block (`div`) instead of inline (`span`). */
  block?: boolean;
  className?: string;
}

export default function EnglishText({ children, block = false, className }: Props) {
  const { t, lang } = useT();
  const Tag = block ? "div" : "span";
  if (lang === "en") return <Tag className={className}>{children}</Tag>;
  return (
    <Tag className={className} lang="en">
      {children} <span className="en-tag">{t("common.englishTag")}</span>
    </Tag>
  );
}
