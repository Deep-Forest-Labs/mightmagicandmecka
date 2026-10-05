// Infested Planet Gauntlet: swarm (aliens).
// Owns world.aliens: spawning, flow-field pathing toward the nearest marine or player structure, a spatial hash
// (cell 48) for separation and queries, bites, spitter globs, hp/death, 8-direction animated sprites drawn y-sorted
// on the 'unit' layer with a faint contact shadow.
// Crowd texture (so a stream reads as liquid, not a lattice): bugs hatch in clutches of 3-14 (some loners) that share a
// pace and a slow weave and hold together (centroid pull, tighter spacing and a smaller hard core inside a clutch), so
// streams are lumps of overlapping bugs with gaps and ragged edges; a travelling wave bends the flow so rivers snake;
// local-centroid cohesion keeps rivers narrow; blocked bugs stop pushing except at the front, where the crowd keeps
// leaning in and compresses against the squad; heavy kinds ignore light bugs ahead and shove them aside; spitters stop
// at range and spit. Body radius follows the variant's bulk, sheets are picked per instance by seed from aliens.json
// (weighted), and the facing row only changes past a hysteresis band, at most 5 times a second. Knobs: IP.swarm.knobs.
//
// API (all optional for callers; guard with `IP.swarm && ...`):
//   IP.swarm.spawn(world, {x, y, kind, n, spread, pack, solo})  -> number actually spawned (clamped to the alien budget)
//                       n > 1 hatches whole clutches; n == 1 calls at one spot fill a shared clutch; solo: true = loner
//   IP.swarm.room(world)                            -> free budget slots (spawners wait while this is 0)
//   IP.swarm.nearest(world, x, y, r)                -> nearest live alien whose centre is within r, or null
//   IP.swarm.inRadius(world, x, y, r, cb)           -> calls cb(alien) for live aliens within r; return true to stop; returns count
//   IP.swarm.damage(world, alien, dmg, cause)       -> subtracts hp, emits 'hit' (and 'alien-died' on the kill); true if it died
//   IP.swarm.flowDist(world, x, y)                  -> path distance (px) from (x,y) to the nearest target, Infinity if none
//   IP.swarm.rebuildPassability(world)              -> call after the walkable map changes
// Damage callers should use IP.swarm.damage and NOT emit their own 'hit' for aliens (it emits one).
// Flow field: a multi-source Dijkstra (5/7 chamfer costs, Dial buckets) on a 24 px grid seeded by every target, so
// each alien walks toward its nearest target by path length. Walls come from IP.terrain.passable(world,x,y) when the
// terrain system runs, ANDed with world.swarm.blockers (circles) and the map edge, as a signed distance field on a
// 12 px grid (soft wall push + slide).
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;

  const STEP = 1 / 60, TAU = Math.PI * 2;
  // table sine for the per-bug weave terms (thousands per tick; exact trig is not needed there)
  const SIN_N = 4096, SIN_K = SIN_N / TAU, SIN_T = new Float32Array(SIN_N);
  for (let i = 0; i < SIN_N; i++) SIN_T[i] = Math.sin(i / SIN_K);
  const fsin = (v) => { let t = v * SIN_K; t -= Math.floor(t / SIN_N) * SIN_N; return SIN_T[t | 0]; };
  const HASH = 48;          // spatial hash cell (px)
  const FC = 24;            // flow-field cell (px)
  const FINE = 12;          // wall SDF cell (px)
  const INF = 0x3fffffff;
  const CLEAR = 8;          // flow cells whose centre is closer than this to a wall are not walked through
  const ATTACK_ANIM = 0.32; // seconds the 4 attack frames take
  // crowd texture / stream shape knobs
  // (KN is exposed as IP.swarm.knobs for tuning; steer() reads it once per tick)
  const KN = {
    coh: 0.5,      // cohesion pull (fraction of speed) toward the centroid of the bugs in reach (surface tension: keeps rivers narrow)
    sepK: 1.5,     // soft separation target between bugs of different clutches, in D = sr_a + sr_b
    sepIn: 0.45,    // soft separation target inside a clutch (in D): clutch-mates overlap (kept just outside the hard core)
    sepW: 0.15,     // soft separation push weight
    side: 0.2,      // lateral sidestep gain when blocked ahead
    align: 0.04,    // alignment toward neighbours' velocity
    crowd: 3,       // >0: intent fades to 0 as the overlap ahead grows (1 - ahead*crowd); 0: old 1/(1+3.5 ahead)
    pack: 0.8,      // pull toward the clutch centroid (fraction of speed) once a bug strays past ~1/3 of the clutch radius
    packWv: 0.32,   // clutch weave amplitude (rad): a whole clutch drifts across the stream, so edges go ragged
    bugWv: 0.08,    // per-bug weave amplitude (rad)
    meander: 0.3,   // large-scale travelling wave on the flow direction (rad): rivers snake and bulge
    press: 0.85,    // near a target the soft spacing shrinks to this fraction: the front compresses against the squad
    loner: 0.2,     // fraction of bugs that hatch alone: they drift in the gaps between clutches
    packMin: 3,     // smallest clutch (that isn't a loner)
    packMax: 14,     // largest clutch
    pushMax: 0.15,   // cap on the soft separation push per tick (in r)
    coreRelax: 0.5, // under-relaxation of the per-tick hard-core correction
    tightQ: 0.8,    // bugs whose deepest hard-core overlap is below this (squared, in core units) get the Gauss-Seidel pass
    // swarm-demo only: hive pump rate (per hive per second), spawn spread, prefill count and lateral spread
    demoRate: 42, demoSpread: 24, demoPrefill: 1300, demoLat: 50,
  };

  const HK = 0.56, HK_NEAR = 0.7, HK_IN = 0.42;   // hard-core distance in units of (ra + rb): normal / near a target / clutch-mates
  const NEAR_FD = Math.round((150 * 5) / 24), NEAR_PX = 150;   // "near a target": 150 px by path (flow units) or straight
  const ROW_HYST = Math.PI / 8 + 0.3, ROW_MIN_TICKS = 12;       // facing row hysteresis

  // ---------------------------------------------------------------- species data (aliens.json, with fallbacks)
  const FALLBACK = {
    drone:   { speed: 75,  hp: 10,  damage: 4,  attackRate: 1.2, radius: 8,  sheet: 'bug_drone' },
    runner:  { speed: 135, hp: 6,   damage: 3,  attackRate: 1.6, radius: 7,  sheet: 'bug_runner' },
    spitter: { speed: 55,  hp: 18,  damage: 6,  attackRate: 0.6, radius: 8,  sheet: 'bug_spitter', range: 220 },
    brute:   { speed: 45,  hp: 120, damage: 18, attackRate: 0.8, radius: 16, sheet: 'bug_brute' },
    tank:    { speed: 28,  hp: 600, damage: 45, attackRate: 0.5, radius: 30, sheet: 'bug_tank' },
  };
  const KINDS = {};         // kind -> { speed, hp, dmg, rate, r, range, m, sheets:[names], vw:[cumulative weights], vb:[bulk] }
  function setKinds(json) {
    const sp = (json && json.species) || {};
    const variants = (json && json.variants) || {};
    const base = (p) => String(p).split('/').pop().replace(/\.png$/i, '');
    for (const k of Object.keys(FALLBACK)) {
      const f = FALLBACK[k], s = (sp[k] && sp[k].stats) || {};
      // aliens.json variants: [{ sheet, sprite, weight, bulk, ... }] (or plain sheet names); picked per instance by seed
      const vs = [];
      if (Array.isArray(variants[k])) for (const v of variants[k]) {
        if (typeof v === 'string') vs.push({ name: base(v), w: 1, bulk: 1 });
        else if (v && (v.sheet || v.sprite)) vs.push({ name: v.sheet ? String(v.sheet) : base(v.sprite), w: v.weight > 0 ? +v.weight : 1, bulk: v.bulk > 0 ? +v.bulk : 1 });
      }
      if (!vs.length) vs.push({ name: sp[k] && sp[k].sprite ? base(sp[k].sprite) : f.sheet, w: 1, bulk: 1 });
      const r = +s.radius || f.radius;
      KINDS[k] = {
        kind: k, speed: +s.speed || f.speed, hp: +s.hp || f.hp, dmg: +s.damage || f.damage,
        rate: +s.attackRate || f.attackRate, r, range: +s.range || f.range || 0, m: r * r, vars: vs,
      };
      finishVariants(KINDS[k]);
    }
  }
  function finishVariants(K) {
    K.sheets = K.vars.map((v) => v.name);
    let acc = 0;
    const tot = K.vars.reduce((s, v) => s + v.w, 0) || 1;
    K.vw = K.vars.map((v) => (acc += v.w / tot));
    K.vb = K.vars.map((v) => v.bulk);
  }
  setKinds(null);
  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = IP.assets.json(IP.assets.base + 'aliens.json').then(setKinds, (e) => console.warn('[swarm] aliens.json: ' + e.message))
        .then(() => {
          const names = new Set(['bug_drone']);
          for (const k in KINDS) for (const n of KINDS[k].sheets) names.add(n);
          return Promise.all([...names].map((n) => IP.assets.load(n).then(() => n, () => null))).then((ok) => {
            const have = new Set(ok.filter(Boolean));
            for (const k in KINDS) {
              const K = KINDS[k];
              K.vars = K.vars.filter((v) => have.has(v.name));
              if (!K.vars.length) K.vars = [{ name: 'bug_drone', w: 1, bulk: 1 }];
              finishVariants(K);
            }
          });
        });
    }
    return dataPromise;
  }

  // ---------------------------------------------------------------- state
  function newState(world) {
    return {
      rng: IP.fork(world, 'swarm'), nextId: 1, budget: 0,
      blockers: [],                  // [{x, y, r}] extra impassable circles (scenarios)
      targets: [], tKind: [],
      hash: null, field: null, sdf: null,
      fieldTick: -999, fieldSig: '', dirty: true,
      stats: { ms: 0, maxMs: 0, bites: 0, kills: 0, spits: 0, spawned: 0, minSep: 0 },
      demo: null,
      // packs: bugs hatch in clutches of 2-7 that hold together (shared pace, shared weave, tighter spacing inside)
      // so a stream is lumps of overlapping bugs with gaps between them instead of one even lattice
      pk: { cap: 0, next: 0, free: [], n: null, cx: null, cy: null, cn: null, spd: null, ph: null, open: new Map() },
    };
  }
  function packGrow(P, need) {
    if (need <= P.cap) return;
    const cap = Math.max(256, need * 2);
    const g = (A, T) => { const b = new T(cap); if (A) b.set(A); return b; };
    P.n = g(P.n, Int32Array); P.cx = g(P.cx, Float32Array); P.cy = g(P.cy, Float32Array); P.cn = g(P.cn, Int32Array);
    P.spd = g(P.spd, Float32Array); P.ph = g(P.ph, Float32Array); P.g = g(P.g, Int32Array); P.wv = g(P.wv, Float32Array);
    P.cap = cap;
  }
  function newPack(S) {
    const P = S.pk, rng = S.rng;
    const id = P.free.length ? P.free.pop() : P.next++;
    packGrow(P, id + 1);
    P.n[id] = 0; P.g[id]++;
    P.spd[id] = 0.8 + rng() * 0.42;          // packs differ in pace: fast ones catch up and merge, slow ones open gaps
    P.ph[id] = rng() * TAU;
    return id;
  }
  // clutch size: some loners, mostly 2-4, a few big lumps up to packMax
  function packSize(rng, kind) {
    if (kind === 'spitter') return 1 + ((rng() * 2) | 0);
    return KN.packMin + ((rng() * rng() * (KN.packMax - KN.packMin + 1)) | 0);
  }
  // the pack a new bug joins: spawns at the same spot (same kind, within 0.7 s) fill one clutch before opening the next
  function packFor(world, S, kind, x, y, solo) {
    if (solo || kind === 'brute' || kind === 'tank' || S.rng() < KN.loner) return -1;
    const P = S.pk, key = kind + ':' + Math.round(x / 64) + ':' + Math.round(y / 64);
    let o = P.open.get(key);
    if (!o || o.left <= 0 || world.time - o.t > 0.7 || P.g[o.id] !== o.g || P.n[o.id] <= 0) {
      const sz = packSize(S.rng, kind);
      const id = newPack(S);
      o = { id, g: P.g[id], left: sz, t: world.time };
      P.open.set(key, o);
      if (P.open.size > 64) for (const [k, v] of P.open) { if (world.time - v.t > 0.7) P.open.delete(k); }
    }
    o.left--; o.t = world.time;
    return o.id;
  }
  function budget(world) {
    const S = world.swarm;
    return S && S.budget > 0 ? S.budget : IP.budget.aliens;
  }

  // ---------------------------------------------------------------- spawning
  function makeAlien(world, S, kind, x, y, pk) {
    const K = KINDS[kind] || KINDS.drone, rng = S.rng;
    let vi = 0;
    if (K.vw.length > 1) { const u = rng(); while (vi < K.vw.length - 1 && u > K.vw[vi]) vi++; }
    const sheet = K.sheets[vi];
    // body size follows the variant's bulk (0.7..1.3 -> radius 0.84..1.14 r): a lean drone packs closer than a fat one
    const rr = K.r * Math.sqrt(K.vb[vi] || 1);
    if (pk == null) pk = -1;
    if (pk >= 0) S.pk.n[pk]++;
    const pace = pk >= 0 ? S.pk.spd[pk] * (0.93 + rng() * 0.14) : 0.78 + rng() * 0.44;
    // a little tint jitter (aliens.json: "plus optional tint jitter") so the mass reads as individuals
    const j = rng(), tr = 232 + ((rng() * 23) | 0), tg = 236 + ((rng() * 19) | 0), tb = 236 + ((rng() * 19) | 0);
    const ang = rng() * TAU;
    return {
      id: S.nextId++, kind: K.kind, x, y, vx: 0, vy: 0, r: rr, dir: ang,
      hp: K.hp, maxHp: K.hp, speed: K.speed * pace, state: 'move', targetId: null,
      sheet, variant: vi, anim: 'walk', frame: 0, hitT: -1,
      // private
      dmg: K.dmg, rate: K.rate, range: K.range, m: rr * rr, cd: 0, atkT: 9, ux: 0, uy: 0, pk,
      row: IP.dirIndex(ang), animT: (rng() * 8) | 0, tint: j < 0.5 ? 0xffffffff : IP.rgba(tr, tg, tb, 1),
      target: null, tKind: '', _s: IP.assets.sheet(sheet),
      // personal space varies a lot per bug (0.65..1.35 r): spacing, overlap and clumping differ bug to bug, so a
      // dense stream never settles into one even lattice
      sr: rr * (0.75 + rng() * 0.5), ph: rng() * TAU, born: world.time,
      fo: (rng() - 0.5) * 0.5, rowT: -99, hk: 0.56,
    };
  }
  function spawn(world, o) {
    o = o || {};
    if (!world.swarm) world.swarm = newState(world);
    const S = world.swarm, al = world.aliens;
    let n = Math.max(0, (o.n == null ? 1 : o.n) | 0);
    n = Math.min(n, budget(world) - al.length);
    if (n <= 0) return 0;
    if (o.kind != null && !KINDS[o.kind]) return 0;     // unknown species: spawn nothing (caller bug), never silent drones
    const kind = o.kind != null ? o.kind : 'drone', K = KINDS[kind], rng = S.rng;
    const spread = o.spread != null ? +o.spread : 6 + Math.sqrt(n) * K.r * 1.3;
    const x0 = +o.x || 0, y0 = +o.y || 0;
    // a spawn spot must be off rock and (when the hash is live) not already occupied: a choked hive mouth waits
    const crowdCheck = o.crowd !== false && S.hash && S.hash.built && S.hash.n === al.length;
    const hit = () => true;
    let made = 0, curPk = -1, curLeft = 0;
    for (let i = 0; i < n; i++) {
      let x = x0, y = y0, ok = false;
      for (let tries = 0; tries < 8; tries++) {
        const a = rng() * TAU, d = Math.sqrt(rng()) * spread;
        x = x0 + Math.cos(a) * d; y = y0 + Math.sin(a) * d;
        if (S.sdf && sdfAt(S.sdf, x, y) < K.r * 0.5) continue;
        if (crowdCheck && inRadius(world, x, y, K.r * 1.05, hit) > 0) continue;
        ok = true; break;
      }
      if (!ok && (crowdCheck || S.sdf)) continue;
      // n > 1: one call hatches whole clutches; n == 1 calls at one spot share an open clutch
      let pk = -1;
      if (o.pack != null) { pk = o.pack | 0; if (pk < 0 || pk >= S.pk.next || S.pk.n[pk] <= 0) pk = -1; }   // join a live clutch only
      else if (o.solo || kind === 'brute' || kind === 'tank' || rng() < KN.loner) pk = -1;
      else if (n > 1) {
        if (curLeft <= 0) { curPk = newPack(S); curLeft = packSize(rng, kind); }
        pk = curPk; curLeft--;
      } else pk = packFor(world, S, kind, x0, y0, false);
      al.push(makeAlien(world, S, kind, x, y, pk));
      made++;
    }
    n = made;
    S.stats.spawned += n;
    S.dirty = true;
    return n;
  }

  // ---------------------------------------------------------------- damage / death
  function kill(world, a, cause) {
    if (a.state === 'dead') return;
    a.state = 'dead';
    const S = world.swarm;
    if (S) { S.stats.kills++; S.dirty = true; }
    IP.emit(world, 'alien-died', { x: a.x, y: a.y, kind: a.kind, dir: a.dir, cause: cause || 'damage', id: a.id, r: a.r, sheet: a.sheet });
  }
  function damage(world, a, dmg, cause) {
    if (!a || a.state === 'dead') return false;
    a.hp -= dmg;
    a.hitT = world.time;
    IP.emit(world, 'hit', { x: a.x, y: a.y, dmg, targetKind: 'alien', id: a.id, kind: a.kind, cause: cause || '' });
    if (a.hp <= 0) { kill(world, a, cause); return true; }
    return false;
  }
  function sweep(world, S) {
    const al = world.aliens;
    let w = 0;
    for (let i = 0; i < al.length; i++) {
      const a = al[i];
      if (a.m === undefined) adopt(world, S, a);
      if (a.state === 'dead' || a.hp <= 0) {
        if (a.state !== 'dead') kill(world, a, 'damage');
        if (a.pk >= 0) { const P = S.pk; if (--P.n[a.pk] <= 0) { P.n[a.pk] = 0; P.free.push(a.pk); } a.pk = -1; }
        continue;
      }
      al[w++] = a;
    }
    if (w !== al.length) { al.length = w; S.dirty = true; }
  }
  // an alien pushed into world.aliens by someone else: give it the private fields
  function adopt(world, S, a) {
    const b = makeAlien(world, S, KINDS[a.kind] ? a.kind : 'drone', +a.x || 0, +a.y || 0);
    for (const k in b) if (a[k] === undefined) a[k] = b[k];
  }

  // ---------------------------------------------------------------- walls: signed distance field (px) on a FINE grid
  function buildSdf(world, S) {
    const map = world.map || { w: 3840, h: 2160 };
    const cols = Math.max(1, Math.ceil(map.w / FINE)), rows = Math.max(1, Math.ceil(map.h / FINE)), n = cols * rows;
    const blocked = new Uint8Array(n);
    const terOn = !!IP.terrain && world.systems.some((s) => s.name === 'terrain');
    // terrain's own SDF when it has one (exact, 4 px); otherwise sample its passability into our grid
    const terSdf = terOn && typeof IP.terrain.sdf === 'function' && world.terrain && world.terrain.sdf ? IP.terrain : null;
    const ter = !terSdf && terOn && typeof IP.terrain.passable === 'function' ? IP.terrain : null;
    const bl = S.blockers;
    for (let gy = 0; gy < rows; gy++) {
      const y = (gy + 0.5) * FINE;
      for (let gx = 0; gx < cols; gx++) {
        const x = (gx + 0.5) * FINE;
        let b = 0;
        for (let k = 0; k < bl.length; k++) { const o = bl[k], dx = x - o.x, dy = y - o.y; if (dx * dx + dy * dy < o.r * o.r) { b = 1; break; } }
        if (!b && ter) { try { b = ter.passable(world, x, y) ? 0 : 1; } catch (e) { b = 0; } }
        blocked[gy * cols + gx] = b;
      }
    }
    // two chamfer transforms: distance to the nearest blocked cell (free cells), and to the nearest free cell (blocked)
    const dOut = chamfer(blocked, cols, rows, 1), dIn = chamfer(blocked, cols, rows, 0);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i++) sd[i] = blocked[i] ? -(dIn[i] - FINE / 2) : dOut[i] - FINE / 2;
    if (terSdf) {
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        let v;
        try { v = terSdf.sdf(world, (gx + 0.5) * FINE, (gy + 0.5) * FINE); } catch (e) { v = 1e4; }
        const i = gy * cols + gx;
        if (v < sd[i]) sd[i] = v;
      }
    }
    S.sdf = { cols, rows, sd, blocked, w: map.w, h: map.h };
  }
  // distance (px) from each cell with value `want` to the nearest cell without it; map edge counts as blocked for free cells
  function chamfer(blocked, cols, rows, want) {
    const n = cols * rows, d = new Float32Array(n), A = FINE, B = FINE * Math.SQRT2;
    for (let i = 0; i < n; i++) d[i] = (blocked[i] ? 0 : 1) === want ? 1e9 : 0;
    const edge = want === 1 ? FINE / 2 : 1e9;   // free cells: the map edge is a wall half a cell away
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (want === 1) { const e = Math.min(x, y, cols - 1 - x, rows - 1 - y) * A + edge; if (e < v) v = e; }
      if (x > 0 && d[i - 1] + A < v) v = d[i - 1] + A;
      if (y > 0) {
        if (d[i - cols] + A < v) v = d[i - cols] + A;
        if (x > 0 && d[i - cols - 1] + B < v) v = d[i - cols - 1] + B;
        if (x < cols - 1 && d[i - cols + 1] + B < v) v = d[i - cols + 1] + B;
      }
      d[i] = v;
    }
    for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (d[i] === 0) continue;
      let v = d[i];
      if (x < cols - 1 && d[i + 1] + A < v) v = d[i + 1] + A;
      if (y < rows - 1) {
        if (d[i + cols] + A < v) v = d[i + cols] + A;
        if (x < cols - 1 && d[i + cols + 1] + B < v) v = d[i + cols + 1] + B;
        if (x > 0 && d[i + cols - 1] + B < v) v = d[i + cols - 1] + B;
      }
      d[i] = v;
    }
    return d;
  }
  // bilinear SDF sample; outside the map is a wall
  function sdfAt(F, x, y) {
    if (x < 0 || y < 0 || x >= F.w || y >= F.h) {
      const ox = x < 0 ? -x : x >= F.w ? x - F.w : 0, oy = y < 0 ? -y : y >= F.h ? y - F.h : 0;
      return -Math.max(ox, oy) - 1;
    }
    const gx = x / FINE - 0.5, gy = y / FINE - 0.5;
    let ix = Math.floor(gx), iy = Math.floor(gy);
    const tx = gx - ix, ty = gy - iy, c = F.cols, rr = F.rows;
    let ix1 = ix + 1, iy1 = iy + 1;
    if (ix < 0) ix = 0; if (iy < 0) iy = 0; if (ix1 > c - 1) ix1 = c - 1; if (iy1 > rr - 1) iy1 = rr - 1;
    if (ix > c - 1) ix = c - 1; if (iy > rr - 1) iy = rr - 1;
    const s = F.sd, a = s[iy * c + ix], b = s[iy * c + ix1], d0 = s[iy1 * c + ix], e = s[iy1 * c + ix1];
    return a + (b - a) * tx + (d0 - a) * ty + (a - b - d0 + e) * tx * ty;
  }

  // ---------------------------------------------------------------- targets + flow field
  function gatherTargets(world, S) {
    const T = S.targets, K = S.tKind;
    T.length = 0; K.length = 0;
    const ms = world.marines;
    if (ms) for (let i = 0; i < ms.length; i++) { const m = ms[i]; if (m && m.state !== 'dead' && m.hp > 0) { T.push(m); K.push('marine'); } }
    const ss = world.structures;
    if (ss) for (let i = 0; i < ss.length; i++) {
      const s = ss[i];
      if (s && s.owner === 'player' && s.kind !== 'node' && s.hp > 0 && s.state !== 'dead') { T.push(s); K.push('structure'); }
    }
  }
  function maybeBuildField(world, S) {
    const T = S.targets;
    let sig = T.length + ':';
    for (let i = 0; i < T.length; i++) sig += T[i].id + ',';
    const f = S.field;
    let need = !f || sig !== S.fieldSig;
    if (!need && world.tick - S.fieldTick >= 8) {
      for (let i = 0; i < T.length; i++) {
        const dx = T[i].x - f.tx[i], dy = T[i].y - f.ty[i];
        if (dx * dx + dy * dy > 10 * 10) { need = true; break; }
      }
    }
    if (need) { buildField(world, S); S.fieldSig = sig; S.fieldTick = world.tick; }
  }
  function buildField(world, S) {
    const map = world.map || { w: 3840, h: 2160 };
    const cols = Math.max(1, Math.ceil(map.w / FC)), rows = Math.max(1, Math.ceil(map.h / FC)), n = cols * rows;
    let f = S.field;
    if (!f || f.cols !== cols || f.rows !== rows) {
      f = S.field = {
        cols, rows, dist: new Int32Array(n), owner: new Int16Array(n), fx: new Float32Array(n), fy: new Float32Array(n),
        wall: new Uint8Array(n), tx: new Float32Array(0), ty: new Float32Array(0), buckets: [[], [], [], [], [], [], [], []], ntargets: 0,
      };
      // flow cells too close to a wall are not walked through (keeps streams off the rock rims)
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        f.wall[gy * cols + gx] = S.sdf && sdfAt(S.sdf, (gx + 0.5) * FC, (gy + 0.5) * FC) < CLEAR ? 1 : 0;
      }
    }
    const T = S.targets, nt = T.length;
    if (f.tx.length < nt) { f.tx = new Float32Array(nt + 8); f.ty = new Float32Array(nt + 8); }
    for (let i = 0; i < nt; i++) { f.tx[i] = T[i].x; f.ty[i] = T[i].y; }
    f.ntargets = nt;
    const dist = f.dist, owner = f.owner, wall = f.wall, B = f.buckets;
    dist.fill(INF); owner.fill(-1);
    for (const b of B) b.length = 0;
    let pending = 0;
    // seeds: every cell under a target (dist 0)
    for (let t = 0; t < nt; t++) {
      const o = T[t], rad = (o.r || 12) + FC * 0.5;
      const gx0 = Math.max(0, Math.floor((o.x - rad) / FC)), gx1 = Math.min(cols - 1, Math.floor((o.x + rad) / FC));
      const gy0 = Math.max(0, Math.floor((o.y - rad) / FC)), gy1 = Math.min(rows - 1, Math.floor((o.y + rad) / FC));
      let seeded = false;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
        const cx = (gx + 0.5) * FC - o.x, cy = (gy + 0.5) * FC - o.y;
        if (cx * cx + cy * cy > rad * rad) continue;
        const c = gy * cols + gx;
        if (dist[c] === 0) continue;
        dist[c] = 0; owner[c] = t; B[0].push(c); pending++; seeded = true;
      }
      if (!seeded) {
        const gx = IP.clamp(Math.floor(o.x / FC), 0, cols - 1), gy = IP.clamp(Math.floor(o.y / FC), 0, rows - 1), c = gy * cols + gx;
        if (dist[c] !== 0) { dist[c] = 0; owner[c] = t; B[0].push(c); pending++; }
      }
    }
    // Dial's algorithm, costs 5 (orthogonal) / 7 (diagonal), no corner cutting
    let cur = 0;
    while (pending > 0) {
      const b = B[cur & 7];
      while (b.length) {
        const c = b.pop(); pending--;
        if (dist[c] !== cur) continue;
        const gx = c % cols, gy = (c / cols) | 0, ow = owner[c];
        const l = gx > 0, rt = gx < cols - 1, u = gy > 0, dn = gy < rows - 1;
        const wl = l && !wall[c - 1], wr = rt && !wall[c + 1], wu = u && !wall[c - cols], wd = dn && !wall[c + cols];
        let nd = cur + 5;
        if (wl && nd < dist[c - 1]) { dist[c - 1] = nd; owner[c - 1] = ow; B[nd & 7].push(c - 1); pending++; }
        if (wr && nd < dist[c + 1]) { dist[c + 1] = nd; owner[c + 1] = ow; B[nd & 7].push(c + 1); pending++; }
        if (wu && nd < dist[c - cols]) { dist[c - cols] = nd; owner[c - cols] = ow; B[nd & 7].push(c - cols); pending++; }
        if (wd && nd < dist[c + cols]) { dist[c + cols] = nd; owner[c + cols] = ow; B[nd & 7].push(c + cols); pending++; }
        nd = cur + 7;
        let k;
        if (wl && wu && !wall[k = c - cols - 1] && nd < dist[k]) { dist[k] = nd; owner[k] = ow; B[nd & 7].push(k); pending++; }
        if (wr && wu && !wall[k = c - cols + 1] && nd < dist[k]) { dist[k] = nd; owner[k] = ow; B[nd & 7].push(k); pending++; }
        if (wl && wd && !wall[k = c + cols - 1] && nd < dist[k]) { dist[k] = nd; owner[k] = ow; B[nd & 7].push(k); pending++; }
        if (wr && wd && !wall[k = c + cols + 1] && nd < dist[k]) { dist[k] = nd; owner[k] = ow; B[nd & 7].push(k); pending++; }
      }
      cur++;
    }
    // wall cells (and anything unreached next to reached cells) point at their best reachable neighbour
    for (let c = 0; c < n; c++) {
      if (dist[c] !== INF) continue;
      const gx = c % cols, gy = (c / cols) | 0;
      let best = INF, bo = -1, bx = 0, by = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const x = gx + ox, y = gy + oy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const k = y * cols + x, d = dist[k];
        if (d < best && !wall[k]) { best = d; bo = owner[k]; bx = ox; by = oy; }
      }
      if (bo >= 0) {
        const l = Math.hypot(bx, by);
        f.fx[c] = bx / l; f.fy[c] = by / l; owner[c] = bo; dist[c] = -(best + (bx && by ? 7 : 5));  // negative = "wall cell, provisional"
      } else { f.fx[c] = 0; f.fy[c] = 0; }
    }
    // reached cells: steepest descent blended with the central-difference gradient (smooth flow, no 8-way banding)
    for (let c = 0; c < n; c++) {
      const d = dist[c];
      if (d === INF || d < 0) continue;
      const gx = c % cols, gy = (c / cols) | 0;
      if (d === 0) {
        const o = T[owner[c]], dx = o.x - (gx + 0.5) * FC, dy = o.y - (gy + 0.5) * FC, l = Math.hypot(dx, dy) || 1;
        f.fx[c] = dx / l; f.fy[c] = dy / l; continue;
      }
      let best = d, bx = 0, by = 0;
      const l = gx > 0, rt = gx < cols - 1, u = gy > 0, dn = gy < rows - 1;
      const ok = (k) => dist[k] >= 0 && dist[k] !== INF && !wall[k];
      const wl = l && ok(c - 1), wr = rt && ok(c + 1), wu = u && ok(c - cols), wd = dn && ok(c + cols);
      if (wl && dist[c - 1] < best) { best = dist[c - 1]; bx = -1; by = 0; }
      if (wr && dist[c + 1] < best) { best = dist[c + 1]; bx = 1; by = 0; }
      if (wu && dist[c - cols] < best) { best = dist[c - cols]; bx = 0; by = -1; }
      if (wd && dist[c + cols] < best) { best = dist[c + cols]; bx = 0; by = 1; }
      if (wl && wu && ok(c - cols - 1) && dist[c - cols - 1] < best) { best = dist[c - cols - 1]; bx = -1; by = -1; }
      if (wr && wu && ok(c - cols + 1) && dist[c - cols + 1] < best) { best = dist[c - cols + 1]; bx = 1; by = -1; }
      if (wl && wd && ok(c + cols - 1) && dist[c + cols - 1] < best) { best = dist[c + cols - 1]; bx = -1; by = 1; }
      if (wr && wd && ok(c + cols + 1) && dist[c + cols + 1] < best) { best = dist[c + cols + 1]; bx = 1; by = 1; }
      let mx = bx, my = by;
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      // gradient (walls / edges count as uphill)
      const dW = wl ? dist[c - 1] : d + 5, dE = wr ? dist[c + 1] : d + 5, dN = wu ? dist[c - cols] : d + 5, dS = wd ? dist[c + cols] : d + 5;
      let gxv = dW - dE, gyv = dN - dS;
      const gl = Math.hypot(gxv, gyv);
      if (gl > 1e-6) {
        gxv /= gl; gyv /= gl;
        if (gxv * mx + gyv * my > 0.2) { mx += gxv; my += gyv; }
      }
      const fl = Math.hypot(mx, my) || 1;
      f.fx[c] = mx / fl; f.fy[c] = my / fl;
    }
    for (let c = 0; c < n; c++) if (dist[c] < 0) dist[c] = -dist[c];
  }

  // ---------------------------------------------------------------- spatial hash (cell 48), counting-sort layout
  function buildHash(world, S) {
    const map = world.map || { w: 3840, h: 2160 };
    const al = world.aliens, n = al.length;
    let H = S.hash;
    const cols = Math.max(1, Math.ceil(map.w / HASH) + 2), rows = Math.max(1, Math.ceil(map.h / HASH) + 2);
    if (!H || H.cols !== cols || H.rows !== rows) {
      H = S.hash = { cols, rows, start: new Int32Array(cols * rows + 1), cur: new Int32Array(cols * rows + 1), items: new Int32Array(0), cell: new Int32Array(0),
        px: new Float32Array(0), py: new Float32Array(0), pr: new Float32Array(0), pm: new Float32Array(0), pvx: new Float32Array(0), pvy: new Float32Array(0),
        rr: new Float32Array(0), pp: new Int32Array(0), hk: new Float32Array(0), wl: new Uint8Array(0), cmax: new Float32Array(cols * rows), n: 0, built: false };
    }
    if (H.items.length < n) {
      const cap = Math.max(1024, n * 1.5) | 0;
      H.items = new Int32Array(cap); H.cell = new Int32Array(cap);
      H.px = new Float32Array(cap); H.py = new Float32Array(cap); H.pr = new Float32Array(cap); H.pm = new Float32Array(cap);
      H.pvx = new Float32Array(cap); H.pvy = new Float32Array(cap); H.rr = new Float32Array(cap); H.pp = new Int32Array(cap); H.hk = new Float32Array(cap); H.wl = new Uint8Array(cap);
    }
    const start = H.start, cur = H.cur, cell = H.cell, items = H.items, nc = cols * rows, inv = 1 / HASH;
    start.fill(0);
    const cmax = H.cmax;
    cmax.fill(0);
    for (let i = 0; i < n; i++) {
      const a = al[i];
      let cx = ((a.x * inv) | 0) + 1, cy = ((a.y * inv) | 0) + 1;
      if (a.x < 0) cx = 0; if (a.y < 0) cy = 0;
      if (cx >= cols) cx = cols - 1; if (cy >= rows) cy = rows - 1;
      const c = cy * cols + cx;
      cell[i] = c; start[c + 1]++;
      if (a.sr > cmax[c]) cmax[c] = a.sr;
      H.px[i] = a.x; H.py[i] = a.y; H.pr[i] = a.sr; H.pm[i] = a.m; H.pvx[i] = a.vx; H.pvy[i] = a.vy; H.rr[i] = a.r; H.pp[i] = a.pk == null ? -1 : a.pk;
    }
    for (let c = 0; c < nc; c++) start[c + 1] += start[c];
    cur.set(start);
    for (let i = 0; i < n; i++) items[cur[cell[i]]++] = i;
    H.n = n; H.built = true;
    S.dirty = false;
  }
  const hcell = (H, v) => { const c = ((v / HASH) | 0) + 1; return v < 0 ? 0 : c; };

  function nearest(world, x, y, r) {
    const S = world.swarm, al = world.aliens;
    if (r == null) r = 1e9;
    let best = null, bd = r * r;
    const H = S && S.hash;
    if (!H || !H.built) {
      for (let i = 0; i < al.length; i++) { const a = al[i]; if (a.state === 'dead') continue; const dx = a.x - x, dy = a.y - y, d = dx * dx + dy * dy; if (d <= bd) { bd = d; best = a; } }
      return best;
    }
    const cx = Math.min(H.cols - 1, hcell(H, x)), cy = Math.min(H.rows - 1, hcell(H, y));
    const maxRing = Math.min(Math.max(H.cols, H.rows), Math.ceil(Math.min(r, 1e6) / HASH) + 1);
    const items = H.items, start = H.start, n = H.n;
    for (let ring = 0; ring <= maxRing; ring++) {
      if (best && (ring - 1) * HASH > Math.sqrt(bd)) break;
      const x0 = cx - ring, x1 = cx + ring, y0 = cy - ring, y1 = cy + ring;
      for (let gy = y0; gy <= y1; gy++) {
        if (gy < 0 || gy >= H.rows) continue;
        const edgeRow = gy === y0 || gy === y1, stepX = edgeRow ? 1 : Math.max(1, x1 - x0);
        for (let gx = x0; gx <= x1; gx += stepX) {
          if (gx < 0 || gx >= H.cols) continue;
          const c = gy * H.cols + gx;
          for (let k = start[c], e = start[c + 1]; k < e; k++) {
            const idx = items[k];
            if (idx >= n || idx >= al.length) continue;
            const a = al[idx];
            if (a.state === 'dead') continue;
            const dx = a.x - x, dy = a.y - y, d = dx * dx + dy * dy;
            if (d <= bd) { bd = d; best = a; }
          }
        }
      }
    }
    return best;
  }
  function inRadius(world, x, y, r, cb) {
    const S = world.swarm, al = world.aliens, r2 = r * r;
    let count = 0;
    const H = S && S.hash;
    if (!H || !H.built) {
      for (let i = 0; i < al.length; i++) {
        const a = al[i]; if (a.state === 'dead') continue;
        const dx = a.x - x, dy = a.y - y;
        if (dx * dx + dy * dy <= r2) { count++; if (cb && cb(a) === true) break; }
      }
      return count;
    }
    const gx0 = Math.max(0, hcell(H, x - r)), gx1 = Math.min(H.cols - 1, hcell(H, x + r));
    const gy0 = Math.max(0, hcell(H, y - r)), gy1 = Math.min(H.rows - 1, hcell(H, y + r));
    const items = H.items, start = H.start, n = Math.min(H.n, al.length);
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const c = gy * H.cols + gx;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const idx = items[k];
        if (idx >= n) continue;
        const a = al[idx];
        if (a.state === 'dead') continue;
        const dx = a.x - x, dy = a.y - y;
        if (dx * dx + dy * dy <= r2) { count++; if (cb && cb(a) === true) return count; }
      }
    }
    return count;
  }
  function flowDist(world, x, y) {
    const S = world.swarm, f = S && S.field;
    if (!f || !f.ntargets) return Infinity;
    const gx = IP.clamp(Math.floor(x / FC), 0, f.cols - 1), gy = IP.clamp(Math.floor(y / FC), 0, f.rows - 1);
    const d = f.dist[gy * f.cols + gx];
    return d >= INF ? Infinity : (d * FC) / 5;
  }

  // ---------------------------------------------------------------- the per-tick swarm step
  function steer(world, S, dt) {
    S.stats.t0 = performance.now();
    const CROWD = KN.crowd, COH = KN.coh, SEPK = KN.sepK, SEPW = KN.sepW, SIDESTEP = KN.side, ALIGN = KN.align;
    const al = world.aliens, n = al.length, H = S.hash, f = S.field, F = S.sdf, T = S.targets, TK = S.tKind, nt = T.length;
    const items = H.items, start = H.start, cols = H.cols;
    const px = H.px, py = H.py, pr = H.pr, pm = H.pm, pvx = H.pvx, pvy = H.pvy, hr = H.rr, tick = world.tick;
    const rng = S.rng, time = world.time;
    const tight = S.tight || (S.tight = []);
    tight.length = 0;
    const cmax = H.cmax, hrows = H.rows, inv = 1 / HASH, pp = H.pp;
    const SEPIN = KN.sepIn, PACK = KN.pack, PACKWV = KN.packWv, BUGWV = KN.bugWv, MEANDER = KN.meander, PRESS = KN.press;
    // pack centroids from this tick's positions
    const P = S.pk, pcx = P.cx, pcy = P.cy, pcn = P.cn, pwv = P.wv;
    if (P.next) {
      pcx.fill(0, 0, P.next); pcy.fill(0, 0, P.next); pcn.fill(0, 0, P.next);
      for (let k = 0; k < P.next; k++) pwv[k] = fsin(time * 0.85 + P.ph[k]) * PACKWV;   // clutch weave, once per clutch
    }
    for (let i = 0; i < n; i++) { const k = pp[i]; if (k >= 0) { pcx[k] += px[i]; pcy[k] += py[i]; pcn[k]++; } }
    for (let ii = 0; ii < n; ii++) {
      const i = items[ii];                 // hash order: neighbours sit next to each other in memory
      const a = al[i];
      const x = px[i], y = py[i], sr = pr[i], r = a.r, mi = pm[i];
      // ---- neighbours: soft separation (position push, overlap allowed; tighter inside a clutch), alignment, crowding,
      // and cohesion toward the centroid of everyone in reach (edge bugs get pulled in: narrow, ragged rivers)
      let sx = 0, sy = 0, avx = 0, avy = 0, an = 0, cnx = 0, cny = 0, chx = 0, chy = 0, hcx = 0, hcy = 0, minQ2 = 99;
      const hk = a.hk, hkIn = hk > HK ? HK_IN * 1.25 : HK_IN, mpk = pp[i], sepOut = a.hk > HK ? SEPK * PRESS : SEPK, sepIn = a.hk > HK ? SEPIN * PRESS : SEPIN, heavy = mi * 0.5;
      const c = H.cell[i], ccx = c % cols, ccy = (c / cols) | 0;
      // only the cells the interaction circle actually touches (usually 1-4 of the 3x3)
      let big = 0;
      for (let gy = ccy - 1; gy <= ccy + 1; gy++) {
        if (gy < 0 || gy >= hrows) continue;
        for (let gx = ccx - 1; gx <= ccx + 1; gx++) { if (gx >= 0 && gx < cols) { const v = cmax[gy * cols + gx]; if (v > big) big = v; } }
      }
      const R = (sr + big) * 1.45;
      let gy0 = ((y - R) * inv | 0) + 1, gy1 = ((y + R) * inv | 0) + 1, gx0 = ((x - R) * inv | 0) + 1, gx1 = ((x + R) * inv | 0) + 1;
      if (y - R < 0) gy0 = 0; if (x - R < 0) gx0 = 0;
      if (gy0 < ccy - 1) gy0 = ccy - 1; if (gy1 > ccy + 1) gy1 = ccy + 1; if (gx0 < ccx - 1) gx0 = ccx - 1; if (gx1 > ccx + 1) gx1 = ccx + 1;
      for (let gy = gy0; gy <= gy1; gy++) {
        if (gy < 0 || gy >= hrows) continue;
        const row = gy * cols;
        for (let gx = gx0; gx <= gx1; gx++) {
          if (gx < 0 || gx >= cols) continue;
          const cc = row + gx;
          for (let k = start[cc], e = start[cc + 1]; k < e; k++) {
            const j = items[k];
            if (j === i) continue;
            const dx = x - px[j], dy = y - py[j], D = sr + pr[j], d2 = dx * dx + dy * dy, A = D * 1.45;
            if (d2 >= A * A) continue;
            avx += pvx[j]; avy += pvy[j]; an++; chx += px[j]; chy += py[j];
            // clutch-mates may overlap deeper (smaller hard core) than strangers
            const same = mpk >= 0 && pp[j] === mpk, hkp = same ? hkIn : hk, hkp2 = hkp * hkp;
            const rp = r + hr[j], q2 = d2 / (rp * rp);
            // soft target never inside the hard core, so the cheap soft push settles almost every pair by itself
            let Dt = D * (same ? sepIn : sepOut);
            if (Dt < rp * hkp * 1.15) Dt = rp * hkp * 1.15;
            if (d2 < Dt * Dt || q2 < hkp2) {
              let d = Math.sqrt(d2), nx, ny;
              if (d < 1e-4) { const ang = ((i * 2.399963) + j * 0.7) % TAU; nx = Math.cos(ang); ny = Math.sin(ang); d = 0; }
              else { nx = dx / d; ny = dy / d; }
              const w = pm[j] / (mi + pm[j]);
              if (d < Dt) {
                const o = Dt - d;
                sx += nx * o * w * SEPW; sy += ny * o * w * SEPW;
                // much lighter bugs don't block a heavy one (brutes and tanks shove drones aside instead of queueing)
                if (pm[j] >= heavy) { cnx -= nx * (o / Dt); cny -= ny * (o / Dt); }
              }
              // hard core (soft overlap stops here): full correction, not clamped like the soft push
              if (q2 < hkp2) {
                const o = hkp * rp - d;
                hcx += nx * o * w; hcy += ny * o * w;
                if (q2 / hkp2 < minQ2) minQ2 = q2 / hkp2;
              }
            }
          }
        }
      }
      // ---- goal: nearest target by path (flow field owner), else nearest by straight line
      let tgt = null, tk = '', fd = INF, fx = 0, fy = 0;
      if (nt) {
        if (f && f.ntargets === nt) {
          const gxf = x / FC - 0.5, gyf = y / FC - 0.5;
          let ix = Math.floor(gxf), iy = Math.floor(gyf);
          const tx = gxf - ix, ty = gyf - iy;
          const fc = f.cols, fr = f.rows;
          // nearest cell: owner + distance
          const nxI = IP.clamp(Math.floor(x / FC), 0, fc - 1), nyI = IP.clamp(Math.floor(y / FC), 0, fr - 1), nc = nyI * fc + nxI;
          const ow = f.owner[nc];
          fd = f.dist[nc];
          if (ow >= 0 && ow < nt) { tgt = T[ow]; tk = TK[ow]; }
          // bilinear flow direction
          for (let q = 0; q < 4; q++) {
            let gx = ix + (q & 1), gy = iy + (q >> 1);
            if (gx < 0) gx = 0; if (gy < 0) gy = 0; if (gx > fc - 1) gx = fc - 1; if (gy > fr - 1) gy = fr - 1;
            const w = ((q & 1) ? tx : 1 - tx) * ((q >> 1) ? ty : 1 - ty), k = gy * fc + gx;
            fx += f.fx[k] * w; fy += f.fy[k] * w;
          }
          const fl = Math.sqrt(fx * fx + fy * fy);
          if (fl > 1e-3) { fx /= fl; fy /= fl; } else { fx = f.fx[nc]; fy = f.fy[nc]; }
        }
        if (!tgt) {
          let bd = Infinity;
          for (let t = 0; t < nt; t++) { const dx = T[t].x - x, dy = T[t].y - y, d = dx * dx + dy * dy; if (d < bd) { bd = d; tgt = T[t]; tk = TK[t]; } }
          fd = INF;
        }
      }
      let desX = 0, desY = 0, mode = 0; // 0 idle, 1 move, 2 melee, 3 ranged
      let kx = 0, ky = 0;               // clutch + cohesion pull: not damped by crowding (lumps still form in a jam)
      let tdx = 0, tdy = 0, td = 1e9;
      if (tgt) {
        tdx = tgt.x - x; tdy = tgt.y - y; td = Math.sqrt(tdx * tdx + tdy * tdy) || 1e-3;
        const reach = r + (tgt.r || 12) + 3;
        const fdPx = fd >= INF ? 1e9 : (fd * FC) / 5;
        if (td <= reach) mode = 2;
        else if (a.range > 0 && td <= a.range && fdPx <= a.range * 1.3) mode = 3;
        else mode = 1;
        const sp = a.speed * (0.92 + 0.08 * fsin(time * 3.3 + a.ph * 1.7));
        if (mode === 1) {
          if (fd >= INF || fdPx < 64 || (fx === 0 && fy === 0)) { desX = (tdx / td) * sp; desY = (tdy / td) * sp; }
          else {
            // weave: the whole clutch drifts across the stream together (ragged, bulging edges), each bug shimmers a
            // little, and a slow travelling wave bends the flow so rivers snake instead of running ruler-straight
            const fade = fdPx < 120 ? 0 : fdPx < 320 ? (fdPx - 120) / 200 : 1;
            let wv = fsin(time * 2.1 + a.ph) * BUGWV;
            if (mpk >= 0) wv += pwv[mpk] * fade;
            wv += MEANDER * fade * (fsin(0.0052 * x + 0.0021 * y - time * 0.55) + 0.6 * fsin(-0.0019 * x + 0.0047 * y + time * 0.41 + 1.3)) * 0.625;
            const w2 = wv * wv, cw = 1 - w2 * 0.5 + w2 * w2 / 24, sw = wv * (1 - w2 / 6 + w2 * w2 / 120);   // |wv| < 0.8
            desX = (fx * cw - fy * sw) * sp; desY = (fx * sw + fy * cw) * sp;
          }
          // clutch-mates hold together: pull toward the pack centroid once a bug strays
          if (mpk >= 0 && pcn[mpk] > 1) {
            const cn = pcn[mpk], qx = pcx[mpk] / cn - x, qy = pcy[mpk] / cn - y, ql = Math.sqrt(qx * qx + qy * qy);
            const prad = r * (0.8 + 0.55 * Math.sqrt(cn)), in0 = prad * 0.35;
            if (ql > in0) { const kk = Math.min(1, (ql - in0) / prad) * PACK * sp / ql; kx += qx * kk; ky += qy * kk; }
          }
          // cohesion: drift toward the local centroid (zero inside the mass, inward at the edges)
          if (an && COH > 0) {
            const qx = chx / an - x, qy = chy / an - y, ql = Math.sqrt(qx * qx + qy * qy);
            if (ql > 0.5) { const kk = Math.min(1, ql / sr) * COH * sp / ql; kx += qx * kk; ky += qy * kk; }
          }
        } else if (mode === 2) { desX = (tdx / td) * sp * 0.1; desY = (tdy / td) * sp * 0.1; }
      }
      a.target = tgt; a.tKind = tk; a.targetId = tgt ? tgt.id : null;
      // close to a target the crowd presses hardest: hold a wider hard core there (used from the next tick)
      const near = tgt && (fd < INF ? fd < NEAR_FD : td < NEAR_PX);
      a.hk = near ? HK_NEAR : HK;
      // only pairs the in-loop correction cannot settle (deep overlap) get the Gauss-Seidel pass below
      // (at the front every bug with a close neighbour joins it: crowd pressure there is the whole point)
      const tightMark = minQ2 < KN.tightQ || (near && minQ2 < 1);
      // ---- intent velocity: steer toward desired, damped by crowding, nudged toward neighbours' heading
      // crowding only counts neighbours ahead (blocking the way), so a stream's tail never stalls its head
      const dl = Math.sqrt(desX * desX + desY * desY);
      const ahead = dl > 1e-3 ? Math.max(0, (cnx * desX + cny * desY) / dl) : 0;
      // blocked: sidestep toward the emptier side (crowds fan out and wrap around the squad instead of jamming)
      if (mode === 1 && ahead > 0.04) {
        const qx = -desY / dl, qy = desX / dl, lat = cnx * qx + cny * qy;
        const side = lat > 0.03 ? -1 : lat < -0.03 ? 1 : (a.ph > Math.PI ? 1 : -1);
        const kk = Math.min(1, ahead * 2.5) * SIDESTEP;
        desX += qx * side * dl * kk; desY += qy * side * dl * kk;
      }
      // blocked bugs stop pushing (a queue rests at soft contact instead of compressing into an even lattice)
      // ...except at the front (near a target), where the crowd keeps leaning in and compresses against the squad
      const cf = CROWD > 0 && a.hk <= HK ? Math.max(0, 1 - ahead * CROWD) : 1 / (1 + ahead * 3.5);
      a.ux += (desX * cf + kx - a.ux) * 0.2;
      a.uy += (desY * cf + ky - a.uy) * 0.2;
      if (an) { a.ux += (avx / an - a.ux) * ALIGN; a.uy += (avy / an - a.uy) * ALIGN; }
      let pl = Math.sqrt(sx * sx + sy * sy);
      const pmax = r * KN.pushMax;
      if (pl > pmax) { sx *= pmax / pl; sy *= pmax / pl; }
      // the hard-core sum is under-relaxed (Jacobi over many neighbours overshoots and makes clumps buzz); whatever
      // is left over goes to the Gauss-Seidel pass below
      let hl = Math.sqrt(hcx * hcx + hcy * hcy), hm = r * 0.5;
      const hsc = KN.coreRelax * (hl * KN.coreRelax > hm ? hm / (hl * KN.coreRelax) : 1);
      let nx = x + a.ux * dt + sx + hcx * hsc, ny = y + a.uy * dt + sy + hcy * hsc;
      // ---- targets are solid: aliens pile up around marines/structures, never on them
      if (nt && (fd < 40 || fd >= INF)) {
        for (let t = 0; t < nt; t++) {
          const o = T[t], dx = nx - o.x, dy = ny - o.y, D = r + (o.r || 12), d2 = dx * dx + dy * dy;
          if (d2 < D * D) { const d = Math.sqrt(d2) || 1e-3; nx = o.x + (dx / d) * D; ny = o.y + (dy / d) * D; }
        }
      }
      // ---- walls: soft push out along the SDF gradient, hard stop inside rock
      let onWall = 0;
      if (F) {
        let sd = sdfAt(F, nx, ny);
        if (sd < r) {
          let gx = sdfAt(F, nx + 4, ny) - sdfAt(F, nx - 4, ny), gy = sdfAt(F, nx, ny + 4) - sdfAt(F, nx, ny - 4);
          const gl = Math.sqrt(gx * gx + gy * gy);
          if (gl > 1e-4) {
            gx /= gl; gy /= gl;
            const push = Math.min(r - sd, r + 8);
            nx += gx * push; ny += gy * push;
            // slide: drop the intent component going into the wall
            const into = a.ux * gx + a.uy * gy;
            if (into < 0) { a.ux -= into * gx; a.uy -= into * gy; }
          }
          sd = sdfAt(F, nx, ny);
          if (sd < 0 && sdfAt(F, x, y) > sd) { nx = x; ny = y; }
          onWall = 1;
        }
      }
      H.wl[i] = onWall;
      if (tightMark) tight.push(i);
      // ---- commit
      const mvx = nx - x, mvy = ny - y, moved = Math.sqrt(mvx * mvx + mvy * mvy);
      a.vx = mvx / dt; a.vy = mvy / dt;
      a.x = nx; a.y = ny;
      // ---- attack
      if (mode === 2 || mode === 3) {
        if (a.state !== 'attack') { a.state = 'attack'; a.cd = rng() * 0.35 / a.rate + 0.05; }
        a.cd -= dt;
        if (a.cd <= 0) {
          a.cd += 1 / a.rate;
          a.atkT = 0;
          if (mode === 2) {
            tgt.hp -= a.dmg;
            S.stats.bites++;
            IP.emit(world, 'hit', { x: tgt.x, y: tgt.y, dmg: a.dmg, targetKind: tk, targetId: tgt.id, by: a.id, kind: a.kind });
          } else spit(world, S, a, tgt, td);
        }
      } else if (a.state !== 'move') { a.state = 'move'; }
      // ---- facing (hysteresis so packed crowds don't flicker between rows)
      let hx, hy;
      if (mode === 2 || mode === 3) { hx = tdx; hy = tdy; }
      // walking: face where the stream is going (flow + weave) blended with the smoothed intent, never the jostle
      else if (mode === 1 && desX * desX + desY * desY > 64) { hx = desX + a.ux * 0.5; hy = desY + a.uy * 0.5; }
      else if (a.ux * a.ux + a.uy * a.uy > 64) { hx = a.ux; hy = a.uy; }
      else if (moved > 0.25) { hx = mvx; hy = mvy; }
      else { hx = a.ux; hy = a.uy; }
      if (hx * hx + hy * hy > 1e-6) {
        const want = Math.atan2(hy, hx) + (mode >= 2 ? 0 : a.fo);   // per-bug facing offset while walking
        let dA = want - a.dir;
        dA -= Math.round(dA / TAU) * TAU;
        a.dir += dA * (mode >= 2 ? 0.35 : 0.22);
        if (a.dir > Math.PI) a.dir -= TAU; else if (a.dir < -Math.PI) a.dir += TAU;
        let rd = a.dir - IP.dirAngle(a.row);
        rd -= Math.round(rd / TAU) * TAU;
        // switch the sheet row only well past the sector edge and not more than 10 times a second
        if (Math.abs(rd) > ROW_HYST && tick - a.rowT >= ROW_MIN_TICKS) { a.row = IP.dirIndex(a.dir); a.rowT = tick; }
      }
      // ---- animation: walk rate tied to ground speed; attack plays once per bite
      a.atkT += dt;
      if (a.atkT < ATTACK_ANIM) { a.anim = 'attack'; a.frame = Math.min(3, ((a.atkT / ATTACK_ANIM) * 4) | 0); }
      else if (moved > 0.12) { a.animT += moved / (r * 0.3); a.anim = 'walk'; a.frame = (a.animT | 0) & 7; }
      else { a.anim = mode >= 2 ? 'idle' : 'walk'; a.frame = mode >= 2 ? 0 : (a.animT | 0) & 7; }
    }
    // hard core: pairs still closer than ~1.1 r get resolved on live positions (Gauss-Seidel), so crowd pressure
    // against marines and rock never stacks bugs on top of each other
    S.stats.tMain = performance.now();
    // near targets (a.hk = HK_NEAR) it runs two extra iterations with a wider core.
    // It works on the hash's typed arrays (refreshed to the post-move positions) and writes back once at the end.
    if (tight.length) {
      const hkA = H.hk, wl = H.wl;
      for (let i = 0; i < n; i++) { const a = al[i]; px[i] = a.x; py[i] = a.y; hkA[i] = a.hk; }
      for (let it = 0; it < 5; it++) {
        for (let q = 0; q < tight.length; q++) {
          const i = tight[q], hi = hkA[i];
          if (it >= 3 && hi < HK_NEAR) continue;
          const c = H.cell[i], ccx = c % cols, ccy = (c / cols) | 0, ri = hr[i], mi = pm[i], pi = pp[i];
          let ax = px[i], ay = py[i];
          const R = ri + 30;
          const gy0 = Math.max(ccy - 1, ((ay - R) * inv | 0) + 1), gy1 = Math.min(ccy + 1, ((ay + R) * inv | 0) + 1);
          const gx0 = Math.max(ccx - 1, ((ax - R) * inv | 0) + 1), gx1 = Math.min(ccx + 1, ((ax + R) * inv | 0) + 1);
          for (let gy = gy0; gy <= gy1; gy++) {
            if (gy < 0 || gy >= hrows) continue;
            for (let gx = gx0; gx <= gx1; gx++) {
              if (gx < 0 || gx >= cols) continue;
              const cc = gy * cols + gx;
              for (let k = start[cc], e = start[cc + 1]; k < e; k++) {
                const j = items[k];
                if (j === i) continue;
                const hj = hkA[j], dx = ax - px[j], dy = ay - py[j], d2 = dx * dx + dy * dy;
                const Dh = (ri + hr[j]) * (pi >= 0 && pp[j] === pi ? (hi > HK ? HK_IN * 1.25 : HK_IN) : hi > hj ? hi : hj);
                if (d2 >= Dh * Dh) continue;
                let d = Math.sqrt(d2), nx, ny;
                if (d < 1e-4) { const ang = (i * 2.399963) % TAU; nx = Math.cos(ang); ny = Math.sin(ang); d = 0; } else { nx = dx / d; ny = dy / d; }
                // a bug pinned against rock doesn't yield (it would be pushed into the wall and back out onto
                // its neighbour); the free one takes the whole correction
                const wi = wl[i], wj = wl[j], o = Dh - d, wa = wi === wj ? pm[j] / (mi + pm[j]) : wi ? 0 : 1;
                ax += nx * o * wa; ay += ny * o * wa;
                px[j] -= nx * o * (1 - wa); py[j] -= ny * o * (1 - wa);
              }
            }
          }
          for (let t = 0; t < nt; t++) {
            const o = T[t], dx = ax - o.x, dy = ay - o.y, D = ri + (o.r || 12), d2 = dx * dx + dy * dy;
            if (d2 < D * D) { const d = Math.sqrt(d2) || 1e-3; ax = o.x + (dx / d) * D; ay = o.y + (dy / d) * D; }
          }
          px[i] = ax; py[i] = ay;
        }
      }
      for (let i = 0; i < n; i++) { const a = al[i]; a.x = px[i]; a.y = py[i]; }
    }
    S.stats.tCore = performance.now();
    // the hard-core nudges must not leave anyone inside rock or inside a marine
    if (F) for (let q = 0; q < tight.length; q++) {
      const a = al[tight[q]], sd = sdfAt(F, a.x, a.y);
      if (sd >= a.r) continue;
      let gx = sdfAt(F, a.x + 4, a.y) - sdfAt(F, a.x - 4, a.y), gy = sdfAt(F, a.x, a.y + 4) - sdfAt(F, a.x, a.y - 4);
      const gl = Math.sqrt(gx * gx + gy * gy);
      if (gl > 1e-4) { a.x += (gx / gl) * (a.r - sd); a.y += (gy / gl) * (a.r - sd); }
    }
  }

  // ---------------------------------------------------------------- spitter globs (world.projectiles, owner 'alien')
  const SPIT_SPEED = 300;
  function spit(world, S, a, tgt, td) {
    const ux = (tgt.x - a.x) / td, uy = (tgt.y - a.y) / td;
    world.projectiles.push({ kind: 'spit', x: a.x + ux * a.r, y: a.y - 4 + uy * a.r, vx: ux * SPIT_SPEED, vy: uy * SPIT_SPEED,
      dmg: a.dmg, ttl: td / SPIT_SPEED + 0.25, owner: 'alien', by: a.id, r: 5, t: 0 });
    S.stats.spits++;
  }
  function updateSpit(world, S, dt) {
    const P = world.projectiles;
    if (!P || !P.length) return;
    const T = S.targets, TK = S.tKind, F = S.sdf;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.owner !== 'alien' || p.kind !== 'spit') { P[w++] = p; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.ttl -= dt; p.t += dt;
      let dead = p.ttl <= 0;
      if (!dead) for (let t = 0; t < T.length; t++) {
        const o = T[t], dx = p.x - o.x, dy = p.y - o.y, D = (o.r || 12) + p.r;
        if (dx * dx + dy * dy <= D * D) {
          o.hp -= p.dmg;
          IP.emit(world, 'hit', { x: p.x, y: p.y, dmg: p.dmg, targetKind: TK[t], targetId: o.id, by: p.by, kind: 'spit' });
          IP.emit(world, 'explosion', { x: p.x, y: p.y, r: 18, kind: 'spitter' });
          dead = true; break;
        }
      }
      if (!dead && F && sdfAt(F, p.x, p.y) < 0) dead = true;
      if (!dead) P[w++] = p;
    }
    P.length = w;
  }

  // ---------------------------------------------------------------- drawing
  let blobTex = null;
  function getBlob() {
    if (blobTex) return blobTex;
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    blobTex = IP.gfx.texture(c, { filter: 'linear', name: 'swarm-blob' });
    return blobTex;
  }
  const SHADOW = IP.rgba(0, 0, 0, 0.34);
  const SPIT_CORE = IP.rgba(214, 255, 120, 1), SPIT_GLOW = IP.rgba(120, 220, 60, 0.55);
  const spriteO = { layer: 'unit', tint: 0xffffffff };
  const flashO = { layer: 'unit', tint: 0xffffffff, add: true, alpha: 0.7 };
  const shadowO = { layer: 'shadow', tex: null, center: true };
  const glowO = { layer: 'fx', tex: null, center: true, add: true };
  let sortVis = new Int32Array(0), sortKey = new Int32Array(0), sortOut = new Int32Array(0), sortCnt = new Int32Array(0);
  function drawAliens(world, r) {
    const S = world.swarm, al = world.aliens, n = al.length;
    if (!n && !(world.projectiles && world.projectiles.length)) return;
    const v = r.view(72);
    if (sortVis.length < n) { const cap = Math.max(1024, n * 1.5) | 0; sortVis = new Int32Array(cap); sortKey = new Int32Array(cap); sortOut = new Int32Array(cap); }
    const rowsY = Math.max(1, Math.ceil(v.y1 - v.y0) + 1);
    if (sortCnt.length < rowsY + 1) sortCnt = new Int32Array(rowsY + 64);
    // cull, then counting-sort by integer y (O(n), stable, deterministic)
    let m = 0;
    for (let i = 0; i < n; i++) {
      const a = al[i];
      if (a.state === 'dead' || a.x < v.x0 || a.x > v.x1 || a.y < v.y0 || a.y > v.y1) continue;
      sortVis[m] = i; sortKey[m] = (a.y - v.y0) | 0; m++;
    }
    const cnt = sortCnt;
    cnt.fill(0, 0, rowsY + 1);
    for (let k = 0; k < m; k++) cnt[sortKey[k] + 1]++;
    for (let y = 0; y < rowsY; y++) cnt[y + 1] += cnt[y];
    for (let k = 0; k < m; k++) sortOut[cnt[sortKey[k]]++] = sortVis[k];
    const blob = getBlob();
    // contact shadows (skipped when the visible crowd is enormous: budget-aware)
    if (m <= 9000) {
      shadowO.tex = blob;
      for (let k = 0; k < m; k++) {
        const a = al[sortOut[k]], rr = a.r;
        r.quad(a.x, a.y + rr * 0.3, rr * 2.5, rr * 1.45, SHADOW, shadowO);
      }
    }
    const fallback = IP.assets.sheet('bug_drone');
    const time = world.time;
    for (let k = 0; k < m; k++) {
      const a = al[sortOut[k]];
      let sh = a._s;
      if (!sh) sh = a._s = IP.assets.sheet(a.sheet) || fallback;
      if (!sh) continue;
      const fr = sh.frame(a.row, a.anim, a.frame);
      spriteO.tint = a.tint;
      r.sprite(sh, fr, a.x, a.y, spriteO);
      if (time - a.hitT < 0.07) r.sprite(sh, fr, a.x, a.y, flashO);
    }
    // spit globs
    const P = world.projectiles;
    if (P) {
      glowO.tex = blob;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (p.owner !== 'alien' || p.kind !== 'spit') continue;
        r.quad(p.x, p.y, 22, 22, SPIT_GLOW, glowO);
        r.circle(p.x, p.y, 3.5, SPIT_CORE, { layer: 'fx' });
        r.line(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.x, p.y, 3, SPIT_GLOW, { layer: 'fx', add: true });
      }
    }
  }

  // ---------------------------------------------------------------- system
  const system = {
    async init(world) {
      world.swarm = newState(world);
      await loadData();
    },
    start(world) {
      const S = world.swarm;
      if (!S) return;
      buildSdf(world, S);
      // re-resolve sheets for aliens spawned before the sheets were loaded
      for (const a of world.aliens) if (a.m === undefined) adopt(world, S, a); else if (!a._s) a._s = IP.assets.sheet(a.sheet);
      gatherTargets(world, S);
      S.field = null;
      sweep(world, S);
      // warm start: the first flow field and hash are built here, so tick 0 costs the same as any other tick
      maybeBuildField(world, S);
      buildHash(world, S);
    },
    update(world, dt) {
      const S = world.swarm;
      if (!S) return;
      const t0 = performance.now();
      if (!S.sdf) buildSdf(world, S);
      sweep(world, S);
      gatherTargets(world, S);
      maybeBuildField(world, S);
      buildHash(world, S);
      steer(world, S, dt);
      updateSpit(world, S, dt);
      buildHash(world, S);            // fresh positions for nearest/inRadius callers later this tick
      if (S.demo) { demoSpawn(world, S, dt); demoAfter(world, S, dt); }
      // corpses leave world.aliens in the tick they die (kills by systems that run after swarm go next tick)
      const n0 = world.aliens.length;
      sweep(world, S);
      if (world.aliens.length !== n0 || S.dirty) buildHash(world, S);
      const ms = performance.now() - t0;   // stats only, never feeds the sim
      S.stats.ms = S.stats.ms ? S.stats.ms * 0.95 + ms * 0.05 : ms;
      if (world.tick > 30 && ms > S.stats.maxMs) S.stats.maxMs = ms;
      S.stats.last = ms;
    },
    draw(world, r) {
      const S = world.swarm;
      if (!S) return;
      if (S.demo) demoDraw(world, S, r);
      drawAliens(world, r);
    },
    drawHud(world, ctx) {
      const S = world.swarm;
      if (!S || !S.demo) return;
      // deterministic numbers only (captures must be byte-identical)
      ctx.font = '600 20px "Chakra Petch", "Segoe UI", system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      let txt = `${S.demo.title}  ALIENS ${world.aliens.length}/${budget(world)}  KILLS ${S.stats.kills}  BITES ${S.stats.bites}  SPITS ${S.stats.spits}  T ${world.time.toFixed(1)}`;
      // live page only: the swarm tick cost (wall-clock, so never in headless captures, which must be byte-identical)
      if (!IP.headless) txt += `  SWARM TICK ${S.stats.ms.toFixed(2)} ms (max ${S.stats.maxMs.toFixed(1)})`;
      const w = ctx.measureText(txt).width;
      // with the real HUD running, its bottom-left hex buttons own that corner: centre the line instead
      const x0 = world.systems.some((q) => q.name === 'hud') ? Math.round(960 - (w + 28) / 2) : 16;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x0, 1080 - 50, w + 28, 34);
      ctx.fillStyle = '#7ff3ff';
      ctx.fillText(txt, x0 + 14, 1080 - 22);
    },
  };
  IP.registerSystem('swarm', system);

  IP.swarm = {
    spawn, damage, nearest, inRadius, flowDist,
    room: (world) => Math.max(0, budget(world) - world.aliens.length),
    kill: (world, a, cause) => kill(world, a, cause),
    rebuildPassability(world) { const S = world.swarm; if (!S) return; buildSdf(world, S); S.field = null; S.fieldSig = ''; },
    kinds: KINDS, knobs: KN,
    HASH, FC,
  };

  // ================================================================ demo + stress scenarios
  // Stub marines (DESIGN.md shape), static; they shoot through IP.swarm.nearest/damage so death removal is exercised.
  // Stubs keep hp >= 1 (demo-only) so the pressure test runs for the whole capture.
  const STUBS = [
    { name: 'SNIPER', cls: 'sniper', dx: -34, dy: -30, range: 560, cool: 70, dmg: 40, splash: 0 },
    { name: 'RIFLE', cls: 'rifle', dx: 30, dy: -34, range: 330, cool: 14, dmg: 4, splash: 0 },
    { name: 'FUSION', cls: 'fusion', dx: -44, dy: 22, range: 260, cool: 30, dmg: 8, splash: 46 },
    { name: 'RIFLE', cls: 'rifle', dx: 40, dy: 26, range: 330, cool: 14, dmg: 4, splash: 0 },
    { name: 'MEDIC', cls: 'medic', dx: 0, dy: 4, range: 200, cool: 24, dmg: 4, splash: 0 },
  ];
  // impassable rock blobs (unions of circles) placed so streams must split and wrap around them
  const ROCKS = [
    [[700, 380, 95], [770, 450, 80], [640, 470, 60], [720, 300, 55]],
    [[620, 800, 70], [700, 760, 62], [560, 860, 48]],
    [[1240, 300, 64], [1310, 250, 52], [1180, 250, 40]],
    [[1530, 740, 72], [1600, 690, 50], [1470, 800, 44]],
    [[1040, 640, 34]],
  ];
  const SQUAD0 = { x: 1130, y: 560 };
  const SPAWNS0 = [{ x: 150, y: 200 }, { x: 190, y: 930 }, { x: 1780, y: 140 }];
  const SPAWNS_X = [{ x: 1180, y: 1020 }, { x: 1820, y: 960 }];   // two more hives for the 6000 stress
  let SQUAD = SQUAD0, SPAWNS = SPAWNS0;

  // k scales the 1920x1080 layout (stress uses k = 1.5 viewed at zoom 1/1.5 so all 6000 stay on screen)
  function setupDemo(world, title, o) {
    const S = world.swarm, k = o.k || 1;
    world.map = { w: Math.round(1920 * k), h: Math.round(1080 * k) };
    world.camera = { x: world.map.w / 2, y: world.map.h / 2, zoom: 1 / k };
    S.blockers.length = 0;
    SQUAD = { x: SQUAD0.x * k, y: SQUAD0.y * k };
    SPAWNS = (o.extra ? SPAWNS0.concat(SPAWNS_X) : SPAWNS0).map((p) => ({ x: p.x * k, y: p.y * k }));
    const terOn = world.systems.some((q) => q.name === 'terrain') && IP.terrain && typeof IP.terrain.generate === 'function';
    let painted = false;
    if (terOn) {
      // same rock layout, painted by the terrain piece (it then owns ground, rock art and passability)
      const masses = [];
      for (const rock of ROCKS) for (const [x, y, rr] of rock) masses.push({ x: x * k, y: y * k, rx: rr * k, ry: rr * k * 0.92, rot: 0, kind: 'rock' });
      const keepClear = SPAWNS.map((p) => ({ x: p.x, y: p.y, r: 70 * k })).concat([{ x: SQUAD.x, y: SQUAD.y, r: 90 * k }]);
      try { IP.terrain.generate(world, { biome: o.biome || 'basalt', w: world.map.w, h: world.map.h, seed: world.seed, masses, keepClear }); painted = true; }
      catch (e) { console.warn('[swarm] terrain.generate failed, using own rocks: ' + e.message); }
      world.camera = { x: world.map.w / 2, y: world.map.h / 2, zoom: 1 / k };
    }
    if (!painted) for (const rock of ROCKS) for (const [x, y, rr] of rock) S.blockers.push({ x: x * k, y: y * k, r: rr * k });
    const rng = IP.fork(world, 'swarm-demo');
    S.demo = {
      title, rate: o.rate, spawns: SPAWNS.map((s) => ({ x: s.x, y: s.y, acc: 0 })), fx: [], rng, painted,
      ground: makeGroundTex(rng), tankAt: o.tankAt, tankDone: false,
    };
    world.marines.length = 0;
    STUBS.forEach((s, i) => {
      world.marines.push({
        id: 'm' + (i + 1), name: s.name, cls: s.cls, x: SQUAD.x + s.dx, y: SQUAD.y + s.dy, r: 14, dir: Math.PI, hp: 100, maxHp: 100,
        state: 'idle', order: null, weapon: { kind: s.cls, range: s.range, dps: (s.dmg * 60) / s.cool, cooldown: s.cool / 60, ammo: Infinity, maxAmmo: Infinity },
        sheet: null, anim: 'idle', frame: 0, selected: false, _stub: { cd: (i * 5) % s.cool, def: s, flash: 0, tx: 0, ty: 0 },
      });
    });
  }
  function pickKind(rng, t) {
    const u = rng();
    if (t > 2.5 && u < 0.035) return 'spitter';
    if (u < 0.10) return 'runner';
    if (t > 3.5 && u > 0.985) return 'brute';
    return 'drone';
  }
  function demoSpawn(world, S, dt) {
    const D = S.demo, rng = D.rng;
    for (let i = 0; i < D.spawns.length; i++) {
      const sp = D.spawns[i];
      sp.acc += D.rate * dt;
      // spawners wait when the budget is full (acc is capped so they don't burst afterwards)
      const room = IP.swarm.room(world);
      if (sp.acc > 6) sp.acc = 6;
      while (sp.acc >= 1 && IP.swarm.room(world) > 0) {
        sp.acc -= 1;
        spawn(world, { x: sp.x, y: sp.y, kind: pickKind(rng, world.time), n: 1, spread: KN.demoSpread });
      }
      if (!room) sp.acc = Math.min(sp.acc, 1);
    }
    if (D.tankAt != null && !D.tankDone && world.time >= D.tankAt) { D.tankDone = true; spawn(world, { x: SPAWNS[2].x, y: SPAWNS[2].y + 30, kind: 'tank', n: 1, spread: 0 }); }
  }
  function demoAfter(world, S, dt) {
    const D = S.demo;
    const usesMarines = world.systems.some((s) => s.name === 'marines');
    if (usesMarines) return;
    for (const m of world.marines) {
      const st = m._stub;
      if (!st) continue;
      if (m.hp < 1) m.hp = 1;                      // demo stubs never die (pressure test)
      m.hp = Math.min(m.maxHp, m.hp + 6 * dt);
      st.flash = Math.max(0, st.flash - dt);
      if (--st.cd > 0) continue;
      const def = st.def;
      if (def.cls === 'medic') {                   // heal the most hurt stub
        let w = null;
        for (const o of world.marines) if (!w || o.hp / o.maxHp < w.hp / w.maxHp) w = o;
        st.cd = def.cool;
        if (w && w.hp < w.maxHp) { w.hp = Math.min(w.maxHp, w.hp + 6); D.fx.push({ k: 'heal', x: w.x, y: w.y - 22, life: 0.5, max: 0.5 }); }
        continue;
      }
      const a = nearest(world, m.x, m.y, def.range);
      if (!a) { st.cd = 4; continue; }
      st.cd = def.cool;
      m.dir = Math.atan2(a.y - m.y, a.x - m.x);
      st.tx = a.x; st.ty = a.y; st.flash = 0.08;
      IP.emit(world, 'shot', { x: m.x, y: m.y, tx: a.x, ty: a.y, weapon: def.cls, hit: true });
      D.fx.push({ k: def.cls, x: m.x, y: m.y, tx: a.x, ty: a.y, life: def.cls === 'sniper' ? 0.16 : 0.09, max: def.cls === 'sniper' ? 0.16 : 0.09 });
      if (def.splash) {
        const hitList = [];
        inRadius(world, a.x, a.y, def.splash, (b) => { hitList.push(b); });
        for (const b of hitList) damage(world, b, def.dmg, def.cls);
        D.fx.push({ k: 'boom', x: a.x, y: a.y, life: 0.28, max: 0.28, r: def.splash });
      } else damage(world, a, def.dmg, def.cls);
    }
    // death puffs from this tick's alien-died events (vfx owns real gore; this only proves removal in the demo)
    for (const e of world.events) if (e.type === 'alien-died') D.fx.push({ k: 'die', x: e.x, y: e.y, life: 0.45, max: 0.45, r: 10 + (e.r || 8) });
    let w = 0;
    for (let i = 0; i < D.fx.length; i++) { const f = D.fx[i]; f.life -= dt; if (f.life > 0) D.fx[w++] = f; }
    D.fx.length = w;
  }
  function makeGroundTex(rng) {
    // dark basalt with violet mottling (placeholder; terrain owns the real ground)
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    const oct = [[4, 1], [8, 0.55], [16, 0.3], [32, 0.16], [64, 0.09]];
    const grids = oct.map(([cells]) => { const a = new Float32Array(cells * cells); for (let i = 0; i < a.length; i++) a[i] = rng(); return a; });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, tot = 0;
      oct.forEach(([cells, amp], k) => {
        const fx = (x * cells) / N, fy = (y * cells) / N, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), G = grids[k];
        const a = G[(iy % cells) * cells + (ix % cells)], b = G[(iy % cells) * cells + ((ix + 1) % cells)];
        const cc = G[((iy + 1) % cells) * cells + (ix % cells)], dd = G[((iy + 1) % cells) * cells + ((ix + 1) % cells)];
        v += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + dd) * sx * sy); tot += amp;
      });
      v /= tot;
      const i = (y * N + x) * 4, t = IP.clamp((v - 0.3) / 0.45, 0, 1);
      d[i] = 22 + t * 50; d[i + 1] = 16 + t * 14; d[i + 2] = 30 + t * 40; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return IP.gfx.texture(c, { filter: 'linear', wrap: 'repeat', name: 'swarm-demo-ground' });
  }
  const ROCK_RIM = IP.rgba(190, 50, 200, 0.85), ROCK_RIM2 = IP.rgba(120, 30, 130, 0.9), ROCK_FILL = IP.rgba(26, 22, 32, 1), ROCK_TOP = IP.rgba(44, 38, 52, 1);
  const RING = IP.rgba(255, 90, 110, 0.95), RING_IN = IP.rgba(60, 200, 190, 0.22);
  function demoDraw(world, S, r) {
    const D = S.demo, map = world.map;
    if (!D.painted) {
      r.quad(0, 0, map.w, map.h, 0xffffffff, { layer: 'ground', tex: D.ground, uv: [0, 0, map.w / 700, map.h / 700] });
      r.quad(0, 0, map.w, map.h, IP.rgba(140, 40, 120, 0.22), { layer: 'ground', tex: D.ground, uv: [0.31, 0.57, 0.31 + map.w / 2600, 0.57 + map.h / 2600] });
    }
    // rocks: rims first, then fills, so a union of circles reads as one organic blob with an outer glow edge
    const bl = S.blockers;
    for (const o of bl) r.circle(o.x, o.y, o.r + 7, ROCK_RIM2, { layer: 'ground' });
    for (const o of bl) r.circle(o.x, o.y, o.r + 3, ROCK_RIM, { layer: 'ground' });
    for (const o of bl) r.circle(o.x, o.y, o.r, ROCK_FILL, { layer: 'ground' });
    for (const o of bl) r.circle(o.x - o.r * 0.18, o.y - o.r * 0.2, o.r * 0.62, ROCK_TOP, { layer: 'ground' });
    // spawn points (placeholder hives)
    const t = world.time;
    for (const sp of D.spawns) {
      r.ngon(sp.x, sp.y, 40, 6, IP.rgba(30, 24, 44, 1), { layer: 'decal', rot: Math.PI / 6 });
      r.ngon(sp.x, sp.y, 40, 6, IP.rgba(60, 220, 190, 0.9), { layer: 'decal', rot: Math.PI / 6, width: 3 });
      r.circle(sp.x, sp.y, 17 + Math.sin(t * 5) * 2, IP.rgba(230, 60, 160, 1), { layer: 'decal' });
      r.circle(sp.x, sp.y, 8, IP.rgba(140, 255, 120, 1), { layer: 'decal' });
    }
    const usesMarines = world.systems.some((s) => s.name === 'marines');
    if (!usesMarines) {
      for (const m of world.marines) {
        r.circle(m.x, m.y, 24, RING_IN, { layer: 'shadow' });
        r.circle(m.x, m.y, 24, RING, { layer: 'over', width: 3 });
        r.circle(m.x, m.y, 9, IP.rgba(26, 40, 44, 1), { layer: 'over' });
        r.circle(m.x, m.y, 7, m.cls === 'medic' ? '#ff5a6e' : m.cls === 'sniper' ? '#4fd1c5' : m.cls === 'fusion' ? '#7be36b' : '#e8e04a', { layer: 'over' });
        const ca = Math.cos(m.dir), sa = Math.sin(m.dir);
        r.line(m.x + ca * 5, m.y + sa * 5, m.x + ca * 17, m.y + sa * 17, 4, '#202a2c', { layer: 'over' });
        const k = m.hp / m.maxHp;
        r.quad(m.x - 18, m.y - 34, 36, 5, IP.rgba(0, 0, 0, 0.7), { layer: 'over' });
        r.quad(m.x - 17, m.y - 33, 34 * k, 3, IP.rgba(240, 60, 70, 1), { layer: 'over' });
      }
      for (const f of D.fx) {
        const k = f.life / f.max;
        if (f.k === 'rifle') r.line(f.x, f.y, f.tx, f.ty, 3, [1, 0.25, 0.25, k], { layer: 'fx', dash: [5, 6], add: true });
        else if (f.k === 'sniper') r.line(f.x, f.y, f.tx, f.ty, 2, [1, 1, 1, k], { layer: 'fx', add: true });
        else if (f.k === 'fusion') r.line(f.x, f.y, f.tx, f.ty, 5, [1, 0.6, 0.15, k], { layer: 'fx', add: true });
        else if (f.k === 'boom') r.circle(f.x, f.y, f.r * (1.1 - k * 0.4), [1, 0.55, 0.15, k * 0.6], { layer: 'fx', add: true });
        else if (f.k === 'die') r.circle(f.x, f.y, f.r * (1.4 - k * 0.6), [0.95, 0.15, 0.5, k * 0.7], { layer: 'decal' });
        else if (f.k === 'heal') { r.quad(f.x - 2, f.y - 7, 4, 14, [1, 1, 1, k], { layer: 'fx' }); r.quad(f.x - 7, f.y - 2, 14, 4, [1, 1, 1, k], { layer: 'fx' }); }
      }
    }
  }

  // a first wave already en route: whole clutches dropped along each hive -> squad line
  function prefill(world, S, N, reach) {
    const rng = S.demo.rng;
    // a coarse occupancy grid: each clutch takes the emptiest of a few candidate spots, so the first tick doesn't
    // start from a pile of overlaps (warm start for the stress scene)
    const OC = 32, ocols = Math.ceil(world.map.w / OC) + 1, orows = Math.ceil(world.map.h / OC) + 1, occ = new Uint16Array(ocols * orows);
    const occAt = (x, y) => {
      const cx = Math.floor(x / OC), cy = Math.floor(y / OC);
      let c = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy;
        if (gx >= 0 && gy >= 0 && gx < ocols && gy < orows) c += occ[gy * ocols + gx];
      }
      return c;
    };
    let made = 0, i = 0;
    while (made < N && i < N * 2) {
      const sp = SPAWNS[i++ % SPAWNS.length];
      const dx = SQUAD.x - sp.x, dy = SQUAD.y - sp.y, L = Math.hypot(dx, dy);
      let x = 0, y = 0, best = 1e9;
      for (let t = 0; t < 5; t++) {
        const u = rng() * reach, lat = (rng() + rng() + rng() - 1.5) * KN.demoLat;
        const qx = sp.x + dx * u - (dy / L) * lat, qy = sp.y + dy * u + (dx / L) * lat, o = occAt(qx, qy);
        if (o < best) { best = o; x = qx; y = qy; }
      }
      const kind = pickKind(rng, 4), k = kind === 'drone' || kind === 'runner' ? Math.min(N - made, packSize(rng, kind)) : 1;
      const n0 = world.aliens.length;
      const got = spawn(world, { x, y, kind, n: k, spread: 4 + k * 3 });
      for (let q = n0; q < world.aliens.length; q++) {
        const a = world.aliens[q], gx = Math.floor(a.x / OC), gy = Math.floor(a.y / OC);
        if (gx >= 0 && gy >= 0 && gx < ocols && gy < orows) occ[gy * ocols + gx]++;
      }
      made += got;
      if (!got) made++;   // a blocked spot still counts, so a full map can't loop forever
    }
  }
  IP.scenario('swarm-demo', async (world) => {
    setupDemo(world, 'SWARM DEMO', { rate: KN.demoRate, tankAt: 5 });
    // the hives have been pumping for a while: a first wave is already en route at t=0
    buildSdf(world, world.swarm);
    prefill(world, world.swarm, KN.demoPrefill, 0.8);
  }, { systems: IP.system('terrain') ? ['terrain', 'swarm'] : ['swarm'] });

  IP.scenario('swarm-stress', async (world) => {
    const S = world.swarm;
    let urlAliens = false;
    try { urlAliens = new URLSearchParams(location.search).has('aliens'); } catch (e) { /* no location */ }
    S.budget = urlAliens ? IP.budget.aliens : 6000;
    setupDemo(world, 'SWARM STRESS', { rate: 90, tankAt: null, k: 1.5, extra: true });
    // pre-fill the budget along the three streams so the whole crowd is moving from tick 0
    buildSdf(world, S);
    prefill(world, S, budget(world), 0.85);
  }, { systems: IP.system('terrain') ? ['terrain', 'swarm'] : ['swarm'] });
})();
