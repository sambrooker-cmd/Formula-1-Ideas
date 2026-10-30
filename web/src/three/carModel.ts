// A 2026-style Formula 1 car built from simple shapes (no model files to download): monocoque
// and nose, sidepods, floor, front and rear wings, halo, helmet, mirrors, suspension and
// wheels with tyres whose sidewall stripe shows the compound. Real size: about 5.6 m long and
// 2 m wide, pointing along +X with the ground at y = 0.
//
// The shapes are built once and shared; each car only gets its own paint, so twenty cars cost
// little more than one. Each car is a handful of meshes (parts are merged by material).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const WHEELBASE = 3.6;
export const FRONT_X = WHEELBASE / 2;
export const REAR_X = -WHEELBASE / 2;
export const WHEEL_R = 0.36;

export const COMPOUND_COLOUR: Record<string, number> = {
  SOFT: 0xe8352e,
  MEDIUM: 0xf5c518,
  HARD: 0xf2f2f2,
  INTERMEDIATE: 0x2fb34a,
  WET: 0x2a7de1,
};

// ---- shape helpers -------------------------------------------------------------------

interface Section {
  x: number;
  /** Half width and half height. */
  w: number;
  h: number;
  /** Centre height and sideways offset. */
  y: number;
  z?: number;
  /** Squareness: 2 = ellipse, higher = boxier. */
  p?: number;
}

/** A smooth body through a series of cross-sections (like a boat hull), closed at both ends. */
function loft(sections: Section[], around = 20): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (s: Section) => {
    const p = s.p ?? 2.6;
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const zz = Math.sign(c) * Math.abs(c) ** (2 / p) * s.w;
      const yy = Math.sign(sn) * Math.abs(sn) ** (2 / p) * s.h;
      pos.push(s.x, s.y + yy, (s.z ?? 0) + zz);
    }
  };
  sections.forEach(ring);
  for (let i = 0; i < sections.length - 1; i++)
    for (let k = 0; k < around; k++) {
      const a = i * around + k;
      const b = i * around + ((k + 1) % around);
      const c = (i + 1) * around + k;
      const d = (i + 1) * around + ((k + 1) % around);
      idx.push(a, c, b, b, c, d);
    }
  // Caps.
  for (const [i, flip] of [
    [0, true],
    [sections.length - 1, false],
  ] as const) {
    const s = sections[i];
    const centre = pos.length / 3;
    pos.push(s.x, s.y, s.z ?? 0);
    for (let k = 0; k < around; k++) {
      const a = i * around + k;
      const b = i * around + ((k + 1) % around);
      if (flip) idx.push(centre, b, a);
      else idx.push(centre, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rz = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, ry, rz)));
  g.translate(x, y, z);
  return g;
};

/** A wing element: a thin, slightly cambered aerofoil-ish slab, spanning z. */
function wingElement(chord: number, thick: number, span: number, x: number, y: number, angle: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-chord / 2, 0);
  shape.quadraticCurveTo(-chord * 0.2, thick * 1.4, chord / 2, thick * 0.3);
  shape.lineTo(chord / 2, 0);
  shape.quadraticCurveTo(-chord * 0.1, thick * 0.3, -chord / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -span / 2);
  g.rotateZ(angle);
  g.translate(x, y, 0);
  return g;
}

const tube = (points: [number, number, number][], r: number, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed), 24, r, 6, closed);

/** Rods are easiest built along Y and aimed with a quaternion. */
function strut(a: [number, number, number], b: [number, number, number], r = 0.018) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const dir = vb.clone().sub(va);
  const g = new THREE.CylinderGeometry(r, r, dir.length(), 5);
  g.translate(0, dir.length() / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(va.x, va.y, va.z);
  return g;
}

const mirrorZ = (g: THREE.BufferGeometry) => {
  const m = g.clone();
  m.scale(1, 1, -1);
  // Flipping one axis turns the triangles inside out: swap the winding back.
  const index = m.getIndex();
  if (index) {
    const a = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
  }
  m.computeVertexNormals();
  return m;
};
const both = (g: THREE.BufferGeometry) => [g, mirrorZ(g)];

const merge = (parts: THREE.BufferGeometry[]) =>
  mergeGeometries(
    parts.map((g) => {
      const x = g.index ? g.toNonIndexed() : g;
      // Keep only what every part has, so they merge.
      for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k);
      if (!x.attributes.normal) x.computeVertexNormals();
      return x;
    }),
  )!;

// ---- the shared shapes -----------------------------------------------------------------

interface Template {
  paint: THREE.BufferGeometry;
  accent: THREE.BufferGeometry;
  carbon: THREE.BufferGeometry;
  halo: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  visor: THREE.BufferGeometry;
  rainLight: THREE.BufferGeometry;
  tyreFront: THREE.BufferGeometry;
  tyreRear: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  stripeFront: THREE.BufferGeometry;
  stripeRear: THREE.BufferGeometry;
  numberPlate: THREE.BufferGeometry;
}

let template: Template | null = null;

function tyre(width: number) {
  // Cross-section of the tyre, revolved around the axle: rounded shoulders, flat tread.
  const r = WHEEL_R;
  const rim = 0.245;
  const hw = width / 2;
  const R = 0.05;
  const pts: THREE.Vector2[] = [new THREE.Vector2(rim, -hw)];
  for (let k = 0; k <= 5; k++) {
    const a = -Math.PI / 2 + (k / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - R + R * Math.cos(a), -hw + R + R * Math.sin(a)));
  }
  for (let k = 0; k <= 5; k++) {
    const a = (k / 5) * (Math.PI / 2);
    pts.push(new THREE.Vector2(r - R + R * Math.cos(a), hw - R + R * Math.sin(a)));
  }
  pts.push(new THREE.Vector2(rim, hw));
  const g = new THREE.LatheGeometry(pts, 28);
  g.rotateX(Math.PI / 2); // axle along Z
  return g;
}

function build(): Template {
  // Monocoque, nose and engine cover in one smooth body.
  const body = loft([
    { x: 2.98, w: 0.07, h: 0.05, y: 0.27, p: 2.2 },
    { x: 2.7, w: 0.13, h: 0.08, y: 0.3 },
    { x: 2.2, w: 0.2, h: 0.12, y: 0.36 },
    { x: 1.6, w: 0.26, h: 0.17, y: 0.42 },
    { x: 1.0, w: 0.32, h: 0.22, y: 0.47 },
    { x: 0.5, w: 0.38, h: 0.26, y: 0.5, p: 3 },
    { x: 0.0, w: 0.4, h: 0.25, y: 0.48, p: 3.2 },
    { x: -0.45, w: 0.36, h: 0.36, y: 0.58, p: 2.6 },
    { x: -0.9, w: 0.3, h: 0.3, y: 0.56 },
    { x: -1.5, w: 0.24, h: 0.22, y: 0.48 },
    { x: -2.0, w: 0.14, h: 0.15, y: 0.4 },
    { x: -2.3, w: 0.09, h: 0.1, y: 0.36 },
  ]);
  // Sidepods: wide at the inlet, tapering hard towards the gearbox ("downwashed").
  const pod = loft(
    [
      { x: 0.62, w: 0.14, h: 0.12, y: 0.44, z: 0.66, p: 3 },
      { x: 0.5, w: 0.22, h: 0.17, y: 0.42, z: 0.62, p: 3 },
      { x: 0.0, w: 0.26, h: 0.18, y: 0.4, z: 0.56, p: 3 },
      { x: -0.7, w: 0.22, h: 0.14, y: 0.34, z: 0.5 },
      { x: -1.4, w: 0.13, h: 0.09, y: 0.27, z: 0.38 },
      { x: -1.95, w: 0.05, h: 0.05, y: 0.24, z: 0.25 },
    ],
    16,
  );
  // Engine-cover fin and the airbox hoop above the driver's head.
  const fin = box(1.2, 0.16, 0.02, -1.45, 0.72, 0, 0.12);
  const hoop = loft(
    [
      { x: -0.3, w: 0.09, h: 0.1, y: 0.88 },
      { x: -0.45, w: 0.12, h: 0.12, y: 0.86 },
      { x: -0.75, w: 0.1, h: 0.08, y: 0.78 },
    ],
    12,
  );

  // Floor: flat plate, narrow at the front, widest between the wheels.
  const floorShape = new THREE.Shape();
  const half: [number, number][] = [
    [1.15, 0.32],
    [0.75, 0.86],
    [-0.9, 0.86],
    [-1.45, 0.62],
    [-2.2, 0.46],
  ];
  floorShape.moveTo(half[0][0], half[0][1]);
  for (const [x, z] of half.slice(1)) floorShape.lineTo(x, z);
  for (const [x, z] of [...half].reverse()) floorShape.lineTo(x, -z);
  const floor = new THREE.ExtrudeGeometry(floorShape, { depth: 0.035, bevelEnabled: false });
  floor.rotateX(Math.PI / 2);
  floor.translate(0, 0.085, 0);
  // Diffuser kick-up at the back.
  const diffuser = box(0.4, 0.02, 0.8, -2.15, 0.15, 0, -0.3);

  // Front wing: main plane plus two flaps, endplates, and the nose pylons.
  const fwMain = wingElement(0.36, 0.035, 1.9, 2.95, 0.1, 0.04);
  const fwFlap1 = wingElement(0.22, 0.03, 1.72, 2.76, 0.17, 0.32);
  const fwFlap2 = wingElement(0.17, 0.025, 1.6, 2.64, 0.24, 0.55);
  const fwEnd = both(box(0.62, 0.26, 0.02, 2.83, 0.2, 0.96));
  const fwPylons = both(box(0.3, 0.14, 0.02, 2.7, 0.2, 0.12));

  // Rear wing: main plane and DRS flap, endplates, beam wing, central swan-neck pylon.
  const rwMain = wingElement(0.34, 0.04, 1.0, -2.42, 0.86, -0.06);
  const rwFlap = wingElement(0.24, 0.03, 1.0, -2.25, 0.98, -0.42);
  const rwEnd = both(box(0.6, 0.44, 0.02, -2.36, 0.82, 0.51, 0.05));
  const beam = wingElement(0.22, 0.025, 0.74, -2.38, 0.42, -0.1);
  const pylon = box(0.06, 0.45, 0.04, -2.3, 0.62, 0, 0.35);

  // Suspension: wishbones and push/pull rods, front and rear, both sides.
  const susp: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const fz = 0.66 * side;
    const rz = 0.6 * side;
    susp.push(
      strut([1.55, 0.5, 0.2 * side], [FRONT_X, 0.5, fz]),
      strut([2.0, 0.5, 0.18 * side], [FRONT_X, 0.5, fz]),
      strut([1.5, 0.3, 0.22 * side], [FRONT_X, 0.24, fz]),
      strut([2.05, 0.3, 0.2 * side], [FRONT_X, 0.24, fz]),
      strut([1.7, 0.6, 0.18 * side], [FRONT_X, 0.26, fz], 0.016),
      strut([-1.6, 0.5, 0.2 * side], [REAR_X, 0.52, rz]),
      strut([-2.1, 0.48, 0.15 * side], [REAR_X, 0.52, rz]),
      strut([-1.55, 0.26, 0.25 * side], [REAR_X, 0.22, rz]),
      strut([-2.15, 0.28, 0.15 * side], [REAR_X, 0.22, rz]),
    );
  }

  // Mirrors on short stalks.
  const mirrors = both(box(0.1, 0.06, 0.16, 0.38, 0.74, 0.5));
  const stalks = [strut([0.42, 0.56, 0.3], [0.4, 0.72, 0.46], 0.012), strut([0.42, 0.56, -0.3], [0.4, 0.72, -0.46], 0.012)];

  // Halo: the titanium hoop around the cockpit and its centre pillar.
  const halo = merge([
    tube(
      [
        [-0.35, 0.68, 0.33],
        [-0.05, 0.86, 0.32],
        [0.3, 0.92, 0.2],
        [0.44, 0.92, 0.0],
        [0.3, 0.92, -0.2],
        [-0.05, 0.86, -0.32],
        [-0.35, 0.68, -0.33],
      ],
      0.032,
    ),
    tube(
      [
        [0.44, 0.92, 0],
        [0.55, 0.8, 0],
        [0.62, 0.7, 0],
      ],
      0.03,
    ),
  ]);

  const helmet = new THREE.SphereGeometry(0.135, 16, 12);
  helmet.scale(1.12, 1, 0.95);
  helmet.translate(-0.12, 0.8, 0);
  // Dark visor band across the front of the helmet.
  const visor = box(0.06, 0.055, 0.2, 0.02, 0.81, 0);

  const rainLight = box(0.04, 0.06, 0.14, -2.45, 0.34, 0);

  const rim = new THREE.CylinderGeometry(0.245, 0.245, 0.26, 20);
  rim.rotateX(Math.PI / 2);
  const stripe = (w: number) => {
    const s1 = new THREE.TorusGeometry(0.305, 0.012, 4, 40);
    s1.translate(0, 0, w / 2 + 0.001);
    const s2 = s1.clone();
    s2.translate(0, 0, -w - 0.002);
    return merge([s1, s2]);
  };

  const numberPlate = new THREE.PlaneGeometry(0.34, 0.24);
  numberPlate.rotateX(-Math.PI / 2);
  numberPlate.rotateY(-Math.PI / 2);
  numberPlate.translate(1.95, 0.535, 0);

  return {
    paint: merge([body, ...both(pod), fwEnd[0], fwEnd[1], rwEnd[0], rwEnd[1], hoop]),
    accent: merge([fwMain, fwFlap1, rwMain, rwFlap, fin]),
    carbon: merge([floor, diffuser, fwFlap2, ...fwPylons, beam, pylon, ...susp, ...mirrors, ...stalks]),
    halo,
    helmet,
    visor,
    rainLight,
    tyreFront: tyre(0.3),
    tyreRear: tyre(0.4),
    rim,
    stripeFront: stripe(0.3),
    stripeRear: stripe(0.4),
    numberPlate,
  };
}

// ---- shared materials ----------------------------------------------------------------------

const shared = {
  carbon: new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.45, metalness: 0.35 }),
  halo: new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.6 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.92, metalness: 0 }),
  rim: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.3, metalness: 0.85 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.08, metalness: 0.9 }),
  rainOn: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  rainOff: new THREE.MeshStandardMaterial({ color: 0x3a0d0d, roughness: 0.6 }),
  stripes: Object.fromEntries(Object.entries(COMPOUND_COLOUR).map(([k, c]) => [k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })])) as Record<
    string,
    THREE.MeshStandardMaterial
  >,
  stripeUnknown: new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }),
};

export function stripeMaterial(compound: string | null) {
  return (compound && shared.stripes[compound]) || shared.stripeUnknown;
}

function numberTexture(num: string, colour: THREE.Color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#' + colour.getHexString();
  ctx.fillRect(0, 0, 128, 96);
  const light = colour.getHSL({ h: 0, s: 0, l: 0 }).l > 0.55;
  ctx.fillStyle = light ? '#111' : '#fff';
  ctx.font = '800 72px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(num, 64, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface CarParts {
  group: THREE.Group;
  /** Spin these about Z (the axle) as the car moves. */
  wheels: THREE.Group[];
  /** Turn these about Y to steer. */
  steer: THREE.Group[];
  stripes: THREE.Mesh[];
  helmet: THREE.Object3D[];
  rainLight: THREE.Mesh;
  /** Meshes that cast shadows. */
  casters: THREE.Mesh[];
}

/** One car in a team's colours. */
export function makeCar(colourHex: string, number: string): CarParts {
  template ??= build();
  const T = template;
  const colour = new THREE.Color(colourHex);
  const hsl = colour.getHSL({ h: 0, s: 0, l: 0 });
  // A second livery colour: darker (or lighter, for very dark cars) version of the team colour.
  const accentColour = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9), hsl.l < 0.25 ? hsl.l + 0.3 : hsl.l * 0.45);
  const paint = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.32, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12 });
  const accent = new THREE.MeshPhysicalMaterial({ color: accentColour, roughness: 0.4, metalness: 0.2, clearcoat: 0.6 });
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setHSL(hsl.h, 0.25, 0.85), roughness: 0.25, clearcoat: 1 });

  const group = new THREE.Group();
  const casters: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    if (cast) casters.push(m);
    group.add(m);
    return m;
  };
  add(T.paint, paint);
  add(T.accent, accent);
  add(T.carbon, shared.carbon);
  add(T.halo, shared.halo);
  const helmet = add(T.helmet, helmetMat, false);
  const visor = add(T.visor, shared.visor, false);
  const rainLight = add(T.rainLight, shared.rainOff, false);
  add(T.numberPlate, new THREE.MeshStandardMaterial({ map: numberTexture(number, colour), roughness: 0.4 }), false);

  const wheels: THREE.Group[] = [];
  const steer: THREE.Group[] = [];
  const stripes: THREE.Mesh[] = [];
  for (const [x, z, front] of [
    [FRONT_X, 0.8, true],
    [FRONT_X, -0.8, true],
    [REAR_X, 0.76, false],
    [REAR_X, -0.76, false],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const wheel = new THREE.Group();
    const t = new THREE.Mesh(front ? T.tyreFront : T.tyreRear, shared.tyre);
    casters.push(t);
    const rim = new THREE.Mesh(T.rim, shared.rim);
    rim.scale.z = front ? 1 : 1.35;
    const s = new THREE.Mesh(front ? T.stripeFront : T.stripeRear, shared.stripeUnknown);
    wheel.add(t, rim, s);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push(wheel);
    stripes.push(s);
    if (front) steer.push(pivot);
  }
  return { group, wheels, steer, stripes, helmet: [helmet, visor], rainLight, casters };
}

export function setRainLight(parts: CarParts, on: boolean) {
  parts.rainLight.material = on ? shared.rainOn : shared.rainOff;
}
