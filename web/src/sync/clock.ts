// One shared playback clock for every window (and, via the server relay, every
// device on the LAN). Windows only exchange *changes* (play, pause, seek, speed,
// session, selected drivers). Each window then computes the current time itself:
//   now = anchorT + (wallNow() - anchorWall) * speed
// so nothing streams per frame and all windows stay in step.
// When following a live session the time is instead pinned to the wall clock,
// held back by the TV delay:  now = wallNow() - liveT0 - delayMs

export interface SyncedState {
  sessionKey: number | null;
  playing: boolean;
  speed: number;
  /** Session time (ms, pack-relative) at the anchor moment. NaN = "jump to lights out once loaded". */
  anchorT: number;
  /** Wall-clock time (epoch ms, server-corrected) at the anchor moment. */
  anchorWall: number;
  /** Up to two highlighted drivers (telemetry, map highlight). */
  selected: number[];
  /** 'live' = the session currently streaming from OpenF1 (or a simulation of one). */
  source: 'replay' | 'live';
  /** Following the live edge (rather than paused or scrubbed back). */
  live: boolean;
  /** Epoch ms that live session times are relative to. */
  liveT0: number;
  /** How far behind real time to show live data, to match the TV picture. */
  delayMs: number;
  /** Last-writer-wins version. */
  rev: number;
}

export const DEFAULT_DELAY_MS = 8000;

type Msg = { type: 'state'; state: SyncedState; src: string } | { type: 'hello'; src: string };

const SRC = Math.random().toString(36).slice(2);
const STORAGE_KEY = 'pitwall.state';
let serverOffset = 0;

export const wallNow = () => Date.now() + serverOffset;

function initialState(): SyncedState {
  const fromUrl = Number(new URLSearchParams(location.search).get('session')) || null;
  let saved: Partial<SyncedState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    // storage unavailable: start fresh
  }
  const sameSession = !fromUrl || saved.sessionKey === fromUrl;
  return {
    sessionKey: fromUrl ?? saved.sessionKey ?? null,
    playing: false,
    speed: saved.speed ?? 1,
    anchorT: sameSession && typeof saved.anchorT === 'number' ? saved.anchorT : NaN,
    anchorWall: wallNow(),
    selected: sameSession ? saved.selected ?? [] : [],
    source: fromUrl ? 'replay' : saved.source ?? 'replay',
    live: !fromUrl && saved.source === 'live',
    liveT0: saved.liveT0 ?? NaN,
    delayMs: saved.delayMs ?? DEFAULT_DELAY_MS,
    rev: 0,
  };
}

let state = initialState();
const listeners = new Set<() => void>();

export function getState() {
  return state;
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Current session time in ms (pack-relative). */
export function now(s: SyncedState = state) {
  if (s.source === 'live' && s.live) return wallNow() - s.liveT0 - s.delayMs;
  return s.playing ? s.anchorT + (wallNow() - s.anchorWall) * s.speed : s.anchorT;
}

function apply(next: SyncedState, broadcast: boolean) {
  state = next;
  if (broadcast) send({ type: 'state', state, src: SRC });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, playing: false, anchorT: now() }));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

function update(patch: Partial<SyncedState>) {
  // Re-anchor at "now" so changing speed or pausing never jumps.
  const t = now();
  apply({ ...state, anchorT: t, anchorWall: wallNow(), ...patch, rev: Math.max(wallNow(), state.rev + 1) }, true);
}

// Any manual playback control drops out of "following live" (Go live brings it back).
export const clock = {
  play: () => !state.playing && update({ playing: true }),
  pause: () => (state.playing || state.live) && update({ playing: false, live: false }),
  toggle: () => (state.live ? update({ playing: false, live: false }) : update({ playing: !state.playing })),
  seek: (t: number) => update({ anchorT: t, live: false }),
  nudge: (ms: number) => update({ anchorT: now() + ms, live: false }),
  setSpeed: (speed: number) => update({ speed, live: false }),
  setSession: (sessionKey: number) =>
    update({ sessionKey, source: 'replay', live: false, anchorT: NaN, playing: false, selected: [] }),
  /** Switch every window to the live session, following the live edge. */
  openLive: () => update({ source: 'live', live: true, playing: true, speed: 1, selected: [] }),
  goLive: () => update({ live: true, playing: true, speed: 1 }),
  setDelay: (delayMs: number) => update({ delayMs: Math.max(0, Math.round(delayMs)) }),
  /** Called when a live snapshot loads: pins the time base all windows share. */
  setLiveT0: (t0: number) => state.liveT0 !== t0 && update({ liveT0: t0 }),
  toggleSelected: (driver: number) => {
    const has = state.selected.includes(driver);
    const selected = has ? state.selected.filter((d) => d !== driver) : [...state.selected, driver].slice(-2);
    update({ selected });
  },
  setSelected: (selected: number[]) => update({ selected: selected.slice(0, 2) }),
  /** Local-only fix-up, e.g. resolving NaN anchorT once data has loaded. */
  initialiseTime: (t: number) => {
    if (Number.isNaN(state.anchorT)) update({ anchorT: t });
  },
};

// ---- transports ------------------------------------------------------------

/** Whether this window is linked to the sync server, and how many windows/devices are. */
export interface LinkStatus {
  connected: boolean;
  peers: number;
}
let link: LinkStatus = { connected: false, peers: 0 };
const linkListeners = new Set<() => void>();
export const getLink = () => link;
export function subscribeLink(fn: () => void) {
  linkListeners.add(fn);
  return () => linkListeners.delete(fn);
}
function setLink(next: LinkStatus) {
  link = next;
  linkListeners.forEach((l) => l());
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pitwall-sync') : null;
let socket: WebSocket | null = null;

function send(msg: Msg) {
  const text = JSON.stringify(msg);
  channel?.postMessage(text);
  if (socket?.readyState === WebSocket.OPEN) socket.send(text);
}

function receive(text: string) {
  let msg: Msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.src === SRC) return;
  if (msg.type === 'hello') {
    if (state.sessionKey != null) send({ type: 'state', state, src: SRC });
  } else if (msg.type === 'state' && msg.state.rev > state.rev) {
    apply(msg.state, false);
  }
}

channel?.addEventListener('message', (e) => receive(e.data));

function connectSocket() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sync`;
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => {
    socket = ws;
    setLink({ ...link, connected: true });
    // Estimate server clock offset so devices with drifting clocks agree on "now".
    const ping = () => ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
    ping();
    setTimeout(ping, 1000);
    ws.send(JSON.stringify({ type: 'hello', src: SRC }));
  });
  ws.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'peers') {
      setLink({ connected: true, peers: data.count });
      return;
    }
    if (data.type === 'pong') {
      const rtt = Date.now() - data.clientTime;
      serverOffset = data.serverTime - (data.clientTime + rtt / 2);
      return;
    }
    receive(e.data);
  });
  ws.addEventListener('close', () => {
    socket = null;
    setLink({ connected: false, peers: 0 });
    setTimeout(connectSocket, 3000);
  });
}

connectSocket();
send({ type: 'hello', src: SRC });

// Handy for debugging from the browser console: __pitwall.getState(), __pitwall.now()
(window as unknown as { __pitwall: unknown }).__pitwall = { getState, now, clock };
