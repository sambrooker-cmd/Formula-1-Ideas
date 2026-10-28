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
import { LiveStore, TOPICS, type Topic } from '../shared/livestore.ts';

type Row = Record<string, any>;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

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
  if (!store.session) return null;
  return encodeSamples([...store.drivers.keys()].sort((a, b) => a - b).map((n) => ({ number: n, ...(store.samples.get(n) ?? { loc: { t: [], x: [], y: [], z: [] }, car: { t: [], speed: [], throttle: [], brake: [], rpm: [], gear: [], drs: [] } }) })));
}
