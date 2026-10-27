// Where data comes from. Locally: the Pit Wall server on this computer. Hosted: the race
// files published alongside the site, plus Jolpica and OpenF1 called straight from the browser.
import { HOSTED } from './env';
import { buildSeason, buildStandingsBefore, makeJolpica, type Season, type StandingsBefore } from '../../shared/season';

export interface CachedSession {
  session_key: number;
  year: number;
  meeting_name: string;
  country_name: string;
  session_name: string;
  circuit_short_name: string;
  date_start: number;
  complete: boolean;
  size_mb: number;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status} ${r.statusText}`);
  return r.json();
}

/** Published race list (hosted) or what's downloaded on this computer (local). */
let hostedList: Promise<CachedSession[]> | null = null;
export function listSessions(): Promise<CachedSession[]> {
  if (!HOSTED) return getJson('/api/sessions');
  hostedList ??= getJson<CachedSession[]>('/data/sessions.json').catch(() => []);
  return hostedList;
}

/** Fetch a file, reporting bytes as they arrive, and un-gzip it if it's gzipped. */
export async function fetchBytes(url: string, onProgress?: (loaded: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't load ${url} (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    onProgress?.(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  // Hosted files are stored gzipped; the browser may or may not have unpacked them already.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }
  return bytes.buffer;
}

/** URLs of a session's replay pack. */
export function packUrls(key: number) {
  return HOSTED
    ? { meta: `/data/s/${key}.meta.json.gz`, samples: `/data/s/${key}.samples.bin.gz` }
    : { meta: `/api/sessions/${key}/meta`, samples: `/api/sessions/${key}/samples` };
}

// ---- season & standings ---------------------------------------------------------

const jolpica = makeJolpica();
const raceSessionCache = new Map<number, Promise<Record<string, any>[]>>();
function raceSessions(year: number) {
  if (!raceSessionCache.has(year)) {
    const p = fetch(`https://api.openf1.org/v1/sessions?year=${year}&session_name=Race`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    raceSessionCache.set(year, p);
  }
  return raceSessionCache.get(year)!;
}

export async function season(year: number): Promise<Season> {
  if (!HOSTED) return getJson(`/api/season?year=${year}`);
  const published = new Set((await listSessions()).map((s) => s.session_key));
  return buildSeason(year, { jolpica, raceSessions, isCached: (k) => published.has(k) });
}

export function standingsBefore(year: number, date: string, kind: 'race' | 'sprint'): Promise<StandingsBefore> {
  if (!HOSTED) return getJson(`/api/standings-before?year=${year}&date=${date}&kind=${kind}`);
  return buildStandingsBefore(year, date, kind, jolpica);
}
