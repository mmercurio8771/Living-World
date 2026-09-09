import { Terrain, WORLD_SIZE } from './terrain';
import { Climate } from './climate';
import { clamp } from './rng';

export const VEG_RES = 128; // cells per side
export const VEG_CELL = WORLD_SIZE / VEG_RES; // world units per cell
/** How much creature energy a full unit of biomass is worth. */
export const BIOMASS_ENERGY = 60;

/**
 * Primary production. A grid of biomass that grows logistically with light,
 * warmth and water, spreads into empty neighbours, and gets eaten.
 */
export class Vegetation {
  readonly res = VEG_RES;
  readonly biomass: Float32Array; // 0..capacity
  readonly capacity: Float32Array; // baked from terrain fertility
  readonly nutrients: Float32Array; // transient boost from decay, 0..1
  readonly cellTemp: Float32Array; // cached local temperature
  /** Total biomass, refreshed every step. */
  total = 0;
  totalCapacity = 0;
  /** Player-imposed blight: fraction of each cell eaten by the "blight" event; decays. */
  private tick = 0;
  private lastGrowth = 0;

  constructor(private terrain: Terrain, private climate: Climate) {
    const n = this.res;
    this.biomass = new Float32Array(n * n);
    this.capacity = new Float32Array(n * n);
    this.nutrients = new Float32Array(n * n);
    this.cellTemp = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * VEG_CELL;
        const y = (j + 0.5) * VEG_CELL;
        const f = terrain.fertilityAt(x, y);
        const k = j * n + i;
        this.capacity[k] = f;
        this.biomass[k] = f * (0.55 + 0.35 * Math.sin(i * 0.37 + j * 0.51) * Math.cos(j * 0.23));
        this.totalCapacity += f;
      }
    }
    this.refreshTemperatures();
    this.total = this.sum();
  }

  cellIndexAt(x: number, y: number): number {
    const i = clamp((x / VEG_CELL) | 0, 0, this.res - 1);
    const j = clamp((y / VEG_CELL) | 0, 0, this.res - 1);
    return j * this.res + i;
  }

  biomassAt(x: number, y: number): number {
    return this.biomass[this.cellIndexAt(x, y)];
  }

  /** Remove up to `amount` biomass at a position; returns what was actually taken. */
  eatAt(x: number, y: number, amount: number): number {
    const k = this.cellIndexAt(x, y);
    const b = this.biomass[k];
    const take = Math.min(b, amount);
    this.biomass[k] = b - take;
    return take;
  }

  /** Decay of a corpse fertilises the soil. */
  addNutrients(x: number, y: number, amount: number): void {
    const n = this.res;
    const ci = clamp((x / VEG_CELL) | 0, 0, n - 1);
    const cj = clamp((y / VEG_CELL) | 0, 0, n - 1);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const w = di === 0 && dj === 0 ? 0.5 : 0.0625;
        const k = j * n + i;
        this.nutrients[k] = Math.min(1, this.nutrients[k] + amount * w);
      }
    }
  }

  /** Player event: destroy a fraction of all vegetation. */
  blight(fraction: number): void {
    for (let k = 0; k < this.biomass.length; k++) this.biomass[k] *= 1 - fraction;
    this.total = this.sum();
  }

  /** Player event: wildfire in a radius — burns biomass, leaves nutrients. */
  burn(x: number, y: number, radius: number): void {
    const n = this.res;
    const r2 = radius * radius;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const cx = (i + 0.5) * VEG_CELL - x;
        const cy = (j + 0.5) * VEG_CELL - y;
        const d2 = cx * cx + cy * cy;
        if (d2 < r2) {
          const k = j * n + i;
          const f = 1 - d2 / r2;
          this.nutrients[k] = Math.min(1, this.nutrients[k] + this.biomass[k] * 0.3);
          this.biomass[k] *= 1 - f * 0.95;
        }
      }
    }
    this.total = this.sum();
  }

  refreshTemperatures(): void {
    const n = this.res;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.cellTemp[j * n + i] = this.climate.temperatureAt((i + 0.5) * VEG_CELL, (j + 0.5) * VEG_CELL);
      }
    }
  }

  /** Grow. Called with the accumulated dt (we run vegetation at a lower rate than creatures). */
  step(dt: number): void {
    this.tick++;
    if (this.tick % 8 === 0) this.refreshTemperatures();
    const n = this.res;
    const light = this.climate.plantLight;
    const moisture = this.climate.moistureFactor;
    const r = 0.11 * this.climate.settings.growthRate;
    const B = this.biomass;
    const K = this.capacity;
    const N = this.nutrients;
    const T = this.cellTemp;
    let total = 0;
    const nutDecay = Math.exp(-dt / 60);
    // pull the growth factor out of the loop where possible
    const lightMoist = r * dt * (0.15 + 0.85 * light) * moisture;
    for (let j = 0; j < n; j++) {
      const row = j * n;
      for (let i = 0; i < n; i++) {
        const k = row + i;
        const cap = K[k] * (1 + 0.6 * N[k]);
        if (cap <= 0.001) {
          B[k] = 0;
          continue;
        }
        // temperature response: bell around 21C, nothing much below 2C
        const dT = (T[k] - 21) / 15;
        const tempResp = Math.exp(-dT * dT);
        let b = B[k];
        const g = lightMoist * tempResp;
        // logistic growth + seeding from neighbours
        let neigh = 0;
        if (i > 0) neigh += B[k - 1];
        if (i < n - 1) neigh += B[k + 1];
        if (j > 0) neigh += B[k - n];
        if (j < n - 1) neigh += B[k + n];
        neigh *= 0.25;
        const room = Math.max(0, 1 - b / cap);
        b += g * (b + 0.35 * neigh + 0.004 * cap) * room;
        // dormancy/withering in cold, drought stress in dry
        if (tempResp < 0.15) b -= b * dt * 0.02;
        if (moisture < 0.35) b -= b * dt * 0.03 * (1 - moisture / 0.35);
        if (b > cap) b = cap;
        if (b < 0) b = 0;
        B[k] = b;
        N[k] *= nutDecay;
        total += b;
      }
    }
    this.total = total;
    this.lastGrowth = total;
  }

  private sum(): number {
    let s = 0;
    for (let k = 0; k < this.biomass.length; k++) s += this.biomass[k];
    return s;
  }

  /** 0..1 greenness relative to capacity, for the world's "health". */
  get fraction(): number {
    return this.totalCapacity > 0 ? this.total / this.totalCapacity : 0;
  }
}
