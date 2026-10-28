// Driver ratings panel: every driver's score for the race, with the reasons behind it.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { raceRatings } from '../data/ratings';
import { useNow } from '../hooks';
import { Panel } from './Panel';

export function Ratings({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  const [reveal, setReveal] = useState(false);
  const ratings = useMemo(() => raceRatings(data), [data]);
  const over = t >= data.meta.raceEnd - 60_000;
  const code = (n: number) => data.drivers.get(n)?.code ?? '';

  let body: ReactNode;
  if (data.meta.session.type !== 'Race') body = <div className="center-msg">Ratings are for races and sprints.</div>;
  else if (!ratings.length) body = <div className="center-msg">Ratings appear once the race has a result.</div>;
  else if (!over && !reveal)
    body = (
      <div className="center-msg">
        <div>
          <p>Ratings give away the result.</p>
          <button className="btn primary" onClick={() => setReveal(true)}>
            Show ratings
          </button>
        </div>
      </div>
    );
  else
    body = (
      <ul className="ratings">
        {ratings.map((r, i) => (
          <li key={r.driver} className="rating-row">
            <span className="num dim">{i + 1}</span>
            <span className={'rating-score num ' + (r.score >= 8 ? 'top' : r.score < 5 ? 'low' : '')}>{r.score.toFixed(1)}</span>
            <span>
              <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
              <b>{code(r.driver)}</b> <span className="dim">{r.finish ? `P${r.finish}` : r.status}</span>
            </span>
            <span className="rating-reasons">
              {r.reasons.map((x) => (
                <span key={x.text} className={'rating-chip ' + (x.points > 0 ? 'up' : 'down')} title={`${x.points > 0 ? '+' : ''}${x.points}`}>
                  {x.text}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <Panel title="Driver ratings" lead={lead} area={area} popout="/ratings" bodyClass="scroll">
      {body}
      {(over || reveal) && ratings.length > 0 && (
        <p className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
          Everyone starts on 6. Points for the result, places gained, beating the team-mate (grid, finish and clean-air pace), net on-track passes, and off for
          penalties. A guide from the timing data, not a judgement of racecraft. Hover a reason for its points.
        </p>
      )}
    </Panel>
  );
}
