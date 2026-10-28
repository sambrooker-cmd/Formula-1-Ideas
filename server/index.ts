import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { listCachedSessions } from './db.ts';
import { ensurePack } from './pack.ts';
import { get } from './openf1.ts';
import zlib from 'node:zlib';
import { season, standingsBefore } from './season.ts';
import { enqueueIngest, recentJobs } from './jobs.ts';
import { autoStatus, readSettings, startAutoDownload, writeSettings } from './autodownload.ts';
import { addClient, liveMeta, liveSamples, liveState, startLiveFeed, startSimulation, status, stopSimulation } from './live.ts';
import { startFreeLiveFeed } from './f1live.ts';
import { prefetchNextOutline } from './outlines.ts';
import { credentials } from './env.ts';

const PORT = Number(process.env.PORT ?? 8787);
const app = Fastify({ logger: { level: 'warn' } });
await app.register(fastifyWebsocket);

// ---- cached sessions -------------------------------------------------------

app.get('/api/sessions', async () => listCachedSessions());

function sendGz(reply: any, file: string, type: string) {
  return reply
    .header('content-type', type)
    .header('content-encoding', 'gzip')
    .header('cache-control', 'private, max-age=3600')
    .send(fs.createReadStream(file));
}

app.get<{ Params: { key: string } }>('/api/sessions/:key/meta', async (req, reply) => {
  const p = ensurePack(Number(req.params.key));
  if (!p) return reply.code(404).send({ error: 'Session not cached' });
  return sendGz(reply, p.meta, 'application/json');
});

app.get<{ Params: { key: string } }>('/api/sessions/:key/samples', async (req, reply) => {
  const p = ensurePack(Number(req.params.key));
  if (!p) return reply.code(404).send({ error: 'Session not cached' });
  return sendGz(reply, p.samples, 'application/octet-stream');
});

// ---- catalogue (what could be ingested), via the same throttled client -----

const catalogue = new Map<string, unknown>();
async function cachedGet(endpoint: string, query: string) {
  const k = endpoint + '?' + query;
  if (!catalogue.has(k)) catalogue.set(k, await get(endpoint, query));
  return catalogue.get(k);
}

app.get<{ Querystring: { year: string } }>('/api/catalogue/meetings', async (req) =>
  cachedGet('meetings', `year=${Number(req.query.year)}`),
);
app.get<{ Querystring: { meeting_key: string } }>('/api/catalogue/sessions', async (req) =>
  cachedGet('sessions', `meeting_key=${Number(req.query.meeting_key)}`),
);

// ---- download jobs and auto-download ------------------------------------------

app.post<{ Body: { sessionKey: number } }>('/api/ingest', async (req, reply) => {
  const sessionKey = Number(req.body?.sessionKey);
  if (!sessionKey) return reply.code(400).send({ error: 'sessionKey required' });
  return enqueueIngest(sessionKey);
});

app.get('/api/ingest', async () => recentJobs());

app.get('/api/settings', async () => ({ ...readSettings(), auto: autoStatus }));
app.post<{ Body: { autoDownload?: boolean } }>('/api/settings', async (req) => {
  const patch = typeof req.body?.autoDownload === 'boolean' ? { autoDownload: req.body.autoDownload } : {};
  return { ...writeSettings(patch), auto: autoStatus };
});

// ---- season calendar & standings (Jolpica) --------------------------------

app.get<{ Querystring: { year?: string } }>('/api/season', async (req, reply) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  try {
    return await season(year);
  } catch (err) {
    return reply.code(502).send({ error: `Couldn't load the ${year} season: ${(err as Error).message}` });
  }
});

app.get<{ Querystring: { year: string; date: string; kind?: string } }>('/api/standings-before', async (req, reply) => {
  try {
    return await standingsBefore(Number(req.query.year), req.query.date, req.query.kind === 'sprint' ? 'sprint' : 'race');
  } catch (err) {
    return reply.code(502).send({ error: (err as Error).message });
  }
});

// ---- live mode ---------------------------------------------------------------

app.get('/api/live', async () => liveState());

app.get('/api/live/meta', async (_req, reply) => {
  const meta = liveMeta();
  if (!meta) return reply.code(404).send({ error: 'No live session' });
  return reply.header('content-type', 'application/json').header('content-encoding', 'gzip').header('cache-control', 'no-store')
    .send(zlib.gzipSync(JSON.stringify(meta), { level: 1 }));
});

app.get('/api/live/samples', async (_req, reply) => {
  const buf = liveSamples();
  if (!buf) return reply.code(404).send({ error: 'No live session' });
  return reply.header('content-type', 'application/octet-stream').header('content-encoding', 'gzip').header('cache-control', 'no-store')
    .send(zlib.gzipSync(buf, { level: 1 }));
});

app.get('/api/live/stream', { websocket: true }, (socket) => addClient(socket));

app.post<{ Body: { sessionKey: number; fromLap?: number; speed?: number } }>('/api/live/simulate', async (req, reply) => {
  try {
    startSimulation(Number(req.body.sessionKey), Number(req.body.fromLap ?? 1), Number(req.body.speed ?? 1));
    return liveState();
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.post('/api/live/stop', async () => {
  stopSimulation();
  return liveState();
});

// ---- sync relay: lets other devices on the LAN follow the same clock ------

const peers = new Set<WebSocket>();
/** Tell every window how many are linked, so each can show it. */
const announcePeers = () => {
  const text = JSON.stringify({ type: 'peers', count: peers.size });
  for (const p of peers) if (p.readyState === 1) p.send(text);
};
app.get('/api/sync', { websocket: true }, (socket) => {
  peers.add(socket);
  announcePeers();
  socket.on('message', (raw) => {
    const text = raw.toString();
    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() }));
      return;
    }
    for (const p of peers) if (p !== socket && p.readyState === 1) p.send(text);
  });
  socket.on('close', () => {
    peers.delete(socket);
    announcePeers();
  });
});

// ---- production: serve the built frontend ----------------------------------

const dist = path.resolve('dist');
if ((process.env.NODE_ENV === 'production' || process.argv.includes('--production')) && fs.existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html'),
  );
}

await app.listen({ port: PORT, host: '0.0.0.0' });
void startLiveFeed();
// Without an OpenF1 login, follow sessions through F1's free timing feed instead.
if (process.env.PITWALL_F1_SNAPSHOT) {
  // Development: replay a captured F1 timing snapshot as if it were live.
  const { loadSnapshotForTest } = await import('./f1live.ts');
  status.freeLive = true;
  await loadSnapshotForTest(JSON.parse(fs.readFileSync(process.env.PITWALL_F1_SNAPSHOT, 'utf8')));
} else if (!credentials && process.env.PITWALL_FREE_LIVE !== '0') void startFreeLiveFeed();
// Fetch the next circuit's outline ahead of the weekend (OpenF1's free tier closes during sessions).
void prefetchNextOutline();
setInterval(prefetchNextOutline, 6 * 3600e3);
startAutoDownload();
console.log(`Pit wall API listening on http://localhost:${PORT}`);
