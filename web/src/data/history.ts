// Season history from Jolpica: every race, sprint and qualifying result of a season, fetched
// once (about a dozen requests) and kept in the browser. Finished seasons are kept for good;
// the current one is refreshed after an hour. Feeds the season stats, driver and circuit pages.
import { makeJolpica } from '../../../shared/season';

const fetcher = makeJolpica();
/** Requests made so far, for the loading message (a first load is ~13 requests, Jolpica can be slow). */
export const jolpicaProgress = { done: 0 };
export const jolpica: typeof fetcher = async (path) => {
  const r = await fetcher(path);
  jolpicaProgress.done++;
  return r;
};

export interface HRace {
  round: number;
  name: string;
  date: string;
  /** Lights out, ISO. */
  start: string;
  circuitId: string;
  circuit: string;
  locality: string;
  country: string;
  sprint: boolean;
}

export interface HDriver {
  id: string;
  code: string;
  given: string;
  family: string;
  number: string;
  nationality: string;
  dob: string;
}

/** [round, driverId, teamId, grid, position (null if not classified), positionText, points, laps, status, fastest-lap rank, fastest-lap time, car number] */
export type HResult = [number, string, string, number, number | null, string, number, number, string, number | null, string | null, number];
/** [round, driverId, teamId, position, q1, q2, q3] */
export type HQuali = [number, string, string, number, string | null, string | null, string | null];

export interface SeasonHistory {
  year: number;
  fetchedAt: number;
  races: HRace[];
  drivers: Record<string, HDriver>;
  teams: Record<string, string>;
  results: HResult[];
  sprints: HResult[];
  quali: HQuali[];
}

const STORE_VERSION = 1;
const key = (year: number) => `pitwall.history.v${STORE_VERSION}.${year}`;
const memory = new Map<number, Promise<SeasonHistory>>();

export function seasonHistory(year: number): Promise<SeasonHistory> {
  if (!memory.has(year)) {
    const p = load(year);
    p.catch(() => memory.delete(year));
    memory.set(year, p);
  }
  return memory.get(year)!;
}

async function load(year: number): Promise<SeasonHistory> {
  const finished = year < new Date().getFullYear();
  try {
    const saved = JSON.parse(localStorage.getItem(key(year)) ?? 'null') as SeasonHistory | null;
    if (saved && (finished || Date.now() - saved.fetchedAt < 3600e3)) return saved;
  } catch {
    // no storage, or a bad copy: fetch again
  }
  const h = await fetchSeason(year);
  try {
    localStorage.setItem(key(year), JSON.stringify(h));
  } catch {
    // storage full or blocked: fine, it's only a cache
  }
  return h;
}

/** All pages of a Jolpica list (it returns at most 100 rows at a time). */
export async function jolpicaAll(path: string): Promise<any[]> {
  const races = new Map<string, any>();
  const listKey = /(results|qualifying|sprint)\.json|\/results\/|\/qualifying\//.test(path);
  let offset = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await jolpica(`${path}${sep}limit=100&offset=${offset}`);
    for (const r of page.RaceTable.Races) {
      // A race's rows can be split across two pages: merge them.
      const k = `${r.season}-${r.round}`;
      const prev = races.get(k);
      if (prev && listKey) {
        for (const f of ['Results', 'QualifyingResults', 'SprintResults']) if (r[f]) prev[f] = [...(prev[f] ?? []), ...r[f]];
      } else races.set(k, r);
    }
    offset += 100;
    if (offset >= Number(page.total)) break;
  }
  return [...races.values()];
}

const num = (s: string | undefined) => (s == null || s === '' ? null : Number(s));

async function fetchSeason(year: number): Promise<SeasonHistory> {
  const schedule = await jolpicaAll(`${year}.json`);
  const results = await jolpicaAll(`${year}/results.json`);
  const sprints = await jolpicaAll(`${year}/sprint.json`);
  const quali = await jolpicaAll(`${year}/qualifying.json`);

  const drivers: Record<string, HDriver> = {};
  const teams: Record<string, string> = {};
  const seen = (d: any, c: any) => {
    drivers[d.driverId] ??= {
      id: d.driverId,
      code: d.code ?? d.familyName.slice(0, 3).toUpperCase(),
      given: d.givenName,
      family: d.familyName,
      number: d.permanentNumber ?? '',
      nationality: d.nationality ?? '',
      dob: d.dateOfBirth ?? '',
    };
    teams[c.constructorId] ??= c.name;
  };
  const toResult = (round: number, r: any): HResult => {
    seen(r.Driver, r.Constructor);
    return [
      round,
      r.Driver.driverId,
      r.Constructor.constructorId,
      Number(r.grid ?? 0),
      /^\d+$/.test(r.positionText) ? Number(r.position) : null,
      r.positionText,
      Number(r.points ?? 0),
      Number(r.laps ?? 0),
      r.status ?? '',
      num(r.FastestLap?.rank),
      r.FastestLap?.Time?.time ?? null,
      Number(r.number ?? 0),
    ];
  };

  return {
    year,
    fetchedAt: Date.now(),
    races: schedule.map((r) => ({
      round: Number(r.round),
      name: r.raceName,
      date: r.date,
      start: `${r.date}T${r.time ?? '12:00:00Z'}`,
      circuitId: r.Circuit.circuitId,
      circuit: r.Circuit.circuitName,
      locality: r.Circuit.Location.locality,
      country: r.Circuit.Location.country,
      sprint: !!r.Sprint,
    })),
    drivers,
    teams,
    results: results.flatMap((race) => (race.Results ?? []).map((r: any) => toResult(Number(race.round), r))),
    sprints: sprints.flatMap((race) => (race.SprintResults ?? []).map((r: any) => toResult(Number(race.round), r))),
    quali: quali.flatMap((race) =>
      (race.QualifyingResults ?? []).map((q: any): HQuali => {
        seen(q.Driver, q.Constructor);
        return [Number(race.round), q.Driver.driverId, q.Constructor.constructorId, Number(q.position), q.Q1 || null, q.Q2 || null, q.Q3 || null];
      }),
    ),
  };
}

// ---- derived stats --------------------------------------------------------------

export const isDnf = (r: HResult) => r[4] == null || !/Finished|Lap|^\+/.test(r[8]);
/** The number a driver raced with that season (the permanent number Jolpica gives can be a later one). */
export function carNumber(h: SeasonHistory, id: string) {
  const counts = new Map<number, number>();
  for (const r of h.results) if (r[1] === id && r[11]) counts.set(r[11], (counts.get(r[11]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (Number(h.drivers[id]?.number) || null);
}

export const fullName = (d: HDriver | undefined) => (d ? `${d.given} ${d.family}` : '');

/** Rounds that have results so far. */
export function completedRounds(h: SeasonHistory) {
  return [...new Set(h.results.map((r) => r[0]))].sort((a, b) => a - b);
}

export interface DriverStats {
  id: string;
  team: string;
  teams: string[];
  points: number;
  position: number;
  starts: number;
  wins: number;
  podiums: number;
  poles: number;
  fastestLaps: number;
  pointsFinishes: number;
  dnfs: number;
  best: number | null;
  avgFinish: number | null;
  avgQuali: number | null;
  sprintPoints: number;
  sprintWins: number;
  gained: number;
}

/** Per-driver season totals, ranked by points (ties: wins, then best finishes). */
export function driverStats(h: SeasonHistory): DriverStats[] {
  const by = new Map<string, DriverStats>();
  const get = (id: string, team: string) => {
    let s = by.get(id);
    if (!s)
      by.set(
        id,
        (s = { id, team, teams: [], points: 0, position: 0, starts: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, pointsFinishes: 0, dnfs: 0, best: null, avgFinish: null, avgQuali: null, sprintPoints: 0, sprintWins: 0, gained: 0 }),
      );
    if (!s.teams.includes(team)) s.teams.push(team);
    s.team = team;
    return s;
  };
  const finishes = new Map<string, number[]>();
  for (const r of [...h.results].sort((a, b) => a[0] - b[0])) {
    const s = get(r[1], r[2]);
    s.starts++;
    s.points += r[6];
    if (r[4] === 1) s.wins++;
    if (r[4] != null && r[4] <= 3) s.podiums++;
    if (r[9] === 1) s.fastestLaps++;
    if (r[6] > 0) s.pointsFinishes++;
    if (isDnf(r)) s.dnfs++;
    if (r[4] != null) {
      s.best = s.best == null ? r[4] : Math.min(s.best, r[4]);
      finishes.set(r[1], [...(finishes.get(r[1]) ?? []), r[4]]);
      if (r[3] > 0) s.gained += r[3] - r[4];
    }
  }
  for (const r of h.sprints) {
    const s = get(r[1], r[2]);
    s.points += r[6];
    s.sprintPoints += r[6];
    if (r[4] === 1) s.sprintWins++;
  }
  const qpos = new Map<string, number[]>();
  for (const q of h.quali) {
    const s = get(q[1], q[2]);
    if (q[3] === 1) s.poles++;
    qpos.set(q[1], [...(qpos.get(q[1]) ?? []), q[3]]);
  }
  const avg = (a?: number[]) => (a?.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  for (const s of by.values()) {
    s.avgFinish = avg(finishes.get(s.id));
    s.avgQuali = avg(qpos.get(s.id));
  }
  const list = [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || (a.best ?? 99) - (b.best ?? 99));
  list.forEach((s, i) => (s.position = i + 1));
  return list;
}

export interface TeamStats {
  id: string;
  name: string;
  points: number;
  wins: number;
  podiums: number;
  oneTwos: number;
  dnfs: number;
  drivers: string[];
}

export function teamStats(h: SeasonHistory): TeamStats[] {
  const by = new Map<string, TeamStats>();
  const get = (id: string) => {
    let t = by.get(id);
    if (!t) by.set(id, (t = { id, name: h.teams[id] ?? id, points: 0, wins: 0, podiums: 0, oneTwos: 0, dnfs: 0, drivers: [] }));
    return t;
  };
  for (const r of [...h.results, ...h.sprints]) {
    const t = get(r[2]);
    t.points += r[6];
    if (!t.drivers.includes(r[1])) t.drivers.push(r[1]);
  }
  for (const r of h.results) {
    const t = get(r[2]);
    if (r[4] === 1) t.wins++;
    if (r[4] != null && r[4] <= 3) t.podiums++;
    if (isDnf(r)) t.dnfs++;
  }
  for (const round of completedRounds(h)) {
    const top2 = h.results.filter((r) => r[0] === round && (r[4] === 1 || r[4] === 2));
    if (top2.length === 2 && top2[0][2] === top2[1][2]) get(top2[0][2]).oneTwos++;
  }
  return [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
}

/** Cumulative points after each round (races plus sprints), per driver id or team id. */
export function pointsProgression(h: SeasonHistory, by: 'driver' | 'team') {
  const rounds = completedRounds(h);
  const out = new Map<string, number[]>();
  const idx = by === 'driver' ? 1 : 2;
  rounds.forEach((round, i) => {
    for (const r of [...h.results, ...h.sprints]) {
      if (r[0] !== round) continue;
      const id = r[idx] as string;
      if (!out.has(id)) out.set(id, new Array(rounds.length).fill(0));
      out.get(id)![i] += r[6];
    }
  });
  for (const arr of out.values()) for (let i = 1; i < arr.length; i++) arr[i] += arr[i - 1];
  // Anyone who joined mid-season: carry zeros forward correctly (already zero-filled).
  return { rounds, series: out };
}

export interface HeadToHead {
  team: string;
  a: string;
  b: string;
  quali: [number, number];
  race: [number, number];
  points: [number, number];
}

/** Team-mate battles: the pair of drivers who raced together most for each team. */
export function teammateBattles(h: SeasonHistory): HeadToHead[] {
  const out: HeadToHead[] = [];
  for (const team of Object.keys(h.teams)) {
    const together = new Map<string, number>();
    for (const round of completedRounds(h)) {
      const ds = h.results.filter((r) => r[0] === round && r[2] === team).map((r) => r[1]).sort();
      if (ds.length === 2) together.set(ds.join('|'), (together.get(ds.join('|')) ?? 0) + 1);
    }
    const pair = [...together].sort((x, y) => y[1] - x[1])[0];
    if (!pair) continue;
    const [a, b] = pair[0].split('|');
    out.push(headToHead(h, team, a, b));
  }
  return out;
}

export function headToHead(h: SeasonHistory, team: string, a: string, b: string): HeadToHead {
  const res: HeadToHead = { team, a, b, quali: [0, 0], race: [0, 0], points: [0, 0] };
  for (const round of completedRounds(h)) {
    const qa = h.quali.find((q) => q[0] === round && q[1] === a);
    const qb = h.quali.find((q) => q[0] === round && q[1] === b);
    if (qa && qb && qa[2] === qb[2]) res.quali[qa[3] < qb[3] ? 0 : 1]++;
    const ra = h.results.find((r) => r[0] === round && r[1] === a);
    const rb = h.results.find((r) => r[0] === round && r[1] === b);
    if (ra && rb && ra[2] === rb[2] && ra[4] != null && rb[4] != null) res.race[ra[4] < rb[4] ? 0 : 1]++;
  }
  for (const r of [...h.results, ...h.sprints]) {
    if (r[2] !== team) continue;
    if (r[1] === a) res.points[0] += r[6];
    if (r[1] === b) res.points[1] += r[6];
  }
  return res;
}

/** "1:23.456" → seconds. */
export function lapSeconds(s: string | null) {
  if (!s) return null;
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(s.trim());
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
}
