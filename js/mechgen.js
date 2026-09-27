// Mecha Factory — blueprints, part library, rigs and walk cycles.
// A blueprint is plain JSON (shareable); build(bp) turns it into a node hierarchy + animator.
(function () {
  const MF = window.MF;
  const { RNG } = MF;
  const PI = Math.PI;

  const OPTIONS = {
    frame: ['biped', 'strider', 'spider', 'crawler', 'tank', 'hover'],
    torso: ['block', 'wedge', 'barrel', 'hunch', 'core'],
    head: ['visor', 'mono', 'cockpit', 'horned', 'sensor', 'none'],
    arm: ['cannon', 'gatling', 'missiles', 'fist', 'claw', 'blade', 'shield', 'drill', 'none'],
    shoulders: ['pauldron', 'round', 'launcher', 'spiked', 'none'],
    back: ['missiles', 'exhaust', 'antenna', 'tank', 'radar', 'artillery', 'wings', 'none'],
    scheme: ['mono', 'split', 'inverse'],
  };
  const LABELS = {
    frame: { biped: 'Biped', strider: 'Reverse-joint', spider: 'Quad spider', crawler: 'Hex crawler', tank: 'Treads', hover: 'Hover' },
    torso: { block: 'Block', wedge: 'Wedge chest', barrel: 'Barrel', hunch: 'Hunchback', core: 'Turret core' },
    head: { visor: 'Visor', mono: 'Mono-eye', cockpit: 'Cockpit', horned: 'V-fin', sensor: 'Sensor bar', none: 'Headless' },
    arm: { cannon: 'Rail cannon', gatling: 'Gatling', missiles: 'Rocket pod', fist: 'Power fist', claw: 'Claw', blade: 'Energy blade', shield: 'Shield', drill: 'Drill', none: 'None' },
    shoulders: { pauldron: 'Pauldrons', round: 'Round guards', launcher: 'Launchers', spiked: 'Spiked', none: 'None' },
    back: { missiles: 'Missile rack', exhaust: 'Exhaust stacks', antenna: 'Antenna', tank: 'Fuel tank', radar: 'Radar dish', artillery: 'Artillery', wings: 'Fins', none: 'None' },
    scheme: { mono: 'Solid', split: 'Two-tone', inverse: 'Inverted' },
  };

  const NAMES = ['Bulwark', 'Scorpion', 'Mantis', 'Warden', 'Hornet', 'Goliath', 'Talon', 'Jackal', 'Rook', 'Cinder', 'Paladin', 'Vulture', 'Basilisk', 'Kodiak', 'Stinger', 'Harrier', 'Anvil', 'Wraith', 'Ironclad', 'Tarantula', 'Sabre', 'Colossus', 'Marauder', 'Bastion', 'Onager', 'Kestrel', 'Behemoth', 'Scarab', 'Tempest', 'Grendel', 'Halberd', 'Mule', 'Nomad', 'Specter', 'Hammerhead', 'Locust', 'Raptor', 'Titan', 'Viper', 'Yeti'];
  const PREFIX = ['MK', 'RX', 'VT', 'GX', 'AR', 'TX', 'ZR', 'KV', 'HX', 'M'];

  // ------------------------------------------------------------- random blueprint
  function randomBlueprint(seed, locks = {}, prev = null) {
    const r = new RNG(seed);
    const keep = (k, gen) => (locks[k] && prev && prev[k] !== undefined ? prev[k] : gen());
    const frame = keep('frame', () => r.weighted({ biped: 5, strider: 3, spider: 3, crawler: 2, tank: 2, hover: 2 }));
    const legged = frame === 'biped' || frame === 'strider';
    const bp = { v: 1, seed, frame };
    bp.torso = keep('torso', () => (frame === 'spider' || frame === 'crawler' ? r.weighted({ core: 5, block: 2, barrel: 2, wedge: 1 }) : r.weighted({ block: 3, wedge: 3, barrel: 2, hunch: 2, core: 1 })));
    bp.head = keep('head', () => (bp.torso === 'core' ? r.weighted({ none: 4, sensor: 2, mono: 1 }) : r.weighted({ visor: 3, mono: 2, cockpit: 2, horned: 2, sensor: 1, none: 1 })));
    const armPool = legged || frame === 'hover' ? { cannon: 3, gatling: 3, missiles: 2, fist: 3, claw: 2, blade: 2, shield: 2, drill: 1 } : { cannon: 3, gatling: 3, missiles: 3, claw: 1, drill: 1, none: 2 };
    bp.armL = keep('armL', () => r.weighted(armPool));
    bp.armR = keep('armR', () => (r.chance(0.45) ? bp.armL : r.weighted(armPool)));
    bp.shoulders = keep('shoulders', () => r.weighted({ pauldron: 4, round: 2, launcher: 2, spiked: 1, none: 2 }));
    bp.back = keep('back', () => r.weighted({ missiles: 3, exhaust: 2, antenna: 2, tank: 2, radar: 1, artillery: 2, wings: 1, none: 2 }));
    bp.scheme = keep('scheme', () => r.weighted({ mono: 2, split: 3, inverse: 1 }));
    bp.bulk = keep('bulk', () => +r.range(0.8, 1.35).toFixed(2));
    bp.legLen = keep('legLen', () => +r.range(0.75, 1.3).toFixed(2));
    bp.tall = keep('tall', () => +r.range(0.8, 1.3).toFixed(2));
    bp.armLen = keep('armLen', () => +r.range(0.8, 1.25).toFixed(2));
    bp.edge = keep('edge', () => +r.range(0.8, 2.4).toFixed(1));
    bp.palette = keep('palette', () => r.pick(Object.keys(MF.PALETTES)));
    bp.colors = locks.palette && prev && prev.colors ? { ...prev.colors } : { ...MF.PALETTES[bp.palette] };
    bp.number = keep('number', () => String(r.int(100, 999)));
    bp.name = keep('name', () => `${r.pick(PREFIX)}-${bp.number} ${r.pick(NAMES)}`);
    return bp;
  }

  // ------------------------------------------------------------- build
  function build(bp) {
    const r = new RNG((bp.seed || 1) ^ 0x9e3779b9);
    const root = new MF.Node('root');
    const bulk = bp.bulk || 1, tall = bp.tall || 1, legLen = bp.legLen || 1, armLen = bp.armLen || 1;
    const e = bp.edge == null ? 1.5 : bp.edge;
    const mats = { mono: ['primary', 'primary', 'secondary'], split: ['primary', 'secondary', 'secondary'], inverse: ['secondary', 'secondary', 'primary'] }[bp.scheme || 'split'];
    const ctx = { bp, r, root, bulk, tall, legLen, armLen, e, A: mats[0], B: mats[1], T: mats[2], M: 'metal', anims: [], stride: 30, hover: 0 };

    const hub = buildFrame(ctx);           // returns node the torso sits on
    const tor = buildTorso(ctx, hub);       // returns anchors
    buildHead(ctx, tor);
    buildArm(ctx, tor, -1, bp.armL);
    buildArm(ctx, tor, 1, bp.armR);
    buildBack(ctx, tor);

    // bounds for shadows / framing
    const prims = MF.updateRig(root, MF.mat(), []);
    let maxY = 0, rad = 0, minY = 1e9;
    for (const p of prims) {
      maxY = Math.max(maxY, p.world[10] + p.brad);
      minY = Math.min(minY, p.world[10] - p.brad);
      rad = Math.max(rad, Math.hypot(p.world[9], p.world[11]) + p.brad * 0.7);
    }
    const nodes = MF.findNodes(root);
    return {
      root, nodes, height: maxY, radius: Math.max(14, rad), stride: ctx.stride, hover: ctx.hover,
      animate(st) {
        root.reset();
        for (const a of ctx.anims) a(st, nodes);
      },
    };
  }

  // ------------------------------------------------------------- frames / locomotion
  function buildFrame(ctx) {
    switch (ctx.bp.frame) {
      case 'strider': return frameStrider(ctx);
      case 'spider': return frameLegs(ctx, 4);
      case 'crawler': return frameLegs(ctx, 6);
      case 'tank': return frameTank(ctx);
      case 'hover': return frameHover(ctx);
      default: return frameBiped(ctx);
    }
  }

  function frameBiped(ctx) {
    const { root, bulk, legLen, e, B, T, M, r } = ctx;
    const thighL = Math.round(10 * legLen + 2), shinL = Math.round(11 * legLen + 2), footH = 3;
    const legW = Math.round(4.5 * bulk + 1.5);
    const hipX = Math.round(4 * bulk + 3);
    const hipY = footH + thighL + shinL;
    const armored = r.chance(0.6);
    const pelvis = root.child('pelvis', [0, hipY, 0]);
    pelvis.box(hipX * 2 - 1, 5, 7, { mat: M, bevel: 1 });
    pelvis.box(hipX * 1.2, 4, 3, { mat: T, at: [0, -1.5, 3.5], cuts: [[0, -1, 1, 2]] });
    for (const s of [-1, 1]) {
      const hip = pelvis.child('hip' + s, [s * hipX, -1, 0]);
      hip.cyl('x', 2.6, 4, { mat: M, at: [s * 0.5, 0, 0] });
      hip.box(legW, thighL + 1, legW + 1, { at: [0, -thighL / 2, 0], mat: B, bevel: Math.min(e, 1.5) });
      if (armored) hip.box(legW + 1.5, thighL * 0.55, 2.5, { at: [s * 0.5, -thighL * 0.35, legW / 2 + 0.8], mat: T, bevel: 0.8, detail: { type: 'panel', face: '+z', at: 0, dir: 'h' } });
      const knee = hip.child('knee' + s, [0, -thighL, 0]);
      knee.cyl('x', 2.4, legW + 1.2, { mat: M });
      knee.box(legW + 2, shinL, legW + 3, { at: [0, -shinL / 2 - 0.5, 0.4], mat: B, bevel: e, bevelSet: 'vert', detail: armored ? { type: 'vent', face: '+z', pitch: 2, inset: 1.5 } : { type: 'panel', face: '+z', at: 0 } });
      knee.box(legW + 1, 4.5, 3, { at: [0, -0.5, legW / 2 + 2], mat: T, cuts: [[0, 1, 1, 1.6], [0, -1, 1, 1.2]] });
      const ankle = knee.child('ankle' + s, [0, -shinL, 0]);
      ankle.box(legW + 3.5, footH, legW + 8, { at: [0, -footH / 2, 1.5], mat: M, bevel: 1, bevelSet: 'top' });
      ankle.box(legW + 2.5, 2, 3, { at: [0, -0.6, legW / 2 + 5], mat: T, cuts: [[0, 1, 1, 1.2]] });
    }
    const L = thighL + shinL, A = 0.42;
    ctx.stride = 4 * L * Math.sin(A);
    ctx.anims.push((st, n) => {
      const m = st.move, ph = st.phase;
      const drop = L * (1 - Math.cos(A * m * Math.sin(ph)));
      n.pelvis.pos[1] -= drop + Math.sin(st.t * 2.2) * 0.35 * (1 - m);
      n.pelvis.rot[1] = Math.sin(ph) * 0.07 * m;
      for (const s of [-1, 1]) {
        const p = s < 0 ? ph : ph + PI;
        const hip = -A * Math.sin(p) * m;
        const knee = Math.max(0, Math.cos(p)) * 0.9 * m;
        n['hip' + s].rot[0] = hip;
        n['knee' + s].rot[0] = knee;
        n['ankle' + s].rot[0] = -(hip + knee) * 0.85;
      }
      if (n.torso) { n.torso.rot[2] = Math.sin(ph) * 0.03 * m; n.torso.rot[1] = -Math.sin(ph) * 0.1 * m; }
    });
    ctx.gait = 'biped';
    return pelvis;
  }

  function frameStrider(ctx) {
    const { root, bulk, legLen, e, B, T, M } = ctx;
    const T1 = Math.round(10 * legLen + 2), S1 = Math.round(T1 * 0.95), M1 = Math.round(7 * legLen + 2), footH = 2.5;
    const a1 = -0.65, a2 = 1.35, a3 = -0.7;
    const legW = Math.round(4 * bulk + 1.5);
    const hipX = Math.round(4.5 * bulk + 3);
    const hipY = footH + T1 * Math.cos(a1) + S1 * Math.cos(a1 + a2) + M1;
    const pelvis = root.child('pelvis', [0, hipY, 0]);
    pelvis.box(hipX * 2, 6, 8, { mat: M, bevel: 1.2 });
    for (const s of [-1, 1]) {
      const hip = pelvis.child('hip' + s, [s * hipX, 0, 0], [a1, 0, 0]);
      hip.cyl('x', 3.2, 4.5, { mat: M, at: [s * 0.6, 0, 0] });
      hip.box(legW + 1, T1 + 2, legW + 3, { at: [0, -T1 / 2, 0], mat: B, bevel: e, detail: { type: 'panel', face: '+z', at: 0, dir: 'v' } });
      hip.box(legW + 2, T1 * 0.5, 2, { at: [s * 0.3, -T1 * 0.3, legW / 2 + 2], mat: T, bevel: 0.8 });
      const knee = hip.child('knee' + s, [0, -T1, 0], [a2, 0, 0]);
      knee.cyl('x', 2.6, legW + 2, { mat: M });
      knee.box(legW, S1, legW, { at: [0, -S1 / 2, 0], mat: M, bevel: 0.8 });
      knee.box(legW + 1, S1 * 0.7, 2, { at: [0, -S1 * 0.45, -legW / 2 - 0.5], mat: B, bevel: 0.8 });
      const ank = knee.child('ankle' + s, [0, -S1, 0], [a3, 0, 0]);
      ank.cyl('x', 2, legW + 1, { mat: M });
      ank.box(legW + 1, M1, legW + 1, { at: [0, -M1 / 2, 0], mat: B, bevel: 1 });
      const foot = ank.child('foot' + s, [0, -M1, 0], [-(a1 + a2 + a3), 0, 0]);
      foot.box(legW + 3, footH, legW + 8, { at: [0, -footH / 2, 2], mat: M, bevel: 0.8, bevelSet: 'top' });
      foot.box(2, footH, 5, { at: [0, -footH / 2, -legW / 2 - 2.5], mat: M });
    }
    const L = hipY, A = 0.38;
    ctx.stride = 4 * L * Math.sin(A) * 0.8;
    ctx.anims.push((st, n) => {
      const m = st.move, ph = st.phase;
      n.pelvis.pos[1] -= L * (1 - Math.cos(A * m * Math.sin(ph))) * 0.8 + Math.sin(st.t * 2.4) * 0.35 * (1 - m);
      n.pelvis.rot[0] = 0.05 * m;
      for (const s of [-1, 1]) {
        const p = s < 0 ? ph : ph + PI;
        const hip = -A * Math.sin(p) * m;
        const lift = Math.max(0, Math.cos(p)) * m;
        n['hip' + s].rot[0] += hip - lift * 0.35;
        n['knee' + s].rot[0] += lift * 0.5;
        n['ankle' + s].rot[0] += -lift * 0.3;
        n['foot' + s].rot[0] += -(hip + lift * -0.15) * 0.9;
      }
      if (n.torso) n.torso.rot[1] = -Math.sin(ph) * 0.08 * m;
    });
    ctx.gait = 'biped';
    return pelvis;
  }

  function frameLegs(ctx, count) {
    const { root, bulk, legLen, e, A, B, T, M, r } = ctx;
    const H = Math.round(9 + 7 * legLen);
    const hubR = Math.round(8 * bulk + 2);
    const hub = root.child('pelvis', [0, H, 0]);
    hub.cyl('y', hubR * 0.8, 5, { mat: M, sides: 8, twist: PI / 8 });
    hub.box(hubR * 1.6, 3, hubR * 1.6, { at: [0, -3, 0], mat: M, bevel: 2, bevelSet: 'vert', detail: { type: 'vent', face: '+z', pitch: 2, inset: 1 } });
    const F = Math.round(9 * legLen + 3), alpha = 0.5, beta = 0.28;
    const kneeY = H + F * Math.sin(alpha);
    const Tb = kneeY / Math.cos(beta);
    const angles = count === 4 ? [PI / 4, -PI / 4, (3 * PI) / 4, (-3 * PI) / 4] : [0.9, -0.9, PI / 2, -PI / 2, 2.25, -2.25];
    // gait groups: diagonal pairs (quad) or tripods (hex)
    const groups = count === 4 ? [0, 1, 1, 0] : [0, 1, 1, 0, 0, 1];
    const legs = [];
    angles.forEach((a, i) => {
      const side = Math.sign(Math.sin(a)) || 1;
      const rootN = hub.child('leg' + i, [Math.sin(a) * hubR * 0.75, 0, Math.cos(a) * hubR * 0.75], [0, a - PI / 2, 0]);
      const coxa = rootN.child('coxa' + i);
      coxa.cyl('y', 3, 6, { mat: M });
      const fem = coxa.child('femur' + i, [1, 1, 0], [0, 0, alpha]);
      fem.box(F + 2, 5, 5 * bulk + 1, { at: [F / 2, 0, 0], mat: B, bevel: e, detail: { type: 'panel', face: '+y', at: 0, dir: 'v' } });
      fem.box(F * 0.6, 2, 5 * bulk + 2, { at: [F * 0.45, 2.8, 0], mat: T, bevel: 0.6 });
      const knee = fem.child('knee' + i, [F, 0, 0], [0, 0, beta - alpha]);
      knee.cyl('z', 3.3, 5 * bulk + 3, { mat: M });
      knee.box(5.5, Tb * 0.62, 5 * bulk + 1.5, { at: [0.8, -Tb * 0.33, 0], mat: A, bevel: e, bevelSet: 'vert', detail: { type: 'bolts', face: 'any', inset: 1.5 } });
      knee.box(3.5, Tb * 0.4, 3, { at: [0, -Tb * 0.78, 0], mat: M, bevel: 0.6 });
      knee.cone('y', 1.2, 2.6, 4, { at: [0, -Tb + 1.5, 0], mat: M, sides: 6 });
      legs.push({ i, side, g: groups[i] });
    });
    const reach = F * Math.cos(alpha) + Tb * Math.sin(beta) + hubR * 0.75;
    const sweep = 0.32;
    ctx.stride = 2 * reach * Math.sin(sweep) * 2;
    ctx.anims.push((st, n) => {
      const m = st.move;
      n.pelvis.pos[1] += Math.sin(st.phase * 2) * 0.5 * m + Math.sin(st.t * 2) * 0.3 * (1 - m);
      for (const L of legs) {
        const p = st.phase + L.g * PI + (count === 6 ? 0 : 0);
        const lift = Math.max(0, Math.sin(p)) * m;
        n['coxa' + L.i].rot[1] = L.side * sweep * Math.cos(p) * m;
        n['femur' + L.i].rot[2] += lift * 0.35;
        n['knee' + L.i].rot[2] -= lift * 0.2;
      }
    });
    ctx.gait = 'legs';
    return hub;
  }

  function frameTank(ctx) {
    const { root, bulk, legLen, e, A, B, T, M } = ctx;
    const tw = Math.round(5 * bulk + 2), th = Math.round(7 + 3 * legLen), tl = Math.round(22 * bulk + 6);
    const gap = Math.round(6 * bulk + 2);
    const hub = root.child('pelvis', [0, th + 1, 0]);
    for (const s of [-1, 1]) {
      const tr = root.child('tread' + s, [s * (gap + tw / 2), th / 2, 0]);
      tr.box(tw, th, tl, { mat: M, cuts: MF.chamfer('ends', th * 0.45), detail: [{ type: 'tread', face: '+y', axis: 'v', dirSign: 1 }, { type: 'tread', face: '+z', axis: 'v' }, { type: 'tread', face: '-z', axis: 'v' }] });
      const wheels = Math.max(3, Math.round(tl / 7));
      for (let k = 0; k < wheels; k++) {
        const z = -tl / 2 + 4 + (k * (tl - 8)) / (wheels - 1);
        tr.cyl('x', 2.3, 1.2, { mat: M, at: [s * (tw / 2 + 0.3), -0.5, z], sides: 8 });
      }
      tr.box(tw + 1.5, 2.5, tl - th * 0.8, { at: [s * 0.3, th / 2 - 0.2, 0], mat: B, bevel: 0.8, detail: { type: 'stripe', face: '+y', width: 2, mat2: 'secondary' } });
    }
    hub.box(gap * 2, th - 1, tl * 0.8, { at: [0, -th / 2, 0], mat: M, bevel: 1.5 });
    hub.box(gap * 2 + 2, 3, tl * 0.75, { at: [0, 0, 0], mat: A, bevel: e, cuts: [[0, 1, 1, 2]], detail: { type: 'vent', face: '+y', pitch: 2, inset: 3 } });
    ctx.stride = 40;
    ctx.anims.push((st, n) => {
      n.pelvis.pos[1] += Math.sin(st.t * 30) * 0.25 * st.move;
      n.pelvis.rot[0] = -0.03 * st.move;
    });
    ctx.gait = 'tread';
    return hub;
  }

  function frameHover(ctx) {
    const { root, bulk, legLen, e, A, B, T, M } = ctx;
    const R = Math.round(8 * bulk + 3);
    const lift = Math.round(6 + 4 * legLen);
    const hub = root.child('pelvis', [0, lift + 6, 0]);
    hub.cone('y', R, R * 0.7, 6, { mat: B, sides: 8, twist: PI / 8, at: [0, -3, 0], detail: { type: 'band', at: 0, size: 0.8, mat2: 'secondary' } });
    hub.cone('y', R * 0.7, R * 0.95, 3, { mat: M, sides: 8, twist: PI / 8, at: [0, -7.5, 0] });
    for (let k = 0; k < 4; k++) {
      const a = PI / 4 + (k * PI) / 2;
      hub.cone('y', 1.2, 2.6, 4, { mat: M, sides: 6, at: [Math.sin(a) * R * 0.6, -10, Math.cos(a) * R * 0.6] });
      hub.cone('y', 0.4, 1.8, 2, { mat: 'accent', sides: 6, shadow: false, at: [Math.sin(a) * R * 0.6, -12.5, Math.cos(a) * R * 0.6] });
    }
    ctx.hover = lift;
    ctx.stride = 60;
    ctx.anims.push((st, n) => {
      n.pelvis.pos[1] += Math.sin(st.t * 3) * 1.2;
      n.pelvis.rot[0] = 0.18 * st.move;
      n.pelvis.rot[2] = Math.sin(st.t * 1.7) * 0.03;
    });
    ctx.gait = 'hover';
    return hub;
  }

  // ------------------------------------------------------------- torso
  function buildTorso(ctx, hub) {
    const { bp, bulk, tall, e, A, B, T, M, r } = ctx;
    const W = Math.round(15 * bulk + 3), Ht = Math.round(11 * tall + 3), D = Math.round(10 * bulk + 2);
    const torso = hub.child('torso', [0, 2.5, 0]);
    const num = { type: 'number', face: 'side', text: bp.number, u: 0, v: 0 };
    const out = { node: torso, W, D, Ht };
    switch (bp.torso) {
      case 'wedge': {
        torso.box(W * 0.5, 5, D * 0.6, { at: [0, 2.5, 0], mat: M, bevel: 1 });
        torso.box(W, Ht, D, { at: [0, 4 + Ht / 2, 0], mat: A, bevel: Math.min(e, 2), cuts: [[0, -1, 1, Math.min(D, Ht) * 0.55], [1, 0, 1, 2], [-1, 0, 1, 2]], detail: [num, { type: 'panel', face: '+y', at: 0, dir: 'v' }] });
        torso.box(W * 0.62, Ht * 0.45, 3, { at: [0, 4 + Ht * 0.7, D / 2 + 0.6], mat: T, cuts: [[0, -1, 1, 2], [1, 0, 1, 1.5], [-1, 0, 1, 1.5]], detail: { type: 'vent', face: '+z', pitch: 2, inset: 1.2 } });
        torso.box(W * 0.35, 3, D * 0.7, { at: [0, 4 + Ht + 0.8, -1], mat: M, bevel: 1 });
        Object.assign(out, { neck: [0, 4 + Ht + 1.5, 0.5], shY: 4 + Ht - 3, shX: W / 2, backY: 4 + Ht * 0.6, backZ: -D / 2, topY: 4 + Ht });
        break;
      }
      case 'barrel': {
        const R = Math.round(W / 2);
        torso.box(W * 0.5, 5, D * 0.6, { at: [0, 2.5, 0], mat: M, bevel: 1 });
        torso.cone('y', R * 0.85, R, Ht, { at: [0, 4 + Ht / 2, 0], mat: A, sides: 8, twist: PI / 8, detail: [{ type: 'band', at: Ht * 0.15, size: 1.2, mat2: 'secondary' }, { ...num, face: 'side', v: -Ht * 0.2 }] });
        torso.cone('y', R, R * 0.7, 3, { at: [0, 4 + Ht + 1.5, 0], mat: T, sides: 8, twist: PI / 8 });
        torso.box(R * 0.9, 3, 2, { at: [0, 4 + Ht * 0.35, R - 0.2], mat: M, detail: { type: 'light', face: '+z', pts: [[-2, 0], [0, 0], [2, 0]], size: 0.6 } });
        Object.assign(out, { neck: [0, 4 + Ht + 3, 0], shY: 4 + Ht - 3, shX: R, backY: 4 + Ht * 0.55, backZ: -R, topY: 4 + Ht + 3 });
        break;
      }
      case 'hunch': {
        torso.box(W * 0.5, 5, D * 0.6, { at: [0, 2.5, 0], mat: M, bevel: 1 });
        torso.box(W * 0.9, Ht * 0.7, D, { at: [0, 4 + Ht * 0.35, 0], mat: B, bevel: e, detail: { type: 'vent', face: '+z', pitch: 2, inset: 2 } });
        torso.box(W * 1.05, Ht * 0.65, D * 1.1, { at: [0, 4 + Ht * 0.8, -1.5], mat: A, bevel: Math.min(2.5, e + 0.5), cuts: [[0, 1, 1, 3]], rot: [-0.18, 0, 0], detail: [num, { type: 'panel', face: '+y', at: 0, dir: 'v' }] });
        Object.assign(out, { neck: [0, 4 + Ht * 0.85, D * 0.45], shY: 4 + Ht * 0.8, shX: W * 0.52, backY: 4 + Ht * 0.8, backZ: -D * 0.55 - 1.5, topY: 4 + Ht * 1.1, headSunk: true });
        break;
      }
      case 'core': {
        const Wc = Math.round(W * 1.15), Hc = Math.round(Ht * 1.05), Dc = Math.round(D * 1.25);
        torso.box(Wc, Hc, Dc, { at: [0, Hc / 2, 0], mat: A, bevel: Math.max(2, e + 0.5), detail: [{ ...num, face: '+x' }, { type: 'panel', face: '+y', at: -Dc * 0.15, dir: 'h' }, { type: 'bolts', face: '-x', inset: 2 }] });
        // front "face" plate with lens, like a turret head
        torso.box(Wc * 0.55, Hc * 0.6, 2.5, { at: [-Wc * 0.12, Hc * 0.55, Dc / 2 + 0.8], mat: T, bevel: 1, detail: { type: 'vent', face: '+z', pitch: 2, inset: 1.2 } });
        torso.cyl('z', 3.2, 2.5, { at: [Wc * 0.26, Hc * 0.62, Dc / 2 + 1], mat: M });
        torso.cyl('z', 1.8, 1.5, { at: [Wc * 0.26, Hc * 0.62, Dc / 2 + 2.6], mat: 'glass' });
        torso.box(Wc * 0.8, 3, Dc * 0.8, { at: [0, -1, 0], mat: M, bevel: 1, detail: { type: 'vent', face: 'side', pitch: 2, inset: 0.5 } });
        Object.assign(out, { neck: [0, Hc + 1, 1], shY: Hc * 0.55, shX: Wc / 2, backY: Hc * 0.6, backZ: -Dc / 2, topY: Hc, W: Wc, D: Dc });
        break;
      }
      default: { // block
        torso.box(W * 0.55, 5, D * 0.6, { at: [0, 2.5, 0], mat: M, bevel: 1, detail: { type: 'vent', face: '+z', pitch: 1.5, inset: 0.6 } });
        torso.box(W, Ht, D, { at: [0, 4 + Ht / 2, 0], mat: A, bevel: e, detail: [num, { type: 'panel', face: '+z', at: 0, dir: 'v' }] });
        torso.box(W * 0.7, Ht * 0.5, 2.5, { at: [0, 4 + Ht * 0.6, D / 2 + 0.6], mat: T, bevel: 1, cuts: [[0, -1, 1, 1.5]], detail: { type: 'light', face: '+z', pts: [[W * 0.22, Ht * 0.12]], size: 0.7 } });
        torso.box(W * 0.4, 2.5, D * 0.8, { at: [0, 4 + Ht + 0.8, 0], mat: M, bevel: 0.8 });
        Object.assign(out, { neck: [0, 4 + Ht + 1.5, 0.5], shY: 4 + Ht - 3, shX: W / 2, backY: 4 + Ht * 0.55, backZ: -D / 2, topY: 4 + Ht });
      }
    }
    ctx.anims.push((st, n) => {
      n.torso.pos[1] += Math.sin(st.t * 2.2 + 0.6) * 0.3 * (1 - st.move);
    });
    return out;
  }

  // ------------------------------------------------------------- head
  function buildHead(ctx, tor) {
    const { bp, bulk, e, A, B, T, M, r } = ctx;
    if (bp.head === 'none') {
      tor.node.box(tor.W * 0.4, 1.6, 1, { at: [0, tor.topY - 3.5, tor.D / 2 + 0.2], mat: 'accent', shadow: false });
      return;
    }
    const neck = tor.node.child('neck', tor.neck);
    const hw = Math.round(6 + 2 * bulk), hh = 6, hd = 7;
    const sunk = tor.headSunk ? -2 : 0;
    const head = neck.child('head', [0, sunk, 0]);
    neck.box(3.5, 3, 3.5, { at: [0, 0, 0], mat: M });
    switch (bp.head) {
      case 'mono': {
        head.box(hw + 1, hh, hd, { at: [0, hh / 2 + 1, 0], mat: A, bevel: 1.5 });
        head.cyl('z', 2.6, 2, { at: [0, hh / 2 + 1.2, hd / 2 + 0.6], mat: M });
        head.cyl('z', 1.3, 1, { at: [0, hh / 2 + 1.2, hd / 2 + 1.6], mat: 'accent', shadow: false });
        head.box(1.5, 3, 4, { at: [0, hh + 2, -1], mat: T, cuts: [[0, 1, 1, 1.2]] });
        break;
      }
      case 'cockpit': {
        head.box(hw + 3, hh, hd + 3, { at: [0, hh / 2 + 1, 0], mat: A, bevel: 1, cuts: [[0, 1, 1, 3.5]] });
        head.box(hw + 0.5, 2.6, 1.2, { at: [0, hh / 2 + 2.4, hd / 2 + 0.2], mat: 'glass', rot: [-0.75, 0, 0] });
        head.box(2, 2, 2, { at: [(hw + 3) / 2, hh / 2, 1], mat: M });
        head.box(2, 2, 2, { at: [-(hw + 3) / 2, hh / 2, 1], mat: M });
        break;
      }
      case 'horned': {
        head.box(hw, hh, hd, { at: [0, hh / 2 + 1, 0], mat: A, bevel: 1.2, detail: { type: 'eye', face: '+z', at: 0.3, h: 0.7, w: hw / 2 - 1.2 } });
        head.box(hw * 0.5, 2, 2, { at: [0, 1.8, hd / 2 + 0.3], mat: M });
        for (const s of [-1, 1]) head.box(1.4, 7, 1.4, { at: [s * 2.8, hh + 3.5, hd / 2 - 0.5], rot: [0, 0, -s * 0.85], mat: 'secondary', shadow: true });
        head.box(2, 2, 1.5, { at: [0, hh + 1.5, hd / 2 - 0.2], mat: 'accent' });
        break;
      }
      case 'sensor': {
        head.box(hw + 5, 4, hd - 1, { at: [0, 3, 0], mat: A, bevel: 1, detail: { type: 'light', face: '+z', pts: [[-3, 0], [0, 0], [3, 0]], size: 0.75 } });
        head.box(1, 8, 1, { at: [(hw + 5) / 2 - 1, 8, -1], mat: M });
        head.box(1.6, 1.6, 1.6, { at: [(hw + 5) / 2 - 1, 12, -1], mat: 'accent' });
        break;
      }
      default: { // visor
        head.box(hw, hh, hd, { at: [0, hh / 2 + 1, 0], mat: A, bevel: Math.min(2, e), detail: { type: 'eye', face: '+z', at: 0.5, h: 0.8, w: hw / 2 - 1 } });
        head.box(hw + 1.5, 2, hd * 0.7, { at: [0, hh + 1.2, -0.5], mat: T, bevel: 0.6 });
        head.box(hw * 0.6, 2.2, 2, { at: [0, 1.6, hd / 2 + 0.2], mat: M, detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.2 } });
      }
    }
    ctx.anims.push((st, n) => {
      if (!n.head) return;
      n.head.rot[1] = Math.sin(st.t * 0.7) * 0.25 * (1 - st.move);
      n.head.rot[0] = Math.sin(st.phase * 2) * 0.03 * st.move;
    });
  }

  // ------------------------------------------------------------- arms
  function buildArm(ctx, tor, s, type) {
    const { bp, bulk, armLen, e, A, B, T, M } = ctx;
    const legged = ctx.gait === 'biped' || ctx.gait === 'hover';
    const hardpoint = !legged; // spiders / tanks mount weapons directly
    const shoulder = tor.node.child('shoulder' + s, [s * (tor.shX + 2.2), tor.shY, 0]);
    shoulder.cyl('x', 2.8, 4, { mat: M });
    buildShoulderArmor(ctx, shoulder, s);
    if (type === 'none') return;
    const up = Math.round(8 * armLen + 1), fo = Math.round(8 * armLen + 2);
    const aw = Math.round(4 * bulk + 1);
    const ranged = type === 'cannon' || type === 'gatling' || type === 'missiles';
    let wrist;
    if (hardpoint) {
      // weapon mount pointing forward
      const mount = shoulder.child('elbow' + s, [s * 2.5, 0, 0], [-PI / 2, 0, 0]);
      mount.box(aw + 1, 6, aw + 2, { at: [0, -2, 0], mat: B, bevel: 1 });
      wrist = mount.child('wrist' + s, [0, -5, 0]);
    } else {
      const upper = shoulder.child('upper' + s, [s * 2.4, -1, 0]);
      upper.box(aw, up, aw, { at: [0, -up / 2, 0], mat: M, bevel: 0.8 });
      const elbow = upper.child('elbow' + s, [0, -up, 0], [ranged ? -1.25 : -0.3, 0, 0]);
      elbow.cyl('x', 2.2, aw + 1, { mat: M });
      elbow.box(aw + 2, fo, aw + 2, { at: [0, -fo / 2, 0], mat: B, bevel: e, bevelSet: 'vert', detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
      wrist = elbow.child('wrist' + s, [0, -fo, 0]);
    }
    const w = wrist;
    switch (type) {
      case 'cannon': {
        const len = Math.round(16 + 6 * armLen);
        w.box(aw + 2, 5, aw + 2, { at: [0, -2, 0], mat: T, bevel: 1, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 0.6 } });
        w.cyl('y', 1.5, len, { at: [0, -4 - len / 2, 0], mat: M, sides: 6 });
        w.box(3.5, 3, 3.5, { at: [0, -4 - len + 1.5, 0], mat: M, bevel: 0.6 });
        w.box(1.8, 1, 1.8, { at: [0, -4 - len, 0], mat: M });
        break;
      }
      case 'gatling': {
        const spin = w.child('spin' + s, [0, -3, 0]);
        w.box(aw + 3, 4, aw + 3, { at: [0, -1.5, 0], mat: T, bevel: 1.2 });
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * PI * 2;
          spin.cyl('y', 0.9, 11, { at: [Math.cos(a) * 1.7, -6, Math.sin(a) * 1.7], mat: M, sides: 6 });
        }
        spin.cyl('y', 2.8, 1.5, { at: [0, -9, 0], mat: M });
        ctx.anims.push((st, n) => { n['spin' + s].rot[1] = st.t * (4 + 14 * st.move); });
        break;
      }
      case 'missiles': {
        w.box(aw + 5, 9, aw + 4, { at: [s * 1.5, -4, 0], mat: A, bevel: 1, detail: [{ type: 'grid', face: '-y', cell: 3, inset: 0.8 }, { type: 'stripe', face: 'side', width: 2, band: 0, bandH: 1.2, mat2: 'secondary' }] });
        break;
      }
      case 'claw': {
        w.box(aw + 1, 3, aw + 1, { at: [0, -1, 0], mat: M, bevel: 0.8 });
        for (const [dx, dz, rz, rx] of [[-1.6, 1, 0.35, -0.2], [1.6, 1, -0.35, -0.2], [0, -1.8, 0, 0.35]]) {
          const f = w.child('claw' + s + dx + dz, [dx, -2.5, dz], [rx, 0, rz]);
          f.box(1.6, 6, 1.6, { at: [0, -3, 0], mat: T, cuts: [[0, -1, 1, 1.2]] });
        }
        break;
      }
      case 'blade': {
        w.box(aw + 1.5, 4, aw + 1.5, { at: [0, -1.5, 0], mat: M, bevel: 1 });
        w.box(1, 16 * armLen, 3, { at: [0, -4 - 8 * armLen, 0.8], mat: 'accent', cuts: [[0, -1, 1, 2.5]], shadow: false });
        break;
      }
      case 'shield': {
        w.box(aw + 1, 4, aw + 1, { at: [0, -1.5, 0], mat: M, bevel: 1 });
        const sh = w.child('shield' + s, [s * (aw / 2 + 2), 3, 0]);
        sh.box(2, 18 * armLen, 12 * bulk, { at: [0, -3, 0], mat: A, bevel: 1, cuts: [[0, -1, 1, 4], [0, -1, -1, 4]], detail: [{ type: 'stripe', face: 'side', width: 2.5, mat2: 'secondary', band: -2, bandH: 2 }, { type: 'bolts', face: 'side', inset: 1.5 }] });
        break;
      }
      case 'drill': {
        w.box(aw + 2, 4, aw + 2, { at: [0, -1.5, 0], mat: T, bevel: 1 });
        const d = w.child('spin' + s, [0, -4, 0]);
        d.cone('y', 0.3, 3.6, 12, { at: [0, -6, 0], mat: M, sides: 6, detail: { type: 'band', dir: 'h', at: 0, size: 0.6 } });
        ctx.anims.push((st, n) => { n['spin' + s].rot[1] = st.t * (3 + 12 * st.move); });
        break;
      }
      default: { // fist
        w.box(aw + 2.5, 5, aw + 2.5, { at: [0, -2.5, 0.3], mat: M, bevel: 1, detail: { type: 'panel', face: '+z', at: -0.8, dir: 'h' } });
        w.box(aw + 3, 2, aw + 3, { at: [0, -0.2, 0.3], mat: T, bevel: 0.6 });
      }
    }
    if (!hardpoint) {
      ctx.anims.push((st, n) => {
        const k = ranged ? 0.12 : 0.4;
        const sw = Math.sin(st.phase + (s < 0 ? 0 : PI)) * k * st.move;
        n['shoulder' + s].rot[0] = sw;
        n['upper' + s].rot[2] = s * (0.08 + Math.sin(st.t * 2.2) * 0.02);
      });
    }
  }

  function buildShoulderArmor(ctx, shoulder, s) {
    const { bp, bulk, e, A, T, M } = ctx;
    const w = Math.round(6 + 2 * bulk), h = 6, d = Math.round(8 + 3 * bulk);
    switch (bp.shoulders) {
      case 'pauldron':
        shoulder.box(w, h, d, { at: [s * 2.6, 2.2, 0], mat: A, bevel: Math.min(2, e), cuts: [[s, 1, 0, 2.5]], detail: { type: 'stripe', face: 'side', width: 2, mat2: bp.scheme === 'inverse' ? 'primary' : 'secondary', band: -1, bandH: 1.2 } });
        break;
      case 'round':
        shoulder.cyl('x', 4.6, w, { at: [s * 2.5, 1.5, 0], mat: T, sides: 8, twist: PI / 8, detail: { type: 'bolts', face: 'side', inset: 1.8 } });
        break;
      case 'launcher':
        shoulder.box(w, h - 1, d, { at: [s * 2.6, 2, 0], mat: A, bevel: 1.2 });
        shoulder.box(w - 1, 5, d - 2, { at: [s * 2.6, 6.8, -0.5], mat: T, bevel: 0.8, rot: [-0.25, 0, 0], detail: { type: 'grid', face: '+z', cell: 2.5, inset: 0.6 } });
        break;
      case 'spiked':
        shoulder.box(w, h, d, { at: [s * 2.6, 2.2, 0], mat: A, bevel: Math.min(2, e) });
        for (const z of [-2.5, 0.5, 3.5]) shoulder.cone('y', 1.4, 0.2, 4, { at: [s * 3, 6.5, z], mat: M, sides: 5 });
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- back
  function buildBack(ctx, tor) {
    const { bp, bulk, tall, e, A, B, T, M } = ctx;
    if (bp.back === 'none') return;
    const back = tor.node.child('back', [0, tor.backY, tor.backZ]);
    switch (bp.back) {
      case 'missiles': {
        back.box(tor.W * 0.6, 7, 4, { at: [0, 0, -2], mat: M, bevel: 1 });
        for (const s of [-1, 1]) {
          back.box(5, 11, 5, { at: [s * 3.4, 7, -3], rot: [-0.35, 0, 0], mat: T, bevel: 0.8, detail: [{ type: 'grid', face: '+y', cell: 2.5, inset: 0.5 }, { type: 'panel', face: 'side', at: 0, dir: 'h' }] });
        }
        break;
      }
      case 'exhaust': {
        back.box(tor.W * 0.55, 8, 4, { at: [0, 0, -2], mat: B, bevel: 1, detail: { type: 'vent', face: '-z', pitch: 2 } });
        for (const s of [-1, 1]) {
          back.cyl('y', 2, 10, { at: [s * 3.2, 6, -3.5], mat: M, sides: 8 });
          back.cyl('y', 1.2, 1, { at: [s * 3.2, 11.2, -3.5], mat: 'accent', shadow: false, sides: 8 });
        }
        break;
      }
      case 'antenna': {
        back.box(tor.W * 0.5, 6, 4, { at: [0, 1, -2], mat: B, bevel: 1 });
        back.box(1, 18 * tall, 1, { at: [tor.W * 0.2, 11 * tall, -2.5], mat: M });
        back.box(1.8, 1.8, 1.8, { at: [tor.W * 0.2, 20 * tall + 1, -2.5], mat: 'accent', shadow: false });
        back.box(1, 10 * tall, 1, { at: [-tor.W * 0.15, 7 * tall, -2.5], mat: M });
        break;
      }
      case 'tank': {
        back.cyl('x', 4.2, tor.W * 0.85, { at: [0, 1, -4], mat: T, sides: 8, twist: PI / 8, detail: { type: 'band', dir: 'v', at: 0, size: 1.2, mat2: 'secondary' } });
        back.box(2, 5, 3, { at: [tor.W * 0.3, 5, -4], mat: M });
        break;
      }
      case 'radar': {
        back.box(4, 6, 4, { at: [0, 1, -2], mat: M, bevel: 1 });
        back.box(1.4, 8, 1.4, { at: [0, 7, -2.5], mat: M });
        const dish = back.child('dish', [0, 12, -3], [-0.6, 0, 0]);
        dish.cone('y', 7 * bulk, 5 * bulk, 2, { mat: T, sides: 10, detail: { type: 'bolts', inset: 2 } });
        dish.box(1, 3, 1, { at: [0, 2, 0], mat: 'accent', shadow: false });
        ctx.anims.push((st, n) => { n.dish.rot[1] = st.t * 0.9; });
        break;
      }
      case 'artillery': {
        const s = bp.armR === 'none' || bp.armR === 'shield' ? 1 : -1;
        back.box(6, 7, 6, { at: [s * tor.W * 0.25, 3, -2], mat: M, bevel: 1 });
        const gun = back.child('gun', [s * tor.W * 0.3, 8, -1], [-0.1, 0, 0]);
        gun.box(6, 6, 12, { at: [0, 0, 0], mat: A, bevel: e, detail: { type: 'vent', face: 'side', pitch: 2 } });
        gun.cyl('z', 1.6, 22 + 6 * tall, { at: [0, 0.5, 6 + 11 + 3 * tall], mat: M, sides: 6 });
        gun.box(3.8, 3.8, 4, { at: [0, 0.5, 6 + 22 + 6 * tall], mat: M, bevel: 0.6 });
        break;
      }
      case 'wings': {
        back.box(tor.W * 0.5, 7, 4, { at: [0, 2, -2], mat: M, bevel: 1 });
        for (const s of [-1, 1]) {
          const wg = back.child('wing' + s, [s * 3, 5, -3], [0.35, 0, -s * 0.5]);
          wg.box(2, 16 * tall, 7, { at: [0, 8 * tall, 0], mat: A, cuts: [[0, 1, -1, 4]], bevel: 0.6, detail: { type: 'stripe', face: 'side', width: 2, mat2: 'secondary', band: 4, bandH: 1.5 } });
        }
        ctx.anims.push((st, n) => { const f = Math.sin(st.t * 1.5) * 0.04; if (n['wing-1']) { n['wing-1'].rot[2] += f; n['wing1'].rot[2] -= f; } });
        break;
      }
    }
  }

  MF.Gen = { OPTIONS, LABELS, randomBlueprint, build, NAMES, PREFIX };
})();
