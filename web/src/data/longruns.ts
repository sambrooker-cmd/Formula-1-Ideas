// Long runs: in practice, teams run race-style stints on heavy fuel. Finding those runs and
// comparing their pace by compound is the best guide to Sunday. Works on races too (stint pace).
import type { SessionData } from './session';
import { stintForLap } from './state';

export interface RunLap {
  lap: number;
  /** Lap within the run, from 1. */
  i: number;
  duration: number;
  /** Excluded from the average: traffic, a mistake or a cool-down lap. */
  outlier: boolean;
}

export interface LongRun {
  driver: number;
  compound: string | null;
  /** Tyre age (laps) at the start of the run. */
  tyreAge: number | null;
  start: number;
  end: number;
  laps: RunLap[];
  /** Mean of the representative laps (s). */
  average: number;
  /** Least-squares slope of lap time against lap (s per lap): tyre wear minus the gain from burning fuel. */
  slope: number;
  clean: number;
}

const MIN_LAPS = 5;

/**
 * All runs of at least MIN_LAPS representative laps, using laps completed by time `t`.
 * A run is the laps between leaving the pits and coming back in.
 */
export function longRuns(data: SessionData, t = Infinity): LongRun[] {
  const out: LongRun[] = [];
  for (const [n, all] of data.laps) {
    // A race's opening lap (standing start, everyone bunched up) says nothing about pace.
    const laps = all.filter((l) => l.end <= t && !(l.lap === 1 && data.meta.session.type === 'Race'));
    const best = Math.min(...laps.filter((l) => l.duration != null && !l.pitOut).map((l) => l.duration!));
    if (!Number.isFinite(best)) continue;

    // Split into runs at each out-lap or gap in lap numbers.
    const runs: (typeof laps)[] = [];
    let cur: typeof laps = [];
    for (const l of laps) {
      const prev = cur.at(-1);
      if (l.pitOut || (prev && l.lap !== prev.lap + 1)) {
        if (cur.length) runs.push(cur);
        cur = l.pitOut ? [] : [l];
        continue;
      }
      cur.push(l);
    }
    if (cur.length) runs.push(cur);

    for (const run of runs) {
      // The last lap of a finished run is usually the in-lap: drop it if it's slow.
      const timed = run.filter((l) => l.duration != null);
      if (timed.length < MIN_LAPS) continue;
      const sorted = timed.map((l) => l.duration!).sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // Push laps mixed with cool-down laps (a qualifying run) aren't a long run.
      const limit = Math.min(median * 1.035, best * 1.12);
      const rlaps: RunLap[] = timed.map((l, i) => ({ lap: l.lap, i: i + 1, duration: l.duration!, outlier: l.duration! > limit }));
      const clean = rlaps.filter((l) => !l.outlier);
      if (clean.length < MIN_LAPS || clean.length < timed.length * 0.6) continue;
      // Pace close to the session best for every lap means a run of qualifying laps, not a long run.
      const average = clean.reduce((s, l) => s + l.duration, 0) / clean.length;
      if (average < best + 0.4 && data.meta.session.type !== 'Race') continue;

      const stint = stintForLap(data, n, run[0].lap);
      out.push({
        driver: n,
        compound: stint?.compound ?? null,
        tyreAge: stint ? (stint.ageAtStart ?? 0) + Math.max(0, run[0].lap - stint.lapStart) : null,
        start: run[0].t,
        end: run.at(-1)!.end,
        laps: rlaps,
        average,
        slope: slope(clean.map((l) => [l.i, l.duration])),
        clean: clean.length,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function slope(pts: [number, number][]) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den ? num / den : 0;
}

export interface PaceRow {
  driver: number;
  run: LongRun;
}

/**
 * Each driver's most representative long run per compound (the one with most clean laps),
 * ranked by average pace.
 */
export function paceTable(runs: LongRun[], compound: string | null) {
  const best = new Map<number, LongRun>();
  for (const r of runs) {
    if (compound && r.compound !== compound) continue;
    const cur = best.get(r.driver);
    if (!cur || r.clean > cur.clean || (r.clean === cur.clean && r.average < cur.average)) best.set(r.driver, r);
  }
  return [...best].map(([driver, run]) => ({ driver, run })).sort((a, b) => a.run.average - b.run.average);
}

/** Team average of their drivers' runs (same compound filter). */
export function teamPace(data: SessionData, rows: PaceRow[]) {
  const teams = new Map<string, { team: string; colour: string; avg: number[]; drivers: number[] }>();
  for (const r of rows) {
    const d = data.drivers.get(r.driver);
    if (!d) continue;
    const t = teams.get(d.team) ?? { team: d.team, colour: d.colour, avg: [], drivers: [] };
    t.avg.push(r.run.average);
    t.drivers.push(r.driver);
    teams.set(d.team, t);
  }
  return [...teams.values()]
    .map((t) => ({ ...t, pace: Math.min(...t.avg) }))
    .sort((a, b) => a.pace - b.pace);
}
