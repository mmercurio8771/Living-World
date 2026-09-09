/**
 * Runs the ecosystem without graphics and prints a compact log.
 * usage: npm run sim -- [minutes=20] [seed=7] [--quiet]
 */
import { World, TICK } from '../src/sim/world';
import { Stats } from '../src/sim/stats';
import { Chronicle } from '../src/sim/chronicle';
import { YEAR_LENGTH, DAY_LENGTH } from '../src/sim/climate';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const minutes = Number(args[0] ?? 20);
const seed = Number(args[1] ?? 7);
const quiet = process.argv.includes('--quiet');
const experiment = (process.argv.find((a) => a.startsWith('--exp=')) ?? '').slice(6);

const world = new World(seed);
world.genesis();
const stats = new Stats(world);
const chron = new Chronicle(world, stats);
chron.listeners.push((e) => {
  if (e.importance >= 2 || !quiet) console.log(`   ★ [${(e.t / DAY_LENGTH).toFixed(1)}d] ${e.title}${e.detail ? ' — ' + e.detail : ''}`);
});

const totalTicks = Math.round((minutes * 60) / TICK);
const logEvery = Math.round(60 / TICK);
const t0 = Date.now();
console.log(`seed ${seed} · land ${(world.terrain.landFraction * 100).toFixed(0)}% · capacity ${world.vegetation.totalCapacity.toFixed(0)}`);
const f = (v: number, d = 2) => v.toFixed(d);
for (let i = 1; i <= totalTicks; i++) {
  world.step(TICK);
  stats.update();
  chron.update();
  if (experiment && i === Math.round((5 * 60) / TICK)) {
    console.log(`   >>> experiment: ${experiment}`);
    if (experiment === 'blight') world.blight(0.5);
    if (experiment === 'drought') world.drought();
    if (experiment === 'fast') world.releaseHunters(8, true);
    if (experiment === 'cold') world.coldSnap();
    if (experiment === 'sun') world.climate.settings.sunlight = 0.5;
    if (experiment === 'nohunters') for (const o of world.organisms) if (o.species === 'hunter') world.smite(o.id);
  }
  if (i % logEvery === 0) {
    const s = stats.latest!;
    const g = s.species.grazer, h = s.species.hunter;
    console.log(
      `${String(i / logEvery).padStart(3)}m y${world.climate.year + 1} ${world.climate.season.padEnd(6)} T${f(s.temperature, 0).padStart(3)} veg ${f(s.vegetation)} | ` +
        `G ${String(g.count).padStart(4)} gen${f(g.avgGeneration, 1)} sz${f(g.avg.size)} sp${f(g.avg.speed)} vi${f(g.avg.vision)} bo${f(g.avg.boldness)} rt${f(g.avg.reproThreshold)} li${f(g.avg.litterSize, 1)} tp${f(g.avg.tempPref, 0)} hue${f(g.avg.hue, 0)} | ` +
        `H ${String(h.count).padStart(3)} gen${f(h.avgGeneration, 1)} sz${f(h.avg.size)} sp${f(h.avg.speed)} vi${f(h.avg.vision)} bo${f(h.avg.boldness)} rt${f(h.avg.reproThreshold)} li${f(h.avg.litterSize, 1)}`,
    );
  }
}
const dt = (Date.now() - t0) / 1000;
console.log(`\n${minutes} sim-minutes (${(minutes * 60 / YEAR_LENGTH).toFixed(1)} years) in ${dt.toFixed(1)}s wall → ${(minutes * 60 / dt).toFixed(0)}x realtime`);
console.log('deaths:', JSON.stringify(world.deathCauses), 'births:', JSON.stringify(world.births), 'oldest:', (world.oldestEver / DAY_LENGTH).toFixed(1) + 'd');
console.log(`hunts ${world.hunts} kills ${world.kills} (${(100 * world.kills / Math.max(1, world.hunts)).toFixed(0)}%) scavenged ${world.scavenged.toFixed(0)} energy`);
