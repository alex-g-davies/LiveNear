// Translated text with React elements inside it (spec 028): a dictionary
// string such as "Pricier than {pct} of {areas}" keeps its word order in each
// language, and the `{pct}` slot becomes, say, a <strong>.

import { Fragment, type ReactNode } from "react";

/** Replace `{name}` slots in an already-translated `text` with nodes. Slots
 * not in `parts` stay as written. */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = text.split(/(\{\w+\})/g);
  return pieces.map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    const node = m && m[1] in parts ? parts[m[1]] : piece;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
