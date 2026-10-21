import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHE_DIR, openSessionDb } from './db.ts';
import { PACK_VERSION, type PackMeta, type SamplesHeader } from '../shared/pack.ts';

type Row = Record<string, any>;

export function packPaths(sessionKey: number) {
  const base = path.join(CACHE_DIR, `session-${sessionKey}.v${PACK_VERSION}`);
  return { meta: base + '.meta.json.gz', samples: base + '.samples.bin.gz' };
}

/** Build (or reuse) the gzipped replay pack for a cached session. Returns null if not cached. */
export function ensurePack(sessionKey: number) {
  const p = packPaths(sessionKey);
  if (fs.existsSync(p.meta) && fs.existsSync(p.samples)) return p;
  return buildPack(sessionKey) ? p : null;
}

export function buildPack(sessionKey: number) {
  const db = openSessionDb(sessionKey);
  if (!db) return false;
  try {
    const done = db.prepare(`SELECT 1 FROM ingest_manifest WHERE request = 'complete'`).get();
    if (!done) return false;
    const s = db.prepare('SELECT * FROM session').get() as Row;
    const t0 = s.date_start - 2 * 3600e3;
    const rel = (t: number | null) => (t == null ? null : t - t0);
    const all = (sql: string) => db.prepare(sql).raw().all() as any[][];

    const drivers = (db.prepare('SELECT * FROM driver ORDER BY driver_number').all() as Row[]).map((d) => ({
      number: d.driver_number,
      code: d.code ?? String(d.driver_number),
      name: d.full_name ?? '',
      team: d.team_name ?? '',
      colour: d.team_colour ?? '#888888',
    }));

    const bounds = db
      .prepare('SELECT MIN(t) a, MAX(t) b FROM (SELECT t FROM location UNION ALL SELECT t FROM car_data UNION ALL SELECT t FROM position)')
      .get() as Row;

    const meta: PackMeta = {
      version: PACK_VERSION,
      session: {
        key: s.session_key,
        year: s.year,
        meetingName: s.meeting_name,
        countryName: s.country_name,
        location: s.location,
        circuit: s.circuit_short_name,
        name: s.session_name,
        type: s.session_type,
      },
      t0,
      start: rel(bounds.a ?? s.date_start)!,
      end: rel(bounds.b ?? s.date_end)!,
      raceStart: rel(s.race_start)!,
      raceEnd: rel(s.race_end)!,
      totalLaps: (db.prepare('SELECT MAX(lap) n FROM lap').get() as Row).n ?? 0,
      drivers,
      laps: all('SELECT driver_number, lap, t_start, duration, s1, s2, s3, pit_out, segments FROM lap ORDER BY driver_number, lap').map(
        (r) => [r[0], r[1], rel(r[2]), r[3], r[4], r[5], r[6], r[7], r[8] ? JSON.parse(r[8]) : null],
      ) as PackMeta['laps'],
      intervals: all('SELECT driver_number, t, gap, gap_text, interval, interval_text FROM interval_sample ORDER BY t').map(
        (r) => [r[0], rel(r[1]), r[2], r[3], r[4], r[5]],
      ) as PackMeta['intervals'],
      positions: all('SELECT driver_number, t, position FROM position ORDER BY t').map((r) => [r[0], rel(r[1]), r[2]]) as PackMeta['positions'],
      stints: all('SELECT driver_number, stint, lap_start, lap_end, compound, tyre_age_at_start FROM stint ORDER BY driver_number, stint') as PackMeta['stints'],
      pits: all('SELECT driver_number, t, lap, pit_duration, lane_duration, stop_duration FROM pit ORDER BY t').map(
        (r) => [r[0], rel(r[1]), r[2], r[3], r[4], r[5]],
      ) as PackMeta['pits'],
      raceControl: all('SELECT t, lap, category, flag, scope, sector, driver_number, message, qualifying_phase FROM race_control ORDER BY t').map(
        (r) => [rel(r[0]), ...r.slice(1)],
      ) as PackMeta['raceControl'],
      weather: all('SELECT * FROM weather ORDER BY t').map((r) => [rel(r[0]), ...r.slice(1)]) as PackMeta['weather'],
      radio: all('SELECT driver_number, t, url FROM team_radio ORDER BY t').map((r) => [r[0], rel(r[1]), r[2]]) as PackMeta['radio'],
      overtakes: all('SELECT * FROM overtake ORDER BY t').map((r) => [rel(r[0]), r[1], r[2], r[3]]) as PackMeta['overtakes'],
      results: (db.prepare('SELECT * FROM result ORDER BY position IS NULL, position').all() as Row[]).map((r) => ({
        driver: r.driver_number,
        position: r.position,
        laps: r.laps,
        points: r.points,
        status: r.status,
        gap: r.gap,
      })),
      grid: all('SELECT driver_number, position FROM grid ORDER BY position') as PackMeta['grid'],
      outline: all('SELECT x, y FROM track_outline ORDER BY seq') as PackMeta['outline'],
    };

    const samples = encodeSamples(
      drivers.map((d) => {
        const loc = db.prepare('SELECT t, x, y FROM location WHERE driver_number = ? ORDER BY t').raw().all(d.number) as number[][];
        const car = db
          .prepare('SELECT t, speed, throttle, brake, rpm, gear, drs FROM car_data WHERE driver_number = ? ORDER BY t')
          .raw()
          .all(d.number) as (number | null)[][];
        return {
          number: d.number,
          loc: { t: loc.map((r) => r[0] - t0), x: loc.map((r) => r[1]), y: loc.map((r) => r[2]) },
          car: {
            t: car.map((r) => r[0]! - t0),
            speed: car.map((r) => r[1]),
            throttle: car.map((r) => r[2]),
            brake: car.map((r) => r[3]),
            rpm: car.map((r) => r[4]),
            gear: car.map((r) => r[5]),
            drs: car.map((r) => r[6]),
          },
        };
      }),
    );

    const p = packPaths(sessionKey);
    fs.writeFileSync(p.meta, zlib.gzipSync(JSON.stringify(meta), { level: 6 }));
    fs.writeFileSync(p.samples, zlib.gzipSync(samples, { level: 6 }));
    return true;
  } finally {
    db.close();
  }
}

type Col = ArrayLike<number | null>;
export interface DriverColumns {
  number: number;
  /** Times already relative to t0. */
  loc: { t: Col; x: Col; y: Col };
  car: { t: Col; speed: Col; throttle: Col; brake: Col; rpm: Col; gear: Col; drs: Col };
}

/** Binary samples layout (see shared/pack.ts): u32 header length, JSON header, 4-byte-aligned typed arrays. */
export function encodeSamples(perDriver: DriverColumns[]) {
  const header: SamplesHeader = { arrays: [] };
  const chunks: Buffer[] = [];
  let offset = 0;
  const push = (key: string, type: SamplesHeader['arrays'][number]['type'], arr: ArrayBufferView & { length: number }) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    header.arrays.push({ key, type, offset, length: arr.length });
    chunks.push(buf);
    offset += buf.length;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
  };
  const n0 = (v: number | null) => v ?? 0;
  for (const d of perDriver) {
    const { loc, car } = d;
    push(`loc.${d.number}.t`, 'i32', Int32Array.from(loc.t, n0));
    push(`loc.${d.number}.x`, 'i32', Int32Array.from(loc.x, n0));
    push(`loc.${d.number}.y`, 'i32', Int32Array.from(loc.y, n0));
    push(`car.${d.number}.t`, 'i32', Int32Array.from(car.t, n0));
    push(`car.${d.number}.speed`, 'i16', Int16Array.from(car.speed, n0));
    push(`car.${d.number}.throttle`, 'u8', Uint8Array.from(car.throttle, (v) => Math.min(255, v ?? 0)));
    push(`car.${d.number}.brake`, 'u8', Uint8Array.from(car.brake, (v) => Math.min(255, v ?? 0)));
    push(`car.${d.number}.rpm`, 'u16', Uint16Array.from(car.rpm, n0));
    push(`car.${d.number}.gear`, 'u8', Uint8Array.from(car.gear, n0));
    push(`car.${d.number}.drs`, 'u8', Uint8Array.from(car.drs, (v) => (v == null ? 255 : v)));
  }
  const headerBuf = Buffer.from(JSON.stringify(header));
  const headerPad = (4 - ((4 + headerBuf.length) % 4)) % 4;
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(headerBuf.length + headerPad);
  return Buffer.concat([lenBuf, headerBuf, Buffer.alloc(headerPad, 0x20), ...chunks]);
}
