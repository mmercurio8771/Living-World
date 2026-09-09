import { Rng, clamp, TAU } from './rng';
import { Terrain, WORLD_SIZE } from './terrain';
import { Climate, DAY_LENGTH } from './climate';
import { Vegetation, BIOMASS_ENERGY } from './vegetation';
import { Genome, initialGenome, mutate } from './genome';
import { Organism, DeathCause } from './organism';
import { SPECIES, SpeciesId, SPECIES_IDS } from './species';
import { SpatialGrid } from './spatialgrid';
import { Behavior, SteerOut } from './behavior';
import { generateName } from './names';
import { Carrion } from './carrion';

export const TICK = 1 / 30; // sim seconds per tick

/** Transient happenings the renderer turns into particles/sound. Cleared every step. */
export interface WorldEffect {
  kind: 'birth' | 'death' | 'kill' | 'escape' | 'spawn' | 'fire' | 'smite';
  x: number;
  y: number;
  species: SpeciesId;
  size: number;
  id?: number;
}

/** Narrative happenings the chronicle records (interventions, arrivals). */
export interface WorldNotice {
  text: string;
  importance: 1 | 2 | 3;
  species?: SpeciesId;
  x?: number;
  y?: number;
  kind: 'arrival' | 'intervention' | 'season';
}

export class World {
  readonly rng: Rng;
  readonly terrain: Terrain;
  readonly climate: Climate;
  readonly vegetation: Vegetation;
  readonly grid: SpatialGrid;
  readonly behavior: Behavior;
  readonly carrion: Carrion;
  organisms: Organism[] = [];
  readonly byId = new Map<number, Organism>();
  counts: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  births: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  deaths: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  deathCauses: Record<DeathCause, number> = { starved: 0, 'old age': 0, eaten: 0, cold: 0, heat: 0, fire: 0, drowned: 0, smitten: 0 };
  effects: WorldEffect[] = [];
  notices: WorldNotice[] = [];
  /** lineage id -> founder name */
  readonly lineageNames = new Map<number, string>();
  readonly lineageCounts = new Map<number, number>();
  oldestEver = 0;
  hunts = 0;
  kills = 0;
  scavenged = 0;
  highestGeneration: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  private nextId = 1;
  private tickCount = 0;
  private lastImmigration: Record<SpeciesId, number> = { grazer: -1e9, hunter: -1e9 };
  private lowSince: Record<SpeciesId, number> = { grazer: -1, hunter: -1 };
  private lastSeason = '';
  private steer: SteerOut = { dirX: 0, dirY: 0, speed: 0 };
  private vegAccum = 0;

  get time(): number {
    return this.climate.time;
  }

  constructor(public readonly seed: number) {
    this.rng = new Rng(seed);
    this.terrain = new Terrain(seed);
    this.climate = new Climate(seed, this.terrain);
    this.vegetation = new Vegetation(this.terrain, this.climate);
    this.grid = new SpatialGrid(WORLD_SIZE, 12);
    this.carrion = new Carrion(this.vegetation);
    this.behavior = new Behavior(seed, this.terrain, this.vegetation, this.climate, this.grid, this.carrion);
    this.lastSeason = this.climate.season;
  }

  /** Populate a fresh world. */
  genesis(grazers = 340, hunters = 30): void {
    this.climate.time = 0.34 * DAY_LENGTH; // start mid-morning
    for (let i = 0; i < grazers; i++) this.spawnRandom('grazer', 0, 0.45);
    for (let i = 0; i < hunters; i++) this.spawnRandom('hunter', 0, 0.5);
  }

  private randomLandPoint(minFertility = 0.25, tries = 200): { x: number; y: number } | null {
    for (let i = 0; i < tries; i++) {
      const x = this.rng.range(6, WORLD_SIZE - 6);
      const y = this.rng.range(6, WORLD_SIZE - 6);
      if (this.terrain.isWater(x, y)) continue;
      if (this.terrain.waterDistAt(x, y) < 3) continue;
      if (this.terrain.fertilityAt(x, y) < minFertility) continue;
      return { x, y };
    }
    return null;
  }

  /** Spawn a creature at a random fertile spot. `genes` overrides the species means. */
  spawnRandom(species: SpeciesId, generation = 0, energyFrac = 0.6, genes?: Partial<Genome>, near?: { x: number; y: number; r: number }): Organism | null {
    let p: { x: number; y: number } | null = null;
    if (near) {
      for (let i = 0; i < 40 && !p; i++) {
        const a = this.rng.range(0, TAU), r = this.rng.range(0, near.r);
        const x = near.x + Math.cos(a) * r, y = near.y + Math.sin(a) * r;
        if (this.terrain.inBounds(x, y, 3) && !this.terrain.isWater(x, y)) p = { x, y };
      }
    }
    if (!p) p = this.randomLandPoint(0.2);
    if (!p) return null;
    const sp = SPECIES[species];
    const g = initialGenome(this.rng, { ...sp.means, ...(genes ?? {}) }, genes ? 0.35 : 1);
    if (genes) for (const k of Object.keys(genes) as (keyof Genome)[]) g[k] = genes[k]!;
    return this.createOrganism(species, g, p.x, p.y, generation, -1, '', energyFrac, true);
  }

  private createOrganism(
    species: SpeciesId,
    genes: Genome,
    x: number,
    y: number,
    generation: number,
    parentId: number,
    parentName: string,
    energyFrac: number,
    adult: boolean,
    lineageId?: number,
    lineageName?: string,
    energyAbs?: number,
  ): Organism {
    const sp = SPECIES[species];
    const id = this.nextId++;
    const name = generateName(this.rng);
    const lineage = lineageId ?? id;
    const lname = lineageName ?? name;
    if (lineageId === undefined) this.lineageNames.set(id, name);
    const maturity = adult ? this.rng.range(0.6, 1) : 0;
    const bodySize = genes.size * (0.45 + 0.55 * maturity);
    const maxEnergy = 100 * bodySize;
    const o = new Organism({
      id,
      name,
      species,
      genes,
      x,
      y,
      energy: energyAbs !== undefined ? Math.min(energyAbs, maxEnergy) : maxEnergy * energyFrac,
      maxEnergy,
      lifespan: sp.lifespan * (0.72 + 0.32 * genes.size) * this.rng.range(0.85, 1.15),
      generation,
      parentId,
      parentName,
      lineageId: lineage,
      lineageName: lname,
      born: this.time,
      heading: this.rng.range(0, TAU),
      wanderPhase: this.rng.range(0, 1000),
    });
    o.maturity = maturity;
    o.refreshBody();
    if (adult) o.age = maturity * sp.maturation * (0.7 + 0.3 * genes.size);
    this.organisms.push(o);
    this.byId.set(id, o);
    this.counts[species]++;
    this.lineageCounts.set(lineage, (this.lineageCounts.get(lineage) ?? 0) + 1);
    if (generation > this.highestGeneration[species]) this.highestGeneration[species] = generation;
    return o;
  }

  /** A group of newcomers arriving from the edge of the world. */
  introduce(species: SpeciesId, n: number, genes?: Partial<Genome>, reason = 'released'): Organism[] {
    const out: Organism[] = [];
    const centre = this.randomLandPoint(0.3) ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    for (let i = 0; i < n; i++) {
      const o = this.spawnRandom(species, 0, 0.7, genes, { x: centre.x, y: centre.y, r: 6 });
      if (o) {
        o.remember(this.time, reason === 'released' ? 'Released into the world' : 'Arrived from across the water');
        out.push(o);
        this.effects.push({ kind: 'spawn', x: o.x, y: o.y, species, size: o.bodySize, id: o.id });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ player interventions
  blight(fraction: number): void {
    this.vegetation.blight(fraction);
    this.notices.push({ text: `A blight withered ${Math.round(fraction * 100)}% of the vegetation`, importance: 2, kind: 'intervention' });
  }
  drought(): void {
    this.climate.droughtPressure = 1;
    this.notices.push({ text: 'A drought has begun. The rains have stopped.', importance: 2, kind: 'intervention' });
  }
  heatwave(): void {
    this.climate.heatPressure = 14;
    this.notices.push({ text: 'A heatwave settles over the island', importance: 2, kind: 'intervention' });
  }
  coldSnap(): void {
    this.climate.heatPressure = -16;
    this.notices.push({ text: 'A bitter cold snap sweeps in from the north', importance: 2, kind: 'intervention' });
  }
  wildfire(x: number, y: number, radius = 22): void {
    this.vegetation.burn(x, y, radius);
    let killed = 0;
    for (const o of this.organisms) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < radius * 0.7 && this.rng.chance(0.55 * (1 - d / (radius * 0.7)) + 0.2)) {
        this.kill(o, 'fire');
        killed++;
      }
    }
    this.effects.push({ kind: 'fire', x, y, species: 'grazer', size: radius });
    this.notices.push({ text: `Wildfire! ${killed} creatures perished in the flames`, importance: 2, kind: 'intervention', x, y });
  }
  smite(id: number): void {
    const o = this.byId.get(id);
    if (!o || !o.alive) return;
    this.kill(o, 'smitten');
    this.effects.push({ kind: 'smite', x: o.x, y: o.y, species: o.species, size: o.bodySize });
  }
  releaseGrazers(n = 40): void {
    this.introduce('grazer', n);
    this.notices.push({ text: `${n} grazers were released into the wild`, importance: 1, kind: 'intervention', species: 'grazer' });
  }
  releaseHunters(n = 8, fast = false): void {
    const group = this.introduce('hunter', n, fast ? { speed: 1.75, vision: 1.3, size: 1.15, hue: 300 } : undefined);
    this.notices.push({
      text: fast ? `${n} unusually fast hunters have been introduced` : `${n} hunters were released into the wild`,
      importance: 2,
      kind: 'intervention',
      species: 'hunter',
      x: group[0]?.x,
      y: group[0]?.y,
    });
  }

  // ------------------------------------------------------------------ stepping
  step(dt = TICK): void {
    this.tickCount++;
    this.effects.length = 0;
    const t = this.time;
    this.climate.step(dt);

    // vegetation runs at 1/4 rate with 4x dt (smooth enough, 4x cheaper)
    this.vegAccum += dt;
    if (this.tickCount % 4 === 0) {
      this.vegetation.step(this.vegAccum);
      this.carrion.step(this.vegAccum);
      this.vegAccum = 0;
    }

    // rebuild spatial index
    this.grid.clear();
    const orgs = this.organisms;
    for (let i = 0; i < orgs.length; i++) if (orgs[i].alive) this.grid.insert(orgs[i]);

    const mutationRate = this.climate.settings.mutationRate;
    const steer = this.steer;
    const decideEvery = 3; // ticks (0.1s)

    for (let i = 0; i < orgs.length; i++) {
      const o = orgs[i];
      if (!o.alive) continue;
      const sp = SPECIES[o.species];

      o.px = o.x;
      o.py = o.y;
      o.pheading = o.heading;
      // ---- growth & ageing
      o.age += dt;
      const matTime = sp.maturation * (0.7 + 0.3 * o.genes.size);
      if (o.maturity < 1) {
        o.maturity = Math.min(1, o.age / matTime);
        o.refreshBody();
        o.maxEnergy = 100 * o.body;
      }
      if (o.cooldown > 0) o.cooldown -= dt;
      if (o.fearMemory > 0) o.fearMemory -= dt;
      if (o.state === 'chase') o.chaseTimer -= dt;

      // ---- local climate (cheap sample, staggered)
      if ((this.tickCount + o.id) % 15 === 0) {
        o.localTemp = this.climate.temperatureAt(o.x, o.y);
        const dT = (o.localTemp - o.genes.tempPref) / 10;
        // Bergmann's rule: big bodies hold their heat; small ones feel every degree
        o.comfort = clamp(1 + (0.38 * dT * dT) / Math.pow(o.genes.size, 0.6), 1, 2.8);
      }
      o.hunger = 1 - o.energy / o.maxEnergy;

      // ---- decide (staggered)
      if ((this.tickCount + o.id) % decideEvery === 0) this.behavior.decide(o, t, this.byId);

      // ---- steer & move
      this.behavior.steer(o, t, this.tickCount, steer);
      const accel = (9 + 6 / o.bodySize) * dt;
      const tvx = steer.dirX * steer.speed, tvy = steer.dirY * steer.speed;
      let ddx = tvx - o.vx, ddy = tvy - o.vy;
      const dl = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dl > accel) {
        ddx *= accel / dl;
        ddy *= accel / dl;
      }
      o.vx += ddx;
      o.vy += ddy;
      const spd = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
      o.moveSpeed = spd;
      o.desiredSpeed = steer.speed;
      if (spd > 0.05) {
        // turn smoothly toward velocity
        const want = Math.atan2(o.vy, o.vx);
        let da = want - o.heading;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const turn = (4 + 3 * spd / (sp.baseSpeed * o.genes.speed)) * dt;
        o.heading += clamp(da, -turn, turn);
      }
      let nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
      if (nx < 1 || ny < 1 || nx > WORLD_SIZE - 1 || ny > WORLD_SIZE - 1 || this.terrain.isWater(nx, ny)) {
        // refuse to enter water; kill the velocity and let steering redirect
        o.vx *= -0.3;
        o.vy *= -0.3;
        o.wanderPhase += 1.3;
        nx = o.x;
        ny = o.y;
      }
      o.distance += spd * dt;
      o.x = nx;
      o.y = ny;

      // ---- energy
      const body = o.bodySize;
      const basal =
        sp.basalCost * Math.pow(body, 0.75) * o.comfort * (o.state === 'rest' || o.state === 'digest' ? 0.55 : 1) * (0.6 + 0.4 * o.maturity);
      const move = 0.045 * body * spd * spd;
      const sense = 0.1 * o.genes.vision * o.genes.vision;
      let gain = 0;
      if (o.state === 'eat' && o.species === 'grazer') {
        const b = this.vegetation.biomassAt(o.x, o.y);
        const rate = 4.7 * Math.pow(body, 0.75) * (b / (b + 0.12));
        const want = Math.min(rate * dt, (o.maxEnergy - o.energy) * 0.999);
        const taken = this.vegetation.eatAt(o.x, o.y, Math.max(0, want) / BIOMASS_ENERGY);
        gain = taken * BIOMASS_ENERGY;
        o.eatingRate = gain / dt;
      } else if (o.state === 'eat' && o.species === 'hunter' && o.targetCorpse && o.targetCorpse.alive) {
        const c = o.targetCorpse;
        const rate = 9 * Math.pow(body, 0.75);
        const want = Math.min(rate * dt, (o.maxEnergy - o.energy) * 0.999, c.meat);
        c.meat -= Math.max(0, want);
        gain = Math.max(0, want);
        this.scavenged += gain;
        o.eatingRate = gain / dt;
        if (c.meat <= 0.5) c.alive = false;
      } else {
        o.eatingRate = 0;
      }
      const cost = (basal + move + sense) * dt;
      o.energy += gain - cost;
      o.netEnergyRate = (gain - cost) / dt;

      // ---- hunters: resolve attacks
      if (o.species === 'hunter' && o.state === 'chase' && o.cooldown <= 0) {
        const prey = this.byId.get(o.targetId);
        if (prey && prey.alive) {
          const dx = prey.x - o.x, dy = prey.y - o.y;
          const reach = 0.9 + 0.55 * (o.bodySize + prey.bodySize);
          if (dx * dx + dy * dy < reach * reach) {
            this.resolveAttack(o, prey);
          }
        }
      }

      // ---- reproduction
      if (
        o.maturity >= 1 &&
        o.cooldown <= 0 &&
        o.energy >= o.genes.reproThreshold * o.maxEnergy &&
        o.state !== 'flee' &&
        o.state !== 'chase' &&
        this.counts[o.species] < sp.maxPopulation
      ) {
        this.reproduce(o, mutationRate);
      }

      // ---- death
      if (o.energy <= 0) {
        const cause: DeathCause = o.comfort > 1.9 ? (o.localTemp < o.genes.tempPref ? 'cold' : 'heat') : 'starved';
        this.kill(o, cause);
      } else if (o.age > o.lifespan) {
        this.kill(o, 'old age');
      }
      if (o.age > this.oldestEver) this.oldestEver = o.age;
    }

    // compact the dead out of the array every few seconds
    if (this.tickCount % 60 === 0) {
      let w = 0;
      for (let i = 0; i < orgs.length; i++) {
        const o = orgs[i];
        if (o.alive) orgs[w++] = o;
        else this.byId.delete(o.id);
      }
      orgs.length = w;
    }

    // season notices
    const season = this.climate.season;
    if (season !== this.lastSeason) {
      this.lastSeason = season;
      const text = { spring: 'Spring returns. The island greens.', summer: 'Summer. Long days and warm nights.', autumn: 'Autumn. The light turns gold.', winter: 'Winter closes in.' }[season];
      this.notices.push({ text, importance: 1, kind: 'season' });
    }

    this.checkImmigration();
  }

  private resolveAttack(h: Organism, prey: Organism): void {
    const hSpeed = SPECIES.hunter.baseSpeed * h.genes.speed;
    const pSpeed = SPECIES.grazer.baseSpeed * prey.genes.speed * (0.55 + 0.45 * prey.maturity);
    const speedEdge = (hSpeed - pSpeed) / pSpeed; // -0.5 .. +1
    const sizeEdge = h.bodySize / prey.bodySize - 1;
    let p = 0.27 + 0.4 * speedEdge + 0.12 * sizeEdge;
    if (prey.state === 'rest' || prey.state === 'eat') p += 0.25; // ambush
    p = clamp(p, 0.05, 0.85);
    this.hunts++;
    if (this.rng.chance(p)) {
      this.kills++;
      const meat = 0.6 * Math.max(0, prey.energy) + 46 * prey.bodySize;
      // a mother shares the kill with cubs nearby
      let cubs = 0;
      for (const c of this.organisms) {
        if (!c.alive || c.parentId !== h.id || c.maturity >= 1) continue;
        if (Math.abs(c.x - h.x) < 12 && Math.abs(c.y - h.y) < 12) cubs++;
      }
      let own = meat;
      if (cubs > 0) {
        const share = meat * 0.5;
        own = meat - share;
        for (const c of this.organisms) {
          if (!c.alive || c.parentId !== h.id || c.maturity >= 1) continue;
          if (Math.abs(c.x - h.x) < 12 && Math.abs(c.y - h.y) < 12) c.energy = Math.min(c.maxEnergy, c.energy + share / cubs);
        }
      }
      const eaten = Math.min(own, h.maxEnergy - h.energy);
      h.energy += eaten;
      // what the hunter can't finish stays as carrion
      if (own - eaten > 6) this.carrion.add(prey.x, prey.y, own - eaten, prey.bodySize, 'grazer');
      h.kills++;
      h.remember(this.time, `Caught ${prey.name}`);
      prey.remember(this.time, `Caught by ${h.name}`);
      this.kill(prey, 'eaten', h);
      h.state = 'digest';
      h.cooldown = 7 + 3 * prey.bodySize;
      h.targetId = -1;
      this.effects.push({ kind: 'kill', x: prey.x, y: prey.y, species: 'grazer', size: prey.bodySize, id: prey.id });
    } else {
      // the prey slips away; both pay
      h.cooldown = 1.1;
      h.chaseTimer -= 1.2;
      prey.escapes++;
      prey.energy -= 1.5;
      prey.fearMemory = 3;
      prey.state = 'flee';
      prey.targetX = prey.x + (prey.x - h.x) * 4;
      prey.targetY = prey.y + (prey.y - h.y) * 4;
      if (prey.escapes <= 3) prey.remember(this.time, `Escaped ${h.name}`);
      this.effects.push({ kind: 'escape', x: prey.x, y: prey.y, species: 'grazer', size: prey.bodySize, id: prey.id });
    }
  }

  private reproduce(o: Organism, mutationRate: number): void {
    const litter = clamp(Math.round(o.genes.litterSize + this.rng.range(-0.3, 0.3)), 1, 4);
    const invest = 0.5 * o.maxEnergy;
    o.energy -= invest;
    o.cooldown = 26 + 8 * litter;
    const perChild = (invest / litter) * 0.9;
    for (let i = 0; i < litter; i++) {
      if (this.counts[o.species] >= SPECIES[o.species].maxPopulation) break;
      const genes = mutate(o.genes, this.rng, mutationRate);
      const a = this.rng.range(0, TAU);
      let cx = o.x + Math.cos(a) * 1.2, cy = o.y + Math.sin(a) * 1.2;
      if (this.terrain.isWater(cx, cy) || !this.terrain.inBounds(cx, cy, 1)) {
        cx = o.x;
        cy = o.y;
      }
      const child = this.createOrganism(
        o.species,
        genes,
        cx,
        cy,
        o.generation + 1,
        o.id,
        o.name,
        0,
        false,
        o.lineageId,
        o.lineageName,
        perChild,
      );
      child.heading = o.heading + this.rng.range(-1, 1);
      child.remember(this.time, `Born to ${o.name}`);
      this.births[o.species]++;
      this.effects.push({ kind: 'birth', x: cx, y: cy, species: o.species, size: child.bodySize, id: child.id });
    }
    o.children += litter;
    if (o.children <= 4 || o.children % 4 === 0) o.remember(this.time, litter === 1 ? 'Gave birth to a single young' : `Gave birth to ${litter} young`);
  }

  private kill(o: Organism, cause: DeathCause, by?: Organism): void {
    if (!o.alive) return;
    o.alive = false;
    o.cause = cause;
    this.counts[o.species]--;
    this.deaths[o.species]++;
    this.deathCauses[cause]++;
    const lc = (this.lineageCounts.get(o.lineageId) ?? 1) - 1;
    if (lc <= 0) this.lineageCounts.delete(o.lineageId);
    else this.lineageCounts.set(o.lineageId, lc);
    // what the earth takes back: a body, then nutrients
    if (cause === 'eaten' || cause === 'fire') this.vegetation.addNutrients(o.x, o.y, 0.3 * o.bodySize);
    else this.carrion.add(o.x, o.y, 26 * o.bodySize + 0.3 * Math.max(0, o.energy), o.bodySize, o.species);
    if (cause !== 'eaten') this.effects.push({ kind: 'death', x: o.x, y: o.y, species: o.species, size: o.bodySize, id: o.id });
  }

  private checkImmigration(): void {
    if (!this.climate.settings.migration) return;
    if (this.tickCount % 30 !== 0) return;
    const t = this.time;
    for (const sid of SPECIES_IDS) {
      const c = this.counts[sid];
      const threshold = sid === 'grazer' ? 6 : 3;
      if (c < threshold) {
        if (this.lowSince[sid] < 0) this.lowSince[sid] = t;
        const waited = t - this.lowSince[sid];
        const wait = sid === 'grazer' ? 45 : 110;
        if (waited > wait && t - this.lastImmigration[sid] > 200) {
          this.lastImmigration[sid] = t;
          this.lowSince[sid] = -1;
          const n = sid === 'grazer' ? this.rng.int(8, 14) : this.rng.int(3, 5);
          const group = this.introduce(sid, n, undefined, 'arrived');
          this.notices.push({
            text: `A small band of ${SPECIES[sid].plural.toLowerCase()} has arrived from across the water`,
            importance: 2,
            kind: 'arrival',
            species: sid,
            x: group[0]?.x,
            y: group[0]?.y,
          });
        }
      } else {
        this.lowSince[sid] = -1;
      }
    }
  }

  /** Alive organisms only (the array may hold recently dead ones until compaction). */
  *alive(): IterableIterator<Organism> {
    for (const o of this.organisms) if (o.alive) yield o;
  }
}
