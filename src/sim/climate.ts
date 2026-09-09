import { SimplexNoise } from './noise';
import { Terrain, SEA_LEVEL } from './terrain';
import { clamp, lerp, smoothstep, TAU } from './rng';

export const DAY_LENGTH = 60; // sim seconds per day
export const DAYS_PER_YEAR = 4;
export const YEAR_LENGTH = DAY_LENGTH * DAYS_PER_YEAR;

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Knobs the player can turn. All neutral at their defaults. */
export interface EnvironmentSettings {
  sunlight: number; // 0.2 .. 1.5, multiplies plant growth and daylight
  temperatureOffset: number; // -15 .. +15 degrees
  rainfall: number; // 0 .. 2, multiplies rain frequency / moisture
  growthRate: number; // 0.2 .. 2, vegetation growth multiplier
  mutationRate: number; // 0 .. 3, multiplies gene mutation probability
  migration: boolean; // allow rare immigrants when a species is nearly gone
}

export const defaultEnvironment = (): EnvironmentSettings => ({
  sunlight: 1,
  temperatureOffset: 0,
  rainfall: 1,
  growthRate: 1,
  mutationRate: 1,
  migration: true,
});

/**
 * Everything about the sky: the sun, the seasons, the weather.
 * Weather is a slow noise process, so it drifts rather than flips.
 */
export class Climate {
  time = 0; // sim seconds since world start
  settings: EnvironmentSettings = defaultEnvironment();

  // weather state (0..1)
  cloudCover = 0.25;
  rain = 0; // intensity
  windX = 0.6;
  windY = 0.2;
  windStrength = 0.4;
  /** transient event pressure, e.g. from a "drought" or "storm" button; decays */
  droughtPressure = 0; // 0..1, suppresses rain and dries the soil
  heatPressure = 0; // degrees added, decays
  private weatherNoise: SimplexNoise;
  private lastSeason: Season = 'spring';

  constructor(seed: number, private terrain: Terrain) {
    this.weatherNoise = new SimplexNoise(seed ^ 0x77aa55);
  }

  /** 0..1 fraction of the current day. 0 = midnight, 0.5 = noon. */
  get dayFrac(): number {
    return (this.time % DAY_LENGTH) / DAY_LENGTH;
  }
  get day(): number {
    return Math.floor(this.time / DAY_LENGTH);
  }
  get year(): number {
    return Math.floor(this.time / YEAR_LENGTH);
  }
  /** 0..1 through the year, 0 = first day of spring. */
  get yearFrac(): number {
    return (this.time % YEAR_LENGTH) / YEAR_LENGTH;
  }
  get season(): Season {
    return SEASONS[Math.floor(this.yearFrac * 4) % 4];
  }
  /** -1 (mid winter) .. +1 (mid summer) */
  get seasonal(): number {
    return Math.sin(TAU * (this.yearFrac - 0.125));
  }
  /** Sun elevation, -1..1; > 0 means daytime. */
  get sunElevation(): number {
    // sun up from ~0.22 to ~0.78 of the day; longer days in summer
    const dayLen = 0.5 + 0.08 * this.seasonal;
    const t = this.dayFrac;
    const rise = 0.5 - dayLen / 2;
    const set = 0.5 + dayLen / 2;
    if (t < rise || t > set) {
      // night: negative, deepest at midnight
      const nightT = t < rise ? (rise - t) / (rise + 1 - set) : (t - set) / (rise + 1 - set);
      return -Math.sin(Math.PI * clamp(nightT, 0, 1)) * 0.7;
    }
    return Math.sin(Math.PI * (t - rise) / (set - rise));
  }
  /** 0..1 available light at ground level (before player sunlight setting). */
  get daylight(): number {
    const e = this.sunElevation;
    const sun = smoothstep(-0.12, 0.35, e);
    return sun * (1 - 0.55 * this.cloudCover);
  }
  /** Effective light for plants, includes the player's sunlight knob. */
  get plantLight(): number {
    return clamp(this.daylight * this.settings.sunlight, 0, 1.6);
  }
  get isNight(): boolean {
    return this.sunElevation < 0;
  }

  /** Ambient temperature (°C) before local modifiers. */
  get baseTemperature(): number {
    const diurnal = Math.sin(TAU * (this.dayFrac - 0.3)) * 4.5; // warmest mid-afternoon
    return (
      19 +
      this.seasonal * 8.5 +
      diurnal +
      this.settings.temperatureOffset +
      this.heatPressure -
      this.cloudCover * 2 -
      this.rain * 2
    );
  }

  /** Local temperature at a world position. North is colder, height is colder. */
  temperatureAt(x: number, y: number): number {
    const h = this.terrain.heightAt(x, y);
    const lat = y / this.terrain.size; // 0 = south (warm) .. 1 = north (cold)
    const altitude = Math.max(0, h - SEA_LEVEL) / (1 - SEA_LEVEL);
    return this.baseTemperature + 4 - lat * 10 - altitude * altitude * 16;
  }

  /** Effective soil moisture multiplier for plant growth at position (0..~1.3). */
  get moistureFactor(): number {
    return clamp(
      (0.55 + 0.45 * this.settings.rainfall) * (1 - 0.75 * this.droughtPressure) + this.rain * 0.35,
      0.05,
      1.4,
    );
  }

  step(dt: number): void {
    this.time += dt;
    const t = this.time;
    // slow-drifting weather
    const n1 = this.weatherNoise.noise2D(t * 0.006, 0.3) * 0.5 + 0.5;
    const n2 = this.weatherNoise.noise2D(t * 0.011 + 40, 7.1) * 0.5 + 0.5;
    const seasonWet = 0.5 - this.seasonal * 0.15; // wetter in winter/spring
    let target = clamp(n1 * 0.9 + seasonWet * 0.5 - 0.25, 0, 1);
    target = target * this.settings.rainfall * (1 - this.droughtPressure);
    this.cloudCover = lerp(this.cloudCover, clamp(target, 0.03, 1), 1 - Math.exp(-dt / 12));
    const rainTarget = this.cloudCover > 0.62 ? smoothstep(0.62, 0.9, this.cloudCover) * (0.6 + 0.4 * n2) : 0;
    this.rain = lerp(this.rain, rainTarget, 1 - Math.exp(-dt / 6));
    // wind wanders around the prevailing south-westerly
    const wa = this.weatherNoise.noise2D(t * 0.02 + 90, 3) * 0.9 + 0.5;
    this.windX = Math.cos(wa);
    this.windY = Math.sin(wa);
    this.windStrength = clamp(0.25 + n2 * 0.5 + this.rain * 0.5, 0.1, 1.2);
    // pressures decay
    this.droughtPressure = Math.max(0, this.droughtPressure - dt / 240);
    this.heatPressure *= Math.exp(-dt / 90);
    this.lastSeason = this.season;
  }

  /** Human-readable clock, e.g. "Day 12 · Summer · Dusk". */
  describeTime(): { day: number; year: number; season: Season; phase: string } {
    const e = this.sunElevation;
    const f = this.dayFrac;
    let phase = 'Night';
    if (e > 0.75) phase = 'Midday';
    else if (e > 0.25) phase = f < 0.5 ? 'Morning' : 'Afternoon';
    else if (e > -0.1) phase = f < 0.5 ? 'Dawn' : 'Dusk';
    return { day: this.day + 1, year: this.year + 1, season: this.season, phase };
  }
}
