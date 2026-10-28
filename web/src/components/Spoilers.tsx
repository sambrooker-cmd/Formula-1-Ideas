// Spoiler-free mode: the on/off switch, the cover that hides results until you've watched a
// race, and the marker that notices when a replay reaches the flag (see spoilers.ts).
import { useEffect, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { seasonHistory } from '../data/history';
import { keyMoments } from '../data/moments';
import { raceId, spoilers, useSpoilers } from '../spoilers';
import { useNow } from '../hooks';

export function SpoilerToggle() {
  const { on } = useSpoilers();
  return (
    <button
      className={'icon-btn' + (on ? ' active' : '')}
      onClick={() => spoilers.setOn(!on)}
      title={
        on
          ? 'Spoiler-free is on: results of recent races you haven’t watched are hidden. Click to turn off.'
          : 'Spoiler-free: hide results of recent races until you’ve watched them'
      }
    >
      🙈 Spoiler-free{on ? ': on' : ''}
    </button>
  );
}

export interface RaceRef {
  id: string;
  name: string;
  start: string | number;
}

/** Hides its contents while any of these races is unwatched (in spoiler-free mode). */
export function SpoilerGate({ races, what, children }: { races: RaceRef[]; what: string; children: ReactNode }) {
  const { hidden } = useSpoilers();
  const unseen = races.filter((r) => hidden(r.id, r.start));
  if (!unseen.length) return <>{children}</>;
  const names = unseen.map((r) => r.name.replace(' Grand Prix', ' GP'));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  return (
    <div className="spoiler-cover">
      <div style={{ fontSize: 28 }}>🙈</div>
      <div>
        <b>Spoiler-free:</b> {what} would give away the <b>{list}</b>, which you haven't watched yet.
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => unseen.forEach((r) => spoilers.markWatched(r.id))}>
          I've watched {unseen.length > 1 ? 'them' : 'it'}
        </button>
        <button className="btn" onClick={() => unseen.forEach((r) => spoilers.reveal(r.id))}>
          Show anyway
        </button>
      </div>
    </div>
  );
}

/** The calendar race a replay belongs to (races only; matched on the date). */
export function useReplayRace(data: SessionData): RaceRef | null | undefined {
  const [race, setRace] = useState<RaceRef | null | undefined>(undefined);
  const isRace = data.meta.session.name === 'Race';
  useEffect(() => {
    if (!isRace || data.live) return setRace(null);
    const date = new Date(data.meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);
    seasonHistory(data.meta.session.year)
      .then((h) => {
        const r = h.races.find((x) => Math.abs(Date.parse(x.date) - Date.parse(date)) <= 3 * 86_400e3);
        setRace(r ? { id: raceId(data.meta.session.year, r.round), name: r.name, start: r.start } : null);
      })
      .catch(() => setRace(null));
  }, [data.meta.session.key, isRace, data.live]); // eslint-disable-line react-hooks/exhaustive-deps
  return race;
}

/** For analysis of a replay: hidden until the race is watched (or the replay reaches the flag). */
export function ReplayGate({ data, what, children }: { data: SessionData; what: string; children: ReactNode }) {
  const race = useReplayRace(data);
  if (!race) return <>{children}</>;
  return (
    <SpoilerGate races={[race]} what={what}>
      {children}
    </SpoilerGate>
  );
}

/** Counts a race as watched once its replay reaches the chequered flag. Renders nothing. */
export function WatchedMarker({ data }: { data: SessionData }) {
  const race = useReplayRace(data);
  const t = useNow(1);
  const { on } = useSpoilers();
  useEffect(() => {
    if (!on || !race) return;
    const flag = keyMoments(data).find((m) => m.kind === 'finish');
    if (flag && t >= flag.t) spoilers.markWatched(race.id);
  }, [on, race, t >= (keyMoments(data).find((m) => m.kind === 'finish')?.t ?? Infinity)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A season's finished races, for a gate on pages that show season results. */
export function finishedRaces(h: { year: number; races: { round: number; name: string; start: string }[]; results: [number, ...unknown[]][] }): RaceRef[] {
  const done = new Set(h.results.map((r) => r[0]));
  return h.races.filter((r) => done.has(r.round)).map((r) => ({ id: raceId(h.year, r.round), name: r.name, start: r.start }));
}
