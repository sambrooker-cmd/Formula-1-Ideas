// Season stats section: the pit stop league table (data/pitstops.ts).
import { useEffect, useMemo, useState } from 'react';
import type { SeasonHistory } from '../data/history';
import { seasonStops, teamStops, type Stop } from '../data/pitstops';
import { teamColour } from './Explore';

export function PitStopTable({ h }: { h: SeasonHistory }) {
  const [stops, setStops] = useState<Stop[] | null | undefined>(undefined);
  useEffect(() => {
    let on = true;
    setStops(undefined);
    seasonStops(h).then((s) => on && setStops(s), () => on && setStops(null));
    return () => {
      on = false;
    };
  }, [h]);
  const table = useMemo(() => (stops ? teamStops(stops) : []), [stops]);
  const raceName = (round: number) => h.races.find((r) => r.round === round)?.name.replace(' Grand Prix', ' GP') ?? `Round ${round}`;
  const code = (id: string) => h.drivers[id]?.code ?? id;

  return (
    <section className="doc-section">
      <h2>Pit stops</h2>
      {stops === undefined && <div className="dim">Loading every stop of the season…</div>}
      {stops === null && <div className="dim">Pit stop data isn't available right now.</div>}
      {stops && table.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Each stop is timed from pit entry to exit and compared with the typical stop at the same race, so slow and quick pit lanes even out. Quickest crew
            on average: <b className="text">{h.teams[table[0].team]}</b>.
          </p>
          <div className="table-scroll">
            <table className="lr-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th className="num">Stops</th>
                  <th className="num">Against typical</th>
                  <th>Best stop</th>
                  <th className="num">Quickest of the race</th>
                  <th className="num">Slow stops</th>
                </tr>
              </thead>
              <tbody>
                {table.map((t, i) => (
                  <tr key={t.team}>
                    <td>
                      <span className="num dim" style={{ display: 'inline-block', width: 20 }}>{i + 1}</span>
                      <i className="team-bar" style={{ background: teamColour(t.team) }} />
                      {h.teams[t.team] ?? t.team}
                    </td>
                    <td className="num">{t.stops}</td>
                    <td className={'num ' + (t.median < -0.2 ? 'good' : t.median > 0.2 ? 'bad' : '')}>
                      {t.median > 0 ? '+' : ''}
                      {t.median.toFixed(2)} s
                    </td>
                    <td className="muted">
                      {t.best ? `${(-t.best.delta).toFixed(1)} s under typical (${t.best.lane.toFixed(1)} s) · ${code(t.best.driver)}, ${raceName(t.best.round)}` : '–'}
                    </td>
                    <td className="num">{t.fastestOfRace || ''}</td>
                    <td className={'num ' + (t.slow ? 'bad' : 'dim')}>{t.slow || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="dim" style={{ fontSize: 11 }}>
            Pit lane times from Jolpica (the time stationary isn't published for every race). Slow stops: more than 2 s over typical. Stops 8 s or more over (repairs,
            penalties served, red flags) are left out of the averages.
          </p>
        </>
      )}
    </section>
  );
}
