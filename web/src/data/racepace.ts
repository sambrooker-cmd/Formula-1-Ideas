// Race pace models built from lap times: fuel-corrected laps, tyre degradation per compound,
// pace in clean air, and what that says about the tyres each car has left.
import type { SessionData } from './session';
import { lastAtOrBefore, stintForLap, trackStatusAt } from './state';

/** Lap time gained per lap as fuel burns off (≈1.6 kg/lap × ≈0.035 s/kg). */
export const FUEL_PER_LAP = 0.055;
/** Clean air: at least this far behind the car ahead (s) at both ends of the lap. */
export const CLEAN_GAP = 2.0;
/** Fewest laps for a pace figure. */
export const MIN_LAPS = 5;

export interface RaceLap {
  driver: number;
  lap: number;
  t: number;
  end: number;
  duration: number;
  /** Lap time with the fuel effect taken out (as if on an empty tank). */
  corrected: number;
  compound: string | null;
  tyreAge: number;
  stint: number;
  clean: boolean;
  /** Gap to the car ahead at the start of the lap (null for the leader). */
  gapAhead: number | null;
}

function intervalAt(data: SessionData, n: number, t: number) {
  const list = data.intervals.get(n);
  if (!list?.length) return undefined;
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans < 0 ? undefined : list[ans];
}

function positionAt(data: SessionData, n: number, t: number) {
  const s = data.positions.get(n);
  if (!s) return null;
  const i = lastAtOrBefore(s.t, t);
  return i < 0 ? null : s.v[i];
}

const cache = new WeakMap<SessionData, { version: number; until: number; laps: RaceLap[] }>();

/**
 * Representative race laps: green flag, not lap 1, not in or out of the pits, not wildly slow.
 * Only laps finished by `until`.
 */
export function raceLaps(data: SessionData, until = Infinity): RaceLap[] {
  const hit = cache.get(data);
  if (hit && hit.version === data.version && hit.until === until) return hit.laps;
  const total = Math.max(data.meta.totalLaps, 1);
  const out: RaceLap[] = [];
  const green = (t: number) => ['GREEN', 'YELLOW'].includes(trackStatusAt(data, t).status);
  for (const [n, laps] of data.laps) {
    const pitLaps = new Set((data.pits.get(n) ?? []).map((p) => p.lap));
    const done = laps.filter((l) => l.duration != null && l.end <= until && l.lap > 1);
    const sorted = done.map((l) => l.duration!).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const l of done) {
      if (l.pitOut || pitLaps.has(l.lap)) continue;
      if (!green(l.t) || !green(l.end - 1) || !green(l.t + (l.end - l.t) / 2)) continue;
      if (l.duration! > median * 1.07) continue;
      const stint = stintForLap(data, n, l.lap);
      const ivStart = intervalAt(data, n, l.t);
      const ivEnd = intervalAt(data, n, l.end - 500);
      const leader = positionAt(data, n, l.t) === 1;
      const gapAhead = leader ? null : ivStart?.interval ?? null;
      const clean = leader || ((ivStart?.interval ?? 0) >= CLEAN_GAP && (ivEnd?.interval ?? 0) >= CLEAN_GAP) || !!ivStart?.intervalText?.includes('LAP');
      out.push({
        driver: n,
        lap: l.lap,
        t: l.t,
        end: l.end,
        duration: l.duration!,
        corrected: l.duration! - FUEL_PER_LAP * (total - l.lap),
        compound: stint?.compound ?? null,
        tyreAge: stint ? (stint.ageAtStart ?? 0) + (l.lap - stint.lapStart) : 0,
        stint: stint?.stint ?? 0,
        clean,
        gapAhead,
      });
    }
  }
  cache.set(data, { version: data.version, until, laps: out });
  return out;
}

function fit(pts: [number, number][]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

export interface StintFit {
  driver: number;
  stint: number;
  compound: string;
  laps: number;
  /** Seconds lost per lap of tyre age (fuel-corrected). */
  slope: number;
  /** Fuel-corrected lap time on brand-new tyres. */
  fresh: number;
  points: [number, number][];
}

export interface DegModel {
  stints: StintFit[];
  /** Per compound: typical loss per lap of age, and pace on fresh tyres relative to the medium (s). */
  compounds: { compound: string; slope: number; offset: number | null; stints: number; laps: number }[];
}

/** Tyre degradation from the race's own stints (at least 6 representative laps each). */
export function degModel(data: SessionData, until = Infinity): DegModel {
  const laps = raceLaps(data, until);
  const groups = new Map<string, RaceLap[]>();
  for (const l of laps) {
    if (!l.compound) continue;
    const k = `${l.driver}|${l.stint}`;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const stints: StintFit[] = [];
  for (const g of groups.values()) {
    if (g.length < 6) continue;
    // Drop laps more than 1 s off the stint's typical pace (traffic, mistakes).
    const med = median(g.map((l) => l.corrected))!;
    const pts = g.filter((l) => l.corrected < med + 1).map((l) => [l.tyreAge, l.corrected] as [number, number]);
    if (pts.length < 6) continue;
    const f = fit(pts);
    stints.push({ driver: g[0].driver, stint: g[0].stint, compound: g[0].compound!, laps: pts.length, slope: f.slope, fresh: f.intercept, points: pts });
  }
  const names = [...new Set(stints.map((s) => s.compound))];
  // Compound offsets: drivers who used both a compound and the medium, comparing fresh-tyre pace.
  const base = names.includes('MEDIUM') ? 'MEDIUM' : names[0];
  const compounds = names.map((c) => {
    const these = stints.filter((s) => s.compound === c);
    const diffs: number[] = [];
    for (const s of these) {
      const ref = stints.filter((x) => x.driver === s.driver && x.compound === base);
      if (ref.length && c !== base) diffs.push(s.fresh - median(ref.map((r) => r.fresh))!);
    }
    // Weighted towards longer stints: repeat each stint's slope by its lap count.
    const slopes = these.flatMap((s) => Array(Math.min(s.laps, 30)).fill(s.slope));
    return {
      compound: c,
      slope: median(slopes) ?? 0,
      offset: c === base ? 0 : median(diffs),
      stints: these.length,
      laps: these.reduce((x, s) => x + s.laps, 0),
    };
  });
  const order = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];
  compounds.sort((a, b) => order.indexOf(a.compound) - order.indexOf(b.compound));
  return { stints, compounds };
}

export interface PaceRow {
  driver: number;
  clean: number;
  all: number;
  cleanPace: number | null;
  allPace: number | null;
  /** How much slower on average in traffic than in clean air (s per lap). */
  trafficCost: number | null;
}

/** Each driver's typical fuel-corrected pace, in clean air and overall. */
export function cleanAirPace(data: SessionData, until = Infinity): PaceRow[] {
  const laps = raceLaps(data, until);
  const rows: PaceRow[] = [];
  for (const n of data.driverOrder) {
    const mine = laps.filter((l) => l.driver === n);
    if (!mine.length) continue;
    const clean = mine.filter((l) => l.clean);
    const traffic = mine.filter((l) => !l.clean);
    // Median: robust to the odd mistake. Needs a handful of laps to mean anything.
    const pace = (ls: RaceLap[]) => (ls.length < MIN_LAPS ? null : median(ls.map((l) => l.corrected)));
    const cp = pace(clean);
    const tp = pace(traffic);
    rows.push({ driver: n, clean: clean.length, all: mine.length, cleanPace: cp, allPace: pace(mine), trafficCost: cp != null && tp != null ? tp - cp : null });
  }
  return rows.sort((a, b) => (a.cleanPace ?? Infinity) - (b.cleanPace ?? Infinity));
}

/** Expected time lost (s per lap) on a compound at a given age, relative to a fresh medium. */
export function tyreCost(model: DegModel, compound: string | null, age: number) {
  const c = model.compounds.find((x) => x.compound === compound);
  if (!c) return null;
  return (c.offset ?? 0) + c.slope * age;
}

/** Each driver's typical clean-air lap with fuel and tyres both taken out: the fairest pace figure. */
export function likeForLikePace(data: SessionData, until = Infinity) {
  const model = degModel(data, until);
  const laps = raceLaps(data, until).filter((l) => l.clean);
  const out = new Map<number, number>();
  for (const n of data.driverOrder) {
    const v = laps
      .filter((l) => l.driver === n)
      .map((l) => l.corrected - (tyreCost(model, l.compound, l.tyreAge) ?? 0))
      .sort((a, b) => a - b);
    if (v.length >= MIN_LAPS) out.set(n, v[Math.floor(v.length / 2)]);
  }
  return out;
}
