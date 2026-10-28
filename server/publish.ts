// Prepare race files for the hosted site.
//
//   npm run publish:data                     new sessions from the last 10 days
//   npm run publish:data -- --season 2026    every finished session this season
//   npm run publish:data -- --session-key 9839
//   ... --site https://pit-wall.web.app      fetch already-published files from the live
//                                            site instead of downloading them again
//
// Output goes to site-data/ (sessions.json + s/<key>.meta.json.gz + s/<key>.samples.bin.gz),
// which the build copies into dist/data. Prints changed=true|false for the GitHub workflow.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { get } from './openf1.ts';
import { ingestSession } from './ingest.ts';
import { listCachedSessions, sessionDbPath } from './db.ts';
import zlib from 'node:zlib';
import { encodeSamples, ensurePack } from './pack.ts';
import { PACK_VERSION } from '../shared/pack.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'site-data' },
    season: { type: 'string' },
    'recent-days': { type: 'string', default: '10' },
    'session-key': { type: 'string', multiple: true },
    site: { type: 'string' },
    max: { type: 'string', default: '12' },
  },
});

const OUT = path.resolve(values.out!);
const FILES = path.join(OUT, 's');
const LIST = path.join(OUT, 'sessions.json');
/** Session types worth replaying. */
const WANTED = ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying', 'Sprint Shootout'];
/**
 * Practice is published "lite": lap data for the long-run analysis, without the car samples
 * (positions and telemetry), which would triple the site's size and Firebase's free download quota.
 */
const LITE = ['Practice 1', 'Practice 2', 'Practice 3'];
/** Wait this long after a session ends: OpenF1's free tier is closed while sessions are live. */
const SETTLE_MS = 2 * 3600e3;

interface Entry {
  session_key: number;
  year: number;
  meeting_name: string;
  country_name: string;
  session_name: string;
  circuit_short_name: string;
  date_start: number;
  complete: true;
  size_mb: number;
  lite?: boolean;
}

const files = (key: number) => ({ meta: path.join(FILES, `${key}.meta.json.gz`), samples: path.join(FILES, `${key}.samples.bin.gz`) });
const published = (key: number) => fs.existsSync(files(key).meta) && fs.existsSync(files(key).samples);
/** Published with an older replay format (e.g. before heights were added for the 3D view)? */
function outdated(key: number) {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(files(key).meta)).toString()).version < PACK_VERSION;
  } catch {
    return true;
  }
}

function readList(): Entry[] {
  try {
    return JSON.parse(fs.readFileSync(LIST, 'utf8'));
  } catch {
    return [];
  }
}

/** If the local copy was lost (e.g. a cold CI cache), get published files back from the live site. */
async function restoreFromSite(site: string) {
  const res = await fetch(new URL('/data/sessions.json', site)).catch(() => null);
  if (!res?.ok) return [];
  let remote: Entry[] = [];
  try {
    remote = await res.json();
  } catch {
    return [];
  }
  const restored: Entry[] = [];
  for (const e of remote) {
    if (published(e.session_key)) {
      restored.push(e);
      continue;
    }
    try {
      for (const [kind, file] of Object.entries(files(e.session_key))) {
        const r = await fetch(new URL(`/data/s/${e.session_key}.${kind === 'meta' ? 'meta.json' : 'samples.bin'}.gz`, site));
        if (!r.ok) throw new Error(`${r.status}`);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      }
      restored.push(e);
      console.log(`Restored ${e.year} ${e.meeting_name} · ${e.session_name} from the live site`);
    } catch (err) {
      console.warn(`Couldn't restore session ${e.session_key}: ${(err as Error).message}`);
    }
  }
  return restored;
}

async function wantedSessions(): Promise<Record<string, any>[]> {
  if (values['session-key']?.length) {
    const out = [];
    for (const k of values['session-key']) out.push(...(await get('sessions', `session_key=${Number(k)}`)));
    return out;
  }
  const year = Number(values.season) || new Date().getUTCFullYear();
  const all = await get('sessions', `year=${year}`);
  const since = values.season ? -Infinity : Date.now() - Number(values['recent-days']) * 86_400e3;
  return all.filter((s) => {
    const end = Date.parse(s.date_end);
    return [...WANTED, ...LITE].includes(s.session_name) && !s.is_cancelled && end + SETTLE_MS < Date.now() && end > since;
  });
}

fs.mkdirSync(FILES, { recursive: true });
let list = readList();
if (values.site) {
  const restored = await restoreFromSite(values.site);
  for (const e of restored) if (!list.some((x) => x.session_key === e.session_key)) list.push(e);
}
// Drop list entries whose files have gone missing.
list = list.filter((e) => published(e.session_key));

const todo = (await wantedSessions()).filter((s) => !published(s.session_key) || outdated(s.session_key)).slice(0, Number(values.max));
console.log(todo.length ? `${todo.length} session(s) to publish` : 'Nothing new to publish');

let changed = false;
for (const s of todo) {
  const label = `${s.year} ${s.location} · ${s.session_name}`;
  try {
    console.log(`Downloading ${label} (session ${s.session_key})…`);
    await ingestSession(s.session_key);
    const pack = ensurePack(s.session_key);
    if (!pack) throw new Error('replay files could not be built');
    const out = files(s.session_key);
    fs.copyFileSync(pack.meta, out.meta);
    const lite = LITE.includes(s.session_name);
    if (lite) fs.writeFileSync(out.samples, zlib.gzipSync(encodeSamples([])));
    else fs.copyFileSync(pack.samples, out.samples);
    const summary = listCachedSessions().find((x) => x.session_key === s.session_key)!;
    const size = (fs.statSync(out.meta).size + fs.statSync(out.samples).size) / 1e6;
    list = list.filter((e) => e.session_key !== s.session_key);
    list.push({
      session_key: s.session_key,
      year: summary.year,
      meeting_name: summary.meeting_name,
      country_name: summary.country_name,
      session_name: summary.session_name,
      circuit_short_name: summary.circuit_short_name,
      date_start: summary.date_start,
      complete: true,
      size_mb: +size.toFixed(1),
      ...(lite ? { lite: true } : {}),
    });
    // On GitHub the working database isn't needed once the replay files are made.
    if (process.env.CI) for (const f of [sessionDbPath(s.session_key), sessionDbPath(s.session_key) + '-wal', sessionDbPath(s.session_key) + '-shm']) fs.rmSync(f, { force: true });
    changed = true;
    console.log(`Published ${label} (${size.toFixed(1)} MB)`);
  } catch (err) {
    console.error(`Skipped ${label}: ${(err as Error).message}`);
  }
}

list.sort((a, b) => b.date_start - a.date_start);
fs.writeFileSync(LIST, JSON.stringify(list, null, 1));
console.log(`${list.length} session(s) on the site`);
console.log(`changed=${changed}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
