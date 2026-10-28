// Career head-to-head: any two drivers since 1950, side by side.
import { useEffect, useMemo, useState } from 'react';
import { allDrivers, career, careerStats, versus, type Career, type CareerDriver } from '../data/career';
import { jolpicaProgress } from '../data/history';
import { DocShell, go, H2HBar, ordinal, param } from './Explore';
import { LineChart } from './LineChart';

const A_COLOUR = '#ff8a3d';
const B_COLOUR = '#3fa7ff';

export function CareerH2HPage() {
  const a = param('a') ?? 'hamilton';
  const b = param('b') ?? 'max_verstappen';
  const [drivers, setDrivers] = useState<CareerDriver[]>([]);
  const [ca, setCa] = useState<Career | null>(null);
  const [cb, setCb] = useState<Career | null>(null);
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    allDrivers().then(setDrivers, () => {});
    career(a).then(setCa, (e) => setError(String(e.message ?? e)));
    career(b).then(setCb, (e) => setError(String(e.message ?? e)));
  }, [a, b]);
  useEffect(() => {
    if (ca && cb) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [ca, cb]);

  return (
    <DocShell active="h2h">
      <div className="doc-head">
        <h1>Head to head</h1>
      </div>
      <div className="doc-head">
        <DriverSearch drivers={drivers} value={a} colour={A_COLOUR} onPick={(id) => go({ a: id })} />
        <span className="dim">vs</span>
        <DriverSearch drivers={drivers} value={b} colour={B_COLOUR} onPick={(id) => go({ b: id })} />
      </div>
      {error && <div className="center-msg static">{error}</div>}
      {!error && (!ca || !cb) && (
        <div className="center-msg static">
          Loading both careers… <span className="dim">({jolpicaProgress.done} requests so far; about 6 per driver the first time, then saved in this browser)</span>
        </div>
      )}
      {ca && cb && <Body a={ca} b={cb} />}
    </DocShell>
  );
}

function DriverSearch({ drivers, value, colour, onPick }: { drivers: CareerDriver[]; value: string; colour: string; onPick: (id: string) => void }) {
  const current = drivers.find((d) => d.id === value);
  const [text, setText] = useState('');
  useEffect(() => setText(current ? current.name : value), [current, value]);
  const listId = `drivers-${colour.slice(1)}`;
  return (
    <span className="lap-pick">
      <i className="h2h-dot" style={{ background: colour }} />
      <input
        className="h2h-search"
        list={listId}
        value={text}
        placeholder="Type a driver's name"
        onChange={(e) => {
          setText(e.target.value);
          const hit = drivers.find((d) => d.name.toLowerCase() === e.target.value.toLowerCase());
          if (hit) onPick(hit.id);
        }}
      />
      <datalist id={listId}>
        {drivers.map((d) => (
          <option key={d.id} value={d.name}>
            {d.nationality}
          </option>
        ))}
      </datalist>
    </span>
  );
}

function Body({ a, b }: { a: Career; b: Career }) {
  const sa = useMemo(() => careerStats(a), [a]);
  const sb = useMemo(() => careerStats(b), [b]);
  const vs = useMemo(() => versus(a, b), [a, b]);
  const pct = (x: number, of: number) => (of ? `${Math.round((x / of) * 100)}%` : '–');
  const rows: [string, string | number, string | number, boolean?][] = [
    ['World titles', sa.titles, sb.titles],
    ['Seasons', sa.seasons.length, sb.seasons.length],
    ['Race starts', sa.starts, sb.starts],
    ['Wins', sa.wins, sb.wins],
    ['Win rate', pct(sa.wins, sa.starts), pct(sb.wins, sb.starts)],
    ['Podiums', sa.podiums, sb.podiums],
    ['Started from pole', sa.poles, sb.poles],
    ['Fastest laps', sa.fastestLaps, sb.fastestLaps],
    ['Points', Math.round(sa.points), Math.round(sb.points)],
    ['Did not finish', sa.dnfs, sb.dnfs, true],
    ['Average finish', sa.avgFinish?.toFixed(1) ?? '–', sb.avgFinish?.toFixed(1) ?? '–', true],
    ['Best championship', sa.bestChampionship ? ordinal(sa.bestChampionship) : '–', sb.bestChampionship ? ordinal(sb.bestChampionship) : '–', true],
  ];
  const better = (x: string | number, y: string | number, lower?: boolean) => {
    const nx = parseFloat(String(x));
    const ny = parseFloat(String(y));
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || nx === ny) return [false, false];
    return lower ? [nx < ny, ny < nx] : [nx > ny, ny > nx];
  };
  const years = [...new Set([...sa.seasons, ...sb.seasons])].sort((x, y) => x - y);
  const winsBy = (c: Career, y: number) => (c.races.some((r) => r[0] === y) ? c.races.filter((r) => r[0] === y && r[6] === 1).length : null);
  const champBy = (c: Career, y: number) => c.standings[y] ?? null;
  const race = (r: Career['races'][number] | null) => (r ? `${r[0]} ${r[2].replace(' Grand Prix', ' GP')}` : '–');

  return (
    <>
      <div className="h2h-table-wrap">
        <table className="doc-table h2h-career">
          <thead>
            <tr>
              <th className="l" style={{ color: A_COLOUR }}>{a.driver.name}</th>
              <th />
              <th style={{ color: B_COLOUR }}>{b.driver.name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, x, y, lower]) => {
              const [ba, bb] = better(x, y, lower);
              return (
                <tr key={label}>
                  <td className={'l num' + (ba ? ' strong' : '')} style={ba ? { color: A_COLOUR } : undefined}>{x}</td>
                  <td className="h2h-label-cell">{label}</td>
                  <td className={'num' + (bb ? ' strong' : '')} style={bb ? { color: B_COLOUR } : undefined}>{y}</td>
                </tr>
              );
            })}
            <tr>
              <td className="l muted">{race(sa.firstRace)}</td>
              <td className="h2h-label-cell">First race</td>
              <td className="muted">{race(sb.firstRace)}</td>
            </tr>
            <tr>
              <td className="l muted">{race(sa.firstWin)}</td>
              <td className="h2h-label-cell">First win</td>
              <td className="muted">{race(sb.firstWin)}</td>
            </tr>
            <tr>
              <td className="l muted wrap">{sa.teams.join(', ')}</td>
              <td className="h2h-label-cell">Teams</td>
              <td className="muted wrap">{sb.teams.join(', ')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="doc-section">
        <h2>When they raced each other</h2>
        {vs.met === 0 ? (
          <p className="muted">They never started the same race.</p>
        ) : (
          <div className="h2h-card wide">
            <p className="muted" style={{ marginTop: 0 }}>
              {vs.met} races together. Finishing ahead when both were classified:
            </p>
            <H2HBar label="Finished ahead" a={vs.ahead[0]} b={vs.ahead[1]} colourA={A_COLOUR} colourB={B_COLOUR} />
          </div>
        )}
      </section>

      {vs.mates.races > 0 && (
        <section className="doc-section">
          <h2>As team-mates</h2>
          <div className="h2h-card wide">
            <p className="muted" style={{ marginTop: 0 }}>
              {[...vs.mates.team].join(', ')}, {[...vs.mates.seasons].join(', ')} · {vs.mates.races} races
            </p>
            <H2HBar label="Grid (qualifying)" a={vs.mates.quali[0]} b={vs.mates.quali[1]} colourA={A_COLOUR} colourB={B_COLOUR} />
            <H2HBar label="Race (both finished)" a={vs.mates.race[0]} b={vs.mates.race[1]} colourA={A_COLOUR} colourB={B_COLOUR} />
            <H2HBar label="Points" a={Math.round(vs.mates.points[0])} b={Math.round(vs.mates.points[1])} colourA={A_COLOUR} colourB={B_COLOUR} />
          </div>
        </section>
      )}

      <section className="doc-section">
        <h2>Wins per season</h2>
        <LineChart
          series={[
            { id: 'a', label: a.driver.code, colour: A_COLOUR, values: years.map((y) => winsBy(a, y)) },
            { id: 'b', label: b.driver.code, colour: B_COLOUR, values: years.map((y) => winsBy(b, y)) },
          ]}
          xLabels={years.map(String)}
          xEvery={Math.ceil(years.length / 12)}
          height={200}
          yMin={0}
        />
      </section>
      <section className="doc-section">
        <h2>Championship position</h2>
        <LineChart
          series={[
            { id: 'a', label: a.driver.code, colour: A_COLOUR, values: years.map((y) => champBy(a, y)) },
            { id: 'b', label: b.driver.code, colour: B_COLOUR, values: years.map((y) => champBy(b, y)) },
          ]}
          xLabels={years.map(String)}
          xEvery={Math.ceil(years.length / 12)}
          height={200}
          invert
          yMin={1}
          yFormat={(v) => ordinal(Math.round(v))}
        />
      </section>
      <p className="dim" style={{ fontSize: 11 }}>
        From Jolpica (the Ergast database). "Started from pole" counts grid position 1, which can differ from pole after grid penalties. Fastest laps are only
        recorded from 2004.
      </p>
    </>
  );
}
