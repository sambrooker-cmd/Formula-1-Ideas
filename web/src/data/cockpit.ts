// Virtual cockpit maths: smooth car readings, live delta to the driver's best lap (by distance),
// g-forces worked out from speed and heading, and rev-light scaling.
import type { DriverSamples, SessionData } from './session';
import { carPosition, currentLap, lastAtOrBefore } from './state';

/** Linear interpolation of a car-data channel at time t. */
export function channelAt(s: DriverSamples, key: 'speed' | 'rpm' | 'throttle' | 'dist', t: number) {
  const i = lastAtOrBefore(s.carT, t);
  if (i < 0) return null;
  const arr = s[key];
  const j = i + 1;
  if (j >= s.carT.length || s.carT[j] - s.carT[i] > 2000) return arr[i];
  const f = (t - s.carT[i]) / (s.carT[j] - s.carT[i]);
  return arr[i] + (arr[j] - arr[i]) * f;
}

/** Direction of travel (radians, OpenF1 x/y frame) over the last `window` ms, or null when stopped. */
export function headingAt(s: DriverSamples, t: number, window = 400) {
  const a = carPosition(s, t - window);
  const b = carPosition(s, t);
  if (!a || !b || b.stale) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 20) return null; // under ~2 m: too slow to tell
  return Math.atan2(dy, dx);
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Longitudinal and lateral acceleration in g (positive: accelerating / turning left). */
export function gForces(s: DriverSamples, t: number) {
  const dt = 0.5;
  const v1 = channelAt(s, 'speed', t - dt * 1000);
  const v2 = channelAt(s, 'speed', t);
  const h1 = headingAt(s, t - dt * 1000);
  const h2 = headingAt(s, t);
  if (v1 == null || v2 == null) return null;
  const v = v2 / 3.6;
  const lon = (v2 / 3.6 - v1 / 3.6) / dt / 9.81;
  const lat = h1 != null && h2 != null ? (v * (wrap(h2 - h1) / dt)) / 9.81 : 0;
  const clamp = (x: number) => Math.max(-6, Math.min(6, x));
  return { lon: clamp(lon), lat: clamp(lat) };
}

/** RPM at the top of the rev range for this driver (98th percentile), for the shift lights. */
const rpmCache = new WeakMap<DriverSamples, number>();
export function rpmMax(s: DriverSamples) {
  let v = rpmCache.get(s);
  if (v == null) {
    const sorted = Array.from(s.rpm as ArrayLike<number>).filter((x) => x > 0).sort((a, b) => a - b);
    v = sorted[Math.floor(sorted.length * 0.98)] ?? 12000;
    rpmCache.set(s, v);
  }
  return v;
}

/**
 * Live delta to the driver's best completed lap so far: how much slower (+) or faster (−)
 * they are at the same distance into the lap.
 */
export function liveDelta(data: SessionData, n: number, t: number) {
  const s = data.samples.get(n);
  const lap = currentLap(data, n, t);
  if (!s || !lap || lap.pitOut) return null;
  const best = (data.laps.get(n) ?? [])
    .filter((l) => l.duration != null && l.end <= t && !l.pitOut && l.lap > 1)
    .sort((a, b) => a.duration! - b.duration!)[0];
  if (!best) return null;
  const d0 = channelAt(s, 'dist', lap.t);
  const dNow = channelAt(s, 'dist', t);
  const b0 = channelAt(s, 'dist', best.t);
  if (d0 == null || dNow == null || b0 == null) return null;
  const into = dNow - d0;
  if (into < 50) return null; // just over the line
  // Find when, on the best lap, the car had covered the same distance.
  const target = b0 + into;
  let lo = lastAtOrBefore(s.carT, best.t);
  let hi = lastAtOrBefore(s.carT, best.end);
  if (lo < 0 || hi <= lo || s.dist[hi] < target) return null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.dist[mid] < target) lo = mid;
    else hi = mid;
  }
  const f = (target - s.dist[lo]) / Math.max(1e-6, s.dist[hi] - s.dist[lo]);
  const bestT = s.carT[lo] + (s.carT[hi] - s.carT[lo]) * f - best.t;
  return { delta: (t - lap.t - bestT) / 1000, bestLap: best.lap, bestTime: best.duration! };
}
