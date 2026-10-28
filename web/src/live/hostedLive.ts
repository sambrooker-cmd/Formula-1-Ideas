// Live mode on the hosted site: each device connects straight to F1's live timing from the
// browser (no server needed) and builds the session itself, through the same feed code the Mac
// uses. Positions are estimated along the circuit outline, as in the Mac's free live mode.
import { LiveStore } from '../../../shared/livestore';
import { F1Feed, F1_SOCKET, merge } from '../../../shared/f1feed';
import type { PackMeta } from '../../../shared/pack';
import { index, type DriverSamples, type SessionData } from '../data/session';
import { fetchBytes, listSessions, packUrls } from '../api';
import { layout } from '../data/circuit';

export interface HostedLiveStatus {
  connected: boolean;
  session: { key: number; name: string } | null;
  error: string | null;
}

type Listener = (msg: { type: 'session' } | { type: 'delta'; topics: Record<string, unknown[]> }) => void;

const store = new LiveStore();
const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let status: HostedLiveStatus = { connected: false, session: null, error: null };

function setStatus(patch: Partial<HostedLiveStatus>) {
  status = { ...status, ...patch };
  statusListeners.forEach((f) => f());
}

const feed = new F1Feed(store, {
  getOutline: (circuitKey, year) => outlineFor(circuitKey, year, feed.state.SessionInfo?.Meeting?.Circuit?.ShortName ?? ''),
  onSessionStart: () => {
    setStatus({ session: { key: store.sessionKey!, name: `${store.session?.year} ${store.meeting?.meeting_name} · ${store.session?.session_name}` } });
    listeners.forEach((f) => f({ type: 'session' }));
  },
  onConnection: (connected) => setStatus({ connected }),
  inflate: async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  },
});

let started = false;

/** Connect (once per page) and keep reconnecting; also starts the position estimates and delta flushes. */
export function startHostedLive() {
  if (started) return;
  started = true;
  feed.ticker = setInterval(() => feed.estimatePositions(), 250);
  setInterval(flush, 250);
  void (async () => {
    for (;;) {
      try {
        // Straight to the WebSocket: the negotiate step isn't allowed from web pages, but isn't needed.
        await feed.run(new WebSocket(F1_SOCKET));
        setStatus({ error: null });
      } catch (err) {
        setStatus({ error: (err as Error).message });
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  })();
}

function flush() {
  const topics = store.pending;
  if (!Object.keys(topics).length) return;
  store.pending = {};
  if (store.session) listeners.forEach((f) => f({ type: 'delta', topics }));
}

export function onHostedLive(f: Listener) {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function hostedLiveStatus() {
  return status;
}
export function subscribeHostedLive(f: () => void) {
  statusListeners.add(f);
  return () => statusListeners.delete(f);
}

/** The session so far, as SessionData with growable arrays (deltas are applied on top). */
export function hostedLiveSnapshot(): SessionData {
  if (!store.session) throw new Error('No live session right now.');
  const meta = store.meta() as PackMeta;
  const data = index(meta, EMPTY_SAMPLES);
  data.live = true;
  for (const n of meta.drivers.map((d) => d.number)) {
    const s = store.samples.get(n);
    const car = s?.car;
    const dist: number[] = [];
    if (car) for (let i = 0; i < car.t.length; i++) {
      const dt = i ? (car.t[i] - car.t[i - 1]) / 1000 : 0;
      dist.push(i ? dist[i - 1] + (dt > 0 && dt < 5 ? ((car.speed[i] + car.speed[i - 1]) / 2 / 3.6) * dt : 0) : 0);
    }
    const samples: Record<keyof DriverSamples, number[]> = {
      locT: [...(s?.loc.t ?? [])],
      locX: [...(s?.loc.x ?? [])],
      locY: [...(s?.loc.y ?? [])],
      locZ: [...(s?.loc.z ?? [])],
      carT: [...(car?.t ?? [])],
      speed: [...(car?.speed ?? [])],
      throttle: [...(car?.throttle ?? [])],
      brake: [...(car?.brake ?? [])],
      rpm: [...(car?.rpm ?? [])],
      gear: [...(car?.gear ?? [])],
      drs: (car?.drs ?? []).map((v) => (v == null ? 255 : v)),
      dist,
    };
    data.samples.set(n, samples);
  }
  return data;
}

/** A samples file with no arrays: the live data is filled in separately. */
const EMPTY_SAMPLES = (() => {
  const header = new TextEncoder().encode(JSON.stringify({ arrays: [] }));
  const pad = (4 - ((4 + header.length) % 4)) % 4;
  const buf = new ArrayBuffer(4 + header.length + pad);
  new DataView(buf).setUint32(0, header.length + pad, true);
  new Uint8Array(buf, 4).set(header);
  new Uint8Array(buf, 4 + header.length, pad).fill(0x20);
  return buf;
})();

// ---- circuit outline ------------------------------------------------------------

type Pt = [number, number];

/**
 * The outline cars are placed along: from a published replay at the same circuit if there is
 * one (exactly the racing line, starting at the line), otherwise MultiViewer's circuit map,
 * turned to start at the start/finish line and run in the driving direction.
 */
async function outlineFor(circuitKey: number, year: number, shortName: string): Promise<Pt[] | null> {
  const key = `pitwall.outline.${circuitKey}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit?.length > 50) return hit;
  } catch {
    // ignore
  }
  let pts: Pt[] | null = null;
  try {
    const published = (await listSessions()).filter((s) => s.circuit_short_name === shortName).sort((a, b) => b.date_start - a.date_start);
    for (const s of published) {
      const meta = JSON.parse(new TextDecoder().decode(await fetchBytes(packUrls(s.session_key).meta))) as PackMeta;
      if (meta.outline?.length > 50) {
        pts = meta.outline;
        break;
      }
    }
  } catch {
    // fall through to MultiViewer
  }
  if (!pts) {
    const l = await layout(circuitKey, year).catch(() => null);
    if (l) pts = alignToStart(l.x.map((x, i) => [x, l.y[i]] as Pt), l.corners);
  }
  if (pts) {
    try {
      localStorage.setItem(key, JSON.stringify(pts));
    } catch {
      // ignore
    }
  }
  return pts;
}

/**
 * MultiViewer's map doesn't say where the line is. Its corners carry their distance from the
 * line, though: run the right way round (corner 1 before corner 2) and start that far before corner 1.
 */
export function alignToStart(pts: Pt[], corners: { number: number; length: number; trackPosition: { x: number; y: number } }[]): Pt[] {
  if (pts.length < 10 || corners.length < 2) return pts;
  const nearest = (p: { x: number; y: number }) => {
    let best = 0;
    let bd = Infinity;
    pts.forEach(([x, y], i) => {
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const sorted = [...corners].sort((a, b) => a.length - b.length);
  const n = pts.length;
  // Direction: going forward from corner 1, corner 2 should come before corner 1 comes round again.
  const i1 = nearest(sorted[0].trackPosition);
  const i2 = nearest(sorted[1].trackPosition);
  const reversed = (i2 - i1 + n) % n > n / 2;
  const ordered = reversed ? [...pts].reverse() : pts;
  const j1 = reversed ? n - 1 - i1 : i1;
  // Walk back from corner 1 by its distance from the line (MultiViewer lengths are in the same units as x/y).
  let back = sorted[0].length;
  let k = j1;
  while (back > 0) {
    const prev = (k - 1 + n) % n;
    back -= Math.hypot(ordered[k][0] - ordered[prev][0], ordered[k][1] - ordered[prev][1]);
    k = prev;
    if (k === j1) break;
  }
  return [...ordered.slice(k), ...ordered.slice(0, k)];
}

// For testing without a live session: feed a captured snapshot through the hosted pipeline.
if (import.meta.env?.DEV) {
  (window as unknown as { __pitwallHostedLiveTest: unknown }).__pitwallHostedLiveTest = async (result: Record<string, unknown>) => {
    for (const [topic, value] of Object.entries(result)) feed.state[topic] = merge(undefined, value);
    await feed.startSession();
    setStatus({ connected: true });
    const leader = Object.entries<Record<string, unknown>>(feed.state.TimingData?.Lines ?? {}).find(([, l]) => l.Position === '1')?.[0];
    if (leader) feed.track(leader).lapStart = Date.now() - 20_000;
    if (!started) {
      started = true;
      feed.ticker = setInterval(() => feed.estimatePositions(), 250);
      setInterval(flush, 250);
    }
  };
}
