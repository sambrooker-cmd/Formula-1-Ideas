// Race strategy before the race: from practice long runs, how quick each tyre is and how fast it
// wears, then every one- and two-stop plan for the race is timed to find the quickest and its pit
// windows. Deliberately simple (no traffic, Safety Cars or tyre warm-up), like the teams' own
// first pass.
import type { LongRun } from './longruns';
import { FUEL_PER_LAP } from './racepace';

export interface CompoundModel {
  compound: string;
  /** Pace on new tyres, relative to the quickest compound (s/lap). */
  pace: number;
  /** Time lost per lap of wear (s/lap/lap). */
  deg: number;
  runs: number;
  /** Not run enough in this session: estimated from the others. */
  estimated: boolean;
}

export interface Plan {
  stints: { compound: string; laps: number }[];
  /** Laps at the end of which they pit. */
  stops: number[];
  /** Race time against the quickest plan (s). */
  delta: number;
  /** For each stop: the range of laps that keeps the plan within a second of its best. */
  windows: [number, number][];
}

const DRY = ['SOFT', 'MEDIUM', 'HARD'];
export let DEG_SCALE = 0.4;
export const setDegScale = (v: number) => (DEG_SCALE = v);
/** Longest sensible stint by compound. */
const LIFE: Record<string, number> = { SOFT: 25, MEDIUM: 38, HARD: 50 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

export function compoundModels(runs: LongRun[]): CompoundModel[] {
  const raw = new Map<string, { pace: number; deg: number; runs: number }>();
  for (const c of DRY) {
    const rs = runs.filter((r) => r.compound === c && r.clean >= 5);
    if (rs.length < 2) continue;
    // The measured slope is wear minus the gain from burning fuel: add the fuel back. Practice
    // runs are short and pushed, so they wear tyres faster than a managed race stint: scaled
    // down to match real races (checked against past races' one- and two-stop outcomes).
    const deg = Math.min(0.2, Math.max(0.015, (median(rs.map((r) => r.slope)) + FUEL_PER_LAP) * DEG_SCALE));
    // Each run's average, wound back to new tyres.
    const fresh = median(rs.map((r) => r.average - deg * ((r.tyreAge ?? 0) + (r.clean + 1) / 2)));
    raw.set(c, { pace: fresh, deg, runs: rs.length });
  }
  if (!raw.size) return [];
  // Fill in missing compounds from typical gaps (hards are often barely run in practice).
  const STEP = { pace: 0.35, deg: 0.65 }; // each harder compound: ~0.35 s slower, ~35% less wear
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < DRY.length; i++) {
      const c = DRY[i];
      if (raw.has(c)) continue;
      const softer = raw.get(DRY[i - 1]);
      const harder = raw.get(DRY[i + 1]);
      if (softer) raw.set(c, { pace: softer.pace + STEP.pace, deg: softer.deg * STEP.deg, runs: 0 });
      else if (harder) raw.set(c, { pace: harder.pace - STEP.pace, deg: harder.deg / STEP.deg, runs: 0 });
    }
  // Softer tyres are quicker and wear faster; when a few practice runs say otherwise (fuel loads
  // and track evolution vary), fall back on the usual gaps.
  for (let i = 1; i < DRY.length; i++) {
    const soft = raw.get(DRY[i - 1]);
    const hard = raw.get(DRY[i]);
    if (!soft || !hard) continue;
    if (hard.pace < soft.pace + 0.1) hard.pace = soft.pace + STEP.pace;
    if (hard.deg > soft.deg * 0.9) hard.deg = soft.deg * STEP.deg;
  }
  const best = Math.min(...[...raw.values()].map((v) => v.pace));
  return DRY.filter((c) => raw.has(c)).map((c) => ({ compound: c, pace: raw.get(c)!.pace - best, deg: raw.get(c)!.deg, runs: raw.get(c)!.runs, estimated: !raw.get(c)!.runs }));
}

/** Time for a stint of `laps` laps on new tyres (relative units). */
const stintTime = (m: CompoundModel, laps: number) => m.pace * laps + (m.deg * laps * (laps - 1)) / 2;

/** The quickest plan for each compound order, one and two stops, best first. */
export function planRace(models: CompoundModel[], raceLaps: number, pitLoss: number): Plan[] {
  const by = new Map(models.map((m) => [m.compound, m]));
  const cs = models.map((m) => m.compound);
  const plans: { stints: string[]; stops: number[]; time: number }[] = [];
  const fits = (c: string, laps: number) => laps >= 5 && laps <= (LIFE[c] ?? 40);

  // One stop.
  for (const a of cs)
    for (const b of cs) {
      if (a === b) continue; // two dry compounds must be used
      let best: { stops: number[]; time: number } | null = null;
      for (let k = 5; k <= raceLaps - 5; k++) {
        if (!fits(a, k) || !fits(b, raceLaps - k)) continue;
        const time = stintTime(by.get(a)!, k) + stintTime(by.get(b)!, raceLaps - k) + pitLoss;
        if (!best || time < best.time) best = { stops: [k], time };
      }
      if (best) plans.push({ stints: [a, b], ...best });
    }
  // Two stops.
  for (const a of cs)
    for (const b of cs)
      for (const c of cs) {
        if (a === b && b === c) continue;
        let best: { stops: number[]; time: number } | null = null;
        for (let k1 = 5; k1 <= raceLaps - 10; k1++)
          for (let k2 = k1 + 5; k2 <= raceLaps - 5; k2++) {
            if (!fits(a, k1) || !fits(b, k2 - k1) || !fits(c, raceLaps - k2)) continue;
            const time = stintTime(by.get(a)!, k1) + stintTime(by.get(b)!, k2 - k1) + stintTime(by.get(c)!, raceLaps - k2) + 2 * pitLoss;
            if (!best || time < best.time) best = { stops: [k1, k2], time };
          }
        if (best) plans.push({ stints: [a, b, c], ...best });
      }
  if (!plans.length) return [];
  plans.sort((x, y) => x.time - y.time);
  const fastest = plans[0].time;

  // Pit windows: how far each stop can move while staying within a second of the plan's best.
  const timeOf = (stints: string[], stops: number[]) => {
    const edges = [0, ...stops, raceLaps];
    let t = (stints.length - 1) * pitLoss;
    for (let i = 0; i < stints.length; i++) {
      const len = edges[i + 1] - edges[i];
      if (!fits(stints[i], len)) return Infinity;
      t += stintTime(by.get(stints[i])!, len);
    }
    return t;
  };
  return plans.slice(0, 8).map((p) => {
    const windows = p.stops.map((k, i): [number, number] => {
      let lo = k;
      let hi = k;
      const at = (lap: number) => timeOf(p.stints, p.stops.map((s, j) => (j === i ? lap : s)));
      while (lo > 1 && at(lo - 1) - p.time <= 1) lo--;
      while (hi < raceLaps - 1 && at(hi + 1) - p.time <= 1) hi++;
      return [lo, hi];
    });
    const edges = [0, ...p.stops, raceLaps];
    return {
      stints: p.stints.map((c, i) => ({ compound: c, laps: edges[i + 1] - edges[i] })),
      stops: p.stops,
      delta: p.time - fastest,
      windows,
    };
  });
}
