import { Organism } from './organism';
import { SPECIES } from './species';
import { hueDistance } from './genome';
import { Terrain } from './terrain';
import { Vegetation, VEG_CELL } from './vegetation';
import { Climate } from './climate';
import { SpatialGrid } from './spatialgrid';
import { Carrion } from './carrion';
import { SimplexNoise } from './noise';
import { clamp, TAU } from './rng';

/** Ground colour hue at a point: dry earth (~35°) when barren, leafy (~100°) when lush. */
export function groundHue(veg: Vegetation, x: number, y: number): number {
  const k = veg.cellIndexAt(x, y);
  const cap = veg.capacity[k];
  const g = cap > 0.01 ? veg.biomass[k] / cap : 0;
  return 35 + 70 * g;
}

/** 0..1, how well a creature's colour matches the ground it stands on. */
export function camouflageOf(o: Organism, veg: Vegetation): number {
  const d = hueDistance(o.genes.hue, groundHue(veg, o.x, o.y));
  const match = 1 - clamp(d / 110, 0, 1);
  return match * match;
}

/** Range at which `viewer` can notice `target`. */
export function detectionRange(viewer: Organism, target: Organism): number {
  const base = SPECIES[viewer.species].baseVision * viewer.genes.vision;
  const camo = 1 - 0.6 * target.camouflage;
  const sizeVis = 0.75 + 0.25 * target.bodySize;
  return base * camo * sizeVis;
}

export interface SteerOut {
  dirX: number;
  dirY: number;
  speed: number; // desired speed, world units / s
}

const tmpGrad = { x: 0, y: 0 };

export class Behavior {
  private wanderNoise: SimplexNoise;
  constructor(
    seed: number,
    private terrain: Terrain,
    private veg: Vegetation,
    private climate: Climate,
    private grid: SpatialGrid,
    private carrion: Carrion,
  ) {
    this.wanderNoise = new SimplexNoise(seed ^ 0x5eed);
  }

  /**
   * Perception + decision. Runs every ~0.1s per creature, staggered.
   * Sets o.state / o.target*. Returns nothing; steer() reads the result each tick.
   */
  decide(o: Organism, t: number, byId: Map<number, Organism>): void {
    const sp = SPECIES[o.species];
    const hungry = o.hunger;
    const night = this.climate.isNight;
    o.camouflage = camouflageOf(o, this.veg);

    if (o.species === 'grazer') {
      // --- threat scan ---
      let threatX = 0, threatY = 0, threat = 0, nearestD = Infinity;
      const scanR = sp.baseVision * o.genes.vision * 1.05;
      const count = this.grid.collect(o.x, o.y, scanR, this.nb, this.nbD2);
      for (let i = 0; i < count; i++) {
        const h = this.nb[i];
        if (h.species !== 'hunter' || !h.alive) continue;
        if (h.state === 'digest' || h.maturity < 0.35) continue; // sleeping / cubs are not threats
        const range = detectionRange(o, h);
        const d = Math.sqrt(this.nbD2[i]);
        if (d > range) continue;
        const fleeDist = range * (0.3 + 0.7 * (1 - o.genes.boldness));
        if (d < fleeDist || (o.state === 'flee' && d < fleeDist * 1.4)) {
          const w = 1 / (d + 0.5);
          threatX += (o.x - h.x) * w;
          threatY += (o.y - h.y) * w;
          threat += w;
          if (d < nearestD) nearestD = d;
        }
      }
      if (threat > 0) {
        o.state = 'flee';
        o.targetX = o.x + threatX / threat;
        o.targetY = o.y + threatY / threat;
        o.fearMemory = 2.0;
        return;
      }
      if (o.fearMemory > 0 && o.state === 'flee') return; // keep running a moment after losing sight

      // --- feeding ---
      const here = this.veg.biomassAt(o.x, o.y);
      if (hungry > 0.28 || (o.state === 'eat' && hungry > 0.05)) {
        if (here > 0.1) {
          o.state = 'eat';
          return;
        }
        // look for greener pasture around us
        const best = this.findGrazing(o);
        if (best) {
          o.state = 'seek';
          o.targetX = best.x;
          o.targetY = best.y;
          return;
        }
      }
      // --- young stay close to their mother ---
      if (o.maturity < 0.6 && this.followParent(o, byId, 3.5)) return;
      // --- rest at night if not hungry ---
      if (night && hungry < 0.55) {
        o.state = 'rest';
        return;
      }
      o.state = 'wander';
      return;
    }

    // ---------------- hunters ----------------
    if (o.state === 'digest') {
      if (o.cooldown > 0) return;
      o.state = 'wander';
    }
    if (o.state === 'chase') {
      const prey = byId.get(o.targetId);
      if (!prey || !prey.alive || o.chaseTimer <= 0) {
        o.state = 'digest';
        o.cooldown = prey && prey.alive ? 4 : 6; // failed chases leave the hunter winded
        o.targetId = -1;
        return;
      }
      const dx = prey.x - o.x, dy = prey.y - o.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > detectionRange(o, prey) * 1.3) {
        o.state = 'digest';
        o.cooldown = 3;
        o.targetId = -1;
        return;
      }
      o.targetX = prey.x + prey.vx * 0.5; // lead the target a little
      o.targetY = prey.y + prey.vy * 0.5;
      return;
    }
    // scavenging: an easy meal beats a chase
    if (o.state === 'eat' && o.targetCorpse) {
      if (o.targetCorpse.alive && o.targetCorpse.meat > 1 && hungry > 0.05) return;
      o.targetCorpse = null;
      o.state = 'wander';
    }
    if (hungry > 0.2) {
      const range = sp.baseVision * o.genes.vision;
      const corpse = this.carrion.nearest(o.x, o.y, range * 0.9);
      if (corpse) {
        const d = Math.hypot(corpse.x - o.x, corpse.y - o.y);
        o.targetCorpse = corpse;
        o.targetX = corpse.x;
        o.targetY = corpse.y;
        o.state = d < 1.6 ? 'eat' : 'seek';
        return;
      }
    }
    if (hungry > 0.25 && o.maturity > 0.35) {
      const prey = this.findPrey(o);
      if (prey) {
        o.state = 'chase';
        o.targetId = prey.id;
        o.chaseTimer = (5 + 7 * o.genes.boldness) / Math.pow(o.genes.speed, 1.2); // sprinters tire fast
        o.targetX = prey.x;
        o.targetY = prey.y;
        return;
      }
      // hungry but nothing seen: roam wider (cubs stay with mother)
      if (o.maturity < 0.7 && this.followParent(o, byId, 4)) return;
      o.state = 'wander';
      return;
    }
    if (o.maturity < 0.7 && this.followParent(o, byId, 4)) return;
    if (night && hungry < 0.5) {
      o.state = 'rest';
      return;
    }
    o.state = 'wander';
  }

  /** Juveniles trail their parent. Returns true if a follow state was set. */
  private followParent(o: Organism, byId: Map<number, Organism>, keep: number): boolean {
    const parent = byId.get(o.parentId);
    if (!parent || !parent.alive) return false;
    const dx = parent.x - o.x, dy = parent.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 45 * 45) return false; // lost
    if (d2 > keep * keep) {
      o.state = 'seek';
      o.targetX = parent.x - (dx / Math.sqrt(d2)) * keep * 0.6;
      o.targetY = parent.y - (dy / Math.sqrt(d2)) * keep * 0.6;
      o.targetCorpse = null;
      return true;
    }
    // close enough: mirror the parent's rest, else idle
    o.state = parent.state === 'rest' || parent.state === 'digest' ? 'rest' : 'wander';
    return true;
  }

  private findGrazing(o: Organism): { x: number; y: number } | null {
    const range = SPECIES[o.species].baseVision * o.genes.vision;
    let bestScore = 0.12;
    let bx = 0, by = 0, found = false;
    // sample rings of cells around us; prefer near & lush
    const rings = 3;
    const dirs = 10;
    for (let r = 1; r <= rings; r++) {
      const dist = (range * r) / rings;
      const off = (o.id * 0.61 + r * 0.9) % TAU;
      for (let k = 0; k < dirs; k++) {
        const a = off + (k / dirs) * TAU;
        const x = o.x + Math.cos(a) * dist;
        const y = o.y + Math.sin(a) * dist;
        if (!this.terrain.inBounds(x, y, 2)) continue;
        const b = this.veg.biomassAt(x, y);
        if (b < 0.1) continue;
        if (this.terrain.isWater(x, y)) continue;
        const score = b - 0.012 * dist;
        if (score > bestScore) {
          bestScore = score;
          bx = x;
          by = y;
          found = true;
        }
      }
    }
    if (!found) return null;
    // snap into the cell centre with a little jitter so herds don't stack
    const jitter = VEG_CELL * 0.4;
    return { x: bx + (o.wanderPhase % 1 - 0.5) * jitter, y: by + ((o.wanderPhase * 7) % 1 - 0.5) * jitter };
  }

  private findPrey(o: Organism): Organism | null {
    const range = SPECIES[o.species].baseVision * o.genes.vision;
    let best: Organism | null = null;
    let bestScore = -Infinity;
    const count = this.grid.collect(o.x, o.y, range, this.nb, this.nbD2);
    for (let i = 0; i < count; i++) {
      const p = this.nb[i];
      if (p.species !== 'grazer' || !p.alive) continue;
      const d = Math.sqrt(this.nbD2[i]);
      if (d > detectionRange(o, p)) continue;
      // prefer near, small, slow prey; bold hunters accept bigger prey
      const sizeRatio = p.bodySize / o.bodySize;
      if (sizeRatio > 0.9 + 0.9 * o.genes.boldness) continue;
      const speedRatio = (p.genes.speed * SPECIES.grazer.baseSpeed) / (o.genes.speed * SPECIES.hunter.baseSpeed);
      const score = -d * 0.08 - sizeRatio * 0.6 - speedRatio * 0.5 + (p.state === 'rest' || p.state === 'eat' ? 0.5 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private nb: Organism[] = new Array(64);
  private nbD2 = new Float64Array(64);

  private computeSocial(o: Organism): void {
    let sepX = 0, sepY = 0, alX = 0, alY = 0, cohX = 0, cohY = 0, n = 0;
    const herd = o.species === 'grazer' && (o.state === 'wander' || o.state === 'seek' || o.state === 'eat');
    const r = herd ? 7 : 3;
    const count = this.grid.collect(o.x, o.y, r, this.nb, this.nbD2);
    const ob = o.bodySize;
    for (let i = 0; i < count; i++) {
      const p = this.nb[i];
      if (p === o || p.species !== o.species || !p.alive) continue;
      const d = Math.sqrt(this.nbD2[i]) + 1e-3;
      const minD = (ob + p.bodySize) * 1.1;
      if (d < minD) {
        const f = (minD - d) / minD;
        sepX += ((o.x - p.x) / d) * f;
        sepY += ((o.y - p.y) / d) * f;
      }
      if (herd) {
        alX += p.vx;
        alY += p.vy;
        cohX += p.x;
        cohY += p.y;
        n++;
      }
    }
    let fx = sepX * 2.2, fy = sepY * 2.2;
    if (herd && n > 0 && o.state !== 'eat') {
      const al = Math.sqrt(alX * alX + alY * alY);
      if (al > 0.01) {
        fx += (alX / al) * 0.35;
        fy += (alY / al) * 0.35;
      }
      const cx = cohX / n - o.x, cy = cohY / n - o.y;
      const cd = Math.sqrt(cx * cx + cy * cy);
      if (cd > 2.5) {
        fx += (cx / cd) * 0.25;
        fy += (cy / cd) * 0.25;
      }
    }
    o.socX = fx;
    o.socY = fy;
    o.socPush = sepX !== 0 || sepY !== 0 ? 1 : 0;
  }

  /** Turn the current state into a desired velocity. Runs every tick. */
  steer(o: Organism, t: number, tick: number, out: SteerOut): void {
    const sp = SPECIES[o.species];
    const maxSpeed = sp.baseSpeed * o.genes.speed * (0.55 + 0.45 * o.maturity);
    let dx = 0, dy = 0, speed = 0;

    switch (o.state) {
      case 'flee': {
        dx = o.targetX - o.x;
        dy = o.targetY - o.y;
        speed = maxSpeed * 1.12;
        break;
      }
      case 'chase': {
        dx = o.targetX - o.x;
        dy = o.targetY - o.y;
        speed = maxSpeed * 1.38; // sprint: costly, brief
        break;
      }
      case 'seek': {
        dx = o.targetX - o.x;
        dy = o.targetY - o.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        speed = maxSpeed * (d < 3 ? 0.35 : 0.68);
        if (d < 1.2) {
          if (o.species === 'hunter') o.state = o.targetCorpse ? 'eat' : 'wander';
          else o.state = this.veg.biomassAt(o.x, o.y) > 0.08 ? 'eat' : 'wander';
        }
        break;
      }
      case 'eat': {
        if (o.species === 'hunter') {
          speed = 0;
          break;
        }
        // slow shuffle while grazing, drifting with the wander noise
        const a = this.wanderAngle(o, t);
        dx = Math.cos(a);
        dy = Math.sin(a);
        speed = maxSpeed * 0.06;
        break;
      }
      case 'rest':
      case 'digest': {
        speed = 0;
        break;
      }
      default: {
        // wander: noise-driven heading + weak temperature seeking
        const a = this.wanderAngle(o, t);
        dx = Math.cos(a);
        dy = Math.sin(a);
        speed = maxSpeed * (o.species === 'hunter' ? 0.42 : 0.38);
        // barren ground (rock, snow, sand) is nowhere to be: drift back downhill toward pasture
        const aheadFert = this.terrain.fertilityAt(o.x + dx * 6, o.y + dy * 6);
        if (aheadFert < 0.08) {
          this.terrain.gradientAt(o.x, o.y, tmpGrad);
          const gl = Math.hypot(tmpGrad.x, tmpGrad.y);
          if (gl > 1e-4 && this.terrain.heightAt(o.x, o.y) > 0.5) {
            dx -= (tmpGrad.x / gl) * 1.6;
            dy -= (tmpGrad.y / gl) * 1.6;
          } else {
            o.wanderPhase += 0.4;
          }
        }
        if (o.comfort > 1.25) {
          // sample the temperature a few units away in four directions and lean toward comfort
          const pref = o.genes.tempPref;
          let bx = 0, by = 0, bestGain = 0;
          for (let k = 0; k < 4; k++) {
            const ang = (k / 4) * TAU;
            const sx = o.x + Math.cos(ang) * 6, sy = o.y + Math.sin(ang) * 6;
            if (!this.terrain.inBounds(sx, sy, 2) || this.terrain.isWater(sx, sy)) continue;
            const gain = Math.abs(o.localTemp - pref) - Math.abs(this.climate.temperatureAt(sx, sy) - pref);
            if (gain > bestGain) {
              bestGain = gain;
              bx = Math.cos(ang);
              by = Math.sin(ang);
            }
          }
          const w = clamp((o.comfort - 1.25) * 1.5, 0, 1.2);
          dx += bx * w;
          dy += by * w;
        }
      }
    }

    // ---- social forces (cached, refreshed every 3rd tick, staggered) ----
    if (o.state !== 'rest' && o.state !== 'digest') {
      if ((tick + o.id) % 3 === 0) this.computeSocial(o);
      dx += o.socX;
      dy += o.socY;
      if (o.socPush > 0) speed = Math.max(speed, maxSpeed * 0.2);
    }

    // ---- stay on land: look ahead, push uphill away from water ----
    const len = Math.hypot(dx, dy);
    if (len > 1e-4) {
      dx /= len;
      dy /= len;
      const aheadX = o.x + dx * (2.5 + speed * 0.4);
      const aheadY = o.y + dy * (2.5 + speed * 0.4);
      const wd = this.terrain.waterDistAt(aheadX, aheadY);
      if (wd < 3.5 || this.terrain.isWater(aheadX, aheadY)) {
        this.terrain.gradientAt(o.x, o.y, tmpGrad);
        const gl = Math.hypot(tmpGrad.x, tmpGrad.y) + 1e-6;
        const w = wd < 1.5 ? 2.5 : 1.2;
        dx += (tmpGrad.x / gl) * w;
        dy += (tmpGrad.y / gl) * w;
        const l2 = Math.hypot(dx, dy) + 1e-6;
        dx /= l2;
        dy /= l2;
        if (o.state === 'wander' || o.state === 'seek') o.wanderPhase += 0.7; // nudge the noise so they turn away
      }
      // world edge
      const m = 3;
      if (o.x < m) dx += 1;
      if (o.x > this.terrain.size - m) dx -= 1;
      if (o.y < m) dy += 1;
      if (o.y > this.terrain.size - m) dy -= 1;
    }
    out.dirX = dx;
    out.dirY = dy;
    out.speed = speed;
  }

  private wanderAngle(o: Organism, t: number): number {
    const n = this.wanderNoise.noise2D(o.wanderPhase * 13.7, t * 0.09 + o.wanderPhase);
    return o.heading + n * 1.4;
  }
}
