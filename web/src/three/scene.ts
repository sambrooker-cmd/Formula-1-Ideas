// The 3D replay scene (three.js): circuit ribbon with heights, cars in team colours with labels,
// and four cameras: orbit, follow, on-board and TV-style trackside cameras.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SessionData } from '../data/session';
import { isRetired } from '../data/state';
import { car3d, track3d, type Track3D } from '../data/track3d';

export type CameraMode = 'orbit' | 'follow' | 'onboard' | 'tv';

const TRACK_WIDTH = 14;
const CAR_LIFT = 0.45;

interface CarObj {
  n: number;
  group: THREE.Group;
  label: THREE.Sprite;
  heading: number;
  hint: number;
  last: THREE.Vector3 | null;
}

export class ReplayScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.5, 20000);
  controls: OrbitControls;
  track: Track3D;
  cars = new Map<number, CarObj>();
  mode: CameraMode = 'follow';
  selected: number | null = null;
  exaggeration = 1;
  labels = true;
  private world = new THREE.Group(); // scaled vertically for height exaggeration
  private ring: THREE.Mesh;
  private tvCams: { pos: THREE.Vector3; idx: number }[] = [];
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private lastFrame = 0;
  private raycaster = new THREE.Raycaster();

  constructor(
    private canvas: HTMLCanvasElement,
    private data: SessionData,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x07090d);
    this.scene.fog = new THREE.Fog(0x07090d, 600, 4000);
    this.scene.add(this.world);
    this.track = track3d(data);

    this.scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a1f28, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(400, 800, 300);
    this.scene.add(sun);

    this.buildTrack();
    for (const n of data.driverOrder) this.addCar(n);

    const ringGeo = new THREE.RingGeometry(3.2, 3.9, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.world.add(this.ring);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    const [cx, cz] = this.track.centre;
    this.controls.target.set(cx, 0, cz);
    this.camera.position.set(cx, this.track.radius * 1.1, cz + this.track.radius * 1.1);
    this.camPos.copy(this.camera.position);
    this.controls.update();
  }

  // ---- building ----------------------------------------------------------------

  private buildTrack() {
    const { pts } = this.track;
    if (pts.length < 3) return;
    const n = pts.length;
    const pos: number[] = [];
    const edgesL: number[] = [];
    const edgesR: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      let tx = b[0] - a[0];
      let tz = b[2] - a[2];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      const nx = -tz * (TRACK_WIDTH / 2);
      const nz = tx * (TRACK_WIDTH / 2);
      const p = pts[i];
      pos.push(p[0] + nx, p[1], p[2] + nz, p[0] - nx, p[1], p[2] - nz);
      edgesL.push(p[0] + nx, p[1] + 0.05, p[2] + nz);
      edgesR.push(p[0] - nx, p[1] + 0.05, p[2] - nz);
    }
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(2 * i, 2 * j, 2 * i + 1, 2 * i + 1, 2 * j, 2 * j + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const asphalt = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.95, side: THREE.DoubleSide }));
    this.world.add(asphalt);
    for (const e of [edgesL, edgesR]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...e, e[0], e[1], e[2]], 3));
      this.world.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xc9d2dd })));
    }

    // Start/finish line.
    const [p0, p1] = [pts[0], pts[1]];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_WIDTH, 1.6), new THREE.MeshBasicMaterial({ color: 0xff4d2e, side: THREE.DoubleSide }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(p1[2] - p0[2], p1[0] - p0[0]) + Math.PI / 2;
    line.position.set(p0[0], p0[1] + 0.08, p0[2]);
    this.world.add(line);

    // Ground and a faint grid, just under the lowest point.
    const size = this.track.radius * 6;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.track.centre[0], -0.6, this.track.centre[1]);
    this.scene.add(ground);
    const grid = new THREE.GridHelper(size, Math.round(size / 100), 0x1a2230, 0x121822);
    grid.position.set(this.track.centre[0], -0.55, this.track.centre[1]);
    this.scene.add(grid);

    // TV cameras: every ~350 m, set back 40 m from the outside of the track and 12 m up.
    const step = 350;
    let next = 0;
    for (let i = 0; i < n; i++) {
      if (this.track.dist[i] < next) continue;
      next += step;
      const a = pts[(i - 3 + n) % n];
      const b = pts[(i + 3) % n];
      const tx = b[0] - a[0];
      const tz = b[2] - a[2];
      const len = Math.hypot(tx, tz) || 1;
      let nx = -tz / len;
      let nz = tx / len;
      // Put the camera on the side away from the circuit's middle (usually the outside of the corner).
      const toCentreX = this.track.centre[0] - pts[i][0];
      const toCentreZ = this.track.centre[1] - pts[i][2];
      if (nx * toCentreX + nz * toCentreZ > 0) {
        nx = -nx;
        nz = -nz;
      }
      this.tvCams.push({ pos: new THREE.Vector3(pts[i][0] + nx * 40, pts[i][1] + 12, pts[i][2] + nz * 40), idx: i });
    }
  }

  private addCar(n: number) {
    const d = this.data.drivers.get(n);
    const colour = new THREE.Color(d?.colour ?? '#888888');
    const body = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    const group = new THREE.Group();
    // Pointing along +X; rotated to the heading each frame.
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.55, 1.0), body);
    chassis.position.set(0, 0.45, 0);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 4), body);
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(2.8, 0.35, 0);
    const sidepods = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.5, 1.7), body);
    sidepods.position.set(-0.3, 0.42, 0);
    const fw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 2.0), dark);
    fw.position.set(3.4, 0.18, 0);
    const rw = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.35, 1.0), body);
    rw.position.set(-2.4, 1.05, 0);
    const wheels = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 12);
    wheels.rotateX(Math.PI / 2);
    for (const [x, z] of [
      [1.8, 0.8],
      [1.8, -0.8],
      [-1.6, 0.8],
      [-1.6, -0.8],
    ]) {
      const w = new THREE.Mesh(wheels, dark);
      w.position.set(x, 0.36, z);
      group.add(w);
    }
    group.add(chassis, nose, sidepods, fw, rw);
    group.userData.driver = n;
    this.world.add(group);

    const label = makeLabel(d?.code ?? String(n), d?.colour ?? '#888');
    this.scene.add(label);
    this.cars.set(n, { n, group, label, heading: 0, hint: -1, last: null });
  }

  // ---- per frame ----------------------------------------------------------------

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      const c = this.selected != null ? this.cars.get(this.selected) : null;
      if (c) this.controls.target.copy(c.group.position);
      this.controls.update();
    }
  }

  /** Which car is under a click (or null). */
  pick(clientX: number, clientY: number): number | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    let best: { n: number; d: number } | null = null;
    for (const c of this.cars.values()) {
      if (!c.group.visible) continue;
      // Generous hit area: distance from the ray to the car.
      const d = this.raycaster.ray.distanceToPoint(c.group.getWorldPosition(new THREE.Vector3()));
      const range = this.camera.position.distanceTo(c.group.position) * 0.03 + 3;
      if (d < range && (!best || d < best.d)) best = { n: c.n, d };
    }
    return best?.n ?? null;
  }

  /** Draw the scene at session time t. `maxFps` keeps the iPad cool. */
  frame(t: number, maxFps: number) {
    const nowMs = performance.now();
    if (nowMs - this.lastFrame < 1000 / maxFps - 2) return;
    const dt = Math.min(0.2, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.world.scale.y = this.exaggeration;
    const up = this.exaggeration;
    for (const c of this.cars.values()) {
      const p = isRetired(this.data, c.n, t) ? null : car3d(this.data, this.track, c.n, t, c.hint);
      if (!p || p.stale) {
        c.group.visible = false;
        c.label.visible = false;
        c.last = null;
        continue;
      }
      c.hint = p.idx;
      const pos = new THREE.Vector3(p.X, p.Y + CAR_LIFT / up, p.Z);
      if (c.last) {
        const dx = pos.x - c.last.x;
        const dz = pos.z - c.last.z;
        if (dx * dx + dz * dz > 0.25) {
          const target = Math.atan2(-dz, dx);
          const diff = Math.atan2(Math.sin(target - c.heading), Math.cos(target - c.heading));
          c.heading += diff * Math.min(1, dt * 8);
          c.last = pos.clone();
        }
      } else c.last = pos.clone();
      c.group.visible = true;
      c.group.position.copy(pos);
      c.group.rotation.y = c.heading;
      // Cars are modelled at real size; undo the vertical exaggeration so they don't stretch.
      c.group.scale.set(1, 1 / up, 1);
      c.label.visible = this.labels;
      c.label.position.set(pos.x, (p.Y + 0) * up + 4.5, pos.z);
      const dist = this.camera.position.distanceTo(c.label.position);
      const s = Math.max(4, dist * 0.045);
      c.label.scale.set(s * 1.6, s * 0.6, 1);
      (c.label.material as THREE.SpriteMaterial).opacity = c.n === this.selected || this.selected == null ? 1 : 0.75;
    }

    const sel = this.selected != null ? this.cars.get(this.selected) : null;
    this.ring.visible = !!sel?.group.visible && this.mode !== 'onboard';
    if (sel && this.mode === 'onboard') sel.label.visible = false;
    if (sel?.group.visible) {
      this.ring.position.set(sel.group.position.x, sel.group.position.y - CAR_LIFT / up + 0.06 / up, sel.group.position.z);
      this.ring.scale.set(1, 1 / up, 1);
    }

    this.updateCamera(sel ?? null, dt);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(sel: CarObj | null, dt: number) {
    const up = this.exaggeration;
    if (this.mode === 'orbit' || !sel || !sel.group.visible) {
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
      this.controls.update();
      return;
    }
    const car = sel.group.position.clone();
    car.y *= up; // world group is scaled; the camera lives outside it
    const fwd = new THREE.Vector3(Math.cos(sel.heading), 0, -Math.sin(sel.heading));
    const k = 1 - Math.exp(-dt * 5);

    if (this.mode === 'follow') {
      const want = car.clone().addScaledVector(fwd, -14).add(new THREE.Vector3(0, 5.5, 0));
      const look = car.clone().addScaledVector(fwd, 12).add(new THREE.Vector3(0, 1, 0));
      this.smooth(want, look, k);
      this.camera.fov = 60;
    } else if (this.mode === 'onboard') {
      const want = car.clone().addScaledVector(fwd, 1.7).add(new THREE.Vector3(0, 1.1, 0));
      const look = car.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, 0.6, 0));
      this.camera.position.copy(want);
      this.camLook.lerp(look, Math.min(1, dt * 12));
      this.camera.lookAt(this.camLook);
      this.camera.fov = 68;
    } else {
      // TV: the trackside camera the car is approaching; it keeps the shot until the car is
      // 150 m past it, then cuts to the next one.
      const L = this.track.length || 1;
      const carD = this.track.dist[sel.hint] ?? 0;
      let cam = -1;
      let best = Infinity;
      this.tvCams.forEach((c, i) => {
        const score = (this.track.dist[c.idx] - carD + 150 + 2 * L) % L;
        if (score < best) {
          best = score;
          cam = i;
        }
      });
      const c = this.tvCams[cam];
      if (c) {
        const pos = new THREE.Vector3(c.pos.x, this.track.pts[c.idx][1] * up + 12, c.pos.z);
        this.camera.position.copy(pos);
        this.camera.lookAt(car);
        const dist = pos.distanceTo(car);
        this.camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(14 / dist)), 6, 55);
      }
    }
    this.camera.updateProjectionMatrix();
  }

  private smooth(pos: THREE.Vector3, look: THREE.Vector3, k: number) {
    if (this.camPos.distanceTo(pos) > 300) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, Math.min(1, k * 1.6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  dispose() {
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
}

function makeLabel(text: string, colour: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(7,9,13,0.85)';
  ctx.beginPath();
  ctx.roundRect(4, 6, 120, 36, 8);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.fillRect(10, 13, 6, 22);
  ctx.fillStyle = '#e8edf3';
  ctx.font = '700 24px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 24, 25);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
}
