// Circuit guide data: layout and corners (MultiViewer's free circuit API), elevation over a
// lap (OpenF1 car positions include height), and the circuit's history (Jolpica).
import { jolpicaAll } from './history';

const OPENF1 = 'https://api.openf1.org/v1/';

/** Cache JSON in localStorage for `ttlMs` (slow-changing data: layouts, history). */
async function cached<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const k = 'pitwall.cache.' + key;
  try {
    const hit = JSON.parse(localStorage.getItem(k) ?? 'null');
    if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  } catch {
    // ignore
  }
  const data = await fetcher();
  try {
    localStorage.setItem(k, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // storage full: fine
  }
  return data;
}

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}

export interface Meeting {
  meeting_key: number;
  circuit_key: number;
  circuit_short_name: string;
  circuit_type?: string;
  date_start: string;
  date_end: string;
  location: string;
}

/** The OpenF1 meeting for a race on `date` (YYYY-MM-DD). */
export async function meetingFor(year: number, date: string): Promise<Meeting | null> {
  const meetings: Meeting[] = await cached(`meetings.${year}`, 86_400e3, () => json(`${OPENF1}meetings?year=${year}`));
  return meetings.find((m) => m.date_start.slice(0, 10) <= date && date <= m.date_end.slice(0, 10)) ?? null;
}

export interface Layout {
  x: number[];
  y: number[];
  rotation: number;
  corners: { number: number; letter?: string; angle: number; length: number; trackPosition: { x: number; y: number } }[];
  pitLoss?: { normal: string; sc: string; vsc: string };
  /** Lap length in metres (from the outline). */
  length: number;
}

export async function layout(circuitKey: number, year: number): Promise<Layout | null> {
  return cached(`layout.${circuitKey}.${year}`, 30 * 86_400e3, async () => {
    for (const y of [year, year - 1, year - 2]) {
      try {
        const d = await json(`https://api.multiviewer.app/api/v1/circuits/${circuitKey}/${y}`);
        if (!d?.x?.length) continue;
        let len = 0;
        for (let i = 1; i < d.x.length; i++) len += Math.hypot(d.x[i] - d.x[i - 1], d.y[i] - d.y[i - 1]);
        return { x: d.x, y: d.y, rotation: d.rotation ?? 0, corners: d.corners ?? [], pitLoss: d.pitLoss, length: len / 10 };
      } catch {
        // try the year before
      }
    }
    return null;
  });
}

export interface Elevation {
  /** Distance from the line (m) and height relative to the lowest point (m). */
  points: [number, number][];
  driver: number;
  year: number;
}

/** Height over the fastest clean lap of the most recent race at this circuit (3 OpenF1 requests). */
export async function elevation(circuitKey: number): Promise<Elevation | null> {
  return cached(`elevation.${circuitKey}`, 90 * 86_400e3, async () => {
    const races = ((await json(`${OPENF1}sessions?circuit_key=${circuitKey}&session_name=Race`)) as any[])
      .filter((s) => Date.parse(s.date_end) < Date.now() - 86_400e3)
      .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
    const race = races[0];
    if (!race) return null;
    const laps = ((await json(`${OPENF1}laps?session_key=${race.session_key}`)) as any[])
      .filter((l) => l.lap_duration && !l.is_pit_out_lap && l.lap_number > 1 && l.date_start)
      .sort((a, b) => a.lap_duration - b.lap_duration);
    const lap = laps[0];
    if (!lap) return null;
    const from = new Date(Date.parse(lap.date_start)).toISOString();
    const to = new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000).toISOString();
    const loc = ((await json(`${OPENF1}location?session_key=${race.session_key}&driver_number=${lap.driver_number}&date>=${from}&date<${to}`)) as any[]).filter(
      (r) => r.x || r.y,
    );
    if (loc.length < 50) return null;
    const minZ = Math.min(...loc.map((r) => r.z));
    let dist = 0;
    const points: [number, number][] = loc.map((r, i) => {
      if (i) dist += Math.hypot(r.x - loc[i - 1].x, r.y - loc[i - 1].y) / 10;
      return [dist, (r.z - minZ) / 10];
    });
    return { points, driver: lap.driver_number, year: race.year };
  });
}

export interface CircuitHistory {
  winners: { year: number; round: number; driverId: string; driver: string; team: string; teamId: string; grid: number }[];
  fastest: { year: number; driver: string; time: string; seconds: number }[];
}

export async function circuitHistory(circuitId: string): Promise<CircuitHistory> {
  return cached(`circuit-history.${circuitId}`, 7 * 86_400e3, async () => {
    const wins = await jolpicaAll(`circuits/${circuitId}/results/1.json`);
    const fl = await jolpicaAll(`circuits/${circuitId}/fastest/1/results.json`);
    const toSec = (t: string) => {
      const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
      return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : Infinity;
    };
    return {
      winners: wins
        .map((r) => {
          const w = r.Results?.[0];
          return {
            year: Number(r.season),
            round: Number(r.round),
            driverId: w?.Driver.driverId,
            driver: `${w?.Driver.givenName} ${w?.Driver.familyName}`,
            team: w?.Constructor.name,
            teamId: w?.Constructor.constructorId,
            grid: Number(w?.grid ?? 0),
          };
        })
        .filter((w) => w.driverId)
        .sort((a, b) => b.year - a.year || b.round - a.round),
      fastest: fl
        .flatMap((r) =>
          (r.Results ?? [])
            .filter((x: any) => x.FastestLap?.Time?.time)
            .map((x: any) => ({ year: Number(r.season), driver: `${x.Driver.givenName} ${x.Driver.familyName}`, time: x.FastestLap.Time.time, seconds: toSec(x.FastestLap.Time.time) })),
        )
        .sort((a, b) => b.year - a.year),
    };
  });
}
