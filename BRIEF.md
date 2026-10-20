# Project brief: F1 Pit Wall (race replay tracker)

Paste this whole file into your first Claude Code message, or save it in the project folder as `BRIEF.md` and say: *"Read BRIEF.md and start with Phase 0."*

---

## 1. What we're building

A browser-based, multi-window F1 "pit wall" that replays any race from 2023 onwards from real timing and telemetry data. It shows:

- a track map with every car moving,
- a live timing tower,
- tyre stints, race control messages and weather,
- telemetry traces for chosen drivers.

Each panel can be opened in its own browser window or screen, and all windows stay in sync with one shared playback clock (play, pause, scrub, 1x–16x speed).

It's a personal, non-commercial fan project. There's no video in it: video is F1 TV / MultiViewer territory and stays out of scope.

Later phases add live mode so the same panels can run during a real session.

## 2. Data sources

| Source | Use for | Access | Limits |
|---|---|---|---|
| **OpenF1** — `https://api.openf1.org/v1` | All session data: car positions, telemetry, laps, intervals, stints, pits, race control, weather, team radio, drivers and team colours | Historical data is free with no key. Live data during sessions needs the €9.90/month sponsor tier (REST, MQTT and WebSocket). | Free tier: 3 requests per second, 30 per minute. Data from 2023 onwards. Licence is CC BY-NC-SA 4.0, so non-commercial use only. |
| **Jolpica-F1** — `https://api.jolpi.ca/ergast/f1/` | Season calendar, results, championship standings, history | Free, no key, Ergast-compatible | 500 requests per hour |
| **FastF1** (Python, optional) | Deeper analysis later, such as lap overlays and tyre degradation | `pip install fastf1` | Uses its own cache |

OpenF1 endpoints we'll use: `meetings`, `sessions`, `drivers`, `location` (x/y/z position, about 3.7 Hz), `car_data` (speed, throttle, brake, RPM, gear, DRS), `position`, `intervals`, `laps`, `stints`, `pit`, `race_control`, `weather`, `team_radio`.

Example request: `https://api.openf1.org/v1/laps?session_key=9839&driver_number=44` (Abu Dhabi 2025 race, Hamilton).

**Important:** check the docs at https://openf1.org/docs before writing any client code. Confirm the exact field names, and confirm how to filter by time range, because `location` and `car_data` are very large per session.

## 3. Key design decisions

1. **Ingest once, replay locally.** The free rate limit makes live-fetching during replay impossible. Write an ingest script that downloads a whole session, throttled to stay safely under 30 requests per minute with retries and backoff. Fetch `location` and `car_data` per driver, and if needed in time chunks. Save everything to a local cache (SQLite, or compressed JSON per session) so a session is only ever downloaded once.
2. **One data model, two feeds.** All panels read from a single "session state at time T" store. In replay mode, a clock drives the store from cached data. In live mode (Phase 4), a stream drives the same store. The panels never know the difference.
3. **Multi-window sync.** The first version uses the browser's `BroadcastChannel` API: one window owns the clock and broadcasts the current time, and the other windows follow it. A later version uses a small local WebSocket server so other devices on the home network (TV, iPad, second laptop) can join.
4. **Track outline from data.** Draw the circuit from one driver's `location` trace on a clean lap, normalised and rotated to fit the panel. This avoids needing any copyrighted track maps.
5. **No F1 logos or broadcast graphics.** Use team colours from the `drivers` endpoint, driver three-letter codes, and an original design.

## 4. Suggested stack

You can change this if there's a good reason.

- **Frontend:** Vite, React and TypeScript. Use Canvas or SVG for the track map, and a lightweight chart library (such as uPlot) for telemetry.
- **Backend:** a small Node (Fastify) or Python (FastAPI) server that runs the ingest and serves cached sessions to the frontend.
- **Storage:** SQLite.
- The whole thing runs locally with one command (`npm run dev` or similar).

## 5. Phases

### Phase 0: Explore (no app code yet)
- Hit the OpenF1 endpoints for one race session (Abu Dhabi 2025, `session_key=9839`).
- Report row counts, field names, sample rates, payload sizes, and how long a full ingest would take within the rate limits.
- Propose the cache schema and the playback approach.
- **Stop and show me the findings before building.**

### Phase 1: Ingest and cache
- Write a CLI command such as `ingest --year 2025 --race "Abu Dhabi" --session Race`. It looks up `session_key` via `meetings` and `sessions`.
- Throttle requests, resume after interruption, and show progress.
- Add a session picker that lists cached sessions.

### Phase 2: Single-window replay (MVP)
- **Track map:** every car as a dot in its team colour with the driver code, interpolated smoothly between samples.
- **Timing tower:** position, driver, gap to leader, interval, current tyre and its age, and pit count.
- **Race control feed** and **track status** (green, yellow, SC, VSC, red).
- **Weather strip.**
- **Playback bar:** play/pause, scrub, speed control (1x, 2x, 4x, 8x, 16x), and jump to lap N.

### Phase 3: Multi-window pit wall
- Each panel is available at its own route (`/map`, `/tower`, `/telemetry`, `/race-control`), so each can be opened in its own window.
- Sync all windows with BroadcastChannel. Pressing pause in any window pauses every window.
- **Telemetry panel:** pick 1–2 drivers and show speed, throttle, brake and gear traces for the current lap, with a marker for "now".
- **Layout presets:** save and restore which panels are open.
- Optional: a WebSocket sync server so other devices on the same Wi-Fi can follow the same clock.

### Phase 4: Live mode (later; needs the OpenF1 sponsor tier)
- Connect to OpenF1's live MQTT or WebSocket stream with my credentials, which come from a `.env` file and are never committed.
- Feed it into the same session store.
- Add a "LIVE" badge, with scrub-back within the session buffer.

### Phase 5: Extras (pick and choose)
- Season calendar and standings from Jolpica.
- Head-to-head lap comparison: overlay two drivers' fastest laps on the map and traces.
- Tyre strategy chart (stints as coloured bars per driver).
- Team radio playback at the correct moment in the replay.
- Battle detector that highlights cars within 1 second of each other.

## 6. Ground rules for Claude Code

- Check OpenF1's live documentation rather than assuming field names.
- Never exceed the API rate limits. Every network call goes through one throttled client.
- Keep secrets in `.env`, and add `.env` and the cache folder to `.gitignore`.
- At the end of each phase, show me how to run it, and stop for my feedback before starting the next phase.
- Prefer simple and working over clever. I'll judge it by running it, not by reading the code.
- Write a short `README.md` covering setup, the ingest command, and how to open the multi-window layout.

## 7. Definition of done (MVP = Phases 0–3)

- [ ] I can ingest a past race with one command and it finishes without hitting rate-limit errors.
- [ ] I can open the replay and see all cars moving smoothly around a recognisable track outline.
- [ ] The timing tower and race control match what actually happened in that race (spot-check against the race result).
- [ ] I can open the map on one screen and the tower and telemetry on another, and they stay in sync when I scrub or change speed.
- [ ] Restarting the app doesn't re-download anything.

## 8. First message to send

> Read BRIEF.md. Start with Phase 0 only: explore the OpenF1 data for session 9839 (Abu Dhabi 2025 race) and report back with your findings and proposed cache schema before writing any app code.
