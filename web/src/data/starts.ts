// Starts: what happened between the grid and the end of lap 1, in this race and in past races
// at the same circuit (Jolpica has lap-by-lap positions from 1996).
import type { SessionData } from './session';
import { lastAtOrBefore } from './state';
import { jolpica, jolpicaAll } from './history';

export interface LapOneRow {
  driver: number;
  grid: number;
  /** Position at the end of lap 1, or null if they didn't complete it. */
  lap1: number | null;
}

/** Grid against position at the end of each car's first lap. */
export function lapOne(data: SessionData): LapOneRow[] {
  const rows: LapOneRow[] = [];
  for (const [n, grid] of data.meta.grid) {
    if (!grid) continue;
    const l1 = data.laps.get(n)?.find((l) => l.lap === 1);
    let lap1: number | null = null;
    if (l1?.duration != null) {
      const s = data.positions.get(n);
      const i = s ? lastAtOrBefore(s.t, l1.end + 1500) : -1;
      lap1 = i >= 0 ? s!.v[i] : null;
    }
    rows.push({ driver: n, grid, lap1 });
  }
  return rows.sort((a, b) => (a.lap1 ?? 99) - (b.lap1 ?? 99));
}

export interface PastStart {
  year: number;
  round: number;
  poleSitter: string;
  /** Who led at the end of lap 1. */
  leader: string;
  poleKept: boolean;
  /** Average places changed per car on lap 1. */
  avgChange: number;
  biggestGain: { driver: string; from: number; to: number } | null;
  /** Cars that started but didn't complete lap 1. */
  lap1Out: string[];
}

/** The last few races at a circuit: how the starts went (about 2 requests per race, kept for a week). */
export async function circuitStarts(circuitId: string, races = 8): Promise<PastStart[]> {
  const key = `pitwall.starts.v1.${circuitId}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit && Date.now() - hit.at < 7 * 86_400e3) return hit.data;
  } catch {
    // ignore
  }
  const results = await jolpicaAll(`circuits/${circuitId}/results.json`);
  const recent = results
    .filter((r) => Number(r.season) >= 1996)
    .sort((a, b) => Number(b.season) - Number(a.season))
    .slice(0, races);
  const out: PastStart[] = [];
  for (const race of recent) {
    const page = await jolpica(`${race.season}/${race.round}/laps/1.json?limit=40`).catch(() => null);
    const timings: { driverId: string; position: string }[] = page?.RaceTable?.Races?.[0]?.Laps?.[0]?.Timings ?? [];
    if (!timings.length) continue;
    const name = (id: string) => {
      const r = race.Results.find((x: any) => x.Driver.driverId === id);
      return r ? `${r.Driver.givenName} ${r.Driver.familyName}` : id;
    };
    const lap1 = new Map(timings.map((t) => [t.driverId, Number(t.position)]));
    const starters = race.Results.filter((r: any) => Number(r.grid) > 0);
    const pole = starters.find((r: any) => r.grid === '1');
    const leader = timings.find((t) => t.position === '1')!.driverId;
    let change = 0;
    let counted = 0;
    let best: PastStart['biggestGain'] = null;
    for (const r of starters) {
      const p = lap1.get(r.Driver.driverId);
      if (p == null) continue;
      const g = Number(r.grid);
      change += Math.abs(g - p);
      counted++;
      if (g - p > 0 && (!best || g - p > best.from - best.to)) best = { driver: name(r.Driver.driverId), from: g, to: p };
    }
    out.push({
      year: Number(race.season),
      round: Number(race.round),
      poleSitter: pole ? name(pole.Driver.driverId) : '–',
      leader: name(leader),
      poleKept: !!pole && pole.Driver.driverId === leader,
      avgChange: counted ? change / counted : 0,
      biggestGain: best,
      lap1Out: starters.filter((r: any) => !lap1.has(r.Driver.driverId)).map((r: any) => name(r.Driver.driverId)),
    });
  }
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: out }));
  } catch {
    // ignore
  }
  return out;
}
