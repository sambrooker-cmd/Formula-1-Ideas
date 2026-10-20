import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const CACHE_DIR = path.resolve(process.env.PITWALL_CACHE ?? 'cache');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session (
  session_key INT PRIMARY KEY, meeting_key INT, year INT, meeting_name TEXT, country_name TEXT,
  location TEXT, session_name TEXT, session_type TEXT, circuit_key INT, circuit_short_name TEXT,
  date_start INT, date_end INT, race_start INT, race_end INT, raw_json TEXT
);
CREATE TABLE IF NOT EXISTS ingest_manifest (request TEXT PRIMARY KEY, rows INT, fetched_at TEXT);
CREATE TABLE IF NOT EXISTS driver (
  driver_number INT PRIMARY KEY, code TEXT, full_name TEXT, team_name TEXT, team_colour TEXT
);
CREATE TABLE IF NOT EXISTS location (
  driver_number INT, t INT, x INT, y INT, z INT, PRIMARY KEY (driver_number, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS car_data (
  driver_number INT, t INT, speed INT, throttle INT, brake INT, rpm INT, gear INT, drs INT,
  PRIMARY KEY (driver_number, t)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lap (
  driver_number INT, lap INT, t_start INT, duration REAL, s1 REAL, s2 REAL, s3 REAL,
  i1_speed INT, i2_speed INT, st_speed INT, pit_out INT, PRIMARY KEY (driver_number, lap)
);
CREATE TABLE IF NOT EXISTS interval_sample (driver_number INT, t INT, gap REAL, gap_text TEXT, interval REAL, interval_text TEXT);
CREATE TABLE IF NOT EXISTS position (driver_number INT, t INT, position INT);
CREATE TABLE IF NOT EXISTS stint (driver_number INT, stint INT, lap_start INT, lap_end INT, compound TEXT, tyre_age_at_start INT);
CREATE TABLE IF NOT EXISTS pit (driver_number INT, t INT, lap INT, pit_duration REAL, lane_duration REAL, stop_duration REAL);
CREATE TABLE IF NOT EXISTS race_control (t INT, lap INT, category TEXT, flag TEXT, scope TEXT, sector INT, driver_number INT, message TEXT);
CREATE TABLE IF NOT EXISTS weather (t INT, air REAL, track REAL, humidity REAL, pressure REAL, rainfall REAL, wind_speed REAL, wind_dir INT);
CREATE TABLE IF NOT EXISTS team_radio (driver_number INT, t INT, url TEXT);
CREATE TABLE IF NOT EXISTS overtake (t INT, overtaker INT, overtaken INT, position INT);
CREATE TABLE IF NOT EXISTS result (driver_number INT PRIMARY KEY, position INT, laps INT, points REAL, status TEXT, gap TEXT, duration REAL);
CREATE TABLE IF NOT EXISTS grid (driver_number INT PRIMARY KEY, position INT, quali_lap REAL);
CREATE TABLE IF NOT EXISTS track_outline (seq INT PRIMARY KEY, x REAL, y REAL);
CREATE INDEX IF NOT EXISTS interval_by_driver ON interval_sample (driver_number, t);
`;

export function sessionDbPath(sessionKey: number) {
  return path.join(CACHE_DIR, `session-${sessionKey}.sqlite`);
}

export function openSessionDb(sessionKey: number, { create = false } = {}) {
  const file = sessionDbPath(sessionKey);
  if (!create && !fs.existsSync(file)) return null;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export type SessionDb = Database.Database;

export interface CachedSessionSummary {
  session_key: number;
  year: number;
  meeting_name: string;
  country_name: string;
  location: string;
  session_name: string;
  circuit_short_name: string;
  date_start: number;
  complete: boolean;
  size_mb: number;
}

/** Every session that has a cache file, newest first. */
export function listCachedSessions(): CachedSessionSummary[] {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const out: CachedSessionSummary[] = [];
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = /^session-(\d+)\.sqlite$/.exec(f);
    if (!m) continue;
    const db = new Database(path.join(CACHE_DIR, f), { readonly: true, fileMustExist: true });
    try {
      const s = db.prepare('SELECT * FROM session').get() as CachedSessionSummary | undefined;
      if (!s) continue;
      const done = db.prepare(`SELECT 1 FROM ingest_manifest WHERE request = 'complete'`).get();
      out.push({ ...pick(s), complete: !!done, size_mb: +(fs.statSync(path.join(CACHE_DIR, f)).size / 1e6).toFixed(1) });
    } catch {
      // half-created file with no tables yet
    } finally {
      db.close();
    }
  }
  return out.sort((a, b) => b.date_start - a.date_start);
}

function pick(s: CachedSessionSummary) {
  const { session_key, year, meeting_name, country_name, location, session_name, circuit_short_name, date_start } = s;
  return { session_key, year, meeting_name, country_name, location, session_name, circuit_short_name, date_start };
}
