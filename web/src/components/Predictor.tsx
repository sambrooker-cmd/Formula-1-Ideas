// Predictor: projected finishing order in races; the knockout picture in qualifying.
import { useMemo, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { predictFinish } from '../data/predictor';
import { isQualifying } from '../data/quali';
import { useNow } from '../hooks';
import { Panel } from './Panel';
import { QualiPredictor } from './QualiPredictor';

export function Predictor(props: { data: SessionData; area?: string; lead?: ReactNode }) {
  return isQualifying(props.data) ? <QualiPredictor {...props} /> : <RacePredictor {...props} />;
}

function RacePredictor({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(1);
  // Re-run every few seconds of race time; it's cheap but needn't be every frame.
  const bucket = Math.floor(t / 5000);
  const p = useMemo(() => predictFinish(data, t), [data, data.version, bucket]); // eslint-disable-line react-hooks/exhaustive-deps
  const code = (n: number) => data.drivers.get(n)?.code ?? '';

  return (
    <Panel title="Race predictor" lead={lead} area={area} popout="/predictor" bodyClass="scroll">
      {data.meta.session.type !== 'Race' ? (
        <div className="center-msg">The predictor is for races and qualifying.</div>
      ) : !p ? (
        <div className="center-msg">Predictions start after a few laps.</div>
      ) : (
        <>
          <div className="moment-filters">
            <b>{p.lapsLeft} laps to go</b>
            {p.neutralised && <span className="battle-tag">Safety Car: gaps will close up, so treat this loosely</span>}
            <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>
              Projected finish
            </span>
          </div>
          <ul className="moments">
            {p.rows.map((r) => {
              const move = r.now - r.projected;
              return (
                <li key={r.driver} className="moment pred-row">
                  <span className="num pred-pos">P{r.projected}</span>
                  <span className="moment-text">
                    <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
                    <b>{code(r.driver)}</b>{' '}
                    <span className={move > 0 ? 'good' : move < 0 ? 'bad' : 'dim'} style={{ fontSize: 11 }}>
                      {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '='} (now P{r.now})
                    </span>
                    {r.needsStop && <span className="battle-tag">needs a stop</span>}
                    {r.reasons.length > 0 && <span className="dim" style={{ fontSize: 11 }}> · {r.reasons.join(' · ')}</span>}
                  </span>
                  <span className="rc-meta">{r.gap == null ? 'lapped' : r.projected === 1 ? '' : `+${r.gap.toFixed(1)}s`}</span>
                </li>
              );
            })}
          </ul>
          <p className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
            From the gaps now, the stops each car still has to make (a second compound, or tyres that won't last), a light touch of recent pace and tyre wear,
            and a nudge towards the running order because passing is hard. Tested on five races, it named the winner more often than the running order did (67
            of 73 checks against 64) and placed the top ten more closely. Safety Cars and incidents can't be predicted.
          </p>
        </>
      )}
    </Panel>
  );
}
