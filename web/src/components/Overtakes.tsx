// Where the passes happened in this race: each on-track pass as a dot on the circuit, and a
// count by corner. Passes are the key moments' position swaps; the dot is where the passing
// car was when the timing registered it, which can be a little after the move itself.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { keyMoments } from '../data/moments';
import { carPosition, trackStatusAt } from '../data/state';
import { cornersForSession } from '../data/circuit';
import { clock } from '../sync/clock';
import { useElementSize } from '../hooks';
import { Panel } from './Panel';
import { fitTransform } from './TrackMap';

type Corner = { number: string; x: number; y: number };

export function Overtakes({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [lapOne, setLapOne] = useState(false);
  const [corners, setCorners] = useState<Corner[] | null>(null);
  useEffect(() => {
    cornersForSession(data.meta).then(setCorners, () => setCorners(null));
  }, [data.meta]);

  const passes = useMemo(() => {
    const out: { t: number; lap: number | null; a: number; b: number; x: number; y: number; text: string }[] = [];
    const swaps = keyMoments(data).filter((m) => m.kind === 'overtake');
    // A swap undone within a minute is the timing flickering (or a pass straight back): count neither.
    const undone = (m: (typeof swaps)[number]) =>
      swaps.some((o) => o !== m && o.drivers[0] === m.drivers[1] && o.drivers[1] === m.drivers[0] && Math.abs(o.t - m.t) < 60_000);
    const seen = new Set<string>();
    for (const m of swaps) {
      if (!lapOne && (m.lap ?? 0) <= 1) continue;
      // Places can't change behind the Safety Car: those swaps are timing noise.
      if (['SC', 'VSC', 'RED', 'SC_ENDING', 'VSC_ENDING'].includes(trackStatusAt(data, m.t).status) || undone(m)) continue;
      const k = `${m.drivers[0]}-${m.drivers[1]}-${m.lap}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const s = data.samples.get(m.drivers[0]);
      const p = s && carPosition(s, m.t);
      if (p && !p.stale) out.push({ t: m.t, lap: m.lap, a: m.drivers[0], b: m.drivers[1], x: p.x, y: p.y, text: m.text });
    }
    return out;
  }, [data, data.version, lapOne]);

  const byCorner = useMemo(() => {
    if (!corners?.length) return [];
    const counts = new Map<string, number>();
    for (const p of passes) {
      let best: Corner | null = null;
      let bd = Infinity;
      for (const c of corners) {
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) counts.set(best.number, (counts.get(best.number) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [passes, corners]);

  const outline = data.meta.outline;
  const map = useMemo(() => fitTransform(outline, size.width, size.height, null, { x: 24, top: 24, bottom: 24 }), [outline, size.width, size.height]);
  const race = data.meta.session.type === 'Race';
  const maxCount = byCorner[0]?.[1] ?? 1;

  return (
    <Panel title="Overtakes" lead={lead} area={area} popout="/overtakes" bodyClass="scroll">
      {!race ? (
        <div className="center-msg">Overtakes are for races and sprints.</div>
      ) : (
        <>
          <div className="moment-filters">
            <b>{passes.length}</b> on-track passes{lapOne ? '' : ' after lap 1'}
            <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
              <input type="checkbox" checked={lapOne} onChange={(e) => setLapOne(e.target.checked)} /> include lap 1
            </label>
          </div>
          <div className="pace-grid">
            <div className="ot-map" ref={ref}>
              {map && size.width > 0 && (
                <svg width={size.width} height={size.height}>
                  <path
                    d={outline.map(([x, y], i) => `${i ? 'L' : 'M'}${map(x, y).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z'}
                    fill="none"
                    stroke="#2d3746"
                    strokeWidth={8}
                    strokeLinejoin="round"
                  />
                  {corners?.map((c) => (
                    <text key={c.number} x={map(c.x, c.y)[0] + 8} y={map(c.x, c.y)[1] - 8} fill="#5b6676" fontSize={10}>
                      {c.number}
                    </text>
                  ))}
                  {passes.map((p, i) => (
                    <circle
                      key={i}
                      cx={map(p.x, p.y)[0]}
                      cy={map(p.x, p.y)[1]}
                      r={5}
                      fill={data.drivers.get(p.a)?.colour ?? '#fff'}
                      stroke="#07090d"
                      strokeWidth={1}
                      opacity={0.85}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        clock.setSelected([p.a, p.b]);
                        clock.seek(p.t - 8000);
                      }}
                    >
                      <title>
                        {p.text}
                        {p.lap ? ` (lap ${p.lap})` : ''}
                      </title>
                    </circle>
                  ))}
                </svg>
              )}
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>Passes by corner</div>
              {!corners ? (
                <div className="dim">Corner positions aren't available for this circuit.</div>
              ) : (
                <div className="ot-bars">
                  {byCorner.map(([c, n]) => (
                    <div key={c} className="ot-row">
                      <span className="num dim">T{c}</span>
                      <span className="ot-bar">
                        <i style={{ width: `${(n / maxCount) * 100}%` }} />
                      </span>
                      <span className="num">{n}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="dim" style={{ fontSize: 11 }}>
                Each dot is a pass, in the passing car's colour; click one to watch it. Positions come from the timing, so a dot can sit a little after where the
                move was made. The circuit guide shows how many passes there usually are here.
              </p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
