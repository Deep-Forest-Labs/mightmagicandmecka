// Infested Planet Gauntlet: structures (hives, captured bases, hex build nodes, turrets, barricades).
// Owner: structures piece. Plain script; registers the 'structures' system and the 'structures-demo' scenario.
//
// Entity (DESIGN.md "Shared entity contract"), one array: world.structures
//   { id, kind:'hive'|'node'|'base'|'turret'|'barricade', owner:'alien'|'player', x, y, r, hp, maxHp, state,
//     spawn:{kinds, rate, burst}|null, ...extras }
//   hive:      state 'active'|'capturing'|'contested'. spawn.rate = aliens per second (x world.game.difficulty, default 1),
//              spawn.kinds = alien kinds (picked uniformly), burst = aliens per call. capP 0..1 capture progress, capN marines in range.
//              Capture loop: live marines within DEF.hive.captureR (120) suppress spawning; with no alien within clearR (160)
//              the progress fills over captureTime (6 s, x1.25 per extra marine); aliens nearby make it 'contested' (holds);
//              an unattended hive decays it. Full progress (or hp <= 0, e.g. turret fire) captures it.
//              ring: [{x,y}] the small alien hex nodes around it (decor; they become the player's nodes on capture).
//   base:      state 'building' (deploy animation) -> 'active'. nodeIds: ids of its six 'node' structures.
//   node:      owner 'player', state 'empty'|'occupied', parent (base id), slot 0..5, occupant (structure id|null). Not targetable.
//   turret:    on a node (node id in .node). range 260, dmg, cooldown, aim (rad), target (entity|null). Ammo-free; emits 'shot'.
//   med-station: on a node. Heals every live marine within range (170) by DEF['med-station'].heal hp/s, emits 'shot'{weapon:'medic'}.
//   barricade: blocks aliens: an impassable circle in world.swarm.blockers (swarm re-routes its flow field around it),
//              world.map.blocked cells, plus a hard push-out every tick. IP.terrain.passable() does not know about it.
// Death: anything with hp <= 0 is handled here in update (so attackers may subtract hp directly or call damage()).
//   hive -> awards DEF.hive.bp to world.bp, emits 'explosion'{kind:'hive'} + 'hive-captured'{id,x,y,bp}, kills every alien within DEF.hive.burstR (and deals
//           shockDmg out to shockR), becomes a player 'base' with six yellow 'node' slots. A new base is shielded for
//           DEF.base.shield s, then keeps DEF.base.armor of any hp loss (bites subtract hp directly; we scale it back).
//   base -> reverts to an alien hive (its nodes, turrets and barricades on them are destroyed), emits 'explosion' + 'base-lost'.
//   turret/barricade/med-station -> removed, emits 'explosion', frees its node. Swarm bites subtract hp directly; we notice
//           the loss (hp arc + flash). Aliens target every player structure except nodes (swarm's gatherTargets).
//
// API (IP.structures):
//   add(world, kind, x, y, opts)            place any structure (hives: opts.spawn = {kinds, rate, burst}, opts.hp)
//   capture(world, hive)                    convert a hive into a player base now (also happens automatically at hp <= 0)
//   build(world, kind, nodeIdOrPos)         spend world.bp (COST turret 3, med-station 2, barricade 1); 'turret' and 'med-station'
//                                           need a free node id; 'barricade' takes a node id or {x,y}. Build mode: with
//                                           world.flags.buildMode on, a tap on a free node builds world.flags.buildKind ('turret').
//                                           returns the new structure or null (reason in IP.structures.lastError)
//   damage(world, s, dmg)                   subtract hp from a structure and emit 'hit' (callers using it need not emit 'hit')
//   nearestEnemy(world, x, y, opts)         opts.team 'player' (default: nearest live alien or alien structure) | 'alien'
//                                           (nearest player base/turret/barricade); opts.range, opts.aliens=false, opts.structures=false
//   at(world, x, y)                          structure under a point (picking for the HUD / build UI)
//   byId(world, id), hives(world), blockedAt(world, x, y)
//   COST {turret, barricade, 'med-station'}, DEF (tuning)
// Art: Mecha Factory style (docs/STYLE.md), painted once into one atlas: chamfered faceted forms, 5-step hue-shifted ramps,
//   1 px ink outlines, key light from the top-left and a cool rim on the back edges. Not modelled on Infested Planet's art.
// Cross-system calls (all optional): IP.swarm.spawn(world,{x,y,kind,n}); IP.terrain.growCreep(world,x,y,r) while a hive lives,
//   IP.terrain.setCreep(world,x,y,r) shrinking it to 0 after capture; barricades mark world.map.blocked cells (copy-on-write,
//   so terrain's flow-field cache, keyed on the array, rebuilds). Without terrain, the demo paints its own ground + creep.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;
  const TAU = Math.PI * 2, D2R = Math.PI / 180;
  const K = 2; // texture pixels per world pixel (crisp up to zoom 2)

  const DEF = {
    hive: { r: 48, hp: 1600, burst: 5, creepMin: 140, creepMax: 380, creepGrow: 8, burstR: 130, shockR: 300, shockDmg: 40,
            captureR: 120, clearR: 160, captureTime: 6, captureDecay: 0.2, bp: 3 }, // capture: marines within captureR, no alien within clearR
    base: { r: 50, hp: 1200, build: 0.7, shield: 6, armor: 0.2 }, // armor: fraction of any hp loss that sticks (fortified)
    node: { r: 20 },
    turret: { r: 20, hp: 320, range: 260, dmg: 14, cooldown: 0.2, turn: 9 },   // ammo-free
    'med-station': { r: 20, hp: 260, range: 170, heal: 8, every: 0.5 },          // heal = hp/s to every marine in range
    barricade: { r: 23, hp: 700 },
  };
  const COST = { turret: 3, barricade: 1, 'med-station': 2 };
  const KIND = (k) => (k === 'medstation' || k === 'med' || k === 'medic' ? 'med-station' : k);
  const diffOf = (world) => { const d = world.game && world.game.difficulty; return d > 0 ? d : 1; };
  // the six slots around a hive/base, measured from ip_01 and ip_09 (not a regular hex: the bar's layout)
  const SLOTS = [[0, -98], [58, -66], [58, 66], [0, 98], [-58, 66], [-58, -66]];
  const SPIKES = [-90, -30, 30, 90, 150, 210].map((d) => d * D2R);

  const on = (world, name) => !!(world.systems && world.systems.some((s) => s.name === name));
  const terr = (world) => on(world, 'terrain') && IP.terrain && world.terrain ? IP.terrain : null;
  const sys = (world) => world.structureSys || (world.structureSys = freshState(world));
  function freshState(world) {
    return { nextId: 1, rng: IP.fork(world, 'structures'), demo: null, tracers: [], booms: [] };
  }

  // =================================================================== art: one painted atlas, built once per page
  let ART = null;
  function mulberry(seed) { return function () { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hexPath(c, x, y, r, rot) {
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = (rot || 0) + (i * Math.PI) / 3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) c.lineTo(px, py); else c.moveTo(px, py); }
    c.closePath();
  }
  function polar(r, a) { return [Math.cos(a) * r, Math.sin(a) * r]; }
  let PK = K; // texels per world px of the item being painted (shadows are in device px)
  function withShadow(c, blur, dx, dy, alpha, fn) {
    c.save();
    c.shadowColor = 'rgba(0,0,0,' + alpha + ')'; c.shadowBlur = blur * PK; c.shadowOffsetX = dx * PK; c.shadowOffsetY = dy * PK;
    fn(); c.restore();
  }

  // ---- Mecha Factory style (docs/STYLE.md): chunky chamfered forms, 5-step hue-shifted ramps (cool shadows, warm
  // highlights), 1 px dark outlines, dusk key light from the top-left and a cool rim on the back (bottom-right) edges.
  const LIGHT = [-Math.SQRT1_2, -Math.SQRT1_2];
  const RIM = [Math.SQRT1_2, Math.SQRT1_2];
  const INK = '#07040c';
  const CHITIN = ['#0b0a1c', '#1b1838', '#2f2954', '#4b3f72', '#7a5f8e'];   // hive carapace: blue-violet -> rose
  const FLESH = ['#2a0620', '#5a0f3e', '#9a1d62', '#d8347f', '#ff8cc0'];    // pods, throat
  const BONE = ['#2e2a22', '#5e5644', '#9a8f74', '#d2c8a8', '#f4ecd6'];     // fangs
  const SLATE = ['#0b0f15', '#1a222d', '#2a3542', '#3e4c5c', '#5a6b7e'];    // player hardware
  const RIMC = '#6cc4dc';
  const lum = (nx, ny) => nx * LIGHT[0] + ny * LIGHT[1];          // -1..1, 1 = facing the key light
  const step = (ramp, l, lo, hi) => ramp[Math.max(lo, Math.min(hi, Math.round(lo + ((l + 1) / 2) * (hi - lo))))];
  function polyPath(c, P) { c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]); c.closePath(); }
  function chamferPoly(cx, cy, r, n, rot, ch) { // regular n-gon with every corner cut by ch (fraction of the edge)
    const P = [];
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i * TAU) / n, a1 = rot + ((i + 1) * TAU) / n;
      const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
      P.push([p0[0] + (p1[0] - p0[0]) * ch, p0[1] + (p1[1] - p0[1]) * ch], [p1[0] + (p0[0] - p1[0]) * ch, p1[1] + (p0[1] - p1[1]) * ch]);
    }
    return P;
  }
  // a faceted chamfered gem/plate: the polygon split into wedge facets around (cx,cy), each shaded by its outward
  // normal against the key light, a 1 px ink outline, and a cool rim on the edges facing away from the light
  function facetPoly(c, P, cx, cy, ramp, lo, hi, rim) {
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy, ml = Math.hypot(mx, my) || 1;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.closePath();
      c.fillStyle = step(ramp, lum(mx / ml, my / ml), lo, hi); c.fill();
      c.lineWidth = 0.5; c.strokeStyle = c.fillStyle; c.stroke(); // seal the hairline between facets
    }
    if (rim) for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy, ml = Math.hypot(mx, my) || 1;
      if ((mx * RIM[0] + my * RIM[1]) / ml < 0.35) continue;
      const k = 0.9 / ml;
      c.beginPath(); c.moveTo(p[0] - mx * k, p[1] - my * k); c.lineTo(q[0] - mx * k, q[1] - my * k); c.lineWidth = 1; c.strokeStyle = rim; c.stroke();
    }
    polyPath(c, P); c.lineWidth = 1.2; c.strokeStyle = INK; c.lineJoin = 'miter'; c.stroke();
  }

  // Hive: an armoured alien spawner. Six chamfered carapace plates (two facets each, split on a lit ridge) ring a big
  // chamfered maw lined with bone fangs; flesh pods sit in the gaps and glow (live, additive). The maw is ~45% of the
  // diameter so it reads as a spawner at a glance; the throat glow pulses with every spawn.
  const HIVE_DRAW = 0.9;                       // ~124 px across the claws at zoom 1
  const HIVE_MAW = 27;                         // maw radius (octagon)
  const HIVE_POD_R = 45;                       // pod ring radius (between the plates)
  const PLATE_AX = [-90, -30, 30, 90, 150, 210].map((d) => d * D2R);
  const PLATE = [[29, -12], [43, -21], [55, -13], [60, -5], [60, 5], [55, 13], [43, 21], [29, 12]]; // (radial, tangential)
  const plateAt = (a, P, s) => P.map(([u, v]) => [Math.cos(a) * u * s - Math.sin(a) * v * s, Math.sin(a) * u * s + Math.cos(a) * v * s]);
  function paintHive(c) {
    // drop shadow + under-flesh (shows in the plate gaps)
    withShadow(c, 7, 2, 6, 0.85, () => {
      c.beginPath(); for (const p of chamferPoly(0, 0, 52, 12, 0, 0.18)) c.lineTo(p[0], p[1]); c.closePath(); c.fillStyle = INK; c.fill();
      for (const a of PLATE_AX) { polyPath(c, plateAt(a, PLATE, 1.04)); c.fill(); }
    });
    const under = chamferPoly(0, 0, 51, 12, 0, 0.18);
    polyPath(c, under); c.fillStyle = CHITIN[1]; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
    // sinew: dark ribs from the maw to the rim
    c.lineCap = 'round';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU + 0.26; c.beginPath(); c.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); c.lineTo(Math.cos(a) * 49, Math.sin(a) * 49); c.lineWidth = 2.4; c.strokeStyle = CHITIN[0]; c.stroke(); }
    // claws: short chamfered spurs anchoring each plate into the ground
    for (const a of PLATE_AX) {
      const P = plateAt(a, [[56, -4.5], [66, -2.5], [69, 0], [66, 2.5], [56, 4.5]], 1);
      polyPath(c, P); c.fillStyle = CHITIN[1]; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
      const ca = Math.cos(a), sa = Math.sin(a);
      c.beginPath(); c.moveTo(ca * 58, sa * 58); c.lineTo(ca * 67, sa * 67); c.lineWidth = 1; c.strokeStyle = lum(ca, sa) > 0 ? CHITIN[3] : CHITIN[2]; c.stroke();
    }
    // plates: two facets per plate, split on the radial ridge; an inset top facet one ramp step lighter (chunky bevel)
    for (const a of PLATE_AX) {
      const P = plateAt(a, PLATE, 1), ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
      const half = (side) => {
        const pts = side < 0 ? [P[0], P[1], P[2], P[3], [ca * 60, sa * 60], [ca * 29, sa * 29]] : [[ca * 29, sa * 29], [ca * 60, sa * 60], P[4], P[5], P[6], P[7]];
        const nx = ca * 0.45 + tx * side, ny = sa * 0.45 + ty * side, nl = Math.hypot(nx, ny);
        polyPath(c, pts); c.fillStyle = step(CHITIN, lum(nx / nl, ny / nl) * 1.3, 0, 3); c.fill();
      };
      half(-1); half(1);
      const T = plateAt(a, [[35, -8], [44, -13], [51, -8], [53, 0], [51, 8], [44, 13], [35, 8]], 1);
      const l0 = lum(ca, sa);
      polyPath(c, T); c.fillStyle = step(CHITIN, l0, 2, 4); c.fill();
      c.lineWidth = 0.8; c.strokeStyle = 'rgba(7,4,12,0.55)'; c.stroke();
      // ridge highlight on the lit side, cool rim on the back edges
      c.beginPath(); c.moveTo(ca * 31, sa * 31); c.lineTo(ca * 58, sa * 58); c.lineWidth = 1; c.strokeStyle = l0 > -0.2 ? CHITIN[4] : CHITIN[3]; c.stroke();
      if (ca * RIM[0] + sa * RIM[1] > 0.2) {
        c.beginPath(); c.moveTo(...plateAt(a, [[54, 12.2]], 1)[0]); c.lineTo(...plateAt(a, [[59.2, 4.6]], 1)[0]); c.lineTo(...plateAt(a, [[59.2, -4.6]], 1)[0]); c.lineTo(...plateAt(a, [[54, -12.2]], 1)[0]);
        c.lineWidth = 1.1; c.strokeStyle = RIMC; c.stroke();
      }
      // two spawn-vent slits per plate
      for (const v of [-6.5, 6.5]) { const S = plateAt(a, [[40, v], [47, v * 1.25]], 1); c.beginPath(); c.moveTo(...S[0]); c.lineTo(...S[1]); c.lineWidth = 1.6; c.strokeStyle = CHITIN[0]; c.stroke(); }
      polyPath(c, P); c.lineWidth = 1.2; c.strokeStyle = INK; c.lineJoin = 'miter'; c.stroke();
    }
    // flesh pods in the gaps (glow drawn live)
    for (const a0 of PLATE_AX) {
      const a = a0 + Math.PI / 6, px = Math.cos(a) * HIVE_POD_R, py = Math.sin(a) * HIVE_POD_R;
      facetPoly(c, chamferPoly(px, py, 7.5, 6, a, 0.22), px, py, FLESH, 1, 4, null);
      c.beginPath(); c.moveTo(px - Math.cos(a) * 3, py - Math.sin(a) * 3); c.lineTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3); c.lineWidth = 1.4; c.strokeStyle = FLESH[0]; c.stroke();
    }
    // collar around the maw: a chamfered octagon ring, faceted
    facetPoly(c, chamferPoly(0, 0, HIVE_MAW + 6, 8, Math.PI / 8, 0.2), 0, 0, CHITIN, 1, 4, RIMC);
    // maw: stepped dark throat (ramp, not a gradient blur)
    const throat = ['#1a0718', '#11040f', '#0a0209', '#050105'];
    [HIVE_MAW, HIVE_MAW - 6, HIVE_MAW - 12, HIVE_MAW - 18].forEach((rr, i) => { polyPath(c, chamferPoly(0, 0, rr, 8, Math.PI / 8, 0.2)); c.fillStyle = throat[i]; c.fill(); });
    polyPath(c, chamferPoly(0, 0, HIVE_MAW, 8, Math.PI / 8, 0.2)); c.lineWidth = 1.4; c.strokeStyle = INK; c.stroke();
    // fangs: 12 chunky bone wedges pointing inward, lit side / shadow side
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + Math.PI / 12, ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca, R0 = HIVE_MAW - 0.5, R1 = HIVE_MAW - 11, w = 3.6;
      const b0 = [ca * R0 + tx * w, sa * R0 + ty * w], b1 = [ca * R0 - tx * w, sa * R0 - ty * w], tip = [ca * R1, sa * R1], mid = [ca * R0, sa * R0];
      const l = lum(-ca, -sa);
      polyPath(c, [b0, tip, mid]); c.fillStyle = step(BONE, lum(tx - ca * 0.3, ty - sa * 0.3), 1, 4); c.fill();
      polyPath(c, [mid, tip, b1]); c.fillStyle = step(BONE, lum(-tx - ca * 0.3, -ty - sa * 0.3), 1, 4); c.fill();
      polyPath(c, [b0, tip, b1]); c.lineWidth = 0.9; c.strokeStyle = INK; c.stroke();
      void l;
    }
    // innermost gullet
    polyPath(c, chamferPoly(0, 0, 6, 8, Math.PI / 8, 0.2)); c.fillStyle = '#000000'; c.fill();
  }

  function paintAlienNode(c) {
    // alien ring node: a chamfered chitin hex socket with a flesh core (becomes a yellow build node on capture)
    withShadow(c, 4, 1, 3, 0.7, () => { polyPath(c, chamferPoly(0, 0, 16, 6, 0, 0.16)); c.fillStyle = INK; c.fill(); });
    facetPoly(c, chamferPoly(0, 0, 15.5, 6, 0, 0.16), 0, 0, CHITIN, 1, 3, RIMC);
    polyPath(c, chamferPoly(0, 0, 10.5, 6, 0, 0.16)); c.fillStyle = CHITIN[0]; c.fill(); c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    facetPoly(c, chamferPoly(0, 0, 6.2, 6, Math.PI / 6, 0.2), 0, 0, FLESH, 2, 4, null);
  }

  function paintPod(c) {
    // egg sac: chamfered chitin shell, cracked open on a flesh seam
    withShadow(c, 4, 1, 3, 0.7, () => { polyPath(c, chamferPoly(0, 0, 9.6, 8, Math.PI / 8, 0.2)); c.fillStyle = INK; c.fill(); });
    facetPoly(c, chamferPoly(0, 0, 9, 8, Math.PI / 8, 0.2), 0, 0, CHITIN, 1, 4, RIMC);
    polyPath(c, [[-5, -2.4], [0, -1.2], [5, -2.4], [3, 1.8], [0, 2.8], [-3, 1.8]]); c.fillStyle = FLESH[3]; c.fill(); c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    c.beginPath(); c.moveTo(-3, -1.2); c.lineTo(0, -0.4); c.lineTo(3, -1.2); c.lineWidth = 0.8; c.strokeStyle = FLESH[4]; c.stroke();
  }

  // med-station: a slate hex pad, a chamfered bone-white cross with a green lamp, hazard corners (player hardware)
  function paintMed(c) {
    withShadow(c, 6, 2, 5, 0.75, () => { polyPath(c, chamferPoly(0, 0, 22.5, 6, 0, 0.14)); c.fillStyle = INK; c.fill(); });
    facetPoly(c, chamferPoly(0, 0, 21, 6, 0, 0.14), 0, 0, SLATE, 1, 4, RIMC);
    polyPath(c, chamferPoly(0, 0, 15.5, 6, 0, 0.14)); c.fillStyle = SLATE[1]; c.fill(); c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    const cross = [[-3.5, -11], [3.5, -11], [3.5, -3.5], [11, -3.5], [11, 3.5], [3.5, 3.5], [3.5, 11], [-3.5, 11], [-3.5, 3.5], [-11, 3.5], [-11, -3.5], [-3.5, -3.5]];
    polyPath(c, cross.map(([x, y]) => [x + 0.8, y + 1.2])); c.fillStyle = INK; c.fill();
    polyPath(c, cross); c.fillStyle = '#d8dee4'; c.fill();
    c.beginPath(); c.moveTo(-3.5, 11); c.lineTo(-3.5, 3.5); c.lineTo(-11, 3.5); c.lineTo(-11, -3.5); c.lineTo(-3.5, -3.5); c.lineTo(-3.5, -11); c.lineTo(3.5, -11);
    c.lineWidth = 1; c.strokeStyle = '#f6f8fa'; c.stroke();
    polyPath(c, cross); c.lineWidth = 1.1; c.strokeStyle = INK; c.stroke();
    polyPath(c, chamferPoly(0, 0, 3, 8, Math.PI / 8, 0.2)); c.fillStyle = '#5dff7a'; c.fill(); c.lineWidth = 0.8; c.strokeStyle = '#0d3a18'; c.stroke();
    for (const k of [0, 3]) { // hazard marks on two opposite corners
      const a = (k * Math.PI) / 3, ca = Math.cos(a), sa = Math.sin(a);
      c.save(); c.translate(ca * 17.5, sa * 17.5); c.rotate(a + Math.PI / 2);
      c.fillStyle = '#f2c230'; c.fillRect(-4, -1.4, 8, 2.8); c.fillStyle = INK; c.fillRect(-1.2, -1.4, 1.3, 2.8); c.fillRect(2.2, -1.4, 1.3, 2.8);
      c.restore();
    }
  }

  function armPts(a, len, hw, ch) {
    const ca = Math.cos(a), sa = Math.sin(a), P = [[0, -hw], [len - ch, -hw], [len, -hw + ch], [len, hw - ch], [len - ch, hw], [0, hw]];
    return P.map(([u, v]) => [u * ca - v * sa, u * sa + v * ca]);
  }
  function paintBase(c) {
    // captured base: a slate hex hub with six chamfered arms (two facets each, split on the arm axis), rungs, hazard
    // marks and a yellow emblem plate. Same ramp/outline/light rules as the hive so the two read as one world.
    const outline = (grow) => {
      c.beginPath();
      hexPath(c, 0, 0, 36 + grow, 0);
      for (const a of SPIKES) { const P = armPts(a, 52 + grow, 15 + grow, 5); c.moveTo(...P[0]); for (let i = 1; i < P.length; i++) c.lineTo(...P[i]); c.closePath(); }
    };
    withShadow(c, 10, 2, 6, 0.75, () => { outline(2); c.fillStyle = INK; c.fill(); });
    for (const a of SPIKES) {
      const P = armPts(a, 52, 15, 5), ca = Math.cos(a), sa = Math.sin(a), tx = -sa, ty = ca;
      // facets: the half facing the key light is a ramp step lighter
      const A0 = [P[0], P[1], P[2], [ca * 52, sa * 52], [0, 0]], A1 = [[0, 0], [ca * 52, sa * 52], P[3], P[4], P[5]];
      for (const [pts, side] of [[A0, -1], [A1, 1]]) {
        const nx = ca * 0.4 + tx * side, ny = sa * 0.4 + ty * side, nl = Math.hypot(nx, ny);
        polyPath(c, pts); c.fillStyle = step(SLATE, lum(nx / nl, ny / nl), 1, 3); c.fill();
      }
      // end cap facet + cool rim on the back edges
      const E = armPts(a, 52, 15, 5).slice(1, 5), cap = [E[0], E[1], E[2], E[3], [ca * 46 - tx * 10, sa * 46 - ty * 10]];
      void cap;
      polyPath(c, [E[0], E[1], E[2], E[3], [ca * 47 + tx * 10, sa * 47 + ty * 10], [ca * 47 - tx * 10, sa * 47 - ty * 10]]);
      c.fillStyle = step(SLATE, lum(ca, sa), 2, 4); c.fill();
      if (ca * RIM[0] + sa * RIM[1] > 0.2) { c.beginPath(); c.moveTo(...E[0]); c.lineTo(...E[1]); c.lineTo(...E[2]); c.lineTo(...E[3]); c.lineWidth = 1.1; c.strokeStyle = RIMC; c.stroke(); }
      polyPath(c, P); c.lineWidth = 1.3; c.strokeStyle = INK; c.lineJoin = 'miter'; c.stroke();
      // rungs: thin light bars
      for (const u of [26.5, 34, 41.5]) {
        c.save(); c.translate(ca * u, sa * u); c.rotate(a);
        c.fillStyle = INK; c.fillRect(-1.5, -8, 3, 16);
        c.fillStyle = '#d8dde6'; c.fillRect(-1, -7.2, 2, 14.4);
        c.fillStyle = '#8c96a3'; c.fillRect(0.2, -7.2, 0.8, 14.4);
        c.restore();
      }
    }
    // central hub: faceted chamfered hex, inner well, rim
    facetPoly(c, chamferPoly(0, 0, 34, 6, 0, 0.12), 0, 0, SLATE, 1, 4, RIMC);
    polyPath(c, chamferPoly(0, 0, 24, 6, 0, 0.12)); c.fillStyle = SLATE[1]; c.fill(); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
    // hazard stripes on two hub faces (top-left and bottom-right)
    for (const k of [4, 1]) {
      const a = (k * Math.PI) / 3 + Math.PI / 6, ca = Math.cos(a), sa = Math.sin(a);
      c.save(); c.translate(ca * 28.5, sa * 28.5); c.rotate(a + Math.PI / 2);
      c.beginPath(); c.rect(-8, -2, 16, 4); c.clip();
      c.fillStyle = '#f2c230'; c.fillRect(-8, -2, 16, 4);
      c.fillStyle = INK; for (let x = -10; x < 10; x += 4) { c.beginPath(); c.moveTo(x, 2); c.lineTo(x + 2, -2); c.lineTo(x + 3.6, -2); c.lineTo(x + 1.6, 2); c.closePath(); c.fill(); }
      c.restore();
    }
    // centre plate: two light bars and the yellow emblem
    c.fillStyle = '#141b23'; c.fillRect(-13, -13, 26, 26); c.lineWidth = 1.2; c.strokeStyle = INK; c.strokeRect(-13, -13, 26, 26);
    c.fillStyle = SLATE[3]; c.fillRect(-13, -13, 26, 1.2);
    for (const y of [-10.5, 6.5]) {
      c.fillStyle = '#cdd4d2'; c.fillRect(-10.5, y, 21, 4);
      c.fillStyle = '#4a545c'; for (const x of [-5.5, -0.5, 4.5]) c.fillRect(x, y, 1, 4);
    }
    c.beginPath(); c.arc(0, -1.5, 5.2, 20 * D2R, 160 * D2R); c.lineWidth = 2; c.strokeStyle = '#e9df6c'; c.stroke();
    c.beginPath(); c.moveTo(-6.5, -2.2); c.lineTo(6.5, -2.2); c.lineWidth = 1.2; c.strokeStyle = '#c9c060'; c.stroke();
  }

  function paintNode(c) {
    // yellow hex build node: a faceted slate socket with a chunky faceted yellow core
    const GOLD = ['#4a3a08', '#8a6e10', '#c8a81c', '#f2d838', '#fff6a8'];
    withShadow(c, 5, 1, 4, 0.75, () => { polyPath(c, chamferPoly(0, 0, 21.5, 6, 0, 0.14)); c.fillStyle = INK; c.fill(); });
    facetPoly(c, chamferPoly(0, 0, 20, 6, 0, 0.14), 0, 0, SLATE, 1, 4, RIMC);
    polyPath(c, chamferPoly(0, 0, 13, 6, 0, 0.14)); c.fillStyle = SLATE[0]; c.fill(); c.lineWidth = 1; c.strokeStyle = INK; c.stroke();
    facetPoly(c, chamferPoly(0, 0, 8.5, 6, 0, 0.14), 0, 0, GOLD, 2, 4, null);
    polyPath(c, chamferPoly(0, 0, 4.2, 6, 0, 0.14)); c.fillStyle = GOLD[4]; c.fill();
  }

  function paintTurret(c) {
    const bar = (a, grow) => {
      const ca = Math.cos(a), sa = Math.sin(a), P = [[-24 - grow, -5.5 - grow], [24 + grow, -5.5 - grow], [24 + grow, 5.5 + grow], [-24 - grow, 5.5 + grow]];
      c.moveTo(P[0][0] * ca - P[0][1] * sa, P[0][0] * sa + P[0][1] * ca);
      for (let i = 1; i < 4; i++) c.lineTo(P[i][0] * ca - P[i][1] * sa, P[i][0] * sa + P[i][1] * ca);
      c.closePath();
    };
    withShadow(c, 6, 2, 5, 0.75, () => { c.beginPath(); bar(Math.PI / 4, 1.5); bar(-Math.PI / 4, 1.5); c.fillStyle = '#05070a'; c.fill(); });
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      c.beginPath(); bar(a, 0);
      const n = [-Math.sin(a), Math.cos(a)];
      const g = c.createLinearGradient(-n[0] * 5.5, -n[1] * 5.5, n[0] * 5.5, n[1] * 5.5);
      g.addColorStop(0, '#45576a'); g.addColorStop(0.45, '#2b3946'); g.addColorStop(1, '#1a232c');
      c.fillStyle = g; c.fill(); c.lineWidth = 1.4; c.strokeStyle = '#05070a'; c.stroke();
      for (const s of [-1, 1]) {
        c.save(); c.rotate(a); c.fillStyle = '#5c6e7e'; c.fillRect(s > 0 ? 18 : -23, -4.4, 5, 8.8); c.restore();
      }
    }
    c.save(); c.rotate(-3 * Math.PI / 4); c.fillStyle = '#cdd85c'; c.fillRect(14, -3, 5, 6); c.restore();
    c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.fillStyle = '#1c2630'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#05070a'; c.stroke();
    c.beginPath(); c.arc(0, 0, 5, 0, TAU); c.fillStyle = '#2f3e4c'; c.fill();
  }
  function paintBarrel(c) {
    withShadow(c, 3, 1, 3, 0.6, () => { c.fillStyle = '#05070a'; c.fillRect(1, -4.6, 32, 9.2); c.beginPath(); c.arc(0, 0, 7.3, 0, TAU); c.fill(); });
    c.fillStyle = '#1d262f'; c.fillRect(2, -3.6, 30, 7.2);
    c.fillStyle = '#4c5b68'; c.fillRect(2, -3.6, 30, 1.5);
    c.fillStyle = '#c9d1d3'; c.fillRect(25, -3.6, 7, 7.2);
    c.fillStyle = '#7d878b'; c.fillRect(25, 1.8, 7, 1.8);
    c.fillStyle = '#0d1116'; c.fillRect(12, -3.6, 1.2, 7.2);
    c.lineWidth = 1.1; c.strokeStyle = '#05070a'; c.strokeRect(2, -3.6, 30, 7.2);
    c.beginPath(); c.arc(0, 0, 6.6, 0, TAU); c.fillStyle = '#35434f'; c.fill(); c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.arc(0, 0, 2.2, 0, TAU); c.fillStyle = '#d0da60'; c.fill();
  }
  function paintBarricade(c) {
    withShadow(c, 6, 2, 5, 0.75, () => { hexPath(c, 0, 0, 23, 0); c.fillStyle = '#05070a'; c.fill(); });
    hexPath(c, 0, 0, 21, 0); c.fillStyle = '#1a2129'; c.fill();
    c.save(); hexPath(c, 0, 0, 18.5, 0); c.clip();
    const bar = (x, y, w, h) => { c.fillStyle = '#0a0d11'; c.fillRect(x - 1, y - 1, w + 2, h + 2); c.fillStyle = '#aab4bc'; c.fillRect(x, y, w, h); c.fillStyle = '#dfe6ea'; c.fillRect(x, y, Math.min(w, 1.1), Math.min(h, 1.1) === h ? h : h); };
    for (const x of [-8, 5]) bar(x, -20, 3.2, 40);
    for (const y of [-8, 5]) bar(-20, y, 40, 3.2);
    c.restore();
    c.fillStyle = '#20282f'; c.fillRect(-4.6, -4.6, 9.4, 9.4); c.fillStyle = '#ccd448'; c.fillRect(-1.6, -1.6, 3.4, 3.4);
    hexPath(c, 0, 0, 21, 0); c.lineWidth = 2.6; c.strokeStyle = '#05070a'; c.stroke();
    // yellow brackets: top/bottom edges and the left/right points
    const V = []; for (let i = 0; i < 6; i++) V.push(polar(25.5, (i * Math.PI) / 3));
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const segs = [[lerp(V[4], V[5], 0.12), lerp(V[4], V[5], 0.88)], [lerp(V[1], V[2], 0.12), lerp(V[1], V[2], 0.88)]];
    const chev = [[lerp(V[2], V[3], 0.45), V[3], lerp(V[3], V[4], 0.55)], [lerp(V[5], V[0], 0.45), V[0], lerp(V[0], V[1], 0.55)]];
    for (const [w, col] of [[5.6, '#0a0904'], [3.4, '#f2da3a']]) {
      c.lineWidth = w; c.strokeStyle = col; c.lineCap = 'butt'; c.lineJoin = 'miter';
      for (const [p, q] of segs) { c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.stroke(); }
      for (const [p, q, s] of chev) { c.beginPath(); c.moveTo(...p); c.lineTo(...q); c.lineTo(...s); c.stroke(); }
    }
  }

  function paintSoft(c, size) {
    const h = size / 2, g = c.createRadialGradient(0, 0, 0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.62)'); g.addColorStop(0.65, 'rgba(255,255,255,0.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(-h, -h, size, size);
  }
  // organic stain: lumpy soft blob with short radiating streaks (tinted at draw time)
  function paintStain(c, size, rnd) {
    const h = size / 2;
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU, d = Math.pow(rnd(), 0.7) * h * 0.52, rr = h * (0.16 + rnd() * 0.22);
      const x = Math.cos(a) * d, y = Math.sin(a) * d, g = c.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, 'rgba(255,255,255,0.32)'); g.addColorStop(0.6, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
    }
    c.lineCap = 'round';
    for (let i = 0; i < 22; i++) {
      const a = rnd() * TAU, r0 = h * (0.38 + rnd() * 0.12), r1 = h * (0.62 + rnd() * 0.3), bend = (rnd() - 0.5) * 0.5;
      c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      c.quadraticCurveTo(Math.cos(a + bend) * (r0 + r1) / 2, Math.sin(a + bend) * (r0 + r1) / 2, Math.cos(a + bend * 1.6) * r1, Math.sin(a + bend * 1.6) * r1);
      c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = h * (0.02 + rnd() * 0.03); c.stroke();
    }
  }
  // periodic value noise (tileable) for the stub ground and creep clouds
  function noise(size, rnd, octaves) {
    const out = new Float32Array(size * size); let amp = 1, tot = 0;
    for (const cells of octaves) {
      const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rnd();
      const k = cells / size;
      for (let y = 0; y < size; y++) {
        const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), y0 = iy % cells, y1 = (iy + 1) % cells;
        for (let x = 0; x < size; x++) {
          const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), x0 = ix % cells, x1 = (ix + 1) % cells;
          const a = g[y0 * cells + x0], b = g[y0 * cells + x1], cc = g[y1 * cells + x0], d = g[y1 * cells + x1];
          out[y * size + x] += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy);
        }
      }
      tot += amp; amp *= 0.55;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  }
  function paintCloud(size, rnd) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const cx = cv.getContext('2d'), img = cx.createImageData(size, size), d = img.data, n = noise(size, rnd, [4, 8, 16, 32]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1, r = Math.hypot(dx, dy);
      const warp = r * (0.75 + 0.5 * n[y * size + x]);
      let a = Math.max(0, 1 - warp); a = Math.pow(a, 1.1) * (0.65 + 0.7 * n[((y * 3) % size) * size + ((x * 3) % size)]);
      const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }
  function paintGround(size, rnd) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const cx = cv.getContext('2d'), img = cx.createImageData(size, size), d = img.data;
    const n1 = noise(size, rnd, [3, 6, 12, 24]), n2 = noise(size, rnd, [16, 32, 64]);
    for (let i = 0; i < size * size; i++) {
      const v = Math.max(0, Math.min(1, (n1[i] - 0.5) * 2.2 + 0.5)), f = (n2[i] - 0.5) * 0.18, sp = rnd() < 0.004 ? 0.12 : 0;
      const m = 1 + f + sp;
      d[i * 4] = (21 + 16 * v) * m; d[i * 4 + 1] = (20 + 12 * v) * m; d[i * 4 + 2] = (26 + 18 * v) * m; d[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }

  // painterly value mottling: low-frequency blotches plus per-texel grain, alpha untouched
  function mottle(c, w, h, amt, rnd) {
    const img = c.getImageData(0, 0, w, h), d = img.data, n = noise(Math.max(w, h), rnd, [6, 12, 24]);
    const sz = Math.max(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!d[i + 3]) continue;
      const m = 1 + amt * ((n[y * sz + x] - 0.5) * 2.2 + (rnd() - 0.5) * 0.9);
      d[i] = Math.min(255, d[i] * m); d[i + 1] = Math.min(255, d[i + 1] * m); d[i + 2] = Math.min(255, d[i + 2] * m);
    }
    c.putImageData(img, 0, 0);
  }
  function buildArt() {
    if (ART) return ART;
    if (!IP.gfx || !IP.gfx.gl) return null;
    const rnd = mulberry(0x51a7c0de);
    // [name, world w, world h, painter]
    const items = [
      ['hive', 150, 150, paintHive], ['base', 128, 128, paintBase], ['stain', 160, 160, (c) => paintStain(c, 160, rnd)], ['med', 52, 52, paintMed],
      ['barricade', 60, 60, paintBarricade], ['turret', 60, 60, paintTurret], ['node', 52, 52, paintNode],
      ['anode', 44, 44, paintAlienNode], ['barrel', 76, 20, paintBarrel], ['soft', 64, 64, (c) => paintSoft(c, 64)], ['pod', 26, 26, paintPod],
    ];
    const AW = 1024, pad = 4, atlas = document.createElement('canvas');
    let x = pad, y = pad, rowH = 0;
    const place = [];
    for (const [name, w, h, fn, opt] of items) {
      const pw = w * K, ph = h * K;
      if (x + pw + pad > AW) { x = pad; y += rowH + pad; rowH = 0; }
      place.push({ name, w, h, fn, opt, px: x, py: y, pw, ph });
      x += pw + pad; rowH = Math.max(rowH, ph);
    }
    atlas.width = AW; atlas.height = Math.pow(2, Math.ceil(Math.log2(y + rowH + pad)));
    const ac = atlas.getContext('2d');
    const uv = {}, size = {};
    for (const p of place) {
      ac.save(); ac.beginPath(); ac.rect(p.px, p.py, p.pw, p.ph); ac.clip();
      if (p.opt && p.opt.soft) {
        // pixel-soft: paint at a low texel density, mottle it, then blur it up into the atlas (the bar's look)
        const ks = p.opt.soft, tw = Math.round(p.w * ks), th = Math.round(p.h * ks);
        const tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
        const tx = tc.getContext('2d');
        tx.translate(tw / 2, th / 2); tx.scale(ks, ks); PK = ks; p.fn(tx); PK = K;
        if (p.opt.mottle) mottle(tx, tw, th, p.opt.mottle, mulberry(IP.hash(p.name)));
        ac.imageSmoothingEnabled = true; ac.imageSmoothingQuality = 'high';
        if (p.opt.blur) ac.filter = 'blur(' + p.opt.blur + 'px)';
        ac.drawImage(tc, p.px, p.py, p.pw, p.ph);
      } else {
        ac.translate(p.px + p.pw / 2, p.py + p.ph / 2); ac.scale(K, K);
        p.fn(ac);
      }
      ac.restore();
      uv[p.name] = [p.px / AW, p.py / atlas.height, (p.px + p.pw) / AW, (p.py + p.ph) / atlas.height];
      size[p.name] = [p.w, p.h];
    }
    const tex = IP.gfx.texture(atlas, { filter: 'linear', mipmap: true, name: 'structures-atlas' });
    const cloud = IP.gfx.texture(paintCloud(256, rnd), { filter: 'linear', mipmap: true, name: 'structures-cloud' });
    const ground = IP.gfx.texture(paintGround(512, rnd), { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'structures-ground' });
    ART = { tex, uv, size, cloud, ground, canvas: atlas };
    return ART;
  }

  // =================================================================== entities
  function add(world, kind, x, y, o) {
    o = o || {};
    const S = sys(world), d = DEF[kind] || {};
    const s = {
      id: S.nextId++, kind, owner: o.owner || (kind === 'hive' ? 'alien' : 'player'), x, y, r: o.r || d.r || 20,
      hp: o.hp != null ? o.hp : d.hp || 1, maxHp: o.maxHp || d.hp || 1, state: 'active', spawn: null,
      hitT: -9, flash: 0, bornT: world.time, phase: S.rng() * TAU,
    };
    if (o.hp != null && !o.maxHp) s.maxHp = Math.max(o.hp, d.hp || 1);
    if (kind === 'hive') {
      s.spawn = Object.assign({ kinds: ['drone'], rate: 4, burst: DEF.hive.burst }, o.spawn || {});
      s.spawnDef = Object.assign({}, s.spawn);
      s.spawnAcc = S.rng() * s.spawn.burst; s.creepR = DEF.hive.creepMin; s.creepT = 0; s.pulse = 0; s.capP = 0; s.capN = 0;
      s.ring = SLOTS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
      s.pods = []; const np = 2 + ((S.rng() * 3) | 0);
      for (let i = 0; i < np; i++) { const k = (S.rng() * 6) | 0, a = S.rng() * TAU; s.pods.push({ x: s.ring[k].x + Math.cos(a) * 26, y: s.ring[k].y + Math.sin(a) * 26, s: 0.8 + S.rng() * 0.4 }); }
    } else if (kind === 'node') {
      s.state = 'empty'; s.parent = o.parent != null ? o.parent : null; s.slot = o.slot != null ? o.slot : -1; s.occupant = null; s.hp = s.maxHp = 1;
    } else if (kind === 'turret') {
      Object.assign(s, { range: DEF.turret.range, dmg: DEF.turret.dmg, cooldown: DEF.turret.cooldown, cool: 0, scan: 0, aim: o.aim != null ? o.aim : -Math.PI / 2, target: null, fireT: -9, node: o.node != null ? o.node : null });
      s.state = 'idle';
    } else if (kind === 'barricade') {
      s.node = o.node != null ? o.node : null; s.blockSave = null;
    } else if (kind === 'med-station') {
      Object.assign(s, { range: DEF['med-station'].range, healT: 0, fireT: -9, node: o.node != null ? o.node : null }); s.state = 'idle';
    } else if (kind === 'base') {
      s.state = 'building'; s.nodeIds = [];
    }
    world.structures.push(s);
    if (kind === 'barricade') markBlocked(world, s, true);
    if (kind === 'base' && o.nodes !== false) makeNodes(world, s);
    return s;
  }
  function byId(world, id) { const L = world.structures; for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }
  function makeNodes(world, base) {
    base.nodeIds = SLOTS.map(([dx, dy], i) => {
      const n = add(world, 'node', base.x + dx, base.y + dy, { parent: base.id, slot: i });
      n.bornT = world.time + 0.25 + i * 0.07;
      return n.id;
    });
  }
  function remove(world, s) {
    s.dead = true;
    if (s.kind === 'barricade') markBlocked(world, s, false);
    if (s.node != null) { const n = byId(world, s.node); if (n) { n.occupant = null; n.state = 'empty'; } }
  }

  function capture(world, s) {
    if (s.kind !== 'hive') return s;
    const S = sys(world);
    const R = DEF.hive.burstR;
    IP.emit(world, 'explosion', { x: s.x, y: s.y, r: R, kind: 'hive' });
    world.bp = (world.bp || 0) + DEF.hive.bp;
    IP.emit(world, 'hive-captured', { id: s.id, x: s.x, y: s.y, bp: DEF.hive.bp });
    // the capture burst kills every alien standing on the hive, so the new base is not overrun at once
    const A = world.aliens, sw = on(world, 'swarm') && IP.swarm && IP.swarm.damage;
    for (let i = 0, n = A.length; i < n; i++) {
      const a = A[i];
      if (!a || a.state === 'dead' || !(a.hp > 0)) continue;
      const dx = a.x - s.x, dy = a.y - s.y;
      if (dx * dx + dy * dy > R * R) continue;
      if (sw) IP.swarm.damage(world, a, 1e9, 'hive'); else a.hp = -1;
    }
    // ...and its shockwave (drawn out to shockR) shreds small bugs further out
    const R2 = DEF.hive.shockR, dmg = DEF.hive.shockDmg;
    for (let i = 0, n = A.length; i < n; i++) {
      const a = A[i];
      if (!a || a.state === 'dead' || !(a.hp > 0)) continue;
      const dx = a.x - s.x, dy = a.y - s.y, d2 = dx * dx + dy * dy;
      if (d2 <= R * R || d2 > R2 * R2) continue;
      if (sw) IP.swarm.damage(world, a, dmg, 'hive'); else { a.hp -= dmg; a.hitT = world.time; }
    }
    s.kind = 'base'; s.owner = 'player'; s.r = DEF.base.r; s.hp = s.maxHp = DEF.base.hp; s.spawn = null; s.capP = 0; s.capN = 0;
    s.state = 'building'; s.bornT = world.time; s.flash = 1; s.shieldUntil = world.time + DEF.base.shield; s.lastHp = s.hp; s.creepFade = s.creepGrown ? s.creepR : 0; s.creepGrown = false; s.creepT = 0;
    S.booms.push({ x: s.x, y: s.y, t: world.time, kind: 'capture' });
    makeNodes(world, s);
    return s;
  }
  function revert(world, s) {
    const S = sys(world);
    IP.emit(world, 'explosion', { x: s.x, y: s.y, r: 110, kind: 'hive' });
    IP.emit(world, 'base-lost', { id: s.id, x: s.x, y: s.y });
    for (const nid of s.nodeIds || []) {
      const n = byId(world, nid); if (!n) continue;
      if (n.occupant != null) { const o = byId(world, n.occupant); if (o && !o.dead) { IP.emit(world, 'explosion', { x: o.x, y: o.y, r: 40, kind: 'rocket' }); remove(world, o); } }
      n.dead = true;
    }
    s.kind = 'hive'; s.owner = 'alien'; s.r = DEF.hive.r; s.maxHp = DEF.hive.hp; s.hp = s.maxHp * 0.5;
    s.spawn = Object.assign({ kinds: ['drone'], rate: 4, burst: DEF.hive.burst }, s.spawnDef || {});
    s.spawnAcc = 0; s.creepR = DEF.hive.creepMin; s.state = 'active'; s.nodeIds = null; s.bornT = world.time; s.flash = 1; s.capP = 0; s.capN = 0;
    if (!s.ring) s.ring = SLOTS.map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy }));
    if (!s.pods) s.pods = [];
    S.booms.push({ x: s.x, y: s.y, t: world.time, kind: 'lost' });
  }

  function damage(world, s, dmg) {
    if (!s || s.dead || s.kind === 'node' || !(dmg > 0)) return 0;
    if (s.shieldUntil > world.time) { s.shieldHitT = world.time; return 0; }
    s.hp -= dmg; s.hitT = world.time; s.flash = Math.min(1, s.flash + 0.5);
    IP.emit(world, 'hit', { x: s.x, y: s.y, dmg, targetKind: 'structure' });
    return dmg;
  }

  function build(world, kind, where) {
    const api = IP.structures;
    api.lastError = null;
    const fail = (m) => { api.lastError = m; return null; };
    kind = KIND(kind);
    const cost = COST[kind];
    if (cost == null) return fail('cannot build "' + kind + '"');
    let node = null, x, y;
    if (where && typeof where === 'object') { x = where.x; y = where.y; }
    else {
      node = byId(world, where);
      if (!node || node.dead || node.kind !== 'node' || node.owner !== 'player') return fail('no such node');
      if (node.occupant != null) return fail('node is occupied');
      x = node.x; y = node.y;
    }
    if ((kind === 'turret' || kind === 'med-station') && !node) return fail(kind + 's are built on a node');
    if (!(x >= 0 && y >= 0)) return fail('bad position');
    if ((world.bp || 0) < cost) return fail('not enough BP');
    world.bp -= cost;
    const s = add(world, kind, x, y, { node: node ? node.id : null });
    if (node) { node.occupant = s.id; node.state = 'occupied'; }
    IP.emit(world, 'structure-built', { id: s.id, kind });
    return s;
  }

  function nearestEnemy(world, x, y, o) {
    o = o || {};
    const team = o.team || 'player', range = o.range != null ? o.range : Infinity;
    let best = null, bd = range * range;
    if (team === 'player') {
      if (o.aliens !== false) {
        const A = world.aliens;
        for (let i = 0, n = A.length; i < n; i++) {
          const a = A[i]; if (!a || !(a.hp > 0) || a.state === 'dead') continue;
          const dx = a.x - x, dy = a.y - y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = a; }
        }
      }
      if (o.structures !== false) {
        for (const s of world.structures) {
          if (s.dead || s.owner !== 'alien' || !(s.hp > 0)) continue;
          const dd = Math.max(0, Math.hypot(s.x - x, s.y - y) - s.r * 0.8), d = dd * dd;
          if (d < bd) { bd = d; best = s; }
        }
      }
    } else {
      for (const s of world.structures) {
        if (s.dead || s.owner !== 'player' || s.kind === 'node' || !(s.hp > 0)) continue;
        const dd = Math.max(0, Math.hypot(s.x - x, s.y - y) - s.r * 0.8), d = dd * dd;
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  }

  function at(world, x, y) {
    let best = null, bp = -1;
    for (const s of world.structures) {
      if (s.dead) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > s.r + 4) continue;
      const pri = s.kind === 'turret' || s.kind === 'barricade' ? 3 : s.kind === 'node' ? 2 : 1;
      if (pri > bp) { bp = pri; best = s; }
    }
    return best;
  }

  // ---- barricades and the terrain grid
  function markBlocked(world, s, onOff) {
    // swarm routing: an impassable circle in world.swarm.blockers, then rebuild its SDF + flow field
    const SW = world.swarm;
    if (SW && Array.isArray(SW.blockers) && IP.swarm && IP.swarm.rebuildPassability) {
      const bl = SW.blockers, k = bl.findIndex((b) => b.structureId === s.id);
      if (onOff && k < 0) bl.push({ x: s.x, y: s.y, r: s.r, structureId: s.id });
      if (!onOff && k >= 0) bl.splice(k, 1);
      if (on(world, 'swarm') && SW.sdf) IP.swarm.rebuildPassability(world);
    }
    const m = world.map, cell = m && m.cell, cols = m && m.cols, rows = m && m.rows;
    if (!m || !m.blocked || !cell || !cols || !rows) return;
    // copy-on-write: terrain keys its flow-field cache on the array identity, so a new array rebuilds the fields
    const g = (m.blocked = new Uint8Array(m.blocked));
    if (onOff) {
      s.blockSave = [];
      const c0 = Math.max(0, Math.floor((s.x - s.r) / cell)), c1 = Math.min(cols - 1, Math.floor((s.x + s.r) / cell));
      const r0 = Math.max(0, Math.floor((s.y - s.r) / cell)), r1 = Math.min(rows - 1, Math.floor((s.y + s.r) / cell));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const cx = (c + 0.5) * cell, cy = (r + 0.5) * cell;
        if (Math.hypot(cx - s.x, cy - s.y) > s.r + cell * 0.35) continue;
        const i = r * cols + c; s.blockSave.push(i, g[i]); g[i] = 1;
      }
    } else if (s.blockSave) {
      for (let k = 0; k < s.blockSave.length; k += 2) g[s.blockSave[k]] = s.blockSave[k + 1];
      s.blockSave = null;
    }
  }
  function blockedAt(world, x, y) {
    for (const s of world.structures) if (!s.dead && s.kind === 'barricade' && Math.hypot(s.x - x, s.y - y) < s.r) return true;
    return false;
  }

  // ---- spawning (real swarm when it runs, else the demo's stub swarm)
  function swarmSpawn(world, x, y, kind, n) {
    if (on(world, 'swarm') && IP.swarm && IP.swarm.spawn) { IP.swarm.spawn(world, { x, y, kind, n }); return; }
    const S = sys(world);
    if (S.demo && S.demo.stubSwarm) stubSpawn(world, x, y, kind, n);
  }

  // =================================================================== system
  let fontAsked = false;
  const api = (IP.structures = {
    DEF, COST, SLOTS, add, capture, build, damage, nearestEnemy, at, byId, blockedAt,
    hives: (world) => world.structures.filter((s) => !s.dead && s.kind === 'hive'),
    lastError: null,
    art: () => buildArt(),
  });

  IP.registerSystem('structures', {
    init(world) {
      world.structureSys = freshState(world);
      if (!fontAsked && IP.assets && IP.assets.font) {
        fontAsked = true;
        IP.assets.font('Chakra Petch', (IP.assets.base || 'assets/') + 'fonts/ChakraPetch-600.woff2', { weight: '600' }).catch(() => {});
      }
    },
    onInput(world, ev) {
      // build mode (HUD toggles world.flags.buildMode): a tap on a free yellow node builds world.flags.buildKind (turret)
      if (!world.structureSys || ev.consumed || ev.type !== 'tap' || !world.flags || !world.flags.buildMode) return;
      const s = at(world, ev.wx, ev.wy);
      if (!s || s.kind !== 'node' || s.owner !== 'player' || s.occupant != null) return;
      const b = build(world, world.flags.buildKind || 'turret', s.id);
      ev.consumed = true;
      if (!b && world.hud) world.hud.alert = { text: String(api.lastError || 'cannot build').toUpperCase(), color: '#ff4fa8', dur: 1.5 };
    },
    drawHud(world, ctx) {
      // capture label over each hive being taken: CAPTURING 62% / CONTESTED
      const S = world.structureSys;
      if (!S) return;
      for (const s of world.structures) {
        if (s.dead || s.kind !== 'hive' || !(s.capN > 0 || s.capP > 0)) continue;
        const p = IP.worldToScreen(s.x, s.y - 96, world), z = world.camera.zoom;
        if (p.x < -100 || p.x > 2020 || p.y < -60 || p.y > 1140) continue;
        const cont = s.state === 'contested', txt = cont ? 'CONTESTED' : s.capN > 0 ? 'CAPTURING ' + Math.floor(s.capP * 100) + '%' : 'HIVE ' + Math.floor(s.capP * 100) + '%';
        ctx.font = '600 ' + Math.round(15 * Math.max(0.8, Math.min(1.6, z))) + 'px "Chakra Petch", "Arial Narrow", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(4,6,10,0.9)'; ctx.lineJoin = 'round';
        ctx.strokeText(txt, p.x, p.y - 6 * z);
        ctx.fillStyle = cont ? '#ff6fb8' : '#f2e14c';
        ctx.fillText(txt, p.x, p.y - 6 * z);
      }
    },
    update(world, dt) {
      const S = world.structureSys;
      if (!S) return;
      const L = world.structures, t = world.time;
      const budget = (IP.budget && IP.budget.aliens) || 3000;
      for (let i = 0, n = L.length; i < n; i++) {
        const s = L[i];
        if (s.dead) continue;
        s.flash = Math.max(0, s.flash - dt * 3);
        if (s.kind === 'hive') {
          if (s.hp <= 0) { capture(world, s); continue; }
          s.pulse = Math.max(0, s.pulse - dt * 2.5);
          // capture loop: marines standing within captureR suppress spawning; with no alien within clearR the
          // progress fills (faster with more marines); aliens nearby contest it (holds); an empty hive decays it
          const H = DEF.hive, nm = marinesNear(world, s.x, s.y, H.captureR);
          s.capN = nm;
          if (nm > 0) {
            if (aliensNear(world, s.x, s.y, H.clearR)) s.state = 'contested';
            else {
              s.state = 'capturing';
              s.capP += (dt / H.captureTime) * (1 + 0.25 * (nm - 1));
              if (s.capP >= 1) { capture(world, s); continue; }
            }
          } else {
            s.state = 'active';
            if (s.capP > 0) s.capP = Math.max(0, s.capP - H.captureDecay * dt);
          }
          const sp = s.spawn;
          if (sp && sp.rate > 0 && nm === 0) {
            s.spawnAcc += sp.rate * diffOf(world) * dt;
            const burst = Math.max(1, sp.burst | 0);
            if (s.spawnAcc >= burst) {
              s.spawnAcc -= burst;
              const room = budget - IP.count(world.aliens);
              const k = Math.min(burst, room);
              if (k > 0) {
                const kinds = sp.kinds && sp.kinds.length ? sp.kinds : ['drone'];
                const kind = kinds[(S.rng() * kinds.length) | 0], a = S.rng() * TAU, d = s.r * (0.2 + 0.25 * S.rng());
                swarmSpawn(world, s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, kind, k);
                s.pulse = 1;
              }
            }
          }
          if ((s.creepT -= dt) <= 0) {
            s.creepT = 1;
            s.creepR = Math.min(DEF.hive.creepMax, s.creepR + DEF.hive.creepGrow);
            const T = terr(world); if (T && T.growCreep) { T.growCreep(world, s.x, s.y, s.creepR); s.creepGrown = true; }
          }
        } else if (s.kind === 'base') {
          // deploy shield: for a few seconds after capture the base shrugs off bites (attackers may subtract hp directly,
          // so both rules are applied to whatever hp was lost since our last tick); after that, armor keeps a quarter of it
          if (s.lastHp == null) s.lastHp = s.hp;
          if (s.hp < s.lastHp) { s.hp = s.shieldUntil > t ? s.lastHp : s.lastHp - (s.lastHp - s.hp) * DEF.base.armor; s.hitT = t; }
          s.lastHp = s.hp;
          if (s.hp <= 0) { revert(world, s); continue; }
          if (s.state === 'building' && t - s.bornT >= DEF.base.build) s.state = 'active';
          if (s.creepFade > 0 && (s.creepT -= dt) <= 0) {
            s.creepT = 0.5; s.creepFade = Math.max(0, s.creepFade - 45);
            const T = terr(world); if (T && T.setCreep) T.setCreep(world, s.x, s.y, s.creepFade);
          }
        } else if (s.kind === 'turret' || s.kind === 'barricade' || s.kind === 'med-station') {
          // swarm bites subtract hp directly: notice the loss so the hp arc and flash show it
          if (s.lastHp == null) s.lastHp = s.hp;
          if (s.hp < s.lastHp) { s.hitT = t; s.flash = Math.min(1, s.flash + 0.25); }
          s.lastHp = s.hp;
        }
        if (s.kind === 'med-station') {
          if (s.hp <= 0) { IP.emit(world, 'explosion', { x: s.x, y: s.y, r: 45, kind: 'rocket' }); remove(world, s); continue; }
          updateMed(world, s, dt);
        } else if (s.kind === 'turret') {
          if (s.hp <= 0) { IP.emit(world, 'explosion', { x: s.x, y: s.y, r: 45, kind: 'rocket' }); remove(world, s); continue; }
          updateTurret(world, s, dt);
        } else if (s.kind === 'barricade') {
          if (s.hp <= 0) { IP.emit(world, 'explosion', { x: s.x, y: s.y, r: 45, kind: 'rocket' }); remove(world, s); continue; }
          pushOut(world, s);
        }
      }
      // drop removed structures (and nodes whose base fell)
      let w = 0;
      for (let i = 0; i < L.length; i++) if (!L[i].dead) L[w++] = L[i];
      L.length = w;
      for (let i = S.tracers.length - 1; i >= 0; i--) if ((S.tracers[i].life -= dt) <= 0) S.tracers.splice(i, 1);
      for (let i = S.booms.length - 1; i >= 0; i--) if (t - S.booms[i].t > 1.2) S.booms.splice(i, 1);
      if (S.demo) demoUpdate(world, dt);
    },
    draw(world, r) {
      const S = world.structureSys;
      if (!S) return;
      const A = buildArt();
      if (!A) return;
      if (S.demo) demoDrawUnder(world, r, A);
      drawStructures(world, r, A);
      if (S.demo) demoDrawOver(world, r, A);
    },
  });

  function marinesNear(world, x, y, R) {
    const M = world.marines; let n = 0;
    if (M) for (let i = 0; i < M.length; i++) {
      const m = M[i]; if (!m || m.state === 'dead' || !(m.hp > 0)) continue;
      const dx = m.x - x, dy = m.y - y; if (dx * dx + dy * dy <= R * R) n++;
    }
    return n;
  }
  function aliensNear(world, x, y, R) {
    if (on(world, 'swarm') && IP.swarm && IP.swarm.inRadius) { let hit = false; IP.swarm.inRadius(world, x, y, R, () => (hit = true)); return hit; }
    const A = world.aliens;
    for (let i = 0, n = A.length; i < n; i++) {
      const a = A[i]; if (!a || a.state === 'dead' || !(a.hp > 0)) continue;
      const dx = a.x - x, dy = a.y - y; if (dx * dx + dy * dy <= R * R) return true;
    }
    return false;
  }
  function updateMed(world, s, dt) {
    const D = DEF['med-station'];
    if ((s.healT -= dt) > 0) return;
    s.healT = D.every;
    let n = 0;
    for (const m of world.marines || []) {
      if (!m || m.state === 'dead' || !(m.hp > 0) || m.hp >= m.maxHp) continue;
      if (Math.hypot(m.x - s.x, m.y - s.y) > s.range) continue;
      m.hp = Math.min(m.maxHp, m.hp + D.heal * D.every);
      IP.emit(world, 'shot', { x: s.x, y: s.y - 4, tx: m.x, ty: m.y, weapon: 'medic', hit: true });
      n++;
    }
    s.state = n ? 'healing' : 'idle';
    if (n) s.fireT = world.time;
  }
  function updateTurret(world, s, dt) {
    s.cool -= dt;
    const tg = s.target;
    const alive = tg && !tg.dead && tg.hp > 0 && tg.state !== 'dead' && Math.hypot(tg.x - s.x, tg.y - s.y) <= s.range + (tg.r || 0);
    if (!alive) s.target = null;
    if (--s.scan <= 0 || !s.target) { s.target = nearestEnemy(world, s.x, s.y, { range: s.range }); s.scan = 8; }
    const T = s.target;
    s.state = T ? 'firing' : 'idle';
    if (!T) { s.aim += Math.sin(world.time * 0.6 + s.phase) * dt * 0.4; return; }
    const want = Math.atan2(T.y - s.y, T.x - s.x);
    let da = want - s.aim; da = Math.atan2(Math.sin(da), Math.cos(da));
    const step = DEF.turret.turn * dt;
    s.aim += Math.abs(da) <= step ? da : Math.sign(da) * step;
    if (Math.abs(da) < 0.2 && s.cool <= 0) {
      s.cool = s.cooldown; s.fireT = world.time;
      const mx = s.x + Math.cos(s.aim) * 32, my = s.y + Math.sin(s.aim) * 32;
      const isS = T.kind === 'hive' || T.owner === 'alien';
      IP.emit(world, 'shot', { x: mx, y: my, tx: T.x, ty: T.y, weapon: 'turret', hit: true });
      if (isS && world.structures.includes(T)) damage(world, T, s.dmg);
      else { T.hp -= s.dmg; T.hitT = world.time; IP.emit(world, 'hit', { x: T.x, y: T.y, dmg: s.dmg, targetKind: 'alien' }); }
      if (!on(world, 'vfx')) sys(world).tracers.push({ x: mx, y: my, tx: T.x, ty: T.y, life: 0.07 });
    }
  }
  function pushOut(world, s) {
    const A = world.aliens, R = s.r + 2;
    for (let i = 0, n = A.length; i < n; i++) {
      const a = A[i]; if (!a) continue;
      const dx = a.x - s.x, dy = a.y - s.y, rr = R + (a.r || 6);
      if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
      const d = Math.hypot(dx, dy);
      if (d >= rr) continue;
      const k = d > 1e-3 ? rr / d : 0;
      if (k) { a.x = s.x + dx * k; a.y = s.y + dy * k; } else { a.x = s.x + rr; }
    }
  }

  // =================================================================== drawing
  function spr(r, A, name, x, y, sc, o) {
    const sz = A.size[name];
    o.tex = A.tex; o.uv = A.uv[name]; o.center = true;
    r.quad(x, y, sz[0] * sc, sz[1] * sc, o.col || 0xffffffff, o);
  }
  function arcHp(r, x, y, rad, frac, col, alpha) {
    const n = 40, a0 = -Math.PI / 2;
    r.circle(x, y, rad, 'rgba(0,0,0,0.55)', { layer: 'over', width: 4, alpha });
    for (let i = 0; i < n; i++) {
      if ((i + 1) / n > frac + 1e-6) break;
      const p = a0 + (i / n) * TAU, q = a0 + ((i + 0.8) / n) * TAU;
      r.line(x + Math.cos(p) * rad, y + Math.sin(p) * rad, x + Math.cos(q) * rad, y + Math.sin(q) * rad, 2.5, col, { layer: 'over', alpha });
    }
  }
  const ease = (u) => 1 - Math.pow(1 - Math.max(0, Math.min(1, u)), 3);
  const back = (u) => { u = Math.max(0, Math.min(1, u)); const c1 = 1.7; return 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); };

  function drawStructures(world, r, A) {
    const t = world.time, L = world.structures;
    const vis = [];
    for (let i = 0; i < L.length; i++) { const s = L[i]; if (!s.dead && r.inView(s.x, s.y, 180)) vis.push(s); }
    vis.sort((a, b) => a.y - b.y || a.id - b.id);
    const terrainCreep = !!terr(world), buildMode = !!(world.flags && world.flags.buildMode);
    // ---- decal footprints
    for (const s of vis) {
      if (s.kind === 'hive') {
        if (!terrainCreep) {
          r.quad(s.x, s.y, s.creepR * 2.4, s.creepR * 2.2, '#6a2050', { layer: 'decal', tex: A.cloud, center: true, alpha: 0.75, rot: s.phase });
          r.quad(s.x, s.y, s.creepR * 1.4, s.creepR * 1.3, '#c23a72', { layer: 'decal', tex: A.cloud, center: true, alpha: 0.5, rot: -s.phase });
        }
        spr(r, A, 'stain', s.x, s.y + 4, 1.15, { layer: 'decal', col: 'rgba(14,4,18,0.9)', rot: s.phase });
        spr(r, A, 'soft', s.x, s.y, 2.6, { layer: 'decal', col: 'rgba(200,40,110,0.22)', add: true });
      } else if (s.kind === 'base') {
        spr(r, A, 'stain', s.x, s.y + 4, 0.95, { layer: 'decal', col: 'rgba(6,8,10,0.75)', rot: s.phase });
      }
    }
    // ---- flat plates: alien ring nodes, player nodes
    for (const s of vis) {
      if (s.kind === 'hive') {
        for (let i = 0; i < s.ring.length; i++) {
          const p = s.ring[i], gl = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 1.3 + s.phase);
          spr(r, A, 'anode', p.x, p.y, 1, { layer: 'shadow' });
          spr(r, A, 'soft', p.x, p.y, 0.5, { layer: 'shadow', col: '#f040c0', add: true, alpha: 0.1 + 0.18 * gl });
        }
      } else if (s.kind === 'node') {
        const u = (t - s.bornT) / 0.3;
        if (u <= 0) continue;
        const sc = back(u), gl = 0.5 + 0.5 * Math.sin(t * 3 + s.slot * 0.9);
        spr(r, A, 'node', s.x, s.y, sc, { layer: 'shadow' });
        if (s.occupant == null) {
          spr(r, A, 'soft', s.x, s.y, 0.5 * sc, { layer: 'shadow', col: '#ffe640', add: true, alpha: 0.18 + 0.22 * gl });
          if (buildMode) r.ngon(s.x, s.y, 25 + 2 * gl, 6, '#ffe640', { layer: 'fx', width: 2, add: true, alpha: 0.5 + 0.4 * gl });
        }
      }
    }
    // ---- bodies, y-sorted
    for (const s of vis) {
      if (s.kind === 'hive') drawHive(r, A, s, t);
      else if (s.kind === 'base') drawBase(r, A, s, t);
      else if (s.kind === 'turret') drawTurret(r, A, s, t);
      else if (s.kind === 'med-station') drawMed(r, A, s, t);
      else if (s.kind === 'barricade') {
        const sc = back((t - s.bornT) / 0.35);
        spr(r, A, 'barricade', s.x, s.y, sc, { layer: 'unit' });
        if (s.flash > 0) spr(r, A, 'barricade', s.x, s.y, sc, { layer: 'unit', col: '#ffffff', add: true, alpha: s.flash * 0.35 });
      }
    }
    // ---- hp arcs (only after recent damage)
    for (const s of vis) {
      if (s.kind === 'node' || s.hp >= s.maxHp) continue;
      const since = t - s.hitT;
      if (since > 2.5) continue;
      const alpha = Math.min(1, (2.5 - since) / 0.6);
      arcHp(r, s.x, s.y, s.r + 14, Math.max(0, s.hp / s.maxHp), s.owner === 'alien' ? '#ff4fa8' : '#f2e14c', alpha);
    }
    // capture progress: the capture radius (dashed, turning) and a segmented bar over the hive
    for (const s of vis) if (s.kind === 'hive' && (s.capN > 0 || s.capP > 0)) drawCapture(r, s, t);
    // capture / loss shockwaves
    for (const b of world.structureSys.booms) {
      const u = (t - b.t) / 1.2, col = b.kind === 'capture' ? '#f2e14c' : '#ff4fa8';
      r.circle(b.x, b.y, 40 + (b.kind === 'capture' ? DEF.hive.shockR - 40 : 150) * ease(u), col, { layer: 'fx', width: 6 * (1 - u) + 1, add: true, alpha: 0.8 * (1 - u) });
      if (u < 0.4) spr(r, A, 'soft', b.x, b.y, 4 * (1 - u), { layer: 'fx', col, add: true, alpha: 0.6 * (1 - u / 0.4) });
    }
  }

  function drawHive(r, A, s, t) {
    const breathe = 1 + 0.016 * Math.sin(t * 2.1 + s.phase);
    const u = (t - s.bornT) / 0.5, grow = s.bornT > 0 ? back(u) : 1;
    for (const p of s.pods) spr(r, A, 'pod', p.x, p.y, p.s, { layer: 'unit' });
    const sc = breathe * grow * HIVE_DRAW;
    spr(r, A, 'hive', s.x, s.y, sc, { layer: 'unit' });
    // flesh pods: additive halo pulsing in a wave around the ring, flaring on each spawn
    for (let i = 0; i < 6; i++) {
      const a = PLATE_AX[i] + Math.PI / 6, gl = 0.5 + 0.5 * Math.sin(t * 3.2 - i * 1.05 + s.phase), pr = HIVE_POD_R * sc;
      spr(r, A, 'soft', s.x + Math.cos(a) * pr, s.y + Math.sin(a) * pr, 0.4 * sc, { layer: 'unit', col: '#ff3a9a', add: true, alpha: Math.min(0.6, 0.22 + 0.2 * gl + 0.3 * s.pulse) });
    }
    // the maw: a magenta throat glow that breathes and flares on every spawn (suppressed = dim, while marines hold it)
    const mouth = 0.5 + 0.5 * Math.sin(t * 1.7 + s.phase), dim = s.capN > 0 ? 0.35 : 1;
    spr(r, A, 'soft', s.x, s.y, 0.62 * sc, { layer: 'unit', col: '#ff2f8c', add: true, alpha: dim * (0.22 + 0.18 * mouth + 0.45 * s.pulse) });
    spr(r, A, 'soft', s.x, s.y, 0.3 * sc, { layer: 'unit', col: '#ffb0d8', add: true, alpha: dim * (0.12 + 0.1 * mouth + 0.35 * s.pulse) });
    if (s.flash > 0) spr(r, A, 'hive', s.x, s.y, sc, { layer: 'unit', col: '#ffd0e8', add: true, alpha: s.flash * 0.4 });
    if (s.state === 'capturing') spr(r, A, 'hive', s.x, s.y, sc, { layer: 'unit', col: '#f2e14c', add: true, alpha: 0.06 + 0.06 * Math.sin(t * 8) });
  }
  function drawCapture(r, s, t) {
    const R = DEF.hive.captureR, p = Math.max(0, Math.min(1, s.capP)), cont = s.state === 'contested';
    const col = cont ? '#ff4fa8' : '#f2e14c', fade = s.capN > 0 ? 1 : 0.55;
    // dashed capture radius, turning while it fills
    const n = 36, spin = s.state === 'capturing' ? t * 0.6 : 0;
    for (let i = 0; i < n; i++) {
      const a0 = spin + (i / n) * TAU, a1 = a0 + (TAU / n) * 0.55;
      r.line(s.x + Math.cos(a0) * R, s.y + Math.sin(a0) * R, s.x + Math.cos(a1) * R, s.y + Math.sin(a1) * R, 2, col, { layer: 'shadow', add: true, alpha: 0.55 * fade });
    }
    // bar: dark chamfered frame, 12 segments filling left to right, leading segment blinking
    const W = 132, Hh = 14, x0 = s.x - W / 2, y0 = s.y - 96;
    r.poly([x0 + 4, y0 - 3, x0 + W + 3, y0 - 3, x0 + W + 7, y0 + 1, x0 + W + 7, y0 + Hh + 3, x0 - 7 + 4, y0 + Hh + 3, x0 - 7, y0 + Hh - 1, x0 - 7, y0 + 1, x0 - 3, y0 - 3], 'rgba(6,8,12,0.88)', { layer: 'over', alpha: fade });
    r.line(x0 - 6, y0 - 2.5, x0 + W + 6, y0 - 2.5, 1, col, { layer: 'over', alpha: 0.7 * fade });
    const N = 12, gap = 2, sw = (W - gap * (N - 1)) / N, filled = p * N;
    for (let i = 0; i < N; i++) {
      const sx = x0 + i * (sw + gap), f = Math.max(0, Math.min(1, filled - i));
      r.quad(sx, y0 + 2, sw, Hh - 4, 'rgba(60,62,70,0.6)', { layer: 'over', alpha: fade });
      if (f > 0) r.quad(sx, y0 + 2, sw * f, Hh - 4, col, { layer: 'over', alpha: fade * (f < 1 && !cont ? 0.6 + 0.4 * Math.sin(t * 14) : 1) });
    }
  }
  function drawMed(r, A, s, t) {
    const sc = back((t - s.bornT) / 0.35), gl = Math.max(0, 1 - (t - s.fireT) / 0.5);
    r.circle(s.x, s.y, s.range, '#5dff7a', { layer: 'shadow', width: 1.5, add: true, alpha: 0.1 + 0.25 * gl });
    spr(r, A, 'med', s.x, s.y, sc, { layer: 'unit' });
    spr(r, A, 'soft', s.x, s.y, 0.35 + 0.25 * gl, { layer: 'unit', col: '#5dff7a', add: true, alpha: 0.25 + 0.5 * gl });
    if (s.flash > 0) spr(r, A, 'med', s.x, s.y, sc, { layer: 'unit', col: '#ffffff', add: true, alpha: s.flash * 0.35 });
  }
  function drawBase(r, A, s, t) {
    const u = (t - s.bornT) / DEF.base.build;
    const sc = s.bornT > 0 ? back(u) : 1;
    spr(r, A, 'base', s.x, s.y, sc, { layer: 'unit' });
    if (s.shieldUntil > t) { // deploy shield: a yellow hex barrier that flickers out over its last second
      const left = s.shieldUntil - t, a = Math.min(1, left) * (0.3 + 0.12 * Math.sin(t * 9 + s.phase)) * Math.min(1, (t - s.bornT) / 0.3);
      r.ngon(s.x, s.y, 74, 6, '#f2e14c', { layer: 'fx', width: 2.5, add: true, alpha: a, rot: Math.PI / 6 });
      r.ngon(s.x, s.y, 74, 6, '#f2e14c', { layer: 'fx', add: true, alpha: a * 0.08, rot: Math.PI / 6 });
    }
    // emblem glow
    spr(r, A, 'soft', s.x, s.y - 1, 0.3, { layer: 'unit', col: '#f2e14c', add: true, alpha: 0.18 + 0.1 * Math.sin(t * 2 + s.phase) });
    if (s.flash > 0) spr(r, A, 'base', s.x, s.y, sc, { layer: 'unit', col: '#ffffff', add: true, alpha: s.flash * 0.35 });
  }
  function drawTurret(r, A, s, t) {
    const sc = back((t - s.bornT) / 0.35);
    spr(r, A, 'turret', s.x, s.y, sc, { layer: 'unit' });
    const recoil = Math.max(0, 1 - (t - s.fireT) / 0.08) * 3;
    const bx = s.x - Math.cos(s.aim) * recoil, by = s.y - Math.sin(s.aim) * recoil;
    spr(r, A, 'barrel', bx, by, sc, { layer: 'unit', rot: s.aim });
    if (s.flash > 0) spr(r, A, 'turret', s.x, s.y, sc, { layer: 'unit', col: '#ffffff', add: true, alpha: s.flash * 0.35 });
    const f = 1 - (t - s.fireT) / 0.06;
    if (f > 0) {
      const mx = s.x + Math.cos(s.aim) * 34, my = s.y + Math.sin(s.aim) * 34;
      spr(r, A, 'soft', mx, my, 0.45 * f + 0.15, { layer: 'fx', col: '#ffe27a', add: true, alpha: 0.9 * f });
    }
  }

  // =================================================================== demo: stubs for neighbours that are not running
  const BUGS = { drone: ['bug_drone', 'bug_drone_v1', 'bug_drone_v2'], runner: ['bug_runner'], spitter: ['bug_spitter'], brute: ['bug_brute'], tank: ['bug_tank'] };
  const SPEED = { drone: 62, runner: 95, spitter: 50, brute: 45, tank: 34 };
  const HP = { drone: 24, runner: 16, spitter: 30, brute: 90, tank: 240 };
  const RAD = { drone: 7, runner: 6, spitter: 8, brute: 11, tank: 15 };

  function stubSpawn(world, x, y, kind, n) {
    const D = world.structureSys.demo, rng = D.rng;
    const sheets = BUGS[kind] || BUGS.drone;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = rng() * 18;
      world.aliens.push({
        id: D.alienId++, kind, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: 0, vy: 0, r: RAD[kind] || 7, dir: a,
        hp: HP[kind] || 24, maxHp: HP[kind] || 24, speed: (SPEED[kind] || 60) * (0.85 + rng() * 0.3), state: 'move', targetId: null,
        sheet: sheets[(rng() * sheets.length) | 0], variant: 0, anim: 'walk', frame: 0, hitT: -9, phase: (rng() * 60) | 0, stub: true,
      });
    }
  }
  function demoUpdate(world, dt) {
    const D = world.structureSys.demo;
    // live path: the squad stands on the third hive, which captures by presence (~3 s with five marines, +BP);
    // one second after the base deploys, the BP buys a turret, a med-station and a barricade on the lane
    const cap = byId(world, D.capId);
    if (D.step === 0 && cap && cap.kind === 'base' && world.time - cap.bornT >= 1) {
      D.step = 1;
      const tur = build(world, 'turret', cap.nodeIds[4]);
      if (tur) tur.aim = Math.PI * 0.9;
      build(world, 'med-station', cap.nodeIds[3]);
      build(world, 'barricade', { x: 1250, y: 575 });
    }
    if (D.stubSwarm) {
      const A = world.aliens, M = world.marines;
      // spatial hash for separation
      const cell = 18, hash = new Map();
      for (let i = 0; i < A.length; i++) { const a = A[i], k = ((a.x / cell) | 0) * 4096 + ((a.y / cell) | 0); let b = hash.get(k); if (!b) hash.set(k, (b = [])); b.push(i); }
      for (let i = A.length - 1; i >= 0; i--) {
        const a = A[i];
        if (a.hp <= 0) { IP.emit(world, 'alien-died', { x: a.x, y: a.y, kind: a.kind, dir: a.dir, cause: 'turret' }); D.splats.push({ x: a.x, y: a.y, rot: D.rng() * TAU, s: 0.5 + D.rng() * 0.5 }); A.splice(i, 1); continue; }
      }
      if (D.splats.length > 120) D.splats.splice(0, D.splats.length - 120);
      for (let i = 0; i < A.length; i++) {
        const a = A[i];
        // goal: nearest marine or player structure
        let gx = a.x, gy = a.y, gd = 1e18, gr = 0, gs = null;
        for (const m of M) { if (m.state === 'dead') continue; const d = (m.x - a.x) ** 2 + (m.y - a.y) ** 2; if (d < gd) { gd = d; gx = m.x; gy = m.y; gr = m.r || 14; gs = null; } }
        const ps = nearestEnemy(world, a.x, a.y, { team: 'alien' });
        if (ps) { const d = Math.max(0, Math.hypot(ps.x - a.x, ps.y - a.y) - ps.r) ** 2; if (d < gd) { gd = d; gx = ps.x; gy = ps.y; gr = ps.r; gs = ps; } }
        const dx = gx - a.x, dy = gy - a.y, dist = Math.hypot(dx, dy) || 1;
        let vx = 0, vy = 0;
        if (dist > gr + a.r + 2) { vx = (dx / dist) * a.speed; vy = (dy / dist) * a.speed; a.state = 'move'; a.anim = 'walk'; }
        else {
          a.state = 'attack'; a.anim = 'attack';
          if (gs && (world.tick + a.id) % 30 === 0) damage(world, gs, 2);
        }
        // separation
        const cx = (a.x / cell) | 0, cy = (a.y / cell) | 0;
        let sx = 0, sy = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const b = hash.get((cx + ox) * 4096 + (cy + oy)); if (!b) continue;
          for (const j of b) {
            if (j === i || j >= A.length) continue;
            const o = A[j], ex = a.x - o.x, ey = a.y - o.y, dd = ex * ex + ey * ey, rr = a.r + o.r;
            if (dd > 0 && dd < rr * rr) { const d = Math.sqrt(dd), f = (rr - d) / rr; sx += (ex / d) * f; sy += (ey / d) * f; }
          }
        }
        vx += sx * 90; vy += sy * 90;
        a.vx = vx; a.vy = vy;
        a.x += vx * dt; a.y += vy * dt;
        if (vx * vx + vy * vy > 25 && a.state === 'move') a.dir = Math.atan2(vy, vx);
        else if (a.state === 'attack') a.dir = Math.atan2(dy, dx);
      }
    }
  }
  function demoDrawUnder(world, r, A) {
    const D = world.structureSys.demo;
    if (!terr(world)) {
      const m = world.map, tile = 1100;
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: A.ground, uv: [0, 0, m.w / tile, m.h / tile] });
      r.quad(0, 0, m.w, m.h, 'rgba(8,6,12,0.45)', { layer: 'ground', tex: A.ground, uv: [0.31, 0.57, 0.31 + m.w / 3000, 0.57 + m.h / 3000] });
      // creep that stays under captured bases (terrain owns creep when it runs)
      for (const s of world.structures) if (s.kind === 'base') r.quad(s.x, s.y, 520, 480, '#4a1838', { layer: 'ground', tex: A.cloud, center: true, alpha: 0.45, rot: s.phase });
    }
    if (D.stubSwarm) for (const p of D.splats) spr(r, A, 'stain', p.x, p.y, 0.32 * p.s, { layer: 'decal', col: 'rgba(200,40,90,0.75)', rot: p.rot });
  }
  function demoDrawOver(world, r, A) {
    const D = world.structureSys.demo, S = world.structureSys;
    if (D.stubSwarm) {
      const al = world.aliens.slice().sort((a, b) => a.y - b.y || a.id - b.id), o = { layer: 'unit' };
      for (const a of al) {
        const sh = IP.assets.sheet(a.sheet); if (!sh) continue;
        const f = a.anim === 'attack' ? sh.frame(IP.dirIndex(a.dir), 'attack', ((world.tick + a.phase) / 6) % 4 | 0) : sh.frame(IP.dirIndex(a.dir), 'walk', ((world.tick + a.phase) / 5) | 0);
        r.sprite(sh, f, a.x, a.y, o);
      }
    }
    if (D.stubMarines) {
      const ring = { layer: 'shadow', width: 3 }, fill = { layer: 'shadow' }, so = { layer: 'unit' };
      for (const m of world.marines) {
        r.circle(m.x, m.y, 24, 'rgba(60,170,160,0.28)', fill);
        r.circle(m.x, m.y, 24, '#ff5a6e', ring);
        const sh = IP.assets.sheet(m.sheet);
        if (sh) r.sprite(sh, sh.frame(IP.dirIndex(m.dir), 'idle', 0), m.x, m.y + 6, so);
        else r.circle(m.x, m.y, 9, '#7fd0c8', so);
      }
    }
    for (const tr of S.tracers) r.line(tr.x, tr.y, tr.tx, tr.ty, 2.5, 'rgba(255,230,140,0.95)', { layer: 'fx', add: true, dash: [6, 5] });
  }

  // =================================================================== scenario
  // Two live hives (left), one hive captured into a base (right) with its six nodes, a turret on a node, a barricade
  // across the lane, and a stub squad as the target. Uses terrain/swarm/marines when they run, stubs otherwise.
  const demo = (biome) => async (world) => {
    const W = 2600, H = 1500;
    world.map = { w: W, h: H };
    const S = sys(world);
    if (on(world, 'terrain') && IP.terrain && IP.terrain.generate) {
      const keep = [[380, 330, 230], [470, 980, 230], [1560, 470, 200], [1250, 575, 140], [1450, 740, 170], [900, 650, 260]].map(([x, y, r]) => ({ x, y, r }));
      IP.terrain.generate(world, {
        biome, w: W, h: H, seed: world.seed, keepClear: keep,
        masses: [
          { x: 1080, y: 40, rx: 360, ry: 150, rot: 0.15 }, { x: 2080, y: 1180, rx: 300, ry: 210, rot: -0.5 },
          { x: 1020, y: 1360, rx: 300, ry: 130, rot: 0.1 }, { x: 2050, y: 160, rx: 120, ry: 110, kind: 'crater' },
          { x: -40, y: 650, rx: 140, ry: 190, rot: 0.3 },
        ],
      });
    }
    world.camera = { x: 1080, y: 660, zoom: 1 };
    world.bp = 3;
    const D = (S.demo = { rng: IP.fork(world, 'structures-demo'), alienId: 1, splats: [], stubSwarm: !on(world, 'swarm'), stubMarines: !on(world, 'marines') });
    if (D.stubSwarm) for (const k of ['bug_drone', 'bug_drone_v1', 'bug_drone_v2', 'bug_runner']) IP.assets.load(k).catch(() => null);
    const h1 = add(world, 'hive', 380, 330, { spawn: { kinds: ['drone', 'drone', 'runner'], rate: 18, burst: 6 } });
    const h2 = add(world, 'hive', 470, 980, { spawn: { kinds: ['drone'], rate: 15, burst: 6 } });
    h1.bornT = h2.bornT = -10;
    h1.creepR = 340; h2.creepR = 280;
    const T = terr(world);
    if (T && T.growCreep) for (const h of [h1, h2]) { T.growCreep(world, h.x, h.y, h.creepR); h.creepGrown = true; }
    // the third hive is a live spawner, but the squad starts on it: spawning is suppressed and it captures by presence
    const cap = add(world, 'hive', 1560, 470, { spawn: { kinds: ['drone', 'runner'], rate: 8, burst: 4 } });
    cap.bornT = -10; cap.creepR = 200;
    if (T && T.growCreep) { T.growCreep(world, cap.x, cap.y, cap.creepR); cap.creepGrown = true; }
    D.capId = cap.id; D.step = 0;
    // stub squad (DESIGN.md marine shape) so the swarm has a target
    const squad = [['rifle_a', 'RIFLE', 'rifle'], ['sniper', 'SNIPER', 'sniper'], ['fusion', 'FUSION', 'fusion'], ['rifle_b', 'RIFLE', 'rifle'], ['medic', 'MEDIC', 'medic']];
    const pos = [110, 150, 180, 210, 70].map((d) => [Math.round(cap.x + Math.cos(d * D2R) * 100), Math.round(cap.y + Math.sin(d * D2R) * 100)]);
    squad.forEach(([sheet, name, cls], i) => {
      world.marines.push({ id: i + 1, name, cls, x: pos[i][0], y: pos[i][1], r: 14, dir: Math.PI * 1.1, hp: 100, maxHp: 100, state: 'idle', order: null,
        weapon: { kind: cls, range: 260, dps: 30, cooldown: 0.2, ammo: 100, maxAmmo: 100 }, sheet, anim: 'idle', frame: 0, selected: false, stub: true });
      if (D.stubMarines) IP.assets.load(sheet).catch(() => null);
    });
    // pre-warm the streams so the first frames already show the swarm pouring out
    for (const h of [h1, h2]) for (let k = 0; k < 5; k++) swarmSpawn(world, h.x + 50 + k * 70, h.y + 20 + k * (h.y < 600 ? 40 : -50), 'drone', 12);
  };
  IP.scenario('structures-demo', demo('basalt'), { systems: ['terrain', 'swarm', 'structures'] });
  IP.scenario('structures-demo-bog', demo('bog'), { systems: ['terrain', 'swarm', 'structures'] });
})();
