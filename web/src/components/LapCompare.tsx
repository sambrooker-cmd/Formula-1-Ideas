import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import uPlot from 'uplot';
import type { Lap, SessionData } from '../data/session';
import { carPosition, carSampleIndex, formatLapTime, lastAtOrBefore } from '../data/state';
import { clock } from '../sync/clock';
import { useElementSize, useNow, useSynced } from '../hooks';
import { Panel } from './Panel';
import { fitTransform } from './TrackMap';

interface Profile {
  driver: number;
  lap: Lap;
  /** Lap length in metres (integrated from speed). */
  length: number;
  /** Per car sample: distance into the lap (m), time into the lap (s), speed (km/h). */
  d: number[];
  t: number[];
  speed: number[];
  /** Position samples with their fraction of the lap (0–1). */
  path: { x: number; y: number; f: number }[];
}

/** Fastest clean lap that has finished by `until` (Infinity = whole session). */
function fastestLap(data: SessionData, driver: number, until: number): Lap | null {
  let best: Lap | null = null;
  for (const l of data.laps.get(driver) ?? []) {
    if (l.duration == null || l.pitOut || l.lap < 2 || l.end > until) continue;
    if (!best || l.duration < best.duration!) best = l;
  }
  return best;
}

function buildProfile(data: SessionData, driver: number, lap: Lap): Profile | null {
  const s = data.samples.get(driver);
  if (!s) return null;
  const i0 = Math.max(0, carSampleIndex(s, lap.t));
  const i1 = lastAtOrBefore(s.carT, lap.end);
  if (i1 - i0 < 20) return null;
  const d0 = s.dist[i0];
  const length = s.dist[i1] - d0;
  const d: number[] = [];
  const t: number[] = [];
  const speed: number[] = [];
  for (let i = i0; i <= i1; i++) {
    d.push(s.dist[i] - d0);
    t.push((s.carT[i] - lap.t) / 1000);
    speed.push(s.speed[i]);
  }
  const path: Profile['path'] = [];
  for (let k = Math.max(0, lastAtOrBefore(s.locT, lap.t)); k < s.locT.length && s.locT[k] <= lap.end; k++) {
    const ci = carSampleIndex(s, s.locT[k]);
    if (ci < i0) continue;
    path.push({ x: s.locX[k], y: s.locY[k], f: Math.min(1, (s.dist[ci] - d0) / length) });
  }
  return { driver, lap, length, d, t, speed, path };
}

/** Linear interpolation of ys at x in a sorted xs. */
function interp(xs: number[], ys: number[], x: number) {
  let lo = 0;
  let hi = xs.length - 1;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[hi]) return ys[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

const timeAt = (p: Profile, f: number) => interp(p.d, p.t, f * p.length);
const speedAt = (p: Profile, f: number) => interp(p.d, p.speed, f * p.length);

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Second driver's colour: their team colour, unless it's too close to the first (team-mates). */
function contrastColour(a: string, b: string) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 90 ? '#e8edf3' : b;
}

const SEGMENTS = 36;
const GRID = 400;

export function LapCompare({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const { selected } = useSynced();
  const [wholeSession, setWholeSession] = useState(false);
  const until = wholeSession ? Infinity : t;

  // Default pair: the two fastest drivers so far.
  const ranking = useMemo(() => {
    const out: { n: number; lap: Lap }[] = [];
    for (const n of data.driverOrder) {
      const l = fastestLap(data, n, until);
      if (l) out.push({ n, lap: l });
    }
    return out.sort((a, b) => a.lap.duration! - b.lap.duration!);
  }, [data, data.version, Math.floor(until / 10_000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pair = (selected.length === 2 ? selected : [selected[0] ?? ranking[0]?.n, selected.length ? ranking.find((r) => r.n !== selected[0])?.n : ranking[1]?.n])
    .filter((n): n is number => n != null);
  const [aN, bN] = pair;
  const lapA = aN != null ? fastestLap(data, aN, until) : null;
  const lapB = bN != null ? fastestLap(data, bN, until) : null;

  const profiles = useMemo(() => {
    const a = aN != null && lapA ? buildProfile(data, aN, lapA) : null;
    const b = bN != null && lapB ? buildProfile(data, bN, lapB) : null;
    return a && b ? { a, b } : null;
  }, [data, aN, bN, lapA?.lap, lapB?.lap]); // eslint-disable-line react-hooks/exhaustive-deps

  const colA = aN != null ? data.drivers.get(aN)!.colour : '#888';
  const colB = bN != null ? contrastColour(colA, data.drivers.get(bN)!.colour) : '#888';

  const setDriver = (slot: 0 | 1, n: number) => {
    const next = [...pair];
    next[slot] = n;
    clock.setSelected([...new Set(next)]);
  };

  const options = data.driverOrder.map((n) => data.drivers.get(n)!);
  const header = (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0, flexWrap: 'wrap' }}>
      <select className="lap-jump" style={{ height: 24 }} value={aN ?? ''} onChange={(e) => setDriver(0, Number(e.target.value))}>
        {options.map((d) => <option key={d.number} value={d.number}>{d.code}</option>)}
      </select>
      vs
      <select className="lap-jump" style={{ height: 24 }} value={bN ?? ''} onChange={(e) => setDriver(1, Number(e.target.value))}>
        {options.filter((d) => d.number !== aN).map((d) => <option key={d.number} value={d.number}>{d.code}</option>)}
      </select>
      <span className="seg">
        <button className={!wholeSession ? 'on' : ''} onClick={() => setWholeSession(false)} title="Only laps already driven at this point in the replay">So far</button>
        <button className={wholeSession ? 'on' : ''} onClick={() => setWholeSession(true)} title="Best laps of the whole session (may spoil the replay)">Whole session</button>
      </span>
    </span>
  );

  return (
    <Panel title="Fastest laps" lead={lead} area={area} popout="/compare" extra={header}>
      {!profiles ? (
        <div className="center-msg">
          Needs a completed clean lap from both drivers{wholeSession ? '' : ' so far'}. Pick two drivers, or switch to "Whole session".
        </div>
      ) : (
        <CompareBody data={data} a={profiles.a} b={profiles.b} colA={colA} colB={colB} />
      )}
    </Panel>
  );
}

function CompareBody({ data, a, b, colA, colB }: { data: SessionData; a: Profile; b: Profile; colA: string; colB: string }) {
  const codeA = data.drivers.get(a.driver)!.code;
  const codeB = data.drivers.get(b.driver)!.code;

  // Fractions along the lap, and B's time gap to A at each (positive = B behind).
  const series = useMemo(() => {
    const f = Array.from({ length: GRID + 1 }, (_, i) => i / GRID);
    return {
      x: f.map((v) => Math.round(v * a.length)),
      speedA: f.map((v) => speedAt(a, v)),
      speedB: f.map((v) => speedAt(b, v)),
      delta: f.map((v) => timeAt(b, v) - timeAt(a, v)),
    };
  }, [a, b]);

  const segments = useMemo(
    () =>
      Array.from({ length: SEGMENTS }, (_, i) => {
        const f0 = i / SEGMENTS;
        const f1 = (i + 1) / SEGMENTS;
        const ta = timeAt(a, f1) - timeAt(a, f0);
        const tb = timeAt(b, f1) - timeAt(b, f0);
        return { f0, f1, winner: ta <= tb ? 'a' : 'b', margin: Math.abs(ta - tb) };
      }),
    [a, b],
  );
  const share = segments.filter((s) => s.winner === 'a').length / SEGMENTS;

  const rows = [
    { p: a, code: codeA, col: colA },
    { p: b, code: codeB, col: colB },
  ];
  const sectorBest = (k: 's1' | 's2' | 's3') => Math.min(a.lap[k] ?? Infinity, b.lap[k] ?? Infinity);
  const gap = b.lap.duration! - a.lap.duration!;

  return (
    <div className="compare">
      <CompareMap data={data} a={a} b={b} colA={colA} colB={colB} segments={segments} />
      <div className="compare-side">
        <table className="compare-table">
          <thead>
            <tr>
              <th className="l">Driver</th>
              <th>Lap</th>
              <th>Time</th>
              <th>S1</th>
              <th>S2</th>
              <th>S3</th>
              <th>Top</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, code, col }) => (
              <tr key={p.driver}>
                <td className="l">
                  <span className="drv"><span className="team-bar" style={{ background: col }} />{code}</span>
                </td>
                <td className="num muted">{p.lap.lap}</td>
                <td className="num"><b>{formatLapTime(p.lap.duration)}</b></td>
                {(['s1', 's2', 's3'] as const).map((k) => (
                  <td key={k} className={'num ' + (p.lap[k] != null && p.lap[k] === sectorBest(k) ? 'purple' : '')}>
                    {p.lap[k]?.toFixed(3) ?? '–'}
                  </td>
                ))}
                <td className="num muted">{Math.max(...p.speed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="compare-verdict">
          <b style={{ color: gap >= 0 ? colA : colB }}>{gap >= 0 ? codeA : codeB}</b> quicker by{' '}
          <b className="num">{Math.abs(gap).toFixed(3)} s</b>
          <span className="muted">
            {' '}· faster through {Math.round(share * 100)}% / {Math.round((1 - share) * 100)}% of the lap
          </span>
        </div>
        <CompareCharts series={series} colA={colA} colB={colB} codeA={codeA} codeB={codeB} />
      </div>
    </div>
  );
}

/** Circuit coloured by who was quicker through each stretch, plus a head-to-head replay of the two laps. */
function CompareMap(props: { data: SessionData; a: Profile; b: Profile; colA: string; colB: string; segments: { f0: number; f1: number; winner: string }[] }) {
  const { data, a, b, colA, colB, segments } = props;
  const [ref, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [racing, setRacing] = useState(false);
  const [raceSpeed, setRaceSpeed] = useState(1);
  const toScreen = useMemo(
    () => fitTransform(a.path.map((p) => [p.x, p.y] as [number, number]), size.width, size.height, null, { x: 24, top: 24, bottom: 40 }),
    [a, size.width, size.height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !toScreen) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d')!;
    const started = performance.now();
    const sa = data.samples.get(a.driver)!;
    const sb = data.samples.get(b.driver)!;
    let raf = 0;

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // base track
      ctx.strokeStyle = '#1b222d';
      ctx.lineWidth = 12;
      ctx.beginPath();
      a.path.forEach((p, i) => {
        const [x, y] = toScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      // who was quicker where
      ctx.lineWidth = 5;
      for (const seg of segments) {
        ctx.strokeStyle = seg.winner === 'a' ? colA : colB;
        ctx.beginPath();
        // Start from the last point before the stretch and end on the first point after it, so stretches join up.
        const first = Math.max(0, a.path.findIndex((p) => p.f >= seg.f0) - 1);
        let last = a.path.findIndex((p) => p.f > seg.f1);
        if (last < 0) last = a.path.length - 1;
        for (let i = first; i <= last; i++) {
          const [x, y] = toScreen(a.path[i].x, a.path[i].y);
          if (i === first) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // start/finish
      const [sx, sy] = toScreen(a.path[0].x, a.path[0].y);
      ctx.fillStyle = '#e8edf3';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();

      if (racing) {
        const tau = ((performance.now() - started) / 1000) * raceSpeed;
        const longest = Math.max(a.lap.duration!, b.lap.duration!);
        for (const [s, lap, col] of [[sa, a.lap, colA], [sb, b.lap, colB]] as const) {
          const pos = carPosition(s, lap.t + Math.min(tau, lap.duration!) * 1000);
          if (!pos) continue;
          const [x, y] = toScreen(pos.x, pos.y);
          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#07090d';
          ctx.stroke();
        }
        ctx.fillStyle = '#e8edf3';
        ctx.font = '600 12px ui-monospace, Menlo, monospace';
        ctx.fillText(`${Math.min(tau, longest).toFixed(1)} s`, 10, size.height - 12);
        if (tau > longest + 1.5) {
          setRacing(false);
          return;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, a, b, colA, colB, segments, toScreen, size.width, size.height, racing, raceSpeed]);

  return (
    <div className="compare-map">
      <div ref={ref} style={{ position: 'absolute', inset: 0 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div className="compare-map-bar">
        <button className="btn" onClick={() => setRacing(!racing)}>{racing ? '■ Stop' : '▶ Race the two laps'}</button>
        <select className="lap-jump" style={{ height: 30 }} value={raceSpeed} onChange={(e) => setRaceSpeed(Number(e.target.value))} aria-label="Race speed">
          {[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>
    </div>
  );
}

function CompareCharts(props: { series: { x: number[]; speedA: number[]; speedB: number[]; delta: number[] }; colA: string; colB: string; codeA: string; codeB: string }) {
  const { series, colA, colB, codeA, codeB } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const [speedEl, deltaEl] = [...host.querySelectorAll<HTMLDivElement>('.chart')];
    const axis = (label: string, show = true): uPlot.Axis => ({
      show,
      stroke: '#5b6676',
      grid: { stroke: '#ffffff0a' },
      ticks: { show: false },
      size: 40,
      font: '10px Inter, system-ui',
      label,
      labelSize: 12,
      labelFont: '10px Inter, system-ui',
    });
    const xAxis = (show: boolean): uPlot.Axis => ({
      show,
      stroke: '#5b6676',
      grid: { stroke: '#ffffff0a' },
      ticks: { stroke: '#ffffff12' },
      size: 22,
      font: '10px Inter, system-ui',
      values: (_u, v) => v.map((m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'k' : String(m))),
    });
    const common = { legend: { show: false }, cursor: { sync: { key: 'cmp' }, points: { show: false } } };
    const speed = new uPlot(
      {
        ...common,
        width: speedEl.clientWidth,
        height: speedEl.clientHeight,
        scales: { x: { time: false }, y: { range: [0, 360] } },
        axes: [xAxis(false), axis('Speed km/h')],
        series: [{}, { stroke: colA, width: 1.5, label: codeA }, { stroke: colB, width: 1.2, dash: [4, 3], label: codeB }],
      },
      [series.x, series.speedA, series.speedB],
      speedEl,
    );
    const maxAbs = Math.max(0.2, ...series.delta.map(Math.abs));
    const delta = new uPlot(
      {
        ...common,
        width: deltaEl.clientWidth,
        height: deltaEl.clientHeight,
        scales: { x: { time: false }, y: { range: [-maxAbs * 1.1, maxAbs * 1.1] } },
        axes: [xAxis(true), axis(`Gap s (+ = ${codeB} behind)`)],
        series: [{}, { stroke: '#e8edf3', width: 1.5, fill: '#ffffff14' }],
      },
      [series.x, series.delta],
      deltaEl,
    );
    const ro = new ResizeObserver(() => {
      speed.setSize({ width: speedEl.clientWidth, height: speedEl.clientHeight });
      delta.setSize({ width: deltaEl.clientWidth, height: deltaEl.clientHeight });
    });
    ro.observe(speedEl);
    ro.observe(deltaEl);
    return () => {
      ro.disconnect();
      speed.destroy();
      delta.destroy();
    };
  }, [series, colA, colB, codeA, codeB]);
  return (
    <div className="compare-charts" ref={hostRef}>
      <div className="chart" style={{ flex: 1.3 }} />
      <div className="chart" style={{ flex: 1 }} />
    </div>
  );
}
