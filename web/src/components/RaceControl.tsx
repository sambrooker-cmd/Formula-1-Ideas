import { useEffect, useMemo, useRef, useState } from 'react';
import { getState } from '../sync/clock';
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

export function RaceControl({ data, area, lead }: { data: SessionData; area?: string; lead?: React.ReactNode }) {
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

  // Auto-play: play each clip as playback reaches it (this window only, at up to 2× speed).
  const [autoRadio, setAutoRadio] = useState(() => {
    try {
      return sessionStorage.getItem('pitwall.autoRadio') === '1';
    } catch {
      return false;
    }
  });
  const prevT = useRef(t);
  useEffect(() => {
    const from = prevT.current;
    prevT.current = t;
    if (!autoRadio) return;
    const { playing, live, speed } = getState();
    const step = t - from;
    if (!(playing || live) || speed > 2 || step <= 0 || step > 4000) return;
    const clip = data.meta.radio.find(([, rt]) => rt > from && rt <= t);
    if (clip) play(clip[2]);
  }, [t, autoRadio, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleAuto = (on: boolean) => {
    setAutoRadio(on);
    try {
      sessionStorage.setItem('pitwall.autoRadio', on ? '1' : '0');
    } catch {
      // ignore
    }
  };

  return (
    <Panel
      title="Race control"
      lead={lead}
      area={area}
      popout="/race-control"
      bodyClass="scroll"
      extra={
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" checked={showRadio} onChange={(e) => setShowRadio(e.target.checked)} /> radio
        </label>
      }
      extraAfter={
        <label
          title="Play team radio automatically as the replay reaches each clip (this window only)"
          style={{ display: 'flex', gap: 4, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}
        >
          <input type="checkbox" checked={autoRadio} onChange={(e) => toggleAuto(e.target.checked)} /> auto-play
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
