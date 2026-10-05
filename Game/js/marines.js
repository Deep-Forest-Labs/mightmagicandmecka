// Infested Planet Gauntlet: the marine squad (owner: marines piece).
// Five marines: selection (click / shift-click / drag box / 1-5 / Space,F2 / double-click; the same Digit or Space twice
// centres the camera), orders (right-click or touch long-press = move; with KeyA armed/held, world.flags.attackMove or
// the HUD toggle = attack-move; KeyH = hold; KeyR or the HUD 'retreat'/'regroup' button = retreat toward the nearest
// player base while firing; game.js owns that button when it runs), steering (terrain flow field, one route per order
// group, loose cluster with a hard minimum spacing), auto-targeting (aliens first, then hives so the squad can break
// them; the sniper picks the biggest alien in range), weapons (rifle, piercing sniper, fusion cone, medic heals by
// priority and seeks hurt squadmates, rocket), shared ammo (drain per shot, 35% fire rate when dry, refill near a base),
// HP/death ('marine-died'), and crisp UI overlays (segmented hp ring on selected marines, dotted/chevron order lines,
// order pings). Registers IP.marines (API for other systems) and the marines-demo / marines-route / marines-feel scenarios.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ tuning (data)
  // Squad order = HUD card order on the bar (ip_01): SNIPER, RIFLE, FUSION, RIFLE, MEDIC. Digit1..5 follow it.
  const SQUAD = [
    { sheet: 'sniper', cls: 'sniper', name: 'SNIPER', callsign: 'Kell "Deadeye"' },
    { sheet: 'rifle_a', cls: 'rifle', name: 'RIFLE', callsign: 'Pvt. Brandt "Hammer"' },
    { sheet: 'fusion', cls: 'fusion', name: 'FUSION', callsign: 'Cpl. Magnus "Furnace"' },
    { sheet: 'rifle_b', cls: 'rifle', name: 'RIFLE', callsign: 'Pvt. Muller "Lucky"' },
    { sheet: 'medic', cls: 'medic', name: 'MEDIC', callsign: 'Sgt. Tamsin "Grit"' },
  ];
  const DEFAULT_SHEET = { rifle: 'rifle_a', sniper: 'sniper', fusion: 'fusion', medic: 'medic', rocket: 'rifle_b' };
  // dmg is per shot (fusion: per second). cooldown in seconds. drain = ammo fraction (0..1 shared) per shot / per second.
  const WEAPONS = {
    rifle: { kind: 'rifle', range: 300, dmg: 5, cooldown: 1 / 7, spread: 0.07, accuracy: 0.9, drain: 0.0009, muzzle: 22 },
    sniper: { kind: 'sniper', range: 560, dmg: 70, cooldown: 1.15, pierce: 2, width: 7, drain: 0.004, muzzle: 34 },
    fusion: { kind: 'fusion', range: 150, dmg: 85, cooldown: 0.1, cone: 0.42, drain: 0.02, muzzle: 20 },
    medic: { kind: 'medic', range: 240, dmg: 6, cooldown: 0.45, spread: 0.05, accuracy: 0.85, drain: 0.0006, muzzle: 18, healRange: 170, hps: 14 },
    rocket: { kind: 'rocket', range: 380, dmg: 45, cooldown: 1.6, splash: 64, speed: 520, drain: 0.006, muzzle: 22 },
  };
  const CLS = {
    rifle: { maxHp: 100, speed: 104 },
    sniper: { maxHp: 80, speed: 96 },
    fusion: { maxHp: 130, speed: 92 },
    medic: { maxHp: 90, speed: 108 },
    rocket: { maxHp: 100, speed: 96 },
  };
  const T = {
    r: 16,               // collision radius; click hit test is r + 8
    ringR: 29,           // selection ring outer radius: the sprite body (~38 px) sits inside it with a little air
    ringBand: 4,         // crisp UI band (1 px dark outline either side), one segment per ~8% hp
    spawnR: 66,          // spawn pentagon radius: ground between neighbouring rings
    slotMin: 68,         // order slots never closer than this (rings never touch at the destination)
    ringSegs: 12,
    sepDist: 64,         // marines push apart inside this distance (loose cluster, not a conga line)
    sepK: 260,
    coreDist: 46,        // hard minimum spacing between marine centres (rings never overlap)
    coreK: 700,
    accel: 1600,         // snappy: full speed in ~4 ticks, first visible step on the order's own tick
    turn: 13,            // rad/s
    arrive: 8,
    ammoEmptyRate: 0.35, // fire-rate multiplier when the shared ammo is empty
    ammoRegen: 0.012,    // per second while not firing
    ammoBaseRegen: 0.22, // per second near a player base
    baseRange: 300,
    dblClick: 0.35,
    retarget: 0.2,
    engage: 250,         // attack-move: the whole group halts when any member has a target this close (inside rifle range)
    groupFar: 120,       // a marine this far from its order group's centroid steers purely by the centroid's flow
    groupBlend: 0.7,     // otherwise: 0.7 centroid flow + 0.3 own flow (one route for the whole squad)
    groupPull: 90,       // beyond this distance from the centroid a marine also drifts back toward the group
    catchUp: 0.18,       // +-18% speed to hold formation along the route (behind speeds up, ahead slows)
    wallPad: 18,         // marines steer to keep their centre this far from impassable terrain while moving
    wallK: 7,            // push strength (px/s per px inside wallPad)
    fuseEmit: 6,         // fusion 'shot' event every N ticks (full ammo)
    fuseEmitDry: 17,     // ... and every N ticks when the shared ammo is empty (~35% of the cadence)
    retreatSpeed: 1.12,  // retreat runs a little faster than a move (still firing over the shoulder)
    retreatPad: 78,      // retreat point: this far outside the base's rim, on the squad's side
    medicSeek: 520,      // an idle medic walks toward a hurt squadmate (< medicSeekHp) within this distance
    medicSeekHp: 0.8,
    healShot: 0.32,      // a medic 'shot' (vfx crosses) toward the patient every N seconds
    hiveMinR: 40,        // marines shoot alien structures (hives) when no alien is in range
    pingLife: 0.45,      // order ping (expanding ring at the click) lifetime
    dblKey: 0.35,        // same Digit / Space twice within this: centre the camera on the selection
  };

  // ------------------------------------------------------------------ helpers
  const has = (world, name) => world.systems && world.systems.some((s) => s.name === name);
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
  const alive = (m) => m && m.state !== 'dead';
  const alienAlive = (a) => a && a.state !== 'dead' && !a.dead && !(a.hp <= 0);
  const STRUCT = { hive: 1, base: 1, node: 1, turret: 1, barricade: 1 };
  const isStruct = (t) => !!(t && t.owner && STRUCT[t.kind]);
  function shiftHeld() { const k = IP.input.keys; return k.has('ShiftLeft') || k.has('ShiftRight'); }
  function St(world) { return world.marinesSys; }
  function passable(world, x, y) {
    const S = St(world);
    if (!S || !S.hasTerrain || !IP.terrain || typeof IP.terrain.passable !== 'function') return true;
    try { return IP.terrain.passable(world, x, y) !== false; } catch (e) { return true; }
  }
  // IP.terrain.flowTo(world, x, y) shape is not pinned down yet: accept a function(x,y), or an object with
  // dir/sample/at(x,y); each may return [dx,dy], {x,y}, {dx,dy} or an angle. Returns a unit vector or null.
  function flowDir(f, x, y) {
    if (!f) return null;
    let v = null;
    try {
      if (typeof f === 'function') v = f(x, y);
      else if (typeof f.dir === 'function') v = f.dir(x, y);
      else if (typeof f.sample === 'function') v = f.sample(x, y);
      else if (typeof f.at === 'function') v = f.at(x, y);
    } catch (e) { return null; }
    if (v == null) return null;
    let vx, vy;
    if (typeof v === 'number') { if (!isFinite(v)) return null; vx = Math.cos(v); vy = Math.sin(v); }
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) { vx = v[0]; vy = v[1]; }
    else { vx = v.x != null ? v.x : v.dx; vy = v.y != null ? v.y : v.dy; }
    if (!isFinite(vx) || !isFinite(vy)) return null;
    const l = Math.hypot(vx, vy);
    return l > 1e-6 ? [vx / l, vy / l] : null;
  }

  function weaponFor(cls) {
    const w = WEAPONS[cls] || WEAPONS.rifle;
    const dps = w.kind === 'fusion' ? w.dmg : w.dmg / w.cooldown;
    return { kind: w.kind, range: w.range, dps: Math.round(dps * 10) / 10, cooldown: w.cooldown, ammo: 1, maxAmmo: 1 };
  }

  // Lazily attach the private per-marine state (marines made by other systems following the contract still work).
  function ensure(m) {
    if (m._k) return m._k;
    if (!m.cls) m.cls = 'rifle';
    if (!m.weapon) m.weapon = weaponFor(m.cls);
    if (!m.sheet) m.sheet = DEFAULT_SHEET[m.cls] || 'rifle_a';
    const c = CLS[m.cls] || CLS.rifle;
    if (m.maxHp == null) m.maxHp = c.maxHp;
    if (m.hp == null) m.hp = m.maxHp;
    if (m.r == null) m.r = T.r;
    if (m.dir == null) m.dir = -Math.PI / 2;
    if (!m.state) m.state = 'idle';
    if (m.order === undefined) m.order = null;
    if (!m.anim) { m.anim = 'idle'; m.frame = 0; }
    if (m.selected == null) m.selected = false;
    m._k = { vx: 0, vy: 0, cd: 0, atkT: 9, walk: 0, target: null, retarget: 0, aim: m.dir, fuseEmit: 0, healT: 0,
      healGlow: 0, speed: c.speed, firing: false, lastShotT: -9, deadT: 0, healShotT: 0, patient: null, orderT: -9 };
    if (IP.assets && !IP.assets.sheet(m.sheet)) IP.assets.load(m.sheet);
    return m._k;
  }

  // ------------------------------------------------------------------ public API
  const API = (IP.marines = {
    SQUAD, WEAPONS, CLS, T,
    // Five marines in a loose cluster around (x, y). Returns the array of marines added.
    spawnSquad(world, x, y, opts) {
      opts = opts || {};
      const out = [];
      const list = opts.squad || SQUAD;
      for (let i = 0; i < list.length && world.marines.length < 5; i++) {
        const d = list[i];
        const a = (i / list.length) * TAU - Math.PI / 2, rad = list.length > 1 ? T.spawnR : 0;
        let px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
        if (!passable(world, px, py)) { const p = API.findPassable(world, px, py); px = p.x; py = p.y; }
        const c = CLS[d.cls] || CLS.rifle;
        const m = {
          id: world.marines.length + 1, name: d.name, callsign: d.callsign, cls: d.cls, x: px, y: py, r: T.r,
          dir: opts.dir != null ? opts.dir : -Math.PI / 2, hp: c.maxHp, maxHp: c.maxHp, state: 'idle', order: null,
          weapon: weaponFor(d.cls), sheet: d.sheet, anim: 'idle', frame: 0, selected: false,
        };
        ensure(m);
        world.marines.push(m);
        out.push(m);
        if (opts.select !== false) { world.selection.add(m.id); m.selected = true; }
      }
      if (world.ammo == null) world.ammo = 1;
      const S = St(world);
      if (S && !S.home && out.length) S.home = { x, y };
      return out;
    },
    findPassable(world, x, y) {
      if (passable(world, x, y)) return { x, y };
      for (let r = 12; r < 400; r += 12) for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (passable(world, px, py)) return { x: px, y: py };
      }
      return { x, y };
    },
    alive: (world) => world.marines.filter(alive),
    // nearest living marine to (x, y) (optionally within maxDist), or null
    nearest(world, x, y, maxDist) {
      let best = null, bd = maxDist != null ? maxDist * maxDist : Infinity;
      for (const m of world.marines) {
        if (!alive(m)) continue;
        const dx = m.x - x, dy = m.y - y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    },
    hitTest(world, wx, wy) {
      let best = null, bd = Infinity;
      for (const m of world.marines) {
        if (!alive(m)) continue;
        const rr = (m.r || T.r) + 8, d = Math.hypot(m.x - wx, m.y - wy);
        if (d <= rr && d < bd) { bd = d; best = m; }
      }
      return best;
    },
    select(world, ids, add) {
      if (!add) world.selection.clear();
      const want = ids === 'all' ? world.marines.filter(alive).map((m) => m.id) : [].concat(ids);
      for (const id of want) { const m = world.marines.find((q) => q.id === id); if (alive(m)) world.selection.add(id); }
      syncSel(world);
    },
    selected: (world) => world.marines.filter((m) => alive(m) && world.selection.has(m.id)),
    // order(world, 'move'|'attack-move'|'hold', x, y, marines?) — defaults to the current selection
    order(world, type, x, y, list) { return issueOrder(world, x, y, type, list); },
    // other systems can hurt a marine through this (or just subtract hp; death is checked every tick)
    damage(world, m, dmg, cause) {
      if (!alive(m)) return;
      m.hp -= dmg;
      IP.emit(world, 'hit', { x: m.x, y: m.y, dmg, targetKind: 'marine', cause });
      if (m.hp <= 0) die(world, m, cause);
    },
    // retreat: the squad (or the given marines) backs toward the nearest player base while firing
    retreat(world, list) { return retreat(world, list); },
    retreatPoint(world, list) { return retreatPoint(world, (list || world.marines).filter(alive)); },
    armAttackMove(world, on) { const S = St(world); if (S) S.armed = on !== false; },
    isArmed: (world) => !!(St(world) && St(world).armed),
  });

  function syncSel(world) {
    for (const m of world.marines) {
      if (!alive(m)) { if (world.selection.has(m.id)) world.selection.delete(m.id); m.selected = false; continue; }
      m.selected = world.selection.has(m.id);
    }
  }

  // ------------------------------------------------------------------ orders
  function issueOrder(world, x, y, type, list) {
    const S = St(world);
    if (!type) type = (S && (S.armed || S.aHeld)) || world.flags.attackMove || IP.input.keys.has('KeyA') ? 'attack-move' : 'move';
    if (S) S.armed = false;
    const ms = (list || API.selected(world)).filter(alive);
    if (!ms.length) return null;
    if (type === 'hold') {
      for (const m of ms) { m.order = { type: 'hold', x: m.x, y: m.y }; m.state = 'idle'; }
      IP.emit(world, 'order', { order: 'hold', x: ms[0].x, y: ms[0].y }); // 'order' (not 'type': IP.emit would let it overwrite the event type)
      return ms;
    }
    if (type === 'retreat' && (x == null || y == null)) { const p = retreatPoint(world, ms); x = p.x; y = p.y; }
    if (!passable(world, x, y)) { const p = API.findPassable(world, x, y); x = p.x; y = p.y; }
    let flow = null;
    if (S && S.hasTerrain && IP.terrain && typeof IP.terrain.flowTo === 'function') {
      try { flow = IP.terrain.flowTo(world, x, y); } catch (e) { flow = null; }
    }
    // slots: keep the squad's relative layout, compressed into a loose cluster around the click
    let cx = 0, cy = 0;
    for (const m of ms) { cx += m.x; cy += m.y; }
    cx /= ms.length; cy /= ms.length;
    let R = 0;
    for (const m of ms) R = Math.max(R, Math.hypot(m.x - cx, m.y - cy));
    const maxR = ms.length > 1 ? 22 + 17 * Math.sqrt(ms.length) : 0;
    const k = R > maxR ? maxR / R : 1;
    const offs = ms.map((m, i) => {
      if (R < 6 && ms.length > 1) { const a = (i / ms.length) * TAU - Math.PI / 2; return [Math.cos(a) * T.spawnR, Math.sin(a) * T.spawnR]; }
      return [(m.x - cx) * k, (m.y - cy) * k];
    });
    // keep slots at least T.slotMin apart so the rings sit with ground between them at the destination
    let dmin = Infinity;
    for (let i = 0; i < offs.length; i++) for (let j = i + 1; j < offs.length; j++) dmin = Math.min(dmin, Math.hypot(offs[i][0] - offs[j][0], offs[i][1] - offs[j][1]));
    if (dmin > 1 && dmin < T.slotMin) { const g = Math.min(2.5, T.slotMin / dmin); for (const o of offs) { o[0] *= g; o[1] *= g; } }
    const gid = S ? ++S.orderSeq : 0;
    ms.forEach((m, i) => {
      let sx = x + offs[i][0], sy = y + offs[i][1];
      if (!passable(world, sx, sy)) { const p = API.findPassable(world, sx, sy); sx = p.x; sy = p.y; }
      m.order = { type, x: sx, y: sy, gx: x, gy: y, flow, t: world.time, gid };
      m.state = 'move';
      m._k.orderT = world.time;
    });
    if (S) { S.pings.push({ x, y, t: world.time, type }); if (S.pings.length > 8) S.pings.shift(); }
    IP.emit(world, 'order', { order: type, x, y });
    return ms;
  }

  // Where a retreat goes: just outside the nearest live player base (on the squad's side of it); else the squad's
  // spawn point; else straight away from the nearest aliens.
  function retreatPoint(world, ms) {
    let cx = 0, cy = 0;
    for (const m of ms) { cx += m.x; cy += m.y; }
    if (ms.length) { cx /= ms.length; cy /= ms.length; }
    let best = null, bd = Infinity;
    for (const s of world.structures || []) {
      if (s.kind !== 'base' || s.owner === 'alien' || s.dead || s.state === 'dead' || !(s.hp > 0 || s.hp == null)) continue;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      const pad = (best.r || 50) + T.retreatPad;
      if (bd < pad) return { x: cx, y: cy, base: best };
      return { x: best.x + ((cx - best.x) / bd) * pad, y: best.y + ((cy - best.y) / bd) * pad, base: best };
    }
    const S = St(world);
    if (S && S.home && Math.hypot(S.home.x - cx, S.home.y - cy) > 60) return { x: S.home.x, y: S.home.y };
    // no base, no home: back off 360 px from the nearest alien
    const a = ms.length ? findTarget(world, { x: cx, y: cy }, 700, true) : null;
    if (a) { const d = Math.hypot(cx - a.x, cy - a.y) || 1; return { x: cx + ((cx - a.x) / d) * 360, y: cy + ((cy - a.y) / d) * 360 }; }
    return { x: cx, y: cy };
  }
  function retreat(world, list) {
    const ms = (list || world.marines).filter(alive);
    if (!ms.length) return null;
    const p = retreatPoint(world, ms);
    return issueOrder(world, p.x, p.y, 'retreat', ms);
  }

  // ------------------------------------------------------------------ targeting + weapons
  // Nearest live alien within range (the sniper prefers the biggest one in range: brutes and tanks first). When no
  // alien is in range, the nearest alien structure (hive) within range, so the squad can break hives (capture loop).
  function findTarget(world, m, range, aliensOnly) {
    const S = St(world);
    let best = null;
    if (m.cls === 'sniper' && S.hasSwarm && IP.swarm && typeof IP.swarm.inRadius === 'function') {
      let bs = -Infinity;
      try {
        IP.swarm.inRadius(world, m.x, m.y, range, (a) => {
          if (!alienAlive(a)) return false;
          const sc = (a.maxHp || a.hp || 1) * 4 - Math.hypot(a.x - m.x, a.y - m.y) * 0.05;
          if (sc > bs) { bs = sc; best = a; }
          return false;
        });
      } catch (e) { best = null; }
      if (best) return best;
    } else if (S.hasSwarm && IP.swarm && typeof IP.swarm.nearest === 'function') {
      try {
        const a = IP.swarm.nearest(world, m.x, m.y, range);
        if (a && alienAlive(a) && Math.hypot(a.x - m.x, a.y - m.y) <= range + (a.r || 0)) best = a;
      } catch (e) { best = scanAliens(world, m, range); }
    } else best = scanAliens(world, m, range);
    if (best || aliensOnly) return best;
    if (S.hasStructures && IP.structures && typeof IP.structures.nearestEnemy === 'function') {
      try {
        const st = IP.structures.nearestEnemy(world, m.x, m.y, { range, aliens: false });
        if (st && alienAlive(st)) return st;
      } catch (e) { /* no structures */ }
    }
    return null;
  }
  function scanAliens(world, m, range) {
    const al = world.aliens;
    if (!al || typeof al.length !== 'number') return null;
    let best = null, bd = (range + 10) * (range + 10), big = m.cls === 'sniper';
    for (let i = 0; i < al.length; i++) {
      const a = al[i];
      if (!alienAlive(a)) continue;
      const dx = a.x - m.x, dy = a.y - m.y, rr = range + (a.r || 0);
      let d = dx * dx + dy * dy;
      if (d > rr * rr) continue;
      if (big) d /= (a.maxHp || 1);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function hurtAlien(world, a, dmg, weapon) {
    const S = St(world);
    if (isStruct(a)) {
      if (IP.structures && typeof IP.structures.damage === 'function') IP.structures.damage(world, a, dmg);
      else { a.hp -= dmg; IP.emit(world, 'hit', { x: a.x, y: a.y, dmg, targetKind: 'structure', weapon }); }
      return;
    }
    if (S.hasSwarm && IP.swarm && typeof IP.swarm.damage === 'function') { IP.swarm.damage(world, a, dmg, weapon); return; }
    a.hp -= dmg;
    a.hitT = world.time;
    IP.emit(world, 'hit', { x: a.x, y: a.y, dmg, targetKind: 'alien', weapon });
  }
  function shot(world, m, tx, ty, weapon, hit) {
    const S = St(world), W = WEAPONS[weapon] || WEAPONS.rifle;
    const a = m._k.aim, mx = m.x + Math.cos(a) * W.muzzle, my = m.y + Math.sin(a) * W.muzzle;
    // the medic's sidearm reads as a (light) rifle tracer; 'medic' shots are the heal crosses (see heal)
    if (weapon === 'medic') weapon = 'rifle';
    IP.emit(world, 'shot', { x: mx, y: my, tx, ty, weapon, hit, id: m.id, cls: m.cls });
    if (!S.hasVfx) { const L = weapon === 'sniper' ? 0.3 : weapon === 'fusion' ? 0.14 : 0.13; S.fx.push({ kind: weapon, x: mx, y: my, tx, ty, life: L, max: L }); }
  }
  function fire(world, m, tgt) {
    const S = St(world), K = m._k, W = WEAPONS[m.weapon.kind] || WEAPONS.rifle, rng = S.rng;
    const ang = K.aim;
    const rate = world.ammo > 0 ? 1 : T.ammoEmptyRate;
    K.atkT = 0; K.lastShotT = world.time;
    if (W.kind === 'rifle' || W.kind === 'medic') {
      const d = Math.hypot(tgt.x - m.x, tgt.y - m.y);
      const hit = rng() < W.accuracy;
      let tx = tgt.x, ty = tgt.y;
      if (!hit) { const e = ang + (rng() - 0.5) * W.spread * 4, L = d + 30 + rng() * 60; tx = m.x + Math.cos(e) * L; ty = m.y + Math.sin(e) * L; }
      else { tx += (rng() - 0.5) * (tgt.r || 6); ty += (rng() - 0.5) * (tgt.r || 6); hurtAlien(world, tgt, W.dmg, W.kind); }
      shot(world, m, tx, ty, W.kind, hit);
      K.cd = W.cooldown / rate;
      world.ammo = Math.max(0, world.ammo - W.drain);
    } else if (W.kind === 'sniper') {
      // pierce: the first alien plus up to W.pierce more along the ray
      const ux = Math.cos(ang), uy = Math.sin(ang), hits = [];
      const al = world.aliens;
      for (let i = 0; i < al.length; i++) {
        const a = al[i];
        if (!alienAlive(a)) continue;
        const dx = a.x - m.x, dy = a.y - m.y, t = dx * ux + dy * uy;
        if (t < 0 || t > W.range + 20) continue;
        const perp = Math.abs(dx * uy - dy * ux);
        if (perp <= W.width + (a.r || 6)) hits.push([t, a]);
      }
      if (!hits.some((h) => h[1] === tgt)) hits.push([Math.hypot(tgt.x - m.x, tgt.y - m.y), tgt]);
      hits.sort((p, q) => p[0] - q[0]);
      const n = Math.min(hits.length, 1 + W.pierce);
      for (let i = 0; i < n; i++) hurtAlien(world, hits[i][1], W.dmg, 'sniper');
      const L = n ? hits[n - 1][0] + 6 : W.range;
      shot(world, m, m.x + ux * L, m.y + uy * L, 'sniper', n > 0);
      K.cd = W.cooldown / rate;
      world.ammo = Math.max(0, world.ammo - W.drain);
    } else if (W.kind === 'rocket') {
      const sp = W.speed, ux = Math.cos(ang), uy = Math.sin(ang);
      const d = Math.hypot(tgt.x - m.x, tgt.y - m.y);
      world.projectiles.push({ kind: 'rocket', x: m.x + ux * W.muzzle, y: m.y + uy * W.muzzle, vx: ux * sp, vy: uy * sp, dmg: W.dmg, ttl: d / sp, owner: 'marines', splash: W.splash, src: m.id });
      shot(world, m, tgt.x, tgt.y, 'rocket', true);
      K.cd = W.cooldown / rate;
      world.ammo = Math.max(0, world.ammo - W.drain);
    }
  }
  // fusion: continuous cone damage every tick; a 'shot' event every 6 ticks so vfx can paint blobs
  function fuse(world, m, tgt, dt) {
    const S = St(world), K = m._k, W = WEAPONS.fusion;
    const rate = world.ammo > 0 ? 1 : T.ammoEmptyRate;
    const dmg = W.dmg * dt * rate, ang = K.aim;
    const burn = (a) => {
      if (!alienAlive(a)) return false;
      const dx = a.x - m.x, dy = a.y - m.y, d = Math.hypot(dx, dy);
      if (d > W.range + (a.r || 0)) return false;
      if (d > 12 && Math.abs(angDiff(ang, Math.atan2(dy, dx))) > W.cone) return false;
      hurtAlien(world, a, dmg, 'fusion');
      return false;
    };
    if (S.hasSwarm && IP.swarm && typeof IP.swarm.inRadius === 'function') IP.swarm.inRadius(world, m.x, m.y, W.range + 14, burn);
    else { const al = world.aliens; for (let i = al.length - 1; i >= 0; i--) burn(al[i]); }
    if (isStruct(tgt)) hurtAlien(world, tgt, dmg, 'fusion');
    world.ammo = Math.max(0, world.ammo - W.drain * dt);
    K.lastShotT = world.time;
    if (--K.fuseEmit <= 0) {
      K.fuseEmit = world.ammo > 0 ? T.fuseEmit : T.fuseEmitDry; K.atkT = 0;
      const L = Math.min(W.range, Math.hypot(tgt.x - m.x, tgt.y - m.y));
      const e = ang + (S.rng() - 0.5) * W.cone;
      shot(world, m, m.x + Math.cos(e) * L, m.y + Math.sin(e) * L, 'fusion', true);
    }
  }
  // Medic: the patient is the most hurt living marine within healRange (the medic itself counts as 20% healthier,
  // so it treats others first). Healing has priority over shooting (see updateMarine).
  function pickPatient(world, m) {
    const W = WEAPONS.medic;
    let best = null, bf = 1;
    for (const o of world.marines) {
      if (!alive(o) || o.hp >= o.maxHp) continue;
      if (Math.hypot(o.x - m.x, o.y - m.y) > W.healRange) continue;
      const f = o.hp / o.maxHp + (o === m ? 0.2 : 0);
      if (f < bf) { bf = f; best = o; }
    }
    return best;
  }
  // someone hurt but out of heal range: the idle medic walks over
  function seekPatient(world, m) {
    let best = null, bs = Infinity;
    for (const o of world.marines) {
      if (o === m || !alive(o) || o.hp >= o.maxHp * T.medicSeekHp) continue;
      const d = Math.hypot(o.x - m.x, o.y - m.y);
      if (d > T.medicSeek || d <= WEAPONS.medic.healRange * 0.8) continue;
      const sc = d * (0.5 + o.hp / o.maxHp);
      if (sc < bs) { bs = sc; best = o; }
    }
    return best;
  }
  function heal(world, m, p, dt) {
    const W = WEAPONS.medic, K = m._k;
    p.hp = Math.min(p.maxHp, p.hp + W.hps * dt * (p === m ? 0.5 : 1));
    if (p._k) p._k.healGlow = 0.45;
    K.healingT = world.time;
    if ((K.healShotT -= dt) <= 0) {
      K.healShotT = T.healShot;
      const a = K.aim;
      IP.emit(world, 'shot', { x: m.x + Math.cos(a) * W.muzzle, y: m.y + Math.sin(a) * W.muzzle, tx: p.x, ty: p.y, weapon: 'medic', hit: true, id: m.id, heal: true });
      IP.emit(world, 'heal', { x: m.x, y: m.y, tx: p.x, ty: p.y, id: p.id, amt: W.hps * T.healShot });
    }
  }

  function die(world, m, cause) {
    if (m.state === 'dead') return;
    m.state = 'dead'; m.hp = 0; m.order = null; m.selected = false; m.anim = 'idle';
    world.selection.delete(m.id);
    if (m._k) m._k.deadT = world.time;
    IP.emit(world, 'marine-died', { x: m.x, y: m.y, name: m.name, id: m.id, cause });
  }

  // ------------------------------------------------------------------ per-tick
  function updateMarine(world, m, dt) {
    const S = St(world), K = m._k;
    if (m.hp <= 0) { die(world, m); return; }
    const W = WEAPONS[m.weapon.kind] || WEAPONS.rifle;
    const range = m.weapon.range || W.range;
    // target: keep a valid one in range, rescan periodically for the nearest
    K.retarget -= dt;
    let tgt = K.target;
    if (tgt && (!alienAlive(tgt) || Math.hypot(tgt.x - m.x, tgt.y - m.y) > range + (tgt.r || 0) + 12 ||
      (!isStruct(tgt) && world.aliens.indexOf && K.retarget <= 0 && world.aliens.indexOf(tgt) < 0))) tgt = null;
    if (!tgt || K.retarget <= 0) { tgt = findTarget(world, m, range); K.retarget = T.retarget; }
    K.target = tgt;
    m.targetId = tgt ? tgt.id : null;

    const patient = m.cls === 'medic' ? pickPatient(world, m) : null;

    // movement
    const o = m.order;
    const G = o && o.gid ? S.groups.get(o.gid) : null;
    let dvx = 0, dvy = 0, wantMove = false;
    if (!o && m.cls === 'medic' && !patient) {
      // auto-heal: an idle medic walks toward a hurt squadmate out of heal range
      const q = seekPatient(world, m);
      if (q) { const dx = q.x - m.x, dy = q.y - m.y, d = Math.hypot(dx, dy) || 1; dvx = (dx / d) * K.speed; dvy = (dy / d) * K.speed; wantMove = true; }
    }
    if (o && o.type !== 'hold') {
      const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy);
      let crowded = false;
      if (d < 30) for (const q of world.marines) if (q !== m && alive(q) && !q.order && Math.hypot(q.x - o.x, q.y - o.y) < 22) { crowded = true; break; }
      if (d < T.arrive || (crowded && d < 30) || (d < 26 && world.time - o.t > 0.5 && Math.hypot(K.vx, K.vy) < 12)) {
        m.order = null;
      } else if (o.type === 'attack-move' && ((G && G.engaged) || (tgt && Math.hypot(tgt.x - m.x, tgt.y - m.y) <= T.engage + (tgt.r || 0)))) {
        // stand and fight: the whole order group halts while any member has something within T.engage (long guns
        // still fire on the move until then); it resumes the march the tick the group is clear
      } else {
        let dir = null, sp = K.speed;
        if (o.flow && Math.hypot(o.gx - m.x, o.gy - m.y) > 70) {
          // one route for the whole order group: steer by the flow sampled at the group's centroid (blended with
          // the marine's own sample when it is close to the group), so a rock on the path never splits the squad
          const own = flowDir(o.flow, m.x, m.y);
          if (G && G.n > 1 && G.dir) {
            const far = Math.hypot(G.cx - m.x, G.cy - m.y) > T.groupFar;
            const w = far || !own ? 1 : T.groupBlend;
            let vx = G.dir[0] * w + (own ? own[0] * (1 - w) : 0), vy = G.dir[1] * w + (own ? own[1] * (1 - w) : 0);
            // the centroid's direction must not drive this marine straight into rock: fall back to its own sample
            // drift back toward the group when strung out (never into rock)
            const gdx = G.cx - m.x, gdy = G.cy - m.y, gd = Math.hypot(gdx, gdy);
            if (gd > T.groupPull) { const c = Math.min(0.6, (gd - T.groupPull) / 120); vx += (gdx / gd) * c; vy += (gdy / gd) * c; }
            const l = Math.hypot(vx, vy);
            if (l > 1e-3) { vx /= l; vy /= l; if (own && !passable(world, m.x + vx * 20, m.y + vy * 20)) { vx = own[0]; vy = own[1]; } dir = [vx, vy]; }
          }
          if (!dir) dir = own;
        }
        if (!dir) dir = [dx / d, dy / d];
        if (G && G.n > 1) {
          // formation speed: the group moves at its slowest member's pace; stragglers catch up, leaders wait
          let lag = 0;
          if (o.flow && typeof o.flow.distAt === 'function' && isFinite(G.dist)) {
            const dm = o.flow.distAt(m.x, m.y);
            if (isFinite(dm)) lag = dm - G.dist;
          } else lag = (G.cx - m.x) * dir[0] + (G.cy - m.y) * dir[1];
          sp = G.speed * (1 + IP.clamp(lag / 160, -T.catchUp, T.catchUp));
        }
        if (o.type === 'retreat') sp *= T.retreatSpeed;
        sp *= Math.min(1, d / 40 + 0.35);
        // step around a squadmate standing in the path (instead of walking through it)
        let sx = 0, sy = 0;
        for (const q of world.marines) {
          if (q === m || !alive(q) || !q._k || Math.hypot(q._k.vx, q._k.vy) > 30) continue;
          const qx = q.x - m.x, qy = q.y - m.y, ahead = qx * dir[0] + qy * dir[1];
          if (ahead <= 0 || ahead > 96) continue;
          const lat = qx * -dir[1] + qy * dir[0];
          if (Math.abs(lat) > 50) continue;
          const side = lat > 0 ? -1 : lat < 0 ? 1 : (m.id & 1 ? 1 : -1);
          const k = Math.min(1, 1.4 * (1 - ahead / 96)) * (1 - Math.abs(lat) / 50);
          sx += -dir[1] * side * k; sy += dir[0] * side * k;
        }
        dir = [dir[0] + sx * 2.4, dir[1] + sy * 2.4];
        { const l = Math.hypot(dir[0], dir[1]) || 1; dir[0] /= l; dir[1] /= l; }
        dvx = dir[0] * sp; dvy = dir[1] * sp; wantMove = true;
      }
    }
    // separation from squadmates (all marines, so idle ones shuffle aside rather than overlap)
    const holding = o && o.type === 'hold';
    let px = 0, py = 0;
    for (const q of world.marines) {
      if (q === m || !alive(q)) continue;
      const dx = m.x - q.x, dy = m.y - q.y, d2 = dx * dx + dy * dy;
      if (d2 >= T.sepDist * T.sepDist) continue;
      const d = Math.sqrt(d2) || 0.01, f = (T.sepDist - d) / T.sepDist;
      const ux = d2 > 1e-4 ? dx / d : Math.cos(m.id * 2.4), uy = d2 > 1e-4 ? dy / d : Math.sin(m.id * 2.4);
      px += ux * f; py += uy * f;
    }
    const sk = holding ? T.sepK * 0.15 : wantMove ? T.sepK * 0.55 : T.sepK;
    dvx += px * sk; dvy += py * sk;
    // hard core: rings never overlap, even while the squad corners a rock (soft separation alone lets the flow win)
    if (!holding) for (const q of world.marines) {
      if (q === m || !alive(q)) continue;
      const dx = m.x - q.x, dy = m.y - q.y, d = Math.hypot(dx, dy);
      if (d >= T.coreDist || d < 1e-3) continue;
      const f = ((T.coreDist - d) / T.coreDist) * T.coreK;
      dvx += (dx / d) * f; dvy += (dy / d) * f;
    }
    // keep the body off rock edges: a soft push along the terrain SDF gradient inside T.wallPad
    if (wantMove && S.hasTerrain && IP.terrain && typeof IP.terrain.sdf === 'function' && world.terrain) {
      const sd = IP.terrain.sdf(world, m.x, m.y);
      if (sd < T.wallPad) {
        const gx = IP.terrain.sdf(world, m.x + 4, m.y) - IP.terrain.sdf(world, m.x - 4, m.y);
        const gy = IP.terrain.sdf(world, m.x, m.y + 4) - IP.terrain.sdf(world, m.x, m.y - 4);
        const gl = Math.hypot(gx, gy);
        if (gl > 1e-6) { const f = (T.wallPad - sd) * T.wallK; dvx += (gx / gl) * f; dvy += (gy / gl) * f; }
      }
    }
    // ease velocity toward desired
    const ax = dvx - K.vx, ay = dvy - K.vy, al = Math.hypot(ax, ay), amax = T.accel * dt;
    if (al > amax) { K.vx += (ax / al) * amax; K.vy += (ay / al) * amax; } else { K.vx = dvx; K.vy = dvy; }
    const spd = Math.hypot(K.vx, K.vy);
    if (spd > 0.5) {
      const nx = m.x + K.vx * dt, ny = m.y + K.vy * dt;
      if (passable(world, nx, ny)) { m.x = nx; m.y = ny; }
      else if (passable(world, nx, m.y)) { m.x = nx; K.vy *= 0.5; }
      else if (passable(world, m.x, ny)) { m.y = ny; K.vx *= 0.5; }
      else { K.vx *= 0.3; K.vy *= 0.3; }
      const mp = world.map;
      if (mp) { m.x = IP.clamp(m.x, 8, mp.w - 8); m.y = IP.clamp(m.y, 8, mp.h - 8); }
      K.walk += spd * dt;
    } else { K.vx = 0; K.vy = 0; }
    m.vx = K.vx; m.vy = K.vy;
    const moving = spd > 14;

    // aim + fire
    K.cd -= dt; K.atkT += dt;
    K.firing = false;
    let face = moving ? Math.atan2(K.vy, K.vx) : m.dir;
    const healing = !!patient && patient !== m;
    if (healing) face = Math.atan2(patient.y - m.y, patient.x - m.x);
    else if (tgt) face = Math.atan2(tgt.y - m.y, tgt.x - m.x);
    const tdiff = angDiff(K.aim, face), tstep = T.turn * dt;
    K.aim += Math.abs(tdiff) <= tstep ? tdiff : Math.sign(tdiff) * tstep;
    K.aim = ((K.aim % TAU) + TAU) % TAU;
    if (!healing && tgt && Math.abs(angDiff(K.aim, face)) < 0.5) {
      K.firing = true;
      if (W.kind === 'fusion') fuse(world, m, tgt, dt);
      else if (K.cd <= 0) fire(world, m, tgt);
    }
    if (patient) heal(world, m, patient, dt);
    m.dir = K.aim;
    m.weapon.ammo = world.ammo;

    // state + anim (contract fields)
    const shooting = world.time - K.lastShotT < 0.3 || world.time - (K.healingT || -9) < 0.1;
    m.state = shooting ? 'attack' : moving ? 'move' : 'idle';
    if (shooting && moving && m.order && m.order.type === 'retreat') { m.anim = 'walk'; m.frame = ((K.walk / 5) | 0) % 8; }
    else if (shooting) { m.anim = 'attack'; m.frame = Math.min(3, (K.atkT * 22) | 0); }
    else if (moving) { m.anim = 'walk'; m.frame = ((K.walk / 5) | 0) % 8; }
    else { m.anim = 'idle'; m.frame = 0; }
    if (K.healGlow > 0) K.healGlow -= dt;
  }

  // order groups (one per issued order): centroid, flow direction at the centroid, slowest member's speed
  function updateGroups(world, S) {
    const G = S.groups;
    G.clear();
    for (const m of world.marines) {
      if (!alive(m) || !m._k || !m.order || !m.order.gid || m.order.type === 'hold') continue;
      let g = G.get(m.order.gid);
      if (!g) { g = { cx: 0, cy: 0, n: 0, speed: Infinity, flow: m.order.flow, dir: null, dist: Infinity, engaged: false }; G.set(m.order.gid, g); }
      g.cx += m.x; g.cy += m.y; g.n++;
      const tg = m._k.target;
      if (m.order.type === 'attack-move' && tg && alienAlive(tg) && Math.hypot(tg.x - m.x, tg.y - m.y) <= T.engage + (tg.r || 0)) g.engaged = true;
      g.speed = Math.min(g.speed, m._k.speed);
    }
    for (const g of G.values()) {
      g.cx /= g.n; g.cy /= g.n;
      if (!g.flow || g.n < 2) continue;
      // the centroid can land inside rock when the squad straddles a thin wall; then each marine uses its own sample
      if (!passable(world, g.cx, g.cy)) continue;
      g.dir = flowDir(g.flow, g.cx, g.cy);
      if (typeof g.flow.distAt === 'function') g.dist = g.flow.distAt(g.cx, g.cy);
    }
  }

  function updateRockets(world, dt) {
    const P = world.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      if (p.owner !== 'marines') continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.ttl -= dt;
      let boom = p.ttl <= 0;
      if (!boom) for (const a of world.aliens) { if (alienAlive(a) && Math.hypot(a.x - p.x, a.y - p.y) < (a.r || 6) + 4) { boom = true; break; } }
      if (!boom) continue;
      for (const a of world.aliens) if (alienAlive(a) && Math.hypot(a.x - p.x, a.y - p.y) < p.splash + (a.r || 0)) hurtAlien(world, a, p.dmg, 'rocket');
      IP.emit(world, 'explosion', { x: p.x, y: p.y, r: p.splash, kind: 'rocket' });
      P.splice(i, 1);
    }
  }

  function updateAmmo(world, dt) {
    let firing = false, nearBase = false;
    for (const m of world.marines) {
      if (!alive(m) || !m._k) continue;
      if (world.time - m._k.lastShotT < 0.25) firing = true;
      if (!nearBase) for (const s of world.structures) {
        if (s.kind === 'base' && s.owner !== 'alien' && s.state !== 'dead' && Math.hypot(s.x - m.x, s.y - m.y) < T.baseRange + (s.r || 0)) { nearBase = true; break; }
      }
    }
    if (nearBase) world.ammo = Math.min(1, world.ammo + T.ammoBaseRegen * dt);
    else if (!firing) world.ammo = Math.min(1, world.ammo + T.ammoRegen * dt);
    const S = world.marinesSys;
    S.nearBase = nearBase;
    if (world.ammo <= 0 && !S.wasEmpty) {
      S.wasEmpty = true;
      IP.emit(world, 'ammo-empty', {});
      if (world.hud && !world.hud.alert) world.hud.alert = { text: 'OUT OF AMMO: FALL BACK TO A BASE', color: '#ffe14a', dur: 3 };
    } else if (world.ammo > 0.1) S.wasEmpty = false;
  }

  // ------------------------------------------------------------------ input
  function boxSelect(world, b, add) {
    const x0 = Math.min(b.sx, b.x), x1 = Math.max(b.sx, b.x), y0 = Math.min(b.sy, b.y), y1 = Math.max(b.sy, b.y);
    const pad = 10 * world.camera.zoom;
    const got = [];
    for (const m of world.marines) {
      if (!alive(m)) continue;
      const s = IP.worldToScreen(m.x, m.y, world);
      if (s.x >= x0 - pad && s.x <= x1 + pad && s.y >= y0 - pad && s.y <= y1 + pad) got.push(m.id);
    }
    if (!got.length && !add) return; // an empty box keeps the selection (fewer accidental deselects on touch)
    API.select(world, got, add);
  }
  function clickSelect(world, ev) {
    const S = St(world);
    const lc = S.lastClick;
    if (shiftHeld()) S.lastClick = null; // shift-clicks toggle; two quick ones never read as a double-click
    else if (lc && world.time - lc.t <= T.dblClick && Math.hypot(ev.x - lc.x, ev.y - lc.y) < 24) {
      API.select(world, 'all');
      S.lastClick = null;
      return;
    }
    S.lastClick = shiftHeld() ? null : { t: world.time, x: ev.x, y: ev.y };
    const m = API.hitTest(world, ev.wx, ev.wy);
    if (!m) return; // clicking ground keeps the squad selected (Infested Planet behaviour)
    if (shiftHeld()) {
      if (world.selection.has(m.id)) world.selection.delete(m.id); else world.selection.add(m.id);
      syncSel(world);
    } else API.select(world, [m.id]);
  }

  function centreOn(world, ms) {
    if (!ms.length || !world.camera) return;
    let x = 0, y = 0;
    for (const m of ms) { x += m.x; y += m.y; }
    world.camera.x = x / ms.length; world.camera.y = y / ms.length;
    if (IP.clampCamera) IP.clampCamera(world);
  }
  // HUD buttons arrive as 'ui' events (emitted by the HUD's input gate earlier in this tick). When the mission rules
  // (game.js) run, they own 'retreat'/'regroup' (they call IP.marines.order themselves), so we stay out of the way.
  const gameOwnsRetreat = (world) => has(world, 'game') && IP.game && typeof IP.game.retreat === 'function';
  function uiEvents(world) {
    if (gameOwnsRetreat(world)) return;
    const ev = world.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type !== 'ui') continue;
      if (e.action === 'retreat' || e.action === 'regroup') retreat(world);
      else if (e.action === 'hold') issueOrder(world, 0, 0, 'hold');
    }
  }

  function onInput(world, ev) {
    const S = St(world);
    if (!S) return;
    if (ev.consumed) {
      if (ev.type === 'cancel') { if (S.box && S.box.id === ev.id) S.box = null; if (S.press && S.press.id === ev.id) S.press = null; }
      return;
    }
    switch (ev.type) {
      case 'down':
        if (ev.button === 2) issueOrder(world, ev.wx, ev.wy);
        else if (ev.button === 0) S.press = { id: ev.id, drag: false, long: false };
        break;
      case 'longpress':
        issueOrder(world, ev.wx, ev.wy);
        if (S.press && S.press.id === ev.id) S.press.long = true;
        break;
      case 'dragstart':
        if (ev.button !== 0 && ev.pointerType === 'mouse') break;
        if (S.press && S.press.id === ev.id) S.press.drag = true;
        S.box = { id: ev.id, sx: ev.sx != null ? ev.sx : ev.x, sy: ev.sy != null ? ev.sy : ev.y, x: ev.x, y: ev.y, add: shiftHeld() };
        break;
      case 'drag':
        if (S.box && S.box.id === ev.id) { S.box.x = ev.x; S.box.y = ev.y; }
        break;
      case 'dragend':
        if (S.box && S.box.id === ev.id) {
          S.box.x = ev.x; S.box.y = ev.y;
          const b = S.box;
          S.box = null;
          if (Math.abs(b.x - b.sx) < 8 && Math.abs(b.y - b.sy) < 8) clickSelect(world, ev);
          else boxSelect(world, b, b.add || shiftHeld());
        }
        if (S.press && S.press.id === ev.id) S.press = null;
        break;
      case 'up':
        if (S.press && S.press.id === ev.id) {
          const p = S.press;
          S.press = null;
          if (!p.drag && !p.long && !ev.longpress && (ev.button === 0 || ev.pointerType !== 'mouse')) clickSelect(world, ev);
        }
        break;
      case 'cancel':
        if (S.box && S.box.id === ev.id) S.box = null;
        if (S.press && S.press.id === ev.id) S.press = null;
        break;
      case 'keydown': {
        const k = ev.key;
        const dm = /^Digit([1-5])$/.exec(k);
        // the same Digit / Space twice in quick succession also centres the camera on the selection
        const again = S.lastKey && S.lastKey.k === k && world.time - S.lastKey.t <= T.dblKey;
        S.lastKey = { k, t: world.time };
        if (dm) {
          const m = world.marines[+dm[1] - 1];
          if (alive(m)) {
            if (shiftHeld() || ev.shift) { world.selection.add(m.id); syncSel(world); } else API.select(world, [m.id]);
            if (again) centreOn(world, [m]);
          }
        } else if (k === 'Space' || k === 'F2') { API.select(world, 'all'); if (again) centreOn(world, API.selected(world)); }
        else if (k === 'KeyA') {
          // KeyA arms attack-move. With marines selected it must not also pan the camera (WASD): drop it from the
          // held keys the engine's camera reads this tick (arrows and edge scroll still pan)
          if (world.selection.size) { S.armed = true; S.aHeld = true; IP.input.keys.delete('KeyA'); }
        }
        else if (k === 'Escape') S.armed = false;
        else if (k === 'KeyH') issueOrder(world, 0, 0, 'hold');
        else if (k === 'KeyR') { if (gameOwnsRetreat(world)) IP.game.retreat(world); else retreat(world); }
        break;
      }
      case 'keyup':
        if (ev.key === 'KeyA') S.aHeld = false;
        break;
    }
  }

  // ------------------------------------------------------------------ demo stub aliens (only when swarm is not running)
  const STUB_KINDS = [
    { kind: 'drone', sheet: 'bug_drone', hp: 14, speed: 62, r: 8, dmg: 3, w: 8 },
    { kind: 'runner', sheet: 'bug_runner', hp: 9, speed: 96, r: 7, dmg: 2, w: 3 },
  ];
  function stubSpawn(world, S, n) {
    const st = S.stub, rng = st.rng;
    const lane = st.lanes[(st.wave++) % st.lanes.length];
    for (let i = 0; i < n; i++) {
      if (IP.count(world.aliens) >= st.max) return;
      const roll = rng() * 11, K = roll < STUB_KINDS[0].w ? STUB_KINDS[0] : STUB_KINDS[1];
      const a = { id: 'a' + (++st.ids), kind: K.kind, x: -12 - rng() * 40, y: lane + (rng() - 0.5) * 90, vx: 0, vy: 0, r: K.r, dir: 0,
        hp: K.hp, maxHp: K.hp, speed: K.speed * (0.9 + rng() * 0.2), state: 'move', targetId: null, sheet: K.sheet, variant: 0,
        anim: 'walk', frame: 0, hitT: -9, _dmg: K.dmg, _cd: rng() * 0.8, _ph: (rng() * 40) | 0 };
      world.aliens.push(a);
    }
  }
  function stubUpdate(world, S, dt) {
    const st = S.stub;
    if (world.time >= st.next) {
      if (S.hasSwarm && IP.swarm && typeof IP.swarm.spawn === 'function') {
        const lane = st.lanes[(st.wave++) % st.lanes.length];
        IP.swarm.spawn(world, { x: 20, y: lane, kind: 'drone', n: st.group });
      } else if (!S.hasSwarm) stubSpawn(world, S, st.group);
      st.next = world.time + st.every;
    }
    if (S.hasSwarm) return;
    const al = world.aliens;
    for (let i = al.length - 1; i >= 0; i--) {
      const a = al[i];
      if (a.hp <= 0) {
        IP.emit(world, 'alien-died', { x: a.x, y: a.y, kind: a.kind, dir: a.dir, cause: 'marines' });
        S.corpses.push({ x: a.x, y: a.y, dir: a.dir, sheet: a.sheet, t: world.time });
        if (S.corpses.length > 160) S.corpses.shift();
        al.splice(i, 1);
      }
    }
    for (let i = 0; i < al.length; i++) {
      const a = al[i];
      const m = API.nearest(world, a.x, a.y);
      let dvx = 0, dvy = 0;
      if (m) {
        const dx = m.x - a.x, dy = m.y - a.y, d = Math.hypot(dx, dy) || 1, reach = a.r + m.r + 2;
        a.targetId = m.id;
        if (d > reach) { dvx = (dx / d) * a.speed; dvy = (dy / d) * a.speed; a.state = 'move'; a.anim = 'walk'; }
        else {
          a.state = 'attack'; a.anim = 'attack';
          if ((a._cd -= dt) <= 0) { a._cd = 0.8; API.damage(world, m, a._dmg, a.kind); }
        }
        a.dir = Math.atan2(dy, dx);
      } else { dvx = a.speed * 0.5; a.state = 'move'; }
      // light separation among the stubs (O(n^2), n is small in the demo)
      for (let j = 0; j < al.length; j++) {
        if (j === i) continue;
        const b = al[j], dx = a.x - b.x, dy = a.y - b.y, rr = a.r + b.r;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < rr) { dvx += (dx / d) * (rr - d) * 14; dvy += (dy / d) * (rr - d) * 14; }
      }
      a.vx = dvx; a.vy = dvy;
      const nx = a.x + dvx * dt, ny = a.y + dvy * dt;
      if (passable(world, nx, ny)) { a.x = nx; a.y = ny; }
      a.frame = a.anim === 'walk' ? (((world.tick + a._ph) / 5) | 0) : Math.min(3, ((0.8 - a._cd) * 8) | 0);
    }
  }

  // ------------------------------------------------------------------ presentation
  // Crisp UI overlays (not world art): solid bands and dots with a 1 px dark outline, like the factory's line work.
  const C = {
    ring: [1.0, 0.45, 0.38],      // coral band (lit hp segments)
    ringOff: [0.40, 0.19, 0.21],  // spent hp segments (an empty slot, still part of the ring)
    hurt: [1.0, 0.16, 0.12],
    outline: [0.02, 0.03, 0.06, 0.85],
    disc: [1.0, 0.55, 0.45, 0.07], // the faintest warm wash inside the ring so the selected unit lifts off the ground
    order: [0.56, 0.97, 1.0],     // move: light cyan dots (the roster's glass colour)
    attack: [1.0, 0.36, 0.30],    // attack-move: coral chevrons (dots would read as rifle tracers)
    retreat: [1.0, 0.85, 0.30],   // retreat: amber dots to a hex
    shadow: 'rgba(0,0,0,0.42)',
  };
  const sprO = { layer: 'unit', scale: 1, tint: 0xffffffff, alpha: 1 };
  const solidO = { layer: 'shadow', alpha: 1 };
  const ORDER_DOT = { r: 2.3, gap: 11, max: 70, end: 4.6 };
  const col4 = (c, a) => [c[0], c[1], c[2], a];

  function arc(r, x, y, rad, a0, a1, w, col) {
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.13));
    let px = x + Math.cos(a0) * rad, py = y + Math.sin(a0) * rad;
    for (let i = 1; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n, nx = x + Math.cos(a) * rad, ny = y + Math.sin(a) * rad;
      r.line(px, py, nx, ny, w, col, solidO);
      px = nx; py = ny;
    }
  }

  // Selected marines only: a segmented coral band (1 px dark outline) whose lit segments are the marine's hp;
  // the lit part pulses red under 35% hp; a green wash while being healed.
  function drawRing(r, x, y, hpF, t, healGlow) {
    const R = T.ringR, band = T.ringBand, mid = R - 1 - band / 2, N = T.ringSegs;
    const hurt = hpF < 0.35;
    r.circle(x, y, R - 1 - band, C.disc, solidO);
    if (healGlow > 0) r.circle(x, y, R - 2, [0.45, 1, 0.55, Math.min(1, healGlow * 2) * 0.3], { layer: 'shadow', add: true });
    r.circle(x, y, mid, C.outline, { layer: 'shadow', width: band + 2 });
    const lit = Math.max(0, Math.min(N, Math.ceil(hpF * N - 1e-3)));
    const pulse = hurt ? 0.75 + 0.25 * Math.sin(t * 10) : 1;
    const on = col4(hurt ? C.hurt : C.ring, pulse), off = col4(C.ringOff, 0.95);
    const gap = 0.075, step = TAU / N, start = -Math.PI / 2;
    for (let i = 0; i < N; i++) {
      const a0 = start + i * step + gap / 2;
      arc(r, x, y, mid, a0, a0 + step - gap, band, i < lit ? on : off);
    }
  }

  // Order line from the ring edge to the marine's slot. Move: light-cyan dots and a round end blob. Attack-move:
  // coral chevrons pointing along the path and a crossed ring. Retreat: amber dots to a small hex. Every mark has a
  // dark 1 px outline so it stays crisp on any ground. Fainter when the marine isn't selected.
  function drawOrder(r, m, sel) {
    const o = m.order;
    if (!o || o.type === 'hold') return;
    const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy);
    const s0 = T.ringR + 5;
    if (d < s0 + 8) return;
    const ux = dx / d, uy = dy / d, px = -uy, py = ux;
    const kind = o.type === 'attack-move' ? 'atk' : o.type === 'retreat' ? 'ret' : 'move';
    const base = kind === 'atk' ? C.attack : kind === 'ret' ? C.retreat : C.order;
    const a = sel ? 1 : 0.38;
    const col = col4(base, a), ol = col4(C.outline, C.outline[3] * a);
    const stop = d - 12, span = stop - s0;
    if (span > 0) {
      const gap = Math.max(kind === 'atk' ? 15 : ORDER_DOT.gap, span / ORDER_DOT.max);
      const n = Math.min(ORDER_DOT.max, Math.floor(span / gap) + 1);
      for (let i = 0; i < n; i++) {
        const u = s0 + i * gap, x = m.x + ux * u, y = m.y + uy * u;
        if (kind === 'atk') {
          // chevron ">" pointing along the path
          const bx = x - ux * 4, by = y - uy * 4;
          r.line(bx + px * 4.5, by + py * 4.5, x + ux * 0.6, y + uy * 0.6, 3.6, ol, solidO);
          r.line(bx - px * 4.5, by - py * 4.5, x + ux * 0.6, y + uy * 0.6, 3.6, ol, solidO);
          r.line(bx + px * 4.5, by + py * 4.5, x, y, 1.8, col, solidO);
          r.line(bx - px * 4.5, by - py * 4.5, x, y, 1.8, col, solidO);
        } else {
          r.circle(x, y, ORDER_DOT.r + 1, ol, solidO);
          r.circle(x, y, ORDER_DOT.r, col, solidO);
        }
      }
    }
    if (kind === 'atk') {
      r.circle(o.x, o.y, 7, ol, { layer: 'shadow', width: 4 });
      r.circle(o.x, o.y, 7, col, { layer: 'shadow', width: 2 });
      r.line(o.x - 4, o.y - 4, o.x + 4, o.y + 4, 2, col, solidO);
      r.line(o.x - 4, o.y + 4, o.x + 4, o.y - 4, 2, col, solidO);
    } else if (kind === 'ret') {
      r.ngon(o.x, o.y, 7, 6, ol, { layer: 'shadow', rot: Math.PI / 6 });
      r.ngon(o.x, o.y, 5.6, 6, col, { layer: 'shadow', rot: Math.PI / 6 });
    } else {
      r.circle(o.x, o.y, ORDER_DOT.end + 1.2, ol, solidO);
      r.circle(o.x, o.y, ORDER_DOT.end, col, solidO);
    }
  }

  // Order ping: a ring that snaps out from the clicked point (instant feedback, before the squad has moved)
  function drawPings(r, S, t) {
    for (const p of S.pings) {
      const k = (t - p.t) / T.pingLife;
      if (k < 0 || k >= 1) continue;
      const base = p.type === 'attack-move' ? C.attack : p.type === 'retreat' ? C.retreat : C.order;
      const e = 1 - (1 - k) * (1 - k), rad = 9 + e * 22, a = (1 - k) * 0.95;
      r.circle(p.x, p.y, rad, col4(C.outline, 0.6 * a), { layer: 'shadow', width: 4 });
      r.circle(p.x, p.y, rad, col4(base, a), { layer: 'shadow', width: 2 });
    }
  }

  function drawMarineSprite(r, world, m) {
    const sh = IP.assets.sheet(m.sheet);
    if (!sh) { r.circle(m.x, m.y, 10, '#6a56c8', { layer: 'unit' }); return; }
    const meta = sh.meta || {};
    const cy = meta.center ? meta.center.y : sh.ay, cx = meta.center ? meta.center.x : sh.ax;
    const d = sh.dir(m.dir);
    const fr = sh.frame(d, m.anim, m.frame);
    sprO.tint = 0xffffffff; sprO.alpha = 1;
    r.sprite(sh, fr, m.x + (sh.ax - cx), m.y + (sh.ay - cy), sprO);
  }

  function drawStubAliens(r, world, S, list) {
    // corpses (only when vfx isn't running; vfx paints its own)
    if (!S.hasVfx) {
      const co = { layer: 'decal', tint: 0xff8a8a8a, alpha: 0.6 };
      for (const c of S.corpses) {
        const sh = IP.assets.sheet(c.sheet);
        if (!sh) continue;
        const ca = Math.cos(c.dir), sa = Math.sin(c.dir);
        r.circle(c.x - ca * 4, c.y - sa * 4, 10, 'rgba(150,14,64,0.55)', { layer: 'decal' });
        r.circle(c.x + ca * 9 + sa * 4, c.y + sa * 9 - ca * 4, 6, 'rgba(216,27,96,0.5)', { layer: 'decal' });
        r.circle(c.x - sa * 8, c.y + ca * 8, 4, 'rgba(216,27,96,0.45)', { layer: 'decal' });
        r.sprite(sh, sh.frame(sh.dir(c.dir), 'idle', 0), c.x, c.y, co);
      }
    }
    for (const a of world.aliens) {
      const sh = IP.assets.sheet(a.sheet);
      if (!sh) { list.push({ y: a.y, a, sh: null }); continue; }
      list.push({ y: a.y, a, sh });
    }
  }

  function drawFallbackFx(r, S) {
    for (const f of S.fx) {
      const k = Math.max(0, f.life / f.max);
      if (f.kind === 'rifle' || f.kind === 'medic') {
        r.line(f.x, f.y, f.tx, f.ty, 2.6, f.kind === 'medic' ? [1, 0.55, 0.75, k] : [1, 0.22, 0.2, k], { layer: 'fx', dash: [4, 5], add: true });
        r.circle(f.x, f.y, 4, [1, 0.8, 0.5, k * 0.8], { layer: 'fx', add: true });
      } else if (f.kind === 'sniper') {
        r.line(f.x, f.y, f.tx, f.ty, 2.2, [1, 1, 1, k], { layer: 'fx', add: true });
      } else if (f.kind === 'fusion') {
        const n = 5;
        for (let i = 1; i <= n; i++) {
          const u = i / n, x = f.x + (f.tx - f.x) * u, y = f.y + (f.ty - f.y) * u;
          r.circle(x, y, 5 + u * 9, [1, 0.55, 0.15, k * 0.55], { layer: 'fx', add: true });
        }
      }
    }
  }

  function makeDemoGround(seed) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rng = IP.mulberry32(seed);
    g.fillStyle = '#1b1522'; g.fillRect(0, 0, 256, 256);
    const cols = ['rgba(58,30,62,0.22)', 'rgba(20,14,26,0.30)', 'rgba(84,34,70,0.12)', 'rgba(40,36,54,0.20)'];
    for (let i = 0; i < 900; i++) {
      const x = rng() * 256, y = rng() * 256, rad = 4 + rng() * 26;
      g.fillStyle = cols[(rng() * cols.length) | 0];
      for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, TAU); g.fill(); }
    }
    return IP.gfx.texture(c, { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'marines-demo-ground' });
  }

  // ------------------------------------------------------------------ system
  IP.registerSystem('marines', {
    init(world) {
      world.marinesSys = {
        rng: IP.fork(world, 'marines'), orderSeq: 0, groups: new Map(), box: null, press: null, lastClick: null, armed: false, fx: [], corpses: [],
        stub: null, ground: null, nearBase: false,
        hasSwarm: has(world, 'swarm'), hasTerrain: has(world, 'terrain'), hasVfx: has(world, 'vfx'), hasStructures: has(world, 'structures'),
        pings: [], home: null, lastKey: null, wasEmpty: false,
      };
      if (world.ammo == null) world.ammo = 1;
      for (const n of ['rifle_a', 'rifle_b', 'sniper', 'fusion', 'medic']) IP.assets.load(n);
    },
    start(world) {
      const S = St(world);
      if (!S) return;
      S.hasSwarm = has(world, 'swarm') && !!IP.swarm;
      S.hasTerrain = has(world, 'terrain') && !!IP.terrain;
      S.hasVfx = has(world, 'vfx');
      S.hasStructures = has(world, 'structures') && !!IP.structures;
      for (const m of world.marines) if (m && m.cls) ensure(m);
      syncSel(world);
    },
    update(world, dt) {
      const S = St(world);
      if (!S) return;
      if (world.ammo == null) world.ammo = 1;
      const ms = world.marines;
      uiEvents(world);
      syncSel(world);
      updateGroups(world, S);
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        if (!m || !m.cls) continue; // not a contract marine (e.g. another scene's placeholder)
        ensure(m);
        if (alive(m)) updateMarine(world, m, dt);
      }
      updateRockets(world, dt);
      updateAmmo(world, dt);
      if (S.stub) stubUpdate(world, S, dt);
      if (S.trail && world.tick % 10 === 0) for (const m of ms) if (alive(m) && m._k && Math.hypot(m._k.vx, m._k.vy) > 5) { S.trail.push(m.x, m.y, m.id); if (S.trail.length > 9000) S.trail.splice(0, 3); }
      for (let i = S.fx.length - 1; i >= 0; i--) if ((S.fx[i].life -= dt) <= 0) S.fx.splice(i, 1);
    },
    draw(world, r) {
      const S = St(world);
      if (!S) return;
      if (S.ground && !S.hasTerrain) {
        const mp = world.map, tile = 512;
        r.quad(0, 0, mp.w, mp.h, 0xffffffff, { layer: 'ground', tex: S.ground, uv: [0, 0, mp.w / tile, mp.h / tile] });
        r.quad(0, 0, mp.w, mp.h, 'rgba(10,6,14,0.35)', { layer: 'ground', tex: S.ground, uv: [0.3, 0.7, 0.3 + mp.w / 2300, 0.7 + mp.h / 2300] });
      }
      const t = world.time;
      const ms = world.marines.filter((m) => m && m.cls && m._k);
      if (S.trail) { const TC = ['#ffd23a', '#5cff6e', '#ff8a3a', '#7ab8ff', '#ff6ad5']; for (let i = 0; i < S.trail.length; i += 3) r.circle(S.trail[i], S.trail[i + 1], 1.6, TC[(S.trail[i + 2] - 1) % 5], { layer: 'decal', alpha: 0.6 }); }
      // dead marines: a dark husk on the decal layer
      for (const m of ms) {
        if (alive(m)) continue;
        const sh = IP.assets.sheet(m.sheet);
        r.circle(m.x, m.y, 16, 'rgba(0,0,0,0.35)', { layer: 'decal' });
        if (sh) r.sprite(sh, sh.frame(sh.dir(m.dir), 'idle', 0), m.x + (sh.ax - (sh.meta.center ? sh.meta.center.x : sh.ax)), m.y + (sh.ay - (sh.meta.center ? sh.meta.center.y : sh.ay)), { layer: 'decal', tint: 0xff606060, alpha: 0.8 });
      }
      // ground-level presentation: rings (selected marines only), contact shadows, order lines
      const live = ms.filter(alive);
      // order marks first, so a squadmate's ring sits on top of a line that passes under it
      for (const m of live) if (!m.selected) drawOrder(r, m, false);
      for (const m of live) if (m.selected) drawOrder(r, m, true);
      drawPings(r, S, t);
      for (const m of live) if (m.selected) drawRing(r, m.x, m.y, m.hp / m.maxHp, t, m._k.healGlow);
      for (const m of live) if (!m.selected && m._k.healGlow > 0) r.circle(m.x, m.y, T.ringR - 6, [0.45, 1, 0.55, Math.min(1, m._k.healGlow * 2) * 0.22], { layer: 'shadow', add: true });
      for (const m of live) r.circle(m.x + 2, m.y + 4, 14, C.shadow, solidO);
      // units, y-sorted (marines + demo stub aliens when swarm isn't drawing them)
      const list = [];
      for (const m of live) list.push({ y: m.y, m });
      if (S.stub && !S.hasSwarm) drawStubAliens(r, world, S, list);
      list.sort((p, q) => p.y - q.y || (p.m ? p.m.id : 0) - (q.m ? q.m.id : 0));
      const ao = { layer: 'unit' };
      for (const e of list) {
        if (e.m) { drawMarineSprite(r, world, e.m); continue; }
        const a = e.a;
        if (!e.sh) { r.circle(a.x, a.y, a.r, '#2c6a8a', ao); continue; }
        r.sprite(e.sh, e.sh.frame(e.sh.dir(a.dir), a.anim, a.frame), a.x, a.y, ao);
      }
      // heal crosses over healed marines
      for (const m of live) {
        if (m._k.healGlow <= 0) continue;
        const k = Math.min(1, m._k.healGlow * 3), y = m.y - 30 - (0.45 - m._k.healGlow) * 20;
        r.line(m.x - 5, y, m.x + 5, y, 3, [0.5, 1, 0.6, k], { layer: 'fx' });
        r.line(m.x, y - 5, m.x, y + 5, 3, [0.5, 1, 0.6, k], { layer: 'fx' });
      }
      // our rockets (vfx adds trails if present)
      for (const p of world.projectiles) {
        if (p.owner !== 'marines') continue;
        const a = Math.atan2(p.vy, p.vx);
        r.quad(p.x, p.y, 12, 4, '#ffd28a', { layer: 'fx', center: true, rot: a });
        r.circle(p.x - Math.cos(a) * 7, p.y - Math.sin(a) * 7, 5, [1, 0.5, 0.1, 0.8], { layer: 'fx', add: true });
      }
      if (!S.hasVfx) drawFallbackFx(r, S);
    },
    drawHud(world, ctx) {
      const S = St(world);
      if (!S) return;
      const b = S.box;
      if (b) {
        const x = Math.min(b.sx, b.x), y = Math.min(b.sy, b.y), w = Math.abs(b.x - b.sx), h = Math.abs(b.y - b.sy);
        ctx.fillStyle = 'rgba(63,216,200,0.10)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(63,216,200,0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.setLineDash([]);
      }
      // attack-move armed (KeyA): a red reticle at the mouse; touch has no hover, the HUD's toggle button shows the state
      if (S.armed && IP.input.pointerType === 'mouse' && IP.input.inFrame) {
        const ip = IP.input;
        ctx.strokeStyle = '#ff5c4d';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(ip.x, ip.y, 14, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ip.x - 20, ip.y); ctx.lineTo(ip.x - 8, ip.y); ctx.moveTo(ip.x + 8, ip.y); ctx.lineTo(ip.x + 20, ip.y);
        ctx.moveTo(ip.x, ip.y - 20); ctx.lineTo(ip.x, ip.y - 8); ctx.moveTo(ip.x, ip.y + 8); ctx.lineTo(ip.x, ip.y + 20); ctx.stroke();
      }
    },
    onInput,
  });

  // ------------------------------------------------------------------ demo scenario
  // Five marines mid-screen; a trickle of aliens from the left (IP.swarm.spawn when swarm runs, else contract-shaped stubs).
  IP.scenario('marines-demo', (world) => {
    world.map = { w: 1920, h: 1080 };       // == the frame, so the camera is locked (KeyA can't pan it)
    world.camera = { x: 960, y: 540, zoom: 1 };
    const S = St(world);
    // painted basalt ground + a few rock masses when terrain runs; the squad's spot and the alien entry stay open
    if (S && S.hasTerrain && IP.terrain && typeof IP.terrain.generate === 'function') {
      IP.terrain.generate(world, { biome: 'basalt', w: 1920, h: 1080, seed: world.seed, count: 3,
        keepClear: [{ x: 1180, y: 560, r: 170 }, { x: 40, y: 540, r: 220 }] });
    }
    API.spawnSquad(world, 1180, 560);
    if (S) {
      S.stub = { rng: IP.fork(world, 'marines-demo-stub'), next: 1.0, every: 0.4, group: 9, wave: 0, ids: 0, max: 260,
        lanes: [420, 640, 520, 700, 380, 600] };
      if (!S.hasTerrain && IP.gfx && IP.gfx.gl) S.ground = makeDemoGround(world.seed * 7919 + 13);
      for (const n of ['bug_drone', 'bug_runner']) IP.assets.load(n);
    }
  }, { systems: ['terrain', 'swarm', 'marines', 'vfx'] });

  // Routing check (the round-1 critic's case): one tall rock centred on the path; the squad starts right of it and
  // is ordered (right-click / long-press) to the far side. A faint per-marine breadcrumb trail shows the route taken.
  IP.scenario('marines-route', (world) => {
    world.camera = { x: 960, y: 540, zoom: 1 };
    if (IP.terrain && typeof IP.terrain.generate === 'function') {
      IP.terrain.generate(world, { biome: 'basalt', w: 1920, h: 1080, seed: 5, masses: [{ x: 960, y: 540, rx: 120, ry: 330, rot: 0, kind: 'rock' }],
        arenaList: [], keepClear: [{ x: 1400, y: 540, r: 150 }, { x: 400, y: 540, r: 150 }] });
    } else world.map = { w: 1920, h: 1080 };
    API.spawnSquad(world, 1400, 540);
    const S = St(world);
    if (S) S.trail = [];
  }, { systems: ['terrain', 'marines'] });

  // Feel check: a hive pours aliens at a hurt squad (rifle 35%, fusion 55%) standing between it and a player base.
  // The medic heals by priority (crosses fly to the most hurt), the rings show hp as lit segments, and KeyR (or the
  // retreat button) backs the squad toward the base while it keeps firing; ammo refills near the base.
  IP.scenario('marines-feel', (world) => {
    world.map = { w: 1920, h: 1080 };
    world.camera = { x: 960, y: 540, zoom: 1 };
    const S = St(world);
    if (S && S.hasTerrain && IP.terrain && typeof IP.terrain.generate === 'function') {
      IP.terrain.generate(world, { biome: 'basalt', w: 1920, h: 1080, seed: world.seed + 11, count: 2,
        keepClear: [{ x: 900, y: 560, r: 260 }, { x: 260, y: 320, r: 230 }, { x: 1650, y: 760, r: 220 }, { x: 560, y: 440, r: 200 }, { x: 1300, y: 660, r: 200 }] });
    }
    if (IP.structures && typeof IP.structures.add === 'function' && has(world, 'structures')) {
      IP.structures.add(world, 'base', 1650, 760);
      IP.structures.add(world, 'hive', 260, 320, { spawn: { kinds: ['drone', 'drone', 'runner'], rate: 22, burst: 8 } });
    }
    const ms = API.spawnSquad(world, 900, 560, { dir: Math.PI });
    const hurt = { rifle_a: 0.35, fusion: 0.55, sniper: 0.8 };
    for (const m of ms) if (hurt[m.sheet]) m.hp = Math.round(m.maxHp * hurt[m.sheet]);
    world.ammo = 0.45;
    if (S) S.home = null;
  }, { systems: ['terrain', 'swarm', 'marines', 'structures', 'vfx'] });
})();
