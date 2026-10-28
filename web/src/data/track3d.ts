// Geometry for the 3D replay: the circuit with heights, and each car's 3D position.
// World units are metres: X = east (x), Y = up (height), Z = south (−y), so a camera looking
// straight down shows the circuit the same way round as the 2D map.
import type { SessionData } from './session';
import { carPosition, lastAtOrBefore } from './state';
import { outlineFromLaps } from './session';

export interface Track3D {
  /** Points in metres: [X, height, Z], in driving order from the line. */
  pts: [number, number, number][];
  /** Distance along the lap at each point (m). */
  dist: number[];
  length: number;
  /** Lowest raw height (decimetres), subtracted from every height. */
  zBase: number;
  hasHeight: boolean;
  centre: [number, number];
  radius: number;
}

const cache = new WeakMap<SessionData, Track3D>();

export function track3d(data: SessionData): Track3D {
  const hit = cache.get(data);
  if (hit && hit.pts.length) return hit;
  const outline = data.meta.outline.length ? data.meta.outline : outlineFromLaps(data);

  // Heights: from the samples of the session's fastest lap (any car's would do; they agree to ~10 cm).
  const ref: { x: number; y: number; z: number }[] = [];
  const best = data.bestLap;
  const s = best ? data.samples.get(best.driver) : undefined;
  if (s && s.locZ.length === s.locT.length && best) {
    for (let i = 0; i < s.locT.length; i++) {
      if (s.locT[i] < best.lap.t || s.locT[i] > best.lap.end) continue;
      ref.push({ x: s.locX[i], y: s.locY[i], z: s.locZ[i] });
    }
  }
  const hasHeight = ref.length > 50 && ref.some((r) => r.z !== ref[0].z);
  let raw = outline.map(([x, y]) => {
    if (!hasHeight) return 0;
    let bestD = Infinity;
    let z = 0;
    for (const r of ref) {
      const d = (r.x - x) ** 2 + (r.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        z = r.z;
      }
    }
    return z;
  });
  // Light smoothing (around the loop) to take the steps out.
  raw = raw.map((_, i) => {
    let sum = 0;
    for (let k = -3; k <= 3; k++) sum += raw[(i + k + raw.length) % raw.length];
    return sum / 7;
  });
  const zBase = raw.length ? Math.min(...raw) : 0;
  const pts = outline.map(([x, y], i) => [x / 10, (raw[i] - zBase) / 10, -y / 10] as [number, number, number]);
  const dist = [0];
  for (let i = 1; i < pts.length; i++) dist.push(dist[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const centre: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
  const t: Track3D = { pts, dist, length: dist.at(-1) ?? 0, zBase, hasHeight, centre, radius };
  cache.set(data, t);
  return t;
}

/** Index of the outline point nearest to (X, Z), searching near `hint` first. */
export function nearestIndex(track: Track3D, X: number, Z: number, hint = -1) {
  const n = track.pts.length;
  const check = (i: number) => (track.pts[i][0] - X) ** 2 + (track.pts[i][2] - Z) ** 2;
  if (hint >= 0) {
    let best = hint;
    let bestD = check(hint);
    for (let k = -40; k <= 40; k++) {
      const i = (hint + k + n) % n;
      const d = check(i);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD < 30 * 30) return best;
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = check(i);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface Car3D {
  X: number;
  Y: number;
  Z: number;
  stale: boolean;
  /** Index of the nearest outline point (for TV cameras and heights). */
  idx: number;
}

/** A car's 3D position at time t (metres, track heights relative to the lowest point). */
export function car3d(data: SessionData, track: Track3D, n: number, t: number, hint = -1): Car3D | null {
  const s = data.samples.get(n);
  if (!s) return null;
  const p = carPosition(s, t);
  if (!p) return null;
  const X = p.x / 10;
  const Z = -p.y / 10;
  const idx = track.pts.length ? nearestIndex(track, X, Z, hint) : 0;
  let Y = track.pts[idx]?.[1] ?? 0;
  if (track.hasHeight && s.locZ.length === s.locT.length && !data.meta.positionsEstimated) {
    const i = lastAtOrBefore(s.locT, t);
    if (i >= 0) {
      const j = Math.min(i + 1, s.locT.length - 1);
      const f = j > i ? Math.max(0, Math.min(1, (t - s.locT[i]) / (s.locT[j] - s.locT[i]))) : 0;
      const z = s.locZ[i] + (s.locZ[j] - s.locZ[i]) * f;
      // Pit lane and garages aren't on the outline: trust the car's own height there.
      Y = (z - track.zBase) / 10;
    }
  }
  return { X, Y, Z, stale: p.stale, idx };
}
