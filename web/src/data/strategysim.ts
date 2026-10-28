// Strategy simulator: replay one driver's race with different pit stops and tyres.
// Each real lap is split into "underlying pace" + tyre effect + pit-stop time; the plan swaps
// the tyre and pit parts using this race's degradation model and pit loss, then the new
// finishing time is compared with everyone else's real one. Traffic and other teams' reactions
// aren't modelled.
import type { SessionData } from './session';
import { pitLoss } from './pitstop';
import { degModel, tyreCost, type DegModel } from './racepace';
import { stintForLap, trackStatusAt } from './state';

export interface PlanStint {
  compound: string;
  /** First lap on this set (1 for the start). */
  fromLap: number;
  /** Laps already on the set when fitted (0 = new). */
  ageAtStart: number;
}

export interface SimResult {
  laps: number[];
  /** Cumulative race time after each lap (ms from lights out), real and simulated. */
  realCum: number[];
  simCum: number[];
  realPos: number;
  simPos: number;
  delta: number;
  /** Who they'd finish just ahead of / behind, and by how much (s). */
  ahead: { driver: number; gap: number } | null;
  behind: { driver: number; gap: number } | null;
  pitLoss: number;
}

const neutralFactor = (status: string) => (status.startsWith('SC') ? 0.5 : status.startsWith('VSC') ? 0.6 : 1);

/** The driver's actual strategy as a plan (starting point for editing). */
export function actualPlan(data: SessionData, n: number): PlanStint[] {
  return (data.stints.get(n) ?? []).map((s, i) => ({
    compound: s.compound ?? 'MEDIUM',
    fromLap: i === 0 ? 1 : s.lapStart,
    ageAtStart: s.ageAtStart ?? 0,
  }));
}

/** Split a driver's real laps into underlying pace, without tyre effects or pit-stop time. */
function decompose(data: SessionData, n: number, model: DegModel) {
  const laps = (data.laps.get(n) ?? []).filter((l) => l.duration != null).sort((a, b) => a.lap - b.lap);
  const realPitLaps = new Set((data.pits.get(n) ?? []).filter((p) => p.t > data.meta.raceStart).map((p) => p.lap));
  const green = (t: number) => ['GREEN', 'YELLOW'].includes(trackStatusAt(data, t).status);
  const tyreOn = (lapNo: number) => {
    const st = stintForLap(data, n, lapNo);
    return { compound: st?.compound ?? null, age: st ? (st.ageAtStart ?? 0) + (lapNo - st.lapStart) : 0 };
  };
  const isPitLap = (lapNo: number) => realPitLaps.has(lapNo) || realPitLaps.has(lapNo - 1);
  const base: (number | null)[] = laps.map((l) => {
    if (l.lap === 1) return l.duration!;
    if (isPitLap(l.lap) || l.pitOut) return null; // filled in below
    const ty = tyreOn(l.lap);
    return l.duration! - (green(l.t) ? tyreCost(model, ty.compound, ty.age) ?? 0 : 0);
  });
  // In- and out-laps: borrow the underlying pace from the nearest normal laps.
  base.forEach((b, i) => {
    if (b != null) return;
    let prev = i - 1;
    while (prev >= 0 && base[prev] == null) prev--;
    let next = i + 1;
    while (next < base.length && base[next] == null) next++;
    const vals = [base[prev], base[next]].filter((v): v is number => v != null);
    base[i] = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : laps[i].duration!;
  });
  // A real in/out-lap under the Safety Car is slow for that reason, not the stop: keep it as is.
  laps.forEach((l, i) => {
    if (isPitLap(l.lap) && !green(l.t + (l.end - l.t) / 2)) base[i] = l.duration!;
  });
  return { laps, base: base as number[], realPitLaps, green, tyreOn, isPitLap };
}

const costCache = new WeakMap<SessionData, number>();
/**
 * What a green-flag stop really costs in this race, measured the same way the simulator builds
 * laps (includes the slow out-lap on cold tyres): median over every driver's green stops.
 */
function stopCost(data: SessionData, model: DegModel) {
  const hit = costCache.get(data);
  if (hit != null) return hit;
  const costs: number[] = [];
  for (const n of data.driverOrder) {
    const { laps, base, realPitLaps, green, tyreOn } = decompose(data, n, model);
    for (const p of realPitLaps) {
      if (p == null) continue;
      const iIn = laps.findIndex((l) => l.lap === p);
      const iOut = laps.findIndex((l) => l.lap === p + 1);
      if (iIn < 0 || iOut < 0) continue;
      if (!green(laps[iIn].t) || !green(laps[iOut].end - 1)) continue;
      const exp = [iIn, iOut].reduce((sum, i) => {
        const ty = tyreOn(laps[i].lap);
        return sum + base[i] + (tyreCost(model, ty.compound, ty.age) ?? 0);
      }, 0);
      const c = laps[iIn].duration! + laps[iOut].duration! - exp;
      if (c > 10 && c < 50) costs.push(c);
    }
  }
  costs.sort((a, b) => a - b);
  const v = costs.length ? costs[Math.floor(costs.length / 2)] : pitLoss(data) + 1.5;
  costCache.set(data, v);
  return v;
}

export function simulate(data: SessionData, n: number, plan: PlanStint[], model: DegModel = degModel(data)): SimResult | null {
  const { laps, base, green, isPitLap } = decompose(data, n, model);
  if (laps.length < 5 || !plan.length) return null;
  const loss = stopCost(data, model);
  const start = data.meta.raceStart;
  const statusOfLap = (lapNo: number) => {
    const l = laps.find((x) => x.lap === lapNo);
    return l ? trackStatusAt(data, l.t + (l.end - l.t) / 2).status : 'GREEN';
  };

  const lapTimes = (pl: PlanStint[]) => {
    const sorted = [...pl].sort((a, b) => a.fromLap - b.fromLap);
    const stopLaps = new Set(sorted.slice(1).map((st) => st.fromLap - 1)); // pit at the end of the lap before
    return laps.map((l, i) => {
      let t = base[i];
      if (l.lap > 1) {
        const st = [...sorted].reverse().find((x) => x.fromLap <= l.lap) ?? sorted[0];
        const age = st.ageAtStart + (l.lap - st.fromLap);
        if (green(l.t)) t += tyreCost(model, st.compound, age) ?? 0;
      }
      // The real Safety Car laps stay as they were (the field was slow regardless).
      const realNeutralPit = isPitLap(l.lap) && !green(l.t + (l.end - l.t) / 2);
      if (stopLaps.has(l.lap) && !realNeutralPit) t += (loss / 2) * neutralFactor(statusOfLap(l.lap));
      if (stopLaps.has(l.lap - 1) && !realNeutralPit) t += (loss / 2) * neutralFactor(statusOfLap(l.lap - 1));
      return t;
    });
  };
  // Compare the plan with the model's version of what really happened, and apply only the
  // difference to the real race: the real strategy then reproduces the real result exactly.
  const asRun = lapTimes(actualPlan(data, n));
  const planned = lapTimes(plan);

  const realCum: number[] = [];
  const simCum: number[] = [];
  let diff = 0;
  laps.forEach((l, i) => {
    diff += planned[i] - asRun[i];
    realCum.push(l.end - start);
    simCum.push(l.end - start + diff * 1000);
  });

  // Finishing order: everyone else's real finish (laps completed, then time).
  const finish = (driver: number) => {
    const ls = (data.laps.get(driver) ?? []).filter((l) => l.duration != null);
    const last = ls.at(-1);
    return last ? { laps: last.lap, time: last.end - start } : null;
  };
  const me = { laps: laps.at(-1)!.lap, time: realCum.at(-1)! };
  const meSim = { laps: me.laps, time: simCum.at(-1)! };
  const others = data.driverOrder.filter((x) => x !== n).map((x) => ({ driver: x, f: finish(x) })).filter((o) => o.f) as { driver: number; f: { laps: number; time: number } }[];
  const before = (a: { laps: number; time: number }, b: { laps: number; time: number }) => a.laps > b.laps || (a.laps === b.laps && a.time < b.time);
  // Real lap 1 time includes the grid; anchor both on the car's real finishing time.
  const offset = (finish(n)?.time ?? me.time) - me.time;
  const meReal = { ...me, time: me.time + offset };
  const meNew = { ...meSim, time: meSim.time + offset };
  const realPos = 1 + others.filter((o) => before(o.f, meReal)).length;
  const simPos = 1 + others.filter((o) => before(o.f, meNew)).length;
  const sameLap = others.filter((o) => o.f.laps === meNew.laps);
  const aheadCar = sameLap.filter((o) => o.f.time <= meNew.time).sort((a, b) => b.f.time - a.f.time)[0];
  const behindCar = sameLap.filter((o) => o.f.time > meNew.time).sort((a, b) => a.f.time - b.f.time)[0];

  return {
    laps: laps.map((l) => l.lap),
    realCum,
    simCum,
    realPos,
    simPos,
    delta: (meNew.time - meReal.time) / 1000,
    ahead: aheadCar ? { driver: aheadCar.driver, gap: (meNew.time - aheadCar.f.time) / 1000 } : null,
    behind: behindCar ? { driver: behindCar.driver, gap: (behindCar.f.time - meNew.time) / 1000 } : null,
    pitLoss: loss,
  };
}
