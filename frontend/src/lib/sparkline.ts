// Build an inline SVG polyline string for a ZIP's price history. Pure so it can
// be dropped into a MapLibre popup (an HTML string) without React.

export type HistoryPoint = [string, number];

export function buildSparklineSvg(
  history: HistoryPoint[] | null | undefined,
  width = 150,
  height = 34,
): string {
  if (!history || history.length < 2) return "";
  const values = history.map(([, v]) => v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - pad - ((v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // Green when the series ends up over its start, red when down.
  const trend = values[values.length - 1] >= values[0] ? "up" : "down"; // --positive / --negative
  return (
    `<svg class="spark" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">` +
    `<polyline class="spark__line spark__line--${trend}" fill="none" stroke-width="1.5" points="${points}"/></svg>`
  );
}
