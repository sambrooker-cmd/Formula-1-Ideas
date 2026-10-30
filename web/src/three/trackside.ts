// The circuit and what's around it for the 3D replay: textured asphalt with white edge lines,
// red-and-white kerbs on the corners, run-off areas, barriers with catch fencing, the start
// gantry (its lights work at the start), grid slots, grandstands along the main straight,
// trees and, for night races, floodlight towers. All generated from the circuit outline.
//
// Things that stand up (barriers, stands, gantry, towers) are kept out of the height-
// exaggerated group, so "Hills ×3" stretches the landscape but not the walls; `setUp` moves
// them to the right height.
import * as THREE from 'three';
import type { Track3D } from '../data/track3d';

export const TRACK_WIDTH = 14;
const HALF = TRACK_WIDTH / 2;
const KERB_W = 1.4;

// ---- textures (drawn once, in code) --------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Seeded random numbers, so the scenery is the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const asphaltTexture = () =>
  canvasTexture(512, 512, (ctx) => {
    const r = rng(7);
    ctx.fillStyle = '#3b3e43';
    ctx.fillRect(0, 0, 512, 512);
    // Aggregate: thousands of tiny light and dark specks.
    for (let i = 0; i < 26000; i++) {
      const v = 40 + r() * 50;
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 4})`;
      ctx.fillRect(r() * 512, r() * 512, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    // The racing line darkens with rubber: a soft dark band down the middle.
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.26)');
    g.addColorStop(0.65, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
  });

const kerbTexture = () =>
  canvasTexture(256, 32, (ctx) => {
    ctx.fillStyle = '#d42a24';
    ctx.fillRect(0, 0, 128, 32);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(128, 0, 128, 32);
    // Ridges: a darker line along each block's edge.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, 256, 3);
  });

const grassTexture = () =>
  canvasTexture(512, 512, (ctx) => {
    const r = rng(3);
    ctx.fillStyle = '#3d6b2f';
    ctx.fillRect(0, 0, 512, 512);
    // Mowing stripes.
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
      ctx.fillRect(i * 64, 0, 64, 512);
    }
    for (let i = 0; i < 30000; i++) {
      const g = 70 + r() * 70;
      ctx.fillStyle = `rgba(${g * 0.45},${g},${g * 0.35},0.35)`;
      ctx.fillRect(r() * 512, r() * 512, 1, 1 + r() * 2);
    }
  });

const gravelTexture = () =>
  canvasTexture(256, 256, (ctx) => {
    const r = rng(11);
    ctx.fillStyle = '#b9a789';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 12000; i++) {
      const v = 140 + r() * 90;
      ctx.fillStyle = `rgb(${v},${v * 0.9},${v * 0.74})`;
      ctx.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    }
  });

const runoffTexture = () =>
  canvasTexture(256, 64, (ctx) => {
    // Painted tarmac run-off: blue with a white band, as at most modern circuits.
    ctx.fillStyle = '#3a5f9a';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#e9edf3';
    ctx.fillRect(0, 0, 256, 6);
    const r = rng(5);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
      ctx.fillRect(r() * 256, r() * 64, 1, 1);
    }
  });

const barrierTexture = () =>
  canvasTexture(256, 64, (ctx) => {
    // Tecpro-style blocks: alternating blue and white, with a darker base.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#e8eaee' : '#2456a8';
      ctx.fillRect(i * 64, 0, 64, 64);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) ctx.fillRect(i * 64, 0, 2, 64);
    ctx.fillRect(0, 54, 256, 10);
  });

const fenceTexture = () =>
  canvasTexture(
    64,
    64,
    (ctx) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.strokeStyle = 'rgba(170,176,186,0.75)';
      ctx.lineWidth = 0.8;
      for (let i = -64; i < 128; i += 6) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 64, 64);
        ctx.moveTo(i + 64, 0);
        ctx.lineTo(i, 64);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(120,126,135,1)';
      ctx.fillRect(0, 0, 3, 64); // post
    },
    true,
  );

const crowdTexture = () =>
  canvasTexture(512, 128, (ctx) => {
    const r = rng(17);
    ctx.fillStyle = '#4a4f58';
    ctx.fillRect(0, 0, 512, 128);
    const colours = ['#e8e8e8', '#ff8000', '#e10600', '#3671c6', '#27f4d2', '#ffd200', '#222', '#c8a27a', '#8a5a3c'];
    for (let y = 4; y < 128; y += 9)
      for (let x = 2; x < 512; x += 6) {
        if (r() < 0.12) continue; // empty seat
        ctx.fillStyle = colours[Math.floor(r() * colours.length)];
        ctx.fillRect(x + r() * 1.5, y, 4, 6);
      }
  });

/** Circuits on city streets (walls close to the track, buildings instead of fields). */
const STREET = /monaco|monte carlo|singapore|marina bay|baku|jeddah|las vegas|valencia|sochi/i;
export const isStreetCircuit = (name: string) => STREET.test(name);

const wallTexture = () =>
  canvasTexture(512, 64, (ctx) => {
    // Concrete wall faced with plain coloured advertising boards (no real brands).
    ctx.fillStyle = '#c9ccd1';
    ctx.fillRect(0, 0, 512, 64);
    const boards = ['#1d3f8f', '#e8e8e8', '#c8102e', '#111', '#f2b705', '#0b7a75'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = boards[(i * 3 + 1) % boards.length];
      ctx.fillRect(i * 128 + 4, 8, 120, 40);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 54, 512, 10);
  });

export const pavementTexture = () =>
  canvasTexture(512, 512, (ctx) => {
    const r = rng(23);
    ctx.fillStyle = '#5d6066';
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 20000; i++) {
      const v = 75 + r() * 40;
      ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
      ctx.fillRect(r() * 512, r() * 512, 1.5, 1.5);
    }
    // Paving joints.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i <= 512; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }
  });

/** Building fronts: rows of windows, some lit (lit ones glow at night). */
const facadeTextures = () => {
  const r = rng(31);
  const lit: [number, number][] = [];
  const day = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#8d939c';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 8; y < 256; y += 16)
      for (let x = 6; x < 256; x += 16) {
        const on = r() < 0.45;
        if (on) lit.push([x, y]);
        ctx.fillStyle = on ? '#4b5a6e' : '#3a4452';
        ctx.fillRect(x, y, 10, 9);
      }
  });
  const glow = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    for (const [x, y] of lit) {
      ctx.fillStyle = r() < 0.5 ? '#ffd9a0' : '#fff2d6';
      ctx.fillRect(x, y, 10, 9);
    }
  });
  return { day, glow };
};

// ---- geometry helpers ---------------------------------------------------------------------

interface Frame {
  /** Left-pointing unit normal (X, Z). */
  nx: number;
  nz: number;
  /** Signed curvature (1/m): positive turns left. */
  curv: number;
}

function frames(track: Track3D): Frame[] {
  const { pts, dist } = track;
  const n = pts.length;
  const out: Frame[] = [];
  const heading = (a: number, b: number) => Math.atan2(pts[b][2] - pts[a][2], pts[b][0] - pts[a][0]);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0];
    const tz = b[2] - a[2];
    const len = Math.hypot(tx, tz) || 1;
    // Curvature over about ±12 m (at least one point either side).
    const along = (a: number, b: number) => ((dist[b % n] - dist[(a + n) % n]) % track.length + track.length) % track.length;
    let k1 = i - 1;
    let k2 = i + 1;
    while (k1 > i - 30 && along(k1 - 1, i) < 12) k1--;
    while (k2 < i + 30 && along(i, k2 + 1) < 12) k2++;
    const h1 = heading((k1 + n) % n, i);
    const h2 = heading(i, k2 % n);
    let dh = h2 - h1;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const span = Math.max(1, along(k1, k2));
    // Z points south, so a positive change in this heading is a right turn: flip for "left = +".
    out.push({ nx: tz / len, nz: -tx / len, curv: -dh / span });
  }
  // Smooth the curvature a little.
  return out.map((f, i) => {
    let s = 0;
    for (let k = -4; k <= 4; k++) s += out[(i + k + n) % n].curv;
    return { ...f, curv: s / 9 };
  });
}

/**
 * A strip alongside the centre line between two sideways offsets (positive = left), for the
 * points where `keep(i)` is true. UVs: u runs along the track (metres / uLen), v across.
 */
function ribbon(track: Track3D, fr: Frame[], from: (i: number) => number, to: (i: number) => number, lift: number, keep: (i: number) => boolean, uLen: number) {
  const { pts, dist } = track;
  const n = pts.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = -1; // vertex index of the previous kept point in this run
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    if (!keep(i)) {
      run = -1;
      continue;
    }
    const p = pts[i];
    const f = fr[i];
    const a = from(i);
    const b = to(i);
    const base = pos.length / 3;
    pos.push(p[0] + f.nx * a, p[1] + lift, p[2] + f.nz * a, p[0] + f.nx * b, p[1] + lift, p[2] + f.nz * b);
    const u = (k === n ? track.length : dist[i]) / uLen;
    uv.push(u, 0, u, 1);
    if (run >= 0) idx.push(run, base, run + 1, run + 1, base, base + 1);
    run = base;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Wind the triangles so they face up (which way round depends on the offsets' order).
  if (idx.length >= 3) {
    const v = (k: number) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const [a, b, c] = [v(idx[0]), v(idx[1]), v(idx[2])];
    const up = b.clone().sub(a).cross(c.clone().sub(a)).y;
    if (up < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points near the track (for keeping scenery off it): a coarse grid of outline points. */
class NearTrack {
  private cells = new Map<string, number[]>();
  constructor(
    private track: Track3D,
    private cell = 25,
  ) {
    track.pts.forEach((p, i) => {
      const k = `${Math.floor(p[0] / cell)},${Math.floor(p[2] / cell)}`;
      (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
    });
  }
  /** Distance from (x, z) to the nearest outline point, ignoring points within `skip` of index `own` (≤ `max` is enough). */
  distance(x: number, z: number, max: number, own = -1, skip = 0) {
    const r = Math.ceil(max / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const n = this.track.pts.length;
    let best = Infinity;
    for (let a = -r; a <= r; a++)
      for (let b = -r; b <= r; b++)
        for (const i of this.cells.get(`${cx + a},${cz + b}`) ?? []) {
          if (own >= 0) {
            const d = Math.abs(i - own);
            if (Math.min(d, n - d) <= skip) continue;
          }
          const p = this.track.pts[i];
          best = Math.min(best, Math.hypot(p[0] - x, p[2] - z));
        }
    return best;
  }
}

// ---- the build -----------------------------------------------------------------------------------

export interface Trackside {
  /** Lies on the ground: goes in the height-exaggerated group. */
  flat: THREE.Group;
  /** Stands up: positioned by setUp. */
  upright: THREE.Group;
  asphalt: THREE.MeshStandardMaterial;
  setUp(up: number): void;
  /** Start lights: how many of the five are lit (0 = off). */
  setStartLights(n: number): void;
  /** Floodlights on (night races). */
  setNight(on: boolean): void;
  /** Ground-level meshes that should receive shadows. */
  receivers: THREE.Mesh[];
  casters: THREE.Object3D[];
}

export function buildTrackside(track: Track3D, detail: 'high' | 'standard', street = false): Trackside {
  const flat = new THREE.Group();
  const upright = new THREE.Group();
  const receivers: THREE.Mesh[] = [];
  const casters: THREE.Object3D[] = [];
  const { pts, dist } = track;
  const n = pts.length;
  const fr = frames(track);
  const near = new NearTrack(track);
  const all = () => true;

  // Asphalt.
  const asphaltTex = asphaltTexture();
  const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0, color: 0xffffff });
  const road = new THREE.Mesh(
    ribbon(track, fr, () => HALF, () => -HALF, 0, all, TRACK_WIDTH),
    asphalt,
  );
  receivers.push(road);
  flat.add(road);

  // White lines along both edges.
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 });
  for (const side of [1, -1]) {
    const line = new THREE.Mesh(
      ribbon(track, fr, () => side * (HALF - 0.1), () => side * (HALF - 0.4), 0.02, all, 10),
      white,
    );
    receivers.push(line);
    flat.add(line);
  }

  // Corners: kerbs on both sides where the track bends (radius under ~150 m), and run-off on the outside.
  const corner = (i: number) => Math.abs(fr[i].curv) > 1 / 150;
  const inCorner = new Array(n).fill(false);
  for (let i = 0; i < n; i++)
    if (corner(i))
      for (let k = -4; k <= 4; k++) inCorner[(i + k + n) % n] = true;
  const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTexture(), roughness: 0.7 });
  for (const side of [1, -1]) {
    const kerb = new THREE.Mesh(
      ribbon(track, fr, () => side * HALF, () => side * (HALF + KERB_W), 0.04, (i) => inCorner[i], 3),
      kerbMat,
    );
    receivers.push(kerb);
    flat.add(kerb);
  }
  // Run-off on the outside of corners: gravel at slower corners, painted tarmac at faster ones.
  const gravelMat = new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1 });
  (gravelMat.map as THREE.Texture).repeat.set(1, 3);
  const runoffMat = new THREE.MeshStandardMaterial({ map: runoffTexture(), roughness: 0.85 });
  for (const side of street ? [] : [1, -1]) {
    const outside = (i: number) => inCorner[i] && Math.sign(fr[i].curv) === -side; // turning away from this side
    const tight = (i: number) => Math.abs(fr[i].curv) > 1 / 60;
    const width = (i: number) => side * (HALF + KERB_W + Math.min(18, 6 + Math.abs(fr[i].curv) * 900));
    for (const [mat, which] of [
      [gravelMat, (i: number) => outside(i) && tight(i)],
      [runoffMat, (i: number) => outside(i) && !tight(i)],
    ] as const) {
      const m = new THREE.Mesh(ribbon(track, fr, () => side * (HALF + KERB_W), width, 0.03, which, 12), mat);
      receivers.push(m);
      flat.add(m);
    }
  }
  // A narrow tarmac verge everywhere else, so the grass doesn't start right at the white line.
  const vergeMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.95 });
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(ribbon(track, fr, () => side * HALF, () => side * (HALF + 2.5), 0.01, (i) => !inCorner[i], 10), vergeMat);
    receivers.push(m);
    flat.add(m);
  }

  // Grid slots: 22 short white lines behind the start, alternating sides, 8 m apart.
  const slotGeo = new THREE.PlaneGeometry(0.3, 3.2);
  slotGeo.rotateX(-Math.PI / 2);
  const slots = new THREE.InstancedMesh(slotGeo, white, 22);
  const slotPos: { i: number; side: number }[] = [];
  for (let k = 0; k < 22; k++) {
    const back = 10 + k * 8;
    let i = n - 1;
    while (i > 0 && track.length - dist[i] < back) i--;
    slotPos.push({ i, side: k % 2 ? -1 : 1 });
  }
  const m4 = new THREE.Matrix4();
  slotPos.forEach(({ i, side }, k) => {
    const p = pts[i];
    const f = fr[i];
    const ang = Math.atan2(f.nx, f.nz);
    m4.compose(new THREE.Vector3(p[0] + f.nx * side * 3.2, p[1] + 0.025, p[2] + f.nz * side * 3.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang), new THREE.Vector3(1, 1, 1));
    slots.setMatrixAt(k, m4);
  });
  flat.add(slots);

  // Chequered start/finish line.
  const chequer = canvasTexture(64, 8, (ctx) => {
    for (let x = 0; x < 64; x += 4)
      for (let y = 0; y < 8; y += 4) {
        ctx.fillStyle = (x + y) % 8 ? '#111' : '#f2f2f2';
        ctx.fillRect(x, y, 4, 4);
      }
  });
  chequer.magFilter = THREE.NearestFilter;
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 1.2), new THREE.MeshStandardMaterial({ map: chequer, roughness: 0.6 }));
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = Math.atan2(pts[1][2] - pts[0][2], pts[1][0] - pts[0][0]) + Math.PI / 2;
  startLine.position.set(pts[0][0], pts[0][1] + 0.03, pts[0][2]);
  flat.add(startLine);

  // ---- upright things -------------------------------------------------------------------
  // Each remembers the track height it stands on, so setUp can follow the exaggeration.
  const anchored: { obj: THREE.Object3D; y: number }[] = [];
  const anchor = (obj: THREE.Object3D, y: number) => {
    anchored.push({ obj, y });
    upright.add(obj);
  };

  // Barriers: blue-and-white walls with catch fencing above, set back from the track. Where
  // another part of the circuit runs close by, the wall is left out rather than cutting across.
  const barrierMat = new THREE.MeshStandardMaterial({ map: street ? wallTexture() : barrierTexture(), roughness: 0.8 });
  const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTexture(), transparent: true, alphaTest: 0.2, opacity: 0.8, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  const barrierGeos: THREE.BufferGeometry[] = [];
  const fenceGeos: THREE.BufferGeometry[] = [];
  const wallBase: number[] = [];
  const fenceBase: number[] = [];
  for (const side of [1, -1]) {
    const off = (i: number) => {
      const out = Math.sign(fr[i].curv) === -side && inCorner[i];
      // Street circuits: walls right by the track (a little room at the corners' escape roads).
      if (street) return side * (HALF + KERB_W + (out ? 3 : 0.8));
      return side * (HALF + KERB_W + (out ? Math.min(20, 8 + Math.abs(fr[i].curv) * 900) : 4));
    };
    const ok = (i: number) => {
      const o = off(i);
      const x = pts[i][0] + fr[i].nx * o;
      const z = pts[i][2] + fr[i].nz * o;
      return near.distance(x, z, HALF + 6, i, 25) > HALF + 5;
    };
    const keep = new Array(n).fill(false).map((_, i) => ok(i));
    // Build vertical strips: ground (h=0) to top (h).
    const wall = (h0: number, h1: number, into: THREE.BufferGeometry[], base: number[]) => {
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let prev = -1;
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        if (!keep[i]) {
          prev = -1;
          continue;
        }
        const o = off(i);
        const x = pts[i][0] + fr[i].nx * o;
        const z = pts[i][2] + fr[i].nz * o;
        const v = pos.length / 3;
        pos.push(x, h0, z, x, h1, z);
        base.push(pts[i][1], pts[i][1]);
        const u = (k === n ? track.length : dist[i]) / (street ? 24 : 4);
        uv.push(u, 0, u, 1);
        if (prev >= 0) idx.push(prev, v, prev + 1, prev + 1, v, v + 1);
        prev = v;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      into.push(g);
    };
    wall(0, 1.1, barrierGeos, wallBase);
    wall(1.1, 4.2, fenceGeos, fenceBase);
  }
  const walls = barrierGeos.map((g) => new THREE.Mesh(g, barrierMat));
  walls.forEach((w) => (w.material.side = THREE.DoubleSide));
  const fences = fenceGeos.map((g) => new THREE.Mesh(g, fenceMat));
  // Upright strips: their y is "height above the track" plus the track height, set in setUp.
  const strips = [...walls, ...fences];
  const stripLocal = strips.map((m) => Float32Array.from(m.geometry.getAttribute('position').array));
  const stripBase: number[][] = [];
  {
    let w = 0;
    let f = 0;
    for (const m of walls) {
      const c = m.geometry.getAttribute('position').count;
      stripBase.push(wallBase.slice(w, w + c));
      w += c;
    }
    for (const m of fences) {
      const c = m.geometry.getAttribute('position').count;
      stripBase.push(fenceBase.slice(f, f + c));
      f += c;
    }
  }
  strips.forEach((m) => upright.add(m));
  walls.forEach((m) => casters.push(m));

  // Start gantry over the line, with five pairs of red lights.
  const gantry = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.6 });
  const span = TRACK_WIDTH + 4;
  for (const s of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), steel);
    post.position.set(0, 3.75, (s * span) / 2);
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, span), steel);
  beam.position.set(0, 7.2, 0);
  gantry.add(beam);
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x220606, roughness: 0.4 });
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xff1a12 });
  const lamps: THREE.Mesh[][] = [];
  for (let k = 0; k < 5; k++) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.6), steel);
    const z = (k - 2) * 1.1;
    pod.position.set(0.35, 6.1, z);
    gantry.add(pod);
    const pair: THREE.Mesh[] = [];
    for (const y of [6.55, 6.05]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), lampOff);
      lamp.rotation.y = Math.PI / 2;
      lamp.position.set(0.61, y, z);
      gantry.add(lamp);
      pair.push(lamp);
    }
    lamps.push(pair);
  }
  // The beam (local Z) spans the track; the lights (local +X) face the oncoming cars.
  gantry.rotation.y = Math.atan2(fr[0].nx, fr[0].nz);
  gantry.position.set(pts[0][0], 0, pts[0][2]);
  anchor(gantry, pts[0][1]);
  casters.push(gantry);

  // Grandstands along the main straight, on whichever side has room.
  const crowd = crowdTexture();
  const standMat = [
    new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 }),
  ];
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.6, metalness: 0.2 });
  const stands = detail === 'high' ? 5 : 3;
  for (let k = 0; k < stands; k++) {
    // From 40 m to ~400 m after the line, and the same before it.
    const target = k % 2 === 0 ? 40 + (k / 2) * 110 : track.length - 70 - ((k - 1) / 2) * 110;
    let i = 0;
    while (i < n - 1 && dist[i] < target) i++;
    for (const side of [1, -1]) {
      const o = side * (HALF + 26);
      const x = pts[i][0] + fr[i].nx * o;
      const z = pts[i][2] + fr[i].nz * o;
      if (near.distance(x, z, 40, i, 30) < 30) continue;
      const stand = new THREE.Group();
      // Stepped seating: rising away from the track.
      for (let s = 0; s < 6; s++) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(70, 1.4 + s * 1.4, 2.6), [standMat[0], standMat[0], standMat[1], standMat[0], standMat[0], standMat[1]]);
        step.position.set(0, (1.4 + s * 1.4) / 2, s * 2.6);
        stand.add(step);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(72, 0.3, 18), roofMat);
      roof.position.set(0, 13, 6);
      stand.add(roof);
      for (const px of [-34, 0, 34]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 13, 0.5), steel);
        col.position.set(px, 6.5, 15);
        stand.add(col);
      }
      // Face the track: local +Z points away from it.
      stand.rotation.y = Math.atan2(fr[i].nx * side, fr[i].nz * side);
      stand.position.set(x, 0, z);
      anchor(stand, pts[i][1]);
      casters.push(stand);
      break;
    }
  }

  // Trees: scattered beyond the barriers, never on the circuit.
  const treeCount = street ? (detail === 'high' ? 120 : 40) : detail === 'high' ? 700 : 220;
  const r = rng(42);
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 5);
  trunkGeo.translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(3, 0);
  crownGeo.scale(1, 1.3, 1);
  crownGeo.translate(0, 5.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 1, flatShading: true }), treeCount);
  const [cx, cz] = track.centre;
  const reach = track.radius * 1.5 + 150;
  let placed = 0;
  const treeBase: { x: number; z: number; s: number; y: number; rot: number }[] = [];
  for (let tries = 0; tries < treeCount * 8 && placed < treeCount; tries++) {
    const x = cx + (r() * 2 - 1) * reach;
    const z = cz + (r() * 2 - 1) * reach;
    const d = near.distance(x, z, 60);
    if (d < 45) continue;
    // Clumps: more likely near other trees.
    const s = 0.7 + r() * 0.8;
    // Ground height: the nearest track point's height (the ground follows the land roughly).
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i += 4) {
      const dd = (pts[i][0] - x) ** 2 + (pts[i][2] - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    treeBase.push({ x, z, s, y: pts[best][1], rot: r() * Math.PI * 2 });
    const tint = new THREE.Color().setHSL(0.27 + r() * 0.06, 0.45, 0.2 + r() * 0.1);
    crowns.setColorAt(placed, tint);
    placed++;
  }
  trunks.count = crowns.count = placed;
  upright.add(trunks, crowns);
  casters.push(crowns);

  // Street circuits: city blocks of buildings along both sides, set back behind the walls.
  const facade = street ? facadeTextures() : null;
  const buildingMat = new THREE.MeshStandardMaterial({
    map: facade?.day ?? null,
    emissiveMap: facade?.glow ?? null,
    emissive: new THREE.Color(0x000000),
    roughness: 0.8,
    metalness: 0.1,
  });
  const buildingBase: { x: number; z: number; y: number; w: number; d: number; h: number; rot: number }[] = [];
  if (street) {
    const rb = rng(77);
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (dist[i] < next) continue;
      next = dist[i] + 22 + rb() * 18;
      for (const side of [1, -1]) {
        if (rb() < 0.25) continue; // the odd gap: a square, a side street
        const w = 16 + rb() * 22;
        const d = 14 + rb() * 18;
        const h = 12 + rb() ** 2 * (detail === 'high' ? 90 : 60);
        const o = side * (HALF + 10 + d / 2 + rb() * 8);
        const x = pts[i][0] + fr[i].nx * o;
        const z = pts[i][2] + fr[i].nz * o;
        if (near.distance(x, z, Math.max(w, d) / 2 + 14, -1, 0) < Math.max(w, d) / 2 + 10) continue;
        buildingBase.push({ x, z, y: pts[i][1], w, d, h, rot: Math.atan2(fr[i].nx, fr[i].nz) });
      }
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  // Three height bands, each with its windows repeated to suit, so windows stay storey-sized.
  const bands = [
    { min: 0, max: 30, rows: 2 },
    { min: 30, max: 60, rows: 4 },
    { min: 60, max: Infinity, rows: 7 },
  ].map((band) => {
    const list = buildingBase.filter((b) => b.h > band.min && b.h <= band.max);
    const mat = buildingMat.clone();
    if (facade) {
      mat.map = facade.day.clone();
      mat.map.repeat.set(2, band.rows);
      mat.map.needsUpdate = true;
      mat.emissiveMap = facade.glow.clone();
      mat.emissiveMap.repeat.set(2, band.rows);
      mat.emissiveMap.needsUpdate = true;
    }
    // Roofs are plain (box faces: +x, −x, +y = roof, −y, +z, −z).
    const roof = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(boxGeo, [mat, mat, roof, roof, mat, mat], Math.max(1, list.length));
    mesh.count = list.length;
    if (list.length) {
      upright.add(mesh);
      casters.push(mesh);
    }
    return { list, mesh, mat };
  });

  // Floodlight towers, only switched on (shown) for night races.
  const towers = new THREE.Group();
  towers.visible = false;
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  let nextTower = 0;
  for (let i = 0; i < n; i++) {
    if (dist[i] < nextTower) continue;
    nextTower = dist[i] + 90;
    const side = i % 2 ? 1 : -1;
    const o = side * (HALF + 12);
    const x = pts[i][0] + fr[i].nx * o;
    const z = pts[i][2] + fr[i].nz * o;
    if (near.distance(x, z, 20, i, 25) < HALF + 6) continue;
    const t = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 16, 6), towerMat);
    pole.position.y = 8;
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), lampMat);
    head.position.set(0, 16, 0);
    t.add(pole, head);
    t.rotation.y = Math.atan2(fr[i].nx, fr[i].nz);
    t.position.set(x, 0, z);
    anchored.push({ obj: t, y: pts[i][1] });
    towers.add(t);
  }
  upright.add(towers);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const setUp = (up: number) => {
    for (const a of anchored) a.obj.position.y = a.y * up;
    strips.forEach((mesh, k) => {
      const attr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const local = stripLocal[k];
      const base = stripBase[k];
      for (let v = 0; v < attr.count; v++) attr.setY(v, local[v * 3 + 1] + base[v] * up);
      attr.needsUpdate = true;
      mesh.geometry.computeBoundingSphere();
    });
    treeBase.forEach((t, k) => {
      q.setFromAxisAngle(yAxis, t.rot);
      m.compose(new THREE.Vector3(t.x, t.y * up - 0.3, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(k, m);
      crowns.setMatrixAt(k, m);
    });
    for (const band of bands) {
      band.list.forEach((b, k) => {
        q.setFromAxisAngle(yAxis, b.rot);
        m.compose(new THREE.Vector3(b.x, b.y * up - 0.3, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
        band.mesh.setMatrixAt(k, m);
      });
      band.mesh.instanceMatrix.needsUpdate = true;
      band.mesh.computeBoundingSphere();
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
  };

  return {
    flat,
    upright,
    asphalt,
    setUp,
    setStartLights: (k) => lamps.forEach((pair, i) => pair.forEach((l) => (l.material = i < k ? lampOn : lampOff))),
    setNight: (on) => {
      // Street circuits are lit by the city; elsewhere, floodlight towers.
      towers.visible = on && !street;
      for (const band of bands) band.mat.emissive.set(on ? 0xffffff : 0x000000);
    },
    receivers,
    casters,
  };
}

export { grassTexture };
