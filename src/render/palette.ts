import * as THREE from 'three';
import { clamp, smoothstep } from '../sim/rng';
import { Climate } from '../sim/climate';

/** Everything colour-related that depends on the time of day and the weather. */
export interface Atmosphere {
  sunDir: THREE.Vector3; // direction *toward* the light source
  sunColor: THREE.Color;
  sunIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fog: THREE.Color;
  fogNear: number;
  fogFar: number;
  exposure: number;
  night: number; // 0 day .. 1 night
  moonUp: number; // 0..1
  starAmount: number;
  glowColor: THREE.Color; // sun/moon disc glow
  bloomStrength: number;
}

interface Key {
  e: number; // sun elevation
  sun: string;
  sunI: number;
  zenith: string;
  horizon: string;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: string;
  exposure: number;
}

// keyframes by sun elevation
const KEYS: Key[] = [
  { e: -0.7, sun: '#9fb4e6', sunI: 1.05, zenith: '#05081a', horizon: '#0d1530', hemiSky: '#2c3d6e', hemiGround: '#10151f', hemiI: 1.1, fog: '#0b1226', exposure: 1.0 },
  { e: -0.25, sun: '#9fb4e6', sunI: 1.0, zenith: '#070c1e', horizon: '#161f3c', hemiSky: '#2f3f70', hemiGround: '#12161f', hemiI: 1.1, fog: '#0d1428', exposure: 1.0 },
  { e: -0.08, sun: '#c48a7a', sunI: 0.8, zenith: '#1a2247', horizon: '#6d3f5d', hemiSky: '#3f4676', hemiGround: '#221c1a', hemiI: 0.85, fog: '#3b2a4a', exposure: 1.0 },
  { e: 0.03, sun: '#ffa060', sunI: 1.5, zenith: '#33437a', horizon: '#f0905a', hemiSky: '#6a6f9e', hemiGround: '#4a3a2c', hemiI: 0.95, fog: '#c48a78', exposure: 1.0 },
  { e: 0.18, sun: '#ffd0a0', sunI: 2.3, zenith: '#4d84c8', horizon: '#f2c9a0', hemiSky: '#93b3dc', hemiGround: '#6e7452', hemiI: 1.25, fog: '#d9c4b5', exposure: 1.0 },
  { e: 0.55, sun: '#fff1dc', sunI: 3.2, zenith: '#4c8fd8', horizon: '#c6def3', hemiSky: '#a6c8ee', hemiGround: '#7a8858', hemiI: 1.45, fog: '#c9dcee', exposure: 1.0 },
  { e: 1.0, sun: '#fff8ee', sunI: 3.4, zenith: '#3f86d6', horizon: '#c9e2f5', hemiSky: '#a9cdf2', hemiGround: '#7e8c5c', hemiI: 1.5, fog: '#cadeef', exposure: 1.0 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpKey(e: number, pick: (k: Key) => string | number, out?: THREE.Color): THREE.Color | number {
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].e < e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  const va = pick(a), vb = pick(b);
  if (typeof va === 'number') return va + ((vb as number) - va) * t;
  tmpA.set(va as string);
  tmpB.set(vb as string);
  return (out ?? new THREE.Color()).copy(tmpA).lerp(tmpB, t);
}

export function makeAtmosphere(): Atmosphere {
  return {
    sunDir: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 1,
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    hemiIntensity: 1,
    fog: new THREE.Color(),
    fogNear: 100,
    fogFar: 600,
    exposure: 1,
    night: 0,
    moonUp: 0,
    starAmount: 0,
    glowColor: new THREE.Color(),
    bloomStrength: 0.3,
  };
}

/** Fill `atm` from the climate's current state. */
export function updateAtmosphere(atm: Atmosphere, climate: Climate): void {
  const e = climate.sunElevation;
  const cloud = climate.cloudCover;
  const rain = climate.rain;
  lerpKey(e, (k) => k.sun, atm.sunColor);
  atm.sunIntensity = lerpKey(e, (k) => k.sunI) as number;
  lerpKey(e, (k) => k.zenith, atm.skyZenith);
  lerpKey(e, (k) => k.horizon, atm.skyHorizon);
  lerpKey(e, (k) => k.hemiSky, atm.hemiSky);
  lerpKey(e, (k) => k.hemiGround, atm.hemiGround);
  atm.hemiIntensity = lerpKey(e, (k) => k.hemiI) as number;
  lerpKey(e, (k) => k.fog, atm.fog);
  atm.exposure = lerpKey(e, (k) => k.exposure) as number;

  // overcast: flatten light, grey the sky
  const grey = tmpA.set('#9aa3ad');
  const overcast = smoothstep(0.35, 0.95, cloud) * (e > 0 ? 1 : 0.4);
  atm.sunIntensity *= 1 - 0.7 * overcast;
  atm.hemiIntensity *= 1 + 0.2 * overcast;
  atm.skyZenith.lerp(grey.clone().multiplyScalar(e > 0 ? 0.75 : 0.12), overcast * 0.85);
  atm.skyHorizon.lerp(grey.clone().multiplyScalar(e > 0 ? 0.9 : 0.15), overcast * 0.85);
  atm.fog.lerp(grey.clone().multiplyScalar(e > 0 ? 0.85 : 0.13), overcast * 0.8);
  atm.hemiSky.lerp(grey.clone().multiplyScalar(e > 0 ? 0.8 : 0.15), overcast * 0.6);
  // rain: darker, closer fog
  atm.fogNear = 120 - rain * 40 - overcast * 20;
  atm.fogFar = 620 - rain * 220 - overcast * 120;
  atm.exposure *= 1 - 0.1 * rain;

  atm.night = smoothstep(0.08, -0.15, e);
  atm.moonUp = smoothstep(-0.02, -0.2, e);
  atm.starAmount = smoothstep(-0.03, -0.25, e) * (1 - cloud * 0.9);
  atm.glowColor.copy(atm.sunColor);
  atm.bloomStrength = 0.28 + 0.3 * atm.night;

  // light direction: the sun arcs east→west; at night the moon from a different bearing
  const dayFrac = climate.dayFrac;
  const az = (dayFrac - 0.5) * Math.PI * 1.1; // -0.55π .. 0.55π over the day
  const el = Math.max(0.12, e) * 1.05;
  const sunX = Math.sin(az) * Math.cos(el);
  const sunY = Math.sin(el);
  const sunZ = -Math.cos(az) * Math.cos(el) * 0.75 - 0.35;
  if (e > -0.02) {
    atm.sunDir.set(sunX, sunY, sunZ).normalize();
  } else {
    // moon: high and from the other side
    const maz = az + Math.PI * 0.8;
    atm.sunDir.set(Math.sin(maz) * 0.6, 0.85, -Math.cos(maz) * 0.5 - 0.3).normalize();
  }
}
