import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { HIGHLIGHT_LENGTH, LEAD_IN, highlightReel, keyMoments, type Moment, type MomentKind } from '../data/moments';
import { formatClock } from '../data/state';
import { clock, getState } from '../sync/clock';
import { useNow } from '../hooks';
import { Panel } from './Panel';

const FILTERS: { id: string; label: string; kinds: MomentKind[] }[] = [
  { id: 'all', label: 'All', kinds: ['start', 'finish', 'flag', 'overtake', 'pit', 'penalty', 'retire', 'fastest', 'undercut'] },
  { id: 'overtakes', label: 'Overtakes', kinds: ['overtake'] },
  { id: 'pits', label: 'Pit stops', kinds: ['pit', 'undercut'] },
  { id: 'incidents', label: 'Flags & incidents', kinds: ['flag', 'penalty', 'retire', 'start', 'finish'] },
];

export const MOMENT_ICON: Record<MomentKind, string> = {
  start: '🚦',
  finish: '🏁',
  flag: '⚠️',
  overtake: '⇅',
  pit: '🔧',
  penalty: '⚖️',
  retire: '✖',
  fastest: '⏱',
  undercut: '⇄',
};


export function KeyMoments({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(4);
  const [filter, setFilter] = useState('all');
  const [spoilers, setSpoilers] = useState(false);
  // null: off; otherwise the time to fit the highlights into (Infinity: all of them).
  const [highlights, setHighlights] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const all = keyMoments(data);
  const kinds = FILTERS.find((f) => f.id === filter)!.kinds;
  const shown = useMemo(
    () => all.filter((m) => kinds.includes(m.kind) && (spoilers || m.t <= t)).reverse(),
    [all, kinds, spoilers, Math.floor(t / 1000)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Highlights: play each notable moment for ~20 s, then jump to the next one.
  const current = useRef<Moment | null>(null);
  const reel = useMemo(
    () => (highlights == null ? [] : highlightReel(all, data.meta.raceStart, Number.isFinite(highlights) ? highlights : null)),
    [all, highlights, data.meta.raceStart],
  );
  useEffect(() => {
    if (highlights == null) return;
    const cur = current.current;
    const next = reel.find((m) => m.t > (cur ? cur.t : t - LEAD_IN + 1000));
    if (!cur || t > cur.t + HIGHLIGHT_LENGTH - LEAD_IN || t < cur.t - LEAD_IN - 2000) {
      if (!next) {
        setHighlights(null);
        clock.pause();
        return;
      }
      current.current = next;
      clock.seek(next.t - LEAD_IN);
      if (getState().speed !== 1) clock.setSpeed(1);
      clock.play();
    }
  }, [highlights, t, reel]);

  const startHighlights = (minutes: number) => {
    setMenu(false);
    current.current = null;
    // Catch-up starts from the beginning; plain highlights carry on from here.
    if (Number.isFinite(minutes)) clock.seek(data.meta.raceStart - LEAD_IN - 2000);
    setHighlights(minutes);
  };
  const stopHighlights = () => {
    setHighlights(null);
    clock.pause();
  };
  const clipNo = current.current ? reel.indexOf(current.current) + 1 : 0;

  return (
    <Panel
      title="Key moments"
      lead={lead}
      area={area}
      popout="/moments"
      bodyClass="scroll"
      extra={
        highlights != null ? (
          <button className="icon-btn active" onClick={stopHighlights} title="Stop the highlights">
            ■ Stop{clipNo > 0 ? ` (${clipNo} of ${reel.length})` : ''}
          </button>
        ) : (
          <span className="menu-wrap">
            <button className="icon-btn" onClick={() => setMenu(!menu)} title="Play just the notable moments, one after another">
              ▶ Highlights ▾
            </button>
            {menu && (
              <span className="menu">
                <button onClick={() => startHighlights(Infinity)}>All the big moments, from here</button>
                <button onClick={() => startHighlights(5)}>Catch up in 5 minutes</button>
                <button onClick={() => startHighlights(10)}>Catch up in 10 minutes</button>
                <button onClick={() => startHighlights(20)}>Catch up in 20 minutes</button>
              </span>
            )}
          </span>
        )
      }
    >
      <div className="moment-filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
        <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} /> show what's ahead
        </label>
      </div>
      <ul className="moments">
        {shown.map((m) => (
          <li
            key={m.kind + m.t + m.text}
            className={`moment w${m.weight} k-${m.kind}` + (m.t > t ? ' ahead' : '')}
            onClick={() => clock.seek(m.t - LEAD_IN)}
            title="Jump to this moment"
          >
            <span className="moment-icon">{MOMENT_ICON[m.kind]}</span>
            <span className="moment-text">
              {m.drivers.length > 0 && (
                <span className="moment-dots">
                  {m.drivers.map((n) => (
                    <i key={n} style={{ background: data.drivers.get(n)?.colour }} />
                  ))}
                </span>
              )}
              {m.text}
            </span>
            <span className="rc-meta">
              {m.lap != null ? `L${m.lap}` : ''} {formatClock(m.t - data.meta.raceStart)}
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="dim" style={{ padding: 12 }}>Nothing yet. Moments appear as the session plays.</li>}
      </ul>
    </Panel>
  );
}
