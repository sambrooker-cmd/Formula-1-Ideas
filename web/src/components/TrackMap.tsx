import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionData } from '../data/session';
import { carPosition, isRetired, lastAtOrBefore, leaderLap, weatherAt } from '../data/state';
import { clock, getState, now } from '../sync/clock';
import { useElementSize, useNow } from '../hooks';
import { Panel } from './Panel';
import { StatusPill } from './PlaybackBar';

type Pt = [number, number];

/** Pick the rotation that lets the outline fill the panel best, then build a world→screen transform. */
function fitTransform(outline: Pt[], width: number, height: number, fixedDeg: number | null) {
  if (outline.length < 2 || width < 10 || height < 10) return null;
  const padX = 40;
  const padTop = 56; // room for the lap counter overlay
  const padBottom = 40; // and the weather strip
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
    let raf = 0;
    const draw = () => {
      const t = now();
      const { selected } = getState();
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
        cars.push({ d, p, pos, sel: selected.includes(d.number), out: isRetired(data, d.number, t) });
      }
      cars.sort((a, b) => Number(a.sel) - Number(b.sel) || b.pos - a.pos);
      ctx.font = '700 11px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (const { d, p, sel, out } of cars) {
        const [x, y] = toScreen(p.x, p.y);
        ctx.globalAlpha = p.stale || out ? 0.3 : 1;
        const r = sel ? 8.5 : 6.5;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = d.colour;
        ctx.fill();
        ctx.lineWidth = sel ? 3 : 1.5;
        ctx.strokeStyle = sel ? '#ffffff' : '#07090d';
        ctx.stroke();
        // label pill
        const w = ctx.measureText(d.code).width + 8;
        const lx = x + r + 3;
        ctx.fillStyle = sel ? '#ffffff' : '#07090dcc';
        ctx.beginPath();
        ctx.roundRect(lx, y - 8, w, 16, 4);
        ctx.fill();
        ctx.fillStyle = sel ? '#07090d' : '#e8edf3';
        ctx.fillText(d.code, lx + 4, y + 0.5);
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
      </div>
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
