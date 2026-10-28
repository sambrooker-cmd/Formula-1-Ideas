// Tyre degradation (per compound, and who has the best tyres right now) and clean-air race pace.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { cleanAirPace, degModel, FUEL_PER_LAP, MIN_LAPS, raceLaps, tyreCost, CLEAN_GAP } from '../data/racepace';
import { formatLapTime, leaderLap, tower } from '../data/state';
import { useNow } from '../hooks';
import { Panel } from './Panel';
import { LineChart } from './LineChart';
import { SpoilerToggle } from './RaceCharts';
import { Tyre } from './TimingTower';

const COLOUR: Record<string, string> = { SOFT: '#ff4d4d', MEDIUM: '#ffd23f', HARD: '#e9edf2', INTERMEDIATE: '#39c96b', WET: '#3f8cff' };
const signed = (v: number, d = 3) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

function useUntil(whole: boolean) {
  const t = useNow(1);
  // Recompute once per completed lap, not every frame.
  return { t, until: whole ? Infinity : Math.floor(t / 20_000) * 20_000 };
}

function RaceOnly({ data, children }: { data: SessionData; children: ReactNode }) {
  if (data.meta.session.type !== 'Race') return <div className="center-msg static">This is for races and sprints.</div>;
  return <>{children}</>;
}

export function TyreDeg({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const [whole, setWhole] = useState(false);
  const { t, until } = useUntil(whole);
  const model = useMemo(() => degModel(data, until), [data, data.version, until]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxAge = Math.max(10, ...model.stints.flatMap((s) => s.points.map((p) => p[0])));
  const ages = Array.from({ length: Math.min(50, maxAge + 1) }, (_, i) => i);
  const lap = leaderLap(data, t);
  const remaining = Math.max(0, data.meta.totalLaps - lap);
  const now = tower(data, t)
    .filter((r) => !r.out && r.position < 99)
    .map((r) => ({ r, cost: tyreCost(model, r.compound, r.tyreAge ?? 0), later: tyreCost(model, r.compound, (r.tyreAge ?? 0) + 10) }));
  // Colour relative to the field: best quarter green, worst quarter red.
  const costs = now.map((x) => x.cost).filter((c): c is number => c != null).sort((a, b) => a - b);
  const q1 = costs[Math.floor(costs.length * 0.25)] ?? 0;
  const q3 = costs[Math.floor(costs.length * 0.75)] ?? 0;

  return (
    <Panel title="Tyre degradation" lead={lead} area={area} popout="/tyre-deg" bodyClass="scroll" extra={<SpoilerToggle value={whole} onChange={setWhole} />}>
      <RaceOnly data={data}>
        {model.compounds.length === 0 ? (
          <div className="center-msg static">Needs a few stints of 6+ green-flag laps.</div>
        ) : (
          <div className="pace-grid">
            <div>
              <div className="deg-cards">
                {model.compounds.map((c) => (
                  <div key={c.compound} className="deg-card">
                    <Tyre compound={c.compound} />
                    <div>
                      <div className="num strong">{signed(c.slope)} s/lap</div>
                      <div className="dim" style={{ fontSize: 11 }}>
                        {c.offset == null ? 'pace vs medium unknown' : c.offset === 0 ? 'baseline when new' : `${signed(c.offset, 2)} s when new vs medium`} · {c.stints} stint{c.stints === 1 ? '' : 's'}
                        {c.stints < 2 || c.laps < 15 ? <b className="bad"> · little data</b> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <LineChart
                series={model.compounds.map((c) => ({
                  id: c.compound,
                  label: c.compound[0],
                  colour: COLOUR[c.compound] ?? '#888',
                  values: ages.map((a) => (c.offset ?? 0) + c.slope * a),
                  dashed: c.stints < 2 || c.laps < 15,
                }))}
                xLabels={ages.map(String)}
                xEvery={5}
                height={200}
                yFormat={(v) => signed(v, 1)}
              />
              <p className="dim" style={{ fontSize: 11 }}>
                Seconds per lap lost against a new medium, by tyre age (laps). Built from this race's stints, with the fuel effect ({FUEL_PER_LAP} s/lap) taken out.
              </p>
            </div>
            <div>
              <div className="dim" style={{ fontSize: 11, marginBottom: 4 }}>
                Best tyres right now{remaining ? ` · ${remaining} laps to go` : ''}
              </div>
              <table className="lr-table">
                <thead>
                  <tr>
                    <th>P</th>
                    <th>Driver</th>
                    <th>Tyre</th>
                    <th title="Expected loss vs a new medium, per lap">Now</th>
                    <th title="Same, ten laps from now">+10 laps</th>
                  </tr>
                </thead>
                <tbody>
                  {now.map(({ r, cost, later }) => (
                    <tr key={r.driver}>
                      <td className="num dim">{r.position}</td>
                      <td>
                        <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
                        <b>{data.drivers.get(r.driver)?.code}</b>
                      </td>
                      <td>
                        <Tyre compound={r.compound} age={r.tyreAge} />
                      </td>
                      <td className={'num ' + (cost == null ? 'dim' : cost <= q1 && q1 < q3 ? 'good' : cost >= q3 && q1 < q3 ? 'bad' : '')}>{cost == null ? '–' : signed(cost, 2)}</td>
                      <td className="num muted">{later == null ? '' : signed(later, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </RaceOnly>
    </Panel>
  );
}

export function CleanAirPace({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const [whole, setWhole] = useState(false);
  const { until } = useUntil(whole);
  const rows = useMemo(() => cleanAirPace(data, until), [data, data.version, until]); // eslint-disable-line react-hooks/exhaustive-deps
  const model = useMemo(() => degModel(data, until), [data, data.version, until]); // eslint-disable-line react-hooks/exhaustive-deps
  // Like-for-like: also take out each lap's tyre age and compound, using the degradation model.
  const lfl = useMemo(() => {
    const laps = raceLaps(data, until).filter((l) => l.clean);
    const out = new Map<number, number>();
    for (const n of data.driverOrder) {
      const v = laps
        .filter((l) => l.driver === n)
        .map((l) => l.corrected - (tyreCost(model, l.compound, l.tyreAge) ?? 0))
        .sort((a, b) => a - b);
      if (v.length >= MIN_LAPS) out.set(n, v[Math.floor(v.length / 2)]);
    }
    return out;
  }, [data, until, model]);
  const ranked = rows.filter((r) => r.cleanPace != null);
  const best = ranked[0]?.cleanPace ?? 0;
  const bestL = Math.min(...lfl.values());
  const few = rows.filter((r) => r.cleanPace == null);

  return (
    <Panel title="Clean-air pace" lead={lead} area={area} popout="/clean-air" bodyClass="scroll" extra={<SpoilerToggle value={whole} onChange={setWhole} />}>
      <RaceOnly data={data}>
        <table className="lr-table" style={{ margin: '6px 10px', width: 'calc(100% - 20px)' }}>
          <thead>
            <tr>
              <th />
              <th>Driver</th>
              <th title={`Green-flag laps at least ${CLEAN_GAP} s behind the car ahead / all representative laps`}>Clean laps</th>
              <th title="Typical lap in clean air, with the fuel effect taken out">Clean-air pace</th>
              <th>Gap</th>
              <th title="Also corrected for tyre age and compound: the fairest comparison">Like-for-like</th>
              <th title="How much slower a typical lap was when stuck behind another car">Traffic cost</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, i) => {
              const l = lfl.get(r.driver);
              return (
                <tr key={r.driver}>
                  <td className="num dim">{i + 1}</td>
                  <td>
                    <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
                    <b>{data.drivers.get(r.driver)?.code}</b>
                  </td>
                  <td className="num">
                    {r.clean}/{r.all}
                  </td>
                  <td className="num">{formatLapTime(r.cleanPace)}</td>
                  <td className="num muted">{i === 0 ? '' : '+' + (r.cleanPace! - best).toFixed(3)}</td>
                  <td className="num">{l == null ? '' : l === bestL ? 'fastest' : '+' + (l - bestL).toFixed(3)}</td>
                  <td className={'num ' + (r.trafficCost == null ? 'dim' : r.trafficCost > 0.5 ? 'bad' : '')}>
                    {r.trafficCost == null ? '–' : `${signed(r.trafficCost, 2)} s/lap`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {few.length > 0 && (
          <p className="dim" style={{ fontSize: 11, padding: '0 10px' }}>
            Not enough clean-air laps (under {MIN_LAPS}): {few.map((r) => data.drivers.get(r.driver)?.code).join(', ')}.
          </p>
        )}
        <p className="dim" style={{ fontSize: 11, padding: '0 10px 10px' }}>
          Clean air: green-flag laps, not in or out of the pits, at least {CLEAN_GAP} s behind the car ahead at both ends of the lap. Pace is the median such lap
          with the fuel effect taken out, so early and late laps compare fairly.
        </p>
      </RaceOnly>
    </Panel>
  );
}
