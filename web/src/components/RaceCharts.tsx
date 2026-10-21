// Lap-by-lap race charts: race trace (gap to leader), positions, and tyre wear.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import uPlot from 'uplot';
import type { Lap, SessionData } from '../data/session';
import { lastAtOrBefore, tower } from '../data/state';
import { useNow, useSynced } from '../hooks';
import { Panel } from './Panel';

// ---- shared helpers -----------------------------------------------------------

/** Team-mates share a colour: the second one gets a dashed line. */
function lineStyles(data: SessionData, order: number[]) {
  const seen = new Set<string>();
  const out = new Map<number, { colour: string; dash?: number[] }>();
  for (const n of order) {
    const colour = data.drivers.get(n)?.colour ?? '#888888';
    out.set(n, { colour, dash: seen.has(colour) ? [5, 4] : undefined });
    seen.add(colour);
  }
  return out;
}

/** Time each driver crossed the line at the end of each lap (index = lap number). */
function crossings(data: SessionData) {
  const out = new Map<number, (number | null)[]>();
  for (const [n, laps] of data.laps) {
    const arr: (number | null)[] = [];
    for (const l of laps) if (l.duration != null) arr[l.lap] = l.end;
    out.set(n, arr);
  }
  return out;
}

/** Laps the leader has completed by time `until`. */
function completedLaps(data: SessionData, until: number) {
  let n = 0;
  data.lapStartTimes.forEach((start, lap) => {
    if (start != null && lap > 0 && start <= until) n = Math.max(n, lap - 1);
  });
  return Math.min(n, data.meta.totalLaps);
}

const axisStyle = (label?: string, size = 36): uPlot.Axis => ({
  stroke: '#5b6676',
  grid: { stroke: '#ffffff0a' },
  ticks: { show: false },
  size,
  font: '10px Inter, system-ui',
  label,
  labelSize: label ? 12 : 0,
  labelFont: '10px Inter, system-ui',
});

/** Mount a uPlot chart into `host`, resizing with it. Returns a cleanup function. */
function mountChart(host: HTMLDivElement, opts: Omit<uPlot.Options, 'width' | 'height'>, values: uPlot.AlignedData) {
  host.innerHTML = '';
  const u = new uPlot({ ...opts, width: host.clientWidth, height: host.clientHeight } as uPlot.Options, values, host);
  const ro = new ResizeObserver(() => u.setSize({ width: host.clientWidth, height: host.clientHeight }));
  ro.observe(host);
  return () => {
    ro.disconnect();
    u.destroy();
  };
}

/** Draws each series' driver code at the end of its line. */
function endLabels(codes: string[], colours: string[]): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const ctx = u.ctx;
        ctx.save();
        ctx.font = `700 ${10 * devicePixelRatio}px Inter, system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        for (let s = 1; s < u.series.length; s++) {
          const ys = u.data[s] as (number | null)[];
          let i = ys.length - 1;
          while (i >= 0 && ys[i] == null) i--;
          if (i < 0 || !codes[s]) continue;
          const x = u.valToPos(u.data[0][i], 'x', true);
          const y = u.valToPos(ys[i]!, 'y', true);
          if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue;
          ctx.fillStyle = colours[s];
          ctx.fillText(codes[s], x + 4 * devicePixelRatio, y);
        }
        ctx.restore();
      },
    },
  };
}

function SpoilerToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="seg">
      <button className={!value ? 'on' : ''} onClick={() => onChange(false)} title="Only laps completed at this point in the replay">So far</button>
      <button className={value ? 'on' : ''} onClick={() => onChange(true)} title="The whole session (may spoil the replay)">Whole race</button>
    </span>
  );
}

function RaceOnly({ data, children }: { data: SessionData; children: ReactNode }) {
  if (data.meta.session.type !== 'Race') return <div className="center-msg">This chart is for races and sprints.</div>;
  return <>{children}</>;
}

// ---- race trace -----------------------------------------------------------------

export function RaceTrace({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const { selected } = useSynced();
  const [whole, setWhole] = useState(false);
  const laps = completedLaps(data, whole ? Infinity : t);
  const host = useRef<HTMLDivElement>(null);
  const order = useMemo(() => tower(data, whole ? Infinity : t).map((r) => r.driver), [data, whole, laps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!host.current || laps < 1) return;
    const cross = crossings(data);
    const x = Array.from({ length: laps }, (_, i) => i + 1);
    const leaderCross = x.map((n) => {
      let m = Infinity;
      for (const arr of cross.values()) if (arr[n] != null && arr[n]! < m) m = arr[n]!;
      return m;
    });
    const styles = lineStyles(data, order);
    const series: uPlot.Series[] = [{}];
    const values: (number | null)[][] = [];
    const codes = [''];
    const colours = [''];
    let topGap = 5;
    order.forEach((n, rank) => {
      const arr = cross.get(n) ?? [];
      const ys = x.map((lap, i) => (arr[lap] != null ? (arr[lap]! - leaderCross[i]) / 1000 : null));
      if (rank < 10) for (const y of ys) if (y != null && y < 200) topGap = Math.max(topGap, y);
      const st = styles.get(n)!;
      const sel = selected.includes(n);
      const dim = selected.length > 0 && !sel;
      series.push({ stroke: dim ? st.colour + '55' : st.colour, width: sel ? 2.6 : 1.4, dash: st.dash, spanGaps: false, points: { show: false } });
      values.push(ys);
      codes.push(data.drivers.get(n)?.code ?? '');
      colours.push(dim ? '#5b6676' : st.colour);
    });
    return mountChart(
      host.current,
      {
        legend: { show: false },
        cursor: { points: { show: false } },
        padding: [8, 34, 0, 0],
        scales: { x: { time: false }, y: { dir: -1, range: [0, topGap * 1.12] } },
        axes: [{ ...axisStyle('Lap', 30) }, axisStyle('Gap to leader (s)', 44)],
        series,
        plugins: [endLabels(codes, colours)],
      },
      [x, ...values],
    );
  }, [data, laps, order, selected]);

  return (
    <Panel title="Race trace" lead={lead} area={area} popout="/race-trace" extra={<SpoilerToggle value={whole} onChange={setWhole} />}>
      <RaceOnly data={data}>
        {laps < 1 ? <div className="center-msg">Appears once the first lap is complete.</div> : <div ref={host} className="chart-host" />}
      </RaceOnly>
    </Panel>
  );
}

// ---- positions ----------------------------------------------------------------------

export function PositionChart({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const { selected } = useSynced();
  const [whole, setWhole] = useState(false);
  const laps = completedLaps(data, whole ? Infinity : t);
  const host = useRef<HTMLDivElement>(null);
  const order = useMemo(() => tower(data, whole ? Infinity : t).map((r) => r.driver), [data, whole, laps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!host.current || laps < 1) return;
    const cross = crossings(data);
    const x = Array.from({ length: laps + 1 }, (_, i) => i); // lap 0 = the grid
    const grid = new Map(data.meta.grid);
    const styles = lineStyles(data, order);
    const series: uPlot.Series[] = [{}];
    const values: (number | null)[][] = [];
    const codes = [''];
    const colours = [''];
    for (const n of order) {
      const pos = data.positions.get(n);
      const arr = cross.get(n) ?? [];
      const at = (time: number) => (pos ? pos.v[Math.max(0, lastAtOrBefore(pos.t, time))] : null);
      const ys = x.map((lap) => {
        if (lap === 0) return grid.get(n) ?? at(data.meta.raceStart);
        return arr[lap] != null ? at(arr[lap]! + 500) : null;
      });
      const st = styles.get(n)!;
      const sel = selected.includes(n);
      const dim = selected.length > 0 && !sel;
      series.push({ stroke: dim ? st.colour + '55' : st.colour, width: sel ? 2.6 : 1.4, dash: st.dash, spanGaps: false, points: { show: false } });
      values.push(ys);
      codes.push(data.drivers.get(n)?.code ?? '');
      colours.push(dim ? '#5b6676' : st.colour);
    }
    const count = data.meta.drivers.length;
    return mountChart(
      host.current,
      {
        legend: { show: false },
        cursor: { points: { show: false } },
        padding: [8, 34, 0, 0],
        scales: { x: { time: false }, y: { dir: -1, range: [0.5, count + 0.5] } },
        axes: [
          { ...axisStyle('Lap', 30), values: (_u, v) => v.map((l) => (l === 0 ? 'Grid' : String(l))) },
          { ...axisStyle('Position', 36), splits: () => Array.from({ length: count }, (_, i) => i + 1).filter((p) => p === 1 || p % 5 === 0) },
        ],
        series,
        plugins: [endLabels(codes, colours)],
      },
      [x, ...values],
    );
  }, [data, laps, order, selected]);

  return (
    <Panel title="Positions" lead={lead} area={area} popout="/positions" extra={<SpoilerToggle value={whole} onChange={setWhole} />}>
      <RaceOnly data={data}>
        {laps < 1 ? <div className="center-msg">Appears once the first lap is complete.</div> : <div ref={host} className="chart-host" />}
      </RaceOnly>
    </Panel>
  );
}

// ---- tyre wear ------------------------------------------------------------------------

const COMPOUND_COLOUR: Record<string, string> = {
  SOFT: '#ff4d4d',
  MEDIUM: '#ffd23f',
  HARD: '#e9edf2',
  INTERMEDIATE: '#39c96b',
  WET: '#3f8cff',
};
/** Burning fuel makes a car roughly this much quicker each lap, which hides some tyre wear. */
const FUEL_EFFECT = 0.05;

interface StintPace {
  driver: number;
  stint: number;
  compound: string;
  laps: { lap: number; time: number }[];
  slope: number;
  intercept: number;
  average: number;
}

/** Clean racing laps per stint: no pit laps, no Safety Car or VSC, no big mistakes or traffic outliers. */
function stintPaces(data: SessionData, driver: number, until: number): StintPace[] {
  const laps = (data.laps.get(driver) ?? []).filter((l) => l.duration != null && l.end <= until && l.lap > 1 && !l.pitOut);
  const pits = data.pits.get(driver) ?? [];
  const neutralised = (l: Lap) =>
    data.trackStatus.some((s, i) => {
      const end = data.trackStatus[i + 1]?.t ?? Infinity;
      return ['SC', 'SC_ENDING', 'VSC', 'VSC_ENDING', 'RED'].includes(s.status) && s.t < l.end && end > l.t;
    });
  const clean = laps.filter((l) => !pits.some((p) => p.t >= l.t && p.t <= l.end + 5000) && !neutralised(l));
  const times = clean.map((l) => l.duration!).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] ?? 0;
  const ok = clean.filter((l) => l.duration! <= median * 1.07);
  const out: StintPace[] = [];
  for (const st of data.stints.get(driver) ?? []) {
    const pts = ok.filter((l) => l.lap >= st.lapStart && (st.lapEnd == null || l.lap <= st.lapEnd)).map((l) => ({ lap: l.lap, time: l.duration! }));
    if (pts.length < 3) continue;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.lap, 0) / n;
    const my = pts.reduce((s, p) => s + p.time, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.lap - mx) ** 2, 0);
    const slope = sxx ? pts.reduce((s, p) => s + (p.lap - mx) * (p.time - my), 0) / sxx : 0;
    out.push({ driver, stint: st.stint, compound: st.compound ?? 'UNKNOWN', laps: pts, slope, intercept: my - slope * mx, average: my });
  }
  return out;
}

export function TyreWear({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const { selected } = useSynced();
  const [whole, setWhole] = useState(false);
  const until = whole ? Infinity : t;
  const laps = completedLaps(data, until);
  const host = useRef<HTMLDivElement>(null);
  const drivers = useMemo(
    () => (selected.length ? selected : tower(data, until).slice(0, 3).map((r) => r.driver)),
    [data, selected, whole, laps], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const paces = useMemo(() => drivers.flatMap((n) => stintPaces(data, n, until)), [data, drivers, laps, whole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!host.current || paces.length === 0) return;
    const x = Array.from({ length: Math.max(laps, 2) }, (_, i) => i + 1);
    const series: uPlot.Series[] = [{}];
    const values: (number | null)[][] = [];
    const all = paces.flatMap((p) => p.laps.map((l) => l.time));
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    for (const p of paces) {
      const colour = data.drivers.get(p.driver)?.colour ?? '#888';
      const fill = COMPOUND_COLOUR[p.compound] ?? '#8a96a8';
      // the laps themselves: dots, filled in the tyre colour, outlined in the team colour
      series.push({ stroke: colour, fill, paths: () => null, points: { show: true, size: 7, width: 1.5, stroke: colour, fill } });
      values.push(x.map((lap) => p.laps.find((l) => l.lap === lap)?.time ?? null));
      // the trend through that stint
      const first = p.laps[0].lap;
      const last = p.laps[p.laps.length - 1].lap;
      series.push({ stroke: colour, width: 1.5, dash: [4, 3], spanGaps: true, points: { show: false } });
      values.push(x.map((lap) => (lap === first || lap === last ? p.intercept + p.slope * lap : null)));
    }
    return mountChart(
      host.current,
      {
        legend: { show: false },
        cursor: { points: { show: false } },
        padding: [8, 12, 0, 0],
        scales: { x: { time: false, range: [0.5, x.length + 0.5] }, y: { range: [lo - 0.4, hi + 0.4] } },
        axes: [axisStyle('Lap', 30), { ...axisStyle('Lap time (s)', 50), values: (_u, v) => v.map((s) => s.toFixed(1)) }],
        series,
      },
      [x, ...values],
    );
  }, [data, paces, laps]);

  return (
    <Panel title="Tyre wear" lead={lead} area={area} popout="/tyre-wear" extra={<SpoilerToggle value={whole} onChange={setWhole} />}>
      <RaceOnly data={data}>
        {paces.length === 0 ? (
          <div className="center-msg">Needs a few clean laps on a set of tyres. Select drivers in the tower to compare them.</div>
        ) : (
          <div className="wear">
            <div ref={host} className="chart-host" />
            <div className="wear-table-wrap">
            <table className="compare-table wear-table">
              <thead>
                <tr>
                  <th className="l">Driver</th>
                  <th className="l">Tyre</th>
                  <th>Laps</th>
                  <th>Avg lap</th>
                  <th title="Seconds lost per lap from tyre wear, allowing for the car getting lighter as fuel burns">Wear / lap</th>
                </tr>
              </thead>
              <tbody>
                {paces.map((p) => (
                  <tr key={p.driver + ':' + p.stint}>
                    <td className="l">
                      <span className="drv"><span className="team-bar" style={{ background: data.drivers.get(p.driver)?.colour }} />{data.drivers.get(p.driver)?.code}</span>
                    </td>
                    <td className="l"><span className={`tyre tyre-${p.compound}`}><span>{p.compound[0]}</span></span></td>
                    <td className="num muted">{p.laps[0].lap}–{p.laps[p.laps.length - 1].lap}</td>
                    <td className="num">{p.average.toFixed(3)}</td>
                    <td className="num"><b>{(p.slope + FUEL_EFFECT >= 0 ? '+' : '') + (p.slope + FUEL_EFFECT).toFixed(3)} s</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="dim" style={{ fontSize: 11, padding: '4px 8px' }}>
              Clean laps only (no pit, Safety Car or slow laps). Wear allows ~{FUEL_EFFECT} s/lap for fuel burning off.
            </div>
          </div>
        )}
      </RaceOnly>
    </Panel>
  );
}

