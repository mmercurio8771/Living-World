import * as THREE from 'three';
import { SEA_LEVEL, WORLD_SIZE } from '../sim/terrain';
import { Atmosphere } from './palette';

const vert = /* glsl */ `
varying vec3 vWorldPos;
varying vec2 vUv;
uniform float uTime;
void main() {
  vUv = uv;
  vec3 p = position;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  // gentle swell
  wp.y += sin(wp.x * 0.11 + uTime * 0.9) * 0.06 + sin(wp.z * 0.17 - uTime * 0.7) * 0.05;
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vWorldPos;
varying vec2 vUv;
uniform sampler2D uHeight;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uWorldSize;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uNight;
uniform float uRain;
uniform float uWindStrength;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uCameraPos;

void main() {
  vec2 wuv = vWorldPos.xz / uWorldSize;
  float inside = step(0.0, wuv.x) * step(wuv.x, 1.0) * step(0.0, wuv.y) * step(wuv.y, 1.0);
  float h = mix(0.0, texture2D(uHeight, wuv).r, inside);
  float depth = clamp((${SEA_LEVEL.toFixed(3)} - h) / 0.10, 0.0, 1.0);

  // animated normal from two scrolling noise layers
  vec2 n1uv = vWorldPos.xz * 0.045 + vec2(uTime * 0.025, uTime * 0.017);
  vec2 n2uv = vWorldPos.xz * 0.09 - vec2(uTime * 0.02, -uTime * 0.03);
  vec3 nA = texture2D(uNoise, n1uv).rgb;
  vec3 nB = texture2D(uNoise, n2uv).rgb;
  float ripple = (nA.r - 0.5) * 0.6 + (nB.g - 0.5) * 0.4;
  float rippleX = (nA.g - 0.5) * 0.6 + (nB.b - 0.5) * 0.4;
  float amp = 0.35 + uWindStrength * 0.5 + uRain * 0.6;
  vec3 N = normalize(vec3(rippleX * amp, 1.0, ripple * amp));

  vec3 V = normalize(uCameraPos - vWorldPos);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // colour by depth, tinted with sky
  vec3 base = mix(uShallow, uDeep, smoothstep(0.0, 1.0, depth));
  vec3 skyRef = mix(uHorizonColor, uSkyColor, clamp(V.y, 0.0, 1.0));
  vec3 col = mix(base, skyRef, 0.25 + 0.5 * fres);

  // caustic-ish shimmer in the shallows
  float caus = pow(max(0.0, sin((nA.b + nB.r) * 12.0 + uTime * 1.6)), 6.0);
  col += uShallow * caus * (1.0 - depth) * 0.35 * (1.0 - uNight * 0.8);

  // sun / moon glitter
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), mix(180.0, 60.0, uRain));
  col += uSunColor * spec * (0.6 - uRain * 0.3) * (1.0 - fres * 0.5);

  // foam along the shore, breathing with time
  float shore = smoothstep(0.12, 0.0, depth) * inside;
  float foamN = texture2D(uNoise, vWorldPos.xz * 0.12 + vec2(uTime * 0.05, 0.0)).b;
  float foam = shore * smoothstep(0.45, 0.8, foamN + 0.25 * sin(uTime * 1.5 + vWorldPos.x * 0.3 + vWorldPos.z * 0.2));
  col = mix(col, vec3(0.92, 0.95, 0.95) * (1.0 - uNight * 0.75), foam * 0.7);

  // rain rings
  if (uRain > 0.01) {
    float r = texture2D(uNoise, vWorldPos.xz * 0.35 + vec2(uTime * 0.3, uTime * 0.21)).r;
    col += vec3(0.08) * uRain * smoothstep(0.75, 0.95, r);
  }

  float alpha = mix(0.7, 0.985, smoothstep(0.0, 0.7, depth));
  alpha = max(alpha, foam);

  // fog
  float dist = length(uCameraPos - vWorldPos);
  float fogF = smoothstep(uFogNear, uFogFar, dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, alpha);
}`;

/** The sea and the lakes: one big plane at sea level with a depth-aware shader. */
export class Water {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(heightTex: THREE.Texture, noiseTex: THREE.Texture) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uHeight: { value: heightTex },
        uNoise: { value: noiseTex },
        uTime: { value: 0 },
        uWorldSize: { value: WORLD_SIZE },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSkyColor: { value: new THREE.Color() },
        uHorizonColor: { value: new THREE.Color() },
        uDeep: { value: new THREE.Color('#12506a') },
        uShallow: { value: new THREE.Color('#4cc1b4') },
        uNight: { value: 0 },
        uRain: { value: 0 },
        uWindStrength: { value: 0.4 },
        uFogColor: { value: new THREE.Color() },
        uFogNear: { value: 100 },
        uFogFar: { value: 600 },
        uCameraPos: { value: new THREE.Vector3() },
      },
    });
    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 6, WORLD_SIZE * 6, 64, 64);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(WORLD_SIZE / 2, 0.02, WORLD_SIZE / 2);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
  }

  update(atm: Atmosphere, time: number, rain: number, wind: number, cameraPos: THREE.Vector3, fogNear: number, fogFar: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    (u.uSunDir.value as THREE.Vector3).copy(atm.sunDir);
    (u.uSunColor.value as THREE.Color).copy(atm.sunColor).multiplyScalar(Math.min(1, atm.sunIntensity * 0.4));
    (u.uSkyColor.value as THREE.Color).copy(atm.skyZenith);
    (u.uHorizonColor.value as THREE.Color).copy(atm.skyHorizon);
    // the water itself darkens at night
    const night = atm.night;
    (u.uDeep.value as THREE.Color).set('#12506a').lerp(new THREE.Color('#071a26'), night);
    (u.uShallow.value as THREE.Color).set('#4cc1b4').lerp(new THREE.Color('#12404a'), night);
    u.uNight.value = night;
    u.uRain.value = rain;
    u.uWindStrength.value = wind;
    (u.uFogColor.value as THREE.Color).copy(atm.fog);
    u.uFogNear.value = fogNear;
    u.uFogFar.value = fogFar;
    (u.uCameraPos.value as THREE.Vector3).copy(cameraPos);
  }
}
