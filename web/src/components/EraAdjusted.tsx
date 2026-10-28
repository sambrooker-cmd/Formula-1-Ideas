// Head to head: the era-adjusted view, judging each driver against their own team-mates
// (data/eras.ts), the one comparison where the car is the same.
import { useEffect, useState } from 'react';
import type { Career } from '../data/career';
import { mateRecord, type MateRecord } from '../data/eras';

const pct = ([a, b]: [number, number]) => (a + b ? Math.round((a / (a + b)) * 100) : null);

function useRecord(c: Career) {
  const [rec, setRec] = useState<MateRecord | null | undefined>(undefined);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    let on = true;
    setRec(undefined);
    mateRecord(c, (d, t) => on && setProgress([d, t])).then((r) => on && setRec(r), () => on && setRec(null));
    return () => {
      on = false;
    };
  }, [c]);
  return { rec, progress };
}

export function EraAdjusted({ a, b, colourA, colourB }: { a: Career; b: Career; colourA: string; colourB: string }) {
  const ra = useRecord(a);
  const rb = useRecord(b);
  const [open, setOpen] = useState<'a' | 'b' | null>(null);
  const loading = ra.rec === undefined || rb.rec === undefined;
  const A = ra.rec;
  const B = rb.rec;

  const rows: [string, number | null, number | null, string][] = A && B
    ? [
        ['Beat team-mate in qualifying', pct(A.quali), pct(B.quali), `${A.quali[0]}–${A.quali[1]} · ${B.quali[0]}–${B.quali[1]}`],
        ['Beat team-mate in races', pct(A.race), pct(B.race), `${A.race[0]}–${A.race[1]} · ${B.race[0]}–${B.race[1]}`],
        ['Share of team points (equal = 50)', A.share != null ? Math.round(A.share) : null, B.share != null ? Math.round(B.share) : null, ''],
      ]
    : [];

  return (
    <section className="doc-section">
      <h2>Era-adjusted: against their team-mates</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Titles and wins mostly measure the car. The one rival with the same car is the team-mate, so this compares how much each driver beat theirs, season by
        season. It works across eras, though it flatters drivers with weak team-mates.
      </p>
      {loading ? (
        <div className="dim">
          Loading every team-mate's results… ({ra.progress[0] + rb.progress[0]} of {ra.progress[1] + rb.progress[1] || '…'} seasons)
        </div>
      ) : !A || !B ? (
        <div className="dim">Team-mate results aren't available right now.</div>
      ) : (
        <>
          <div className="era-index">
            <div style={{ color: colourA }}>
              <span className="era-num">{A.index != null ? Math.round(A.index) : '–'}</span>
              <span className="muted">{a.driver.name}</span>
            </div>
            <div className="dim" style={{ alignSelf: 'center', fontSize: 12 }}>
              team-mate index
              <br />
              (50 = level)
            </div>
            <div style={{ color: colourB, textAlign: 'right' }}>
              <span className="era-num">{B.index != null ? Math.round(B.index) : '–'}</span>
              <span className="muted">{b.driver.name}</span>
            </div>
          </div>
          <table className="doc-table h2h-career">
            <tbody>
              {rows.map(([label, x, y, detail]) => (
                <tr key={label}>
                  <td className="l num" style={x != null && y != null && x > y ? { color: colourA, fontWeight: 700 } : undefined}>
                    {x == null ? '–' : `${x}%`}
                  </td>
                  <td className="h2h-label-cell">
                    {label}
                    {detail && <div className="dim" style={{ fontSize: 10 }}>{detail}</div>}
                  </td>
                  <td className="num" style={x != null && y != null && y > x ? { color: colourB, fontWeight: 700 } : undefined}>
                    {y == null ? '–' : `${y}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className={'btn' + (open === 'a' ? ' primary' : '')} onClick={() => setOpen(open === 'a' ? null : 'a')}>
              {a.driver.name}: season by season
            </button>
            <button className={'btn' + (open === 'b' ? ' primary' : '')} onClick={() => setOpen(open === 'b' ? null : 'b')}>
              {b.driver.name}: season by season
            </button>
          </div>
          {open && <Seasons rec={open === 'a' ? A : B} />}
          <p className="dim" style={{ fontSize: 11 }}>
            Qualifying uses grid positions (qualifying times only go back to 1994), so grid penalties count. Races count only when both finished. The index is the
            average of the three figures.
          </p>
        </>
      )}
    </section>
  );
}

function Seasons({ rec }: { rec: MateRecord }) {
  return (
    <div className="table-scroll" style={{ marginTop: 8 }}>
      <table className="lr-table">
        <thead>
          <tr>
            <th>Season</th>
            <th>Team</th>
            <th>Team-mates</th>
            <th className="num">Qualifying</th>
            <th className="num">Races</th>
            <th className="num">Points share</th>
          </tr>
        </thead>
        <tbody>
          {rec.seasons.map((s) => (
            <tr key={`${s.year}-${s.team}`}>
              <td className="num">{s.year}</td>
              <td>{s.team}</td>
              <td className="muted">{s.mates.join(', ')}</td>
              <td className={'num ' + (s.quali[0] > s.quali[1] ? 'good' : s.quali[0] < s.quali[1] ? 'bad' : '')}>
                {s.quali[0]}–{s.quali[1]}
              </td>
              <td className={'num ' + (s.race[0] > s.race[1] ? 'good' : s.race[0] < s.race[1] ? 'bad' : '')}>
                {s.race[0]}–{s.race[1]}
              </td>
              <td className="num">{s.share != null ? Math.round(s.share) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
