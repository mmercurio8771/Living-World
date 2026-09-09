import { SimplexNoise } from './noise';
import { clamp, smoothstep, lerp } from './rng';

export const WORLD_SIZE = 256; // world units, square
export const TERRAIN_RES = 256; // height samples per side
export const SEA_LEVEL = 0.40;
export const BEACH_LEVEL = 0.425;
export const HIGHLAND_LEVEL = 0.66;
export const ROCK_LEVEL = 0.78;
export const SNOW_LEVEL = 0.86;
export const HEIGHT_SCALE = 34; // world units of vertical relief at h=1

/**
 * The land itself. An island, so that the sea is the natural boundary of the world.
 * Height, moisture and fertility are baked once; everything else reads from them.
 */
export class Terrain {
  readonly res = TERRAIN_RES;
  readonly size = WORLD_SIZE;
  readonly height: Float32Array; // [0,1]
  readonly moisture: Float32Array; // [0,1]
  readonly fertility: Float32Array; // [0,1] — vegetation carrying capacity
  readonly waterDist: Float32Array; // world units to nearest water
  readonly water: Uint8Array; // 1 = water
  readonly landFraction: number;
  private noise: SimplexNoise;

  constructor(seed: number) {
    const n = this.res;
    this.noise = new SimplexNoise(seed);
    const warp = new SimplexNoise(seed ^ 0x9e3779b9);
    const detail = new SimplexNoise(seed ^ 0x51ed27);
    this.height = new Float32Array(n * n);
    this.moisture = new Float32Array(n * n);
    this.fertility = new Float32Array(n * n);
    this.waterDist = new Float32Array(n * n);
    this.water = new Uint8Array(n * n);

    // --- height ---
    const rawH = new Float32Array(n * n);
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const v = j / (n - 1);
        // domain warp for organic coastlines
        const wx = warp.fbm(u * 2.1 + 3.7, v * 2.1 + 1.3, 3) * 0.18;
        const wy = warp.fbm(u * 2.1 - 5.1, v * 2.1 + 9.2, 3) * 0.18;
        const x = u + wx;
        const y = v + wy;
        let h = this.noise.fbm(x * 3.1, y * 3.1, 6, 2.05, 0.5) * 0.5 + 0.5;
        // a mountain spine, ridged, biased to one side of the island
        const ridge = this.noise.ridged(x * 1.9 + 11, y * 1.9 + 7, 4);
        const spine = smoothstep(0.3, 0.85, 1 - Math.abs((x - 0.62) - (y - 0.45) * 0.55) * 2.6);
        h = h * 0.78 + ridge * 0.27 * (0.3 + 0.7 * spine);
        h += detail.noise2D(x * 12, y * 12) * 0.015;
        // island falloff: distance from centre, squircle-ish, slightly irregular
        const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2;
        const r = Math.pow(Math.pow(Math.abs(dx), 2.6) + Math.pow(Math.abs(dy), 2.6), 1 / 2.6);
        const edgeNoise = warp.fbm(u * 3 + 20, v * 3 - 13, 3) * 0.12;
        const falloff = smoothstep(0.62 + edgeNoise, 1.02 + edgeNoise, r);
        h = h * (1 - falloff * 0.95) - falloff * 0.25 + 0.09 * (1 - smoothstep(0.2, 0.75, r));
        rawH[j * n + i] = h;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    // normalise so the sea sits where we want it
    for (let k = 0; k < n * n; k++) {
      let h = clamp((rawH[k] - minH) / (maxH - minH), 0, 1);
      // push the distribution: broad lowlands, rarer peaks
      h = Math.pow(h, 1.25);
      this.height[k] = h;
    }
    // ensure a comfortable land fraction (target ~55-62%) by shifting heights
    const target = 0.58;
    let lo = -0.3, hi = 0.3;
    for (let it = 0; it < 24; it++) {
      const mid = (lo + hi) / 2;
      let land = 0;
      for (let k = 0; k < n * n; k++) if (this.height[k] + mid > SEA_LEVEL) land++;
      if (land / (n * n) > target) hi = mid; else lo = mid;
    }
    const shift = (lo + hi) / 2;
    for (let k = 0; k < n * n; k++) {
      let h = clamp(this.height[k] + shift, 0, 1);
      // broad lowlands, rarer peaks: compress the heights above the sea
      if (h > SEA_LEVEL) {
        const t = (h - SEA_LEVEL) / (1 - SEA_LEVEL);
        h = SEA_LEVEL + Math.pow(t, 1.7) * (1 - SEA_LEVEL);
      }
      this.height[k] = h;
    }

    // --- water mask + distance to water (BFS) ---
    let land = 0;
    const queue: number[] = [];
    for (let k = 0; k < n * n; k++) {
      if (this.height[k] < SEA_LEVEL) {
        this.water[k] = 1;
        this.waterDist[k] = 0;
        queue.push(k);
      } else {
        land++;
        this.waterDist[k] = 1e9;
      }
    }
    this.landFraction = land / (n * n);
    let head = 0;
    while (head < queue.length) {
      const k = queue[head++];
      const i = k % n, j = (k / n) | 0;
      const d = this.waterDist[k];
      const push = (ii: number, jj: number, cost: number) => {
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) return;
        const kk = jj * n + ii;
        if (this.waterDist[kk] > d + cost) {
          this.waterDist[kk] = d + cost;
          queue.push(kk);
        }
      };
      push(i + 1, j, 1); push(i - 1, j, 1); push(i, j + 1, 1); push(i, j - 1, 1);
      push(i + 1, j + 1, 1.414); push(i - 1, j - 1, 1.414); push(i + 1, j - 1, 1.414); push(i - 1, j + 1, 1.414);
    }
    const cellSize = this.size / n;
    for (let k = 0; k < n * n; k++) this.waterDist[k] *= cellSize;

    // --- moisture & fertility ---
    const moistNoise = new SimplexNoise(seed ^ 0xabcdef);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const u = i / (n - 1), v = j / (n - 1);
        const h = this.height[k];
        const nearWater = Math.exp(-this.waterDist[k] / 26);
        const mn = moistNoise.fbm(u * 3.3 + 4, v * 3.3 + 8, 4) * 0.5 + 0.5;
        // prevailing wind from the south-west drops rain on the west
        const windward = smoothstep(0.9, 0.1, u) * 0.18;
        let m = 0.28 + 0.45 * mn + 0.32 * nearWater + windward - Math.max(0, h - HIGHLAND_LEVEL) * 1.4;
        m = clamp(m, 0, 1);
        this.moisture[k] = m;
        // fertility: lowlands best, beaches poor, rock none
        const heightSuit =
          smoothstep(SEA_LEVEL, BEACH_LEVEL + 0.03, h) * (1 - smoothstep(HIGHLAND_LEVEL, ROCK_LEVEL, h) * 0.85);
        let f = heightSuit * (0.25 + 0.75 * m);
        if (this.water[k]) f = 0;
        this.fertility[k] = clamp(f, 0, 1);
      }
    }
  }

  /** Bilinear height in [0,1] at world coordinates. */
  heightAt(x: number, y: number): number {
    const n = this.res;
    const s = (n - 1) / this.size;
    const fx = clamp(x * s, 0, n - 1.001);
    const fy = clamp(y * s, 0, n - 1.001);
    const i = fx | 0, j = fy | 0;
    const tx = fx - i, ty = fy - j;
    const h = this.height;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  }

  /** World-space elevation (units). Water surface for underwater points. */
  elevationAt(x: number, y: number): number {
    const h = this.heightAt(x, y);
    return (Math.max(h, SEA_LEVEL) - SEA_LEVEL) * HEIGHT_SCALE;
  }

  isWater(x: number, y: number): boolean {
    return this.heightAt(x, y) < SEA_LEVEL;
  }

  fertilityAt(x: number, y: number): number {
    return this.sampleNearest(this.fertility, x, y);
  }

  moistureAt(x: number, y: number): number {
    return this.sampleNearest(this.moisture, x, y);
  }

  waterDistAt(x: number, y: number): number {
    return this.sampleNearest(this.waterDist, x, y);
  }

  private sampleNearest(arr: Float32Array, x: number, y: number): number {
    const n = this.res;
    const s = (n - 1) / this.size;
    const i = clamp(Math.round(x * s), 0, n - 1);
    const j = clamp(Math.round(y * s), 0, n - 1);
    return arr[j * n + i];
  }

  /** Gradient of height (dh/dx, dh/dy) in [0,1] per world unit. */
  gradientAt(x: number, y: number, out: { x: number; y: number }): void {
    const e = 1.0;
    out.x = (this.heightAt(x + e, y) - this.heightAt(x - e, y)) / (2 * e);
    out.y = (this.heightAt(x, y + e) - this.heightAt(x, y - e)) / (2 * e);
  }

  inBounds(x: number, y: number, margin = 0): boolean {
    return x >= margin && y >= margin && x <= this.size - margin && y <= this.size - margin;
  }
}
