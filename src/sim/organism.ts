import { Genome } from './genome';
import { SpeciesId } from './species';

export type State = 'wander' | 'seek' | 'eat' | 'flee' | 'chase' | 'rest' | 'digest';
export type DeathCause = 'starved' | 'old age' | 'eaten' | 'cold' | 'heat' | 'fire' | 'drowned' | 'smitten';

export interface LifeEvent {
  t: number;
  text: string;
}

/** One creature. Plain fields for speed; behaviour lives in behavior.ts. */
export class Organism {
  id: number;
  name: string;
  species: SpeciesId;
  genes: Genome;
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  heading: number;
  /** previous tick, for render interpolation */
  px: number;
  py: number;
  pheading: number;
  energy: number;
  maxEnergy: number;
  age = 0;
  lifespan: number;
  maturity = 0; // 0..1
  generation: number;
  parentId: number;
  parentName: string;
  lineageId: number;
  lineageName: string;
  born: number;
  alive = true;
  cause: DeathCause | null = null;

  state: State = 'wander';
  stateTimer = 0;
  targetId = -1;
  /** corpse being scavenged (hunters) */
  targetCorpse: import('./carrion').Corpse | null = null;
  targetX = 0;
  targetY = 0;
  chaseTimer = 0;
  cooldown = 0; // rest after a chase / eat pause
  wanderPhase: number;
  fearMemory = 0; // seconds since a hunter was last seen (decays)
  hunger = 0; // 0..1 cached
  camouflage = 0; // 0..1 cached
  localTemp = 20;
  comfort = 1; // cached temperature cost multiplier
  eatingRate = 0; // energy/s cached for UI
  netEnergyRate = 0; // energy/s cached for UI
  /** cached genes.size * maturity factor, refreshed each tick */
  body = 0.5;
  /** cached social steering (separation/alignment/cohesion), refreshed every few ticks */
  socX = 0;
  socY = 0;
  socPush = 0;
  /** speed actually used this tick (world units/s), for animation */
  moveSpeed = 0;
  desiredSpeed = 0;

  children = 0;
  kills = 0;
  escapes = 0;
  distance = 0;
  log: LifeEvent[] = [];

  constructor(init: {
    id: number;
    name: string;
    species: SpeciesId;
    genes: Genome;
    x: number;
    y: number;
    energy: number;
    maxEnergy: number;
    lifespan: number;
    generation: number;
    parentId: number;
    parentName: string;
    lineageId: number;
    lineageName: string;
    born: number;
    heading: number;
    wanderPhase: number;
  }) {
    this.id = init.id;
    this.name = init.name;
    this.species = init.species;
    this.genes = init.genes;
    this.x = init.x;
    this.y = init.y;
    this.energy = init.energy;
    this.maxEnergy = init.maxEnergy;
    this.lifespan = init.lifespan;
    this.generation = init.generation;
    this.parentId = init.parentId;
    this.parentName = init.parentName;
    this.lineageId = init.lineageId;
    this.lineageName = init.lineageName;
    this.born = init.born;
    this.heading = init.heading;
    this.px = init.x;
    this.py = init.y;
    this.pheading = init.heading;
    this.wanderPhase = init.wanderPhase;
  }

  /** Physical size, grows with maturity. */
  get bodySize(): number {
    return this.body;
  }
  refreshBody(): void {
    this.body = this.genes.size * (0.45 + 0.55 * this.maturity);
  }

  remember(t: number, text: string): void {
    this.log.push({ t, text });
    if (this.log.length > 14) this.log.shift();
  }
}
