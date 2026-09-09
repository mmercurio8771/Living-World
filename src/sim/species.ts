import { Genome } from './genome';

export type SpeciesId = 'grazer' | 'hunter';
export const SPECIES_IDS: SpeciesId[] = ['grazer', 'hunter'];

export interface SpeciesDef {
  id: SpeciesId;
  name: string; // "Grazer"
  plural: string; // "Grazers"
  diet: 'plants' | 'meat';
  baseVision: number; // world units at vision gene = 1
  baseSpeed: number; // units/s at speed gene = 1
  basalCost: number; // energy/s at size 1
  maturation: number; // seconds to adulthood at size 1
  lifespan: number; // seconds at size 1
  means: Genome; // starting gene means
  /** hard cap to keep the renderer/CPU comfortable */
  maxPopulation: number;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  grazer: {
    id: 'grazer',
    name: 'Grazer',
    plural: 'Grazers',
    diet: 'plants',
    baseVision: 15,
    baseSpeed: 5.2,
    basalCost: 0.95,
    maturation: 34,
    lifespan: 210,
    means: {
      size: 0.9,
      speed: 1.0,
      vision: 1.0,
      boldness: 0.4,
      reproThreshold: 0.72,
      litterSize: 2,
      tempPref: 19,
      hue: 34,
      pattern: 0.3,
    },
    maxPopulation: 2500,
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    plural: 'Hunters',
    diet: 'meat',
    baseVision: 22,
    baseSpeed: 5.6,
    basalCost: 1.0,
    maturation: 34,
    lifespan: 250,
    means: {
      size: 1.25,
      speed: 1.05,
      vision: 1.0,
      boldness: 0.5,
      reproThreshold: 0.78,
      litterSize: 1.6,
      tempPref: 18,
      hue: 18,
      pattern: 0.4,
    },
    maxPopulation: 600,
  },
};
