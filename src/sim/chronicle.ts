import { World, WorldNotice } from './world';
import { Stats, Sample } from './stats';
import { SPECIES, SpeciesId, SPECIES_IDS } from './species';
import { GENE_SPECS, GeneKey } from './genome';
import { DAY_LENGTH } from './climate';

export type EventKind =
  | 'extinction'
  | 'crash'
  | 'boom'
  | 'recovery'
  | 'trait'
  | 'lineage'
  | 'elder'
  | 'generation'
  | 'arrival'
  | 'intervention'
  | 'season'
  | 'founding';

export interface ChronicleEvent {
  id: number;
  t: number;
  kind: EventKind;
  importance: 1 | 2 | 3;
  title: string;
  detail?: string;
  species?: SpeciesId;
  x?: number;
  y?: number;
  organismId?: number;
}

const TRAIT_VERBS: Partial<Record<GeneKey, [string, string]>> = {
  size: ['growing larger', 'growing smaller'],
  speed: ['getting faster', 'slowing down'],
  vision: ['developing keener senses', 'losing their sharp senses'],
  boldness: ['becoming bolder', 'becoming more cautious'],
  reproThreshold: ['breeding later, with more reserves', 'breeding earlier and leaner'],
  litterSize: ['having larger litters', 'having smaller litters'],
  tempPref: ['adapting to warmer weather', 'adapting to colder weather'],
};

/**
 * Watches the statistics and writes the story of the world:
 * crashes, booms, extinctions, trait shifts, dynasties.
 */
export class Chronicle {
  events: ChronicleEvent[] = [];
  private nextId = 1;
  private lastCheck = 0;
  private peak: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  private crashed: Record<SpeciesId, number> = { grazer: 0, hunter: 0 }; // pre-crash peak, 0 if not in crash
  private cooldown = new Map<string, number>();
  private extinct: Record<SpeciesId, boolean> = { grazer: false, hunter: false };
  private lineageAnnounced = new Set<number>();
  private generationMilestone: Record<SpeciesId, number> = { grazer: 0, hunter: 0 };
  private elderRecord = 0;
  private traitRef: Record<SpeciesId, Sample | null> = { grazer: null, hunter: null };
  private hueRef: Record<SpeciesId, number> = { grazer: -1, hunter: -1 };
  listeners: ((e: ChronicleEvent) => void)[] = [];

  constructor(private world: World, private stats: Stats) {}

  private emit(e: Omit<ChronicleEvent, 'id' | 't'>): ChronicleEvent {
    const ev: ChronicleEvent = { id: this.nextId++, t: this.world.time, ...e };
    this.events.push(ev);
    if (this.events.length > 400) this.events.shift();
    for (const l of this.listeners) l(ev);
    return ev;
  }

  private onCooldown(key: string, seconds: number): boolean {
    const t = this.world.time;
    const until = this.cooldown.get(key) ?? -1;
    if (t < until) return true;
    this.cooldown.set(key, t + seconds);
    return false;
  }

  /** Call every frame; cheap unless a check is due. */
  update(): void {
    const w = this.world;
    // pass along world notices immediately
    if (w.notices.length) {
      for (const n of w.notices) this.fromNotice(n);
      w.notices.length = 0;
    }
    const t = w.time;
    if (t - this.lastCheck < 4) return;
    this.lastCheck = t;
    const s = this.stats.latest;
    if (!s) return;
    if (this.events.length === 0) {
      this.emit({ kind: 'founding', importance: 2, title: 'The world begins', detail: `${s.species.grazer.count} grazers and ${s.species.hunter.count} hunters on a fresh island.` });
    }
    for (const sid of SPECIES_IDS) this.checkSpecies(sid, s);
    this.checkElder();
  }

  private fromNotice(n: WorldNotice): void {
    this.emit({
      kind: n.kind,
      importance: n.importance,
      title: n.text,
      species: n.species,
      x: n.x,
      y: n.y,
    });
  }

  private checkSpecies(sid: SpeciesId, s: Sample): void {
    const w = this.world;
    const sp = SPECIES[sid];
    const now = s.species[sid].count;
    const name = sp.plural;
    const lower = name.toLowerCase();

    // extinction / return
    if (now === 0 && !this.extinct[sid]) {
      this.extinct[sid] = true;
      this.emit({ kind: 'extinction', importance: 3, title: `${name} have gone extinct`, detail: `The last of the ${lower} is gone. ${w.deaths[sid]} have died since the world began.`, species: sid });
      this.peak[sid] = 0;
      this.crashed[sid] = 0;
      return;
    }
    if (now > 0 && this.extinct[sid]) {
      this.extinct[sid] = false;
    }

    // crash / boom against the recent past
    const past = this.stats.ago(60);
    if (past) {
      const then = past.species[sid].count;
      if (then >= 30 && now <= then * 0.55 && !this.crashed[sid] && !this.onCooldown('crash' + sid, 90)) {
        this.crashed[sid] = then;
        this.emit({ kind: 'crash', importance: 3, title: `${name} population crashed`, detail: `From ${then} to ${now} in a single season. ${this.explainCrash(sid)}`, species: sid });
      } else if (then >= 12 && now >= then * 1.8 && now >= 25 && !this.onCooldown('boom' + sid, 120)) {
        this.emit({ kind: 'boom', importance: 2, title: `${name} are booming`, detail: `Their numbers nearly doubled, from ${then} to ${now}.`, species: sid });
      }
    }
    if (this.crashed[sid] && now >= this.crashed[sid] * 0.8) {
      this.emit({ kind: 'recovery', importance: 2, title: `${name} have recovered`, detail: `Back to ${now} after falling to a fraction of that.`, species: sid });
      this.crashed[sid] = 0;
    }
    if (now > this.peak[sid]) this.peak[sid] = now;

    // trait drift: compare with the reference sample (reset whenever we announce)
    if (now >= 15) {
      const ref = this.traitRef[sid];
      if (!ref) {
        this.traitRef[sid] = s;
        this.hueRef[sid] = s.species[sid].avg.hue;
      } else if (s.t - ref.t > 100) {
        const cur = s.species[sid];
        const old = ref.species[sid];
        let bestKey: GeneKey | null = null;
        let bestScore = 0;
        for (const spec of GENE_SPECS) {
          if (spec.key === 'hue' || spec.key === 'pattern') continue;
          const k = spec.key;
          const span = spec.max - spec.min;
          const delta = (cur.avg[k] - old.avg[k]) / span;
          const score = Math.abs(delta);
          if (score > 0.085 && score > bestScore) {
            bestScore = score;
            bestKey = k;
          }
        }
        if (bestKey && !this.onCooldown('trait' + sid + bestKey, 150)) {
          const spec = GENE_SPECS.find((g) => g.key === bestKey)!;
          const up = cur.avg[bestKey] > old.avg[bestKey];
          const verbs = TRAIT_VERBS[bestKey]!;
          this.emit({
            kind: 'trait',
            importance: 2,
            title: `${name} are ${up ? verbs[0] : verbs[1]}`,
            detail: `Average ${spec.label.toLowerCase()} shifted from ${spec.format(old.avg[bestKey])} to ${spec.format(cur.avg[bestKey])} over ${Math.round((s.t - ref.t) / DAY_LENGTH)} days.`,
            species: sid,
          });
          this.traitRef[sid] = s;
        } else if (s.t - ref.t > 240) {
          this.traitRef[sid] = s; // slide the window
        }
        // colour: a story of camouflage
        const hueNow = cur.avg.hue;
        const hueRef = this.hueRef[sid];
        if (hueRef >= 0) {
          let dh = Math.abs(hueNow - hueRef) % 360;
          if (dh > 180) dh = 360 - dh;
          if (dh > 32 && cur.sd.hue < 110 && !this.onCooldown('hue' + sid, 200)) {
            this.emit({
              kind: 'trait',
              importance: 2,
              title: `${name} are changing colour`,
              detail: `Their coats have drifted toward ${describeHue(hueNow)}${sid === 'grazer' ? ' — perhaps the ground hides them better' : ''}.`,
              species: sid,
            });
            this.hueRef[sid] = hueNow;
          }
        }
      }
    }

    // dominant lineage
    if (now >= 24) {
      let bestL = -1, bestC = 0;
      for (const [lid, c] of w.lineageCounts) {
        const founder = w.byId.get(lid);
        // lineage counts include both species; filter by checking a live member's species is costly, so approximate via founder name lookup below
        if (c > bestC) {
          bestC = c;
          bestL = lid;
        }
        void founder;
      }
      if (bestL >= 0 && !this.lineageAnnounced.has(bestL)) {
        // verify species by scanning members (rare path)
        let members = 0;
        for (const o of w.organisms) if (o.alive && o.lineageId === bestL && o.species === sid) members++;
        if (members >= now * 0.5 && members >= 20) {
          this.lineageAnnounced.add(bestL);
          const founder = w.lineageNames.get(bestL) ?? 'an unknown ancestor';
          this.emit({
            kind: 'lineage',
            importance: 3,
            title: `The line of ${founder} dominates the ${lower}`,
            detail: `${members} of ${now} living ${lower} descend from ${founder}.`,
            species: sid,
          });
        }
      }
    }

    // generation milestones
    const g = w.highestGeneration[sid];
    const next = this.generationMilestone[sid];
    const milestones = [10, 25, 50, 100, 200, 400, 800];
    const m = milestones.find((mm) => mm > next && g >= mm);
    if (m) {
      this.generationMilestone[sid] = m;
      this.emit({ kind: 'generation', importance: 1, title: `${name} reach generation ${m}`, species: sid });
    }
  }

  private explainCrash(sid: SpeciesId): string {
    const w = this.world;
    const past = this.stats.ago(60);
    const now = this.stats.latest!;
    if (sid === 'grazer') {
      const hunters = now.species.hunter.count;
      const veg = now.vegetation;
      if (past && veg < 0.25 && veg < past.vegetation * 0.7) return 'The pastures were stripped bare.';
      if (hunters > now.species.grazer.count * 0.35) return 'Hunters swarm the island.';
      if (w.climate.baseTemperature < 4) return 'The cold is taking them.';
      if (w.climate.droughtPressure > 0.4) return 'The drought is starving them.';
      return 'Starvation, mostly.';
    }
    const prey = now.species.grazer.count;
    if (prey < 40) return 'There is almost nothing left to hunt.';
    if (w.climate.baseTemperature < 4) return 'Winter is thinning them out.';
    return 'The prey grew too hard to catch.';
  }

  private checkElder(): void {
    const w = this.world;
    for (const o of w.organisms) {
      if (!o.alive) continue;
      if (o.age > this.elderRecord + 20 && o.age > 240) {
        this.elderRecord = o.age;
        if (this.onCooldown('elder', 120)) return;
        this.emit({
          kind: 'elder',
          importance: 1,
          title: `${o.name} is the oldest creature ever to live`,
          detail: `A ${SPECIES[o.species].name.toLowerCase()} of ${Math.round(o.age / DAY_LENGTH)} days, generation ${o.generation}.`,
          species: o.species,
          organismId: o.id,
          x: o.x,
          y: o.y,
        });
        return;
      }
    }
  }
}

export function describeHue(h: number): string {
  h = ((h % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'rust and orange';
  if (h < 62) return 'sandy gold';
  if (h < 80) return 'olive';
  if (h < 150) return 'green';
  if (h < 195) return 'teal';
  if (h < 250) return 'blue';
  if (h < 290) return 'violet';
  if (h < 345) return 'magenta';
  return 'red';
}
