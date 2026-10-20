# Phase 0 findings: OpenF1 data for Abu Dhabi 2025 race (session 9839)

Probed on 2026-10-20 against `https://api.openf1.org/v1`, with requests spaced 2.5 s apart. Docs checked at https://openf1.org/docs.

## Summary

- **Every endpoint we need works for this session, with no key.** One whole-race request per driver for `location` and `car_data` succeeds (about 3 s, about 4–5.5 MB each). We don't need time chunking for a race.
- **A whole-field `location` request is refused** with HTTP 422 ("You're likely asking for too much data at once"). We have to fetch per driver, as the brief assumed.
- **Gzip works and matters.** Sending `Accept-Encoding: gzip` shrinks VER's `location` from 4.3 MB to 0.33 MB on the wire.
- **A full race ingest needs about 55 requests and takes roughly 3–4 minutes** at a conservative 24 requests per minute. About 20 MB is transferred.
- **The track outline drawn from one lap of VER's `location` data is clearly Yas Marina** (see `phase0-track-outline.png`). Decision 4 in the brief is confirmed.
- **The rate limit isn't stated in the docs**, and the API sends no rate-limit headers. We'll keep the brief's 30 requests per minute as a hard ceiling and run at 24.

![Track outline from VER lap 20](phase0-track-outline.png)

## Endpoint inventory (session 9839)

| Endpoint | Rows | JSON size | Cadence | Fields |
|---|---|---|---|---|
| `meetings` | 1 | 0.8 KB | – | meeting_key, meeting_name, meeting_official_name, location, country_*, circuit_key, circuit_short_name, circuit_type, circuit_info_url, circuit_image, gmt_offset, date_start, date_end, year, is_cancelled |
| `sessions` | 5 per meeting | – | – | session_key, session_type, session_name, date_start, date_end, meeting_key, circuit_key, circuit_short_name, country_*, location, gmt_offset, year, is_cancelled |
| `drivers` | 20 | 8 KB | – | driver_number, broadcast_name, full_name, name_acronym, team_name, team_colour (hex, no `#`), first_name, last_name, headshot_url, country_code (null here) |
| `location` (1 driver) | 34,452 | 4.3 MB (0.33 MB gzip) | median 0.24 s (about 4 Hz), p95 0.42 s, max gap 1.3 s | date, driver_number, x, y, z |
| `car_data` (1 driver) | 33,653 | 5.5 MB | median 0.24 s, p95 0.44 s | date, driver_number, speed, throttle, brake, rpm, n_gear, drs |
| `laps` | 1,156 | 554 KB | per lap | lap_number, date_start, lap_duration, duration_sector_1/2/3, i1_speed, i2_speed, st_speed, is_pit_out_lap, segments_sector_1/2/3 (arrays) |
| `intervals` | 26,261 | 3.7 MB | about 4 s per driver | date, driver_number, gap_to_leader, interval |
| `position` | 668 | 77 KB | on change only | date, driver_number, position |
| `stints` | 47 | 7 KB | – | stint_number, driver_number, lap_start, lap_end, compound, tyre_age_at_start |
| `pit` | 27 | 5 KB | – | date, driver_number, lap_number, pit_duration, lane_duration, stop_duration (null here) |
| `race_control` | 109 | 31 KB | events | date, lap_number, category, flag, scope, sector, driver_number, qualifying_phase, message |
| `weather` | 154 | 33 KB | 60 s | date, air_temperature, track_temperature, humidity, pressure, rainfall, wind_speed, wind_direction |
| `team_radio` | 22 | 6 KB | events | date, driver_number, recording_url (mp3 on livetiming.formula1.com) |
| `overtakes` | 342 | 53 KB | events | date, overtaking_driver_number, overtaken_driver_number, position |
| `session_result` | 20 | 4 KB | – | position, driver_number, number_of_laps, points, dnf, dns, dsq, duration, gap_to_leader |
| `starting_grid` | 404 on the race | – | – | Stored on the **qualifying** session (9835): position, driver_number, lap_duration |

Per-race totals: `location` is about 690k rows and about 87 MB of raw JSON for 20 drivers. `car_data` is about 670k rows and about 110 MB.

## Gotchas to handle in ingest

1. **Data starts about an hour before lights out.** Feeds begin around 12:05 UTC. `SESSION STARTED` is at 13:03:27.584, which equals lap 1 `date_start`, and `SESSION FINISHED` is at 14:29:35. The replay should default to the start but allow the pre-race period (cars leaving the pits to the grid).
2. **`location` contains `(0, 0, 0)` rows** (3,595 for VER), from before the car is running or from dropouts. Drop them, or treat them as "no position".
3. **`location` and `car_data` are sampled independently**, so their timestamps don't line up. Interpolate each on its own.
4. **`intervals.gap_to_leader` / `interval` are mixed types**: a float, a string like `"+1 LAP"`, or null. Store a numeric column plus a text column.
5. **`position` is change-only** (668 rows), so "position at T" is the last value at or before T. Same for stints, weather and race control.
6. **There is no track-status endpoint.** Green, yellow, SC, VSC and red come from `race_control` (category `Flag` / `SafetyCar` / `SessionStatus`). This race had no SC/VSC (just one double yellow on lap 1), so we need a second test race with a safety car to check that logic.
7. **`starting_grid` belongs to qualifying**: look it up via the meeting's Qualifying session.
8. **Team radio is patchy.** The docs say coverage drops sharply from 2026. Audio is hotlinked from F1's static server. We won't re-host it.
9. **Coordinates are in arbitrary units** (x −2,195…5,796, y −5,346…11,775 here). The outline needs per-circuit normalisation and a rotation preset.

## Ingest plan and timing

| Step | Requests |
|---|---|
| Resolve `meetings` and `sessions` | 2 |
| Session-level endpoints (drivers, laps, intervals, position, stints, pit, race_control, weather, team_radio, overtakes, session_result, starting_grid via qualifying) | 12 |
| `location` per driver | 20 |
| `car_data` per driver | 20 |
| **Total** | **about 54** |

At 1 request every 2.5 s (24 per minute) that's about 2 min 15 s of pacing, plus about 3 s server time on each of the 40 large calls, so **3–4 minutes per race**. Retry on 429/5xx with exponential backoff (5 s, 10 s, 20 s, 40 s). Record every completed request in a manifest so an interrupted ingest resumes where it stopped.

## Proposed cache schema (SQLite, one file per session)

One file per session (`cache/2025/abu-dhabi/race.sqlite`) keeps sessions independent, easy to delete, and makes "is this cached?" a single file check. A small `cache/index.sqlite` lists what's cached for the session picker.

```sql
-- metadata
CREATE TABLE session  (session_key INT PRIMARY KEY, meeting_key INT, year INT, meeting_name TEXT,
                       session_name TEXT, circuit_key INT, circuit_short_name TEXT,
                       date_start_ms INT, date_end_ms INT, race_start_ms INT, race_end_ms INT, raw_json TEXT);
CREATE TABLE driver   (driver_number INT PRIMARY KEY, code TEXT, full_name TEXT, team_name TEXT, team_colour TEXT);
CREATE TABLE ingest_manifest (request TEXT PRIMARY KEY, status TEXT, rows INT, fetched_at TEXT);

-- high-rate samples: integer ms since epoch, integer-only columns, WITHOUT ROWID to keep them compact
CREATE TABLE location (driver_number INT, t INT, x INT, y INT, z INT, PRIMARY KEY (driver_number, t)) WITHOUT ROWID;
CREATE TABLE car_data (driver_number INT, t INT, speed INT, throttle INT, brake INT, rpm INT, gear INT, drs INT,
                       PRIMARY KEY (driver_number, t)) WITHOUT ROWID;

-- timing and events
CREATE TABLE lap      (driver_number INT, lap INT, t_start INT, duration REAL, s1 REAL, s2 REAL, s3 REAL,
                       i1_speed INT, i2_speed INT, st_speed INT, pit_out INT, PRIMARY KEY (driver_number, lap));
CREATE TABLE interval_sample (driver_number INT, t INT, gap REAL, gap_text TEXT, interval REAL, interval_text TEXT);
CREATE TABLE position (driver_number INT, t INT, position INT);
CREATE TABLE stint    (driver_number INT, stint INT, lap_start INT, lap_end INT, compound TEXT, tyre_age_at_start INT);
CREATE TABLE pit      (driver_number INT, t INT, lap INT, pit_duration REAL, lane_duration REAL, stop_duration REAL);
CREATE TABLE race_control (t INT, lap INT, category TEXT, flag TEXT, scope TEXT, sector INT, driver_number INT, message TEXT);
CREATE TABLE weather  (t INT, air REAL, track REAL, humidity REAL, pressure REAL, rainfall INT, wind_speed REAL, wind_dir INT);
CREATE TABLE team_radio (driver_number INT, t INT, url TEXT);
CREATE TABLE overtake (t INT, overtaker INT, overtaken INT, position INT);
CREATE TABLE result   (driver_number INT PRIMARY KEY, position INT, laps INT, points REAL, status TEXT, gap REAL, duration REAL);
CREATE TABLE grid     (driver_number INT PRIMARY KEY, position INT, quali_lap REAL);
CREATE TABLE track_outline (seq INT PRIMARY KEY, x REAL, y REAL);  -- precomputed at ingest
```

The cache file should come to roughly 40–60 MB per race. The raw JSON responses won't be kept.

## Proposed playback approach

1. **Load the whole session into the browser once.** The server turns the SQLite file into one gzipped "replay pack" of compact typed arrays per driver: `t` as ms offsets from session start (Int32), and x/y, speed, throttle and so on (Int16/Uint8). That should be about 10–15 MB over the wire for a full race, and about 30 MB in memory. After loading, scrubbing and 16x playback need no network calls at all.
2. **One clock, one pure function.** The clock is `{ playing, speed, anchorSessionTime, anchorWallTime }`. Every window computes `now = anchorSessionTime + (performance.now() − anchorWallTime) × speed` on each animation frame, and calls `stateAt(now)`. `stateAt` returns positions (linearly interpolated between the two surrounding `location` samples, found by binary search), latest timing, stints, race control, weather and track status.
3. **Multi-window sync.** Windows send each other only clock *changes* (play, pause, seek, speed) over `BroadcastChannel`, plus an occasional heartbeat from the window that owns the clock. They don't stream frames. Each window has its own copy of the replay pack (cached by the browser), so the panels stay independent. The same messages can later travel over a LAN WebSocket, and live mode (Phase 4) only changes what fills the store.
4. **Track map.** Draw the precomputed outline once onto a Canvas layer, then draw the 20 dots on a second canvas every frame. That's cheap even at 60 fps.

## Open questions for you

1. **Stack:** I suggest **Node (Fastify) with better-sqlite3**, so the whole project is TypeScript and runs from one `npm run dev`. FastAPI would only make sense if we want FastF1 soon. OK to go with Node?
2. **Safety-car test race:** I'd add a second race that had a safety car for Phase 2 testing of track status. Are you happy for me to choose one?
3. **Replay start:** should the replay default to lights out, with the pre-race period still reachable by scrubbing?
