# Pit Wall

A multi-window race replay "pit wall" for any Grand Prix session from 2023 onwards, built on free [OpenF1](https://openf1.org) data. It shows:

- **Track map:** every car moving around a circuit outline traced from real position data.
- **Timing tower:** position, gap, interval, last lap, tyre and age, pit stops. Battles under 1 s are highlighted.
- **Race control:** flags, Safety Car / VSC / red flag, penalties, and team radio clips you can play.
- **Telemetry:** speed, throttle, brake and gear for one or two drivers over the current lap, with a marker for "now".
- **Fastest laps:** two drivers' best laps head to head: the circuit coloured by who was quicker where, sector times, a speed trace and the time gap around the lap, plus a button that races the two laps against each other on the map. It's a tab next to Telemetry, or its own window at `/compare`.
- **Tyre strategy:** stints as coloured bars for every driver.
- **Weather:** air and track temperature, humidity, wind, rain.

More views (tabs on the pit wall, or their own windows):

- **Key moments:** every overtake, pit stop, flag, penalty, retirement and new fastest lap. Tap one to jump there, or press **▶ Highlights** to watch just the big moments back to back.
- **Race trace, Positions and Tyre wear** charts. They show only laps already driven unless you choose **Whole race**.
- **Qualifying mode:** for qualifying sessions the timing tower shows Q1/Q2/Q3, the drop zone, who's been knocked out, deleted laps and mini-sector colours.
- **Pit stop predictor** (🔧 on the map): pick a driver to see a ghost car where they'd rejoin if they pitted now. It uses the stop time loss measured from that race, and allows for cheaper stops under the Safety Car.
- **Championship as it stands:** the drivers' and constructors' standings if the race finished now.
- **Alerts** (🔔 in the playback bar): banners for Safety Cars, red flags, retirements, penalties, big passes, fastest laps and your selected drivers' stops. 🔊 adds a sound in that window.
- **Team radio auto-play:** tick **auto-play** in race control and clips play as the replay reaches them.
- **Driver dashboard** (`/driver`): one driver, big and clear, to sit beside the TV's onboard channel.
- **TV mode** (`/tv`): big text for a TV, for example over AirPlay.
- **Auto-download:** tick **Download new races automatically** on the home page and each race downloads itself about 2 hours after it finishes, while Pit Wall is running.

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

### More views

- **📰 Report** (top bar, or `/report`): a written summary of the race or qualifying session, with the full classification. It hides itself until you ask, so it won't spoil a replay.
- **Pit battles** (Strategy tab, or `/pit-battles`): every undercut and overcut between close cars, whether it worked, and how much time it gained. Successful ones also appear in Key moments.
- **Long runs** (analysis tab, or `/long-runs`): in practice, finds each driver's race-style runs and ranks their pace by tyre, with a chart of the laps. In a race the same tab shows stint pace. Practice sessions on the home page have a **Long runs** button.
- **Virtual cockpit** (`/cockpit`): the selected car from the inside: shift lights, gear, speed, pedals, live delta to their best lap, a g-force circle and a track view that turns with the car.
- **🧊 3D replay** (top bar, or `/3d`): the race in 3D with detailed cars in team colours (halo, wings, sidepods; wheels turn and steer, and the tyre stripe shows the compound being used), on a circuit with kerbs, run-off, barriers and catch fencing, grandstands and a start gantry whose lights count down at the start. The sky and sun are worked out for the real place and time, so Abu Dhabi fades from sunset into a floodlit night and Singapore is floodlit throughout; when it rained, the track is wet and rain falls. Cameras: **Follow** (a low chase camera), **On-board** (the driver's view through the halo), **TV** (trackside cameras that cut as the car passes) and **Free** (drag to orbit, pinch or scroll to zoom). Click a car or a name in the list to follow it. **Real height** shows the hills as they are; **Hills ×3/×6** exaggerates them. **High detail** adds shadows and more scenery (it starts off on iPads; turn it on if yours keeps up). It runs at 30 frames a second to save battery; tick **Smooth** for 60.
- **Season stats** (`/season-stats`), **driver pages** (click a driver in the standings) and the **circuit guide** (click a race in the calendar): points through the season, every driver's numbers, team-mate battles, corner maps, elevation, lap records and past winners. These come from Jolpica and are saved in your browser after the first load.

### Analysis (📈 Analysis in the top bar, or `/analysis`)

- **Ghost lap:** two laps (any drivers, any laps) raced against each other on the map from the same start, with the gap all the way round and the sector splits.
- **Corners:** for two laps, each corner's slowest speed, where braking started and exit speed; or the whole field ranked by speed through each corner. Corner positions come from MultiViewer's free circuit data. (Times through single corners aren't shown: OpenF1's timestamps aren't precise enough between cars to be fair.)
- **Tyre deg:** how much each compound slowed per lap in this race (fuel effect removed), and who has the best tyres right now.
- **Clean-air pace:** each driver's typical lap when not stuck behind anyone, a like-for-like figure corrected for tyres, and how much traffic cost them.
- **Strategy sim:** change a driver's pit laps or tyres and see where they'd have finished. The real strategy reproduces the real result exactly; only that car changes, and traffic isn't modelled.
- **Battles:** every on-track fight (3+ laps within a second), who got through, and one click to watch it with both cars selected. Also a tab next to Key moments.
- **Start:** grid to the end of lap 1 for every car, and how starts have gone at this circuit in recent years (did pole hold on, first-lap retirements).
- **Overtakes:** where on the lap this race's passes happened (a dot per pass, a count per corner). Click a dot to watch it.
- **Race strategy** (practice sessions; also a button on the home page): the quickest one- and two-stop plans for Sunday from the session's long runs, with pit windows.
- **Ratings:** a mark out of 10 for every driver's race, with the reasons (result against the car, team-mate, like-for-like pace, places gained, penalties). The best is "Drive of the race" in the report.

### Watching
- **Catch up:** in Key moments, **▶ Highlights ▾ → Catch up in 5 / 10 / 20 minutes** plays the race's biggest moments in that time, start to flag.
- **Commentary** (a tab next to Key moments, or `/commentary`), and 💬 on the track map for a caption line: who's closing on whom, who's in overtaking range, tyre offsets and the lead, worked out from the timing.
- **Team radio** (a tab next to Key moments, or `/radio`): every clip with what was said, searchable, and shown in race control too. In the Mac app, press **Transcribe this session on this Mac** (a few minutes; the first time also downloads about 1 GB of speech recognition). Expect the odd misheard name. The hosted site can't make transcripts: F1's server won't let GitHub download the audio.
- **🙈 Spoiler-free** (home page and the explore pages): hides results of recent races (the last three weeks) you haven't watched: winners and standings on the home page, season, driver, circuit and prediction pages, analysis of the race, and result notifications (alerts also stop saying who's leading). A race counts as watched when its replay reaches the chequered flag, or tap **I've watched it**. The setting follows you between devices.

### Predictor (a tab next to Key moments, or `/predictor`)

- **Races:** the projected finishing order from the gaps now, the stops each car still has to make (a second tyre compound, or tyres that won't last), and recent pace. It also leans a little towards the running order, because passing is hard. Tested on five races it beat simply reading the running order, both for the winner and for the top ten.
- **Qualifying:** the knockout line and the time needed to get through, who's in the drop zone, and for cars on a flying lap a projected time from the sectors they've done, with where it would put them.

### Circuit guide extras

The circuit guide also shows **overtaking** (on-track passes per race in recent years, and how that compares), **Safety Car odds** (how often there's been a Safety Car, VSC or red flag here, and on which laps) and **starts here** in recent years. **Season stats** also has **title maths** (who can still win, and exactly what the leader needs to seal it at the next race), a **form guide** (a mark for every race, averaged over the last five), a **pit stop league table** (each team's stops against the typical stop at each race) and an **upgrade tracker**: each team's qualifying pace against the fastest car, race by race, so you can see who's found speed.

### Mini window and timing strip

**▣ Mini window** (top bar) floats positions and gaps in a small window that stays on top of other apps (Chrome/Edge; other browsers get a small pop-up). The same view is at `/strip` for a TV browser or AirPlay, and `/strip?layout=row` is a one-line ticker.

### Weather

The circuit guide shows the race-weekend forecast (or the weather on the day, for past races) from Open-Meteo, and a rain radar around the circuit from RainViewer. The next race on the home page links straight to it.

### History and fun

- **Head to head** (`/head-to-head`): any two drivers since 1950: titles, wins, podiums, how they did against each other and as team-mates, and season by season. **Era-adjusted** compares each against their own team-mates (qualifying, races, share of the team's points), the fairest way to compare drivers from different eras.
- **Predictions** (`/predictions`): pick the podium before each race; 3 points for an exact position, 1 for a podium finisher in the wrong place, scored over the season. Saved on the Mac's Pit Wall (so the iPad sees the same picks) or your account on the hosted site.
- **On this day** (`/on-this-day`): Grands Prix held on today's date in past years, and drivers born on it.

### Storage

Downloads are kept under a size limit (5 GB to start; change it next to **Cached sessions** on the home page). When over, the races you opened longest ago are deleted first. Star (☆) a race to keep it for good, or delete one with 🗑. Replay files from older versions of the app are tidied away automatically (they rebuild when needed).

### Multiple windows and screens

- **⧉ Pop out** on any panel opens it in its own window.
- The home page has **layout presets** that open several windows at once: Quad, Map + timing, and Race engineer. Your browser may ask you to allow pop-ups the first time.
- Once your windows are where you want them, even across screens, click **Save arrangement** to reuse that layout later.
- Each panel also has its own address: `/map`, `/tower`, `/telemetry`, `/race-control`, `/strategy`, plus `/wall` for everything. Add `?bar=0` to hide the playback bar in a window.

### Other devices (TV, tablet, second laptop)

`npm run dev` also serves the app on your local network. Vite prints a `Network:` address when it starts, such as `http://192.168.1.20:5173`. Open `http://<that address>/map` on the TV or tablet. It joins the same session and follows the same clock through a small sync server, which also corrects for device clocks that disagree.

## Live mode (with the TV)

Live mode follows a session as it happens. The pit wall is designed to run on a laptop or tablet next to the TV, kept in step with the picture. There are two ways to get the data.

### Free live mode (no setup)

With no OpenF1 login, the app connects to F1's own public live-timing feed (the one the official live timing page uses) whenever a session is on. You get the timing tower, gaps, tyres, pit stops, sectors, race control, weather and team radio for free.

F1 stopped publishing car positions and telemetry to that feed in 2025, so on the map the cars are **estimated**: each car is placed along the track from its last line crossing and its usual lap time. A "≈ estimated positions" tag shows when this is happening. They're close on a normal lap but drift during incidents, and there's no speed/throttle telemetry.

The track outline comes from a past race at the same circuit. The app fetches it a few days ahead, because OpenF1's free tier closes during live sessions. If you've downloaded a race at that circuit, that's used instead.

### Paid live mode: OpenF1 sponsor tier (€9.90/month)

Real car positions and telemetry. Setup (once):

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

## Hosting on Firebase (any browser, anywhere)

The same app can run as a private website on Firebase's free plan. There's no server: a GitHub job adds each session (races, qualifying, sprints) about 2 hours after it finishes and publishes it to the site, so every device gets it instantly. Sign-in is with Google and only the accounts you list can get in, and your devices stay in sync through Firebase.

Compared with running it on your Mac:
- **Live works too**, in free mode: each device connects straight to F1's own live timing (the tower, gaps, tyres, pits, race control, weather and team radio are live; car positions are estimated, as in free mode on the Mac). For exact positions and telemetry, use the Mac version with an OpenF1 sponsor login.
- **The race files are public files on the site.** The app itself needs sign-in, but anyone with a file's exact address could download it. The OpenF1 data licence allows non-commercial sharing.

### One-time setup

**1. Firebase project** at console.firebase.google.com:
- **Create the project:** Add project → name it (e.g. `pit-wall`) → Analytics off. Keep the free **Spark** plan.
- **Sign-in:** Build → Authentication → Get started → **Google** → Enable.
- **Database:** Build → Realtime Database → Create database → **Belgium (europe-west1)** → *Start in locked mode*.
- **Web app:** ⚙️ Project settings → General → Your apps → **</>** → name it "Pit Wall" → register. Copy the `firebaseConfig` values.

**2. Put the config in the app.** Fill in `web/src/hosting.config.json`:
```json
{
  "firebase": { "apiKey": "…", "authDomain": "…", "databaseURL": "…", "projectId": "…", "storageBucket": "…", "messagingSenderId": "…", "appId": "…" },
  "allowedEmails": ["you@gmail.com"]
}
```
The config identifies the project and isn't secret. Only the listed Google accounts can sign in.

**3. A deploy key for GitHub.** Go to console.cloud.google.com → pick the project:
- **Create the service account:** IAM & Admin → **Service accounts** → **Create service account** → name `github-deploy` → role **Firebase Admin** → Done.
- **Create its key:** open it → **Keys** → Add key → Create new key → **JSON**. A file downloads. Treat it like a password.

**4. Connect GitHub** (the repository's Settings → Secrets and variables → Actions):
- **Secrets** → New repository secret: `FIREBASE_SERVICE_ACCOUNT`, with the whole contents of that JSON file. Then delete the file.
- **Variables** → New repository variable: `FIREBASE_PROJECT_ID`, with your project ID (e.g. `pit-wall-1a2b3`).

**5. First publish.** On GitHub, go to Actions → **Publish Pit Wall** → Run workflow (leave the boxes empty). It adds the last 3 race weekends (races, qualifying, sprints, and practice as lap data only), which takes about 40 minutes. After that it runs by itself every 4 hours and on every change to `main`, adding each new session about 2 hours after it finishes. To add a whole season, type the year (e.g. `2025`) in the season box: each run works for up to 80 minutes and publishes what it has, so a full season takes a few runs.

Your site is then at `https://<project-id>.web.app`. On iPhone/iPad, use Share → Add to Home Screen.

**6. Notifications (optional).** A second GitHub job, **Notifications**, runs every 10 minutes and sends reminders before sessions, Safety Car / VSC / red flag alerts while one is on, and the podium or pole when it ends, even when Pit Wall is closed. It uses the same secret, so there's nothing to add; it makes its own signing keys on the first run. Turn them on per device on the home page (**Notifications → Turn on for this device**). On iPad/iPhone they only work in the home-screen app (iOS 16.4 or later), so add it to the home screen first, open it from there and sign in. To check it end to end, go to Actions → **Notifications** → Run workflow, which sends a test to every device that's signed up.

Signing in from the home-screen app needs one extra address allowed in Google: console.cloud.google.com → APIs & Services → **Credentials** → the **Web client (auto created by Google Service)** → *Authorized redirect URIs* → add `https://<project-id>.web.app/__/auth/handler` → Save.

To publish on your own computer instead of GitHub: run `npm run publish:data`, then `npm run build:hosted`, then `npx firebase-tools deploy`.

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
- **Free live mode was tested against a captured snapshot of the feed**, not yet during a real session. If F1 changes or blocks the feed, the Live card says so and the rest of the app is unaffected.
- **FastF1** now needs an F1 TV login, so it isn't used.

---

Unofficial personal fan project, non-commercial. Data from [OpenF1](https://openf1.org), licensed CC BY-NC-SA 4.0.
This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
