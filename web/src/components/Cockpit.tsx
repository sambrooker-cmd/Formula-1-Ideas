// Virtual cockpit: the selected driver's car from the inside: shift lights, gear and speed,
// pedals, live delta to their best lap, a g-force circle and a heading-up track view.
import { useEffect, useRef } from 'react';
import type { SessionData } from '../data/session';
import { carPosition, formatLapTime, isRetired, tower } from '../data/state';
import { channelAt, gForces, headingAt, liveDelta, rpmMax } from '../data/cockpit';
import { outlineFromLaps } from '../data/session';
import { clock, now } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Tyre } from './TimingTower';

const LIGHTS = 15;

export function Cockpit({ data }: { data: SessionData }) {
  const t = useNow(30);
  const { selected } = useSynced();
  const rows = tower(data, t);
  const n = selected[0] ?? rows[0]?.driver;
  const d = n != null ? data.drivers.get(n) : undefined;
  const s = n != null ? data.samples.get(n) : undefined;
  if (n == null || !d || !s) return <div className="center-msg">No drivers in this session.</div>;
  if (!s.carT.length) return <div className="center-msg">No car data in this session (the hosted site keeps practice to lap times only).</div>;

  const row = rows.find((r) => r.driver === n);
  const speed = channelAt(s, 'speed', t) ?? 0;
  const rpm = channelAt(s, 'rpm', t) ?? 0;
  const i = Math.max(0, Math.min(s.carT.length - 1, binIdx(s.carT, t)));
  const gear = s.gear[i];
  const throttle = Math.min(100, Math.max(0, channelAt(s, 'throttle', t) ?? 0));
  const brake = s.brake[i] > 0;
  const drs = s.drs[i];
  const top = rpmMax(s);
  const frac = Math.max(0, Math.min(1, (rpm - top * 0.72) / (top * 0.27)));
  const lit = Math.round(frac * LIGHTS);
  const delta = liveDelta(data, n, t);
  const g = gForces(s, t);
  const out = isRetired(data, n, t);
  const live = s.carT.length && t - s.carT[i] < 3000;

  return (
    <div className="cockpit" style={{ ['--team' as string]: d.colour }}>
      <div className="ck-top">
        <select className="lap-jump" value={n} onChange={(e) => clock.setSelected([Number(e.target.value)])} aria-label="Driver">
          {data.driverOrder.map((x) => (
            <option key={x} value={x}>
              {data.drivers.get(x)?.code}
            </option>
          ))}
        </select>
        <b>{d.name}</b>
        <span className="muted">{d.team}</span>
        <span style={{ flex: 1 }} />
        {row && row.position < 99 && <span className="ck-pos num">P{row.position}</span>}
        <Tyre compound={row?.compound ?? null} age={row?.tyreAge} />
      </div>

      <div className={'ck-lights' + (frac >= 0.97 ? ' flash' : '')}>
        {Array.from({ length: LIGHTS }, (_, k) => (
          <i key={k} className={k < lit ? (k < 5 ? 'g' : k < 10 ? 'r' : 'b') : ''} />
        ))}
      </div>

      <div className="ck-main">
        <Pedal label="BRAKE" value={brake ? 100 : 0} colour="var(--red)" />
        <div className="ck-wheel">
          <div className="ck-screen">
            <div className="ck-side">
              <div className="ck-label">SPEED</div>
              <div className="ck-big num">{Math.round(speed)}</div>
              <div className="ck-label">km/h</div>
            </div>
            <div className="ck-gear num">{out ? '–' : gear || 'N'}</div>
            <div className="ck-side">
              <div className="ck-label">DELTA</div>
              <div className={'ck-big num ' + (delta == null ? 'dim' : delta.delta <= 0 ? 'good' : 'bad')}>
                {delta == null ? '––' : (delta.delta <= 0 ? '−' : '+') + Math.abs(delta.delta).toFixed(2)}
              </div>
              <div className="ck-label">{delta ? `vs best ${formatLapTime(delta.bestTime)}` : 'to best lap'}</div>
            </div>
          </div>
          <div className="ck-strip num">
            <span>{Math.round(rpm).toLocaleString()} rpm</span>
            {drs !== 255 && <span className={drs >= 10 ? 'on' : ''}>DRS</span>}
            <span>LAP {row?.lap || '–'}</span>
            <span>LAST {formatLapTime(row?.lastLap) || '–'}</span>
          </div>
        </div>
        <Pedal label="THROTTLE" value={throttle} colour="var(--green)" />
      </div>

      <div className="ck-bottom">
        <div className="ck-card">
          <div className="ck-label">HEADING-UP TRACK VIEW</div>
          <TrackAhead data={data} n={n} />
        </div>
        <div className="ck-card">
          <div className="ck-label">G-FORCE (ESTIMATED)</div>
          <GCircle g={g} n={n} data={data} />
        </div>
      </div>
      {!live && !out && <div className="dim" style={{ textAlign: 'center', fontSize: 12 }}>No fresh car data at this moment (garage, pit lane or a data gap).</div>}
    </div>
  );
}

function binIdx(arr: ArrayLike<number>, t: number) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function Pedal({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="ck-pedal">
      <div className="ck-pedal-bar">
        <i style={{ height: value + '%', background: colour }} />
      </div>
      <div className="ck-label">{label}</div>
    </div>
  );
}

/** The track ahead, rotated so the car always points up, with nearby cars. Canvas, redrawn every frame. */
function TrackAhead({ data, n }: { data: SessionData; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const heading = useRef(0);
  useEffect(() => {
    const outline = data.meta.outline.length ? data.meta.outline : outlineFromLaps(data);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W * dpr) {
        c.width = W * dpr;
        c.height = H * dpr;
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const t = now();
      const s = data.samples.get(n);
      const me = s ? carPosition(s, t) : null;
      if (!s || !me) return;
      const h = headingAt(s, t, 300);
      if (h != null) {
        // Smooth the turn so the view doesn't twitch.
        const diff = Math.atan2(Math.sin(h - heading.current), Math.cos(h - heading.current));
        heading.current += diff * 0.25;
      }
      const scale = Math.min(W, H) / 4500; // ~450 m across
      const ox = W / 2;
      const oy = H * 0.72;
      // Rotate the world (y up) so the heading points along +y, then draw with screen y flipped.
      const rot = Math.PI / 2 - heading.current;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const Pm = (x: number, y: number): [number, number] => {
        const dx = x - me.x;
        const dy = y - me.y;
        return [ox + (dx * cos - dy * sin) * scale, oy - (dx * sin + dy * cos) * scale];
      };
      const draw2 = (width: number, colour: string) => {
        ctx.beginPath();
        outline.forEach(([x, y], k) => {
          const [px, py] = Pm(x, y);
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.closePath();
        ctx.lineWidth = width;
        ctx.strokeStyle = colour;
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      draw2(Math.max(8, 140 * scale), '#1d2430');
      draw2(2, '#5b6676');
      // Other cars nearby.
      for (const other of data.driverOrder) {
        if (other === n || isRetired(data, other, t)) continue;
        const os = data.samples.get(other);
        const p = os ? carPosition(os, t) : null;
        if (!p || p.stale) continue;
        const [px, py] = Pm(p.x, p.y);
        if (px < -20 || py < -20 || px > W + 20 || py > H + 20) continue;
        ctx.fillStyle = data.drivers.get(other)?.colour ?? '#888';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e8edf3';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillText(data.drivers.get(other)?.code ?? '', px + 9, py + 4);
      }
      // Our car: an arrow pointing up.
      ctx.fillStyle = data.drivers.get(n)?.colour ?? '#fff';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy - 12);
      ctx.lineTo(ox + 8, oy + 8);
      ctx.lineTo(ox, oy + 4);
      ctx.lineTo(ox - 8, oy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, n]);
  return <canvas ref={ref} className="ck-canvas" />;
}

/** Friction circle: where the car is in its grip, with a short trail. */
function GCircle({ g, n, data }: { g: { lon: number; lat: number } | null; n: number; data: SessionData }) {
  const trail = useRef<{ lon: number; lat: number }[]>([]);
  const last = useRef(n);
  if (last.current !== n) {
    trail.current = [];
    last.current = n;
  }
  if (g) {
    trail.current.push(g);
    if (trail.current.length > 45) trail.current.shift();
  }
  const R = 80;
  const C = 95;
  const toXY = (p: { lon: number; lat: number }) => [C - (p.lat / 6) * R, C - (p.lon / 6) * R] as const;
  const colour = data.drivers.get(n)?.colour ?? '#fff';
  return (
    <svg viewBox="0 0 190 190" className="ck-g">
      {[2, 4, 6].map((r) => (
        <circle key={r} cx={C} cy={C} r={(r / 6) * R} fill="none" stroke="#ffffff14" />
      ))}
      <line x1={C - R} x2={C + R} y1={C} y2={C} stroke="#ffffff14" />
      <line x1={C} x2={C} y1={C - R} y2={C + R} stroke="#ffffff14" />
      <text x={C + 3} y={C - (4 / 6) * R - 3} fill="var(--dim)" fontSize={8}>4g</text>
      <text x={C} y={10} fill="var(--dim)" fontSize={8} textAnchor="middle">ACCEL</text>
      <text x={C} y={186} fill="var(--dim)" fontSize={8} textAnchor="middle">BRAKE</text>
      <polyline points={trail.current.map((p) => toXY(p).join(',')).join(' ')} fill="none" stroke={colour} strokeOpacity={0.4} strokeWidth={1.5} />
      {g && <circle cx={toXY(g)[0]} cy={toXY(g)[1]} r={6} fill={colour} stroke="#fff" strokeWidth={1.5} />}
      {g && (
        <text x={186} y={186} fill="var(--muted)" fontSize={9} textAnchor="end">
          {Math.hypot(g.lat, g.lon).toFixed(1)} g
        </text>
      )}
    </svg>
  );
}
