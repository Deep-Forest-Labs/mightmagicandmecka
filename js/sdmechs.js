// Mecha Factory — "Heroic frame" line: super-deformed, Gundam-inspired mechs.
// ~3 heads tall: big head with a proper face, big chest block, huge shoulder armour, short thick
// limbs, big feet, narrow waist with skirt armour and big backpacks. Seven archetypes with their
// own silhouettes, plus Armored-Core-style hardpoints: right hand, left hand and two shoulder mounts.
//
// Weapons are self-contained builders collected in WEAPONS (exposed as MF.Gen.sdWeapons) so other
// lines can reuse them. Mount-frame convention for every weapon: +z = muzzle / forward,
// +y = up (the direction a held blade points), x = sideways; the origin is the grip (hand) or the
// mount bracket. A builder adds its own muzzle flash and its own st.fire animation; when it is
// given arm joints (o.joints) it also drives the arm through the shared attack motion (armMotion).
(function () {
  const MF = window.MF;
  const G = MF.Gen;
  const PI = Math.PI;

  // ------------------------------------------------------------------ palettes
  // Gundam-style tricolour blocking: primary armour, secondary chest, tertiary waist/feet/shield,
  // accent = yellow V-fin/vents and every emissive bit.
  Object.assign(MF.PALETTES, {
    'Zaku Green':    { primary: '#6b9a4f', secondary: '#35593c', metal: '#474c58', accent: '#ffcf3a', glass: '#ff5c9d', tertiary: '#9aa39a', outline: '#111a12', bg: '#c8c3a8', floor: '#b6b196' },
    'Titans Navy':   { primary: '#33406b', secondary: '#1d2239', metal: '#4d5266', accent: '#ffb02e', glass: '#ff4d5e', tertiary: '#d5d7de', outline: '#0b0d17', bg: '#9ba1b0', floor: '#8b91a0' },
    'Gold Frame':    { primary: '#f2efe7', secondary: '#d29b2c', metal: '#3b4152', accent: '#fff07a', glass: '#5ef0ff', tertiary: '#2f57bf', outline: '#15131c', bg: '#34445e', floor: '#2c3a52' },
    'Hazard Orange': { primary: '#f08a2a', secondary: '#2f2e38', metal: '#4b4b57', accent: '#ffe14a', glass: '#6ff0ff', tertiary: '#ebe5d4', outline: '#16120e', bg: '#4a5260', floor: '#404855' },
    'Black Knight':  { primary: '#3a3a47', secondary: '#bd922e', metal: '#62646f', accent: '#ffd24a', glass: '#ff4a4a', tertiary: '#a3212f', outline: '#0d0c11', bg: '#a39d90', floor: '#948e81' },
    'Ghost Camo':    { primary: '#808964', secondary: '#4c5741', metal: '#3c3f40', accent: '#ffb347', glass: '#7fffd4', tertiary: '#bdb28b', outline: '#131610', bg: '#5d6470', floor: '#525965' },
  });
  const SD_PALETTES = ['Tricolor', 'Red Comet', 'Zaku Green', 'Titans Navy', 'Gold Frame', 'Hazard Orange', 'Black Knight', 'Ghost Camo'];

  // ------------------------------------------------------------------ helpers
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // keyframed pose deltas: ks = [[u, {sh, el, ry, tw, ln, lu}], ...] with u ascending
  function keyed(u, ks) {
    if (u <= ks[0][0]) return ks[0][1];
    for (let i = 1; i < ks.length; i++) {
      if (u <= ks[i][0]) {
        const [u0, a] = ks[i - 1], [u1, b] = ks[i];
        const t = smooth((u - u0) / (u1 - u0));
        const o = {};
        for (const k of ['sh', 'el', 'ry', 'tw', 'ln', 'lu']) o[k] = (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
        return o;
      }
    }
    return ks[ks.length - 1][1];
  }
  const Z = {};
  const MOTIONS = {
    // overhead chop that ends in a low diagonal follow-through
    slash: [[0, Z], [0.14, { sh: -2.5, el: -0.7, ry: 0.15, tw: 0.35, ln: -0.06 }], [0.4, { sh: 0.35, el: 0.4, ry: -0.45, tw: -0.45, ln: 0.12, lu: 1.5 }], [0.7, { sh: 0.2, el: 0.3, ry: -0.3, tw: -0.3, ln: 0.08, lu: 1 }], [1, Z]],
    // lance / spear: pull back, lunge
    thrust: [[0, Z], [0.16, { sh: 0.35, el: -0.3, tw: 0.3, ln: -0.05 }], [0.38, { sh: -0.35, el: 0.9, tw: -0.35, ln: 0.12, lu: 4 }], [0.7, { sh: -0.3, el: 0.7, tw: -0.25, ln: 0.08, lu: 3 }], [1, Z]],
    // straight punch from a fist pose
    punch: [[0, Z], [0.14, { sh: 0.45, el: -1.3, tw: 0.35 }], [0.34, { sh: -1.6, el: 0.3, ry: -0.15, tw: -0.4, ln: 0.1, lu: 2.5 }], [0.65, { sh: -1.4, el: 0.2, tw: -0.3, ln: 0.08, lu: 2 }], [1, Z]],
    // hold the weapon up in front and twirl it (the weapon spins itself)
    spin: [[0, Z], [0.12, { sh: -1.2, el: 0.3, ry: -0.2 }], [0.85, { sh: -1.2, el: 0.3, ry: -0.2 }], [1, Z]],
    // shield bash
    bash: [[0, Z], [0.15, { sh: 0.25, el: 0.1, tw: 0.25 }], [0.35, { sh: -0.35, el: -0.1, tw: -0.3, ln: 0.08, lu: 2.5 }], [1, Z]],
  };
  // Shared attack motion. f = st.fire (1 right after the trigger, decaying to 0).
  // J = { sh, el, torso, pelvis } node names; s = side (+1 left, -1 right).
  function armMotion(kind, f, n, J, s, k) {
    if (!(f > 0) || !kind) return;
    let d;
    if (kind === 'shoot') d = { sh: 0.05 * f, el: -0.28 * f };
    else if (kind === 'heavy') d = { sh: 0.12 * f, el: -0.45 * f, ln: -0.07 * f, lu: -1.2 * f };
    else if (kind === 'spray') d = { el: -0.06 * f + Math.sin(f * 60) * 0.03 };
    else d = keyed(1 - f, MOTIONS[kind] || MOTIONS.punch);
    const sh = J.sh && n[J.sh], el = J.el && n[J.el], tor = J.torso && n[J.torso], pel = J.pelvis && n[J.pelvis];
    if (sh) { sh.rot[0] += d.sh || 0; sh.rot[1] += (d.ry || 0) * s; }
    if (el) el.rot[0] = Math.min(0.05, el.rot[0] + (d.el || 0));
    if (tor) { tor.rot[1] += (d.tw || 0) * s; tor.rot[0] += d.ln || 0; }
    if (pel) pel.pos[2] += (d.lu || 0) * k;
  }
  // fire value for this weapon, honouring alternation between two melee hands
  const fireOf = (st, o) => (o.alt == null || ((st.fireN | 0) & 1) === o.alt ? st.fire || 0 : 0);
  const flash = (node, name, at, kind, rot) => {
    const mz = node.child(name, at, rot || [-PI / 2, 0, 0]); // flare points down local -y -> weapon +z
    mz.startHidden = true;
    G.parts.muzzleFlash(mz, kind);
    return mz;
  };
  const GLOW = { mat: 'accent', shadow: false };

  // ------------------------------------------------------------------ weapons
  // pose: rest pose of the arm holding it (see POSES). attack: armMotion kind.
  // hand: fits a hand slot. mount: fits a shoulder/back mount. twoHand: the free hand supports it.
  const WEAPONS = {
    none: { label: 'Empty hand', hand: true, mount: true, pose: 'fist', attack: null, build() {} },

    beamRifle: {
      label: 'Beam rifle', hand: true, pose: 'aim', attack: 'shoot',
      build(ctx, g, s, o) {
        const id = o.id;
        const body = g.child(id + 'slide');
        body.box(3, 4.2, 11, { at: [0, 1.6, 3.2], mat: 'primary', bevel: 0.6, cuts: [[0, 1, 1, 1.4]], detail: { type: 'panel', face: 'side', at: 1, dir: 'v' } });
        body.box(2.2, 2.4, 4.5, { at: [0, 4.3, 2], mat: 'secondary', bevel: 0.4 }); // sensor
        body.box(1.4, 1.4, 1, { at: [0, 4.3, 4.4], mat: 'glass', shadow: false });
        body.cyl('z', 1.1, 7, { at: [0, 2.2, 11.5], mat: 'metal', sides: 6 });
        body.box(2.4, 3.4, 3, { at: [0, 1.4, -3.4], mat: 'metal', bevel: 0.4 }); // stock
        body.box(1.6, 3, 1.8, { at: [0, -1.5, 6.5], mat: 'metal' }); // foregrip
        flash(body, id + 'mz', [0, 2.2, 15.2], 'beam');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.6);
          n[id + 'slide'].pos[2] -= f * 1.2 * ctx.k;
          if (o.joints) armMotion('shoot', f, n, o.joints, s, ctx.k);
        });
      },
    },

    machineGun: {
      label: 'Machine gun', hand: true, pose: 'aim', attack: 'spray',
      build(ctx, g, s, o) {
        const id = o.id;
        const body = g.child(id + 'slide');
        body.box(3, 4, 9, { at: [0, 1.5, 2.5], mat: 'metal', bevel: 0.5, detail: { type: 'vent', face: 'side', pitch: 1.2, inset: 0.8 } });
        body.cyl('x', 3, 2.2, { at: [s * 2.2, 1.2, 1.5], mat: 'secondary', sides: 8, detail: { type: 'bolts', face: 'side', inset: 1.4 } }); // drum magazine
        body.cyl('z', 0.9, 7, { at: [0, 2.2, 10], mat: 'metal', sides: 6 });
        body.box(2, 2, 2.4, { at: [0, 2.2, 13.2], mat: 'metal' }); // muzzle brake
        body.box(1, 2.6, 1, { at: [0, 4.6, 5], mat: 'metal' }); // sight
        body.box(2.4, 3, 3.6, { at: [0, 0.8, -3.4], mat: 'primary', bevel: 0.4 }); // stock
        flash(body, id + 'mz', [0, 2.2, 14.6], 'flash');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.12 && Math.floor(f * 14) % 2 === 0);
          n[id + 'slide'].pos[2] -= (f > 0.1 ? (Math.floor(f * 14) % 2) * 0.8 : 0) * ctx.k;
          if (o.joints) armMotion('spray', f, n, o.joints, s, ctx.k);
        });
      },
    },

    bazooka: {
      label: 'Bazooka', hand: true, pose: 'aim', attack: 'heavy',
      build(ctx, g, s, o) {
        const id = o.id;
        const body = g.child(id + 'slide', [s * 1.5, 4.5, 0]);
        body.cyl('z', 2.6, 20, { at: [0, 0, 3], mat: 'secondary', sides: 8, twist: PI / 8, detail: { type: 'band', dir: 'h', at: 0, size: 0.8, mat2: 'tertiary' } });
        body.cone('z', 2.6, 3.4, 3, { at: [0, 0, 14.5], mat: 'metal', sides: 8, twist: PI / 8 });
        body.cone('z', 3.2, 2.4, 2.5, { at: [0, 0, -8.2], mat: 'metal', sides: 8, twist: PI / 8 });
        body.box(2.4, 3, 5, { at: [-s * 3.2, 1.2, 4], mat: 'primary', bevel: 0.5 }); // scope
        body.box(1.6, 4.5, 2, { at: [0, -3.4, 1], mat: 'metal' }); // grip
        flash(body, id + 'mz', [0, 0, 16.5], 'puff');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.5);
          n[id + 'slide'].pos[2] -= f * 2.5 * ctx.k;
          if (o.joints) armMotion('heavy', f, n, o.joints, s, ctx.k);
        });
      },
    },

    gatling: {
      label: 'Gatling', hand: true, pose: 'aim', attack: 'spray',
      build(ctx, g, s, o) {
        const id = o.id;
        g.box(5, 5.5, 8, { at: [0, 1.5, 2.5], mat: 'primary', bevel: 0.8, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 1 } });
        g.cyl('y', 2.4, 5, { at: [0, -2.5, 1], mat: 'secondary', sides: 8, detail: { type: 'band', at: 0, size: 0.6, mat2: 'tertiary' } }); // ammo drum under
        const spin = g.child(id + 'spin', [0, 1.5, 7]);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * PI * 2 + PI / 4;
          spin.cyl('z', 0.8, 10, { at: [Math.cos(a) * 1.5, Math.sin(a) * 1.5, 5], mat: 'metal', sides: 6 });
        }
        spin.cyl('z', 2.6, 1.4, { at: [0, 0, 8.5], mat: 'metal', sides: 8 });
        flash(g, id + 'mz', [0, 1.5, 17.5], 'flash');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'spin'].rot[2] = st.t * (2 + 30 * f);
          n[id + 'mz'].hidden = !(f > 0.1 && Math.floor(st.t * 30 + f * 20) % 2 === 0);
          if (o.joints) armMotion('spray', f, n, o.joints, s, ctx.k);
        });
      },
    },

    longRifle: {
      label: 'Long rifle', hand: true, pose: 'aim', attack: 'heavy', twoHand: true,
      build(ctx, g, s, o) {
        const id = o.id;
        const body = g.child(id + 'slide');
        body.box(3, 4, 15, { at: [0, 1.6, 3], mat: 'primary', bevel: 0.6, cuts: [[0, 1, 1, 1.5]], detail: { type: 'panel', face: 'side', at: 2, dir: 'v' } });
        body.cyl('z', 1, 20, { at: [0, 2, 20.5], mat: 'metal', sides: 6 });
        body.box(2.2, 2.2, 3, { at: [0, 2, 31], mat: 'secondary', bevel: 0.4 }); // muzzle
        body.cyl('z', 1.5, 8, { at: [0, 5.3, 2.5], mat: 'metal', sides: 8, detail: { type: 'band', at: 0, size: 0.5, mat2: 'tertiary' } }); // scope
        body.box(1.8, 1.8, 0.8, { at: [0, 5.3, 6.8], mat: 'glass', shadow: false });
        body.box(2.4, 3.6, 5, { at: [0, 1, -6], mat: 'secondary', bevel: 0.5 }); // stock
        body.box(2, 2, 4, { at: [0, -1.4, 10], mat: 'metal' }); // foregrip
        flash(body, id + 'mz', [0, 2, 32.8], 'beam');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.55);
          n[id + 'slide'].pos[2] -= f * 2 * ctx.k;
          if (o.joints) armMotion('heavy', f, n, o.joints, s, ctx.k);
        });
      },
    },

    beamSaber: {
      label: 'Beam saber', hand: true, pose: 'blade', attack: 'slash', melee: true,
      build(ctx, g, s, o) {
        const id = o.id;
        g.cyl('y', 1.1, 5, { at: [0, 0, 0], mat: 'metal', sides: 6, detail: { type: 'band', at: 1, size: 0.5, mat2: 'primary' } });
        g.cyl('y', 1.2, 19, { ...GLOW, at: [0, 12, 0], sides: 6 });
        g.cone('y', 1.2, 0.4, 2, { ...GLOW, at: [0, 22.5, 0], sides: 6 });
        ctx.anims.push((st, n) => { if (o.joints) armMotion('slash', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    heatAxe: {
      label: 'Heat axe', hand: true, pose: 'blade', attack: 'slash', melee: true,
      build(ctx, g, s, o) {
        const id = o.id;
        g.cyl('y', 1, 16, { at: [0, 5, 0], mat: 'metal', sides: 6 });
        g.box(1.6, 3.4, 2.6, { at: [0, 12.5, 0.6], mat: 'primary', bevel: 0.3 });
        g.box(1.2, 10, 8.5, { ...GLOW, at: [0, 12.5, 5.6], cuts: [[0, 1, -1, 3.2], [0, -1, -1, 3.2], [0, 1, 1, 1.4], [0, -1, 1, 1.4]] });
        g.box(1.5, 2, 3.4, { at: [0, 12.5, -2.6], mat: 'metal', cuts: [[0, 0, -1, 0.6]] });
        ctx.anims.push((st, n) => { if (o.joints) armMotion('slash', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    katana: {
      label: 'Great katana', hand: true, pose: 'blade', attack: 'slash', melee: true,
      build(ctx, g, s, o) {
        g.cyl('y', 1, 6, { at: [0, 0.5, 0], mat: 'tertiary', sides: 6, detail: { type: 'band', at: 0, size: 0.6, mat2: 'secondary' } });
        g.box(4.2, 1, 4.2, { at: [0, 3.8, 0], mat: 'secondary', bevel: 0.5 }); // tsuba
        const bl = g.child(o.id + 'blade', [0, 4.2, 0], [-0.1, 0, 0]);
        bl.box(1, 27, 2.6, { at: [0, 13.5, 0], mat: 'metal', cuts: [[0, 1, 1, 2.2]], detail: { type: 'panel', face: 'side', at: -0.4, dir: 'v' } });
        bl.box(0.6, 25, 0.7, { ...GLOW, at: [0, 13, 1.5], cuts: [[0, 1, 1, 0.6]] });
        ctx.anims.push((st, n) => { if (o.joints) armMotion('slash', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    lance: {
      label: 'Lance', hand: true, pose: 'lance', attack: 'thrust', melee: true,
      build(ctx, g, s, o) {
        g.cone('z', 3.6, 1.4, 4, { at: [0, 0, 2.5], mat: 'tertiary', sides: 8, twist: PI / 8 }); // vamplate
        g.cone('z', 2.4, 0.25, 26, { at: [0, 0, 17], mat: 'primary', sides: 8, twist: PI / 8, detail: { type: 'band', dir: 'h', at: 0, size: 0.7, mat2: 'secondary' } });
        g.cyl('z', 1, 7, { at: [0, 0, -3], mat: 'metal', sides: 6 });
        g.box(0.8, 0.8, 5, { ...GLOW, at: [0, 0, 29] });
        ctx.anims.push((st, n) => { if (o.joints) armMotion('thrust', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    twinSaber: {
      label: 'Twin beam saber', hand: true, pose: 'blade', attack: 'spin', melee: true,
      build(ctx, g, s, o) {
        const id = o.id;
        const sp = g.child(id + 'spin');
        sp.cyl('y', 1.1, 8, { mat: 'metal', sides: 6, detail: { type: 'band', at: 0, size: 0.8, mat2: 'tertiary' } });
        for (const d of [-1, 1]) sp.cyl('y', 1.2, 19, { ...GLOW, at: [0, d * 13.5, 0], sides: 6 });
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'spin'].rot[2] = (1 - f) * PI * 4 * (f > 0 ? 1 : 0);
          if (o.joints) armMotion('spin', f, n, o.joints, s, ctx.k);
        });
      },
    },

    knuckle: {
      label: 'Power knuckle', hand: true, pose: 'fist', attack: 'punch', melee: true,
      build(ctx, g, s, o) {
        const h = o.hand || 1;
        g.box(7 * h, 6.5 * h, 7 * h, { at: [0, 0, 1.5 * h], mat: 'primary', bevel: 1.2 * h, detail: { type: 'panel', face: 'side', at: 0, dir: 'v' } });
        g.box(7.6 * h, 5 * h, 2.4 * h, { at: [0, -0.3 * h, 5.3 * h], mat: 'tertiary', bevel: 0.6 * h });
        for (const x of [-2.2, 0, 2.2]) g.box(1.3 * h, 1.3 * h, 1.3 * h, { at: [x * h, 1 * h, 6.8 * h], mat: 'metal', cuts: [[0, 0, 1, 0.5]] });
        g.box(8 * h, 8 * h, 2.2 * h, { at: [0, 0, -2.4 * h], mat: 'secondary', bevel: 0.6 * h }); // cuff
        ctx.anims.push((st, n) => { if (o.joints) armMotion('punch', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    claw: {
      label: 'Crusher claws', hand: true, pose: 'fist', attack: 'punch', melee: true,
      build(ctx, g, s, o) {
        const h = o.hand || 1;
        g.box(6.5 * h, 5 * h, 5 * h, { at: [0, 0, 0.5 * h], mat: 'metal', bevel: 1 * h });
        for (const [x, y, r] of [[-2.2, 1.2, 0.22], [0, 1.6, 0], [2.2, 1.2, -0.22], [0, -2.2, 0]]) {
          g.box(1.6 * h, 1.6 * h, 8 * h, { at: [x * h, y * h, 5.5 * h], rot: [y < 0 ? -0.25 : 0.1, r, 0], mat: y < 0 ? 'metal' : 'tertiary', cuts: [[0, -1, 1, 1.3 * h], [0, 1, 1, 0.5 * h]] });
        }
        ctx.anims.push((st, n) => { if (o.joints) armMotion('punch', fireOf(st, o), n, o.joints, s, ctx.k); });
      },
    },

    shield: {
      label: 'Shield', hand: true, pose: 'shield', attack: 'bash', shield: true,
      build(ctx, g, s, o) {
        const aw = o.armW || 6;
        const sh = g.child(o.id + 'plate', [s * (aw / 2 + 1.6), 1, -2], [0, -s * 0.55, 0]);
        sh.box(2, 21, 13, { at: [0, 0, 0], mat: 'primary', bevel: 0.8, cuts: [[0, -1, 1, 6], [0, -1, -1, 6], [0, 1, 1, 1.5], [0, 1, -1, 1.5]], detail: { type: 'band', face: 'side', dir: 'v', at: 0, size: 1.2, mat2: 'tertiary' } });
        sh.box(2.4, 2, 12, { at: [s * 0.3, 5.5, 0], mat: 'tertiary', bevel: 0.4 });
        sh.box(2.6, 2.6, 2.6, { at: [s * 0.5, 5.5, 0], rot: [PI / 4, 0, 0], mat: 'accent' });
        sh.box(1.5, 3, 3, { at: [-s * 1.4, 0, 0], mat: 'metal' }); // mount
      },
    },

    kite: {
      label: 'Kite shield', hand: true, pose: 'shield', attack: 'bash', shield: true,
      build(ctx, g, s, o) {
        const aw = o.armW || 6;
        const sh = g.child(o.id + 'plate', [s * (aw / 2 + 1.6), -1, -2], [0, -s * 0.5, 0]);
        sh.box(2, 22, 15, { at: [0, 0, 0], mat: 'secondary', bevel: 0.8, cuts: [[0, -1, 1, 9], [0, -1, -1, 9], [0, 1, 1, 1.2], [0, 1, -1, 1.2]], detail: { type: 'band', face: 'side', dir: 'h', at: 4, size: 1.1, mat2: 'tertiary' } });
        sh.box(2.4, 19, 2, { at: [s * 0.3, -1, 0], mat: 'tertiary', cuts: [[0, -1, 0, 0.5]] });
        sh.cyl('x', 2.4, 1.2, { at: [s * 1.3, 4, 0], mat: 'accent', sides: 8 });
        sh.box(1.5, 3, 3, { at: [-s * 1.4, 0, 0], mat: 'metal' });
      },
    },

    // ---------------------------------------------------------- shoulder / back mounts
    cannon: {
      label: 'Shoulder cannon', mount: true, attack: 'heavy',
      build(ctx, m, s, o) {
        const id = o.id;
        m.box(4.5, 4, 5, { at: [0, 0, -1], mat: 'metal', bevel: 0.6 });
        const arm = m.child(id + 'arm', [0, 1, -1], [0.35, 0, 0]);
        arm.box(3, 7.5, 3.2, { at: [0, 3.5, 0], mat: 'secondary', bevel: 0.6 });
        const gun = arm.child(id + 'gun', [0, 7, 0], [-0.35, 0, 0]);
        gun.box(5.5, 5.5, 10, { at: [0, 0, 0], mat: 'primary', bevel: 1, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 1.2 } });
        const bar = gun.child(id + 'slide');
        bar.cyl('z', 1.6, 17, { at: [0, 0.3, 13], mat: 'metal', sides: 8, twist: PI / 8 });
        bar.box(3.8, 3.8, 3.4, { at: [0, 0.3, 21.5], mat: 'secondary', bevel: 0.6, detail: { type: 'vent', face: 'side', pitch: 1.2, inset: 0.6 } });
        flash(bar, id + 'mz', [0, 0.3, 23.5], 'flash');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          // folds the barrel up while marching, snaps level to fire
          n[id + 'gun'].rot[0] -= 0.75 * st.move * (1 - Math.min(1, f * 3));
          n[id + 'mz'].hidden = !(f > 0.55);
          n[id + 'slide'].pos[2] -= f * 3.5 * ctx.k;
          n[id + 'gun'].pos[2] -= f * 1 * ctx.k;
        });
      },
    },

    missilePod: {
      label: 'Missile pod', mount: true, attack: 'shoot',
      build(ctx, m, s, o) {
        const id = o.id;
        m.box(4, 3, 4, { at: [0, 0, -1], mat: 'metal', bevel: 0.5 });
        const pod = m.child(id + 'pod', [0, 5.5, 0], [-0.12, 0, 0]);
        pod.box(9, 8, 8, { mat: 'primary', bevel: 1, detail: { type: 'grid', face: '+z', cell: 2.8, inset: 0.9 } });
        pod.box(9.6, 2, 8.6, { at: [0, 3.6, -0.4], mat: 'secondary', bevel: 0.5 });
        pod.box(1.2, 6, 5, { at: [s * 5, -0.5, -1], mat: 'tertiary', bevel: 0.3 });
        flash(pod, id + 'mz', [0, 0, 4.4], 'puff');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.5);
          n[id + 'pod'].rot[0] -= f * 0.12;
        });
      },
    },

    homing: {
      label: 'Homing missiles', mount: true, attack: 'shoot',
      build(ctx, m, s, o) {
        const id = o.id;
        m.box(4, 3, 4, { at: [0, 0, -1], mat: 'metal', bevel: 0.5 });
        m.box(8, 7, 8, { at: [0, 5, 0], mat: 'secondary', bevel: 0.8, detail: { type: 'vent', face: 'side', pitch: 1.6, inset: 1.2 } });
        for (const x of [-1.8, 1.8]) for (const z of [-1.8, 1.8]) m.box(1.6, 1, 1.6, { ...GLOW, at: [x, 8.3, z] });
        const lid = m.child(id + 'lid', [0, 8.6, -4]);
        lid.box(8.6, 1.4, 8.6, { at: [0, 0.3, 4.1], mat: 'primary', bevel: 0.5, detail: { type: 'panel', face: '+y', at: 0, dir: 'h' } });
        for (let i = 0; i < 2; i++) {
          const ms = m.child(id + 'ms' + i, [(i ? 1.8 : -1.8), 8.5, (i ? 1.8 : -1.8)]);
          ms.startHidden = true;
          ms.cyl('y', 0.8, 4, { at: [0, 2, 0], mat: 'primary', sides: 6 });
          ms.cone('y', 0.8, 0.2, 1.4, { ...GLOW, at: [0, 4.7, 0], sides: 6 });
          ms.cone('y', 0.2, 1.3, 4, { ...GLOW, at: [0, -2, 0], sides: 6 });
        }
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'lid'].rot[0] = -1.9 * Math.min(1, f * 3);
          for (let i = 0; i < 2; i++) {
            const u = Math.max(0, Math.min(1, (1 - f) * 1.6 - i * 0.35));
            const ms = n[id + 'ms' + i];
            ms.hidden = !(f > 0 && u > 0 && u < 1);
            ms.pos[1] += u * 24 * ctx.k;
            ms.pos[2] += u * u * 22 * ctx.k;
            ms.pos[0] += s * u * 4 * ctx.k;
            ms.rot[0] = u * 1.3;
          }
        });
      },
    },

    rocket: {
      label: 'Rocket launcher', mount: true, attack: 'heavy',
      build(ctx, m, s, o) {
        const id = o.id;
        m.box(4, 3, 4, { at: [0, 0, -1], mat: 'metal', bevel: 0.5 });
        const rk = m.child(id + 'slide', [0, 4.5, 0], [-0.08, 0, 0]);
        for (const x of [-2.1, 2.1]) {
          rk.cyl('z', 2, 15, { at: [x, 0, 1.5], mat: 'secondary', sides: 8, twist: PI / 8, detail: { type: 'band', dir: 'h', at: 0, size: 1, mat2: 'tertiary' } });
          rk.cyl('z', 2.3, 1.4, { at: [x, 0, 9.2], mat: 'metal', sides: 8, twist: PI / 8 });
        }
        rk.box(2, 4, 8, { at: [0, 0, 0], mat: 'metal', bevel: 0.4 });
        flash(rk, id + 'mz', [-2.1 * s, 0, 10], 'puff');
        ctx.anims.push((st, n) => {
          const f = fireOf(st, o);
          n[id + 'mz'].hidden = !(f > 0.5);
          n[id + 'slide'].pos[2] -= f * 2 * ctx.k;
        });
      },
    },

    radar: {
      label: 'Radar dish', mount: true, attack: null,
      build(ctx, m, s, o) {
        const id = o.id;
        m.box(4, 3, 4, { at: [0, 0, -1], mat: 'metal', bevel: 0.5 });
        m.cyl('y', 0.8, 9, { at: [0, 5, -1], mat: 'metal', sides: 6 });
        const dish = m.child(id + 'dish', [0, 10, -1]);
        const tilt = dish.child(id + 'tilt', [0, 0, 0], [-0.55, 0, 0]);
        tilt.cone('y', 5.5, 4, 1.6, { mat: 'primary', sides: 10, detail: { type: 'bolts', face: '+y', inset: 1.5 } });
        tilt.cyl('y', 0.5, 3.5, { at: [0, 2.3, 0], mat: 'metal', sides: 5 });
        tilt.box(1.4, 1.4, 1.4, { ...GLOW, at: [0, 4.3, 0] });
        ctx.anims.push((st, n) => { n[id + 'dish'].rot[1] = st.t * 1.4 + s; });
      },
    },
  };
  const HAND_W = Object.keys(WEAPONS).filter((k) => WEAPONS[k].hand);
  const MOUNT_W = ['none'].concat(Object.keys(WEAPONS).filter((k) => WEAPONS[k].mount && k !== 'none'));
  const labelsOf = (keys) => Object.fromEntries(keys.map((k) => [k, WEAPONS[k].label]));

  // Arm rest poses: shoulder pitch, elbow pitch, outward roll.
  const POSES = {
    aim: { sh: -0.12, el: -1.35, rz: 0.12 },
    blade: { sh: -0.3, el: -0.6, rz: 0.2 },
    lance: { sh: -0.1, el: -1.38, rz: 0.12 },
    shield: { sh: -0.08, el: -1.15, rz: 0.2 },
    fist: { sh: 0.02, el: -0.4, rz: 0.14 },
    support: { sh: -1.05, el: -0.75, rz: 0.05, ry: -0.55 },
  };

  // ------------------------------------------------------------------ archetypes
  const TYPES = {
    hero: 'Hero (all-rounder)', commander: 'Commander (mono-eye)', heavy: 'Heavy artillery', knight: 'Knight / samurai',
    sniper: 'Sniper', brawler: 'Brawler', ace: 'Ace (winged)',
  };
  const HEADS = { vfin: 'V-fin twin-eye', mono: 'Mono-eye', kabuto: 'Kabuto crest', goggle: 'Goggle visor', scope: 'Sniper scope', fang: 'Fanged brute' };
  const BACKS = { binders: 'Wing binders', feathers: 'Feather wings', thrusters: 'Thruster pack', funnels: 'Fin funnels', cape: 'Cape', cloak: 'Camo cloak', none: 'Slim pack' };

  // Body proportions per archetype (world px at size 1).
  const ARCH = {
    hero:      { head: 1.0,  chestW: 17, chestH: 11, chestD: 12, pad: 'block', padS: 1.0,  legW: 9,   shin: 10, thigh: 4, footL: 14, footW: 9,  hipX: 5,   arm: 1.0,  hand: 1.0,  hunch: 0,    bend: 0.12, splay: 0.05 },
    commander: { head: 0.98, chestW: 18, chestH: 11, chestD: 13, pad: 'zaku',  padS: 1.0,  legW: 9.5, shin: 10, thigh: 4, footL: 15, footW: 10, hipX: 5.5, arm: 1.0,  hand: 1.05, hunch: 0.05, bend: 0.14, splay: 0.07 },
    heavy:     { head: 0.66, chestW: 22, chestH: 12, chestD: 15, pad: 'round', padS: 1.0,  legW: 13,  shin: 12, thigh: 5, footL: 19, footW: 13, hipX: 7.5, arm: 1.0,  hand: 1.15, hunch: 0.04, bend: 0.1,  splay: 0.08 },
    knight:    { head: 0.96, chestW: 17, chestH: 12, chestD: 12, pad: 'sode',  padS: 1.0,  legW: 8.5, shin: 11, thigh: 4, footL: 14, footW: 8.5,hipX: 5,   arm: 1.05, hand: 1.0,  hunch: 0,    bend: 0.08, splay: 0.04 },
    sniper:    { head: 0.86, chestW: 14, chestH: 11, chestD: 11, pad: 'slim',  padS: 0.85, legW: 7,   shin: 14, thigh: 6, footL: 13, footW: 7.5,hipX: 4.5, arm: 1.2,  hand: 0.9,  hunch: 0.05, bend: 0.1,  splay: 0.03 },
    brawler:   { head: 0.76, chestW: 21, chestH: 16, chestD: 15, pad: 'dome',  padS: 1.0,  legW: 10,  shin: 10, thigh: 4, footL: 16, footW: 11, hipX: 6,   arm: 1.3,  hand: 1.5,  hunch: 0.5,  bend: 0.25, splay: 0.12 },
    ace:       { head: 1.0,  chestW: 16, chestH: 11, chestD: 11, pad: 'swept', padS: 0.95, legW: 8,   shin: 11, thigh: 4, footL: 14, footW: 8.5,hipX: 5,   arm: 1.0,  hand: 1.0,  hunch: 0,    bend: 0.1,  splay: 0.04 },
  };

  // Signature loadouts (weights) per archetype. Any weapon still fits any archetype via the slots.
  const LOADOUT = {
    hero:      { head: { vfin: 9, goggle: 1 }, R: { beamRifle: 7, bazooka: 1, beamSaber: 2 }, L: { shield: 7, beamSaber: 2, none: 1 }, back: { binders: 4, thrusters: 5, funnels: 1 }, mount: { none: 8, missilePod: 1, cannon: 1 }, sym: 0.5 },
    commander: { head: { mono: 9, goggle: 1 }, R: { machineGun: 7, bazooka: 3 }, L: { heatAxe: 7, shield: 2 }, back: { thrusters: 6, none: 2, cape: 1 }, mount: { none: 6, rocket: 2, missilePod: 1 }, sym: 0.2 },
    heavy:     { head: { goggle: 7, mono: 2 }, R: { gatling: 4, beamRifle: 3, bazooka: 2 }, L: { none: 3, shield: 2, knuckle: 1 }, back: { thrusters: 3, none: 3 }, mount: { cannon: 7, missilePod: 2, homing: 2 }, sym: 0.85 },
    knight:    { head: { kabuto: 9, vfin: 1 }, R: { katana: 5, lance: 3, beamSaber: 1 }, L: { kite: 5, none: 2 }, back: { cape: 8, binders: 1 }, mount: { none: 12, rocket: 1 }, sym: 0.5 },
    sniper:    { head: { scope: 8, goggle: 2 }, R: { longRifle: 8, beamRifle: 1 }, L: { none: 6, shield: 1 }, back: { cloak: 7, thrusters: 2 }, mount: { radar: 4, none: 4, missilePod: 1 }, sym: 0 },
    brawler:   { head: { fang: 7, mono: 2 }, R: { knuckle: 5, claw: 4 }, L: { knuckle: 4, claw: 4, none: 1 }, back: { thrusters: 5, none: 3 }, mount: { none: 5, missilePod: 2, homing: 2 }, sym: 0.7 },
    ace:       { head: { vfin: 8, kabuto: 1 }, R: { twinSaber: 4, beamRifle: 3, beamSaber: 1 }, L: { shield: 3, beamSaber: 3, none: 2 }, back: { feathers: 8, binders: 2 }, mount: { none: 7, cannon: 2 }, sym: 0.9 },
  };

  function randomSD(r, keep, bp) {
    const type = keep('sdType', () => r.weighted({ hero: 5, commander: 4, heavy: 3, knight: 3, sniper: 3, brawler: 3, ace: 3 }));
    const L = LOADOUT[type] || LOADOUT.hero;
    bp.sdType = type;
    bp.sdHead = keep('sdHead', () => r.weighted(L.head));
    bp.sdWeaponR = keep('sdWeaponR', () => r.weighted(L.R));
    bp.sdWeaponL = keep('sdWeaponL', () => {
      if (type === 'brawler' && r.chance(0.7)) return bp.sdWeaponR === 'knuckle' || bp.sdWeaponR === 'claw' ? bp.sdWeaponR : 'knuckle';
      if (WEAPONS[bp.sdWeaponR] && WEAPONS[bp.sdWeaponR].twoHand) return r.chance(0.8) ? 'none' : 'shield';
      if (bp.sdWeaponR === 'lance') return r.chance(0.8) ? 'kite' : 'shield';
      return r.weighted(L.L);
    });
    bp.sdBack = keep('sdBack', () => r.weighted(L.back));
    bp.sdBackL = keep('sdBackL', () => r.weighted(L.mount));
    bp.sdBackR = keep('sdBackR', () => (r.chance(L.sym) ? bp.sdBackL : r.weighted(L.mount)));
  }

  const NAME_WORDS = {
    hero: ['Valor', 'Paragon', 'Vanguard', 'Aurora', 'Resolve', 'Dawnstar', 'Vigil', 'Liberty'],
    commander: ['Kaiser', 'Warlord', 'Marshal', 'Tyrant', 'Baron', 'Centurion', 'Viceroy'],
    heavy: ['Bulwark', 'Mortar', 'Bastion', 'Howitzer', 'Rampart', 'Ironside', 'Anvil'],
    knight: ['Shogun', 'Ronin', 'Templar', 'Paladin', 'Kensei', 'Crusader', 'Daimyo'],
    sniper: ['Hawkeye', 'Longshot', 'Specter', 'Deadeye', 'Whisper', 'Nightjar', 'Farsight'],
    brawler: ['Grizzly', 'Rampage', 'Brute', 'Ogre', 'Maul', 'Knuckles', 'Wrecker'],
    ace: ['Seraph', 'Zephyr', 'Halcyon', 'Archangel', 'Solaris', 'Skylord', 'Valkyrie'],
  };
  const NAME_PREFIX = { hero: 'RX', commander: 'MS', heavy: 'RX', knight: 'XM', sniper: 'RGM', brawler: 'MSM', ace: 'XXG' };

  // ------------------------------------------------------------------ build
  function buildSD(ctx) {
    const { bp, r } = ctx;
    const type = ARCH[bp.sdType] ? bp.sdType : 'hero';
    const A = ARCH[type];
    const bulk = bp.bulk || 1, legLen = bp.legLen || 1, tall = bp.tall || 1, armLen = bp.armLen || 1;
    const e = bp.edge == null ? 1.5 : bp.edge;
    const bev = Math.max(0.5, Math.min(2.2, 0.6 + e * 0.55));
    const wB = 0.8 + 0.2 * bulk; // gentle width modifier
    const lL = 0.75 + 0.25 * legLen;
    const tT = 0.8 + 0.2 * tall;
    const aL = 0.8 + 0.2 * armLen;
    const k = ctx.k;
    const soles = [];
    const wR = WEAPONS[bp.sdWeaponR] ? bp.sdWeaponR : 'none';
    const wL = WEAPONS[bp.sdWeaponL] ? bp.sdWeaponL : 'none';

    // ---------------------------------------------------------------- legs & pelvis
    const legW = A.legW * wB, shin = Math.round(A.shin * lL), thigh = Math.round(A.thigh * lL);
    const footL = A.footL * (0.9 + 0.1 * bulk), footW = A.footW * wB, footH = 4, ankY = 5.5;
    const hipX = A.hipX * wB, b = A.bend, sp = A.splay;
    const hipY = ankY + (thigh + shin) * Math.cos(b);
    const pelvis = ctx.root.child('pelvis', [0, hipY + 1, 0]);
    // waist core, V crotch block, skirts
    pelvis.box(hipX * 2 + 1, 4, 7 * wB, { at: [0, 1, 0], mat: 'metal', bevel: 0.8 });
    pelvis.box(5 * wB, 5.5, 5, { at: [0, -0.5, 3], mat: 'tertiary', bevel: 0.6, cuts: [[0, -1, 1, 2.5], [1, -1, 0, 1.5], [-1, -1, 0, 1.5]] });
    pelvis.box(3, 1.2, 1, { ...GLOW, at: [0, 1.4, 5.6] });
    pelvis.box(hipX * 2 + 3, 5, 2.2, { at: [0, 0, -4.2 * wB], mat: 'primary', bevel: 0.6, rot: [-0.15, 0, 0] });
    for (const s of [-1, 1]) {
      const sk = pelvis.child('skF' + s, [s * (hipX * 0.62 + 0.5), 2.5, 3.6 * wB]);
      sk.box(hipX + 1, 7, 2, { at: [0, -3.5, 0], rot: [-0.12, 0, 0], mat: 'primary', bevel: 0.6, cuts: [[s, -1, 0, 1.6], [-s, -1, 0, 0.6]], detail: { type: 'panel', face: '+z', at: -1.5, dir: 'h' } });
      pelvis.box(2.2, 8, 7.5 * wB, { at: [s * (hipX + legW / 2 + 1.2), -1.5, 0], rot: [0, 0, s * 0.22], mat: 'primary', bevel: 0.6, cuts: [[0, -1, 1, 2], [0, -1, -1, 2]], detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
    }
    for (const s of [-1, 1]) {
      const hs = pelvis.child('hipS' + s, [s * hipX, -1, 0], [0, 0, s * sp]);
      const hip = hs.child('hip' + s, [0, 0, 0], [-b, 0, 0]);
      hip.box(legW * 0.78, thigh + 2, legW * 0.8, { at: [0, -thigh / 2, 0], mat: 'metal', bevel: 0.8 });
      const knee = hip.child('knee' + s, [0, -thigh, 0], [2 * b, 0, 0]);
      // big boot: shin block, knee guard, flared ankle guard
      knee.box(legW, shin + 1, legW + 1, { at: [0, -shin / 2 - 0.5, 0], mat: 'primary', bevel: bev, bevelSet: 'vert', cuts: [[0, 1, 1, 2]], detail: { type: 'panel', face: 'side', at: -1, dir: 'h' } });
      knee.box(legW * 0.8, 5, 3, { at: [0, 0.2, legW / 2 + 1.2], mat: 'secondary', bevel: 0.5, cuts: [[0, 1, 1, 1.5], [1, -1, 1, 1.2], [-1, -1, 1, 1.2]] });
      knee.box(legW + 1.4, 4, legW + 2.4, { at: [0, -shin + 1.5, 0.2], mat: 'primary', bevel: 0.8, cuts: [[0, 1, 1, 1.5]], detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 1.4 } });
      const ank = knee.child('ankle' + s, [0, -shin, 0], [-b, 0, 0]);
      const ft = ank.child('foot' + s, [0, 0, 0], [0, 0, -s * sp]);
      const fz = footL * 0.12;
      soles.push(ft.box(footW + 0.6, 1.4, footL, { at: [0, -ankY + 0.7, fz], mat: 'metal' }));
      ft.box(footW, footH - 1.2, footL - 1.5, { at: [0, -ankY + 1.4 + (footH - 1.2) / 2, fz - 0.4], mat: 'tertiary', bevel: 0.7, bevelSet: 'top', cuts: [[0, 1, 1, 2.2]] });
      ft.box(footW * 0.62, 2.5, 3, { at: [0, -ankY + 3.2, fz + footL / 2 - 2.5], mat: 'primary', bevel: 0.4, cuts: [[0, 1, 1, 1.4]] }); // toe cap
      ft.box(footW * 0.7, 3, 2.5, { at: [0, -ankY + 2.4, fz - footL / 2 + 0.6], mat: 'metal', cuts: [[0, 1, -1, 1]] }); // heel
    }

    // ---------------------------------------------------------------- torso
    const cW = A.chestW * wB, cH = A.chestH * tT, cD = A.chestD * wB;
    const torso = pelvis.child('torso', [0, 2.5, 0], [A.hunch, 0, 0]);
    const abY = 2.2, chestY = 4.2 + cH / 2, topY = 4.2 + cH;
    torso.box(cW * 0.5, 4.5, cD * 0.6, { at: [0, abY, 0.3], mat: 'primary', bevel: 0.6, detail: { type: 'panel', face: '+z', at: 0, dir: 'v' } });
    torso.box(cW, cH, cD, { at: [0, chestY, 0], mat: 'secondary', bevel: bev, cuts: [[0, -1, 1, cH * 0.35], [1, 0, 1, 2.2], [-1, 0, 1, 2.2]], detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
    // chest vents: yellow frame with dark slats
    for (const s of [-1, 1]) {
      torso.box(cW * 0.3, cH * 0.36, 1.2, { at: [s * cW * 0.22, chestY + cH * 0.14, cD / 2 + 0.2], mat: 'accent' });
      torso.box(cW * 0.3 - 1.6, cH * 0.36 - 1.4, 1.2, { at: [s * cW * 0.22, chestY + cH * 0.14, cD / 2 + 0.7], mat: 'metal', detail: { type: 'vent', face: '+z', pitch: 1, inset: 0 } });
    }
    // cockpit hatch
    torso.box(cW * 0.26, cH * 0.32, 1.6, { at: [0, chestY - cH * 0.14, cD / 2 - 0.9], rot: [0.5, 0, 0], mat: 'primary', bevel: 0.4, detail: { type: 'bolts', face: 'any', inset: 0.9 } });
    // collar
    torso.box(cW * 0.7, 3, cD * 0.75, { at: [0, topY + 0.6, -0.6], mat: 'primary', bevel: 0.8, cuts: [[0, 1, 1, 1.2]] });
    const shX = cW / 2 + 1.5, shY = topY - 3;

    // ---------------------------------------------------------------- head
    const hs = A.head * (0.95 + 0.05 * bulk);
    const neckY = type === 'brawler' ? topY - 1 : topY - 0.2;
    const neck = torso.child('neck', [0, neckY, type === 'brawler' ? cD * 0.32 : 0.5], [-A.hunch * 0.85, 0, 0]);
    neck.cyl('y', 2.2, 4, { at: [0, 0.5, 0], mat: 'metal', sides: 6 });
    const head = neck.child('head', [0, 0.8, 0]);
    buildHead(ctx, head, bp.sdHead || 'vfin', hs, type);

    // ---------------------------------------------------------------- shoulders & arms
    const armW = 6 * wB * (type === 'brawler' ? 1.3 : 1);
    const joints = (s) => ({ sh: 'sh' + s, el: 'el' + s, torso: 'torso', pelvis: 'pelvis' });
    const R = -1, Lf = 1; // anatomical right is -x (the unit faces +z)
    const twoR = WEAPONS[wR].twoHand && (wL === 'none'), twoL = WEAPONS[wL].twoHand && (wR === 'none');
    const attackers = [wR, wL].filter((w) => WEAPONS[w].attack && !WEAPONS[w].shield).length;
    const arms = {};
    for (const s of [R, Lf]) {
      const wt = s === R ? wR : wL;
      const W = WEAPONS[wt];
      const support = (s === Lf && twoR) || (s === R && twoL);
      const pose = POSES[support ? 'support' : W.pose || 'fist'];
      const pad = torso.child('pad' + s, [s * shX, shY, 0]);
      buildPad(ctx, pad, s, A.pad, A.padS * (0.9 + 0.1 * bulk), bev);
      const lean = support ? 0 : type === 'brawler' ? -A.hunch - 0.25 : 0; // gorilla arms hang forward of the hunched chest
      const sh = torso.child('sh' + s, [s * shX, shY, 0], [pose.sh + lean, (pose.ry || 0) * s, s * pose.rz]);
      const upL = 5 * aL * A.arm, foL = 8 * aL * A.arm;
      const up = sh.child('up' + s, [s * 2, -2, 0]);
      up.box(armW * 0.7, upL + 2, armW * 0.7, { at: [0, -upL / 2, 0], mat: 'metal', bevel: 0.6 });
      const el = up.child('el' + s, [0, -upL, 0], [pose.el, 0, 0]);
      el.cyl('x', 2.2, armW * 0.8, { mat: 'metal', sides: 8 });
      el.box(armW, foL, armW, { at: [0, -foL / 2 - 0.5, 0], mat: 'primary', bevel: bev * 0.8, bevelSet: 'vert', cuts: [[0, 1, -1, 1.6]], detail: { type: 'panel', face: 'side', at: -foL * 0.15, dir: 'h' } });
      el.box(armW + 0.8, 2, armW + 0.8, { at: [0, -foL + 0.4, 0], mat: type === 'knight' ? 'secondary' : 'tertiary', bevel: 0.5 }); // cuff
      const wr = el.child('wr' + s, [0, -foL - 0.5, 0]);
      const hsz = 4.6 * A.hand * wB;
      if (wt !== 'knuckle' && wt !== 'claw') wr.box(hsz, hsz, hsz, { at: [0, -hsz / 2, 0.3], mat: 'metal', bevel: hsz * 0.22, bevelSet: 'round' });
      const grip = wr.child('gr' + s, [0, -hsz * 0.55, 0.3], [PI / 2, 0, 0]);
      const o = { id: (s === R ? 'wR' : 'wL'), armW, hand: A.hand * wB, joints: joints(s) };
      if (attackers > 1) o.alt = s === R ? 1 : 0; // two attacking hands take turns
      if (W.shield && attackers > 0) o.joints = null; // shields only bash when nothing else attacks
      if (W.shield && attackers === 0) W.attack && ctx.anims.push((st, n) => armMotion('bash', st.fire || 0, n, joints(s), s, ctx.k));
      W.build(ctx, grip, s, o);
      arms[s] = { swing: support ? 0.04 : W.pose === 'fist' ? 0.5 : W.pose === 'blade' ? 0.3 : 0.12 };
    }
    ctx.fireDecay = WEAPONS[wR].melee || WEAPONS[wL].melee ? 2.2 : 5;

    // ---------------------------------------------------------------- backpack & mounts
    const back = torso.child('pack', [0, chestY + 1, -cD / 2 - 1.5]);
    buildBack(ctx, back, bp.sdBack || 'none', { cW, cD, cH, topY, chestY, bev, type });
    const padTop = shY + 7 * A.padS;
    for (const s of [R, Lf]) {
      const wt = s === R ? bp.sdBackR : bp.sdBackL;
      if (!wt || wt === 'none' || !WEAPONS[wt] || !WEAPONS[wt].mount) continue;
      const mnt = torso.child('mt' + s, [s * (cW / 2 - 0.5), Math.max(topY + 2, padTop - 1), -cD / 2 + 0.5]);
      WEAPONS[wt].build(ctx, mnt, s, { id: s === R ? 'mR' : 'mL' });
    }

    // ---------------------------------------------------------------- rest on the ground
    MF.updateRig(ctx.root, MF.mat(), []);
    let minY = 1e9;
    for (const p of soles) minY = Math.min(minY, p.world[10] - p.hy);
    pelvis.pos[1] -= minY; pelvis.base.pos[1] -= minY;

    // ---------------------------------------------------------------- walk / idle
    const Lleg = (thigh + shin) * Math.cos(b) + ankY * 0.3, Aw = 0.44;
    ctx.stride = 4 * Lleg * Math.sin(Aw);
    ctx.gait = 'biped';
    ctx.anims.push((st, n) => {
      const m = st.move || 0, ph = st.phase || 0, t = st.t || 0;
      const drop = Lleg * (1 - Math.cos(Aw * m * Math.sin(ph)));
      const stomp = m * 1.1 * Math.pow(Math.max(0, -Math.cos(2 * ph)), 6); // heavy footfall dip
      const breathe = Math.sin(t * 2.2) * 0.35 * (1 - m);
      n.pelvis.pos[1] -= (drop + stomp + breathe) * k;
      n.pelvis.rot[1] += Math.sin(ph) * 0.08 * m;
      for (const s of [-1, 1]) {
        const p = s < 0 ? ph : ph + PI;
        const hip = -Aw * Math.sin(p) * m;
        const knee = Math.max(0, Math.cos(p)) * 1.05 * m;
        n['hip' + s].rot[0] += hip;
        n['knee' + s].rot[0] += knee;
        n['ankle' + s].rot[0] += -(hip + knee) * 0.92;
        n['skF' + s].rot[0] += Math.min(0, hip - knee * 0.4) * 0.8;
        const sw = -s * Math.sin(ph) * arms[s].swing * m;
        n['sh' + s].rot[0] += sw;
        n['sh' + s].rot[2] += s * (Math.sin(t * 2.2) * 0.025 * (1 - m) + stomp * 0.04);
        n['pad' + s].rot[0] += sw * 0.4;
        n['pad' + s].rot[2] -= s * stomp * 0.05;
      }
      n.torso.rot[1] += -Math.sin(ph) * 0.18 * m;
      n.torso.rot[0] += 0.07 * m + stomp * 0.03;
      n.torso.rot[2] += Math.sin(ph) * 0.035 * m;
      n.torso.pos[1] += Math.sin(t * 2.2 + 0.6) * 0.25 * (1 - m) * k;
      n.head.rot[1] += Math.sin(t * 0.7) * 0.32 * (1 - m) + Math.sin(ph) * 0.12 * m;
      n.head.rot[0] += Math.sin(t * 0.45) * 0.05 * (1 - m) - stomp * 0.05;
    });
  }

  // ------------------------------------------------------------------ heads
  // head node origin = top of the neck. hs scales the whole head (tiny heads for heavies).
  function buildHead(ctx, h, kind, hs, type) {
    const W = 17 * hs, H = 14 * hs, D = 14 * hs;
    const fz = D / 2; // face plane
    const eyes = (y, w, tilt) => {
      for (const s of [-1, 1]) h.box(w, 1.5 * Math.max(0.8, hs), 1.2, { at: [s * W * 0.17, y, fz + 0.45], rot: [-0.5, 0, s * tilt], mat: 'glass', shadow: false, cuts: [[-s, -1, 0, 0.5]] });
    };
    switch (kind) {
      case 'mono': { // Zaku-style: round helmet, mono-eye rail, snout with ribbed pipes
        h.cone('y', W * 0.52, W * 0.4, H * 0.78, { at: [0, H * 0.42, -0.3], mat: 'primary', sides: 8, twist: PI / 8 });
        h.cone('y', W * 0.4, W * 0.18, H * 0.28, { at: [0, H * 0.94, -0.3], mat: 'primary', sides: 8, twist: PI / 8 });
        h.box(W * 0.84, 3.6 * hs, 2, { at: [0, H * 0.55, W * 0.44], mat: 'metal', bevel: 0.3 });
        const eye = h.child('monoEye', [0, H * 0.55, W * 0.44 + 1.1]);
        eye.box(3.4 * hs, 3 * hs, 1.2, { mat: 'glass', shadow: false, bevel: 0.5 });
        h.box(W * 0.36, 4 * hs, 4.5 * hs, { at: [0, H * 0.22, W * 0.4], mat: 'secondary', bevel: 0.6, cuts: [[0, -1, 1, 1.2]], detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.6 } });
        for (const s of [-1, 1]) h.cyl('z', 1.05 * hs + 0.2, 7 * hs, { at: [s * W * 0.33, H * 0.2, W * 0.14], rot: [0, s * 0.75, 0], mat: 'metal', sides: 6, detail: [{ type: 'tread', face: 'side', axis: 'u' }, { type: 'tread', face: '+y', axis: 'v' }] });
        if (type === 'commander' || ctx.r.chance(0.3)) {
          h.box(1.2, 10 * hs, 3.4 * hs, { at: [0, H * 1.2, W * 0.26], rot: [0.45, 0, 0], mat: 'accent', cuts: [[0, 1, 1, 2.4 * hs], [0, 1, -1, 0.8]] });
        }
        ctx.anims.push((st, n) => { n.monoEye.pos[0] += Math.sin((st.t || 0) * 1.3) * W * 0.26 * ctx.k * (1 - st.move * 0.7); });
        break;
      }
      case 'kabuto': { // samurai helmet: brim, flared fukigaeshi, tall kuwagata crest, menpo mask
        h.box(W * 0.84, H * 0.8, D * 0.9, { at: [0, H * 0.45, -0.3], mat: 'primary', bevel: 1.2 * hs });
        h.box(W * 1.06, H * 0.45, D, { at: [0, H * 0.84, -0.6], mat: 'secondary', bevel: 1.5 * hs, cuts: [[0, 1, 1, 2.5 * hs]] });
        h.box(W * 1.25, 1.6, D * 1.05, { at: [0, H * 0.62, -0.8], mat: 'secondary', bevel: 0.4, cuts: [[0, 0, 1, 1]] });
        for (const s of [-1, 1]) h.box(1.6, 6 * hs, 6.5 * hs, { at: [s * W * 0.66, H * 0.55, 0.5], rot: [0, s * 0.35, -s * 0.45], mat: 'tertiary', bevel: 0.4 });
        h.box(W * 0.62, H * 0.24, 1.4, { at: [0, H * 0.46, fz - 0.4], mat: 'metal' });
        eyes(H * 0.47, W * 0.2, 0.18);
        h.box(W * 0.42, H * 0.26, 2, { at: [0, H * 0.18, fz - 0.5], mat: 'metal', bevel: 0.4, cuts: [[0, -1, 1, 1]], detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.5 } });
        for (const s of [-1, 1]) h.box(1.6, 13 * hs, 1.3, { ...GLOW, shadow: true, at: [s * (1.2 + 3.3 * hs), H * 0.95 + 5.8 * hs, fz - 0.8], rot: [0, 0, -s * 0.42], cuts: [[s, 1, 0, 1]] });
        h.cyl('z', 1.9 * hs, 1.2, { ...GLOW, at: [0, H * 0.98, fz + 0.1], sides: 8 });
        break;
      }
      case 'goggle': { // GM-style: dome-ish helmet with one wide visor, side antenna
        h.box(W * 0.95, H * 0.95, D, { at: [0, H * 0.5, -0.3], mat: 'primary', bevel: 2.4 * hs, bevelSet: 'round' });
        h.box(W * 0.78, 3.2 * hs, 2, { at: [0, H * 0.58, fz - 0.2], rot: [-0.3, 0, 0], mat: 'glass', shadow: false, bevel: 0.4 });
        h.box(W * 0.9, 2 * hs, D * 0.5, { at: [0, H * 0.86, fz * 0.45], mat: 'secondary', bevel: 0.6 });
        h.box(W * 0.4, 3 * hs, 2, { at: [0, H * 0.2, fz - 0.3], mat: 'metal', bevel: 0.4, detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.4 } });
        h.box(1, 7 * hs, 1, { ...GLOW, shadow: true, at: [W * 0.5, H * 0.95, -1], rot: [0, 0, -0.2] });
        h.cyl('x', 2 * hs, W + 1.2, { at: [0, H * 0.5, -0.5], mat: 'metal', sides: 8 });
        break;
      }
      case 'scope': { // sniper: narrow head, big scope over the right eye, flat visor, long antenna
        h.box(W * 0.8, H * 0.9, D * 0.95, { at: [0, H * 0.47, -0.3], mat: 'primary', bevel: 1.2 * hs, cuts: [[0, 1, 1, 2.5 * hs]] });
        h.box(W * 0.66, 2 * hs, 1.4, { at: [0, H * 0.55, fz - 0.2], rot: [-0.3, 0, 0], mat: 'glass', shadow: false });
        h.cyl('z', 2 * hs, 6 * hs, { at: [-W * 0.34, H * 0.6, fz + 0.5], mat: 'secondary', sides: 8, twist: PI / 8 });
        h.cyl('z', 1.3 * hs, 1, { at: [-W * 0.34, H * 0.6, fz + 3.6 * hs], mat: 'glass', shadow: false, sides: 8 });
        h.box(W * 0.36, 2.6 * hs, 1.6, { at: [0, H * 0.2, fz - 0.4], mat: 'metal', detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.3 } });
        h.box(0.9, 12 * hs, 0.9, { ...GLOW, shadow: true, at: [W * 0.3, H * 1.1, -2], rot: [-0.35, 0, -0.1] });
        h.box(2.4, 2.2 * hs, 3, { at: [0, H * 0.95, 0], mat: 'tertiary', bevel: 0.3 });
        break;
      }
      case 'fang': { // brute: low skull, brow ridge, glaring slits, fanged jaw, swept horns
        h.box(W * 0.9, H * 0.7, D * 0.95, { at: [0, H * 0.55, -0.6], mat: 'primary', bevel: 1.4 * hs, cuts: [[0, 1, 1, 2 * hs]] });
        h.box(W, 2.2 * hs, 3, { at: [0, H * 0.72, fz - 0.8], mat: 'secondary', bevel: 0.4, cuts: [[0, -1, 1, 1]] });
        for (const s of [-1, 1]) h.box(W * 0.24, 1.2 * Math.max(1, hs), 1, { at: [s * W * 0.2, H * 0.55, fz - 0.2], rot: [-0.3, 0, s * 0.3], mat: 'glass', shadow: false });
        h.box(W * 0.72, H * 0.34, D * 0.6, { at: [0, H * 0.2, 1.8], mat: 'tertiary', bevel: 0.6, cuts: [[0, -1, 1, 1.5]], detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.6 } });
        for (const s of [-1, 1]) h.cone('y', 0.9, 0.1, 2.2, { at: [s * W * 0.2, H * 0.28, fz + 1.7], mat: 'primary', sides: 4 });
        for (const s of [-1, 1]) h.cone('y', 1.5 * hs + 0.3, 0.2, 8 * hs, { ...GLOW, shadow: true, at: [s * W * 0.52, H * 0.95, -1], rot: [-0.5, 0, -s * 0.9], sides: 5 });
        break;
      }
      default: { // vfin: the Gundam face
        h.box(W, H, D, { at: [0, H / 2, -0.4], mat: 'primary', bevel: 2 * hs, cuts: [[0, 1, 1, 3.2 * hs], [1, -1, 1, 2 * hs], [-1, -1, 1, 2 * hs]] });
        h.box(W * 0.64, H * 0.56, 1.4, { at: [0, H * 0.42, fz - 0.35], mat: 'metal' }); // face recess
        eyes(H * 0.55, W * 0.24, 0.26);
        h.box(W * 0.34, H * 0.26, 1.8, { at: [0, H * 0.24, fz + 0.1], mat: 'primary', bevel: 0.4, detail: { type: 'vent', face: '+z', pitch: 1, inset: 0.6 } }); // mouthplate
        h.box(W * 0.26, 1.8 * hs, 2.2, { at: [0, H * 0.07, fz - 0.2], mat: 'tertiary', cuts: [[0, -1, 1, 1]] }); // chin
        h.box(2.8 * hs, 2.4 * hs, 1.6, { at: [0, H * 0.8, fz - 0.9], mat: 'tertiary', cuts: [[0, 1, 1, 0.7]] }); // forehead sensor
        const th = 0.92, fl = 11 * hs;
        for (const s of [-1, 1]) {
          h.box(1.8 * Math.max(0.8, hs), fl, 1.3, { ...GLOW, shadow: true, at: [s * (0.9 + Math.sin(th) * fl / 2), H * 0.8 + Math.cos(th) * fl / 2, fz - 0.6], rot: [0, 0, -s * th], cuts: [[s, 1, 0, 0.9]] });
          h.box(1.5, 1.5, 1.4, { at: [s * W * 0.37, H * 0.78, fz - 1.1], mat: 'metal' }); // head vulcans
        }
        h.cyl('x', 2.2 * hs, W + 1.2, { at: [0, H * 0.45, -0.6], mat: 'metal', sides: 8 });
        h.box(2, 2.4 * hs, D * 0.6, { at: [0, H + 0.4, -1.5], mat: 'primary', bevel: 0.4, cuts: [[0, 1, 1, 1.2]] }); // top crest
      }
    }
  }

  // ------------------------------------------------------------------ shoulder armour
  function buildPad(ctx, p, s, kind, sc, bev) {
    const S = sc;
    switch (kind) {
      case 'zaku': {
        if (s > 0) { // left: spiked pauldron
          p.box(10 * S, 9 * S, 12 * S, { at: [s * 4.5 * S, 2 * S, 0], mat: 'primary', bevel: 2.4 * S, bevelSet: 'round' });
          for (const z of [-3.4, 0, 3.4]) p.cone('y', 2, 0.15, 6.5, { at: [s * 7 * S, 7.5 * S, z * S], rot: [0, 0, -s * 0.55], mat: 'metal', sides: 5 });
          p.box(10.5 * S, 1.6, 12.5 * S, { at: [s * 4.5 * S, -1.2 * S, 0], mat: 'secondary', bevel: 0.5 });
        } else { // right: big shoulder shield plate
          p.box(6 * S, 6 * S, 8 * S, { at: [s * 3.5 * S, 2 * S, 0], mat: 'metal', bevel: 1 });
          p.box(3, 17 * S, 15 * S, { at: [s * 8.4 * S, 0.5 * S, 1.5], rot: [0, s * 0.5, s * 0.12], mat: 'primary', bevel: 1, cuts: [[0, 1, 1, 3], [0, 1, -1, 3], [0, -1, 1, 3], [0, -1, -1, 3]], detail: { type: 'band', face: 'side', dir: 'h', at: 3.5 * S, size: 1, mat2: 'secondary' } });
        }
        break;
      }
      case 'round': { // heavy: big rounded blocks with a rim
        p.box(12 * S, 11 * S, 13 * S, { at: [s * 5 * S, 2 * S, 0], mat: 'primary', bevel: 3 * S, bevelSet: 'round', detail: { type: 'bolts', face: 'side', inset: 2.2 } });
        p.box(12.6 * S, 2.2, 13.6 * S, { at: [s * 5 * S, -2.6 * S, 0], mat: 'tertiary', bevel: 0.6 });
        break;
      }
      case 'sode': { // samurai: layered hanging plates
        p.box(9 * S, 3.5, 11 * S, { at: [s * 3.5 * S, 4.6 * S, 0], mat: 'secondary', bevel: 0.8, cuts: [[s, 1, 0, 1.4]] });
        for (let i = 0; i < 3; i++) {
          p.box(2, 5.2 * S, (12.5 + i) * S, { at: [s * (6.8 + i * 1.3) * S, (2.2 - i * 3.6) * S, 0], rot: [0, 0, s * 0.3], mat: i === 1 ? 'tertiary' : 'primary', bevel: 0.5, cuts: [[0, -1, 1, 1.2], [0, -1, -1, 1.2]] });
        }
        break;
      }
      case 'slim': {
        p.box(7.5 * S, 7 * S, 9.5 * S, { at: [s * 3.8 * S, 2 * S, 0], mat: 'primary', bevel: bev, cuts: [[s, 1, 0, 2]] });
        p.box(1.6, 5 * S, 8 * S, { at: [s * 7.8 * S, 1 * S, 0], mat: 'secondary', bevel: 0.4 });
        break;
      }
      case 'dome': { // brawler: enormous domed pauldrons with a spike ridge
        p.box(13 * S, 12 * S, 13 * S, { at: [s * 5 * S, 2.5 * S, -0.5], mat: 'primary', bevel: 3.6 * S, bevelSet: 'round', detail: { type: 'panel', face: 'side', at: 0, dir: 'v' } });
        p.box(13.6 * S, 2.4, 13.6 * S, { at: [s * 5 * S, -2.6 * S, -0.5], mat: 'tertiary', bevel: 0.6 });
        for (const z of [-3, 1.5]) p.cone('y', 1.6, 0.2, 5, { at: [s * 6 * S, 9 * S, z * S], rot: [-0.3, 0, -s * 0.3], mat: 'metal', sides: 5 });
        break;
      }
      case 'swept': { // ace: angular pads with swept-up fins
        p.box(9 * S, 8 * S, 11 * S, { at: [s * 4 * S, 2 * S, 0], mat: 'primary', bevel: bev, cuts: [[s, 1, 0, 3], [0, -1, 1, 2]] });
        p.box(1.6, 10 * S, 6 * S, { at: [s * 7 * S, 8.5 * S, -2 * S], rot: [-0.45, 0, -s * 0.35], mat: 'secondary', cuts: [[0, 1, 1, 3], [0, 1, -1, 1]] });
        p.box(9.5 * S, 1.6, 11.5 * S, { at: [s * 4 * S, -1.4 * S, 0], mat: 'tertiary', bevel: 0.4 });
        break;
      }
      default: { // block: Gundam box pads
        p.box(10 * S, 10 * S, 12 * S, { at: [s * 4.5 * S, 2 * S, 0], mat: 'primary', bevel: bev, cuts: [[s, 1, 0, 2.5]], detail: { type: 'panel', face: 'side', at: -1, dir: 'h' } });
        p.box(10.6 * S, 2, 12.6 * S, { at: [s * 4.5 * S, -2.8 * S, 0], mat: 'secondary', bevel: 0.5 });
      }
    }
  }

  // ------------------------------------------------------------------ backpacks
  function buildBack(ctx, pk, kind, t) {
    const { cW, cH, bev } = t;
    const flameAnim = (names) => ctx.anims.push((st, n) => {
      for (const nm of names) { const f = n[nm]; if (!f) continue; f.hidden = !(st.move > 0.2 || st.fire > 0.3); f.pos[1] += Math.sin(st.t * 41 + nm.length) * 0.4 * ctx.k; }
    });
    switch (kind) {
      case 'binders': { // Freedom-like wing binders rising over the shoulders
        pk.box(cW * 0.6, 9, 4, { at: [0, 0, -1], mat: 'primary', bevel: 1, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1.5 } });
        for (const s of [-1, 1]) {
          const w = pk.child('wing' + s, [s * cW * 0.22, 2, -2.5], [0.3, 0, -s * 0.48]);
          w.box(2.4, 27, 9, { at: [0, 11.5, 0], mat: 'secondary', bevel: 0.6, cuts: [[0, 1, -1, 5], [0, -1, 1, 3]], detail: { type: 'band', face: 'side', dir: 'h', at: 6, size: 1, mat2: 'accent' } });
          w.box(3, 5, 5, { at: [0, 0, 0], mat: 'metal', bevel: 0.6 });
          w.box(2.8, 5, 3, { at: [0, 23, 3.2], mat: 'tertiary', cuts: [[0, 1, 1, 1.6]] });
        }
        ctx.anims.push((st, n) => { const f = Math.sin(st.t * 1.4) * 0.04 + st.move * 0.18; n['wing-1'].rot[2] -= f; n.wing1.rot[2] += f; });
        break;
      }
      case 'feathers': { // ace: a big fan of feather plates spread wide on each side
        pk.box(cW * 0.55, 9, 4.5, { at: [0, 0, -1], mat: 'primary', bevel: 1, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1.2 } });
        for (const s of [-1, 1]) {
          const w = pk.child('wing' + s, [s * cW * 0.18, 4, -3.5], [0.3, 0, 0]);
          w.box(4, 5, 4, { mat: 'metal', bevel: 0.8 });
          for (let i = 0; i < 5; i++) {
            const phi = 0.42 + i * 0.36, len = 23 - i * 1.8, off = 2 + i * 0.3;
            const d = off + len / 2;
            w.box(i === 0 ? 3 : 1.6, len, i === 0 ? 4.5 : 4, { at: [s * Math.sin(phi) * d, Math.cos(phi) * d, -1 - i * 0.55], rot: [0, 0, -s * phi], mat: i === 0 ? 'secondary' : i % 2 ? 'primary' : 'primary', bevel: 0.3, cuts: [[0, 1, 1, 1.4], [0, 1, -1, 1.4]], detail: i === 0 ? { type: 'band', face: 'side', dir: 'h', at: len * 0.3, size: 0.8, mat2: 'tertiary' } : { type: 'panel', face: 'side', at: len * 0.2, dir: 'h' } });
          }
          const tipD = 2 + 23;
          w.box(1.4, 4, 1.4, { ...GLOW, at: [s * Math.sin(0.42) * tipD, Math.cos(0.42) * tipD + 1, 1.2], rot: [0, 0, -s * 0.42] });
        }
        ctx.anims.push((st, n) => { const f = Math.sin(st.t * 1.6) * 0.05 - st.move * 0.12 + (st.fire || 0) * 0.12; n['wing-1'].rot[2] -= f; n.wing1.rot[2] += f; n['wing-1'].rot[0] += st.move * 0.2; n.wing1.rot[0] += st.move * 0.2; });
        break;
      }
      case 'funnels': { // Nu-style fin funnels stacked on one side: asymmetric silhouette
        pk.box(cW * 0.62, 10, 4.5, { at: [0, 0, -1], mat: 'primary', bevel: 1, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1.5 } });
        const f = pk.child('funnels', [cW * 0.25, 1, -3.5], [0.15, 0, -0.18]);
        for (let i = 0; i < 6; i++) {
          f.box(1.3, 18 + (i % 2) * 2, 3.4, { at: [i * 1.7, 7 + (i % 2), -i * 0.5], mat: i % 2 ? 'secondary' : 'primary', cuts: [[0, 1, 1, 1.5]] });
        }
        f.box(11, 1.4, 1.2, { ...GLOW, at: [4.2, 16.5, 1.2] });
        pk.cone('y', 2.4, 1.5, 3, { at: [-cW * 0.18, -5.5, -1.2], mat: 'metal', sides: 8 });
        ctx.anims.push((st, n) => { n.funnels.pos[1] += Math.sin(st.t * 2.4) * 0.5 * ctx.k; n.funnels.rot[2] += Math.sin(st.t * 1.2) * 0.03; });
        break;
      }
      case 'thrusters': { // RX-style pack: big nozzles and two beam-saber hilts over the shoulders
        pk.box(cW * 0.72, 11, 5, { at: [0, 0, -1.5], mat: 'primary', bevel: bev, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1.6 } });
        for (const s of [-1, 1]) {
          pk.cone('y', 2, 3, 5, { at: [s * cW * 0.18, -7, -2.6], rot: [0.3, 0, 0], mat: 'metal', sides: 8, twist: PI / 8 });
          const fl = pk.child('flame' + s, [s * cW * 0.18, -10, -3.6]);
          fl.cone('y', 0.5, 2.4, 4, { ...GLOW, rot: [0.3, 0, 0], sides: 6 });
          pk.cyl('y', 1.1, 6, { at: [s * cW * 0.26, 7.5, -1.5], rot: [0, 0, -s * 0.28], mat: 'metal', sides: 6 });
          pk.box(1.6, 1.6, 1.6, { at: [s * (cW * 0.26 + 1), 10.8, -1.5], rot: [0, 0, -s * 0.28], mat: 'tertiary' });
        }
        flameAnim(['flame-1', 'flame1']);
        break;
      }
      case 'cape': { // knight: two-piece cape that flows back when walking
        const cp = pk.child('cape', [0, t.topY - t.chestY - 1.5, -0.5], [0.12, 0, 0]);
        cp.box(cW * 0.95, 2.5, 3, { at: [0, 0, 0.5], mat: 'tertiary', bevel: 0.8 });
        cp.box(cW * 0.95, 14, 1.4, { at: [0, -7.5, 0], mat: 'tertiary', bevel: 0.4, detail: { type: 'panel', face: '-z', at: 0, dir: 'v' } });
        const c2 = cp.child('cape2', [0, -14, 0], [0.06, 0, 0]);
        c2.box(cW * 1.1, 13, 1.4, { at: [0, -6.5, 0], mat: 'tertiary', bevel: 0.4, cuts: [[1, -1, 0, 3], [-1, -1, 0, 3]], detail: { type: 'panel', face: '-z', at: 0, dir: 'v' } });
        for (const s of [-1, 1]) cp.box(2.4, 2.4, 1.6, { mat: 'accent', at: [s * cW * 0.36, 0, 2.3] });
        ctx.anims.push((st, n) => {
          const m = st.move || 0, t2 = st.t || 0;
          n.cape.rot[0] += 0.35 * m + Math.sin(t2 * 2.3) * 0.03 + Math.sin(st.phase * 2) * 0.04 * m + (st.fire || 0) * 0.2;
          n.cape2.rot[0] += 0.25 * m + Math.sin(t2 * 2.3 + 0.9) * 0.05 + Math.sin(st.phase * 2 + 1) * 0.08 * m;
        });
        break;
      }
      case 'cloak': { // sniper: camo mantle over the shoulders and a ragged drape
        const cl = pk.child('cloak', [0, t.topY - t.chestY - 0.5, 1]);
        const camo = { type: 'stripe', width: 2.5, mat2: 'metal' };
        cl.box(cW + 7, 5, t.cD + 3, { at: [0, 1, 2.5], mat: 'secondary', bevel: 2, bevelSet: 'round', detail: camo });
        cl.box(cW + 3, 15, 1.8, { at: [0, -7, -1.4], rot: [0.14, 0, 0], mat: 'secondary', bevel: 0.4, detail: camo });
        const c2 = cl.child('cloak2', [0, -14, -3], [0.06, 0, 0]);
        c2.box(cW + 5, 13, 1.6, { at: [0, -6, 0], mat: 'secondary', bevel: 0.4, cuts: [[1, -1, 0, 2.5], [-1, -1, 0, 2.5], [0.35, -1, 0, 1.6], [-0.35, -1, 0, 1.6]], detail: camo });
        ctx.anims.push((st, n) => {
          const m = st.move || 0;
          n.cloak2.rot[0] += 0.3 * m + Math.sin((st.t || 0) * 2 + 0.5) * 0.04 + Math.sin(st.phase * 2) * 0.06 * m;
        });
        break;
      }
      default: // slim pack
        pk.box(cW * 0.55, 8, 3.5, { at: [0, 0, -1], mat: 'primary', bevel: 1, detail: { type: 'vent', face: '-z', pitch: 1.5, inset: 1.2 } });
        for (const s of [-1, 1]) pk.cone('y', 1.6, 2.2, 3, { at: [s * cW * 0.14, -5.5, -1.2], mat: 'metal', sides: 8 });
    }
  }

  // ------------------------------------------------------------------ register
  const opt = (key, label, labels) => ({ key, label, options: Object.keys(labels), labels });
  G.registerLine('sd', {
    label: 'Heroic frame (SD)', group: 'Mechs', weight: 4,
    slots: [
      opt('sdType', 'Archetype', TYPES),
      opt('sdHead', 'Head', HEADS),
      { key: 'sdWeaponR', label: 'Right hand', options: HAND_W, labels: labelsOf(HAND_W) },
      { key: 'sdWeaponL', label: 'Left hand', options: HAND_W, labels: labelsOf(HAND_W) },
      opt('sdBack', 'Backpack', BACKS),
      { key: 'sdBackR', label: 'Right shoulder', options: MOUNT_W, labels: Object.assign(labelsOf(MOUNT_W), { none: 'None' }) },
      { key: 'sdBackL', label: 'Left shoulder', options: MOUNT_W, labels: Object.assign(labelsOf(MOUNT_W), { none: 'None' }) },
    ],
    random: randomSD,
    build: buildSD,
    palettes: SD_PALETTES,
    sizeRange: [0.95, 1.2],
    name(r, bp) {
      const t = NAME_WORDS[bp.sdType] ? bp.sdType : 'hero';
      return `${NAME_PREFIX[t]}-${bp.number} ${r.pick(NAME_WORDS[t])}`;
    },
  });

  G.sdWeapons = WEAPONS;
  G.sdArmMotion = armMotion;
  G.sdPoses = POSES;
})();
