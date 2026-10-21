// Auto-download: an hour-by-hour check that fetches each race once it has finished
// (2 hours after the scheduled end, safely outside OpenF1's live-session window).
// Only races from the last week, so older ones stay a choice (the Season card's Download buttons).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, listCachedSessions } from './db.ts';
import { get } from './openf1.ts';
import { busy, enqueueIngest } from './jobs.ts';

const SETTINGS = path.join(CACHE_DIR, 'settings.json');
const CHECK_EVERY_MS = 60 * 60_000;
const AFTER_END_MS = 2 * 3600e3;
/** Only recent races: switching it on shouldn't quietly download a whole season. */
const LOOKBACK_MS = 7 * 86_400e3;

interface Settings {
  autoDownload: boolean;
}

export function readSettings(): Settings {
  try {
    return { autoDownload: false, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) };
  } catch {
    return { autoDownload: false };
  }
}

export function writeSettings(patch: Partial<Settings>) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2));
  if (next.autoDownload) void checkNow();
  return next;
}

export const autoStatus = { lastCheck: null as string | null, lastQueued: [] as number[], error: null as string | null };

/** Queue this season's finished races that aren't downloaded yet. */
export async function checkNow() {
  if (!readSettings().autoDownload || busy()) return;
  try {
    const year = new Date().getUTCFullYear();
    const races = await get('sessions', `year=${year}&session_name=Race`);
    const cached = new Set(listCachedSessions().filter((s) => s.complete).map((s) => s.session_key));
    const due = races.filter((r) => {
      const ended = Date.parse(r.date_end);
      return !r.is_cancelled && !cached.has(r.session_key) && ended + AFTER_END_MS < Date.now() && ended > Date.now() - LOOKBACK_MS;
    });
    autoStatus.lastQueued = due.map((r) => r.session_key);
    for (const r of due) enqueueIngest(r.session_key, 'auto');
    autoStatus.error = null;
  } catch (err) {
    autoStatus.error = (err as Error).message;
  } finally {
    autoStatus.lastCheck = new Date().toISOString();
  }
}

export function startAutoDownload() {
  setTimeout(checkNow, 60_000); // shortly after start-up
  setInterval(checkNow, CHECK_EVERY_MS);
}
