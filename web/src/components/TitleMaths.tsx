// Season stats section: who can still win each title, and what seals it at the next weekend.
import { useMemo } from 'react';
import type { SeasonHistory } from '../data/history';
import { titleMaths, type Scenario, type TitleMaths as Maths } from '../data/titlemaths';

export function TitleMaths({ h }: { h: SeasonHistory }) {
  const drivers = useMemo(() => titleMaths(h, 'drivers'), [h]);
  const teams = useMemo(() => titleMaths(h, 'teams'), [h]);
  if (drivers.done) return null;
  return (
    <section className="doc-section">
      <h2>Title maths</h2>
      <Block m={drivers} name={(id) => h.drivers[id]?.code ?? id} full={(id) => (h.drivers[id] ? `${h.drivers[id].given} ${h.drivers[id].family}` : id)} />
      <Block m={teams} name={(id) => h.teams[id] ?? id} full={(id) => h.teams[id] ?? id} />
      <p className="dim" style={{ fontSize: 11 }}>
        Points: 25-18-15-12-10-8-6-4-2-1 in races, 8 to 1 in sprints. Level on points, the title goes to whoever has more wins (then more second places, and so on).
      </p>
    </section>
  );
}

function Block({ m, name, full }: { m: Maths; name: (id: string) => string; full: (id: string) => string }) {
  const [leader, ...rest] = m.table;
  if (!leader) return null;
  const alive = rest.filter((c) => c.alive);
  const left = `${m.racesLeft} race${m.racesLeft === 1 ? '' : 's'}${m.sprintsLeft ? ` and ${m.sprintsLeft} sprint${m.sprintsLeft === 1 ? '' : 's'}` : ''}`;
  const title = m.kind === 'drivers' ? 'Drivers' : 'Constructors';
  return (
    <div className="title-block">
      <h3>{title}</h3>
      {alive.length === 0 ? (
        <p>
          <b className="text">{full(leader.id)}</b> {m.kind === 'drivers' ? 'is' : 'are'} champion: nobody can catch {m.kind === 'drivers' ? 'them' : 'them'} with {left} left.
        </p>
      ) : (
        <>
          <p>
            <b className="text">{full(leader.id)}</b> lead{m.kind === 'drivers' ? 's' : ''} by <b>{leader.points - rest[0].points}</b> with {left} to go ({m.maxLeft} points still
            available). Still in it: {alive.map((c) => `${name(c.id)} (−${c.behind})`).join(', ')}.
          </p>
          {m.next && m.clinchMargin != null && (
            <p>
              {m.clinchMargin <= m.next.weekendMax + leader.points - (rest[0]?.points ?? 0) ? (
                <>
                  {name(leader.id)} can seal it at the <b>{m.next.name}</b>
                  {m.next.sprint ? ' (sprint weekend)' : ''} by leaving it at least <b>{m.clinchMargin}</b> points clear of {alive.length === 1 ? name(alive[0].id) : 'everyone'}
                  {' '}(the lead is {leader.points - rest[0].points} now).
                </>
              ) : (
                <>It can't be settled at the {m.next.name}: too many points are still available after it.</>
              )}
            </p>
          )}
          {m.scenarios.length > 0 && m.scenarios.some((s) => s.possible) && <Scenarios m={m} name={name} />}
        </>
      )}
    </div>
  );
}

/** "P1–P8: champion whatever the others do" etc., grouping leader results with the same condition. */
function Scenarios({ m, name }: { m: Maths; name: (id: string) => string }) {
  const leader = name(m.table[0].id);
  const condition = (s: Scenario) => {
    if (!s.possible) return 'not enough';
    const needs = s.rivals.filter((r) => r.atBest !== null);
    if (!needs.length) return 'champion, whatever the others do';
    return (
      'champion unless ' +
      needs
        .map((r) => (r.atBest === 0 ? `${name(r.id)} scores` : r.atBest === 2 ? `${name(r.id)} wins` : `${name(r.id)} finishes in the top ${r.atBest! - 1}`))
        .join(' or ')
    );
  };
  const groups: { from: number; to: number; text: string }[] = [];
  for (const s of m.scenarios) {
    const text = condition(s);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.to = s.leaderPos;
    else groups.push({ from: s.leaderPos, to: s.leaderPos, text });
  }
  const label = (p: number) => (p === 0 ? 'out of the points' : `P${p}`);
  return (
    <table className="lr-table title-table">
      <tbody>
        {groups.map((g) => (
          <tr key={g.from}>
            <td className="muted">
              If {leader} finishes {g.from === g.to ? label(g.from) : g.to === 0 ? `P${g.from} or lower` : `${label(g.from)}–${label(g.to)}`}
            </td>
            <td className={g.text === 'not enough' ? 'dim' : g.text.startsWith('champion,') ? 'good' : ''}>{g.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
