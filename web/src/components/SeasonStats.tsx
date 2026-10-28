// Season stats: points progression, the full driver and team tables, team-mate battles and winners.
import { finishedRaces, SpoilerGate } from './Spoilers';
import { TitleMaths } from './TitleMaths';
import { FormGuide } from './FormGuide';
import { PitStopTable } from './PitStopTable';
import { useMemo, useState } from 'react';
import {
  completedRounds,
  driverStats,
  fullName,
  pointsProgression,
  rolling,
  teamQualiPace,
  teammateBattles,
  teamStats,
  type DriverStats,
  type SeasonHistory,
} from '../data/history';
import { DocShell, go, H2HBar, links, Loading, param, teamColour, thisYear, Tile, useHistory, YearSelect, ordinal } from './Explore';
import { LineChart } from './LineChart';

export function SeasonStatsPage() {
  const year = Number(param('year')) || thisYear();
  const { h, error } = useHistory(year);
  return (
    <DocShell active="season">
      <div className="doc-head">
        <h1>{year} season</h1>
        <YearSelect year={year} onChange={(y) => go({ year: y })} />
      </div>
      <Loading h={h} error={error} what={`the ${year} season`} />
      {h && (
        <SpoilerGate races={finishedRaces(h)} what="The season stats">
          <SeasonBody h={h} />
        </SpoilerGate>
      )}
    </DocShell>
  );
}

type SortKey = keyof Pick<DriverStats, 'points' | 'wins' | 'podiums' | 'poles' | 'fastestLaps' | 'pointsFinishes' | 'dnfs' | 'avgQuali' | 'avgFinish' | 'gained'>;
const COLUMNS: { key: SortKey; label: string; title: string; asc?: boolean; fmt?: (v: number | null) => string }[] = [
  { key: 'points', label: 'Pts', title: 'Points (races and sprints)' },
  { key: 'wins', label: 'Wins', title: 'Grand Prix wins' },
  { key: 'podiums', label: 'Pod', title: 'Podiums' },
  { key: 'poles', label: 'Poles', title: 'Pole positions (Grand Prix qualifying)' },
  { key: 'fastestLaps', label: 'FL', title: 'Fastest laps' },
  { key: 'pointsFinishes', label: 'In pts', title: 'Races finished in the points' },
  { key: 'dnfs', label: 'DNF', title: 'Did not finish (or disqualified)' },
  { key: 'avgQuali', label: 'Avg Q', title: 'Average qualifying position', asc: true, fmt: (v) => (v == null ? '' : v.toFixed(1)) },
  { key: 'avgFinish', label: 'Avg fin', title: 'Average finishing position (classified finishes)', asc: true, fmt: (v) => (v == null ? '' : v.toFixed(1)) },
  { key: 'gained', label: '+/−', title: 'Places gained from grid to finish, over the season', fmt: (v) => (v == null ? '' : v > 0 ? `+${v}` : String(v)) },
];

function SeasonBody({ h }: { h: SeasonHistory }) {
  const [sort, setSort] = useState<SortKey>('points');
  const [chartBy, setChartBy] = useState<'driver' | 'team'>('driver');
  const rounds = completedRounds(h);
  const drivers = useMemo(() => driverStats(h), [h]);
  const teams = useMemo(() => teamStats(h), [h]);
  const battles = useMemo(() => teammateBattles(h), [h]);
  const prog = useMemo(() => pointsProgression(h, chartBy), [h, chartBy]);
  const finished = rounds.length === h.races.length && rounds.length > 0;
  const code = (id: string) => h.drivers[id]?.code ?? id;

  if (!rounds.length) return <div className="center-msg static">No races in {h.year} yet. The calendar has {h.races.length} rounds.</div>;

  const col = COLUMNS.find((c) => c.key === sort)!;
  const sorted = [...drivers].sort((a, b) => {
    const va = a[sort] ?? (col.asc ? 99 : -99);
    const vb = b[sort] ?? (col.asc ? 99 : -99);
    return (col.asc ? va - vb : vb - va) || a.position - b.position;
  });

  const top = chartBy === 'driver' ? drivers.slice(0, 6).map((d) => d.id) : teams.slice(0, 6).map((t) => t.id);
  const series = top.map((id) => {
    const team = chartBy === 'driver' ? drivers.find((d) => d.id === id)!.team : id;
    const dashed = chartBy === 'driver' && top.some((o) => o !== id && drivers.find((d) => d.id === o)?.team === team && top.indexOf(o) < top.indexOf(id));
    return { id, label: chartBy === 'driver' ? code(id) : h.teams[id], colour: teamColour(team), values: prog.series.get(id) ?? [], dashed };
  });

  const winners = new Set(h.results.filter((r) => r[4] === 1).map((r) => r[1]));
  const leader = drivers[0];
  const second = drivers[1];
  const climbs = h.results.filter((r) => r[4] != null && r[3] > 0).map((r) => ({ r, gain: r[3] - r[4]! })).sort((a, b) => b.gain - a.gain);
  const bestClimb = climbs[0];
  const lowestWin = h.results.filter((r) => r[4] === 1 && r[3] > 0).sort((a, b) => b[3] - a[3])[0];
  const raceName = (round: number) => h.races.find((r) => r.round === round)?.name ?? `round ${round}`;
  const poleWins = rounds.filter((round) => {
    const pole = h.quali.find((q) => q[0] === round && q[3] === 1)?.[1];
    const win = h.results.find((r) => r[0] === round && r[4] === 1)?.[1];
    return pole && pole === win;
  }).length;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {finished ? (
          <>
            <b className="text">{fullName(h.drivers[leader.id])}</b> won the championship by {leader.points - second.points} points.{' '}
          </>
        ) : (
          <>
            After {rounds.length} of {h.races.length} rounds, <b className="text">{fullName(h.drivers[leader.id])}</b> leads by {leader.points - second.points} points.{' '}
          </>
        )}
        {teams[0] && `${teams[0].name} ${finished ? 'took' : 'lead'} the constructors' title${finished ? '' : ' race'}.`}
      </p>

      <div className="tiles">
        <Tile label="Different winners" value={winners.size} />
        <Tile label="Pole → win" value={`${poleWins}/${rounds.length}`} sub="races won from pole" />
        {lowestWin && <Tile label="Win from furthest back" value={`${code(lowestWin[1])} from P${lowestWin[3]}`} sub={raceName(lowestWin[0])} />}
        {bestClimb && <Tile label="Biggest climb" value={`${code(bestClimb.r[1])} +${bestClimb.gain}`} sub={`P${bestClimb.r[3]} → P${bestClimb.r[4]}, ${raceName(bestClimb.r[0])}`} />}
        <Tile label="Most poles" value={code([...drivers].sort((a, b) => b.poles - a.poles)[0].id)} sub={`${[...drivers].sort((a, b) => b.poles - a.poles)[0].poles} poles`} />
      </div>

      <TitleMaths h={h} />

      <FormGuide h={h} />

      <section className="doc-section">
        <div className="doc-section-head">
          <h2>Points through the season</h2>
          <span className="seg">
            <button className={chartBy === 'driver' ? 'on' : ''} onClick={() => setChartBy('driver')}>Drivers</button>
            <button className={chartBy === 'team' ? 'on' : ''} onClick={() => setChartBy('team')}>Teams</button>
          </span>
        </div>
        <LineChart series={series} xLabels={prog.rounds.map((r) => `R${r}`)} height={280} xEvery={Math.ceil(prog.rounds.length / 12)} yMin={0} />
      </section>

      <TeamPace h={h} />

      <PitStopTable h={h} />

      <section className="doc-section">
        <h2>Drivers</h2>
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>P</th>
                <th className="l">Driver</th>
                <th className="l">Team</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} title={c.title} className={'sortable' + (sort === c.key ? ' on' : '')} onClick={() => setSort(c.key)}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => (
                <tr key={d.id}>
                  <td className="num dim">{d.position}</td>
                  <td className="l">
                    <i className="team-bar" style={{ background: teamColour(d.team) }} />
                    <a href={links.driver(h.year, d.id)}>{fullName(h.drivers[d.id])}</a>
                  </td>
                  <td className="l muted">{d.teams.map((t) => h.teams[t]).join(' / ')}</td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={'num' + (c.key === 'points' ? ' strong' : '')}>
                      {c.fmt ? c.fmt(d[c.key]) : d[c.key] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <h2>Teams</h2>
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>P</th>
                <th className="l">Team</th>
                <th>Pts</th>
                <th>Wins</th>
                <th>Podiums</th>
                <th title="Races where the team finished first and second">1–2s</th>
                <th>DNFs</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id}>
                  <td className="num dim">{i + 1}</td>
                  <td className="l">
                    <i className="team-bar" style={{ background: teamColour(t.id) }} />
                    {t.name}
                  </td>
                  <td className="num strong">{t.points}</td>
                  <td className="num">{t.wins || ''}</td>
                  <td className="num">{t.podiums || ''}</td>
                  <td className="num">{t.oneTwos || ''}</td>
                  <td className="num">{t.dnfs || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="doc-section">
        <h2>Team-mate battles</h2>
        <div className="h2h-grid">
          {battles.map((b) => (
            <div key={b.team} className="h2h-card">
              <div className="h2h-names">
                <a href={links.driver(h.year, b.a)}>{code(b.a)}</a>
                <span className="dim">{h.teams[b.team]}</span>
                <a href={links.driver(h.year, b.b)}>{code(b.b)}</a>
              </div>
              <H2HBar label="Qualifying" a={b.quali[0]} b={b.quali[1]} colourA={teamColour(b.team)} colourB={teamColour(b.team)} />
              <H2HBar label="Race" a={b.race[0]} b={b.race[1]} colourA={teamColour(b.team)} colourB={teamColour(b.team)} />
              <H2HBar label="Points" a={b.points[0]} b={b.points[1]} colourA={teamColour(b.team)} colourB={teamColour(b.team)} />
            </div>
          ))}
        </div>
        <p className="dim" style={{ fontSize: 12 }}>Race head-to-head counts only races both finished.</p>
      </section>

      <section className="doc-section">
        <h2>Race by race</h2>
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Rd</th>
                <th className="l">Grand Prix</th>
                <th className="l">Pole</th>
                <th className="l">Winner</th>
                <th className="l">Podium</th>
                <th className="l">Fastest lap</th>
              </tr>
            </thead>
            <tbody>
              {h.races.map((race) => {
                const res = h.results.filter((r) => r[0] === race.round);
                const pod = res.filter((r) => r[4] != null && r[4] <= 3).sort((a, b) => a[4]! - b[4]!);
                const pole = h.quali.find((q) => q[0] === race.round && q[3] === 1);
                const fl = res.find((r) => r[9] === 1);
                return (
                  <tr key={race.round} className={res.length ? '' : 'dim'}>
                    <td className="num dim">{race.round}</td>
                    <td className="l">
                      <a href={links.circuit(h.year, race.round)}>{race.name.replace(' Grand Prix', ' GP')}</a>
                      {race.sprint && <span className="tag out" style={{ marginLeft: 6 }}>SPRINT</span>}
                    </td>
                    <td className="l">{pole ? code(pole[1]) : ''}</td>
                    <td className="l strong">{pod[0] ? <span><i className="team-bar" style={{ background: teamColour(pod[0][2]) }} />{code(pod[0][1])}{pod[0][3] > 1 ? <span className="dim"> from {ordinal(pod[0][3])}</span> : ''}</span> : res.length ? '' : new Date(race.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</td>
                    <td className="l muted">{pod.slice(1).map((r) => code(r[1])).join(' · ')}</td>
                    <td className="l muted">{fl ? `${code(fl[1])} ${fl[10] ?? ''}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="dim" style={{ fontSize: 11 }}>Results from Jolpica. Saved in this browser, so it's instant next time.</p>
    </>
  );
}

/** Who's been getting faster: each team's qualifying gap to the fastest, through the season. */
function TeamPace({ h }: { h: SeasonHistory }) {
  const { rounds, gaps } = useMemo(() => teamQualiPace(h), [h]);
  const [only, setOnly] = useState<string | null>(null);
  if (rounds.length < 2) return null;
  const teams = [...gaps.keys()].filter((t) => gaps.get(t)!.some((v) => v != null));
  const smooth = new Map(teams.map((t) => [t, rolling(gaps.get(t)!, 3)]));
  // Change: average of the last 3 rounds against the 3 before them.
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const rows = teams
    .map((t) => {
      const g = gaps.get(t)!;
      const recent = avg(g.slice(-3));
      const before = avg(g.slice(-6, -3));
      return { t, recent, change: recent != null && before != null ? recent - before : null, season: avg(g) };
    })
    .sort((a, b) => (a.recent ?? 9) - (b.recent ?? 9));
  const shown = only ? [only] : teams;
  return (
    <section className="doc-section">
      <div className="doc-section-head">
        <h2>Team pace through the season</h2>
        {only && (
          <button className="icon-btn" onClick={() => setOnly(null)}>
            Show all teams
          </button>
        )}
      </div>
      <LineChart
        series={shown.map((t) => ({ id: t, label: h.teams[t].replace(/ F1 Team| Racing/g, ''), colour: teamColour(t), values: smooth.get(t)! }))}
        xLabels={rounds.map((r) => `R${r}`)}
        height={260}
        invert
        yMin={0}
        xEvery={Math.ceil(rounds.length / 12)}
        yFormat={(v) => `${v.toFixed(1)}%`}
      />
      <div className="table-scroll">
        <table className="doc-table" style={{ maxWidth: 640 }}>
          <thead>
            <tr>
              <th className="l">Team</th>
              <th title="Average gap to the fastest qualifying lap over the last 3 rounds">Last 3 rounds</th>
              <th title="Last 3 rounds against the 3 before them">Change</th>
              <th>Season</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.t} onClick={() => setOnly(only === r.t ? null : r.t)} style={{ cursor: 'pointer' }}>
                <td className="l">
                  <i className="team-bar" style={{ background: teamColour(r.t) }} />
                  {h.teams[r.t]}
                </td>
                <td className="num">{r.recent == null ? '–' : `${r.recent.toFixed(2)}%`}</td>
                <td className={'num ' + (r.change == null ? '' : r.change < -0.1 ? 'good' : r.change > 0.1 ? 'bad' : 'dim')}>
                  {r.change == null ? '' : `${r.change < 0 ? '▲ ' : r.change > 0 ? '▼ ' : ''}${Math.abs(r.change).toFixed(2)}%`}
                </td>
                <td className="num muted">{r.season == null ? '–' : `${r.season.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim" style={{ fontSize: 11 }}>
        Each team's fastest qualifying lap as a % behind the fastest of all, averaged over 3 rounds (lower is faster). ▲ means they've closed in recently, which is
        often an upgrade working. Wet qualifying sessions add noise. Click a team to show just its line.
      </p>
    </section>
  );
}
