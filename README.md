# Pit Wall

A multi-window race replay "pit wall" for any Grand Prix session from 2023 onwards, built on free [OpenF1](https://openf1.org) data. It shows:

- **Track map:** every car moving around a circuit outline traced from real position data.
- **Timing tower:** position, gap, interval, last lap, tyre and age, pit stops. Battles under 1 s are highlighted.
- **Race control:** flags, Safety Car / VSC / red flag, penalties, and team radio clips you can play.
- **Telemetry:** speed, throttle, brake and gear for one or two drivers over the current lap, with a marker for "now".
- **Tyre strategy:** stints as coloured bars for every driver.
- **Weather:** air and track temperature, humidity, wind, rain.

Every panel can open in its own window, on any screen or any device on your Wi-Fi. All windows share one clock: press pause, scrub or change speed in any window and the others follow.

See [`BRIEF.md`](BRIEF.md) for the project brief and [`docs/PHASE0_FINDINGS.md`](docs/PHASE0_FINDINGS.md) for the data research.

## Setup

You need **Node.js 20 or newer**.

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

## Getting a race

Either use the **Download a session** box on the home page, or the command line:

```bash
npm run ingest -- --year 2025 --race "Abu Dhabi" --session Race
npm run ingest -- --year 2024 --race Monaco --session Qualifying
npm run ingest -- --session-key 9839
```

- `--race` matches the Grand Prix name, country, city or circuit.
- `--session` defaults to `Race`. Others are `Qualifying`, `Sprint`, `Practice 1` and so on.

A race takes **2–4 minutes and about 55 requests**. Requests are paced at 24 per minute, under OpenF1's free limit of 30 per minute. If the download is interrupted, run the same command again and it resumes where it stopped. A finished session is never downloaded twice. Run one download at a time, either from the page or the command line, so you stay within the rate limit.

Each session is stored in `cache/session-<key>.sqlite` (about 35 MB per race) plus a compressed replay pack of about 8 MB that the browser loads. Delete a file to remove that session.

> OpenF1's free tier is reportedly unavailable from about 30 minutes before a live session until 30 minutes after it ends. If a download is refused during a race weekend, try again later.

## Using it

1. On the home page, click **Open pit wall** next to a session. This opens the full single-screen view.
2. Click a driver in the tower or on the map to select them. Click a second driver to compare. The telemetry panel and the map highlight both.
3. **Keyboard:** Space plays and pauses. ← and → jump 10 s; hold Shift for 60 s.
4. On the scrubber, Safety Car and VSC periods are shaded amber, red flags are red, and the thin ticks mark every 5 laps. **Jump to…** goes to lights out or any lap.

### Multiple windows and screens

- **⧉ Pop out** on any panel opens it in its own window.
- The home page has **layout presets** that open several windows at once: Quad, Map + timing, and Race engineer. Your browser may ask you to allow pop-ups the first time.
- Once your windows are where you want them, even across screens, click **Save arrangement** to reuse that layout later.
- Each panel also has its own address: `/map`, `/tower`, `/telemetry`, `/race-control`, `/strategy`, plus `/wall` for everything. Add `?bar=0` to hide the playback bar in a window.

### Other devices (TV, tablet, second laptop)

`npm run dev` also serves the app on your local network. Vite prints a `Network:` address when it starts, such as `http://192.168.1.20:5173`. Open `http://<that address>/map` on the TV or tablet. It joins the same session and follows the same clock through a small sync server, which also corrects for device clocks that disagree.

## How it works

```
OpenF1 ──(one throttled queue, 24 req/min)──▶ ingest ──▶ cache/session-<key>.sqlite
                                                              │
                                     server builds once ──▶ replay pack (gzip, ~8 MB)
                                                              │
                         every window loads it once ──▶ stateAt(t) ──▶ panels
                                                              ▲
                    BroadcastChannel (same computer) + WebSocket relay (LAN) ── shared clock
```

- **Server** (`server/`, Fastify + SQLite):
  - `openf1.ts`: the only code that talks to OpenF1. It paces requests, retries with backoff, and splits a request into smaller time ranges if OpenF1 says it's too big.
  - `ingest.ts`: downloads a session and records each finished request so it can resume.
  - `pack.ts`: turns the cache into a compact binary pack for the browser.
  - `index.ts`: serves the API and the sync relay.
- **Browser** (`web/`, React + Vite):
  - The whole session is loaded into memory once.
  - `data/state.ts` answers "what was true at time *t*?" by interpolating car positions between samples and taking the latest timing, tyre, flag and weather values.
  - `sync/clock.ts` holds the shared clock. Windows exchange only changes (play, pause, seek, speed, session, selected drivers) and each one works out the current time itself, so nothing is streamed frame by frame.
- **Track status:** OpenF1 has no track-status feed, so green / yellow / SC / VSC / red / chequered are worked out from race control messages.

### Production build

```bash
npm start   # builds the frontend and serves everything from http://localhost:8787
```

## Known limits

- **Car positions are sampled about 4 times a second** and smoothed in between. Lateral position isn't in the data.
- **Team radio** comes from F1's servers and only a selection of clips is published. Coverage is much thinner from 2026.
- **Live mode** (Phase 4 in the brief) needs the paid OpenF1 sponsor tier and isn't built yet.
- **FastF1** now needs an F1 TV login, so it isn't used.

---

Unofficial personal fan project, non-commercial. Data from [OpenF1](https://openf1.org), licensed CC BY-NC-SA 4.0.
This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
