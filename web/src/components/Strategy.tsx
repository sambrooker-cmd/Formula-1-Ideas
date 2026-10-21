import type { SessionData } from '../data/session';
import { leaderLap, tower } from '../data/state';
import { useElementSize, useNow, useSynced } from '../hooks';
import { clock } from '../sync/clock';
import { Panel } from './Panel';

const COMPOUND: Record<string, string> = {
  SOFT: 'var(--soft)',
  MEDIUM: 'var(--medium)',
  HARD: 'var(--hard)',
  INTERMEDIATE: 'var(--inter)',
  WET: 'var(--wet)',
};

/** Stints as coloured bars per driver, ordered by the current running order. */
export function Strategy({ data, area, lead }: { data: SessionData; area?: string; lead?: React.ReactNode }) {
  const t = useNow(2);
  const { selected } = useSynced();
  const [ref, size] = useElementSize<HTMLDivElement>();
  const rows = tower(data, t);
  const total = Math.max(1, data.meta.totalLaps);
  const lap = leaderLap(data, t);
  const labelW = 46;
  const rowH = Math.max(12, Math.min(22, (size.height - 24) / Math.max(1, rows.length)));
  const plotW = Math.max(10, size.width - labelW - 10);
  const x = (l: number) => labelW + ((l - 1) / total) * plotW;

  return (
    <Panel title="Tyre strategy" lead={lead} area={area} popout="/strategy">
      <div ref={ref} style={{ position: 'absolute', inset: '6px 8px 4px 4px' }}>
        {size.width > 0 && (
          <svg width={size.width} height={rows.length * rowH + 20} style={{ display: 'block' }}>
            {Array.from({ length: Math.floor(total / 10) + 1 }, (_, i) => i * 10)
              .filter((l) => l > 0)
              .map((l) => (
                <g key={l}>
                  <line x1={x(l)} x2={x(l)} y1={0} y2={rows.length * rowH} stroke="#ffffff10" />
                  <text x={x(l)} y={rows.length * rowH + 13} fill="var(--dim)" fontSize={10} textAnchor="middle">
                    {l}
                  </text>
                </g>
              ))}
            {rows.map((r, i) => {
              const d = data.drivers.get(r.driver)!;
              const stints = data.stints.get(r.driver) ?? [];
              const y = i * rowH;
              const sel = selected.includes(r.driver);
              return (
                <g key={r.driver} onClick={() => clock.toggleSelected(r.driver)} style={{ cursor: 'pointer' }}>
                  {sel && <rect x={0} y={y} width={size.width} height={rowH} fill="#ffffff0d" />}
                  <rect x={2} y={y + rowH * 0.2} width={3} height={rowH * 0.6} fill={d.colour} />
                  <text x={9} y={y + rowH / 2 + 4} fill="var(--text)" fontSize={11} fontWeight={700}>
                    {d.code}
                  </text>
                  {stints.map((s) => {
                    const end = Math.min(s.lapEnd ?? total, total);
                    const shownEnd = Math.min(end, Math.max(lap, s.lapStart));
                    if (s.lapStart > lap && lap > 0) return null;
                    return (
                      <rect
                        key={s.stint}
                        x={x(s.lapStart)}
                        y={y + rowH * 0.22}
                        width={Math.max(2, x(shownEnd + 1) - x(s.lapStart) - 2)}
                        height={rowH * 0.56}
                        rx={3}
                        fill={COMPOUND[s.compound ?? ''] ?? 'var(--muted)'}
                        opacity={0.85}
                      >
                        <title>
                          {s.compound} · laps {s.lapStart}–{end} · {s.ageAtStart ?? 0} laps old at fit
                        </title>
                      </rect>
                    );
                  })}
                </g>
              );
            })}
            {lap > 0 && <line x1={x(lap + 0.5)} x2={x(lap + 0.5)} y1={0} y2={rows.length * rowH} stroke="#fff" strokeDasharray="3 3" />}
          </svg>
        )}
      </div>
    </Panel>
  );
}
