// Long-run pace: practice race simulations (or race stints) ranked by average lap time, per compound.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { longRuns, paceTable, teamPace, type LongRun } from '../data/longruns';
import { formatLapTime } from '../data/state';
import { useElementSize, useNow } from '../hooks';
import { clock } from '../sync/clock';
import { Panel } from './Panel';
import { SpoilerToggle } from './RaceCharts';
import { Tyre } from './TimingTower';

const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

export function LongRuns({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const [whole, setWhole] = useState(false);
  const [compound, setCompound] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[] | null>(null);
  const race = data.meta.session.type === 'Race';
  const until = whole ? Infinity : t;
  const lapsDone = useMemo(() => {
    let c = 0;
    for (const laps of data.laps.values()) for (const l of laps) if (l.end <= until) c++;
    return c;
  }, [data, data.version, until]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = useMemo(() => longRuns(data, until), [data, lapsDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const present = COMPOUNDS.filter((c) => runs.some((r) => r.compound === c));
  const rows = paceTable(runs, compound);
  const teams = teamPace(data, rows);
  const shown = picked ?? rows.slice(0, 4).map((r) => r.driver);
  const toggle = (n: number) => setPicked(shown.includes(n) ? shown.filter((x) => x !== n) : [...shown, n]);
  const fastest = rows[0]?.run.average;
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);

  return (
    <Panel
      title={race ? 'Stint pace' : 'Long runs'}
      lead={lead}
      area={area}
      popout="/long-runs"
      bodyClass="scroll"
      extra={<SpoilerToggle value={whole} onChange={setWhole} label={race ? 'Whole race' : 'Whole session'} />}
    >
      <div className="moment-filters">
        <button className={'chip' + (compound == null ? ' on' : '')} onClick={() => setCompound(null)}>
          All tyres
        </button>
        {present.map((c) => (
          <button key={c} className={'chip' + (compound === c ? ' on' : '')} onClick={() => setCompound(c)}>
            <Tyre compound={c} /> {c.toLowerCase()}
          </button>
        ))}
        <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {race ? 'Each driver’s longest stint' : 'Runs of 5+ consistent laps, each driver’s longest'} · click rows to compare
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="center-msg" style={{ position: 'static', padding: 30 }}>
          {race ? 'No full stints yet.' : 'No long runs yet. Teams usually do them in the second half of FP2 (or FP1 on sprint weekends).'}
        </div>
      ) : (
        <div className="longruns">
          <table className="lr-table">
            <thead>
              <tr>
                <th />
                <th>Driver</th>
                <th>Tyre</th>
                <th title="Representative laps / laps in the run">Laps</th>
                <th>Average</th>
                <th>Gap</th>
                <th title="Lap time change per lap, from a straight-line fit. Fuel burning off makes cars faster, tyre wear slower.">Trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const d = data.drivers.get(r.driver);
                const on = shown.includes(r.driver);
                return (
                  <tr key={r.driver} className={on ? 'on' : ''} onClick={() => toggle(r.driver)} onDoubleClick={() => clock.seek(r.run.start)}>
                    <td className="num dim">{i + 1}</td>
                    <td>
                      <i className="team-bar" style={{ background: d?.colour }} />
                      <b>{code(r.driver)}</b> <span className="dim">{d?.team}</span>
                    </td>
                    <td>
                      <Tyre compound={r.run.compound} age={r.run.tyreAge} />
                    </td>
                    <td className="num">
                      {r.run.clean}/{r.run.laps.length}
                    </td>
                    <td className="num">{formatLapTime(r.run.average)}</td>
                    <td className="num muted">{i === 0 ? '' : '+' + (r.run.average - fastest!).toFixed(3)}</td>
                    <td className={'num ' + (r.run.slope > 0.05 ? 'bad' : r.run.slope < -0.02 ? 'good' : 'muted')}>
                      {r.run.slope >= 0 ? '+' : '−'}
                      {Math.abs(r.run.slope).toFixed(2)}s/lap
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="lr-side">
            <RunChart data={data} runs={rows.filter((r) => shown.includes(r.driver)).map((r) => r.run)} />
            <div className="lr-teams">
              <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>Teams (best driver)</div>
              {teams.map((tm) => (
                <div key={tm.team} className="lr-team">
                  <i className="team-bar" style={{ background: tm.colour }} />
                  <span className="grow">{tm.team}</span>
                  <span className="num muted">{tm.pace === teams[0].pace ? formatLapTime(tm.pace) : '+' + (tm.pace - teams[0].pace).toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
        Teams run different fuel loads and engine modes in practice, so treat gaps under a few tenths as a tie. Double-click a row to jump to the run.
      </div>
    </Panel>
  );
}

/** Lap time against lap of the run; hollow dots are laps left out of the average. */
function RunChart({ data, runs }: { data: SessionData; runs: LongRun[] }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const W = size.width;
  const H = 220;
  const pad = { l: 52, r: 8, t: 8, b: 20 };
  const clean = runs.flatMap((r) => r.laps.filter((l) => !l.outlier).map((l) => l.duration));
  const maxI = Math.max(5, ...runs.map((r) => r.laps.length));
  const lo = clean.length ? Math.min(...clean) - 0.3 : 0;
  const hi = clean.length ? Math.max(...clean) + 0.3 : 1;
  const x = (i: number) => pad.l + ((i - 1) / Math.max(1, maxI - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((Math.min(hi, v) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  return (
    <div ref={ref} className="lr-chart">
      {W > 0 && runs.length > 0 && (
        <svg width={W} height={H}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#ffffff10" />
              <text x={pad.l - 6} y={y(v) + 3} fill="var(--dim)" fontSize={10} textAnchor="end">
                {formatLapTime(v)}
              </text>
            </g>
          ))}
          {Array.from({ length: maxI }, (_, i) => i + 1)
            .filter((i) => i === 1 || i % 5 === 0)
            .map((i) => (
              <text key={i} x={x(i)} y={H - 5} fill="var(--dim)" fontSize={10} textAnchor="middle">
                {i}
              </text>
            ))}
          {runs.map((r) => {
            const colour = data.drivers.get(r.driver)?.colour ?? '#888';
            const pts = r.laps.filter((l) => !l.outlier);
            return (
              <g key={r.driver + '-' + r.start}>
                <polyline points={pts.map((l) => `${x(l.i)},${y(l.duration)}`).join(' ')} fill="none" stroke={colour} strokeWidth={1.6} />
                {r.laps.map((l) => (
                  <circle key={l.i} cx={x(l.i)} cy={y(l.duration)} r={2.6} fill={l.outlier ? 'none' : colour} stroke={colour}>
                    <title>
                      {data.drivers.get(r.driver)?.code} lap {l.lap}: {formatLapTime(l.duration)}
                      {l.outlier ? ' (left out)' : ''}
                    </title>
                  </circle>
                ))}
                <text x={x(r.laps.length) + 4} y={y(r.laps.at(-1)!.duration) + 3} fill={colour} fontSize={10} fontWeight={700}>
                  {data.drivers.get(r.driver)?.code}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      {runs.length === 0 && <div className="dim" style={{ padding: 20 }}>Click drivers in the table to plot their runs.</div>}
    </div>
  );
}
