import * as THREE from 'three';
import { Terrain } from '../sim/terrain';
import { Vegetation } from '../sim/vegetation';
import { SimplexNoise } from '../sim/noise';

/** Live vegetation fraction (biomass / capacity) as a texture, updated in place each frame. */
export class BiomassTexture {
  texture: THREE.DataTexture;
  private data: Uint8Array;
  constructor(private veg: Vegetation) {
    const n = veg.res;
    this.data = new Uint8Array(n * n);
    this.texture = new THREE.DataTexture(this.data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.update();
  }
  update(): void {
    const b = this.veg.biomass, c = this.veg.capacity, d = this.data;
    for (let k = 0; k < d.length; k++) {
      const cap = c[k];
      d[k] = cap > 0.02 ? Math.min(255, (b[k] / cap) * 255) | 0 : 0;
    }
    this.texture.needsUpdate = true;
  }
}

export function makeFertilityTexture(terrain: Terrain): THREE.DataTexture {
  const n = terrain.res;
  const data = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) data[k] = (terrain.fertility[k] * 255) | 0;
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeHeightTexture(terrain: Terrain): THREE.DataTexture {
  const n = terrain.res;
  const data = new Float32Array(n * n);
  data.set(terrain.height);
  const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable-ish soft noise for clouds and water ripples. */
export function makeNoiseTexture(seed: number, size = 256): THREE.DataTexture {
  const noise = new SimplexNoise(seed);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // sample on a torus so the texture tiles
      const a = (i / size) * Math.PI * 2, b = (j / size) * Math.PI * 2;
      const x = Math.cos(a) * 1.6, y = Math.sin(a) * 1.6, z = Math.cos(b) * 1.6, w = Math.sin(b) * 1.6;
      const n1 = noise.fbm(x + z * 0.7, y + w * 0.7, 4) * 0.5 + 0.5;
      const n2 = noise.fbm(x * 2.1 + 5 + w, y * 2.1 + z, 3) * 0.5 + 0.5;
      const n3 = noise.noise2D(x * 4 + z * 3 + 9, y * 4 + w * 3) * 0.5 + 0.5;
      const k = (j * size + i) * 4;
      data[k] = n1 * 255;
      data[k + 1] = n2 * 255;
      data[k + 2] = n3 * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
