// A driver's season: headline numbers, the team-mate battle, points over the season and every race.
import { finishedRaces, SpoilerGate } from './Spoilers';
import { useEffect, useMemo, useState } from 'react';
import { carNumber, completedRounds, driverStats, fullName, headToHead, isDnf, pointsProgression, type SeasonHistory } from '../data/history';
import { season as loadSeason } from '../api';
import { clock } from '../sync/clock';
import { DocShell, go, H2HBar, links, Loading, ordinal, param, teamColour, thisYear, Tile, useHistory, YearSelect } from './Explore';
import { LineChart } from './LineChart';

export function DriverSeasonPage() {
  const year = Number(param('year')) || thisYear();
  const { h, error } = useHistory(year);
  return (
    <DocShell active="driver">
      <Loading h={h} error={error} what={`the ${year} season`} />
      {h && (
        <SpoilerGate races={finishedRaces(h)} what="Driver pages">
          <DriverBody h={h} id={param('driver')} />
        </SpoilerGate>
      )}
    </DocShell>
  );
}

function DriverBody({ h, id: wanted }: { h: SeasonHistory; id: string | null }) {
  const stats = useMemo(() => driverStats(h), [h]);
  const id = wanted && h.drivers[wanted] ? wanted : stats[0]?.id;
  const [replays, setReplays] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    loadSeason(h.year)
      .then((s) => {
        const races = s.races as { round: number; cached: boolean; sessionKey: number | null }[];
        setReplays(new Map(races.filter((r) => r.cached && r.sessionKey).map((r) => [r.round, r.sessionKey!])));
      })
      .catch(() => {});
  }, [h.year]);

  const picker = (
    <div className="doc-head">
      <select className="lap-jump" value={id ?? ''} onChange={(e) => go({ driver: e.target.value })} aria-label="Driver">
        {stats.map((s) => (
          <option key={s.id} value={s.id}>
            {fullName(h.drivers[s.id])}
          </option>
        ))}
      </select>
      <YearSelect year={h.year} onChange={(y) => go({ year: y })} />
    </div>
  );
  if (!id) return <>{picker}<div className="center-msg static">No results in {h.year} yet.</div></>;

  const me = stats.find((s) => s.id === id)!;
  const d = h.drivers[id];
  const rounds = completedRounds(h);
  const colour = teamColour(me.team);

  // Team-mate: who raced alongside them most in their current team.
  const mates = new Map<string, number>();
  for (const r of h.results) {
    if (r[2] !== me.team || r[1] === id) continue;
    if (h.results.some((x) => x[0] === r[0] && x[1] === id && x[2] === me.team)) mates.set(r[1], (mates.get(r[1]) ?? 0) + 1);
  }
  const mate = [...mates].sort((a, b) => b[1] - a[1])[0]?.[0];
  const h2h = mate ? headToHead(h, me.team, id, mate) : null;

  const prog = pointsProgression(h, 'driver');
  const rival = stats[0].id === id ? stats[1]?.id : stats[0].id;
  const series = [
    { id, label: d.code, colour, values: prog.series.get(id) ?? [] },
    ...(mate ? [{ id: mate, label: h.drivers[mate].code, colour, values: prog.series.get(mate) ?? [], dashed: true }] : []),
    ...(rival && rival !== mate ? [{ id: rival, label: `${h.drivers[rival].code} (${stats[0].id === id ? 'P2' : 'leader'})`, colour: '#8a96a8', values: prog.series.get(rival) ?? [] }] : []),
  ];

  const age = d.dob ? Math.floor((Date.parse(`${h.year}-12-31`) - Date.parse(d.dob)) / (365.25 * 86_400e3)) : null;

  return (
    <>
      {picker}
      <div className="driver-hero" style={{ borderColor: colour }}>
        <div className="driver-number" style={{ color: colour }}>
          {carNumber(h, id)}
        </div>
        <div>
          <h1 style={{ margin: 0 }}>{fullName(d)}</h1>
          <div className="muted">
            {me.teams.map((t) => h.teams[t]).join(' / ')} · {d.nationality}
            {age != null && ` · ${age} at the end of ${h.year}`}
          </div>
        </div>
        <div className="driver-pos">
          <div className="num">{ordinal(me.position)}</div>
          <div className="dim">{me.points} pts</div>
        </div>
      </div>

      <div className="tiles">
        <Tile label="Wins" value={me.wins} sub={me.sprintWins ? `+${me.sprintWins} sprint` : undefined} />
        <Tile label="Podiums" value={me.podiums} />
        <Tile label="Poles" value={me.poles} />
        <Tile label="Fastest laps" value={me.fastestLaps} />
        <Tile label="Points finishes" value={`${me.pointsFinishes}/${me.starts}`} />
        <Tile label="DNFs" value={me.dnfs} />
        <Tile label="Avg qualifying" value={me.avgQuali?.toFixed(1) ?? '–'} />
        <Tile label="Avg finish" value={me.avgFinish?.toFixed(1) ?? '–'} sub={me.best ? `best ${ordinal(me.best)}` : undefined} />
      </div>

      {h2h && mate && (
        <section className="doc-section">
          <h2>
            Against team-mate <a href={links.driver(h.year, mate)}>{fullName(h.drivers[mate])}</a>
          </h2>
          <div className="h2h-card wide">
            <div className="h2h-names">
              <b>{d.code}</b>
              <span />
              <b>{h.drivers[mate].code}</b>
            </div>
            <H2HBar label="Qualifying" a={h2h.quali[0]} b={h2h.quali[1]} colourA={colour} colourB={colour} />
            <H2HBar label="Race (both finished)" a={h2h.race[0]} b={h2h.race[1]} colourA={colour} colourB={colour} />
            <H2HBar label="Points" a={h2h.points[0]} b={h2h.points[1]} colourA={colour} colourB={colour} />
          </div>
        </section>
      )}

      <section className="doc-section">
        <h2>Points through the season</h2>
        <LineChart series={series} xLabels={prog.rounds.map((r) => `R${r}`)} height={240} xEvery={Math.ceil(rounds.length / 12)} yMin={0} />
      </section>

      <section className="doc-section">
        <h2>Results</h2>
        <div className="result-strip">
          {rounds.map((round) => {
            const r = h.results.find((x) => x[0] === round && x[1] === id);
            const cls = !r ? 'none' : isDnf(r) ? 'dnf' : r[4] === 1 ? 'p1' : r[4] === 2 ? 'p2' : r[4] === 3 ? 'p3' : r[6] > 0 ? 'pts' : 'nopts';
            return (
              <span key={round} className={'rs ' + cls} title={`${h.races.find((x) => x.round === round)?.name}: ${r ? r[5] : 'did not race'}`}>
                {r ? (isDnf(r) ? '✕' : r[5]) : '–'}
              </span>
            );
          })}
        </div>
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Rd</th>
                <th className="l">Grand Prix</th>
                <th title="Qualifying position">Quali</th>
                <th>Grid</th>
                <th>Finish</th>
                <th>+/−</th>
                <th>Pts</th>
                <th className="l">Sprint</th>
                <th className="l">Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {h.races.map((race) => {
                const r = h.results.find((x) => x[0] === race.round && x[1] === id);
                const q = h.quali.find((x) => x[0] === race.round && x[1] === id);
                const s = h.sprints.find((x) => x[0] === race.round && x[1] === id);
                if (!r && !q) return null;
                const delta = r && r[4] != null && r[3] > 0 ? r[3] - r[4] : null;
                const key = replays.get(race.round);
                return (
                  <tr key={race.round}>
                    <td className="num dim">{race.round}</td>
                    <td className="l">
                      <a href={links.circuit(h.year, race.round)}>{race.name.replace(' Grand Prix', ' GP')}</a>
                    </td>
                    <td className="num">{q?.[3] ?? ''}</td>
                    <td className="num">{r ? (r[3] > 0 ? r[3] : 'PL') : ''}</td>
                    <td className={'num strong' + (r && r[4] != null && r[4] <= 3 ? ' podium' : '')}>{r ? posText(r[5]) : ''}</td>
                    <td className={'num ' + (delta == null ? '' : delta > 0 ? 'good' : delta < 0 ? 'bad' : 'dim')}>
                      {delta == null ? '' : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : '='}
                    </td>
                    <td className="num">{r ? (r[6] || '') : ''}{s && s[6] ? <span className="dim"> +{s[6]}</span> : ''}</td>
                    <td className="l muted">{s ? (/^\d+$/.test(s[5]) ? `P${s[5]}` : posText(s[5])) : ''}</td>
                    <td className="l muted">{r && isDnf(r) ? r[8] : r?.[9] === 1 ? `Fastest lap ${r[10] ?? ''}` : ''}</td>
                    <td>
                      {key && (
                        <button
                          className="btn small"
                          onClick={() => {
                            clock.setSession(key);
                            if (r?.[11]) clock.setSelected([r[11]]);
                            location.href = '/wall';
                          }}
                        >
                          Replay
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 11 }}>PL = started from the pit lane. Sprint points shown after the + sign.</p>
      </section>
    </>
  );
}

/** Jolpica's position codes: R retired, D disqualified, W withdrawn, N not classified, E excluded, F failed to qualify. */
function posText(t: string) {
  return ({ R: 'Ret', D: 'DSQ', W: 'DNS', N: 'NC', E: 'EX', F: 'DNQ' } as Record<string, string>)[t] ?? t;
}
