# Engine API (as built, round 1)

`Game/js/engine.js` is a plain script that creates `window.IP`. Every other file is a plain script loaded after it (see `Game/index.html`): register a system and/or scenarios, and that's it. The engine only calls systems that registered. A system that throws is logged once (`IP.errors`, the console, and the F3 overlay) and the frame carries on.

Open it with `node tools/serve.js 8711`, then go to http://localhost:8711/Game/ (add `?scenario=NAME&seed=N&debug=1&aliens=N&scale=0.75`). With no `?scenario`, it runs `IP.defaultScenario`, or `'stress'` when that isn't set.

## Systems
```js
IP.registerSystem('swarm', {
  init(world)  {},          // fresh world, before the scenario fn runs (may be async). Reset your state here.
  start(world) {},          // after the scenario fn populated the world (may be async), e.g. build flow fields
  update(world, dt) {},     // fixed step, dt === 1/60 always
  draw(world, r) {},        // WebGL batcher, world coords (see below)
  drawHud(world, ctx) {},   // 2D canvas, logical 1920x1080, ctx is save()/restore()d around each system
  onInput(world, ev) {},    // input events, delivered inside the tick (deterministic), see Input
});
```
- Systems run in registration (script) order, and re-registering a name replaces it. `IP.system(name)` returns a registered system.
- **Systems run in every scenario.** Guard on your own data (for example `if (!world.swarm) return;`), or have the scenario restrict systems with `opts.systems`.
- Put your data on the world under your name (`world.swarm = {...}`). The shared fields are `world.aliens`, `marines`, `structures`, `projectiles`, `decals`, `selection` (Set), `bp`, `flags`, `events`.
- `world.aliens.length` must be the live alien count, because the capture tool prints it. It can be an array, or an object with `length`.
- `world.events` holds the events pushed during the latest tick. It's cleared at the start of each tick. Push with `IP.emit(world, type, data)`, which returns `{type, tick, ...data}`.

## Scenarios
```js
IP.scenario('mission1', async (world, opts) => { world.map = { w: 4096, h: 4096 }; world.camera = { x, y, zoom: 1 }; ... },
            { systems: ['terrain','swarm', ...] /* optional whitelist */, seed: 1 /* optional default */ });
await IP.loadScenario('mission1', { seed: 7 });   // returns the world
```
`loadScenario` does the following in order:
1. Creates a new world (`seed`, `rng`, `time` and `tick` set to 0, a default map of 3840×2160).
2. Resets input and queued actions.
3. Awaits every system's `init`.
4. Awaits the scenario fn.
5. Awaits every system's `start`.
6. Awaits all pending asset loads.
7. Clamps the camera and renders once.

## Time and RNG
- Fixed 60 Hz. `world.time === world.tick / 60`. The real loop uses an accumulator with at most 5 steps per frame.
- `IP.stepTo(seconds)` runs ticks until `world.time >= seconds`, then renders once (headless). `IP.step(n)` runs n ticks.
- `IP.rng(world)` and `world.rng()` give a mulberry32 float in [0,1), seeded per scenario. Never use `Math.random` or `Date` in sim code or render ordering.
- `IP.fork(world, 'label')` gives an independent seeded stream. Use one per system so that adding RNG calls in one system doesn't shift another.
- Helpers: `IP.rand(world, a, b)`, `IP.randInt(world, a, b)` (inclusive), `IP.pick(world, arr)`, `IP.hash(str)`, `IP.mulberry32(seed)`.
- `IP.budget.aliens` defaults to 3000. It's 1500 on coarse-pointer (touch) devices, and `?aliens=N` overrides it. Respect it in spawners.

## Rendering (`r` in draw)
The world draws in 7 layers, flushed in this order: `ground, decal, shadow, unit, fx, over, screen`.
- All layers except `screen` use **world** coordinates, mapped through the camera.
- `screen` uses logical 1920×1080 screen coordinates (vignettes, full-screen tints).
- Within a layer, draw order is call order, so sort your own units by y before drawing.

Each flush uploads one dynamic VBO and batches up to 8 textures per draw call, so mixing a few sheets in one layer costs nothing. Blending is premultiplied alpha. Pixel-art sheets use nearest filtering.

```js
r.sprite(sheet, frame, x, y, { rot, scale, tint, alpha, layer:'unit', flipX, add, snap })   // anchor (feet) lands on x,y
r.quad(x, y, w, h, rgba, { rot, layer:'fx', tex, uv:[u0,v0,u1,v1], center, add, alpha })      // x,y = top-left (or centre with center:true); rot spins around the centre
r.line(x0, y0, x1, y1, width, rgba, { layer:'fx', dash:[on, off], dashOffset, add, alpha })   // dashed: cyan move orders, tracers
r.circle(x, y, rad, rgba, { layer:'fx', width, add, alpha })   // filled disc, or an anti-aliased ring when width is given
r.poly([x0,y0,x1,y1,...], rgba, { layer, add, alpha })          // convex fan
r.ngon(x, y, rad, sides, rgba, { rot, width, layer, add, alpha }) // hexes: sides 6, rot PI/6 for pointy-top
r.view(margin) -> {x0,y0,x1,y1}   r.inView(x, y, margin)        // culling helpers
r.renderTo(target, {x,y,w,h}, (r) => { ...draw calls... }, { clear: rgba | false })
```
- `rgba` accepts several forms:
  - a CSS string (`'#ff3366'`, `'#ff336680'`, `'rgba(255,51,102,0.5)'`), cached after first parse
  - an array `[r,g,b,a]` with 0..1 floats (or 0..255 when any channel is above 1)
  - a packed number from `IP.rgba(r255, g255, b255, a01)`, which is fastest
- `tint` multiplies the sprite.
- `add: true` makes a draw **additive** (glows, muzzle flashes, explosions) with no state change, so it batches with everything else.
- `opts` is read-only. Reuse one object per loop to avoid garbage, as the stress scene does with its sprite options.
- `snap` defaults to on. Unrotated sprites at scale 1 snap to whole world pixels, and the camera is rounded to whole logical pixels, so nearest-filtered sprites don't shimmer.
- `r.renderTo` draws straight into a render target. It maps the world rect onto the whole target with the top edge at v=0. Use it for persistent layers: accumulate blood or creep into a target once, then draw it each frame as one `r.quad(..., { tex: target })`.

### Textures and targets
```js
const tex = IP.gfx.texture(canvasOrImage, { filter:'nearest'|'linear', wrap:'clamp'|'repeat'|'mirror', mipmap:true, name })
tex.update(newCanvas?)   tex.dispose()   // re-upload after you redraw the source canvas
const rt = IP.gfx.target(w, h, { filter:'linear' })   // also r.target(w,h); rt.onRestore = (rt) => {...} after a context loss
```
- Use a repeat-wrapped, linear, mipmapped texture for painterly ground. Draw it as one big `ground` quad with `uv` scaled for tiling.
- On WebGL context loss (mobile), textures re-upload from their source automatically. Render targets come back empty, so implement `rt.onRestore`.

## Assets and sheets
```js
const sheet = await IP.assets.load('bug_drone')   // Game/assets/sprites/bug_drone.png + .json, cached; loadScenario awaits pending loads
IP.assets.sheet('bug_drone')                       // sync lookup once loaded (or null)
IP.assets.sheetFromCanvas(canvas, meta, { name })  // runtime/placeholder sheets
IP.assets.image(url) / json(url) / text(url) / font(family, url, descriptors) / ready()
```
- A sheet looks like `{ tex, cw, ch, cols, rows, frameCount, ax, ay, anims, meta, frame(dir, anim, i), dir(angle) }`. It reads the factory export meta: `cellWidth/Height`, `rows` (S,SE,E,NE,N,NW,W,SW), `columns`, `animations {idle,walk,attack,(die)}: {from,count,loop}`, and `anchor`.
- `sheet.frame(d, 'walk', i)` gives the frame index. Loop anims wrap. Anims with `loop:false` hold on their last frame.
- `IP.dirIndex(angle)` gives the sheet row for a facing in radians (screen space: +x is east, +y is south). `IP.dirAngle(d)` is the inverse.
- Fonts: ship font files under `Game/assets`, call `IP.assets.font('Chakra Petch', 'assets/fonts/ChakraPetch-SemiBold.woff2', {weight:'600'})` in `init`, and captures will wait for them. No web fonts.

## Camera
- `world.camera = {x, y, zoom}` gives the world point at the screen centre. Zoom 1 means 1 world px per logical px.
- Built-in controls run inside the tick, so they're deterministic:
  - WASD and arrow keys
  - edge scroll (mouse only, off when headless or on touch)
  - middle-drag
  - two-finger drag and pinch
  - wheel zoom (and trackpad ctrl+wheel), toward the cursor
- Camera position and zoom are clamped to `world.map`. The minimum zoom never shows outside the map.
- `IP.cameraControl = { enabled, keys, edge, edgePx, speed, minZoom:0.5, maxZoom:2, wheelStep }`. Turn off `keys` if you need WASD for something else.
- Helpers: `IP.screenToWorld(sx, sy)`, `IP.worldToScreen(wx, wy)`, `IP.viewRect(world, margin)`, `IP.zoomAt(world, sx, sy, zoom)`, `IP.clampCamera(world)`.

## Input (mouse and touch unified, logical coords)
The polled state is `IP.input = { x, y, wx, wy, down, buttons, keys:Set, wheel, justPressed:Set, justReleased:Set, pointers:[], pointerType, inFrame, gesture }`.
- Keys use `KeyboardEvent.code` (`'KeyA'`, `'Space'`, `'Digit1'`, `'ShiftLeft'`).
- `justPressed` and `justReleased` also get `'Mouse0'`, `'Mouse1'` and `'Mouse2'`, plus `'Touch'`.
- `justPressed`, `justReleased` and `wheel` reset after every tick, so they're never missed when a frame runs zero ticks.

Events are handed to `onInput(world, ev)`. Each one has `{type, id, x, y, wx, wy, button, pointerType, consumed?, longpress?, sx, sy}`. The types are:
- `down`, `move`, `up`, `cancel`
- `tap` (released within 350 ms without moving)
- `longpress` (touch held 450 ms without moving; issue orders on this, as on a right-click)
- `dragstart`, `drag`, `dragend` (`sx`/`sy` is where the drag started; use it for box select)
- `wheel` (`deltaY`)
- `keydown`, `keyup` (`key`, which is the code)
- `leave`

**Skip events with `ev.consumed`.** Those belong to a camera gesture (middle-drag, pinch). When a second finger lands, the first finger gets a `cancel` so you can drop a half-made box select.

Mobile rules: nothing may need hover or right-click only. A right-click (`button 2`) and a `longpress` should both issue orders. Touch targets should be at least 44 logical px.

## Headless and capture
- `?headless=1` sets render scale 1, doesn't start the loop, and turns off edge scroll. Systems shouldn't care.
- `IP.capture()` renders and composes WebGL plus the HUD into a 1920×1080 PNG dataURL. The F3 overlay is DOM, so it's never in a capture.
- `IP.queueActions([{t, type, x, y | wx, wy, button, key, deltaY, pointerType}])` scripts input:
  - The types are `click` (down+up+tap), `key` (down, then up next tick), `camera {x, y, zoom}`, plus any event type above.
  - Actions inject at the first tick where `world.time >= t`.
- `IP.measureFps(ms)` runs the real rAF loop and returns `{fps, frames, cpuMs, ticksPerSec, quads, draws}`. Other hooks: `IP.run()`, `IP.stop()`, `IP.paused`, `IP.render()`, `IP.tick()`, `IP.stats`.
- Capture tool:

  ```
  node tools/capture.js --scenario=NAME --t=SECONDS --out=PATH.png [--seed=N] [--actions=JSON|@file.json] [--aliens=N]
        [--fps-ms=2000 | --no-fps] [--gpu=metal|swiftshader] [--viewport=390x844 --dpr=3 --mobile --page] [--debug] [--verbose]
  ```

  - It starts its own static server on a free port and runs headless Chromium on the Metal GPU through ANGLE (`--gpu=swiftshader` gives a CPU fallback).
  - It prints `fps=<n> aliens=<n> cpu_ms=.. quads=.. draws=..`.
  - It exits 1 if any system threw or the page failed.
  - The same args give a byte-identical PNG (checked on both Metal and SwiftShader).
  - `--page` takes a page screenshot at the viewport instead of `IP.capture()`, for phone letterboxing.

## Layout and scaling
- The 1920×1080 frame is letterboxed into the stage, inside the safe areas.
- Render scale is `clamp(fit × devicePixelRatio, 0.5, 1)`. The HUD canvas scales up to 2× for crisp text on hi-DPI screens. `?scale=` or `IP.setRenderScale(s)` overrides both. `IP.capture` always renders at 1.
- Phones held upright show a "rotate to landscape" hint under the frame.

## Built-in `stress` scenario
- It spawns `IP.budget.aliens` 28 px placeholder bugs in six streams flowing at a 5-marine squad.
- It also draws 400 persistent splat decals at most, dashed tracers and move lines, rings, and additive explosions.
- All its art is generated at runtime, so it needs no assets.

Measured on an M1 Max in headless Chromium, real rAF:

| Aliens | fps | cpu |
| --- | --- | --- |
| 3000 | 60 | ≈1 ms per frame, 6 draw calls |
| 10000 | 60 | 3.2 ms |
| 30000 | 60 | 14 ms |
| 60000 | 18 | |

At 30k aliens, a tick costs 2.6 ms and a render 8.6 ms. About 1.5 ms of the render is the scene's y-sort, so the batcher costs roughly 0.2 µs per sprite.
