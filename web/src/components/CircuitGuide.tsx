// Circuit guide: the layout with numbered corners, the elevation over a lap, key numbers,
// and who has won here.
import { useEffect, useMemo, useState } from 'react';
import { circuitHistory, elevation, layout, meetingFor, neutralisations, type CircuitHistory, type Elevation, type Layout, type NeutralRace } from '../data/circuit';
import type { SeasonHistory } from '../data/history';
import { listSessions, type CachedSession } from '../api';
import { clock } from '../sync/clock';
import { useElementSize } from '../hooks';
import { DocShell, go, links, Loading, ordinal, param, teamColour, thisYear, Tile, useHistory, YearSelect } from './Explore';
import { LineChart } from './LineChart';
import { RaceWeather } from './Weather';
import { circuitStarts, type PastStart } from '../data/starts';

export function CircuitGuidePage() {
  const year = Number(param('year')) || thisYear();
  const { h, error } = useHistory(year);
  return (
    <DocShell active="circuit">
      <Loading h={h} error={error} what={`the ${year} calendar`} />
      {h && <CircuitBody h={h} />}
    </DocShell>
  );
}

function CircuitBody({ h }: { h: SeasonHistory }) {
  // Default: the next race, or the last one if the season is over.
  const wanted = Number(param('round'));
  const upcoming = h.races.find((r) => Date.parse(r.start) + 3 * 3600e3 > Date.now());
  const race = h.races.find((r) => r.round === wanted) ?? upcoming ?? h.races.at(-1);
  const [map, setMap] = useState<Layout | null | undefined>(undefined);
  const [elev, setElev] = useState<Elevation | null | undefined>(undefined);
  const [hist, setHist] = useState<CircuitHistory | null>(null);
  const [replays, setReplays] = useState<CachedSession[]>([]);
  const [problem, setProblem] = useState('');
  const [neutral, setNeutral] = useState<NeutralRace[] | null>(null);

  useEffect(() => {
    if (!race) return;
    setMap(undefined);
    setElev(undefined);
    setHist(null);
    setNeutral(null);
    meetingFor(h.year, race.date)
      .then(async (m) => {
        if (!m) {
          setMap(null);
          setElev(null);
          return;
        }
        layout(m.circuit_key, h.year).then(setMap, () => setMap(null));
        neutralisations(m.circuit_key).then(setNeutral, () => setNeutral(null));
        elevation(m.circuit_key).then(setElev, () => setElev(null));
        const all = await listSessions();
        setReplays(all.filter((s) => s.complete && s.circuit_short_name === m.circuit_short_name));
      })
      .catch((e) => {
        setProblem(`Couldn't reach OpenF1 (${e.message}). The layout and elevation need it; the history below doesn't.`);
        setMap(null);
        setElev(null);
      });
    circuitHistory(race.circuitId).then(setHist, () => setHist(null));
  }, [h.year, race?.round]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!race) return <div className="center-msg static">No {h.year} calendar yet.</div>;

  const result = h.results.filter((r) => r[0] === race.round);
  const winner = result.find((r) => r[4] === 1);
  const raceLaps = winner?.[7] ?? null;
  const record = hist?.fastest.length ? [...hist.fastest].sort((a, b) => a.seconds - b.seconds)[0] : null;
  const when = new Date(race.start);
  const future = when.getTime() > Date.now();

  return (
    <>
      <div className="doc-head">
        <select className="lap-jump" value={race.round} onChange={(e) => go({ round: e.target.value })} aria-label="Circuit">
          {h.races.map((r) => (
            <option key={r.round} value={r.round}>
              {r.round}. {r.name}
            </option>
          ))}
        </select>
        <YearSelect year={h.year} onChange={(y) => go({ year: y })} />
      </div>
      <div className="report-kicker">
        Round {race.round} · {when.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        {race.sprint && ' · sprint weekend'}
      </div>
      <h1 style={{ margin: '6px 0 2px' }}>{race.circuit}</h1>
      <div className="muted">
        {race.locality}, {race.country} · {race.name}
      </div>

      <div className="circuit-grid">
        <div className="circuit-map-card">
          {map === undefined && <div className="center-msg static">Loading layout…</div>}
          {map === null && <div className="center-msg static">No layout available for this circuit.</div>}
          {map && <CircuitMap map={map} />}
        </div>
        <div className="tiles col">
          {map && <Tile label="Lap length" value={`${(map.length / 1000).toFixed(2)} km`} sub="measured from the layout, so approximate" />}
          {map && <Tile label="Corners" value={new Set(map.corners.map((c) => c.number)).size} />}
          {map && raceLaps && <Tile label="Race distance" value={`${raceLaps} laps`} sub={`${((raceLaps * map.length) / 1000).toFixed(1)} km`} />}
          {map?.pitLoss && <Tile label="Pit stop costs" value={`${Number(map.pitLoss.normal).toFixed(1)} s`} sub={`${Number(map.pitLoss.sc).toFixed(1)} s under a Safety Car, ${Number(map.pitLoss.vsc).toFixed(1)} s under VSC`} />}
          {elev && <Tile label="Elevation change" value={`${Math.max(...elev.points.map((p) => p[1])).toFixed(0)} m`} sub="lowest to highest point" />}
          {record && <Tile label="Fastest race lap on record" value={record.time} sub={`${record.driver}, ${record.year}`} />}
        </div>
      </div>
      {problem && <p className="dim">{problem}</p>}

      {elev && (
        <section className="doc-section">
          <h2>Elevation over a lap</h2>
          <LineChart
            series={[{ id: 'z', label: 'Height', colour: '#3fa7ff', values: sample(elev.points, 160).map((p) => p[1]), fill: true }]}
            xLabels={sample(elev.points, 160).map((p) => `${(p[0] / 1000).toFixed(1)} km`)}
            xEvery={20}
            height={170}
            yFormat={(v) => `${v.toFixed(Math.max(...elev.points.map((p) => p[1])) < 10 ? 1 : 0)} m`}
            yMin={0}
          />
          <p className="dim" style={{ fontSize: 11 }}>From car #{elev.driver}'s fastest lap in the {elev.year} race. Heights come from the cars' positioning data, so treat them as approximate.</p>
        </section>
      )}

      <RaceWeather lat={race.lat} lng={race.lng} start={race.start} />
      {neutral && neutral.length > 0 && <SafetyCarOdds races={neutral} />}

      {winner && (
        <section className="doc-section">
          <h2>{h.year} race</h2>
          <p>
            Won by <a href={links.driver(h.year, winner[1])}>{h.drivers[winner[1]] ? `${h.drivers[winner[1]].given} ${h.drivers[winner[1]].family}` : winner[1]}</a> ({h.teams[winner[2]]})
            {winner[3] > 1 ? ` from ${ordinal(winner[3])} on the grid` : winner[3] === 1 ? ' from pole' : ''}.
          </p>
        </section>
      )}
      {future && <p className="muted">Lights out: {when.toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} (your time).</p>}

      {replays.length > 0 && (
        <section className="doc-section">
          <h2>Replays from here</h2>
          <div className="replay-chips">
            {replays.map((s) => (
              <button
                key={s.session_key}
                className="btn small"
                onClick={() => {
                  clock.setSession(s.session_key);
                  location.href = /Practice/.test(s.session_name) ? '/long-runs' : '/wall';
                }}
              >
                {s.year} {s.session_name}
              </button>
            ))}
          </div>
        </section>
      )}

      {hist && hist.winners.length > 0 && <History hist={hist} year={h.year} />}
      <StartsHere circuitId={race.circuitId} />
    </>
  );
}

function History({ hist, year }: { hist: CircuitHistory; year: number }) {
  const count = <T,>(key: (w: CircuitHistory['winners'][number]) => T) => {
    const m = new Map<T, number>();
    for (const w of hist.winners) m.set(key(w), (m.get(key(w)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const drivers = count((w) => w.driver).slice(0, 5);
  const teams = count((w) => w.team).slice(0, 5);
  const withGrid = hist.winners.filter((w) => w.grid > 0);
  const fromPole = withGrid.filter((w) => w.grid === 1).length;
  const furthest = [...withGrid].sort((a, b) => b.grid - a.grid)[0];
  const first = hist.winners.at(-1);

  return (
    <section className="doc-section">
      <h2>History</h2>
      <p>
        {hist.winners.length} world championship race{hist.winners.length === 1 ? '' : 's'} here
        {first ? ` since ${first.year}` : ''}. {withGrid.length > 0 && `${Math.round((fromPole / withGrid.length) * 100)}% were won from pole`}
        {furthest && furthest.grid > 1 ? `; the furthest back a winner started was ${ordinal(furthest.grid)} (${furthest.driver}, ${furthest.year}).` : '.'}
      </p>
      <div className="history-grid">
        <div>
          <h3>Most wins</h3>
          {drivers.map(([name, n]) => (
            <div key={name} className="lr-team">
              <span className="grow">{name}</span>
              <span className="num">{n}</span>
            </div>
          ))}
          <h3>Most wins by team</h3>
          {teams.map(([name, n]) => (
            <div key={name} className="lr-team">
              <span className="grow">{name}</span>
              <span className="num">{n}</span>
            </div>
          ))}
        </div>
        <div>
          <h3>Recent winners</h3>
          {hist.winners.slice(0, 12).map((w) => (
            <div key={`${w.year}-${w.round}`} className="lr-team">
              <span className="num dim" style={{ width: 44 }}>{w.year}</span>
              <i className="team-bar" style={{ background: teamColour(w.teamId) }} />
              <span className="grow">{w.year >= 2023 && w.year <= year ? <a href={links.driver(w.year, w.driverId)}>{w.driver}</a> : w.driver}</span>
              <span className="dim">{w.team}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function sample<T>(arr: T[], n: number) {
  if (arr.length <= n) return arr;
  return Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
}

/** The layout, rotated the way the TV graphics show it, with numbered corners. */
function CircuitMap({ map }: { map: Layout }) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const geo = useMemo(() => {
    const rad = (map.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rot = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
    const pts = map.x.map((x, i) => rot(x, map.y[i]));
    const corners = map.corners.map((c) => {
      const [x, y] = rot(c.trackPosition.x, c.trackPosition.y);
      const a = ((c.angle + map.rotation) * Math.PI) / 180;
      return { label: `${c.number}${c.letter ?? ''}`, x, y, dx: Math.cos(a), dy: Math.sin(a) };
    });
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { pts, corners, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }, [map]);

  const W = size.width;
  const H = Math.max(260, Math.min(460, W * 0.75));
  const pad = 30;
  const s = Math.min((W - 2 * pad) / (geo.maxX - geo.minX || 1), (H - 2 * pad) / (geo.maxY - geo.minY || 1));
  const ox = (W - (geo.maxX - geo.minX) * s) / 2;
  const oy = (H - (geo.maxY - geo.minY) * s) / 2;
  const X = (x: number) => ox + (x - geo.minX) * s;
  const Y = (y: number) => H - (oy + (y - geo.minY) * s); // north up: flip y
  const path = geo.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('') + 'Z';
  const [sx, sy] = geo.pts[0] ?? [0, 0];
  const [nx, ny] = geo.pts[3] ?? [0, 0];
  const ang = Math.atan2(Y(ny) - Y(sy), X(nx) - X(sx));

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {W > 0 && (
        <svg width={W} height={H}>
          <path d={path} fill="none" stroke="#2d3746" strokeWidth={10} strokeLinejoin="round" />
          <path d={path} fill="none" stroke="#e8edf3" strokeWidth={2.5} strokeLinejoin="round" />
          <line
            x1={X(sx) - Math.sin(ang) * 9}
            y1={Y(sy) + Math.cos(ang) * 9}
            x2={X(sx) + Math.sin(ang) * 9}
            y2={Y(sy) - Math.cos(ang) * 9}
            stroke="var(--accent)"
            strokeWidth={3}
          />
          {geo.corners.map((c) => (
            <g key={c.label}>
              <circle cx={X(c.x) + c.dx * 16} cy={Y(c.y) - c.dy * 16} r={8} fill="var(--panel-2)" stroke="var(--line-2)" />
              <text x={X(c.x) + c.dx * 16} y={Y(c.y) - c.dy * 16 + 3} fill="var(--text)" fontSize={9} fontWeight={700} textAnchor="middle">
                {c.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function StartsHere({ circuitId }: { circuitId: string }) {
  const [past, setPast] = useState<PastStart[] | null>(null);
  useEffect(() => {
    setPast(null);
    circuitStarts(circuitId).then(setPast, () => setPast([]));
  }, [circuitId]);
  if (!past?.length) return null;
  return (
    <section className="doc-section">
      <h2>Starts here</h2>
      <p>
        In the last {past.length} races here, pole led after lap 1 {past.filter((p) => p.poleKept).length} times. Cars moved{' '}
        {(past.reduce((s, p) => s + p.avgChange, 0) / past.length).toFixed(1)} places each on lap 1 on average
        {(() => {
          const out = past.reduce((s, p) => s + p.lap1Out.length, 0);
          return out ? `, and ${out} car${out === 1 ? '' : 's'} went out on the first lap` : '';
        })()}
        .
      </p>
    </section>
  );
}

/** How often this race has been neutralised, and when. */
function SafetyCarOdds({ races }: { races: NeutralRace[] }) {
  const withSc = races.filter((r) => r.events.some((e) => e[1] === 'SC')).length;
  const withVsc = races.filter((r) => r.events.some((e) => e[1] === 'VSC')).length;
  const withRed = races.filter((r) => r.events.some((e) => e[1] === 'RED')).length;
  const any = races.filter((r) => r.events.length).length;
  const total = (k: string) => races.reduce((s, r) => s + r.events.filter((e) => e[1] === k).length, 0);
  const label = { SC: 'Safety Car', VSC: 'VSC', RED: 'Red flag' } as const;
  return (
    <section className="doc-section">
      <h2>Safety Car odds</h2>
      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Safety Car</div>
          <div className="tile-value">
            {withSc}/{races.length}
          </div>
          <div className="tile-sub">races ({total('SC')} in all)</div>
        </div>
        <div className="tile">
          <div className="tile-label">Virtual Safety Car</div>
          <div className="tile-value">
            {withVsc}/{races.length}
          </div>
          <div className="tile-sub">races ({total('VSC')} in all)</div>
        </div>
        <div className="tile">
          <div className="tile-label">Red flag</div>
          <div className="tile-value">
            {withRed}/{races.length}
          </div>
          <div className="tile-sub">races</div>
        </div>
        <div className="tile">
          <div className="tile-label">Any neutralisation</div>
          <div className="tile-value">{Math.round((any / races.length) * 100)}%</div>
          <div className="tile-sub">of races here</div>
        </div>
      </div>
      <table className="lr-table" style={{ maxWidth: 560 }}>
        <tbody>
          {races.map((r) => (
            <tr key={r.year}>
              <td className="num dim">{r.year}</td>
              <td>
                {r.events.length ? (
                  r.events.map((e, i) => (
                    <span key={i} className={'sc-chip k-' + e[1]}>
                      {label[e[1]]}
                      {e[0] ? ` · lap ${e[0]}` : ''}
                    </span>
                  ))
                ) : (
                  <span className="dim">clean race</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dim" style={{ fontSize: 11 }}>Races here since 2023 (OpenF1's race control messages), so a small sample: treat it as a feel for the track, not a forecast.</p>
    </section>
  );
}
