// Range bar from best to worst exit with the expected mark (spec 022 R11).
// All three positions are fractions of the row-set maximum.

interface Props {
  lo: number;
  mid: number;
  hi: number;
  color?: string;
  label: string;
}

const pct = (f: number) => `${Math.max(0, Math.min(1, f)) * 100}%`;

export default function RangeBar({ lo, mid, hi, color, label }: Props) {
  const left = Math.min(lo, hi);
  const right = Math.max(lo, hi);
  return (
    <div className="cars-range" role="img" aria-label={label}>
      <div className="cars-range__track" />
      <div
        className="cars-range__span"
        style={{
          left: pct(left),
          width: pct(right - left),
          background: color ?? undefined,
          opacity: color ? 0.3 : undefined,
        }}
      />
      <div className="cars-range__mark" style={{ left: pct(mid), background: color ?? undefined }} />
    </div>
  );
}
