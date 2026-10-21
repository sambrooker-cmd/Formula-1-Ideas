import { useMemo, useRef, useState } from 'react';
import type { SessionData } from '../data/session';
import { formatClock, trackStatusAt } from '../data/state';
import { useNow } from '../hooks';
import { Panel } from './Panel';
import { STATUS_LABEL } from './PlaybackBar';

const FLAG_COLOUR: Record<string, string> = {
  GREEN: 'var(--green)',
  YELLOW: 'var(--yellow)',
  'DOUBLE YELLOW': 'var(--yellow)',
  RED: 'var(--red)',
  BLUE: 'var(--blue)',
  CLEAR: 'var(--green)',
  CHEQUERED: '#e8edf3',
  'BLACK AND WHITE': '#e8edf3',
};

type Item =
  | { kind: 'rc'; t: number; lap: number | null; category: string | null; flag: string | null; message: string }
  | { kind: 'radio'; t: number; driver: number; url: string };

export function RaceControl({ data, area }: { data: SessionData; area?: string }) {
  const t = useNow(4);
  const [showRadio, setShowRadio] = useState(true);
  const audio = useRef<HTMLAudioElement | null>(null);

  const items = useMemo<Item[]>(() => {
    const list: Item[] = data.meta.raceControl.map(([t, lap, category, flag, , , , message]) => ({
      kind: 'rc',
      t,
      lap,
      category,
      flag,
      message,
    }));
    for (const [driver, t, url] of data.meta.radio) list.push({ kind: 'radio', t, driver, url });
    return list.sort((a, b) => a.t - b.t);
  }, [data, data.version]);

  const visible = items.filter((i) => i.t <= t && (showRadio || i.kind === 'rc')).reverse().slice(0, 80);
  const status = trackStatusAt(data, t);

  const play = (url: string) => {
    audio.current?.pause();
    audio.current = new Audio(url);
    audio.current.play().catch(() => undefined);
  };

  return (
    <Panel
      title="Race control"
      area={area}
      popout="/race-control"
      bodyClass="scroll"
      extra={
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" checked={showRadio} onChange={(e) => setShowRadio(e.target.checked)} /> radio
        </label>
      }
    >
      <div className="rc-status">
        <span className={`status-pill st-${status.status}`}>{STATUS_LABEL[status.status]}</span>
        {status.yellowSectors.length > 0 && <span className="muted">Yellow in sector {status.yellowSectors.join(', ')}</span>}
      </div>
      <ul className="rc-list">
        {visible.map((i) => (
          <li key={i.kind + i.t + (i.kind === 'rc' ? i.message : i.url)} className={t - i.t < 3000 ? 'fresh' : ''}>
            <span className="rc-meta">
              {i.kind === 'rc' && i.lap != null ? `L${i.lap}` : ''}
              <br />
              {formatClock(i.t - data.meta.raceStart)}
            </span>
            {i.kind === 'rc' ? (
              <span>
                {i.flag && <span className="rc-flag" style={{ background: FLAG_COLOUR[i.flag] ?? 'var(--muted)' }} />}
                {i.message}
              </span>
            ) : (
              <span className="muted">
                <b style={{ color: data.drivers.get(i.driver)?.colour }}>{data.drivers.get(i.driver)?.code ?? i.driver}</b> team radio
                <button className="radio-btn" onClick={() => play(i.url)}>▶ play</button>
              </span>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="dim">No messages yet</li>}
      </ul>
    </Panel>
  );
}
