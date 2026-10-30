// Sky, sun and weather for the 3D replay. The sun is placed for the circuit's location and the
// session's real time of day, so Abu Dhabi fades from sunset into a floodlit night and Las
// Vegas is dark throughout. Rain darkens and polishes the track and falls around the camera.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const RAD = Math.PI / 180;

/** Sun height and direction (radians) for a time and place (the usual astronomical formulas). */
export function sunPosition(ms: number, lat: number, lng: number) {
  const d = ms / 86_400_000 - 0.5 + 2440588 - 2451545;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const e = RAD * 23.4397;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lng - ra;
  const phi = RAD * lat;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude, azimuth };
}

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xcfe2ff, 0x3a4a2a, 0.9);
  /** Direction to the sun (unit). */
  sunDir = new THREE.Vector3(0.4, 0.7, 0.3).normalize();
  night = false;
  wet = false;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private pmrem: THREE.PMREMGenerator;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastAlt = Infinity;

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private shadows: boolean,
  ) {
    this.sky.scale.setScalar(40000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    if (shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -60;
      c.right = c.top = 60;
      c.near = 1;
      c.far = 600;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.03;
    }

    // Rain: short streaks in a box that travels with the camera.
    const N = 2500;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 40;
      const z = (Math.random() - 0.5) * 80;
      this.rainPos.set([x, y, z, x + 0.05, y - 0.7, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.setSun(Math.PI / 4, 0.6);
  }

  /** Place the sun (altitude, azimuth in radians) and match the sky, light, fog and reflections. */
  setSun(altitude: number, azimuth: number) {
    // Azimuth is measured from south towards west; world X = east, Z = south.
    this.sunDir.set(-Math.sin(azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(azimuth) * Math.cos(altitude)).normalize();
    const deg = altitude / RAD;
    this.night = deg < -4;
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.visible = !this.night;

    // Light colour and strength: white at midday, warm and low near sunset, floodlights at night.
    const day = THREE.MathUtils.clamp((deg + 2) / 12, 0, 1);
    const warm = new THREE.Color().lerpColors(new THREE.Color(0xffb070), new THREE.Color(0xfff6ec), THREE.MathUtils.clamp(deg / 25, 0, 1));
    if (this.night) {
      // Floodlights: bright, from high above, slightly cool.
      this.sun.color.set(0xeef2ff);
      this.sun.intensity = 2.2;
      this.sunDir.set(0.15, 1, 0.1).normalize();
      this.hemi.color.set(0x6070a0);
      this.hemi.groundColor.set(0x101318);
      this.hemi.intensity = 0.45;
      this.scene.background = new THREE.Color(0x070b16);
      this.scene.fog = new THREE.Fog(0x0a0f1c, 400, 3500);
    } else {
      this.sun.color.copy(warm);
      this.sun.intensity = 0.6 + 2.6 * day * (this.wet ? 0.45 : 1);
      this.hemi.color.set(this.wet ? 0x9aa6b4 : 0xcfe2ff);
      this.hemi.groundColor.set(0x3a4a2a);
      this.hemi.intensity = 0.35 + 0.65 * day;
      this.scene.background = null;
      const fogCol = new THREE.Color().lerpColors(new THREE.Color(0x8a6a5a), new THREE.Color(this.wet ? 0x8f99a3 : 0xb9cbe0), day);
      this.scene.fog = new THREE.Fog(fogCol, this.wet ? 250 : 1500, this.wet ? 2200 : 9000);
    }
    this.renderer.toneMappingExposure = this.night ? 0.9 : 0.42 + 0.2 * (1 - day);

    // Reflections in the paint come from the sky itself (redone only when the sun has moved).
    // (Rebuilding reflections takes a moment, so only for a real change of light.)
    if (Math.abs(deg - this.lastAlt) > 4 || (this.night && this.lastAlt > -4) || (!this.night && this.lastAlt < -4)) {
      this.lastAlt = deg;
      const envScene = new THREE.Scene();
      if (this.night) envScene.background = new THREE.Color(0x101624);
      else {
        const s = new Sky();
        s.scale.setScalar(1000);
        s.material.uniforms.sunPosition.value.copy(this.sunDir);
        s.material.uniforms.turbidity.value = 4;
        s.material.uniforms.rayleigh.value = 1.2;
        envScene.add(s);
      }
      const target = this.pmrem.fromScene(envScene, 0.02);
      this.envTarget?.dispose();
      this.envTarget = target;
      this.scene.environment = target.texture;
      this.scene.environmentIntensity = this.night ? 0.5 : 0.9;
    }
  }

  setWet(wet: boolean, asphalt: THREE.MeshStandardMaterial) {
    if (wet === this.wet) return;
    this.wet = wet;
    this.rain.visible = wet;
    // A wet track: darker and shinier (it reflects the sky).
    asphalt.roughness = wet ? 0.28 : 0.92;
    asphalt.metalness = wet ? 0.15 : 0;
    asphalt.color.set(wet ? 0x8a8f96 : 0xffffff);
    asphalt.needsUpdate = true;
    this.lastAlt = Infinity;
  }

  /** Each frame: keep the shadows and the rain around what the camera is looking at. */
  update(focus: THREE.Vector3, camera: THREE.Camera, dt: number) {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 250);
    if (this.rain.visible) {
      this.rain.position.set(camera.position.x, camera.position.y - 15, camera.position.z);
      const p = this.rainPos;
      const fall = dt * 30;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= fall;
        p[i + 4] -= fall;
        if (p[i + 4] < 0) {
          p[i + 1] += 40;
          p[i + 4] += 40;
        }
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose() {
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
