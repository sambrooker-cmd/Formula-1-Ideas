// One lap as a trace: time, distance, speed, brake and position through the lap. Used to race
// two laps against each other (ghost car) and to measure each corner.
import type { Lap, SessionData } from './session';
import { carPosition, lastAtOrBefore } from './state';

export interface LapTrace {
  driver: number;
  lap: Lap;
  /** Per car sample within the lap: ms into the lap, metres into the lap, speed, brake (0/1). */
  t: number[];
  d: number[];
  speed: number[];
  brake: number[];
  throttle: number[];
  length: number;
}

export function lapTrace(data: SessionData, driver: number, lap: Lap): LapTrace | null {
  const s = data.samples.get(driver);
  if (!s || lap.duration == null) return null;
  const i0 = Math.max(0, lastAtOrBefore(s.carT, lap.t));
  const i1 = lastAtOrBefore(s.carT, lap.end);
  if (i1 - i0 < 20) return null;
  const tr: LapTrace = { driver, lap, t: [], d: [], speed: [], brake: [], throttle: [], length: 0 };
  const d0 = s.dist[i0];
  for (let i = i0; i <= i1; i++) {
    tr.t.push(s.carT[i] - lap.t);
    tr.d.push(s.dist[i] - d0);
    tr.speed.push(s.speed[i]);
    tr.brake.push(s.brake[i] > 0 ? 1 : 0);
    tr.throttle.push(s.throttle[i]);
  }
  // Pin the trace to the exact lap time: the last car sample is usually a fraction before the line.
  const endMs = lap.duration * 1000;
  const lastT = tr.t.at(-1)!;
  if (endMs > lastT) {
    tr.d.push(tr.d.at(-1)! + (tr.speed.at(-1)! / 3.6) * ((endMs - lastT) / 1000));
    tr.t.push(endMs);
    tr.speed.push(tr.speed.at(-1)!);
    tr.brake.push(0);
    tr.throttle.push(tr.throttle.at(-1)!);
  }
  if (tr.t[0] < 0) {
    // First sample was just before the line: move it onto the line.
    const f = -tr.t[0] / (tr.t[1] - tr.t[0] || 1);
    const d0 = tr.d[0] + (tr.d[1] - tr.d[0]) * f;
    tr.d = tr.d.map((x) => x - d0);
    tr.t[0] = 0;
    tr.d[0] = 0;
  }
  // Distance comes from adding up speed readings, which drifts a little differently for each car
  // (±1%). Scale every lap to the circuit's length so the same metre is the same place for everyone.
  const ref = outlineLength(data);
  const raw = tr.d.at(-1)!;
  if (ref > 1000 && Math.abs(raw / ref - 1) < 0.08) tr.d = tr.d.map((x) => (x * ref) / raw);
  tr.length = tr.d.at(-1)!;
  return tr;
}

const lengthCache = new WeakMap<SessionData, number>();
/** Length of the circuit outline in metres (0 if there's no outline). */
export function outlineLength(data: SessionData) {
  let len = lengthCache.get(data);
  if (len == null) {
    const o = data.meta.outline;
    len = 0;
    for (let i = 1; i < o.length; i++) len += Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]) / 10;
    if (o.length > 2) len += Math.hypot(o[0][0] - o.at(-1)![0], o[0][1] - o.at(-1)![1]) / 10;
    lengthCache.set(data, len);
  }
  return len;
}

function interp(xs: number[], ys: number[], x: number) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + (ys[hi] - ys[lo]) * f;
}

/** Fraction of the lap (0–1) covered after `ms` into it. Fractions make two cars' slightly different distances comparable. */
export const fracAt = (tr: LapTrace, ms: number) => interp(tr.t, tr.d, ms) / (tr.length || 1);
/** ms into the lap when the car reached a fraction of the lap. */
export const timeAtFrac = (tr: LapTrace, f: number) => interp(tr.d, tr.t, f * tr.length);
export const speedAtFrac = (tr: LapTrace, f: number) => interp(tr.d, tr.speed, f * tr.length);

/** Time difference A − B (s) at each of `n` points around the lap: positive = A behind. */
export function deltaCurve(a: LapTrace, b: LapTrace, n = 200) {
  const out: number[] = [];
  for (let k = 0; k <= n; k++) {
    const f = k / n;
    out.push((timeAtFrac(a, f) - timeAtFrac(b, f)) / 1000);
  }
  return out;
}

export interface CornerStats {
  number: string;
  /** Lowest speed through the corner (km/h). */
  minSpeed: number;
  /** Metres before the slowest point where the car started braking (null: no braking, flat out). */
  brakeBefore: number | null;
  /** Speed 120 m after the slowest point. */
  exitSpeed: number;
}

/**
 * Measure each corner on one lap. `corners` are track positions (timing x/y); each is matched to
 * the moment the car passed closest to it, then the slowest point nearby is found.
 */
export interface CornerDef {
  number: string;
  x: number;
  y: number;
}

export function cornerStats(data: SessionData, tr: LapTrace, corners: CornerDef[]): (CornerStats | null)[] {
  return corners.map((c) => measureCorner(data, tr, c));
}

/**
 * Prepare corners for measuring, using a reference lap: corners that share a slowest point
 * (chicanes like 6–7) are merged and labelled "6–7".
 */
export function mergeCorners(data: SessionData, ref: LapTrace, corners: CornerDef[]): CornerDef[] {
  const out: (CornerDef & { apex: number })[] = [];
  for (const c of corners) {
    const m = measureCorner(data, ref, c, true) as (CornerStats & { apexD: number }) | null;
    if (!m) continue;
    const prev = out.at(-1);
    if (prev && Math.abs(prev.apex - m.apexD) < 30) {
      prev.number = `${prev.number.split('–')[0]}–${c.number}`;
      continue;
    }
    out.push({ ...c, apex: m.apexD });
  }
  return out;
}

function measureCorner(data: SessionData, tr: LapTrace, c: CornerDef, withApex = false): CornerStats | null {
  const s = data.samples.get(tr.driver)!;
  const lapEnd = tr.lap.end;
  // Car positions through the lap, sampled with the car data (cached per trace).
  const pos = (posCache.get(tr) ?? posCache.set(tr, tr.t.map((ms) => carPosition(s, tr.lap.t + ms))).get(tr))!;
  let best = -1;
  let bestD = Infinity;
  pos.forEach((p, i) => {
    if (!p) return;
    const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0 || bestD > 400 ** 2 || tr.lap.t + tr.t[best] > lapEnd) return null;
  // Slowest point within 120 m of the corner marker.
  const at = tr.d[best];
  let minI = best;
  for (let i = 0; i < tr.d.length; i++) if (Math.abs(tr.d[i] - at) < 120 && tr.speed[i] < tr.speed[minI]) minI = i;
  const apex = tr.d[minI];
  let brakeStart: number | null = null;
  for (let i = minI; i >= 0 && apex - tr.d[i] < 400; i--) {
    if (tr.brake[i]) brakeStart = tr.d[i];
    else if (brakeStart != null) break;
  }
  const exitD = Math.min(tr.length, apex + 120);
  return {
    number: c.number,
    minSpeed: tr.speed[minI],
    brakeBefore: brakeStart != null ? Math.round(apex - brakeStart) : null,
    exitSpeed: interp(tr.d, tr.speed, exitD),
    ...(withApex ? { apexD: apex } : {}),
  };
}

const posCache = new WeakMap<LapTrace, ({ x: number; y: number } | null)[]>();

/** Fastest timed lap for a driver (excluding out-laps), optionally before time t. */
export function fastestLap(data: SessionData, n: number, before = Infinity) {
  return (
    (data.laps.get(n) ?? [])
      .filter((l) => l.duration != null && !l.pitOut && l.end <= before && l.lap > 1)
      .sort((a, b) => a.duration! - b.duration!)[0] ?? null
  );
}
