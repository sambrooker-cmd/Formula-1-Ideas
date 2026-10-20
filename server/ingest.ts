import { get, TooMuchDataError } from './openf1.ts';
import { openSessionDb, type SessionDb } from './db.ts';
import { buildPack } from './pack.ts';

type Row = Record<string, any>;

export interface Progress {
  done: number;
  total: number;
  step: string;
  message?: string;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
const iso = (t: number) => new Date(t).toISOString();
const norm = (s: unknown) => String(s ?? '').toLowerCase();

/** Find an OpenF1 session from human input: --year 2025 --race "Abu Dhabi" --session Race, or a session key. */
export async function resolveSession(opts: { sessionKey?: number; year?: number; race?: string; session?: string }) {
  if (opts.sessionKey) {
    const [s] = await get('sessions', `session_key=${opts.sessionKey}`);
    if (!s) throw new Error(`No OpenF1 session with key ${opts.sessionKey}`);
    return s;
  }
  if (!opts.year || !opts.race) throw new Error('Give either --session-key, or --year and --race');
  const meetings = await get('meetings', `year=${opts.year}`);
  const q = norm(opts.race);
  const hits = meetings.filter((m) =>
    [m.meeting_name, m.location, m.country_name, m.circuit_short_name].some((f) => norm(f).includes(q)),
  );
  if (hits.length === 0) {
    const names = meetings.map((m) => m.meeting_name).join(', ');
    throw new Error(`No ${opts.year} meeting matches "${opts.race}". Options: ${names}`);
  }
  const meeting = hits.find((m) => norm(m.meeting_name).includes(q)) ?? hits[0];
  const sessions = await get('sessions', `meeting_key=${meeting.meeting_key}`);
  const wanted = norm(opts.session ?? 'Race');
  const session =
    sessions.find((s) => norm(s.session_name) === wanted) ?? sessions.find((s) => norm(s.session_name).includes(wanted));
  if (!session) {
    throw new Error(
      `${meeting.meeting_name} has no "${opts.session}" session. Options: ${sessions.map((s) => s.session_name).join(', ')}`,
    );
  }
  return session;
}

/**
 * Download everything for one session into cache/session-<key>.sqlite.
 * Each completed request is recorded in ingest_manifest, so re-running after an
 * interruption picks up where it stopped and a finished session is never fetched again.
 */
export async function ingestSession(sessionKey: number, onProgress: (p: Progress) => void = () => {}) {
  const db = openSessionDb(sessionKey, { create: true })!;
  try {
    if (isDone(db, 'complete')) {
      onProgress({ done: 1, total: 1, step: 'complete', message: 'Already cached' });
      return;
    }
    const [session] = await get('sessions', `session_key=${sessionKey}`);
    if (!session) throw new Error(`No OpenF1 session with key ${sessionKey}`);
    const [meeting] = await get('meetings', `meeting_key=${session.meeting_key}`);
    saveSession(db, session, meeting ?? {});

    const sk = `session_key=${sessionKey}`;
    const steps: [string, () => Promise<number>][] = [
      ['drivers', async () => storeDrivers(db, await get('drivers', sk))],
      ['laps', async () => storeLaps(db, await get('laps', sk))],
      ['intervals', async () => storeIntervals(db, await get('intervals', sk))],
      ['position', async () => storeSimple(db, 'position', await get('position', sk), (r) => [r.driver_number, ms(r.date), r.position])],
      ['stints', async () => storeSimple(db, 'stint', await get('stints', sk), (r) => [r.driver_number, r.stint_number, r.lap_start, r.lap_end, r.compound, r.tyre_age_at_start])],
      ['pit', async () => storeSimple(db, 'pit', await get('pit', sk), (r) => [r.driver_number, ms(r.date), r.lap_number, r.pit_duration, r.lane_duration ?? null, r.stop_duration ?? null])],
      ['race_control', async () => storeSimple(db, 'race_control', await get('race_control', sk), (r) => [ms(r.date), r.lap_number, r.category, r.flag, r.scope, r.sector, r.driver_number, r.message])],
      ['weather', async () => storeSimple(db, 'weather', await get('weather', sk), (r) => [ms(r.date), r.air_temperature, r.track_temperature, r.humidity, r.pressure, r.rainfall, r.wind_speed, r.wind_direction])],
      ['team_radio', async () => storeSimple(db, 'team_radio', await get('team_radio', sk), (r) => [r.driver_number, ms(r.date), r.recording_url])],
      ['overtakes', async () => storeSimple(db, 'overtake', await get('overtakes', sk), (r) => [ms(r.date), r.overtaking_driver_number, r.overtaken_driver_number, r.position])],
      ['session_result', async () => storeResults(db, await get('session_result', sk))],
      ['starting_grid', async () => storeGrid(db, session)],
    ];

    // Drivers are needed before we know which per-driver requests to make.
    const total = () => steps.length + 2 * driverNumbers(db).length + 1;
    let done = 0;
    const run = async (key: string, fn: () => Promise<number>) => {
      if (!isDone(db, key)) {
        onProgress({ done, total: total(), step: key, message: 'downloading' });
        const rows = await fn();
        db.prepare('INSERT OR REPLACE INTO ingest_manifest VALUES (?, ?, ?)').run(key, rows, new Date().toISOString());
      }
      done++;
      onProgress({ done, total: total(), step: key });
    };

    for (const [key, fn] of steps) await run(key, fn);

    const window = { from: ms(session.date_start)! - 2 * 3600e3, to: ms(session.date_end)! + 2 * 3600e3 };
    for (const n of driverNumbers(db)) {
      await run(`location:${n}`, async () => storeLocation(db, n, await fetchSamples('location', sessionKey, n, window)));
      await run(`car_data:${n}`, async () => storeCarData(db, n, await fetchSamples('car_data', sessionKey, n, window)));
    }

    onProgress({ done, total: total(), step: 'finalise', message: 'Building track outline and replay pack' });
    finalise(db);
    db.prepare(`INSERT OR REPLACE INTO ingest_manifest VALUES ('complete', 0, ?)`).run(new Date().toISOString());
    const finalTotal = total();
    db.close();
    buildPack(sessionKey);
    onProgress({ done: finalTotal, total: finalTotal, step: 'complete' });
  } finally {
    if (db.open) db.close();
  }
}

const isDone = (db: SessionDb, key: string) => !!db.prepare('SELECT 1 FROM ingest_manifest WHERE request = ?').get(key);
const driverNumbers = (db: SessionDb) =>
  (db.prepare('SELECT driver_number FROM driver ORDER BY driver_number').all() as Row[]).map((r) => r.driver_number as number);

/** Fetch high-rate samples for one driver; if OpenF1 says it's too much at once, split the time range in half. */
async function fetchSamples(endpoint: string, sessionKey: number, driver: number, range: { from: number; to: number }) {
  const base = `session_key=${sessionKey}&driver_number=${driver}`;
  try {
    return await get(endpoint, base);
  } catch (err) {
    if (!(err instanceof TooMuchDataError)) throw err;
  }
  const chunk = async (from: number, to: number, depth: number): Promise<Row[]> => {
    try {
      return await get(endpoint, `${base}&date>=${iso(from)}&date<${iso(to)}`);
    } catch (err) {
      if (!(err instanceof TooMuchDataError) || depth > 6) throw err;
      const mid = Math.floor((from + to) / 2);
      return [...(await chunk(from, mid, depth + 1)), ...(await chunk(mid, to, depth + 1))];
    }
  };
  return chunk(range.from, range.to, 0);
}

function saveSession(db: SessionDb, s: Row, m: Row) {
  db.prepare(
    `INSERT OR REPLACE INTO session (session_key, meeting_key, year, meeting_name, country_name, location, session_name,
       session_type, circuit_key, circuit_short_name, date_start, date_end, race_start, race_end, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    s.session_key, s.meeting_key, s.year, m.meeting_name ?? s.location, s.country_name, s.location, s.session_name,
    s.session_type, s.circuit_key, s.circuit_short_name, ms(s.date_start), ms(s.date_end), JSON.stringify({ session: s, meeting: m }),
  );
}

function storeSimple(db: SessionDb, table: string, rows: Row[], map: (r: Row) => unknown[]) {
  if (rows.length === 0) return 0;
  const width = map(rows[0]).length;
  const stmt = db.prepare(`INSERT INTO ${table} VALUES (${Array(width).fill('?').join(',')})`);
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    for (const r of rows) stmt.run(...map(r));
  })();
  return rows.length;
}

function storeDrivers(db: SessionDb, rows: Row[]) {
  const stmt = db.prepare('INSERT OR REPLACE INTO driver VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of rows) {
      stmt.run(r.driver_number, r.name_acronym, r.full_name, r.team_name, r.team_colour ? '#' + r.team_colour : '#888888');
    }
  })();
  return rows.length;
}

function storeLaps(db: SessionDb, rows: Row[]) {
  const stmt = db.prepare('INSERT OR REPLACE INTO lap VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.driver_number, r.lap_number, ms(r.date_start), r.lap_duration, r.duration_sector_1, r.duration_sector_2,
        r.duration_sector_3, r.i1_speed, r.i2_speed, r.st_speed, r.is_pit_out_lap ? 1 : 0,
      );
    }
  })();
  return rows.length;
}

// gap_to_leader / interval are a float, a string like "+1 LAP", or null.
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const txt = (v: unknown) => (typeof v === 'string' ? v : null);

function storeIntervals(db: SessionDb, rows: Row[]) {
  return storeSimple(db, 'interval_sample', rows, (r) => [
    r.driver_number, ms(r.date), num(r.gap_to_leader), txt(r.gap_to_leader), num(r.interval), txt(r.interval),
  ]);
}

function storeResults(db: SessionDb, rows: Row[]) {
  return storeSimple(db, 'result', rows, (r) => [
    r.driver_number,
    r.position,
    r.number_of_laps,
    r.points ?? null,
    r.dsq ? 'DSQ' : r.dns ? 'DNS' : r.dnf ? 'DNF' : 'FINISHED',
    r.gap_to_leader == null ? null : JSON.stringify(r.gap_to_leader),
    num(r.duration),
  ]);
}

/** The starting grid lives on the qualifying session of the same meeting. */
async function storeGrid(db: SessionDb, session: Row) {
  const name = norm(session.session_name);
  if (name !== 'race' && name !== 'sprint') return 0;
  const sessions = await get('sessions', `meeting_key=${session.meeting_key}`);
  const quali = sessions.find((s) =>
    name === 'race' ? norm(s.session_name) === 'qualifying' : ['sprint qualifying', 'sprint shootout'].includes(norm(s.session_name)),
  );
  if (!quali) return 0;
  const rows = await get('starting_grid', `session_key=${quali.session_key}`);
  return storeSimple(db, 'grid', rows, (r) => [r.driver_number, r.position, r.lap_duration]);
}

function storeLocation(db: SessionDb, driver: number, rows: Row[]) {
  const stmt = db.prepare('INSERT OR REPLACE INTO location VALUES (?, ?, ?, ?, ?)');
  let kept = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM location WHERE driver_number = ?').run(driver);
    for (const r of rows) {
      if (r.x === 0 && r.y === 0 && r.z === 0) continue; // car not running / no fix
      stmt.run(driver, ms(r.date), r.x, r.y, r.z);
      kept++;
    }
  })();
  return kept;
}

function storeCarData(db: SessionDb, driver: number, rows: Row[]) {
  const stmt = db.prepare('INSERT OR REPLACE INTO car_data VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM car_data WHERE driver_number = ?').run(driver);
    for (const r of rows) stmt.run(driver, ms(r.date), r.speed, r.throttle, r.brake, r.rpm, r.n_gear, r.drs ?? null);
  })();
  return rows.length;
}

/** Work out when the session really ran, and trace the circuit from one clean fast lap. */
function finalise(db: SessionDb) {
  const s = db.prepare('SELECT * FROM session').get() as Row;
  const started = db
    .prepare(`SELECT MIN(t) t FROM race_control WHERE category = 'SessionStatus' AND message LIKE '%STARTED%'`)
    .get() as Row;
  const firstLap = db.prepare('SELECT MIN(t_start) t FROM lap WHERE lap = 1').get() as Row;
  const finished = db
    .prepare(`SELECT MAX(t) t FROM race_control WHERE message LIKE '%SESSION FINISHED%' OR flag = 'CHEQUERED'`)
    .get() as Row;
  const raceStart = started.t ?? firstLap.t ?? s.date_start;
  const raceEnd = finished.t ?? s.date_end;
  db.prepare('UPDATE session SET race_start = ?, race_end = ?').run(raceStart, raceEnd);

  const candidates = db
    .prepare(
      `SELECT driver_number, t_start, duration FROM lap
       WHERE duration IS NOT NULL AND pit_out = 0 AND lap > 1 AND t_start IS NOT NULL
       ORDER BY duration LIMIT 10`,
    )
    .all() as Row[];
  for (const lap of candidates) {
    const pts = db
      .prepare('SELECT x, y FROM location WHERE driver_number = ? AND t >= ? AND t < ? ORDER BY t')
      .all(lap.driver_number, lap.t_start, lap.t_start + lap.duration * 1000) as Row[];
    if (pts.length < 100) continue;
    const ins = db.prepare('INSERT INTO track_outline VALUES (?, ?, ?)');
    db.transaction(() => {
      db.prepare('DELETE FROM track_outline').run();
      pts.forEach((p, i) => ins.run(i, p.x, p.y));
    })();
    return;
  }
}
