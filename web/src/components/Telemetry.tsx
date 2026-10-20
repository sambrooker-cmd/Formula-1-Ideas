import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { DriverSamples, SessionData } from '../data/session';
import { carSampleIndex, currentLap, lastAtOrBefore, tower } from '../data/state';
import { clock, getState, now } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Panel } from './Panel';

const CHANNELS = [
  { key: 'speed', label: 'Speed km/h', range: [0, 360] as [number, number] },
  { key: 'throttle', label: 'Throttle %', range: [0, 100] as [number, number] },
  { key: 'brake', label: 'Brake', range: [0, 100] as [number, number] },
  { key: 'gear', label: 'Gear', range: [0, 8] as [number, number] },
] as const;
type Channel = (typeof CHANNELS)[number]['key'];

const STEP_M = 5;

/** Distance into the lap (m) for a driver at time t, using integrated speed. */
function lapDistance(s: DriverSamples, lapStart: number, t: number) {
  const i0 = Math.max(0, carSampleIndex(s, lapStart));
  const i = carSampleIndex(s, t);
  if (i < 0) return 0;
  return s.dist[i] - s.dist[i0];
}

/** Resample one driver's lap onto a fixed distance grid. */
function lapTrace(s: DriverSamples, start: number, end: number, grid: number) {
  const i0 = Math.max(0, carSampleIndex(s, start));
  const i1 = Math.max(i0, lastAtOrBefore(s.carT, end));
  const out: Record<Channel, (number | null)[]> = { speed: [], throttle: [], brake: [], gear: [] };
  let j = i0;
  for (let g = 0; g < grid; g++) {
    const d = g * STEP_M;
    while (j < i1 && s.dist[j + 1] - s.dist[i0] < d) j++;
    if (j >= i1) {
      for (const c of CHANNELS) out[c.key].push(null);
      continue;
    }
    out.speed.push(s.speed[j]);
    out.throttle.push(Math.min(100, s.throttle[j]));
    out.brake.push(s.brake[j] > 0 ? 100 : 0);
    out.gear.push(s.gear[j]);
  }
  return { out, length: s.dist[i1] - s.dist[i0] };
}

export function Telemetry({ data, area }: { data: SessionData; area?: string }) {
  const t = useNow(8);
  const { selected } = useSynced();
  const leader = useMemo(() => tower(data, t)[0]?.driver, [data, Math.floor(t / 5000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const drivers = (selected.length ? selected : leader != null ? [leader] : []).filter((n) => data.samples.has(n));
  const primary = drivers[0];
  const lap = primary != null ? currentLap(data, primary, t) : null;
  const key = `${drivers.join(',')}|${lap?.lap}`;

  const chartsRef = useRef<HTMLDivElement>(null);
  const plots = useRef<{ u: uPlot; marker: HTMLDivElement; marker2: HTMLDivElement }[]>([]);

  // (Re)build the charts whenever the drivers or the primary driver's lap changes.
  useEffect(() => {
    const host = chartsRef.current;
    if (!host || primary == null || !lap) return;
    const traces = drivers.map((n) => {
      const l = data.laps.get(n)?.find((x) => x.lap === lap.lap);
      return l ? { n, ...lapTrace(data.samples.get(n)!, l.t, l.end, 0) } : null;
    });
    const maxLen = Math.max(...traces.map((tr) => tr?.length ?? 0), 1000);
    const grid = Math.ceil(maxLen / STEP_M) + 1;
    const xs = Array.from({ length: grid }, (_, i) => i * STEP_M);
    const full = drivers.map((n) => {
      const l = data.laps.get(n)?.find((x) => x.lap === lap.lap);
      return l ? lapTrace(data.samples.get(n)!, l.t, l.end, grid).out : null;
    });

    const rows = [...host.querySelectorAll<HTMLDivElement>('.chart')];
    plots.current = CHANNELS.map((c, ci) => {
      const el = rows[ci];
      el.innerHTML = '';
      const series: uPlot.Series[] = [{}];
      const values: (number | null)[][] = [];
      drivers.forEach((n, di) => {
        if (!full[di]) return;
        series.push({
          label: data.drivers.get(n)!.code,
          stroke: di === 0 ? data.drivers.get(n)!.colour : '#e8edf3',
          width: di === 0 ? 1.6 : 1.2,
          dash: di === 0 ? undefined : [4, 3],
          paths: c.key === 'gear' || c.key === 'brake' ? uPlot.paths.stepped!({ align: 1 }) : undefined,
        });
        values.push(full[di]![c.key]);
      });
      const u = new uPlot(
        {
          width: el.clientWidth,
          height: el.clientHeight,
          legend: { show: false },
          cursor: { sync: { key: 'tele' }, points: { show: false } },
          scales: { x: { time: false }, y: { range: c.range } },
          axes: [
            {
              show: ci === CHANNELS.length - 1,
              stroke: '#5b6676',
              grid: { stroke: '#ffffff0a' },
              ticks: { stroke: '#ffffff12' },
              values: (_u, v) => v.map((m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'k' : String(m))),
              size: 22,
              font: '10px Inter, system-ui',
            },
            {
              stroke: '#5b6676',
              grid: { stroke: '#ffffff0a' },
              ticks: { show: false },
              size: 40,
              font: '10px Inter, system-ui',
              label: c.label,
              labelSize: 12,
              labelFont: '10px Inter, system-ui',
              splits: c.key === 'gear' ? [2, 4, 6, 8] : c.key === 'brake' ? [0, 100] : undefined,
            },
          ],
          series,
        },
        [xs, ...values] as uPlot.AlignedData,
        el,
      );
      const mk = () => {
        const m = document.createElement('div');
        m.className = 'now-line';
        u.over.appendChild(m);
        return m;
      };
      const marker = mk();
      const marker2 = mk();
      marker2.style.borderLeftColor = '#ffffff55';
      return { u, marker, marker2 };
    });

    const ro = new ResizeObserver(() => {
      plots.current.forEach(({ u }, i) => u.setSize({ width: rows[i].clientWidth, height: rows[i].clientHeight }));
    });
    rows.forEach((r) => ro.observe(r));

    // Move the "now" markers every frame.
    let raf = 0;
    const tick = () => {
      const tt = now();
      const px = (n: number | undefined) => {
        if (n == null) return null;
        const l = data.laps.get(n)?.find((x) => x.lap === lap.lap);
        if (!l || tt < l.t || tt > l.end) return null;
        return lapDistance(data.samples.get(n)!, l.t, tt);
      };
      const d1 = px(drivers[0]);
      const d2 = px(drivers[1]);
      for (const { u, marker, marker2 } of plots.current) {
        marker.style.display = d1 == null ? 'none' : 'block';
        if (d1 != null) marker.style.left = u.valToPos(d1, 'x') + 'px';
        marker2.style.display = d2 == null ? 'none' : 'block';
        if (d2 != null) marker2.style.left = u.valToPos(d2, 'x') + 'px';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      plots.current.forEach(({ u }) => u.destroy());
      plots.current = [];
    };
  }, [key, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = data.driverOrder.map((n) => data.drivers.get(n)!);
  const setDriver = (slot: 0 | 1, value: string) => {
    const cur = getState().selected.length ? [...getState().selected] : leader != null ? [leader] : [];
    const n = value === '' ? null : Number(value);
    const next = slot === 0 ? [n ?? cur[0], cur[1]] : [cur[0], n];
    clock.setSelected([...new Set(next.filter((x): x is number => x != null))]);
  };

  return (
    <Panel
      title="Telemetry"
      area={area}
      popout="/telemetry"
      extra={
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
          <select className="lap-jump" style={{ height: 24 }} value={drivers[0] ?? ''} onChange={(e) => setDriver(0, e.target.value)}>
            {options.map((d) => (
              <option key={d.number} value={d.number}>
                {d.code}
              </option>
            ))}
          </select>
          vs
          <select className="lap-jump" style={{ height: 24 }} value={drivers[1] ?? ''} onChange={(e) => setDriver(1, e.target.value)}>
            <option value="">—</option>
            {options
              .filter((d) => d.number !== drivers[0])
              .map((d) => (
                <option key={d.number} value={d.number}>
                  {d.code}
                </option>
              ))}
          </select>
          {lap && <span className="muted">· lap {lap.lap}</span>}
        </span>
      }
    >
      <div className="tele">
        <div className="tele-side">
          {drivers.map((n) => (
            <LiveCard key={n} data={data} driver={n} t={t} />
          ))}
          {drivers.length < 2 && <div className="dim" style={{ fontSize: 11 }}>Tip: click a second driver in the tower or on the map to compare.</div>}
        </div>
        <div className="tele-charts" ref={chartsRef}>
          {CHANNELS.map((c) => (
            <div key={c.key} className="chart" style={{ flex: c.key === 'speed' ? 1.6 : c.key === 'gear' ? 1.15 : 0.8 }} />
          ))}
          {!lap && <div className="center-msg" style={{ position: 'absolute', inset: 0 }}>No lap data at this moment</div>}
        </div>
      </div>
    </Panel>
  );
}

function LiveCard({ data, driver, t }: { data: SessionData; driver: number; t: number }) {
  const d = data.drivers.get(driver)!;
  const s = data.samples.get(driver)!;
  const i = carSampleIndex(s, t);
  if (i < 0) return null;
  const drs = s.drs[i];
  const drsOpen = drs !== 255 && drs >= 10;
  return (
    <div className="tele-card" style={{ borderLeftColor: d.colour }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b>{d.code}</b>
        <span className="muted" style={{ fontSize: 11 }}>
          {drs !== 255 && <span style={{ color: drsOpen ? 'var(--green)' : 'var(--dim)', fontWeight: 700, marginRight: 6 }}>DRS</span>}
          G{s.gear[i]}
        </span>
      </div>
      <div className="big">
        {s.speed[i]}
        <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> km/h</span>
      </div>
      <div className="muted num" style={{ fontSize: 11 }}>{s.rpm[i].toLocaleString()} rpm</div>
      <div className="bar">
        <i style={{ width: Math.min(100, s.throttle[i]) + '%', background: 'var(--green)' }} />
      </div>
      <div className="bar">
        <i style={{ width: (s.brake[i] > 0 ? 100 : 0) + '%', background: 'var(--red)' }} />
      </div>
    </div>
  );
}
