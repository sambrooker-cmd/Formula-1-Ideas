// Free live mode: F1's own live timing feed (SignalR), which needs no login for timing,
// tyres, race control, track status, weather, lap count and team radio. Since 2025 car
// positions and telemetry need an F1 TV login, so positions here are *estimated*: each car
// is placed along the circuit outline from its lap timing.
//
// Everything is converted into the same rows the OpenF1 feed produces and applied to the
// shared live store, so every panel, the TV delay and alerts work unchanged.
import zlib from 'node:zlib';
import { store, status, announceSession } from './live.ts';
import { getOutline } from './outlines.ts';

const BASE = 'https://livetiming.formula1.com/signalrcore';
const RS = '\x1e'; // SignalR record separator
const TOPICS = [
  'Heartbeat', 'SessionInfo', 'SessionStatus', 'SessionData', 'DriverList', 'TimingData', 'TimingAppData',
  'TimingStats', 'RaceControlMessages', 'TrackStatus', 'WeatherData', 'LapCount', 'TeamRadio',
  'PitLaneTimeCollection', 'ExtrapolatedClock', 'TopThree', 'CarData.z', 'Position.z',
];

type Obj = Record<string, any>;

/** SignalR sends partial updates; arrays arrive as objects keyed by index. */
function merge(target: any, delta: any): any {
  if (delta === null || typeof delta !== 'object') return delta;
  if (Array.isArray(delta)) return delta;
  if (Array.isArray(target)) {
    const out = [...target];
    for (const [k, v] of Object.entries(delta)) if (k !== '_kf') out[Number(k)] = merge(out[Number(k)], v);
    return out;
  }
  const out: Obj = target && typeof target === 'object' ? { ...target } : {};
  for (const [k, v] of Object.entries(delta)) if (k !== '_kf') out[k] = merge(out[k], v);
  return out;
}

const iso = (t: number) => new Date(t).toISOString();
const utc = (s: string) => Date.parse(/Z$|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z');
const num = (s: unknown) => {
  const n = parseFloat(String(s ?? '').replace('+', ''));
  return Number.isFinite(n) ? n : null;
};
/** "1:39.811" → 99.811 */
function lapSeconds(s: unknown) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(s ?? '').trim());
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null;
}
/** "+1.234" → 1.234; "1L" / "2 L" → "+1 LAP"; "LAP 12" or "" (leader) → 0. */
function gapValue(s: unknown): number | string | null {
  const t = String(s ?? '').trim();
  if (t === '' || /^LAP/i.test(t)) return 0;
  const lapped = /^\+?(\d+)\s*L/i.exec(t);
  if (lapped) return `+${lapped[1]} LAP${lapped[1] === '1' ? '' : 'S'}`;
  return num(t);
}

interface DriverTrack {
  position?: string;
  gap?: string;
  interval?: string;
  laps?: number;
  lapStart?: number; // when the current lap began (seen live)
  lapTimes: number[]; // recent completed lap times, for estimating progress
  sectors: (string | null)[];
  segments: (number | null)[][];
  inPitSince?: number;
  inPit?: boolean;
  stintsKey?: string;
  realPositions: boolean;
}

class F1Feed {
  state: Obj = {};
  drivers = new Map<string, DriverTrack>();
  sessionKey: number | null = null;
  outline: [number, number][] = [];
  cumulative: number[] = [];
  ws: WebSocket | null = null;
  ticker: NodeJS.Timeout | null = null;
  phase: number | null = null;
  lastSessionStatus = '';

  track(n: string) {
    let d = this.drivers.get(n);
    if (!d) {
      d = { lapTimes: [], sectors: [null, null, null], segments: [[], [], []], realPositions: false };
      this.drivers.set(n, d);
    }
    return d;
  }

  /** Is the session in the feed actually happening now (rather than last weekend's final state)? */
  isLive() {
    const info = this.state.SessionInfo;
    if (!info?.StartDate) return false;
    const offset = /^(-?)(\d+):(\d+)/.exec(info.GmtOffset ?? '00:00');
    const offMs = offset ? (offset[1] ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000 : 0;
    const start = Date.parse(info.StartDate + 'Z') - offMs;
    const end = Date.parse((info.EndDate ?? info.StartDate) + 'Z') - offMs;
    const finalised = info.SessionStatus === 'Finalised' || info.ArchiveStatus?.Status === 'Complete';
    return !finalised && Date.now() > start - 3600e3 && Date.now() < end + 3 * 3600e3;
  }

  async startSession() {
    const info = this.state.SessionInfo;
    const offset = /^(-?)(\d+):(\d+)/.exec(info.GmtOffset ?? '00:00');
    const offMs = offset ? (offset[1] ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60_000 : 0;
    const start = Date.parse(info.StartDate + 'Z') - offMs;
    const end = Date.parse((info.EndDate ?? info.StartDate) + 'Z') - offMs;
    this.sessionKey = info.Key;
    this.drivers.clear();
    this.phase = null;
    store.reset(
      {
        session_key: info.Key,
        session_name: info.Name,
        session_type: info.Type,
        date_start: iso(start),
        date_end: iso(end),
        year: new Date(start).getUTCFullYear(),
        location: info.Meeting?.Location,
        country_name: info.Meeting?.Country?.Name,
        circuit_short_name: info.Meeting?.Circuit?.ShortName,
        circuit_key: info.Meeting?.Circuit?.Key,
        meeting_key: info.Meeting?.Key,
      },
      { meeting_name: info.Meeting?.Name },
    );
    status.source = 'f1';
    const outline = info.Meeting?.Circuit?.Key != null ? await getOutline(info.Meeting.Circuit.Key) : null;
    this.setOutline(outline ?? []);
    this.processAll(Date.now());
    announceSession();
  }

  setOutline(pts: [number, number][]) {
    this.outline = pts;
    this.cumulative = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    store.outline = pts;
    store.positionsEstimated = pts.length > 0;
  }

  /** A point a fraction (0–1) of the way round the outline. */
  pointAt(f: number): [number, number] | null {
    const pts = this.outline;
    if (pts.length < 2) return null;
    const total = this.cumulative[this.cumulative.length - 1];
    const target = ((f % 1) + 1) % 1 * total;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cumulative[mid] <= target) lo = mid;
      else hi = mid;
    }
    const seg = this.cumulative[hi] - this.cumulative[lo] || 1;
    const k = (target - this.cumulative[lo]) / seg;
    return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * k, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * k];
  }

  // ---- converting F1 topics into live-store rows -----------------------------

  processAll(t: number) {
    for (const topic of ['DriverList', 'TimingAppData', 'TimingData', 'RaceControlMessages', 'WeatherData', 'TeamRadio', 'SessionStatus']) {
      this.process(topic, t);
    }
  }

  process(topic: string, t: number) {
    const s = this.state[topic];
    if (!s || this.sessionKey == null) return;
    switch (topic) {
      case 'DriverList':
        for (const [n, d] of Object.entries<Obj>(s)) {
          if (!d?.Tla) continue;
          store.apply('drivers', {
            driver_number: Number(n), name_acronym: d.Tla, full_name: d.FullName, team_name: d.TeamName, team_colour: d.TeamColour,
          });
        }
        return;
      case 'TimingData':
        return this.timing(s, t);
      case 'TimingAppData':
        for (const [n, line] of Object.entries<Obj>(s.Lines ?? {})) {
          const stints: Obj[] = Array.isArray(line.Stints) ? line.Stints : Object.values(line.Stints ?? {});
          const key = JSON.stringify(stints.map((x) => [x?.Compound, x?.TotalLaps, x?.StartLaps]));
          const d = this.track(n);
          if (d.stintsKey === key) continue;
          d.stintsKey = key;
          let lapStart = 1;
          stints.forEach((st, i) => {
            if (!st) return;
            const length = Math.max(0, (st.TotalLaps ?? 0) - (st.StartLaps ?? 0));
            store.apply('stints', {
              driver_number: Number(n), stint_number: i + 1, lap_start: lapStart, lap_end: lapStart + Math.max(0, length - 1),
              compound: st.Compound, tyre_age_at_start: st.StartLaps ?? 0,
            });
            lapStart += length;
          });
        }
        return;
      case 'RaceControlMessages': {
        const msgs: Obj[] = Array.isArray(s.Messages) ? s.Messages : Object.values(s.Messages ?? {});
        for (const m of msgs) {
          if (!m?.Utc) continue;
          store.apply('race_control', {
            date: iso(utc(m.Utc)), lap_number: m.Lap ?? null, category: m.Category ?? null, flag: m.Flag ?? null, scope: m.Scope ?? null,
            sector: m.Sector ?? null, driver_number: m.RacingNumber ? Number(m.RacingNumber) : null, message: m.Message ?? '',
          });
        }
        return;
      }
      case 'WeatherData':
        store.apply('weather', {
          date: iso(t), air_temperature: num(s.AirTemp), track_temperature: num(s.TrackTemp), humidity: num(s.Humidity),
          pressure: num(s.Pressure), rainfall: num(s.Rainfall), wind_speed: num(s.WindSpeed), wind_direction: num(s.WindDirection),
        });
        return;
      case 'TeamRadio': {
        const caps: Obj[] = Array.isArray(s.Captures) ? s.Captures : Object.values(s.Captures ?? {});
        const base = `https://livetiming.formula1.com/static/${this.state.SessionInfo?.Path ?? ''}`;
        for (const c of caps) {
          if (!c?.Utc || !c.Path) continue;
          store.apply('team_radio', { driver_number: Number(c.RacingNumber), date: iso(utc(c.Utc)), recording_url: base + c.Path });
        }
        return;
      }
      case 'SessionStatus': {
        // Qualifying phases and the start/finish come through here; record them like race control does.
        const st = s.Status as string;
        if (!st || st === this.lastSessionStatus) return;
        this.lastSessionStatus = st;
        const part = this.state.TimingData?.SessionPart ?? null;
        if (st === 'Started') {
          this.phase = part;
          // Lights out: every car starts lap 1 now (practice and qualifying laps start at the line instead).
          if (this.state.SessionInfo?.Type === 'Race') for (const n of Object.keys(this.state.DriverList ?? {})) this.track(n).lapStart = t;
          store.apply('race_control', { date: iso(t), category: 'SessionStatus', message: 'SESSION STARTED', qualifying_phase: part });
        } else if (st === 'Finished' || st === 'Ends') {
          store.apply('race_control', { date: iso(t), category: 'SessionStatus', message: 'SESSION FINISHED', qualifying_phase: this.phase });
        }
        return;
      }
    }
  }

  timing(s: Obj, t: number) {
    for (const [n, line] of Object.entries<Obj>(s.Lines ?? {})) {
      const d = this.track(n);
      const dn = Number(n);
      if (line.Position && line.Position !== d.position) {
        d.position = line.Position;
        store.apply('position', { driver_number: dn, date: iso(t), position: Number(line.Position) });
      }
      const gap = line.GapToLeader ?? '';
      const interval = line.IntervalToPositionAhead?.Value ?? '';
      if (gap !== d.gap || interval !== d.interval) {
        d.gap = gap;
        d.interval = interval;
        store.apply('intervals', { driver_number: dn, date: iso(t), gap_to_leader: gapValue(gap), interval: gapValue(interval) });
      }
      // Remember sector times and mini-sectors as they arrive, for when the lap completes.
      const sectors: Obj[] = Array.isArray(line.Sectors) ? line.Sectors : Object.values(line.Sectors ?? {});
      sectors.forEach((sec, i) => {
        if (!sec || i > 2) return;
        if (sec.Value) d.sectors[i] = sec.Value;
        const segs: Obj[] = Array.isArray(sec.Segments) ? sec.Segments : Object.values(sec.Segments ?? {});
        d.segments[i] = segs.map((g) => g?.Status ?? null);
      });
      // A new lap: record the one just finished and start timing the next.
      const laps = line.NumberOfLaps;
      if (typeof laps === 'number' && laps !== d.laps) {
        const first = d.laps === undefined;
        d.laps = laps;
        const duration = lapSeconds(line.LastLapTime?.Value);
        if (!first && duration) {
          d.lapTimes = [...d.lapTimes.slice(-4), duration];
          store.apply('laps', {
            driver_number: dn, lap_number: laps, date_start: iso(t - duration * 1000), lap_duration: duration,
            duration_sector_1: lapSeconds(d.sectors[0]), duration_sector_2: lapSeconds(d.sectors[1]), duration_sector_3: lapSeconds(d.sectors[2]),
            is_pit_out_lap: false, segments_sector_1: d.segments[0], segments_sector_2: d.segments[1], segments_sector_3: d.segments[2],
          });
        } else if (duration) {
          d.lapTimes = [duration];
        }
        if (!first) d.lapStart = t;
        store.apply('laps', { driver_number: dn, lap_number: laps + 1, date_start: iso(t), lap_duration: null, is_pit_out_lap: !!line.PitOut });
        d.sectors = [null, null, null];
      }
      // Pit stops: from entering the pit lane to leaving it.
      if (line.InPit !== undefined && line.InPit !== d.inPit) {
        if (line.InPit) d.inPitSince = t;
        else if (d.inPitSince != null) {
          store.apply('pit', { driver_number: dn, date: iso(d.inPitSince), lap_number: d.laps ?? null, lane_duration: (t - d.inPitSince) / 1000 });
          d.inPitSince = undefined;
        }
        d.inPit = line.InPit;
      }
    }
  }

  /** Estimated car positions, 4 times a second, from each car's progress through its lap. */
  estimatePositions() {
    if (this.sessionKey == null || this.outline.length < 2) return;
    const t = Date.now();
    const lines: Obj = this.state.TimingData?.Lines ?? {};
    // Behind the Safety Car (or VSC) laps are much slower.
    const track = String(this.state.TrackStatus?.Status ?? '1');
    const slow = track === '4' || track === '6' || track === '7' ? 1.4 : 1;
    const typical = (median([...this.drivers.values()].flatMap((d) => d.lapTimes)) ?? 95) * slow;
    const progress = (d: DriverTrack) =>
      d.lapStart != null ? Math.min(0.995, (t - d.lapStart) / 1000 / ((median(d.lapTimes) ?? typical / slow) * slow)) : null;

    // The leader, for cars whose lap start we haven't seen yet (e.g. joined mid-race).
    const leaderNo = Object.keys(lines).find((n) => lines[n]?.Position === '1');
    const leaderF = leaderNo ? progress(this.track(leaderNo)) : null;

    for (const [n, d] of this.drivers) {
      if (d.realPositions || lines[n]?.Retired || lines[n]?.Stopped) continue;
      let f: number | null;
      if (d.inPit) f = 0.985; // pit lane runs alongside the start/finish straight at most tracks
      else f = progress(d);
      if (f == null && leaderF != null && this.state.SessionInfo?.Type === 'Race') {
        const gap = gapValue(lines[n]?.GapToLeader);
        if (typeof gap === 'number') f = leaderF - gap / typical;
      }
      if (f == null) continue;
      const p = this.pointAt(f);
      if (p) store.apply('location', { driver_number: Number(n), date: iso(t), x: Math.round(p[0]), y: Math.round(p[1]), z: 1 });
    }
  }

  /** Real positions and telemetry, if F1 ever sends them without a login. */
  compressed(topic: string, payload: string) {
    try {
      const data = JSON.parse(zlib.inflateRawSync(Buffer.from(payload, 'base64')).toString());
      if (topic === 'Position.z') {
        for (const frame of data.Position ?? []) {
          for (const [n, e] of Object.entries<Obj>(frame.Entries ?? {})) {
            this.track(n).realPositions = true;
            store.apply('location', { driver_number: Number(n), date: frame.Timestamp, x: e.X, y: e.Y, z: e.Z });
          }
        }
      } else if (topic === 'CarData.z') {
        for (const e of data.Entries ?? []) {
          for (const [n, car] of Object.entries<Obj>(e.Cars ?? {})) {
            const c = car.Channels ?? {};
            store.apply('car_data', { driver_number: Number(n), date: e.Utc, rpm: c['0'], speed: c['2'], n_gear: c['3'], throttle: c['4'], brake: c['5'], drs: c['45'] });
          }
        }
      }
    } catch {
      // ignore anything we can't decode
    }
  }

  // ---- connection ------------------------------------------------------------

  async connect() {
    const neg = await fetch(`${BASE}/negotiate?negotiateVersion=1`, { method: 'POST', headers: { 'User-Agent': 'BestHTTP' } });
    if (!neg.ok) throw new Error(`F1 live timing refused the connection (${neg.status})`);
    const cookies = (neg.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const { connectionToken } = (await neg.json()) as { connectionToken: string };
    // Node's built-in WebSocket accepts extra headers (the load balancer cookie must match).
    const ws = new (WebSocket as unknown as new (url: string, opts: object) => WebSocket)(
      `wss://livetiming.formula1.com/signalrcore?id=${encodeURIComponent(connectionToken)}`,
      { headers: { 'User-Agent': 'BestHTTP', Cookie: cookies } },
    );
    this.ws = ws;
    let handshaken = false;
    ws.addEventListener('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS));
    ws.addEventListener('message', (ev) => {
      for (const part of String(ev.data).split(RS).filter(Boolean)) {
        let m: Obj;
        try {
          m = JSON.parse(part);
        } catch {
          continue;
        }
        if (!handshaken) {
          handshaken = true;
          status.connected = true;
          ws.send(JSON.stringify({ type: 1, target: 'Subscribe', arguments: [TOPICS], invocationId: '0' }) + RS);
          continue;
        }
        if (m.type === 3 && m.result) void this.snapshot(m.result);
        else if (m.type === 1 && m.target === 'feed') this.onFeed(m.arguments[0], m.arguments[1], m.arguments[2]);
        else if (m.type === 6) ws.send(JSON.stringify({ type: 6 }) + RS); // ping → pong
      }
    });
    return new Promise<void>((resolve) => {
      ws.addEventListener('close', () => {
        status.connected = false;
        resolve();
      });
      ws.addEventListener('error', () => {
        status.connected = false;
      });
    });
  }

  async snapshot(result: Obj) {
    for (const [topic, value] of Object.entries(result)) {
      if (topic.endsWith('.z')) this.compressed(topic, value as string);
      else this.state[topic] = merge(undefined, value);
    }
    await this.check();
  }

  onFeed(topic: string, delta: unknown, when: string) {
    const t = when ? Date.parse(when) : Date.now();
    if (topic.endsWith('.z')) {
      if (this.sessionKey != null) this.compressed(topic, delta as string);
      return;
    }
    this.state[topic] = merge(this.state[topic], delta);
    if (topic === 'SessionInfo') void this.check();
    else if (this.sessionKey != null) this.process(topic, t);
  }

  /** Start (or stop) mirroring the session depending on whether it's live. */
  async check() {
    if (status.source === 'simulation' || status.source === 'openf1') return;
    const key = this.state.SessionInfo?.Key ?? null;
    if (this.isLive()) {
      if (key !== this.sessionKey) await this.startSession();
    } else if (this.sessionKey != null) {
      this.sessionKey = null; // keep the finished session's data until the next one starts
    }
  }
}

function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const feed = new F1Feed();

/** Keep a connection to F1 live timing open; reconnect whenever it drops. */
export async function startFreeLiveFeed() {
  status.freeLive = true;
  feed.ticker = setInterval(() => feed.estimatePositions(), 250);
  for (;;) {
    try {
      await feed.connect();
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
