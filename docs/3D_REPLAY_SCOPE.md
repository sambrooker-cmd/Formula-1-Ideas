# 3D replay: scope

A 3D view of a replay: the circuit as a ribbon with its real elevation, cars moving on it, and a camera you can orbit, follow a car with, or put on board. Measured against real data (Abu Dhabi and Zandvoort 2025) on 28 Oct 2026.

## Verdict

**Feasible, moderate size, low running cost.** The data is good enough and already downloaded; the work is almost all front-end. Worth building as a separate `/3d` view loaded only when opened, so the rest of the app doesn't get heavier.

## Data

| Question | Finding |
|---|---|
| Is height data available? | Yes. OpenF1 `location` has `z` alongside x/y, same 3.7 Hz rate. |
| Do we already have it? | Yes. Every downloaded session's database already stores `z`; it's just not put in the replay files. No re-downloading. |
| Quality | Very clean. The same spot on track reads the same height lap after lap (median difference 0 cm, 95% within 10 cm, no spikes over 3 m). It looks map-matched to a track model rather than raw GPS. |
| Height range | Abu Dhabi 11 m, Zandvoort 9 m. Spa (~100 m) and Austin (~40 m) will look much more dramatic. |
| Extra download per race | Adding z as 16-bit adds ~1.2 MB raw, ~0.5 MB gzipped to an ~8 MB race file (+6%). |
| Firebase free quota (360 MB/day download) | Race files are ~8 MB, so ~45 race loads a day today; with z, ~42. Not a concern for one person. |
| Free live mode | No positions at all (F1 removed them in 2025), so 3D live would only show estimated cars on a 3D track, like the 2D map does now. |

Not available from any free source: car orientation (pitch/roll/yaw: derive yaw from direction of travel), suspension, steering angle, track width, kerbs, run-off, barriers or buildings. The track ribbon has to use a fixed width (~12–15 m), so it's a stylised 3D map, not a game-style circuit model.

## Building it

- **Library:** three.js (~180 KB gzipped, loaded only on the 3D page; the current app is ~150 KB gzipped). No React-three-fiber needed; a single canvas like the heading-up view in the cockpit.
- **Track:** one ribbon mesh along the stored outline with z from the same lap (a few thousand vertices), a start/finish line, and pit lane from a pit lap if wanted.
- **Cars:** 20–22 simple shapes (a wedge or low-poly car) in team colours, positioned by interpolating x/y/z like the 2D map; yaw from direction of travel; floating driver codes.
- **Cameras:** orbit (drag/pinch), follow-car (behind and above, smoothed), on-board (bonnet height looking ahead), and a TV-style trackside camera that cuts between fixed points as the selected car passes.
- **Sync:** uses the same shared clock, so it follows play/pause/scrub on every screen like everything else.

Rough size of the job, compared with what's been built so far:

| Part | Size |
|---|---|
| Add z to the replay files (server + loader, file version 3) | small |
| Track ribbon + cars + orbit camera | medium |
| Follow and on-board cameras, smoothing | medium |
| TV-style auto-cuts | small–medium |
| Touch controls, iPad tuning, low-power mode | small |
| **Total** | about the same as the virtual cockpit + circuit guide together, i.e. one solid build session |

## Device load

- **GPU:** trivial by game standards (one ribbon, ~22 low-poly cars). Any iPad from the last ~6 years runs it at 60 fps.
- **Battery:** WebGL at 60 fps keeps the GPU busy; cap at 30 fps by default and drop to 10 fps when paused or in the background tab. On an iPad that's comparable to watching video.
- **Memory:** z adds ~2.5 MB of decoded arrays per race; the 3D scene itself is a few MB.

## Recommendation

Build it when wanted: start with track + cars + orbit/follow cameras on cached replays (most of the "wow"), then add on-board and TV cuts. Keep it a separate page so the main pit wall stays light on the iPad.
