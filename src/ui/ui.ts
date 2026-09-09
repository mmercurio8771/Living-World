import { App } from '../app';
import { el, button, ICONS, fmtDays } from './dom';
import { sparkline, areaChart, traitBar, hueColor } from './charts';
import { DAY_LENGTH } from '../sim/climate';
import { SPECIES, SpeciesId, SPECIES_IDS } from '../sim/species';
import { GENE_SPECS } from '../sim/genome';
import { Organism } from '../sim/organism';
import { ChronicleEvent } from '../sim/chronicle';
import { describeHue } from '../sim/chronicle';
import { Ambience } from '../audio/ambience';

const SPECIES_COLOR: Record<SpeciesId, string> = { grazer: '#b8e08a', hunter: '#ff9a76' };

/** The whole interface: translucent, sparse, in service of the view. */
export class UI {
  private hud!: { clock: HTMLElement; weather: HTMLElement; icon: HTMLElement; dial: SVGCircleElement; temp: HTMLElement };
  private chips!: Record<'grazer' | 'hunter' | 'veg', { count: HTMLElement; spark: HTMLCanvasElement }>;
  private almanac!: HTMLElement;
  private almanacOpen = false;
  private almanacParts!: {
    popChart: HTMLCanvasElement;
    vegChart: HTMLCanvasElement;
    rates: HTMLElement;
    traits: Record<SpeciesId, { canvases: Map<string, HTMLCanvasElement>; values: Map<string, HTMLElement>; header: HTMLElement }>;
    lineages: HTMLElement;
    deaths: HTMLElement;
  };
  private env!: HTMLElement;
  private envOpen = false;
  private feed!: HTMLElement;
  private feedItems: HTMLElement[] = [];
  private chroniclePanel!: HTMLElement;
  private chronicleList!: HTMLElement;
  private chronicleOpen = false;
  private inspector!: HTMLElement;
  private insp!: {
    name: HTMLElement; species: HTMLElement; sub: HTMLElement; state: HTMLElement; energy: HTMLElement; energyBar: HTMLElement;
    stats: HTMLElement; traits: Map<string, { bar: HTMLCanvasElement; val: HTMLElement }>; log: HTMLElement; follow: HTMLButtonElement; swatch: HTMLElement; camo: HTMLElement;
  };
  private titleCard!: HTMLElement;
  private titleTimer = 0;
  private titleQueue: ChronicleEvent[] = [];
  private hoverLabel!: HTMLElement;
  private intro!: HTMLElement;
  private help!: HTMLElement;
  private transport!: { play: HTMLButtonElement; speeds: HTMLButtonElement[]; film: HTMLButtonElement; sound: HTMLButtonElement; env: HTMLButtonElement };
  private placingFire = false;
  private fireCursor!: HTMLElement;
  private lastSlow = 0;
  private lastChart = 0;
  private audio = new Ambience();
  private deadShownUntil = 0;
  private eventCount = 0;
  private toastEl!: HTMLElement;
  private toastTimer = 0;

  constructor(public app: App, public root: HTMLElement) {
    this.build();
    app.listeners.select.push((o) => this.onSelect(o));
    app.chronicle.listeners.push((e) => this.onEvent(e));
    app.cam.onFollowBroken = () => this.refreshFollow();
    app.cam.onUserInput = () => this.dismissIntro();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // first click anywhere starts audio (browser policy) but keeps it muted unless enabled
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
  }

  // ---------------------------------------------------------------- build
  private build(): void {
    const r = this.root;

    // ---- intro
    this.intro = el('div', 'intro', `
      <div class="intro-inner">
        <div class="intro-eyebrow">a window into</div>
        <h1>Living World</h1>
        <div class="intro-sub">a tiny ecosystem that grows, hunts, breeds, and evolves on its own</div>
        <div class="intro-hint"><span>drag</span> to look around · <span>scroll</span> to zoom · <span>click</span> a creature to meet it</div>
      </div>`);
    r.appendChild(this.intro);
    setTimeout(() => this.dismissIntro(), 5200);

    // ---- HUD (top-left)
    const hud = el('div', 'hud');
    hud.innerHTML = `
      <div class="brand">Living World</div>
      <div class="clock-row">
        <div class="dial"><svg viewBox="0 0 60 34" width="60" height="34">
          <path d="M4 30 A26 26 0 0 1 56 30" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1"/>
          <circle class="dial-sun" cx="30" cy="4" r="3.2" fill="#ffd27a"/>
        </svg><div class="dial-icon"></div></div>
        <div>
          <div class="clock"></div>
          <div class="weather"><span class="temp"></span><span class="sky"></span></div>
        </div>
      </div>`;
    r.appendChild(hud);
    this.hud = {
      clock: hud.querySelector('.clock')!,
      weather: hud.querySelector('.sky')!,
      icon: hud.querySelector('.dial-icon')!,
      dial: hud.querySelector('.dial-sun')!,
      temp: hud.querySelector('.temp')!,
    };

    // ---- population chips (top-right) + almanac
    const chips = el('div', 'chips');
    const mkChip = (key: 'grazer' | 'hunter' | 'veg', label: string, color: string) => {
      const c = el('div', 'chip chip-' + key);
      c.innerHTML = `<span class="dot" style="background:${color}"></span><span class="count">0</span><span class="label">${label}</span><canvas class="spark" width="64" height="22"></canvas>`;
      c.addEventListener('click', () => this.toggleAlmanac());
      chips.appendChild(c);
      return { count: c.querySelector('.count') as HTMLElement, spark: c.querySelector('canvas') as HTMLCanvasElement };
    };
    this.chips = {
      grazer: mkChip('grazer', 'grazers', SPECIES_COLOR.grazer),
      hunter: mkChip('hunter', 'hunters', SPECIES_COLOR.hunter),
      veg: mkChip('veg', 'vegetation', '#6fcf7a'),
    };
    r.appendChild(chips);
    this.buildAlmanac();

    // ---- transport (bottom-center)
    const t = el('div', 'transport');
    const play = button('tbtn play', ICONS.pause, 'Pause / resume (space)', () => this.togglePause());
    const speeds = [1, 2, 4, 8].map((s) => button('tbtn speed' + (s === 1 ? ' active' : ''), `${s}×`, `Run at ${s}× speed`, () => this.setSpeed(s)));
    const film = button('tbtn', ICONS.film, 'Cinematic camera (c)', () => this.toggleCinematic());
    const sound = button('tbtn', ICONS.mute, 'Ambient sound (m)', () => this.toggleSound());
    const env = button('tbtn', ICONS.leaf, 'Shape the environment (e)', () => this.toggleEnv());
    const help = button('tbtn', ICONS.help, 'Help (?)', () => this.toggleHelp());
    t.append(play, el('span', 'sep'), ...speeds, el('span', 'sep'), film, sound, env, help);
    r.appendChild(t);
    this.transport = { play, speeds, film, sound, env };
    this.buildEnv();

    // ---- chronicle feed (bottom-left)
    const feedWrap = el('div', 'feed-wrap');
    const feedHead = button('feed-head', 'Chronicle <span class="arrow">›</span>', 'Open the full chronicle', () => this.toggleChronicle());
    this.feed = el('div', 'feed');
    feedWrap.append(this.feed, feedHead);
    r.appendChild(feedWrap);
    this.chroniclePanel = el('div', 'panel chronicle-panel hidden');
    this.chroniclePanel.innerHTML = `<div class="panel-head"><h2>Chronicle</h2><span class="panel-sub">the story so far</span></div>`;
    const closeC = button('close', ICONS.close, 'Close', () => this.toggleChronicle());
    this.chroniclePanel.querySelector('.panel-head')!.appendChild(closeC);
    this.chronicleList = el('div', 'chronicle-list');
    this.chroniclePanel.appendChild(this.chronicleList);
    r.appendChild(this.chroniclePanel);

    // ---- inspector
    this.buildInspector();

    // ---- title card, hover label, help, fire cursor, toast
    this.titleCard = el('div', 'title-card hidden');
    r.appendChild(this.titleCard);
    this.hoverLabel = el('div', 'hover-label hidden');
    r.appendChild(this.hoverLabel);
    this.help = el('div', 'panel help hidden', `
      <div class="panel-head"><h2>How to explore</h2></div>
      <div class="help-grid">
        <div><b>Drag</b> pan · <b>Right-drag</b> orbit · <b>Scroll</b> zoom</div>
        <div><b>WASD / arrows</b> move · <b>Q / E</b> turn · <b>+ / −</b> zoom</div>
        <div><b>Click</b> a creature to inspect it · <b>F</b> follow it</div>
        <div><b>Space</b> pause · <b>1–4</b> speed · <b>C</b> cinematic · <b>M</b> sound</div>
        <div><b>E</b> environment · <b>A</b> almanac · <b>L</b> chronicle · <b>Esc</b> close</div>
      </div>
      <div class="help-foot">Every creature carries nine inherited traits. Watch the population charts: what survives, spreads.</div>
      <div class="help-seed">world seed <b>${this.app.world.seed}</b> · add <code>?seed=…</code> to the address to revisit a world</div>`);
    const closeH = button('close', ICONS.close, 'Close', () => this.toggleHelp());
    this.help.querySelector('.panel-head')!.appendChild(closeH);
    r.appendChild(this.help);
    this.fireCursor = el('div', 'fire-cursor hidden', 'click to set a fire · esc to cancel');
    r.appendChild(this.fireCursor);
    this.toastEl = el('div', 'toast hidden');
    r.appendChild(this.toastEl);
  }

  private buildAlmanac(): void {
    const p = el('div', 'panel almanac hidden');
    p.innerHTML = `
      <div class="panel-head"><h2>Almanac</h2><span class="panel-sub">populations & inheritance</span></div>
      <div class="section">
        <div class="section-title">Population <span class="legend"><i style="background:${SPECIES_COLOR.grazer}"></i>grazers <i style="background:${SPECIES_COLOR.hunter}"></i>hunters</span></div>
        <canvas class="pop-chart"></canvas>
        <div class="section-title" style="margin-top:8px">Vegetation <span class="legend"><i style="background:#6fcf7a"></i>share of capacity</span></div>
        <canvas class="veg-chart"></canvas>
        <div class="rates"></div>
      </div>
      <div class="section traits-section"></div>
      <div class="section"><div class="section-title">Dynasties</div><div class="lineages"></div></div>
      <div class="section"><div class="section-title">How they die</div><div class="deaths"></div></div>`;
    const close = button('close', ICONS.close, 'Close', () => this.toggleAlmanac());
    p.querySelector('.panel-head')!.appendChild(close);
    const traitsSection = p.querySelector('.traits-section') as HTMLElement;
    const traits = {} as Record<SpeciesId, { canvases: Map<string, HTMLCanvasElement>; values: Map<string, HTMLElement>; header: HTMLElement }>;
    for (const sid of SPECIES_IDS) {
      const head = el('div', 'section-title', `<span style="color:${SPECIES_COLOR[sid]}">${SPECIES[sid].plural}</span> <span class="gen"></span>`);
      traitsSection.appendChild(head);
      const grid = el('div', 'trait-grid');
      const canvases = new Map<string, HTMLCanvasElement>();
      const values = new Map<string, HTMLElement>();
      for (const g of GENE_SPECS) {
        if (g.key === 'pattern') continue;
        const cell = el('div', 'trait-cell');
        cell.innerHTML = `<div class="trait-name">${g.label}</div><canvas></canvas><div class="trait-val"></div>`;
        grid.appendChild(cell);
        canvases.set(g.key, cell.querySelector('canvas')!);
        values.set(g.key, cell.querySelector('.trait-val')!);
      }
      traitsSection.appendChild(grid);
      traits[sid] = { canvases, values, header: head.querySelector('.gen')! };
    }
    this.root.appendChild(p);
    this.almanac = p;
    this.almanacParts = {
      popChart: p.querySelector('.pop-chart')!,
      vegChart: p.querySelector('.veg-chart')!,
      rates: p.querySelector('.rates')!,
      traits,
      lineages: p.querySelector('.lineages')!,
      deaths: p.querySelector('.deaths')!,
    };
  }

  private buildEnv(): void {
    const w = this.app.world;
    const s = w.climate.settings;
    const p = el('div', 'panel env hidden');
    p.innerHTML = `<div class="panel-head"><h2>Shape the world</h2><span class="panel-sub">the ecosystem answers in its own time</span></div>
      <div class="env-cols"><div class="env-sliders"></div><div class="env-events"></div></div>`;
    const close = button('close', ICONS.close, 'Close', () => this.toggleEnv());
    p.querySelector('.panel-head')!.appendChild(close);
    const sliders = p.querySelector('.env-sliders') as HTMLElement;
    const mkSlider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string, hint: string) => {
      const row = el('div', 'slider-row');
      row.innerHTML = `<div class="slider-label"><span>${label}</span><span class="slider-val"></span></div><input type="range" min="${min}" max="${max}" step="${step}"><div class="slider-hint">${hint}</div>`;
      const input = row.querySelector('input')!;
      const val = row.querySelector('.slider-val')!;
      input.value = String(get());
      val.textContent = fmt(get());
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = fmt(get());
      });
      input.addEventListener('dblclick', () => {
        const def = { sunlight: 1, temperatureOffset: 0, rainfall: 1, growthRate: 1, mutationRate: 1 } as Record<string, number>;
        const d = def[label.toLowerCase().replace(' ', '')];
        if (d !== undefined) { set(d); input.value = String(d); val.textContent = fmt(d); }
      });
      sliders.appendChild(row);
      return { input, val, get, fmt };
    };
    const sl = [
      mkSlider('Sunlight', 0.2, 1.5, 0.05, () => s.sunlight, (v) => (s.sunlight = v), (v) => Math.round(v * 100) + '%', 'less light, slower plants, darker days'),
      mkSlider('Temperature', -15, 15, 0.5, () => s.temperatureOffset, (v) => (s.temperatureOffset = v), (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '°', 'shifts the whole climate'),
      mkSlider('Rainfall', 0, 2, 0.05, () => s.rainfall, (v) => (s.rainfall = v), (v) => Math.round(v * 100) + '%', 'clouds, rain, soil moisture'),
      mkSlider('Plant growth', 0.2, 2, 0.05, () => s.growthRate, (v) => (s.growthRate = v), (v) => Math.round(v * 100) + '%', 'how fast pasture recovers'),
      mkSlider('Mutation rate', 0, 3, 0.1, () => s.mutationRate, (v) => (s.mutationRate = v), (v) => v.toFixed(1) + '×', 'variation between generations'),
    ];
    void sl;
    const mig = el('label', 'toggle-row', `<input type="checkbox" ${s.migration ? 'checked' : ''}><span>Allow migrants when a species nearly vanishes</span>`);
    mig.querySelector('input')!.addEventListener('change', (e) => (s.migration = (e.target as HTMLInputElement).checked));
    sliders.appendChild(mig);

    const events = p.querySelector('.env-events') as HTMLElement;
    const mkEvent = (label: string, hint: string, cls: string, fn: () => void) => {
      const b = button('event-btn ' + cls, `<span class="ev-label">${label}</span><span class="ev-hint">${hint}</span>`, '', fn);
      events.appendChild(b);
      return b;
    };
    mkEvent('Blight', 'vegetation −50%', 'ev-plant', () => { w.blight(0.5); this.toast('A blight sweeps the island'); });
    mkEvent('Drought', 'the rains stop for a season', 'ev-sky', () => { w.drought(); this.toast('The rains stop'); });
    mkEvent('Heatwave', '+14° for a while', 'ev-sky', () => { w.heatwave(); this.toast('A heatwave sets in'); });
    mkEvent('Cold snap', '−16° for a while', 'ev-sky', () => { w.coldSnap(); this.toast('A cold snap arrives'); });
    mkEvent('Wildfire', 'click the ground to place', 'ev-fire', () => { this.placingFire = true; this.fireCursor.classList.remove('hidden'); this.toggleEnv(false); });
    mkEvent('Release grazers', '40 newcomers', 'ev-grazer', () => { w.releaseGrazers(40); this.toast('40 grazers released'); });
    mkEvent('Release hunters', '8 newcomers', 'ev-hunter', () => { w.releaseHunters(8); this.toast('8 hunters released'); });
    mkEvent('Fast hunters', '8 built for speed', 'ev-hunter', () => { w.releaseHunters(8, true); this.toast('Something fast has arrived'); });
    this.root.appendChild(p);
    this.env = p;
  }

  private buildInspector(): void {
    const p = el('div', 'panel inspector hidden');
    p.innerHTML = `
      <div class="insp-head">
        <div class="swatch"></div>
        <div class="insp-title"><div class="insp-name"></div><div class="insp-species"></div></div>
      </div>
      <div class="insp-sub"></div>
      <div class="insp-state"></div>
      <div class="energy-row"><span>energy</span><div class="energy"><div class="energy-bar"></div></div><span class="energy-val"></span></div>
      <div class="insp-stats"></div>
      <div class="insp-traits"></div>
      <div class="camo"></div>
      <div class="insp-log"></div>
      <div class="insp-actions"></div>`;
    const close = button('close', ICONS.close, 'Close', () => this.app.select(null));
    p.querySelector('.insp-head')!.appendChild(close);
    const traitsEl = p.querySelector('.insp-traits') as HTMLElement;
    const traits = new Map<string, { bar: HTMLCanvasElement; val: HTMLElement }>();
    for (const g of GENE_SPECS) {
      if (g.key === 'hue') continue;
      const row = el('div', 'itrait');
      row.innerHTML = `<span class="itrait-name">${g.label}</span><canvas class="itrait-bar"></canvas><span class="itrait-val"></span>`;
      traitsEl.appendChild(row);
      traits.set(g.key, { bar: row.querySelector('canvas')!, val: row.querySelector('.itrait-val')! });
    }
    const actions = p.querySelector('.insp-actions') as HTMLElement;
    const follow = button('abtn primary', `${ICONS.eye} Follow`, 'Follow with the camera (f)', () => this.toggleFollow());
    const smite = button('abtn danger', 'Strike down', 'Remove this creature from the world', () => {
      const o = this.app.selected;
      if (o) this.app.world.smite(o.id);
    });
    actions.append(follow, smite);
    this.root.appendChild(p);
    this.inspector = p;
    this.insp = {
      name: p.querySelector('.insp-name')!,
      species: p.querySelector('.insp-species')!,
      sub: p.querySelector('.insp-sub')!,
      state: p.querySelector('.insp-state')!,
      energy: p.querySelector('.energy-val')!,
      energyBar: p.querySelector('.energy-bar')!,
      stats: p.querySelector('.insp-stats')!,
      traits,
      log: p.querySelector('.insp-log')!,
      follow,
      swatch: p.querySelector('.swatch')!,
      camo: p.querySelector('.camo')!,
    };
  }

  // ---------------------------------------------------------------- actions
  private dismissIntro(): void {
    if (!this.intro.classList.contains('gone')) this.intro.classList.add('gone');
  }
  togglePause(): void {
    this.app.paused = !this.app.paused;
    this.transport.play.innerHTML = this.app.paused ? ICONS.play : ICONS.pause;
    this.transport.play.classList.toggle('paused', this.app.paused);
  }
  setSpeed(s: number): void {
    this.app.speed = s;
    if (this.app.paused) this.togglePause();
    this.transport.speeds.forEach((b) => b.classList.toggle('active', b.textContent === `${s}×`));
  }
  toggleCinematic(): void {
    const cam = this.app.cam;
    cam.cinematic = !cam.cinematic;
    if (cam.cinematic) {
      this.cinematicNext(true);
      this.toast('Cinematic mode — move to take back control');
    }
    this.transport.film.classList.toggle('active', cam.cinematic);
  }
  private cinematicTimer = 0;
  /** Pick something worth watching. */
  private cinematicNext(first = false): void {
    const w = this.app.world;
    const cam = this.app.cam;
    const alive = w.organisms.filter((o) => o.alive);
    if (alive.length === 0) return;
    // prefer drama: chases and flights, then hunters, then herds
    const dramatic = alive.filter((o) => o.state === 'chase' || o.state === 'flee');
    const pool = dramatic.length > 3 && Math.random() < 0.6 ? dramatic : Math.random() < 0.35 ? alive.filter((o) => o.species === 'hunter') : alive;
    const pick = (pool.length ? pool : alive)[Math.floor(Math.random() * (pool.length || alive.length))];
    if (Math.random() < 0.3 && !first) {
      // wide establishing shot
      cam.followId = -1;
      cam.lookAt(pick.x, pick.y, 90 + Math.random() * 80);
    } else {
      cam.follow(pick.id);
      cam.dist = 22 + Math.random() * 30;
    }
    cam.yaw += (Math.random() - 0.5) * 1.2;
    this.cinematicTimer = 14 + Math.random() * 12;
    this.refreshFollow();
  }
  toggleSound(): void {
    const on = this.audio.toggle();
    this.transport.sound.innerHTML = on ? ICONS.sound : ICONS.mute;
    this.transport.sound.classList.toggle('active', on);
  }
  toggleEnv(force?: boolean): void {
    this.envOpen = force ?? !this.envOpen;
    this.env.classList.toggle('hidden', !this.envOpen);
    this.transport.env.classList.toggle('active', this.envOpen);
    if (this.envOpen) this.toggleHelp(false);
  }
  toggleAlmanac(force?: boolean): void {
    this.almanacOpen = force ?? !this.almanacOpen;
    this.almanac.classList.toggle('hidden', !this.almanacOpen);
    if (this.almanacOpen) this.renderAlmanac(true);
  }
  toggleChronicle(force?: boolean): void {
    this.chronicleOpen = force ?? !this.chronicleOpen;
    this.chroniclePanel.classList.toggle('hidden', !this.chronicleOpen);
    if (this.chronicleOpen) this.renderChronicle();
  }
  toggleHelp(force?: boolean): void {
    const open = force ?? this.help.classList.contains('hidden');
    this.help.classList.toggle('hidden', !open);
  }
  toggleFollow(): void {
    const o = this.app.selected;
    const cam = this.app.cam;
    if (!o) return;
    if (cam.followId === o.id) cam.followId = -1;
    else cam.follow(o.id);
    this.refreshFollow();
  }
  private refreshFollow(): void {
    const o = this.app.selected;
    const following = !!o && this.app.cam.followId === o.id;
    this.insp.follow.innerHTML = following ? `${ICONS.eye} Following` : `${ICONS.eye} Follow`;
    this.insp.follow.classList.toggle('on', following);
  }
  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    this.toastTimer = 2.6;
  }

  /** Returns true if the click was used by the UI (e.g. placing a fire). */
  consumeClick(sx: number, sy: number): boolean {
    if (!this.placingFire) return false;
    const g = this.app.cam.groundAt(sx, sy);
    this.placingFire = false;
    this.fireCursor.classList.add('hidden');
    if (g) {
      this.app.world.wildfire(g.x, g.z, 20);
      this.audio.event('fire');
    }
    return true;
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); this.togglePause(); }
    else if (k === '1' || k === '2' || k === '3' || k === '4') this.setSpeed([1, 2, 4, 8][Number(k) - 1]);
    else if (k === 'c') this.toggleCinematic();
    else if (k === 'm') this.toggleSound();
    else if (k === 'e') this.toggleEnv();
    else if (k === 'a') this.toggleAlmanac();
    else if (k === 'l') this.toggleChronicle();
    else if (k === 'f') this.toggleFollow();
    else if (k === '?' || k === 'h') this.toggleHelp();
    else if (k === 'escape') {
      if (this.placingFire) { this.placingFire = false; this.fireCursor.classList.add('hidden'); return; }
      this.toggleEnv(false); this.toggleAlmanac(false); this.toggleChronicle(false); this.toggleHelp(false);
      this.app.select(null);
    }
    this.dismissIntro();
  }

  private onSelect(o: Organism | null): void {
    this.inspector.classList.toggle('hidden', !o);
    this.almanac.classList.toggle('with-inspector', !!o);
    if (o) {
      this.renderInspector(true);
      this.audio.event('select');
    }
    this.refreshFollow();
  }

  private onEvent(e: ChronicleEvent): void {
    this.eventCount++;
    // feed item
    const item = el('div', 'feed-item imp' + e.importance + ' kind-' + e.kind);
    item.innerHTML = `<span class="feed-time">day ${Math.floor(e.t / DAY_LENGTH) + 1}</span><span class="feed-text">${e.title}</span>`;
    if (e.x !== undefined || e.organismId !== undefined) {
      item.classList.add('clickable');
      item.addEventListener('click', () => this.goToEvent(e));
    }
    this.feed.appendChild(item);
    this.feedItems.push(item);
    requestAnimationFrame(() => item.classList.add('in'));
    while (this.feedItems.length > 4) {
      const old = this.feedItems.shift()!;
      old.classList.add('out');
      setTimeout(() => old.remove(), 600);
    }
    // fade the item out itself after a while
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => { item.remove(); const i = this.feedItems.indexOf(item); if (i >= 0) this.feedItems.splice(i, 1); }, 600);
    }, 18000 + e.importance * 6000);
    if (e.importance >= 3 || e.kind === 'season' || e.kind === 'arrival') this.titleQueue.push(e);
    if (this.chronicleOpen) this.renderChronicle();
    if (e.kind === 'extinction') this.audio.event('extinction');
    else if (e.importance >= 2) this.audio.event('event');
  }

  private goToEvent(e: ChronicleEvent): void {
    const cam = this.app.cam;
    if (e.organismId !== undefined) {
      const o = this.app.world.byId.get(e.organismId);
      if (o && o.alive) {
        this.app.select(o);
        cam.follow(o.id);
        this.refreshFollow();
        return;
      }
    }
    if (e.x !== undefined && e.y !== undefined) cam.lookAt(e.x, e.y, 60);
  }

  // ---------------------------------------------------------------- per-frame
  update(): void {
    const app = this.app;
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, now - (this.lastFrameT || now));
    this.lastFrameT = now;
    this.updateHover();
    this.updateTitleCard(dt);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.add('hidden');
    }
    if (app.cam.cinematic) {
      this.cinematicTimer -= dt;
      if (this.cinematicTimer <= 0) this.cinematicNext();
    }
    this.audio.update(app.world, app.renderer.atm, dt, app.cam.distance);
    if (this.audio.isOn && (this.frameN++ & 15) === 0) {
      const f = app.cam.focus;
      const wd = app.world.terrain.waterDistAt(Math.max(0, Math.min(255, f.x)), Math.max(0, Math.min(255, f.z)));
      this.audio.setWaterProximity((1 - wd / 25) * Math.max(0, 1 - (app.cam.distance - 20) / 120));
    }
    if (now - this.lastSlow > 0.25) {
      this.lastSlow = now;
      this.updateHud();
      this.updateChips();
      if (app.selected) this.renderInspector(false);
    }
    if (now - this.lastChart > 1.0) {
      this.lastChart = now;
      if (this.almanacOpen) this.renderAlmanac(false);
    }
  }
  private lastFrameT = 0;
  private frameN = 0;

  private updateHud(): void {
    const c = this.app.world.climate;
    const d = c.describeTime();
    const season = d.season.charAt(0).toUpperCase() + d.season.slice(1);
    this.hud.clock.textContent = `Day ${d.day} · ${season} · ${d.phase}`;
    const temp = Math.round(c.baseTemperature);
    this.hud.temp.textContent = `${temp}°`;
    let sky = 'clear';
    let icon = c.isNight ? ICONS.moon : ICONS.sun;
    if (c.rain > 0.15) { sky = temp < 2 ? 'snow' : c.rain > 0.6 ? 'heavy rain' : 'rain'; icon = temp < 2 ? ICONS.snow : ICONS.rain; }
    else if (c.cloudCover > 0.55) { sky = 'overcast'; icon = ICONS.cloud; }
    else if (c.cloudCover > 0.3) sky = 'some cloud';
    if (c.droughtPressure > 0.3) sky = 'drought';
    if (c.windStrength > 0.85) sky += ', windy';
    this.hud.weather.textContent = sky;
    if (this.hud.icon.innerHTML !== icon) this.hud.icon.innerHTML = icon;
    // sun dial: arc from left (rise) to right (set)
    const e = c.sunElevation;
    const f = c.dayFrac;
    const ang = Math.PI * (1 - f); // 0 at midnight (left,below)... simple: map dayFrac 0.25..0.75 to arc
    const t = (f - 0.25) / 0.5;
    const a = Math.PI * (1 - Math.max(0, Math.min(1, t)));
    const cx = 30 + Math.cos(a) * 26, cy = 30 - Math.sin(a) * 26;
    this.hud.dial.setAttribute('cx', cx.toFixed(1));
    this.hud.dial.setAttribute('cy', (e < -0.05 ? 30 : cy).toFixed(1));
    this.hud.dial.setAttribute('fill', e < 0 ? '#b9c6ea' : '#ffd27a');
    void ang;
  }

  private updateChips(): void {
    const s = this.app.stats;
    const latest = s.latest;
    if (!latest) return;
    const hist = s.samples.slice(-90);
    this.chips.grazer.count.textContent = String(latest.species.grazer.count);
    this.chips.hunter.count.textContent = String(latest.species.hunter.count);
    this.chips.veg.count.textContent = Math.round(latest.vegetation * 100) + '%';
    sparkline(this.chips.grazer.spark, hist.map((x) => x.species.grazer.count), SPECIES_COLOR.grazer, { fill: true, min: 0 });
    sparkline(this.chips.hunter.spark, hist.map((x) => x.species.hunter.count), SPECIES_COLOR.hunter, { fill: true, min: 0 });
    sparkline(this.chips.veg.spark, hist.map((x) => x.vegetation), '#6fcf7a', { fill: true, min: 0, max: 1 });
  }

  private updateHover(): void {
    const o = this.app.hovered;
    if (!o || !o.alive || o === this.app.selected) {
      this.hoverLabel.classList.add('hidden');
      return;
    }
    const out = { x: 0, y: 0, depth: 0 };
    const t = this.app.world.terrain;
    const x = o.px + (o.x - o.px) * this.app.alpha, z = o.py + (o.y - o.py) * this.app.alpha;
    if (!this.app.cam.project(x, t.elevationAt(x, z) + 1.6 * o.bodySize, z, out)) {
      this.hoverLabel.classList.add('hidden');
      return;
    }
    this.hoverLabel.classList.remove('hidden');
    this.hoverLabel.style.transform = `translate(${out.x.toFixed(0)}px, ${out.y.toFixed(0)}px) translate(-50%, -100%)`;
    this.hoverLabel.innerHTML = `<b style="color:${SPECIES_COLOR[o.species]}">${o.name}</b> <span>${SPECIES[o.species].name.toLowerCase()} · ${this.describeState(o)}</span>`;
  }

  private describeState(o: Organism): string {
    const w = this.app.world;
    switch (o.state) {
      case 'eat': return o.species === 'hunter' ? 'feeding on carrion' : 'grazing';
      case 'flee': return 'fleeing';
      case 'chase': { const p = w.byId.get(o.targetId); return p ? `hunting ${p.name}` : 'hunting'; }
      case 'rest': return w.climate.isNight ? 'sleeping' : 'resting';
      case 'digest': return 'resting after a hunt';
      case 'seek': return o.species === 'hunter' ? (o.targetCorpse ? 'heading to carrion' : 'roaming') : o.maturity < 0.6 ? 'staying near its mother' : 'looking for pasture';
      default: return o.maturity < 1 ? 'growing up' : 'wandering';
    }
  }

  private updateTitleCard(dt: number): void {
    if (this.titleTimer > 0) {
      this.titleTimer -= dt;
      if (this.titleTimer <= 0) this.titleCard.classList.add('hidden');
      return;
    }
    const e = this.titleQueue.shift();
    if (!e) return;
    const isSeason = e.kind === 'season';
    this.titleCard.className = 'title-card ' + (isSeason ? 'season' : 'major');
    this.titleCard.innerHTML = isSeason ? `<div class="tc-title">${e.title}</div>` : `<div class="tc-eyebrow">${e.kind === 'extinction' ? 'extinction' : e.kind === 'lineage' ? 'a dynasty' : e.kind === 'crash' ? 'collapse' : e.kind === 'arrival' ? 'newcomers' : 'the chronicle'}</div><div class="tc-title">${e.title}</div>${e.detail ? `<div class="tc-detail">${e.detail}</div>` : ''}`;
    this.titleTimer = isSeason ? 4.5 : 6.5;
  }

  // ---------------------------------------------------------------- panels
  private renderAlmanac(full: boolean): void {
    const s = this.app.stats;
    const w = this.app.world;
    const samples = s.samples;
    const a = this.almanacParts;
    areaChart(a.popChart, [
      { values: samples.map((x) => x.species.grazer.count), color: SPECIES_COLOR.grazer, fill: true },
      { values: samples.map((x) => x.species.hunter.count), color: SPECIES_COLOR.hunter, fill: true },
    ], { independent: true });
    areaChart(a.vegChart, [{ values: samples.map((x) => x.vegetation * 100), color: '#6fcf7a', fill: true }]);
    const latest = s.latest;
    if (!latest) return;
    const recent = samples.slice(-15);
    const rate = (sid: SpeciesId, key: 'births' | 'deaths') => recent.reduce((acc, x) => acc + x.species[sid][key], 0) / Math.max(1, recent.length * 2) * DAY_LENGTH;
    a.rates.innerHTML = SPECIES_IDS.map((sid) => `<div><i style="background:${SPECIES_COLOR[sid]}"></i><b>${latest.species[sid].count}</b> ${SPECIES[sid].plural.toLowerCase()} · <span class="up">+${rate(sid, 'births').toFixed(0)}</span> <span class="down">−${rate(sid, 'deaths').toFixed(0)}</span> per day · gen ${latest.species[sid].maxGeneration}</div>`).join('');
    // traits
    const stride = Math.max(1, Math.floor(samples.length / 120));
    for (const sid of SPECIES_IDS) {
      const t = a.traits[sid];
      const sp = latest.species[sid];
      t.header.textContent = sp.count > 0 ? `avg generation ${sp.avgGeneration.toFixed(1)} · oldest line gen ${sp.maxGeneration}` : 'extinct';
      const base = s.baseline;
      for (const g of GENE_SPECS) {
        if (g.key === 'pattern') continue;
        const cv = t.canvases.get(g.key)!;
        const vals: number[] = [];
        for (let i = 0; i < samples.length; i += stride) {
          const ss = samples[i].species[sid];
          if (ss.count > 0) vals.push(ss.avg[g.key]);
        }
        if (g.key === 'hue') {
          // draw the colour itself rather than a number
          const ctx = cv.getContext('2d')!;
          const wpx = cv.clientWidth, hpx = cv.clientHeight;
          if (cv.width !== wpx) { cv.width = wpx; cv.height = hpx; }
          ctx.clearRect(0, 0, wpx, hpx);
          for (let i = 0; i < vals.length; i++) {
            ctx.fillStyle = hueColor(vals[i], 0.55, 0.5);
            ctx.fillRect((i / vals.length) * wpx, hpx * 0.3, wpx / vals.length + 1, hpx * 0.5);
          }
          t.values.get(g.key)!.textContent = sp.count ? describeHue(sp.avg.hue) : '–';
        } else {
          sparkline(cv, vals, SPECIES_COLOR[sid], { marker: base && base.species[sid].count ? base.species[sid].avg[g.key] : undefined });
          const v = sp.avg[g.key];
          const b = base?.species[sid].avg[g.key];
          let arrow = '';
          if (b !== undefined && sp.count > 0) {
            const span = g.max - g.min;
            const d = (v - b) / span;
            arrow = d > 0.04 ? ' <span class="up">▲</span>' : d < -0.04 ? ' <span class="down">▼</span>' : '';
          }
          t.values.get(g.key)!.innerHTML = sp.count ? g.format(v) + arrow : '–';
        }
      }
    }
    if (!full && this.eventCount % 2 !== 0) return;
    // lineages
    const lines: { id: number; n: number; sid: SpeciesId }[] = [];
    const bySpecies = new Map<number, { g: number; h: number }>();
    for (const o of w.organisms) {
      if (!o.alive) continue;
      const e = bySpecies.get(o.lineageId) ?? { g: 0, h: 0 };
      if (o.species === 'grazer') e.g++; else e.h++;
      bySpecies.set(o.lineageId, e);
    }
    for (const [id, c] of bySpecies) {
      if (c.g) lines.push({ id, n: c.g, sid: 'grazer' });
      if (c.h) lines.push({ id, n: c.h, sid: 'hunter' });
    }
    lines.sort((x, y) => y.n - x.n);
    const total: Record<SpeciesId, number> = { grazer: w.counts.grazer, hunter: w.counts.hunter };
    a.lineages.innerHTML = lines.slice(0, 6).map((l) => {
      const share = total[l.sid] ? l.n / total[l.sid] : 0;
      return `<div class="lineage"><span class="lname" style="color:${SPECIES_COLOR[l.sid]}">${w.lineageNames.get(l.id) ?? '?'}</span><div class="lbar"><div style="width:${(share * 100).toFixed(0)}%;background:${SPECIES_COLOR[l.sid]}"></div></div><span class="lnum">${l.n} · ${Math.round(share * 100)}%</span></div>`;
    }).join('') || '<div class="muted">No living lineages.</div>';
    // deaths
    const dc = w.deathCauses;
    const totalD = Object.values(dc).reduce((x, y) => x + y, 0) || 1;
    const causes = (Object.keys(dc) as (keyof typeof dc)[]).filter((k) => dc[k] > 0).sort((x, y) => dc[y] - dc[x]);
    a.deaths.innerHTML = causes.map((k) => `<div class="cause"><span>${k}</span><div class="lbar"><div style="width:${((dc[k] / totalD) * 100).toFixed(0)}%"></div></div><span class="lnum">${dc[k]}</span></div>`).join('') || '<div class="muted">Nothing has died yet.</div>';
  }

  private renderChronicle(): void {
    const evs = this.app.chronicle.events.slice().reverse();
    this.chronicleList.innerHTML = evs.map((e) => `
      <div class="chron-item imp${e.importance} kind-${e.kind}" data-id="${e.id}">
        <div class="chron-time">Day ${Math.floor(e.t / DAY_LENGTH) + 1}</div>
        <div class="chron-body"><div class="chron-title">${e.title}</div>${e.detail ? `<div class="chron-detail">${e.detail}</div>` : ''}</div>
      </div>`).join('');
    this.chronicleList.querySelectorAll('.chron-item').forEach((n) => {
      const id = Number((n as HTMLElement).dataset.id);
      const e = evs.find((x) => x.id === id);
      if (e && (e.x !== undefined || e.organismId !== undefined)) {
        n.classList.add('clickable');
        n.addEventListener('click', () => this.goToEvent(e));
      }
    });
  }

  private renderInspector(full: boolean): void {
    const o = this.app.selected;
    if (!o) return;
    const w = this.app.world;
    const s = this.app.stats;
    const i = this.insp;
    const color = SPECIES_COLOR[o.species];
    if (full) {
      i.name.textContent = o.name;
      i.name.style.color = color;
      i.swatch.style.background = hueColor(o.genes.hue, o.species === 'grazer' ? 0.5 : 0.55, o.species === 'grazer' ? 0.5 : 0.4);
      this.deadShownUntil = 0;
    }
    i.species.textContent = `${SPECIES[o.species].name} · generation ${o.generation}`;
    const lineage = o.lineageName === o.name ? 'founder of a new line' : `of the line of ${o.lineageName}`;
    const parent = o.parentName ? `child of ${o.parentName} · ` : '';
    i.sub.textContent = `${parent}${lineage}`;
    if (!o.alive) {
      i.state.innerHTML = `<span class="dead">died — ${o.cause}</span> at ${fmtDays(o.age, DAY_LENGTH)} old`;
      if (!this.deadShownUntil) this.deadShownUntil = performance.now() + 6000;
      if (performance.now() > this.deadShownUntil) this.app.select(null);
    } else {
      const age = fmtDays(o.age, DAY_LENGTH);
      const life = o.maturity < 1 ? `young (${Math.round(o.maturity * 100)}% grown)` : o.age > o.lifespan * 0.8 ? 'elderly' : 'adult';
      const temp = o.localTemp;
      const comfort = o.comfort > 1.6 ? (temp < o.genes.tempPref ? ' · suffering the cold' : ' · suffering the heat') : o.comfort > 1.25 ? (temp < o.genes.tempPref ? ' · a little cold' : ' · a little warm') : '';
      i.state.innerHTML = `<b>${this.describeState(o)}</b> · ${age} old, ${life}${comfort}`;
    }
    const ef = Math.max(0, Math.min(1, o.energy / o.maxEnergy));
    i.energyBar.style.width = (ef * 100).toFixed(1) + '%';
    i.energyBar.style.background = ef < 0.25 ? '#ff7a6a' : ef < 0.5 ? '#ffc46a' : color;
    const rate = o.netEnergyRate;
    i.energy.textContent = `${Math.round(o.energy)} / ${Math.round(o.maxEnergy)} ${o.alive ? (rate >= 0 ? '▲' : '▼') : ''}`;
    i.stats.innerHTML = `
      <div><span>${o.children}</span>young</div>
      ${o.species === 'hunter' ? `<div><span>${o.kills}</span>kills</div>` : `<div><span>${o.escapes}</span>escapes</div>`}
      <div><span>${Math.round(o.distance)}</span>paces</div>
      <div><span>${Math.round(o.lifespan / DAY_LENGTH)}d</span>lifespan</div>`;
    const sp = s.latest?.species[o.species];
    for (const g of GENE_SPECS) {
      if (g.key === 'hue') continue;
      const row = i.traits.get(g.key)!;
      const mean = sp && sp.count ? sp.avg[g.key] : o.genes[g.key];
      const sd = sp && sp.count ? sp.sd[g.key] : 0;
      traitBar(row.bar, o.genes[g.key], g.min, g.max, mean, sd, color);
      row.val.textContent = g.format(o.genes[g.key]);
    }
    const camo = Math.round(o.camouflage * 100);
    i.camo.innerHTML = `<span class="camo-swatch" style="background:${hueColor(o.genes.hue, 0.5, 0.45)}"></span><span>a coat of ${describeHue(o.genes.hue)}, <b>${camo}%</b> hidden against the ground here</span>`;
    i.log.innerHTML = o.log.slice(-6).reverse().map((l) => `<div><span class="log-t">day ${Math.floor(l.t / DAY_LENGTH) + 1}</span>${l.text}</div>`).join('');
  }
}
