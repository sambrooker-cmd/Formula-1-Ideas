// Championship maths: who can still win the title, and what the leader needs to seal it at the
// next race weekend. Points as in 2025 on: 25-18-15-12-10-8-6-4-2-1 in races, 8 down to 1 in
// sprints, no fastest-lap point. Ties are split by most wins (then seconds, …), which we only mention.
import { driverStats, completedRounds, teamStats, type SeasonHistory } from './history';

export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export interface Contender {
  id: string;
  points: number;
  behind: number;
  /** Could they still win (or tie) if they won everything from here? */
  alive: boolean;
}

export interface Scenario {
  /** Leader's finishing position at the next race (0: outside the points). */
  leaderPos: number;
  /** For each rival still in it: the best position they can have and the leader still seals it (null: any result is enough; 0: only if they score nothing). */
  rivals: { id: string; atBest: number | null }[];
  /** Is it possible at all with this leader result? */
  possible: boolean;
}

export interface TitleMaths {
  kind: 'drivers' | 'teams';
  done: boolean;
  racesLeft: number;
  sprintsLeft: number;
  maxLeft: number;
  table: Contender[];
  next: { name: string; round: number; sprint: boolean; weekendMax: number } | null;
  /** Leader seals it at the next weekend if they leave it this many points (or more) ahead of everyone. */
  clinchMargin: number | null;
  /** Concrete results that seal it at the next race (race-only weekends, drivers). */
  scenarios: Scenario[];
}

export function titleMaths(h: SeasonHistory, kind: 'drivers' | 'teams'): TitleMaths {
  const done = new Set(completedRounds(h));
  const sprintDone = new Set(h.sprints.map((r) => r[0]));
  const left = h.races.filter((r) => !done.has(r.round));
  const sprintsLeft = h.races.filter((r) => r.sprint && !sprintDone.has(r.round)).length;
  const raceMax = kind === 'drivers' ? RACE_POINTS[0] : RACE_POINTS[0] + RACE_POINTS[1];
  const sprintMax = kind === 'drivers' ? SPRINT_POINTS[0] : SPRINT_POINTS[0] + SPRINT_POINTS[1];
  const maxLeft = left.length * raceMax + sprintsLeft * sprintMax;

  const standings =
    kind === 'drivers' ? driverStats(h).map((s) => ({ id: s.id, points: s.points })) : teamStats(h).map((s) => ({ id: s.id, points: s.points }));
  const lead = standings[0]?.points ?? 0;
  const table = standings.map((s) => ({ id: s.id, points: s.points, behind: lead - s.points, alive: s.points + maxLeft >= lead }));

  const nextRace = left[0] ?? null;
  const next = nextRace
    ? {
        name: nextRace.name,
        round: nextRace.round,
        sprint: nextRace.sprint && !sprintDone.has(nextRace.round),
        weekendMax: raceMax + (nextRace.sprint && !sprintDone.has(nextRace.round) ? sprintMax : 0),
      }
    : null;
  const rivals = table.slice(1).filter((c) => c.alive);
  // After the next weekend, the most anyone could still gain.
  const afterNext = next ? maxLeft - next.weekendMax : 0;
  const clinchMargin = next && rivals.length ? afterNext + 1 : null;

  // Race-only weekends: spell out which results do it.
  const scenarios: Scenario[] = [];
  if (kind === 'drivers' && next && !next.sprint && rivals.length && table[0]) {
    const pts = (p: number) => (p >= 1 && p <= 10 ? RACE_POINTS[p - 1] : 0);
    for (let lp = 1; lp <= 11; lp++) {
      const leaderPos = lp === 11 ? 0 : lp;
      const lPts = pts(leaderPos);
      const out: Scenario['rivals'] = [];
      let possible = true;
      for (const r of rivals) {
        // The rival must end up more than `afterNext` behind: r.behind + lPts - rPts > afterNext.
        const allowed = r.behind + lPts - afterNext - 1; // most points the rival may score
        if (allowed < 0) {
          possible = false;
          break;
        }
        if (allowed >= RACE_POINTS[0]) {
          out.push({ id: r.id, atBest: null });
          continue;
        }
        // Best (lowest-numbered) position, other than the leader's, scoring no more than allowed.
        let best = 0;
        for (let p = 1; p <= 11; p++) {
          if (p === leaderPos) continue;
          if (pts(p > 10 ? 0 : p) <= allowed) {
            best = p > 10 ? 0 : p;
            break;
          }
        }
        out.push({ id: r.id, atBest: best });
      }
      scenarios.push({ leaderPos, rivals: out, possible });
    }
  }

  return { kind, done: left.length === 0 && sprintsLeft === 0, racesLeft: left.length, sprintsLeft, maxLeft, table, next, clinchMargin, scenarios };
}
