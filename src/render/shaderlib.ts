import * as THREE from 'three';

/**
 * Uniforms shared by every surface material: cloud shadows, season tint, world size.
 * One object, referenced by all materials, updated once per frame.
 */
export const worldUniforms = {
  uWorldSize: { value: 256 },
  uClouds: { value: null as THREE.Texture | null },
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  uCloudCover: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(0.6, 0.2, 0.4) }, // x, z, strength
  uSeasonTint: { value: new THREE.Color(1, 1, 1) },
  uAutumn: { value: 0 }, // 0..1
  uWinter: { value: 0 }, // 0..1
  uBloom: { value: 0 }, // flowers
  uWet: { value: 0 },
  uSnowLine: { value: 0.86 },
};

export const cloudShadowGLSL = /* glsl */ `
float cloudShadow(vec2 worldXZ) {
  vec2 cuv = worldXZ / uWorldSize * 1.6 + uCloudOffset;
  float c = texture2D(uClouds, cuv).r;
  float c2 = texture2D(uClouds, cuv * 2.3 + vec2(0.37, 0.11)).g;
  float cover = uCloudCover;
  float cloud = smoothstep(0.62 - cover * 0.35, 0.85 - cover * 0.2, c * 0.75 + c2 * 0.25);
  return 1.0 - cloud * (0.35 + 0.35 * cover);
}`;

/** Add the shared uniforms to a material's shader (call inside onBeforeCompile). */
export function attachWorldUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, worldUniforms);
}

export const worldUniformDeclGLSL = /* glsl */ `
uniform float uWorldSize;
uniform sampler2D uClouds;
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uSeasonTint;
uniform float uAutumn;
uniform float uWinter;
uniform float uBloom;
uniform float uWet;
uniform float uSnowLine;
`;
