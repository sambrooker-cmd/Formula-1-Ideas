// Loads a replay pack and indexes it for fast "state at time T" lookups.
import type { PackDriver, PackMeta, SamplesHeader } from '../../../shared/pack';

/** Typed arrays for replays; plain (growable) arrays in live mode. */
export type Num = { readonly length: number; [i: number]: number };

export interface DriverSamples {
  locT: Num;
  locX: Num;
  locY: Num;
  carT: Num;
  speed: Num;
  throttle: Num;
  brake: Num;
  rpm: Num;
  gear: Num;
  /** 255 = no DRS data (e.g. 2026 onwards). */
  drs: Num;
  /** Cumulative distance in metres at each car sample, integrated from speed. */
  dist: Num;
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
  /** True while following a session in progress; data grows as deltas arrive. */
  live: boolean;
  /** Bumped on every live update so memoised views know to recompute. */
  version: number;
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

/** Snapshot of the session currently live (or simulated), converted to growable arrays. */
export async function loadLiveSnapshot(onProgress?: (loaded: number, total: number) => void): Promise<SessionData> {
  const metaRes = await fetch('/api/live/meta', { cache: 'no-store' });
  if (!metaRes.ok) throw new Error('No live session right now.');
  const meta = (await metaRes.json()) as PackMeta;
  const buf = await fetchWithProgress('/api/live/samples', onProgress);
  const data = index(meta, buf);
  data.live = true;
  for (const [n, s] of data.samples) data.samples.set(n, growable(s));
  return data;
}

function growable(s: DriverSamples): DriverSamples {
  const out = {} as Record<keyof DriverSamples, number[]>;
  for (const k of Object.keys(s) as (keyof DriverSamples)[]) out[k] = Array.from(s[k] as ArrayLike<number>);
  return out;
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
    const carT: Num = g(`car.${d.number}.t`);
    const speed: Num = g(`car.${d.number}.speed`);
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
    fixLapEnds(list);
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

  const data: SessionData = {
    meta,
    live: false,
    version: 0,
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
  if (meta.outline.length < 50) meta.outline = outlineFromLaps(data);
  return data;
}

function fixLapEnds(list: Lap[]) {
  list.forEach((l, i) => {
    l.end = l.duration != null ? l.t + l.duration * 1000 : i + 1 < list.length ? list[i + 1].t : l.t + 120_000;
  });
}

/** Trace the circuit from the fastest clean lap so far (live sessions have no precomputed outline). */
export function outlineFromLaps(data: SessionData): [number, number][] {
  const candidates: { n: number; l: Lap }[] = [];
  for (const [n, list] of data.laps) for (const l of list) if (l.duration && !l.pitOut && l.lap > 1) candidates.push({ n, l });
  candidates.sort((a, b) => a.l.duration! - b.l.duration!);
  for (const { n, l } of candidates.slice(0, 10)) {
    const s = data.samples.get(n);
    if (!s) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i < s.locT.length; i++) if (s.locT[i] >= l.t && s.locT[i] < l.end) pts.push([s.locX[i], s.locY[i]]);
    if (pts.length > 100) return pts;
  }
  return [];
}

// ---- live deltas -------------------------------------------------------------

type Tuple = any[];

const lastT = (a: Num) => (a.length ? a[a.length - 1] : -Infinity);

/** Apply a batch of live updates (same tuple shapes as the replay pack) in place. */
export function applyDelta(data: SessionData, topics: Record<string, any[]>) {
  const { meta } = data;
  for (const d of (topics.drivers ?? []) as PackMeta['drivers']) {
    if (!data.drivers.has(d.number)) {
      meta.drivers.push(d);
      data.driverOrder.push(d.number);
      data.samples.set(d.number, growable({ locT: [], locX: [], locY: [], carT: [], speed: [], throttle: [], brake: [], rpm: [], gear: [], drs: [], dist: [] }));
    }
    data.drivers.set(d.number, d);
  }
  for (const [n, t, x, y] of topics.location ?? []) {
    const s = data.samples.get(n) as unknown as Record<string, number[]> | undefined;
    if (!s || t <= lastT(s.locT)) continue;
    s.locT.push(t);
    s.locX.push(x);
    s.locY.push(y);
    meta.end = Math.max(meta.end, t);
  }
  for (const [n, t, speed, throttle, brake, rpm, gear, drs] of topics.car_data ?? []) {
    const s = data.samples.get(n) as unknown as Record<string, number[]> | undefined;
    if (!s || t <= lastT(s.carT)) continue;
    const i = s.carT.length;
    const dt = i ? (t - s.carT[i - 1]) / 1000 : 0;
    s.dist.push(i ? s.dist[i - 1] + (dt > 0 && dt < 5 ? ((speed + s.speed[i - 1]) / 2 / 3.6) * dt : 0) : 0);
    s.carT.push(t);
    s.speed.push(speed);
    s.throttle.push(throttle);
    s.brake.push(brake);
    s.rpm.push(rpm);
    s.gear.push(gear);
    s.drs.push(drs == null ? 255 : drs);
  }
  for (const r of (topics.laps ?? []) as PackMeta['laps']) {
    if (r[2] == null) continue;
    const list = data.laps.get(r[0]) ?? [];
    const lap: Lap = { lap: r[1], t: r[2], end: 0, duration: r[3], s1: r[4], s2: r[5], s3: r[6], pitOut: !!r[7] };
    const i = list.findIndex((l) => l.lap === lap.lap);
    if (i >= 0) list[i] = lap;
    else list.push(lap);
    list.sort((a, b) => a.t - b.t);
    fixLapEnds(list);
    data.laps.set(r[0], list);
    if (data.lapStartTimes[lap.lap] == null || lap.t < data.lapStartTimes[lap.lap]) data.lapStartTimes[lap.lap] = lap.t;
    meta.totalLaps = Math.max(meta.totalLaps, lap.lap);
    if (lap.duration && meta.outline.length < 50) meta.outline = outlineFromLaps(data);
  }
  for (const r of (topics.intervals ?? []) as PackMeta['intervals']) {
    const list = data.intervals.get(r[0]) ?? [];
    if (list.length && r[1] <= list[list.length - 1].t) continue;
    list.push({ t: r[1], gap: r[2], gapText: r[3], interval: r[4], intervalText: r[5] });
    data.intervals.set(r[0], list);
  }
  for (const [n, t, p] of (topics.positions ?? []) as PackMeta['positions']) {
    const ser = data.positions.get(n) ?? { t: [], v: [] };
    if (ser.t.length && t <= ser.t[ser.t.length - 1]) continue;
    ser.t.push(t);
    ser.v.push(p);
    data.positions.set(n, ser);
  }
  for (const r of (topics.stints ?? []) as PackMeta['stints']) {
    const list = data.stints.get(r[0]) ?? [];
    const st = { stint: r[1], lapStart: r[2], lapEnd: r[3], compound: r[4], ageAtStart: r[5] };
    const i = list.findIndex((x) => x.stint === st.stint);
    if (i >= 0) list[i] = st;
    else list.push(st);
    list.sort((a, b) => a.stint - b.stint);
    data.stints.set(r[0], list);
  }
  for (const r of (topics.pits ?? []) as PackMeta['pits']) {
    const list = data.pits.get(r[0]) ?? [];
    if (list.some((p) => p.t === r[1])) continue;
    list.push({ t: r[1], lap: r[2], laneDuration: r[4] ?? r[3], stopDuration: r[5] });
    data.pits.set(r[0], list);
  }
  const pushUnique = <T extends Tuple>(target: T[], rows: T[] | undefined, same: (a: T, b: T) => boolean) => {
    for (const r of rows ?? []) if (!target.some((x) => same(x, r))) target.push(r);
  };
  const before = meta.raceControl.length;
  pushUnique(meta.raceControl, topics.raceControl as PackMeta['raceControl'], (a, b) => a[0] === b[0] && a[7] === b[7]);
  if (meta.raceControl.length !== before) {
    meta.raceControl.sort((a, b) => a[0] - b[0]);
    data.trackStatus = buildTrackStatus(meta);
    const started = meta.raceControl.find((r) => r[2] === 'SessionStatus' && /STARTED/.test(r[7]));
    if (started) meta.raceStart = started[0];
  }
  pushUnique(meta.weather, topics.weather as PackMeta['weather'], (a, b) => a[0] === b[0]);
  pushUnique(meta.radio, topics.radio as PackMeta['radio'], (a, b) => a[1] === b[1] && a[0] === b[0]);
  pushUnique(meta.overtakes, topics.overtakes as PackMeta['overtakes'], (a, b) => a[0] === b[0] && a[1] === b[1]);
  data.version++;
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
