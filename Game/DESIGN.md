# Infested Planet Gauntlet: the contract

Goal: recreate **Infested Planet** (five marines vs 100,000 aliens; Steam app 204530). The bar is its official
1920×1080 Steam screenshots in `docs/ImageRefs/InfestedPlanet/ip_01..12.jpg`, full frame, HUD and all, judged
blind against our own 1080p captures. Units use this repo's Mecha Factory art (baked sprite sheets). PC first
(mouse + keyboard), mobile later (touch, lower unit budgets), so nothing may assume a mouse-only or desktop-only world.

Read this whole file before building or judging. The builder of a piece owns ONLY the files listed for it.

## What the bar looks like (read the shots yourself; this is the summary)
- Pure top-down 2D. Painterly, mottled ground: olive/khaki "bog" variant (ip_01, ip_05) or black/violet basalt variant
  (ip_02, ip_09). Impassable terrain is organic: olive tendril/tentacle banks with soft rim light, or dark rock with
  magenta glowing edges.
- Aliens: dense swarms of small teal/blue bugs with green-yellow highlights, ~16–22 px each, hundreds on screen, flowing
  like liquid along paths toward the marines. Mutations add bigger variants.
- Hives: dark hexagonal organic spawners with a pink/green mouth, surrounded by small hex nodes. Bases: dark hex
  structures with yellow hex build nodes around them.
- Marines: five tiny units (~40 px) each in a pink/red circular selection ring with cyan dotted move-order lines.
  Weapons: red dotted rifle tracers, white sniper streaks, orange fusion blobs, medic crosses.
- Gore: huge magenta/pink blood splatter decals that persist, orange explosions, white "shred" bursts.
- HUD: top-left magenta "05 BP" + yellow AMMO bar; top-center five marine cards in cyan hex-cut frames (name, red HP bar,
  weapon silhouette; a dead one greys out with an X); right edge stack of hex buttons with yellow biohazard icons
  (alien mutations); bottom-left hex buttons (build/research); bottom-right hex buttons (attack-move, retreat, weapon).
  Font: a techno sans very close to Chakra Petch (already used by the factory UI; ship it locally, no web fonts).

## Pieces (each is built, captured, and judged independently)
| id | what | owns |
| --- | --- | --- |
| engine | WebGL2 sprite/quad batcher, fixed 60 Hz sim, 1920×1080 logical frame scaled to fit, deterministic seeded RNG, input (pointer + keys + touch), camera, scenario registry, headless capture | `Game/index.html`, `Game/js/engine.js`, `Game/css/game.css`, `tools/capture.js` |
| bake | `tools/bake.js`: bake Mecha Factory blueprints into sprite sheets + JSON the engine loads; the marine roster | `tools/bake.js`, `Game/assets/roster.json`, `Game/assets/sprites/*` |
| alien-art | a `bug` product line in the factory (small alien bugs with mutation variants), bakeable at 32 px cells | `js/bugs.js` (+ its script tag and line registration in the factory), `Game/assets/aliens.json` |
| world-look | 3 competing world-look specs with example images; the pick drives terrain + vfx palettes | `docs/WORLD-LOOK.md`, `Game/progress/shots/world-*` |
| terrain | painterly ground + organic impassable banks + spreading creep around hives, map data and passability | `Game/js/terrain.js` |
| swarm | aliens: flow-field pathing, spatial hash, separation, attack, death; 3,000+ on screen at 60 fps | `Game/js/swarm.js` |
| marines | squad of 5: selection (click, box), move, attack-move, hold; auto-targeting; weapons (rifle, sniper, flamer/fusion, rocket, medic); HP, death | `Game/js/marines.js` |
| structures | hives (spawn aliens, capturable), base, hex nodes, turrets/barricades buildable with BP | `Game/js/structures.js` |
| vfx | tracers, muzzle flashes, persistent blood decal layer, explosions, corpses, shred bursts, shake | `Game/js/vfx.js` |
| hud | the full HUD on the 2D overlay canvas: BP/ammo, marine cards, side hex buttons, alerts, objective text, dialogue box | `Game/js/hud.js` |
| game | mission flow: capture every hive to win, BP economy and upgrades, alien mutations, lose when the squad dies; scenarios for captures | `Game/js/game.js`, `Game/js/scenarios.js` |
| composite | nothing new: the full-frame A/B of the whole game; its gaps are routed back to the pieces | — |

Script load order in `Game/index.html`: engine, terrain, swarm, marines, structures, vfx, hud, game, scenarios.
Every file is a plain script that registers onto the global `IP` namespace (no modules, no bundler, no npm runtime deps).
The game runs over http from `node tools/serve.js 8711` → http://localhost:8711/Game/ (WebGL textures from `file://`
images are tainted in Chrome, so `file://` is best-effort only). The capture tool starts its own static server on a free
port (reuse `tools/serve.js`) and loads the page over http. Missing systems must not break the page: the engine only calls
systems that registered. Assets are `Game/assets/sprites/<name>.png` + `<name>.json` (the factory's export meta:
cellWidth/Height, rows S,SE,E,NE,N,NW,W,SW, columns, animations {idle,walk,attack}, anchor) loaded with fetch + Image.

## Engine API (the engine builder implements this; everyone else codes against it)
```js
IP.registerSystem(name, { init(world), update(world, dt), draw(world, r), drawHud(world, ctx), onInput(world, ev) })
// systems run in registration (script) order. dt is always 1/60. draw gets the WebGL batcher r, drawHud gets the 2D ctx.
IP.world = { seed, rng, time, tick, map, camera:{x,y,zoom}, aliens:[], marines:[], structures:[], projectiles:[],
             decals, selection:Set, bp, flags:{}, events:[] }          // systems add their own fields under their name
IP.rng(world)         // seeded, deterministic (mulberry32); never Math.random in sim code
IP.loadScenario(name) // resets world and runs scenarios[name](world)
IP.scenario(name, fn) // register a scenario
IP.stepTo(seconds)    // headless: run fixed steps until world.time >= seconds, then render once
IP.capture()          // returns a PNG dataURL of the composed 1920×1080 frame (world + HUD)
r.sprite(sheet, frame, x, y, { rot, scale, tint, alpha, layer })   // layers: ground, decal, shadow, unit, fx, over
r.quad(x, y, w, h, rgba, { rot, layer, tex, uv })  r.line(x0,y0,x1,y1,width,rgba,{layer,dash})  r.circle(x,y,rad,rgba,{layer,width})
IP.assets.load(name) // loads Game/assets/sprites/<name>.png + .json (8 direction rows, columns idle/walk/attack(/die))
IP.input: { x, y, down, buttons, keys:Set, wheel, justPressed:Set, justReleased:Set, pointers:[] }  // logical coords
```
Capture tool contract: `node tools/capture.js --scenario=NAME --t=SECONDS --out=PATH.png [--seed=N] [--actions=JSON]`
produces an exact 1920×1080 PNG and prints `fps=<measured>` and `aliens=<count>` on stdout; two runs with the same
args must produce byte-identical PNGs.

## Mobile-safe rules (so we don't paint ourselves into a corner)
- All input through pointer events with logical coordinates; nothing requires hover or right-click only (right-click
  and long-press both issue orders; a toggle button gives attack-move).
- Unit budgets are data (`IP.budget.aliens`), defaulting to 3,000 on PC; render cost per alien is one textured quad.
- Logical 1920×1080 scaled to any viewport; HUD anchored to edges; touch targets ≥ 44 px logical.
- No web fonts, no fetches to the internet, assets are files under `Game/assets`.

## Progress log (mandatory, every round)
`node tools/progress.js --piece=<id> --round=<n> --role=builder|critic --status=working|done|pass|fail|info|pick
 --score=<0-10> --model=<model> --text="..." --img=Game/progress/shots/a.png,b.png --ab=Game/progress/shots/ab-<id>-r<n>`
Captures go in `Game/progress/shots/<id>-r<n>-<what>.png`. Never delete earlier rounds' shots. Never run git commands.
The page is `Game/progress/index.html` served by `node tools/serve.js 8711` → http://localhost:8711/Game/progress/

## Critic protocol
A critic has fresh context and is deliberately harsh. It must:
1. Run the real thing (capture tool, bake tool, factory page) itself; never trust the builder's description.
2. Blind A/B: `python3 tools/ab.py --ours <capture> --ref docs/ImageRefs/InfestedPlanet/ip_XX.jpg --out Game/progress/shots/ab-<id>-r<n> [--crop x,y,w,h --refcrop x,y,w,h]`,
   view A.png and B.png with the image reader, write the verdict (which would you rather play, why, biggest gap) and
   only THEN read key.json.
3. Score 0–10 where 10 = indistinguishable from or better than the bar for this piece. `pass` only when the critic would
   rather play ours in the blind A/B. Name the single biggest gap first; the builder's next round starts there.
4. Log the verdict with the A/B directory so the page shows the pair.

## Phase 2 additions (orchestrator, after phase 1)

### Shared entity contract (every system reads these; the owner listed writes them)
```js
// aliens (owner: swarm). world.aliens is an array; dead aliens are removed by swarm.
{ id, kind:'drone'|'runner'|'spitter'|'brute'|'tank', x, y, vx, vy, r /*collision radius px*/, dir /*rad, screen space*/,
  hp, maxHp, speed, state:'move'|'attack'|'dead', targetId, sheet /*asset name*/, variant, anim:'walk'|'attack'|'idle', frame, hitT /*last hit time*/ }
// marines (owner: marines). Five at most; dead ones stay in the array with state 'dead' so the HUD can grey the card.
{ id, name, cls:'rifle'|'sniper'|'fusion'|'medic'|'rocket', x, y, r, dir, hp, maxHp, state:'idle'|'move'|'attack'|'dead',
  order:{ type:'move'|'attack-move'|'hold', x, y }|null, weapon:{ kind, range, dps, cooldown, ammo, maxAmmo }, sheet, anim, frame, selected }
// structures (owner: structures). Hives spawn aliens; nodes are hex build slots; base/turret/barricade are player builds.
{ id, kind:'hive'|'node'|'base'|'turret'|'barricade', owner:'alien'|'player', x, y, r, hp, maxHp, state, spawn:{kinds, rate}|null }
// projectiles (owner: whoever fires; marines and structures): { kind:'rocket'|'spit'|'flame', x, y, vx, vy, dmg, ttl, owner }
// events (IP.emit; owner: whoever causes it). vfx and hud consume them in the same tick (world.events is cleared each tick):
'shot'        { x, y, tx, ty, weapon:'rifle'|'sniper'|'fusion'|'medic'|'rocket'|'turret', hit:bool }   // hitscan tracer from (x,y) to (tx,ty)
'hit'         { x, y, dmg, targetKind:'alien'|'marine'|'structure' }
'alien-died'  { x, y, kind, dir, cause }     // vfx paints blood + corpse here
'marine-died' { x, y, name }
'explosion'   { x, y, r, kind:'rocket'|'spitter'|'hive' }
'hive-captured' { id, x, y }   'structure-built' { id, kind }   'mutation' { name, desc }   'order' { type, x, y }
```
Damage flow: marines/structures subtract alien hp and emit 'hit'; swarm notices hp <= 0, emits 'alien-died', removes.
Aliens subtract marine/structure hp and emit 'hit'; marines/structures handle their own death and emit it.
Cross-system calls, all optional (guard with `IP.swarm && ...`): `IP.swarm.spawn(world, {x, y, kind, n})`,
`IP.terrain.passable(world, x, y)`, `IP.terrain.flowTo(world, x, y)` (a flow field toward a point), `IP.terrain.creepAt(world, x, y)`,
`IP.marines.nearest(world, x, y)`, `IP.structures.nearestEnemy(world, x, y)`. Spatial lookups: `IP.grid` (engine; see README-engine.md if present, else build your own hash in your file).
Each builder registers a demo scenario in its own file (`IP.scenario('<piece>-demo', fn, {systems:[...]})`) that stands up
stub entities for anything it needs from a piece that is not built yet, following the shapes above exactly.
`node tools/capture.js --systems=a,b` runs only those systems, so a half-written neighbour can't break your capture.

### Biomes
Terrain exposes `world.terrain.biome` = 'basalt' (default) | 'bog'. Both ship. The critic compares basalt captures with
ip_02/ip_09 and bog captures with ip_01/ip_05. The round-3 world-look brief (in the progress log) is the recipe to port.

### Font
`Game/assets/fonts/ChakraPetch-{400,500,600,700}.woff2` are in the repo (SIL OFL). Load with IP.assets.font.

## Clarified bar (user, 2026-10-05)
Infested Planet's screenshots are the bar for **gameplay and on-screen density** only: five marines vs hundreds of aliens,
liquid swarm streams, hives, capture loop, readability with a lot happening. They are **not the art bar**. The art target is
**polished StarCraft Remastered / Warcraft 3 quality in the Mecha Factory style** (docs/STYLE.md: chunky chamfered forms,
5-step hue-shifted ramps, 1 px outlines, dusk key + cool rim), for the world, the marines AND the aliens. Critics judge
behaviour/density against Infested Planet and judge art for polish and style consistency, never for likeness to Infested
Planet. The world look is being chosen from Grok Imagine samples (docs/ImageRefs/WorldLook/ once saved).
