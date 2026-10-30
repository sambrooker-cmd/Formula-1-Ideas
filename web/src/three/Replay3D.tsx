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
      // Full rate while playing; a gentle rate when paused so free-camera dragging stays smooth enough.
      const fps = st.playing || st.live ? (saved('smooth', false) ? 60 : 30) : 20;
      scene.frame(now(), fps);
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
          disabled={mode === 'director'}
          title={mode === 'director' ? 'The director chooses who to follow' : undefined}
          onChange={(e) => clock.setSelected([Number(e.target.value)])}
          aria-label="Car to follow"
        >
          {data.driverOrder.map((n) => (
            <option key={n} value={n}>
              {data.drivers.get(n)?.code}
            </option>
          ))}
        </select>
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
      <div className="r3d-board">
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
