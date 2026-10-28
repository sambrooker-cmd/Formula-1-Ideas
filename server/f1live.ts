// Free live mode on the Mac: connects to F1's live timing (see shared/f1feed.ts) and feeds the
// server's live store, which every screen on the Wi-Fi follows.
import zlib from 'node:zlib';
import { store, status, announceSession } from './live.ts';
import { getOutline } from './outlines.ts';
import { F1Feed, merge, type SocketLike } from '../shared/f1feed.ts';

type Obj = Record<string, any>;

const feed = new F1Feed(store, {
  getOutline: (circuitKey) => getOutline(circuitKey),
  onSessionStart: () => {
    status.source = 'f1';
    announceSession();
  },
  onConnection: (connected) => (status.connected = connected),
  paused: () => status.source === 'simulation' || status.source === 'openf1',
  inflate: async (b64) => zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString(),
});

async function connect() {
  const neg = await fetch('https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1', { method: 'POST', headers: { 'User-Agent': 'BestHTTP' } });
  if (!neg.ok) throw new Error(`F1 live timing refused the connection (${neg.status})`);
  const cookies = (neg.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const { connectionToken } = (await neg.json()) as { connectionToken: string };
  // Node's built-in WebSocket accepts extra headers (the load balancer cookie must match).
  const ws = new (WebSocket as unknown as new (url: string, opts: object) => SocketLike)(
    `wss://livetiming.formula1.com/signalrcore?id=${encodeURIComponent(connectionToken)}`,
    { headers: { 'User-Agent': 'BestHTTP', Cookie: cookies } },
  );
  return feed.run(ws);
}

/** Keep a connection to F1 live timing open; reconnect whenever it drops. */
export async function startFreeLiveFeed() {
  status.freeLive = true;
  feed.ticker = setInterval(() => feed.estimatePositions(), 250);
  for (;;) {
    try {
      await connect();
      status.error = null;
    } catch (err) {
      status.error = `F1 live timing: ${(err as Error).message}`;
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/** For testing without a live session: load a captured snapshot and treat it as live. */
export async function loadSnapshotForTest(result: Obj) {
  for (const [topic, value] of Object.entries(result)) feed.state[topic] = merge(undefined, value);
  await feed.startSession();
  status.connected = true;
  const leader = Object.entries<Obj>(feed.state.TimingData?.Lines ?? {}).find(([, l]) => l.Position === '1')?.[0];
  if (leader) feed.track(leader).lapStart = Date.now() - 20_000;
  feed.ticker ??= setInterval(() => feed.estimatePositions(), 250);
  return feed;
}
export { merge };
