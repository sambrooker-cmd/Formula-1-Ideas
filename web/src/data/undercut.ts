// Undercut checker: for each pit stop, did stopping earlier (or later) than a nearby rival
// win or lose the place? Pairs up close cars that pitted within a few laps of each other and
// compares their order before the first stop with their order once both have rejoined.
import type { SessionData } from './session';
import { isRetired, lastAtOrBefore, trackStatusAt } from './state';

export type BattleOutcome = 'undercut' | 'overcut' | 'held' | 'failed';

export interface PitBattle {
  /** The car that stopped first. */
  first: number;
  /** The car that stayed out longer. */
  second: number;
  firstLap: number;
  secondLap: number;
  /** When the first car pitted, and when the outcome was settled (end of the second car's out-lap). */
  t: number;
  settled: number;
  /** Was the first car ahead before / after? */
  aheadBefore: boolean;
  aheadAfter: boolean;
  /** Seconds the first car gained on the second over the cycle (negative = lost), if gaps are known. */
  swing: number | null;
  /** Gap between them once settled, in seconds (positive = first car ahead). */
  gapAfter: number | null;
  /** Stops made under a Safety Car or VSC cost less, which changes the picture. */
  neutralised: boolean;
  outcome: BattleOutcome;
  /** Position of the leading car of the two after the cycle. */
  forPosition: number;
  /** Stationary times (s), when known: a slow stop often decides it. */
  firstStop: number | null;
  secondStop: number | null;
}

const MAX_LAPS_APART = 5; // further apart than this it's a different strategy, not an undercut
const MAX_POSITIONS_APART = 3;
const MAX_GAP = 8; // seconds between them before the first stop

const cache = new WeakMap<SessionData, { version: number; list: PitBattle[] }>();

export function pitBattles(data: SessionData): PitBattle[] {
  const hit = cache.get(data);
  if (hit && hit.version === data.version) return hit.list;
  const list = data.meta.session.type === 'Race' ? build(data) : [];
  cache.set(data, { version: data.version, list });
  return list;
}

function positionAt(data: SessionData, n: number, t: number) {
  const s = data.positions.get(n);
  if (!s) return null;
  const i = lastAtOrBefore(s.t, t);
  return i < 0 ? null : s.v[i];
}

/** Gap to the leader in seconds (0 for the leader), or null if lapped / unknown. */
function gapAt(data: SessionData, n: number, t: number) {
  if (positionAt(data, n, t) === 1) return 0;
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
  return ans < 0 ? null : list[ans].gap;
}

/** End of the lap on which a car left the pits: by then it's back up to speed and the order is settled. */
function outLapEnd(data: SessionData, n: number, pitT: number, lane: number) {
  const exit = pitT + lane * 1000;
  const laps = data.laps.get(n) ?? [];
  const lap = laps.find((l) => l.t <= exit && exit < l.end) ?? laps.find((l) => l.t > exit);
  if (!lap || lap.duration == null) return null;
  return lap.end + 1000;
}

function build(data: SessionData): PitBattle[] {
  const { raceStart } = data.meta;
  const stops: { n: number; t: number; lap: number; lane: number; stop: number | null }[] = [];
  for (const [n, pits] of data.pits)
    for (const p of pits) if (p.t > raceStart && p.lap != null) stops.push({ n, t: p.t, lap: p.lap, lane: p.laneDuration ?? 22, stop: p.stopDuration });
  stops.sort((a, b) => a.t - b.t);

  const out: PitBattle[] = [];
  for (const a of stops) {
    const before = a.t - 3000;
    const posA = positionAt(data, a.n, before);
    if (posA == null) continue;
    const nextA = stops.find((s) => s.n === a.n && s.t > a.t);
    for (const n of data.driverOrder) {
      if (n === a.n) continue;
      // The rival's next stop after ours, a few laps later, with no stop of theirs just before ours
      // (that would be their undercut on us, counted the other way round).
      const b = stops.find((s) => s.n === n && s.t > a.t);
      if (!b || b.lap <= a.lap || b.lap - a.lap > MAX_LAPS_APART) continue;
      if (stops.some((s) => s.n === n && s.t < a.t && a.lap - s.lap <= MAX_LAPS_APART)) continue;
      if (nextA && nextA.t < b.t + b.lane * 1000) continue;

      const posB = positionAt(data, n, before);
      if (posB == null || Math.abs(posA - posB) > MAX_POSITIONS_APART) continue;
      const gA = gapAt(data, a.n, before);
      const gB = gapAt(data, n, before);
      if (gA != null && gB != null && Math.abs(gA - gB) > MAX_GAP) continue;
      if (gA == null || gB == null) {
        if (Math.abs(posA - posB) > 1) continue; // can't tell how close they were: only take neighbours
      }

      const settled = outLapEnd(data, n, b.t, b.lane);
      if (settled == null) continue;
      if (isRetired(data, a.n, settled) || isRetired(data, n, settled)) continue;
      const pA = positionAt(data, a.n, settled);
      const pB = positionAt(data, n, settled);
      if (pA == null || pB == null) continue;

      const aheadBefore = posA < posB;
      const aheadAfter = pA < pB;
      const gA2 = gapAt(data, a.n, settled);
      const gB2 = gapAt(data, n, settled);
      const relBefore = gA != null && gB != null ? gB - gA : null;
      const relAfter = gA2 != null && gB2 != null ? gB2 - gA2 : null;
      const neutral = (t: number) => !['GREEN', 'YELLOW', 'CHEQUERED', 'PRE'].includes(trackStatusAt(data, t).status);

      out.push({
        first: a.n,
        second: n,
        firstLap: a.lap,
        secondLap: b.lap,
        t: a.t,
        settled,
        aheadBefore,
        aheadAfter,
        swing: relBefore != null && relAfter != null ? relAfter - relBefore : null,
        gapAfter: relAfter,
        neutralised: neutral(a.t) || neutral(b.t),
        outcome: aheadBefore ? (aheadAfter ? 'held' : 'overcut') : aheadAfter ? 'undercut' : 'failed',
        forPosition: Math.min(pA, pB),
        firstStop: a.stop,
        secondStop: b.stop,
      });
    }
  }
  return out;
}

/** One-line description, from the point of view of whoever gained (or kept) the place. */
export function describeBattle(b: PitBattle, code: (n: number) => string) {
  const A = code(b.first);
  const B = code(b.second);
  const laps = b.secondLap - b.firstLap;
  const l = `${laps} lap${laps > 1 ? 's' : ''}`;
  return main() + slow();

  function main() {
    switch (b.outcome) {
      case 'undercut':
        return `Undercut: ${A} pits ${l} earlier and jumps ${B}`;
      case 'overcut':
        return `Overcut: ${B} stays out ${l} longer and jumps ${A}`;
      case 'held':
        return `${A} pits first and stays ahead of ${B}`;
      case 'failed':
        return `${A}'s undercut on ${B} doesn't work`;
    }
  }
  function slow() {
    const s = [b.firstStop != null && b.firstStop >= SLOW_STOP ? `${A} ${b.firstStop.toFixed(1)} s` : '', b.secondStop != null && b.secondStop >= SLOW_STOP ? `${B} ${b.secondStop.toFixed(1)} s` : '']
      .filter(Boolean)
      .join(', ');
    return s ? ` (slow stop: ${s})` : '';
  }
}

const SLOW_STOP = 4;
