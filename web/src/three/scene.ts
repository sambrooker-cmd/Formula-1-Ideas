// The 3D replay scene (three.js): the circuit and its surroundings with real heights, detailed
// cars in team colours (wheels turn and steer, tyre stripes show the compound), a sky and sun
// for the real time and place, rain when it rained, and four cameras: orbit, follow, on-board
// (from the driver's seat) and TV-style trackside cameras.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SessionData } from '../data/session';
import { currentLap, isRetired, stintForLap, weatherAt } from '../data/state';
import { track3d, type Track3D } from '../data/track3d';
import { carPose } from '../data/carpath';
import { makeCar, setRainLight, stripeMaterial, WHEEL_R, type CarParts } from './carModel';
import { buildTrackside, grassTexture, TRACK_WIDTH, type Trackside } from './trackside';
import { Environment, sunPosition } from './environment';

export type CameraMode = 'orbit' | 'follow' | 'onboard' | 'tv';

/** The car model's ground is at y = 0; positions are lifted this little bit to sit on the road. */
const CAR_LIFT = 0.02;

export type Detail = 'high' | 'standard';

interface CarObj {
  n: number;
  group: THREE.Group;
  parts: CarParts;
  label: THREE.Sprite;
  heading: number;
  hint: number;
  prev: THREE.Vector3 | null;
  steer: number;
  compound: string | null | undefined;
  checkedAt: number;
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
  private lastRenderT = NaN;
  private lastState = '';
  /** Set when something changed that the next frame must draw (camera dragged, etc.). */
  needsRender = true;
  private raycaster = new THREE.Raycaster();
  private env: Environment;
  private side: Trackside | null = null;
  private ground: THREE.Mesh | null = null;
  private appliedUp = -1;
  private location: { lat: number; lng: number } | null = null;
  private sunCheckedAt = -Infinity;
  private weatherCheckedAt = -Infinity;
  private lightsLit = -1;

  constructor(
    private canvas: HTMLCanvasElement,
    private data: SessionData,
    readonly detail: Detail = 'high',
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: detail === 'high' ? 'high-performance' : 'low-power' });
    this.renderer.setPixelRatio(Math.min(detail === 'high' ? 2 : 1.25, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (detail === 'high') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    this.scene.add(this.world);
    this.track = track3d(data);
    this.env = new Environment(this.scene, this.renderer, detail === 'high');

    this.buildTrack();
    for (const n of data.driverOrder) this.addCar(n);

    const ringGeo = new THREE.RingGeometry(3.3, 3.55, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.world.add(this.ring);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));
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
    const side = buildTrackside(this.track, this.detail);
    this.side = side;
    this.world.add(side.flat);
    this.scene.add(side.upright);
    if (this.detail === 'high') {
      side.receivers.forEach((m) => (m.receiveShadow = true));
      side.casters.forEach((o) => o.traverse((x) => ((x as THREE.Mesh).castShadow = true)));
    }

    // Grass all around, just under the lowest point of the circuit.
    const size = this.track.radius * 8 + 2000;
    const grass = grassTexture();
    grass.repeat.set(size / 40, size / 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.track.centre[0], -0.3, this.track.centre[1]);
    ground.receiveShadow = this.detail === 'high';
    this.scene.add(ground);
    this.ground = ground;

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
      this.tvCams.push({ pos: new THREE.Vector3(pts[i][0] + nx * 40, pts[i][1] + 18, pts[i][2] + nz * 40), idx: i });
    }
  }

  private addCar(n: number) {
    const d = this.data.drivers.get(n);
    const parts = makeCar(d?.colour ?? '#888888', String(n));
    const group = parts.group;
    if (this.detail === 'high') parts.casters.forEach((m) => (m.castShadow = true));
    group.userData.driver = n;
    this.world.add(group);

    const label = makeLabel(d?.code ?? String(n), d?.colour ?? '#888');
    this.scene.add(label);
    this.cars.set(n, { n, group, parts, label, heading: 0, hint: -1, prev: null, steer: 0, compound: undefined, checkedAt: -Infinity });
  }

  /** The circuit's place on Earth, for the sun. */
  setLocation(lat: number, lng: number) {
    this.location = { lat, lng };
    this.sunCheckedAt = -Infinity;
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
    // Nothing to draw when paused and nobody's touching anything: save the battery.
    if (this.mode === 'orbit' && this.controls.update()) this.needsRender = true;
    const state = `${this.selected}|${this.exaggeration}|${this.labels}|${this.mode}|${this.canvas.width}x${this.canvas.height}`;
    if (t === this.lastRenderT && !this.needsRender && state === this.lastState && !this.env.wet) return;
    this.lastRenderT = t;
    this.lastState = state;
    this.needsRender = false;
    const dt = Math.min(0.2, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.world.scale.y = this.exaggeration;
    const up = this.exaggeration;
    if (up !== this.appliedUp) {
      this.side?.setUp(up);
      if (this.ground) this.ground.position.y = -0.3;
      this.appliedUp = up;
    }
    this.updateWorld(t);
    const wet = this.env.wet;
    const blink = wet && Math.floor(nowMs / 250) % 2 === 0;
    for (const c of this.cars.values()) {
      const p = isRetired(this.data, c.n, t) ? null : carPose(this.data, this.track, c.n, t);
      if (!p || p.stale) {
        c.group.visible = false;
        c.label.visible = false;
        c.prev = null;
        continue;
      }
      c.hint = p.idx;
      const px = p.X;
      const py = p.Y + CAR_LIFT / up;
      const pz = p.Z;
      // The smoothed path gives the heading directly; ease into it only after a jump (seeking).
      const diff = Math.atan2(Math.sin(p.heading - c.heading), Math.cos(p.heading - c.heading));
      c.heading = Math.abs(diff) > 0.6 ? p.heading : c.heading + diff * Math.min(1, dt * 20);

      // Wheels: turn by the distance the car has moved (so they match any replay speed, and
      // stop when paused); front ones steer by how sharply the path is curving.
      const moved = c.prev ? Math.hypot(px - c.prev.x, pz - c.prev.z) : 0;
      if (c.prev) c.prev.set(px, py, pz);
      else c.prev = new THREE.Vector3(px, py, pz);
      // Past ~1 rad a frame the eye can't follow anyway (it would look like it's going backwards).
      if (moved < 30) for (const w of c.parts.wheels) w.rotation.z -= Math.min(moved / WHEEL_R, 1.1);
      const ahead = carPose(this.data, this.track, c.n, t + 250);
      let steer = 0;
      if (ahead && !ahead.stale) {
        const ds = Math.hypot(ahead.X - px, ahead.Z - pz);
        const dh = Math.atan2(Math.sin(ahead.heading - p.heading), Math.cos(ahead.heading - p.heading));
        if (ds > 0.5) steer = THREE.MathUtils.clamp(Math.atan((dh / ds) * 3.6), -0.45, 0.45); // wheelbase × curvature
      }
      c.steer += (steer - c.steer) * Math.min(1, dt * 10);
      for (const s of c.parts.steer) s.rotation.y = c.steer;
      // Tyre compound (checked about once a second of race time) and the rain light.
      if (Math.abs(t - c.checkedAt) > 1000) {
        c.checkedAt = t;
        const lap = currentLap(this.data, c.n, t)?.lap ?? 1;
        const compound = stintForLap(this.data, c.n, Math.max(1, lap))?.compound ?? null;
        if (compound !== c.compound) {
          c.compound = compound;
          const mat = stripeMaterial(compound);
          c.parts.stripes.forEach((m) => (m.material = mat));
        }
      }
      setRainLight(c.parts, blink);
      c.group.visible = true;
      c.group.position.set(px, py, pz);
      c.group.rotation.y = c.heading;
      // Cars are modelled at real size; undo the vertical exaggeration so they don't stretch.
      c.group.scale.set(1, 1 / up, 1);
      c.label.position.set(px, p.Y * up + 2.6, pz);
      const dist = this.camera.position.distanceTo(c.label.position);
      // Labels stay a readable size on screen, and get out of the way close up.
      c.label.visible = this.labels && dist > 12;
      // Constant size on screen, whatever the zoom (TV cameras zoom right in).
      const s = THREE.MathUtils.clamp(dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.09, 0.6, 60);
      c.label.scale.set(s * 1.6, s * 0.6, 1);
      (c.label.material as THREE.SpriteMaterial).opacity = c.n === this.selected || this.selected == null ? 1 : 0.75;
    }

    const sel = this.selected != null ? this.cars.get(this.selected) : null;
    this.ring.visible = !!sel?.group.visible && (this.mode === 'orbit' || this.mode === 'tv');
    if (sel && (this.mode === 'onboard' || this.mode === 'follow')) sel.label.visible = false;
    // From the driver's seat, don't show the driver's own helmet.
    for (const c of this.cars.values()) c.parts.helmet.forEach((h) => (h.visible = !(this.mode === 'onboard' && c === sel)));
    if (sel?.group.visible) {
      this.ring.position.set(sel.group.position.x, sel.group.position.y - CAR_LIFT / up + 0.06 / up, sel.group.position.z);
      this.ring.scale.set(1, 1 / up, 1);
    }

    this.updateCamera(sel ?? null, dt);
    const focus = sel?.group.visible ? sel.group.position.clone().setY(sel.group.position.y * up) : this.controls.target.clone();
    this.env.update(focus, this.camera, dt);
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
      // A chase camera, low behind the car like the TV's.
      const want = car.clone().addScaledVector(fwd, -9.5).add(new THREE.Vector3(0, 2.6, 0));
      const look = car.clone().addScaledVector(fwd, 10).add(new THREE.Vector3(0, 0.8, 0));
      // Locked to the car (its heading is already smoothed), so it never drops back at speed.
      this.camPos.copy(want);
      this.camLook.lerp(look, Math.min(1, k * 2.5));
      if (this.camLook.distanceTo(look) > 50) this.camLook.copy(look);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.camera.fov = 55;
    } else if (this.mode === 'onboard') {
      // The driver's eye line: just behind the halo's front pillar, looking down the road.
      const want = car.clone().addScaledVector(fwd, -0.2).add(new THREE.Vector3(0, 1.02, 0));
      const look = car.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, 0.5, 0));
      this.camera.position.copy(want);
      this.camLook.lerp(look, Math.min(1, dt * 12));
      this.camera.lookAt(this.camLook);
      this.camera.fov = 72;
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
        const pos = new THREE.Vector3(c.pos.x, this.track.pts[c.idx][1] * up + 18, c.pos.z);
        this.camera.position.copy(pos);
        this.camera.lookAt(car);
        const dist = pos.distanceTo(car);
        this.camera.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(14 / dist)), 6, 55);
      }
    }
    this.camera.updateProjectionMatrix();
  }

  private lastT = 0;

  /** Sun (every ~30 s of race time), rain (every ~5 s) and the start lights. */
  private updateWorld(t: number) {
    this.lastT = t;
    if (this.location && Math.abs(t - this.sunCheckedAt) > 30_000) {
      this.sunCheckedAt = t;
      const { altitude, azimuth } = sunPosition(this.data.meta.t0 + t, this.location.lat, this.location.lng);
      this.env.setSun(altitude, azimuth);
      this.side?.setNight(this.env.night);
    }
    if (this.side && Math.abs(t - this.weatherCheckedAt) > 5000) {
      this.weatherCheckedAt = t;
      const w = weatherAt(this.data, t);
      this.env.setWet(!!w?.rain, this.side.asphalt);
    }
    // Start lights: one pair a second for five seconds, then all out at the start.
    const start = this.data.meta.raceStart;
    const lit = this.data.meta.session.type === 'Race' && t >= start - 5000 && t < start ? Math.min(5, Math.floor((t - (start - 5000)) / 1000) + 1) : 0;
    if (lit !== this.lightsLit) {
      this.lightsLit = lit;
      this.side?.setStartLights(lit);
    }
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
    this.env.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    // Free everything on the graphics card, textures included (switching detail rebuilds the scene).
    const free = (mat: THREE.Material) => {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
      mat.dispose();
    };
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(free);
      else if (mat) free(mat);
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
