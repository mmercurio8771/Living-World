import * as THREE from 'three';
import { Terrain, SEA_LEVEL, BEACH_LEVEL, HIGHLAND_LEVEL, ROCK_LEVEL, HEIGHT_SCALE, WORLD_SIZE } from '../sim/terrain';
import { SimplexNoise } from '../sim/noise';
import { clamp, smoothstep } from '../sim/rng';
import { attachWorldUniforms, cloudShadowGLSL, worldUniformDeclGLSL } from './shaderlib';

/** The ground: a displaced grid with baked biome colours and live vegetation/snow/cloud shading. */
export class TerrainMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;

  constructor(terrain: Terrain, biomassTex: THREE.Texture, fertilityTex: THREE.Texture, seed: number) {
    const n = terrain.res;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2); // XZ plane, +Y up. After rotation, plane v runs along -Z→+Z? we remap below.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const detail = new SimplexNoise(seed ^ 0x1234);
    const c = new THREE.Color();
    const sand = new THREE.Color('#e7d6a6');
    const sandWet = new THREE.Color('#c9b688');
    const earth = new THREE.Color('#9a7f57');
    const earthDry = new THREE.Color('#b59c6c');
    const bed = new THREE.Color('#6d8a72');
    const bedDeep = new THREE.Color('#355a5e');
    const olive = new THREE.Color('#948f66');
    const rock = new THREE.Color('#8f8a84');
    const rockDark = new THREE.Color('#5f5a56');
    const grad = { x: 0, y: 0 };
    for (let i = 0; i < pos.count; i++) {
      // PlaneGeometry vertices run x: -W/2..W/2, and (after rotateX) z: -W/2..W/2 with the first row at z=-W/2.
      const x = pos.getX(i) + WORLD_SIZE / 2;
      const z = pos.getZ(i) + WORLD_SIZE / 2;
      const h = terrain.heightAt(x, z);
      const y = (h - SEA_LEVEL) * HEIGHT_SCALE;
      pos.setY(i, y);
      terrain.gradientAt(x, z, grad);
      const slope = Math.min(1, Math.hypot(grad.x, grad.y) * HEIGHT_SCALE * 0.55);
      const nz = detail.fbm(x * 0.05, z * 0.05, 3) * 0.5 + 0.5;
      const fine = detail.noise2D(x * 0.35, z * 0.35) * 0.5 + 0.5;
      const moist = terrain.moistureAt(x, z);
      if (h < SEA_LEVEL) {
        const depth = clamp((SEA_LEVEL - h) / 0.12, 0, 1);
        c.copy(sandWet).lerp(bed, smoothstep(0.0, 0.35, depth)).lerp(bedDeep, smoothstep(0.3, 1, depth));
      } else if (h < BEACH_LEVEL) {
        const t = (h - SEA_LEVEL) / (BEACH_LEVEL - SEA_LEVEL);
        c.copy(sandWet).lerp(sand, smoothstep(0, 0.4, t));
        c.lerp(earthDry, smoothstep(0.55, 1, t) * 0.6);
      } else if (h < HIGHLAND_LEVEL) {
        c.copy(earth).lerp(earthDry, (1 - moist) * 0.7 + nz * 0.2);
        c.lerp(olive, smoothstep(HIGHLAND_LEVEL - 0.08, HIGHLAND_LEVEL, h) * 0.5);
      } else if (h < ROCK_LEVEL) {
        const t = (h - HIGHLAND_LEVEL) / (ROCK_LEVEL - HIGHLAND_LEVEL);
        c.copy(olive).lerp(rock, smoothstep(0.3, 1, t));
      } else {
        c.copy(rock).lerp(rockDark, fine * 0.5);
      }
      // cliffs are rock, whatever the height
      c.lerp(rockDark, smoothstep(0.35, 0.8, slope) * 0.85);
      // micro variation so flat areas don't look like plastic
      const v = 0.92 + fine * 0.16;
      colors[i * 3] = c.r * v;
      colors[i * 3 + 1] = c.g * v;
      colors[i * 3 + 2] = c.b * v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0.0,
    });
    const mat = this.material;
    mat.onBeforeCompile = (shader) => {
      attachWorldUniforms(shader);
      shader.uniforms.uBiomass = { value: biomassTex };
      shader.uniforms.uFertility = { value: fertilityTex };
      shader.uniforms.uLush = { value: new THREE.Color('#6aae4c') };
      shader.uniforms.uDry = { value: new THREE.Color('#c9b672') };
      shader.uniforms.uSnow = { value: new THREE.Color('#d6dee8') };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying float vNy;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvNy = normal.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWorldPos;
varying float vNy;
uniform sampler2D uBiomass;
uniform sampler2D uFertility;
uniform vec3 uLush;
uniform vec3 uDry;
uniform vec3 uSnow;
${worldUniformDeclGLSL}
${cloudShadowGLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 wuv = vWorldPos.xz / uWorldSize;
  float bio = texture2D(uBiomass, wuv).r;
  float fert = texture2D(uFertility, wuv).r;
  float g = smoothstep(0.02, 0.75, bio) * step(0.02, fert);
  vec3 col = diffuseColor.rgb;
  // fertile ground that has been grazed bare shows as straw, then earth
  col = mix(col, uDry, fert * 0.5 * (1.0 - g));
  vec3 lush = uLush * uSeasonTint;
  col = mix(col, lush, g * (0.55 + 0.4 * fert));
  // winter: everything a little paler and colder
  col = mix(col, col * vec3(0.9, 0.93, 1.02) + 0.04, uWinter * 0.5);
  // snow on the heights, less on steep faces
  float h01 = vWorldPos.y / ${HEIGHT_SCALE.toFixed(1)} + ${SEA_LEVEL.toFixed(3)};
  float snow = smoothstep(uSnowLine - 0.02, uSnowLine + 0.05, h01) * smoothstep(0.45, 0.85, vNy);
  col = mix(col, uSnow, snow);
  diffuseColor.rgb = col;
}`,
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 1.0 - uWet * 0.55;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= cloudShadow(vWorldPos.xz);');
    };
    mat.customProgramCacheKey = () => 'terrain';

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false; // self-shadowing shows the shadow frustum edge; the normal shading carries the relief
  }
}
