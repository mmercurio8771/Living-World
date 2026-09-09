import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Terrain, SEA_LEVEL, BEACH_LEVEL, HIGHLAND_LEVEL, ROCK_LEVEL, WORLD_SIZE } from '../sim/terrain';
import { Vegetation, VEG_CELL } from '../sim/vegetation';
import { Rng } from '../sim/rng';
import { SimplexNoise } from '../sim/noise';
import { attachWorldUniforms, cloudShadowGLSL, worldUniformDeclGLSL } from './shaderlib';

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

/** A tuft: three crossed, tapered blades. */
function makeTuftGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.BufferGeometry();
    // tapered blade: quad with pinched top
    const w = 0.42, h = 1.0;
    const verts = new Float32Array([
      -w / 2, 0, 0, w / 2, 0, 0, w * 0.18, h, 0,
      -w / 2, 0, 0, w * 0.18, h, 0, -w * 0.18, h, 0,
    ]);
    const norm = new Float32Array(18);
    for (let k = 0; k < 6; k++) { norm[k * 3 + 1] = 0.35; norm[k * 3 + 2] = 0.94; }
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    g.rotateY((i / 3) * Math.PI);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

function makePineGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 1.6, 6);
  trunk.translate(0, 0.8, 0);
  const c1 = new THREE.ConeGeometry(1.25, 1.9, 7); c1.translate(0, 2.0, 0);
  const c2 = new THREE.ConeGeometry(0.95, 1.7, 7); c2.translate(0, 3.0, 0);
  const c3 = new THREE.ConeGeometry(0.6, 1.4, 7); c3.translate(0, 3.9, 0);
  return tagParts([trunk, c1, c2, c3], [0, 1, 1, 1]);
}

function makeRoundTreeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.18, 0.3, 1.9, 6);
  trunk.translate(0, 0.95, 0);
  const a = new THREE.IcosahedronGeometry(1.35, 1); a.translate(0, 2.6, 0); a.scale(1.15, 0.95, 1.15);
  const b = new THREE.IcosahedronGeometry(0.85, 1); b.translate(0.7, 3.1, 0.3);
  const c = new THREE.IcosahedronGeometry(0.8, 1); c.translate(-0.6, 3.2, -0.4);
  return tagParts([trunk, a, b, c], [0, 1, 1, 1]);
}

function makeShrubGeometry(): THREE.BufferGeometry {
  const a = new THREE.IcosahedronGeometry(0.7, 1); a.translate(0, 0.5, 0); a.scale(1.2, 0.8, 1.1);
  const b = new THREE.IcosahedronGeometry(0.5, 1); b.translate(0.5, 0.45, 0.3);
  return tagParts([a, b], [1, 1]);
}

function tagParts(geos: THREE.BufferGeometry[], parts: number[]): THREE.BufferGeometry {
  const flat = geos.map((g, i) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    const n = ng.attributes.position.count;
    ng.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(parts[i]), 1));
    return ng;
  });
  return mergeGeometries(flat)!;
}

/** Shared material patch: wind sway + seasonal canopy tint + cloud shadow. */
function plantMaterial(kind: 'grass' | 'tree', biomassTex?: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
    side: kind === 'grass' ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: false,
  });
  mat.onBeforeCompile = (shader) => {
    attachWorldUniforms(shader);
    if (biomassTex) shader.uniforms.uBiomass = { value: biomassTex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec4 aInst; // x: rand, y: phase, z: cellU, w: cellV
varying vec3 vWorldPos;
varying float vPart;
varying float vHeight;
varying float vRand;
varying float vBio;
${worldUniformDeclGLSL}
${biomassTex ? 'uniform sampler2D uBiomass;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vPart = aPart;
vRand = aInst.x;
vHeight = position.y;
${
  kind === 'grass'
    ? `
float bio = texture2D(uBiomass, aInst.zw).r;
vBio = bio;
float hscale = 0.12 + 0.88 * smoothstep(0.0, 0.85, bio);
hscale *= 1.0 - uWinter * 0.35;
transformed.y *= hscale;
transformed.xz *= 0.7 + 0.3 * hscale;`
    : 'vBio = aInst.z;'
}
// sway: more at the top
float top = ${kind === 'grass' ? 'transformed.y' : 'clamp((position.y - 1.0) / 4.0, 0.0, 1.0)'};
vec4 wpos0 = instanceMatrix * vec4(transformed, 1.0);
wpos0 = modelMatrix * wpos0;
float gust = sin(uTime * ${kind === 'grass' ? '2.2' : '1.1'} + wpos0.x * 0.25 + wpos0.z * 0.19 + aInst.y * 6.28) * 0.5 + 0.5;
float sway = (0.15 + 0.85 * gust) * uWind.z * ${kind === 'grass' ? '0.45' : '0.08'};
transformed.x += uWind.x * sway * top * top * ${kind === 'grass' ? '1.0' : '3.0'};
transformed.z += uWind.y * sway * top * top * ${kind === 'grass' ? '1.0' : '3.0'};`,
      )
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldPos;
varying float vPart;
varying float vHeight;
varying float vRand;
varying float vBio;
${worldUniformDeclGLSL}
${cloudShadowGLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 col = diffuseColor.rgb;
  ${
    kind === 'grass'
      ? `
  vec3 lush = vec3(0.38, 0.68, 0.25) * (0.85 + 0.3 * vRand);
  vec3 straw = vec3(0.8, 0.7, 0.4);
  col = mix(straw, lush, smoothstep(0.05, 0.6, vBio));
  col *= uSeasonTint;
  col = mix(col, vec3(0.78, 0.55, 0.25) * (0.8 + 0.4 * vRand), uAutumn * 0.6 * step(0.5, vRand));
  col = mix(col, vec3(0.6, 0.62, 0.55), uWinter * 0.55);
  // darker at the roots
  col *= 0.6 + 0.5 * clamp(vHeight, 0.0, 1.0);
  // flowers on the tips of a few tufts
  float flowerSeed = fract(vRand * 17.3);
  if (flowerSeed > 0.78 && uBloom > 0.01 && vHeight > 0.8 && vBio > 0.5) {
    vec3 fcol = flowerSeed > 0.93 ? vec3(1.0, 0.85, 0.35) : (flowerSeed > 0.86 ? vec3(0.95, 0.55, 0.7) : vec3(0.95, 0.95, 0.9));
    col = mix(col, fcol, uBloom * smoothstep(0.8, 0.95, vHeight));
  }`
      : `
  if (vPart < 0.5) {
    col = vec3(0.36, 0.26, 0.17) * (0.85 + 0.3 * vRand);
  } else {
    // canopy: instance colour, autumn/winter blend by per-tree randomness
    float turn = smoothstep(0.2 + vRand * 0.5, 0.6 + vRand * 0.5, uAutumn);
    vec3 autumnCol = mix(vec3(0.85, 0.45, 0.15), vec3(0.75, 0.2, 0.12), fract(vRand * 3.7));
    col = mix(col, autumnCol, turn * step(0.5, fract(vRand * 5.1) + 0.3) * vBio); // vBio carries "deciduous" for trees
    col = mix(col, vec3(0.5, 0.55, 0.5), uWinter * 0.3 * vBio + uWinter * 0.15);
    col *= uSeasonTint;
  }`
  }
  diffuseColor.rgb = col;
}`,
      )
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= cloudShadow(vWorldPos.xz);');
  };
  mat.customProgramCacheKey = () => 'plant-' + kind;
  return mat;
}

/** Grass tufts, trees, shrubs and rocks. Grass reads live biomass on the GPU. */
export class VegetationMesh {
  group = new THREE.Group();
  grass: THREE.InstancedMesh;
  pines: THREE.InstancedMesh;
  rounds: THREE.InstancedMesh;
  shrubs: THREE.InstancedMesh;
  rocks: THREE.InstancedMesh;
  treePositions: { x: number; y: number }[] = [];

  constructor(terrain: Terrain, veg: Vegetation, biomassTex: THREE.Texture, seed: number) {
    const rng = new Rng(seed ^ 0x9d2c);
    const n = veg.res;

    // ---------------- grass ----------------
    const tufts: { x: number; z: number; y: number; s: number; u: number; v: number; r: number }[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cap = veg.capacity[j * n + i];
        if (cap < 0.05) continue;
        const count = cap > 0.6 ? 4 : cap > 0.3 ? 3 : cap > 0.15 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const x = (i + rng.range(0.1, 0.9)) * VEG_CELL;
          const z = (j + rng.range(0.1, 0.9)) * VEG_CELL;
          if (terrain.isWater(x, z)) continue;
          const y = terrain.elevationAt(x, z);
          tufts.push({ x, z, y, s: (0.7 + 0.6 * rng.next()) * (0.55 + 0.5 * cap), u: (i + 0.5) / n, v: (j + 0.5) / n, r: rng.next() });
        }
      }
    }
    const tuftGeo = makeTuftGeometry();
    const grassMat = plantMaterial('grass', biomassTex);
    this.grass = new THREE.InstancedMesh(tuftGeo, grassMat, tufts.length);
    const gInst = new Float32Array(tufts.length * 4);
    tufts.forEach((t, idx) => {
      tmpP.set(t.x, t.y - 0.02, t.z);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      tmpS.set(t.s * 0.55, t.s * 0.62, t.s * 0.55);
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.grass.setMatrixAt(idx, tmpM);
      gInst[idx * 4] = t.r;
      gInst[idx * 4 + 1] = rng.next();
      gInst[idx * 4 + 2] = t.u;
      gInst[idx * 4 + 3] = t.v;
    });
    tuftGeo.setAttribute('aInst', new THREE.InstancedBufferAttribute(gInst, 4));
    tuftGeo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(tuftGeo.attributes.position.count).fill(1), 1));
    this.grass.receiveShadow = true;
    this.grass.castShadow = false;
    this.grass.frustumCulled = false;
    this.group.add(this.grass);

    // ---------------- trees ----------------
    const pines: { x: number; z: number; s: number }[] = [];
    const rounds: { x: number; z: number; s: number }[] = [];
    const shrubs: { x: number; z: number; s: number }[] = [];
    const occupied = new Set<number>();
    const cellKey = (x: number, z: number) => Math.floor(x / 4) * 1000 + Math.floor(z / 4);
    const forestNoise = new SimplexNoise(seed ^ 0xf0e57);
    for (let tries = 0; tries < 16000; tries++) {
      const x = rng.range(3, WORLD_SIZE - 3), z = rng.range(3, WORLD_SIZE - 3);
      const h = terrain.heightAt(x, z);
      if (h < BEACH_LEVEL + 0.01 || h > ROCK_LEVEL + 0.03) continue;
      const m = terrain.moistureAt(x, z);
      const f = terrain.fertilityAt(x, z);
      const key = cellKey(x, z);
      if (occupied.has(key)) continue;
      const highland = h > HIGHLAND_LEVEL - 0.06;
      // forests where it's wet; pines up high and in the cooler north
      const north = z / WORLD_SIZE;
      const pineness = (highland ? 0.7 : 0) + north * 0.4 + (m - 0.5) * 0.3;
      // forests clump: a noise mask decides where the woods are
      const forest = forestNoise.fbm(x * 0.022 + 3, z * 0.022 - 7, 3) * 0.5 + 0.5;
      const clump = Math.pow(Math.max(0, forest - 0.35) / 0.65, 1.6);
      const density = (highland ? 0.6 * m : 0.7 * Math.pow(m, 1.3) * (0.4 + f)) * (0.08 + 1.4 * clump);
      if (rng.next() > density * 0.7) continue;
      occupied.add(key);
      if (rng.next() < 0.28 && !highland) {
        shrubs.push({ x, z, s: rng.range(0.7, 1.3) });
      } else if (rng.next() < pineness) {
        pines.push({ x, z, s: rng.range(0.75, 1.45) });
      } else {
        rounds.push({ x, z, s: rng.range(0.7, 1.3) });
      }
      this.treePositions.push({ x, y: z });
    }
    const treeMat = plantMaterial('tree');
    const place = (list: { x: number; z: number; s: number }[], geo: THREE.BufferGeometry, colors: string[], castShadow = true, deciduous = 1) => {
      const mesh = new THREE.InstancedMesh(geo, treeMat, Math.max(1, list.length));
      const inst = new Float32Array(Math.max(1, list.length) * 4);
      list.forEach((t, idx) => {
        tmpP.set(t.x, terrain.elevationAt(t.x, t.z) - 0.15, t.z);
        tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
        tmpS.set(t.s * rng.range(0.9, 1.1), t.s, t.s * rng.range(0.9, 1.1));
        tmpM.compose(tmpP, tmpQ, tmpS);
        mesh.setMatrixAt(idx, tmpM);
        tmpC.set(rng.pick(colors)).offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.08, 0.08), rng.range(-0.06, 0.06));
        tmpC.convertSRGBToLinear();
        mesh.setColorAt(idx, tmpC);
        inst[idx * 4] = rng.next();
        inst[idx * 4 + 1] = rng.next();
        inst[idx * 4 + 2] = deciduous;
      });
      geo.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.count = list.length;
      this.group.add(mesh);
      return mesh;
    };
    this.pines = place(pines, makePineGeometry(), ['#4f9c5c', '#468f64', '#58a452', '#428c5a'], true, 0);
    this.rounds = place(rounds, makeRoundTreeGeometry(), ['#5a9e42', '#6aaa46', '#4c8e40', '#76b052']);
    this.shrubs = place(shrubs, makeShrubGeometry(), ['#68984a', '#7aa652', '#5a8a44'], false, 1);

    // ---------------- rocks ----------------
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.deleteAttribute('uv');
    rockGeo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(rockGeo.attributes.position.count).fill(0), 1));
    const rockMat = new THREE.MeshStandardMaterial({ color: '#b3ada4', roughness: 0.9, flatShading: true });
    const rocks: { x: number; z: number; s: number }[] = [];
    for (let tries = 0; tries < 3000 && rocks.length < 320; tries++) {
      const x = rng.range(3, WORLD_SIZE - 3), z = rng.range(3, WORLD_SIZE - 3);
      const h = terrain.heightAt(x, z);
      if (h < SEA_LEVEL + 0.004) continue;
      const rockiness = h > ROCK_LEVEL ? 0.4 : h > HIGHLAND_LEVEL ? 0.6 : h < BEACH_LEVEL ? 0.3 : 0.08;
      if (rng.next() > rockiness) continue;
      rocks.push({ x, z, s: h > ROCK_LEVEL ? rng.range(0.6, 1.8) : rng.range(0.3, 0.9) });
    }
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rocks.length));
    rocks.forEach((r, idx) => {
      tmpP.set(r.x, terrain.elevationAt(r.x, r.z) - r.s * 0.35, r.z);
      tmpQ.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
      tmpS.set(r.s * rng.range(0.7, 1.3), r.s * rng.range(0.5, 0.9), r.s * rng.range(0.7, 1.3));
      tmpM.compose(tmpP, tmpQ, tmpS);
      this.rocks.setMatrixAt(idx, tmpM);
      tmpC.set('#b3ada4').offsetHSL(rng.range(-0.02, 0.03), 0, rng.range(-0.08, 0.06));
      tmpC.convertSRGBToLinear();
      this.rocks.setColorAt(idx, tmpC);
    });
    this.rocks.count = rocks.length;
    this.rocks.castShadow = true;
    this.rocks.receiveShadow = true;
    this.group.add(this.rocks);
  }
}
