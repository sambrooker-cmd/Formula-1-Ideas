import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { listCachedSessions } from './db.ts';
import { ensurePack } from './pack.ts';
import { ingestSession, type Progress } from './ingest.ts';
import { get } from './openf1.ts';
import zlib from 'node:zlib';
import { addClient, liveMeta, liveSamples, liveState, startLiveFeed, startSimulation, stopSimulation } from './live.ts';

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

// ---- ingest jobs (one at a time, so the rate limit is never shared) --------

interface Job {
  sessionKey: number;
  state: 'running' | 'done' | 'error';
  progress: Progress | null;
  error?: string;
}
const jobs: Job[] = [];
let running: Promise<void> = Promise.resolve();

app.post<{ Body: { sessionKey: number } }>('/api/ingest', async (req, reply) => {
  const sessionKey = Number(req.body?.sessionKey);
  if (!sessionKey) return reply.code(400).send({ error: 'sessionKey required' });
  const existing = jobs.find((j) => j.sessionKey === sessionKey && j.state === 'running');
  if (existing) return existing;
  const job: Job = { sessionKey, state: 'running', progress: null };
  jobs.push(job);
  running = running.then(() =>
    ingestSession(sessionKey, (p) => (job.progress = p)).then(
      () => void (job.state = 'done'),
      (err) => {
        job.state = 'error';
        job.error = (err as Error).message;
      },
    ),
  );
  return job;
});

app.get('/api/ingest', async () => jobs.slice(-10));

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
app.get('/api/sync', { websocket: true }, (socket) => {
  peers.add(socket);
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
  socket.on('close', () => peers.delete(socket));
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
console.log(`Pit wall API listening on http://localhost:${PORT}`);
