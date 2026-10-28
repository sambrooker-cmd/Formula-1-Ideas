// Circuit outlines (x/y in the F1 timing frame, in driving order from the start/finish line).
// Free live mode has no car positions, so it places cars along this outline instead.
// Sources, in order: saved file, any downloaded session at the circuit, OpenF1 history.
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from './db.ts';
import Database from './sqlite.ts';
import { get } from './openf1.ts';

type Pt = [number, number];
const DIR = path.join(CACHE_DIR, 'outlines');
const file = (circuitKey: number) => path.join(DIR, `circuit-${circuitKey}.json`);

function save(circuitKey: number, pts: Pt[]) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(circuitKey), JSON.stringify(pts));
  return pts;
}

/** From any downloaded session at this circuit. */
function fromLocalSessions(circuitKey: number): Pt[] | null {
  if (!fs.existsSync(CACHE_DIR)) return null;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = /^session-(\d+)\.sqlite$/.exec(f);
    if (!m) continue;
    let db: Database | null = null;
    try {
      db = new Database(path.join(CACHE_DIR, f), { readonly: true });
      const s = db.prepare('SELECT circuit_key FROM session').get() as { circuit_key: number } | undefined;
      if (s?.circuit_key !== circuitKey) continue;
      const pts = db.prepare('SELECT x, y FROM track_outline ORDER BY seq').raw().all() as Pt[];
      if (pts.length > 100) return pts;
    } catch {
      // not a finished download
    } finally {
      db?.close();
    }
  }
  return null;
}

/** From last year's race at this circuit on OpenF1: the winner's fastest clean lap (3 requests). */
async function fromOpenF1(circuitKey: number): Promise<Pt[] | null> {
  const races = (await get('sessions', `circuit_key=${circuitKey}&session_name=Race`))
    .filter((s) => Date.parse(s.date_end) < Date.now() - 86_400e3)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
  const race = races[0];
  if (!race) return null;
  const laps = (await get('laps', `session_key=${race.session_key}`))
    .filter((l) => l.lap_duration && !l.is_pit_out_lap && l.lap_number > 1 && l.date_start)
    .sort((a, b) => a.lap_duration - b.lap_duration);
  const lap = laps[0];
  if (!lap) return null;
  const start = new Date(Date.parse(lap.date_start)).toISOString();
  const end = new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000).toISOString();
  const loc = await get('location', `session_key=${race.session_key}&driver_number=${lap.driver_number}&date>=${start}&date<${end}`);
  const pts = loc.filter((r) => r.x || r.y).map((r) => [r.x, r.y] as Pt);
  return pts.length > 100 ? pts : null;
}

export async function getOutline(circuitKey: number): Promise<Pt[] | null> {
  try {
    if (fs.existsSync(file(circuitKey))) return JSON.parse(fs.readFileSync(file(circuitKey), 'utf8'));
  } catch {
    // corrupt file: fetch again
  }
  const local = fromLocalSessions(circuitKey);
  if (local) return save(circuitKey, local);
  try {
    const remote = await fromOpenF1(circuitKey);
    if (remote) return save(circuitKey, remote);
  } catch {
    // OpenF1's free tier is closed while a session is live; prefetching avoids needing it then
  }
  return null;
}

/** Fetch the outline for the next race weekend ahead of time (while OpenF1's free tier is open). */
export async function prefetchNextOutline() {
  try {
    const meetings = await get('meetings', `year=${new Date().getUTCFullYear()}`);
    const next = meetings
      .filter((m) => Date.parse(m.date_end) > Date.now())
      .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
    if (next) await getOutline(next.circuit_key);
  } catch {
    // try again later
  }
}

