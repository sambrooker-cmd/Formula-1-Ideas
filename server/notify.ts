// Notifications for the hosted Pit Wall, sent from a GitHub Action every 10 minutes (see
// .github/workflows/notify.yml), so they arrive even when every Pit Wall window is closed:
//   - reminders shortly before sessions start (schedule from Jolpica)
//   - during a session: Safety Car, Virtual Safety Car, red flag and restarts (from F1 live timing)
//   - results: the podium after a race or sprint, pole after qualifying
//
// Devices subscribe from the site (web push); their subscriptions live in the Firebase
// database under rooms/<uid>/push. The keys that sign the pushes are made on the first run and
// kept in the database too, so there's nothing extra to set up.
//
// Usage:  tsx server/notify.ts reminders   (also prints whether a session is on: live=true/false)
//         tsx server/notify.ts live        (follow the session now on, until it ends)
//         tsx server/notify.ts test        (send a test notification to every device)
// Needs FIREBASE_SERVICE_ACCOUNT (the JSON key). NOTIFY_DRY_RUN=1 prints instead of sending.
import crypto from 'node:crypto';
import fs from 'node:fs';
import webpush from 'web-push';
import { F1Feed, F1_SOCKET, type SocketLike } from '../shared/f1feed.ts';
import { LiveStore } from '../shared/livestore.ts';

type Obj = Record<string, any>;
const DRY = !!process.env.NOTIFY_DRY_RUN;
/** For testing the schedule: pretend it's this time (ISO). */
const clock = () => (process.env.NOTIFY_NOW ? Date.parse(process.env.NOTIFY_NOW) : Date.now());
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- Firebase database over REST (the service account's token bypasses the rules) ----------

const hosting = JSON.parse(fs.readFileSync(new URL('../web/src/hosting.config.json', import.meta.url), 'utf8'));
const DB_URL: string = hosting.firebase?.databaseURL;
let token: { value: string; exp: number } | null = null;

async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is missing or incomplete');
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url')}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google sign-in for the service account failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function db(method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) {
  const res = await fetch(`${DB_URL}/${path}.json?access_token=${await accessToken()}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Database ${method} ${path} failed (${res.status})`);
  return res.json();
}

// ---- devices and sending ---------------------------------------------------------------

export interface Prefs {
  /** Before which sessions: none, qualifying/sprints/race, or every session. */
  reminders: 'off' | 'main' | 'all';
  /** Safety Car, VSC, red flags and restarts. */
  incidents: boolean;
  /** Podium after races and sprints, pole after qualifying. */
  results: boolean;
}
type Kind = 'reminder-main' | 'reminder-all' | 'incident' | 'result' | 'test';
interface Message {
  title: string;
  body: string;
  /** Where tapping it goes. */
  url: string;
  /** Replaces an earlier notification with the same tag. */
  tag: string;
  kind: Kind;
}

async function vapid() {
  let keys = (await db('GET', 'notify/vapid')) as { publicKey: string; privateKey: string } | null;
  if (!keys?.publicKey) {
    keys = webpush.generateVAPIDKeys();
    await db('PUT', 'notify/vapid', keys);
    log('made new signing keys for notifications');
  }
  // The site reads the public half from here when a device signs up.
  await db('PUT', 'notify/public/vapidKey', keys.publicKey);
  webpush.setVapidDetails(`mailto:${hosting.allowedEmails?.[0] ?? 'pitwall@example.com'}`, keys.publicKey, keys.privateKey);
}

const wants = (p: Prefs, kind: Kind) =>
  kind === 'test' ||
  (kind === 'reminder-main' && p.reminders !== 'off') ||
  (kind === 'reminder-all' && p.reminders === 'all') ||
  (kind === 'incident' && p.incidents) ||
  (kind === 'result' && p.results);

/** Send to every device that wants this kind, once per id (ids are remembered for a fortnight). */
async function send(id: string, msg: Message) {
  const safeId = crypto.createHash('sha1').update(id).digest('hex').slice(0, 20); // database keys can't hold every character
  if (!DRY && (await db('GET', `notify/sent/${safeId}`))) return;
  log(`${DRY ? '[dry run] ' : ''}${msg.title}: ${msg.body}`);
  if (DRY) return;
  await db('PUT', `notify/sent/${safeId}`, Date.now());
  const rooms = ((await db('GET', 'rooms')) ?? {}) as Record<string, { push?: Record<string, { sub: webpush.PushSubscription; prefs: Prefs }> }>;
  for (const [uid, room] of Object.entries(rooms)) {
    for (const [devId, dev] of Object.entries(room.push ?? {})) {
      if (!dev?.sub?.endpoint || !wants(dev.prefs ?? { reminders: 'main', incidents: true, results: true }, msg.kind)) continue;
      try {
        await webpush.sendNotification(dev.sub, JSON.stringify(msg), { TTL: msg.kind.startsWith('reminder') ? 1800 : 900, urgency: 'high' });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          log(`device ${devId} has unsubscribed; removing it`);
          await db('DELETE', `rooms/${uid}/push/${devId}`);
        } else log(`couldn't reach device ${devId}: ${code ?? (err as Error).message}`);
      }
    }
  }
}

async function tidySent() {
  const sent = ((await db('GET', 'notify/sent')) ?? {}) as Record<string, number>;
  for (const [k, at] of Object.entries(sent)) if (Date.now() - at > 14 * 86_400e3) await db('DELETE', `notify/sent/${k}`);
}

// ---- the schedule ----------------------------------------------------------------------

interface Session {
  id: string;
  meeting: string;
  name: string;
  main: boolean;
  start: number;
  /** How long to keep following it for live alerts. */
  length: number;
}

const SESSIONS: [key: string, name: string, main: boolean, minutes: number][] = [
  ['FirstPractice', 'Practice 1', false, 75],
  ['SecondPractice', 'Practice 2', false, 75],
  ['ThirdPractice', 'Practice 3', false, 75],
  ['SprintQualifying', 'Sprint qualifying', true, 60],
  ['Sprint', 'Sprint', true, 75],
  ['Qualifying', 'Qualifying', true, 90],
];

async function schedule(): Promise<Session[]> {
  const year = new Date().getUTCFullYear();
  const out: Session[] = [];
  for (const y of [year, year + 1]) {
    const res = await fetch(`https://api.jolpi.ca/ergast/f1/${y}.json?limit=100`);
    if (!res.ok) continue;
    const races: Obj[] = (await res.json()).MRData?.RaceTable?.Races ?? [];
    for (const r of races) {
      const at = (s: Obj | undefined) => (s?.date && s?.time ? Date.parse(`${s.date}T${s.time}`) : NaN);
      const meeting = String(r.raceName).replace('Grand Prix', 'GP');
      for (const [key, name, main, minutes] of SESSIONS) {
        const start = at(r[key]);
        if (Number.isFinite(start)) out.push({ id: `${r.season}-${r.round}-${key}`, meeting, name, main, start, length: minutes * 60e3 });
      }
      const start = at(r);
      if (Number.isFinite(start)) out.push({ id: `${r.season}-${r.round}-Race`, meeting, name: 'Race', main: true, start, length: 180 * 60e3 });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The session happening now (from 10 minutes before it starts), if any. */
const current = (list: Session[], now = clock()) => list.find((s) => now >= s.start - 10 * 60e3 && now < s.start + s.length);

async function reminders() {
  const list = await schedule();
  const now = clock();
  for (const s of list) {
    const mins = Math.round((s.start - now) / 60e3);
    // The Action runs every 10 minutes (often a little late), so remind from 40 minutes out.
    if (mins < 2 || mins > 40) continue;
    await send(`rem-${s.id}`, {
      title: `${s.meeting}: ${s.name} in ${mins} minutes`,
      body: `Starts at ${new Date(s.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })} UK time. Live timing is on the Pit Wall.`,
      url: '/',
      tag: `rem-${s.id}`,
      kind: s.main ? 'reminder-main' : 'reminder-all',
    });
  }
  const on = current(list);
  log(on ? `on now: ${on.meeting} ${on.name}` : 'no session on');
  return on;
}

// ---- following a session live ------------------------------------------------------------

/** Watches F1 live timing for flags and results. Uses the shared feed only for its connection and state. */
class Watcher extends F1Feed {
  seenRcm = 0;
  finished = false;
  constructor(private session: Session) {
    super(new LiveStore(), { getOutline: async () => null, paused: () => true });
  }

  get title() {
    const info = this.state.SessionInfo;
    return info ? `${String(info.Meeting?.Name ?? this.session.meeting).replace('Grand Prix', 'GP')} ${info.Name ?? ''}`.trim() : `${this.session.meeting} ${this.session.name}`;
  }
  get isThisSession() {
    // The feed shows the last session until the next one begins; make sure it's this one.
    const info = this.state.SessionInfo;
    if (!info?.StartDate) return false;
    const offset = /^(-?)(\d+):(\d+)/.exec(info.GmtOffset ?? '00:00');
    const offMs = offset ? (offset[1] ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000 : 0;
    return Math.abs(Date.parse(info.StartDate + 'Z') - offMs - this.session.start) < 3 * 3600e3;
  }
  code(n: string) {
    return this.state.DriverList?.[n]?.Tla ?? n;
  }
  order() {
    return Object.entries<Obj>(this.state.TimingData?.Lines ?? {})
      .filter(([, l]) => Number(l.Position) > 0)
      .sort((a, b) => Number(a[1].Position) - Number(b[1].Position))
      .map(([n, l]) => ({ n, gap: String(l.GapToLeader ?? l.TimeDiffToFastest ?? ''), best: l.BestLapTime?.Value as string | undefined }));
  }
  lapText() {
    const lap = this.state.LapCount?.CurrentLap;
    return lap ? `lap ${lap}${this.state.LapCount?.TotalLaps ? ` of ${this.state.LapCount.TotalLaps}` : ''}` : '';
  }
  leaderText() {
    const [a, b] = this.order();
    if (!a) return '';
    return b ? ` ${this.code(a.n)} leads ${this.code(b.n)}${/^\+?\d/.test(b.gap) ? ` by ${b.gap.replace('+', '')}s` : ''}.` : ` ${this.code(a.n)} leads.`;
  }

  override async snapshot(result: Obj) {
    await super.snapshot(result);
    // Don't repeat what happened before we connected, apart from the last few minutes.
    const msgs = this.messages();
    this.seenRcm = msgs.findIndex((m) => Date.now() - Date.parse(m.Utc + (m.Utc?.endsWith('Z') ? '' : 'Z')) < 5 * 60e3);
    if (this.seenRcm < 0) this.seenRcm = msgs.length;
    await this.look();
  }
  override onFeed(topic: string, delta: unknown, when: string) {
    super.onFeed(topic, delta, when);
    if (topic === 'RaceControlMessages' || topic === 'SessionStatus') void this.look();
  }
  messages(): Obj[] {
    const m = this.state.RaceControlMessages?.Messages;
    return Array.isArray(m) ? m : Object.values(m ?? {});
  }

  async look() {
    if (!this.isThisSession) return;
    const msgs = this.messages();
    const isRace = /^(Race|Sprint)$/.test(this.state.SessionInfo?.Name ?? '') || this.session.name === 'Race' || this.session.name === 'Sprint';
    for (; this.seenRcm < msgs.length; this.seenRcm++) {
      const m = msgs[this.seenRcm];
      const text = String(m.Message ?? '');
      const id = `${this.state.SessionInfo?.Key ?? this.session.id}-${m.Utc}-${text.slice(0, 40)}`;
      const say = (title: string, body: string) => send(id, { title: `${title} · ${this.title}`, body, url: '/', tag: `live-${this.session.id}`, kind: 'incident' });
      const lap = this.lapText();
      if (/VIRTUAL SAFETY CAR DEPLOYED/.test(text)) await say('Virtual Safety Car', `VSC deployed${lap ? ` on ${lap}` : ''}.${isRace ? this.leaderText() : ''}`);
      else if (/VIRTUAL SAFETY CAR ENDING/.test(text)) await say('VSC ending', 'Racing resumes shortly.');
      else if (/SAFETY CAR DEPLOYED/.test(text)) await say('Safety Car', `Safety Car deployed${lap ? ` on ${lap}` : ''}.${isRace ? this.leaderText() : ''}`);
      else if (/SAFETY CAR IN THIS LAP/.test(text)) await say('Restart coming', `The Safety Car comes in at the end of this lap.${this.leaderText()}`);
      else if (m.Flag === 'RED') await say('Red flag', `The session is stopped${lap ? ` on ${lap}` : ''}.${isRace ? this.leaderText() : ''}`);
      else if (/RESUME|WILL RESTART AT/.test(text) && m.Category !== 'SafetyCar') await say('Restart', `${text.charAt(0) + text.slice(1).toLowerCase()}${/ AT \d/.test(text) ? ' (local time at the track)' : ''}`);
    }
    const status = this.state.SessionStatus?.Status;
    if ((status === 'Finished' || status === 'Finalised' || status === 'Ends') && !this.finished) {
      const part = this.state.TimingData?.SessionPart;
      const quali = /Qualifying/.test(this.session.name);
      if (quali && part != null && part < 3) return; // Q1 or Q2 just ended
      this.finished = true;
      // Give the last cars time to cross the line before reading the order.
      await new Promise((r) => setTimeout(r, DRY ? 0 : 45_000));
      const top = this.order().slice(0, 3).map((o) => this.code(o.n));
      if (isRace && top.length)
        await send(`res-${this.session.id}`, {
          title: `${this.title}: ${top[0]} wins`,
          body: `Podium: ${top.join(', ')}. The replay will be on the Pit Wall in a couple of hours.`,
          url: '/',
          tag: `res-${this.session.id}`,
          kind: 'result',
        });
      else if (quali && top.length) {
        const pole = this.order()[0];
        await send(`res-${this.session.id}`, {
          title: `${this.title}: pole for ${top[0]}`,
          body: `${top[0]}${pole?.best ? ` (${pole.best})` : ''} ahead of ${top.slice(1).join(' and ')}.`,
          url: '/',
          tag: `res-${this.session.id}`,
          kind: 'result',
        });
      }
    }
  }
}

async function connect() {
  const neg = await fetch('https://livetiming.formula1.com/signalrcore/negotiate?negotiateVersion=1', { method: 'POST', headers: { 'User-Agent': 'BestHTTP' } });
  if (!neg.ok) throw new Error(`F1 live timing refused the connection (${neg.status})`);
  const cookies = (neg.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const { connectionToken } = (await neg.json()) as { connectionToken: string };
  return new (WebSocket as unknown as new (url: string, opts: object) => SocketLike)(`${F1_SOCKET}?id=${encodeURIComponent(connectionToken)}`, {
    headers: { 'User-Agent': 'BestHTTP', Cookie: cookies },
  });
}

async function live(session: Session) {
  const w = new Watcher(session);
  const until = session.start + session.length + 30 * 60e3;
  log(`following ${session.meeting} ${session.name} until ${new Date(until).toISOString().slice(11, 16)} UTC`);
  while (Date.now() < until && !w.finished) {
    try {
      const ws = await connect();
      // Stop once the session's over (or the time's up), and reconnect if the feed drops.
      const timer = setInterval(() => (w.finished || Date.now() >= until) && ws.close(), 15_000);
      await w.run(ws);
      clearInterval(timer);
    } catch (err) {
      log(`live timing: ${(err as Error).message}`);
    }
    if (!w.finished) await new Promise((r) => setTimeout(r, 10_000));
  }
  log('done');
}

// ---- entry ----------------------------------------------------------------------------

const mode = process.argv[2] ?? 'reminders';
if (!DRY) await vapid();
if (mode === 'test') {
  await send(`test-${Date.now()}`, { title: 'Pit Wall', body: 'Notifications are working on this device.', url: '/', tag: 'test', kind: 'test' });
} else if (mode === 'live') {
  const on = current(await schedule());
  if (on) await live(on);
  else log('no session on');
} else if (mode === 'replay') {
  // For testing: run a captured live-timing snapshot through the watcher (NOTIFY_DRY_RUN=1).
  const snap = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const w = new Watcher({ id: 'test', meeting: 'Test', name: process.argv[4] ?? 'Race', main: true, start: Date.now(), length: 3600e3 });
  Object.defineProperty(w, 'isThisSession', { get: () => true });
  await w.snapshot(snap);
  w.seenRcm = 0;
  await w.look();
} else {
  const on = await reminders();
  if (!DRY) await tidySent();
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `live=${on ? 'true' : 'false'}\n`);
}
