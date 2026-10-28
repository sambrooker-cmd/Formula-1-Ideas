// Keeps the downloads folder in check: a size limit, races you want to keep, and tidying up
// replay files left over from older versions of the app (they rebuild on demand).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR } from './db.ts';
import { PACK_VERSION } from '../shared/pack.ts';

interface StorageSettings {
  /** Gigabytes; null = no limit. */
  limitGB: number | null;
  keep: number[];
  lastOpened: Record<string, number>;
}

const FILE = path.join(CACHE_DIR, 'storage.json');
const DEFAULT: StorageSettings = { limitGB: 5, keep: [], lastOpened: {} };

export function readStorage(): StorageSettings {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT };
  }
}

function writeStorage(s: StorageSettings) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 1));
}

/** All files belonging to one session (database and replay files of any version). */
export function sessionFiles(key: number) {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const re = new RegExp(`^session-${key}\\.(sqlite(-wal|-shm)?|v\\d+\\.(meta\\.json|samples\\.bin)\\.gz)$`);
  return fs.readdirSync(CACHE_DIR).filter((f) => re.test(f)).map((f) => path.join(CACHE_DIR, f));
}

export function sessionBytes(key: number) {
  return sessionFiles(key).reduce((s, f) => s + fs.statSync(f).size, 0);
}

function sessionKeys() {
  if (!fs.existsSync(CACHE_DIR)) return [];
  const keys = new Set<number>();
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = /^session-(\d+)\./.exec(f);
    if (m) keys.add(Number(m[1]));
  }
  return [...keys];
}

export function markOpened(key: number) {
  const s = readStorage();
  s.lastOpened[key] = Date.now();
  writeStorage(s);
}

export function setKeep(key: number, keep: boolean) {
  const s = readStorage();
  s.keep = keep ? [...new Set([...s.keep, key])] : s.keep.filter((k) => k !== key);
  writeStorage(s);
  return s;
}

export function setLimit(limitGB: number | null) {
  const s = readStorage();
  s.limitGB = limitGB;
  writeStorage(s);
  return s;
}

export function deleteSession(key: number) {
  for (const f of sessionFiles(key)) fs.rmSync(f, { force: true });
  const s = readStorage();
  delete s.lastOpened[key];
  s.keep = s.keep.filter((k) => k !== key);
  writeStorage(s);
}

/** Replay files from older app versions: safe to delete, they're rebuilt from the database. */
function removeOldPacks() {
  let freed = 0;
  if (!fs.existsSync(CACHE_DIR)) return freed;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const m = /^session-(\d+)\.v(\d+)\.(meta\.json|samples\.bin)\.gz$/.exec(f);
    if (!m || Number(m[2]) >= PACK_VERSION) continue;
    if (!fs.existsSync(path.join(CACHE_DIR, `session-${m[1]}.sqlite`))) continue; // only file left: keep it
    const p = path.join(CACHE_DIR, f);
    freed += fs.statSync(p).size;
    fs.rmSync(p, { force: true });
  }
  return freed;
}

/**
 * Tidy old files, then if over the limit delete the least recently opened races (never ones
 * marked keep, or ones `inUse` says are being downloaded).
 */
export function cleanup(inUse: (key: number) => boolean = () => false) {
  const freedOld = removeOldPacks();
  const s = readStorage();
  const deleted: number[] = [];
  if (s.limitGB != null) {
    const limit = s.limitGB * 1e9;
    const all = sessionKeys().map((k) => ({ k, bytes: sessionBytes(k), opened: s.lastOpened[k] ?? fileTime(k) }));
    let total = all.reduce((x, a) => x + a.bytes, 0);
    // Never the race being downloaded, one marked keep, or anything opened or downloaded in the last hour.
    const candidates = all.filter((a) => !s.keep.includes(a.k) && !inUse(a.k) && a.opened < Date.now() - 3600e3).sort((a, b) => a.opened - b.opened);
    for (const c of candidates) {
      if (total <= limit) break;
      deleteSession(c.k);
      total -= c.bytes;
      deleted.push(c.k);
    }
  }
  if (deleted.length || freedOld) console.log(`Storage: removed ${deleted.length} race(s), ${(freedOld / 1e6).toFixed(0)} MB of old replay files`);
  return { deleted, freedOldMB: freedOld / 1e6 };
}

function fileTime(key: number) {
  const files = sessionFiles(key);
  return files.length ? Math.max(...files.map((f) => fs.statSync(f).mtimeMs)) : 0;
}

export function storageStatus() {
  const s = readStorage();
  const sessions = sessionKeys().map((k) => ({ key: k, mb: +(sessionBytes(k) / 1e6).toFixed(1), lastOpened: s.lastOpened[k] ?? null, keep: s.keep.includes(k) }));
  return { limitGB: s.limitGB, totalMB: +sessions.reduce((x, a) => x + a.mb, 0).toFixed(0), sessions };
}
