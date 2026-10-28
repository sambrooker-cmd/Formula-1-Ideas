// Live mode. One in-memory LiveStore holds the session in progress. It is fed by either:
//   - the OpenF1 sponsor-tier MQTT stream (real live sessions), or
//   - a simulator that replays a cached session through exactly the same path, with times
//     shifted so it looks like it's happening now (for testing and rehearsing the TV sync).
// Browsers fetch a snapshot (same format as a replay pack) and then receive deltas.
import mqtt from 'mqtt';
import type { WebSocket } from 'ws';
import { credentials } from './env.ts';
import { accessToken, get } from './openf1.ts';
import { openSessionDb } from './db.ts';
import { encodeSamples } from './pack.ts';
import { PACK_VERSION, type PackDriver, type PackMeta } from '../shared/pack.ts';

type Row = Record<string, any>;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const txt = (v: unknown) => (typeof v === 'string' ? v : null);

const TOPICS = [
  'sessions', 'drivers', 'location', 'car_data', 'laps', 'intervals', 'position',
  'stints', 'pit', 'race_control', 'weather', 'team_radio', 'overtakes',
] as const;
type Topic = (typeof TOPICS)[number];

interface Samples {
  loc: { t: number[]; x: number[]; y: number[] };
  car: { t: number[]; speed: number[]; throttle: number[]; brake: number[]; rpm: number[]; gear: number[]; drs: (number | null)[] };
}

/** Insert keeping `t` sorted; messages occasionally arrive slightly out of order. Returns false for duplicates. */
function sortedInsert(t: number[], value: number, cols: unknown[][], values: unknown[]) {
  let i = t.length;
  while (i > 0 && t[i - 1] > value) i--;
  if (i > 0 && t[i - 1] === value) return false;
  if (i === t.length) {
    t.push(value);
    cols.forEach((c, k) => c.push(values[k]));
  } else {
    t.splice(i, 0, value);
    cols.forEach((c, k) => c.splice(i, 0, values[k]));
  }
  return true;
}

class LiveStore {
  sessionKey: number | null = null;
  session: Row | null = null;
  meeting: Row | null = null;
  t0 = 0;
  drivers = new Map<number, PackDriver>();
  samples = new Map<number, Samples>();
  laps = new Map<string, PackMeta['laps'][number]>();
  intervals: PackMeta['intervals'] = [];
  positions: PackMeta['positions'] = [];
  stints = new Map<string, PackMeta['stints'][number]>();
  pits: PackMeta['pits'] = [];
  raceControl: PackMeta['raceControl'] = [];
  weather: PackMeta['weather'] = [];
  radio: PackMeta['radio'] = [];
  overtakes: PackMeta['overtakes'] = [];
  /** Deltas collected since the last flush to browsers. */
  pending: Record<string, unknown[]> = {};
  lastMessageAt = 0;
  /** Circuit outline, when the feed knows it (free live mode places cars along it). */
  outline: [number, number][] = [];
  /** True when car positions are estimated rather than measured. */
  positionsEstimated = false;

  reset(session: Row, meeting: Row | null) {
    Object.assign(this, new LiveStore());
    this.sessionKey = session.session_key;
    this.session = session;
    this.meeting = meeting;
    this.t0 = ms(session.date_start)! - 2 * 3600e3;
  }

  private rel(iso: string | null | undefined) {
    const t = ms(iso);
    return t == null ? null : t - this.t0;
  }

  private emit(topic: string, tuple: unknown) {
    (this.pending[topic] ??= []).push(tuple);
  }

  private driverSamples(n: number) {
    let s = this.samples.get(n);
    if (!s) {
      s = {
        loc: { t: [], x: [], y: [] },
        car: { t: [], speed: [], throttle: [], brake: [], rpm: [], gear: [], drs: [] },
      };
      this.samples.set(n, s);
    }
    return s;
  }

  apply(topic: Topic, r: Row) {
    this.lastMessageAt = Date.now();
    switch (topic) {
      case 'drivers': {
        const d: PackDriver = {
          number: r.driver_number,
          code: r.name_acronym ?? String(r.driver_number),
          name: r.full_name ?? '',
          team: r.team_name ?? '',
          colour: r.team_colour ? '#' + r.team_colour : '#888888',
        };
        this.drivers.set(d.number, d);
        this.driverSamples(d.number);
        return this.emit('drivers', d);
      }
      case 'location': {
        if (r.x === 0 && r.y === 0 && r.z === 0) return;
        const t = this.rel(r.date)!;
        const s = this.driverSamples(r.driver_number).loc;
        if (sortedInsert(s.t, t, [s.x, s.y], [r.x, r.y])) this.emit('location', [r.driver_number, t, r.x, r.y]);
        return;
      }
      case 'car_data': {
        const t = this.rel(r.date)!;
        const c = this.driverSamples(r.driver_number).car;
        const vals = [r.speed ?? 0, r.throttle ?? 0, r.brake ?? 0, r.rpm ?? 0, r.n_gear ?? 0, r.drs ?? null];
        if (sortedInsert(c.t, t, [c.speed, c.throttle, c.brake, c.rpm, c.gear, c.drs], vals)) {
          this.emit('car_data', [r.driver_number, t, ...vals]);
        }
        return;
      }
      case 'laps': {
        const tuple: PackMeta['laps'][number] = [
          r.driver_number, r.lap_number, this.rel(r.date_start), r.lap_duration ?? null,
          r.duration_sector_1 ?? null, r.duration_sector_2 ?? null, r.duration_sector_3 ?? null, r.is_pit_out_lap ? 1 : 0,
          r.segments_sector_1 ? [r.segments_sector_1, r.segments_sector_2 ?? [], r.segments_sector_3 ?? []] : null,
        ];
        this.laps.set(`${r.driver_number}:${r.lap_number}`, tuple); // later versions of a lap replace earlier ones
        return this.emit('laps', tuple);
      }
      case 'intervals': {
        const tuple: PackMeta['intervals'][number] = [
          r.driver_number, this.rel(r.date)!, num(r.gap_to_leader), txt(r.gap_to_leader), num(r.interval), txt(r.interval),
        ];
        this.intervals.push(tuple);
        return this.emit('intervals', tuple);
      }
      case 'position': {
        const tuple: PackMeta['positions'][number] = [r.driver_number, this.rel(r.date)!, r.position];
        this.positions.push(tuple);
        return this.emit('positions', tuple);
      }
      case 'stints': {
        const tuple: PackMeta['stints'][number] = [r.driver_number, r.stint_number, r.lap_start, r.lap_end ?? null, r.compound ?? null, r.tyre_age_at_start ?? null];
        this.stints.set(`${r.driver_number}:${r.stint_number}`, tuple);
        return this.emit('stints', tuple);
      }
      case 'pit': {
        const tuple: PackMeta['pits'][number] = [r.driver_number, this.rel(r.date)!, r.lap_number ?? null, r.pit_duration ?? null, r.lane_duration ?? null, r.stop_duration ?? null];
        this.pits.push(tuple);
        return this.emit('pits', tuple);
      }
      case 'race_control': {
        const tuple: PackMeta['raceControl'][number] = [
          this.rel(r.date)!, r.lap_number ?? null, r.category ?? null, r.flag ?? null, r.scope ?? null, r.sector ?? null, r.driver_number ?? null, r.message ?? '',
          r.qualifying_phase ?? null,
        ];
        this.raceControl.push(tuple);
        return this.emit('raceControl', tuple);
      }
      case 'weather': {
        const tuple: PackMeta['weather'][number] = [
          this.rel(r.date)!, r.air_temperature, r.track_temperature, r.humidity, r.pressure, r.rainfall, r.wind_speed, r.wind_direction,
        ];
        this.weather.push(tuple);
        return this.emit('weather', tuple);
      }
      case 'team_radio': {
        const tuple: PackMeta['radio'][number] = [r.driver_number, this.rel(r.date)!, r.recording_url];
        this.radio.push(tuple);
        return this.emit('radio', tuple);
      }
      case 'overtakes': {
        const tuple: PackMeta['overtakes'][number] = [this.rel(r.date)!, r.overtaking_driver_number, r.overtaken_driver_number, r.position];
        this.overtakes.push(tuple);
        return this.emit('overtakes', tuple);
      }
      case 'sessions':
        return;
    }
  }

  meta(): PackMeta & { live: true } {
    const s = this.session!;
    const byT = <T extends unknown[]>(a: T[], i: number) => [...a].sort((x, y) => (x[i] as number) - (y[i] as number));
    const rc = byT(this.raceControl, 0);
    const started = rc.find((r) => r[2] === 'SessionStatus' && /STARTED/.test(r[7]));
    const finished = [...rc].reverse().find((r) => /SESSION FINISHED/.test(r[7]) || r[3] === 'CHEQUERED');
    let start = Infinity;
    let end = -Infinity;
    for (const d of this.samples.values()) {
      if (d.loc.t.length) [start, end] = [Math.min(start, d.loc.t[0]), Math.max(end, d.loc.t.at(-1)!)];
    }
    const sessionStart = ms(s.date_start)! - this.t0;
    if (!Number.isFinite(start)) [start, end] = [sessionStart - 3600e3, sessionStart - 3600e3 + 1];
    const laps = [...this.laps.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      version: PACK_VERSION,
      live: true,
      session: {
        key: s.session_key,
        year: s.year,
        meetingName: this.meeting?.meeting_name ?? s.location,
        countryName: s.country_name,
        location: s.location,
        circuit: s.circuit_short_name,
        name: s.session_name,
        type: s.session_type,
      },
      t0: this.t0,
      start,
      end,
      raceStart: started ? started[0] : sessionStart,
      raceEnd: finished ? finished[0] : ms(s.date_end)! - this.t0,
      totalLaps: laps.reduce((m, l) => Math.max(m, l[1]), 0),
      drivers: [...this.drivers.values()].sort((a, b) => a.number - b.number),
      laps,
      intervals: byT(this.intervals, 1),
      positions: byT(this.positions, 1),
      stints: [...this.stints.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      pits: byT(this.pits, 1),
      raceControl: rc,
      weather: byT(this.weather, 0),
      radio: byT(this.radio, 1),
      overtakes: byT(this.overtakes, 0),
      results: [],
      grid: [],
      outline: this.outline,
      positionsEstimated: this.positionsEstimated,
    };
  }

  encodedSamples() {
    return encodeSamples(
      [...this.drivers.keys()].sort((a, b) => a - b).map((n) => ({ number: n, ...this.driverSamples(n) })),
    );
  }
}

// ---------------------------------------------------------------------------

export const store = new LiveStore();
const clients = new Set<WebSocket>();

export const status = {
  source: 'none' as 'none' | 'openf1' | 'f1' | 'simulation',
  /** Free live mode (F1's own timing feed) is running. */
  freeLive: false,
  configured: !!credentials,
  connected: false,
  error: null as string | null,
  simulating: null as null | { sessionKey: number; label: string },
};

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
}

function broadcast(msg: unknown) {
  const text = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(text);
}

// Push batched deltas 4× a second.
setInterval(() => {
  const topics = store.pending;
  if (Object.keys(topics).length === 0) return;
  store.pending = {};
  broadcast({ type: 'delta', key: store.sessionKey, topics });
}, 250);

export function announceSession() {
  store.pending = {};
  broadcast({ type: 'session', key: store.sessionKey });
}

export function liveState() {
  return {
    ...status,
    session: store.session
      ? {
          key: store.sessionKey,
          name: `${store.session.year} ${store.meeting?.meeting_name ?? store.session.location} · ${store.session.session_name}`,
          dateStart: store.session.date_start,
          dateEnd: store.session.date_end,
        }
      : null,
    lastMessageAt: store.lastMessageAt || null,
  };
}

// ---- real feed: OpenF1 MQTT ------------------------------------------------

let mqttClient: mqtt.MqttClient | null = null;
let switching: Promise<void> | null = null;
const buffered: [Topic, Row][] = [];

/** Load a session's identity and everything so far (via REST) into the store. Used when joining mid-session. */
async function switchToSession(sessionKey: number) {
  const [session] = await get('sessions', `session_key=${sessionKey}`);
  if (!session) throw new Error(`Unknown session ${sessionKey}`);
  const [meeting] = await get('meetings', `meeting_key=${session.meeting_key}`);
  store.reset(session, meeting ?? null);
  const sk = `session_key=${sessionKey}`;
  const backfill: [Topic, string][] = [
    ['drivers', 'drivers'], ['laps', 'laps'], ['intervals', 'intervals'], ['position', 'position'], ['stints', 'stints'],
    ['pit', 'pit'], ['race_control', 'race_control'], ['weather', 'weather'], ['team_radio', 'team_radio'], ['overtakes', 'overtakes'],
  ];
  for (const [topic, endpoint] of backfill) for (const r of await get(endpoint, sk)) store.apply(topic, r);
  for (const n of store.drivers.keys()) {
    for (const r of await get('location', `${sk}&driver_number=${n}`)) store.apply('location', r);
    for (const r of await get('car_data', `${sk}&driver_number=${n}`)) store.apply('car_data', r);
  }
  announceSession();
}

function onLiveMessage(topic: Topic, row: Row) {
  if (status.source === 'simulation') return; // a simulation has the store
  const key = row.session_key as number | undefined;
  if (key && key !== store.sessionKey && !switching) {
    switching = switchToSession(key)
      .catch((err) => void (status.error = (err as Error).message))
      .finally(() => {
        switching = null;
        for (const [t, r] of buffered.splice(0)) if (r.session_key === store.sessionKey) store.apply(t, r);
      });
  }
  if (switching) buffered.push([topic, row]);
  else if (key === store.sessionKey) store.apply(topic, row);
}

export async function startLiveFeed() {
  if (!credentials) return;
  try {
    const token = await accessToken();
    mqttClient = mqtt.connect('mqtts://mqtt.openf1.org:8883', {
      username: credentials.username,
      password: token!,
      reconnectPeriod: 5000,
      connectTimeout: 20_000,
    });
    mqttClient.on('connect', () => {
      status.connected = true;
      status.error = null;
      if (status.source !== 'simulation') status.source = 'openf1';
      mqttClient!.subscribe(TOPICS.map((t) => 'v1/' + t));
    });
    mqttClient.on('close', () => (status.connected = false));
    mqttClient.on('error', (err) => (status.error = `OpenF1 live feed: ${err.message}`));
    mqttClient.on('message', (topic, payload) => {
      try {
        onLiveMessage(topic.replace(/^v1\//, '') as Topic, JSON.parse(payload.toString()));
      } catch {
        // ignore malformed payloads
      }
    });
    // Tokens last an hour: refresh well before, so reconnects use a valid one.
    setInterval(async () => {
      try {
        const fresh = await accessToken();
        if (mqttClient && fresh) mqttClient.options.password = fresh;
      } catch (err) {
        status.error = (err as Error).message;
      }
    }, 10 * 60_000);

    // If a session is already running, join it now rather than waiting for its next message.
    const [latest] = await get('sessions', 'session_key=latest');
    if (latest) {
      const now = Date.now();
      if (now > ms(latest.date_start)! - 3600e3 && now < ms(latest.date_end)! + 3600e3) await switchToSession(latest.session_key);
    }
  } catch (err) {
    status.error = (err as Error).message;
  }
}

// ---- simulated feed: replay a cached session as if it were live -----------

let simTimer: NodeJS.Timeout | null = null;

export function stopSimulation() {
  if (simTimer) clearInterval(simTimer);
  const wasSimulating = status.source === 'simulation';
  simTimer = null;
  status.simulating = null;
  status.source = mqttClient ? 'openf1' : status.freeLive ? 'f1' : 'none';
  if (wasSimulating) {
    // Drop the simulated session; a real one (if any) is picked up on its next message.
    Object.assign(store, new LiveStore());
    announceSession();
  }
}

/**
 * Feed a cached session through the live path. Everything before `fromLap` is loaded
 * instantly; after that rows are released in real time (× speed), with dates shifted
 * so the session appears to be happening right now.
 */
export function startSimulation(sessionKey: number, fromLap = 1, speed = 1) {
  const db = openSessionDb(sessionKey);
  if (!db) throw new Error(`Session ${sessionKey} isn't cached`);
  stopSimulation();
  // Index by time so the per-tick range queries stay cheap.
  db.exec('CREATE INDEX IF NOT EXISTS location_t ON location (t); CREATE INDEX IF NOT EXISTS car_data_t ON car_data (t);');
  const s = db.prepare('SELECT * FROM session').get() as Row;
  const raw = JSON.parse(s.raw_json) as { session: Row; meeting: Row };
  const lapStart = (db.prepare('SELECT MIN(t_start) t FROM lap WHERE lap = ?').get(fromLap) as Row).t ?? s.race_start;
  const simFrom = (fromLap <= 1 ? s.race_start - 120_000 : lapStart - 10_000) as number;
  const wallStart = Date.now();
  const shift = wallStart - simFrom;
  const iso = (t: number | null) => (t == null ? null : new Date(t + shift).toISOString());

  store.reset(
    { ...raw.session, date_start: iso(s.date_start), date_end: iso(s.date_end) },
    raw.meeting,
  );
  status.source = 'simulation';
  status.simulating = { sessionKey, label: `${s.year} ${s.meeting_name} · ${s.session_name}` };

  const q = {
    drivers: db.prepare('SELECT * FROM driver'),
    location: db.prepare('SELECT * FROM location WHERE t >= ? AND t < ? ORDER BY t'),
    car: db.prepare('SELECT * FROM car_data WHERE t >= ? AND t < ? ORDER BY t'),
    lapStarts: db.prepare('SELECT * FROM lap WHERE t_start >= ? AND t_start < ?'),
    lapEnds: db.prepare('SELECT * FROM lap WHERE duration IS NOT NULL AND t_start + duration * 1000 >= ? AND t_start + duration * 1000 < ?'),
    intervals: db.prepare('SELECT * FROM interval_sample WHERE t >= ? AND t < ? ORDER BY t'),
    position: db.prepare('SELECT * FROM position WHERE t >= ? AND t < ? ORDER BY t'),
    pit: db.prepare('SELECT * FROM pit WHERE t >= ? AND t < ?'),
    rc: db.prepare('SELECT * FROM race_control WHERE t >= ? AND t < ? ORDER BY t'),
    weather: db.prepare('SELECT * FROM weather WHERE t >= ? AND t < ?'),
    radio: db.prepare('SELECT * FROM team_radio WHERE t >= ? AND t < ?'),
    overtakes: db.prepare('SELECT * FROM overtake WHERE t >= ? AND t < ?'),
    stints: db.prepare('SELECT * FROM stint'),
  };
  const firstLapT = new Map<string, number>();
  for (const l of db.prepare('SELECT driver_number, lap, t_start FROM lap').all() as Row[]) firstLapT.set(`${l.driver_number}:${l.lap}`, l.t_start);
  const stints = q.stints.all() as Row[];
  const releasedStints = new Set<Row>();

  const lapRow = (l: Row, complete: boolean) => ({
    driver_number: l.driver_number, lap_number: l.lap, date_start: iso(l.t_start), lap_duration: complete ? l.duration : null,
    duration_sector_1: complete ? l.s1 : null, duration_sector_2: complete ? l.s2 : null, duration_sector_3: complete ? l.s3 : null,
    is_pit_out_lap: !!l.pit_out,
  });

  const release = (from: number, to: number) => {
    for (const r of q.location.all(from, to) as Row[]) store.apply('location', { ...r, date: iso(r.t) });
    for (const r of q.car.all(from, to) as Row[]) store.apply('car_data', { ...r, n_gear: r.gear, date: iso(r.t) });
    for (const l of q.lapStarts.all(from, to) as Row[]) store.apply('laps', lapRow(l, false));
    for (const l of q.lapEnds.all(from, to) as Row[]) store.apply('laps', lapRow(l, true));
    for (const r of q.intervals.all(from, to) as Row[]) {
      store.apply('intervals', { driver_number: r.driver_number, date: iso(r.t), gap_to_leader: r.gap ?? r.gap_text, interval: r.interval ?? r.interval_text });
    }
    for (const r of q.position.all(from, to) as Row[]) store.apply('position', { ...r, date: iso(r.t) });
    for (const r of q.pit.all(from, to) as Row[]) store.apply('pit', { ...r, lap_number: r.lap, date: iso(r.t) });
    for (const r of q.rc.all(from, to) as Row[]) store.apply('race_control', { ...r, lap_number: r.lap, date: iso(r.t) });
    for (const r of q.weather.all(from, to) as Row[]) {
      store.apply('weather', {
        date: iso(r.t), air_temperature: r.air, track_temperature: r.track, humidity: r.humidity, pressure: r.pressure,
        rainfall: r.rainfall, wind_speed: r.wind_speed, wind_direction: r.wind_dir,
      });
    }
    for (const r of q.radio.all(from, to) as Row[]) store.apply('team_radio', { ...r, recording_url: r.url, date: iso(r.t) });
    for (const r of q.overtakes.all(from, to) as Row[]) {
      store.apply('overtakes', { date: iso(r.t), overtaking_driver_number: r.overtaker, overtaken_driver_number: r.overtaken, position: r.position });
    }
    // A stint becomes known when the driver starts its first lap.
    for (const st of stints) {
      if (releasedStints.has(st)) continue;
      const begins = firstLapT.get(`${st.driver_number}:${st.lap_start}`) ?? -Infinity;
      if (begins < to) {
        releasedStints.add(st);
        store.apply('stints', { ...st, stint_number: st.stint });
      }
    }
  };

  for (const d of q.drivers.all() as Row[]) {
    store.apply('drivers', {
      driver_number: d.driver_number, name_acronym: d.code, full_name: d.full_name, team_name: d.team_name,
      team_colour: String(d.team_colour ?? '').replace('#', ''),
    });
  }
  release(-1e15, simFrom);
  announceSession();

  let cursor = simFrom;
  simTimer = setInterval(() => {
    const target = simFrom + (Date.now() - wallStart) * speed;
    if (target <= cursor) return;
    release(cursor, target);
    cursor = target;
    if (cursor > s.date_end + 3600e3) stopSimulation();
  }, 200);
}

export function liveMeta() {
  return store.session ? store.meta() : null;
}
export function liveSamples() {
  return store.session ? store.encodedSamples() : null;
}
