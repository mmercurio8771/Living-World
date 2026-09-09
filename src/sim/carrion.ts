import { SpeciesId } from './species';
import { Vegetation } from './vegetation';

/** A body left on the ground. Hunters scavenge it; what remains feeds the soil. */
export interface Corpse {
  x: number;
  y: number;
  meat: number; // energy left
  size: number;
  species: SpeciesId;
  age: number;
  alive: boolean; // false once consumed / rotted away
}

export class Carrion {
  corpses: Corpse[] = [];
  constructor(private veg: Vegetation) {}

  add(x: number, y: number, meat: number, size: number, species: SpeciesId): void {
    this.corpses.push({ x, y, meat, size, species, age: 0, alive: true });
  }

  /** Nearest scavengeable corpse within radius, or null. */
  nearest(x: number, y: number, radius: number): Corpse | null {
    let best: Corpse | null = null;
    let bd = radius * radius;
    for (const c of this.corpses) {
      if (!c.alive || c.meat < 4) continue;
      const dx = c.x - x, dy = c.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = c;
      }
    }
    return best;
  }

  step(dt: number): void {
    const list = this.corpses;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      c.age += dt;
      // rot: meat returns to the ground
      const rot = Math.min(c.meat, (1.4 + c.size) * dt);
      c.meat -= rot;
      if (rot > 0) this.veg.addNutrients(c.x, c.y, (rot / 100) * 0.6);
      if (c.meat <= 0.5 || c.age > 60) c.alive = false;
      if (c.alive) list[w++] = c;
    }
    list.length = w;
  }
}
