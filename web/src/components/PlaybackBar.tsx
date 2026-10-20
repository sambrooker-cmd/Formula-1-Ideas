import { useEffect, useMemo } from 'react';
import { clock, now } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import type { SessionData, TrackStatusKind } from '../data/session';
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
  const { start, end, raceStart, totalLaps } = data.meta;
  const span = end - start;
  const lap = leaderLap(data, t);

  // Stop at the end of the data. Every window does the same check, so it's harmless if several fire.
  useEffect(() => {
    if (synced.playing && t >= end) clock.pause();
    if (t > end + 1000 || t < start - 1000) clock.seek(Math.min(end, Math.max(start, t)));
  }, [t, synced.playing, end, start]);

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
            LAP <b>{Math.min(lap, totalLaps) || '–'}</b>/{totalLaps}{' '}
          </>
        )}
        · <b>{formatClock(sinceStart)}</b>
      </span>
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
