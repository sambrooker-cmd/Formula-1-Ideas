// How hard is it to overtake here? On-track passes in past races at a circuit, counted from
// Jolpica's lap-by-lap positions: a pass is two cars swapping places between one lap and the
// next with neither of them pitting (on that lap or the one before) or dropping out. The first
// lap is left out (that's the start). Kept in the browser after the first load (it's ~12
// requests per race).
import { jolpica } from './history';

export interface RaceOvertakes {
  year: number;
  round: number;
  name: string;
  laps: number;
  passes: number;
}

type LapRow = { number: string; Timings: { driverId: string; position: string }[] };

async function allLaps(year: number, round: number): Promise<Map<number, Map<string, number>>> {
  const laps = new Map<number, Map<string, number>>();
  for (let offset = 0; ; offset += 100) {
    const page = await jolpica(`${year}/${round}/laps.json?limit=100&offset=${offset}`);
    const rows: LapRow[] = page.RaceTable?.Races?.[0]?.Laps ?? [];
    for (const l of rows) {
      const m = laps.get(Number(l.number)) ?? new Map<string, number>();
      for (const t of l.Timings) m.set(t.driverId, Number(t.position));
      laps.set(Number(l.number), m);
    }
    if (offset + 100 >= Number(page.total ?? 0)) break;
  }
  return laps;
}

/** On-track passes in one race. */
export async function raceOvertakes(year: number, round: number): Promise<{ laps: number; passes: number } | null> {
  const key = `pitwall.overtakes.v1.${year}.${round}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit) return hit;
  } catch {
    // ignore
  }
  const laps = await allLaps(year, round);
  if (laps.size < 5) return null;
  const pits = await jolpica(`${year}/${round}/pitstops.json?limit=100`).catch(() => null);
  const pitted = new Set<string>(); // `${driver}:${lap}`
  for (const p of pits?.RaceTable?.Races?.[0]?.PitStops ?? []) {
    pitted.add(`${p.driverId}:${p.lap}`);
    pitted.add(`${p.driverId}:${Number(p.lap) + 1}`);
  }
  let passes = 0;
  const n = Math.max(...laps.keys());
  for (let lap = 2; lap <= n; lap++) {
    const prev = laps.get(lap - 1);
    const cur = laps.get(lap);
    if (!prev || !cur) continue;
    const clean = [...cur.keys()].filter((d) => prev.has(d) && !pitted.has(`${d}:${lap}`) && !pitted.has(`${d}:${lap - 1}`));
    for (const a of clean)
      for (const b of clean) if (prev.get(a)! > prev.get(b)! && cur.get(a)! < cur.get(b)!) passes++;
  }
  const out = { laps: n, passes };
  try {
    localStorage.setItem(key, JSON.stringify(out));
  } catch {
    // ignore
  }
  return out;
}

/** The last few races at a circuit. */
export async function circuitOvertakes(circuitId: string, races = 5, before = Date.now()): Promise<RaceOvertakes[]> {
  const page = await jolpica(`circuits/${circuitId}/races.json?limit=100`);
  const list = (page.RaceTable?.Races ?? [])
    .filter((r: any) => Number(r.season) >= 2000 && Date.parse(r.date) < before - 86_400e3)
    .sort((a: any, b: any) => Number(b.season) - Number(a.season))
    .slice(0, races);
  const out: RaceOvertakes[] = [];
  for (const r of list) {
    const o = await raceOvertakes(Number(r.season), Number(r.round)).catch(() => null);
    if (o) out.push({ year: Number(r.season), round: Number(r.round), name: r.raceName, ...o });
  }
  return out;
}

/** Rough scale from recent seasons: a typical dry race has 30–50 passes. */
export function difficulty(perRace: number) {
  if (perRace < 12) return { label: 'very hard', tone: 'bad' };
  if (perRace < 25) return { label: 'hard', tone: 'bad' };
  if (perRace < 45) return { label: 'average', tone: '' };
  if (perRace < 70) return { label: 'easy', tone: 'good' };
  return { label: 'very easy', tone: 'good' };
}
