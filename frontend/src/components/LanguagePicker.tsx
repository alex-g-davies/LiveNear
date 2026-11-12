// Language picker (spec 028 R1). Closed, it shows the short code; open, the
// native list gives each language's name in that language. The select sits
// transparently over the code, so it keeps native keyboard and touch
// behaviour and its accessible name says the language in full.

import { LANG_CODES, LANG_NAMES, LANGS, setLanguage, type Lang } from "../i18n/core";
import { useT } from "../i18n/react";

interface Props {
  className?: string;
}

export default function LanguagePicker({ className }: Props) {
  const { t, lang } = useT();
  return (
    <span className={`lang-picker${className ? ` ${className}` : ""}`}>
      <span className="lang-picker__code" aria-hidden="true">
        {LANG_CODES[lang]}
      </span>
      <select
        className="lang-picker__select"
        aria-label={t("common.language.label", { name: LANG_NAMES[lang] })}
        value={lang}
        onChange={(e) => void setLanguage(e.target.value as Lang)}
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </span>
  );
}
