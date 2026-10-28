// Predictions: pick the podium before each race and score yourself over the season. Private.
import { finishedRaces, SpoilerGate } from './Spoilers';
import { useEffect, useMemo, useState } from 'react';
import { completedRounds, fullName, type SeasonHistory } from '../data/history';
import { loadUserData, saveUserData } from '../data/userstore';
import { DocShell, go, Loading, param, teamColour, thisYear, Tile, useHistory, YearSelect } from './Explore';
import { LineChart } from './LineChart';

type Picks = Record<string, Record<string, { podium: string[]; at: number }>>;
const KEY = 'predictions';

/** 3 points for the right driver in the right place, 1 for a podium finisher in the wrong place. */
export function score(pick: string[], actual: string[]) {
  let pts = 0;
  const detail = pick.map((id, i) => {
    if (!id) return 'none' as const;
    if (actual[i] === id) {
      pts += 3;
      return 'exact' as const;
    }
    if (actual.includes(id)) {
      pts += 1;
      return 'podium' as const;
    }
    return 'miss' as const;
  });
  return { pts, detail };
}

export function PredictionsPage() {
  const year = Number(param('year')) || thisYear();
  const { h, error } = useHistory(year);
  return (
    <DocShell active="predictions">
      <div className="doc-head">
        <h1>Predictions</h1>
        <YearSelect year={year} onChange={(y) => go({ year: y })} />
      </div>
      <Loading h={h} error={error} what={`the ${year} season`} />
      {h && (
        <SpoilerGate races={finishedRaces(h)} what="Your prediction scores">
          <Body h={h} />
        </SpoilerGate>
      )}
    </DocShell>
  );
}

function Body({ h }: { h: SeasonHistory }) {
  const [picks, setPicks] = useState<Picks | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    loadUserData<Picks>(KEY).then((p) => setPicks(p ?? {}));
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const done = completedRounds(h);
  const lastRound = done.at(-1);
  // Drivers to choose from: the most recent race's entry list (or everyone this season).
  const field = useMemo(() => {
    const recent = lastRound != null ? h.results.filter((r) => r[0] === lastRound) : [];
    const ids = recent.length ? recent.map((r) => ({ id: r[1], team: r[2] })) : Object.keys(h.drivers).map((id) => ({ id, team: '' }));
    return ids.sort((a, b) => h.drivers[a.id].family.localeCompare(h.drivers[b.id].family));
  }, [h, lastRound]);

  if (!picks) return <div className="center-msg static">Loading your predictions…</div>;
  const mine = picks[h.year] ?? {};
  const actualPodium = (round: number) =>
    h.results
      .filter((r) => r[0] === round && r[4] != null && r[4] <= 3)
      .sort((a, b) => a[4]! - b[4]!)
      .map((r) => r[1]);

  const upcoming = h.races.filter((r) => Date.parse(r.start) > now);
  const next = upcoming[0];
  const scored = h.races
    .filter((r) => done.includes(r.round) && mine[r.round]?.podium?.some(Boolean))
    .map((r) => ({ race: r, pick: mine[r.round].podium, actual: actualPodium(r.round), ...score(mine[r.round].podium, actualPodium(r.round)) }));
  const total = scored.reduce((s, x) => s + x.pts, 0);
  const exact = scored.reduce((s, x) => s + x.detail.filter((d) => d === 'exact').length, 0);
  const winners = scored.filter((x) => x.detail[0] === 'exact').length;

  const save = (round: number, podium: string[]) => {
    const next: Picks = { ...picks, [h.year]: { ...mine, [round]: { podium, at: Date.now() } } };
    setPicks(next);
    void saveUserData(KEY, next);
  };

  let cum = 0;
  const cumulative = done.map((round) => {
    const s = scored.find((x) => x.race.round === round);
    cum += s?.pts ?? 0;
    return cum;
  });

  return (
    <>
      <div className="tiles">
        <Tile label="Your score" value={total} sub={`from ${scored.length} race${scored.length === 1 ? '' : 's'}`} />
        <Tile label="Average" value={scored.length ? (total / scored.length).toFixed(1) : '–'} sub="points per race (max 9)" />
        <Tile label="Winners called" value={`${winners}/${scored.length}`} />
        <Tile label="Exact positions" value={exact} />
      </div>

      {next ? (
        <section className="doc-section">
          <h2>
            Round {next.round}: {next.name}
          </h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Lights out {new Date(next.start).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}. Picks
            lock then.
          </p>
          <PodiumPicker h={h} field={field} value={mine[next.round]?.podium ?? ['', '', '']} onChange={(p) => save(next.round, p)} />
          {upcoming.length > 1 && (
            <details className="later">
              <summary className="muted">Pick later races too</summary>
              {upcoming.slice(1).map((r) => (
                <div key={r.round} className="later-row">
                  <span className="muted">
                    R{r.round} {r.name.replace(' Grand Prix', ' GP')}
                  </span>
                  <PodiumPicker h={h} field={field} value={mine[r.round]?.podium ?? ['', '', '']} onChange={(p) => save(r.round, p)} compact />
                </div>
              ))}
            </details>
          )}
        </section>
      ) : (
        <p className="muted">The {h.year} season is over.</p>
      )}

      {done.length > 0 && scored.length > 0 && (
        <section className="doc-section">
          <h2>Your season</h2>
          <LineChart series={[{ id: 's', label: 'points', colour: '#ff4d2e', values: cumulative, fill: true }]} xLabels={done.map((r) => `R${r}`)} height={160} yMin={0} />
        </section>
      )}

      <section className="doc-section">
        <h2>Race by race</h2>
        <div className="table-scroll">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Rd</th>
                <th className="l">Grand Prix</th>
                <th className="l">Your podium</th>
                <th className="l">Actual podium</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {h.races
                .filter((r) => done.includes(r.round))
                .map((r) => {
                  const pick = mine[r.round]?.podium;
                  const actual = actualPodium(r.round);
                  const s = pick?.some(Boolean) ? score(pick, actual) : null;
                  return (
                    <tr key={r.round}>
                      <td className="num dim">{r.round}</td>
                      <td className="l">{r.name.replace(' Grand Prix', ' GP')}</td>
                      <td className="l">
                        {s ? (
                          pick!.map((id, i) => (
                            <span key={i} className={'pick-chip ' + s.detail[i]}>
                              {h.drivers[id]?.code ?? '–'}
                            </span>
                          ))
                        ) : (
                          <span className="dim">no prediction</span>
                        )}
                      </td>
                      <td className="l muted">{actual.map((id) => h.drivers[id]?.code).join(' · ')}</td>
                      <td className="num strong">{s ? s.pts : ''}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 11 }}>
          3 points for the right driver in the right place, 1 for a driver who made the podium in a different place. Green: exact · amber: on the podium · grey:
          missed. Your picks are private: saved on this Mac's Pit Wall (or your account on the hosted site), with a copy in this browser.
        </p>
      </section>
    </>
  );
}

function PodiumPicker({
  h,
  field,
  value,
  onChange,
  compact = false,
}: {
  h: SeasonHistory;
  field: { id: string; team: string }[];
  value: string[];
  onChange: (p: string[]) => void;
  compact?: boolean;
}) {
  return (
    <div className={'podium-pick' + (compact ? ' compact' : '')}>
      {[0, 1, 2].map((i) => (
        <label key={i} className="podium-slot">
          <span className="podium-num">P{i + 1}</span>
          <i style={{ background: teamColour(field.find((f) => f.id === value[i])?.team ?? '') }} />
          <select
            className="lap-jump"
            value={value[i] ?? ''}
            onChange={(e) => {
              const next = [...value];
              next[i] = e.target.value;
              // Same driver can't be in two places.
              next.forEach((v, k) => k !== i && v === e.target.value && (next[k] = ''));
              onChange(next);
            }}
          >
            <option value="">Choose…</option>
            {field.map((f) => (
              <option key={f.id} value={f.id}>
                {compact ? h.drivers[f.id].code : fullName(h.drivers[f.id])}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
