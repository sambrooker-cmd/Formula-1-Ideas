// Season calendar, results and championship standings from Jolpica (the Ergast successor).
// Free, no key, 500 requests/hour: responses are cached for 10 minutes, so a page load
// costs at most 4 requests and usually none.
import { get } from './openf1.ts';
import { listCachedSessions } from './db.ts';

const JOLPICA = 'https://api.jolpi.ca/ergast/f1/';
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; data: any }>();
let lastRequest = 0;

async function jolpica(path: string) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  // Jolpica allows bursts of 4/s; space ours out anyway.
  const wait = lastRequest + 300 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(JOLPICA + path, { headers: { 'user-agent': 'pit-wall-fan-project' } });
  if (!res.ok) {
    if (hit) return hit.data; // stale beats nothing
    throw new Error(`Jolpica ${res.status} for ${path}`);
  }
  const data = (await res.json()).MRData;
  cache.set(path, { at: Date.now(), data });
  return data;
}

/** OpenF1 race sessions for a year, so calendar rows can link straight to a replay. Cached for an hour. */
const openf1Races = new Map<number, { at: number; rows: Record<string, any>[] }>();
async function raceSessions(year: number) {
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

export async function season(year: number) {
  const schedule = await jolpica(`${year}.json?limit=100`);
  const winners = await jolpica(`${year}/results/1.json?limit=100`);
  const drivers = await jolpica(`${year}/driverStandings.json?limit=100`);
  const constructors = await jolpica(`${year}/constructorStandings.json?limit=100`);
  const sessions = await raceSessions(year);
  const cached = new Map(listCachedSessions().map((s) => [s.session_key, s.complete]));

  const winnerByRound = new Map<string, any>();
  for (const r of winners.RaceTable.Races) winnerByRound.set(r.round, r.Results?.[0]);

  const races = schedule.RaceTable.Races.map((r: any) => {
    const start = `${r.date}T${r.time ?? '12:00:00Z'}`;
    const w = winnerByRound.get(r.round);
    const session = sessions.find((s) => String(s.date_start).slice(0, 10) === r.date);
    const key = session?.session_key ?? null;
    return {
      round: Number(r.round),
      name: r.raceName,
      circuit: r.Circuit.circuitName,
      locality: r.Circuit.Location.locality,
      country: r.Circuit.Location.country,
      start,
      sprint: !!r.Sprint,
      winner: w ? { code: w.Driver.code ?? w.Driver.familyName.slice(0, 3).toUpperCase(), name: `${w.Driver.givenName} ${w.Driver.familyName}`, team: w.Constructor.name } : null,
      sessionKey: key,
      cached: key != null && cached.get(key) === true,
    };
  });

  const dList = drivers.StandingsTable.StandingsLists[0];
  const cList = constructors.StandingsTable.StandingsLists[0];
  return {
    year,
    afterRound: dList ? Number(dList.round) : 0,
    races,
    drivers: (dList?.DriverStandings ?? []).map((d: any) => ({
      position: Number(d.position ?? d.positionText),
      code: d.Driver.code ?? d.Driver.familyName.slice(0, 3).toUpperCase(),
      name: `${d.Driver.givenName} ${d.Driver.familyName}`,
      team: d.Constructors?.at(-1)?.name ?? '',
      points: Number(d.points),
      wins: Number(d.wins),
    })),
    constructors: (cList?.ConstructorStandings ?? []).map((c: any) => ({
      position: Number(c.position ?? c.positionText),
      name: c.Constructor.name,
      points: Number(c.points),
      wins: Number(c.wins),
    })),
  };
}

/**
 * Championship standings going into a race (or sprint) on `date`: after the previous
 * round, plus this weekend's sprint points when it's the main race.
 */
export async function standingsBefore(year: number, date: string, kind: 'race' | 'sprint') {
  const schedule = await jolpica(`${year}.json?limit=100`);
  const event = schedule.RaceTable.Races.find((r: any) => r.date === date || r.Sprint?.date === date);
  if (!event) throw new Error(`No ${year} round on ${date}`);
  const round = Number(event.round);

  const drivers = new Map<string, { code: string; name: string; team: string; points: number }>();
  const constructors = new Map<string, number>();
  if (round > 1) {
    const d = await jolpica(`${year}/${round - 1}/driverStandings.json?limit=100`);
    for (const s of d.StandingsTable.StandingsLists[0]?.DriverStandings ?? []) {
      const code = s.Driver.code ?? s.Driver.familyName.slice(0, 3).toUpperCase();
      drivers.set(code, { code, name: `${s.Driver.givenName} ${s.Driver.familyName}`, team: s.Constructors?.at(-1)?.name ?? '', points: Number(s.points) });
    }
    const c = await jolpica(`${year}/${round - 1}/constructorStandings.json?limit=100`);
    for (const s of c.StandingsTable.StandingsLists[0]?.ConstructorStandings ?? []) constructors.set(s.Constructor.name, Number(s.points));
  }
  if (kind === 'race' && event.Sprint) {
    const sprint = await jolpica(`${year}/${round}/sprint.json?limit=100`);
    for (const r of sprint.RaceTable.Races[0]?.SprintResults ?? []) {
      const code = r.Driver.code ?? r.Driver.familyName.slice(0, 3).toUpperCase();
      const pts = Number(r.points);
      const entry = drivers.get(code) ?? { code, name: `${r.Driver.givenName} ${r.Driver.familyName}`, team: r.Constructor.name, points: 0 };
      entry.points += pts;
      drivers.set(code, entry);
      constructors.set(r.Constructor.name, (constructors.get(r.Constructor.name) ?? 0) + pts);
    }
  }
  return {
    round,
    raceName: event.raceName,
    drivers: [...drivers.values()],
    constructors: [...constructors].map(([name, points]) => ({ name, points })),
  };
}
