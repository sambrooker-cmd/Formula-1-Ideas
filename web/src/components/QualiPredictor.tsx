// Qualifying predictor: the knockout line, who's in danger, and where the cars on a flying lap
// will end up, projected from the sectors they've done so far plus their best for the rest.
import type { ReactNode } from 'react';
import type { Lap, SessionData } from '../data/session';
import { qualiAt } from '../data/quali';
import { formatLapTime } from '../data/state';
import { useNow } from '../hooks';
import { Panel } from './Panel';

interface Flying {
  driver: number;
  /** Sectors done so far this lap (1–3). */
  done: number;
  /** Gap to their own best lap at the same point (s), when known. */
  delta: number | null;
  projected: number;
  /** Where the projected time would put them in this phase. */
  wouldBe: number;
}

/** Sector times (s) a lap has shown by time t. */
function sectorsSoFar(l: Lap, t: number) {
  const out: number[] = [];
  let at = l.t;
  for (const s of [l.s1, l.s2, l.s3]) {
    if (s == null) break;
    at += s * 1000;
    if (at > t) break;
    out.push(s);
  }
  return out;
}

export function QualiPredictor({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(4);
  const q = qualiAt(data, t);
  const code = (n: number) => data.drivers.get(n)?.code ?? '';
  const running = q.rows.filter((r) => r.outIn == null);
  const cut = q.cutoff;
  // Time needed to get through: the last car in the safe places.
  const cutTime = cut != null ? running[cut - 1]?.best?.duration ?? null : null;

  // Best sectors so far this session, per driver (from completed laps).
  const bestSectors = (n: number) => {
    const b = [Infinity, Infinity, Infinity];
    for (const l of data.laps.get(n) ?? [])
      if (l.end <= t && !l.pitOut) [l.s1, l.s2, l.s3].forEach((s, i) => s != null && s < b[i] && (b[i] = s));
    return b;
  };

  const flying: Flying[] = [];
  for (const r of running) {
    if (!r.onLap) continue;
    const lap = [...(data.laps.get(r.driver) ?? [])].reverse().find((l) => l.t <= t && t < l.end);
    if (!lap || lap.pitOut) continue;
    const done = sectorsSoFar(lap, t);
    if (!done.length || done.length === 3) continue;
    const best = bestSectors(r.driver);
    const rest = best.slice(done.length);
    if (rest.some((x) => !Number.isFinite(x))) continue;
    const projected = done.reduce((a, b) => a + b, 0) + rest.reduce((a, b) => a + b, 0);
    const pb = r.best;
    const pbSoFar = pb && [pb.s1, pb.s2, pb.s3].slice(0, done.length).every((x) => x != null) ? [pb.s1!, pb.s2!, pb.s3!].slice(0, done.length).reduce((a, b) => a + b, 0) : null;
    const others = running.filter((o) => o.driver !== r.driver && o.best?.duration != null && o.best.duration < Math.min(projected, r.best?.duration ?? Infinity));
    flying.push({
      driver: r.driver,
      done: done.length,
      delta: pbSoFar == null ? null : done.reduce((a, b) => a + b, 0) - pbSoFar,
      projected,
      wouldBe: others.length + 1,
    });
  }
  const flyingBy = new Map(flying.map((f) => [f.driver, f]));

  // Who to show: everyone from a few places above the line down (or the top 10 in Q3).
  const shown = cut == null ? running : running.slice(Math.max(0, cut - 4));

  return (
    <Panel title="Qualifying predictor" lead={lead} area={area} popout="/predictor" bodyClass="scroll">
      {!q.phase ? (
        <div className="center-msg">Waiting for qualifying to start.</div>
      ) : (
        <>
          <div className="moment-filters">
            <b>Q{q.shown}</b>
            {cut != null ? (
              <span>
                Top {cut} go through · needed now: <b className="num">{cutTime != null ? formatLapTime(cutTime) : 'no time yet'}</b>
              </span>
            ) : (
              <span>Fight for pole{q.fastest != null && <> · fastest <b className="num">{formatLapTime(q.fastest)}</b></>}</span>
            )}
            {flying.length > 0 && <span className="dim" style={{ marginLeft: 'auto', fontSize: 11 }}>{flying.length} on a flying lap</span>}
          </div>
          <ul className="moments">
            {shown.map((r) => {
              const pos = running.indexOf(r) + 1;
              const danger = cut != null && pos > cut;
              const f = flyingBy.get(r.driver);
              const improves = f && (r.best?.duration == null || f.projected < r.best.duration);
              return (
                <li key={r.driver} className={'moment pred-row' + (danger ? ' danger' : '')}>
                  <span className={'num pred-pos ' + (danger ? 'bad' : '')}>P{pos}</span>
                  <span className="moment-text">
                    <i className="team-bar" style={{ background: data.drivers.get(r.driver)?.colour }} />
                    <b>{code(r.driver)}</b> <span className="num muted">{r.best?.duration != null ? formatLapTime(r.best.duration) : 'no time'}</span>
                    {danger && <span className="battle-tag">drop zone</span>}
                    {r.inPit && <span className="dim" style={{ fontSize: 11 }}> · in the pits</span>}
                    {f && (
                      <span style={{ fontSize: 11 }}>
                        {' '}
                        · on a lap, {f.done} sector{f.done > 1 ? 's' : ''} done
                        {f.delta != null && Math.abs(f.delta) < 3 && <span className={f.delta < 0 ? 'good' : 'bad'}> ({f.delta < 0 ? '' : '+'}{f.delta.toFixed(2)} on their best)</span>}
                        {' → '}
                        <b className="num">{formatLapTime(f.projected)}</b>
                        {improves ? (
                          <>
                            {' '}
                            would be <b className={cut != null && f.wouldBe > cut ? 'bad' : 'good'}>P{f.wouldBe}</b>
                          </>
                        ) : (
                          <span className="dim"> no improvement</span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="rc-meta">
                    {cutTime != null && r.best?.duration != null && pos !== cut
                      ? `${r.best.duration - cutTime > 0 ? '+' : ''}${(r.best.duration - cutTime).toFixed(3)}`
                      : pos === cut
                        ? 'on the line'
                        : cut == null && pos > 1 && q.fastest != null && r.best?.duration != null
                          ? `+${(r.best.duration - q.fastest).toFixed(3)}`
                          : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>
            Gaps on the right are to the last safe place. For cars on a flying lap the projection adds their best times for the sectors still to come to the
            sectors they've just done — a guide only: track evolution usually makes late laps quicker.
          </p>
        </>
      )}
    </Panel>
  );
}
