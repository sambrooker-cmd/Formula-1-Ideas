// One shared playback clock for every window (and, via the server relay, every
// device on the LAN). Windows only exchange *changes* (play, pause, seek, speed,
// session, selected drivers). Each window then computes the current time itself:
//   now = anchorT + (wallNow() - anchorWall) * speed
// so nothing streams per frame and all windows stay in step.

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
  /** Last-writer-wins version. */
  rev: number;
}

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

export const clock = {
  play: () => !state.playing && update({ playing: true }),
  pause: () => state.playing && update({ playing: false }),
  toggle: () => update({ playing: !state.playing }),
  seek: (t: number) => update({ anchorT: t }),
  nudge: (ms: number) => update({ anchorT: now() + ms }),
  setSpeed: (speed: number) => update({ speed }),
  setSession: (sessionKey: number) =>
    update({ sessionKey, anchorT: NaN, playing: false, selected: [] }),
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
    // Estimate server clock offset so devices with drifting clocks agree on "now".
    const ping = () => ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
    ping();
    setTimeout(ping, 1000);
    ws.send(JSON.stringify({ type: 'hello', src: SRC }));
  });
  ws.addEventListener('message', (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'pong') {
      const rtt = Date.now() - data.clientTime;
      serverOffset = data.serverTime - (data.clientTime + rtt / 2);
      return;
    }
    receive(e.data);
  });
  ws.addEventListener('close', () => {
    socket = null;
    setTimeout(connectSocket, 3000);
  });
}

connectSocket();
send({ type: 'hello', src: SRC });

// Handy for debugging from the browser console: __pitwall.getState(), __pitwall.now()
(window as unknown as { __pitwall: unknown }).__pitwall = { getState, now, clock };
