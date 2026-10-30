// Smooth car movement for the 3D replay. Positions arrive about four times a second (sometimes
// a second apart) and wobble by a metre or so; drawn as they are, cars cut corners, jerk at each
// new point and bob up and down. Instead each sample is turned into "how far round the lap" and
// "how far from the centre line", both are smoothed, and the car is placed back on the smooth
// track curve. The result follows the racing line, points where it's going and sits on the road.
// In the pit lane (well away from the track) the car's own positions are used, on a curve.
import type { SessionData } from './session';
import { lastAtOrBefore } from './state';
import type { Track3D } from './track3d';

export interface Pose {
  X: number;
  Y: number;
  Z: number;
  /** Direction of travel (radians, same convention as atan2(-dz, dx)). */
  heading: number;
  /** m/s along the track. */
  speed: number;
  /** Index of the nearest track point (TV cameras use it). */
  idx: number;
  /** Positions this old aren't trusted (car stopped sending, or retired). */
  stale: boolean;
}

/** Off-track beyond this (m from the centre line) means pit lane or garage: use raw positions. */
const OFF_TRACK = 13;

/** Each sample projected onto the track: worked out only when first needed. */
interface Path {
  /** Distance round the lap (m, 0 … lap length); NaN until worked out. */
  d: Float64Array;
  /** Sideways offset (m, + = left). */
  lat: Float64Array;
  idx: Int32Array;
}

interface TrackFrame {
  loop: number;
  /** Cumulative distance at each point, including the closing segment. */
  cum: number[];
  /** Unit tangent (x, z) and left normal at each point. */
  tx: number[];
  tz: number[];
}

const frames = new WeakMap<Track3D, TrackFrame>();
function frame(track: Track3D): TrackFrame {
  let f = frames.get(track);
  if (f) return f;
  const { pts } = track;
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = pts[i - 1];
    const b = pts[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[2] - a[2]));
  }
  const tx: number[] = [];
  const tz: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    tx.push((b[0] - a[0]) / len);
    tz.push((b[2] - a[2]) / len);
  }
  f = { loop: cum[n], cum, tx, tz };
  frames.set(track, f);
  return f;
}

/** Project (X, Z) onto the track near `hint`: distance along the lap and sideways offset. */
function project(track: Track3D, f: TrackFrame, X: number, Z: number, hint: number) {
  const { pts } = track;
  const n = pts.length;
  const near = (i: number) => (pts[i][0] - X) ** 2 + (pts[i][2] - Z) ** 2;
  let best = -1;
  let bd = Infinity;
  if (hint >= 0)
    for (let k = -25; k <= 25; k++) {
      const i = (hint + k + n) % n;
      const d = near(i);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  if (best < 0 || bd > 40 * 40)
    for (let i = 0; i < n; i++) {
      const d = near(i);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  // Refine within the segment either side of the nearest point.
  const p = pts[best];
  const dx = X - p[0];
  const dz = Z - p[2];
  const along = dx * f.tx[best] + dz * f.tz[best];
  // Left normal is (tz, -tx) with X east / Z south.
  const lat = dx * f.tz[best] - dz * f.tx[best];
  return { d: f.cum[best] + along, lat, idx: best };
}

const paths = new WeakMap<SessionData, Map<number, Path>>();

function path(data: SessionData, n: number): Path | null {
  const s = data.samples.get(n);
  if (!s || !s.locT.length) return null;
  let byCar = paths.get(data);
  if (!byCar) paths.set(data, (byCar = new Map()));
  let p = byCar.get(n);
  // Live sessions keep growing: start again with room for the new samples.
  if (!p || p.d.length < s.locT.length) {
    const size = Math.ceil(s.locT.length * (data.live ? 1.5 : 1)) + 1;
    const next: Path = { d: new Float64Array(size).fill(NaN), lat: new Float64Array(size), idx: new Int32Array(size).fill(-1) };
    if (p) {
      next.d.set(p.d.subarray(0, Math.min(p.d.length, size)));
      next.lat.set(p.lat.subarray(0, Math.min(p.lat.length, size)));
      next.idx.set(p.idx.subarray(0, Math.min(p.idx.length, size)));
    }
    byCar.set(n, (p = next));
  }
  return p;
}

function ensure(track: Track3D, f: TrackFrame, s: { locX: ArrayLike<number>; locY: ArrayLike<number> }, p: Path, k: number) {
  if (!Number.isNaN(p.d[k])) return;
  const hint = k > 0 && p.idx[k - 1] >= 0 ? p.idx[k - 1] : p.idx[k + 1] ?? -1;
  const pr = project(track, f, s.locX[k] / 10, -s.locY[k] / 10, hint);
  p.d[k] = ((pr.d % f.loop) + f.loop) % f.loop;
  p.lat[k] = pr.lat;
  p.idx[k] = pr.idx;
}

/** Point on the centre line at distance d (any lap), with height and tangent. */
function onTrack(track: Track3D, f: TrackFrame, d: number) {
  const { pts } = track;
  const n = pts.length;
  const L = f.loop;
  const u = ((d % L) + L) % L;
  // Binary search for the segment.
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f.cum[mid] <= u) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[(lo + 1) % n];
  const seg = f.cum[lo + 1] - f.cum[lo] || 1;
  const k = (u - f.cum[lo]) / seg;
  const tx = f.tx[lo] + (f.tx[(lo + 1) % n] - f.tx[lo]) * k;
  const tz = f.tz[lo] + (f.tz[(lo + 1) % n] - f.tz[lo]) * k;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, z: a[2] + (b[2] - a[2]) * k, tx: tx / tl, tz: tz / tl, idx: k < 0.5 ? lo : (lo + 1) % n };
}

/** Where car n is at time t, smoothly. */
export function carPose(data: SessionData, track: Track3D, n: number, t: number): Pose | null {
  const s = data.samples.get(n);
  if (!s || track.pts.length < 3) return null;
  const p = path(data, n);
  if (!p) return null;
  const N = s.locT.length;
  let i = lastAtOrBefore(s.locT, t);
  if (i < 0) return null;
  const stale = t - s.locT[i] > 4000 && (i === N - 1 || s.locT[i + 1] - s.locT[i] > 4000);
  if (i >= N - 1) i = N - 2; // hold at the last sample
  if (i < 0) return null;
  const f = frame(track);
  const L = f.loop;
  const T = s.locT;

  // The neighbouring samples, projected onto the track, with distances counted on from sample i's.
  const lo = Math.max(0, i - 12);
  const hi = Math.min(N - 1, i + 13);
  for (let k = lo; k <= hi; k++) ensure(track, f, s, p, k);
  const ts: number[] = [];
  const ds: number[] = [];
  const lats: number[] = [];
  const xs: number[] = [];
  const zs: number[] = [];
  for (let k = lo; k <= hi; k++) {
    let dd = p.d[k] - p.d[i];
    dd -= Math.round(dd / L) * L;
    ts.push(T[k]);
    ds.push(p.d[i] + dd);
    lats.push(p.lat[k]);
    xs.push(s.locX[k] / 10);
    zs.push(-s.locY[k] / 10);
  }
  const li = i - lo;

  // On track: placed on the smooth track curve. The samples' timestamps are uneven (60 ms apart,
  // then 360 ms), though the car isn't, so a smooth curve is fitted through the nearby samples
  // rather than passing exactly through each one.
  const fit = localFit(ts, ds, t, li, 380);
  const lat = localMean(ts, lats, t, li, 600);
  const c = onTrack(track, f, fit.value);
  const dLat = (localMean(ts, lats, t + 150, li, 600) - localMean(ts, lats, t - 150, li, 600)) / 0.3;
  const trackSpeed = Math.max(0, fit.slope);
  const drift = trackSpeed > 3 ? Math.atan2(dLat, trackSpeed) : 0;
  const onX = c.x + c.tz * lat; // left normal (tz, -tx)
  const onZ = c.z - c.tx * lat;
  const onHeading = Math.atan2(-c.tz, c.tx) + drift;

  // Away from the track (pit lane, garages): the car's own positions, fitted the same way. In
  // between, blend the two so there's no jump on the way in or out of the pits.
  const w = Math.min(1, Math.max(0, (Math.abs(lat) - (OFF_TRACK - 5)) / 6));
  if (w === 0) return { X: onX, Y: c.y, Z: onZ, heading: onHeading, speed: trackSpeed, idx: c.idx, stale };
  const fx = localFit(ts, xs, t, li, 380);
  const fz = localFit(ts, zs, t, li, 380);
  const rawSpeed = Math.hypot(fx.slope, fz.slope);
  const rawHeading = rawSpeed > 1 ? Math.atan2(-fz.slope, fx.slope) : onHeading;
  let Y = c.y;
  if (track.hasHeight && s.locZ.length === N && !data.meta.positionsEstimated) {
    const k = Math.min(1, Math.max(0, (t - T[i]) / (T[i + 1] - T[i] || 1)));
    Y = c.y * (1 - w) + ((s.locZ[i] + (s.locZ[i + 1] - s.locZ[i]) * k - track.zBase) / 10) * w;
  }
  const dh = Math.atan2(Math.sin(rawHeading - onHeading), Math.cos(rawHeading - onHeading));
  return {
    X: onX + (fx.value - onX) * w,
    Y,
    Z: onZ + (fz.value - onZ) * w,
    heading: onHeading + dh * w,
    speed: trackSpeed + (rawSpeed - trackSpeed) * w,
    idx: c.idx,
    stale,
  };
}


/**
 * Weighted quadratic fit of v against time around t (Gaussian weights, width sigma ms): the value
 * and slope (per second) at t. Quadratic so braking and accelerating aren't smoothed away.
 */
function localFit(T: ArrayLike<number>, v: number[], t: number, i: number, sigma: number) {
  // The caller passes a fixed, generous set of neighbours: samples far from t get vanishingly
  // small weights, so the fit doesn't jump as samples come into or drop out of range.
  const lo = 0;
  const hi = T.length - 1;
  // Sums for the normal equations in x = (T - t) / 1000 (seconds).
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, b0 = 0, b1 = 0, b2 = 0;
  const base = v[i];
  for (let k = lo; k <= hi && k < v.length; k++) {
    const x = (T[k] - t) / 1000;
    const w = Math.exp(-0.5 * ((T[k] - t) / sigma) ** 2);
    const y = v[k] - base;
    const x2 = x * x;
    s0 += w;
    s1 += w * x;
    s2 += w * x2;
    s3 += w * x2 * x;
    s4 += w * x2 * x2;
    b0 += w * y;
    b1 += w * x * y;
    b2 += w * x2 * y;
  }
  // Solve [s0 s1 s2; s1 s2 s3; s2 s3 s4] [a b c] = [b0 b1 b2] (Cramer's rule); fall back to linear.
  const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  if (hi - lo >= 3 && Math.abs(det) > 1e-9) {
    const a = (b0 * (s2 * s4 - s3 * s3) - s1 * (b1 * s4 - s3 * b2) + s2 * (b1 * s3 - s2 * b2)) / det;
    const b = (s0 * (b1 * s4 - b2 * s3) - b0 * (s1 * s4 - s3 * s2) + s2 * (s1 * b2 - b1 * s2)) / det;
    return { value: base + a, slope: b };
  }
  const den = s0 * s2 - s1 * s1;
  if (Math.abs(den) > 1e-9) {
    const b = (s0 * b1 - s1 * b0) / den;
    const a = (b0 - b * s1) / s0;
    return { value: base + a, slope: b };
  }
  return { value: v[i], slope: 0 };
}

/** Gaussian-weighted average of v around time t. */
function localMean(T: ArrayLike<number>, v: number[], t: number, i: number, sigma: number) {
  let sum = 0;
  let w = 0;
  for (let k = 0; k < v.length; k++) {
    const wt = Math.exp(-0.5 * ((T[k] - t) / sigma) ** 2);
    sum += v[k] * wt;
    w += wt;
  }
  return w ? sum / w : v[i];
}
