// How hard is it to overtake here? On-track passes in past races at a circuit, counted from
// Jolpica's lap-by-lap positions: a pass is two cars swapping places between one lap and the
// next with neither of them pitting (on that lap or the one before) or dropping out. The first
// lap is left out (that's the start). Kept in the browser after the first load (it's ~12
// requests per race).
import { jolpica } from './history';
import type { SessionData } from './session';
import { keyMoments } from './moments';
import { lastAtOrBefore, trackStatusAt } from './state';

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

/**
 * On-track passes in a replay, counted by the same rules as the lap-by-lap count above so the
 * two agree: not behind the Safety Car, neither car on an in- or out-lap, and the place kept for
 * at least 30 seconds (so timing flicker and passes straight back don't count).
 */
export function replayPasses(data: SessionData, lapOne = false) {
  const pos = (n: number, t: number) => {
    const s = data.positions.get(n);
    const i = s ? lastAtOrBefore(s.t, t) : -1;
    return i >= 0 ? s!.v[i] : 99;
  };
  const lapOf = (n: number, t: number) => {
    const ls = data.laps.get(n) ?? [];
    for (let i = ls.length - 1; i >= 0; i--) if (ls[i].t <= t) return ls[i].lap;
    return 0;
  };
  const pitLaps = new Map<number, Set<number>>();
  const pitting = (n: number, lap: number) => {
    if (!pitLaps.has(n)) pitLaps.set(n, new Set((data.pits.get(n) ?? []).flatMap((p) => (p.lap != null ? [p.lap, p.lap + 1] : []))));
    return pitLaps.get(n)!.has(lap);
  };
  const seen = new Set<string>();
  return keyMoments(data).filter((m) => {
    if (m.kind !== 'overtake') return false;
    if (!lapOne && (m.lap ?? 0) <= 1) return false;
    if (['SC', 'VSC', 'RED', 'SC_ENDING', 'VSC_ENDING'].includes(trackStatusAt(data, m.t).status)) return false;
    const [a, b] = m.drivers;
    if (!(pos(a, m.t - 4000) > pos(b, m.t - 4000) && pos(a, m.t + 30_000) < pos(b, m.t + 30_000))) return false;
    if (pitting(a, lapOf(a, m.t)) || pitting(b, lapOf(b, m.t))) return false;
    const k = `${a}-${b}-${m.lap}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
