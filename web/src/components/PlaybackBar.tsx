import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { clock, getLink, now, subscribeLink, wallNow } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import type { SessionData, TrackStatusKind } from '../data/session';
import { AlertToggles } from './Alerts';
import { HOSTED } from '../env';
import { firebaseEnabled } from '../firebase';
import { formatClock, leaderLap, trackStatusAt } from '../data/state';

const SPEEDS = [1, 2, 4, 8, 16];

export const STATUS_LABEL: Record<TrackStatusKind, string> = {
  PRE: 'PRE-SESSION',
  GREEN: 'GREEN',
  YELLOW: 'YELLOW',
  SC: 'SAFETY CAR',
  SC_ENDING: 'SC IN THIS LAP',
  VSC: 'VSC',
  VSC_ENDING: 'VSC ENDING',
  RED: 'RED FLAG',
  CHEQUERED: 'CHEQUERED',
};

const BAND_COLOUR: Partial<Record<TrackStatusKind, string>> = {
  SC: '#ffb020aa',
  SC_ENDING: '#ffb02077',
  VSC: '#ffb02055',
  VSC_ENDING: '#ffb02033',
  RED: '#ff3b4eaa',
  YELLOW: '#ffd23f33',
};

export function StatusPill({ data, t }: { data: SessionData; t: number }) {
  const s = trackStatusAt(data, t);
  return <span className={`status-pill st-${s.status}`}>{STATUS_LABEL[s.status]}</span>;
}

export function PlaybackBar({ data, compact = false }: { data: SessionData; compact?: boolean }) {
  const synced = useSynced();
  const t = useNow(compact ? 6 : 15);
  const { start, raceStart, totalLaps } = data.meta;
  // Live: the timeline ends at "now minus the TV delay" and keeps growing.
  const end = data.live ? wallNow() - data.meta.t0 - synced.delayMs : data.meta.end;
  const span = Math.max(1, end - start);
  const lap = leaderLap(data, t);

  // Replays stop at the end of the data; live playback that catches up rejoins the live edge.
  // Every window does the same check, so it's harmless if several fire.
  useEffect(() => {
    if (data.live) {
      if (!synced.live && t >= end) clock.goLive();
      else if (t < start - 1000) clock.seek(start);
      return;
    }
    if (synced.playing && t >= end) clock.pause();
    if (t > end + 1000 || t < start - 1000) clock.seek(Math.min(end, Math.max(start, t)));
  }, [t, synced.playing, synced.live, end, start, data.live]);

  // Keyboard: space = play/pause, arrows = ±10 s (shift: ±60 s).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        clock.toggle();
      } else if (e.key === 'ArrowRight') clock.nudge(e.shiftKey ? 60_000 : 10_000);
      else if (e.key === 'ArrowLeft') clock.nudge(e.shiftKey ? -60_000 : -10_000);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bands = useMemo(() => {
    const out: { left: number; width: number; colour: string }[] = [];
    data.trackStatus.forEach((s, i) => {
      const colour = BAND_COLOUR[s.status];
      if (!colour) return;
      const until = data.trackStatus[i + 1]?.t ?? end;
      out.push({ left: ((s.t - start) / span) * 100, width: ((until - s.t) / span) * 100, colour });
    });
    return out;
  }, [data, start, end, span]);

  const lapMarks = useMemo(
    () => data.lapStartTimes.map((lt, n) => (lt != null && n % 5 === 0 ? ((lt - start) / span) * 100 : null)).filter((x) => x != null),
    [data, start, span],
  );

  const pct = Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const sinceStart = t - raceStart;

  return (
    <div className={'playback' + (compact ? ' compact' : '')}>
      {data.live &&
        (synced.live ? (
          <span className="live-badge" title="Following the live session, held back by your TV delay">● LIVE</span>
        ) : (
          <button className="pb-btn live-btn" onClick={() => clock.goLive()} title="Jump back to live">
            GO LIVE <span className="num">−{formatClock(end - t)}</span>
          </button>
        ))}
      <button className="pb-btn" title="Back 10 s (←)" onClick={() => clock.nudge(-10_000)}>
        ⟲
      </button>
      <button className="pb-btn primary" title="Play / pause (space)" onClick={() => clock.toggle()}>
        {synced.playing ? '❚❚' : '▶'}
      </button>
      <button className="pb-btn" title="Forward 10 s (→)" onClick={() => clock.nudge(10_000)}>
        ⟳
      </button>
      {!compact && (
        <div className="speeds" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} className={synced.speed === s ? 'on' : ''} onClick={() => clock.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      )}
      <div className="scrubber">
        <div className="bands">
          {lapMarks.map((l, i) => (
            <span key={i} className="lapmark" style={{ left: l + '%' }} />
          ))}
          {bands.map((b, i) => (
            <span key={i} className="band" style={{ left: b.left + '%', width: Math.max(0.2, b.width) + '%', background: b.colour }} />
          ))}
          <span className="fill" style={{ width: pct + '%' }} />
        </div>
        <span className="knob" style={{ left: pct + '%' }} />
        <input
          type="range"
          min={start}
          max={end}
          step={1000}
          value={Math.round(Math.min(end, Math.max(start, now())))}
          onChange={(e) => clock.seek(Number(e.target.value))}
          aria-label="Scrub"
        />
      </div>
      <span className="clock">
        {totalLaps > 0 && (
          <>
            LAP <b>{Math.min(lap, totalLaps) || '–'}</b>
            {!data.live && `/${totalLaps}`}{' '}
          </>
        )}
        · <b>{formatClock(sinceStart)}</b>
      </span>
      <LinkChip />
      {!compact && <AlertToggles />}
      {data.live && <TvDelay data={data} compact={compact} />}
      {!compact && (
        <>
          <select
            className="lap-jump"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'start') clock.seek(raceStart);
              else if (v) clock.seek(data.lapStartTimes[Number(v)] - 3000);
            }}
            aria-label="Jump to lap"
          >
            <option value="">Jump to…</option>
            <option value="start">Lights out</option>
            {data.lapStartTimes.map((lt, n) => (lt != null && n > 0 ? <option key={n} value={n}>Lap {n}</option> : null))}
          </select>
          <StatusPill data={data} t={t} />
        </>
      )}
      {compact && (
        <select className="lap-jump" value={synced.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))} aria-label="Speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/**
 * TV delay: live data arrives a few seconds after the real event, but the TV picture is
 * later still. Holding the data back by the difference keeps the pit wall from spoiling
 * the TV. "Sync to TV" measures it: tap when you see the leader cross the line (or lights out).
 */
function TvDelay({ data, compact }: { data: SessionData; compact: boolean }) {
  const { delayMs } = useSynced();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');

  const tap = () => {
    const tapReal = wallNow() - data.meta.t0; // when the tap happened, in session time
    let crossing: number | null = null;
    data.lapStartTimes.forEach((ls) => {
      if (ls != null && ls <= tapReal - 500 && (crossing == null || ls > crossing)) crossing = ls;
    });
    if (crossing == null || tapReal - crossing > 120_000) {
      setNote("Couldn't find a line crossing in the last 2 minutes of data. Try again at the next one.");
      return;
    }
    const delay = tapReal - crossing;
    clock.setDelay(delay);
    clock.goLive();
    setNote(`Your TV is ${(delay / 1000).toFixed(1)} s behind the real cars. All windows now match it.`);
  };

  const nudge = (ms: number) => clock.setDelay(delayMs + ms);

  return (
    <span className="tv-delay">
      <button className="pb-btn" onClick={() => setOpen(!open)} title="Match the data to your TV picture">
        📺 {compact ? '' : 'TV delay '}
        <b className="num">{(delayMs / 1000).toFixed(1)}s</b>
      </button>
      {open && (
        <div className="tv-pop" role="dialog">
          <div className="tv-pop-title">Sync to your TV</div>
          <p>
            Watch the TV. The moment the <b>race leader crosses the start/finish line</b> (or the lights go out), press the
            button.
          </p>
          <button className="btn primary big" onClick={tap}>
            Leader crossed the line: NOW
          </button>
          {note && <p className="muted">{note}</p>}
          <div className="tv-fine">
            Fine-tune
            <button className="btn" onClick={() => nudge(-1000)}>−1s</button>
            <button className="btn" onClick={() => nudge(-250)}>−¼s</button>
            <b className="num">{(delayMs / 1000).toFixed(2)} s</b>
            <button className="btn" onClick={() => nudge(250)}>+¼s</button>
            <button className="btn" onClick={() => nudge(1000)}>+1s</button>
          </div>
          <p className="dim">
            Data ahead of the TV? Increase the delay. Behind? Decrease it. The setting is remembered for next time.
            {delayMs < 3000 && ' Below ~3 s the live data itself may not have arrived yet.'}
          </p>
          <button className="icon-btn" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </span>
  );
}

/** Shows whether this screen is linked to the others (other windows and devices on the Wi-Fi). */
function LinkChip() {
  const link = useSyncExternalStore(subscribeLink, getLink);
  if (HOSTED && !firebaseEnabled) return null; // nothing to link to
  const others = Math.max(0, link.peers - 1);
  const label = !link.connected ? 'Not linked' : others === 0 ? 'Linked · no other screens' : `Linked · ${others} other screen${others > 1 ? 's' : ''}`;
  return (
    <span
      className={'link-chip ' + (link.connected ? (others ? 'ok' : 'alone') : 'off')}
      title={
        link.connected
          ? 'Play, pause, speed and scrubbing are shared with every linked screen.'
          : "This screen can't reach the sync server, so it won't follow the others. Reload the page; if it persists, check this device is on the same Wi-Fi."
      }
    >
      <span className="dot" />
      {label}
    </span>
  );
}
