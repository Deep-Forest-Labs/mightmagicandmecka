/* Infested Planet Gauntlet: engine.
 * WebGL2 quad/sprite batcher with layers, fixed 60 Hz simulation, seeded RNG, unified pointer/key input, camera,
 * system + scenario registry, asset loading and headless capture. Plain script; registers onto window.IP.
 * API reference for other builders: Game/js/README-engine.md
 */
(function () {
  'use strict';
  const IP = (window.IP = window.IP || {});
  const W = 1920, H = 1080, STEP = 1 / 60, TAU = Math.PI * 2;
  IP.W = W; IP.H = H; IP.STEP = STEP; IP.version = 'engine-r1';

  const qs = new URLSearchParams(location.search);
  IP.params = qs;
  IP.headless = qs.has('headless') && qs.get('headless') !== '0';
  const coarse = !IP.headless && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  IP.mobile = coarse;
  IP.budget = IP.budget || {};
  IP.budget.aliens = qs.has('aliens') ? Math.max(0, +qs.get('aliens') | 0) : (IP.budget.aliens || (coarse ? 1500 : 3000));

  // ---------------------------------------------------------------- RNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { // FNV-1a
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  IP.mulberry32 = mulberry32;
  IP.hash = hashStr;
  IP.rng = (world) => (world || IP.world).rng();
  IP.rand = (world, a, b) => a + (b - a) * world.rng();
  IP.randInt = (world, a, b) => a + Math.floor((b - a + 1) * world.rng());
  IP.pick = (world, arr) => arr[Math.floor(world.rng() * arr.length)];
  // An independent deterministic stream so one system's draws never shift another's.
  IP.fork = (world, label) => mulberry32((world.seed ^ hashStr(label)) >>> 0);

  // ---------------------------------------------------------------- colors
  const colorCache = new Map();
  const pack = (r, g, b, a) => ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
  function parseCss(s) {
    s = s.trim();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
      return pack((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
    }
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
      return pack(Math.round(p[0]), Math.round(p[1]), Math.round(p[2]), Math.round((p[3] === undefined ? 1 : p[3]) * 255));
    }
    return 0xffffffff;
  }
  function toColor(c) {
    if (typeof c === 'number') return c >>> 0;
    if (c == null) return 0xffffffff;
    if (typeof c === 'string') {
      let v = colorCache.get(c);
      if (v === undefined) { v = parseCss(c); colorCache.set(c, v); }
      return v;
    }
    const k = c[0] > 1 || c[1] > 1 || c[2] > 1 ? 1 : 255;
    return pack(Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k), Math.round((c[3] === undefined ? 1 : c[3]) * 255));
  }
  function withAlpha(c, a) {
    if (a === undefined || a === null || a >= 1) return c;
    const al = Math.round(((c >>> 24) & 255) * (a > 0 ? a : 0));
    return ((c & 0xffffff) | (al << 24)) >>> 0;
  }
  IP.rgba = (r, g, b, a = 1) => pack(r, g, b, Math.round(a * 255));
  IP.color = toColor;
  IP.withAlpha = withAlpha;

  // ---------------------------------------------------------------- math helpers
  const DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
  IP.DIRS = DIRS;
  // Sheet row for a facing angle (radians, screen space: +x east, +y south).
  IP.dirIndex = (angle) => ((Math.round((Math.PI / 2 - angle) / (Math.PI / 4)) % 8) + 8) % 8;
  IP.dirAngle = (d) => Math.PI / 2 - d * (Math.PI / 4);
  IP.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  IP.lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------- world, systems, scenarios
  function newWorld(seed) {
    return {
      seed, rng: mulberry32(seed), time: 0, tick: 0, dt: STEP,
      map: { w: 3840, h: 2160 }, camera: { x: 1920, y: 1080, zoom: 1 },
      aliens: [], marines: [], structures: [], projectiles: [], decals: [],
      selection: new Set(), bp: 0, flags: {}, events: [], scenario: null, systems: [],
    };
  }
  IP.newWorld = newWorld;
  IP.world = newWorld(1);

  const systems = [];
  IP.systems = systems;
  IP.registerSystem = function (name, sys) {
    sys.name = name;
    const i = systems.findIndex((s) => s.name === name);
    if (i >= 0) systems[i] = sys; else systems.push(sys);
    return sys;
  };
  IP.system = (name) => systems.find((s) => s.name === name) || null;

  const scenarios = {};
  IP.scenarios = scenarios;
  IP.scenario = function (name, fn, opts) { scenarios[name] = { fn, opts: opts || {} }; };
  IP.emit = (world, type, data) => { const e = Object.assign({ type, tick: world.tick }, data); world.events.push(e); return e; };

  const errors = [];
  IP.errors = errors;
  const errSeen = new Set();
  function reportErr(where, e) {
    const key = where + ':' + (e && e.message);
    if (errSeen.has(key)) return;
    errSeen.add(key);
    errors.push(key);
    console.error('[IP] ' + where + ' threw:', e);
  }
  function callSys(s, fn, a, b) {
    const f = s[fn];
    if (!f) return undefined;
    try { return f.call(s, a, b); } catch (e) { reportErr(s.name + '.' + fn, e); return undefined; }
  }

  IP.loadScenario = async function (name, o) {
    o = o || {};
    const sc = scenarios[name];
    if (!sc) throw new Error('unknown scenario "' + name + '" (have: ' + Object.keys(scenarios).join(', ') + ')');
    const seed = (o.seed != null && o.seed !== '' ? +o.seed : sc.opts.seed != null ? sc.opts.seed : 1) >>> 0;
    const world = newWorld(seed);
    world.scenario = name;
    world.opts = o;
    IP.world = world;
    let want = o.systems != null ? o.systems : sc.opts.systems;   // loadScenario(name, {systems:'a,b'|[...]}) overrides the scenario's whitelist
    if (typeof want === 'string') want = want.split(',').map((x) => x.trim()).filter(Boolean);
    world.systems = want ? systems.filter((s) => want.includes(s.name)) : systems.slice();
    resetInput();
    actions.length = 0;
    acc = 0;
    for (const s of world.systems) if (s.init) { try { await s.init(world); } catch (e) { reportErr(s.name + '.init', e); } }
    await sc.fn(world, o);
    for (const s of world.systems) if (s.start) { try { await s.start(world); } catch (e) { reportErr(s.name + '.start', e); } }
    await IP.assets.ready();
    clampCamera(world);
    if (gfx.gl) render();
    return world;
  };

  // ---------------------------------------------------------------- fixed-step simulation
  let acc = 0;
  function tick() {
    const world = IP.world;
    world.events.length = 0;
    injectActions(world);
    processInput(world);
    cameraControl(world);
    const sys = world.systems;
    for (let i = 0; i < sys.length; i++) if (sys[i].update) callSys(sys[i], 'update', world, STEP);
    world.tick++;
    world.time = world.tick / 60;
    input.justPressed.clear();
    input.justReleased.clear();
    input.wheel = 0;
  }
  IP.tick = tick;
  IP.stepTo = function (seconds) {
    const world = IP.world;
    let guard = 0;
    while (world.time < seconds - 1e-9 && guard++ < 1e6) tick();
    render();
    return world;
  };
  IP.step = function (n) { for (let i = 0; i < (n || 1); i++) tick(); render(); return IP.world; };

  // ---------------------------------------------------------------- scripted actions (capture --actions)
  const actions = [];
  // Each action: { t, type, x, y | wx, wy, button, key, deltaY, id, pointerType }
  // type: down | up | move | tap | longpress | dragstart | drag | dragend | wheel | keydown | keyup | key | click | camera
  IP.queueActions = function (list) {
    for (const a of list || []) actions.push(Object.assign({}, a));
    actions.sort((a, b) => (a.t || 0) - (b.t || 0));
  };
  function injectActions(world) {
    while (actions.length && (actions[0].t || 0) <= world.time + 1e-9) {
      const a = actions.shift();
      if (a.type === 'camera') {
        const c = world.camera;
        if (a.x != null) c.x = a.x; if (a.y != null) c.y = a.y; if (a.zoom != null) c.zoom = a.zoom;
        clampCamera(world);
        continue;
      }
      let x = a.x, y = a.y;
      if (a.wx != null) { const s = IP.worldToScreen(a.wx, a.wy, world); x = s.x; y = s.y; }
      const base = { id: a.id != null ? a.id : 1, x: x != null ? x : input.x, y: y != null ? y : input.y, button: a.button || 0, pointerType: a.pointerType || 'mouse', synthetic: true };
      if (a.type === 'click') {
        queue.push(Object.assign({ type: 'down' }, base), Object.assign({ type: 'up' }, base), Object.assign({ type: 'tap' }, base));
      } else if (a.type === 'key') {
        queue.push({ type: 'keydown', key: a.key, synthetic: true });
        actions.unshift({ t: world.time + STEP, type: 'keyup', key: a.key });
      } else if (a.type === 'keydown' || a.type === 'keyup') {
        queue.push({ type: a.type, key: a.key, synthetic: true });
      } else if (a.type === 'wheel') {
        queue.push(Object.assign({ type: 'wheel', deltaY: a.deltaY || 0 }, base));
      } else {
        queue.push(Object.assign({ type: a.type, sx: a.sx, sy: a.sy }, base));
      }
    }
  }

  // ---------------------------------------------------------------- camera
  IP.cameraControl = {
    enabled: true, keys: true, edge: !IP.headless && !coarse, edgePx: 6, speed: 1100,
    minZoom: 0.5, maxZoom: 2, wheelStep: 1.12,
  };
  function zoomLimits(world) {
    const cc = IP.cameraControl, m = world.map;
    const fit = Math.max(W / m.w, H / m.h);
    return [Math.max(cc.minZoom, Math.min(fit, cc.maxZoom)), cc.maxZoom];
  }
  function clampCamera(world) {
    const c = world.camera, m = world.map;
    const [zmin, zmax] = zoomLimits(world);
    c.zoom = IP.clamp(c.zoom, zmin, zmax);
    const hw = W / 2 / c.zoom, hh = H / 2 / c.zoom;
    c.x = m.w <= hw * 2 ? m.w / 2 : IP.clamp(c.x, hw, m.w - hw);
    c.y = m.h <= hh * 2 ? m.h / 2 : IP.clamp(c.y, hh, m.h - hh);
  }
  IP.clampCamera = clampCamera;
  IP.screenToWorld = (sx, sy, world) => { const c = (world || IP.world).camera; return { x: c.x + (sx - W / 2) / c.zoom, y: c.y + (sy - H / 2) / c.zoom }; };
  IP.worldToScreen = (wx, wy, world) => { const c = (world || IP.world).camera; return { x: (wx - c.x) * c.zoom + W / 2, y: (wy - c.y) * c.zoom + H / 2 }; };
  IP.viewRect = (world, margin) => {
    const c = (world || IP.world).camera, m = margin || 0;
    const hw = W / 2 / c.zoom, hh = H / 2 / c.zoom;
    return { x0: c.x - hw - m, y0: c.y - hh - m, x1: c.x + hw + m, y1: c.y + hh + m };
  };
  function zoomAt(world, sx, sy, z) {
    const c = world.camera;
    const [zmin, zmax] = zoomLimits(world);
    z = IP.clamp(z, zmin, zmax);
    const wx = c.x + (sx - W / 2) / c.zoom, wy = c.y + (sy - H / 2) / c.zoom;
    c.zoom = z;
    c.x = wx - (sx - W / 2) / z;
    c.y = wy - (sy - H / 2) / z;
  }
  IP.zoomAt = zoomAt;
  function cameraControl(world) {
    const cc = IP.cameraControl;
    if (!cc.enabled) { clampCamera(world); return; }
    const c = world.camera, k = input.keys;
    let dx = 0, dy = 0;
    if (cc.keys) {
      if (k.has('KeyA') || k.has('ArrowLeft')) dx -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) dy -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) dy += 1;
    }
    if (cc.edge && input.inFrame && input.pointerType === 'mouse' && !gesture) {
      if (input.x <= cc.edgePx) dx -= 1; else if (input.x >= W - 1 - cc.edgePx) dx += 1;
      if (input.y <= cc.edgePx) dy -= 1; else if (input.y >= H - 1 - cc.edgePx) dy += 1;
    }
    if (dx || dy) {
      const l = Math.hypot(dx, dy), v = (cc.speed / c.zoom) * STEP;
      c.x += (dx / l) * v; c.y += (dy / l) * v;
    }
    clampCamera(world);
    const wp = IP.screenToWorld(input.x, input.y, world);
    input.wx = wp.x; input.wy = wp.y;
  }

  // ---------------------------------------------------------------- input
  const input = (IP.input = {
    x: W / 2, y: H / 2, wx: 0, wy: 0, down: false, buttons: 0, keys: new Set(), wheel: 0,
    justPressed: new Set(), justReleased: new Set(), pointers: [], pointerType: 'mouse', inFrame: false, gesture: null,
  });
  const queue = [];
  IP.inputQueue = queue;
  let gesture = null; // tick-side camera gesture: {kind:'pan', id, lx, ly} | {kind:'pinch', a, b, cx, cy, d}
  const gestured = new Set(); // pointer ids whose remaining events belong to a camera gesture
  function resetInput() {
    queue.length = 0;
    input.pointers.length = 0;
    input.keys.clear(); input.justPressed.clear(); input.justReleased.clear();
    input.down = false; input.buttons = 0; input.wheel = 0; input.gesture = null;
    gesture = null; gestured.clear();
  }
  IP.resetInput = resetInput;
  function touchList() { return input.pointers.filter((p) => p.type !== 'mouse'); }
  function processInput(world) {
    if (!queue.length) return;
    const evs = queue.splice(0, queue.length);
    const sys = world.systems;
    const extra = [];
    for (const ev of evs) {
      if (ev.x != null) { const wp = IP.screenToWorld(ev.x, ev.y, world); ev.wx = wp.x; ev.wy = wp.y; }
      handleEvent(world, ev, extra);
      // engine-made notices (e.g. 'cancel' for the first finger of a pinch) go to systems before the event itself
      while (extra.length) { const x = extra.shift(); for (let i = 0; i < sys.length; i++) if (sys[i].onInput) callSys(sys[i], 'onInput', world, x); }
      for (let i = 0; i < sys.length; i++) if (sys[i].onInput) callSys(sys[i], 'onInput', world, ev);
    }
  }
  function handleEvent(world, ev, extra) {
    const cam = world.camera;
    switch (ev.type) {
      case 'down': {
        gestured.delete(ev.id);
        const p = { id: ev.id, type: ev.pointerType, x: ev.x, y: ev.y, sx: ev.x, sy: ev.y, button: ev.button };
        input.pointers.push(p);
        input.pointerType = ev.pointerType;
        input.x = ev.x; input.y = ev.y; input.inFrame = true;
        if (ev.pointerType === 'mouse') { input.buttons |= 1 << ev.button; input.justPressed.add('Mouse' + ev.button); }
        else input.justPressed.add('Touch');
        if (ev.button === 0) input.down = true;
        const touches = touchList();
        if (ev.pointerType !== 'mouse' && touches.length === 2) {
          const [a, b] = touches;
          gesture = { kind: 'pinch', a: a.id, b: b.id, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
          gestured.add(a.id); gestured.add(b.id);
          ev.consumed = true;
          // let systems drop whatever the first finger started (box select, drag)
          const other = a.id === ev.id ? b : a;
          const wp = IP.screenToWorld(other.x, other.y, world);
          extra.push({ type: 'cancel', id: other.id, x: other.x, y: other.y, wx: wp.x, wy: wp.y, pointerType: other.type, consumed: true, engine: true });
          input.down = false;
        } else if (ev.pointerType === 'mouse' && ev.button === 1) {
          gesture = { kind: 'pan', id: ev.id, lx: ev.x, ly: ev.y };
          gestured.add(ev.id);
          ev.consumed = true;
        }
        break;
      }
      case 'move': {
        const p = input.pointers.find((q) => q.id === ev.id);
        if (p) { p.x = ev.x; p.y = ev.y; }
        if (!p || p.type === 'mouse' || input.pointers.length <= 1 || p === input.pointers[0]) { input.x = ev.x; input.y = ev.y; }
        if (ev.pointerType) input.pointerType = ev.pointerType;
        input.inFrame = ev.x >= 0 && ev.y >= 0 && ev.x < W && ev.y < H;
        if (gesture && gesture.kind === 'pan' && gesture.id === ev.id) {
          cam.x -= (ev.x - gesture.lx) / cam.zoom; cam.y -= (ev.y - gesture.ly) / cam.zoom;
          gesture.lx = ev.x; gesture.ly = ev.y;
          ev.consumed = true;
        } else if (gesture && gesture.kind === 'pinch' && (gesture.a === ev.id || gesture.b === ev.id)) {
          const a = input.pointers.find((q) => q.id === gesture.a), b = input.pointers.find((q) => q.id === gesture.b);
          if (a && b) {
            const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            cam.x -= (cx - gesture.cx) / cam.zoom; cam.y -= (cy - gesture.cy) / cam.zoom;
            zoomAt(world, cx, cy, cam.zoom * (d / gesture.d));
            gesture.cx = cx; gesture.cy = cy; gesture.d = d;
          }
          ev.consumed = true;
        } else if (gestured.has(ev.id)) ev.consumed = true;
        break;
      }
      case 'up': case 'cancel': {
        const i = input.pointers.findIndex((q) => q.id === ev.id);
        if (i >= 0) input.pointers.splice(i, 1);
        if (ev.type === 'up') {
          if (ev.pointerType === 'mouse') { input.buttons &= ~(1 << ev.button); input.justReleased.add('Mouse' + ev.button); }
          else input.justReleased.add('Touch');
        }
        if (ev.button === 0 || ev.pointerType !== 'mouse') input.down = input.pointers.some((q) => q.button === 0 && !gestured.has(q.id));
        if (gestured.has(ev.id)) ev.consumed = true;
        if (gesture && ((gesture.kind === 'pan' && gesture.id === ev.id) || (gesture.kind === 'pinch' && (gesture.a === ev.id || gesture.b === ev.id)))) gesture = null;
        break;
      }
      case 'tap': case 'longpress': case 'dragstart': case 'drag': case 'dragend':
        if (gestured.has(ev.id)) ev.consumed = true;
        break;
      case 'wheel':
        input.wheel += ev.deltaY;
        if (IP.cameraControl.enabled && ev.deltaY) zoomAt(world, ev.x, ev.y, cam.zoom * Math.pow(IP.cameraControl.wheelStep, -Math.sign(ev.deltaY) * Math.min(3, Math.abs(ev.deltaY) / 100 || 1)));
        break;
      case 'keydown':
        if (!input.keys.has(ev.key)) input.justPressed.add(ev.key);
        input.keys.add(ev.key);
        break;
      case 'keyup':
        input.keys.delete(ev.key);
        input.justReleased.add(ev.key);
        break;
      case 'leave':
        input.inFrame = false;
        break;
    }
    input.gesture = gesture ? gesture.kind : null;
  }

  // DOM side: converts browser events to logical events and queues them for the next tick.
  const LONGPRESS_MS = 450, TAP_MS = 350, MOVE_TOL_CSS = 10;
  let frameRect = { left: 0, top: 0, width: W, height: H };
  function toLogical(cx, cy) { return [((cx - frameRect.left) * W) / frameRect.width, ((cy - frameRect.top) * H) / frameRect.height]; }
  function enqueue(ev) {
    const last = queue[queue.length - 1];
    if (last && (ev.type === 'move' || ev.type === 'drag') && last.type === ev.type && last.id === ev.id) { last.x = ev.x; last.y = ev.y; return; }
    queue.push(ev);
  }
  IP.enqueue = enqueue;
  function bindDom(stage) {
    const live = new Map();
    stage.addEventListener('contextmenu', (e) => e.preventDefault());
    stage.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const [x, y] = toLogical(e.clientX, e.clientY);
      const p = { id: e.pointerId, type: e.pointerType, x, y, sx: x, sy: y, cx: e.clientX, cy: e.clientY, t0: performance.now(), button: e.button, drag: false, long: false, timer: 0 };
      live.set(e.pointerId, p);
      enqueue({ type: 'down', id: p.id, x, y, button: e.button, pointerType: p.type });
      if (p.type !== 'mouse') {
        p.timer = setTimeout(() => {
          if (live.get(p.id) === p && !p.drag) { p.long = true; enqueue({ type: 'longpress', id: p.id, x: p.x, y: p.y, button: 0, pointerType: p.type }); }
        }, LONGPRESS_MS);
      }
    });
    stage.addEventListener('pointermove', (e) => {
      const [x, y] = toLogical(e.clientX, e.clientY);
      const p = live.get(e.pointerId);
      enqueue({ type: 'move', id: e.pointerId, x, y, button: p ? p.button : -1, pointerType: e.pointerType });
      if (!p) return;
      p.x = x; p.y = y;
      if (!p.drag && Math.hypot(e.clientX - p.cx, e.clientY - p.cy) > MOVE_TOL_CSS) {
        p.drag = true; clearTimeout(p.timer);
        if (!p.long) enqueue({ type: 'dragstart', id: p.id, x, y, sx: p.sx, sy: p.sy, button: p.button, pointerType: p.type });
      } else if (p.drag && !p.long) enqueue({ type: 'drag', id: p.id, x, y, sx: p.sx, sy: p.sy, button: p.button, pointerType: p.type });
    });
    const up = (e, cancel) => {
      const p = live.get(e.pointerId);
      const [x, y] = toLogical(e.clientX, e.clientY);
      if (!p) return;
      live.delete(e.pointerId);
      clearTimeout(p.timer);
      enqueue({ type: cancel ? 'cancel' : 'up', id: p.id, x, y, button: p.button, pointerType: p.type, longpress: p.long });
      if (cancel) return;
      if (p.drag && !p.long) enqueue({ type: 'dragend', id: p.id, x, y, sx: p.sx, sy: p.sy, button: p.button, pointerType: p.type });
      else if (!p.drag && !p.long && performance.now() - p.t0 < TAP_MS) enqueue({ type: 'tap', id: p.id, x, y, button: p.button, pointerType: p.type });
    };
    stage.addEventListener('pointerup', (e) => up(e, false));
    stage.addEventListener('pointercancel', (e) => up(e, true));
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') enqueue({ type: 'leave', id: e.pointerId }); });
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = toLogical(e.clientX, e.clientY);
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // trackpad pinch arrives as ctrl+wheel with small deltas
      enqueue({ type: 'wheel', id: 0, x, y, deltaY: e.ctrlKey ? dy * 4 : dy, pointerType: 'mouse' });
    }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); if (!e.repeat) toggleDebug(); return; }
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) enqueue({ type: 'keydown', key: e.code, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey });
    });
    window.addEventListener('keyup', (e) => enqueue({ type: 'keyup', key: e.code }));
    window.addEventListener('blur', () => { for (const k of input.keys) enqueue({ type: 'keyup', key: k }); enqueue({ type: 'leave', id: 0 }); });
  }

  // ---------------------------------------------------------------- WebGL2 batcher
  const VS = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_col;
layout(location=3) in uvec4 a_ex;
uniform vec4 u_view;
out vec2 v_uv; out vec4 v_col; flat out uvec4 v_ex;
void main(){ gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0); v_uv = a_uv; v_col = a_col; v_ex = a_ex; }`;
  const FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex[8];
in vec2 v_uv; in vec4 v_col; flat in uvec4 v_ex;
out vec4 o;
vec4 samp(uint s, vec2 uv, vec2 dx, vec2 dy){
  if (s < 4u) {
    if (s == 0u) return textureGrad(u_tex[0], uv, dx, dy);
    if (s == 1u) return textureGrad(u_tex[1], uv, dx, dy);
    if (s == 2u) return textureGrad(u_tex[2], uv, dx, dy);
    return textureGrad(u_tex[3], uv, dx, dy);
  }
  if (s == 4u) return textureGrad(u_tex[4], uv, dx, dy);
  if (s == 5u) return textureGrad(u_tex[5], uv, dx, dy);
  if (s == 6u) return textureGrad(u_tex[6], uv, dx, dy);
  return textureGrad(u_tex[7], uv, dx, dy);
}
void main(){
  vec2 dx = dFdx(v_uv), dy = dFdy(v_uv);
  uint mode = v_ex.y & 127u;
  vec4 col = vec4(v_col.rgb * v_col.a, v_col.a);
  vec4 c;
  if (mode == 0u) c = samp(v_ex.x, v_uv, dx, dy) * col;
  else if (mode == 3u) c = col;
  else {
    float d = length(v_uv);
    float aa = max(length(vec2(dx.x, dy.x)), 1e-4) * 1.2;
    float a = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    if (mode == 2u) { float inner = float(v_ex.z | (v_ex.w << 8u)) / 65535.0; a *= smoothstep(inner - aa, inner, d); }
    c = col * a;
  }
  if ((v_ex.y & 128u) != 0u) c.a = 0.0;
  o = c;
}`;
  const MODE_TEX = 0, MODE_DISC = 1, MODE_RING = 2, MODE_SOLID = 3, ADD = 128, MAX_SLOTS = 8;
  const LAYERS = ['ground', 'decal', 'shadow', 'unit', 'fx', 'over', 'screen'];

  const gfx = (IP.gfx = { gl: null, canvas: null, textures: [], targets: [], lost: false });
  const stats = { quads: 0, draws: 0, uploads: 0, frameMs: 0, tickMs: 0, renderMs: 0 };
  IP.stats = stats;

  function makeLayerSet() {
    const set = {};
    for (const n of LAYERS) set[n] = { name: n, space: n === 'screen' ? 'screen' : 'world', cap: 0, n: 0, buf: null, f32: null, u32: null, segs: [], seg: null };
    return set;
  }
  const mainLayers = makeLayerSet();
  let scratchLayers = null;
  let cur = mainLayers; // layer set draws go into (swapped during renderTo)

  function growLayer(L, need) {
    let cap = Math.max(256, L.cap);
    while (cap < need) cap *= 2;
    const buf = new ArrayBuffer(cap * 96);
    if (L.buf) new Uint8Array(buf).set(new Uint8Array(L.buf, 0, L.n * 96));
    L.buf = buf; L.f32 = new Float32Array(buf); L.u32 = new Uint32Array(buf); L.cap = cap;
  }
  function slotFor(L, tex) {
    let s = L.seg;
    if (!s) { s = L.seg = { start: L.n, count: 0, texs: [] }; L.segs.push(s); }
    if (!tex) return 0;
    let i = s.texs.indexOf(tex);
    if (i < 0) {
      if (s.texs.length >= MAX_SLOTS) { s = L.seg = { start: L.n, count: 0, texs: [] }; L.segs.push(s); }
      i = s.texs.length; s.texs.push(tex);
    }
    return i;
  }
  function pushQuad(L, ex, col, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1) {
    if (L.n >= L.cap) growLayer(L, L.n + 1);
    const o = L.n * 24, f = L.f32, u = L.u32;
    f[o] = x0; f[o + 1] = y0; f[o + 2] = u0; f[o + 3] = v0; u[o + 4] = col; u[o + 5] = ex;
    f[o + 6] = x1; f[o + 7] = y1; f[o + 8] = u1; f[o + 9] = v0; u[o + 10] = col; u[o + 11] = ex;
    f[o + 12] = x2; f[o + 13] = y2; f[o + 14] = u1; f[o + 15] = v1; u[o + 16] = col; u[o + 17] = ex;
    f[o + 18] = x3; f[o + 19] = y3; f[o + 20] = u0; f[o + 21] = v1; u[o + 22] = col; u[o + 23] = ex;
    L.n++; L.seg.count++;
  }
  const exOf = (slot, mode, add, param) => (slot | ((mode | (add ? ADD : 0)) << 8) | ((param & 0xffff) << 16)) >>> 0;
  function layerOf(o, def) {
    const L = cur[(o && o.layer) || def];
    if (!L) throw new Error('unknown layer "' + (o && o.layer) + '" (use ' + LAYERS.join(', ') + ')');
    return L;
  }

  let prog = null, vao = null, vbo = null, ibo = null, iboQuads = 0, uView = null, white = null;
  function initGL(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    gfx.gl = gl; gfx.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    uView = gl.getUniformLocation(prog, 'u_view');
    gl.uniform1iv(gl.getUniformLocation(prog, 'u_tex'), [0, 1, 2, 3, 4, 5, 6, 7]);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 24, 16);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3, 4, gl.UNSIGNED_BYTE, 24, 20);
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    iboQuads = 0;
    ensureIndices(16384);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const c = document.createElement('canvas'); c.width = c.height = 1;
    const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, 1, 1);
    if (!white) white = createTexture(c, { filter: 'nearest', name: 'white' });
    else uploadTexture(white);
    for (let i = 0; i < MAX_SLOTS; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, white.gl); }
    return gl;
  }
  function ensureIndices(quads) {
    if (quads <= iboQuads) return;
    let n = Math.max(16384, iboQuads);
    while (n < quads) n *= 2;
    const idx = new Uint32Array(n * 6);
    for (let q = 0, i = 0; q < n; q++, i += 6) {
      const v = q * 4;
      idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
    }
    const gl = gfx.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    iboQuads = n;
  }

  // ---- textures
  let texId = 0;
  function uploadTexture(t) {
    const gl = gfx.gl;
    t.gl = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t.gl);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (t.src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.src);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const lin = t.opts.filter === 'linear';
    const mip = lin && t.opts.mipmap && t.src;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : lin ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, lin ? gl.LINEAR : gl.NEAREST);
    const wrap = t.opts.wrap === 'repeat' ? gl.REPEAT : t.opts.wrap === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (white && white.gl && t !== white) gl.bindTexture(gl.TEXTURE_2D, white.gl);
  }
  function createTexture(src, opts) {
    const t = { id: ++texId, gl: null, src: src || null, w: src ? src.width : opts.w, h: src ? src.height : opts.h, opts: opts || {}, name: (opts && opts.name) || '' };
    t.update = (s) => {
      if (s) { t.src = s; t.w = s.width; t.h = s.height; }
      const gl = gfx.gl;
      if (!gl || !t.gl) return t;
      gl.bindTexture(gl.TEXTURE_2D, t.gl);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.src);
      if (t.opts.filter === 'linear' && t.opts.mipmap) gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    };
    t.dispose = () => { if (gfx.gl && t.gl) gfx.gl.deleteTexture(t.gl); t.gl = null; const i = gfx.textures.indexOf(t); if (i >= 0) gfx.textures.splice(i, 1); };
    gfx.textures.push(t);
    if (gfx.gl) uploadTexture(t);
    return t;
  }
  // IP.gfx.texture(canvasOrImage, { filter:'nearest'|'linear', wrap:'clamp'|'repeat'|'mirror', mipmap, name })
  gfx.texture = (src, opts) => createTexture(src, Object.assign({ filter: 'nearest', wrap: 'clamp' }, opts || {}));

  // ---- render targets (persistent layers such as accumulated blood)
  function makeTarget(t) {
    const gl = gfx.gl;
    t.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.gl, 0);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  gfx.target = (w, h, opts) => {
    const t = createTexture(null, Object.assign({ filter: 'linear', wrap: 'clamp', w: w | 0, h: h | 0 }, opts || {}));
    t.isTarget = true;
    gfx.targets.push(t);
    if (gfx.gl) makeTarget(t);
    return t;
  };

  // ---- view mappings
  let camView = [1 / 960, -1 / 540, -1, 1];
  const screenView = [1 / 960, -1 / 540, -1, 1];
  function setCamView(world) {
    const c = world.camera, z = c.zoom;
    // round the camera to whole logical pixels so nearest-filtered sprites do not shimmer
    const cx = Math.round(c.x * z) / z, cy = Math.round(c.y * z) / z;
    camView = [z / 960, -z / 540, (-cx * z) / 960, (cy * z) / 540];
  }
  function flush(layers, viewFor) {
    const gl = gfx.gl;
    let total = 0, maxQ = 0;
    for (const n of LAYERS) { total += layers[n].n; }
    if (total) {
      maxQ = total;
      ensureIndices(maxQ);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, total * 96, gl.STREAM_DRAW);
      let base = 0;
      for (const n of LAYERS) {
        const L = layers[n];
        if (!L.n) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, base * 96, L.u32, 0, L.n * 24);
        stats.uploads++;
        gl.uniform4fv(uView, viewFor(L));
        for (const s of L.segs) {
          if (!s.count) continue;
          for (let i = 0; i < s.texs.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, s.texs[i].gl || white.gl); }
          gl.drawElements(gl.TRIANGLES, s.count * 6, gl.UNSIGNED_INT, (base + s.start) * 24);
          stats.draws++;
        }
        stats.quads += L.n;
        base += L.n;
      }
    }
    for (const n of LAYERS) { const L = layers[n]; L.n = 0; L.segs.length = 0; L.seg = null; }
  }

  // ---- the public batcher object passed to draw(world, r)
  const r = (IP.r = {
    layers: LAYERS,
    stats,
    white: () => white,
    // sprite(sheet, frame, x, y, { rot, scale, tint, alpha, layer='unit', flipX, add, snap })
    sprite(sheet, frame, x, y, o) {
      if (!sheet || !sheet.tex) return;
      const L = layerOf(o, 'unit');
      const slot = slotFor(L, sheet.tex);
      const fi = ((frame | 0) % sheet.frameCount) * 4, uv = sheet.uv;
      let u0 = uv[fi], v0 = uv[fi + 1], u1 = uv[fi + 2], v1 = uv[fi + 3];
      let sc = sheet.drawScale, col = 0xffffffff, rot = 0, add = false;
      if (o) {
        if (o.scale != null) sc *= o.scale;
        if (o.tint != null) col = toColor(o.tint);
        if (o.alpha != null) col = withAlpha(col, o.alpha);
        if (o.rot) rot = o.rot;
        if (o.flipX) { const t = u0; u0 = u1; u1 = t; }
        add = !!o.add;
      }
      const ex = exOf(slot, MODE_TEX, add, 0);
      const ax = sheet.ax * sc, ay = sheet.ay * sc, w = sheet.cw * sc, h = sheet.ch * sc;
      if (!rot) {
        let x0 = x - ax, y0 = y - ay;
        if (!(o && o.snap === false) && sc === 1) { x0 = Math.round(x0); y0 = Math.round(y0); }
        pushQuad(L, ex, col, x0, y0, x0 + w, y0, x0 + w, y0 + h, x0, y0 + h, u0, v0, u1, v1);
      } else {
        const c = Math.cos(rot), s = Math.sin(rot);
        const lx0 = -ax, ly0 = -ay, lx1 = w - ax, ly1 = h - ay;
        pushQuad(L, ex, col,
          x + lx0 * c - ly0 * s, y + lx0 * s + ly0 * c,
          x + lx1 * c - ly0 * s, y + lx1 * s + ly0 * c,
          x + lx1 * c - ly1 * s, y + lx1 * s + ly1 * c,
          x + lx0 * c - ly1 * s, y + lx0 * s + ly1 * c, u0, v0, u1, v1);
      }
    },
    // quad(x, y, w, h, rgba, { rot, layer='fx', tex, uv:[u0,v0,u1,v1], center, add, alpha })
    // x,y is the top-left corner (or the centre with center:true); rot spins around the centre.
    quad(x, y, w, h, rgba, o) {
      const L = layerOf(o, 'fx');
      let col = toColor(rgba), mode = MODE_SOLID, slot = 0, u0 = 0, v0 = 0, u1 = 1, v1 = 1, rot = 0, add = false;
      if (o) {
        if (o.alpha != null) col = withAlpha(col, o.alpha);
        if (o.tex) { mode = MODE_TEX; slot = slotFor(L, o.tex); if (o.uv) { u0 = o.uv[0]; v0 = o.uv[1]; u1 = o.uv[2]; v1 = o.uv[3]; } }
        if (o.center) { x -= w / 2; y -= h / 2; }
        rot = o.rot || 0; add = !!o.add;
      }
      if (mode === MODE_SOLID) slotFor(L, null);
      const ex = exOf(slot, mode, add, 0);
      if (!rot) { pushQuad(L, ex, col, x, y, x + w, y, x + w, y + h, x, y + h, u0, v0, u1, v1); return; }
      const cx = x + w / 2, cy = y + h / 2, c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hh = h / 2;
      pushQuad(L, ex, col,
        cx - hw * c + hh * s, cy - hw * s - hh * c,
        cx + hw * c + hh * s, cy + hw * s - hh * c,
        cx + hw * c - hh * s, cy + hw * s + hh * c,
        cx - hw * c - hh * s, cy - hw * s + hh * c, u0, v0, u1, v1);
    },
    // line(x0,y0,x1,y1,width,rgba,{ layer='fx', dash:[on,off], dashOffset, add, alpha })
    line(x0, y0, x1, y1, width, rgba, o) {
      const L = layerOf(o, 'fx');
      let col = toColor(rgba);
      if (o && o.alpha != null) col = withAlpha(col, o.alpha);
      slotFor(L, null);
      const ex = exOf(0, MODE_SOLID, !!(o && o.add), 0);
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      const ux = dx / len, uy = dy / len, nx = (-uy * width) / 2, ny = (ux * width) / 2;
      const seg = (a, b) => {
        const ax = x0 + ux * a, ay = y0 + uy * a, bx = x0 + ux * b, by = y0 + uy * b;
        pushQuad(L, ex, col, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny, 0, 0, 1, 1);
      };
      const dash = o && o.dash;
      if (!dash) { seg(0, len); return; }
      const on = Math.max(0.5, dash[0]), off = Math.max(0, dash[1] != null ? dash[1] : dash[0]), per = on + off;
      let t = -(((o.dashOffset || 0) % per) + per) % per, n = 0;
      for (; t < len && n < 4000; t += per, n++) { const a = Math.max(0, t), b = Math.min(len, t + on); if (b > a) seg(a, b); }
    },
    // circle(x, y, rad, rgba, { layer='fx', width (ring thickness; omit for a filled disc), add, alpha })
    circle(x, y, rad, rgba, o) {
      if (rad <= 0) return;
      const L = layerOf(o, 'fx');
      let col = toColor(rgba);
      if (o && o.alpha != null) col = withAlpha(col, o.alpha);
      slotFor(L, null);
      const ring = o && o.width > 0;
      const inner = ring ? Math.max(0, Math.min(1, (rad - o.width) / rad)) : 0;
      const ex = exOf(0, ring ? MODE_RING : MODE_DISC, !!(o && o.add), Math.round(inner * 65535));
      const m = rad + 1.5, k = m / rad;
      pushQuad(L, ex, col, x - m, y - m, x + m, y - m, x + m, y + m, x - m, y + m, -k, -k, k, k);
    },
    // poly([x0,y0,x1,y1,...], rgba, { layer='fx', add, alpha }) convex fan fill
    poly(pts, rgba, o) {
      const L = layerOf(o, 'fx');
      let col = toColor(rgba);
      if (o && o.alpha != null) col = withAlpha(col, o.alpha);
      slotFor(L, null);
      const ex = exOf(0, MODE_SOLID, !!(o && o.add), 0);
      const n = pts.length >> 1;
      for (let i = 1; i + 1 < n; i++) {
        pushQuad(L, ex, col, pts[0], pts[1], pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], pts[i * 2 + 2], pts[i * 2 + 3], 0, 0, 1, 1);
      }
    },
    // ngon(x, y, rad, sides, rgba, { rot, width (outline instead of fill), layer, add, alpha }); hexes: sides 6
    ngon(x, y, rad, sides, rgba, o) {
      const rot = (o && o.rot) || 0, pts = [];
      for (let i = 0; i < sides; i++) { const a = rot + (i / sides) * TAU; pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
      if (o && o.width > 0) {
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          r.line(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], o.width, rgba, o);
          r.circle(pts[i * 2], pts[i * 2 + 1], o.width / 2, rgba, { layer: o.layer, alpha: o.alpha, add: o.add });
        }
      } else r.poly(pts, rgba, o);
    },
    target: (w, h, opts) => gfx.target(w, h, opts),
    // renderTo(target, {x,y,w,h} world rect mapped onto the whole target, fn(r), { clear: rgba|false })
    // Draw calls inside fn go straight into the target (all layers, in layer order), not the frame.
    renderTo(t, view, fn, opts) {
      const gl = gfx.gl;
      if (!gl || gfx.lost) return;
      if (!scratchLayers) scratchLayers = makeLayerSet();
      const prev = cur;
      cur = scratchLayers;
      try { fn(r); } finally { cur = prev; }
      const v = view || { x: 0, y: 0, w: t.w, h: t.h };
      const vv = [2 / v.w, 2 / v.h, (-2 * v.x) / v.w - 1, (-2 * v.y) / v.h - 1];
      // never leave the target's own texture on a unit while drawing into it (WebGL feedback-loop error)
      for (let i = 0; i < MAX_SLOTS; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, white.gl); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
      if (opts && opts.clear !== undefined && opts.clear !== false) {
        const c = toColor(opts.clear), a = ((c >>> 24) & 255) / 255;
        gl.clearColor(((c & 255) / 255) * a, (((c >>> 8) & 255) / 255) * a, (((c >>> 16) & 255) / 255) * a, a);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      flush(scratchLayers, () => vv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gfx.canvas.width, gfx.canvas.height);
    },
    view: (margin) => IP.viewRect(IP.world, margin),
    inView(x, y, m) { const c = IP.world.camera, hw = W / 2 / c.zoom + (m || 0), hh = H / 2 / c.zoom + (m || 0); return x > c.x - hw && x < c.x + hw && y > c.y - hh && y < c.y + hh; },
  });

  // ---------------------------------------------------------------- sprite sheets + assets
  // Sheet: { name, tex, cw, ch, cols, rows, frameCount, ax, ay, anims, meta, uv, drawScale, frame(dir, anim, i), dir(angle) }
  function makeSheet(src, meta, opts) {
    opts = opts || {};
    meta = meta || {};
    const cw = meta.cellWidth || meta.cw || src.width, ch = meta.cellHeight || meta.ch || src.height;
    const cols = Array.isArray(meta.columns) ? meta.columns.length : meta.columns || Math.max(1, Math.floor(src.width / cw));
    const rows = Array.isArray(meta.rows) ? meta.rows.length : meta.rows || Math.max(1, Math.floor(src.height / ch));
    const tex = gfx.texture(src, { filter: opts.filter || 'nearest', name: opts.name || meta.name || '' });
    const n = cols * rows, uv = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = i % cols, rr = (i / cols) | 0;
      uv[i * 4] = (c * cw) / src.width; uv[i * 4 + 1] = (rr * ch) / src.height;
      uv[i * 4 + 2] = ((c + 1) * cw) / src.width; uv[i * 4 + 3] = ((rr + 1) * ch) / src.height;
    }
    const anims = meta.animations || {};
    const sheet = {
      name: opts.name || meta.name || '', tex, cw, ch, cols, rows, frameCount: n, uv, meta, anims,
      ax: meta.anchor ? meta.anchor.x : cw / 2, ay: meta.anchor ? meta.anchor.y : ch / 2,
      drawScale: opts.drawScale || 1,
      // frame index for direction row d (0..7 = S,SE,E,NE,N,NW,W,SW), animation name and step i (wraps or holds)
      frame(d, anim, i) {
        const a = anims[anim] || anims.idle || anims.walk || { from: 0, count: 1 };
        const cnt = Math.max(1, a.count || 1);
        let k = i | 0;
        k = a.loop === false ? Math.min(Math.max(k, 0), cnt - 1) : ((k % cnt) + cnt) % cnt;
        return ((((d | 0) % rows) + rows) % rows) * cols + a.from + k;
      },
      dir: (angle) => IP.dirIndex(angle) % rows,
    };
    return sheet;
  }
  const pending = new Set();
  function track(p) { pending.add(p); const done = () => pending.delete(p); p.then(done, done); return p; }
  const sheetCache = {};
  IP.assets = {
    base: 'assets/',
    sheets: {},
    image(url) {
      return track(new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => res(img)) : res(img));
        img.onerror = () => rej(new Error('image failed: ' + url));
        img.src = url;
      }));
    },
    json(url) { return track(fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); })); },
    text(url) { return track(fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); })); },
    // Game/assets/sprites/<name>.png + <name>.json (factory export meta). Cached; resolves to a sheet.
    load(name, opts) {
      if (sheetCache[name]) return sheetCache[name];
      const base = IP.assets.base + 'sprites/' + name;
      const p = Promise.all([IP.assets.image(base + '.png'), IP.assets.json(base + '.json')]).then(([img, meta]) => {
        const s = makeSheet(img, meta, Object.assign({ name }, opts || {}));
        IP.assets.sheets[name] = s;
        return s;
      });
      sheetCache[name] = track(p);
      p.catch((e) => console.warn('[IP] asset ' + name + ': ' + e.message));
      return p;
    },
    sheet: (name) => IP.assets.sheets[name] || null,
    // build a sheet from an in-memory canvas/image + meta (placeholders, runtime-baked sprites)
    sheetFromCanvas(src, meta, opts) {
      const s = makeSheet(src, meta, opts);
      if (opts && opts.name) IP.assets.sheets[opts.name] = s;
      return s;
    },
    // local font file -> document.fonts (no web fonts). Captures wait for it.
    font(family, url, desc) {
      if (typeof FontFace === 'undefined') return Promise.resolve(null);
      const f = new FontFace(family, 'url(' + url + ')', desc || {});
      return track(f.load().then((ff) => { document.fonts.add(ff); return ff; }));
    },
    ready: async () => { while (pending.size) await Promise.allSettled([...pending]); },
    pendingCount: () => pending.size,
  };

  // ---------------------------------------------------------------- layout, render, loop
  let stageEl, frameEl, glCanvas, hudCanvas, hudCtx, debugEl;
  IP.renderScale = 1; IP.hudScale = 1;
  let fitScale = 1, scaleOverride = qs.has('scale') ? +qs.get('scale') : null;
  function layout() {
    if (!stageEl) return;
    const cs = getComputedStyle(stageEl);
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const aw = Math.max(1, stageEl.clientWidth - pl - pr), ah = Math.max(1, stageEl.clientHeight - pt - pb);
    fitScale = Math.min(aw / W, ah / H);
    const fw = Math.round(W * fitScale), fh = Math.round(H * fitScale);
    frameEl.style.width = fw + 'px'; frameEl.style.height = fh + 'px';
    frameEl.style.left = Math.round(pl + (aw - fw) / 2) + 'px'; frameEl.style.top = Math.round(pt + (ah - fh) / 2) + 'px';
    frameEl.style.transform = 'none';
    const dpr = window.devicePixelRatio || 1;
    const rs = IP.headless ? 1 : scaleOverride || IP.clamp(fitScale * dpr, 0.5, 1);
    const hs = IP.headless ? 1 : scaleOverride || IP.clamp(fitScale * dpr, 0.5, 2);
    setScales(rs, hs);
    glCanvas.style.imageRendering = fitScale * dpr >= 1 ? 'pixelated' : 'auto';
    const b = frameEl.getBoundingClientRect();
    frameRect = { left: b.left, top: b.top, width: b.width || 1, height: b.height || 1 };
  }
  function setScales(rs, hs) {
    const gw = Math.round(W * rs), gh = Math.round(H * rs);
    if (glCanvas.width !== gw || glCanvas.height !== gh) { glCanvas.width = gw; glCanvas.height = gh; }
    const hw = Math.round(W * hs), hh = Math.round(H * hs);
    if (hudCanvas.width !== hw || hudCanvas.height !== hh) { hudCanvas.width = hw; hudCanvas.height = hh; }
    IP.renderScale = rs; IP.hudScale = hs;
  }
  IP.setRenderScale = (s) => { scaleOverride = s || null; layout(); };
  IP.layout = layout;

  IP.clearColor = [0.04, 0.045, 0.05];
  function render() {
    const gl = gfx.gl;
    const world = IP.world;
    const t0 = performance.now();
    stats.quads = 0; stats.draws = 0; stats.uploads = 0;
    if (gl && !gfx.lost) {
      setCamView(world);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      const cc = IP.clearColor;
      gl.clearColor(cc[0], cc[1], cc[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const sys = world.systems;
      for (let i = 0; i < sys.length; i++) if (sys[i].draw) callSys(sys[i], 'draw', world, r);
      flush(mainLayers, (L) => (L.space === 'screen' ? screenView : camView));
    }
    if (hudCtx) {
      const hs = IP.hudScale;
      hudCtx.setTransform(1, 0, 0, 1, 0, 0);
      hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      hudCtx.setTransform(hs, 0, 0, hs, 0, 0);
      const sys = world.systems;
      for (let i = 0; i < sys.length; i++) if (sys[i].drawHud) {
        hudCtx.save();
        callSys(sys[i], 'drawHud', world, hudCtx);
        hudCtx.restore();
      }
    }
    stats.renderMs = performance.now() - t0;
  }
  IP.render = render;

  let composeCanvas = null;
  // Compose the WebGL frame and the HUD into one 1920x1080 PNG dataURL (always at render scale 1).
  IP.capture = function (type) {
    const saved = [IP.renderScale, IP.hudScale];
    const rescale = saved[0] !== 1 || saved[1] !== 1;
    if (rescale) setScales(1, 1);
    render();
    if (!composeCanvas) { composeCanvas = document.createElement('canvas'); composeCanvas.width = W; composeCanvas.height = H; }
    const c = composeCanvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.imageSmoothingEnabled = false;
    c.drawImage(glCanvas, 0, 0, W, H);
    c.drawImage(hudCanvas, 0, 0, W, H);
    const url = composeCanvas.toDataURL(type || 'image/png');
    if (rescale) { setScales(saved[0], saved[1]); render(); }
    return url;
  };

  // ---- main loop (real time). Headless pages do not run it until IP.run() / IP.measureFps().
  let running = false, rafId = 0, last = 0;
  const fpsWin = { frames: 0, t0: 0, fps: 0, cpu: 0, cpuAcc: 0, ticks: 0, tickAcc: 0 };
  IP.paused = false;
  IP.maxStepsPerFrame = 5;
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    let n = 0;
    if (!IP.paused) {
      acc += dt;
      while (acc >= STEP && n < IP.maxStepsPerFrame) { tick(); acc -= STEP; n++; }
      if (n === IP.maxStepsPerFrame) acc = 0;
    } else acc = 0;
    const t1 = performance.now();
    render();
    const t2 = performance.now();
    stats.tickMs = t1 - t0; stats.frameMs = t2 - t0;
    fpsWin.frames++; fpsWin.cpuAcc += t2 - t0; fpsWin.tickAcc += n;
    if (now - fpsWin.t0 >= 250) {
      const s = (now - fpsWin.t0) / 1000;
      fpsWin.fps = fpsWin.frames / s; fpsWin.cpu = fpsWin.cpuAcc / Math.max(1, fpsWin.frames); fpsWin.ticks = fpsWin.tickAcc / s;
      fpsWin.frames = 0; fpsWin.cpuAcc = 0; fpsWin.tickAcc = 0; fpsWin.t0 = now;
      updateDebug();
    }
    for (const f of frameHooks) f(now);
  }
  const frameHooks = new Set();
  IP.run = function () {
    if (running) return;
    running = true;
    last = performance.now(); fpsWin.t0 = last; acc = 0;
    rafId = requestAnimationFrame(frame);
  };
  IP.stop = function () { running = false; cancelAnimationFrame(rafId); };
  IP.isRunning = () => running;
  // Run the real rAF loop for ms milliseconds; resolves { fps, frames, ms, cpuMs, ticksPerSec }.
  IP.measureFps = function (ms) {
    ms = ms || 2000;
    const wasRunning = running;
    IP.run();
    return new Promise((res) => {
      let t0 = 0, frames = 0, cpu = 0, ticks0 = IP.world.tick;
      const hook = (now) => {
        if (!t0) { t0 = now; ticks0 = IP.world.tick; return; }
        frames++; cpu += stats.frameMs;
        if (now - t0 >= ms) {
          frameHooks.delete(hook);
          if (!wasRunning) IP.stop();
          const el = (now - t0) / 1000;
          res({ fps: +(frames / el).toFixed(1), frames, ms: Math.round(now - t0), cpuMs: +(cpu / Math.max(1, frames)).toFixed(2), ticksPerSec: +((IP.world.tick - ticks0) / el).toFixed(1), quads: stats.quads, draws: stats.draws });
        }
      };
      frameHooks.add(hook);
    });
  };

  // ---- debug overlay (DOM, never part of IP.capture)
  let debugOn = qs.get('debug') === '1';
  function toggleDebug() { debugOn = !debugOn; if (debugEl) debugEl.hidden = !debugOn; updateDebug(); }
  IP.toggleDebug = toggleDebug;
  function count(v) { return v == null ? 0 : typeof v.length === 'number' ? v.length : typeof v.size === 'number' ? v.size : typeof v.count === 'number' ? v.count : 0; }
  IP.count = count;
  function updateDebug() {
    if (!debugOn || !debugEl) return;
    const w = IP.world, c = w.camera;
    debugEl.textContent =
      `fps ${fpsWin.fps.toFixed(1)}  cpu ${fpsWin.cpu.toFixed(2)} ms  ticks/s ${fpsWin.ticks.toFixed(0)}\n` +
      `quads ${stats.quads}  draws ${stats.draws}  render ${stats.renderMs.toFixed(2)} ms\n` +
      `aliens ${count(w.aliens)}  marines ${count(w.marines)}  structures ${count(w.structures)}\n` +
      `projectiles ${count(w.projectiles)}  decals ${count(w.decals)}  budget ${IP.budget.aliens}\n` +
      `scenario ${w.scenario}  seed ${w.seed}  t ${w.time.toFixed(2)}  tick ${w.tick}\n` +
      `cam ${c.x.toFixed(0)},${c.y.toFixed(0)} z${c.zoom.toFixed(2)}  scale ${IP.renderScale.toFixed(2)}/${IP.hudScale.toFixed(2)}\n` +
      `input ${input.x.toFixed(0)},${input.y.toFixed(0)} ${input.pointerType}${input.gesture ? ' ' + input.gesture : ''}  keys ${[...input.keys].join(' ')}` +
      (errors.length ? `\nerrors ${errors.length}: ${errors[errors.length - 1]}` : '');
  }

  // ---------------------------------------------------------------- boot
  function fatal(msg) {
    const d = document.createElement('div');
    d.id = 'fatal'; d.textContent = msg;
    (frameEl || document.body).appendChild(d);
    console.error('[IP] ' + msg);
  }
  function boot() {
    stageEl = document.getElementById('stage');
    frameEl = document.getElementById('frame');
    glCanvas = document.getElementById('gl');
    hudCanvas = document.getElementById('hud');
    debugEl = document.getElementById('debug');
    if (!stageEl || !frameEl || !glCanvas || !hudCanvas) { fatal('engine: #stage/#frame/#gl/#hud missing'); return; }
    hudCtx = hudCanvas.getContext('2d');
    layout();
    try { if (!initGL(glCanvas)) { fatal('WebGL2 is not available in this browser.'); return; } }
    catch (e) { fatal('WebGL2 init failed: ' + e.message); return; }
    glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gfx.lost = true; });
    glCanvas.addEventListener('webglcontextrestored', () => {
      initGL(glCanvas);
      for (const t of gfx.textures) if (t !== white) { uploadTexture(t); if (t.isTarget) { makeTarget(t); if (t.onRestore) t.onRestore(t); } }
      gfx.lost = false;
    });
    bindDom(stageEl);
    window.addEventListener('resize', layout);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', layout);
    if (debugEl) debugEl.hidden = !debugOn;
    IP.ready = true;
    document.dispatchEvent(new Event('ip-ready'));
    if (!IP.headless) {
      const want = qs.get('scenario') || IP.defaultScenario || 'stress';
      IP.loadScenario(want, { seed: qs.has('seed') ? +qs.get('seed') : undefined })
        .catch((e) => fatal('scenario ' + want + ': ' + e.message))
        .then(() => IP.run());
    }
  }
  if (document.readyState === 'complete') setTimeout(boot, 0);
  else window.addEventListener('load', boot);

  // ================================================================ built-in 'stress' scenario
  // Placeholder art only (no factory assets) so performance is measurable before other systems exist.
  function noiseTex(size, rng, octaves) {
    // periodic value-noise fBm in [0,1], tileable
    const out = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (const cells of octaves) {
      const g = new Float32Array(cells * cells);
      for (let i = 0; i < g.length; i++) g[i] = rng();
      const k = cells / size;
      for (let y = 0; y < size; y++) {
        const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
        const y0 = iy % cells, y1 = (iy + 1) % cells;
        for (let x = 0; x < size; x++) {
          const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
          const x0 = ix % cells, x1 = (ix + 1) % cells;
          const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
          out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
      total += amp; amp *= 0.55;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }
  function makeGroundCanvas(rng) {
    const S = 256;
    const n1 = noiseTex(S, rng, [4, 8, 16, 32, 64, 128]);
    const n2 = noiseTex(S, rng, [3, 6, 12, 48]);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const cx = c.getContext('2d'), img = cx.createImageData(S, S), d = img.data;
    const stops = [[0, [30, 36, 16]], [0.3, [50, 58, 24]], [0.5, [78, 82, 34]], [0.7, [108, 98, 44]], [1, [140, 122, 58]]];
    const ramp = (v) => {
      v = IP.clamp(v, 0, 1);
      for (let i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a);
        return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
      }
      return stops[stops.length - 1][1];
    };
    for (let i = 0; i < S * S; i++) {
      const v = (n1[i] - 0.5) * 1.9 + 0.5, h = n2[i];
      const col = ramp(v);
      d[i * 4] = col[0] * (0.85 + 0.3 * h); d[i * 4 + 1] = col[1] * (1.05 - 0.15 * h); d[i * 4 + 2] = col[2] * (0.9 + 0.1 * h); d[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return c;
  }
  function makeBugSheet() {
    const C = 28, cols = 5, rows = 8;
    const c = document.createElement('canvas'); c.width = C * cols; c.height = C * rows;
    const x = c.getContext('2d');
    for (let d = 0; d < rows; d++) for (let f = 0; f < cols; f++) {
      const ang = IP.dirAngle(d), phase = f === 0 ? 0 : ((f - 1) / 4) * TAU, swing = f === 0 ? 0 : 1;
      x.save();
      x.translate(f * C + C / 2, d * C + C / 2);
      x.rotate(ang);
      x.scale(1.18, 1.18);
      // legs: three pairs, alternating tripod swing
      x.strokeStyle = '#06161d'; x.lineWidth = 1.6; x.lineCap = 'round';
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
        const ph = phase + (i % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
        const sw = Math.sin(ph) * 1.8 * swing;
        const bx = 1.5 - i * 2.5;
        x.beginPath(); x.moveTo(bx, side * 2.2); x.lineTo(bx + 1.6 + sw - i * 1.3, side * 6.6); x.stroke();
      }
      // body outline then fill
      x.fillStyle = '#05141a';
      x.beginPath(); x.ellipse(-3, 0, 6.2, 4.6, 0, 0, TAU); x.fill();
      x.beginPath(); x.ellipse(3.6, 0, 3.6, 3.4, 0, 0, TAU); x.fill();
      x.fillStyle = '#1f5f86';
      x.beginPath(); x.ellipse(-3, 0, 5.1, 3.6, 0, 0, TAU); x.fill();
      x.fillStyle = '#2b86ad';
      x.beginPath(); x.ellipse(3.6, 0, 2.7, 2.5, 0, 0, TAU); x.fill();
      x.fillStyle = '#3aa7c4';
      x.beginPath(); x.ellipse(-3.5, -1.1, 2.8, 1.4, 0, 0, TAU); x.fill();
      x.fillStyle = '#b9e651';
      x.fillRect(-5, -0.6, 1.4, 1.4); x.fillRect(-2.2, 0.8, 1.2, 1.2); x.fillRect(4.6, -1.3, 1.1, 1.1); x.fillRect(4.6, 0.4, 1.1, 1.1);
      x.restore();
    }
    const meta = {
      name: 'stress-bug', cellWidth: C, cellHeight: C, rows: DIRS, columns: ['idle', 'walk0', 'walk1', 'walk2', 'walk3'],
      animations: { idle: { from: 0, count: 1 }, walk: { from: 1, count: 4, loop: true } }, anchor: { x: C / 2, y: C / 2 },
    };
    return IP.assets.sheetFromCanvas(c, meta, { name: 'stress-bug' });
  }
  function blobCanvas(size, rng, splat) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    if (!splat) {
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, size, size);
      return c;
    }
    const dot = (cx, cy, rr, a) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, 'rgba(255,255,255,' + a + ')'); g.addColorStop(0.65, 'rgba(255,255,255,' + a * 0.85 + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
    };
    const h = size / 2;
    for (let i = 0; i < 7; i++) dot(h + (rng() - 0.5) * size * 0.16, h + (rng() - 0.5) * size * 0.16, size * (0.07 + rng() * 0.08), 0.9);
    const rays = 9 + ((rng() * 6) | 0);
    for (let k = 0; k < rays; k++) {
      const a = rng() * TAU, len = size * (0.18 + rng() * 0.3);
      for (let j = 0, n = 4 + ((rng() * 5) | 0); j < n; j++) {
        const d = size * 0.08 + (len * j) / n, rr = size * (0.035 - j * 0.003) * (0.6 + rng() * 0.8);
        if (rr > 0.6) dot(h + Math.cos(a + (rng() - 0.5) * 0.12) * d, h + Math.sin(a + (rng() - 0.5) * 0.12) * d, rr, 0.85);
      }
    }
    return c;
  }

  const stress = {
    init(world) {
      if (world.scenario !== 'stress') return;
      const rng = IP.fork(world, 'stress-art');
      const S = (world.stress = {});
      S.ground = gfx.texture(makeGroundCanvas(rng), { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'stress-ground' });
      S.splat = gfx.texture(blobCanvas(128, rng, true), { filter: 'linear', name: 'stress-splat' });
      S.blob = gfx.texture(blobCanvas(32, rng, false), { filter: 'linear', name: 'stress-blob' });
      S.bug = makeBugSheet();
    },
    update(world) {
      const S = world.stress;
      if (!S) return;
      const t = world.time, rng = world.rng;
      for (let i = 0; i < world.aliens.length; i++) {
        const a = world.aliens[i], p = S.paths[a.path];
        a.p += (a.speed * STEP) / p.len;
        if (a.p >= 1) { a.p -= 1; a.lane = (rng() - 0.5) * 2; }
        placeAlien(a, p, t);
      }
      // marines shoot the nearest alien in range every few ticks; kills leave decals
      for (const m of world.marines) {
        if (--m.cool > 0) continue;
        m.cool = 7 + ((rng() * 5) | 0);
        let best = -1, bd = m.range * m.range;
        for (let i = 0; i < world.aliens.length; i++) {
          const a = world.aliens[i], dx = a.x - m.x, dy = a.y - m.y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
        if (best < 0) continue;
        const a = world.aliens[best];
        m.aim = Math.atan2(a.y - m.y, a.x - m.x);
        world.projectiles.push({ x0: m.x, y0: m.y, x1: a.x, y1: a.y, life: 0.12, kind: m.kind });
        addDecal(world, a.x, a.y, 0.7 + rng() * 0.8);
        S.fx.push({ x: a.x, y: a.y, life: 0.3, max: 0.3, r: 14 + rng() * 10 });
        IP.emit(world, 'kill', { x: a.x, y: a.y });
        a.p = 0; a.lane = (rng() - 0.5) * 2;
        placeAlien(a, S.paths[a.path], t);
      }
      for (let i = world.projectiles.length - 1; i >= 0; i--) if ((world.projectiles[i].life -= STEP) <= 0) world.projectiles.splice(i, 1);
      for (let i = S.fx.length - 1; i >= 0; i--) if ((S.fx[i].life -= STEP) <= 0) S.fx.splice(i, 1);
    },
    draw(world, rr) {
      const S = world.stress;
      if (!S) return;
      const m = world.map, tile = 640;
      rr.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: S.ground, uv: [0, 0, m.w / tile, m.h / tile] });
      // a second, larger-scale pass for broad light/dark mottling
      rr.quad(0, 0, m.w, m.h, 'rgba(14,18,6,0.38)', { layer: 'ground', tex: S.ground, uv: [0.37, 0.61, 0.37 + m.w / 3400, 0.61 + m.h / 3400] });
      const dop = { layer: 'decal', tex: S.splat, rot: 0, center: true, alpha: 1 };
      for (const d of world.decals) { dop.rot = d.rot; dop.alpha = d.a; rr.quad(d.x, d.y, d.w, d.h, d.col, dop); }
      // marines: shadow, ring, body, gun
      const shadowO = { layer: 'shadow', tex: S.blob, center: true };
      for (const mm of world.marines) {
        rr.quad(mm.x + 3, mm.y + 5, 46, 34, 'rgba(0,0,0,0.55)', shadowO);
        rr.circle(mm.x, mm.y, 25, 'rgba(255,90,110,0.9)', { layer: 'shadow', width: 3 });
        rr.circle(mm.x, mm.y, 22, 'rgba(60,200,190,0.25)', { layer: 'shadow' });
        rr.circle(mm.x, mm.y, 10, '#1a2a2c', { layer: 'unit' });
        rr.circle(mm.x, mm.y, 8, mm.color, { layer: 'unit' });
        const ca = Math.cos(mm.aim), sa = Math.sin(mm.aim);
        rr.line(mm.x + ca * 4, mm.y + sa * 4, mm.x + ca * 17, mm.y + sa * 17, 4, '#202a2c', { layer: 'unit' });
        rr.line(mm.tx, mm.ty, mm.x, mm.y, 3, 'rgba(70,220,230,0.9)', { layer: 'over', dash: [3, 7] });
        rr.circle(mm.tx, mm.ty, 4, 'rgba(70,220,230,0.95)', { layer: 'over' });
      }
      // aliens, back-to-front by y; one textured quad each
      const al = world.aliens, n = al.length;
      if (!S.order || S.order.length !== n) S.order = Array.from({ length: n }, (_, i) => i);
      const ord = S.order;
      ord.sort((i, j) => al[i].y - al[j].y || i - j);
      const so = { tint: 0xffffffff };
      const ft = world.tick;
      for (let k = 0; k < n; k++) {
        const a = al[ord[k]];
        so.tint = a.tint;
        rr.sprite(S.bug, S.bug.frame(a.dir, 'walk', ((ft + a.phase) / 5) | 0), a.x, a.y, so);
      }
      for (const p of world.projectiles) {
        const col = p.kind === 'sniper' ? 'rgba(255,255,255,0.95)' : 'rgba(255,60,60,0.95)';
        rr.line(p.x0, p.y0, p.x1, p.y1, p.kind === 'sniper' ? 2 : 3, col, { layer: 'fx', dash: p.kind === 'sniper' ? null : [5, 6], add: true });
      }
      for (const f of S.fx) {
        const k = f.life / f.max;
        rr.quad(f.x, f.y, f.r * 2 * (1.6 - k * 0.6), f.r * 2 * (1.6 - k * 0.6), [1, 0.55, 0.15, k], { layer: 'fx', tex: S.blob, center: true, add: true });
        rr.circle(f.x, f.y, f.r * (1.2 - k * 0.5), [1, 0.85, 0.5, k * 0.6], { layer: 'fx', width: 2, add: true });
      }
    },
    drawHud(world, ctx) {
      if (!world.stress) return;
      ctx.font = '600 22px "Chakra Petch", "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(16, H - 52, 560, 36);
      ctx.fillStyle = '#7ff3ff';
      ctx.fillText(`ENGINE STRESS  ${count(world.aliens)} ALIENS  SEED ${world.seed}  T ${world.time.toFixed(2)}`, 28, H - 22);
    },
  };
  function placeAlien(a, p, t) {
    // quadratic bezier from spawn to the squad, offset sideways by lane, with a small per-bug wobble
    const u = a.p, iu = 1 - u;
    const x = iu * iu * p.x0 + 2 * iu * u * p.cx + u * u * p.x1, y = iu * iu * p.y0 + 2 * iu * u * p.cy + u * u * p.y1;
    let tx = 2 * iu * (p.cx - p.x0) + 2 * u * (p.x1 - p.cx), ty = 2 * iu * (p.cy - p.y0) + 2 * u * (p.y1 - p.cy);
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const spread = p.width * (0.55 + 0.45 * iu);
    const w = Math.sin(t * 3.1 + a.phase) * 5;
    a.x = x - ty * (a.lane * spread + w); a.y = y + tx * (a.lane * spread + w);
    a.dir = IP.dirIndex(Math.atan2(ty, tx) + Math.cos(t * 3.1 + a.phase) * 0.35);
  }
  function addDecal(world, x, y, s) {
    const S = world.stress, rng = world.rng;
    const pal = ['#d81b60', '#ff3d7f', '#b0124a', '#ff6fa0', '#8e0f3c'];
    const d = { x: x + (rng() - 0.5) * 20, y: y + (rng() - 0.5) * 20, w: 64 * s * (0.8 + rng() * 0.6), h: 64 * s * (0.7 + rng() * 0.5), rot: rng() * TAU, col: pal[(rng() * pal.length) | 0], a: 0.5 + rng() * 0.35 };
    if (world.decals.length < S.maxDecals) world.decals.push(d);
    else { world.decals[S.decalHead] = d; S.decalHead = (S.decalHead + 1) % S.maxDecals; }
  }
  IP.registerSystem('stress', stress);
  IP.scenario('stress', (world) => {
    const S = world.stress, rng = world.rng;
    world.map = { w: 3840, h: 2160 };
    const cx = 1920, cy = 1080;
    world.camera = { x: cx, y: cy, zoom: 1 };
    S.fx = []; S.maxDecals = 400; S.decalHead = 0;
    // six streams converging on the squad from beyond the screen edges
    const spawns = [[-1150, -620], [-1250, 180], [-500, 760], [700, 800], [1250, -150], [300, -760]];
    S.paths = spawns.map(([dx, dy], i) => {
      const x0 = cx + dx, y0 = cy + dy, ang = Math.atan2(dy - 40, dx - 120), stop = 210 + rng() * 60;
      const x1 = cx + 120 + Math.cos(ang) * stop, y1 = cy + 40 + Math.sin(ang) * stop;
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, len0 = Math.hypot(x1 - x0, y1 - y0);
      const bend = (i % 2 ? 1 : -1) * len0 * (0.18 + rng() * 0.15);
      const cxp = mx + (-(y1 - y0) / len0) * bend, cyp = my + ((x1 - x0) / len0) * bend;
      let len = 0, px = x0, py = y0;
      for (let k = 1; k <= 32; k++) {
        const u = k / 32, iu = 1 - u;
        const qx = iu * iu * x0 + 2 * iu * u * cxp + u * u * x1, qy = iu * iu * y0 + 2 * iu * u * cyp + u * u * y1;
        len += Math.hypot(qx - px, qy - py); px = qx; py = qy;
      }
      return { x0, y0, cx: cxp, cy: cyp, x1, y1, len, width: 110 + rng() * 70 };
    });
    const N = IP.budget.aliens;
    const tints = [0xffffffff, 0xffe6f0ff, 0xfff0ffe0, 0xffd8e8ff, 0xffffffe8];
    for (let i = 0; i < N; i++) {
      // bell-ish lane distribution so streams have dense cores and ragged edges
      const lane = (rng() + rng() + rng() - 1.5) / 1.5;
      const a = { x: 0, y: 0, dir: 0, path: i % S.paths.length, p: rng(), lane, speed: 70 + rng() * 45, phase: (rng() * 40) | 0, tint: tints[(rng() * tints.length) | 0] };
      placeAlien(a, S.paths[a.path], 0);
      world.aliens.push(a);
    }
    const kinds = ['sniper', 'rifle', 'fusion', 'rifle', 'medic'];
    const cols = ['#4fd1c5', '#e8e04a', '#7be36b', '#e8e04a', '#ff5a6e'];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.4, x = cx + 140 + Math.cos(a) * 46, y = cy + 40 + Math.sin(a) * 46;
      world.marines.push({ x, y, tx: x + 60 + i * 30, ty: y - 260 - i * 20, aim: 0, cool: i * 2 + 1, range: 420, kind: kinds[i], color: cols[i] });
    }
    for (let i = 0; i < 160; i++) {
      const p = S.paths[i % S.paths.length], u = 0.82 + rng() * 0.18, iu = 1 - u;
      const x = iu * iu * p.x0 + 2 * iu * u * p.cx + u * u * p.x1, y = iu * iu * p.y0 + 2 * iu * u * p.cy + u * u * p.y1;
      addDecal(world, x + (rng() - 0.5) * p.width * 1.4, y + (rng() - 0.5) * p.width * 1.4, 0.5 + rng() * 1.1);
    }
  }, { systems: ['stress'] });
})();
