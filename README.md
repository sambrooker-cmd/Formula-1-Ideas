# Pit Wall

A multi-window race replay "pit wall" for any Grand Prix session from 2023 onwards, built on free [OpenF1](https://openf1.org) data. It shows:

- **Track map:** every car moving around a circuit outline traced from real position data.
- **Timing tower:** position, gap, interval, last lap, tyre and age, pit stops. Battles under 1 s are highlighted.
- **Race control:** flags, Safety Car / VSC / red flag, penalties, and team radio clips you can play.
- **Telemetry:** speed, throttle, brake and gear for one or two drivers over the current lap, with a marker for "now".
- **Fastest laps:** two drivers' best laps head to head: the circuit coloured by who was quicker where, sector times, a speed trace and the time gap around the lap, plus a button that races the two laps against each other on the map. It's a tab next to Telemetry, or its own window at `/compare`.
- **Tyre strategy:** stints as coloured bars for every driver.
- **Weather:** air and track temperature, humidity, wind, rain.

The home page also shows the **season**: the next race with a countdown, the full calendar with winners, and the drivers' and constructors' championships. Finished races have a **Download** button; once downloaded it becomes **Replay**.

Every panel can open in its own window, on any screen or any device on your Wi-Fi. All windows share one clock: press pause, scrub or change speed in any window and the others follow.

See [`BRIEF.md`](BRIEF.md) for the project brief and [`docs/PHASE0_FINDINGS.md`](docs/PHASE0_FINDINGS.md) for the data research.

## Easy start on a Mac (no terminal)

1. Install **Node.js** (the LTS version) from nodejs.org.
2. Download this project as a ZIP from GitHub (green **Code** button → **Download ZIP**) and unzip it. Moving the folder into your home folder (Finder → Go → Home) keeps things tidy.
3. Double-click **Pit Wall** in the folder. The first time, it sets itself up (about a minute), then opens Pit Wall in your browser. It keeps running in the background; there's no window to keep open.
4. Double-click **Pit Wall** again any time: it offers **Open** or **Stop**.

You can drag **Pit Wall** to the Dock for one-click access. It remembers where its folder is.

The first time, macOS may say it can't verify the developer. Click **Done**, go to **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to "Pit Wall", then open it again. If macOS asks whether `node` may accept incoming connections, click **Allow**: your iPad needs this to connect.

**More options (Mac)** has **Start automatically at login** (Pit Wall is then always running whenever your Mac is on), **Stop starting automatically**, and **Start in Terminal** (shows the server's output, useful if something goes wrong). The app writes its log to `~/Library/Application Support/Pit Wall/pitwall.log`.

**On your iPad:** open the address Pit Wall shows when it starts, for example `http://Your-Mac.local:8787/companion`. It uses your Mac's name, so it keeps working when the Wi-Fi gives the Mac a new number. In Safari, tap **Share → Add to Home Screen** and Pit Wall gets its own icon and opens full screen like an app. The **Linked** indicator in the playback bar shows whether a screen is following the others.

**Updating:** download the new ZIP, then move the **cache** folder (your downloaded races) from the old folder into the new one.

## Setup (developers)

You need **Node.js 22.13 or newer**: the LTS download from nodejs.org is fine. Nothing needs compiling, so you don't need Python or Xcode tools.

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

## Live mode (with the TV)

Live mode follows a session as it happens, using OpenF1's paid sponsor tier (€9.90/month). The pit wall is designed to run on a laptop or tablet next to the TV, kept in step with the picture.

### Setup (once)

1. Sponsor OpenF1 at https://openf1.org to get a login.
2. Copy `.env.example` to `.env` and fill in `OPENF1_USERNAME` and `OPENF1_PASSWORD`. `.env` is git-ignored and your password stays on your computer: the server logs in, and browsers only talk to your server.
3. Restart `npm run dev`. The **Live** card on the home page shows "Connected".

With credentials set, downloads of past races also speed up to 50 requests a minute.

### On race day

1. When a session starts, the Live card shows it. If you start the app mid-session, it first loads everything so far.
2. On the laptop or tablet, click **Open companion view**: map, timing and race control, sized for a screen beside the TV. Use **Full pit wall** if you want telemetry too.
3. **Sync to TV:** click **📺 TV delay** in the playback bar, then press **Leader crossed the line: NOW** the moment you see the leader cross the start/finish line on the TV (lights out works too). The app measures how far your TV is behind the real cars and holds all the data back by exactly that much, so it never spoils what's about to happen on screen. Fine-tune with the ±¼ s and ±1 s buttons. The delay is remembered, so you'll usually only need to do it once per setup.
4. **LIVE** means you're following the live edge (minus the TV delay). Pause or scrub back to rewatch something, then press **GO LIVE** to catch up.

Every other window and device follows the same live clock and delay.

### Rehearse with a simulated live race

On the home page, under **Live**, choose a cached race and a starting lap and click **Start simulation**. The server feeds that race through exactly the same live pipeline as a real session, as if it were happening right now. It's useful for trying the companion view and TV sync before a race weekend. You can play a recording of that race on your Sky box and practise syncing to it.

After a real session ends, download it normally (`npm run ingest` or the home page) to get the complete, cleaned-up replay with the circuit outline and final classification.

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

- **Live** (`server/live.ts`): keeps the session in progress in memory. It's fed from OpenF1's MQTT stream, or from the simulator. Browsers load a snapshot in the same format as a replay pack, then receive updates 4 times a second over a WebSocket.
- **Server** (`server/`, Fastify + SQLite):
  - `season.ts`: calendar, results and standings from Jolpica, cached for 10 minutes.
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
- **Live video can't be built in.** In the UK, Sky has the exclusive live rights (to 2034) and F1 TV Pro is blocked, so the video stays on your TV. The TV-delay sync is how the two are kept together.
- **The real OpenF1 live feed hasn't been tested end to end yet** (it needs a sponsor login during a live session). The simulated feed exercises the same browser and server path.
- **FastF1** now needs an F1 TV login, so it isn't used.

---

Unofficial personal fan project, non-commercial. Data from [OpenF1](https://openf1.org), licensed CC BY-NC-SA 4.0.
This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
