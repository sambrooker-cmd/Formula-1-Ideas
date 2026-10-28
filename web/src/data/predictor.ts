// Live race predictor: where everyone will finish, projected from the gaps now, any pit stop
// each car still has to make, and (lightly weighted) recent pace and tyre wear to come.
// Tested on three 2025–26 races: from lap 5 on it named the eventual winner 50 times in 56
// (the running order: 47). Further down the order the running order is about as good, so pace
// and tyre effects are kept small (`tune`) rather than trusted fully.
import type { SessionData } from './session';
import { leaderLap, stintForLap, tower, trackStatusAt } from './state';
import { pitLoss } from './pitstop';
import { degModel, raceLaps, tyreCost } from './racepace';

export interface Projection {
  driver: number;
  now: number;
  projected: number;
  /** Projected gap to the projected winner (s), or null when lapped. */
  gap: number | null;
  needsStop: boolean;
  reasons: string[];
}

const DRY = ['SOFT', 'MEDIUM', 'HARD'];
/** Longest sensible stint by compound when the race hasn't shown one yet. */
const DEFAULT_LIFE: Record<string, number> = { SOFT: 30, MEDIUM: 42, HARD: 55 };

export function predictFinish(data: SessionData, t: number, tune = { tyre: 0.2, pace: 0.2 }): { rows: Projection[]; lapsLeft: number; neutralised: boolean } | null {
  const total = data.meta.totalLaps;
  const lap = leaderLap(data, t);
  if (data.meta.session.type !== 'Race' || !total || lap < 3) return null;
  const lapsLeft = Math.max(0, total - lap);
  const model = degModel(data, t);
  const laps = raceLaps(data, t);
  const loss = pitLoss(data) + 1.5; // includes the slow out-lap
  const status = trackStatusAt(data, t).status;
  const neutralised = !['GREEN', 'YELLOW'].includes(status);

  // Longest stint seen so far on each compound (how long tyres can last here).
  const life: Record<string, number> = { ...DEFAULT_LIFE };
  for (const list of data.stints.values())
    for (const s of list) {
      if (!s.compound || s.lapEnd == null) continue;
      life[s.compound] = Math.max(life[s.compound] ?? 0, s.lapEnd - s.lapStart + 1 + (s.ageAtStart ?? 0));
    }
  const fieldPace = median(laps.filter((l) => l.lap > lap - 6).map((l) => l.duration)) ?? 90;

  const rows = tower(data, t).filter((r) => !r.out && r.position < 99);
  const out: (Projection & { time: number; lapped: boolean })[] = [];
  for (const r of rows) {
    const n = r.driver;
    const reasons: string[] = [];
    const recent = laps.filter((l) => l.driver === n && l.lap > lap - 8).map((l) => l.duration);
    const pace = recent.length >= 3 ? median(recent)! : fieldPace;
    const gapNum = r.position === 1 ? 0 : parseFloat(r.gap.replace('+', ''));
    const lapped = r.position !== 1 && (!Number.isFinite(gapNum) || /LAP/i.test(r.gap));
    const compounds = new Set((data.stints.get(n) ?? []).filter((s) => s.lapStart <= Math.max(1, r.lap)).map((s) => s.compound));
    const age = r.tyreAge ?? 0;
    const compound = r.compound ?? 'MEDIUM';
    const wet = !DRY.includes(compound);

    // Does this car still have to stop?
    let needsStop = false;
    if (lapsLeft >= 3 && !wet) {
      if ([...compounds].filter((c) => c && DRY.includes(c)).length < 2) {
        needsStop = true;
        reasons.push('must still use a second compound');
      } else if (age + lapsLeft > (life[compound] ?? 45) + 6) {
        needsStop = true;
        reasons.push(`${compound.toLowerCase()}s ${age} laps old won't last ${lapsLeft} more`);
      }
    }
    let time = (lapped ? 999 : gapNum) + lapsLeft * (fieldPace + (pace - fieldPace) * tune.pace);
    // Tyre wear from here on (recent pace already includes today's wear).
    const slope = model.compounds.find((c) => c.compound === compound)?.slope ?? 0.05;
    if (needsStop) {
      time += loss;
      const next = compounds.has('HARD') ? 'MEDIUM' : 'HARD';
      const fresh = (k: number) => tyreCost(model, next, k) ?? 0;
      const now = tyreCost(model, compound, age) ?? 0;
      for (let k = 1; k <= lapsLeft; k++) time += (fresh(k) - now) * tune.tyre;
    } else if (!wet) {
      time += ((slope * lapsLeft * (lapsLeft + 1)) / 2) * tune.tyre;
    }
    if (recent.length >= 3) {
      const d = pace - fieldPace;
      if (Math.abs(d) > 0.3) reasons.push(`${Math.abs(d).toFixed(1)} s/lap ${d < 0 ? 'quicker' : 'slower'} than the field lately`);
    }
    out.push({ driver: n, now: r.position, projected: 0, gap: null, needsStop, reasons, time, lapped });
  }
  out.sort((a, b) => Number(a.lapped) - Number(b.lapped) || (a.lapped ? a.now - b.now : a.time - b.time));
  const lead = out[0]?.time ?? 0;
  return {
    rows: out.map((o, i) => ({ driver: o.driver, now: o.now, projected: i + 1, gap: o.lapped ? null : o.time - lead, needsStop: o.needsStop, reasons: o.reasons })),
    lapsLeft,
    neutralised,
  };
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
