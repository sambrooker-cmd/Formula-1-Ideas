// The automatic race report as a readable page, with the full classification underneath.
import { useEffect, useMemo, useState } from 'react';
import type { SessionData } from '../data/session';
import { buildReport, surname, type ChampBefore } from '../data/report';
import { now } from '../sync/clock';
import { loadBefore } from './Championship';

export function RaceReport({ data }: { data: SessionData }) {
  const { meta } = data;
  const race = meta.session.type === 'Race';
  const sprint = /sprint/i.test(meta.session.name);
  // It's a spoiler: only show it straight away if you've already watched to the end.
  const [reveal, setReveal] = useState(() => now() >= meta.raceEnd - 60_000);
  const [champ, setChamp] = useState<ChampBefore | null>(null);

  useEffect(() => {
    if (!race) return;
    const date = new Date(meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);
    loadBefore(meta.session.year, date, sprint ? 'sprint' : 'race').then(setChamp, () => setChamp(null));
  }, [meta, race, sprint]);

  const report = useMemo(() => buildReport(data, champ), [data, champ]);

  if (!report)
    return (
      <div className="center-msg">
        Reports are written for races, sprints and qualifying. Practice sessions have long-run analysis instead.
      </div>
    );

  if (!reveal)
    return (
      <div className="center-msg">
        <div>
          <p>This report gives away the result.</p>
          <button className="btn primary" onClick={() => setReveal(true)}>
            Show the report
          </button>
        </div>
      </div>
    );

  const grid = new Map(meta.grid.map(([n, p]) => [n, p]));
  const results = [...meta.results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));

  return (
    <article className="report">
      <div className="report-kicker">
        {meta.session.year} {meta.session.meetingName} · {meta.session.name} · {meta.session.circuit}
      </div>
      <h1>{report.headline}</h1>
      <p className="report-standfirst">{report.standfirst}</p>
      <dl className="report-facts">
        {report.facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
      {report.sections.map((s) => (
        <section key={s.title}>
          <h2>{s.title}</h2>
          {s.paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}

      <section>
        <h2>Classification</h2>
        <table className="report-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Driver</th>
              <th>Team</th>
              {race && <th>Grid</th>}
              <th>{race ? 'Gap' : 'Laps'}</th>
              {race && <th>Pts</th>}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const d = data.drivers.get(r.driver);
              const g = grid.get(r.driver);
              const moved = g != null && r.position != null ? g - r.position : null;
              return (
                <tr key={r.driver}>
                  <td className="num">{r.position ?? r.status}</td>
                  <td>
                    <i className="team-bar" style={{ background: d?.colour }} />
                    {d ? surname(d.name) : r.driver}
                  </td>
                  <td className="muted">{d?.team}</td>
                  {race && (
                    <td className="num">
                      {g ?? '–'}
                      {moved ? <span className={moved > 0 ? 'good' : 'bad'}> {moved > 0 ? `▲${moved}` : `▼${-moved}`}</span> : null}
                    </td>
                  )}
                  <td className="num">{race ? (r.status !== 'FINISHED' ? r.status : r.position === 1 ? '' : fmtGap(r.gap)) : r.laps}</td>
                  {race && <td className="num">{r.points || ''}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p className="dim report-foot">
        Written automatically from the timing data. <button className="icon-btn" onClick={() => window.print()}>Print / save as PDF</button>
      </p>
    </article>
  );
}

function fmtGap(g: string | null) {
  if (!g) return '';
  const s = g.replace(/"/g, '');
  return /^\d/.test(s) ? `+${s}` : s;
}
