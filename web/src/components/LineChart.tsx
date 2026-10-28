// A small multi-series line chart (SVG): points over a season, elevation over a lap, etc.
import { useElementSize } from '../hooks';

export interface LineSeries {
  id: string;
  label: string;
  colour: string;
  values: (number | null)[];
  dashed?: boolean;
  /** Draw a filled area under the line (single-series charts). */
  fill?: boolean;
}

export function LineChart({
  series,
  xLabels,
  height = 240,
  yFormat = (v) => String(Math.round(v)),
  xEvery = 1,
  invert = false,
  yMin,
}: {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  yFormat?: (v: number) => string;
  /** Label every Nth x value. */
  xEvery?: number;
  /** Higher values at the bottom (positions). */
  invert?: boolean;
  yMin?: number;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = size.width;
  const H = height;
  const pad = { l: 44, r: series.length > 1 ? 78 : 16, t: 10, b: 22 };
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const lo = yMin ?? (all.length ? Math.min(...all) : 0);
  const hi0 = all.length ? Math.max(...all) : 1;
  const hi = hi0 === lo ? lo + 1 : hi0;
  const n = Math.max(2, xLabels.length);
  const x = (i: number) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
  const yr = (v: number) => (v - lo) / (hi - lo);
  const y = (v: number) => pad.t + (invert ? yr(v) : 1 - yr(v)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  // End-of-line labels, nudged apart so close finishes stay readable.
  const labels = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] == null) i--;
      return i < 0 ? null : { id: s.id, label: s.label, colour: s.colour, x: x(i) + 4, y: y(s.values[i]!) + 3 };
    })
    .filter((l): l is NonNullable<typeof l> => l != null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 11) labels[i].y = labels[i - 1].y + 11;

  return (
    <div ref={ref} className="line-chart" style={{ height: H }}>
      {W > 0 && (
        <svg width={W} height={H}>
          {ticks.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#ffffff10" />
              <text x={pad.l - 6} y={y(v) + 3} fill="var(--dim)" fontSize={10} textAnchor="end">
                {yFormat(v)}
              </text>
            </g>
          ))}
          {xLabels.map((l, i) =>
            i % xEvery === 0 || i === xLabels.length - 1 ? (
              <text key={i} x={x(i)} y={H - 6} fill="var(--dim)" fontSize={10} textAnchor="middle">
                {l}
              </text>
            ) : null,
          )}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v)] as const))).filter((p): p is readonly [number, number] => p != null);
            if (!pts.length) return null;
            const last = pts[pts.length - 1];
            return (
              <g key={s.id}>
                {s.fill && (
                  <polygon
                    points={[...pts.map((p) => p.join(',')), `${last[0]},${H - pad.b}`, `${pts[0][0]},${H - pad.b}`].join(' ')}
                    fill={s.colour}
                    opacity={0.15}
                  />
                )}
                <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.colour} strokeWidth={2} strokeDasharray={s.dashed ? '4 3' : undefined}>
                  <title>{s.label}</title>
                </polyline>
              </g>
            );
          })}
          {series.length > 1 &&
            labels.map((l) => (
              <text key={l.id} x={l.x} y={l.y} fill={l.colour} fontSize={10} fontWeight={700}>
                {l.label}
              </text>
            ))}
        </svg>
      )}
    </div>
  );
}
