import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionData } from '../data/session';
import { carPosition, isRetired, lastAtOrBefore, leaderLap, weatherAt } from '../data/state';
import { clock, getState, now } from '../sync/clock';
import { useElementSize, useNow } from '../hooks';
import { Panel } from './Panel';
import { StatusPill } from './PlaybackBar';
import { predictPit, type PitPrediction } from '../data/pitstop';
import { useSynced } from '../hooks';

type Pt = [number, number];
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LABEL_H = 16;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where a label could go: hugging the dot first, then further out along 8 directions (with a leader line). */
function labelCandidates(x: number, y: number, r: number, w: number) {
  const h = LABEL_H;
  const out: { rect: Rect; leader: boolean }[] = [
    { rect: { x: x + r + 3, y: y - h / 2, w, h }, leader: false },
    { rect: { x: x - r - 3 - w, y: y - h / 2, w, h }, leader: false },
    { rect: { x: x - w / 2, y: y - r - 3 - h, w, h }, leader: false },
    { rect: { x: x - w / 2, y: y + r + 3, w, h }, leader: false },
  ];
  for (const dist of [24, 38, 54]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const ax = x + Math.cos(a) * dist;
      const ay = y + Math.sin(a) * dist;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const rx = cx > 0.3 ? ax : cx < -0.3 ? ax - w : ax - w / 2;
      const ry = cy > 0.3 ? ay : cy < -0.3 ? ay - h : ay - h / 2;
      out.push({ rect: { x: rx, y: ry, w, h }, leader: true });
    }
  }
  return out;
}

/** Pick the rotation that lets the outline fill the panel best, then build a world→screen transform. */
export function fitTransform(
  outline: Pt[],
  width: number,
  height: number,
  fixedDeg: number | null,
  // Defaults leave room for the lap counter overlay (top) and the weather strip (bottom).
  pad = { x: 40, top: 56, bottom: 40 },
) {
  if (outline.length < 2 || width < 10 || height < 10) return null;
  const padX = pad.x;
  const padTop = pad.top;
  const padBottom = pad.bottom;
  let best = { scale: 0, angle: 0, cx: 0, cy: 0 };
  const angles = fixedDeg == null ? Array.from({ length: 60 }, (_, i) => i * 3) : [fixedDeg];
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of outline) {
      const rx = x * cos - y * sin;
      const ry = x * sin + y * cos;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
    }
    const scale = Math.min((width - padX * 2) / (maxX - minX), (height - padTop - padBottom) / (maxY - minY));
    // Prefer the unrotated view unless rotating gains a real 8%+.
    if (scale > best.scale * (deg === 0 ? 1 : 1.08)) best = { scale, angle: a, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  const cos = Math.cos(best.angle);
  const sin = Math.sin(best.angle);
  return (x: number, y: number): Pt => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return [width / 2 + (rx - best.cx) * best.scale, padTop + (height - padTop - padBottom) / 2 - (ry - best.cy) * best.scale];
  };
}

export function TrackMap({ data, area }: { data: SessionData; area?: string }) {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = useNow(4);

  const outline = useMemo<Pt[]>(() => {
    if (data.meta.outline.length > 50) return data.meta.outline;
    // Fallback: a slice of any driver's trace.
    const s = data.samples.values().next().value;
    if (!s) return [];
    const pts: Pt[] = [];
    for (let i = 0; i < s.locT.length; i += 3) pts.push([s.locX[i], s.locY[i]]);
    return pts;
  }, [data, data.meta.outline]);

  // Rotation: automatic best fit, or a per-circuit override from the ↻ button (remembered in this browser).
  const rotKey = `pitwall.rotation.${data.meta.session.circuit}`;
  const [rotation, setRotation] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(rotKey);
      return v == null ? null : Number(v);
    } catch {
      return null;
    }
  });
  const rotate = () => {
    const next = rotation == null ? 0 : rotation + 45 >= 360 ? null : rotation + 45;
    setRotation(next);
    try {
      if (next == null) localStorage.removeItem(rotKey);
      else localStorage.setItem(rotKey, String(next));
    } catch {
      // ignore
    }
  };

  const toScreen = useMemo(() => fitTransform(outline, size.width, size.height, rotation), [outline, size.width, size.height, rotation]);

  // Pit stop predictor (remembered per browser): ghost car where the selected driver would rejoin.
  const { selected } = useSynced();
  const [pitMode, setPitMode] = useState(() => {
    try {
      return localStorage.getItem('pitwall.pitmode') === '1';
    } catch {
      return false;
    }
  });
  const togglePitMode = () => {
    setPitMode(!pitMode);
    try {
      localStorage.setItem('pitwall.pitmode', pitMode ? '0' : '1');
    } catch {
      // ignore
    }
  };
  const isRace = data.meta.session.type === 'Race';
  const prediction: PitPrediction | null = pitMode && isRace && selected[0] != null ? predictPit(data, selected[0], t) : null;
  const predictionRef = useRef<PitPrediction | null>(null);
  predictionRef.current = prediction;

  // Draw loop: runs every animation frame, outside React.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !toScreen) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d')!;

    // Pre-render the circuit once.
    const track = new Path2D();
    outline.forEach(([x, y], i) => {
      const [sx, sy] = toScreen(x, y);
      if (i === 0) track.moveTo(sx, sy);
      else track.lineTo(sx, sy);
    });
    track.closePath();
    const [ax, ay] = toScreen(...outline[0]);
    const [bx, by] = toScreen(...outline[Math.min(3, outline.length - 1)]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / len;
    const ny = (bx - ax) / len;

    const drivers = data.meta.drivers;
    const lastSpot = new Map<number, number>(); // keeps each label where it was, so labels don't flicker
    let raf = 0;
    const draw = () => {
      const t = now();
      const { selected } = getState();
      const dotRectsExtra: Rect[] = [];
      let ghostLabel: { x: number; y: number; text: string; colour: string } | null = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.width, size.height);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#1b222d';
      ctx.lineWidth = 16;
      ctx.stroke(track);
      ctx.strokeStyle = '#3b4658';
      ctx.lineWidth = 2;
      ctx.stroke(track);
      // start/finish line
      ctx.strokeStyle = '#e8edf3';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax + nx * 11, ay + ny * 11);
      ctx.lineTo(ax - nx * 11, ay - ny * 11);
      ctx.stroke();

      // Cars, drawn from the back of the field forward so the leader sits on top.
      const cars = [];
      for (const d of drivers) {
        const s = data.samples.get(d.number);
        if (!s) continue;
        const p = carPosition(s, t);
        if (!p) continue;
        const ps = data.positions.get(d.number);
        const pos = ps ? ps.v[Math.max(0, lastAtOrBefore(ps.t, t))] : 99;
        const [x, y] = toScreen(p.x, p.y);
        const sel = selected.includes(d.number);
        cars.push({ d, x, y, r: sel ? 8.5 : 6.5, pos, sel, dim: p.stale || isRetired(data, d.number, t) });
      }
      cars.sort((a, b) => Number(a.sel) - Number(b.sel) || b.pos - a.pos);
      for (const c of cars) {
        ctx.globalAlpha = c.dim ? 0.3 : 1;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fillStyle = c.d.colour;
        ctx.fill();
        ctx.lineWidth = c.sel ? 3 : 1.5;
        ctx.strokeStyle = c.sel ? '#ffffff' : '#07090d';
        ctx.stroke();
      }

      // Pit predictor ghost: where the leader was `after` seconds ago.
      const pred = predictionRef.current;
      if (pred && pred.leader != null) {
        const ls = data.samples.get(pred.leader);
        const gp = ls ? carPosition(ls, t - pred.after * 1000) : null;
        const d = data.drivers.get(pred.driver);
        if (gp && d) {
          const [gx, gy] = toScreen(gp.x, gp.y);
          ctx.globalAlpha = 1;
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = d.colour;
          ctx.beginPath();
          ctx.arc(gx, gy, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          dotRectsExtra.push({ x: gx - 11, y: gy - 11, w: 22, h: 22 });
          ghostLabel = { x: gx, y: gy, text: `${d.code} if pits`, colour: d.colour };
        }
      }

      // Labels go on top of every dot. Placed in priority order (selected, then race order),
      // each takes the first spot that doesn't cover another label or car; if it has to sit
      // away from its car, a thin line points back to it.
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const placed: Rect[] = [];
      if (ghostLabel) {
        ctx.font = '700 11px Inter, system-ui, sans-serif';
        const w = ctx.measureText(ghostLabel.text).width + 8;
        const rect = { x: ghostLabel.x + 13, y: ghostLabel.y - 8, w, h: 16 };
        ctx.fillStyle = '#07090dd9';
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
        ctx.fill();
        ctx.strokeStyle = ghostLabel.colour;
        ctx.setLineDash([3, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e8edf3';
        ctx.textBaseline = 'middle';
        ctx.fillText(ghostLabel.text, rect.x + 4, rect.y + 8.5);
        placed.push(rect);
      }
      const dotRects: Rect[] = [...cars.map((c) => ({ x: c.x - c.r, y: c.y - c.r, w: c.r * 2, h: c.r * 2 })), ...dotRectsExtra];
      const byPriority = [...cars].sort((a, b) => Number(b.sel) - Number(a.sel) || a.pos - b.pos);
      for (const c of byPriority) {
        const w = ctx.measureText(c.d.code).width + 8;
        const own = dotRects[cars.indexOf(c)];
        const fits = (r: Rect) =>
          r.x >= 0 && r.y >= 0 && r.x + r.w <= size.width && r.y + r.h <= size.height &&
          !placed.some((o) => overlaps(o, r)) &&
          !dotRects.some((o) => o !== own && overlaps(o, r));
        const candidates = labelCandidates(c.x, c.y, c.r, w);
        const remembered = lastSpot.get(c.d.number);
        // Next to the car if there's room; otherwise stay where it was last frame, then search outwards.
        const order = [0, 1, 2, 3, ...(remembered != null ? [remembered] : []), ...candidates.keys()];
        const chosen = order.find((i) => fits(candidates[i].rect));
        if (chosen == null) continue; // nowhere tidy to put it: the dot alone still shows (and can be clicked)
        lastSpot.set(c.d.number, chosen);
        const { rect, leader } = candidates[chosen];
        placed.push(rect);
        ctx.globalAlpha = c.dim ? 0.35 : 1;
        if (leader) {
          const tx = Math.max(rect.x, Math.min(c.x, rect.x + rect.w));
          const ty = Math.max(rect.y, Math.min(c.y, rect.y + rect.h));
          const ang = Math.atan2(ty - c.y, tx - c.x);
          ctx.strokeStyle = c.sel ? '#ffffff' : c.d.colour;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(c.x + Math.cos(ang) * (c.r + 1), c.y + Math.sin(ang) * (c.r + 1));
          ctx.lineTo(tx, ty);
          ctx.stroke();
        }
        ctx.fillStyle = c.sel ? '#ffffff' : '#07090dd9';
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
        ctx.fill();
        if (leader && !c.sel) {
          ctx.strokeStyle = c.d.colour;
          ctx.stroke();
        }
        ctx.fillStyle = c.sel ? '#07090d' : '#e8edf3';
        ctx.fillText(c.d.code, rect.x + 4, rect.y + rect.h / 2 + 0.5);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, outline, toScreen, size.width, size.height]);

  // Click a car to select it.
  const onClick = (e: React.MouseEvent) => {
    if (!toScreen) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hit: number | null = null;
    let bestD = 14;
    for (const d of data.meta.drivers) {
      const p = carPosition(data.samples.get(d.number)!, now());
      if (!p) continue;
      const [x, y] = toScreen(p.x, p.y);
      const dist = Math.hypot(x - mx, y - my);
      if (dist < bestD) [bestD, hit] = [dist, d.number];
    }
    if (hit != null) clock.toggleSelected(hit);
  };

  const lap = leaderLap(data, t);
  const w = weatherAt(data, t);
  return (
    <Panel
      title="Track"
      area={area}
      popout="/map"
      extra={
        <>
          <span>{data.meta.session.circuit}</span>
          {isRace && (
            <button
              className={'icon-btn' + (pitMode ? ' active' : '')}
              onClick={togglePitMode}
              title="Pit stop predictor: shows where the selected driver would rejoin if they pitted now"
            >
              🔧 Pit predictor
            </button>
          )}
          <button className="icon-btn" onClick={rotate} title="Rotate the map (cycles 45° steps, then back to auto-fit)">
            ↻ {rotation == null ? 'auto' : rotation + '°'}
          </button>
        </>
      }
    >
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} onClick={onClick}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
      <div style={{ position: 'absolute', left: 12, top: 10, display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'none' }}>
        {data.meta.totalLaps > 0 && (
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>
            {Math.min(lap, data.meta.totalLaps) || 0}
            {!data.live && <span className="dim">/{data.meta.totalLaps}</span>}
          </span>
        )}
        <StatusPill data={data} t={t} />
        {data.meta.positionsEstimated && (
          <span className="tag out" title="Free live mode: positions are worked out from lap timing, so they're approximate">
            ≈ estimated positions
          </span>
        )}
      </div>
      {pitMode && isRace && (
        <div className="pit-box">
          {prediction ? (
            <PitSummary data={data} p={prediction} />
          ) : (
            <span className="muted">Select a driver (tap the tower or a car) to see where they'd rejoin if they pitted now.</span>
          )}
        </div>
      )}
      {w && (
        <div className="weather" style={{ position: 'absolute', left: 12, bottom: 10, pointerEvents: 'none' }}>
          <span>AIR <b>{w.air.toFixed(1)}°</b></span>
          <span>TRACK <b>{w.track.toFixed(1)}°</b></span>
          <span>HUM <b>{Math.round(w.humidity)}%</b></span>
          <span>
            WIND <b>{w.windSpeed.toFixed(1)} m/s</b>{' '}
            <span style={{ display: 'inline-block', transform: `rotate(${w.windDir + 180}deg)` }}>↑</span>
          </span>
          <span>RAIN <b style={{ color: w.rain ? 'var(--blue)' : undefined }}>{w.rain ? 'YES' : 'NO'}</b></span>
        </div>
      )}
    </Panel>
  );
}

export function PitSummary({ data, p }: { data: SessionData; p: PitPrediction }) {
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const cheap = p.status.startsWith('SC') || p.status.startsWith('VSC');
  return (
    <>
      <div>
        If <b style={{ color: data.drivers.get(p.driver)?.colour }}>{code(p.driver)}</b> pits now: rejoins <b>P{p.position}</b>
      </div>
      <div className="muted num" style={{ fontSize: 12 }}>
        {p.ahead && <>{p.ahead.gap.toFixed(1)} s behind {code(p.ahead.driver)}</>}
        {p.ahead && p.behind && ' · '}
        {p.behind && <>{p.behind.gap.toFixed(1)} s ahead of {code(p.behind.driver)}</>}
      </div>
      <div className="dim" style={{ fontSize: 11 }}>
        Stop costs ~{p.loss.toFixed(1)} s{cheap ? ' (cheaper under the Safety Car)' : ''}
      </div>
    </>
  );
}
