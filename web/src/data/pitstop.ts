// Pit stop predictor: if a driver pitted right now, where would they come out?
import type { SessionData } from './session';
import { carPosition, isRetired, lastAtOrBefore, trackStatusAt, tower } from './state';

const lossCache = new WeakMap<SessionData, { version: number; loss: number }>();

/**
 * Typical time a pit stop costs in this race: (in-lap + out-lap) minus two normal laps,
 * taken from the race's own green-flag stops. Falls back to 22 s.
 */
export function pitLoss(data: SessionData) {
  const hit = lossCache.get(data);
  if (hit && hit.version === data.version) return hit.loss;
  const losses: number[] = [];
  for (const [n, pits] of data.pits) {
    const laps = (data.laps.get(n) ?? []).filter((l) => l.duration != null);
    const clean = laps.filter((l) => !l.pitOut && l.lap > 1).map((l) => l.duration!).sort((a, b) => a - b);
    const typical = clean[Math.floor(clean.length * 0.3)]; // a "normal" lap, ignoring slow ones
    if (!typical) continue;
    for (const p of pits) {
      const inLap = laps.find((l) => l.t <= p.t && p.t < l.end);
      const outLap = inLap && laps.find((l) => l.lap === inLap.lap + 1);
      if (!inLap || !outLap) continue;
      const status = trackStatusAt(data, p.t).status;
      if (status !== 'GREEN' && status !== 'YELLOW') continue;
      const loss = inLap.duration! + outLap.duration! - 2 * typical;
      if (loss > 10 && loss < 45) losses.push(loss);
    }
  }
  losses.sort((a, b) => a - b);
  const loss = losses.length ? losses[Math.floor(losses.length / 2)] : 22;
  lossCache.set(data, { version: data.version, loss });
  return loss;
}

/** Under a Safety Car or VSC the field is slow, so a stop costs much less. */
function neutralisedFactor(status: string) {
  if (status === 'SC' || status === 'SC_ENDING') return 0.5;
  if (status === 'VSC' || status === 'VSC_ENDING') return 0.6;
  return 1;
}

export interface PitPrediction {
  driver: number;
  loss: number;
  status: string;
  position: number;
  ahead: { driver: number; gap: number } | null;
  behind: { driver: number; gap: number } | null;
  /** Where on track they'd rejoin (x/y in OpenF1 units), if known. */
  ghost: { x: number; y: number } | null;
  /** Gap to the leader after the stop (s), and who the leader is: lets the map animate the ghost smoothly. */
  after: number;
  leader: number | null;
}

export function predictPit(data: SessionData, driver: number, t: number): PitPrediction | null {
  if (data.meta.session.type !== 'Race' || t < data.meta.raceStart) return null;
  const rows = tower(data, t).filter((r) => !r.out);
  const gapOf = (n: number) => {
    const list = data.intervals.get(n);
    if (!list?.length) return null;
    const i = lastAtOrBefore(list.map((s) => s.t), t);
    if (i < 0) return null;
    const s = list[i];
    return rows[0]?.driver === n ? 0 : s.gap;
  };
  const mine = gapOf(driver);
  if (mine == null || isRetired(data, driver, t)) return null;
  const status = trackStatusAt(data, t).status;
  const loss = pitLoss(data) * neutralisedFactor(status);
  const after = mine + loss;

  const others = rows
    .filter((r) => r.driver !== driver)
    .map((r) => ({ driver: r.driver, gap: gapOf(r.driver) }))
    .filter((o): o is { driver: number; gap: number } => o.gap != null);
  const aheadOf = others.filter((o) => o.gap < after).sort((a, b) => b.gap - a.gap);
  const behindOf = others.filter((o) => o.gap >= after).sort((a, b) => a.gap - b.gap);

  // A car that's G seconds behind the leader is where the leader was G seconds ago.
  const leader = rows[0]?.driver;
  const leaderSamples = leader != null ? data.samples.get(leader) : null;
  const pos = leaderSamples ? carPosition(leaderSamples, t - after * 1000) : null;

  return {
    driver,
    loss,
    status,
    position: aheadOf.length + 1,
    ahead: aheadOf[0] ? { driver: aheadOf[0].driver, gap: after - aheadOf[0].gap } : null,
    behind: behindOf[0] ? { driver: behindOf[0].driver, gap: behindOf[0].gap - after } : null,
    ghost: pos ? { x: pos.x, y: pos.y } : null,
    after,
    leader: leader ?? null,
  };
}
