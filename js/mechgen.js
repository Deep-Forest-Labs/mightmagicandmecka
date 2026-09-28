// Mecha Factory — blueprints, part library, rigs and walk cycles.
// A blueprint is plain JSON (shareable); build(bp) turns it into a node hierarchy + animator.
(function () {
  const MF = window.MF;
  const { RNG } = MF;
  const PI = Math.PI;

  const OPTIONS = {
    frame: ['biped', 'strider', 'spider', 'crawler', 'quadruped', 'tank', 'hover'],
    torso: ['block', 'wedge', 'barrel', 'hunch', 'core', 'cockpit'],
    head: ['visor', 'mono', 'cockpit', 'horned', 'sensor', 'dome', 'skull', 'periscope', 'none'],
    arm: ['cannon', 'gatling', 'missiles', 'fist', 'claw', 'blade', 'shield', 'drill', 'hammer', 'flamer', 'laser', 'twin', 'none'],
    shoulders: ['pauldron', 'round', 'launcher', 'spiked', 'shield', 'none'],
    back: ['missiles', 'exhaust', 'antenna', 'tank', 'radar', 'artillery', 'wings', 'jetpack', 'saw', 'sensor', 'none'],
    scheme: ['mono', 'split', 'inverse'],
  };
  const LABELS = {
    frame: { biped: 'Biped', strider: 'Reverse-joint', spider: 'Quad spider', crawler: 'Hex crawler', quadruped: 'Quadruped walker', tank: 'Treads', hover: 'Hover' },
    torso: { block: 'Block', wedge: 'Wedge chest', barrel: 'Barrel', hunch: 'Hunchback', core: 'Turret core', cockpit: 'Cockpit hull' },
    head: { visor: 'Visor', mono: 'Mono-eye', cockpit: 'Cockpit', horned: 'V-fin', sensor: 'Sensor bar', dome: 'Dome', skull: 'Skull', periscope: 'Periscope', none: 'Headless' },
    arm: { cannon: 'Rail cannon', gatling: 'Gatling', missiles: 'Rocket pod', fist: 'Power fist', claw: 'Claw', blade: 'Energy blade', shield: 'Shield', drill: 'Drill', hammer: 'Hydraulic hammer', flamer: 'Flamer', laser: 'Laser lance', twin: 'Twin cannon', none: 'None' },
    shoulders: { pauldron: 'Pauldrons', round: 'Round guards', launcher: 'Launchers', spiked: 'Spiked', shield: 'Shield plates', none: 'None' },
    back: { missiles: 'Missile rack', exhaust: 'Exhaust stacks', antenna: 'Antenna', tank: 'Fuel tank', radar: 'Radar dish', artillery: 'Artillery', wings: 'Fins', jetpack: 'Jetpack', saw: 'Buzz saw', sensor: 'Sensor mast', none: 'None' },
    scheme: { mono: 'Solid', split: 'Two-tone', inverse: 'Inverted' },
  };

  const NAMES = ['Bulwark', 'Scorpion', 'Mantis', 'Warden', 'Hornet', 'Goliath', 'Talon', 'Jackal', 'Rook', 'Cinder', 'Paladin', 'Vulture', 'Basilisk', 'Kodiak', 'Stinger', 'Harrier', 'Anvil', 'Wraith', 'Ironclad', 'Tarantula', 'Sabre', 'Colossus', 'Marauder', 'Bastion', 'Onager', 'Kestrel', 'Behemoth', 'Scarab', 'Tempest', 'Grendel', 'Halberd', 'Mule', 'Nomad', 'Specter', 'Hammerhead', 'Locust', 'Raptor', 'Titan', 'Viper', 'Yeti'];
  const PREFIX = ['MK', 'RX', 'VT', 'GX', 'AR', 'TX', 'ZR', 'KV', 'HX', 'M'];

  // ------------------------------------------------------------- product lines
  // A line is a family of units with its own part slots, random rules and builder.
  // def: { label, group, slots:[{key,label,options,labels}], weight, random(r, keep, bp), build(ctx),
  //        palettes?:[names], sizeRange?:[a,b], name?(r, bp), sliders?:[keys] }
  const LINES = {};
  function registerLine(id, def) { LINES[id] = Object.assign({ id, weight: 1, group: 'Mechs' }, def); }
  const lineOf = (bp) => LINES[(bp && bp.line) || 'modular'] || LINES.modular;

  // ------------------------------------------------------------- random blueprint
  // opts.line forces a line (used by the gallery filter); locks keep slot values from prev.
  function randomBlueprint(seed, locks = {}, prev = null, opts = {}) {
    const r = new RNG(seed);
    const keep = (k, gen) => (locks[k] && prev && prev[k] !== undefined ? prev[k] : gen());
    const weights = {};
    for (const id in LINES) if (!opts.group || LINES[id].group === opts.group) weights[id] = LINES[id].weight;
    let line = keep('line', () => opts.line || r.weighted(weights));
    if (!LINES[line]) line = 'modular';
    const def = LINES[line];
    const bp = { v: 2, seed, line };
    // a locked slot from another line would be meaningless here
    const keepL = (k, gen) => (locks[k] && prev && (prev.line || 'modular') === line && prev[k] !== undefined ? prev[k] : gen());
    def.random(r, keepL, bp);
    bp.bulk = keep('bulk', () => +r.range(0.8, 1.35).toFixed(2));
    bp.legLen = keep('legLen', () => +r.range(0.75, 1.3).toFixed(2));
    bp.tall = keep('tall', () => +r.range(0.8, 1.3).toFixed(2));
    bp.armLen = keep('armLen', () => +r.range(0.8, 1.25).toFixed(2));
    bp.edge = keep('edge', () => +r.range(0.8, 2.4).toFixed(1));
    const sr = def.sizeRange || [1.0, 1.3];
    bp.size = keepL('size', () => +r.range(sr[0], sr[1]).toFixed(2));
    const pals = def.palettes || Object.keys(MF.PALETTES).filter((k) => !MF.PALETTES[k].human);
    bp.palette = keep('palette', () => r.pick(pals));
    bp.colors = locks.palette && prev && prev.colors ? { ...prev.colors } : { ...MF.PALETTES[bp.palette] };
    bp.number = keep('number', () => String(r.int(100, 999)));
    bp.name = keep('name', () => (def.name ? def.name(r, bp) : `${r.pick(PREFIX)}-${bp.number} ${r.pick(NAMES)}`));
    return bp;
  }

  function randomModular(r, keep, bp) {
    const frame = keep('frame', () => r.weighted({ biped: 5, strider: 3, spider: 3, crawler: 2, quadruped: 3, tank: 2, hover: 2 }));
    const legged = frame === 'biped' || frame === 'strider';
    bp.frame = frame;
    bp.torso = keep('torso', () => {
      if (frame === 'spider' || frame === 'crawler') return r.weighted({ core: 5, block: 2, barrel: 2, wedge: 1, cockpit: 2 });
      if (frame === 'quadruped') return r.weighted({ core: 3, block: 2, cockpit: 3, wedge: 2, barrel: 1 });
      if (frame === 'tank') return r.weighted({ block: 3, wedge: 2, barrel: 2, hunch: 1, core: 2, cockpit: 4 });
      return r.weighted({ block: 3, wedge: 3, barrel: 2, hunch: 2, core: 1, cockpit: 1 });
    });
    bp.head = keep('head', () => {
      if (bp.torso === 'core') return r.weighted({ none: 4, sensor: 2, mono: 1, periscope: 1 });
      if (bp.torso === 'cockpit') return r.weighted({ none: 3, periscope: 3, sensor: 2, dome: 2, mono: 1 });
      return r.weighted({ visor: 3, mono: 2, cockpit: 2, horned: 2, sensor: 1, dome: 2, skull: 2, periscope: 1, none: 1 });
    });
    const armPool = legged || frame === 'hover'
      ? { cannon: 3, gatling: 3, missiles: 2, fist: 3, claw: 2, blade: 2, shield: 2, drill: 1, hammer: 2, flamer: 2, laser: 2, twin: 2 }
      : { cannon: 3, gatling: 3, missiles: 3, claw: 1, drill: 1, flamer: 2, laser: 2, twin: 3, hammer: 1, none: 2 };
    bp.armL = keep('armL', () => r.weighted(armPool));
    bp.armR = keep('armR', () => (r.chance(0.45) ? bp.armL : r.weighted(armPool)));
    bp.shoulders = keep('shoulders', () => r.weighted({ pauldron: 4, round: 2, launcher: 2, spiked: 1, shield: 2, none: 2 }));
    bp.back = keep('back', () => r.weighted({ missiles: 3, exhaust: 2, antenna: 2, tank: 2, radar: 1, artillery: 2, wings: 1, jetpack: 2, saw: 1, sensor: 2, none: 2 }));
    bp.scheme = keep('scheme', () => r.weighted({ mono: 2, split: 3, inverse: 1 }));
  }

  // ------------------------------------------------------------- build
  function build(bp) {
    const r = new RNG((bp.seed || 1) ^ 0x9e3779b9);
    const root = new MF.Node('root');
    const bulk = bp.bulk || 1, tall = bp.tall || 1, legLen = bp.legLen || 1, armLen = bp.armLen || 1;
    const e = bp.edge == null ? 1.5 : bp.edge;
    const mats = { mono: ['primary', 'primary', 'secondary'], split: ['primary', 'secondary', 'secondary'], inverse: ['secondary', 'secondary', 'primary'] }[bp.scheme || 'split'];
    const k = bp.size || 1;
    const ctx = { bp, r, root, bulk, tall, legLen, armLen, e, k, A: mats[0], B: mats[1], T: mats[2], M: 'metal', anims: [], stride: 30, hover: 0, fireDecay: 5 };
    MF.setBuildScale(k);
    try {
      lineOf(bp).build(ctx);
    } finally {
      MF.setBuildScale(1);
    }
    ctx.stride *= k; ctx.hover *= k;

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
      root, nodes, height: maxY, radius: Math.max(10, rad), stride: ctx.stride, hover: ctx.hover, fireDecay: ctx.fireDecay,
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
      case 'quadruped': return frameQuad(ctx);
      case 'tank': return frameTank(ctx);
      case 'hover': return frameHover(ctx);
      default: return frameBiped(ctx);
    }
  }

  function frameBiped(ctx) {
    const { root, bulk, legLen, e, B, T, M, r } = ctx;
    const thighL = Math.round(11 * legLen + 3), shinL = Math.round(12 * legLen + 3), footH = 3;
    const skirts = r.chance(0.6), pistons = r.chance(0.6);
    const legW = Math.round(4.5 * bulk + 1.5);
    const hipX = Math.round(4 * bulk + 3);
    const hipY = footH + thighL + shinL;
    const armored = r.chance(0.6);
    const pelvis = root.child('pelvis', [0, hipY + 1, 0]);
    pelvis.box(hipX * 2 - 1, 5, 7, { mat: M, bevel: 1 });
    pelvis.box(hipX * 1.2, 4, 3, { mat: T, at: [0, -1.5, 3.5], cuts: [[0, -1, 1, 2]] });
    if (skirts) for (const s of [-1, 1]) pelvis.box(2, 8, 8, { mat: ctx.A, at: [s * (hipX + legW / 2 + 1.8), -3, 0], rot: [0, 0, s * 0.12], bevel: 0.7, cuts: [[0, -1, 1, 2.5], [0, -1, -1, 2.5]], detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
    for (const s of [-1, 1]) {
      const hip = pelvis.child('hip' + s, [s * hipX, -1, 0]);
      hip.cyl('x', 2.6, 4, { mat: M, at: [s * 0.5, 0, 0] });
      hip.box(legW, thighL + 1, legW + 1, { at: [0, -thighL / 2, 0], mat: B, bevel: Math.min(e, 1.5) });
      if (armored) hip.box(legW + 1.5, thighL * 0.55, 2.5, { at: [s * 0.5, -thighL * 0.35, legW / 2 + 0.8], mat: T, bevel: 0.8, detail: { type: 'panel', face: '+z', at: 0, dir: 'h' } });
      const knee = hip.child('knee' + s, [0, -thighL, 0]);
      knee.cyl('x', 2.4, legW + 1.2, { mat: M });
      knee.box(legW + 2, shinL, legW + 3, { at: [0, -shinL / 2 - 0.5, 0.4], mat: B, bevel: e, bevelSet: 'vert', detail: armored ? { type: 'vent', face: '+z', pitch: 2, inset: 1.5 } : { type: 'panel', face: '+z', at: 0 } });
      knee.box(legW + 1, 4.5, 3, { at: [0, -0.5, legW / 2 + 2], mat: T, cuts: [[0, 1, 1, 1.6], [0, -1, 1, 1.2]] });
      if (pistons) knee.cyl('y', 0.9, shinL * 0.55, { at: [0, -shinL * 0.45, -(legW / 2 + 2.2)], mat: M, sides: 6 });
      const ankle = knee.child('ankle' + s, [0, -shinL, 0]);
      ankle.cyl('x', 1.8, legW + 2.5, { mat: M, at: [0, -0.5, 0] });
      ankle.box(legW + 3.5, footH, legW + 8, { at: [0, -footH / 2, 1.5], mat: M, bevel: 1, bevelSet: 'top' });
      ankle.box(legW + 2.5, 2, 3, { at: [0, -0.6, legW / 2 + 5], mat: T, cuts: [[0, 1, 1, 1.2]] });
    }
    const L = thighL + shinL, A = 0.42;
    ctx.stride = 4 * L * Math.sin(A);
    ctx.anims.push((st, n) => {
      const m = st.move, ph = st.phase;
      const drop = L * (1 - Math.cos(A * m * Math.sin(ph)));
      n.pelvis.pos[1] -= (drop + Math.sin(st.t * 2.2) * 0.35 * (1 - m)) * ctx.k;
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
      hip.cyl('y', 0.85, T1 * 0.7, { at: [0, -T1 * 0.5, -(legW + 3) / 2 - 0.9], mat: M, sides: 6 }); // hydraulic ram
      const knee = hip.child('knee' + s, [0, -T1, 0], [a2, 0, 0]);
      knee.cyl('x', 2.6, legW + 2, { mat: M });
      knee.cyl('x', 1.6, legW + 3.4, { mat: T, sides: 8 }); // joint caps
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
      n.pelvis.pos[1] -= (L * (1 - Math.cos(A * m * Math.sin(ph))) * 0.8 + Math.sin(st.t * 2.4) * 0.35 * (1 - m)) * ctx.k;
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
      if (count === 4) fem.box(F * 0.6, 2, 5 * bulk + 2, { at: [F * 0.45, 2.8, 0], mat: T, bevel: 0.6 });
      if (count === 4) fem.cyl('x', 0.85, F * 0.65, { at: [F * 0.5, -3.2, 0], mat: M, sides: 6 }); // hydraulic ram
      const knee = fem.child('knee' + i, [F, 0, 0], [0, 0, beta - alpha]);
      knee.cyl('z', 3.3, 5 * bulk + 3, { mat: M });
      knee.cyl('z', 2, 5 * bulk + 4.4, { mat: T, sides: 8 }); // joint caps
      knee.box(5.5, Tb * 0.62, 5 * bulk + 1.5, { at: [0.8, -Tb * 0.33, 0], mat: A, bevel: e, bevelSet: 'vert', detail: { type: 'bolts', face: 'any', inset: 1.5 } });
      knee.cyl('y', 1.5, Tb * 0.4, { at: [0, -Tb * 0.78, 0], mat: M, sides: 6 }); // piston rod
      knee.cone('y', 1.2, 2.6, 4, { at: [0, -Tb + 1.5, 0], mat: M, sides: 6 });
      legs.push({ i, side, g: groups[i] });
    });
    const reach = F * Math.cos(alpha) + Tb * Math.sin(beta) + hubR * 0.75;
    const sweep = 0.32;
    ctx.stride = 2 * reach * Math.sin(sweep) * 2;
    ctx.anims.push((st, n) => {
      const m = st.move;
      n.pelvis.pos[1] += (Math.sin(st.phase * 2) * 0.5 * m + Math.sin(st.t * 2) * 0.3 * (1 - m)) * ctx.k;
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

  // Four legs under a long chassis, front and back (mammal walker, not a splayed spider).
  // Front legs: elbow points back, forearm down-forward, short pastern. Hind legs: Z-shaped
  // (stifle forward, hock back). Diagonal pairs move together.
  function frameQuad(ctx) {
    const { root, bulk, legLen, e, A, B, T, M } = ctx;
    const legW = Math.round(3.5 * bulk + 1.5);
    const bodyW = Math.round(9 * bulk + 4), bodyL = Math.round(24 * bulk + 13);
    const footH = 2.5;
    // hind chain: thigh / shin / metatarsal
    const T1 = Math.round(9 * legLen + 4), S1 = Math.round(T1 * 0.95), M1 = Math.round(5 * legLen + 3);
    const hA = [-0.5, 1.15, -0.65];
    const H = footH + T1 * Math.cos(hA[0]) + S1 * Math.cos(hA[0] + hA[1]) + M1 * Math.cos(hA[0] + hA[1] + hA[2]);
    // front chain: upper arm (down-back) / forearm (down-forward) / pastern, sized to match hip height
    const fA = [0.4, -0.65, 0.25], F3 = 3;
    const F12 = (H - footH - F3 * Math.cos(fA[0] + fA[1] + fA[2])) / (Math.cos(fA[0]) + Math.cos(fA[0] + fA[1]));
    const F1 = F12, F2 = F12;
    const hub = root.child('pelvis', [0, H + 1, 0]);
    hub.box(bodyW, 6, bodyL, { at: [0, -1.5, 0], mat: M, bevel: 1.5, detail: { type: 'vent', face: 'side', pitch: 2, inset: 2 } });
    hub.box(bodyW + 2, 3, bodyL * 0.8, { at: [0, 1.5, -1], mat: A, bevel: Math.min(e, 1.2), cuts: [[0, 1, 1, 1.5], [0, 1, -1, 1.5]], detail: [{ type: 'panel', face: '+y', at: bodyL * 0.15, dir: 'h' }, { type: 'bolts', face: 'side', inset: 1.2 }] });
    hub.box(bodyW - 1, 5, 3, { at: [0, -1, bodyL / 2 + 1], mat: T, bevel: 0.8, cuts: [[0, -1, 1, 1.8]], detail: { type: 'light', face: '+z', pts: [[-bodyW * 0.28, 0.6], [bodyW * 0.28, 0.6]], size: 0.7 } });
    const legs = [];
    const hipX = bodyW / 2 + legW / 2 + 0.6;
    // i: 0 FL, 1 FR, 2 HL, 3 HR ; diagonal pairs FL+HR / FR+HL
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([s, f], i) => {
      const front = f > 0;
      const ang = front ? fA : hA;
      const L = front ? [F1, F2, F3] : [T1, S1, M1];
      const z = f * (bodyL / 2 - legW * 0.9);
      const hip = hub.child('qhip' + i, [s * hipX, -1, z], [ang[0], 0, 0]);
      hip.cyl('x', 3, legW + 2.5, { mat: M, sides: 8 });
      hip.cyl('x', 1.8, legW + 3.6, { mat: T, sides: 8 }); // joint caps
      hip.box(legW + 1, L[0] + 2, legW + 2, { at: [0, -L[0] / 2, 0], mat: B, bevel: Math.min(e, 1.4), detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
      if (!front) hip.box(1.5, L[0] * 0.7, legW + 2.5, { at: [s * (legW / 2 + 1.1), -L[0] * 0.45, 0], mat: A, bevel: 0.5, detail: { type: 'bolts', face: 'side', inset: 1 } });
      else hip.box(legW + 1.6, L[0] * 0.55, 2, { at: [0, -L[0] * 0.3, legW / 2 + 1.3], mat: A, bevel: 0.6 });
      const knee = hip.child('qknee' + i, [0, -L[0], 0], [ang[1], 0, 0]);
      knee.cyl('x', 2.4, legW + 1.6, { mat: M });
      knee.box(legW, L[1], legW, { at: [0, -L[1] / 2, 0], mat: M, bevel: 0.8 });
      // hydraulic piston on the outer face of the shin
      knee.cyl('y', 0.8, L[1] * 0.65, { at: [0, -L[1] * 0.5, (front ? -1 : 1) * (legW / 2 + 1)], mat: T, sides: 6 });
      const ank = knee.child('qank' + i, [0, -L[1], 0], [ang[2], 0, 0]);
      ank.box(legW + 0.5, L[2] + 1, legW + 0.5, { at: [0, -L[2] / 2, 0], mat: front ? M : B, bevel: 0.8 });
      const foot = ank.child('qfoot' + i, [0, -L[2], 0], [-(ang[0] + ang[1] + ang[2]), 0, 0]);
      foot.box(legW + 2.5, footH, legW + 5, { at: [0, -footH / 2, 1], mat: M, bevel: 0.8, bevelSet: 'top', cuts: [[0, 1, 1, 1.4]] });
      legs.push({ i, front, g: i === 0 || i === 3 ? 0 : 1 });
    });
    const Aw = 0.3;
    ctx.stride = 4 * H * Math.sin(Aw) * 0.85;
    ctx.anims.push((st, n) => {
      const m = st.move, ph = st.phase;
      n.pelvis.pos[1] -= (H * (1 - Math.cos(Aw * m * Math.sin(ph))) * 0.85 + Math.sin(st.t * 2) * 0.3 * (1 - m)) * ctx.k;
      n.pelvis.rot[0] = Math.sin(ph * 2) * 0.025 * m;
      n.pelvis.rot[2] = Math.sin(ph) * 0.03 * m;
      for (const L of legs) {
        const p = ph + L.g * PI;
        const hip = -Aw * Math.sin(p) * m;
        const lift = Math.max(0, Math.cos(p)) * m;
        let dh, dk, da;
        if (L.front) { dh = hip - lift * 0.1; dk = -lift * 0.75; da = lift * 0.7; }
        else { dh = hip - lift * 0.3; dk = lift * 0.6; da = -lift * 0.45; }
        n['qhip' + L.i].rot[0] += dh;
        n['qknee' + L.i].rot[0] += dk;
        n['qank' + L.i].rot[0] += da;
        n['qfoot' + L.i].rot[0] -= dh + dk + da;
      }
      if (n.torso) n.torso.rot[1] = -Math.sin(ph) * 0.06 * m;
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
      n.pelvis.pos[1] += Math.sin(st.t * 3) * 1.2 * ctx.k;
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
      case 'cockpit': { // low tank-like hull with a glass canopy strip on the sloped glacis
        const Wc = Math.round(W * 1.05), Hh = Math.round(Ht * 0.7 + 3), Dh = Math.round(D * 1.4 + 2);
        const cy = 3.5 + Hh / 2, c = Math.round(Math.min(Hh, Dh) * 0.6);
        const hy = Hh / 2, hz = Dh / 2;
        torso.box(W * 0.5, 5, D * 0.6, { at: [0, 2.5, 0], mat: M, bevel: 1 });
        torso.box(Wc, Hh, Dh, { at: [0, cy, 0], mat: A, bevel: Math.min(e, 1.5), cuts: [[0, 1, 1, c], [0, 1, -1, 2.5], [1, 0, 1, 2], [-1, 0, 1, 2]], detail: [{ ...num, face: 'side', u: -Dh * 0.15, v: 0 }, { type: 'panel', face: '+y', at: -Dh * 0.18, dir: 'h' }, { type: 'light', face: '+z', pts: [[-Wc * 0.3, -hy * 0.45], [Wc * 0.3, -hy * 0.45]], size: 0.8 }] });
        // canopy lies on the 45deg glacis cut: midpoint of the cut edge, nudged out along its normal
        torso.box(Wc * 0.72, 1.4, c * 1.41 * 0.62, { at: [0, cy + hy - c / 2 + 0.35, hz - c / 2 + 0.35], rot: [PI / 4, 0, 0], mat: 'glass', bevel: 0.4 });
        torso.box(Wc * 0.8, 1.6, 2.2, { at: [0, cy + hy - 0.2, hz - c - 0.6], mat: T, bevel: 0.5 }); // canopy brow
        for (const s of [-1, 1]) torso.box(2.6, Hh * 0.6, Dh * 0.85, { at: [s * (Wc / 2 + 1.1), 3.5 + Hh * 0.32, -0.5], mat: B, bevel: 0.7, cuts: [[0, -1, 1, 2], [0, -1, -1, 2]], detail: { type: 'vent', face: 'side', pitch: 2, inset: 1.4 } });
        torso.cyl('y', 2.6, 1.6, { at: [Wc * 0.2, 3.5 + Hh + 0.6, -Dh * 0.25], mat: T, sides: 8, detail: { type: 'bolts', face: '+y', inset: 1 } });
        Object.assign(out, { neck: [-Wc * 0.12, 3.5 + Hh + 0.5, -Dh * 0.22], shY: 3.5 + Hh * 0.7, shX: Wc / 2 + 2, backY: 3.5 + Hh * 0.5, backZ: -Dh / 2, topY: 3.5 + Hh, W: Wc + 2, D: Dh });
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
    greebleTorso(ctx, out);
    ctx.anims.push((st, n) => {
      n.torso.pos[1] += Math.sin(st.t * 2.2 + 0.6) * 0.3 * (1 - st.move) * ctx.k;
    });
    return out;
  }

  function greebleTorso(ctx, t) {
    const { r, M, T } = ctx;
    const n = t.node;
    const midY = (t.shY + (t.topY || t.shY)) / 2 - 2;
    if (r.chance(0.55) && ctx.bp.torso !== 'barrel') {
      // side vent pods under the shoulders
      for (const s of [-1, 1]) n.box(2, 4, Math.max(4, t.D * 0.45), { at: [s * (t.W / 2 + 0.8), Math.max(5, t.shY - 5), -0.5], mat: M, bevel: 0.5, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 0.4 } });
    }
    if (r.chance(0.5)) {
      // twin exhaust pipes low on the back
      for (const s of [-1, 1]) n.cyl('z', 1.1, 4, { at: [s * t.W * 0.22, 5.5, -t.D / 2 - 1.5], mat: M, sides: 6 });
    }
    if (r.chance(0.45)) {
      // hose from chest to back
      n.cyl('x', 0.8, t.W * 0.5, { at: [0, midY, -t.D / 2 - 0.6], mat: M, sides: 6 });
    }
    if (r.chance(0.5)) n.box(1.4, 1.4, 1.2, { at: [t.W * 0.3, t.shY + 1, t.D / 2 + 0.2], mat: 'accent', shadow: false });
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
      case 'dome': { // octagonal dome with a wraparound glass band
        const R = Math.round(hw / 2 + 0.5);
        head.cyl('x', 1.7, 2 * R + 3, { at: [0, 2.8, -0.3], mat: M, sides: 8 }); // ear cans
        head.cyl('y', R, 3.6, { at: [0, 2.8, 0], mat: A, sides: 8, detail: { type: 'panel', face: '+z', at: -0.6, dir: 'h' } });
        head.cyl('y', R + 0.35, 2.2, { at: [0, 5.7, 0], mat: 'glass', sides: 8, detail: { type: 'eye', face: '+z', at: 0, h: 0.55, w: 1.6 } });
        head.cone('y', R, R * 0.4, 3.6, { at: [0, 8.6, 0], mat: A, sides: 8 });
        head.box(1.2, 2.2, R + 1, { at: [0, 10.6, -0.8], mat: T, cuts: [[0, 1, 1, 1.2]] });
        break;
      }
      case 'skull': { // angular cranium, brow ridge over twin eye lights, V-jaw with grille
        head.box(hw, hh - 0.5, hd, { at: [0, hh / 2 + 3, -0.6], mat: A, bevel: 1, cuts: [[0, -1, 1, 2.4], [1, 1, 0, 1.6], [-1, 1, 0, 1.6]] });
        head.box(hw - 1.4, 2, 1.2, { at: [0, hh + 0.6, hd / 2 - 0.6], mat: M });
        for (const sx of [-1, 1]) head.box(1.6, 1.1, 0.8, { at: [sx * hw * 0.2, hh + 0.6, hd / 2 + 0.1], mat: 'accent', shadow: false });
        head.box(hw + 0.8, 1.6, 2.6, { at: [0, hh + 2.2, hd / 2 - 0.9], mat: T, bevel: 0.4, cuts: [[0, 1, 1, 1.2], [0, -1, 1, 0.8]] });
        head.cyl('x', 1.3, hw + 1.2, { at: [0, 3.8, -0.6], mat: M, sides: 6 }); // jaw hinge
        head.box(hw * 0.8, 3.8, hd * 0.8, { at: [0, 2.6, 1.3], mat: B, bevel: 0.4, cuts: [[1, 0, 1, 2.4], [-1, 0, 1, 2.4], [0, -1, 1, 1.8]], detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.5 } });
        break;
      }
      case 'periscope': { // small head with a tall offset sensor mast
        head.box(hw - 1.5, 4.2, hd - 1.5, { at: [0, 3, 0], mat: A, bevel: 1, detail: { type: 'eye', face: '+z', at: 0.2, h: 0.6, w: (hw - 1.5) / 2 - 1.3 } });
        head.box(hw - 3, 1.6, 2, { at: [0, 1.4, (hd - 1.5) / 2 + 0.4], mat: M });
        const sx = r.chance(0.5) ? 1 : -1;
        const scope = head.child('scope', [sx * ((hw - 1.5) / 2 + 0.3), 4.2, -1.2]);
        scope.cyl('y', 1.5, 1.6, { at: [0, 0.4, 0], mat: T, sides: 8 });
        scope.cyl('y', 0.8, 10, { at: [0, 5.5, 0], mat: M, sides: 6 });
        scope.box(2.8, 2.6, 5, { at: [0, 11.2, 0.8], mat: A, bevel: 0.6, cuts: [[0, 1, 1, 1]] });
        scope.box(1.8, 1.4, 0.8, { at: [0, 11, 3.5], mat: 'accent', shadow: false });
        ctx.anims.push((st, n) => { if (n.scope) n.scope.rot[1] = Math.sin(st.t * 0.8) * 0.6; });
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
    const ranged = type === 'cannon' || type === 'gatling' || type === 'missiles' || type === 'flamer' || type === 'laser' || type === 'twin';
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
      if (!ranged) elbow.box(aw + 1, 3, 2, { at: [0, 0.5, -aw / 2 - 1.2], mat: T, cuts: [[0, 1, -1, 1.2]] });
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
        sh.box(2, 18 * armLen, 12 * bulk, { at: [0, -3, 0], mat: A, bevel: 1, cuts: [[0, -1, 1, 4], [0, -1, -1, 4]], detail: [{ type: 'band', face: 'side', at: -3, size: 1.2, mat2: 'secondary' }, { type: 'band', face: 'side', at: 0.5, size: 0.6, mat2: 'secondary' }, { type: 'bolts', face: 'side', inset: 1.5 }] });
        break;
      }
      case 'drill': {
        w.box(aw + 2, 4, aw + 2, { at: [0, -1.5, 0], mat: T, bevel: 1 });
        const d = w.child('spin' + s, [0, -4, 0]);
        d.cone('y', 0.3, 3.6, 12, { at: [0, -6, 0], mat: M, sides: 6, detail: { type: 'band', dir: 'h', at: 0, size: 0.6 } });
        ctx.anims.push((st, n) => { n['spin' + s].rot[1] = st.t * (3 + 12 * st.move); });
        break;
      }
      case 'hammer': { // hydraulic hammer: cuff, twin pistons, heavy head with round strike faces
        w.box(aw + 1.5, 3.5, aw + 1.5, { at: [0, -1.2, 0], mat: M, bevel: 0.8 });
        for (const sd of [-1, 1]) w.cyl('y', 0.7, 6.5, { at: [sd * 2.1, -5, 0], mat: T, sides: 6 });
        const hl = Math.round(11 + 3 * bulk);
        w.box(aw + 3, 6.5, hl, { at: [0, -10.5, 0], mat: A, bevel: 1, detail: [{ type: 'band', face: 'side', dir: 'v', at: 0, size: 1.2, mat2: 'secondary' }, { type: 'bolts', face: 'side', inset: 1.3 }] });
        w.cyl('z', 3.4, 2.4, { at: [0, -10.5, hl / 2 + 1], mat: M, sides: 8, twist: PI / 8 });
        w.cyl('z', 2.6, 1.8, { at: [0, -10.5, -hl / 2 - 0.8], mat: M, sides: 8, twist: PI / 8 });
        break;
      }
      case 'flamer': { // stubby barrel + flared nozzle, fuel tank on top, pilot light at the tip
        w.box(aw + 2, 5, aw + 2, { at: [0, -2, 0], mat: T, bevel: 1, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 0.6 } });
        w.cyl('y', 1.4, 7, { at: [0, -8, 0], mat: M, sides: 6 });
        w.cone('y', 2.7, 1.5, 4, { at: [0, -13, 0], mat: M, sides: 8, twist: PI / 8 });
        w.cyl('y', 1.5, 0.6, { at: [0, -15.2, 0], mat: 'accent', sides: 8, twist: PI / 8, shadow: false });
        w.cyl('y', 2.3, 9, { at: [0, -5, aw / 2 + 2.6], mat: ctx.bp.scheme === 'inverse' ? 'primary' : 'secondary', sides: 8, twist: PI / 8, detail: { type: 'band', at: 0, size: 0.8 } });
        w.box(1.2, 1.2, 1.4, { at: [0, -14.4, 2.6], mat: 'accent', shadow: false });
        break;
      }
      case 'laser': { // long thin barrel wrapped in glowing coils
        const len = Math.round(19 + 6 * armLen);
        w.box(aw + 2, 6, aw + 2.5, { at: [0, -2.5, 0], mat: T, bevel: 1, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 0.7 } });
        w.cyl('y', 0.9, len, { at: [0, -5 - len / 2, 0], mat: M, sides: 6 });
        for (let k = 0; k < 3; k++) w.cyl('y', 1.9, 1.2, { at: [0, -7.5 - k * 3.2, 0], mat: 'accent', sides: 8, shadow: false });
        w.box(2.6, 2.4, 2.6, { at: [0, -5 - len + 1.2, 0], mat: M, bevel: 0.5 });
        break;
      }
      case 'twin': { // two short cannons stacked one over the other
        w.box(aw + 2, 5.5, aw + 5, { at: [0, -2.2, 0], mat: A, bevel: 1, detail: [{ type: 'panel', face: 'side', at: 0, dir: 'h' }, { type: 'bolts', face: 'side', inset: 1.2 }] });
        for (const dz of [-2, 2]) {
          w.cyl('y', 1.3, 10, { at: [0, -9.5, dz], mat: M, sides: 6 });
          w.box(3, 2.6, 3, { at: [0, -14.5, dz], mat: M, bevel: 0.6 });
        }
        break;
      }
      default: { // fist
        w.box(aw + 2.5, 5, aw + 2.5, { at: [0, -2.5, 0.3], mat: M, bevel: 1, detail: { type: 'panel', face: '+z', at: -0.8, dir: 'h' } });
        w.box(aw + 3, 2, aw + 3, { at: [0, -0.2, 0.3], mat: T, bevel: 0.6 });
      }
    }
    // muzzle flash (Space to fire): hidden flare at the barrel tip plus recoil
    const tips = { cannon: -4 - Math.round(16 + 6 * armLen) - 1.5, gatling: -15, missiles: -9, flamer: -16, laser: -5 - Math.round(19 + 6 * armLen) - 1.5, twin: -16 };
    if (tips[type] != null) {
      const zs = type === 'twin' ? [-2, 2] : [0];
      zs.forEach((dz, i) => {
        const mz = w.child('muzzle' + s + i, [type === 'missiles' ? s * 1.5 : 0, tips[type], dz]);
        mz.startHidden = true;
        muzzleFlash(mz, type === 'flamer' ? 'flame' : type === 'missiles' ? 'puff' : type === 'laser' ? 'beam' : 'flash');
      });
      ctx.anims.push((st, n) => {
        const on = st.fire > 0.55 || (type === 'flamer' && st.fire > 0.1) || (type === 'gatling' && st.fire > 0.1 && Math.floor(st.t * 30) % 2 === 0);
        zs.forEach((_, i) => { n['muzzle' + s + i].hidden = !on; });
        const el = n['elbow' + s];
        if (el) el.rot[0] -= st.fire * (type === 'gatling' || type === 'flamer' ? 0.05 : 0.22);
        if (type === 'gatling' && n['spin' + s]) n['spin' + s].rot[1] += st.fire * st.t * 40;
      });
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

  // flare shapes pointing down the node's -y axis (the barrel direction)
  function muzzleFlash(n, kind) {
    const glow = { mat: 'accent', shadow: false };
    if (kind === 'flame') {
      n.cone('y', 0.8, 3.2, 14, { ...glow, at: [0, -7, 0], sides: 6 });
      n.cone('y', 2.2, 0.4, 4, { ...glow, at: [0, -15.5, 0], sides: 6 });
    } else if (kind === 'beam') {
      n.cyl('y', 0.8, 40, { ...glow, at: [0, -20, 0], sides: 6 });
      n.box(4, 1, 4, { ...glow, at: [0, -0.5, 0] });
    } else if (kind === 'puff') {
      n.box(5, 3, 5, { ...glow, at: [0, -1.5, 0], bevel: 1.2 });
      n.cone('y', 0.2, 2, 6, { ...glow, at: [0, -6, 0], sides: 5 });
    } else {
      n.cone('y', 0.2, 2.6, 6, { ...glow, at: [0, -3, 0], sides: 6 });
      n.box(7, 1.2, 1.2, { ...glow, at: [0, -0.8, 0] });
      n.box(1.2, 1.2, 7, { ...glow, at: [0, -0.8, 0] });
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
      case 'shield': { // layered plates: a cap sloping outward-down, then a big flat side shield
        shoulder.box(w + 1, 2, d + 1, { at: [s * 2.8, 4.2, 0], mat: T, rot: [0, 0, -s * 0.38], bevel: 0.6, cuts: [[0, 1, 1, 1], [0, 1, -1, 1]] });
        shoulder.box(w + 2, 2, d + 3, { at: [s * 4.6, 2.6, 0], mat: A, rot: [0, 0, -s * 0.62], bevel: 0.6, detail: [{ type: 'band', face: '+y', dir: 'v', at: s * (w / 2 - 0.6), size: 0.7, mat2: bp.scheme === 'inverse' ? 'primary' : 'secondary' }, { type: 'bolts', face: '+y', inset: 1.2 }] });
        shoulder.box(1.8, 10, d + 1, { at: [s * (w / 2 + 4.6), -3.2, 0.5], mat: A, rot: [0, 0, s * 0.2], bevel: 0.7, cuts: [[0, -1, 1, 3], [0, -1, -1, 3]], detail: [{ type: 'panel', face: 'side', at: -1, dir: 'h' }, { type: 'bolts', face: 'side', inset: 1.4 }] });
        break;
      }
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
        const mz = gun.child('muzzleArt', [0, 0.5, 6 + 24 + 6 * tall], [-PI / 2, 0, 0]);
        mz.startHidden = true;
        muzzleFlash(mz, 'flash');
        ctx.anims.push((st, n) => { n.muzzleArt.hidden = !(st.fire > 0.55 && st.fireN % 2 === 0); n.gun.pos[2] -= st.fire * 2 * ctx.k; });
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
      case 'jetpack': { // pack with two thrusters angled down/back, flickering exhaust
        back.box(tor.W * 0.6, 10, 5, { at: [0, 2, -2.5], mat: A, bevel: 1.2, detail: [{ type: 'vent', face: '-z', pitch: 2, inset: 2 }, { type: 'bolts', face: '-z', inset: 1.2 }] });
        const jx = Math.max(4, tor.W * 0.27);
        for (const s of [-1, 1]) {
          const j = back.child('jet' + s, [s * jx, 3, -6.5], [0.32, 0, s * -0.1]);
          j.cone('y', 3.1, 2.1, 12, { at: [0, 1, 0], mat: T, sides: 8, twist: PI / 8, detail: [{ type: 'band', at: 3, size: 0.8, mat2: bp.scheme === 'inverse' ? 'primary' : 'secondary' }, { type: 'panel', at: -2.5, dir: 'h' }] });
          j.cone('y', 3.4, 2.6, 3, { at: [0, -6.5, 0], mat: M, sides: 8, twist: PI / 8 });
          const f = j.child('flame' + s, [0, -8, 0]);
          f.cone('y', 0.5, 2.6, 4, { at: [0, -1.5, 0], mat: 'accent', sides: 8, twist: PI / 8, shadow: false });
        }
        ctx.anims.push((st, n) => {
          for (const s of [-1, 1]) n['flame' + s].pos[1] += (Math.sin(st.t * 37 + s) * 0.35 - 0.5 * st.move) * ctx.k;
        });
        break;
      }
      case 'saw': { // buzz saw on a boom reaching over one shoulder
        const sd = bp.armL === 'none' || bp.armL === 'shield' ? -1 : 1;
        back.box(5.5, 7, 5, { at: [sd * tor.W * 0.25, 2, -2.5], mat: M, bevel: 1, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1 } });
        const Lb = Math.round(12 + 3 * tall);
        const boom = back.child('sawBoom', [sd * tor.W * 0.28, 4, -3], [0.55, 0, -sd * 0.42]);
        boom.box(3, Lb, 3.2, { at: [0, Lb / 2, 0], mat: B, bevel: 0.8, detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
        boom.cyl('y', 0.8, Lb * 0.7, { at: [0, Lb * 0.45, -2.4], mat: T, sides: 6 });
        const hub = boom.child('sawHub', [0, Lb, 0], [-0.55, 0, sd * 0.42]);
        hub.cyl('x', 2.8, 4, { at: [-sd * 0.5, 0, 0], mat: T, sides: 8 });
        const bl = hub.child('sawBlade', [sd * 2.6, 0, 0]);
        const a = Math.round(4.5 * bulk + 1.5);
        bl.box(0.9, a * 2, a * 2, { mat: M });
        bl.box(0.9, a * 2, a * 2, { mat: M, rot: [PI / 4, 0, 0] });
        bl.cyl('x', a * 1.12, 1.3, { mat: T, sides: 12, detail: [{ type: 'panel', face: 'side', at: 0, dir: 'v' }, { type: 'panel', face: 'side', at: 0, dir: 'h' }] });
        bl.cyl('x', 1.8, 2, { mat: M, sides: 6 });
        ctx.anims.push((st, n) => { n.sawBlade.rot[0] = -st.t * (5 + 7 * st.move); });
        break;
      }
      case 'sensor': { // tall mast with a spinning radar bar
        back.box(4.5, 6, 4, { at: [0, 1, -2], mat: M, bevel: 1 });
        const mh = Math.round(18 * tall + 2);
        back.cyl('y', 0.9, mh, { at: [0, 4 + mh / 2, -2.5], mat: M, sides: 6 });
        back.box(3, 1.4, 3, { at: [0, 4 + mh * 0.55, -2.5], mat: T, bevel: 0.3 });
        const bar = back.child('sensorBar', [0, 4 + mh, -2.5]);
        bar.cyl('y', 1.7, 1.8, { at: [0, 0.4, 0], mat: T, sides: 8 });
        const bw = Math.round(10 + 4 * bulk);
        bar.box(bw, 1.8, 2, { at: [0, 1.9, 0], mat: A, bevel: 0.4, detail: { type: 'light', face: '+z', pts: [[-bw * 0.3, 0], [0, 0], [bw * 0.3, 0]], size: 0.5 } });
        bar.box(1.3, 1.3, 1.3, { at: [bw / 2 + 0.3, 1.9, 0], mat: 'accent', shadow: false });
        ctx.anims.push((st, n) => { n.sensorBar.rot[1] = st.t * 2.2; });
        break;
      }
    }
  }

  function buildModular(ctx) {
    const { bp } = ctx;
    const hub = buildFrame(ctx);           // returns node the torso sits on
    const tor = buildTorso(ctx, hub);       // returns anchors
    buildHead(ctx, tor);
    buildArm(ctx, tor, -1, bp.armL);
    buildArm(ctx, tor, 1, bp.armR);
    buildBack(ctx, tor);
  }

  const slot = (key, label, opt) => ({ key, label, options: OPTIONS[opt || key], labels: LABELS[opt || key] });
  registerLine('modular', {
    label: 'Modular frame', group: 'Mechs', weight: 2,
    slots: [slot('frame', 'Chassis'), slot('torso', 'Torso'), slot('head', 'Head'), slot('armL', 'Left arm', 'arm'), slot('armR', 'Right arm', 'arm'), slot('shoulders', 'Shoulders'), slot('back', 'Backpack'), slot('scheme', 'Paint split')],
    random: randomModular,
    build: buildModular,
  });

  MF.Gen = {
    OPTIONS, LABELS, randomBlueprint, build, NAMES, PREFIX, LINES, registerLine, lineOf,
    // building blocks other lines can reuse
    parts: { buildFrame, frameBiped, buildTorso, greebleTorso, buildHead, buildArm, buildShoulderArmor, buildBack, muzzleFlash },
  };
})();
