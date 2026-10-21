// Alerts: a banner (and optional sound) when something big happens while you're watching.
import { useEffect, useRef, useState } from 'react';
import type { SessionData } from '../data/session';
import { keyMoments, type Moment } from '../data/moments';
import { getState } from '../sync/clock';
import { useNow } from '../hooks';
import { MOMENT_ICON } from './KeyMoments';

const ALERTS_KEY = 'pitwall.alerts'; // per browser: banners on/off
const SOUND_KEY = 'pitwall.alertSound'; // per window: so several open windows don't all beep

function readFlag(storage: () => Storage, key: string, fallback: boolean) {
  try {
    const v = storage().getItem(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}
function writeFlag(storage: () => Storage, key: string, v: boolean) {
  try {
    storage().setItem(key, v ? '1' : '0');
  } catch {
    // ignore
  }
}

/** Which moments deserve an interruption. Pit stops only for the drivers you've selected. */
function alertWorthy(m: Moment, selected: number[]) {
  if (m.kind === 'pit') return m.drivers.some((d) => selected.includes(d));
  if (m.kind === 'overtake') return m.weight >= 3 || m.drivers.some((d) => selected.includes(d));
  if (m.kind === 'fastest') return (m.lap ?? 0) >= 10;
  return m.weight >= 2;
}

let audio: AudioContext | null = null;
function beep(urgent: boolean) {
  try {
    audio ??= new AudioContext();
    const tones = urgent ? [880, 660, 880] : [660, 880];
    tones.forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(audio!.destination);
      const at = audio!.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.15, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      o.start(at);
      o.stop(at + 0.15);
    });
  } catch {
    // no audio available
  }
}

interface Toast {
  id: number;
  moment: Moment;
}

/** Watches the clock and shows a banner when an alert-worthy moment is passed during normal playback. */
export function AlertsHost({ data }: { data: SessionData }) {
  const t = useNow(4);
  const prev = useRef(t);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const from = prev.current;
    prev.current = t;
    const { selected, speed, playing, live } = getState();
    const step = t - from;
    // Only while it's playing forward normally: jumping around the timeline shouldn't set off alarms.
    if (!(playing || live) || step <= 0 || step > 4000 * Math.max(1, speed)) return;
    if (!readFlag(() => localStorage, ALERTS_KEY, true)) return;
    const fresh = keyMoments(data).filter((m) => m.t > from && m.t <= t && alertWorthy(m, selected));
    if (!fresh.length) return;
    if (readFlag(() => sessionStorage, SOUND_KEY, false)) beep(fresh.some((m) => m.kind === 'flag' || m.kind === 'retire'));
    setToasts((list) => [...list, ...fresh.map((moment) => ({ id: ++seq.current, moment }))].slice(-3));
  }, [t, data]);

  // Each banner stays for 7 seconds.
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => setToasts((list) => list.slice(1)), 7000);
    return () => clearTimeout(timer);
  }, [toasts]);

  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(({ id, moment: m }) => (
        <button key={id} className={`toast k-${m.kind}`} onClick={() => setToasts((list) => list.filter((x) => x.id !== id))}>
          <span className="toast-icon">{MOMENT_ICON[m.kind]}</span>
          <span>
            {m.drivers.length > 0 && (
              <span className="moment-dots">
                {m.drivers.map((n) => (
                  <i key={n} style={{ background: data.drivers.get(n)?.colour }} />
                ))}
              </span>
            )}
            {m.text}
          </span>
          {m.lap != null && <span className="dim num">L{m.lap}</span>}
        </button>
      ))}
    </div>
  );
}

/** Bell and speaker buttons for the playback bar. */
export function AlertToggles() {
  const [on, setOn] = useState(() => readFlag(() => localStorage, ALERTS_KEY, true));
  const [sound, setSound] = useState(() => readFlag(() => sessionStorage, SOUND_KEY, false));
  return (
    <span className="alert-toggles">
      <button
        className={'icon-btn' + (on ? '' : ' off')}
        title={on ? 'Alerts on: banners for Safety Cars, red flags, retirements, penalties and your drivers' : 'Alerts off'}
        onClick={() => {
          writeFlag(() => localStorage, ALERTS_KEY, !on);
          setOn(!on);
        }}
      >
        {on ? '🔔' : '🔕'}
      </button>
      {on && (
        <button
          className={'icon-btn' + (sound ? '' : ' off')}
          title={sound ? 'Alert sound on (this window)' : 'Alert sound off'}
          onClick={() => {
            writeFlag(() => sessionStorage, SOUND_KEY, !sound);
            setSound(!sound);
            if (!sound) beep(false); // also unlocks audio, which browsers only allow after a click
          }}
        >
          {sound ? '🔊' : '🔈'}
        </button>
      )}
    </span>
  );
}
