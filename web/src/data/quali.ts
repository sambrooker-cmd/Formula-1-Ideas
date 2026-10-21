// Qualifying: Q1/Q2/Q3 phases, knockouts, deleted laps and the running order at any moment.
import type { Lap, SessionData } from './session';

export interface Phase {
  n: number;
  start: number;
  end: number;
}

export const isQualifying = (data: SessionData) => data.meta.session.type === 'Qualifying';

/** Phase windows from race control (each phase has its own SESSION STARTED / FINISHED). */
export function phases(data: SessionData): Phase[] {
  const out: Phase[] = [];
  for (const r of data.meta.raceControl) {
    const phase = r[8];
    if (r[2] !== 'SessionStatus' || phase == null) continue;
    if (/STARTED/.test(r[7]) && !out.some((p) => p.n === phase)) out.push({ n: phase, start: r[0], end: Infinity });
    if (/FINISHED/.test(r[7])) {
      const p = out.find((x) => x.n === phase);
      if (p) p.end = r[0];
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** How many cars go through to Q2 (20 cars: 15; 22 cars: 16). Q3 is always the top 10. */
export function q2Size(field: number) {
  return field - Math.ceil((field - 10) / 2);
}

/** Laps the stewards deleted (track limits etc.): driver → lap number → time of deletion. */
function deletions(data: SessionData) {
  const out = new Map<number, Map<number, number>>();
  for (const r of data.meta.raceControl) {
    const m = /CAR (\d+).*?TIME [\d:.]+ DELETED.*?LAP (\d+)/.exec(r[7]);
    if (!m) continue;
    const n = Number(m[1]);
    if (!out.has(n)) out.set(n, new Map());
    out.get(n)!.set(Number(m[2]), r[0]);
  }
  return out;
}

export interface QualiRow {
  driver: number;
  /** Phase the driver was knocked out in (null while still in). */
  outIn: number | null;
  best: Lap | null;
  last: Lap | null;
  lapsInPhase: number;
  onLap: boolean;
  inPit: boolean;
}

export interface QualiState {
  phase: Phase | null;
  /** The phase whose results are being shown (current, or just finished). */
  shown: number;
  rows: QualiRow[];
  /** Position after which drivers are in the drop zone for the shown phase (null in Q3). */
  cutoff: number | null;
  fastest: number | null;
}

export function qualiAt(data: SessionData, t: number): QualiState {
  const ph = phases(data);
  const del = deletions(data);
  const current = [...ph].reverse().find((p) => p.start <= t) ?? null;
  const shown = current?.n ?? 1;
  const field = data.meta.drivers.length;

  const valid = (n: number, l: Lap) => {
    if (l.duration == null || l.end > t || l.pitOut) return false;
    const deletedAt = del.get(n)?.get(l.lap);
    return deletedAt == null || deletedAt > t;
  };
  const phaseOf = (l: Lap) => [...ph].reverse().find((p) => p.start <= l.t)?.n ?? 1;
  const bestIn = (n: number, phase: number) => {
    let best: Lap | null = null;
    for (const l of data.laps.get(n) ?? []) if (phaseOf(l) === phase && valid(n, l) && (!best || l.duration! < best.duration!)) best = l;
    return best;
  };
  const byBest = (phase: number) => (a: number, b: number) =>
    (bestIn(a, phase)?.duration ?? Infinity) - (bestIn(b, phase)?.duration ?? Infinity);

  // Knockouts happen when the next phase starts.
  const outIn = new Map<number, number>();
  let alive = data.meta.drivers.map((d) => d.number);
  for (const p of ph) {
    if (p.n >= 3) break;
    const next = ph.find((x) => x.n === p.n + 1);
    if (!next || next.start > t) break;
    const keep = p.n === 1 ? q2Size(field) : 10;
    const ranked = [...alive].sort(byBest(p.n));
    for (const n of ranked.slice(keep)) outIn.set(n, p.n);
    alive = ranked.slice(0, keep);
  }

  const rowFor = (n: number): QualiRow => {
    const laps = data.laps.get(n) ?? [];
    const lapsIn = laps.filter((l) => phaseOf(l) === shown && l.t <= t);
    const lastDone = [...laps].reverse().find((l) => l.duration != null && l.end <= t) ?? null;
    const now = laps.find((l) => l.t <= t && t < l.end);
    const pits = data.pits.get(n) ?? [];
    const lastPit = [...pits].reverse().find((p) => p.t <= t);
    const inPit = !!lastPit && t < lastPit.t + (lastPit.laneDuration ?? 30) * 1000;
    return {
      driver: n,
      outIn: outIn.get(n) ?? null,
      best: bestIn(n, outIn.get(n) ?? shown),
      last: lastDone,
      lapsInPhase: lapsIn.length,
      onLap: !!now && !now.pitOut && !inPit,
      inPit,
    };
  };

  const running = alive.sort(byBest(shown)).map(rowFor);
  const out2 = [...outIn].filter(([, p]) => p === 2).map(([n]) => n).sort(byBest(2)).map(rowFor);
  const out1 = [...outIn].filter(([, p]) => p === 1).map(([n]) => n).sort(byBest(1)).map(rowFor);
  const fastest = running.reduce<number | null>((m, r) => (r.best && (m == null || r.best.duration! < m) ? r.best.duration! : m), null);
  return {
    phase: current,
    shown,
    rows: [...running, ...out2, ...out1],
    cutoff: shown === 1 ? q2Size(field) : shown === 2 ? 10 : null,
    fastest,
  };
}
