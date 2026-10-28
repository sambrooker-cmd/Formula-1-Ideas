// Career data for any driver since 1950 (Jolpica): every race result and championship finish.
// Saved in the browser, refreshed weekly (careers only change on race weekends).
import { jolpica, jolpicaAll } from './history';

export interface CareerDriver {
  id: string;
  name: string;
  code: string;
  nationality: string;
  dob: string;
}

/** [year, round, raceName, teamId, teamName, grid, position|null, positionText, points, status, fastestLapRank] */
export type CareerRace = [number, number, string, string, string, number, number | null, string, number, string, number | null];

export interface Career {
  driver: CareerDriver;
  races: CareerRace[];
  /** Sprint points by year (they count towards totals). */
  sprintPoints: Record<number, number>;
  sprintWins: number;
  /** Final championship position by year. */
  standings: Record<number, number>;
  fetchedAt: number;
}

const WEEK = 7 * 86_400e3;

function stored<T>(key: string, ttl: number): T | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (v && Date.now() - v.at < ttl) return v.data as T;
  } catch {
    // ignore
  }
  return null;
}
function store(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // full: fine
  }
}

/** Every driver in the database (about 870), for the search box. */
export async function allDrivers(): Promise<CareerDriver[]> {
  const key = 'pitwall.drivers.v1';
  const hit = stored<CareerDriver[]>(key, 30 * 86_400e3);
  if (hit) return hit;
  const out: CareerDriver[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await jolpica(`drivers.json?limit=100&offset=${offset}`);
    for (const d of page.DriverTable.Drivers) out.push(toDriver(d));
    if (offset + 100 >= Number(page.total)) break;
  }
  store(key, out);
  return out;
}

function toDriver(d: any): CareerDriver {
  return {
    id: d.driverId,
    name: `${d.givenName} ${d.familyName}`,
    code: d.code ?? d.familyName.slice(0, 3).toUpperCase(),
    nationality: d.nationality ?? '',
    dob: d.dateOfBirth ?? '',
  };
}

const memory = new Map<string, Promise<Career>>();
export function career(id: string): Promise<Career> {
  if (!memory.has(id)) {
    const p = loadCareer(id);
    p.catch(() => memory.delete(id));
    memory.set(id, p);
  }
  return memory.get(id)!;
}

async function loadCareer(id: string): Promise<Career> {
  const key = `pitwall.career.v1.${id}`;
  const hit = stored<Career>(key, WEEK);
  if (hit) return hit;
  const info = await jolpica(`drivers/${id}.json`);
  const d = info.DriverTable.Drivers[0];
  if (!d) throw new Error(`No driver "${id}"`);
  const results = await jolpicaAll(`drivers/${id}/results.json`);
  const sprints = await jolpicaAll(`drivers/${id}/sprint.json`).catch(() => []);
  const c: Career = {
    driver: toDriver(d),
    races: results.flatMap((race) =>
      (race.Results ?? []).map(
        (r: any): CareerRace => [
          Number(race.season),
          Number(race.round),
          race.raceName,
          r.Constructor.constructorId,
          r.Constructor.name,
          Number(r.grid ?? 0),
          /^\d+$/.test(r.positionText) ? Number(r.position) : null,
          r.positionText,
          Number(r.points ?? 0),
          r.status ?? '',
          r.FastestLap?.rank ? Number(r.FastestLap.rank) : null,
        ],
      ),
    ),
    sprintPoints: {},
    sprintWins: 0,
    standings: {},
    fetchedAt: Date.now(),
  };
  for (const race of sprints) {
    for (const r of race.SprintResults ?? []) {
      const y = Number(race.season);
      c.sprintPoints[y] = (c.sprintPoints[y] ?? 0) + Number(r.points ?? 0);
      if (r.position === '1') c.sprintWins++;
    }
  }
  // Final championship position, one season at a time (Jolpica has no all-seasons query).
  // Finished seasons never change, so they're kept for good.
  const thisYear = new Date().getFullYear();
  for (const y of [...new Set(c.races.map((r) => r[0]))]) {
    const k = `pitwall.standing.v1.${id}.${y}`;
    const saved = y < thisYear ? stored<number>(k, Infinity) : null;
    if (saved != null) {
      c.standings[y] = saved;
      continue;
    }
    const st = await jolpica(`${y}/drivers/${id}/driverStandings.json`).catch(() => null);
    const row = st?.StandingsTable?.StandingsLists?.[0]?.DriverStandings?.[0];
    if (!row) continue;
    c.standings[y] = Number(row.position ?? row.positionText);
    if (y < thisYear) store(k, c.standings[y]);
  }
  c.races.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  store(key, c);
  return c;
}

export interface CareerStats {
  seasons: number[];
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  points: number;
  titles: number;
  dnfs: number;
  bestChampionship: number | null;
  avgFinish: number | null;
  teams: string[];
  firstRace: CareerRace | null;
  firstWin: CareerRace | null;
  lastRace: CareerRace | null;
}

const finished = (r: CareerRace) => r[6] != null && /Finished|Lap|^\+/.test(r[9]);

export function careerStats(c: Career): CareerStats {
  const started = c.races.filter((r) => !/Did not|Withdrew|Not qualified|DNQ|DNPQ|Excluded/i.test(r[9]) && r[5] >= 0);
  const fin = c.races.filter((r) => r[6] != null);
  const seasons = [...new Set(c.races.map((r) => r[0]))];
  const champs = Object.values(c.standings);
  const current = new Date().getFullYear();
  return {
    seasons,
    starts: started.length,
    wins: c.races.filter((r) => r[6] === 1).length,
    podiums: c.races.filter((r) => r[6] != null && r[6] <= 3).length,
    poles: c.races.filter((r) => r[5] === 1).length,
    fastestLaps: c.races.filter((r) => r[10] === 1).length,
    points: c.races.reduce((s, r) => s + r[8], 0) + Object.values(c.sprintPoints).reduce((s, v) => s + v, 0),
    // A title counts once the season is over.
    titles: Object.entries(c.standings).filter(([y, p]) => p === 1 && Number(y) < current).length,
    dnfs: started.filter((r) => !finished(r)).length,
    bestChampionship: champs.length ? Math.min(...champs) : null,
    avgFinish: fin.length ? fin.reduce((s, r) => s + r[6]!, 0) / fin.length : null,
    teams: [...new Set(c.races.map((r) => r[4]))],
    firstRace: c.races[0] ?? null,
    firstWin: c.races.find((r) => r[6] === 1) ?? null,
    lastRace: c.races.at(-1) ?? null,
  };
}

/** Races both drivers took part in: who finished ahead (both classified), and as team-mates. */
export function versus(a: Career, b: Career) {
  const key = (r: CareerRace) => `${r[0]}-${r[1]}`;
  const bByRace = new Map(b.races.map((r) => [key(r), r]));
  let met = 0;
  const ahead = [0, 0];
  const mates = { races: 0, quali: [0, 0], race: [0, 0], points: [0, 0], seasons: new Set<number>(), team: new Set<string>() };
  for (const ra of a.races) {
    const rb = bByRace.get(key(ra));
    if (!rb) continue;
    met++;
    if (ra[6] != null && rb[6] != null) ahead[ra[6] < rb[6] ? 0 : 1]++;
    if (ra[3] === rb[3]) {
      mates.races++;
      mates.seasons.add(ra[0]);
      mates.team.add(ra[4]);
      if (ra[5] > 0 && rb[5] > 0) mates.quali[ra[5] < rb[5] ? 0 : 1]++;
      if (ra[6] != null && rb[6] != null) mates.race[ra[6] < rb[6] ? 0 : 1]++;
      mates.points[0] += ra[8];
      mates.points[1] += rb[8];
    }
  }
  return { met, ahead, mates };
}
