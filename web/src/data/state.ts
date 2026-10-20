// Pure functions: "what was true at time t?" Every panel reads through these,
// so replay and (later) live mode only differ in how the data gets filled.
import type { DriverSamples, IntervalSample, Lap, SessionData, Stint, TrackStatusSpan } from './session';

/** Index of the last element <= t in a sorted array, or -1. */
export function lastAtOrBefore(arr: ArrayLike<number>, t: number) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function lastBy<T>(list: T[] | undefined, t: number, key: (x: T) => number): T | null {
  if (!list || list.length === 0) return null;
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans < 0 ? null : list[ans];
}

const MAX_GAP_MS = 4000;

/** Interpolated car position. `stale` means no fresh sample nearby (in the garage, retired, or data dropout). */
export function carPosition(s: DriverSamples, t: number) {
  const i = lastAtOrBefore(s.locT, t);
  if (i < 0) return null;
  const j = i + 1;
  if (j < s.locT.length && s.locT[j] - s.locT[i] < MAX_GAP_MS) {
    const f = (t - s.locT[i]) / (s.locT[j] - s.locT[i]);
    return {
      x: s.locX[i] + (s.locX[j] - s.locX[i]) * f,
      y: s.locY[i] + (s.locY[j] - s.locY[i]) * f,
      stale: false,
    };
  }
  return { x: s.locX[i], y: s.locY[i], stale: t - s.locT[i] > MAX_GAP_MS };
}

export function carSampleIndex(s: DriverSamples, t: number) {
  return lastAtOrBefore(s.carT, t);
}

export function currentLap(data: SessionData, driver: number, t: number): Lap | null {
  return lastBy(data.laps.get(driver), t, (l) => l.t);
}

export function lastCompletedLap(data: SessionData, driver: number, t: number): Lap | null {
  const laps = data.laps.get(driver);
  if (!laps) return null;
  for (let i = laps.length - 1; i >= 0; i--) if (laps[i].duration != null && laps[i].end <= t) return laps[i];
  return null;
}

export function stintForLap(data: SessionData, driver: number, lap: number): Stint | null {
  const list = data.stints.get(driver) ?? [];
  const exact = list.find((s) => s.lapStart <= lap && (s.lapEnd == null || lap <= s.lapEnd));
  if (exact) return exact;
  // Past the last recorded stint (e.g. a car that stopped): keep showing the last tyre it had.
  const before = list.filter((s) => s.lapStart <= lap);
  return before[before.length - 1] ?? list[0] ?? null;
}

export function trackStatusAt(data: SessionData, t: number): TrackStatusSpan {
  return lastBy(data.trackStatus, t, (s) => s.t) ?? data.trackStatus[0];
}

export function leaderLap(data: SessionData, t: number) {
  let lap = 0;
  data.lapStartTimes.forEach((start, n) => {
    if (start != null && start <= t) lap = Math.max(lap, n);
  });
  return lap;
}

export function weatherAt(data: SessionData, t: number) {
  const w = lastBy(data.meta.weather, t, (r) => r[0]) ?? data.meta.weather[0];
  if (!w) return null;
  return { air: w[1], track: w[2], humidity: w[3], pressure: w[4], rain: w[5], windSpeed: w[6], windDir: w[7] };
}

/** DNF/DNS/DSQ cars, once they've stopped. A retired car's final lap never completes, so call it ~2.5 min after that lap began. */
export function isRetired(data: SessionData, driver: number, t: number) {
  const result = data.meta.results.find((r) => r.driver === driver);
  if (!result || result.status === 'FINISHED') return false;
  const finalLap = data.laps.get(driver)?.at(-1);
  if (!finalLap) return true;
  return t > (finalLap.duration != null ? finalLap.end + 30_000 : finalLap.t + 150_000);
}

export interface TowerRow {
  driver: number;
  position: number;
  lap: number;
  gap: string;
  interval: string;
  intervalSecs: number | null;
  compound: string | null;
  tyreAge: number | null;
  pits: number;
  inPit: boolean;
  out: boolean;
  lastLap: number | null;
  bestLap: number | null;
  personalBestLast: boolean;
}

const fmtGap = (n: number | null, text: string | null) => (text ? text : n == null ? '' : '+' + n.toFixed(3));

export function tower(data: SessionData, t: number): TowerRow[] {
  const rows: TowerRow[] = [];
  const raceLike = data.meta.session.type === 'Race';
  for (const n of data.driverOrder) {
    const posSeries = data.positions.get(n);
    const pi = posSeries ? lastAtOrBefore(posSeries.t, t) : -1;
    const position = pi >= 0 ? posSeries!.v[pi] : 99;
    const lap = currentLap(data, n, t);
    const iv: IntervalSample | null = lastBy(data.intervals.get(n), t, (r) => r.t);
    const lapNo = lap?.lap ?? 0;
    const stint = stintForLap(data, n, Math.max(1, lapNo));
    const pits = (data.pits.get(n) ?? []).filter((p) => p.t <= t);
    const lastPit = pits[pits.length - 1];
    const inPit = !!lastPit && t < lastPit.t + (lastPit.laneDuration ?? 25) * 1000;
    const done = (data.laps.get(n) ?? []).filter((l) => l.end <= t && l.duration != null);
    const last = done[done.length - 1]?.duration ?? null;
    const best = done.reduce<number | null>((b, l) => (b == null || l.duration! < b ? l.duration : b), null);
    const out = isRetired(data, n, t);
    rows.push({
      driver: n,
      position,
      lap: lapNo,
      gap: raceLike ? (position === 1 ? 'LEADER' : fmtGap(iv?.gap ?? null, iv?.gapText ?? null)) : '',
      interval: raceLike ? (position === 1 ? '' : fmtGap(iv?.interval ?? null, iv?.intervalText ?? null)) : '',
      intervalSecs: iv?.interval ?? null,
      compound: stint?.compound ?? null,
      tyreAge: stint && lapNo ? (stint.ageAtStart ?? 0) + (lapNo - stint.lapStart) : stint?.ageAtStart ?? null,
      pits: pits.length,
      inPit,
      out,
      lastLap: last,
      bestLap: best,
      personalBestLast: last != null && last === best,
    });
  }
  // Retired cars drop to the bottom, in the order they retired.
  return rows.sort((a, b) => Number(a.out) - Number(b.out) || a.position - b.position);
}

/** Fastest completed lap of the session up to time t. */
export function overallBestAt(data: SessionData, t: number) {
  let best: { driver: number; duration: number } | null = null;
  for (const [n, laps] of data.laps) {
    for (const l of laps) {
      if (l.duration != null && l.end <= t && (!best || l.duration < best.duration)) best = { driver: n, duration: l.duration };
    }
  }
  return best;
}

export function formatLapTime(s: number | null | undefined) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, '0')}` : rest.toFixed(3);
}

export function formatClock(ms: number) {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body = `${h > 0 ? h + ':' : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(sec).padStart(2, '0')}`;
  return (neg ? '−' : '') + body;
}
