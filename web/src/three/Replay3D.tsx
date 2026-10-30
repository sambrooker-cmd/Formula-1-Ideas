// The 3D replay page. Loaded only when opened (three.js is ~180 KB), and driven by the same
// shared clock as every other window.
import { useEffect, useRef, useState } from 'react';
import type { SessionData } from '../data/session';
import { tower } from '../data/state';
import { clock, getState, now } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { ReplayScene, type CameraMode, type Detail } from './scene';
import { seasonHistory } from '../data/history';
import { track3d } from '../data/track3d';
import { formatLapTime } from '../data/state';
import { fracAt, timeAtFrac } from '../data/laptrace';
import { LapSelect, useLapPair } from '../components/LapPicker';

const MODES: { id: CameraMode; label: string; title: string }[] = [
  { id: 'director', label: '🎬 Director', title: 'Sit back: it finds the best action (fights, passes, pit stops) and cuts between cameras for you' },
  { id: 'follow', label: 'Follow', title: 'Behind the selected car' },
  { id: 'onboard', label: 'On-board', title: 'From the cockpit of the selected car' },
  { id: 'tv', label: 'TV', title: 'Trackside cameras that cut as the selected car passes' },
  { id: 'orbit', label: 'Free', title: 'Drag to orbit, pinch or scroll to zoom, right-drag to pan' },
];

function saved<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem('pitwall.3d.' + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem('pitwall.3d.' + key, JSON.stringify(v));
  } catch {
    // ignore
  }
}

export default function Replay3D({ data }: { data: SessionData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReplayScene | null>(null);
  const { selected } = useSynced();
  const t = useNow(3);
  const [mode, setMode] = useState<CameraMode>(() => saved('mode', 'follow'));
  const [exag, setExag] = useState<number>(() => saved('exaggeration', 1));
  // High detail (shadows, more trees, sharper) by default, except on phones and tablets.
  const [detail, setDetail] = useState<Detail>(() => saved('detail', navigator.maxTouchPoints > 1 ? 'standard' : 'high'));
  const [labels, setLabels] = useState<boolean>(() => saved('labels', true));
  const [smooth, setSmooth] = useState<boolean>(() => saved('smooth', false));
  const [error, setError] = useState('');
  const rows = tower(data, t).filter((r) => !r.out && r.position < 99);
  const focus = selected[0] ?? rows[0]?.driver ?? null;
  const track = track3d(data);

  // Lap duel: two laps (any drivers, any laps) raced against each other on their own clock.
  const [duelOn, setDuelOn] = useState(false);
  const { a, b, setA, setB, trA, trB } = useLapPair(data);
  const duelClock = useRef({ on: false, g: 0, playing: false, speed: 1, last: 0 });
  const [, setTick] = useState(0);
  const total = Math.max(trA?.lap.duration ?? 0, trB?.lap.duration ?? 0) * 1000;
  useEffect(() => {
    const dc = duelClock.current;
    const s = sceneRef.current;
    const ready = duelOn && !!trA && !!trB;
    dc.on = ready;
    dc.g = 0;
    dc.playing = ready;
    dc.last = performance.now();
    s?.setDuel(ready ? { a: { n: a.driver, t0: trA!.lap.t }, b: { n: b.driver, t0: trB!.lap.t } } : null);
    if (ready) clock.pause();
  }, [duelOn, trA, trB, a.driver, b.driver, detail]);
  // Redraw the gap readout a few times a second while the duel runs.
  useEffect(() => {
    if (!duelOn) return;
    const id = setInterval(() => setTick((x) => x + 1), 150);
    return () => clearInterval(id);
  }, [duelOn]);

  // Create the scene once per session; render in a loop paced by the frame cap.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let scene: ReplayScene;
    try {
      scene = new ReplayScene(canvas, data, detail);
    } catch (e) {
      setError(`3D isn't available in this browser (${(e as Error).message}).`);
      return;
    }
    sceneRef.current = scene;
    // Where on Earth, for the sun: the calendar's circuit for this weekend.
    const date = new Date(data.meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);
    seasonHistory(data.meta.session.year)
      .then((h) => {
        const r = h.races.find((x) => Math.abs(Date.parse(x.date) - Date.parse(date)) <= 4 * 86_400e3);
        if (r && Number.isFinite(r.lat) && Number.isFinite(r.lng) && sceneRef.current === scene) scene.setLocation(r.lat, r.lng);
      })
      .catch(() => undefined);
    const host = hostRef.current!;
    const ro = new ResizeObserver(([e]) => scene.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(host);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const st = getState();
      const dc = duelClock.current;
      const wall = performance.now();
      if (dc.on) {
        if (dc.playing) dc.g = Math.min(dc.g + (wall - dc.last) * dc.speed, totalRef.current + 1500);
        if (dc.g >= totalRef.current + 1500) dc.playing = false;
        dc.last = wall;
      }
      // Full rate while playing; a gentle rate when paused so free-camera dragging stays smooth enough.
      const fps = st.playing || st.live || (dc.on && dc.playing) ? (saved('smooth', false) ? 60 : 30) : 20;
      scene.frame(dc.on ? dc.g : now(), fps);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [data, detail]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.selected = focus;
    s.exaggeration = exag;
    s.labels = labels;
    if (s.mode !== mode || s.controls.enabled !== (mode === 'orbit')) s.setMode(mode);
  }, [focus, exag, labels, mode, detail]);

  const totalRef = useRef(total);
  totalRef.current = total;
  const dc = duelClock.current;
  let gap: number | null = null;
  let finished = false;
  if (duelOn && trA && trB) {
    const g = dc.g;
    finished = g >= trA.lap.duration! * 1000 && g >= trB.lap.duration! * 1000;
    if (g >= trA.lap.duration! * 1000) gap = trA.lap.duration! - trB.lap.duration!;
    else gap = (g - timeAtFrac(trB, Math.min(1, fracAt(trA, g)))) / 1000;
  }
  const dA = data.drivers.get(a.driver);
  const dB = data.drivers.get(b.driver);
  const same = a.driver === b.driver;
  const leaderCode = gap == null ? '' : gap <= 0 ? `${dA?.code}${same ? ' (A)' : ''}` : `${dB?.code}${same ? ' (B)' : ''}`;

  const choose = (m: CameraMode) => {
    setMode(m);
    save('mode', m);
  };

  const onClick = (e: React.MouseEvent) => {
    const n = sceneRef.current?.pick(e.clientX, e.clientY);
    if (n != null) clock.setSelected([n]);
  };

  if (error) return <div className="center-msg">{error}</div>;

  return (
    <div className="r3d" ref={hostRef}>
      <canvas ref={canvasRef} className="r3d-canvas" onClick={onClick} />
      <div className="r3d-bar">
        <span className="seg" role="group" aria-label="Camera">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} title={m.title} onClick={() => choose(m.id)}>
              {m.label}
            </button>
          ))}
        </span>
        <select
          className="lap-jump"
          value={focus ?? ''}
          disabled={mode === 'director' || duelOn}
          title={mode === 'director' ? 'The director chooses who to follow' : duelOn ? 'The camera follows lap A' : undefined}
          onChange={(e) => clock.setSelected([Number(e.target.value)])}
          aria-label="Car to follow"
        >
          {data.driverOrder.map((n) => (
            <option key={n} value={n}>
              {data.drivers.get(n)?.code}
            </option>
          ))}
        </select>
        <button
          className={'r3d-duel-btn' + (duelOn ? ' on' : '')}
          title="Race two laps against each other: pick any two drivers and laps (great for qualifying)"
          onClick={() => setDuelOn((x) => !x)}
        >
          ⏱ Lap duel
        </button>
        <span className="seg" title="Exaggerate the hills so they're easier to see">
          {[1, 3, 6].map((x) => (
            <button
              key={x}
              className={exag === x ? 'on' : ''}
              onClick={() => {
                setExag(x);
                save('exaggeration', x);
              }}
            >
              {x === 1 ? 'Real height' : `Hills ×${x}`}
            </button>
          ))}
        </span>
        <label className="r3d-check">
          <input
            type="checkbox"
            checked={labels}
            onChange={(e) => {
              setLabels(e.target.checked);
              save('labels', e.target.checked);
            }}
          />
          Names
        </label>
        <label className="r3d-check" title="60 frames a second: smoother, but uses more battery">
          <input
            type="checkbox"
            checked={smooth}
            onChange={(e) => {
              setSmooth(e.target.checked);
              save('smooth', e.target.checked);
            }}
          />
          Smooth
        </label>
        <label className="r3d-check" title="Shadows, more trees and a sharper picture. Turn off if it's slow (it starts off on iPads).">
          <input
            type="checkbox"
            checked={detail === 'high'}
            onChange={(e) => {
              const d = e.target.checked ? 'high' : 'standard';
              setDetail(d);
              save('detail', d);
            }}
          />
          High detail
        </label>
      </div>
      {duelOn && (
        <div className="r3d-duel">
          <div className="r3d-duel-pick">
            <LapSelect data={data} value={a} onChange={setA} tag="A" />
            <LapSelect data={data} value={b} onChange={setB} tag="B" />
          </div>
          {!trA || !trB ? (
            <div className="muted">No position data for one of those laps; choose another.</div>
          ) : (
            <>
              <div className="r3d-duel-times">
                <span>
                  <b className="lap-pick-tag" style={{ background: dA?.colour }}>A</b> {dA?.code} {formatLapTime(trA.lap.duration)}
                </span>
                <span>
                  <b className="lap-pick-tag" style={{ background: dB?.colour }}>B</b> {dB?.code} {formatLapTime(trB.lap.duration)}
                </span>
              </div>
              <div className="r3d-duel-gap num">
                {gap == null || Math.abs(gap) < 0.0005
                  ? 'Level'
                  : `${finished ? 'Final: ' : ''}${leaderCode} ${finished ? 'by' : 'ahead by'} ${Math.abs(gap).toFixed(3)} s`}
                <span className="muted"> · {(dc.g / 1000).toFixed(1)} s into the lap</span>
              </div>
              <div className="r3d-duel-ctl">
                <button
                  onClick={() => {
                    if (!dc.playing && dc.g >= total) dc.g = 0;
                    dc.playing = !dc.playing;
                    dc.last = performance.now();
                    setTick((x) => x + 1);
                  }}
                >
                  {dc.playing ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                  onClick={() => {
                    dc.g = 0;
                    dc.playing = true;
                    dc.last = performance.now();
                  }}
                >
                  ⟲ Restart
                </button>
                <span className="seg" role="group" aria-label="Duel speed">
                  {[0.5, 1, 2].map((x) => (
                    <button
                      key={x}
                      className={dc.speed === x ? 'on' : ''}
                      onClick={() => {
                        dc.speed = x;
                        setTick((y) => y + 1);
                      }}
                    >
                      {x}×
                    </button>
                  ))}
                </span>
                <input
                  type="range"
                  min={0}
                  max={total}
                  step={50}
                  value={dc.g}
                  aria-label="Time into the lap"
                  onChange={(e) => {
                    dc.g = Number(e.target.value);
                    setTick((x) => x + 1);
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}
      <div className="r3d-board" hidden={duelOn}>
        {rows.slice(0, 22).map((r) => {
          const d = data.drivers.get(r.driver);
          return (
            <button key={r.driver} className={'r3d-row' + (r.driver === focus ? ' on' : '')} onClick={() => clock.setSelected([r.driver])}>
              <span className="num dim">{r.position}</span>
              <i style={{ background: d?.colour }} />
              <b>{d?.code}</b>
              <span className="num muted">{r.position === 1 ? '' : r.interval}</span>
            </button>
          );
        })}
      </div>
      {mode === 'director' && sceneRef.current?.directorCaption && <div className="r3d-caption">🎬 {sceneRef.current.directorCaption}</div>}
      {(!track.hasHeight || data.meta.positionsEstimated) && (
        <div className="r3d-note">
          {data.meta.positionsEstimated
            ? 'Free live mode: car positions are estimated, so cars follow the racing line.'
            : 'This replay has no height data, so the circuit is shown flat.'}
        </div>
      )}
    </div>
  );
}
