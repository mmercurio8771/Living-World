# Living World

A window into a tiny ecosystem. An island of grazers, hunters and pasture that grows, hunts, breeds, evolves and dies on its own, rendered as a lit, shadowed, weathered little place you can pan around, zoom into, and disrupt.

## Launch

```bash
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173). A production build is `npm run build` followed by `npm run preview`, or serve the `dist/` folder from any static host.

Add `?seed=anything` to the address to get a specific island back. Each seed is a different island, climate and founding population.

`npm run sim -- 20 7` runs the same ecosystem headlessly in Node for 20 sim-minutes on seed 7 and prints the population and trait log. `--exp=blight|drought|fast|cold|sun|nohunters` applies an experiment at the 5-minute mark.

## Previewing without a local setup

- **Single file.** `npm run build:single` writes `dist/living-world.html`, one self-contained page that runs when opened straight from disk. No server, no install.
- **GitHub Pages.** The workflow in `.github/workflows/pages.yml` builds and publishes the app on every push. Turn it on once under the repository's Settings → Pages → Source: *GitHub Actions*. The site then lives at `https://<owner>.github.io/<repo>/`.

## Controls

| Action | Input |
| --- | --- |
| Pan | drag, or WASD / arrow keys |
| Orbit | right-drag (or ctrl-drag), Q / E |
| Zoom | scroll or pinch, + / − |
| Inspect a creature | click it, F to follow it with the camera |
| Pause, speed | space, 1–4 for 1×/2×/4×/8× |
| Cinematic camera | C |
| Ambient sound | M |
| Shape the environment | E |
| Almanac (charts, traits, dynasties) | A, or click a population chip |
| Chronicle (the story so far) | L, or the Chronicle button |

## The rules of the world

**The island.** Terrain is generated from warped fractal noise with a ridged mountain spine and an island falloff, so the sea is the natural edge of the world. Height and moisture give every patch a fertility, which is the carrying capacity of its pasture. Beaches, rock and snow grow nothing.

**Climate.** A day is 60 seconds, a year is four days. Temperature depends on season, time of day, latitude (north is colder), altitude, and cloud cover. Weather drifts as a slow noise process: cloud cover builds into rain, wind changes direction and strength. Winter lowers the snow line; cold snaps and droughts are transient pressures that decay.

**Pasture.** A 128×128 grid of biomass grows logistically with light, warmth and moisture, seeds into bare neighbours, withers in cold and drought, and is eaten. Bodies rot into nutrients that raise the local capacity for a while, so a massacre is followed by a bloom.

**Grazers** eat pasture. They scan for hunters, flee when one comes inside their personal flight distance, look for greener cells when hungry, drift in loose herds (alignment and cohesion), rest at night when fed, and juveniles trail their mother.

**Hunters** eat grazers and carrion. They pick prey that is near, small, slow, or resting, sprint for a short burst (sprinting costs energy in proportion to speed squared, and faster sprinters tire sooner), and the catch is a probability set by the speed and size difference, with a bonus for ambushing something asleep or grazing. After a kill they rest and digest, and they share meat with their cubs nearby. Failed chases leave them winded.

**Energy.** Basal cost scales with body mass to the 0.75 (Kleiber), movement cost with mass × speed², and every creature pays extra when the local temperature is far from its preferred one, with small bodies feeling it more (Bergmann's rule). Young are born from a fixed share of the parent's storage split among the litter, so big litters mean lean, risky young.

**Death** comes from starvation, cold or heat, old age (lifespan grows with size), predation, fire, or the player's hand. If a species is nearly gone for long enough, a small band may arrive from across the water, which you can switch off.

## What can evolve

Every creature carries nine inherited traits, each mutated a little at birth (the mutation rate is a slider):

| Trait | Benefit | Cost |
| --- | --- | --- |
| Size | more storage, harder to kill, longer life, holds heat | higher upkeep, more visible |
| Speed | catches or escapes | movement cost ∝ speed², sprints tire faster |
| Vision | finds food and threats sooner | upkeep grows with vision² |
| Boldness | grazers graze longer before fleeing; hunters chase longer and take bigger prey | gets caught; wastes energy on long chases |
| Breeding threshold | well-provisioned young | fewer births |
| Litter size | more young | each starts leaner |
| Preferred temperature | comfort in a climate band | discomfort everywhere else |
| Hue | camouflage against the ground where it stands | none directly, so it drifts until predation pushes it |
| Markings | visual only | none |

Traits show in the bodies: size and maturity set scale, faster creatures are longer and leaner, hue is the coat, markings are stripes or dapples. Grazers can turn green because green ones survive on green ground, then dun again when they have grazed it bare.

## Things I watched happen

These came out of the rules, not scripts, across dozens of headless and on-screen runs:

- **Seasonal boom and bust.** Grazers overshoot every summer, strip the pasture, and crash in the first winter, then recover in spring. Predators lag behind by about a season, so the population chart draws the classic coupled oscillation.
- **Predators evolving speed, prey evolving caution.** In most runs hunters' average speed climbed from 1.05 to 1.3–1.5 over ten generations, and grazers responded by fleeing earlier or by getting faster themselves.
- **Vision is only worth it when something is watching.** With few hunters, grazer vision decays generation by generation because it costs energy; introduce fast hunters and it climbs back up within a few days.
- **Camouflage emerging.** Grazer coats drifted from tan toward olive and green over long runs. The chronicle records it as "changing colour".
- **The fast-hunter experiment.** Releasing eight hunters bred for speed at minute five drove the grazer population down by 80 percent, the fast lineage swept the hunter population (average speed 1.15 to 1.62), and then the hunters collapsed to a handful once there was nothing left to catch.
- **Dynasties.** A single founder's line regularly ends up holding half a species, and the chronicle names them.
- **Cold adaptation.** Preferred temperature drifted downward by a few degrees across winters in every run, and larger bodies were favoured in cold spells.

## Techniques worth mentioning

- **Two clocks.** The simulation runs at a fixed 30 ticks per second with a per-frame time budget; rendering interpolates between the last two ticks, so 8× speed stays smooth and a slow machine degrades gracefully instead of spiralling.
- **The pasture is a texture.** Biomass is uploaded as a 128×128 texture. The terrain shader blends earth, straw and lush green from it, and every grass tuft reads its own cell in the vertex shader to set its height, so grazing visibly flattens and browns the land with zero per-tuft CPU work.
- **Creatures animate on the GPU.** Both species are single instanced meshes whose vertices carry a part id. The vertex shader swings legs by gait phase, dips the head when grazing, folds the legs when resting, wags the tail, and adds a breathing pulse, from four floats per instance.
- **One light that becomes the moon.** Sun colour, intensity, sky gradient, hemisphere fill, fog and exposure are keyframed by sun elevation; at night the same directional light takes the moon's bearing and colour. The shadow frustum follows the camera and snaps to texels to avoid shimmer.
- **Cloud shadows in every material.** A tileable noise texture scrolls with the wind and darkens terrain, plants and creatures alike through a shared shader chunk.
- **Water from a heightmap.** The sea reads the terrain height texture for depth colour, shoreline foam and caustic shimmer, with sun glitter and rain rings.
- **Procedural sound.** Wind, rain, crickets, birdsong and shoreline water are synthesised with the Web Audio API; nothing is sampled.
- **Story detection.** A chronicle watches the statistics for extinctions, crashes, booms, recoveries, trait shifts, colour drift, dynasties, record ages and generation milestones, and turns them into titled events you can click to jump to.

## Project layout

```
src/sim/      pure simulation: terrain, climate, vegetation, genome, behaviour, world, stats, chronicle
src/render/   Three.js scene: sky, lighting, terrain, water, vegetation, creatures, particles, camera, post
src/ui/       the overlay: HUD, transport, almanac, environment, chronicle, inspector
src/audio/    procedural ambience
scripts/      headless runner
```
