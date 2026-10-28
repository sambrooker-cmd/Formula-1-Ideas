// The start: grid to the end of lap 1 for this race, and how starts usually go at this circuit.
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { circuitStarts, lapOne, type PastStart } from '../data/starts';
import { seasonHistory } from '../data/history';
import { useNow } from '../hooks';
import { Panel } from './Panel';

/** Jolpica circuit id for this replay's race, via the season calendar (matched on date). */
async function circuitIdFor(data: SessionData) {
  const date = new Date(data.meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);
  const h = await seasonHistory(data.meta.session.year);
  const race = h.races.find((r) => Math.abs(Date.parse(r.date) - Date.parse(date)) <= 3 * 86_400e3);
  return race?.circuitId ?? null;
}

export function Starts({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const [past, setPast] = useState<PastStart[] | null | undefined>(undefined);
  const race = data.meta.session.type === 'Race';
  useEffect(() => {
    if (!race) return;
    circuitIdFor(data)
      .then((id) => (id ? circuitStarts(id) : null))
      .then(setPast, () => setPast(null));
  }, [data, race]);

  if (!race)
    return (
      <Panel title="The start" lead={lead} area={area} popout="/starts">
        <div className="center-msg">Start analysis is for races and sprints.</div>
      </Panel>
    );

  const lap1Done = data.lapStartTimes[2] != null && t >= data.lapStartTimes[2]!;
  const rows = lapOne(data);
  const code = (n: number) => data.drivers.get(n)?.code ?? '';
  const maxMove = Math.max(3, ...rows.map((r) => (r.lap1 ? Math.abs(r.grid - r.lap1) : 0)));

  return (
    <Panel title="The start" lead={lead} area={area} popout="/starts" bodyClass="scroll">
      <div className="pace-grid">
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>Grid → end of lap 1 (places gained or lost)</div>
          {!lap1Done ? (
            <div className="center-msg static">Appears once lap 1 is complete.</div>
          ) : (
            <div className="start-list">
              {[...rows]
                .sort((a, b) => a.grid - b.grid)
                .map((r) => {
                  const move = r.lap1 == null ? null : r.grid - r.lap1;
                  return (
                    <div key={r.driver} className="start-row">
                      <span className="num dim">P{r.grid}</span>
                      <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
                      <b>{code(r.driver)}</b>
                      <span className="start-bar">
                        {move != null && move !== 0 && (
                          <i
                            className={move > 0 ? 'gain' : 'loss'}
                            style={{ width: `${(Math.abs(move) / maxMove) * 50}%`, [move > 0 ? 'left' : 'right']: '50%' } as React.CSSProperties}
                          />
                        )}
                      </span>
                      <span className={'num ' + (move == null ? 'bad' : move > 0 ? 'good' : move < 0 ? 'bad' : 'dim')}>
                        {move == null ? 'out' : move > 0 ? `+${move}` : move < 0 ? `${move}` : '='}
                      </span>
                      <span className="num muted">{r.lap1 ? `P${r.lap1}` : ''}</span>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 6 }}>Starts here in recent years</div>
          {past === undefined && <div className="dim">Loading history…</div>}
          {past === null && <div className="dim">History isn't available for this circuit.</div>}
          {past && past.length > 0 && (
            <>
              <p style={{ margin: '0 0 8px' }}>
                Pole led after lap 1 in <b>{past.filter((p) => p.poleKept).length} of {past.length}</b> races. On average each car moved{' '}
                <b>{(past.reduce((s, p) => s + p.avgChange, 0) / past.length).toFixed(1)}</b> places on lap 1
                {past.some((p) => p.lap1Out.length) ? `, and ${past.filter((p) => p.lap1Out.length).length} of the starts had a first-lap retirement` : ''}.
              </p>
              <table className="lr-table">
                <tbody>
                  {past.map((p) => (
                    <tr key={`${p.year}-${p.round}`}>
                      <td className="num dim">{p.year}</td>
                      <td>{p.poleKept ? <span className="good">pole held</span> : <span>{p.leader.split(' ').at(-1)} led</span>}</td>
                      <td className="muted">{p.biggestGain ? `${p.biggestGain.driver.split(' ').at(-1)} +${p.biggestGain.from - p.biggestGain.to}` : ''}</td>
                      <td className="bad">{p.lap1Out.map((x) => x.split(' ').at(-1)).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dim" style={{ fontSize: 11 }}>Who led after lap 1, the biggest climb, and anyone out on lap 1. From Jolpica.</p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
