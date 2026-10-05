// Infested Planet Gauntlet: mission flow (owner: game piece). Plain script; registers the 'game' system and IP.game.
//
// The loop (Infested Planet's): a map with 6-8 alien hives and one landing zone (starting base), a squad of five. A hive
// is taken by destroying it or by standing on it with the area clear (structures' capture bar); either way it becomes a
// player base with six build nodes and pays TUNE.bpPerHive build points (BP, the same on every path). BP also trickle in
// over time and buy turrets / barricades on nodes, weapon swaps and the orbital strike. Every ~90 s of play the aliens
// mutate (Fast, Armored, Spitters, Regrowth, Berserk). Win when no alien hive is left, lose when the whole squad is dead.
//
// How a fight plays (round 3):
//   - only the hive the squad is attacking floods: the hive its attack-move / move order is on (from TUNE.assaultR away,
//     so the stream runs the whole approach), else the hive nearest the squad centre within TUNE.nearR. It pours its
//     assault reserve (TUNE.reserve) out at TUNE.rate.assault, debited by the aliens it actually hatched (newborns are
//     counted per hive), and hatches the mouth's shortfall out of the rim facing the squad when the mouth chokes. Every
//     reserve refills TUNE.reserve.refill per second, so a drained hive keeps streaming at about that rate, and a
//     neighbour a stray marine walks near does not bleed out. Other hives within TUNE.awakeR of a marine stream at the
//     awake rate, the rest trickle. Pressure ramps with captured hives (TUNE.rate.perHive, TUNE.pressure), thins as the
//     squad loses hp, and tougher mutations (Armored, Fast) come in proportionally smaller numbers.
//   - counter-attack: once the squad is at the hive (TUNE.counterNear) or on it, the nearest other hive answers with its
//     own stream (TUNE.rate.counter), so the capture is a two-front fight. A dying hive (below TUNE.dying hp) gives up.
//   - taking a hive is a fight: standing on it keeps it hatching clutches at the rim (TUNE.contested) until it is
//     below TUNE.dying hp, and its capture bar can't complete until its hp is below TUNE.capLock.hp or the squad has stood on it
//     TUNE.capLock.stand seconds. Marines whose order is on the hive put part of their fire into it (objective fire).
//   - attack-move assist: marines.js halts an attack-moving group while anything is in reach; when the whole squad is on
//     an attack-move onto a hive and has been fighting TUNE.push.engaged s, it steps TUNE.push.step px toward the hive
//     (firing) and resumes, so attack-move grinds through a stream and ends on the hive.
//   - captured ground holds: bases and turrets keep only TUNE.fort.* of each loss on top of structures' armor, repair when
//     calm, and until the Regrowth mutation a base can't be pushed below TUNE.fort.floor of its hp (only Regrowth re-
//     infests ground; with it, an unguarded base re-infests TUNE.regrowAfter s after capture). Marines near a base heal.
//
// Data out (read by the HUD and anyone else):
//   world.game = { difficulty, difficultyName, bp, mutations:[{key,name,desc,t}], upgrades:{catalog, swaps, built}, time,
//                  state:'playing'|'won'|'lost', objective, hives:{total (fixed: the mission hives), captured, left},
//                  foothold:'held'|'lost' (the landing zone, never counted as a hive), nextMutation, stats:{kills, captures, lost} }
//   world.bp (the spendable pool; structures.build spends it), world.hud.{mutations, objective, alert, dialogue}
// Data in: 'ui' events (IP.emit(world,'ui',{action,...})) from the HUD, or IP.game.command(world, {action,...}) from scripts:
//   build            {kind?:'turret'|'barricade', node?:id, x?, y?}  no kind: a turret on the nearest free node to the squad
//                    (a barricade when only 1-2 BP are left). build-turret / build-barricade are aliases. {on:true} with no
//                    target (the HUD toggle) arms structures' tap-a-node build mode and says so.
//   research|upgrade {id?, cls?}  swap a marine's weapon (default: the first selected marine, next class in
//                    rifle > sniper > fusion > rocket > medic). Costs COST.swap[cls] BP. From the HUD toggle: on:true previews
//                    the swap (alert), on:false confirms it.
//   retreat|regroup  the living squad falls back to the nearest player base (marines' retreat order: fires over the shoulder)
//   weapon|special   orbital strike on the densest knot of aliens near the squad (TUNE.special: BP cost, cooldown)
//   dialogue-next    from a script: closes the commander line (the HUD's own click path advances its queue itself)
// API: IP.game = { TUNE, COST, MUTATIONS, DIFF, LINES, setupMission(world, cfg), applyPlan(world, plan), build(world, kind, where),
//                  swap(world, marine|id, cls, opts), special(world), retreat(world), mutate(world, key), say(world, text),
//                  state(world), command(world, ev), hiveIds(world) }
// Rules run in a small per-world system ('game-rules') spliced in right after 'structures' (before vfx and hud), so the
// events it emits (shots at hives, mutation, captures) are seen by vfx and hud in the same tick. The registered 'game'
// system only sets up, fast-forwards scripted scenarios in start(), and draws the end-of-mission banner.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ tuning (data)
  const TUNE = {
    bpStart: 4,
    bpPerHive: 4,            // paid in total on every capture, whatever the path (structures pays DEF.hive.bp; we top up the rest)
    bpTrickle: 1,            // ... and this much every bpEvery seconds of play
    bpEvery: 30,
    mutationEvery: 90,       // seconds of play between mutations
    regrowAfter: 120,        // Regrowth: a captured hive re-infests this long after capture unless a turret guards them
    pressure: { base: 520, perHive: 60, max: 1000, soft: 160 }, // live-alien target: base + perHive * captured
    awakeR: 1000,            // a hive pumps at the awake rate while a marine is within this distance of THAT hive
    nearR: 600,              // with no order on a hive, the hive nearest the squad centre within this is the one attacked
    assaultR: 1300,          // a hive the squad's order is on pours its assault wave from this far (the whole approach)
    rate: { assault: 34, awake: 4.5, asleep: 0.15, perHive: 0.1, counter: 14 }, // aliens per second per hive, x (1 + perHive * captured)
    counterNear: 300,        // ... from when the squad is this close to the hive it attacks
    counterR: 1500,          // counter-attack: while the squad stands on a hive (or has drained it), the nearest other hive within this streams at rate.counter
    surge: { every: 40, len: 10, mul: 1.8, assault: 1.8 },                   // periodic surges (liquid streams pour out), lulls between
    brute: { every: 9, n: 1 },                                   // Berserk: per awake hive
    reserve: { base: 1500, perHive: 120, refill: 15 }, // assault-wave reserve per hive (aliens hatched, counted) and its refill per second
    contested: 16,           // a hive with marines on it keeps hatching this many per second x ramp (structures stops it; we pump)
    contestedBurst: 10,      // ... in clutches of this many at the rim
    dying: 0.25,             // a hive below this share of its hp hatches nothing more (no pump, no stream, no brutes)
    rim: { share: 1 },     // assault: when the hive mouth chokes, this share of the shortfall hatches at the rim facing the squad
    capLock: { hp: 0.35, stand: 20 },  // a hive's capture bar can't complete until its hp < 35% or the squad stood on it 20 s
    push: { engaged: 3, step: 150, near: 300, stop: 230, crowdR: 170, crowd: 14 },  // attack-move assist: engaged this long -> step toward the hive
    hiveFireDelay: 0.6,      // fallback: a marine idle next to a hive this long starts shooting it (see hiveFire)
    hiveFireBusy: 0.6,       // ... and at this fraction of its cadence while also fighting aliens, when the hive is its objective
    // fortification (mission rule on top of structures' own armor): the share of each hp loss that sticks on player
    // bases / turrets, repair once a structure has taken no damage for `calm` seconds, and (until the Regrowth
    // mutation) the floor a base's hp can't be pushed below, so only Regrowth re-infests captured ground
    fort: { base: 0.35, turret: 0.35, repair: 12, turretRepair: 5, calm: 4, floor: 0.15 },
    baseHeal: { r: 320, hps: 6 },      // marines standing by a player base patch up (the base also refills ammo, marines.js)
    special: { cost: 2, r: 150, dmg: 60, reach: 480, cooldown: 12 },   // the HUD special weapon: an orbital strike
    dialogueDelay: 2,        // the opening commander line waits this long
    dialogueDur: 5,          // commander lines auto-dismiss after this many seconds
  };
  const DIFF = { easy: 0.75, normal: 1, hard: 1.35 };
  const COST = { turret: 3, barricade: 1, swap: { rifle: 1, sniper: 3, fusion: 3, rocket: 4, medic: 2 } };
  const CYCLE = ['rifle', 'sniper', 'fusion', 'rocket', 'medic'];
  const LABEL = { rifle: 'RIFLE', sniper: 'SNIPER', fusion: 'FUSION', rocket: 'ROCKET', medic: 'MEDIC' };
  const SHEET = { sniper: 'sniper', fusion: 'fusion', medic: 'medic' };
  // the five mutations (Infested Planet's design); names are what the HUD rail shows
  const MUTATIONS = {
    fast: { name: 'Fast', desc: 'Aliens move 40% faster.' },
    armored: { name: 'Armored', desc: 'Thickened carapace: aliens have double hit points.' },
    spitters: { name: 'Spitters', desc: 'Hives breed acid spitters that attack from range.' },
    regrowth: { name: 'Regrowth', desc: 'Captured hives re-infest after 120 s unless a turret guards them.' },
    berserk: { name: 'Berserk', desc: 'Hives hatch hulking brutes.' },
  };
  const MUT_KEYS = Object.keys(MUTATIONS);
  const LINES = {
    start: 'Marines, this sector is crawling. Burn every hive and hold what you take. The swarm adapts, so move fast.',
    first: 'Hive down! That nest is our base now. Spend the build points on turrets before the swarm takes it back.',
    won: 'Sector clear. Every hive is ash. Bring them home, marines.',
    lost: 'Squad signal lost... All units, pull back.',
  };

  const has = (world, n) => !!(world.systems && world.systems.some((s) => s.name === n));
  const alive = (m) => m && m.state !== 'dead' && !(m.hp <= 0);
  const G = (world) => world.gameSys;

  // ------------------------------------------------------------------ state
  function fresh(world, o) {
    const rng = IP.fork(world, 'game');
    // mutation order: a seeded shuffle of the five (seed-stable, differs between seeds)
    const order = MUT_KEYS.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    // difficulty is a number (structures multiplies hive spawn rates by it); difficultyName is the label
    const dn = o && typeof o.difficulty === 'string' && DIFF[o.difficulty] ? o.difficulty : 'normal';
    const difficulty = o && typeof o.difficulty === 'number' && o.difficulty > 0 ? o.difficulty : DIFF[dn];
    const game = {
      difficulty, difficultyName: dn, bp: 0, mutations: [], time: 0, state: 'playing', objective: '',
      upgrades: {
        catalog: [
          { action: 'build', kind: 'turret', cost: COST.turret, label: 'Turret' },
          { action: 'build', kind: 'barricade', cost: COST.barricade, label: 'Barricade' },
        ].concat(CYCLE.map((c) => ({ action: 'upgrade', cls: c, cost: COST.swap[c], label: LABEL[c] }))),
        swaps: [], built: { turret: 0, barricade: 0 },
      },
      hives: { total: 0, captured: 0, left: 0 }, foothold: 'held', nextMutation: TUNE.mutationEvery,
      stats: { kills: 0, captures: 0, lost: 0 },
    };
    world.game = game;
    return {
      rng, order, mutIdx: 0, mods: { speed: 1, hp: 1 }, diff: difficulty,
      t0: 0, hiveIds: [], baseIds: [], capturedAt: {}, bpT: 0, bruteT: {}, idleNear: {}, fireCd: {},
      hpSeen: {}, calm: {}, reserve: {}, hatched: {}, hatchAcc: {}, rimAcc: {}, assaultId: -1, standT: {}, contAcc: {}, pushT: 0, pushGid: -1, step: null, pending: null, specialT: -99,
      firstCapture: false, dialogueT: -1, sayAt: null, plan: null, prefill: null, ended: false, ready: false, cmds: [],
    };
  }

  // ------------------------------------------------------------------ helpers
  function squadCentre(world) {
    let x = 0, y = 0, n = 0;
    for (const m of world.marines) if (alive(m)) { x += m.x; y += m.y; n++; }
    return n ? { x: x / n, y: y / n, n } : null;
  }
  function hud(world) { return world.hud || (world.hud = {}); }
  function alert(world, text, kind, dur) {
    if (IP.hud && IP.hud.alert) IP.hud.alert(world, text, { kind: kind || 'info', dur: dur || 2.8 });
    else hud(world).alert = { text, kind: kind || 'info', t: world.time, dur: dur || 2.8 };
  }
  function say(world, text) {
    const h = hud(world);
    // hud:true keeps the rest of the HUD on screen while the commander talks (the mission keeps running)
    h.dialogue = { portrait: 'commander', text, hud: true, t: world.time };
    const S = G(world); if (S) S.dialogueT = world.time;
    return h.dialogue;
  }
  function byId(world, id) {
    if (IP.structures && IP.structures.byId) return IP.structures.byId(world, id);
    return world.structures.find((s) => s.id === id) || null;
  }
  function playerBases(world) { return world.structures.filter((s) => !s.dead && s.kind === 'base' && s.owner === 'player'); }
  function nearestBase(world, x, y) {
    let best = null, bd = Infinity;
    for (const b of playerBases(world)) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
    return best;
  }
  function guarded(world, base) {
    for (const nid of base.nodeIds || []) {
      const n = byId(world, nid);
      if (!n || n.occupant == null) continue;
      const o = byId(world, n.occupant);
      if (o && !o.dead && o.kind === 'turret') return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ actions
  function build(world, kind, where) {
    const g = world.game;
    if (!IP.structures || !has(world, 'structures')) { alert(world, 'NO STRUCTURES SYSTEM', 'danger'); return null; }
    let target = where;
    if (target == null) {
      // the nearest free node to the squad (or the screen centre when the squad is gone)
      const c = squadCentre(world) || { x: world.camera.x, y: world.camera.y };
      let best = null, bd = 760;
      for (const s of world.structures) {
        if (s.dead || s.kind !== 'node' || s.owner !== 'player' || s.occupant != null) continue;
        const d = Math.hypot(s.x - c.x, s.y - c.y);
        if (d < bd) { bd = d; best = s; }
      }
      if (!best) { alert(world, 'NO FREE BUILD NODE NEAR THE SQUAD', 'danger'); return null; }
      target = best.id;
      if (!kind) kind = (world.bp || 0) >= COST.turret ? 'turret' : 'barricade';
    }
    kind = kind || 'turret';
    const s = IP.structures.build(world, kind, target);
    if (!s) { alert(world, String(IP.structures.lastError || 'cannot build').toUpperCase(), 'danger'); return null; }
    g.upgrades.built[kind] = (g.upgrades.built[kind] || 0) + 1;
    alert(world, kind.toUpperCase() + ' BUILT', 'good');
    return s;
  }

  function swap(world, who, cls, o) {
    o = o || {};
    const g = world.game;
    const m = typeof who === 'object' ? who : world.marines.find((q) => q.id === who);
    if (!alive(m)) { if (!o.quiet) alert(world, 'SELECT A MARINE TO RE-ARM', 'danger'); return false; }
    const W = IP.marines && IP.marines.WEAPONS && IP.marines.WEAPONS[cls];
    if (!W) return false;
    if (!cls || cls === m.cls) { if (!o.quiet) alert(world, LABEL[m.cls] + ' ALREADY ARMED', 'info'); return false; }
    const cost = o.free ? 0 : COST.swap[cls] || 2;
    if ((world.bp || 0) < cost) { if (!o.quiet) alert(world, 'NOT ENOUGH BP (' + cost + ')', 'danger'); return false; }
    world.bp -= cost;
    const from = m.cls;
    m.cls = cls;
    m.name = LABEL[cls];
    const dps = W.kind === 'fusion' ? W.dmg : W.dmg / W.cooldown;
    m.weapon = { kind: W.kind, range: W.range, dps: Math.round(dps * 10) / 10, cooldown: W.cooldown, ammo: world.ammo != null ? world.ammo : 1, maxAmmo: 1 };
    if (SHEET[cls]) m.sheet = SHEET[cls];
    else if (SHEET[from]) m.sheet = cls === 'rocket' ? 'rifle_b' : 'rifle_a';
    if (IP.assets && !IP.assets.sheet(m.sheet)) IP.assets.load(m.sheet);
    if (m._k) {
      const C = IP.marines.CLS && IP.marines.CLS[cls];
      if (C) m._k.speed = C.speed;
      m._k.target = null; m._k.cd = 0.4;
    }
    g.upgrades.swaps.push({ id: m.id, from, to: cls, t: g.time });
    if (!o.quiet) alert(world, LABEL[from] + ' RE-ARMED: ' + LABEL[cls], 'good');
    return true;
  }

  function retreat(world) {
    const ms = world.marines.filter(alive);
    const c = squadCentre(world);
    if (!c) return null;
    const b = nearestBase(world, c.x, c.y);
    if (!b) { alert(world, 'NO BASE TO RETREAT TO', 'danger'); return null; }
    // marines' own retreat order runs a little faster and keeps firing over the shoulder; a plain move otherwise
    if (IP.marines && IP.marines.retreat) IP.marines.retreat(world, ms);
    else if (IP.marines && IP.marines.order) IP.marines.order(world, 'move', b.x, b.y + b.r + 40, ms);
    alert(world, 'RETREAT: FALL BACK TO THE BASE', 'info');
    return b;
  }

  // the HUD special weapon: an orbital strike on the thickest knot of aliens near the squad
  function special(world) {
    const S = G(world), c = squadCentre(world), SP = TUNE.special;
    if (!c || !IP.swarm || !IP.swarm.inRadius || !has(world, 'swarm')) return false;
    const left = SP.cooldown - (world.time - S.specialT);
    if (left > 0) { alert(world, 'ORBITAL STRIKE RECHARGING (' + Math.ceil(left) + ' S)', 'danger'); return false; }
    if ((world.bp || 0) < SP.cost) { alert(world, 'NOT ENOUGH BP (' + SP.cost + ')', 'danger'); return false; }
    // aim: the alien within reach with the most neighbours (sampled, deterministic)
    let best = null, bn = 0, k = 0;
    IP.swarm.inRadius(world, c.x, c.y, SP.reach, (a) => {
      if ((k++ & 7) !== 0) return false;
      const n = IP.swarm.inRadius(world, a.x, a.y, SP.r * 0.8, () => false);
      if (n > bn) { bn = n; best = a; }
      return false;
    });
    if (!best) { alert(world, 'NO TARGET FOR THE STRIKE', 'danger'); return false; }
    world.bp -= SP.cost;
    S.specialT = world.time;
    const x = best.x, y = best.y, hit = [];
    IP.swarm.inRadius(world, x, y, SP.r, (a) => { hit.push(a); return false; });
    for (const a of hit) IP.swarm.damage(world, a, SP.dmg, 'strike');
    IP.emit(world, 'explosion', { x, y, r: SP.r, kind: 'rocket' });
    IP.emit(world, 'explosion', { x: x + 40, y: y - 30, r: SP.r * 0.6, kind: 'rocket' });
    IP.emit(world, 'explosion', { x: x - 36, y: y + 34, r: SP.r * 0.6, kind: 'rocket' });
    alert(world, 'ORBITAL STRIKE: ' + hit.length + ' HIT', 'good');
    return true;
  }

  function mutate(world, key) {
    const S = G(world), g = world.game;
    if (!S || !MUTATIONS[key] || g.mutations.some((m) => m.key === key)) return null;
    const def = MUTATIONS[key], mu = { key, name: def.name, desc: def.desc, t: g.time };
    g.mutations.push(mu);
    // apply to aliens already alive; new ones are processed in rules() as they appear
    if (key === 'fast') { S.mods.speed *= 1.4; for (const a of world.aliens) if (a && a.speed) a.speed *= 1.4; }
    if (key === 'armored') { S.mods.hp *= 2; for (const a of world.aliens) if (a && a.hp > 0) { a.hp *= 2; a.maxHp = (a.maxHp || a.hp) * 2; } }
    IP.emit(world, 'mutation', { name: def.name, desc: def.desc, key });
    alert(world, 'ALIEN MUTATION: ' + def.name.toUpperCase(), 'danger', 3.2);
    return mu;
  }

  function onUi(world, e) {
    const g = world.game, S = G(world), fl = world.flags || (world.flags = {});
    const a = e.action;
    if (g.state !== 'playing' && a !== 'dialogue-next') return;
    if (a === 'build' && e.kind == null && e.node == null && e.x == null) {
      // the HUD's build toggle: structures builds on the next tap on a free node while world.flags.buildMode is on
      if (e.on) {
        if (!fl.buildKind) fl.buildKind = 'turret';
        const c = COST[fl.buildKind] || (IP.structures && IP.structures.COST && IP.structures.COST[fl.buildKind]) || '?';
        alert(world, 'BUILD: TAP A FREE YELLOW NODE (' + String(fl.buildKind).toUpperCase() + ' ' + c + ' BP)', 'info', 2.4);
      }
    } else if (a === 'build' || a === 'build-turret' || a === 'build-barricade') {
      const kind = e.kind || (a === 'build-turret' ? 'turret' : a === 'build-barricade' ? 'barricade' : null);
      const where = e.node != null ? e.node : e.x != null ? { x: e.x, y: e.y } : null;
      build(world, kind, where);
    } else if (a === 'research' || a === 'upgrade') {
      let m = e.id != null ? world.marines.find((q) => q.id === e.id) : null;
      if (!m) m = world.marines.find((q) => alive(q) && world.selection && world.selection.has(q.id));
      const cls = e.cls || (m ? CYCLE[(CYCLE.indexOf(m.cls) + 1) % CYCLE.length] : null);
      if (e.on === true && !e.cls) {
        // the HUD's research toggle: first press previews the swap, the second press (toggle off) confirms it
        if (!alive(m)) { alert(world, 'RESEARCH: SELECT A MARINE TO RE-ARM', 'info', 2.4); S.pending = null; }
        else {
          S.pending = { id: m.id, cls, t: world.time };
          alert(world, 'RE-ARM ' + LABEL[m.cls] + ' > ' + LABEL[cls] + ' (' + (COST.swap[cls] || 2) + ' BP): PRESS AGAIN', 'info', 4);
        }
      } else if (e.on === false && !e.cls) {
        const P = S.pending; S.pending = null;
        if (P && world.time - P.t < 8) swap(world, P.id, P.cls);
      } else swap(world, m, cls);
      if (e.on !== true) fl.research = false;
    } else if (a === 'retreat' || a === 'regroup') {
      retreat(world);
    } else if (a === 'weapon' || a === 'special' || a === 'strike') {
      if (e.on !== false) special(world);
      fl.special = false;
    } else if (a === 'dialogue-next') {
      // from a script (IP.game.command): close the commander line ourselves. The HUD's own click path has already
      // advanced its queue before it emits this, so we must not clear whatever line it moved on to.
      if (e._cmd) { const h = hud(world); if (h.dialogue && IP.hud && IP.hud.close) IP.hud.close(world); h.dialogue = null; }
      if (S) S.dialogueT = -1;
    }
  }

  // ------------------------------------------------------------------ the rules (runs after structures, before vfx/hud)
  function rules(world, dt) {
    const S = G(world), g = world.game;
    if (!S || !g || !S.ready) return;
    g.time = S.t0 + world.time;
    const diff = S.diff;

    // queued commands (IP.game.command: scripts and tests; world.events is cleared at the start of every tick)
    while (S.cmds.length) onUi(world, S.cmds.shift());
    // events from this tick (HUD 'ui' presses, kills)
    const ev = world.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'ui') onUi(world, e);
      else if (e.type === 'alien-died') g.stats.kills++;
    }

    // captures and losses by state diff, so every path pays the same (play, turret fire, IP.structures.capture between ticks)
    const hiveBp = (IP.structures && IP.structures.DEF && IP.structures.DEF.hive && IP.structures.DEF.hive.bp) || 0;
    let captured = 0;
    for (const id of S.hiveIds) {
      const s = byId(world, id);
      const ours = !!(s && !s.dead && s.kind === 'base' && s.owner === 'player');
      if (ours) captured++;
      if (ours && S.capturedAt[id] == null) {
        S.capturedAt[id] = g.time;
        world.bp = (world.bp || 0) + Math.max(0, TUNE.bpPerHive - hiveBp);
        g.stats.captures++;
        if (g.state === 'playing') {
          if (!S.firstCapture) { S.firstCapture = true; say(world, LINES.first); }
          else alert(world, 'HIVE CAPTURED  +' + TUNE.bpPerHive + ' BP', 'good', 2.6);
        }
      } else if (!ours && S.capturedAt[id] != null) {
        delete S.capturedAt[id];
        g.stats.lost++;
        if (g.state === 'playing') alert(world, 'HIVE RE-INFESTED', 'danger', 3);
      }
    }
    // the landing zone is tracked on its own (never counted as a hive): lost -> an alert and it spawns until retaken
    const fb = S.baseIds.length ? byId(world, S.baseIds[0]) : null;
    if (fb) {
      const held = !fb.dead && fb.kind === 'base' && fb.owner === 'player';
      if (g.foothold === 'held' && !held) { g.foothold = 'lost'; if (g.state === 'playing') alert(world, 'LANDING ZONE OVERRUN', 'danger', 3.4); }
      else if (g.foothold === 'lost' && held) { g.foothold = 'held'; if (g.state === 'playing') alert(world, 'LANDING ZONE RETAKEN', 'good', 2.6); }
    }
    const hives = [];
    for (const s of world.structures) if (!s.dead && s.kind === 'hive') hives.push(s);
    g.hives.total = S.hiveIds.length; g.hives.captured = captured; g.hives.left = hives.length;

    if (g.state === 'playing') {
      // BP trickle
      S.bpT += dt;
      if (S.bpT >= TUNE.bpEvery) { S.bpT -= TUNE.bpEvery; world.bp = (world.bp || 0) + TUNE.bpTrickle; }
      // mutations
      if (g.time >= g.nextMutation) {
        g.nextMutation += TUNE.mutationEvery;
        while (S.mutIdx < S.order.length && g.mutations.some((m) => m.key === S.order[S.mutIdx])) S.mutIdx++;
        if (S.mutIdx < S.order.length) mutate(world, S.order[S.mutIdx++]);
      }
      // Regrowth: unguarded captured hives re-infest (structures reverts a base whose hp hits 0; the diff above logs it)
      const regrowth = g.mutations.some((m) => m.key === 'regrowth');
      if (regrowth) {
        for (const id in S.capturedAt) {
          const b = byId(world, +id);
          if (!b || b.kind !== 'base' || !(b.hp > 0)) continue;
          if (g.time - S.capturedAt[id] < TUNE.regrowAfter) continue;
          if (guarded(world, b)) continue;
          b.hp = 0; b.lastHp = 0; b.shieldUntil = -1;
        }
      }
      fortify(world, S, dt);
      // without Regrowth the swarm can batter a base but not re-infest it: it holds at TUNE.fort.floor of its hp
      if (!regrowth) for (const b of world.structures) {
        if (b.dead || b.kind !== 'base' || b.owner !== 'player' || !(b.hp > 0)) continue;
        const fl = b.maxHp * TUNE.fort.floor;
        if (b.hp < fl) { b.hp = fl; b.lastHp = fl; S.hpSeen[b.id] = fl; }
      }
      baseHeal(world, dt);
      capLock(world, S, hives, dt);
      newborns(world, S, hives);
      spawnControl(world, S, g, hives, captured, diff, dt);
      pushAssist(world, S, hives, dt);
      hiveFire(world, S, hives, dt);
      // win / lose
      if (S.hiveIds.length && !hives.length) end(world, 'won');
      else if (world.marines.length && !world.marines.some(alive)) end(world, 'lost');
    } else {
      for (const h of hives) if (h.spawn) h.spawn.rate = 0;
    }

    // mutation mods on aliens born since last tick (new aliens are appended; compaction keeps order)
    const A = world.aliens;
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i];
      if (!a || a._gm) break;
      a._gm = 1;
      if (S.mods.speed !== 1 && a.speed) a.speed *= S.mods.speed;
      if (S.mods.hp !== 1 && a.hp > 0) { a.hp *= S.mods.hp; a.maxHp = (a.maxHp || a.hp) * S.mods.hp; }
    }

    // commander lines: the opening line waits TUNE.dialogueDelay, every line auto-dismisses after TUNE.dialogueDur
    const h = hud(world);
    if (S.sayAt && world.time >= S.sayAt.t) { say(world, S.sayAt.text); S.sayAt = null; }
    if (h.dialogue && S.dialogueT >= 0 && world.time - S.dialogueT > TUNE.dialogueDur && h.dialogue.portrait === 'commander') { h.dialogue = null; S.dialogueT = -1; }

    // HUD-facing model
    g.bp = world.bp || 0;
    const left = Math.max(0, g.nextMutation - g.time);
    const mm = (left / 60) | 0, ss = (left | 0) % 60;
    g.objective = g.state === 'won' ? 'Mission complete: every hive destroyed'
      : g.state === 'lost' ? 'Mission failed: the squad is down'
      : 'Destroy the hives  ' + captured + ' / ' + g.hives.total + (g.foothold === 'lost' ? '   ·   retake the landing zone' : '')
        + (S.mutIdx < S.order.length ? '   ·   mutation in ' + mm + ':' + (ss < 10 ? '0' : '') + ss : '');
    h.objective = g.objective;
    h.mutations = g.mutations;
  }

  // Fortification: player bases and turrets keep only TUNE.fort.{base,turret} of each hp loss (on top of structures' own
  // base armor), and repair once they have gone TUNE.fort.calm seconds without a hit. lastHp is kept in step so structures
  // does not read our repair as damage.
  function fortify(world, S, dt) {
    const F = TUNE.fort;
    for (const s of world.structures) {
      if (s.dead || s.owner !== 'player' || (s.kind !== 'base' && s.kind !== 'turret')) continue;
      const keep = s.kind === 'base' ? F.base : F.turret;
      const prev = S.hpSeen[s.id];
      if (prev != null && s.hp < prev && s.hp > 0) {
        s.hp = prev - (prev - s.hp) * keep; s.lastHp = s.hp; S.calm[s.id] = 0;
      } else {
        S.calm[s.id] = (S.calm[s.id] || 0) + dt;
        if (S.calm[s.id] >= F.calm && s.hp > 0 && s.hp < s.maxHp) {
          s.hp = Math.min(s.maxHp, s.hp + (s.kind === 'base' ? F.repair : F.turretRepair) * dt); s.lastHp = s.hp;
        }
      }
      S.hpSeen[s.id] = s.hp;
    }
  }

  // Field hospital: a living marine within TUNE.baseHeal.r of a player base regains TUNE.baseHeal.hps.
  function baseHeal(world, dt) {
    const B = TUNE.baseHeal;
    let bases = null;
    for (const m of world.marines) {
      if (!alive(m) || m.hp >= m.maxHp) continue;
      if (!bases) bases = playerBases(world);
      for (const b of bases) if (Math.hypot(b.x - m.x, b.y - m.y) < B.r) { m.hp = Math.min(m.maxHp, m.hp + B.hps * dt); break; }
    }
  }

  // Taking a hive is a fight: its capture bar can't complete until its hp is below TUNE.capLock.hp of max or the squad
  // has stood on it TUNE.capLock.stand seconds (the bar creeps up meanwhile so the player sees the progress).
  function capLock(world, S, hives, dt) {
    const L = TUNE.capLock;
    for (const h of hives) {
      const st = (S.standT[h.id] = h.capN > 0 ? (S.standT[h.id] || 0) + dt : Math.max(0, (S.standT[h.id] || 0) - dt * 0.5));
      const open = h.hp < h.maxHp * L.hp || st >= L.stand;
      h.capLock = !open;
      if (!open && h.capP > 0) h.capP = Math.min(h.capP, 0.95 * (st / L.stand));
    }
  }

  // Attack-move assist: marines' attack-move halts the whole group while anything is in reach, so a hive that never
  // stops pumping would hold the squad at arm's length forever. When the living squad is on one attack-move order whose
  // point is on an alien hive and it has been fighting TUNE.push.engaged seconds, it takes a short step (TUNE.push.step px)
  // toward the hive, still firing, then resumes the attack-move: the squad grinds forward through the stream. Within
  // TUNE.push.stop of the hive the last step is onto the hive itself (to stand on it and take it).
  function pushAssist(world, S, hives, dt) {
    if (!IP.marines || !IP.marines.order || !hives.length) return;
    const P = TUNE.push;
    const ms = world.marines.filter(alive);
    if (!ms.length) { S.step = null; return; }
    // a step in progress: once every marine has arrived (orders cleared), resume the attack-move on the hive
    if (S.step) {
      const hv = byId(world, S.step.hive);
      const busy = ms.some((m) => m.order && m.order.gid === S.step.gid);
      const other = ms.some((m) => m.order && m.order.gid !== S.step.gid);
      if (other || !hv || hv.kind !== 'hive') { S.step = null; return; }
      if (busy && world.time - S.step.t < 4) return;
      const last = S.step.last;
      S.step = null;
      if (!last) { const r = IP.marines.order(world, 'attack-move', hv.x, hv.y, ms); if (r && r[0]) S.pushGid = r[0].order.gid; }
      S.pushT = 0;
      return;
    }
    let o = null, fighting = false;
    for (const m of ms) {
      if (!m.order) continue;
      if (m.order.type !== 'attack-move' || (o && m.order.gid !== o.gid)) { S.pushT = 0; return; }
      o = m.order;
      if (m.targetId != null) fighting = true;
    }
    if (!o) { S.pushT = 0; return; }
    if (S.pushGid !== o.gid) { S.pushGid = o.gid; S.pushT = 0; }
    const gx = o.gx != null ? o.gx : o.x, gy = o.gy != null ? o.gy : o.y;
    let hv = null, bd = P.near;
    for (const h of hives) { const d = Math.hypot(h.x - gx, h.y - gy); if (d < bd) { bd = d; hv = h; } }
    if (!hv) { S.pushT = 0; return; }
    const c = squadCentre(world);
    const dist = Math.hypot(c.x - hv.x, c.y - hv.y);
    if (dist < 60) { S.pushT = 0; return; }
    S.pushT = fighting ? S.pushT + dt : Math.max(0, S.pushT - dt);
    if (S.pushT < P.engaged) return;
    // never step into a crowd: while more than P.crowd aliens are within P.crowdR of the squad it holds and shoots
    if (IP.swarm && IP.swarm.inRadius && has(world, 'swarm') && IP.swarm.inRadius(world, c.x, c.y, P.crowdR, () => false) > P.crowd) return;
    S.pushT = 0;
    const last = dist < P.stop;
    const k = last ? 1 : Math.min(1, P.step / dist);
    const tx = c.x + (hv.x - c.x) * k, ty = c.y + (hv.y - c.y) * k;
    const r = IP.marines.order(world, 'move', tx, ty, ms.filter((m) => m.order));
    if (r && r[0]) S.step = { hive: hv.id, gid: r[0].order.gid, t: world.time, last };
  }

  // Which hive the squad is attacking: the hive its order (attack-move / move, or the push-assist step) is on, while the
  // squad centre is within TUNE.assaultR of it; with no order on a hive, the hive nearest the squad centre within
  // TUNE.nearR. Only that hive spends its assault reserve: a neighbour a stray marine wanders near does not bleed out.
  function attackedHive(world, S, hives, c) {
    if (!c || !hives.length) return null;
    let tgt = null;
    if (S.step) { const hv = byId(world, S.step.hive); if (hv && !hv.dead && hv.kind === 'hive') tgt = hv; }
    if (!tgt) {
      for (const m of world.marines) {
        if (!alive(m) || !m.order || (m.order.type !== 'attack-move' && m.order.type !== 'move')) continue;
        const o = m.order, gx = o.gx != null ? o.gx : o.x, gy = o.gy != null ? o.gy : o.y;
        for (const h of hives) if (Math.hypot(h.x - gx, h.y - gy) < TUNE.push.near) { tgt = h; break; }
        if (tgt) break;
      }
    }
    if (tgt && Math.hypot(tgt.x - c.x, tgt.y - c.y) < TUNE.assaultR) return tgt;
    let best = null, bd = TUNE.nearR;
    for (const h of hives) { const d = Math.hypot(h.x - c.x, h.y - c.y); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  // Aliens born since the last tick (appended at the tail; swarm's compaction keeps order) are counted against the hive
  // they hatched at, so the assault reserve is spent by what actually came out, not by the nominal rate.
  function newborns(world, S, hives) {
    const A = world.aliens;
    for (let i = A.length - 1; i >= 0; i--) {
      const a = A[i];
      if (!a || a._gh) break;
      a._gh = 1;
      for (const h of hives) {
        const dx = a.x - h.x, dy = a.y - h.y, rr = h.r * 2.2;
        if (dx * dx + dy * dy < rr * rr) { S.hatched[h.id] = (S.hatched[h.id] || 0) + 1; break; }
      }
    }
  }
  function markBorn(world) { for (const a of world.aliens) if (a) a._gh = 1; }

  function spawnControl(world, S, g, hives, captured, diff, dt) {
    const P = TUNE.pressure;
    const target = Math.min(P.max, (P.base + P.perHive * captured) * diff);
    const live = IP.count ? IP.count(world.aliens) : world.aliens.length;
    // soft cap: rates fade to 0 as the live count climbs past the target
    const over = Math.max(0, live - target), fade = Math.max(0, 1 - over / P.soft);
    const under = live < target * 0.5 ? 1.5 : 1;    // refill quickly after a big wipe
    const surging = g.time % TUNE.surge.every < TUNE.surge.len;
    const surge = surging ? TUNE.surge.mul : 1, surgeA = surging ? TUNE.surge.assault : 1;
    const ramp = (1 + TUNE.rate.perHive * captured) * diff;  // (berserk timer and pressure use it; rate divides diff back out)
    // a squad that has lost marines (or is badly hurt) faces a thinner swarm: it can still win back ground, as the bar's
    // missions allow. strength = the squad's living hp over its full hp.
    let hpNow = 0, hpAll = 0;
    for (const m of world.marines) { hpAll += m.maxHp || 0; if (alive(m)) hpNow += m.hp; }
    const thin = hpAll > 0 ? 0.3 + 0.7 * Math.min(1, hpNow / hpAll) : 1;
    // (Fast speeds every bug up, it does not add runners; Spitters adds one ranged spitter in eight, enough to change
    // how a fight plays without turning every stream into a firing line)
    const kinds = ['drone', 'drone', 'drone', 'drone', 'drone', 'drone', 'runner'];
    if (g.mutations.some((m) => m.key === 'spitters')) kinds.push('spitter');
    const berserk = g.mutations.some((m) => m.key === 'berserk');
    const swarmOn = !!(IP.swarm && IP.swarm.spawn && has(world, 'swarm'));
    // tougher bugs (Armored, Fast) come in proportionally smaller numbers, so a mutation changes the fight, not the odds
    const tough = Math.sqrt(S.mods.hp) * Math.pow(S.mods.speed, 0.66);
    // a hive wakes up (pumps at the awake rate) only while a marine is within TUNE.awakeR of THAT hive; the rest only
    // trickle, so the density is where the squad is and a base the squad left behind erodes slowly instead of being swamped
    const hunters = [];
    for (const m of world.marines) if (alive(m)) hunters.push(m);
    const c = squadCentre(world);
    const atk = attackedHive(world, S, hives, c);
    S.assaultId = atk ? atk.id : -1;
    const R = TUNE.reserve, cap = R.base + R.perHive * captured;
    // counter-attack: once the squad is at the hive (within TUNE.counterNear or on it), the nearest other hive answers with a stream of its own (not from
    // its reserve), so taking a hive is a fight on two fronts instead of a stand in the open
    let counter = null;
    if (atk && c && (atk.capN > 0 || Math.hypot(atk.x - c.x, atk.y - c.y) < TUNE.counterNear) && atk.hp > atk.maxHp * TUNE.dying) {
      let bd = TUNE.counterR;
      for (const h of hives) { if (h === atk) continue; const d = Math.hypot(h.x - c.x, h.y - c.y); if (d < bd) { bd = d; counter = h; } }
    }
    S.counterId = counter ? counter.id : -1;
    for (const h of hives) {
      let d = Infinity;
      for (const q of hunters) { const dd = Math.hypot(q.x - h.x, q.y - h.y); if (dd < d) d = dd; }
      const awake = d < TUNE.awakeR;
      // the assault wave: the hive under attack pours its reserve out at the assault rate for the whole approach (a
      // flood the squad has to grind through), debited by the aliens it actually hatched; every reserve refills
      // TUNE.reserve.refill per second, so a drained hive keeps streaming at about that rate
      let res = S.reserve[h.id] == null ? cap : S.reserve[h.id];
      const born = S.hatched[h.id] || 0;
      S.hatched[h.id] = 0;
      if (h === atk) res -= born;
      res = Math.min(cap, res + R.refill * dt);
      S.reserve[h.id] = res;
      // a dying hive (below TUNE.dying of its hp) gives up: it hatches nothing, so the squad can walk in and take it
      const dying = h.hp < h.maxHp * TUNE.dying;
      const assault = h === atk && res > 0 && h.capN === 0 && !dying;
      const base = dying ? 0 : assault ? TUNE.rate.assault : h === counter ? TUNE.rate.counter : awake ? TUNE.rate.awake : TUNE.rate.asleep;
      if (!h.spawn) h.spawn = { kinds, rate: 0, burst: 5 };
      h.spawn.kinds = kinds;
      h.spawn.burst = awake || h === counter ? 5 : 3;
      // (surges swell the assault wave less than the background streams; the after-a-wipe boost is for the background only)
      h.spawn.rate = (base * ramp * (assault ? surgeA : surge * under) * fade * thin) / diff / tough;   // structures multiplies by difficulty
      // the mouth chokes when the crowd at it is thick (swarm refuses occupied spots): the shortfall hatches out of
      // the rim on the side facing the squad, so the wave stays a stream instead of a puff
      if (assault && swarmOn && c) {
        const want = h.spawn.rate * diff;
        const prev = S.hatchAcc[h.id] == null ? want : S.hatchAcc[h.id];
        const ema = (S.hatchAcc[h.id] = prev + (born / dt - prev) * dt);   // hatched per second, ~1 s smoothing
        const short = Math.max(0, want - ema) * TUNE.rim.share;
        S.rimAcc[h.id] = (S.rimAcc[h.id] || 0) + short * dt;
        if (S.rimAcc[h.id] >= 5) {
          S.rimAcc[h.id] -= 5;
          const a0 = Math.atan2(c.y - h.y, c.x - h.x), a = a0 + (S.rng() - 0.5) * 2.2, rd = h.r * (0.95 + 0.4 * S.rng());
          IP.swarm.spawn(world, { x: h.x + Math.cos(a) * rd, y: h.y + Math.sin(a) * rd, kind: kinds[(S.rng() * kinds.length) | 0], n: 5 });
          h.pulse = 1;
        }
      } else { S.rimAcc[h.id] = 0; S.hatchAcc[h.id] = null; }
      // structures stops a hive hatching while marines stand on it; we keep it fighting back with clutches out of the
      // rim, so taking it means clearing what it throws (each clutch contests the capture until it is shot)
      if (h.capN > 0 && !dying && swarmOn) {
        S.contAcc[h.id] = (S.contAcc[h.id] || 0) + (TUNE.contested * ramp * fade * thin * dt) / tough;
        const burst = TUNE.contestedBurst;
        if (S.contAcc[h.id] >= burst) {
          S.contAcc[h.id] -= burst;
          const a = S.rng() * TAU, rd = h.r * (0.6 + 0.4 * S.rng());
          IP.swarm.spawn(world, { x: h.x + Math.cos(a) * rd, y: h.y + Math.sin(a) * rd, kind: kinds[(S.rng() * kinds.length) | 0], n: burst });
          h.pulse = 1;
        }
      } else S.contAcc[h.id] = 0;
      if (berserk && awake && fade > 0 && !dying) {
        S.bruteT[h.id] = (S.bruteT[h.id] == null ? S.rng() * TUNE.brute.every : S.bruteT[h.id]) - dt;
        if (S.bruteT[h.id] <= 0) {
          S.bruteT[h.id] += TUNE.brute.every / Math.min(2, ramp);
          if (swarmOn) IP.swarm.spawn(world, { x: h.x, y: h.y + h.r * 0.3, kind: 'brute', n: TUNE.brute.n });
        }
      }
    }
  }

  // Hive fire. Fallback: a living marine with no target, standing within weapon range of an alien hive for
  // TUNE.hiveFireDelay, shoots the hive with its own weapon (marines.js targets hives itself when no alien is in reach;
  // then targetId is the hive and this stays out of it). Objective fire: a marine busy with aliens whose order (or
  // position) is on that hive also puts TUNE.hiveFireBusy of its cadence into the hive, so pushing through a stream
  // still wears the hive down.
  function hiveFire(world, S, hives, dt) {
    if (!hives.length || !IP.marines || !IP.marines.WEAPONS) return;
    const WS = IP.marines.WEAPONS;
    for (const m of world.marines) {
      if (!alive(m) || !m.weapon) continue;
      const W = WS[m.weapon.kind] || WS.rifle;
      const range = m.weapon.range || W.range;
      let best = null, bd = Infinity;
      for (const h of hives) {
        const d = Math.hypot(h.x - m.x, h.y - m.y) - h.r * 0.8;
        if (d < range && d < bd) { bd = d; best = h; }
      }
      if (!best || (m.targetId != null && m.targetId === best.id)) { S.idleNear[m.id] = 0; continue; }
      let rate = 1;
      if (m.targetId != null) {
        const o = m.order, gx = o && (o.gx != null ? o.gx : o.x), gy = o && (o.gy != null ? o.gy : o.y);
        const objective = (o && Math.hypot(gx - best.x, gy - best.y) < TUNE.push.near) || Math.hypot(m.x - best.x, m.y - best.y) < 200;
        if (!objective || W.kind === 'medic') { S.idleNear[m.id] = 0; continue; }
        rate = TUNE.hiveFireBusy;
      }
      if (IP.terrain && IP.terrain.los && has(world, 'terrain') && !IP.terrain.los(world, m.x, m.y, best.x, best.y)) { S.idleNear[m.id] = 0; continue; }
      S.idleNear[m.id] = (S.idleNear[m.id] || 0) + dt;
      if (S.idleNear[m.id] < TUNE.hiveFireDelay) continue;
      const ang = Math.atan2(best.y - m.y, best.x - m.x);
      if (m.targetId == null) {
        m.dir = ang;
        if (m._k) { m._k.aim = ang; m._k.lastShotT = world.time; }
      }
      S.fireCd[m.id] = (S.fireCd[m.id] || 0) - dt;
      if (S.fireCd[m.id] > 0) continue;
      if (world.ammo <= 0) rate *= 0.35;
      const fusion = W.kind === 'fusion';
      const cd = fusion ? 0.1 : W.cooldown;
      S.fireCd[m.id] = cd / rate;
      const dmg = fusion ? W.dmg * cd : W.dmg;
      const tx = best.x + (S.rng() - 0.5) * best.r, ty = best.y + (S.rng() - 0.5) * best.r;
      const mx = m.x + Math.cos(ang) * (W.muzzle || 20), my = m.y + Math.sin(ang) * (W.muzzle || 20);
      if (W.kind === 'rocket') {
        IP.emit(world, 'shot', { x: mx, y: my, tx, ty, weapon: 'rocket', hit: true, id: m.id });
        IP.emit(world, 'explosion', { x: tx, y: ty, r: W.splash || 60, kind: 'rocket' });
      } else if (!fusion || m.targetId == null) IP.emit(world, 'shot', { x: mx, y: my, tx, ty, weapon: W.kind, hit: true, id: m.id });
      if (m._k && m.targetId == null) m._k.atkT = 0;
      IP.structures.damage(world, best, dmg);
      if (m.targetId == null) world.ammo = Math.max(0, (world.ammo != null ? world.ammo : 1) - (fusion ? W.drain * cd : W.drain || 0));   // objective fire rides on the shots already paid for
    }
  }

  function end(world, state) {
    const g = world.game, S = G(world);
    if (g.state !== 'playing') return;
    g.state = state;
    if (state === 'won') { alert(world, 'MISSION COMPLETE: ALL HIVES DESTROYED', 'good', 6); say(world, LINES.won); }
    else { alert(world, 'MISSION FAILED: SQUAD LOST', 'danger', 6); say(world, LINES.lost); }
    S.ended = world.time;
  }

  // ------------------------------------------------------------------ mission setup (scenarios.js supplies cfg)
  // cfg = { biome, w, h, base:{x,y}, squad:{x,y}, hives:[{x,y,hp?,kinds?}], camera:{x,y,zoom}, terrain:{count,...},
  //         difficulty, bp }
  function setupMission(world, cfg) {
    const S = G(world);
    if (!S) return null;
    const W = cfg.w || 4000, H = cfg.h || 2800;
    world.map = { w: W, h: H };
    const keep = [{ x: cfg.base.x, y: cfg.base.y, r: 300 }, { x: cfg.squad.x, y: cfg.squad.y, r: 170 }]
      .concat(cfg.hives.map((h) => ({ x: h.x, y: h.y, r: 270 })))
      .concat(cfg.clear || []);
    if (IP.terrain && IP.terrain.generate && has(world, 'terrain')) {
      IP.terrain.generate(world, Object.assign({ biome: cfg.biome || 'basalt', w: W, h: H, seed: (cfg.terrainSeed != null ? cfg.terrainSeed : world.seed * 7919 + 17) >>> 0, keepClear: keep }, cfg.terrain || {}));
    }
    const free = (p) => (IP.terrain && IP.terrain.nearestFree && has(world, 'terrain') ? IP.terrain.nearestFree(world, p.x, p.y) : { x: p.x, y: p.y });
    world.bp = cfg.bp != null ? cfg.bp : TUNE.bpStart;
    if (has(world, 'structures') && IP.structures) {
      const bp0 = free(cfg.base);
      const base = IP.structures.add(world, 'base', bp0.x, bp0.y);
      base.state = 'active'; base.bornT = -10;
      S.baseIds.push(base.id);
      // the foothold comes with one turret (on the node facing the first hive)
      if (cfg.baseTurret !== false && base.nodeIds && base.nodeIds.length) {
        const k = cfg.baseTurretSlot != null ? cfg.baseTurretSlot : 1;
        const bp = world.bp; world.bp = 99;
        const t = IP.structures.build(world, 'turret', base.nodeIds[k]);
        world.bp = bp;
        if (t) t.aim = -Math.PI / 4;
      }
      const T = IP.terrain && has(world, 'terrain') ? IP.terrain : null;
      cfg.hives.forEach((hc, i) => {
        const p = free(hc);
        const hp = hc.hp || 1400;
        const h = IP.structures.add(world, 'hive', p.x, p.y, { hp, maxHp: hp, spawn: { kinds: hc.kinds || ['drone'], rate: 0, burst: 5 } });
        h.bornT = -10;
        h.creepR = hc.creep || 300;
        if (T && T.growCreep) { T.growCreep(world, h.x, h.y, h.creepR); h.creepGrown = true; }
        h.missionIndex = i;
        S.hiveIds.push(h.id);
      });
    }
    if (IP.marines && IP.marines.spawnSquad && has(world, 'marines')) {
      const sq = free(cfg.squad);
      IP.marines.spawnSquad(world, sq.x, sq.y, { dir: cfg.squad.dir != null ? cfg.squad.dir : -Math.PI / 4 });
    }
    world.camera = Object.assign({ zoom: 1 }, cfg.camera || { x: cfg.squad.x, y: cfg.squad.y });
    world.game.hives.total = S.hiveIds.length;
    S.prefill = cfg.prefill || null;
    S.squadAt = { x: cfg.squad.x, y: cfg.squad.y };
    return world.game;
  }

  // ------------------------------------------------------------------ scripted fast-forward (mid / late scenarios)
  // plan = { t0 (game seconds already played), captured:[hive index], turrets:[[hive index, slot]], mutations:[keys] | n,
  //          bp, squad:{x, y, attack: hive index | {x,y}, hp:[fractions], dead:[squad index], swaps:[[squad index, cls]]},
  //          camera, prefill:[{from: hive index, n, to:{x,y}?}], warm (seconds of real sim run in start()) }
  function applyPlan(world, plan) {
    const S = G(world), g = world.game;
    if (!S) return;
    S.plan = plan;
    S.t0 = plan.t0 || 0;
    g.time = S.t0;
    g.nextMutation = (Math.floor(S.t0 / TUNE.mutationEvery) + 1) * TUNE.mutationEvery;
    const T = IP.terrain && has(world, 'terrain') ? IP.terrain : null;
    for (const i of plan.captured || []) {
      const h = byId(world, S.hiveIds[i]);
      if (!h || h.kind !== 'hive' || !IP.structures) continue;
      IP.structures.capture(world, h);
      h.state = 'active'; h.bornT = -10; h.shieldUntil = -1; h.creepFade = 0;
      if (T && T.setCreep) T.setCreep(world, h.x, h.y, 0);
      for (const nid of h.nodeIds || []) { const n = byId(world, nid); if (n) n.bornT = -10; }
      S.capturedAt[h.id] = S.t0 - (plan.capturedAgo || 40);
      S.firstCapture = true;
    }
    world.events.length = 0;                 // the setup's capture events are history, not news
    for (const [i, slot] of plan.turrets || []) {
      const b = byId(world, S.hiveIds[i]);
      if (!b || b.kind !== 'base' || !b.nodeIds) continue;
      const bp = world.bp; world.bp = 99;
      const t = IP.structures.build(world, 'turret', b.nodeIds[slot]);
      world.bp = bp;
      if (t) { t.bornT = -10; g.upgrades.built.turret++; }
    }
    const muts = typeof plan.mutations === 'number' ? S.order.slice(0, plan.mutations) : plan.mutations || [];
    for (const k of muts) { mutate(world, k); const mu = g.mutations[g.mutations.length - 1]; if (mu) mu.t = S.t0 - 5; }
    S.mutIdx = 0;
    world.events.length = 0;
    if (hud(world)) hud(world).alert = null;
    if (plan.bp != null) world.bp = plan.bp;
    const sq = plan.squad;
    if (sq) {
      const ms = world.marines;
      const free = (x, y) => (T && T.nearestFree ? T.nearestFree(world, x, y) : { x, y });
      ms.forEach((m, i) => {
        const a = (i / ms.length) * TAU - Math.PI / 2;
        const p = free(sq.x + Math.cos(a) * 56, sq.y + Math.sin(a) * 56);
        m.x = p.x; m.y = p.y;
        if (sq.hp && sq.hp[i] != null) m.hp = Math.max(1, Math.round(m.maxHp * sq.hp[i]));
      });
      for (const [i, cls] of sq.swaps || []) if (ms[i]) swap(world, ms[i], cls, { free: true, quiet: true });
      for (const i of sq.dead || []) if (ms[i]) { ms[i].hp = 0; ms[i].state = 'dead'; ms[i].order = null; world.selection.delete(ms[i].id); ms[i].selected = false; }
    }
    if (plan.camera) world.camera = Object.assign({ zoom: 1 }, plan.camera);
  }

  function attackPoint(world, S, a) {
    if (a == null) return null;
    if (typeof a === 'object') return a;
    const h = byId(world, S.hiveIds[a]);
    return h ? { x: h.x, y: h.y } : null;
  }

  // streams already on their way: aliens strung along the line from each source hive toward a point (the squad)
  // list = [{from: hive index, n, lat (lateral spread px), reach (0..1 of the way), u0 (start fraction), to:{x,y}?, brutes, kinds?}]
  function prefill(world, S, list, to0) {
    if (!list || !IP.swarm || !IP.swarm.spawn || !has(world, 'swarm')) return;
    if (IP.swarm.rebuildPassability && world.swarm && !world.swarm.sdf) IP.swarm.rebuildPassability(world);
    const T = IP.terrain && has(world, 'terrain') ? IP.terrain : null;
    const kinds = ['drone', 'drone', 'drone', 'runner'];
    const g = world.game;
    if (g.mutations.some((m) => m.key === 'spitters')) kinds.push('spitter');
    for (const pf of list) {
      const h = byId(world, S.hiveIds[pf.from]);
      if (!h) continue;
      const to = pf.to || to0;
      // follow the terrain: walk the flow field from the hive toward the target, so a stream bends round rock
      const path = [{ x: h.x, y: h.y }];
      const fl = T && T.flowTo ? T.flowTo(world, to.x, to.y) : null;
      let px = h.x, py = h.y;
      for (let k = 0; k < 400; k++) {
        const d = fl && fl.dir ? fl.dir(px, py) : null;
        let dx = to.x - px, dy = to.y - py; const L = Math.hypot(dx, dy);
        if (L < 30) break;
        if (d && (d[0] || d[1])) { dx = d[0]; dy = d[1]; } else { dx /= L; dy /= L; }
        px += dx * 12; py += dy * 12;
        path.push({ x: px, y: py });
      }
      path.push({ x: to.x, y: to.y });
      const len = [0];
      for (let k = 1; k < path.length; k++) len.push(len[k - 1] + Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
      const total = len[len.length - 1] || 1;
      const at = (u) => {
        const want = u * total; let k = 1;
        while (k < len.length - 1 && len[k] < want) k++;
        const a = path[k - 1], b = path[k], f = (want - len[k - 1]) / Math.max(1e-6, len[k] - len[k - 1]);
        const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, ll = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x, y, nx: -(b.y - a.y) / ll, ny: (b.x - a.x) / ll };
      };
      const u0 = pf.u0 != null ? pf.u0 : 0.06, reach = pf.reach || 0.6;
      // clutches along the path (the swarm packs n > 1 into one clutch), loners in the gaps
      let left = pf.n;
      while (left > 0) {
        const u = u0 + reach * S.rng(), lat = (S.rng() + S.rng() + S.rng() - 1.5) * (pf.lat || 60);
        const p = at(Math.min(1, u)), n = Math.min(left, 1 + ((S.rng() * 6) | 0));
        const ks = pf.kinds || kinds;
        IP.swarm.spawn(world, { x: p.x + p.nx * lat, y: p.y + p.ny * lat, kind: ks[(S.rng() * ks.length) | 0], n, spread: 10 + n * 2 });
        left -= n;
      }
      if (pf.brutes) { const p = at(u0 + reach * 0.5); IP.swarm.spawn(world, { x: p.x, y: p.y, kind: 'brute', n: pf.brutes }); }
    }
  }

  async function fastForward(world) {
    const S = G(world), plan = S.plan;
    if (!plan) return;
    if (IP.assets && IP.assets.ready) await IP.assets.ready();
    prefill(world, S, plan.prefill, plan.squad);
    markBorn(world);
    const sq = plan.squad;
    const tgt = sq && attackPoint(world, S, sq.attack);
    if (tgt && IP.marines && IP.marines.order) IP.marines.order(world, 'attack-move', tgt.x, tgt.y, world.marines.filter(alive));
    const ticks = Math.round((plan.warm || 0) * 60);
    for (let i = 0; i < ticks; i++) {
      IP.tick();
      if (plan.immortal) for (const m of world.marines) if (alive(m) && m.hp < m.maxHp * 0.3) m.hp = m.maxHp * 0.3;
      if (plan.follow && i % 6 === 0) { const c = squadCentre(world); if (c) { world.camera.x += (c.x + (plan.follow.dx || 0) - world.camera.x) * 0.2; world.camera.y += (c.y + (plan.follow.dy || 0) - world.camera.y) * 0.2; } }
    }
    if (plan.camera && !plan.follow) Object.assign(world.camera, plan.camera);
    if (IP.clampCamera) IP.clampCamera(world);
  }

  // ------------------------------------------------------------------ system
  function placeRules(world) {
    const R = { name: 'game-rules', update: rules };
    const L = world.systems;
    let at = -1;
    for (const n of ['structures', 'marines', 'swarm', 'terrain']) { at = L.findIndex((s) => s.name === n); if (at >= 0) break; }
    if (at < 0) { at = L.findIndex((s) => s.name === 'vfx' || s.name === 'hud'); at = at < 0 ? L.length : at; L.splice(at, 0, R); }
    else L.splice(at + 1, 0, R);
  }

  IP.registerSystem('game', {
    init(world) {
      // the engine iterates world.systems while calling init; splicing in front of us re-yields this system once
      if (world.gameSys && world.systems.some((s) => s.name === 'game-rules')) return;
      world.gameSys = fresh(world, world.opts);
      placeRules(world);
    },
    async start(world) {
      const S = G(world);
      if (!S || !world.game) return;
      S.ready = true;
      if (S.plan) await fastForward(world);
      else {
        if (S.prefill) prefill(world, S, S.prefill, S.squadAt);
        markBorn(world);
        if (S.hiveIds.length && world.game.state === 'playing' && S.sayStart !== false) S.sayAt = { t: TUNE.dialogueDelay, text: LINES.start };
      }
      rules(world, 0);  // the HUD model is filled before the first frame
    },
    drawHud(world, ctx) {
      const g = world.game, S = G(world);
      if (!g || !S || g.state === 'playing' || S.ended === false) return;
      const t = Math.min(1, (world.time - S.ended) / 0.6);
      ctx.save();
      ctx.globalAlpha = t;
      ctx.fillStyle = 'rgba(4,10,16,0.55)';
      ctx.fillRect(0, 430, 1920, 120);
      ctx.font = '700 64px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
      ctx.fillStyle = g.state === 'won' ? '#5ff0a0' : '#ff5f5f';
      ctx.fillText(g.state === 'won' ? 'MISSION COMPLETE' : 'MISSION FAILED', 960, 490);
      ctx.restore();
    },
  });

  IP.game = {
    TUNE, COST, MUTATIONS, DIFF, LINES,
    setupMission, applyPlan,
    build: (world, kind, where) => build(world, kind, where),
    swap: (world, who, cls, o) => swap(world, who, cls, o),
    special: (world) => special(world),
    retreat: (world) => retreat(world),
    mutate: (world, key) => mutate(world, key),
    say: (world, text) => say(world, text),
    state: (world) => world.game,
    command: (world, ev) => { const S = G(world); if (S) S.cmds.push(Object.assign({ type: 'ui', _cmd: true }, ev)); },
    hiveIds: (world) => (G(world) ? G(world).hiveIds.slice() : []),
  };
})();
