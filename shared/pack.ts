// The "replay pack" the server sends to the browser for one session.
// All times are integer milliseconds relative to `t0` (an epoch ms reference).
// Event lists are compact tuples rather than objects to keep the payload small.

export const PACK_VERSION = 2;

export interface PackMeta {
  version: number;
  session: {
    key: number;
    year: number;
    meetingName: string;
    countryName: string;
    location: string;
    circuit: string;
    name: string;
    type: string;
  };
  t0: number;
  /** First and last moment there is any data. */
  start: number;
  end: number;
  /** "SESSION STARTED" (lights out for a race) and "SESSION FINISHED"/chequered flag. */
  raceStart: number;
  raceEnd: number;
  totalLaps: number;
  drivers: PackDriver[];
  /** [driver, lap, tStart, duration s, s1, s2, s3, pitOut 0/1, mini-sector codes per sector (2048 yellow, 2049 green, 2051 purple, 2064 pit) or null] */
  laps: [number, number, number | null, number | null, number | null, number | null, number | null, number, (number | null)[][] | null][];
  /** [driver, t, gap s, gapText, interval s, intervalText] */
  intervals: [number, number, number | null, string | null, number | null, string | null][];
  /** [driver, t, position] — change events only */
  positions: [number, number, number][];
  /** [driver, stint, lapStart, lapEnd, compound, tyreAgeAtStart] */
  stints: [number, number, number, number | null, string | null, number | null][];
  /** [driver, t, lap, pitDuration, laneDuration, stopDuration] */
  pits: [number, number, number | null, number | null, number | null, number | null][];
  /** [t, lap, category, flag, scope, sector, driver, message, qualifying phase 1–3 or null] */
  raceControl: [number, number | null, string | null, string | null, string | null, number | null, number | null, string, number | null][];
  /** [t, air, track, humidity, pressure, rainfall, windSpeed, windDir] */
  weather: [number, number, number, number, number, number, number, number][];
  /** [driver, t, url] */
  radio: [number, number, string][];
  /** [t, overtaker, overtaken, position] */
  overtakes: [number, number, number, number][];
  results: { driver: number; position: number | null; laps: number | null; points: number | null; status: string; gap: string | null }[];
  /** [driver, position] */
  grid: [number, number][];
  /** Circuit outline in OpenF1 x/y units, in driving order starting at the line. */
  outline: [number, number][];
  /** Live free mode: car positions are estimated from lap timing, not measured. */
  positionsEstimated?: boolean;
}

export interface PackDriver {
  number: number;
  code: string;
  name: string;
  team: string;
  colour: string;
}

/** Binary samples file: u32 header length, JSON header, then 4-byte-aligned typed arrays. */
export interface SamplesHeader {
  arrays: { key: string; type: 'i32' | 'i16' | 'u16' | 'u8'; offset: number; length: number }[];
}

// Keys used in the samples file, per driver number n:
//   loc.<n>.t / loc.<n>.x / loc.<n>.y          (i32)
//   car.<n>.t (i32) speed (i16) throttle (u8) brake (u8) rpm (u16) gear (u8) drs (u8, 255 = null)
