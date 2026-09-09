import * as THREE from 'three';
import { World, WorldEffect } from '../sim/world';
import { Terrain, WORLD_SIZE } from '../sim/terrain';
import { Atmosphere } from './palette';
import { Rng } from '../sim/rng';

const vert = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aType; // 0 soft dot, 1 streak (rain), 2 flake
attribute vec3 aColor;
varying float vAlpha;
varying float vType;
varying vec3 vColor;
uniform float uPixelRatio;
void main() {
  vAlpha = aAlpha;
  vType = aType;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (180.0 / max(1.0, -mv.z));
}`;
const frag = /* glsl */ `
precision highp float;
varying float vAlpha;
varying float vType;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a;
  if (vType > 0.5 && vType < 1.5) {
    // vertical streak
    a = smoothstep(0.12, 0.0, abs(p.x)) * smoothstep(0.5, 0.15, abs(p.y));
  } else {
    float d = length(p) * 2.0;
    a = smoothstep(1.0, 0.25, d);
    if (vType > 1.5) a = smoothstep(1.0, 0.6, d); // flake: harder edge
  }
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; r: number; g: number; b: number;
  type: number; kind: number; // kind: 0 mote, 1 firefly, 2 rain, 3 snow, 4 spark, 5 smoke, 6 ember, 7 wisp
  seed: number;
}

/** One pooled system for weather, ambient motes, fireflies and event sparkles. */
export class Particles {
  additive: THREE.Points;
  normal: THREE.Points;
  private pool: P[] = [];
  private cap: number;
  private rng = new Rng(1234);
  private geoA: THREE.BufferGeometry;
  private geoN: THREE.BufferGeometry;
  private fire: { x: number; y: number; r: number; t: number }[] = [];

  constructor(private world: World, private terrain: Terrain, cap = 6000) {
    this.cap = cap;
    const mk = (blend: THREE.Blending) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aType', new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: blend,
        uniforms: { uPixelRatio: { value: 1 } },
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      return { geo, pts };
    };
    const a = mk(THREE.AdditiveBlending);
    const n = mk(THREE.NormalBlending);
    this.geoA = a.geo;
    this.geoN = n.geo;
    this.additive = a.pts;
    this.normal = n.pts;
    this.additive.renderOrder = 20;
    this.normal.renderOrder = 19;
  }

  setPixelRatio(pr: number): void {
    (this.additive.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = pr;
    (this.normal.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = pr;
  }

  private spawn(p: Partial<P> & { x: number; y: number; z: number; kind: number }): void {
    if (this.pool.length >= this.cap) return;
    this.pool.push({
      vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, r: 1, g: 1, b: 1, type: 0, seed: this.rng.next(),
      ...p,
    });
  }

  /** Turn sim effects into bursts. */
  onEffects(effects: WorldEffect[]): void {
    const rng = this.rng;
    for (const e of effects) {
      const y = this.terrain.elevationAt(e.x, e.y);
      if (e.kind === 'birth') {
        for (let i = 0; i < 8; i++) {
          this.spawn({ x: e.x + rng.range(-0.4, 0.4), y: y + 0.4, z: e.y + rng.range(-0.4, 0.4), kind: 4, vx: rng.range(-0.6, 0.6), vy: rng.range(0.8, 2.2), vz: rng.range(-0.6, 0.6), maxLife: rng.range(0.9, 1.6), size: rng.range(1.6, 2.6), r: 0.85, g: 1.0, b: 0.75 });
        }
      } else if (e.kind === 'death' || e.kind === 'smite') {
        for (let i = 0; i < 10; i++) {
          this.spawn({ x: e.x + rng.range(-0.3, 0.3), y: y + 0.3 + rng.range(0, 0.5), z: e.y + rng.range(-0.3, 0.3), kind: 7, vx: rng.range(-0.25, 0.25), vy: rng.range(0.5, 1.3), vz: rng.range(-0.25, 0.25), maxLife: rng.range(1.5, 2.8), size: rng.range(2.5, 4.5) * (0.6 + e.size * 0.4), r: 0.85, g: 0.88, b: 0.95 });
        }
      } else if (e.kind === 'kill') {
        for (let i = 0; i < 12; i++) {
          this.spawn({ x: e.x, y: y + 0.5, z: e.y, kind: 4, vx: rng.range(-2, 2), vy: rng.range(0.5, 2.5), vz: rng.range(-2, 2), maxLife: rng.range(0.4, 0.9), size: rng.range(1.2, 2.2), r: 0.9, g: 0.15, b: 0.1 });
        }
        for (let i = 0; i < 6; i++) {
          this.spawn({ x: e.x, y: y + 0.4, z: e.y, kind: 7, vx: rng.range(-0.3, 0.3), vy: rng.range(0.4, 1.0), vz: rng.range(-0.3, 0.3), maxLife: rng.range(1.2, 2.2), size: rng.range(2.5, 4), r: 0.8, g: 0.82, b: 0.9 });
        }
      } else if (e.kind === 'escape') {
        for (let i = 0; i < 5; i++) {
          this.spawn({ x: e.x, y: y + 0.2, z: e.y, kind: 5, vx: rng.range(-1, 1), vy: rng.range(0.3, 1.0), vz: rng.range(-1, 1), maxLife: rng.range(0.5, 1.0), size: rng.range(2, 3.5), r: 0.6, g: 0.55, b: 0.45 });
        }
      } else if (e.kind === 'spawn') {
        for (let i = 0; i < 14; i++) {
          this.spawn({ x: e.x + rng.range(-0.5, 0.5), y: y + rng.range(0.2, 2.5), z: e.y + rng.range(-0.5, 0.5), kind: 4, vx: rng.range(-0.4, 0.4), vy: rng.range(0.3, 1.2), vz: rng.range(-0.4, 0.4), maxLife: rng.range(1.2, 2.4), size: rng.range(1.8, 3.2), r: 0.8, g: 0.92, b: 1.0 });
        }
      } else if (e.kind === 'fire') {
        this.fire.push({ x: e.x, y: e.y, r: e.size, t: 7 });
      }
    }
  }

  update(dt: number, atm: Atmosphere, focus: THREE.Vector3, zoomDist: number): void {
    const rng = this.rng;
    const climate = this.world.climate;
    const night = atm.night;
    const wind = climate;
    const windX = wind.windX * wind.windStrength * 3, windZ = wind.windY * wind.windStrength * 3;
    // ambient population targets scale with how close we are
    const near = THREE.MathUtils.clamp(1 - (zoomDist - 20) / 250, 0.15, 1);
    const radius = 30 + zoomDist * 0.6;

    // ---- emit ambient
    const moteTarget = Math.round(320 * near * (1 - night * 0.6) * (1 - climate.rain));
    const flyTarget = Math.round(260 * near * night * (1 - climate.rain * 0.8) * (climate.baseTemperature > 6 ? 1 : 0));
    let motes = 0, flies = 0, rain = 0, snow = 0;
    for (const p of this.pool) {
      if (p.kind === 0) motes++;
      else if (p.kind === 1) flies++;
      else if (p.kind === 2) rain++;
      else if (p.kind === 3) snow++;
    }
    const cold = climate.baseTemperature < 1.5;
    const precip = climate.rain;
    const rainTarget = cold ? 0 : Math.round(2600 * precip * near);
    const snowTarget = cold ? Math.round(900 * Math.max(precip, climate.cloudCover > 0.6 ? 0.5 : 0) * near) : 0;

    const emitAround = (kind: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.283), d = Math.sqrt(rng.next()) * radius;
        const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
        if (x < 0 || z < 0 || x > WORLD_SIZE || z > WORLD_SIZE) continue;
        const ground = this.terrain.elevationAt(x, z);
        if (kind === 0) {
          this.spawn({ x, y: ground + rng.range(0.5, 6), z, kind: 0, vx: rng.range(-0.3, 0.3), vy: rng.range(-0.1, 0.25), vz: rng.range(-0.3, 0.3), maxLife: rng.range(6, 14), size: rng.range(0.9, 1.8), r: 1.0, g: 0.92, b: 0.7 });
        } else if (kind === 1) {
          if (this.terrain.isWater(x, z) || this.world.vegetation.biomassAt(x, z) < 0.15) continue;
          this.spawn({ x, y: ground + rng.range(0.6, 3.5), z, kind: 1, vx: rng.range(-0.5, 0.5), vy: rng.range(-0.2, 0.3), vz: rng.range(-0.5, 0.5), maxLife: rng.range(5, 12), size: rng.range(1.6, 2.6), r: 0.75, g: 1.0, b: 0.35 });
        } else if (kind === 2) {
          this.spawn({ x, y: ground + rng.range(8, 40), z, kind: 2, type: 1, vx: windX * 0.6, vy: -rng.range(22, 30), vz: windZ * 0.6, maxLife: 3, size: rng.range(1.6, 2.4), r: 0.75, g: 0.82, b: 0.95 });
        } else {
          this.spawn({ x, y: ground + rng.range(6, 30), z, kind: 3, type: 2, vx: windX * 0.3 + rng.range(-0.5, 0.5), vy: -rng.range(1.5, 3), vz: windZ * 0.3 + rng.range(-0.5, 0.5), maxLife: 14, size: rng.range(1.4, 2.4), r: 0.95, g: 0.97, b: 1.0 });
        }
      }
    };
    if (motes < moteTarget) emitAround(0, Math.min(40, moteTarget - motes));
    if (flies < flyTarget) emitAround(1, Math.min(30, flyTarget - flies));
    if (rain < rainTarget) emitAround(2, Math.min(400, rainTarget - rain));
    if (snow < snowTarget) emitAround(3, Math.min(80, snowTarget - snow));

    // ---- fires
    for (const f of this.fire) {
      f.t -= dt;
      const n = Math.round(60 * dt * Math.min(1, f.t / 2));
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, 6.283), d = Math.sqrt(rng.next()) * f.r * 0.8;
        const x = f.x + Math.cos(a) * d, z = f.y + Math.sin(a) * d;
        const ground = this.terrain.elevationAt(x, z);
        if (rng.next() < 0.55) this.spawn({ x, y: ground + 0.3, z, kind: 6, vx: rng.range(-1, 1) + windX * 0.5, vy: rng.range(3, 9), vz: rng.range(-1, 1) + windZ * 0.5, maxLife: rng.range(0.8, 2.2), size: rng.range(1.5, 3), r: 1.0, g: 0.5, b: 0.15 });
        else this.spawn({ x, y: ground + 1, z, kind: 5, vx: rng.range(-0.6, 0.6) + windX, vy: rng.range(2, 5), vz: rng.range(-0.6, 0.6) + windZ, maxLife: rng.range(3, 6), size: rng.range(5, 10), r: 0.25, g: 0.22, b: 0.2 });
      }
    }
    this.fire = this.fire.filter((f) => f.t > 0);

    // ---- integrate
    const pool = this.pool;
    let w = 0;
    const t = performance.now() * 0.001;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      switch (p.kind) {
        case 0: // motes drift on the wind, bob
          p.x += (p.vx + windX * 0.4) * dt;
          p.z += (p.vz + windZ * 0.4) * dt;
          p.y += (p.vy + Math.sin(t * 1.3 + p.seed * 20) * 0.3) * dt;
          break;
        case 1: { // fireflies wander
          p.vx += rng.range(-1, 1) * dt * 2;
          p.vz += rng.range(-1, 1) * dt * 2;
          p.vy += rng.range(-1, 1) * dt * 1.2 - (p.y - this.terrain.elevationAt(p.x, p.z) - 1.8) * 0.15 * dt;
          const sp = Math.hypot(p.vx, p.vz);
          if (sp > 1.4) { p.vx *= 1.4 / sp; p.vz *= 1.4 / sp; }
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          break;
        }
        case 2: // rain
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.y < this.terrain.elevationAt(p.x, p.z)) { p.life = p.maxLife; continue; }
          break;
        case 3: // snow
          p.x += (p.vx + Math.sin(t + p.seed * 30) * 0.4) * dt; p.y += p.vy * dt; p.z += (p.vz + Math.cos(t * 0.8 + p.seed * 25) * 0.4) * dt;
          if (p.y < this.terrain.elevationAt(p.x, p.z) + 0.1) { p.life = p.maxLife; continue; }
          break;
        default: // sparks, wisps, smoke, embers: ballistic + drag
          p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5;
          if (p.kind === 4) p.vy -= 2.5 * dt;
          if (p.kind === 6) p.vy -= 1.0 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      pool[w++] = p;
    }
    pool.length = w;

    // ---- write buffers
    const posA = this.geoA.attributes.position.array as Float32Array;
    const sizeA = this.geoA.attributes.aSize.array as Float32Array;
    const alphaA = this.geoA.attributes.aAlpha.array as Float32Array;
    const typeA = this.geoA.attributes.aType.array as Float32Array;
    const colA = this.geoA.attributes.aColor.array as Float32Array;
    const posN = this.geoN.attributes.position.array as Float32Array;
    const sizeN = this.geoN.attributes.aSize.array as Float32Array;
    const alphaN = this.geoN.attributes.aAlpha.array as Float32Array;
    const typeN = this.geoN.attributes.aType.array as Float32Array;
    const colN = this.geoN.attributes.aColor.array as Float32Array;
    let na = 0, nn = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const lt = p.life / p.maxLife;
      const fade = Math.min(1, lt * 6) * Math.min(1, (1 - lt) * 4);
      let alpha = fade;
      let size = p.size;
      let r = p.r, g = p.g, b = p.b;
      const isAdd = p.kind === 0 || p.kind === 1 || p.kind === 4 || p.kind === 6;
      if (p.kind === 0) alpha *= 0.28 * (1 - night) * (0.7 + 0.3 * Math.sin(t * 2 + p.seed * 40));
      if (p.kind === 1) {
        const blink = Math.pow(Math.max(0, Math.sin(t * (1.2 + p.seed * 1.5) + p.seed * 50)), 3);
        alpha *= (0.15 + 0.85 * blink) * night;
        size *= 0.7 + 0.5 * blink;
      }
      if (p.kind === 2) alpha *= 0.35;
      if (p.kind === 3) alpha *= 0.85;
      if (p.kind === 5) { alpha *= 0.35 * (1 - lt); size *= 1 + lt * 2; }
      if (p.kind === 7) { alpha *= 0.5; size *= 1 + lt * 1.5; }
      if (p.kind === 6) { r = 1; g = 0.45 + 0.4 * (1 - lt); b = 0.1; }
      if (isAdd) {
        posA[na * 3] = p.x; posA[na * 3 + 1] = p.y; posA[na * 3 + 2] = p.z;
        sizeA[na] = size; alphaA[na] = alpha; typeA[na] = p.type;
        colA[na * 3] = r; colA[na * 3 + 1] = g; colA[na * 3 + 2] = b;
        na++;
      } else {
        posN[nn * 3] = p.x; posN[nn * 3 + 1] = p.y; posN[nn * 3 + 2] = p.z;
        sizeN[nn] = size; alphaN[nn] = alpha; typeN[nn] = p.type;
        colN[nn * 3] = r; colN[nn * 3 + 1] = g; colN[nn * 3 + 2] = b;
        nn++;
      }
    }
    this.geoA.setDrawRange(0, na);
    this.geoN.setDrawRange(0, nn);
    for (const geo of [this.geoA, this.geoN]) {
      for (const k of ['position', 'aSize', 'aAlpha', 'aType', 'aColor']) (geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
