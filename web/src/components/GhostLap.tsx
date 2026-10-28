// Ghost car: two laps raced against each other from the same start, on the map, with the gap
// between them all the way round. Has its own player (the laps happened at different times).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { carPosition, formatLapTime } from '../data/state';
import { deltaCurve, fracAt, speedAtFrac, timeAtFrac } from '../data/laptrace';
import { useElementSize } from '../hooks';
import { Panel } from './Panel';
import { fitTransform } from './TrackMap';
import { LineChart } from './LineChart';
import { LapSelect, useLapPair } from './LapPicker';

const SPEEDS = [0.25, 0.5, 1, 2];

export function GhostLap({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const { a, b, setA, setB, trA, trB } = useLapPair(data);
  const [g, setG] = useState(0); // ms into the laps
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ref, size] = useElementSize<HTMLDivElement>();
  const total = Math.max(trA?.lap.duration ?? 0, trB?.lap.duration ?? 0) * 1000;

  useEffect(() => setG(0), [trA, trB]);
  const last = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setG((x) => {
        const next = x + dt * speed;
        if (next >= total + 1500) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);

  const outline = data.meta.outline;
  const map = useMemo(() => fitTransform(outline, size.width, size.height, null, { x: 20, top: 20, bottom: 20 }), [outline, size.width, size.height]);
  // Smoothed: single samples can be a few tenths out, which shows as spikes in braking zones.
  const curve = useMemo(() => {
    const raw = trA && trB ? deltaCurve(trA, trB, 200) : [];
    return raw.map((_, i) => {
      const w = raw.slice(Math.max(0, i - 3), i + 4);
      return i === 0 || i === raw.length - 1 ? raw[i] : w.reduce((x, y) => x + y, 0) / w.length;
    });
  }, [trA, trB]);

  const dA = data.drivers.get(a.driver);
  const dB = data.drivers.get(b.driver);
  const sameColour = dA?.colour === dB?.colour;
  const posOf = (n: number, lapT: number, ms: number) => {
    const s = data.samples.get(n);
    return s ? carPosition(s, lapT + ms) : null;
  };

  let gap: number | null = null;
  let vA: number | null = null;
  let vB: number | null = null;
  if (trA && trB) {
    const fa = Math.min(1, fracAt(trA, Math.min(g, trA.lap.duration! * 1000)));
    gap = (g - timeAtFrac(trB, fa)) / 1000; // + : A is behind where B was at this point
    if (g >= trA.lap.duration! * 1000) gap = trA.lap.duration! - trB.lap.duration!;
    vA = speedAtFrac(trA, fa);
    vB = speedAtFrac(trB, Math.min(1, fracAt(trB, g)));
  }

  const ghostDots = trA && trB && map
    ? [
        { n: a.driver, p: posOf(a.driver, trA.lap.t, Math.min(g, trA.lap.duration! * 1000)), colour: dA?.colour ?? '#fff', label: 'A', ghost: false },
        { n: b.driver, p: posOf(b.driver, trB.lap.t, Math.min(g, trB.lap.duration! * 1000)), colour: dB?.colour ?? '#fff', label: 'B', ghost: true },
      ]
    : [];

  return (
    <Panel title="Ghost lap" lead={lead} area={area} popout="/ghost" bodyClass="scroll">
      <div className="moment-filters">
        <LapSelect data={data} value={a} onChange={setA} tag="A" />
        <span className="dim">vs</span>
        <LapSelect data={data} value={b} onChange={setB} tag="B" />
      </div>
      {!trA || !trB ? (
        <div className="center-msg static">Pick two timed laps with car data.</div>
      ) : (
        <div className="ghost">
          <div className="ghost-map" ref={ref}>
            {map && size.width > 0 && (
              <svg width={size.width} height={size.height}>
                <path
                  d={outline.map(([x, y], i) => `${i ? 'L' : 'M'}${map(x, y).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z'}
                  fill="none"
                  stroke="#2d3746"
                  strokeWidth={8}
                  strokeLinejoin="round"
                />
                {ghostDots.map((c) =>
                  c.p ? (
                    <g key={c.label}>
                      <circle
                        cx={map(c.p.x, c.p.y)[0]}
                        cy={map(c.p.x, c.p.y)[1]}
                        r={9}
                        fill={c.ghost ? 'transparent' : c.colour}
                        stroke={c.ghost ? (sameColour ? '#fff' : c.colour) : '#fff'}
                        strokeWidth={c.ghost ? 3 : 2}
                        strokeDasharray={c.ghost && sameColour ? '3 2' : undefined}
                        opacity={c.ghost ? 0.9 : 1}
                      />
                      <text x={map(c.p.x, c.p.y)[0] + 12} y={map(c.p.x, c.p.y)[1] + (c.ghost ? 16 : -6)} fill="#e8edf3" fontSize={12} fontWeight={700}>
                        {data.drivers.get(c.n)?.code}
                      </text>
                    </g>
                  ) : null,
                )}
              </svg>
            )}
          </div>
          <div className="ghost-side">
            <div className="ghost-gap num" style={{ color: gap == null ? undefined : gap > 0 ? 'var(--red)' : 'var(--green)' }}>
              {gap == null ? '–' : `${gap > 0 ? '+' : '−'}${Math.abs(gap).toFixed(3)}`}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {gap == null ? '' : gap > 0 ? `${dA?.code} behind ${dB?.code}` : `${dA?.code} ahead of ${dB?.code}`}
            </div>
            <div className="ghost-rows">
              <div>
                <span className="lap-pick-tag" style={{ background: dA?.colour }}>A</span> {dA?.code} {formatLapTime(trA.lap.duration)}
                <b className="num">{vA != null ? Math.round(vA) : ''}</b>
              </div>
              <div>
                <span className="lap-pick-tag ghost" style={{ borderColor: dB?.colour }}>B</span> {dB?.code} {formatLapTime(trB.lap.duration)}
                <b className="num">{vB != null ? Math.round(vB) : ''}</b>
              </div>
              <div className="dim" style={{ fontSize: 11 }}>speeds in km/h</div>
            </div>
            <table className="lr-table">
              <tbody>
                {(['s1', 's2', 's3'] as const).map((k, i) => {
                  const x = trA.lap[k];
                  const y = trB.lap[k];
                  const diff = x != null && y != null ? x - y : null;
                  return (
                    <tr key={k}>
                      <td className="dim">Sector {i + 1}</td>
                      <td className="num">{x?.toFixed(3) ?? '–'}</td>
                      <td className="num">{y?.toFixed(3) ?? '–'}</td>
                      <td className={'num ' + (diff == null ? '' : diff > 0 ? 'bad' : 'good')}>{diff == null ? '' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(3)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {trA && trB && (
        <>
          <div className="ghost-player">
            <button className="pb-btn primary" onClick={() => (g >= total ? (setG(0), setPlaying(true)) : setPlaying(!playing))}>
              {playing ? '❚❚' : '▶'}
            </button>
            <button className="pb-btn" onClick={() => (setG(0), setPlaying(false))} title="Back to the line">
              ⏮
            </button>
            <input type="range" min={0} max={total} step={50} value={g} onChange={(e) => (setPlaying(false), setG(Number(e.target.value)))} />
            <span className="num muted">{formatLapTime(g / 1000) || '0.000'}</span>
            <span className="speeds">
              {SPEEDS.map((s) => (
                <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </span>
          </div>
          <div style={{ padding: '0 10px 10px' }}>
            <div className="dim" style={{ fontSize: 11 }}>
              Gap around the lap ({dA?.code} − {dB?.code}): above zero, {dA?.code} is behind. Approximate mid-lap (±0.1 s); exact at the line and the sector splits.
            </div>
            <LineChart
              series={[{ id: 'd', label: 'gap', colour: dA?.colour ?? '#fff', values: curve, fill: true }]}
              xLabels={curve.map((_, i) => `${Math.round((i / 200) * 100)}%`)}
              xEvery={25}
              height={140}
              yFormat={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`}
            />
          </div>
        </>
      )}
    </Panel>
  );
}
