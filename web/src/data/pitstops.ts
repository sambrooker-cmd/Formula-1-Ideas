// Pit stop league table: every stop of the season (Jolpica: pit lane time, entry to exit),
// compared within each race so different pit lanes are fair. Fetched one race at a time and
// kept in the browser.
import { completedRounds, jolpica, type SeasonHistory } from './history';

export interface Stop {
  round: number;
  driver: string;
  team: string;
  lap: number;
  /** Pit lane time (s). */
  lane: number;
  /** Against the race's typical stop (s): negative is quicker. */
  delta: number;
}

export interface TeamStops {
  team: string;
  stops: number;
  /** Median of each stop against the race's typical stop. */
  median: number;
  best: Stop | null;
  /** Stops more than 2 s slower than typical (not counting long ones for repairs or penalties). */
  slow: number;
  /** Races where this team made the quickest stop. */
  fastestOfRace: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

async function raceStops(year: number, round: number): Promise<{ driverId: string; lap: string; duration: string }[]> {
  const key = `pitwall.pitstops.v1.${year}.${round}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit) return hit;
  } catch {
    // ignore
  }
  const page = await jolpica(`${year}/${round}/pitstops.json?limit=100`);
  const stops = page.RaceTable?.Races?.[0]?.PitStops ?? [];
  try {
    if (stops.length) localStorage.setItem(key, JSON.stringify(stops.map((s: any) => ({ driverId: s.driverId, lap: s.lap, duration: s.duration }))));
  } catch {
    // ignore
  }
  return stops;
}

export async function seasonStops(h: SeasonHistory): Promise<Stop[]> {
  const out: Stop[] = [];
  for (const round of completedRounds(h)) {
    const raw = await raceStops(h.year, round).catch(() => []);
    const team = new Map(h.results.filter((r) => r[0] === round).map((r) => [r[1], r[2]]));
    const list = raw
      .map((s) => ({ driver: s.driverId, lane: parseFloat(s.duration), lap: Number(s.lap) }))
      .filter((s) => Number.isFinite(s.lane) && s.lane > 5); // red-flag "stops" show as minutes ("1:02:03"), which don't parse
    const typical = median(list.map((s) => s.lane));
    for (const s of list) out.push({ round, driver: s.driver, team: team.get(s.driver) ?? '', lap: s.lap, lane: s.lane, delta: s.lane - typical });
  }
  return out;
}

/** A stop this much slower than typical was for repairs, a penalty or a red flag: not a pit crew's doing. */
const OUTLIER = 8;

export function teamStops(stops: Stop[]): TeamStops[] {
  const teams = new Map<string, Stop[]>();
  for (const s of stops) if (s.team) teams.set(s.team, [...(teams.get(s.team) ?? []), s]);
  const quickest = new Map<number, Stop>();
  for (const s of stops) if (s.delta < OUTLIER && (!quickest.has(s.round) || s.lane < quickest.get(s.round)!.lane)) quickest.set(s.round, s);
  return [...teams]
    .map(([team, list]) => {
      const normal = list.filter((s) => s.delta < OUTLIER);
      return {
        team,
        stops: list.length,
        median: median(normal.map((s) => s.delta)),
        best: [...normal].sort((a, b) => a.delta - b.delta)[0] ?? null,
        slow: normal.filter((s) => s.delta > 2).length,
        fastestOfRace: [...quickest.values()].filter((s) => s.team === team).length,
      };
    })
    .filter((t) => Number.isFinite(t.median))
    .sort((a, b) => a.median - b.median);
}
