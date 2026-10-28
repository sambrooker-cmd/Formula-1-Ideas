// Battle tracker: stretches of the race where a car ran within a second of the car directly ahead
// for several laps (green flag only), including whether the places changed.
import type { SessionData } from './session';
import { lastAtOrBefore, trackStatusAt } from './state';

export const BATTLE_GAP = 1.0;
export const MIN_LAPS = 3;

export interface Battle {
  /** The pair, front car first at the start of the battle. */
  front: number;
  chaser: number;
  startLap: number;
  endLap: number;
  start: number;
  end: number;
  /** Position being fought over (the front car's, at the start). */
  forPosition: number;
  closest: number;
  /** Changes of order during the battle (not in the pits). */
  passes: { lap: number; t: number; by: number }[];
}

const cache = new WeakMap<SessionData, { version: number; list: Battle[] }>();

function positionAt(data: SessionData, n: number, t: number) {
  const s = data.positions.get(n);
  if (!s) return null;
  const i = lastAtOrBefore(s.t, t);
  return i < 0 ? null : s.v[i];
}

function intervalAt(data: SessionData, n: number, t: number) {
  const list = data.intervals.get(n);
  if (!list?.length) return null;
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
  return ans < 0 ? null : list[ans].interval;
}

export function battles(data: SessionData): Battle[] {
  const hit = cache.get(data);
  if (hit && hit.version === data.version) return hit.list;
  const list = data.meta.session.type === 'Race' ? build(data) : [];
  cache.set(data, { version: data.version, list });
  return list;
}

function build(data: SessionData): Battle[] {
  // For every lap end: who was right behind whom, and how close.
  type Close = { lap: number; t: number; front: number; chaser: number; gap: number; pos: number };
  const close: Close[] = [];
  const inPits = (n: number, t: number) => (data.pits.get(n) ?? []).some((p) => t > p.t - 20_000 && t < p.t + ((p.laneDuration ?? 22) + 20) * 1000);
  for (const [n, laps] of data.laps) {
    for (const l of laps) {
      if (l.duration == null || l.lap < 2) continue;
      const t = l.end + 500;
      if (!['GREEN', 'YELLOW'].includes(trackStatusAt(data, t).status) || !['GREEN', 'YELLOW'].includes(trackStatusAt(data, l.t).status)) continue;
      const gap = intervalAt(data, n, t);
      const pos = positionAt(data, n, t);
      if (gap == null || pos == null || pos < 2 || gap > BATTLE_GAP) continue;
      const front = data.driverOrder.find((x) => x !== n && positionAt(data, x, t) === pos - 1);
      if (front == null || inPits(n, t) || inPits(front, t)) continue;
      close.push({ lap: l.lap, t, front, chaser: n, gap, pos: pos - 1 });
    }
  }
  close.sort((a, b) => a.t - b.t);

  // Group by pair (either order), allowing a one-lap break.
  const open = new Map<string, Battle & { lastLap: number }>();
  const done: Battle[] = [];
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const c of close) {
    const k = key(c.front, c.chaser);
    const b = open.get(k);
    if (b && c.lap <= b.lastLap + 2) {
      // The order flipped: a pass (on track: we skipped pit laps above).
      const prevFront = b.passes.length ? b.passes.at(-1)!.by : b.front;
      if (c.front !== prevFront) b.passes.push({ lap: c.lap, t: c.t, by: c.front });
      b.lastLap = Math.max(b.lastLap, c.lap);
      b.endLap = b.lastLap;
      b.end = c.t;
      b.closest = Math.min(b.closest, c.gap);
      continue;
    }
    if (b) {
      if (b.endLap - b.startLap + 1 >= MIN_LAPS) done.push(b);
      open.delete(k);
    }
    open.set(k, { front: c.front, chaser: c.chaser, startLap: c.lap, endLap: c.lap, start: c.t - 90_000, end: c.t, forPosition: c.pos, closest: c.gap, passes: [], lastLap: c.lap });
  }
  for (const b of open.values()) if (b.endLap - b.startLap + 1 >= MIN_LAPS) done.push(b);
  return done
    .map((b) => {
      const { lastLap: _unused, ...rest } = b as Battle & { lastLap: number };
      return rest;
    })
    .sort((a, b) => a.start - b.start);
}
