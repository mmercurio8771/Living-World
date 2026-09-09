import { World, TICK } from './sim/world';
import { Stats } from './sim/stats';
import { Chronicle } from './sim/chronicle';
import { Organism } from './sim/organism';
import { Renderer } from './render/renderer';
import { CameraController } from './render/camera';
import { hashSeed } from './sim/rng';
import * as THREE from 'three';

/** Application state shared by the loop, the renderer and the UI. */
export class App {
  world: World;
  stats: Stats;
  chronicle: Chronicle;
  cam: CameraController;
  renderer: Renderer;
  speed = 1;
  paused = false;
  selected: Organism | null = null;
  hovered: Organism | null = null;
  /** sim seconds accumulated but not yet stepped */
  private acc = 0;
  /** ms of sim work allowed per frame */
  budgetMs = 14;
  /** 0..1 fraction of the way between the last two ticks (for interpolation) */
  alpha = 0;
  lastFrame = performance.now();
  simLoad = 0; // 0..1 how much of the budget the sim uses
  listeners: { select: ((o: Organism | null) => void)[] } = { select: [] };
  private frameCount = 0;

  constructor(public canvas: HTMLCanvasElement, seed: number) {
    this.world = new World(seed);
    this.world.genesis();
    this.stats = new Stats(this.world);
    this.stats.update(true);
    this.chronicle = new Chronicle(this.world, this.stats);
    this.cam = new CameraController(canvas, this.world.terrain, window.innerWidth / window.innerHeight);
    this.renderer = new Renderer(canvas, this.world, this.cam);
    this.cam.introTarget = this.findHerd();
  }

  /** The busiest patch of grazers, for the opening shot. */
  private findHerd(): import('three').Vector3 | null {
    const gs = this.world.organisms.filter((o) => o.alive && o.species === 'grazer');
    if (!gs.length) return null;
    let best = gs[0], bestN = -1;
    for (let i = 0; i < gs.length; i += 3) {
      const o = gs[i];
      let n = 0;
      for (const p of gs) if (Math.abs(p.x - o.x) < 18 && Math.abs(p.y - o.y) < 18) n++;
      if (n > bestN) { bestN = n; best = o; }
    }
    const v = new THREE.Vector3(best.x, 0, best.y);
    return v;
  }

  select(o: Organism | null): void {
    if (o && !o.alive) o = null;
    this.selected = o;
    for (const l of this.listeners.select) l(o);
  }

  /** Nearest organism to a screen point, within `radiusPx`. */
  pick(sx: number, sy: number, radiusPx = 22): Organism | null {
    const out = { x: 0, y: 0, depth: 0 };
    let best: Organism | null = null;
    let bestD = radiusPx * radiusPx;
    const t = this.world.terrain;
    for (const o of this.world.organisms) {
      if (!o.alive) continue;
      const x = o.px + (o.x - o.px) * this.alpha, z = o.py + (o.y - o.py) * this.alpha;
      if (!this.cam.project(x, t.elevationAt(x, z) + 0.6 * o.bodySize, z, out)) continue;
      const dx = out.x - sx, dy = out.y - sy;
      // generous radius for small/far creatures
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Advance the world by `seconds` of sim time immediately (debugging, screenshots). */
  warp(seconds: number): void {
    const steps = Math.round(seconds / TICK);
    for (let i = 0; i < steps; i++) {
      this.world.step(TICK);
      this.stats.update();
      this.chronicle.update();
    }
  }

  frame(now: number): void {
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (dt > 0.1) dt = 0.1;
    this.frameCount++;

    if (!this.paused) {
      this.acc += dt * this.speed;
      const start = performance.now();
      let steps = 0;
      const maxSteps = Math.ceil(this.speed * 2) + 2;
      while (this.acc >= TICK && steps < maxSteps) {
        this.world.step(TICK);
        this.acc -= TICK;
        steps++;
        if (performance.now() - start > this.budgetMs) {
          // over budget: drop the backlog so we never spiral
          if (this.acc > TICK * 4) this.acc = TICK * 4;
          break;
        }
      }
      const used = performance.now() - start;
      this.simLoad = this.simLoad * 0.9 + (used / this.budgetMs) * 0.1;
      this.stats.update();
      this.chronicle.update();
    }
    this.alpha = Math.min(1, this.acc / TICK);
    if (this.selected && !this.selected.alive) {
      // keep showing the dead for a moment via UI; camera stops following
      if (this.cam.followId === this.selected.id) this.cam.followId = -1;
    }
    this.renderer.update(dt, this.paused ? 1 : this.alpha, this.selected, this.hovered);
  }
}

export function seedFromLocation(): number {
  const p = new URLSearchParams(location.search).get('seed');
  if (p && p.length) return /^\d+$/.test(p) ? Number(p) >>> 0 : hashSeed(p);
  return (Math.random() * 0xffffffff) >>> 0;
}
