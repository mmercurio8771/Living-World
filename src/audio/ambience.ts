import { World } from '../sim/world';
import { Atmosphere } from '../render/palette';
import { clamp } from '../sim/rng';

/**
 * A procedural soundscape: wind, rain, birds by day, crickets by night, water near the shore.
 * Nothing is sampled; everything is synthesised so the app stays self-contained.
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private enabled = false;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: { gain: GainNode };
  private water!: { gain: GainNode };
  private crickets!: { gain: GainNode; osc: OscillatorNode; lfo: OscillatorNode };
  private birdTimer = 1;
  private noiseBuffer!: AudioBuffer;
  private t = 0;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // shared noise source
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      // pink-ish noise
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const noise = () => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      src.start();
      return src;
    };

    // wind
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 400;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    noise().connect(wf).connect(wg).connect(this.master);
    this.wind = { gain: wg, filter: wf };

    // rain
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 4200;
    rf.Q.value = 0.5;
    const rg = ctx.createGain();
    rg.gain.value = 0;
    noise().connect(rf).connect(rg).connect(this.master);
    this.rain = { gain: rg };

    // water
    const waf = ctx.createBiquadFilter();
    waf.type = 'lowpass';
    waf.frequency.value = 600;
    const wag = ctx.createGain();
    wag.gain.value = 0;
    noise().connect(waf).connect(wag).connect(this.master);
    this.water = { gain: wag };

    // crickets: pulsed high tone
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 4300;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 14;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const cg = ctx.createGain();
    cg.gain.value = 0;
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    lfo.connect(lfoGain).connect(pulse.gain);
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 4300;
    cf.Q.value = 6;
    osc.connect(pulse).connect(cf).connect(cg).connect(this.master);
    osc.start();
    lfo.start();
    this.crickets = { gain: cg, osc, lfo };
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.unlock();
    if (this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0, this.ctx.currentTime, 0.4);
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    }
    return this.enabled;
  }

  get isOn(): boolean {
    return this.enabled;
  }

  update(world: World, atm: Atmosphere, dt: number, camDist: number): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const c = world.climate;
    this.t += dt;
    const near = clamp(1 - (camDist - 30) / 300, 0.35, 1); // closer = more detail
    const tc = ctx.currentTime;
    // wind
    const ws = c.windStrength;
    this.wind.gain.gain.setTargetAtTime(0.05 + ws * 0.18 * (1.3 - near * 0.3), tc, 0.5);
    this.wind.filter.frequency.setTargetAtTime(220 + ws * 700 + Math.sin(this.t * 0.35) * 120, tc, 0.5);
    // rain
    this.rain.gain.gain.setTargetAtTime(c.rain * 0.12, tc, 0.8);
    // water when the focus is near the shore
    const focus = world.terrain;
    void focus;
    // crickets at warm nights
    const cr = atm.night * clamp((c.baseTemperature - 6) / 10, 0, 1) * (1 - c.rain) * near;
    this.crickets.gain.gain.setTargetAtTime(cr * 0.035, tc, 0.8);
    this.crickets.lfo.frequency.setTargetAtTime(11 + clamp(c.baseTemperature - 10, 0, 15) * 0.4, tc, 1);
    // birds by day
    const dayAmount = (1 - atm.night) * (1 - c.rain * 0.8) * clamp((c.baseTemperature - 2) / 12, 0.1, 1);
    this.birdTimer -= dt * dayAmount * (0.6 + Math.min(1, world.counts.grazer / 400));
    if (this.birdTimer <= 0) {
      this.birdTimer = 1.5 + Math.random() * 5;
      this.chirp(near);
    }
  }

  setWaterProximity(v: number): void {
    if (!this.ctx) return;
    this.water.gain.gain.setTargetAtTime(clamp(v, 0, 1) * 0.08, this.ctx.currentTime, 0.8);
  }

  private chirp(near: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + Math.random() * 0.2;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 1800 + Math.random() * 1600;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.connect(pan).connect(this.master);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(g);
    let t = t0;
    for (let i = 0; i < notes; i++) {
      const f = base * (1 + (Math.random() - 0.5) * 0.35);
      const len = 0.06 + Math.random() * 0.08;
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.3), t + len * 0.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045 * near, t + 0.015);
      g.gain.linearRampToValueAtTime(0, t + len);
      t += len + 0.04 + Math.random() * 0.1;
    }
    osc.start(t0);
    osc.stop(t + 0.1);
  }

  /** UI and world events: soft, short, never annoying. */
  event(kind: 'select' | 'event' | 'extinction' | 'fire'): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const play = (freq: number, dur: number, vol: number, type: OscillatorType = 'sine', delay = 0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(vol, t + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      o.connect(g).connect(this.master);
      o.start(t + delay);
      o.stop(t + delay + dur + 0.05);
    };
    if (kind === 'select') play(880, 0.18, 0.05);
    else if (kind === 'event') { play(523, 0.6, 0.05); play(784, 0.9, 0.04, 'sine', 0.12); }
    else if (kind === 'extinction') { play(196, 2.2, 0.08, 'triangle'); play(147, 2.6, 0.06, 'sine', 0.3); }
    else if (kind === 'fire') {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + 3);
    }
  }
}
