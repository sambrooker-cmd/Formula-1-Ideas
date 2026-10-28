// Strategy simulator: "what if they'd stopped on a different lap, or used different tyres?"
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { actualPlan, simulate, type PlanStint } from '../data/strategysim';
import { degModel } from '../data/racepace';
import { useSynced } from '../hooks';
import { Panel } from './Panel';
import { LineChart } from './LineChart';
import { Tyre } from './TimingTower';

const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

export function StrategySim({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const { selected } = useSynced();
  const race = data.meta.session.type === 'Race';
  const finishers = data.meta.results.filter((r) => r.position != null).sort((a, b) => a.position! - b.position!);
  const [n, setN] = useState<number>(selected[0] ?? finishers[0]?.driver ?? data.driverOrder[0]);
  const [plan, setPlan] = useState<PlanStint[]>(() => actualPlan(data, n));
  useEffect(() => setPlan(actualPlan(data, n)), [data, n]);
  const model = useMemo(() => degModel(data), [data]);
  const result = useMemo(() => (race ? simulate(data, n, plan, model) : null), [data, n, plan, model, race]);
  const totalLaps = (data.laps.get(n) ?? []).filter((l) => l.duration != null).at(-1)?.lap ?? data.meta.totalLaps;
  const known = model.compounds.map((c) => c.compound);
  const code = (x: number) => data.drivers.get(x)?.code ?? '';

  if (!race)
    return (
      <Panel title="Strategy simulator" lead={lead} area={area} popout="/strategy-sim">
        <div className="center-msg">The strategy simulator is for races.</div>
      </Panel>
    );

  const update = (i: number, patch: Partial<PlanStint>) => setPlan(plan.map((s, k) => (k === i ? { ...s, ...patch } : s)).sort((a, b) => a.fromLap - b.fromLap));
  const addStop = () => {
    const last = plan.at(-1)!;
    const from = Math.min(totalLaps - 1, Math.max(last.fromLap + 5, Math.round((last.fromLap + totalLaps) / 2)));
    setPlan([...plan, { compound: last.compound === 'HARD' ? 'MEDIUM' : 'HARD', fromLap: from, ageAtStart: 0 }]);
  };
  const changed = JSON.stringify(plan) !== JSON.stringify(actualPlan(data, n));
  // Reference car for the chart: the winner (or the runner-up when it's the winner's own race).
  const refDriver = finishers[0]?.driver === n ? finishers[1]?.driver : finishers[0]?.driver;
  const winnerCum = (() => {
    const w = refDriver;
    const laps = (data.laps.get(w) ?? []).filter((l) => l.duration != null);
    return new Map(laps.map((l) => [l.lap, l.end - data.meta.raceStart]));
  })();

  return (
    <Panel title="Strategy simulator" lead={lead} area={area} popout="/strategy-sim" bodyClass="scroll">
      <div className="moment-filters">
        <select className="lap-jump" value={n} onChange={(e) => setN(Number(e.target.value))} aria-label="Driver">
          {finishers.map((r) => (
            <option key={r.driver} value={r.driver}>
              P{r.position} {code(r.driver)}
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={() => setPlan(actualPlan(data, n))} disabled={!changed}>
          Reset to what happened
        </button>
      </div>
      <div className="sim-grid">
        <div>
          <table className="lr-table sim-plan">
            <thead>
              <tr>
                <th>Stint</th>
                <th>From lap</th>
                <th>Tyre</th>
                <th title="Laps already on the set when fitted">Used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.map((s, i) => (
                <tr key={i}>
                  <td className="dim">{i === 0 ? 'Start' : `Stop ${i}`}</td>
                  <td>
                    {i === 0 ? (
                      '1'
                    ) : (
                      <input
                        type="number"
                        className="sim-num"
                        min={2}
                        max={totalLaps - 1}
                        value={s.fromLap - 1}
                        onChange={(e) => update(i, { fromLap: Math.max(2, Math.min(totalLaps - 1, Number(e.target.value))) + 1 })}
                        title="Pit at the end of this lap"
                      />
                    )}
                    {i > 0 && <span className="dim"> (pit end of lap)</span>}
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <Tyre compound={s.compound} />
                      <select className="lap-jump" value={s.compound} onChange={(e) => update(i, { compound: e.target.value })}>
                        {COMPOUNDS.filter((c) => known.includes(c) || c === s.compound).map((c) => (
                          <option key={c} value={c}>
                            {c.toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </span>
                  </td>
                  <td>
                    <input type="number" className="sim-num" min={0} max={30} value={s.ageAtStart} onChange={(e) => update(i, { ageAtStart: Math.max(0, Number(e.target.value)) })} />
                  </td>
                  <td>{i > 0 && <button className="icon-btn" onClick={() => setPlan(plan.filter((_, k) => k !== i))}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.length < 5 && (
            <button className="icon-btn" style={{ margin: '6px 0' }} onClick={addStop}>
              + Add a stop
            </button>
          )}
        </div>
        <div className="sim-result">
          {result ? (
            <>
              <div className="sim-pos">
                <span className="dim">Real</span> <b className="num">P{result.realPos}</b>
                <span className="dim">→ with this plan</span>{' '}
                <b className={'num ' + (result.simPos < result.realPos ? 'good' : result.simPos > result.realPos ? 'bad' : '')}>P{result.simPos}</b>
              </div>
              <div className="muted">
                {Math.abs(result.delta) < 0.05
                  ? 'Same race time.'
                  : `${Math.abs(result.delta).toFixed(1)} s ${result.delta < 0 ? 'faster' : 'slower'} over the race.`}{' '}
                {result.ahead && `${Math.abs(result.ahead.gap).toFixed(1)} s behind ${code(result.ahead.driver)}`}
                {result.ahead && result.behind && ', '}
                {result.behind && `${result.behind.gap.toFixed(1)} s ahead of ${code(result.behind.driver)}`}.
              </div>
            </>
          ) : (
            <div className="dim">Not enough laps to simulate.</div>
          )}
        </div>
      </div>
      {result && (
        <div style={{ padding: '0 10px' }}>
          <div className="dim" style={{ fontSize: 11 }}>
            Gap to {refDriver === finishers[0]?.driver ? 'the winner' : `${code(refDriver)} (P2)`}, real (solid) and with this plan (dashed), seconds. Below zero is ahead.
          </div>
          <LineChart
            series={[
              {
                id: 'real',
                label: 'real',
                colour: data.drivers.get(n)?.colour ?? '#fff',
                values: result.laps.map((l, i) => (winnerCum.has(l) ? (result.realCum[i] - (winnerCum.get(l)! )) / 1000 : null)),
              },
              {
                id: 'sim',
                label: 'plan',
                colour: '#e8edf3',
                dashed: true,
                values: result.laps.map((l, i) => (winnerCum.has(l) ? (result.simCum[i] - winnerCum.get(l)!) / 1000 : null)),
              },
            ]}
            xLabels={result.laps.map(String)}
            xEvery={10}
            height={200}
            yFormat={(v) => v.toFixed(1)}
          />
        </div>
      )}
      <p className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
        Uses this race's tyre degradation and the real cost of a stop ({result ? result.pitLoss.toFixed(1) : '–'} s green flag, about half under a Safety Car). It
        changes only this car: everyone else's race stays as it was, and traffic and how hard it is to overtake aren't modelled, so treat it as a guide.
      </p>
    </Panel>
  );
}
