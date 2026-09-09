import { Rng, clamp } from './rng';

/**
 * Heritable traits. Every gene has a real cost or trade-off in the rules,
 * so selection has something to push against.
 */
export interface Genome {
  size: number; // 0.5..2.4  bigger: more storage, stronger, costlier, more visible
  speed: number; // 0.5..2.0  faster: catches/escapes, movement costs ~speed^2
  vision: number; // 0.4..2.0  sees further, small upkeep cost
  boldness: number; // 0..1     grazers: how close a hunter may come; hunters: chase persistence
  reproThreshold: number; // 0.5..0.95 energy fraction required to breed
  litterSize: number; // 1..4  offspring per birth; the energy is split between them
  tempPref: number; // 0..34 °C preferred temperature; mismatch costs energy
  hue: number; // 0..360 body colour; camouflage against the ground
  pattern: number; // 0..1 markings intensity (visual, drifts neutrally)
}

export type GeneKey = keyof Genome;

export interface GeneSpec {
  key: GeneKey;
  label: string;
  min: number;
  max: number;
  /** mutation step (sd of gaussian) */
  step: number;
  circular?: boolean;
  format: (v: number) => string;
}

export const GENE_SPECS: GeneSpec[] = [
  { key: 'size', label: 'Size', min: 0.5, max: 2.4, step: 0.08, format: (v) => v.toFixed(2) },
  { key: 'speed', label: 'Speed', min: 0.5, max: 2.0, step: 0.08, format: (v) => v.toFixed(2) },
  { key: 'vision', label: 'Vision', min: 0.4, max: 2.0, step: 0.08, format: (v) => v.toFixed(2) },
  { key: 'boldness', label: 'Boldness', min: 0, max: 1, step: 0.07, format: (v) => Math.round(v * 100) + '%' },
  { key: 'reproThreshold', label: 'Breeding threshold', min: 0.5, max: 0.95, step: 0.04, format: (v) => Math.round(v * 100) + '%' },
  { key: 'litterSize', label: 'Litter size', min: 1, max: 4, step: 0.3, format: (v) => v.toFixed(1) },
  { key: 'tempPref', label: 'Preferred temp', min: 0, max: 34, step: 1.6, format: (v) => v.toFixed(0) + '°' },
  { key: 'hue', label: 'Hue', min: 0, max: 360, step: 14, circular: true, format: (v) => Math.round(v) + '°' },
  { key: 'pattern', label: 'Markings', min: 0, max: 1, step: 0.08, format: (v) => Math.round(v * 100) + '%' },
];

export const GENE_KEYS: GeneKey[] = GENE_SPECS.map((g) => g.key);

export function cloneGenome(g: Genome): Genome {
  return { ...g };
}

/** Copy with mutation. `rate` multiplies the per-gene mutation probability. */
export function mutate(g: Genome, rng: Rng, rate: number): Genome {
  const out = cloneGenome(g);
  const p = clamp(0.22 * rate, 0, 1);
  for (const spec of GENE_SPECS) {
    if (!rng.chance(p)) continue;
    // occasional larger jumps keep the population exploring
    const big = rng.chance(0.08) ? 3 : 1;
    let v = out[spec.key] + rng.gauss() * spec.step * big;
    if (spec.circular) {
      v = ((v % spec.max) + spec.max) % spec.max;
    } else {
      v = clamp(v, spec.min, spec.max);
    }
    out[spec.key] = v;
  }
  return out;
}

/** Random genome around a species' starting means. */
export function initialGenome(rng: Rng, means: Genome, spread = 1): Genome {
  const g = cloneGenome(means);
  for (const spec of GENE_SPECS) {
    // colour starts fairly uniform so that later drift is visible as a change
    let v = means[spec.key] + rng.gauss() * spec.step * (spec.circular ? 0.9 : 1.6) * spread;
    if (spec.circular) v = ((v % spec.max) + spec.max) % spec.max;
    else v = clamp(v, spec.min, spec.max);
    g[spec.key] = v;
  }
  return g;
}

/** Shortest angular distance between hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
