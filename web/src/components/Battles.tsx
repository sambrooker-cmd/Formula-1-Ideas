// Battle tracker panel: every on-track fight, newest first, with one click to watch it.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { battles, BATTLE_GAP, MIN_LAPS } from '../data/battles';
import { clock } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Panel } from './Panel';

export function Battles({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(2);
  const { selected } = useSynced();
  const [spoilers, setSpoilers] = useState(false);
  const [mine, setMine] = useState(false);
  const [top10, setTop10] = useState(false);
  const all = battles(data);
  const code = (n: number) => data.drivers.get(n)?.code ?? '';
  const colour = (n: number) => data.drivers.get(n)?.colour ?? '#888';
  const shown = useMemo(
    () =>
      all
        .filter((b) => spoilers || b.start <= t)
        .filter((b) => !mine || selected.includes(b.front) || selected.includes(b.chaser))
        .filter((b) => !top10 || b.forPosition <= 10)
        .slice()
        .reverse(),
    [all, spoilers, mine, top10, selected, Math.floor(t / 5000)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const watch = (front: number, chaser: number, start: number) => {
    clock.setSelected([chaser, front]);
    clock.seek(start);
    clock.play();
  };

  return (
    <Panel title="Battles" lead={lead} area={area} popout="/battles" bodyClass="scroll">
      {data.meta.session.type !== 'Race' ? (
        <div className="center-msg">Battles are tracked in races.</div>
      ) : (
        <>
          <div className="moment-filters">
            <button className={'chip' + (top10 ? ' on' : '')} onClick={() => setTop10(!top10)}>
              Top 10 only
            </button>
            <label className="muted" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={!selected.length} /> selected drivers
            </label>
            <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
              <input type="checkbox" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} /> show what's ahead
            </label>
          </div>
          <ul className="moments">
            {shown.map((b) => {
              const live = t >= b.start && t <= b.end + 60_000;
              const laps = b.endLap - b.startLap + 1;
              return (
                <li key={`${b.front}-${b.chaser}-${b.startLap}`} className={'moment battle-row' + (b.start > t ? ' ahead' : '') + (live ? ' live' : '')} onClick={() => watch(b.front, b.chaser, b.start)} title="Watch this battle (selects both cars)">
                  <span className="battle-pos num">P{b.forPosition}</span>
                  <span className="moment-text">
                    <span className="moment-dots">
                      <i style={{ background: colour(b.front) }} />
                      <i style={{ background: colour(b.chaser) }} />
                    </span>
                    <b>{code(b.chaser)}</b> on <b>{code(b.front)}</b> for {laps} laps
                    {b.passes.length > 0 ? (
                      <span className="good">
                        {' '}
                        · {b.passes.map((p) => `${code(p.by)} through on lap ${p.lap}`).join(', ')}
                      </span>
                    ) : (
                      <span className="dim"> · {code(b.front)} held on</span>
                    )}
                    {live && <span className="battle-tag live">NOW</span>}
                  </span>
                  <span className="rc-meta">
                    L{b.startLap}–{b.endLap} · {b.closest.toFixed(2)}s
                  </span>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="dim" style={{ padding: 12 }}>
                No battles yet. A battle is {MIN_LAPS}+ green-flag laps with a car within {BATTLE_GAP.toFixed(1)} s of the one ahead.
              </li>
            )}
          </ul>
        </>
      )}
    </Panel>
  );
}
