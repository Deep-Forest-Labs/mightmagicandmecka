// Mecha Factory — human units line: heroic super-deformed infantry (~3 heads tall).
// Roles pick the body (proportions, torso, default gear); weapons are self-contained builders held
// in a per-hand "grip" node. Arms are driven by 2-bone IK toward hand targets that each weapon
// poses in chest space, so one- and two-handed weapons, swings and recoil all share one rig.
(function () {
  const MF = window.MF;
  const PI = Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // ------------------------------------------------------------- extra human palettes
  Object.assign(MF.PALETTES, {
    'Iron Warden': { human: true, primary: '#3f5f8f', secondary: '#d9b45a', metal: '#8c93a0', accent: '#8fe3ff', glass: '#bff2ff', skin: '#d8a27c', hair: '#5a3b26', leather: '#6b4a30', tertiary: '#e8e0cc', outline: '#10131c', bg: '#6f7480', floor: '#626772' },
    'Ash Legion': { human: true, primary: '#8a8f96', secondary: '#b53a2a', metal: '#3e3f47', accent: '#ff5a2a', glass: '#ffb08a', skin: '#b98262', hair: '#1e1b1c', leather: '#4a3a30', tertiary: '#d9c89c', outline: '#121216', bg: '#55555c', floor: '#4a4a51' },
  });
  // darker, desaturated palettes for the grim / dark / real styles: low value, one accent
  const DARK = (o) => Object.assign({ human: true, styles: ['grim', 'dark', 'real'], glass: '#9fb4c0', outline: '#0b0a0c' }, o);
  Object.assign(MF.PALETTES, {
    'Iron Pilgrim': DARK({ primary: '#4b5058', secondary: '#b3a688', tertiary: '#5c1f22', metal: '#6c6f76', leather: '#3a2b21', skin: '#a07a60', hair: '#28211d', accent: '#d8a040', bg: '#3a3a3e', floor: '#323236' }),
    'Oxblood': DARK({ primary: '#5a1c1e', secondary: '#2b2a2e', tertiary: '#8a7858', metal: '#44454b', leather: '#2e221b', skin: '#a87c64', hair: '#191515', accent: '#e0462c', bg: '#302a2b', floor: '#292425' }),
    'Grave Moss': DARK({ primary: '#3e4933', secondary: '#7a6538', tertiary: '#4c3828', metal: '#5c5947', leather: '#372b20', skin: '#977660', hair: '#29241e', accent: '#a6d46c', bg: '#33362e', floor: '#2c2f28' }),
    'Ashen': DARK({ primary: '#686664', secondary: '#2e2d30', tertiary: '#4a3b35', metal: '#4e5056', leather: '#39312e', skin: '#a3887a', hair: '#1d1b1c', accent: '#ff6a28', bg: '#3a3939', floor: '#323131' }),
    'Bone & Rust': DARK({ primary: '#a89c82', secondary: '#7a3f24', tertiary: '#3e3933', metal: '#5b5650', leather: '#473223', skin: '#a8866a', hair: '#372820', accent: '#ffae45', bg: '#433e38', floor: '#3a3631' }),
    'Night Watch': DARK({ primary: '#27304a', secondary: '#7a808e', tertiary: '#5a2630', metal: '#5a5f6b', leather: '#2d2521', skin: '#a27e68', hair: '#19191f', accent: '#8cc4ff', bg: '#2a2e38', floor: '#242832' }),
  });
  const HUMAN_PALS = Object.keys(MF.PALETTES).filter((k) => MF.PALETTES[k].human && !MF.PALETTES[k].styles);
  const DARK_PALS = Object.keys(MF.PALETTES).filter((k) => MF.PALETTES[k].human && MF.PALETTES[k].styles);

  // ------------------------------------------------------------- styles
  // 'sd' is the original super-deformed look (ROLES as written). The others derive their proportions from the
  // role with multipliers, then legs / torso / arms are rescaled so the body hits a target height at size 1.
  // head/limbs/chest: shape multipliers; U,F arms; pads pauldron scale; ws weapon scale; blade greatsword length;
  // lean/headZ posture; crouch knee bend; bob/armSwing/lift/swing motion damping; bevel armour chamfer scale.
  const STYLES = {
    grim: { label: 'Grim heroic', head: 0.66, legs: 1.6, torso: 1.0, legW: 0.95, boot: 0.92, chestW: 1.08, chestD: 1.0, waist: 0.9, taper: 1.3, shX: 1.0,
      U: 0.78, F: 0.76, aw: 0.95, fore: 1.1, fist: 0.9, pads: 0.95, ws: 1.12, blade: 1.0, lean: 0.45, headZ: 0.5, crouch: 0.55, neck: 1.6,
      bob: 0.35, armSwing: 0.55, lift: 0.75, swing: 0.85, bevel: 0.4,
      H: { rogue: 46, soldier: 50, berserker: 56, sniper: 50, knight: 52, heavy: 54 } },
    dark: { label: 'Dark stylized', head: 0.9, legs: 0.95, torso: 1.2, legW: 0.8, boot: 1.0, chestW: 1.35, chestD: 1.1, waist: 0.58, taper: 2.2, shX: 1.12,
      U: 1.12, F: 1.1, aw: 1.05, fore: 1.55, fist: 1.45, pads: 1.0, ws: 1.18, blade: 0.95, lean: 1.0, leanAdd: 0.28, headZ: 1.0, headZAdd: 2, crouch: 1.15, neck: 1.2,
      bob: 0.45, armSwing: 0.6, lift: 0.8, swing: 0.85, bevel: 0.45,
      H: { rogue: 42, soldier: 46, berserker: 54, sniper: 46, knight: 48, heavy: 50 } },
    real: { label: 'Gritty realistic', head: 0.68, legs: 1.45, torso: 1.0, legW: 0.8, boot: 0.8, chestW: 0.86, chestD: 0.92, waist: 0.85, taper: 1.1, shX: 0.9, bruteW: 0.85,
      U: 0.8, F: 0.78, aw: 0.78, fore: 1.0, fist: 0.66, pads: 0.55, ws: 0.8, blade: 0.8, lean: 0.5, headZ: 0.4, crouch: 0.5, neck: 1.8,
      bob: 0.3, armSwing: 0.5, lift: 0.7, swing: 0.8, bevel: 0.3,
      H: { rogue: 50, soldier: 54, berserker: 60, sniper: 54, knight: 55, heavy: 57 } },
  };
  // hard-surface bevel: SD keeps its pebble shapes, the other styles get small angular chamfers
  const HB = (H, b) => (H.sd ? { bevel: b, bevelSet: 'round' } : { bevel: b * H.S.bevel, bevelSet: 'all' });

  // ------------------------------------------------------------- small rotation kit (3x3 in the first 9 slots)
  const eulerM = (r) => MF.matFromEuler(new Float64Array(12), 0, 0, 0, r[0], r[1], r[2]);
  const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  function mulT(a, b) { // a^T * b
    const o = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i] * b[j] + a[3 + i] * b[3 + j] + a[6 + i] * b[6 + j];
    return o;
  }
  function mul(a, b) {
    const o = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  }
  // R = Ry * Rx * Rz  ->  [rx, ry, rz]
  const toEuler = (m) => [Math.asin(clamp(-m[5], -1, 1)), Math.atan2(m[2], m[8]), Math.atan2(m[3], m[4])];
  // Euler that turns local +z toward direction d, then rolls about it
  function aim(d, roll = 0) {
    const n = norm(d);
    return [-Math.asin(clamp(n[1], -1, 1)), Math.atan2(n[0], n[2]), roll];
  }

  // Two-bone arm IK in the shoulder's parent frame. S shoulder, T target (effector = fist centre),
  // U upper arm, F forearm (+fist offset), pole: where the elbow should point.
  // Returns shoulder Euler, elbow bend (applied as rx = -b) and the hand's orientation matrix.
  function solveArm(S, U, F, T, pole) {
    let d = [T[0] - S[0], T[1] - S[1], T[2] - S[2]];
    let D = Math.hypot(d[0], d[1], d[2]);
    if (D < 1e-5) { d = [0, -1, 0]; D = 1e-5; }
    const hw = [d[0] / D, d[1] / D, d[2] / D];
    const Dc = clamp(D, Math.abs(U - F) + 0.08 * (U + F), (U + F) * 0.999);
    const b = PI - Math.acos(clamp((U * U + F * F - Dc * Dc) / (2 * U * F), -1, 1));
    // local frame: hand direction h, elbow-side direction e (both in the y-z plane), hinge x
    const hy = -U - F * Math.cos(b), hz = F * Math.sin(b), hl = Math.hypot(hy, hz);
    const h = [0, hy / hl, hz / hl], e = [0, -h[2], h[1]];
    let pd = pole[0] * hw[0] + pole[1] * hw[1] + pole[2] * hw[2];
    let ew = [pole[0] - pd * hw[0], pole[1] - pd * hw[1], pole[2] - pd * hw[2]];
    let el = Math.hypot(ew[0], ew[1], ew[2]);
    if (el < 1e-3) {
      const alt = Math.abs(hw[2]) < 0.9 ? [0, 0, -1] : [0, 1, 0];
      pd = alt[0] * hw[0] + alt[1] * hw[1] + alt[2] * hw[2];
      ew = [alt[0] - pd * hw[0], alt[1] - pd * hw[1], alt[2] - pd * hw[2]];
      el = Math.hypot(ew[0], ew[1], ew[2]);
    }
    ew = [ew[0] / el, ew[1] / el, ew[2] / el];
    const xw = [hw[1] * ew[2] - hw[2] * ew[1], hw[2] * ew[0] - hw[0] * ew[2], hw[0] * ew[1] - hw[1] * ew[0]];
    const R = new Float64Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i * 3 + j] = hw[i] * h[j] + ew[i] * e[j] + xw[i] * (j === 0 ? 1 : 0);
    const cb = Math.cos(-b), sb = Math.sin(-b);
    const Rx = new Float64Array([1, 0, 0, 0, cb, -sb, 0, sb, cb]);
    return { rot: toEuler(R), bend: b, hand: mul(R, Rx) };
  }

  // ------------------------------------------------------------- roles (body proportions, design px at size 1)
  // aY ankle height, crouch [hip, knee] rest angles, chest [W,H,D], U/F upper/fore arm, fist size.
  const ROLES = {
    rogue: {
      label: 'Rogue', body: 'lean', aY: 3, thigh: 7.2, shin: 7.4, legW: 3.4, hipX: 2.7, crouch: [-0.5, 0.95], boot: [4.4, 4.2, 7.5],
      chest: [10.5, 9.5, 7], lean: 0.45, walkLean: 0.12, head: 11.5, headZ: 1.8, headDrop: 1.2, U: 5.2, F: 5.4, aw: 2.8, fist: 3.8,
      shX: 6.4, shDrop: 2.6, swing: 0.62, lift: 1.25, sway: 0.03, walkCrouch: 0.12, shRoll: 0.05, armSwing: 2.5, ws: 1,
      padScale: 0.75,
    },
    soldier: {
      label: 'Soldier', body: 'armored', aY: 3.5, thigh: 5.5, shin: 5.2, legW: 5, hipX: 3.8, crouch: [-0.2, 0.4], boot: [6.6, 5.5, 9.5],
      chest: [15, 12, 10], lean: 0.1, walkLean: 0.08, head: 13.5, headZ: 0.6, headDrop: 1.2, U: 5.5, F: 6, aw: 4, fist: 4.6,
      shX: 9, shDrop: 3.2, swing: 0.5, lift: 1.0, sway: 0.03, walkCrouch: 0.05, shRoll: 0.04, armSwing: 3, ws: 1.22,
      padScale: 1.15,
    },
    berserker: {
      label: 'Berserker', body: 'brute', aY: 4, thigh: 9.2, shin: 8.8, legW: 6.6, hipX: 5, crouch: [-0.34, 0.62], boot: [8.4, 6, 11],
      chest: [20, 18.5, 13], lean: 0.34, walkLean: 0.1, head: 13, headZ: 3.2, headDrop: 1.2, U: 8, F: 8.5, aw: 6, fist: 6.4,
      shX: 12.2, shDrop: 3.6, swing: 0.44, lift: 1.1, sway: 0.07, walkCrouch: 0.08, shRoll: 0.09, armSwing: 3.5, ws: 1.25,
      padScale: 1.25,
    },
    sniper: {
      label: 'Sniper', body: 'lean', aY: 3, thigh: 7.2, shin: 7.4, legW: 3.8, hipX: 3, crouch: [-0.36, 0.72], boot: [5, 4.6, 8],
      chest: [11.5, 10.5, 7.5], lean: 0.24, walkLean: 0.1, head: 12, headZ: 1.2, headDrop: 1.2, U: 5.6, F: 5.8, aw: 3.1, fist: 3.9,
      shX: 6.8, shDrop: 2.8, swing: 0.56, lift: 1.15, sway: 0.03, walkCrouch: 0.1, shRoll: 0.04, armSwing: 2.5, ws: 1.05,
      padScale: 0.8,
    },
    knight: {
      label: 'Knight', body: 'armored', aY: 3.5, thigh: 5.8, shin: 5.4, legW: 5, hipX: 3.8, crouch: [-0.15, 0.3], boot: [6.4, 5.2, 9.5],
      chest: [14.5, 12.5, 10], lean: 0.06, walkLean: 0.06, head: 13, headZ: 0.6, headDrop: 1.2, U: 5.6, F: 6, aw: 4, fist: 4.6,
      shX: 8.8, shDrop: 3.2, swing: 0.48, lift: 1.0, sway: 0.03, walkCrouch: 0.05, shRoll: 0.04, armSwing: 3, ws: 1.15,
      padScale: 1.05,
    },
    heavy: {
      label: 'Heavy flamer', body: 'armored', aY: 4, thigh: 6.8, shin: 6.6, legW: 6.2, hipX: 4.6, crouch: [-0.2, 0.4], boot: [7.8, 6, 10.5],
      chest: [18, 15, 12], lean: 0.12, walkLean: 0.06, head: 14, headZ: 1, headDrop: 2, U: 6, F: 6.6, aw: 5, fist: 5.4,
      shX: 11, shDrop: 3.4, swing: 0.42, lift: 0.9, sway: 0.05, walkCrouch: 0.05, shRoll: 0.06, armSwing: 3, ws: 1.3,
      padScale: 1.3,
    },
  };

  // ------------------------------------------------------------- slots
  const OPT = {
    role: ['rogue', 'soldier', 'berserker', 'sniper', 'knight', 'heavy'],
    style: ['sd', 'grim', 'dark', 'real'],
    era: ['fantasy', 'scifi'],
    head: ['hood', 'helm', 'horned', 'visor', 'bare'],
    shoulders: ['pauldrons', 'fur', 'spiked', 'light', 'none'],
    extra: ['scarf', 'cape', 'backpack', 'tanks', 'banner', 'none'],
  };
  const LBL = {
    role: { rogue: 'Rogue', soldier: 'Soldier', berserker: 'Berserker', sniper: 'Sniper', knight: 'Knight', heavy: 'Heavy flamer' },
    era: { fantasy: 'High fantasy', scifi: 'Grimdark sci-fi' },
    style: { sd: 'Heroic SD (chibi)', grim: 'Grim heroic', dark: 'Dark stylized', real: 'Gritty realistic' },
    head: { hood: 'Hood', helm: 'Helmet', horned: 'Horned helm', visor: 'Visored helm', bare: 'Bare head' },
    shoulders: { pauldrons: 'Big pauldrons', fur: 'Fur mantle', spiked: 'Spiked plates', light: 'Leather caps', none: 'None' },
    extra: { scarf: 'Scarf', cape: 'Cape', backpack: 'Backpack', tanks: 'Fuel tanks', banner: 'Back banner', none: 'None' },
  };

  // ------------------------------------------------------------- materials per role / era
  function matsFor(role, era) {
    const sci = era === 'scifi';
    if (role === 'rogue') return {
      thigh: 'primary', shin: 'primary', boot: 'leather', knee: null, wrap: 'leather', upper: 'secondary', fore: 'leather', fist: 'leather',
      cuff: sci ? 'metal' : 'leather', joint: 'secondary',
    };
    if (role === 'sniper') return {
      thigh: 'primary', shin: 'primary', boot: 'leather', knee: 'leather', wrap: 'leather', upper: 'primary', fore: 'leather', fist: 'leather',
      cuff: sci ? 'metal' : 'leather', joint: 'primary',
    };
    if (role === 'knight' && !sci) return {
      thigh: 'metal', shin: 'metal', boot: 'metal', knee: 'secondary', wrap: 'leather', upper: 'primary', fore: 'metal', fist: 'metal', cuff: 'secondary', joint: 'metal',
    };
    if (role === 'berserker') return {
      thigh: sci ? 'metal' : 'primary', shin: sci ? 'primary' : 'leather', boot: sci ? 'primary' : 'leather', knee: sci ? 'secondary' : null, wrap: 'leather',
      upper: 'skin', fore: 'skin', fist: sci ? 'metal' : 'skin', cuff: sci ? 'primary' : 'leather', joint: 'skin', cuffLen: 0.32,
    };
    return { // soldier
      thigh: sci ? 'primary' : 'primary', shin: sci ? 'primary' : 'leather', boot: sci ? 'primary' : 'leather', knee: sci ? 'secondary' : 'metal', wrap: 'leather',
      upper: sci ? 'metal' : 'primary', fore: sci ? 'primary' : 'metal', fist: sci ? 'primary' : 'leather', cuff: sci ? 'secondary' : 'leather', joint: 'metal',
    };
  }

  // ------------------------------------------------------------- legs
  function buildLegs(ctx, H) {
    const { P, M, role, sci } = H;
    const [a1, a2] = P.crouch;
    const hipY = P.aY + P.thigh * Math.cos(a1) + P.shin * Math.cos(a1 + a2);
    const pelvis = ctx.root.child('pelvis', [0, hipY, 0]);
    P.hipY = hipY;
    const lw = P.legW;
    const [bw, bh, bl] = P.boot;
    for (const s of [-1, 1]) {
      const hip = pelvis.child('hip' + s, [s * P.hipX, 0, 0], [a1, 0, 0]);
      hip.box(lw + 0.4, P.thigh + 2, lw + 0.8, { at: [0, -P.thigh / 2 + 0.4, 0], mat: M.thigh, ...(H.body === 'brute' || H.sd ? { bevel: lw * 0.28, bevelSet: 'round' } : HB(H, lw * 0.28)) });
      const knee = hip.child('knee' + s, [0, -P.thigh, 0], [a2, 0, 0]);
      knee.box(lw - 0.2, P.shin + 1, lw + 0.2, { at: [0, -P.shin / 2, 0], mat: M.shin, bevel: 0.8 });
      if (M.knee) knee.box(lw + 1, 3.6, 2.6, { at: [0, 0.2, lw / 2 + 0.5], mat: M.knee, ...HB(H, 0.9), cuts: H.sd ? null : [[0, 1, 1, 1.2]] });
      const ankle = knee.child('ankle' + s, [0, -P.shin, 0], [-(a1 + a2), 0, 0]);
      // boot: sole sits exactly on y = 0 at rest
      const bz = bl * 0.17;
      if (H.body === 'lean') {
        ankle.box(bw, bh, bl, { at: [0, -P.aY + bh / 2, bz], mat: M.boot, bevel: 1, bevelSet: 'top', cuts: [[0, 1, 1, 2.2]] });
        ankle.box(bw + 0.8, 2.6, bw + 0.6, { at: [0, -P.aY + bh + 0.6, -0.2], mat: M.wrap, bevel: 0.6, rot: [0.15, 0, 0] });
        knee.box(lw + 0.3, 1.4, lw + 0.6, { at: [0, -P.shin * 0.45, 0], mat: M.wrap });
      } else if (H.body === 'brute') {
        ankle.box(bw, bh, bl, { at: [0, -P.aY + bh / 2, bz], mat: M.boot, bevel: H.sd ? 1.8 : 1, bevelSet: sci || !H.sd ? 'top' : 'round', cuts: sci || !H.sd ? [[0, 1, 1, 2]] : null });
        if (!sci) ankle.box(bw + 1.2, 3, bw + 1.2, { at: [0, -P.aY + bh + 0.8, 0], mat: 'hair', bevel: 1.2, bevelSet: 'round' });
        else ankle.box(bw - 1, 1.5, 2, { at: [0, -P.aY + 1.5, bz + bl / 2], mat: 'metal' });
        knee.box(lw + 0.6, 1.5, lw + 0.8, { at: [0, -P.shin * 0.35, 0], mat: sci ? 'metal' : M.wrap });
      } else {
        ankle.box(bw, bh, bl, { at: [0, -P.aY + bh / 2, bz], mat: M.boot, bevel: 1.2, bevelSet: 'top', cuts: [[0, 1, 1, 2.4]] });
        ankle.box(bw + 0.4, 1.4, bl + 0.4, { at: [0, -P.aY + 0.7, bz], mat: sci ? 'metal' : 'leather' });
        if (sci) ankle.box(bw + 0.6, 2.2, bw + 0.8, { at: [0, -P.aY + bh + 0.4, -0.3], mat: 'secondary', bevel: 0.6 });
      }
    }
    // stride: ankle travel during stance (half cycle) x 2
    const zA = (h) => -(P.thigh * Math.sin(h) + P.shin * Math.sin(h + a2));
    ctx.stride = 2 * (zA(a1 - P.swing) - zA(a1 + P.swing));
    return pelvis;
  }

  // ------------------------------------------------------------- torsos (chest node origin = waist)
  function buildTorso(ctx, H, pelvis) {
    const { P, role, sci } = H;
    const [W, Ht, D] = P.chest;
    const chest = pelvis.child('chest', [0, 1.5, 0], [P.lean, 0, 0]);
    const hw = P.hipX * 2 + P.legW;
    if (H.body === 'lean') {
      const tunic = role === 'rogue' ? 'secondary' : 'primary';
      pelvis.box(hw + 1, 3, P.legW + 3, { at: [0, 0.5, 0], mat: 'leather', bevel: 0.6 });
      pelvis.box(2.2, 2, 1, { at: [0, 0.6, P.legW / 2 + 1.9], mat: 'metal' });
      pelvis.box(3, 3.2, 2.4, { at: [P.hipX + 1.6, -0.2, 1], mat: 'leather', bevel: 0.6 });
      // sash tail
      pelvis.box(3, 7, 1, { at: [-P.hipX - 0.5, -3, 2], rot: [0.1, 0, 0.2], mat: 'tertiary', cuts: [[0, -1, 1, 1], [1, -1, 0, 1.2]] });
      chest.box(W * 0.72 * P.waist, 4.5, D * 0.8, { at: [0, 1.8, 0], mat: tunic, bevel: 0.8 });
      chest.box(W, Ht * 0.68, D, { at: [0, Ht * 0.6, 0], mat: tunic, bevel: 1.4, cuts: [[1, -1, 0, 2.2 * P.taper], [-1, -1, 0, 2.2 * P.taper]] });
      chest.box(1.4, Ht * 1.05, 1, { at: [0.5, Ht * 0.5, D / 2 + 0.2], rot: [0, 0, 0.62], mat: 'leather' }); // bandolier
      if (role === 'rogue') {
        chest.box(W + 2.5, 4, D + 1.5, { at: [0, Ht - 1, -0.6], mat: 'primary', bevel: 1.4, bevelSet: 'round' }); // capelet
        chest.box(W + 1.5, 5, 2, { at: [0, Ht - 4, -D / 2 - 0.4], mat: 'primary', cuts: [[1, -1, 0, 1.5], [-1, -1, 0, 1.5]] });
      } else { // sniper: ammo pouches on the chest, padded collar
        for (const x of [-2.6, 0, 2.6]) chest.box(2.2, 2.8, 1.6, { at: [x, Ht * 0.42, D / 2 + 0.5], mat: 'leather', bevel: 0.4 });
        chest.box(W * 0.8, 2.6, D * 0.85, { at: [0, Ht - 0.2, -0.3], mat: 'secondary', bevel: 1, bevelSet: 'round' });
      }
      chest.box(2, 1.8, 1.2, { at: [-1.3, Ht * 0.64, D / 2 + 0.6], rot: [0, 0, 0.62], mat: 'metal' });
      if (sci) chest.box(W * 0.5, 3, 2, { at: [0, Ht * 0.45, -D / 2 - 0.4], mat: 'metal', bevel: 0.5, detail: { type: 'light', face: '-z', pts: [[-1.5, 0], [1.5, 0]], size: 0.5 } });
    } else if (H.body === 'brute') {
      // belt, big buckle, loincloth flaps
      pelvis.box(hw + 3, 4.5, P.legW + 6, { at: [0, 0.6, 0.3], mat: 'leather', bevel: 1 });
      pelvis.box(5, 4.2, 1.6, { at: [0, 0.8, P.legW / 2 + 3.4], mat: sci ? 'secondary' : 'metal', ...HB(H, 0.8), detail: { type: 'face', face: '+z', pts: [[-1, 0.3], [1, 0.3]], size: 0.55, dark: 0 } });
      pelvis.box(6, 9, 1.4, { at: [0, -4.2, P.legW / 2 + 2.6], rot: [-0.08, 0, 0], mat: sci ? 'metal' : 'primary', cuts: [[1, -1, 0, 1.8], [-1, -1, 0, 1.8]], detail: sci ? { type: 'vent', face: '+z', pitch: 2, inset: 1 } : { type: 'band', at: -2.5, size: 0.7, mat2: 'tertiary' } });
      pelvis.box(8, 8, 1.4, { at: [0, -3.4, -P.legW / 2 - 2.8], rot: [0.12, 0, 0], mat: 'primary', cuts: [[1, -1, 0, 2], [-1, -1, 0, 2]] });
      if (sci) {
        chest.box(W * 0.7 * P.waist, 6, D * 0.75, { at: [0, 2.5, 0], mat: 'metal', bevel: 1, detail: { type: 'vent', face: '+z', pitch: 2, inset: 1.5 } });
        chest.box(W, Ht * 0.7, D, { at: [0, Ht * 0.62, 0], mat: 'primary', bevel: H.sd ? 2.2 : 1, cuts: [[1, -1, 0, 3.5 * P.taper], [-1, -1, 0, 3.5 * P.taper], [0, -1, 1, 3]], detail: [{ type: 'band', face: '+z', at: -Ht * 0.12, size: 0.8, mat2: 'secondary' }, { type: 'bolts', face: 'side', inset: 1.6 }] });
        chest.box(W * 0.45, 4, 2, { at: [0, Ht * 0.7, D / 2 + 0.2], mat: 'secondary', ...HB(H, 1), detail: { type: 'face', face: '+z', pts: [[-1.2, 0.5], [1.2, 0.5]], size: H.sd ? 0.6 : 0.5, h: H.sd ? 0.7 : 0.45, glow: true } });
        chest.box(W * 0.6, 3, D * 0.7, { at: [0, Ht + 0.2, -1], mat: 'metal', bevel: 0.8 });
      } else {
        chest.box(W * 0.74 * P.waist, 7.5, D * 0.86, { at: [0, 3, 0.8], mat: 'skin', bevel: 2.4, bevelSet: 'round' }); // gut
        chest.box(W, Ht * 0.66, D * 0.92, { at: [0, Ht * 0.62, 0], mat: 'skin', bevel: 2.6, bevelSet: 'round' });
        for (const s of [-1, 1]) chest.box(W * 0.4, Ht * 0.3, 2.4, { at: [s * W * 0.22, Ht * 0.66, D * 0.44], mat: 'skin', bevel: 1, bevelSet: 'round', rot: [0, 0, s * 0.08] });
        chest.box(2.2, Ht * 1.15, 1.2, { at: [0, Ht * 0.55, D * 0.5 + 0.8], rot: [0, 0, -0.7], mat: 'leather' }); // harness
        chest.box(W * 0.9, 2.2, D * 0.95, { at: [0, 4.6, 0.5], mat: 'tertiary', bevel: 0.8 }); // sash
        chest.box(W * 0.6, 3, D * 0.8, { at: [0, Ht * 0.6, -D / 2 + 0.5], mat: 'skin', bevel: 1.5, bevelSet: 'round' }); // back hump
      }
    } else {
      // soldier
      pelvis.box(hw + 1.5, 3.4, P.legW + 4.5, { at: [0, 0.6, 0], mat: 'leather', bevel: 0.7 });
      pelvis.box(3, 2.4, 1.2, { at: [0, 0.7, P.legW / 2 + 2.6], mat: sci ? 'secondary' : 'metal', bevel: 0.4 });
      for (const s of [-1, 1]) pelvis.box(2.6, 3, 2.4, { at: [s * (hw / 2 + 0.2), 0.4, 1.6], mat: 'leather', bevel: 0.6 });
      if (sci) {
        pelvis.box(5, 4.5, 3, { at: [0, -1.4, P.legW / 2 + 1.2], mat: 'primary', bevel: 0.8, cuts: [[0, -1, 1, 1.6]] });
        chest.box(W * 0.62 * P.waist, 5, D * 0.72, { at: [0, 2, 0], mat: 'metal', bevel: 0.8, detail: { type: 'vent', face: '+z', pitch: 1.6, inset: 1 } });
        chest.box(W, Ht * 0.72, D, { at: [0, Ht * 0.6, 0], mat: 'primary', bevel: H.sd ? 1.6 : 0.8, cuts: [[1, -1, 0, 3 * P.taper], [-1, -1, 0, 3 * P.taper], [0, -1, 1, 2.2]], detail: { type: 'bolts', face: 'side', inset: 1.4 } });
        // winged emblem
        chest.box(W * 0.74, 2, 1.2, { at: [0, Ht * 0.74, D / 2 + 0.3], mat: 'secondary', cuts: [[1, -1, 0, 1.1], [-1, -1, 0, 1.1]] });
        chest.box(2.4, 3.2, 1.6, { at: [0, Ht * 0.68, D / 2 + 0.6], mat: 'secondary', bevel: 0.5 });
        chest.box(W * 0.55, 2.6, D * 0.72, { at: [0, Ht + 0.3, -0.4], mat: 'metal', bevel: 0.8 });
      } else {
        pelvis.box(W * 0.42, 8, 1.2, { at: [0, -3.2, P.legW / 2 + 2.4], mat: 'primary', cuts: [[1, -1, 0, 1], [-1, -1, 0, 1]], detail: { type: 'band', face: '+z', dir: 'v', at: 0, size: 0.8, mat2: 'tertiary' } });
        chest.box(W * 0.8 * P.waist, 5, D * 0.8, { at: [0, 2, 0], mat: 'primary', bevel: 1 });
        chest.box(W * 0.94, Ht * 0.7, D, { at: [0, Ht * 0.6, 0], mat: 'metal', bevel: H.sd ? 2 : 0.9, cuts: [[1, -1, 0, 3 * P.taper], [-1, -1, 0, 3 * P.taper]], detail: { type: 'panel', face: '+z', at: 0, dir: 'v' } });
        chest.box(W * 0.4, Ht * 0.52, 1.2, { at: [0, Ht * 0.52, D / 2 + 0.3], mat: 'primary', cuts: [[1, -1, 0, 1.5], [-1, -1, 0, 1.5]], detail: { type: 'band', face: '+z', dir: 'v', at: 0, size: 0.8, mat2: 'tertiary' } });
        chest.box(W * 0.55, 2.6, D * 0.72, { at: [0, Ht + 0.2, -0.4], mat: 'leather', bevel: 0.8 });
      }
    }
    if (H.style === 'real') { // gear: belt pouches, a slung sheath, a cross strap, a hanging flask
      const hx = P.hipX + P.legW / 2;
      pelvis.box(2, 2.6, 1.8, { at: [hx * 0.55, 0, P.legW / 2 + 1.4], mat: 'leather', bevel: 0.3 });
      pelvis.box(2, 2.6, 1.8, { at: [-hx * 0.55, 0, P.legW / 2 + 1.4], mat: 'leather', bevel: 0.3 });
      pelvis.box(1.6, P.thigh * 0.9, 1.4, { at: [hx + 0.6, -P.thigh * 0.35, -1.2], rot: [0.5, 0, 0.12], mat: 'leather', detail: { type: 'band', at: P.thigh * 0.3, size: 0.5, mat2: 'metal' } });
      pelvis.cyl('y', 1.1, 3, { at: [-hx - 0.4, -1.6, -0.8], mat: 'tertiary', sides: 6 });
      chest.box(1, Ht * 1.05, 1, { at: [-W * 0.1, Ht * 0.52, -D / 2 - 0.3], rot: [0, 0, -0.62], mat: 'leather' });
    }
    return chest;
  }

  // ------------------------------------------------------------- heads (node origin = neck, facing +z)
  function faceDetail(H, opt = {}) {
    const hs = P0(H).head;
    const sep = opt.sep || hs * 0.17;
    return {
      type: 'face', face: '+z', pts: [[-sep, opt.eyeY || 0.4], [sep, opt.eyeY || 0.4]], size: opt.size || 0.62, h: opt.h || 0.75,
      glow: !!opt.glow, brow: opt.brow !== false, angry: opt.angry !== false, mat2: 'hair', v: opt.mouth, mw: opt.mw || 1.3, band: opt.beard,
    };
  }
  const P0 = (H) => H.P;

  function buildHead(ctx, H, chest) {
    const { P, bp, sci, role } = H;
    const [W, Ht, D] = P.chest;
    const hs = P.head;
    const head = chest.child('head', [0, Ht - P.headDrop, P.headZ], [-P.lean * 0.9, 0, 0]);
    if (!H.sd) { buildHeadStyled(ctx, H, head); return head; }
    const type = bp.head;
    const skull = (w, h, d, y, z, det) => head.box(w, h, d, { at: [0, y, z], mat: 'skin', bevel: Math.min(w, h) * 0.2, bevelSet: 'round', detail: det });
    const big = H.body === 'brute';
    switch (type) {
      case 'hood': {
        const fw = hs * 0.64, fh = hs * 0.6;
        skull(fw, fh, hs * 0.7, hs * 0.42, 1.6, sci ? null : faceDetail(H, { eyeY: hs * 0.06, sep: hs * 0.15, size: 0.7, h: 0.8 }));
        // mask / respirator over the lower face
        head.box(fw + 0.6, fh * 0.36, hs * 0.66, { at: [0, hs * 0.22, 2], mat: sci ? 'metal' : 'tertiary', bevel: 0.8, detail: sci ? { type: 'vent', face: '+z', pitch: 1.2, inset: 0.8 } : null });
        if (sci) { // goggles
          for (const s of [-1, 1]) head.cyl('z', 1.35, 1.4, { at: [s * hs * 0.15, hs * 0.5, hs * 0.35 + 1.4], mat: 'accent', sides: 8, shadow: false });
          head.box(fw + 1, 1.1, hs * 0.62, { at: [0, hs * 0.5, 0.9], mat: 'metal' });
        }
        // hood shell: big rounded cowl set back so the face peeks out, brim, and a pointed tip
        head.box(hs * 0.98, hs * 0.92, hs * 0.92, { at: [0, hs * 0.5, -0.9], mat: 'primary', bevel: hs * 0.2, bevelSet: 'round' });
        head.box(hs * 0.84, 2.2, 3, { at: [0, hs * 0.86, hs * 0.34], mat: 'primary', bevel: 0.8, rot: [0.2, 0, 0] });
        const tip = head.child('hoodTip', [0, hs * 0.8, -hs * 0.35], [-1.95, 0, 0]);
        tip.box(hs * 0.5, hs * 0.6, 3, { at: [0, hs * 0.22, 0], mat: 'primary', cuts: [[1, 1, 0, 2], [-1, 1, 0, 2]] });
        break;
      }
      case 'helm': {
        if (sci) {
          head.box(hs * 0.96, hs * 0.9, hs * 0.94, { at: [0, hs * 0.47, 0], mat: 'primary', bevel: hs * 0.2, bevelSet: 'round' });
          head.box(1.6, 1.4, hs * 0.9, { at: [0, hs * 0.92, -0.2], mat: 'secondary', bevel: 0.4 });
          head.box(hs * 0.7, hs * 0.38, 2.2, { at: [0, hs * 0.44, hs * 0.44], mat: 'primary', bevel: 0.8, detail: { type: 'light', face: '+z', pts: [[-hs * 0.17, hs * 0.05], [hs * 0.17, hs * 0.05]], size: 0.95 } });
          head.box(hs * 0.3, hs * 0.26, 2.8, { at: [0, hs * 0.18, hs * 0.5], mat: 'metal', bevel: 0.6, cuts: [[0, -1, 1, 1.2]], detail: { type: 'vent', face: '+z', pitch: 1.3, inset: 0.5 } });
          for (const s of [-1, 1]) head.cyl('x', hs * 0.18, 1.6, { at: [s * hs * 0.49, hs * 0.38, 0], mat: 'secondary', sides: 8 });
        } else {
          skull(hs * 0.72, hs * 0.66, hs * 0.72, hs * 0.36, 1.4, faceDetail(H, { eyeY: hs * 0.04, sep: hs * 0.15, mouth: big ? null : -hs * 0.2, beard: big ? -hs * 0.08 : null }));
          head.cyl('y', hs * 0.44, hs * 0.34, { at: [0, hs * 0.8, -0.4], mat: 'metal', sides: 8, twist: PI / 8, detail: { type: 'band', at: -hs * 0.12, size: 0.6, mat2: 'secondary' } });
          head.cone('y', hs * 0.66, hs * 0.54, 1.6, { at: [0, hs * 0.64, -0.4], mat: 'metal', sides: 8, twist: PI / 8 });
          head.box(2, 1.8, 2, { at: [0, hs * 1.0, -0.4], mat: 'secondary', bevel: 0.5 });
          for (const s of [-1, 1]) head.box(0.9, hs * 0.4, 1, { at: [s * hs * 0.37, hs * 0.26, 0.6], mat: 'leather' });
        }
        break;
      }
      case 'horned': {
        if (sci) {
          head.box(hs * 0.9, hs * 0.86, hs * 0.9, { at: [0, hs * 0.45, 0], mat: 'metal', bevel: hs * 0.2, bevelSet: 'round', detail: faceDetail(H, { eyeY: hs * 0.06, sep: hs * 0.17, glow: true, size: 0.9, h: 0.8 }) });
          head.box(hs * 0.42, hs * 0.3, 2.4, { at: [0, hs * 0.16, hs * 0.44], mat: 'metal', bevel: 0.5, detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.4 } });
          head.box(hs * 0.96, hs * 0.44, hs * 0.94, { at: [0, hs * 0.76, -0.4], mat: 'primary', bevel: hs * 0.16, bevelSet: 'round' });
        } else {
          skull(hs * 0.74, hs * 0.68, hs * 0.74, hs * 0.38, 0.5, faceDetail(H, { eyeY: hs * 0.04, sep: hs * 0.16, beard: -hs * 0.06 }));
          // big braided beard
          head.box(hs * 0.62, hs * 0.42, 3, { at: [0, hs * 0.05, hs * 0.3], mat: 'hair', bevel: 0.8, cuts: [[1, -1, 0, 2], [-1, -1, 0, 2]] });
          head.box(hs * 0.94, hs * 0.44, hs * 0.94, { at: [0, hs * 0.76, -0.2], mat: 'metal', bevel: hs * 0.18, bevelSet: 'round', detail: { type: 'band', face: 'notTop', at: -hs * 0.12, size: 0.8, mat2: 'secondary' } });
          head.box(1.4, hs * 0.34, 1.2, { at: [0, hs * 0.52, hs * 0.44], mat: 'metal' });
        }
        for (const s of [-1, 1]) { // horns: out, then sweeping up
          const h1 = head.child('horn' + s, [s * hs * 0.42, hs * 0.78, -0.4], [0, 0, -s * 1.15]);
          h1.cone('y', hs * 0.17, hs * 0.12, hs * 0.42, { at: [0, hs * 0.2, 0], mat: 'secondary', sides: 6 });
          const h2 = h1.child('hornTip' + s, [0, hs * 0.4, 0], [0, 0, s * 0.95]);
          h2.cone('y', hs * 0.12, 0.3, hs * 0.5, { at: [0, hs * 0.24, 0], mat: 'secondary', sides: 6 });
        }
        break;
      }
      case 'visor': {
        if (sci) {
          head.box(hs * 0.94, hs * 0.92, hs * 0.94, { at: [0, hs * 0.47, 0], mat: 'primary', bevel: hs * 0.22, bevelSet: 'round' });
          head.box(hs * 0.8, hs * 0.26, 2, { at: [0, hs * 0.5, hs * 0.44], mat: 'metal', bevel: 0.5, detail: { type: 'eye', face: '+z', at: 0, h: 0.8, w: hs * 0.34 } });
          head.box(hs * 0.26, hs * 0.3, 2, { at: [0, hs * 0.22, hs * 0.46], mat: 'metal', detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.3 } });
          head.box(1.4, hs * 0.5, hs * 0.7, { at: [0, hs * 0.96, -0.4], mat: 'secondary', cuts: [[0, 1, 1, 2]] });
        } else { // great helm with dark slit and a plume
          head.cyl('y', hs * 0.48, hs * 0.86, { at: [0, hs * 0.44, 0], mat: 'metal', sides: 8, twist: PI / 8, detail: [{ type: 'face', face: '+z', pts: [[-hs * 0.14, hs * 0.1], [hs * 0.14, hs * 0.1]], size: 1.3, h: 0.5, brow: false, dark: 0 }, { type: 'band', at: -hs * 0.05, size: 0.5, mat2: 'secondary' }] });
          head.cone('y', hs * 0.48, hs * 0.3, 2.2, { at: [0, hs * 0.97, 0], mat: 'metal', sides: 8, twist: PI / 8 });
          head.box(1.2, hs * 0.5, 1, { at: [0, hs * 0.44, hs * 0.5], mat: 'secondary' });
          const pl = head.child('plume', [0, hs * 1.05, -0.5], [-0.5, 0, 0]);
          pl.box(2, hs * 0.55, hs * 0.5, { at: [0, hs * 0.2, -hs * 0.2], mat: 'tertiary', bevel: 0.8, cuts: [[0, 1, 1, 2.5]] });
        }
        break;
      }
      default: { // bare head with wild hair
        skull(hs * 0.8, hs * 0.76, hs * 0.8, hs * 0.42, 0.4, faceDetail(H, { eyeY: hs * 0.06, sep: hs * 0.16, mouth: big ? null : -hs * 0.18, beard: big ? -hs * 0.04 : null, glow: false }));
        if (sci) head.box(2, 1.6, 1, { at: [hs * 0.16, hs * 0.48, hs * 0.44], mat: 'accent', shadow: false });
        head.box(hs * 0.86, hs * 0.3, hs * 0.86, { at: [0, hs * 0.8, -0.3], mat: 'hair', bevel: 1.2, bevelSet: 'round' });
        head.box(hs * 0.84, hs * 0.5, 2.5, { at: [0, hs * 0.55, -hs * 0.36], mat: 'hair', bevel: 1 });
        for (const [x, z, rz, rx] of [[-0.25, 0.1, 0.5, 0], [0, 0.1, 0, -0.2], [0.25, 0.1, -0.5, 0], [0, -0.25, 0, 0.6], [-0.32, -0.2, 0.9, 0.3], [0.32, -0.2, -0.9, 0.3]]) {
          head.cone('y', 1.6, 0.2, hs * 0.38, { at: [x * hs, hs * 0.96, z * hs], rot: [rx, 0, rz], mat: 'hair', sides: 5 });
        }
        if (big) head.box(hs * 0.62, hs * 0.4, 3, { at: [0, hs * 0.1, hs * 0.3], mat: 'hair', bevel: 0.8, cuts: [[1, -1, 0, 2], [-1, -1, 0, 2]] });
      }
    }
    return head;
  }

  // Heads for the grim / dark / real styles: angular shells, faces hidden or shadowed, eyes at most 1px.
  function buildHeadStyled(ctx, H, head) {
    const { P, bp, sci } = H;
    const hs = P.head, type = bp.head, brute = H.body === 'brute', real = H.style === 'real';
    const hb = (b) => ({ bevel: b, bevelSet: 'all' });
    const sep = Math.max(1.1, hs * 0.15);
    const face = (o = {}) => ({
      type: 'face', face: '+z', pts: [[-sep, o.eyeY || 0], [sep, o.eyeY || 0]], size: 0.5, h: 0.5, dark: 0, glint: o.glint,
      brow: o.brow !== false, browW: real ? 0.2 : 0.6, browT: real ? 0.5 : 0.62, angry: !real, mat2: 'hair', shade: o.shade, fill: o.fill, band: o.beard,
    });
    const skin = (w, h, d, y, z, det) => head.box(w, h, d, { at: [0, y, z], mat: 'skin', ...hb(0.5), detail: det });
    const beard = (len) => head.box(hs * 0.6, len, 2.4, { at: [0, hs * 0.12 - len * 0.3, hs * 0.34], mat: 'hair', ...hb(0.4), cuts: [[1, -1, 0, hs * 0.22], [-1, -1, 0, hs * 0.22]] });
    const horns = (len) => {
      for (const s of [-1, 1]) { // swept out, then hooking forward like a bull's
        const h1 = head.child('horn' + s, [s * hs * 0.42, hs * 0.7, -0.3], [0, 0, -s * 1.3]);
        h1.cone('y', hs * 0.16, hs * 0.11, len * 0.55, { at: [0, len * 0.27, 0], mat: 'secondary', sides: 5 });
        const h2 = h1.child('hornTip' + s, [0, len * 0.52, 0], [0.9, 0, s * 0.55]);
        h2.cone('y', hs * 0.11, 0.25, len * 0.55, { at: [0, len * 0.26, 0], mat: 'secondary', sides: 5 });
      }
    };
    switch (type) {
      case 'hood': { // deep cowl, face lost in shadow except two glints
        skin(hs * 0.6, hs * 0.66, hs * 0.66, hs * 0.42, 0.9, face({ fill: 0, glint: sci ? 204 : 3, eyeY: hs * 0.06, brow: false }));
        if (sci) head.box(hs * 0.3, hs * 0.2, 1.8, { at: [0, hs * 0.2, hs * 0.38], mat: 'metal', detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.3 } });
        head.box(hs * 1.0, hs * 1.02, hs * 1.0, { at: [0, hs * 0.52, -0.9], mat: 'primary', ...hb(0.7), cuts: [[0, 1, -1, hs * 0.32], [1, 1, 0, hs * 0.14], [-1, 1, 0, hs * 0.14]] });
        head.box(hs * 0.94, 1.8, hs * 0.4, { at: [0, hs * 0.96, hs * 0.3], rot: [0.32, 0, 0], mat: 'primary', ...hb(0.4) });
        for (const s of [-1, 1]) head.box(1.6, hs * 0.86, hs * 0.34, { at: [s * hs * 0.42, hs * 0.48, hs * 0.36], mat: 'primary', rot: [0, -s * 0.15, 0] });
        const tip = head.child('hoodTip', [0, hs * 0.9, -hs * 0.3], [-1.25, 0, 0]);
        tip.box(hs * 0.42, hs * 0.5, 2, { at: [0, hs * 0.2, 0], mat: 'primary', cuts: [[1, 1, 0, hs * 0.2], [-1, 1, 0, hs * 0.2]] });
        break;
      }
      case 'helm': {
        if (sci) { // faceted helm, faceplate with thin glowing lens slits, grille snout
          head.box(hs * 0.9, hs * 0.92, hs * 0.94, { at: [0, hs * 0.48, -0.2], mat: 'primary', ...hb(0.8), cuts: [[1, 1, 0, hs * 0.2], [-1, 1, 0, hs * 0.2], [0, 1, 1, hs * 0.22], [0, 1, -1, hs * 0.14]] });
          head.box(hs * 0.66, hs * 0.4, 1.8, { at: [0, hs * 0.46, hs * 0.44], mat: 'metal', ...hb(0.3), detail: { type: 'slit', face: '+z', rects: [[-hs * 0.16, hs * 0.04, 1.3, 0.45], [hs * 0.16, hs * 0.04, 1.3, 0.45]], glow: true } });
          head.box(hs * 0.3, hs * 0.3, 2.6, { at: [0, hs * 0.18, hs * 0.48], mat: 'metal', cuts: [[0, -1, 1, 1.2], [1, 0, 1, 0.8], [-1, 0, 1, 0.8]], detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.3 } });
          head.box(1.2, hs * 0.2, hs * 0.86, { at: [0, hs * 0.92, -0.3], mat: 'secondary' });
          for (const s of [-1, 1]) head.box(1.4, hs * 0.34, hs * 0.34, { at: [s * hs * 0.47, hs * 0.4, 0], mat: 'secondary', cuts: [[0, 1, 1, 1], [0, -1, 1, 1]] });
        } else { // sallet: swept tail, eye slit, bevor over the jaw
          head.box(hs * 0.84, hs * 0.9, hs * 0.9, { at: [0, hs * 0.5, 0], mat: 'metal', ...hb(0.6), cuts: [[0, 1, 1, hs * 0.26], [0, 1, -1, hs * 0.2], [1, 1, 0, hs * 0.16], [-1, 1, 0, hs * 0.16]], detail: { type: 'slit', face: '+z', rects: [[0, hs * 0.08, hs * 0.3, 0.55]] } });
          head.box(hs * 0.84, 1.4, hs * 0.45, { at: [0, hs * 0.16, -hs * 0.52], rot: [-0.55, 0, 0], mat: 'metal' });
          head.box(hs * 0.8, hs * 0.36, 2, { at: [0, hs * 0.16, hs * 0.42], mat: 'metal', cuts: [[0, -1, 1, 1], [1, 0, 1, 1], [-1, 0, 1, 1]] });
          head.box(1, hs * 0.16, hs * 0.8, { at: [0, hs * 0.97, -0.2], mat: 'secondary' });
        }
        break;
      }
      case 'visor': {
        if (sci) { // helm with a glowing T-visor
          head.box(hs * 0.9, hs * 0.96, hs * 0.92, { at: [0, hs * 0.48, -0.2], mat: 'primary', ...hb(0.8), cuts: [[1, 1, 0, hs * 0.22], [-1, 1, 0, hs * 0.22], [0, 1, -1, hs * 0.2]] });
          head.box(hs * 0.7, hs * 0.62, 1.6, { at: [0, hs * 0.44, hs * 0.44], mat: 'metal', ...hb(0.3), cuts: [[1, -1, 0, 1.4], [-1, -1, 0, 1.4]], detail: { type: 'slit', face: '+z', rects: [[0, hs * 0.1, hs * 0.28, 0.45], [0, -hs * 0.08, 0.45, hs * 0.16]], glow: true } });
          head.box(1.4, hs * 0.34, hs * 0.7, { at: [0, hs * 1.0, -0.6], mat: 'secondary', cuts: [[0, 1, 1, 2]] });
        } else { // flat-topped great helm, dark T-slit, cross trim, a stiff crest
          head.box(hs * 0.86, hs * 1.04, hs * 0.9, { at: [0, hs * 0.5, 0], mat: 'metal', ...hb(0.5), cuts: [[1, 1, 0, 1], [-1, 1, 0, 1], [0, 1, 1, 1], [0, 1, -1, 1]], detail: [{ type: 'slit', face: '+z', rects: [[0, hs * 0.14, hs * 0.32, 0.55], [0, -hs * 0.08, 0.55, hs * 0.2]] }, { type: 'band', face: 'notTop', at: -hs * 0.36, size: 0.5, mat2: 'secondary' }] });
          head.box(1.2, hs * 0.66, 1, { at: [0, hs * 0.5, hs * 0.46], mat: 'secondary', detail: { type: 'slit', face: '+z', rects: [[0, -hs * 0.08, 0.6, hs * 0.2]] } });
          const pl = head.child('plume', [0, hs * 1.02, -0.5], [-0.3, 0, 0]);
          pl.box(1.4, hs * 0.4, hs * 0.8, { at: [0, hs * 0.16, -hs * 0.1], mat: 'tertiary', cuts: [[0, 1, 1, hs * 0.3], [0, 1, -1, hs * 0.2]] });
        }
        break;
      }
      case 'horned': {
        if (sci) {
          head.box(hs * 0.88, hs * 0.9, hs * 0.9, { at: [0, hs * 0.48, 0], mat: 'metal', ...hb(0.6), cuts: [[0, 1, 1, hs * 0.2], [1, 1, 0, hs * 0.14], [-1, 1, 0, hs * 0.14]], detail: { type: 'slit', face: '+z', rects: [[-hs * 0.16, hs * 0.06, 1.1, 0.45], [hs * 0.16, hs * 0.06, 1.1, 0.45]], glow: true } });
          head.box(hs * 0.4, hs * 0.3, 2.4, { at: [0, hs * 0.14, hs * 0.44], mat: 'metal', cuts: [[0, -1, 1, 1], [1, 0, 1, 0.8], [-1, 0, 1, 0.8]], detail: { type: 'vent', face: '+z', pitch: 1.2, inset: 0.3 } });
          head.box(hs * 0.92, hs * 0.36, hs * 0.94, { at: [0, hs * 0.82, -0.3], mat: 'primary', ...hb(0.6), cuts: [[0, 1, 1, hs * 0.16]] });
        } else {
          skin(hs * 0.7, hs * 0.72, hs * 0.74, hs * 0.38, 0.6, face({ eyeY: hs * 0.05, shade: hs * 0.02, beard: -hs * 0.1 }));
          beard(brute ? hs * 0.5 : hs * 0.34);
          head.box(hs * 0.92, hs * 0.44, hs * 0.94, { at: [0, hs * 0.78, -0.2], mat: 'metal', ...hb(0.6), cuts: [[0, 1, 1, hs * 0.14], [1, 1, 0, hs * 0.12], [-1, 1, 0, hs * 0.12]], detail: { type: 'band', face: 'notTop', at: -hs * 0.12, size: 0.6, mat2: 'secondary' } });
          head.box(1.2, hs * 0.36, 1.2, { at: [0, hs * 0.5, hs * 0.44], mat: 'metal' });
        }
        horns(hs * (brute ? 1.25 : 0.9));
        break;
      }
      default: { // bare: hard-set face, heavy brows, cropped or wild hair
        skin(hs * 0.72, hs * 0.86, hs * 0.8, hs * 0.44, 0.3, face({ eyeY: hs * 0.06, beard: brute ? -hs * 0.12 : null }));
        if (sci) head.box(1.6, 1, 0.8, { at: [sep, hs * 0.5, hs * 0.42], mat: 'accent', shadow: false });
        head.box(hs * 0.78, hs * 0.22, hs * 0.86, { at: [0, hs * 0.9, -0.2], mat: 'hair', ...hb(0.4) });
        head.box(hs * 0.78, hs * 0.62, 2.2, { at: [0, hs * 0.58, -hs * 0.4], mat: 'hair', ...hb(0.3) });
        if (brute) {
          beard(hs * 0.55);
          head.box(2, hs * 0.3, hs * 0.8, { at: [0, hs * 1.06, -0.4], mat: 'hair', cuts: [[0, 1, 1, hs * 0.2], [0, 1, -1, hs * 0.14]] }); // crest of hair
        }
      }
    }
  }

  // ------------------------------------------------------------- arms (IK chain: shoulder -> elbow -> hand -> grip)
  function buildArm(ctx, H, chest, s) {
    const { P, M } = H;
    const S = H.sh[s];
    const aw = P.aw, fs = P.fist, fo = fs * 0.42;
    const sh = chest.child('sh' + s, S);
    sh.box(aw + 1, aw + 1, aw + 1, { mat: M.joint, ...HB(H, aw * 0.3) });
    sh.box(aw, P.U + 1, aw, { at: [0, -P.U / 2, 0], mat: M.upper, bevel: aw * 0.3, bevelSet: H.body === 'brute' ? 'round' : 'all' });
    const el = sh.child('el' + s, [0, -P.U, 0]);
    el.box(aw * P.fore + 0.8, P.F + 0.6, aw * P.fore + 0.8, { at: [0, -P.F / 2 + 0.2, 0], mat: M.fore, bevel: aw * 0.25, bevelSet: H.body === 'brute' ? 'round' : 'all' });
    const cl = M.cuffLen || 0.5;
    el.cone('y', (aw * P.fore + 2.2) / 2, (aw * P.fore + 0.8) / 2, P.F * cl, { at: [0, -P.F * (1 - cl * 0.6), 0], mat: M.cuff, sides: 8, twist: PI / 8 });
    const hand = el.child('hand' + s, [0, -P.F, 0]);
    hand.box(fs, fs, fs, { at: [0, -fo, 0], mat: M.fist, ...(H.sd || M.fist === 'skin' ? { bevel: fs * 0.26, bevelSet: 'round' } : HB(H, fs * 0.26)) });
    const grip = hand.child('grip' + s, [0, -fo, 0]);
    return { sh, el, hand, grip, Feff: P.F + fo };
  }

  // ------------------------------------------------------------- shoulders (pads follow the upper arm a little)
  function buildShoulders(ctx, H, chest) {
    const { P, bp, sci } = H;
    const type = bp.shoulders;
    const [W, Ht, D] = P.chest;
    const q = P.padScale;
    if (type === 'fur') { // one heavy mantle across the shoulders and back
      chest.box(W * 0.86, 4.5 * q, D * 0.62, { at: [0, Ht - 0.6, -D * 0.3], mat: 'leather', bevel: 1.8, bevelSet: 'round' });
      chest.box(W * 0.7, 6 * q, 3.5, { at: [0, Ht - 3.5, -D / 2 - 0.4], mat: 'leather', bevel: 1.4, bevelSet: 'round' });
    }
    if (type === 'none') return;
    for (const s of [-1, 1]) {
      const S = H.sh[s];
      const pad = chest.child('pad' + s, [S[0], S[1], S[2]]);
      switch (type) {
        case 'pauldrons':
          if (sci && !H.sd) { // angular power-armour pauldron: faceted shell, raised trim ridge, heavy lower rim
            pad.box(10 * q, 8 * q, 12 * q, { at: [s * 2.4 * q, 2.4 * q, 0], mat: 'primary', bevel: 0.8, cuts: [[s, 1, 0, 3.4 * q], [0, 1, 1, 2.4 * q], [0, 1, -1, 2.4 * q], [-s, 1, 0, 1.2 * q]], detail: { type: 'bolts', face: 'side', inset: 1.4 } });
            pad.box(1.6 * q, 3 * q, 11 * q, { at: [s * 1.2 * q, 6.6 * q, 0], mat: 'secondary', cuts: [[0, 1, 1, 1.4 * q], [0, 1, -1, 1.4 * q]] });
            pad.box(11.2 * q, 2 * q, 13 * q, { at: [s * 2.8 * q, -1.8 * q, 0], mat: 'secondary', bevel: 0.5, rot: [0, 0, -s * 0.18] });
          } else if (sci) { // 40k bowl: rounded dome over a contrasting rim
            pad.box(10 * q, 8.5 * q, 11.5 * q, { at: [s * 2.2 * q, 2.2 * q, 0], mat: 'primary', bevel: 3 * q, bevelSet: 'round' });
            pad.box(11 * q, 2 * q, 12.5 * q, { at: [s * 2.6 * q, -1.8 * q, 0], mat: 'secondary', bevel: 0.9, rot: [0, 0, -s * 0.15] });
            pad.box(2 * q, 3 * q, 5 * q, { at: [s * 7.3 * q, 2.2 * q, 0], mat: 'secondary', bevel: 0.6 });
          } else {
            pad.box(8.5 * q, 3.4 * q, 11 * q, { at: [s * 1.8 * q, 3.4 * q, 0], mat: 'primary', bevel: 1.2, rot: [0, 0, -s * 0.28], detail: { type: 'band', face: '+y', dir: 'v', at: s * 3.2 * q, size: 0.8, mat2: 'secondary' } });
            pad.box(8.4 * q, 3 * q, 10 * q, { at: [s * 3 * q, 0.6 * q, 0], mat: 'metal', bevel: 1.1, rot: [0, 0, -s * 0.55] });
            pad.box(7.6 * q, 3 * q, 9 * q, { at: [s * 4.2 * q, -1.8 * q, 0], mat: 'secondary', bevel: 1, rot: [0, 0, -s * 0.8] });
            if (!H.sd) pad.box(1.4 * q, 2.6 * q, 10 * q, { at: [s * 1.2 * q, 5.4 * q, 0], mat: 'metal', rot: [0, 0, -s * 0.28], cuts: [[0, 1, 1, 1.6 * q], [0, 1, -1, 1.6 * q]] });
          }
          break;
        case 'spiked':
          pad.box(8 * q, 6.5 * q, 10 * q, { at: [s * 1.6 * q, 1.4 * q, 0], mat: sci ? 'primary' : 'metal', bevel: 1.6 * q, detail: { type: 'bolts', face: 'side', inset: 1.4 } });
          for (const z of [-2.8, 0.2, 3.2]) pad.cone('y', 1.3 * q, 0.2, 5 * q, { at: [s * 2.4 * q, 6.4 * q, z * q], rot: [0, 0, -s * 0.35], mat: sci ? 'secondary' : 'metal', sides: 5 });
          break;
        case 'fur':
          pad.box(8.5 * q, 6.5 * q, 10 * q, { at: [s * 2 * q, 1.4 * q, -0.6], mat: 'leather', bevel: 2.4 * q, bevelSet: 'round' });
          pad.box(5 * q, 4 * q, 7 * q, { at: [s * 4.2 * q, -1.4 * q, 0.2], mat: 'leather', bevel: 1.4 * q, bevelSet: 'round', rot: [0, 0, -s * 0.5] });
          for (const z of [-2.5, 1.5]) pad.cone('y', 1.4 * q, 0.2, 3 * q, { at: [s * 3 * q, 4.6 * q, z * q], rot: [0, 0, -s * 0.5], mat: 'leather', sides: 5 });
          if (s < 0) pad.box(4.2 * q, 4 * q, 4 * q, { at: [s * 2.5 * q, 4.8 * q, 1.5 * q], mat: 'tertiary', ...HB(H, 1.2), detail: { type: 'face', face: '+z', pts: [[-0.9, 0.3], [0.9, 0.3]], size: 0.55, h: 0.6, brow: false, dark: 0 } }); // skull trophy
          break;
        default: // light leather caps
          pad.box(5 * q, 3.4 * q, 6.5 * q, { at: [s * 1.2 * q, 1.2 * q, 0], mat: 'leather', bevel: 1, rot: [0, 0, -s * 0.35] });
      }
    }
  }

  // ------------------------------------------------------------- extras (cape, scarf, pack, banner)
  function buildExtra(ctx, H, chest, head) {
    const { P, bp, sci } = H;
    const [W, Ht, D] = P.chest;
    const type = bp.extra;
    if (type === 'scarf' || type === 'cape') {
      // neck wrap
      chest.box(W * 0.62, 3, D * 0.8, { at: [0, Ht - 0.2, 0.4], mat: 'tertiary', bevel: 1, bevelSet: 'round' });
    }
    if (type === 'scarf') {
      const t1 = chest.child('scarf1', [W * 0.2, Ht - 0.5, -D / 2 - 0.5], [-1.05, 0.25, 0]);
      t1.box(4, 1, 8, { at: [0, 0, -3.6], mat: 'tertiary', bevel: 0.3 });
      const t2 = t1.child('scarf2', [0, 0, -7.4], [-0.35, 0, 0]);
      t2.box(3.2, 1.2, 7, { at: [0, 0, -3.2], mat: 'tertiary', cuts: [[1, 0, -1, 1.2], [-1, 0, -1, 1.2]] });
      H.flow.push({ n: 'scarf1', base: -1.05, amp: 0.08, walk: 0.55, ph: 0, lean: true }, { n: 'scarf2', base: -0.3, amp: 0.2, walk: 0.1, ph: 0.8 });
    } else if (type === 'cape') {
      const len = P.aY + P.thigh + P.shin * 0.5 + Ht * 0.7;
      const c1 = chest.child('cape1', [0, Ht - 1, -D / 2 - 0.6], [0.1, 0, 0]);
      c1.box(W * 0.95, len * 0.55, 1.2, { at: [0, -len * 0.27, 0], mat: 'secondary', cuts: [[1, 1, 0, 1.5], [-1, 1, 0, 1.5]] });
      const c2 = c1.child('cape2', [0, -len * 0.54, 0], [0.05, 0, 0]);
      c2.box(W * 1.05, len * 0.5, 1.2, { at: [0, -len * 0.24, 0], mat: 'secondary', cuts: [[1, -1, 0, 1], [-1, -1, 0, 1]], detail: { type: 'band', face: '-z', at: -len * 0.2, size: 0.8, mat2: 'tertiary' } });
      H.flow.push({ n: 'cape1', base: 0.1, amp: 0.04, walk: 0.35, ph: 0, lean: true }, { n: 'cape2', base: 0.05, amp: 0.06, walk: 0.25, ph: 0.9 });
    } else if (type === 'backpack') {
      const bk = chest.child('pack', [0, Ht * 0.55, -D / 2]);
      if (sci) {
        bk.box(W * 0.78, Ht * 0.85, 5, { at: [0, 0, -2.4], mat: 'primary', bevel: 1.2, detail: [{ type: 'vent', face: '-z', pitch: 2, inset: 2 }, { type: 'bolts', face: '-z', inset: 1.2 }] });
        for (const s of [-1, 1]) {
          bk.cyl('y', 1.9, 7, { at: [s * W * 0.26, Ht * 0.5, -3.2], mat: 'metal', sides: 8 });
          bk.cyl('y', 1.2, 0.8, { at: [s * W * 0.26, Ht * 0.5 + 3.8, -3.2], mat: 'accent', sides: 8, shadow: false });
        }
      } else {
        bk.box(W * 0.7, Ht * 0.75, 4.5, { at: [0, -0.5, -2.2], mat: 'leather', bevel: 1.2, detail: { type: 'band', face: '-z', dir: 'v', at: 0, size: 0.7, mat2: 'metal' } });
        bk.cyl('x', 2.4, W * 0.9, { at: [0, Ht * 0.45, -2.4], mat: 'tertiary', sides: 8, detail: { type: 'band', dir: 'v', at: W * 0.25, size: 0.5, mat2: 'leather' } });
        bk.cyl('y', 1.8, 2.6, { at: [W * 0.3, -Ht * 0.3, -4.6], mat: 'metal', sides: 8 });
      }
    } else if (type === 'tanks') {
      const tk = chest.child('tanks', [0, Ht * 0.45, -D / 2]);
      tk.box(W * 0.7, 3, 3, { at: [0, -Ht * 0.25, -1.2], mat: 'metal', bevel: 0.6 });
      for (const s of [-1, 1]) {
        if (sci) {
          tk.cyl('y', 3, Ht * 0.95, { at: [s * W * 0.2, 1, -3.4], mat: 'secondary', sides: 8, twist: PI / 8, detail: [{ type: 'band', at: Ht * 0.2, size: 0.8, mat2: 'tertiary' }, { type: 'band', at: -Ht * 0.2, size: 0.8, mat2: 'tertiary' }] });
          tk.cone('y', 3, 1.4, 2, { at: [s * W * 0.2, Ht * 0.5 + 2, -3.4], mat: 'metal', sides: 8, twist: PI / 8 });
        } else {
          tk.cyl('y', 3.4, Ht * 0.8, { at: [s * W * 0.2, 0, -3.6], mat: 'leather', sides: 8, twist: PI / 8, detail: [{ type: 'band', at: Ht * 0.25, size: 0.7, mat2: 'secondary' }, { type: 'band', at: -Ht * 0.25, size: 0.7, mat2: 'secondary' }] });
        }
      }
      tk.box(1.6, 1.6, 1.6, { at: [W * 0.2, Ht * 0.5 + 3.4, -3.4], mat: 'accent', shadow: false });
      tk.cyl('x', 1, W * 0.5, { at: [0, -Ht * 0.3, -3.8], mat: 'metal', sides: 6 });
    } else if (type === 'banner') {
      const bn = chest.child('banner', [W * 0.2, Ht * 0.4, -D / 2 - 1.2]);
      const hgt = Ht + P.head + 10;
      bn.cyl('y', 0.6, hgt, { at: [0, hgt / 2 - 2, 0], mat: sci ? 'metal' : 'leather', sides: 6 });
      bn.box(W * 0.7, 1, 1, { at: [-W * 0.3, hgt - 2.5, 0], mat: sci ? 'metal' : 'leather' });
      const fl = bn.child('flag', [-W * 0.3, hgt - 3, 0]);
      fl.box(W * 0.6, 12, 0.8, { at: [0, -6, 0], mat: 'tertiary', cuts: [[0, -1, 0, 0]], detail: [{ type: 'band', face: '-z', at: 3, size: 1.2, mat2: 'secondary' }, { type: 'band', face: '+z', at: 3, size: 1.2, mat2: 'secondary' }] });
      fl.box(W * 0.3, 3, 0.8, { at: [-W * 0.15, -13.2, 0], mat: 'tertiary', cuts: [[1, -1, 0, 1.5]] });
      fl.box(W * 0.3, 3, 0.8, { at: [W * 0.15, -13.2, 0], mat: 'tertiary', cuts: [[-1, -1, 0, 1.5]] });
      if (sci) bn.box(2, 2, 2, { at: [0, hgt - 1.2, 0], mat: 'accent', shadow: false });
      else bn.cone('y', 1, 0.2, 2.5, { at: [0, hgt - 0.3, 0], mat: 'metal', sides: 4 });
      H.flow.push({ n: 'flag', base: 0, amp: 0.05, walk: 0.3, ph: 0.3 });
    }
  }

  // ------------------------------------------------------------- weapons
  // Each weapon: { label, hands, attack, decay, build(ctx, grip, side, type, H) -> { pose(st, n, H, s, f) } }
  // Weapon-local frame at the fist centre: +z points to the business end, +y is the "top".
  // pose() writes hand targets into H.tgt[side] = { p: [x,y,z] chest-space design px, rot: chest-space Euler } and
  // body offsets into H.fx; f is the attack progress (1 on trigger decaying to 0; 0 when this hand is not attacking).
  function muzzle(grip, s, at, kind) {
    const mz = grip.child('mz' + s, at, [-PI / 2, 0, 0]);
    mz.startHidden = true;
    MF.Gen.parts.muzzleFlash(mz, kind);
    return 'mz' + s;
  }
  const flick = (st) => ((Math.floor((st.t || 0) * 24) & 1) === 0);

  // generic rest & guard spots in chest space
  const hipSpot = (H, s, dz = 0) => [H.sh[s][0] * 0.78, -H.P.chest[1] * 0.12, H.P.chest[2] * 0.5 + 2 + dz];
  const levelRx = (H) => -(H.P.lean);

  const HUMAN_WEAPONS = {
    dagger: {
      label: 'Dagger / energy knife', hands: 1, attack: true, decay: 2.6,
      build(ctx, grip, s, type, H) {
        const sci = H.sci, L = 10;
        grip.box(1.3, 1.3, 5, { at: [0, 0, -0.3], mat: sci ? 'metal' : 'leather' });
        grip.box(1.8, 1.8, 1.4, { at: [0, 0, -2.9], mat: 'metal', bevel: 0.4 });
        if (sci) {
          grip.box(1.8, 3, 1.4, { at: [0, 0.2, 2.6], mat: 'metal', bevel: 0.4 });
          grip.box(0.8, 2.2, L + 2, { at: [0, 0.3, 3.2 + (L + 2) / 2], mat: 'accent', shadow: false, cuts: [[0, 1, 1, 2], [0, -1, 1, 0.8]] });
        } else {
          grip.box(1, 3.8, 1, { at: [0, 0, 2.4], mat: 'metal' });
          grip.box(1, 2.4, L, { at: [0, 0.2, 2.8 + L / 2], mat: 'metal', cuts: [[0, 1, 1, 2], [0, -1, 1, 0.6]], detail: { type: 'panel', face: 'side', at: 0.2, dir: 'h' } });
        }
        return {
          pose(st, n, H, s, f) {
            const P = H.P, m = Math.min(1, st.move);
            const bob = Math.sin(st.phase * 2 + (s > 0 ? 1 : 0)) * 0.6 * m;
            const rest = [H.sh[s][0] * 1.05, -1 + bob, P.chest[2] * 0.5 + 2];
            const restD = [s * 0.55, -0.65, -0.5];
            let p = rest, d = restD;
            if (f > 0) { // wind the knife up behind the shoulder, then rip it down across the body
              const u = 1 - f;
              const k1 = ease(seg(u, 0, 0.2)), k2 = ease(seg(u, 0.2, 0.4)), k3 = ease(seg(u, 0.7, 1));
              const wind = [H.sh[s][0] * 1.35, H.sh[s][1] + P.U * 0.9, -2], windD = [s * 0.4, 0.8, -0.5];
              const hit = [-s * P.chest[0] * 0.35, -1, P.chest[2] * 0.5 + P.F + 3], hitD = [-s * 0.8, -0.55, 0.3];
              p = mix3(mix3(mix3(rest, wind, k1), hit, k2), rest, k3);
              d = mix3(mix3(mix3(restD, windD, k1), hitD, k2), restD, k3);
              const a = k1 * (1 - k2) - k2 * (1 - k3);
              H.fx.twist += s * 0.45 * a;
              H.fx.lean += 0.3 * k2 * (1 - k3) - 0.1 * k1 * (1 - k2);
              H.fx.crouch += 0.2 * k2 * (1 - k3);
            } else if (st.fire > 0) { // off hand tucks into a guard while the other knife strikes
              const g = Math.sin(clamp(1 - st.fire, 0, 1) * PI);
              p = mix3(rest, [H.sh[s][0] * 0.55, H.sh[s][1] - P.U * 0.6, P.chest[2] * 0.5 + 4], g);
              d = mix3(restD, [s * 0.2, 0.2, 1], g);
            }
            H.tgt[s] = { p, rot: aim(d, s * 0.6) };
          },
        };
      },
    },

    sword: {
      label: 'Sword / power sword', hands: 1, attack: true, decay: 2.4,
      build(ctx, grip, s, type, H) {
        const sci = H.sci, L = 15;
        grip.box(1.4, 1.4, 5, { at: [0, 0, -0.5], mat: 'leather' });
        grip.box(2, 2, 1.6, { at: [0, 0, -3.4], mat: 'secondary', bevel: 0.5 });
        grip.box(1.4, 6, 1.4, { at: [0, 0, 2.6], mat: 'secondary', bevel: 0.3 });
        grip.box(1, 2.6, L, { at: [0, 0, 3.2 + L / 2], mat: 'metal', cuts: [[0, 1, 1, 1.4], [0, -1, 1, 1.4]], detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
        if (sci) grip.box(1.2, 0.8, L - 1, { at: [0, -1.1, 3.2 + L / 2], mat: 'accent', shadow: false, cuts: [[0, 0, 1, 0.8]] });
        return {
          pose(st, n, H, s, f) {
            const P = H.P;
            const rest = [H.sh[s][0] * 0.9, -0.5, P.chest[2] * 0.5 + 3];
            const restD = [s * 0.25, 0.55, 0.8];
            let p = rest, d = restD;
            if (f > 0) {
              const u = 1 - f;
              const k1 = ease(seg(u, 0, 0.2)), k2 = ease(seg(u, 0.2, 0.42)), k3 = ease(seg(u, 0.72, 1));
              const wind = [H.sh[s][0] * 0.8, H.sh[s][1] + 5, 0], windD = [s * 0.3, 0.4, -1];
              const hit = [-s * 1, 0, P.chest[2] * 0.5 + 7], hitD = [-s * 0.3, -0.6, 0.75];
              p = mix3(mix3(mix3(rest, wind, k1), hit, k2), rest, k3);
              d = mix3(mix3(mix3(restD, windD, k1), hitD, k2), restD, k3);
              H.fx.twist += s * 0.3 * (k1 * (1 - k2) - k2 * (1 - k3));
              H.fx.lean += 0.2 * k2 * (1 - k3) - 0.1 * k1 * (1 - k2);
            }
            H.tgt[s] = { p, rot: aim(d, -s * 0.3) };
          },
        };
      },
    },

    pistol: {
      label: 'Pistol / flintlock', hands: 1, attack: true, decay: 4,
      build(ctx, grip, s, type, H) {
        const sci = H.sci;
        grip.box(1.6, 4, 2, { at: [0, -0.6, -0.4], rot: [0.25, 0, 0], mat: sci ? 'metal' : 'leather' });
        if (sci) {
          grip.box(2.6, 3.2, 8, { at: [0, 2.4, 2.2], mat: 'primary', bevel: 0.6, detail: { type: 'panel', face: 'side', at: 0, dir: 'v' } });
          grip.box(1.8, 1.8, 3, { at: [0, 2.6, 7.2], mat: 'metal' });
        } else {
          grip.box(2, 2.4, 5, { at: [0, 1.8, 1.2], mat: 'metal' });
          grip.cyl('z', 0.9, 7, { at: [0, 2.4, 6], mat: 'metal', sides: 6 });
          grip.cone('z', 0.9, 1.4, 1.4, { at: [0, 2.4, 9.8], mat: 'metal', sides: 6 });
        }
        const mzn = muzzle(grip, s, [0, 2.5, sci ? 8.8 : 10.6], 'flash');
        return {
          pose(st, n, H, s, f) {
            const P = H.P;
            const rest = [H.sh[s][0] * 1.05, -0.5, P.chest[2] * 0.5 + 1];
            let p = rest, d = [s * 0.1, -0.8, 0.6];
            if (f > 0) {
              const u = 1 - f, up = ease(seg(u, 0, 0.12)) * (1 - ease(seg(u, 0.75, 1)));
              const aimP = [H.sh[s][0] * 0.55, H.sh[s][1] - 1, P.U + P.F * 0.9];
              const kick = Math.max(0, 1 - Math.abs(u - 0.2) * 6);
              p = mix3(rest, aimP, up); p[1] += kick * 1.2; p[2] -= kick * 1.2;
              d = mix3(d, [0, Math.sin(-levelRx(H)) + kick * 0.3, 1], up);
              n[mzn].hidden = !(u > 0.12 && u < 0.3);
              H.fx.twist += -s * 0.25 * up;
            }
            H.tgt[s] = { p, rot: aim(d, 0) };
          },
        };
      },
    },

    shield: {
      label: 'Shield', hands: 1, attack: false, decay: 3,
      build(ctx, grip, s, type, H) {
        const sci = H.sci;
        const sw = 11, sh = 15;
        grip.box(2, 2, 2, { at: [0, 0, 1], mat: 'metal' });
        if (sci) {
          grip.box(sw, sh, 1.8, { at: [0, -1, 2.4], mat: 'primary', bevel: 1, cuts: [[1, -1, 0, 3], [-1, -1, 0, 3]], detail: [{ type: 'band', face: '+z', at: sh * 0.25, size: 1, mat2: 'secondary' }, { type: 'bolts', face: '+z', inset: 1.6 }] });
          grip.box(sw * 0.3, sh * 0.35, 1, { at: [0, 0, 3.6], mat: 'secondary', bevel: 0.5, detail: { type: 'light', face: '+z', pts: [[0, 0]], size: 0.8 } });
        } else {
          grip.box(sw, sh, 1.6, { at: [0, -1, 2.3], mat: 'primary', cuts: [[1, -1, 0, sw * 0.45], [-1, -1, 0, sw * 0.45], [1, 1, 0, 1], [-1, 1, 0, 1]], detail: [{ type: 'band', face: '+z', dir: 'v', at: 0, size: 1.2, mat2: 'tertiary' }, { type: 'band', face: '+z', at: sh * 0.12, size: 1.2, mat2: 'tertiary' }] });
          grip.box(sw + 0.6, 1.2, 2, { at: [0, sh / 2 - 1.4, 2.2], mat: 'metal' });
          grip.cyl('z', 1.6, 1.4, { at: [0, 0, 3.6], mat: 'metal', sides: 8 });
        }
        return {
          pose(st, n, H, s, f) {
            const P = H.P;
            let p = [H.sh[s][0] * 0.75, P.chest[1] * 0.35, P.chest[2] * 0.5 + 4];
            if (f > 0) { const u = 1 - f, b = ease(seg(u, 0, 0.25)) * (1 - ease(seg(u, 0.6, 1))); p = [p[0] * (1 - b * 0.5), p[1] + b, p[2] + b * 5]; H.fx.lean += 0.15 * b; }
            H.tgt[s] = { p, rot: aim([s * 0.35, Math.sin(-levelRx(H)), 1], 0) };
          },
        };
      },
    },

    mg: {
      label: 'Machine gun / gatling blunderbuss', hands: 2, attack: true, decay: 4,
      build(ctx, grip, s, type, H) {
        const sci = H.sci;
        let tip;
        grip.box(1.8, 4.2, 2.2, { at: [0, -0.4, -0.3], rot: [0.3, 0, 0], mat: sci ? 'metal' : 'leather' });
        if (sci) { // heavy bolter-ish: chunky receiver, drum, shroud
          grip.box(4.2, 5.6, 12, { at: [0, 3.6, 1.8], mat: 'primary', bevel: 1, detail: [{ type: 'panel', face: 'side', at: 1, dir: 'v' }, { type: 'bolts', face: 'side', inset: 1.1 }] });
          grip.box(3.4, 3.8, 5, { at: [0, 3.2, -6], mat: 'metal', bevel: 0.8, cuts: [[0, -1, -1, 2]] });
          grip.box(3.6, 3.6, 7, { at: [0, 4, 11], mat: 'metal', bevel: 0.6, detail: { type: 'vent', face: 'side', pitch: 1.5, inset: 0.6 } });
          grip.cyl('z', 1.2, 4, { at: [0, 4, 16], mat: 'metal', sides: 6 });
          grip.box(3, 3, 2, { at: [0, 4, 18.6], mat: 'metal', bevel: 0.5 });
          grip.cyl('x', 3.4, 3.2, { at: [0, 0.4, 5], mat: 'secondary', sides: 8, detail: { type: 'bolts', face: 'side', inset: 1.4 } });
          grip.box(1, 1.8, 5, { at: [0, 7.2, 1.5], mat: 'metal' });
          grip.box(1.8, 3, 2, { at: [0, 1, 10.5], mat: 'metal' });
          tip = [0, 4, 19.8];
        } else { // gatling blunderbuss: wooden stock, brass housing, spinning flared barrels, hopper
          grip.box(2.8, 3.6, 8, { at: [0, 2, -5], mat: 'leather', bevel: 0.8, cuts: [[0, -1, -1, 2]] });
          grip.cyl('z', 3.2, 6, { at: [0, 3.6, 2.8], mat: 'secondary', sides: 8, detail: { type: 'band', dir: 'h', at: 0, size: 0.5 } });
          grip.box(3.2, 3.6, 3.6, { at: [0, 7.6, 1.8], mat: 'leather', bevel: 0.8 });
          const spin = grip.child('spin' + s, [0, 3.6, 6]);
          for (let i = 0; i < 6; i++) { const a = (i / 6) * PI * 2; spin.cyl('z', 0.8, 11, { at: [Math.cos(a) * 1.9, Math.sin(a) * 1.9, 5.5], mat: 'metal', sides: 6 }); }
          spin.cyl('z', 2.9, 1.4, { at: [0, 0, 4], mat: 'secondary', sides: 8 });
          spin.cone('z', 2.8, 3.8, 2.4, { at: [0, 0, 11.6], mat: 'metal', sides: 8 });
          grip.box(1, 1, 3, { at: [2.2, 3.6, 0.6], mat: 'metal' });
          grip.box(1.8, 3, 2, { at: [0, 1.2, 9], mat: 'leather' });
          tip = [0, 3.6, 19.4];
        }
        const mzn = muzzle(grip, s, tip, sci ? 'flash' : 'puff');
        const fore = (sci ? [0, 0.4, 10.5] : [0, 0.6, 9]).map((v) => v * H.P.ws);
        return {
          pose(st, n, H, s, f) {
            const P = H.P, m = Math.min(1, st.move);
            const bob = Math.sin(st.phase * 2) * 0.4 * m;
            let p = [s * P.chest[0] * 0.3, -P.chest[1] * 0.08 + bob, P.chest[2] * 0.5 + 1.8];
            let rx = levelRx(H) - P.walkLean * m + 0.04, ry = -s * 0.1;
            if (f > 0) {
              const on = f > 0.08;
              const j = on && flick(st) ? 1 : 0.4;
              p = [p[0], p[1] + 0.3 * j * f, p[2] - 1.6 * j * f];
              rx -= 0.07 * j * f;
              n[mzn].hidden = !(on && flick(st));
              if (n['spin' + s]) n['spin' + s].rot[2] = (st.t || 0) * 30;
              H.fx.lean -= 0.05 * f;
            }
            const rot = [rx, ry, 0];
            const R = eulerM(rot);
            const g2 = apply(R, fore);
            H.tgt[s] = { p, rot };
            H.tgt[-s] = { p: [p[0] + g2[0], p[1] + g2[1], p[2] + g2[2]] };
          },
        };
      },
    },

    rifle: {
      label: 'Long rifle / las-rifle', hands: 2, attack: true, decay: 2.6,
      build(ctx, grip, s, type, H) {
        const sci = H.sci;
        grip.box(1.6, 3.6, 2, { at: [0, -0.6, -0.2], rot: [0.3, 0, 0], mat: 'leather' });
        if (sci) { // las-rifle: armoured receiver, long barrel with glowing coils, big scope
          grip.box(2.8, 4, 12, { at: [0, 2.6, 3], mat: 'primary', bevel: 0.7, detail: { type: 'panel', face: 'side', at: 0, dir: 'v' } });
          grip.box(2.4, 3.6, 7, { at: [0, 2.2, -6.5], mat: 'metal', bevel: 0.6, cuts: [[0, -1, -1, 2.2]] });
          grip.cyl('z', 0.8, 16, { at: [0, 3, 17], mat: 'metal', sides: 6 });
          for (const z of [11, 14]) grip.cyl('z', 1.5, 1, { at: [0, 3, z], mat: 'accent', sides: 8, shadow: false });
          grip.box(2, 2, 3, { at: [0, 3, 25], mat: 'metal', bevel: 0.4 });
          grip.cyl('z', 1.2, 7, { at: [0, 5.8, 2], mat: 'metal', sides: 8 });
          grip.cyl('z', 1.3, 0.6, { at: [0, 5.8, 5.6], mat: 'glass', sides: 8 });
        } else { // long musket: wooden stock, iron barrel, brass bands
          grip.box(2.4, 3.8, 11, { at: [0, 1.6, -6], mat: 'leather', bevel: 0.7, cuts: [[0, -1, -1, 2.6], [0, 1, -1, 0.8]] });
          grip.box(2.2, 2.6, 16, { at: [0, 2.4, 7], mat: 'leather', bevel: 0.5 });
          grip.cyl('z', 0.8, 22, { at: [0, 3.2, 12], mat: 'metal', sides: 6 });
          for (const z of [4, 10, 14]) grip.box(2.6, 3, 0.8, { at: [0, 2.6, z], mat: 'secondary' });
          grip.box(1.2, 2.2, 3, { at: [0, 3.8, 1], mat: 'metal' });
        }
        const mzn = muzzle(grip, s, [0, sci ? 3 : 3.2, sci ? 26.6 : 23.2], sci ? 'beam' : 'flash');
        const ws = H.P.ws, fore = [0, 1.2 * ws, 10 * ws];
        return {
          pose(st, n, H, s, f) {
            const P = H.P, m = Math.min(1, st.move);
            let up = 0, kick = 0;
            if (f > 0) {
              const u = 1 - f;
              up = ease(seg(u, 0, 0.16)) * (1 - ease(seg(u, 0.78, 1)));
              kick = u > 0.2 ? Math.max(0, 1 - (u - 0.2) * 5) : 0;
              n[mzn].hidden = !(u > 0.2 && u < 0.34);
              H.fx.twist += s * 0.3 * up;
            }
            const pitch = P.lean + P.walkLean * m + H.fx.lean;
            const low = [H.sh[s][0] * 0.35, P.chest[1] * 0.1 + Math.sin(st.phase * 2) * 0.4 * m, P.chest[2] * 0.5 + 1.5];
            const aimP = [H.sh[s][0] * 0.4, H.sh[s][1] + 0.6, P.chest[2] * 0.5 - 0.5];
            const p = mix3(low, aimP, up);
            p[2] -= kick * 1.5; p[1] += kick * 0.4;
            const th = lerp(-0.3, 0.02 + kick * 0.18, up) + pitch;
            const rot = aim([lerp(-s * 0.35, -s * 0.05, up), Math.sin(th), Math.cos(th)], 0);
            const g2 = apply(eulerM(rot), fore);
            H.tgt[s] = { p, rot };
            H.tgt[-s] = { p: [p[0] + g2[0], p[1] + g2[1], p[2] + g2[2]] };
          },
        };
      },
    },

    flamer: {
      label: 'Flamer / dragon-breath lance', hands: 2, attack: true, decay: 2,
      build(ctx, grip, s, type, H) {
        const sci = H.sci;
        grip.box(1.8, 4, 2.2, { at: [0, -0.4, -0.3], rot: [0.3, 0, 0], mat: sci ? 'metal' : 'leather' });
        if (sci) {
          grip.box(3.6, 4.6, 9, { at: [0, 3, 1], mat: 'primary', bevel: 0.9, detail: { type: 'bolts', face: 'side', inset: 1 } });
          grip.cyl('z', 2.6, 8, { at: [0, -0.2, 5], mat: 'secondary', sides: 8, detail: { type: 'band', dir: 'h', at: 0, size: 0.7 } });
          grip.cyl('z', 1.3, 8, { at: [0, 3.4, 9], mat: 'metal', sides: 6 });
          grip.cone('z', 1.6, 2.8, 3, { at: [0, 3.4, 14.4], mat: 'metal', sides: 8 });
          grip.box(1.2, 1.2, 1.4, { at: [0, 1.4, 15], mat: 'accent', shadow: false });
        } else { // brass fire-lance with a snarling drake-mouth nozzle and a bellows keg
          grip.box(2.6, 3.4, 8, { at: [0, 2.2, -4], mat: 'leather', bevel: 0.7 });
          grip.cyl('z', 2.8, 6, { at: [0, 0, 4], mat: 'leather', sides: 8, detail: { type: 'band', dir: 'h', at: 0, size: 0.6, mat2: 'secondary' } });
          grip.cyl('z', 1.2, 10, { at: [0, 3.2, 8], mat: 'secondary', sides: 6 });
          grip.box(3.4, 3.6, 4.4, { at: [0, 3.4, 14.4], mat: 'secondary', bevel: 0.8, cuts: [[0, 1, 1, 1.6]], detail: { type: 'light', face: 'side', pts: [[1, 0.8]], size: 0.5 } });
          grip.box(1, 1, 1, { at: [0, 2, 16.8], mat: 'accent', shadow: false });
        }
        const mzn = muzzle(grip, s, [0, sci ? 3.4 : 3, sci ? 16.2 : 17], 'flame');
        const fore = [0, 0.4 * H.P.ws, 7.5 * H.P.ws];
        return {
          pose(st, n, H, s, f) {
            const P = H.P, m = Math.min(1, st.move);
            let p = [s * P.chest[0] * 0.3, -P.chest[1] * 0.06 + Math.sin(st.phase * 2) * 0.4 * m, P.chest[2] * 0.5 + 2];
            let rx = levelRx(H) - P.walkLean * m + 0.06, ry = -s * 0.1;
            n[mzn].hidden = !(f > 0.12);
            if (f > 0.12) {
              const sweep = Math.sin((1 - f) * 7) * 0.18; // hose the area
              ry += sweep; rx += 0.05; p = [p[0], p[1] + 0.5, p[2] - 0.6];
              n[mzn].pos[1] += (flick(st) ? 0.6 : -0.4) * ctx.k;
              H.fx.twist += sweep * 0.5;
            }
            const rot = [rx, ry, 0];
            const g2 = apply(eulerM(rot), fore);
            H.tgt[s] = { p, rot };
            H.tgt[-s] = { p: [p[0] + g2[0], p[1] + g2[1], p[2] + g2[2]] };
          },
        };
      },
    },

    greatsword: {
      label: 'Greatsword / chainsword', hands: 2, attack: true, decay: 2.2,
      build(ctx, grip, s, type, H) {
        const sci = H.sci, ws = H.P.ws;
        const fs = H.P.fist / ws;                    // fist size in weapon units
        const g2 = -(fs + 0.6);                       // second hand along the grip
        const L = Math.round(33 * (H.P.blade || 1));   // blade length (weapon units)
        grip.box(1.8, 1.8, fs * 2 + 2.5, { at: [0, 0, g2 / 2], mat: 'leather' });
        grip.box(2.8, 2.8, 2.4, { at: [0, 0, g2 - fs * 0.5 - 1.4], mat: sci ? 'metal' : 'secondary', bevel: 0.7 });
        if (sci) { // chainsword: motor housing, toothed chain bar, glowing runes
          grip.box(4.4, 7, 7, { at: [0, -0.8, fs * 0.5 + 3.4], mat: 'primary', bevel: 1, detail: [{ type: 'vent', face: 'side', pitch: 1.5, inset: 1 }] });
          grip.box(2.4, 6.4, L, { at: [0, -0.4, fs * 0.5 + 6 + L / 2], mat: 'primary', bevel: 0.6, cuts: [[0, 1, 1, 3], [0, -1, 1, 2]], detail: [{ type: 'light', face: 'side', pts: [[-L * 0.3, 1], [-L * 0.1, 1], [L * 0.1, 1]], size: 0.6 }, { type: 'band', face: 'side', at: 1.8, size: 0.6, mat2: 'secondary' }] });
          grip.box(1.6, 1.8, L + 1.5, { at: [0, -4.2, fs * 0.5 + 6 + L / 2], mat: 'metal', cuts: [[0, -1, 1, 1.2]], detail: { type: 'tread', face: 'side', axis: 'u' } });
          grip.box(1.6, 1.8, L * 0.9, { at: [0, 3.1, fs * 0.5 + 6 + L * 0.47], mat: 'metal', detail: { type: 'tread', face: 'side', axis: 'u' } });
          grip.cyl('y', 1, 4, { at: [0, 4.2, fs * 0.5 + 1.8], mat: 'metal', sides: 6 });
        } else { // greatsword: crossguard, ricasso, long fullered blade
          grip.box(1.8, 12, 1.8, { at: [0, 0, fs * 0.5 + 1.4], mat: 'secondary', bevel: 0.4, cuts: [[0, 1, 1, 0.8], [0, -1, 1, 0.8]] });
          grip.box(1.2, 3.2, 3, { at: [0, 0, fs * 0.5 + 3.8], mat: 'metal' });
          grip.box(1.2, 5, L, { at: [0, 0, fs * 0.5 + 5.2 + L / 2], mat: 'metal', cuts: [[0, 1, 1, 2.6], [0, -1, 1, 2.6]], detail: { type: 'panel', face: 'side', at: 0, dir: 'h' } });
        }
        return {
          pose(st, n, H, s, f) {
            const P = H.P, m = Math.min(1, st.move);
            const shs = H.sh[s];
            // rest: grip in front of the chest, blade over the shoulder (angle th: 0 = forward, PI/2 = up, PI = back)
            // th is the blade's pitch in world terms (0 forward, PI/2 up, PI back); chest pitch is added below
            let rest = { p: [shs[0] * 0.55, P.chest[1] * 0.45 + Math.sin(st.phase * 2) * 0.5 * m, P.chest[2] * 0.5 + 2.5], th: 2.42, lat: s * 0.3, roll: -s * 1.2 };
            if (!H.sd) { // non-SD: held low in both hands, point resting just above the ground ahead
              const p = [shs[0] * 0.3, -P.chest[1] * 0.02 + Math.sin(st.phase * 2) * 0.3 * m, P.chest[2] * 0.5 + 2.5];
              const L0 = P.lean + P.walkLean * m;
              const gy = P.hipY + 1.5 + p[1] * Math.cos(L0) - p[2] * Math.sin(L0);
              const reach = P.fist * 0.5 + (5.2 + L) * ws, lat = -s * 0.28;
              const th = Math.asin(clamp(-(gy - 1.5) / reach * Math.hypot(1, lat), -0.98, 0));
              rest = { p, th, lat, roll: -s * 1.55 };
            }
            const wind = { p: [shs[0] * 0.15, shs[1] + P.U * 0.6, -1], th: 2.95, lat: s * 0.1, roll: -s * 1.4 };
            const hit = { p: [-shs[0] * 0.05, -P.chest[1] * 0.1, P.chest[2] * 0.5 + P.F + 2], th: -0.3, lat: -s * 0.05, roll: -s * 1.5 };
            let k = rest;
            if (f > 0) {
              const u = 1 - f;
              const k1 = ease(seg(u, 0, 0.24)), k2 = seg(u, 0.24, 0.42), k3 = ease(seg(u, 0.74, 1));
              const lerpK = (a, b, t) => ({ p: mix3(a.p, b.p, t), th: lerp(a.th, b.th, t), lat: lerp(a.lat, b.lat, t), roll: lerp(a.roll, b.roll, t) });
              const k2e = k2 * k2 * (2 - k2);
              k = lerpK(lerpK(lerpK(rest, wind, k1), hit, k2e), rest, k3);
              H.fx.lean += -0.22 * k1 * (1 - k2) + 0.4 * k2e * (1 - k3);
              H.fx.crouch += -0.05 * k1 * (1 - k2) + 0.28 * k2e * (1 - k3);
              H.fx.twist += s * 0.25 * k1 * (1 - k2) - s * 0.15 * k2e * (1 - k3);
              H.fx.headPitch += 0.2 * k2e * (1 - k3);
            }
            const th = k.th + P.lean + P.walkLean * m + H.fx.lean;
            const d = [k.lat, Math.sin(th), Math.cos(th)];
            const rot = aim(d, k.roll);
            const R = eulerM(rot);
            const o = apply(R, [0, 0, g2 * ws]);
            H.tgt[s] = { p: k.p, rot };
            H.tgt[-s] = { p: [k.p[0] + o[0], k.p[1] + o[1], k.p[2] + o[2]] };
          },
        };
      },
    },
  };

  // ------------------------------------------------------------- build
  const W_OPTS_R = Object.keys(HUMAN_WEAPONS).concat(['none']).filter((k) => k !== 'shield');
  const W_OPTS_L = Object.keys(HUMAN_WEAPONS).filter((k) => HUMAN_WEAPONS[k].hands === 1).concat(['none']);
  const W_LBL = { none: 'None' };
  for (const k in HUMAN_WEAPONS) W_LBL[k] = HUMAN_WEAPONS[k].label;

  // derive a role's proportions for a non-SD style and rescale lengths so the body reaches the style's target height
  function styledRole(b, S, role) {
    const P = Object.assign({}, b);
    P.head = b.head * S.head; P.headDrop = b.headDrop * S.head - S.neck; P.headZ = b.headZ * S.headZ + (S.headZAdd || 0);
    P.thigh = b.thigh * S.legs; P.shin = b.shin * S.legs; P.legW = b.legW * S.legW; P.hipX = b.hipX * S.legW;
    P.boot = b.boot.map((v) => v * S.boot); P.aY = b.aY * Math.max(0.85, S.boot);
    const bw0 = b.body === 'brute' ? S.bruteW || 1 : 1;
    P.chest = [b.chest[0] * S.chestW * bw0, b.chest[1] * S.torso, b.chest[2] * S.chestD * bw0];
    P.shX = b.shX * S.chestW * S.shX * bw0; P.U = b.U * S.U; P.F = b.F * S.F; P.aw = b.aw * S.aw; P.fist = b.fist * S.fist;
    P.padScale = b.padScale * S.pads * (b.body === 'brute' ? 0.85 : 1); P.ws = b.ws * S.ws; P.lean = b.lean * S.lean + (S.leanAdd || 0); P.crouch = b.crouch.map((v) => v * S.crouch);
    P.swing = b.swing * S.swing; P.lift = b.lift * S.lift; P.armSwing = b.armSwing * S.armSwing; P.walkCrouch = b.walkCrouch * 0.6;
    P.waist = S.waist; P.taper = S.taper; P.fore = S.fore; P.bob = S.bob; P.blade = S.blade; P.sway = b.sway * 0.7; P.shRoll = b.shRoll * 0.7;
    // height: aY + legs + 1.5 + (Ht - headDrop) cos(lean) - headZ sin(lean) + head  ->  solve the length factor f
    const [a1, a2] = P.crouch, L = P.lean;
    const legs = P.thigh * Math.cos(a1) + P.shin * Math.cos(a1 + a2);
    const fixed = P.aY + 1.5 - P.headDrop * Math.cos(L) - P.headZ * Math.sin(L) + P.head * 0.95;
    const f = (S.H[role] - fixed) / (legs + P.chest[1] * Math.cos(L));
    P.thigh *= f; P.shin *= f; P.chest = [P.chest[0], P.chest[1] * f, P.chest[2]];
    P.U *= f; P.F *= f; P.shDrop = b.shDrop * (0.6 + 0.4 * f);
    return P;
  }

  function buildHuman(ctx) {
    const { bp } = ctx;
    const role = ROLES[bp.role] ? bp.role : 'soldier';
    const sci = bp.era === 'scifi';
    const style = STYLES[bp.style] ? bp.style : 'sd';
    const S = STYLES[style];
    const base = S ? styledRole(ROLES[role], S, role) : Object.assign({ waist: 1, taper: 1, fore: 1, bob: 1, blade: 1 }, ROLES[role]);
    const bulk = clamp(bp.bulk || 1, 0.6, 1.6), tall = clamp(bp.tall || 1, 0.6, 1.6), legLen = clamp(bp.legLen || 1, 0.6, 1.6), armLen = clamp(bp.armLen || 1, 0.6, 1.6);
    const bw = 1 + (bulk - 1) * 0.3, lw = 1 + (legLen - 1) * 0.3, tw = 1 + (tall - 1) * 0.25, aw = 1 + (armLen - 1) * 0.3;
    const P = Object.assign({}, base, {
      thigh: base.thigh * lw, shin: base.shin * lw, legW: base.legW * bw, hipX: base.hipX * bw,
      chest: [base.chest[0] * bw, base.chest[1] * tw, base.chest[2] * bw], shX: base.shX * bw, U: base.U * aw, F: base.F * aw, aw: base.aw * bw,
    });
    const H = { P, M: matsFor(role, sci ? 'scifi' : 'fantasy'), role, body: base.body, sci, era: sci ? 'scifi' : 'fantasy', bp, sh: {}, tgt: {}, fx: {}, flow: [], weapons: [], style, sd: !S, S: S || {} };
    const [W, Ht, D] = P.chest;
    for (const s of [-1, 1]) H.sh[s] = [s * P.shX, Ht - P.shDrop, 0];
    const pelvis = buildLegs(ctx, H);
    const chest = buildTorso(ctx, H, pelvis);
    const head = buildHead(ctx, H, chest);
    const arms = { [-1]: buildArm(ctx, H, chest, -1), [1]: buildArm(ctx, H, chest, 1) };
    buildShoulders(ctx, H, chest);
    buildExtra(ctx, H, chest, head);
    // weapons: right hand is side -1 (the unit faces +z, so its right is -x)
    let wr = HUMAN_WEAPONS[bp.weaponR] ? bp.weaponR : 'none';
    let wl = HUMAN_WEAPONS[bp.weaponL] ? bp.weaponL : 'none';
    if (wr !== 'none' && HUMAN_WEAPONS[wr].hands === 2) wl = 'none';
    if (wl !== 'none' && HUMAN_WEAPONS[wl].hands === 2) wl = 'none';
    let decay = 5;
    for (const [s, key] of [[-1, wr], [1, wl]]) {
      if (key === 'none') continue;
      const def = HUMAN_WEAPONS[key];
      // weapons are modelled in their own units and built at the role's weapon scale
      let ctl;
      MF.setBuildScale(ctx.k * P.ws);
      try { ctl = def.build(ctx, arms[s].grip, s, key, H); } finally { MF.setBuildScale(ctx.k); }
      H.weapons.push({ s, key, def, ctl });
      if (def.attack) decay = Math.min(decay, def.decay);
    }
    ctx.fireDecay = decay;
    ctx.gait = 'biped';
    ctx.anims.push(makeAnimator(ctx, H, arms));
  }

  // ------------------------------------------------------------- animation
  function makeAnimator(ctx, H, arms) {
    const P = H.P, k = ctx.k;
    const [a1, a2] = P.crouch;
    const attackers = H.weapons.filter((w) => w.def.attack);
    const twoHanded = H.weapons.some((w) => w.def.hands === 2);
    const pole = (s) => [s * 0.55, -0.15, -1];
    return (st, n) => {
      const m = clamp(st.move || 0, 0, 1.3), m1 = Math.min(1, m), ph = st.phase || 0, t = st.t || 0;
      const fire = clamp(st.fire || 0, 0, 1);
      const idle = 1 - m1;
      const breath = Math.sin(t * 2.3);
      const fx = H.fx; fx.twist = 0; fx.lean = 0; fx.crouch = 0; fx.headPitch = 0;
      // which hand attacks: alternate between two attacking weapons
      let active = null;
      if (attackers.length === 1) active = attackers[0].s;
      else if (attackers.length === 2) active = (st.fireN || 0) % 2 === 1 ? -1 : 1;
      H.tgt[-1] = null; H.tgt[1] = null;
      for (const w of H.weapons) w.ctl.pose(st, n, H, w.s, w.s === active ? fire : 0);
      // empty hands: hang and counter-swing
      for (const s of [-1, 1]) {
        if (H.tgt[s]) continue;
        const sw = Math.sin(s > 0 ? ph : ph + PI) * P.armSwing * m1;
        const reach = (P.U + arms[s].Feff) * 0.86;
        H.tgt[s] = { p: [H.sh[s][0] * 1.08, H.sh[s][1] - reach + Math.abs(sw) * 0.25 + breath * 0.2 * idle * P.bob, 1.2 + sw + P.lean * 4], wrist: [0, 0, 0] };
      }
      // legs: swing / lift, crouch keeps feet planted; pelvis height from the stance leg
      const c = fx.crouch + P.walkCrouch * m1 + breath * 0.018 * idle * P.bob;
      let V = 0;
      for (const s of [-1, 1]) {
        const p = s < 0 ? ph : ph + PI;
        const dh = -P.swing * Math.sin(p) * m;
        const dk = Math.max(0, Math.cos(p)) * P.lift * m;
        const h = a1 + dh - c, kn = a2 + dk + 2 * c;
        n['hip' + s].rot[0] = h;
        n['knee' + s].rot[0] = kn;
        n['ankle' + s].rot[0] = -(h + kn) + dk * 0.3;
        V = Math.max(V, P.thigh * Math.cos(h) + P.shin * Math.cos(h + kn));
      }
      n.pelvis.pos[1] = (P.aY + V) * k;
      n.pelvis.rot[1] = Math.sin(ph) * 0.1 * m1;
      n.pelvis.rot[2] = Math.sin(ph) * P.sway * m1 + Math.sin(t * 0.9) * 0.025 * idle * P.bob; // stride sway / idle weight shift
      const ch = n.chest;
      ch.rot[0] = P.lean + fx.lean + P.walkLean * m1 + breath * 0.02 * idle * P.bob;
      ch.rot[1] = -n.pelvis.rot[1] * (twoHanded ? 0.9 : 1.6) + fx.twist;
      ch.rot[2] = -n.pelvis.rot[2] * 0.6 + Math.sin(ph) * P.shRoll * m1;
      if (n.head) {
        n.head.rot[0] = -(P.lean + fx.lean + P.walkLean * m1) * 0.85 + fx.headPitch + breath * 0.02 * idle * P.bob;
        n.head.rot[1] = -fx.twist * 0.5 - ch.rot[1] * 0.3;
      }
      // arms via IK
      for (const s of [-1, 1]) {
        const a = arms[s], T = H.tgt[s];
        const sol = solveArm(H.sh[s], P.U, a.Feff, T.p, pole(s));
        const r = n['sh' + s].rot;
        r[0] = sol.rot[0]; r[1] = sol.rot[1]; r[2] = sol.rot[2];
        n['el' + s].rot[0] = -sol.bend;
        const g = n['grip' + s].rot;
        if (T.rot) { const e = toEuler(mulT(sol.hand, eulerM(T.rot))); g[0] = e[0]; g[1] = e[1]; g[2] = e[2]; }
        else if (T.wrist) { g[0] = T.wrist[0]; g[1] = T.wrist[1]; g[2] = T.wrist[2]; }
        const pad = n['pad' + s];
        if (pad) { pad.rot[0] = clamp(sol.rot[0], -1.6, 1.6) * 0.22; pad.rot[2] = clamp(sol.rot[2], -1.2, 1.2) * 0.3; }
      }
      // cloth
      for (const fl of H.flow) {
        const nd = n[fl.n];
        if (!nd) continue;
        nd.rot[0] = fl.base + Math.sin(t * 2.1 + fl.ph + ph) * fl.amp + fl.walk * m1 + Math.sin(ph * 2 + fl.ph) * 0.06 * m1 - (fl.lean ? fx.lean * 0.8 : 0);
      }
    };
  }

  // ------------------------------------------------------------- random + registration
  const ERA_DEFAULT = { rogue: 'fantasy', soldier: 'scifi', berserker: null, sniper: 'scifi', knight: 'fantasy', heavy: 'scifi' };
  let lastStyle = 'sd';
  // unlocked random style: SD only until the art director picks a direction (e.g. { sd: 2, grim: 1, dark: 1, real: 1 })
  const STYLE_WEIGHTS = { sd: 1 };
  function randomHuman(r, keep, bp) {
    bp.role = keep('role', () => r.weighted({ rogue: 3, soldier: 3, berserker: 3, sniper: 2, knight: 2, heavy: 2 }));
    const role = bp.role;
    bp.era = keep('era', () => (ERA_DEFAULT[role] ? (r.chance(0.72) ? ERA_DEFAULT[role] : ERA_DEFAULT[role] === 'scifi' ? 'fantasy' : 'scifi') : r.pick(['fantasy', 'scifi'])));
    const sci = bp.era === 'scifi';
    bp.head = keep('head', () => ({
      rogue: () => r.weighted({ hood: 8, bare: 1, visor: sci ? 1 : 0 }),
      soldier: () => r.weighted({ helm: 6, visor: 3, bare: 1 }),
      berserker: () => r.weighted({ horned: 6, bare: 3, helm: sci ? 1 : 0 }),
      sniper: () => r.weighted({ hood: 5, visor: 3, bare: 1, helm: 1 }),
      knight: () => r.weighted({ visor: 6, helm: 2, horned: 1 }),
      heavy: () => r.weighted({ helm: 4, visor: 4, horned: 1 }),
    })[role]());
    bp.shoulders = keep('shoulders', () => ({
      rogue: () => r.weighted({ none: 5, light: 2 }),
      soldier: () => r.weighted({ pauldrons: 7, spiked: 1 }),
      berserker: () => r.weighted({ fur: 7, spiked: 2 }),
      sniper: () => r.weighted({ light: 4, none: 3 }),
      knight: () => r.weighted({ pauldrons: 6, spiked: 1 }),
      heavy: () => r.weighted({ pauldrons: 5, spiked: 3 }),
    })[role]());
    bp.weaponR = keep('weaponR', () => ({
      rogue: () => r.weighted({ dagger: 8, sword: 1 }),
      soldier: () => r.weighted({ mg: 8, pistol: 1 }),
      berserker: () => r.weighted({ greatsword: 8, sword: 1 }),
      sniper: () => 'rifle',
      knight: () => r.weighted({ sword: 6, greatsword: 1 }),
      heavy: () => r.weighted({ flamer: 7, mg: 3 }),
    })[role]());
    bp.weaponL = keep('weaponL', () => {
      if (HUMAN_WEAPONS[bp.weaponR] && HUMAN_WEAPONS[bp.weaponR].hands === 2) return 'none';
      if (role === 'rogue') return 'dagger';
      if (role === 'soldier') return r.weighted({ shield: 1, pistol: 1, none: 1 });
      if (role === 'knight') return r.weighted({ shield: 8, dagger: 1 });
      if (role === 'sniper') return r.weighted({ pistol: 1, dagger: 1 });
      return r.weighted({ dagger: 1, sword: 1, shield: 1 });
    });
    bp.extra = keep('extra', () => ({
      rogue: () => r.weighted({ scarf: 6, cape: 3, none: 1 }),
      soldier: () => r.weighted({ backpack: 7, banner: 1, cape: 1 }),
      berserker: () => r.weighted({ none: 5, banner: 2, cape: 1 }),
      sniper: () => r.weighted({ cape: 5, scarf: 2, backpack: 1 }),
      knight: () => r.weighted({ cape: 6, banner: 2, none: 1 }),
      heavy: () => r.weighted({ tanks: 8, backpack: 1 }),
    })[role]());
    // style rolls from its own seed-derived RNG so every other roll (and old seeds) stay exactly as before
    bp.style = keep('style', () => new MF.RNG(((bp.seed || 1) ^ 0x5717e5) >>> 0).weighted(STYLE_WEIGHTS));
    lastStyle = bp.style;
  }

  const NAMES = {
    rogue: [['Vex', 'Nyx', 'Sable', 'Quill', 'Wren', 'Shade', 'Kestrel', 'Mirra', 'Rook', 'Silk'], ['the Quiet', 'Nightstep', 'Twofang', 'Ashveil', 'the Unseen', 'Knifewhisper', 'Duskrunner']],
    soldier: [['Sgt. Harlan', 'Cpl. Voss', 'Pvt. Brandt', 'Lt. Okoro', 'Sgt. Kade', 'Cpl. Reyes', 'Pvt. Muller', 'Sgt. Tamsin'], ['"Grit"', '"Hammer"', '"Dozer"', '"Lucky"', '"Rivets"', '"Chatter"', '"Bulldog"']],
    sniper: [['Kell', 'Ysolde', 'Marek', 'Vasha', 'Dorn', 'Ilse', 'Corvin'], ['Longshot', 'One-Eye', 'the Patient', 'Farsight', '"Ghost"', '"Deadeye"']],
    knight: [['Ser Aldric', 'Ser Maren', 'Dame Odile', 'Ser Gawen', 'Brother Tobias', 'Ser Hollis'], ['the Steadfast', 'of the Dawn', 'Ironwall', 'the Just', 'Lionheart', 'the Grey']],
    heavy: [['Cpl. Kruger', 'Sgt. Bram', 'Pvt. Ozzo', 'Sgt. Hild', 'Cpl. Magnus'], ['"Torch"', '"Cinders"', '"Smokey"', '"Furnace"', '"Blaze"']],
    berserker: [['Brakka', 'Ulfgar', 'Grom', 'Hrodgar', 'Skarn', 'Torvald', 'Vorga', 'Kaelos'], ['Skullsplitter', 'the Red', 'Oathbreaker', 'Bonegrinder', 'Ironhide', 'the Unchained', 'Wolfsblood']],
  };

  const slot = (key, label, options, labels) => ({ key, label, options, labels });
  MF.Gen.registerLine('human', {
    label: 'Human', group: 'Humans', weight: 3,
    slots: [
      slot('role', 'Role', OPT.role, LBL.role),
      slot('style', 'Style', OPT.style, LBL.style),
      slot('era', 'Era', OPT.era, LBL.era),
      slot('head', 'Head', OPT.head, LBL.head),
      slot('shoulders', 'Shoulders', OPT.shoulders, LBL.shoulders),
      slot('weaponR', 'Right hand', W_OPTS_R, W_LBL),
      slot('weaponL', 'Left hand', W_OPTS_L, W_LBL),
      slot('extra', 'Extra', OPT.extra, LBL.extra),
    ],
    random: randomHuman,
    build: buildHuman,
    palettes: HUMAN_PALS,
    sizeRange: [0.95, 1.05],
    name(r, bp) { const L = NAMES[bp.role] || NAMES.soldier; return `${r.pick(L[0])} ${r.pick(L[1])}`; },
  });

  // palette pool follows the style just rolled (randomBlueprint reads def.palettes right after def.random)
  Object.defineProperty(MF.Gen.LINES.human, 'palettes', { get: () => (lastStyle === 'sd' || !STYLES[lastStyle] ? HUMAN_PALS : DARK_PALS), configurable: true });
  MF.Gen.humanWeapons = HUMAN_WEAPONS;
  MF.Gen.humanStyles = STYLES;
  MF.Gen.humanRoles = ROLES;
})();
