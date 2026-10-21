// TV mode: big text, high contrast, readable from the sofa (e.g. AirPlay to the TV).
import type { SessionData } from '../data/session';
import { formatLapTime, leaderLap, tower, trackStatusAt } from '../data/state';
import { isQualifying, qualiAt } from '../data/quali';
import { keyMoments } from '../data/moments';
import { useNow, useSynced } from '../hooks';
import { TrackMap } from './TrackMap';
import { STATUS_LABEL } from './PlaybackBar';
import { MOMENT_ICON } from './KeyMoments';

export function TvMode({ data }: { data: SessionData }) {
  const t = useNow(4);
  const { selected } = useSynced();
  const status = trackStatusAt(data, t);
  const lap = leaderLap(data, t);
  const quali = isQualifying(data) ? qualiAt(data, t) : null;
  const latest = keyMoments(data).filter((m) => m.t <= t && m.weight >= 2).at(-1);

  const rows = quali
    ? quali.rows.slice(0, 12).map((r, i) => ({
        driver: r.driver,
        pos: i + 1,
        right: i === 0 ? formatLapTime(r.best?.duration) : r.best && quali.fastest ? '+' + (r.best.duration! - quali.fastest).toFixed(3) : '',
        tag: r.outIn ? `Q${r.outIn}` : r.inPit ? 'PIT' : '',
      }))
    : tower(data, t)
        .slice(0, 12)
        .map((r) => ({
          driver: r.driver,
          pos: r.position,
          right: r.position === 1 ? (data.meta.session.type === 'Race' ? 'Leader' : formatLapTime(r.bestLap)) : r.interval || r.gap,
          tag: r.out ? 'OUT' : r.inPit ? 'PIT' : '',
        }));

  return (
    <div className="tv">
      <div className="tv-map">
        <TrackMap data={data} />
      </div>
      <aside className="tv-side">
        <div className="tv-head">
          <div className="num tv-lap">
            {data.meta.session.type === 'Race' ? (
              <>
                LAP {Math.min(lap, data.meta.totalLaps) || '–'}
                {!data.live && <span className="dim">/{data.meta.totalLaps}</span>}
              </>
            ) : quali ? (
              `Q${quali.shown}`
            ) : (
              data.meta.session.name
            )}
          </div>
          <span className={`status-pill st-${status.status}`}>{STATUS_LABEL[status.status]}</span>
        </div>
        <ol className="tv-tower">
          {rows.map((r) => {
            const d = data.drivers.get(r.driver)!;
            return (
              <li key={r.driver} className={selected.includes(r.driver) ? 'sel' : ''}>
                <span className="num tv-pos">{r.pos < 99 ? r.pos : '–'}</span>
                <span className="team-bar" style={{ background: d.colour, height: 26, width: 6 }} />
                <b>{d.code}</b>
                {r.tag && <span className="tag pit">{r.tag}</span>}
                <span className="num tv-gap">{r.right}</span>
              </li>
            );
          })}
        </ol>
        {latest && (
          <div className="tv-latest">
            <span>{MOMENT_ICON[latest.kind]}</span> {latest.text}
          </div>
        )}
      </aside>
    </div>
  );
}
