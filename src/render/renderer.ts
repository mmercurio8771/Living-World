import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { World } from '../sim/world';
import { WORLD_SIZE } from '../sim/terrain';
import { Atmosphere, makeAtmosphere, updateAtmosphere } from './palette';
import { Sky } from './sky';
import { Lighting } from './lighting';
import { TerrainMesh } from './terrainMesh';
import { Water } from './water';
import { VegetationMesh } from './vegetationMesh';
import { Creatures, CarrionMesh } from './creatures';
import { Particles } from './particles';
import { BiomassTexture, makeFertilityTexture, makeHeightTexture, makeNoiseTexture } from './textures';
import { worldUniforms } from './shaderlib';
import { CameraController } from './camera';
import { clamp, smoothstep } from '../sim/rng';
import { Organism } from '../sim/organism';

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uSaturation: { value: 1.08 },
    uWarm: { value: 0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uSaturation;
uniform float uWarm;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 q = vUv - 0.5;
  float v = 1.0 - uVignette * smoothstep(0.25, 1.1, dot(q, q) * 2.2);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  c.rgb = mix(vec3(l), c.rgb, uSaturation);
  c.rgb *= vec3(1.0 + uWarm * 0.04, 1.0, 1.0 - uWarm * 0.04);
  c.rgb *= v;
  c.rgb += (hash(vUv * 1000.0) - 0.5) * uGrain;
  gl_FragColor = c;
}`,
};

/** Owns the scene, all render subsystems and the post chain. */
export class Renderer {
  gl: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  composer: EffectComposer;
  atm: Atmosphere = makeAtmosphere();
  sky: Sky;
  lighting: Lighting;
  terrainMesh: TerrainMesh;
  water: Water;
  vegetation: VegetationMesh;
  creatures: Creatures;
  carrion: CarrionMesh;
  particles: Particles;
  biomassTex: BiomassTexture;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  selectionRing: THREE.Mesh;
  hoverRing: THREE.Mesh;
  private fog: THREE.Fog;
  private cloudTex: THREE.DataTexture;
  private frame = 0;
  quality: 'high' | 'medium' | 'low' = 'high';
  private fpsAvg = 60;

  constructor(public canvas: HTMLCanvasElement, public world: World, public cam: CameraController) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    const pr = Math.min(window.devicePixelRatio || 1, 1.75);
    this.gl.setPixelRatio(pr);

    this.fog = new THREE.Fog(0xcadeef, 100, 600);
    this.scene.fog = this.fog;

    const t = world.terrain;
    this.biomassTex = new BiomassTexture(world.vegetation);
    const fert = makeFertilityTexture(t);
    const height = makeHeightTexture(t);
    const noise = makeNoiseTexture(world.seed ^ 0x5151);
    this.cloudTex = makeNoiseTexture(world.seed ^ 0xc10d, 256);
    worldUniforms.uClouds.value = this.cloudTex;
    worldUniforms.uWorldSize.value = WORLD_SIZE;

    this.sky = new Sky(this.scene);
    this.lighting = new Lighting(this.scene, 2048);
    this.terrainMesh = new TerrainMesh(t, this.biomassTex.texture, fert, world.seed);
    this.scene.add(this.terrainMesh.mesh);
    this.water = new Water(height, noise);
    this.scene.add(this.water.mesh);
    // a dark sea floor far below, so the deep water has something to sit on
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 6, WORLD_SIZE * 6), new THREE.MeshStandardMaterial({ color: '#2a4a52', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(WORLD_SIZE / 2, -9, WORLD_SIZE / 2);
    this.scene.add(floor);
    this.vegetation = new VegetationMesh(t, world.vegetation, this.biomassTex.texture, world.seed);
    this.scene.add(this.vegetation.group);
    this.creatures = new Creatures(world, t);
    this.scene.add(this.creatures.group);
    this.carrion = new CarrionMesh(world, t);
    this.scene.add(this.carrion.mesh);
    this.particles = new Particles(world, t);
    this.particles.setPixelRatio(pr);
    this.scene.add(this.particles.additive);
    this.scene.add(this.particles.normal);

    // selection / hover rings
    const ringGeo = new THREE.RingGeometry(0.75, 1.0, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.selectionRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 10;
    this.scene.add(this.selectionRing);
    this.hoverRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.hoverRing.visible = false;
    this.hoverRing.renderOrder = 10;
    this.scene.add(this.hoverRing);

    // post
    const size = new THREE.Vector2();
    this.gl.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.gl, rt);
    this.composer.addPass(new RenderPass(this.scene, cam.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(gradeShader);
    this.composer.addPass(this.grade);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.cam.setAspect(w / h);
  }

  /** Adapt quality to frame time. */
  private adapt(dt: number): void {
    const fps = 1 / Math.max(1e-3, dt);
    this.fpsAvg = this.fpsAvg * 0.95 + fps * 0.05;
    if (this.frame % 120 !== 0) return;
    if (this.fpsAvg < 34 && this.quality === 'high') this.setQuality('medium');
    else if (this.fpsAvg < 24 && this.quality === 'medium') this.setQuality('low');
  }

  setQuality(q: 'high' | 'medium' | 'low'): void {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio || 1, 1.75) : q === 'medium' ? 1 : 0.8;
    this.gl.setPixelRatio(pr);
    this.particles.setPixelRatio(pr);
    this.lighting.sun.shadow.mapSize.setScalar(q === 'high' ? 2048 : 1024);
    if (this.lighting.sun.shadow.map) {
      this.lighting.sun.shadow.map.dispose();
      this.lighting.sun.shadow.map = null;
    }
    this.bloom.enabled = q !== 'low';
    this.resize();
  }

  update(dt: number, alpha: number, selected: Organism | null, hovered: Organism | null): void {
    this.frame++;
    this.adapt(dt);
    const world = this.world;
    const climate = world.climate;
    const atm = this.atm;
    updateAtmosphere(atm, climate);
    const now = performance.now() * 0.001;

    // camera follows?
    let followPos: THREE.Vector3 | null = null;
    if (this.cam.followId >= 0) {
      const o = world.byId.get(this.cam.followId);
      if (o && o.alive) {
        const x = o.px + (o.x - o.px) * alpha, z = o.py + (o.y - o.py) * alpha;
        followPos = new THREE.Vector3(x, world.terrain.elevationAt(x, z), z);
      }
    }
    this.cam.update(dt, followPos);
    const cam = this.cam.camera;

    // atmosphere → scene
    this.sky.update(atm, cam.position, now, climate.cloudCover);
    this.fog.color.copy(atm.fog);
    const d = this.cam.distance;
    this.fog.near = atm.fogNear * 0.5 + d * 1.3;
    this.fog.far = atm.fogFar * 0.8 + d * 3.2;
    this.gl.toneMappingExposure = atm.exposure * 1.12;
    this.bloom.strength = atm.bloomStrength;
    const shadowExtent = clamp(this.cam.distance * 1.5 + 30, 60, 240);
    this.lighting.update(atm, this.cam.focus, shadowExtent);

    // seasons → shared uniforms
    const yf = climate.yearFrac;
    const autumn = smoothstep(0.5, 0.62, yf) * (1 - smoothstep(0.74, 0.8, yf));
    const winter = Math.max(smoothstep(0.74, 0.84, yf), 1 - smoothstep(0.0, 0.1, yf)) * 1.0;
    const bloomF = smoothstep(0.04, 0.14, yf) * (1 - smoothstep(0.4, 0.55, yf));
    const cold = clamp((10 - climate.baseTemperature) / 22, 0, 1);
    worldUniforms.uAutumn.value = autumn;
    worldUniforms.uWinter.value = Math.max(winter, cold * 0.8);
    worldUniforms.uBloom.value = bloomF * (1 - cold);
    worldUniforms.uSnowLine.value = 0.9 - cold * 0.36;
    worldUniforms.uWet.value = climate.rain;
    worldUniforms.uTime.value = now;
    worldUniforms.uCloudCover.value = climate.cloudCover;
    const wind = climate;
    (worldUniforms.uWind.value as THREE.Vector3).set(wind.windX, wind.windY, wind.windStrength);
    (worldUniforms.uCloudOffset.value as THREE.Vector2).x += wind.windX * wind.windStrength * dt * 0.012;
    (worldUniforms.uCloudOffset.value as THREE.Vector2).y += wind.windY * wind.windStrength * dt * 0.012;
    (worldUniforms.uSeasonTint.value as THREE.Color)
      .set(1, 1, 1)
      .lerp(new THREE.Color(1.06, 0.92, 0.72), autumn * 0.7)
      .lerp(new THREE.Color(0.9, 0.95, 1.02), worldUniforms.uWinter.value * 0.6);
    this.grade.uniforms.uTime.value = now;
    this.grade.uniforms.uWarm.value = clamp(climate.sunElevation < 0.25 && climate.sunElevation > -0.1 ? 1 : 0, 0, 1) * 0.6;

    // textures & objects
    if (this.frame % 3 === 0) this.biomassTex.update();
    this.water.update(atm, now, climate.rain, climate.windStrength, cam.position, this.fog.near, this.fog.far);
    this.creatures.update(dt, alpha);
    this.carrion.update();
    this.particles.onEffects(world.effects);
    this.particles.update(dt, atm, this.cam.focus, this.cam.distance);

    // rings
    const placeRing = (ring: THREE.Mesh, o: Organism | null, pulse: number) => {
      if (!o || !o.alive) {
        ring.visible = false;
        return;
      }
      const x = o.px + (o.x - o.px) * alpha, z = o.py + (o.y - o.py) * alpha;
      ring.visible = true;
      ring.position.set(x, world.terrain.elevationAt(x, z) + 0.12, z);
      const s = o.bodySize * 1.6 * (1 + 0.08 * Math.sin(now * 4) * pulse);
      ring.scale.setScalar(s);
    };
    placeRing(this.selectionRing, selected, 1);
    placeRing(this.hoverRing, hovered && hovered !== selected ? hovered : null, 0);
    (this.selectionRing.material as THREE.MeshBasicMaterial).color.set(selected?.species === 'hunter' ? 0xffb090 : 0xd8ffb0);

    this.composer.render();
  }
}
