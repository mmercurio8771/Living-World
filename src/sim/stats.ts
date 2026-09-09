import { World } from './world';
import { GENE_KEYS, GeneKey, Genome } from './genome';
import { SpeciesId, SPECIES_IDS } from './species';

export interface SpeciesSample {
  count: number;
  births: number;
  deaths: number;
  avg: Genome;
  sd: Genome;
  avgGeneration: number;
  maxGeneration: number;
  avgEnergy: number;
  avgAge: number;
}

export interface Sample {
  t: number;
  vegetation: number; // fraction of capacity
  temperature: number;
  species: Record<SpeciesId, SpeciesSample>;
}

const zeroGenome = (): Genome => ({ size: 0, speed: 0, vision: 0, boldness: 0, reproThreshold: 0, litterSize: 0, tempPref: 0, hue: 0, pattern: 0 });

export const SAMPLE_INTERVAL = 2; // sim seconds
export const HISTORY_LENGTH = 900; // samples kept (30 sim-minutes)

/** Periodically measures the world. Everything the UI charts comes from here. */
export class Stats {
  samples: Sample[] = [];
  latest: Sample | null = null;
  private lastSampleTime = -1e9;
  private lastBirths: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  private lastDeaths: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  /** the very first sample, to measure drift against */
  baseline: Sample | null = null;

  constructor(private world: World) {}

  update(force = false): Sample | null {
    const t = this.world.time;
    if (!force && t - this.lastSampleTime < SAMPLE_INTERVAL) return null;
    this.lastSampleTime = t;
    const s = this.measure();
    this.samples.push(s);
    if (this.samples.length > HISTORY_LENGTH) this.samples.shift();
    this.latest = s;
    if (!this.baseline) this.baseline = s;
    return s;
  }

  measure(): Sample {
    const w = this.world;
    const species = {} as Record<SpeciesId, SpeciesSample>;
    const sums: Record<SpeciesId, Genome> = { grazer: zeroGenome(), hunter: zeroGenome() };
    const sq: Record<SpeciesId, Genome> = { grazer: zeroGenome(), hunter: zeroGenome() };
    const hueX: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const hueY: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const n: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const gen: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const maxGen: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const energy: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    const age: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
    for (const o of w.organisms) {
      if (!o.alive) continue;
      const s = o.species;
      n[s]++;
      const g = o.genes;
      const S = sums[s], Q = sq[s];
      for (const k of GENE_KEYS) {
        if (k === 'hue') continue;
        S[k] += g[k];
        Q[k] += g[k] * g[k];
      }
      const hr = (g.hue * Math.PI) / 180;
      hueX[s] += Math.cos(hr);
      hueY[s] += Math.sin(hr);
      gen[s] += o.generation;
      if (o.generation > maxGen[s]) maxGen[s] = o.generation;
      energy[s] += o.energy / o.maxEnergy;
      age[s] += o.age;
    }
    for (const s of SPECIES_IDS) {
      const c = n[s];
      const avg = zeroGenome();
      const sd = zeroGenome();
      if (c > 0) {
        for (const k of GENE_KEYS) {
          if (k === 'hue') continue;
          avg[k] = sums[s][k] / c;
          sd[k] = Math.sqrt(Math.max(0, sq[s][k] / c - avg[k] * avg[k]));
        }
        let h = (Math.atan2(hueY[s], hueX[s]) * 180) / Math.PI;
        if (h < 0) h += 360;
        avg.hue = h;
        // circular spread: 1 - resultant length, scaled to degrees-ish
        sd.hue = (1 - Math.hypot(hueX[s], hueY[s]) / c) * 180;
      }
      species[s] = {
        count: c,
        births: w.births[s] - this.lastBirths[s],
        deaths: w.deaths[s] - this.lastDeaths[s],
        avg,
        sd,
        avgGeneration: c > 0 ? gen[s] / c : 0,
        maxGeneration: maxGen[s],
        avgEnergy: c > 0 ? energy[s] / c : 0,
        avgAge: c > 0 ? age[s] / c : 0,
      };
      this.lastBirths[s] = w.births[s];
      this.lastDeaths[s] = w.deaths[s];
    }
    return {
      t: w.time,
      vegetation: w.vegetation.fraction,
      temperature: w.climate.baseTemperature,
      species,
    };
  }

  /** Sample closest to `secondsAgo` in the past. */
  ago(secondsAgo: number): Sample | null {
    if (this.samples.length === 0) return null;
    const target = this.world.time - secondsAgo;
    let best = this.samples[0];
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].t <= target) {
        best = this.samples[i];
        break;
      }
    }
    return best;
  }

  /** Where an individual's trait sits in its species' distribution, as -1..1 (± 2 sd clamps). */
  percentile(species: SpeciesId, key: GeneKey, value: number): number {
    const s = this.latest?.species[species];
    if (!s || s.count < 2) return 0;
    if (key === 'hue') return 0;
    const sd = s.sd[key] || 1e-6;
    const z = (value - s.avg[key]) / sd;
    return Math.max(-1, Math.min(1, z / 2));
  }
}
