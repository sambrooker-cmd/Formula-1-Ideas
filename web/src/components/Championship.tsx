import { useEffect, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { overallBestAt, tower } from '../data/state';
import { useNow } from '../hooks';
import { Panel } from './Panel';

const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

interface Before {
  round: number;
  raceName: string;
  drivers: { code: string; name: string; team: string; points: number }[];
  constructors: { name: string; points: number }[];
}

const cache = new Map<string, Promise<Before>>();
function loadBefore(year: number, date: string, kind: string) {
  const key = `${year}|${date}|${kind}`;
  if (!cache.has(key)) {
    const p = fetch(`/api/standings-before?year=${year}&date=${date}&kind=${kind}`).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Could not load standings');
      return body as Before;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

/** Team names differ slightly between sources ("Red Bull Racing" vs "Red Bull"): match on the first word. */
const sameTeam = (a: string, b: string) => {
  const first = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').split(' ')[0];
  return first(a) === first(b);
};

/** The championships if this race finished right now. */
export function Championship({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const [before, setBefore] = useState<Before | null>(null);
  const [error, setError] = useState('');
  const sprint = /sprint/i.test(data.meta.session.name);
  const scoring = data.meta.session.type === 'Race';
  const date = new Date(data.meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);

  useEffect(() => {
    if (!scoring) return;
    loadBefore(data.meta.session.year, date, sprint ? 'sprint' : 'race').then(setBefore, (e) => setError(String(e.message ?? e)));
  }, [data, date, sprint, scoring]);

  let body: ReactNode;
  if (!scoring) body = <div className="center-msg">Championship points are only scored in races and sprints.</div>;
  else if (error) body = <div className="center-msg">{error}</div>;
  else if (!before) body = <div className="center-msg">Loading standings…</div>;
  else {
    const table = sprint ? SPRINT_POINTS : RACE_POINTS;
    const rows = tower(data, t).filter((r) => !r.out && r.position < 99);
    const started = t >= data.meta.raceStart;
    // Fastest-lap bonus point (2019–2024 only, and only for a top-10 finisher).
    const fl = !sprint && data.meta.session.year <= 2024 ? overallBestAt(data, t) : null;

    const gain = new Map<string, number>();
    const teamOf = new Map(before.drivers.map((d) => [d.code, d.team]));
    if (started) {
      rows.forEach((r, i) => {
        const code = data.drivers.get(r.driver)?.code ?? '';
        let pts = table[i] ?? 0;
        if (fl && fl.driver === r.driver && i < 10) pts += 1;
        if (pts) gain.set(code, pts);
        if (!teamOf.has(code)) teamOf.set(code, data.drivers.get(r.driver)?.team ?? '');
      });
    }
    const drivers = [...before.drivers];
    for (const code of gain.keys()) {
      if (!drivers.some((d) => d.code === code)) drivers.push({ code, name: code, team: teamOf.get(code) ?? '', points: 0 });
    }
    const beforeRank = new Map([...drivers].sort((a, b) => b.points - a.points).map((d, i) => [d.code, i + 1]));
    const now = drivers
      .map((d) => ({ ...d, gain: gain.get(d.code) ?? 0, total: d.points + (gain.get(d.code) ?? 0) }))
      .sort((a, b) => b.total - a.total);

    const teamGain = new Map<string, number>();
    for (const [code, pts] of gain) {
      const team = before.constructors.find((c) => sameTeam(c.name, teamOf.get(code) ?? ''))?.name ?? teamOf.get(code) ?? '';
      teamGain.set(team, (teamGain.get(team) ?? 0) + pts);
    }
    const teams = [...before.constructors];
    for (const name of teamGain.keys()) if (!teams.some((c) => c.name === name)) teams.push({ name, points: 0 });
    const teamBeforeRank = new Map([...teams].sort((a, b) => b.points - a.points).map((c, i) => [c.name, i + 1]));
    const teamsNow = teams.map((c) => ({ ...c, gain: teamGain.get(c.name) ?? 0, total: c.points + (teamGain.get(c.name) ?? 0) })).sort((a, b) => b.total - a.total);
    const leader = now[0];

    const move = (was: number | undefined, is: number) =>
      was == null || was === is ? <span className="dim">–</span> : was > is ? <span className="green">▲{was - is}</span> : <span style={{ color: 'var(--red)' }}>▼{is - was}</span>;

    body = (
      <div className="champ">
        <div className="champ-note">
          {started ? (
            <>
              If the {sprint ? 'sprint' : 'race'} finished now: <b>{leader.code}</b> leads by <b>{leader.total - (now[1]?.total ?? 0)}</b>
            </>
          ) : (
            <>Standings going into round {before.round}, {before.raceName}</>
          )}
        </div>
        <div className="champ-grid">
          <table className="tower">
            <thead>
              <tr>
                <th className="l" style={{ textAlign: 'center' }}>P</th>
                <th />
                <th className="l">Driver</th>
                <th>Before</th>
                <th>Race</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {now.slice(0, 12).map((d, i) => (
                <tr key={d.code} style={{ cursor: 'default' }} title={d.name}>
                  <td className="pos num">{i + 1}</td>
                  <td className="num" style={{ fontSize: 11 }}>{move(beforeRank.get(d.code), i + 1)}</td>
                  <td className="l"><b>{d.code}</b> <span className="muted" style={{ fontSize: 11 }}>{d.team}</span></td>
                  <td className="num muted">{d.points}</td>
                  <td className={'num ' + (d.gain ? 'green' : 'dim')}>{d.gain ? '+' + d.gain : ''}</td>
                  <td className="num"><b>{d.total}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="tower">
            <thead>
              <tr>
                <th className="l" style={{ textAlign: 'center' }}>P</th>
                <th />
                <th className="l">Team</th>
                <th>Race</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {teamsNow.map((c, i) => (
                <tr key={c.name} style={{ cursor: 'default' }}>
                  <td className="pos num">{i + 1}</td>
                  <td className="num" style={{ fontSize: 11 }}>{move(teamBeforeRank.get(c.name), i + 1)}</td>
                  <td className="l"><b>{c.name}</b></td>
                  <td className={'num ' + (c.gain ? 'green' : 'dim')}>{c.gain ? '+' + c.gain : ''}</td>
                  <td className="num"><b>{c.total}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <Panel title="Championship" lead={lead} area={area} popout="/championship" bodyClass="scroll">
      {body}
    </Panel>
  );
}
