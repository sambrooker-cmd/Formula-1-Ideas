// Season calendar and standings for the local server (see shared/season.ts).
import { get } from './openf1.ts';
import { listCachedSessions } from './db.ts';
import { buildSeason, buildStandingsBefore, makeJolpica } from '../shared/season.ts';

const jolpica = makeJolpica({ 'user-agent': 'pit-wall-fan-project' });

/** OpenF1 race sessions for a year, so calendar rows can link straight to a replay. Cached for an hour. */
const openf1Races = new Map<number, { at: number; rows: Record<string, any>[] }>();
export async function raceSessions(year: number) {
  const hit = openf1Races.get(year);
  if (hit && Date.now() - hit.at < 3600e3) return hit.rows;
  try {
    const rows = await get('sessions', `year=${year}&session_name=Race`);
    openf1Races.set(year, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? []; // e.g. OpenF1's free tier is paused during a live session
  }
}

export function season(year: number) {
  const cached = new Map(listCachedSessions().map((s) => [s.session_key, s.complete]));
  return buildSeason(year, { jolpica, raceSessions, isCached: (k) => cached.get(k) === true });
}

export function standingsBefore(year: number, date: string, kind: 'race' | 'sprint') {
  return buildStandingsBefore(year, date, kind, jolpica);
}
