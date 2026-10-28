// Key moments: the race's story as a list of events, worked out from the data we already
// have. Used by the Key moments panel, highlights playback, alerts and TV mode.
import type { SessionData, TrackStatusKind } from './session';
import { formatLapTime, isRetired, stintForLap } from './state';
import { describeBattle, pitBattles } from './undercut';

export type MomentKind = 'start' | 'finish' | 'flag' | 'overtake' | 'pit' | 'penalty' | 'retire' | 'fastest' | 'undercut';

export interface Moment {
  t: number;
  kind: MomentKind;
  /** 1 = minor, 2 = notable, 3 = big (podium fights, Safety Cars, red flags, retirements). */
  weight: 1 | 2 | 3;
  drivers: number[];
  text: string;
  lap: number | null;
}

const FLAG_TEXT: Partial<Record<TrackStatusKind, string>> = {
  SC: 'Safety Car deployed',
  VSC: 'Virtual Safety Car',
  RED: 'Red flag: session stopped',
};

const cache = new WeakMap<SessionData, { version: number; list: Moment[] }>();

/** All key moments in time order (cached per data version). */
export function keyMoments(data: SessionData): Moment[] {
  const hit = cache.get(data);
  if (hit && hit.version === data.version) return hit.list;
  const list = build(data);
  cache.set(data, { version: data.version, list });
  return list;
}

function lapAt(data: SessionData, driver: number | null, t: number) {
  if (driver != null) {
    const laps = data.laps.get(driver) ?? [];
    for (let i = laps.length - 1; i >= 0; i--) if (laps[i].t <= t) return laps[i].lap;
  }
  let lap = 0;
  data.lapStartTimes.forEach((s, n) => s != null && s <= t && (lap = Math.max(lap, n)));
  return lap || null;
}

function build(data: SessionData): Moment[] {
  const { meta } = data;
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const race = meta.session.type === 'Race';
  const out: Moment[] = [];
  const started = meta.raceControl.some((r) => r[2] === 'SessionStatus' && /STARTED/.test(r[7]));

  if (started) out.push({ t: meta.raceStart, kind: 'start', weight: 3, drivers: [], text: race ? 'Lights out' : 'Session started', lap: 1 });

  // Flags: Safety Car, VSC, red, and the restarts after them.
  let neutralised = false;
  for (const s of data.trackStatus) {
    const text = FLAG_TEXT[s.status];
    if (text && !neutralised) {
      out.push({ t: s.t, kind: 'flag', weight: 3, drivers: [], text, lap: lapAt(data, null, s.t) });
      neutralised = true;
    } else if (neutralised && (s.status === 'GREEN' || s.status === 'YELLOW')) {
      out.push({ t: s.t, kind: 'flag', weight: 2, drivers: [], text: race ? 'Green flag: racing resumes' : 'Green flag', lap: lapAt(data, null, s.t) });
      neutralised = false;
    } else if (s.status === 'CHEQUERED' && !out.some((m) => m.kind === 'finish')) {
      out.push({ t: s.t, kind: 'finish', weight: 3, drivers: [], text: 'Chequered flag', lap: lapAt(data, null, s.t) });
      neutralised = false;
    } else if (text && s.status === 'RED') {
      out.push({ t: s.t, kind: 'flag', weight: 3, drivers: [], text, lap: lapAt(data, null, s.t) });
    }
  }

  // Pit stops.
  const pitTimes: { n: number; t: number; until: number }[] = [];
  for (const [n, pits] of data.pits) {
    for (const p of pits) {
      if (p.t < meta.raceStart) continue;
      pitTimes.push({ n, t: p.t, until: p.t + (p.laneDuration ?? 25) * 1000 });
      const lap = p.lap ?? lapAt(data, n, p.t);
      const tyre = lap != null ? stintForLap(data, n, lap + 1)?.compound : null;
      const stop = p.stopDuration != null ? ` (${p.stopDuration.toFixed(1)} s)` : '';
      out.push({
        t: p.t,
        kind: 'pit',
        weight: 1,
        drivers: [n],
        text: `${code(n)} pits${stop}${tyre ? `, onto ${tyre.toLowerCase()}s` : ''}`,
        lap,
      });
    }
  }

  // On-track overtakes (OpenF1 also counts position swaps from pit stops; drop those).
  const inPits = (n: number, t: number) => pitTimes.some((p) => p.n === n && t > p.t - 15_000 && t < p.until + 15_000);
  for (const [t, a, b, pos] of meta.overtakes) {
    if (t < meta.raceStart || inPits(a, t) || inPits(b, t)) continue;
    if (isRetired(data, b, t)) continue;
    out.push({
      t,
      kind: 'overtake',
      weight: pos <= 3 ? 3 : pos <= 10 ? 2 : 1,
      drivers: [a, b],
      text: `${code(a)} passes ${code(b)} for P${pos}`,
      lap: lapAt(data, a, t),
    });
  }

  // Penalties from the stewards.
  for (const [t, lap, , , , , driver, message] of meta.raceControl) {
    if (!/PENALTY/.test(message) || /NO FURTHER|UNDER INVESTIGATION|NOTED/.test(message)) continue;
    const m = /CAR (\d+)/.exec(message);
    const n = driver ?? (m ? Number(m[1]) : null);
    out.push({
      t,
      kind: 'penalty',
      weight: 2,
      drivers: n != null ? [n] : [],
      text: message
        .replace(/^FIA STEWARDS: /, '')
        .toLowerCase()
        .replace(/^./, (c) => c.toUpperCase())
        .replace(/\(([a-z]{3})\)/g, (_m, c: string) => `(${c.toUpperCase()})`),
      lap,
    });
  }

  // Retirements.
  for (const r of meta.results) {
    if (r.status === 'FINISHED' || r.status === 'DNS') continue;
    const last = data.laps.get(r.driver)?.at(-1);
    if (!last) continue;
    const t = last.duration != null ? last.end + 30_000 : last.t + 150_000;
    out.push({ t, kind: 'retire', weight: 3, drivers: [r.driver], text: `${code(r.driver)} is out of the ${race ? 'race' : 'session'}`, lap: last.lap });
  }

  // Places won or lost in the pits (undercuts and overcuts).
  for (const b of pitBattles(data)) {
    if (b.outcome !== 'undercut' && b.outcome !== 'overcut') continue;
    const winner = b.outcome === 'undercut' ? b.first : b.second;
    out.push({
      t: b.settled,
      kind: 'undercut',
      weight: b.forPosition <= 3 ? 3 : b.forPosition <= 10 ? 2 : 1,
      drivers: [winner, winner === b.first ? b.second : b.first],
      text: describeBattle(b, code),
      lap: b.secondLap + 1,
    });
  }

  // Each new fastest lap (after the opening laps, when they mean something).
  const laps: { n: number; lap: number; end: number; duration: number }[] = [];
  for (const [n, list] of data.laps) for (const l of list) if (l.duration && !l.pitOut && l.lap > 1) laps.push({ n, lap: l.lap, end: l.end, duration: l.duration });
  laps.sort((x, y) => x.end - y.end);
  let best = Infinity;
  for (const l of laps) {
    if (l.duration >= best) continue;
    best = l.duration;
    if (race && l.lap < 5) continue;
    out.push({ t: l.end, kind: 'fastest', weight: 1, drivers: [l.n], text: `Fastest lap: ${code(l.n)} ${formatLapTime(l.duration)}`, lap: l.lap });
  }

  return out.sort((x, y) => x.t - y.t);
}

// ---- highlights ----

export const LEAD_IN = 8000; // jump this far before a moment so you see it build up
export const HIGHLIGHT_LENGTH = 22_000; // how long each highlight plays before moving on

/**
 * The moments to play. Without a time limit: every notable moment. With one (catch-up), the
 * biggest moments that fit, always including the start, flags and the finish; moments close
 * together share one clip.
 */
export function highlightReel(all: Moment[], raceStart: number, minutes: number | null): Moment[] {
  const firstFinish = all.find((m) => m.kind === 'finish');
  const pool = all.filter((m) => m.t >= raceStart - 1000 && (minutes != null || m.weight >= 2) && (m.kind !== 'finish' || m == firstFinish));
  // One clip per cluster of moments (the first moment starts it), scored by what's in it.
  const clips: { m: Moment; score: number; must: boolean }[] = [];
  for (const m of pool) {
    const last = clips[clips.length - 1];
    const forPlace = Number(/for P(\d+)/.exec(m.text)?.[1] ?? 99);
    const restart = m.kind === 'flag' && /^Green/.test(m.text);
    const w = restart ? 1 : m.weight ** 2 * (m.kind === 'overtake' ? (forPlace <= 3 ? 2 : forPlace <= 10 ? 1.2 : 0.8) : 1);
    const must = m.kind === 'start' || m.kind === 'finish' || (m.kind === 'flag' && !restart);
    if (last && m.t - last.m.t < HIGHLIGHT_LENGTH - LEAD_IN) {
      last.score += w;
      last.must ||= must;
    } else clips.push({ m, score: w, must });
  }
  if (minutes == null) return clips.map((c) => c.m);
  const fit = Math.max(3, Math.floor((minutes * 60_000) / HIGHLIGHT_LENGTH));
  const chosen = [...clips].sort((a, b) => Number(b.must) - Number(a.must) || b.score - a.score).slice(0, fit);
  return chosen.map((c) => c.m).sort((a, b) => a.t - b.t);
}
