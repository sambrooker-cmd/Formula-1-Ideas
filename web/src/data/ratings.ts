// Driver ratings for a race: a transparent, rule-based score out of 10 from what the timing data
// shows. Everyone starts at 6; each line below moves it, and every adjustment is listed.
import type { SessionData } from './session';
import { keyMoments } from './moments';
import { likeForLikePace } from './racepace';

export interface Rating {
  driver: number;
  score: number;
  finish: number | null;
  status: string;
  reasons: { text: string; points: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function raceRatings(data: SessionData): Rating[] {
  const { meta } = data;
  if (meta.session.type !== 'Race' || !meta.results.length) return [];
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const team = (n: number) => data.drivers.get(n)?.team ?? '';
  const grid = new Map(meta.grid);
  const result = new Map(meta.results.map((r) => [r.driver, r]));
  const pace = likeForLikePace(data);
  const moments = keyMoments(data);
  const sprint = /sprint/i.test(meta.session.name);

  return meta.results
    .filter((r) => r.status !== 'DNS')
    .map((r) => {
      const n = r.driver;
      const reasons: Rating['reasons'] = [];
      const add = (text: string, points: number) => points && reasons.push({ text, points: Math.round(points * 10) / 10 });
      const finished = r.status === 'FINISHED' && r.position != null;
      const g = grid.get(n);

      // Result.
      if (finished) {
        const p = r.position!;
        // Where they finished matters most; how far they came through matters too, but less.
        const top = sprint ? 8 : 10;
        if (p === 1) add('won', 2);
        else if (p <= 3) add('podium', p === 2 ? 1.6 : 1.3);
        else if (p <= top) add('in the points', 1 - ((p - 4) / (top - 4)) * 0.7);
        if (g) add(g > p ? `gained ${g - p} place${g - p > 1 ? 's' : ''} from P${g}` : g < p ? `lost ${p - g} place${p - g > 1 ? 's' : ''} from P${g}` : '', clamp((g - p) * 0.1, -1, 1));
      } else {
        add(r.status === 'DSQ' ? 'disqualified' : 'didn’t finish', -0.5);
      }

      // Team-mate.
      const mate = meta.results.find((x) => x.driver !== n && team(x.driver) === team(n));
      if (mate) {
        const mg = grid.get(mate.driver);
        if (g && mg) add(g < mg ? `out-qualified ${code(mate.driver)}` : `out-qualified by ${code(mate.driver)}`, g < mg ? 0.3 : -0.3);
        const mateFinished = mate.status === 'FINISHED' && mate.position != null;
        if (finished && mateFinished) add(r.position! < mate.position! ? `finished ahead of ${code(mate.driver)}` : `finished behind ${code(mate.driver)}`, r.position! < mate.position! ? 0.5 : -0.5);
        const mine = pace.get(n);
        const theirs = pace.get(mate.driver);
        if (mine != null && theirs != null) {
          const d = theirs - mine; // + = quicker
          if (Math.abs(d) >= 0.05) add(`${Math.abs(d).toFixed(2)} s/lap ${d > 0 ? 'quicker' : 'slower'} than ${code(mate.driver)} in clean air`, clamp(d * 2.5, -1, 1));
        }
      }

      // Racing.
      const passes = moments.filter((m) => m.kind === 'overtake' && m.drivers[0] === n).length;
      const passed = moments.filter((m) => m.kind === 'overtake' && m.drivers[1] === n).length;
      // The overtake data counts every swap (including back-and-forth ones), so only the net matters.
      const net = passes - passed;
      if (net) add(`${net > 0 ? '+' : ''}${net} net on-track passes (${passes} made, ${passed} suffered)`, clamp(net * 0.1, -0.6, 0.8));

      // Stewards.
      const pens = meta.raceControl.filter(
        ([, , , , , , d, m]) => /\d+ SECOND TIME PENALTY|DRIVE THROUGH|STOP AND GO/.test(m) && !/SERVED/.test(m) && (d === n || new RegExp(`CAR ${n}\\b`).test(m)),
      ).length;
      if (pens) add(`${pens} penalt${pens > 1 ? 'ies' : 'y'}`, -0.5 * pens);

      const score = clamp(6 + reasons.reduce((s, x) => s + x.points, 0), 2, 10);
      return { driver: n, score: Math.round(score * 10) / 10, finish: r.position, status: r.status, reasons };
    })
    .sort((a, b) => b.score - a.score || (a.finish ?? 99) - (b.finish ?? 99));
}
