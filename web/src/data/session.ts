// Loads a replay pack and indexes it for fast "state at time T" lookups.
import type { PackDriver, PackMeta, SamplesHeader } from '../../../shared/pack';

export interface DriverSamples {
  locT: Int32Array;
  locX: Int32Array;
  locY: Int32Array;
  carT: Int32Array;
  speed: Int16Array;
  throttle: Uint8Array;
  brake: Uint8Array;
  rpm: Uint16Array;
  gear: Uint8Array;
  drs: Uint8Array;
  /** Cumulative distance in metres at each car sample, integrated from speed. */
  dist: Float64Array;
}

export interface Lap {
  lap: number;
  t: number;
  end: number;
  duration: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  pitOut: boolean;
}

export interface Series {
  t: number[];
  v: number[];
}

export interface IntervalSample {
  t: number;
  gap: number | null;
  gapText: string | null;
  interval: number | null;
  intervalText: string | null;
}

export interface Stint {
  stint: number;
  lapStart: number;
  lapEnd: number | null;
  compound: string | null;
  ageAtStart: number | null;
}

export interface Pit {
  t: number;
  lap: number | null;
  laneDuration: number | null;
  stopDuration: number | null;
}

export type TrackStatusKind = 'PRE' | 'GREEN' | 'YELLOW' | 'SC' | 'SC_ENDING' | 'VSC' | 'VSC_ENDING' | 'RED' | 'CHEQUERED';

export interface TrackStatusSpan {
  t: number;
  status: TrackStatusKind;
  yellowSectors: number[];
}

export interface SessionData {
  meta: PackMeta;
  drivers: Map<number, PackDriver>;
  driverOrder: number[];
  samples: Map<number, DriverSamples>;
  laps: Map<number, Lap[]>;
  intervals: Map<number, IntervalSample[]>;
  positions: Map<number, Series>;
  stints: Map<number, Stint[]>;
  pits: Map<number, Pit[]>;
  trackStatus: TrackStatusSpan[];
  /** Time the race leader started lap N (index N). */
  lapStartTimes: number[];
  bestLap: { driver: number; lap: Lap } | null;
}

const cache = new Map<number, Promise<SessionData>>();

export function loadSession(key: number, onProgress?: (loaded: number, total: number) => void) {
  if (!cache.has(key)) {
    const p = load(key, onProgress);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return cache.get(key)!;
}

async function load(key: number, onProgress?: (loaded: number, total: number) => void): Promise<SessionData> {
  const metaRes = await fetch(`/api/sessions/${key}/meta`);
  if (!metaRes.ok) throw new Error(`Session ${key} is not cached yet. Ingest it from the home page first.`);
  const meta = (await metaRes.json()) as PackMeta;
  const buf = await fetchWithProgress(`/api/sessions/${key}/samples`, onProgress);
  return index(meta, buf);
}

async function fetchWithProgress(url: string, onProgress?: (loaded: number, total: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to load ${url}`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded, 0);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

const CTORS = { i32: Int32Array, i16: Int16Array, u16: Uint16Array, u8: Uint8Array } as const;

function index(meta: PackMeta, buf: ArrayBuffer): SessionData {
  const headerLen = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headerLen))) as SamplesHeader;
  const base = 4 + headerLen;
  const arrays = new Map<string, any>();
  for (const a of header.arrays) arrays.set(a.key, new CTORS[a.type](buf, base + a.offset, a.length));

  const drivers = new Map(meta.drivers.map((d) => [d.number, d]));
  const samples = new Map<number, DriverSamples>();
  for (const d of meta.drivers) {
    const g = (k: string) => arrays.get(`${k}`);
    const carT: Int32Array = g(`car.${d.number}.t`);
    const speed: Int16Array = g(`car.${d.number}.speed`);
    const dist = new Float64Array(carT.length);
    for (let i = 1; i < carT.length; i++) {
      const dt = (carT[i] - carT[i - 1]) / 1000;
      dist[i] = dist[i - 1] + (dt > 0 && dt < 5 ? ((speed[i] + speed[i - 1]) / 2 / 3.6) * dt : 0);
    }
    samples.set(d.number, {
      locT: g(`loc.${d.number}.t`),
      locX: g(`loc.${d.number}.x`),
      locY: g(`loc.${d.number}.y`),
      carT,
      speed,
      throttle: g(`car.${d.number}.throttle`),
      brake: g(`car.${d.number}.brake`),
      rpm: g(`car.${d.number}.rpm`),
      gear: g(`car.${d.number}.gear`),
      drs: g(`car.${d.number}.drs`),
      dist,
    });
  }

  const group = <T>(rows: T[], key: (r: T) => number) => {
    const m = new Map<number, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };

  const laps = new Map<number, Lap[]>();
  for (const [n, rows] of group(meta.laps, (r) => r[0])) {
    const list = rows
      .filter((r) => r[2] != null)
      .map((r) => ({ lap: r[1], t: r[2]!, end: 0, duration: r[3], s1: r[4], s2: r[5], s3: r[6], pitOut: !!r[7] }))
      .sort((a, b) => a.t - b.t);
    list.forEach((l, i) => {
      l.end = l.duration != null ? l.t + l.duration * 1000 : i + 1 < list.length ? list[i + 1].t : l.t + 120_000;
    });
    laps.set(n, list);
  }

  const intervals = new Map<number, IntervalSample[]>();
  for (const [n, rows] of group(meta.intervals, (r) => r[0])) {
    intervals.set(
      n,
      rows.map((r) => ({ t: r[1], gap: r[2], gapText: r[3], interval: r[4], intervalText: r[5] })),
    );
  }

  const positions = new Map<number, Series>();
  for (const [n, rows] of group(meta.positions, (r) => r[0])) {
    positions.set(n, { t: rows.map((r) => r[1]), v: rows.map((r) => r[2]) });
  }

  const stints = new Map<number, Stint[]>();
  for (const [n, rows] of group(meta.stints, (r) => r[0])) {
    stints.set(
      n,
      rows.map((r) => ({ stint: r[1], lapStart: r[2], lapEnd: r[3], compound: r[4], ageAtStart: r[5] })),
    );
  }

  const pits = new Map<number, Pit[]>();
  for (const [n, rows] of group(meta.pits, (r) => r[0])) {
    pits.set(
      n,
      rows.map((r) => ({ t: r[1], lap: r[2], laneDuration: r[4] ?? r[3], stopDuration: r[5] })),
    );
  }

  const lapStartTimes: number[] = [];
  for (const r of meta.laps) {
    if (r[2] == null) continue;
    if (lapStartTimes[r[1]] == null || r[2] < lapStartTimes[r[1]]) lapStartTimes[r[1]] = r[2];
  }

  let bestLap: SessionData['bestLap'] = null;
  for (const [n, list] of laps) {
    for (const l of list) if (l.duration && (!bestLap || l.duration < bestLap.lap.duration!)) bestLap = { driver: n, lap: l };
  }

  // Final classification order, falling back to car number, as a stable default order.
  const resultOrder = meta.results.filter((r) => r.position != null).map((r) => r.driver);
  const driverOrder = [...resultOrder, ...meta.drivers.map((d) => d.number).filter((n) => !resultOrder.includes(n))];

  return {
    meta,
    drivers,
    driverOrder,
    samples,
    laps,
    intervals,
    positions,
    stints,
    pits,
    trackStatus: buildTrackStatus(meta),
    lapStartTimes,
    bestLap,
  };
}

/** Derive green / yellow / SC / VSC / red from race control messages (OpenF1 has no track-status feed). */
function buildTrackStatus(meta: PackMeta): TrackStatusSpan[] {
  const spans: TrackStatusSpan[] = [{ t: meta.start, status: 'PRE', yellowSectors: [] }];
  let status: TrackStatusKind = 'PRE';
  let neutralised = false; // SC / VSC / red in force: sector flags don't change the headline status
  const yellows = new Set<number>();
  const push = (t: number) => {
    const effective: TrackStatusKind = !neutralised && (status === 'GREEN' || status === 'YELLOW') ? (yellows.size ? 'YELLOW' : 'GREEN') : status;
    spans.push({ t, status: effective, yellowSectors: [...yellows].sort((a, b) => a - b) });
  };
  for (const [t, , category, flag, scope, sector, , message] of meta.raceControl) {
    const msg = (message ?? '').toUpperCase();
    const before = JSON.stringify([status, neutralised, [...yellows]]);
    if (category === 'SafetyCar') {
      if (msg.includes('VIRTUAL SAFETY CAR DEPLOYED') || msg.includes('VSC DEPLOYED')) [status, neutralised] = ['VSC', true];
      else if (msg.includes('VIRTUAL SAFETY CAR ENDING') || msg.includes('VSC ENDING')) [status, neutralised] = ['VSC_ENDING', true];
      else if (msg.includes('SAFETY CAR DEPLOYED')) [status, neutralised] = ['SC', true];
      else if (msg.includes('SAFETY CAR IN THIS LAP')) [status, neutralised] = ['SC_ENDING', true];
    } else if (category === 'SessionStatus' && msg.includes('STARTED')) {
      [status, neutralised] = ['GREEN', false];
    } else if (flag === 'RED') {
      [status, neutralised] = ['RED', true];
      yellows.clear();
    } else if (flag === 'CHEQUERED') {
      [status, neutralised] = ['CHEQUERED', true];
      yellows.clear();
    } else if ((flag === 'GREEN' || flag === 'CLEAR') && (scope === 'Track' || msg.includes('TRACK CLEAR'))) {
      if (status !== 'PRE' && status !== 'CHEQUERED') [status, neutralised] = ['GREEN', false];
      yellows.clear();
    } else if ((flag === 'YELLOW' || flag === 'DOUBLE YELLOW') && sector != null) {
      yellows.add(sector);
      if (status === 'PRE') continue;
    } else if (flag === 'CLEAR' && sector != null) {
      yellows.delete(sector);
    } else {
      continue;
    }
    if (status === 'PRE' && yellows.size === 0) continue;
    if (JSON.stringify([status, neutralised, [...yellows]]) !== before) push(t);
  }
  return spans;
}
