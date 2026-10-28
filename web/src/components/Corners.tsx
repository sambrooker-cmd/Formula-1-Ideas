// Corner by corner: how two laps compare at every corner (slowest speed, where braking started,
// exit speed), and who carries the most speed through each corner across the field.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { cornerStats, fastestLap, lapTrace, mergeCorners, type CornerStats } from '../data/laptrace';
import { cornersForSession } from '../data/circuit';
import { Panel } from './Panel';
import { LapSelect, useLapPair } from './LapPicker';

type Corner = { number: string; x: number; y: number };

export function Corners({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const [raw, setRaw] = useState<Corner[] | null | undefined>(undefined);
  const [view, setView] = useState<'pair' | 'field'>('pair');
  const { a, b, setA, setB, trA, trB } = useLapPair(data);

  useEffect(() => {
    setRaw(undefined);
    cornersForSession(data.meta).then(setRaw, () => setRaw(null));
  }, [data]);

  const corners = useMemo(() => (raw && trA ? mergeCorners(data, trA, raw) : []), [data, raw, trA]);
  const sa = useMemo(() => (trA ? cornerStats(data, trA, corners) : []), [data, trA, corners]);
  const sb = useMemo(() => (trB ? cornerStats(data, trB, corners) : []), [data, trB, corners]);

  // Field view: every driver's fastest lap, quickest through each corner.
  const field = useMemo(() => {
    if (view !== 'field' || !corners.length) return [];
    const rows: { n: number; stats: (CornerStats | null)[] }[] = [];
    for (const n of data.driverOrder) {
      const l = fastestLap(data, n);
      const tr = l ? lapTrace(data, n, l) : null;
      if (tr) rows.push({ n, stats: cornerStats(data, tr, corners) });
    }
    return corners.map((c, i) => {
      // A reading far from the field's typical speed means that lap's position and speed data are out
      // of step there (it happens on some laps); leave it out rather than show nonsense.
      const speeds = rows.map((r) => r.stats[i]?.minSpeed).filter((v): v is number => v != null).sort((x, y) => x - y);
      const median = speeds[Math.floor(speeds.length / 2)] ?? 0;
      const ranked = rows.filter((r) => r.stats[i] && Math.abs(r.stats[i]!.minSpeed - median) < Math.max(25, median * 0.2)).sort((x, y) => y.stats[i]!.minSpeed - x.stats[i]!.minSpeed || y.stats[i]!.exitSpeed - x.stats[i]!.exitSpeed);
      return { corner: c.number, ranked: ranked.map((r) => ({ n: r.n, s: r.stats[i]! })) };
    });
  }, [view, corners, data]);

  const code = (n: number) => data.drivers.get(n)?.code ?? '';
  const colour = (n: number) => data.drivers.get(n)?.colour ?? '#888';
  const cmp = (x: number | null | undefined, y: number | null | undefined, higherBetter: boolean) =>
    x == null || y == null || x === y ? '' : (x > y) === higherBetter ? 'good' : 'bad';

  return (
    <Panel
      title="Corners"
      lead={lead}
      area={area}
      popout="/corners"
      bodyClass="scroll"
      extra={
        <span className="seg">
          <button className={view === 'pair' ? 'on' : ''} onClick={() => setView('pair')}>Two laps</button>
          <button className={view === 'field' ? 'on' : ''} onClick={() => setView('field')}>Whole field</button>
        </span>
      }
    >
      {raw === undefined && <div className="center-msg static">Loading corner positions…</div>}
      {raw === null && <div className="center-msg static">Corner positions aren't available for this circuit (they come from MultiViewer, via OpenF1).</div>}
      {raw && view === 'pair' && (
        <>
          <div className="moment-filters">
            <LapSelect data={data} value={a} onChange={setA} tag="A" />
            <span className="dim">vs</span>
            <LapSelect data={data} value={b} onChange={setB} tag="B" />
          </div>
          {trA && trB ? (
            <table className="lr-table corner-table">
              <thead>
                <tr>
                  <th>Corner</th>
                  <th colSpan={2}>Slowest point (km/h)</th>
                  <th colSpan={2} title="How far before the slowest point the driver started braking">Braked (m before)</th>
                  <th colSpan={2}>Exit (km/h)</th>
                </tr>
                <tr className="dim">
                  <th />
                  {[0, 1, 2].map((k) => [
                    <th key={k + 'a'}>{code(a.driver)}</th>,
                    <th key={k + 'b'}>{code(b.driver)}</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {corners.map((c, i) => {
                  const x = sa[i];
                  const y = sb[i];
                  return (
                    <tr key={c.number}>
                      <td>
                        <b>T{c.number}</b>
                      </td>
                      <td className={'num ' + cmp(x?.minSpeed, y?.minSpeed, true)}>{x?.minSpeed ?? '–'}</td>
                      <td className="num muted">{y?.minSpeed ?? '–'}</td>
                      <td className={'num ' + cmp(x?.brakeBefore, y?.brakeBefore, false)}>{x ? (x.brakeBefore ?? 'flat') : '–'}</td>
                      <td className="num muted">{y ? (y.brakeBefore ?? 'flat') : '–'}</td>
                      <td className={'num ' + cmp(x?.exitSpeed, y?.exitSpeed, true)}>{x ? Math.round(x.exitSpeed) : '–'}</td>
                      <td className="num muted">{y ? Math.round(y.exitSpeed) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="center-msg static">Pick two timed laps with car data.</div>
          )}
        </>
      )}
      {raw && view === 'field' && (
        <table className="lr-table corner-table">
          <thead>
            <tr>
              <th>Corner</th>
              <th>Highest speed at the slowest point (each driver's fastest lap, km/h)</th>
            </tr>
          </thead>
          <tbody>
            {field.map((f) => (
              <tr key={f.corner}>
                <td>
                  <b>T{f.corner}</b>
                </td>
                <td className="corner-field">
                  {f.ranked.slice(0, 6).map((r) => (
                    <span key={r.n} className="corner-chip" title={`${code(r.n)}: slowest ${r.s.minSpeed} km/h, exit ${Math.round(r.s.exitSpeed)} km/h`}>
                      <i style={{ background: colour(r.n) }} />
                      {code(r.n)}
                      <span className="dim"> {r.s.minSpeed}</span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
        Car data arrives about four times a second, so speeds are within a few km/h and braking points within roughly ±20 m. Green means A is better. Corner
        times aren't shown: OpenF1's timestamps aren't precise enough between cars to time a single corner fairly.
      </div>
    </Panel>
  );
}
