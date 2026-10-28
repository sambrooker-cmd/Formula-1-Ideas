// The live session being followed, held in memory in the same shape as a replay pack. Fed
// OpenF1-style rows (from OpenF1, F1's own timing feed, or the simulator); collects deltas for
// screens that are already showing it. Shared by the Mac server and the hosted site's browser feed.
import { PACK_VERSION, type PackDriver, type PackMeta } from './pack.ts';

export type Row = Record<string, any>;
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const txt = (v: unknown) => (typeof v === 'string' ? v : null);

export const TOPICS = [
  'sessions', 'drivers', 'location', 'car_data', 'laps', 'intervals', 'position',
  'stints', 'pit', 'race_control', 'weather', 'team_radio', 'overtakes',
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Samples {
  loc: { t: number[]; x: number[]; y: number[]; z: number[] };
  car: { t: number[]; speed: number[]; throttle: number[]; brake: number[]; rpm: number[]; gear: number[]; drs: (number | null)[] };
}

/** Insert keeping `t` sorted; messages occasionally arrive slightly out of order. Returns false for duplicates. */
function sortedInsert(t: number[], value: number, cols: unknown[][], values: unknown[]) {
  let i = t.length;
  while (i > 0 && t[i - 1] > value) i--;
  if (i > 0 && t[i - 1] === value) return false;
  if (i === t.length) {
    t.push(value);
    cols.forEach((c, k) => c.push(values[k]));
  } else {
    t.splice(i, 0, value);
    cols.forEach((c, k) => c.splice(i, 0, values[k]));
  }
  return true;
}

export class LiveStore {
  sessionKey: number | null = null;
  session: Row | null = null;
  meeting: Row | null = null;
  t0 = 0;
  drivers = new Map<number, PackDriver>();
  samples = new Map<number, Samples>();
  laps = new Map<string, PackMeta['laps'][number]>();
  intervals: PackMeta['intervals'] = [];
  positions: PackMeta['positions'] = [];
  stints = new Map<string, PackMeta['stints'][number]>();
  pits: PackMeta['pits'] = [];
  raceControl: PackMeta['raceControl'] = [];
  weather: PackMeta['weather'] = [];
  radio: PackMeta['radio'] = [];
  overtakes: PackMeta['overtakes'] = [];
  /** Deltas collected since the last flush to browsers. */
  pending: Record<string, unknown[]> = {};
  lastMessageAt = 0;
  /** Circuit outline, when the feed knows it (free live mode places cars along it). */
  outline: [number, number][] = [];
  /** True when car positions are estimated rather than measured. */
  positionsEstimated = false;

  reset(session: Row, meeting: Row | null) {
    Object.assign(this, new LiveStore());
    this.sessionKey = session.session_key;
    this.session = session;
    this.meeting = meeting;
    this.t0 = ms(session.date_start)! - 2 * 3600e3;
  }

  private rel(iso: string | null | undefined) {
    const t = ms(iso);
    return t == null ? null : t - this.t0;
  }

  private emit(topic: string, tuple: unknown) {
    (this.pending[topic] ??= []).push(tuple);
  }

  private driverSamples(n: number) {
    let s = this.samples.get(n);
    if (!s) {
      s = {
        loc: { t: [], x: [], y: [], z: [] },
        car: { t: [], speed: [], throttle: [], brake: [], rpm: [], gear: [], drs: [] },
      };
      this.samples.set(n, s);
    }
    return s;
  }

  apply(topic: Topic, r: Row) {
    this.lastMessageAt = Date.now();
    switch (topic) {
      case 'drivers': {
        const d: PackDriver = {
          number: r.driver_number,
          code: r.name_acronym ?? String(r.driver_number),
          name: r.full_name ?? '',
          team: r.team_name ?? '',
          colour: r.team_colour ? '#' + r.team_colour : '#888888',
        };
        this.drivers.set(d.number, d);
        this.driverSamples(d.number);
        return this.emit('drivers', d);
      }
      case 'location': {
        if (r.x === 0 && r.y === 0 && r.z === 0) return;
        const t = this.rel(r.date)!;
        const s = this.driverSamples(r.driver_number).loc;
        if (sortedInsert(s.t, t, [s.x, s.y, s.z], [r.x, r.y, r.z ?? 0])) this.emit('location', [r.driver_number, t, r.x, r.y, r.z ?? 0]);
        return;
      }
      case 'car_data': {
        const t = this.rel(r.date)!;
        const c = this.driverSamples(r.driver_number).car;
        const vals = [r.speed ?? 0, r.throttle ?? 0, r.brake ?? 0, r.rpm ?? 0, r.n_gear ?? 0, r.drs ?? null];
        if (sortedInsert(c.t, t, [c.speed, c.throttle, c.brake, c.rpm, c.gear, c.drs], vals)) {
          this.emit('car_data', [r.driver_number, t, ...vals]);
        }
        return;
      }
      case 'laps': {
        const tuple: PackMeta['laps'][number] = [
          r.driver_number, r.lap_number, this.rel(r.date_start), r.lap_duration ?? null,
          r.duration_sector_1 ?? null, r.duration_sector_2 ?? null, r.duration_sector_3 ?? null, r.is_pit_out_lap ? 1 : 0,
          r.segments_sector_1 ? [r.segments_sector_1, r.segments_sector_2 ?? [], r.segments_sector_3 ?? []] : null,
        ];
        this.laps.set(`${r.driver_number}:${r.lap_number}`, tuple); // later versions of a lap replace earlier ones
        return this.emit('laps', tuple);
      }
      case 'intervals': {
        const tuple: PackMeta['intervals'][number] = [
          r.driver_number, this.rel(r.date)!, num(r.gap_to_leader), txt(r.gap_to_leader), num(r.interval), txt(r.interval),
        ];
        this.intervals.push(tuple);
        return this.emit('intervals', tuple);
      }
      case 'position': {
        const tuple: PackMeta['positions'][number] = [r.driver_number, this.rel(r.date)!, r.position];
        this.positions.push(tuple);
        return this.emit('positions', tuple);
      }
      case 'stints': {
        const tuple: PackMeta['stints'][number] = [r.driver_number, r.stint_number, r.lap_start, r.lap_end ?? null, r.compound ?? null, r.tyre_age_at_start ?? null];
        this.stints.set(`${r.driver_number}:${r.stint_number}`, tuple);
        return this.emit('stints', tuple);
      }
      case 'pit': {
        const tuple: PackMeta['pits'][number] = [r.driver_number, this.rel(r.date)!, r.lap_number ?? null, r.pit_duration ?? null, r.lane_duration ?? null, r.stop_duration ?? null];
        this.pits.push(tuple);
        return this.emit('pits', tuple);
      }
      case 'race_control': {
        const tuple: PackMeta['raceControl'][number] = [
          this.rel(r.date)!, r.lap_number ?? null, r.category ?? null, r.flag ?? null, r.scope ?? null, r.sector ?? null, r.driver_number ?? null, r.message ?? '',
          r.qualifying_phase ?? null,
        ];
        this.raceControl.push(tuple);
        return this.emit('raceControl', tuple);
      }
      case 'weather': {
        const tuple: PackMeta['weather'][number] = [
          this.rel(r.date)!, r.air_temperature, r.track_temperature, r.humidity, r.pressure, r.rainfall, r.wind_speed, r.wind_direction,
        ];
        this.weather.push(tuple);
        return this.emit('weather', tuple);
      }
      case 'team_radio': {
        const tuple: PackMeta['radio'][number] = [r.driver_number, this.rel(r.date)!, r.recording_url];
        this.radio.push(tuple);
        return this.emit('radio', tuple);
      }
      case 'overtakes': {
        const tuple: PackMeta['overtakes'][number] = [this.rel(r.date)!, r.overtaking_driver_number, r.overtaken_driver_number, r.position];
        this.overtakes.push(tuple);
        return this.emit('overtakes', tuple);
      }
      case 'sessions':
        return;
    }
  }

  meta(): PackMeta & { live: true } {
    const s = this.session!;
    const byT = <T extends unknown[]>(a: T[], i: number) => [...a].sort((x, y) => (x[i] as number) - (y[i] as number));
    const rc = byT(this.raceControl, 0);
    const started = rc.find((r) => r[2] === 'SessionStatus' && /STARTED/.test(r[7]));
    const finished = [...rc].reverse().find((r) => /SESSION FINISHED/.test(r[7]) || r[3] === 'CHEQUERED');
    let start = Infinity;
    let end = -Infinity;
    for (const d of this.samples.values()) {
      if (d.loc.t.length) [start, end] = [Math.min(start, d.loc.t[0]), Math.max(end, d.loc.t.at(-1)!)];
    }
    const sessionStart = ms(s.date_start)! - this.t0;
    if (!Number.isFinite(start)) [start, end] = [sessionStart - 3600e3, sessionStart - 3600e3 + 1];
    const laps = [...this.laps.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      version: PACK_VERSION,
      live: true,
      session: {
        key: s.session_key,
        year: s.year,
        meetingName: this.meeting?.meeting_name ?? s.location,
        countryName: s.country_name,
        location: s.location,
        circuit: s.circuit_short_name,
        name: s.session_name,
        type: s.session_type,
      },
      t0: this.t0,
      start,
      end,
      raceStart: started ? started[0] : sessionStart,
      raceEnd: finished ? finished[0] : ms(s.date_end)! - this.t0,
      totalLaps: laps.reduce((m, l) => Math.max(m, l[1]), 0),
      drivers: [...this.drivers.values()].sort((a, b) => a.number - b.number),
      laps,
      intervals: byT(this.intervals, 1),
      positions: byT(this.positions, 1),
      stints: [...this.stints.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      pits: byT(this.pits, 1),
      raceControl: rc,
      weather: byT(this.weather, 0),
      radio: byT(this.radio, 1),
      overtakes: byT(this.overtakes, 0),
      results: [],
      grid: [],
      outline: this.outline,
      positionsEstimated: this.positionsEstimated,
    };
  }

}

