// Small builders for test data, so tests don't need the network or downloaded races.
import type { HRace, HResult, SeasonHistory } from '../web/src/data/history.ts';

export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

/** A season: `results[round]` is the finishing order (driver ids, all on team `t_<id>`, two per team). */
export function season(rounds: number, finished: string[][], opts: { sprints?: number[] } = {}): SeasonHistory {
  const races: HRace[] = Array.from({ length: rounds }, (_, i) => ({
    round: i + 1,
    name: `Race ${i + 1}`,
    date: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, '0')}`,
    start: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, '0')}T13:00:00Z`,
    circuitId: `c${i + 1}`,
    circuit: 'Circuit',
    locality: 'Town',
    country: 'Land',
    lat: 0,
    lng: 0,
    sprint: (opts.sprints ?? []).includes(i + 1),
  }));
  const ids = [...new Set(finished.flat())];
  const team = (id: string) => `team${Math.floor(ids.indexOf(id) / 2)}`;
  const results: HResult[] = [];
  finished.forEach((order, r) =>
    order.forEach((id, p) => results.push([r + 1, id, team(id), p + 1, p + 1, String(p + 1), RACE_POINTS[p] ?? 0, 50, 'Finished', null, null, 0])),
  );
  return {
    year: 2026,
    fetchedAt: Date.now(),
    races,
    drivers: Object.fromEntries(ids.map((id) => [id, { id, code: id.slice(0, 3).toUpperCase(), given: id, family: id, number: '1', nationality: '', dob: '' }])),
    teams: Object.fromEntries(ids.map((id) => [team(id), team(id)])),
    results,
    sprints: [],
    quali: finished.flatMap((order, r) => order.map((id, p) => [r + 1, id, team(id), p + 1, null, null, null] as SeasonHistory['quali'][number])),
  };
}
