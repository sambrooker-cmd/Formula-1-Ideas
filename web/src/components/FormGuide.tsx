// Season stats section: who's in form, from a rating for every race (data/form.ts).
import { useMemo, useState } from 'react';
import { fullName, type SeasonHistory } from '../data/history';
import { formGuide } from '../data/form';
import { links, teamColour } from './Explore';

export function FormGuide({ h }: { h: SeasonHistory }) {
  const rows = useMemo(() => formGuide(h), [h]);
  const [all, setAll] = useState(false);
  if (rows.length < 3) return null;
  const raceName = (round: number) => h.races.find((r) => r.round === round)?.name.replace(' Grand Prix', ' GP') ?? `Round ${round}`;
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <section className="doc-section">
      <h2>Form guide</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        A mark out of 10 for each race, averaged over each driver's last five. Hot: <b className="text">{rows.slice(0, 3).map((r) => h.drivers[r.id]?.code).join(', ')}</b>.
        {(() => {
          const rising = rows.filter((r) => r.before != null).sort((a, b) => b.recent - b.before! - (a.recent - a.before!))[0];
          return rising && rising.recent - rising.before! > 0.3 ? <> Most improved: <b className="text">{h.drivers[rising.id]?.code}</b> (+{(rising.recent - rising.before!).toFixed(1)}).</> : null;
        })()}
      </p>
      <div className="table-scroll">
        <table className="lr-table form-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Last five</th>
              <th className="num">Form</th>
              <th className="num">Trend</th>
              <th className="num">Season</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const trend = r.before == null ? null : r.recent - r.before;
              return (
                <tr key={r.id}>
                  <td>
                    <i className="team-bar" style={{ background: teamColour(r.team) }} />
                    <a href={links.driver(h.year, r.id)}>{fullName(h.drivers[r.id])}</a>
                  </td>
                  <td>
                    <span className="form-bars">
                      {r.races.slice(-5).map((x) => (
                        <i
                          key={x.round}
                          title={`${raceName(x.round)}: ${x.finish ? `P${x.finish}` : 'did not finish'} · ${x.score.toFixed(1)}`}
                          style={{ height: `${Math.max(8, ((x.score - 2) / 8) * 100)}%`, background: x.score >= 8 ? 'var(--green)' : x.score >= 6 ? 'var(--muted)' : 'var(--red)' }}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="num">
                    <b>{r.recent.toFixed(1)}</b>
                  </td>
                  <td className={'num ' + (trend == null ? 'dim' : trend > 0.2 ? 'good' : trend < -0.2 ? 'bad' : 'dim')}>
                    {trend == null ? '–' : trend > 0.2 ? `▲ ${trend.toFixed(1)}` : trend < -0.2 ? `▼ ${(-trend).toFixed(1)}` : '='}
                  </td>
                  <td className="num muted">{r.season.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 10 && (
        <button className="btn" onClick={() => setAll(!all)}>
          {all ? 'Show top 10' : `Show all ${rows.length}`}
        </button>
      )}
      <p className="dim" style={{ fontSize: 11 }}>
        From results only: where they finished, places gained, and against their team-mate (qualifying and race). The race ratings in a replay also count pace and
        overtakes. Trend compares with the five races before.
      </p>
    </section>
  );
}
