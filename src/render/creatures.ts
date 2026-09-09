import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { World } from '../sim/world';
import { Organism } from '../sim/organism';
import { SpeciesId, SPECIES } from '../sim/species';
import { Terrain } from '../sim/terrain';
import { attachWorldUniforms, cloudShadowGLSL, worldUniformDeclGLSL } from './shaderlib';

const PART = { BODY: 0, FL: 1, FR: 2, BL: 3, BR: 4, HEAD: 5, TAIL: 6, EYE: 7 } as const;

function tag(src: THREE.BufferGeometry, part: number): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

function sphere(r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, part: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(5, Math.round(seg * 0.7)));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return tag(g, part);
}

function cone(r: number, h: number, x: number, y: number, z: number, rx: number, ry: number, rz: number, part: number, seg = 6): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return tag(g, part);
}

function leg(rTop: number, rBot: number, h: number, x: number, y: number, z: number, part: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 6);
  g.translate(x, y, z);
  return tag(g, part);
}

/** Facing +X. Rounded, deer-meets-capybara. Hip height 0.55. */
function makeGrazerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(sphere(0.5, 1.25, 0.82, 0.92, 0, 0.66, 0, PART.BODY, 12));
  parts.push(sphere(0.34, 0.9, 0.85, 0.85, 0.42, 0.78, 0, PART.BODY, 8)); // shoulders
  parts.push(sphere(0.3, 1.05, 0.9, 0.82, 0.78, 0.98, 0, PART.HEAD, 9));
  parts.push(sphere(0.17, 1.2, 0.8, 0.9, 1.02, 0.9, 0, PART.HEAD, 7)); // muzzle
  parts.push(cone(0.09, 0.3, 0.7, 1.28, 0.17, 0.25, 0, 0.35, PART.HEAD, 5));
  parts.push(cone(0.09, 0.3, 0.7, 1.28, -0.17, -0.25, 0, 0.35, PART.HEAD, 5));
  parts.push(sphere(0.055, 1, 1, 1, 0.9, 1.05, 0.2, PART.EYE, 6));
  parts.push(sphere(0.055, 1, 1, 1, 0.9, 1.05, -0.2, PART.EYE, 6));
  parts.push(leg(0.085, 0.07, 0.56, 0.38, 0.28, 0.27, PART.FL));
  parts.push(leg(0.085, 0.07, 0.56, 0.38, 0.28, -0.27, PART.FR));
  parts.push(leg(0.095, 0.075, 0.56, -0.36, 0.28, 0.27, PART.BL));
  parts.push(leg(0.095, 0.075, 0.56, -0.36, 0.28, -0.27, PART.BR));
  parts.push(sphere(0.1, 1, 1, 1, -0.62, 0.78, 0, PART.TAIL, 6));
  return mergeGeometries(parts)!;
}

/** Facing +X. Long, low, fox-wolf. Hip height 0.6. */
function makeHunterGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(sphere(0.45, 1.75, 0.72, 0.72, -0.05, 0.68, 0, PART.BODY, 12));
  parts.push(sphere(0.4, 1.0, 0.85, 0.8, 0.45, 0.78, 0, PART.BODY, 9)); // chest
  parts.push(sphere(0.28, 1.15, 0.85, 0.8, 0.98, 0.92, 0, PART.HEAD, 9));
  parts.push(cone(0.14, 0.42, 1.32, 0.85, 0, 0, 0, -Math.PI / 2, PART.HEAD, 6)); // snout
  parts.push(cone(0.08, 0.3, 0.9, 1.22, 0.15, 0.2, 0, 0.25, PART.HEAD, 4));
  parts.push(cone(0.08, 0.3, 0.9, 1.22, -0.15, -0.2, 0, 0.25, PART.HEAD, 4));
  parts.push(sphere(0.05, 1, 1, 1, 1.12, 0.99, 0.16, PART.EYE, 6));
  parts.push(sphere(0.05, 1, 1, 1, 1.12, 0.99, -0.16, PART.EYE, 6));
  parts.push(leg(0.07, 0.055, 0.62, 0.5, 0.31, 0.22, PART.FL));
  parts.push(leg(0.07, 0.055, 0.62, 0.5, 0.31, -0.22, PART.FR));
  parts.push(leg(0.08, 0.06, 0.62, -0.55, 0.31, 0.22, PART.BL));
  parts.push(leg(0.08, 0.06, 0.62, -0.55, 0.31, -0.22, PART.BR));
  // tail: tapered, sweeping back and slightly down
  const tail = new THREE.CylinderGeometry(0.05, 0.11, 0.9, 6);
  tail.rotateZ(Math.PI / 2 + 0.35);
  tail.translate(-1.2, 0.62, 0);
  parts.push(tag(tail, PART.TAIL));
  return mergeGeometries(parts)!;
}

function creatureMaterial(species: SpeciesId): THREE.MeshStandardMaterial {
  const hip = species === 'grazer' ? 0.55 : 0.6;
  const neck = species === 'grazer' ? [0.6, 0.85] : [0.8, 0.85];
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    attachWorldUniforms(shader);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec4 iAnim;   // phase, gait, rest, headDown
attribute vec4 iExtra;  // pattern, alert, hunger, hurt
varying vec3 vWorldPos;
varying vec3 vLocal;
varying float vPart;
varying vec4 vExtra;
${worldUniformDeclGLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPart = aPart;
vExtra = iExtra;
vLocal = position;
{
  float phase = iAnim.x;
  float gait = iAnim.y;
  float rest = iAnim.z;
  float headDown = iAnim.w;
  int part = int(aPart + 0.5);
  float HIP = ${hip.toFixed(2)};
  if (part >= 1 && part <= 4) {
    float off = (part == 1 || part == 4) ? 0.0 : 3.14159;
    float legLen = max(0.0, HIP - position.y);
    float s = sin(phase + off);
    transformed.x += s * 0.55 * gait * legLen;
    transformed.y += max(0.0, -cos(phase + off)) * 0.16 * gait * legLen;
    transformed.y = mix(transformed.y, HIP - legLen * 0.2, rest);
    transformed.x = mix(transformed.x, transformed.x + (part <= 2 ? 0.25 : -0.25) * legLen, rest);
  }
  if (part == 5 || part == 7) {
    vec2 pivot = vec2(${neck[0].toFixed(2)}, ${neck[1].toFixed(2)});
    vec2 rel = transformed.xy - pivot;
    float ang = -headDown * 0.9 + sin(phase) * 0.05 * gait + iExtra.y * 0.25;
    float c = cos(ang), s = sin(ang);
    transformed.xy = pivot + vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  }
  if (part == 6) {
    float wag = sin(uTime * 7.0 + phase * 0.7 + iAnim.x * 0.3) * (0.15 + 0.35 * gait + iExtra.y * 0.3);
    transformed.z += wag * ${species === 'grazer' ? '0.5' : '1.0'};
  }
  float bob = abs(sin(phase)) * 0.045 * gait;
  transformed.y += bob - rest * (${species === 'grazer' ? '0.3' : '0.32'});
  transformed.y *= 1.0 + 0.012 * sin(uTime * 2.3 + iAnim.x);
}`,
      )
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying vec3 vLocal;
varying float vPart;
varying vec4 vExtra;
${worldUniformDeclGLSL}
${cloudShadowGLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  int part = int(vPart + 0.5);
  if (part == 7) {
    col = vec3(0.02, 0.02, 0.025);
  } else {
    // pale belly and muzzle
    float belly = smoothstep(0.75, 0.35, vLocal.y);
    col = mix(col, col * 1.3 + 0.12, belly * 0.55);
    // markings: stripes for some, dapples for others, strength from the pattern gene
    float stripes = smoothstep(0.45, 0.7, sin(vLocal.x * 10.0 + vLocal.y * 2.5) * 0.5 + 0.5);
    float dapple = smoothstep(0.6, 0.85, sin(vLocal.x * 14.0) * sin(vLocal.z * 14.0 + 1.3) * sin(vLocal.y * 9.0) * 0.5 + 0.5);
    float mark = mix(stripes, dapple, step(0.5, fract(vExtra.x * 7.0)));
    float bodyPart = (part == 0 || part == 5) ? 1.0 : 0.3;
    col = mix(col, col * 0.5, mark * vExtra.x * bodyPart * 0.9);
    // darker legs and tail tip
    if (part >= 1 && part <= 4) col *= 0.82;
    if (part == 6) col *= 0.9;
    // hurt flash
    col = mix(col, vec3(1.0, 0.3, 0.2), vExtra.w * 0.7);
  }
  diffuseColor.rgb = col;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (int(vPart + 0.5) == 7) roughnessFactor = 0.15;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= cloudShadow(vWorldPos.xz);');
  };
  mat.customProgramCacheKey = () => 'creature-' + species;
  return mat;
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Render-side per-organism state (animation phase etc.), keyed by id. */
interface AnimState {
  phase: number;
  gait: number;
  rest: number;
  head: number;
  hurt: number;
}

export class Creatures {
  group = new THREE.Group();
  meshes: Record<SpeciesId, THREE.InstancedMesh>;
  private anim: Record<SpeciesId, THREE.InstancedBufferAttribute>;
  private extra: Record<SpeciesId, THREE.InstancedBufferAttribute>;
  private states = new Map<number, AnimState>();
  /** organisms rendered this frame, in instance order, per species (for picking) */
  drawn: Record<SpeciesId, Organism[]> = { grazer: [], hunter: [] };
  private cleanupTimer = 0;

  constructor(private world: World, private terrain: Terrain) {
    const make = (sp: SpeciesId, geo: THREE.BufferGeometry) => {
      const cap = SPECIES[sp].maxPopulation;
      const mesh = new THREE.InstancedMesh(geo, creatureMaterial(sp), cap);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      const extra = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      extra.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iAnim', anim);
      geo.setAttribute('iExtra', extra);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      // instanceColor is created lazily by setColorAt; do it once so the attribute exists
      mesh.setColorAt(0, tmpC.set(1, 1, 1));
      mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return { mesh, anim, extra };
    };
    const g = make('grazer', makeGrazerGeometry());
    const h = make('hunter', makeHunterGeometry());
    this.meshes = { grazer: g.mesh, hunter: h.mesh };
    this.anim = { grazer: g.anim, hunter: h.anim };
    this.extra = { grazer: g.extra, hunter: h.extra };
  }

  /** Body colour from genes. */
  static colorOf(o: Organism, out: THREE.Color): THREE.Color {
    const g = o.genes;
    if (o.species === 'grazer') return out.setHSL(g.hue / 360, 0.3 + 0.18 * g.pattern, 0.5, THREE.SRGBColorSpace);
    return out.setHSL(g.hue / 360, 0.52, 0.4, THREE.SRGBColorSpace);
  }

  update(dt: number, alpha: number): void {
    const counts: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    this.drawn.grazer.length = 0;
    this.drawn.hunter.length = 0;
    const world = this.world;
    for (const o of world.organisms) {
      if (!o.alive) continue;
      const sp = o.species;
      const mesh = this.meshes[sp];
      const idx = counts[sp]++;
      if (idx >= SPECIES[sp].maxPopulation) break;
      this.drawn[sp].push(o);
      let st = this.states.get(o.id);
      if (!st) {
        st = { phase: Math.random() * 6.28, gait: 0, rest: 0, head: 0, hurt: 0 };
        this.states.set(o.id, st);
      }
      // interpolate
      const x = o.px + (o.x - o.px) * alpha;
      const z = o.py + (o.y - o.py) * alpha;
      let dh = o.heading - o.pheading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const heading = o.pheading + dh * alpha;
      const body = o.bodySize;
      const scale = body * 1.15;
      const y = this.terrain.elevationAt(x, z);
      // animation state
      const maxSpeed = SPECIES[sp].baseSpeed * o.genes.speed;
      const rel = Math.min(1.6, o.moveSpeed / (maxSpeed * 0.6));
      const targetGait = rel < 0.05 ? 0 : Math.min(1.3, 0.3 + rel);
      st.gait += (targetGait - st.gait) * Math.min(1, dt * 8);
      st.phase += (o.moveSpeed / Math.max(0.5, body)) * dt * 3.4;
      const resting = o.state === 'rest' || o.state === 'digest';
      st.rest += ((resting ? 1 : 0) - st.rest) * Math.min(1, dt * 3);
      const eating = o.state === 'eat';
      st.head += ((eating ? 1 : 0) - st.head) * Math.min(1, dt * 4);
      st.hurt = Math.max(0, st.hurt - dt * 2);
      const alert = o.state === 'flee' || o.state === 'chase' ? 1 : 0;

      tmpP.set(x, y, z);
      tmpQ.setFromAxisAngle(UP, -heading);
      // faster genes read as longer, leaner bodies
      const stretch = 0.9 + 0.22 * (o.genes.speed - 1);
      tmpS.set(scale * stretch, scale * (1.05 - 0.08 * (o.genes.speed - 1)), scale * (1.0 - 0.06 * (o.genes.speed - 1)));
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(idx, tmpM);
      mesh.setColorAt(idx, Creatures.colorOf(o, tmpC));
      const a = this.anim[sp].array as Float32Array;
      a[idx * 4] = st.phase;
      a[idx * 4 + 1] = st.gait;
      a[idx * 4 + 2] = st.rest;
      a[idx * 4 + 3] = st.head;
      const e = this.extra[sp].array as Float32Array;
      e[idx * 4] = o.genes.pattern;
      e[idx * 4 + 1] = alert;
      e[idx * 4 + 2] = o.hunger;
      e[idx * 4 + 3] = st.hurt;
    }
    for (const sp of ['grazer', 'hunter'] as SpeciesId[]) {
      const mesh = this.meshes[sp];
      mesh.count = counts[sp];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.anim[sp].needsUpdate = true;
      this.extra[sp].needsUpdate = true;
    }
    // forget the dead now and then
    this.cleanupTimer += dt;
    if (this.cleanupTimer > 5) {
      this.cleanupTimer = 0;
      for (const id of this.states.keys()) {
        const o = world.byId.get(id);
        if (!o || !o.alive) this.states.delete(id);
      }
    }
  }

  flashHurt(id: number): void {
    const st = this.states.get(id);
    if (st) st.hurt = 1;
  }
}

/** Bodies on the ground. Small, dark, quietly fading back into the soil. */
export class CarrionMesh {
  mesh: THREE.InstancedMesh;
  private cap = 400;
  constructor(private world: World, private terrain: Terrain) {
    const geo = new THREE.IcosahedronGeometry(0.5, 1);
    geo.deleteAttribute('uv');
    geo.scale(1.4, 0.45, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  update(): void {
    let n = 0;
    for (const c of this.world.carrion.corpses) {
      if (!c.alive || n >= this.cap) continue;
      const shrink = Math.min(1, c.meat / (30 * c.size + 1));
      const s = c.size * (0.5 + 0.7 * shrink);
      tmpP.set(c.x, this.terrain.elevationAt(c.x, c.y) + 0.05 * s, c.y);
      tmpE.set(0, (c.x * 7.1 + c.y * 3.3) % 6.28, 0);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(s, s * (0.5 + 0.5 * shrink), s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.mesh.setMatrixAt(n++, tmpM);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
