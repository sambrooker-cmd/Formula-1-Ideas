// Driver form guide: a rating for every race of the season from the results alone (so it works
// for every round, not just the replays on this device), and each driver's average over their
// last five. Same scale and rules as the race ratings (data/ratings.ts), minus the parts that
// need timing data (pace and on-track passes): a result against the car, against the team-mate,
// and places gained.
import { completedRounds, isDnf, type SeasonHistory } from './history';

export interface FormRace {
  round: number;
  score: number;
  finish: number | null;
}
export interface FormRow {
  id: string;
  team: string;
  races: FormRace[];
  /** Average of the last five races. */
  recent: number;
  /** Average of the five before that (null early in the season). */
  before: number | null;
  /** Average over the whole season. */
  season: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function formGuide(h: SeasonHistory, window = 5): FormRow[] {
  const rounds = completedRounds(h);
  const byDriver = new Map<string, FormRace[]>();
  const team = new Map<string, string>();
  for (const round of rounds) {
    const results = h.results.filter((r) => r[0] === round);
    const quali = new Map(h.quali.filter((q) => q[0] === round).map((q) => [q[1], q[3]]));
    for (const r of results) {
      const [, id, teamId, grid, pos] = r;
      if (r[8] === 'Did not start' || /Withdrew/i.test(r[8])) continue;
      team.set(id, teamId);
      let score = 6;
      const finished = !isDnf(r) && pos != null;
      if (finished) {
        if (pos === 1) score += 2;
        else if (pos <= 3) score += pos === 2 ? 1.6 : 1.3;
        else if (pos <= 10) score += 1 - ((pos - 4) / 6) * 0.7;
        if (grid > 0) score += clamp((grid - pos) * 0.1, -1, 1);
      } else score -= 0.5;
      const mate = results.find((x) => x[1] !== id && x[2] === teamId);
      if (mate) {
        const mq = quali.get(mate[1]);
        const q = quali.get(id);
        if (q != null && mq != null) score += q < mq ? 0.3 : -0.3;
        const mateFinished = !isDnf(mate) && mate[4] != null;
        if (finished && mateFinished) score += pos! < mate[4]! ? 0.5 : -0.5;
      }
      const list = byDriver.get(id) ?? [];
      list.push({ round, score: Math.round(clamp(score, 2, 10) * 10) / 10, finish: finished ? pos : null });
      byDriver.set(id, list);
    }
  }
  const rows: FormRow[] = [];
  for (const [id, races] of byDriver) {
    if (races.length < 2) continue;
    const scores = races.map((r) => r.score);
    const recent = avg(scores.slice(-window));
    const prev = scores.slice(-2 * window, -window);
    rows.push({ id, team: team.get(id) ?? '', races, recent, before: prev.length >= 3 ? avg(prev) : null, season: avg(scores) });
  }
  return rows.sort((a, b) => b.recent - a.recent);
}
