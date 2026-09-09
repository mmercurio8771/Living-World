import * as THREE from 'three';
import { Atmosphere } from './palette';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // push to far plane
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform float uNight;
uniform float uStars;
uniform float uMoon;
uniform float uTime;
uniform float uCloud;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  // gradient with a soft band at the horizon
  float t = pow(max(h, 0.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  // below the horizon: keep a dim haze so the far water has something to fade into
  col = mix(col, uHorizon * 0.85, smoothstep(0.0, -0.2, d.y));

  float sd = max(dot(d, uSunDir), 0.0);
  // sun / moon disc and glow
  float disc = smoothstep(0.9985, 0.9993, sd);
  float glow = pow(sd, 48.0) * 0.55 + pow(sd, 6.0) * 0.18;
  vec3 glowCol = uGlow;
  col += glowCol * glow * (1.0 - uCloud * 0.6);
  col += mix(glowCol * 6.0, vec3(0.9, 0.95, 1.1) * 2.2, uMoon) * disc * (1.0 - uCloud * 0.8);

  // stars: hashed points that twinkle, only above the horizon at night
  if (uStars > 0.001 && d.y > 0.0) {
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float r = hash(cell);
    vec3 centre = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 5.1)) - 0.5) * 0.7;
    float dist = length(sp - centre);
    float star = smoothstep(0.32, 0.0, dist) * step(0.975, r);
    float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 3.0) + r * 40.0);
    col += vec3(0.9, 0.93, 1.0) * star * tw * uStars * smoothstep(0.0, 0.25, d.y) * 1.3;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** A dome that carries the gradient, sun, moon and stars. Also the fog's colour reference. */
export class Sky {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlow: { value: new THREE.Color() },
        uNight: { value: 0 },
        uStars: { value: 0 },
        uMoon: { value: 0 },
        uTime: { value: 0 },
        uCloud: { value: 0 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    this.mesh.scale.setScalar(2000);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  update(atm: Atmosphere, cameraPos: THREE.Vector3, time: number, cloud: number): void {
    const u = this.mat.uniforms;
    (u.uZenith.value as THREE.Color).copy(atm.skyZenith);
    (u.uHorizon.value as THREE.Color).copy(atm.skyHorizon);
    (u.uSunDir.value as THREE.Vector3).copy(atm.sunDir);
    (u.uGlow.value as THREE.Color).copy(atm.glowColor);
    u.uNight.value = atm.night;
    u.uStars.value = atm.starAmount;
    u.uMoon.value = atm.moonUp;
    u.uTime.value = time;
    u.uCloud.value = cloud;
    this.mesh.position.copy(cameraPos);
  }
}
