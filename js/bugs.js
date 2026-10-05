// Mecha Factory — alien bug line (Infested Planet swarm). Six-legged segmented bugs built from the same convex
// primitives as the mechs: bodies are faceted ovoids (a box with ~50 chamfer cuts circumscribing an ellipsoid), legs
// are tapered frustums. Organic reads come from overlapping segment ovoids and tapered legs, not smooth meshes.
// Species: drone (the basic swarm bug), runner, spitter, brute, tank. Walk = alternating tripods; attack = lunge/bite
// (the spitter rears and spits); idle = twitch.
//
// BAKING: MF.Bugs.bakeSheet(MFApp, unit, { cell, pitch }) is the ONE supported path for game sheets. It renders the
// tight crop, centres the body in square cells (anchor = ground point, meta.centered = true) and applies the bug
// finish (see finish(): low-key quantised tones, navy shadow edge, one stamped head star on small bugs).
// MFApp.buildSheet(bugUnit, { cell: <number> }) is routed to bakeSheet at the current pitch (wrapped on
// DOMContentLoaded), so fixed cells never clip the body. The rig also carries root.footInCell (0..1, where the ground
// point should sit inside a fixed cell) for app.js to honour if it ever stops being wrapped.
(function () {
  const MF = window.MF;
  const G = MF.Gen;
  const PI = Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ------------------------------------------------------------- palettes
  // shell = primary, legs / mandibles = secondary (a shell-mid tone, NOT a highlight), underside & coxae = metal,
  // head cap = skin (the one mint area), soft parts (sac, maw, brute membrane) = tertiary, star seed = hair,
  // other emissive bits = accent, spit / big-bug eyes = glass, outline = the navy shadow edge (#0b1c33) so the gaps
  // between bugs read navy. Registered non-enumerable so the mech and human palette pickers (which list Object.keys)
  // are not polluted; lookups by name (sanitize, randomBlueprint) still work.
  const ALIEN = {
    'Infested Teal': { primary: '#1c425c', secondary: '#2c5a78', tertiary: '#c0306f', metal: '#12293f', skin: '#3f7a6c', hair: '#b8e08c', accent: '#9cc878', glass: '#9fd0dc', outline: '#0b1c33', bg: '#35361f', floor: '#454628' },
    'Blood Hive':    { primary: '#4a1624', secondary: '#6a2a2e', tertiary: '#a24bd6', metal: '#240d16', skin: '#8a4a32', hair: '#ffe0a0', accent: '#f0b060', glass: '#ffd6a0', outline: '#1a070e', bg: '#35361f', floor: '#454628' },
    'Void Brood':    { primary: '#2a2258', secondary: '#3a3470', tertiary: '#c8ff52', metal: '#151030', skin: '#2f6a6a', hair: '#d0fff0', accent: '#8ef0c8', glass: '#c0b8ff', outline: '#0c0820', bg: '#2a2234', floor: '#352c42' },
  };
  for (const k in ALIEN) {
    Object.defineProperty(MF.PALETTES, k, { value: Object.assign({ alien: true }, ALIEN[k]), enumerable: false, configurable: true, writable: true });
  }
  // the Infested Planet look leads; the alternates are mutations
  const ALIEN_PALS = ['Infested Teal', 'Infested Teal', 'Infested Teal', 'Infested Teal', 'Blood Hive', 'Void Brood'];

  // Bake finish tones, per palette: the renderer's 5-step ramps are quantised to these 5 low-key tones per material
  // class ([deepest, dark, base, lit, top]). Tuned against the ip_01 swarm (navy-blue blobs, one bright front star).
  // A palette without an entry (or with edited colours) derives its tones from its own ramps (see tonesFor).
  const TONES = {
    'Infested Teal': {
      primary:   ['#133242', '#153e52', '#18465e', '#22536c', '#2a5d78'],
      metal:     ['#0b1e26', '#0f2830', '#112d32', '#16363c', '#1c4048'],
      secondary: ['#152e30', '#203c3e', '#274d4f', '#2c5456', '#305a5c'],
      skin:      ['#24483f', '#306254', '#3a6a5a', '#42705f', '#477666'],
      tertiary:  ['#3a0c26', '#6e1a44', '#b02c66', '#bc3c74', '#c64c80'],
      // star: [arms, core, glint, inner halo (diagonals), 2 px tips, outer ring]; everything but the glint is
      // mint-dominant, everything inside the 5x5 reads bright (g > 120) like the ip_01 clusters
      // round 4: inner halo / tips sit just above the bright cut and lean cyan; [5] is the soft halo (blended 50%)
      star: ['#96cc86', '#dcecc4', '#9fd0dc', '#548078', '#507c74', '#64c88c'], speck: '#9fd0dc', edge: '#0b1c33',
    },
  };
  // per-bug shade variants (legacy bp.shade 0..2 = variants 0..2): a value multiplier on the chitin tones only.
  const SHADES = [1.0, 0.88, 1.12];
  // Round 4: per-instance variants (bp.variant 0..5). Each one differs in chitin value (shade), hue (deg; + = bluer,
  // - = tealer) and saturation (sat), the size class of its head highlight (star: 3 = 3x3 plus, 5 = 5x5 cluster,
  // 7 = 7x5 soft blob), how many 1 px pale-cyan specks sit on the shell (specks) and the body width (bulk: 0.7 / 1.3 =
  // -1 / +1 px). Weights give 40% 3x3, 40% 5x5, 20% 7x5. The swarm picks one per instance by seed (aliens.json variants).
  const VARIANTS = [
    { name: 'bug_drone',    shade: 1.00, hue: 0,   sat: 1.00, star: 5, specks: 2, bulk: 1.0,  weight: 0.2, speckMode: 'merge' },
    { name: 'bug_drone_v1', shade: 0.88, hue: 6,   sat: 1.15, star: 3, specks: 2, bulk: 0.7,  weight: 0.2 },
    { name: 'bug_drone_v2', shade: 1.12, hue: -8,  sat: 0.84, star: 5, specks: 2, bulk: 1.3,  weight: 0.2, speckMode: 'merge' },
    { name: 'bug_drone_v3', shade: 0.94, hue: -10, sat: 0.78, star: 3, specks: 1, bulk: 1.0,  weight: 0.2 },
    { name: 'bug_drone_v4', shade: 1.15, hue: 8,   sat: 1.22, star: 7, specks: 2, bulk: 1.15, weight: 0.1, speckMode: 'merge' },
    { name: 'bug_drone_v5', shade: 0.85, hue: -6,  sat: 0.90, star: 7, specks: 3, bulk: 0.85, weight: 0.1, speckMode: 'merge' },
  ];
  const variantOf = (bp) => {
    if (!bp) return VARIANTS[0];
    if (bp.variant != null && VARIANTS[bp.variant | 0]) return VARIANTS[bp.variant | 0];
    return VARIANTS[clamp(bp.shade | 0, 0, 2)];
  };

  // ------------------------------------------------------------- species
  // All sizes are build units at size 1 (1 unit = 1 screen px). Part = { w, h, l, z, y } (full sizes, centre offset
  // from the thorax centre). H: thorax centre height. legs: attach x (from centre), z per pair, femur length F, femur
  // rise `up` and tibia fall `down` (rad), radius r, spread (yaw from forward per pair). mand: [radius, length].
  const SPECIES = {
    drone: {
      scale: 1.0, H: 3.3, head: { w: 6.4, h: 4.2, l: 4.8, z: 4.6, y: -0.4 }, th: { w: 7.0, h: 5.0, l: 4.8, z: 1.4, y: 0.6 },
      abd: [{ w: 11.0, h: 6.4, l: 8.6, z: -3.4, y: 0.3 }],
      // pairR: per-pair leg radius; the front and back pairs (the outer legs of each tripod) are 2 px thick so the
      // alternating stride reads at 1:1
      legs: { x: 2.8, z: [2.6, 1.2, -0.2], F: 2.6, up: 0.6, down: 1.15, r: 0.62, pairR: [1.0, 0.62, 1.0], spread: [0.7, 1.55, 2.35] },
      mand: [0.55, 2.3], lunge: 5.0, back: 2.0, footInCell: 0.56, star: true, sweep: 0.8, bob: 0.8, surge: 0.9, sway: 1.0,
    },
    runner: {
      scale: 0.92, H: 3.0, head: { w: 5.2, h: 3.6, l: 4.8, z: 4.7, y: -0.4 }, th: { w: 6.8, h: 4.2, l: 6.2, z: 1.0, y: 0 },
      abd: [{ w: 8.2, h: 4.9, l: 8.0, z: -4.0, y: 0.2 }, { w: 6.0, h: 3.8, l: 4.8, z: -8.2, y: -0.2 }],
      legs: { x: 2.4, z: [2.6, 0.6, -1.4], F: 3.2, up: 0.6, down: 1.0, r: 0.55, spread: [0.6, 1.55, 2.5] },
      mand: [0.45, 2.2], lunge: 3.0, back: 1.2, footInCell: 0.56, star: true,
    },
    spitter: {
      H: 3.5, head: { w: 6.0, h: 4.2, l: 4.8, z: 5.4, y: -0.4 }, th: { w: 8.4, h: 5.2, l: 6.0, z: 2.0, y: 0 },
      abd: [{ w: 8.6, h: 5.4, l: 4.6, z: -1.4, y: 0.2 }],
      bulb: { w: 13.4, h: 9.4, l: 11.0, z: -6.8, y: 1.6 },
      legs: { x: 2.8, z: [3.4, 1.6, -0.2], F: 3.0, up: 0.6, down: 1.05, r: 0.62, spread: [0.75, 1.55, 2.3] },
      mand: [0.45, 1.5], lunge: 0, back: 1.0, footInCell: 0.58, star: true,
    },
    brute: {
      H: 5.8, head: { w: 12.0, h: 7.0, l: 7.0, z: 9.6, y: -1.0 }, th: { w: 24.0, h: 10.0, l: 9.6, z: 4.0, y: 0.8 },
      abd: [{ w: 30.0, h: 11.0, l: 9.6, z: -2.2, y: 1.0 }, { w: 27.0, h: 10.0, l: 8.4, z: -6.8, y: 0.2 }, { w: 21.0, h: 8.0, l: 7.0, z: -10.6, y: -0.8 }],
      legs: { x: 8.5, z: [5.4, 0.8, -3.6], F: 5.6, up: 0.5, down: 1.0, r: 1.7, spread: [0.8, 1.6, 2.35] },
      mand: [1.1, 4.4], lunge: 7.0, back: 3.0, footInCell: 0.6, edgeAlpha: 255, toneK: 0.7,
    },
    tank: {
      scale: 1.25, H: 9.5, head: { w: 18.0, h: 10.0, l: 10.0, z: 18.0, y: -2.6 }, th: { w: 30.0, h: 14.0, l: 14.0, z: 10.0, y: -0.6 },
      abd: [{ w: 46.0, h: 20.0, l: 38.0, z: -4.0, y: 1.6 }],
      legs: { x: 12.0, z: [9.0, 0.0, -9.0], F: 9.0, up: 0.45, down: 1.05, r: 2.6, spread: [0.85, 1.6, 2.3] },
      mand: [1.6, 5.0], lunge: 6.0, back: 3.0, footInCell: 0.62, edgeAlpha: 255, membrane: [0.34, 0.26],
    },
  };

  const OPT = {
    species: ['drone', 'runner', 'spitter', 'brute', 'tank'],
    carapace: ['dome', 'ridged', 'spiked', 'plated'],
    head: ['mandibles', 'pincers', 'horn', 'maw', 'crest'],
    abdomen: ['segmented', 'stinger', 'bulb', 'heavy'],
    markings: ['none', 'spots', 'bands', 'ridge', 'chevrons'],
    legs: ['spindly', 'barbed', 'hooked', 'stubby'],
  };
  const LBL = {
    species: { drone: 'Drone', runner: 'Runner', spitter: 'Spitter', brute: 'Brute', tank: 'Tank' },
    carapace: { dome: 'Smooth dome', ridged: 'Dorsal ridge', spiked: 'Spined', plated: 'Armour plates' },
    head: { mandibles: 'Mandibles', pincers: 'Great pincers', horn: 'Horn', maw: 'Open maw', crest: 'Hammer crest' },
    abdomen: { segmented: 'Segmented', stinger: 'Stinger', bulb: 'Acid sac', heavy: 'Armoured' },
    markings: { none: 'None', spots: 'Glow spots', bands: 'Bands', ridge: 'Spine stripe', chevrons: 'Chevrons' },
    legs: { spindly: 'Spindly', barbed: 'Barbed', hooked: 'Scythe forelegs', stubby: 'Stubby' },
  };
  const DEFAULTS = {
    drone:   { carapace: { dome: 6, ridged: 2, spiked: 1 }, head: { mandibles: 6, maw: 1, horn: 1 }, abdomen: { segmented: 6, stinger: 1 }, markings: { none: 4, spots: 2, ridge: 2, bands: 1 }, legs: { spindly: 6, barbed: 1 } },
    runner:  { carapace: { ridged: 3, dome: 2, spiked: 1 }, head: { mandibles: 3, pincers: 2 }, abdomen: { stinger: 3, segmented: 2 }, markings: { ridge: 3, chevrons: 2, spots: 1, none: 1 }, legs: { hooked: 3, spindly: 2 } },
    spitter: { carapace: { dome: 3, ridged: 2, spiked: 1 }, head: { maw: 4, mandibles: 1 }, abdomen: { bulb: 1 }, markings: { spots: 4, bands: 2, none: 1 }, legs: { spindly: 3, stubby: 1 } },
    brute:   { carapace: { plated: 4, spiked: 2, ridged: 1 }, head: { pincers: 4, horn: 2, crest: 2 }, abdomen: { heavy: 3, segmented: 2, stinger: 1 }, markings: { bands: 3, ridge: 2, spots: 1, none: 1 }, legs: { barbed: 2, spindly: 2, stubby: 1 } },
    tank:    { carapace: { spiked: 4, plated: 2 }, head: { horn: 3, crest: 3, pincers: 2 }, abdomen: { heavy: 4, bulb: 1 }, markings: { bands: 2, spots: 2, ridge: 1 }, legs: { stubby: 4, barbed: 1 } },
  };
  const NAMES = {
    drone: ['Skitter', 'Chitter', 'Mite', 'Swarmling', 'Tick', 'Nit'],
    runner: ['Darter', 'Flicker', 'Lacer', 'Sprinter', 'Skimmer'],
    spitter: ['Spitter', 'Bile', 'Gorger', 'Acid', 'Sputter'],
    brute: ['Brute', 'Ram', 'Crusher', 'Mauler', 'Bulwark'],
    tank: ['Behemoth', 'Hive Tank', 'Colossus', 'Leviathan', 'Juggernaut'],
  };

  function randomBug(r, keep, bp) {
    bp.species = keep('species', () => r.weighted({ drone: 5, runner: 2, spitter: 2, brute: 2, tank: 1 }));
    const D = DEFAULTS[bp.species] || DEFAULTS.drone;
    for (const k of ['carapace', 'head', 'abdomen', 'markings', 'legs']) bp[k] = keep(k, () => r.weighted(D[k]));
    bp.shade = keep('shade', () => r.int(0, SHADES.length - 1)); // legacy value variant (see SHADES)
    bp.variant = keep('variant', () => r.weighted(Object.fromEntries(VARIANTS.map((v, i) => [i, v.weight * 10]))) | 0); // bake finish variant (see VARIANTS)
  }

  // ------------------------------------------------------------- shapes
  // Faceted ovoid: a box whose edges and corners are cut by planes tangent to the inscribed ellipsoid. Normals sit on
  // rings of latitude, so from above the outline is a 20-gon and the top shades in soft concentric steps.
  const OV_DIRS = (() => {
    const out = [];
    const ring = (el, n, off) => {
      for (let i = 0; i < n; i++) { const a = ((i + off) / n) * 2 * PI; out.push([Math.cos(el) * Math.sin(a), Math.sin(el), Math.cos(el) * Math.cos(a)]); }
    };
    ring(0, 20, 0.5); ring(0.35, 12, 0); ring(0.78, 8, 0.5); ring(1.15, 6, 0); ring(-0.6, 8, 0.25);
    return out.filter((n) => Math.abs(n[0]) < 0.999 && Math.abs(n[1]) < 0.999 && Math.abs(n[2]) < 0.999);
  })();
  function ovoid(node, w, h, l, o = {}) {
    const a = w / 2, b = h / 2, c = l / 2;
    const cuts = [];
    for (const n of OV_DIRS) {
      const sup = Math.sqrt((a * n[0]) ** 2 + (b * n[1]) ** 2 + (c * n[2]) ** 2);
      const cut = Math.abs(n[0]) * a + Math.abs(n[1]) * b + Math.abs(n[2]) * c - sup;
      if (cut > 1e-3) cuts.push([n[0], n[1], n[2], cut]);
    }
    return node.box(w, h, l, { at: o.at, rot: o.rot, mat: o.mat || 'primary', cuts, detail: o.detail, shadow: o.shadow });
  }
  const part = (P, k = 1) => [P.w * k, P.h, P.l];

  function markDetail(kind, w, l) {
    switch (kind) {
      case 'spots': return { type: 'light', face: '+y', pts: [[-w * 0.2, -l * 0.1], [w * 0.2, -l * 0.1]], size: 0.5, dim: true };
      case 'bands': return { type: 'band', face: '+y', at: -l * 0.18, size: 0.55, mat2: 'secondary' };
      case 'ridge': return { type: 'band', face: '+y', dir: 'v', at: 0, size: 0.5, mat2: 'secondary' };
      case 'chevrons': return { type: 'stripe', face: '+y', width: 1.2, mat2: 'secondary' };
      default: return null;
    }
  }

  // ------------------------------------------------------------- build
  function buildBug(ctx) {
    const { bp } = ctx;
    const sp = SPECIES[bp.species] ? bp.species : 'drone';
    const SP = SPECIES[sp];
    const KK = ctx.k * (SP.scale || 1);
    MF.setBuildScale(KK);
    try { buildBody(ctx, bp, sp, SP, KK); } finally { MF.setBuildScale(ctx.k); }
    ctx.root.footInCell = SP.footInCell;
  }

  function buildBody(ctx, bp, sp, SP, KK) {
    const bw = 1 + (clamp(bp.bulk || 1, 0.6, 1.6) - 1) * 0.3;
    const ll = 1 + (clamp(bp.legLen || 1, 0.6, 1.6) - 1) * 0.3;
    const car = bp.carapace, headT = bp.head, abdT = bp.abdomen, mk = bp.markings, legT = bp.legs;
    const big = sp === 'brute' || sp === 'tank';
    const T = SP.th, Hd = SP.head;

    const body = ctx.root.child('body', [0, SP.H, 0]);
    // thorax: dark underside + shell ovoid
    ovoid(body, T.w * bw * 0.84, T.h * 0.6, T.l * 0.9, { at: [0, T.y - T.h * 0.25, T.z], mat: 'metal', shadow: false });
    ovoid(body, T.w * bw, T.h, T.l, { at: [0, T.y, T.z], mat: SP.thMat || 'primary', detail: markDetail(mk === 'bands' || mk === 'spots' ? 'none' : mk, T.w, T.l) });
    if (car === 'ridged') ovoid(body, Math.max(1.2, T.w * 0.16), T.h * 0.4, T.l * 0.8, { at: [0, T.y + T.h * 0.36, T.z], mat: 'secondary' });
    if (car === 'plated' && big) {
      // pronotum shield lip in the highlight colour
      ovoid(body, T.w * bw * 1.04, T.h * 0.5, T.l * 0.5, { at: [0, T.y + T.h * 0.12, T.z + T.l * 0.3], detail: { type: 'band', face: '+y', at: T.l * 0.05, size: 0.6, mat2: 'secondary' } });
    }
    if (car === 'spiked') spikes(body, T, big ? 2 : 1, 0, big);

    // ---------------- head
    const head = body.child('head', [0, Hd.y, Hd.z - Hd.l * 0.2]);
    // small bugs: the head is the one mint area (skin); big bugs keep a shell head with a mint brow
    ovoid(head, Hd.w * bw, Hd.h, Hd.l, { at: [0, 0, Hd.l * 0.2], mat: SP.star ? 'skin' : 'primary' });
    if (!SP.star) ovoid(head, Hd.w * bw * 0.6, Hd.h * 0.4, Hd.l * 0.5, { at: [0, Hd.h * 0.32, Hd.l * 0.32], mat: 'skin' });
    // star seed: the green-yellow read at the front of every bug. Its own material ('hair' = the star colour) so the
    // bake finish can find it and stamp one compact star there; in the hangar it renders as a bright brow nub.
    const nub = Math.max(1.2, Hd.w * 0.2);
    head.box(nub * (big ? 1.6 : 1), Math.max(0.9, nub * 0.6), nub, { at: [0, Hd.h * 0.44, Hd.l * 0.42], mat: 'hair', bevel: nub * 0.2 });
    if (big) for (const s of [-1, 1]) head.box(Hd.w * 0.12, Hd.h * 0.16, Hd.w * 0.1, { at: [s * Hd.w * 0.3, Hd.h * 0.28, Hd.l * 0.52], mat: 'glass', bevel: 0.2 });
    const [mr, ml0] = SP.mand;
    const mandible = (s, len, rad, splay, curl) => {
      const m = head.child('mand' + s, [s * Hd.w * 0.24, -Hd.h * 0.1, Hd.l * 0.62], [0, s * splay, 0]);
      m.cone('z', rad, rad * 0.8, len, { at: [0, 0, len / 2], mat: 'secondary', sides: 6 });
      const tip = m.child('mtip' + s, [0, 0, len * 0.92], [0, -s * curl, 0]);
      tip.cone('z', rad * 0.8, Math.max(0.25, rad * 0.35), len * 0.85, { at: [0, 0, len * 0.4], mat: 'secondary', sides: 6 });
      return m;
    };
    if (headT === 'mandibles' || headT === 'horn' || headT === 'crest') for (const s of [-1, 1]) mandible(s, ml0 * (headT === 'mandibles' ? 1 : 0.8), mr, 0.4, 0.95);
    if (headT === 'pincers') for (const s of [-1, 1]) {
      const m = mandible(s, ml0 * 1.35, mr * 1.25, 0.55, 1.2);
      m.cone('z', mr * 0.5, 0.2, ml0 * 0.5, { at: [-s * mr * 0.9, 0, ml0 * 0.8], rot: [0, -s * 0.9, 0], mat: 'metal', sides: 4 }); // serration
    }
    if (headT === 'horn') head.cone('z', Math.max(0.8, Hd.w * 0.15), 0.2, Hd.l * 1.3, { at: [0, Hd.h * 0.45, Hd.l * 0.85], rot: [-0.45, 0, 0], mat: 'secondary', sides: 6 });
    if (headT === 'crest') ovoid(head, Hd.w * 1.5, Hd.h * 0.35, Hd.l * 0.7, { at: [0, Hd.h * 0.35, 0], detail: { type: 'band', face: '+y', at: Hd.l * 0.1, size: 0.6, mat2: 'secondary' } });
    if (headT === 'maw') {
      ovoid(head, Hd.w * 0.62, Hd.h * 0.5, Math.max(1.4, Hd.l * 0.4), { at: [0, -Hd.h * 0.05, Hd.l * 0.62], mat: 'tertiary' });
      for (const s of [-1, 1]) head.cone('z', Math.max(0.45, mr * 0.9), 0.15, ml0 * 0.8, { at: [s * Hd.w * 0.28, -Hd.h * 0.1, Hd.l * 0.78], rot: [0, -s * 0.3, 0], mat: 'accent', sides: 4 });
    }
    // spit glob (spitter attack) is hidden until the attack
    const spit = head.child('spit', [0, Hd.h * 0.1, Hd.l * 1.2]);
    spit.startHidden = true;
    spit.box(2.0, 2.0, 2.0, { mat: 'glass', bevel: 0.6, bevelSet: 'round', shadow: false });

    // ---------------- abdomen (front segment overlaps the next, like tergites)
    const abdNodes = [];
    let parent = body, pz = 0, py = 0;
    const segs = SP.abd.map((a, i) => (abdT === 'heavy' && !big && i === 0 ? Object.assign({}, a, { w: a.w * 1.06 }) : a));
    segs.forEach((A, i) => {
      const n = parent.child('abd' + i, [0, A.y - py, A.z + A.l * 0.4 - pz], [0, 0, 0]);
      const zc = -A.l * 0.4;
      ovoid(n, A.w * bw * 0.86, A.h * 0.6, A.l * 0.9, { at: [0, -A.h * 0.25, zc], mat: 'metal', shadow: false });
      const segL = sp === 'drone' && abdT === 'segmented' ? A.l * 0.62 : A.l;
      ovoid(n, A.w * bw, A.h, segL, { at: [0, 0, zc + (A.l - segL) / 2], detail: markDetail((mk === 'spots' && i > 0) || (big && mk === 'bands') ? 'none' : mk, A.w, A.l) });
      // big bugs: a soft magenta membrane bulging between the pronotum and the first tergite (the threat colour)
      if (big && i === 0 && mk !== 'none') { const mb = SP.membrane || [0.6, 0.55]; ovoid(n, A.w * bw * mb[0], A.h * 1.05, Math.max(2.6, A.l * mb[1]), { at: [0, A.h * 0.2, -A.l * 0.05], mat: 'tertiary' }); }
      if (sp === 'drone' && abdT === 'segmented') {
        // second tergite tucked under the first: a soft segment line across the back, not a stacked box
        ovoid(n, A.w * bw * 0.86, A.h * 0.84, A.l * 0.5, { at: [0, -A.h * 0.07, zc - A.l * 0.24] });
      }
      if ((abdT === 'heavy' || car === 'plated') && big) {
        // rear lip of each plate: a dark groove between tergites (segment band), not a painted stripe
        ovoid(n, A.w * bw * 0.96, A.h * 0.4, A.l * 0.36, { at: [0, A.h * 0.24, zc - A.l * 0.3], detail: { type: 'band', face: '+y', at: -A.l * 0.04, size: Math.max(0.6, A.l * 0.05), mat2: 'metal' } });
      }
      if (car === 'ridged') ovoid(n, Math.max(1.2, A.w * 0.14), A.h * 0.4, A.l * 0.8, { at: [0, A.h * 0.36, zc], mat: 'secondary' });
      if (car === 'spiked' && (big || i === 0)) spikes(n, Object.assign({}, A, { z: zc, y: 0 }), sp === 'tank' ? 3 : big ? 2 : 1, i, big);
      abdNodes.push(n);
      parent = n; pz = A.z + A.l * 0.4; py = A.y;
    });
    const last = segs[segs.length - 1];
    if (abdT === 'bulb') {
      const B = SP.bulb || { w: last.w * 1.25, h: last.h * 1.25, l: last.l * 1.2, z: last.z - last.l * 0.7, y: last.y + 0.6 };
      const sac = parent.child('sac', [0, B.y - py, B.z + B.l * 0.45 - pz], [0.05, 0, 0]);
      ovoid(sac, B.w * bw, B.h, B.l, { at: [0, 0, -B.l * 0.45], mat: 'tertiary', detail: [{ type: 'band', face: '+y', at: -B.l * 0.12, size: 0.5, mat2: 'primary' }, mk === 'spots' ? { type: 'light', face: '+y', pts: [[-B.w * 0.18, -B.l * 0.3], [B.w * 0.18, -B.l * 0.3]], size: 0.55, dim: true } : null].filter(Boolean) });
      // shell saddle over the front of the sac keeps the teal read
      ovoid(sac, B.w * bw * 0.84, B.h * 0.5, B.l * 0.42, { at: [0, B.h * 0.26, -B.l * 0.12] });
      abdNodes.push(sac);
    }
    if (abdT === 'stinger') {
      const sn = parent.child('sting', [0, last.h * 0.1, -last.l * 0.85], [-0.3, 0, 0]);
      const stL = last.l * (sp === 'runner' ? 0.6 : 0.85);
      sn.cone('z', Math.max(0.6, last.h * 0.18), 0.15, stL, { at: [0, 0, -stL * 0.45], mat: 'secondary', sides: 6 });
      sn.box(0.9, 0.9, 0.9, { at: [0, 0, -stL * 0.95], mat: 'secondary' });
    }

    // ---------------- legs
    const legs = buildLegs(body, SP, legT, ll, sp);

    // ---------------- motion
    const sweep = SP.sweep || (sp === 'runner' ? 0.42 : sp === 'tank' ? 0.24 : 0.34);
    const bobA = SP.bob || 0.3, surgeA = SP.surge || 0, swayA = SP.sway || 0;
    ctx.stride = 4 * legs.reach * Math.sin(sweep);
    ctx.fireDecay = sp === 'tank' ? 2.5 : sp === 'brute' ? 3 : 4.5;
    ctx.gait = 'legs';
    const lunge = SP.lunge, back = SP.back || 0;
    ctx.anims.push((st, n) => {
      const m = st.move, ph = st.phase, t = st.t || 0, f = st.fire || 0, idle = 1 - m;
      const b = n.body;
      // scuttle: quick bob each half-cycle, body yaws toward the planted tripod, abdomen swings behind
      b.pos[1] += (-Math.abs(Math.sin(ph)) * bobA * m + Math.sin(t * 2.1) * 0.12 * idle) * KK;
      // drone scuttle: a forward surge on every push (2 px peak to peak on screen) and a 1 px lateral sway toward the
      // planted tripod, so consecutive walk frames move the whole body, not only the leg nubs
      b.pos[2] += Math.cos(ph * 2) * surgeA * m * KK;
      b.pos[0] += Math.sin(ph) * swayA * m * KK;
      b.rot[1] += Math.sin(ph) * 0.06 * m;
      b.rot[2] += Math.sin(ph) * 0.04 * m;
      const twitch = Math.max(0, Math.sin(t * 2.9) - 0.75) * 4; // a sharp twitch every couple of seconds
      n.head.rot[1] += -Math.sin(ph) * 0.08 * m + idle * (Math.sin(t * 1.3) * 0.12 + twitch * 0.12);
      abdNodes.forEach((a, i) => { a.rot[1] += -Math.sin(ph - 0.7 - i * 0.5) * (0.1 + i * 0.03) * m + idle * Math.sin(t * 0.9 - i * 0.6) * 0.05; });
      if (abdNodes[0]) abdNodes[0].pos[1] += idle * Math.sin(t * 2.6) * 0.15 * KK; // breathing
      const chew = idle * (Math.sin(t * 6) * 0.5 + 0.5) * 0.25;
      for (const s of [-1, 1]) if (n['mand' + s]) n['mand' + s].rot[1] += s * chew;
      for (const L of legs) {
        if (L.hooked) {
          n['femur' + L.i].rot[2] += (Math.sin(ph * 2 + L.s) * 0.06 * m) + idle * Math.sin(t * 1.7 + L.s) * 0.05;
          continue;
        }
        const p = ph + L.g * PI;
        const lift = Math.max(0, Math.sin(p)) * m;
        n['leg' + L.i].rot[1] += L.s * sweep * Math.cos(p) * m;
        n['femur' + L.i].rot[2] += lift * 0.5;
        n['knee' + L.i].rot[2] -= lift * 0.3;
      }
      // idle: one foreleg taps on the twitch
      if (idle > 0 && legs[0] && !legs[0].hooked) n['femur' + legs[0].i].rot[2] += twitch * 0.25 * idle;
      // ---- attack. fire is 1 when the attack starts and decays to 0; the sheet bakes attack0..3 at fire 1, .75, .5, .25.
      // lungeCurve: wind-up (-1: pulled back, crouched, legs tucked) -> thrust (+1: body forward, mandibles wide,
      // forelegs reaching) -> recover (0).
      if (f > 0) {
        const z = lungeCurve(f);
        const tuck = Math.max(0, -z), reach = Math.max(0, z);
        if (sp === 'spitter') {
          b.pos[2] -= (tuck * back + reach * 0.5) * KK;             // rears back, then holds while it spits
          b.pos[1] -= tuck * 0.5 * KK;
          if (abdNodes[0]) abdNodes[0].rot[0] += (tuck + reach) * 0.3; // sac swings up over the back
          n.head.rot[0] -= tuck * 0.35 - reach * 0.1;
          n.spit.hidden = reach < 0.15;
          n.spit.pos[2] += (0.4 + (1 - f) * 2.6) * KK;
          n.spit.pos[1] += (1 - f) * 1.0 * KK;
        } else {
          b.pos[2] += (reach * lunge - tuck * back) * KK;
          b.pos[1] -= tuck * 0.6 * KK;                               // crouch on the wind-up
          b.rot[0] += tuck * 0.12 - reach * 0.06;                    // head tucked on the wind-up, reared into the bite
          for (const a of abdNodes) a.rot[0] -= reach * 0.06;        // tail lifts to balance
          n.head.rot[0] -= reach * 0.18;                             // head up so the open mandibles project forward
        }
        const open = sp === 'spitter' ? reach : Math.max(reach, tuck * 0.3);
        for (const s of [-1, 1]) if (n['mand' + s]) n['mand' + s].rot[1] += s * open * 0.7;
        for (const L of legs) {
          if (L.hooked) {
            if (L.j === 0) { n['femur' + L.i].rot[2] += reach * 0.7 - tuck * 0.2; n['leg' + L.i].rot[1] += L.s * reach * 0.2; }
            continue;
          }
          // wind-up: every leg folds in under the body; thrust: forelegs reach forward, hind legs push back
          n['femur' + L.i].rot[2] += tuck * 0.55 + (L.j === 0 ? reach * 0.5 : 0);
          n['knee' + L.i].rot[2] -= tuck * 0.45;
          n['leg' + L.i].rot[1] += L.s * (L.j === 0 ? reach * 0.35 : L.j === 2 ? -reach * 0.3 : 0) + L.s * tuck * (L.j === 0 ? -0.15 : L.j === 2 ? 0.2 : 0);
        }
      }
    });
  }

  // attack timeline, f = fire (1 -> 0): -1 at f = 1 (wind-up), +1 at f = 0.75 (thrust), then eases back to 0.
  function lungeCurve(f) {
    const u = clamp(1 - f, 0, 1);
    if (u < 0.25) { const e = u / 0.25; return -1 + 2 * e * e * (3 - 2 * e); }
    return Math.pow(1 - (u - 0.25) / 0.75, 1.6);
  }

  // dorsal spines in rows of `n` per side (+ a central one on big bugs); tips in the mint (big) or leg tone (small)
  function spikes(node, A, n, i, big) {
    const hgt = Math.max(1.6, A.h * 0.4), rad = Math.max(0.6, A.w * 0.06);
    for (let k = 0; k < n; k++) for (const s of [-1, 1]) {
      const zz = A.z + (n === 1 ? 0 : (k / (n - 1) - 0.5) * A.l * 0.55);
      const xx = s * A.w * (n === 1 ? 0.2 : 0.24 + 0.06 * Math.cos(k));
      const sn = node.child('spk' + i + '_' + k + '_' + s, [xx, A.y + A.h * 0.4, zz], [-0.55, 0, s * 0.55]);
      sn.cone('y', rad, rad * 0.35, hgt, { at: [0, hgt / 2, 0], mat: 'secondary', sides: 5 });
      sn.cone('y', rad * 0.35, 0.12, Math.max(0.9, hgt * 0.3), { at: [0, hgt + Math.max(0.9, hgt * 0.3) / 2 - 0.1, 0], mat: big ? 'skin' : 'secondary', sides: 5 });
    }
    if (n >= 2) node.cone('y', rad * 1.2, 0.15, hgt * 1.2, { at: [0, A.y + A.h * 0.5, A.z], rot: [-0.6, 0, 0], mat: 'secondary', sides: 5 });
    void i;
  }

  // Six legs in two tripods (L-front, R-mid, L-back / R-front, L-mid, R-back). Each leg: coxa stub, femur rising
  // out of the body, tapered tibia falling to the ground (leg tone; small bugs' forelegs in the head mint; no glowing tips:
  // the only bright read on a small bug is its head star).
  function buildLegs(body, SP, style, ll, sp) {
    const legs = [];
    const LG = SP.legs;
    const attachY = SP.th.y - SP.th.h * 0.2;
    const hY = SP.H + attachY;
    let reach = 0;
    for (let j = 0; j < 3; j++) for (const s of [-1, 1]) {
      const i = legs.length;
      const hooked = style === 'hooked' && j === 0;
      let up = LG.up, down = LG.down, F = LG.F * ll, r = LG.pairR ? LG.pairR[j] : LG.r;
      if (style === 'stubby') { F *= 0.85; up *= 0.7; r *= 1.2; down += 0.1; }
      if (style === 'spindly') { r *= 0.95; }
      if (style === 'barbed') r *= 1.05;
      const a = s * (hooked ? 0.5 : LG.spread[j]);
      const cox = Math.max(0.6, r * 0.8);
      const lm = SP.star && j === 0 && sp !== 'drone' ? 'skin' : 'secondary'; // drone legs stay on the shell-mid tone
      const root = body.child('leg' + i, [s * LG.x, attachY, LG.z[j]], [0, a - PI / 2, 0]);
      root.cyl('x', r * 1.05, cox + 0.6, { at: [cox / 2, 0, 0], mat: 'metal', sides: 6 });
      if (hooked) {
        // scythe foreleg: femur raised forward, blade folded back along it
        const Fh = F * 1.2;
        const fem = root.child('femur' + i, [cox, 0, 0], [0, 0, 0.7]);
        fem.cone('x', r * 1.1, r * 0.85, Fh + 0.5, { at: [Fh / 2, 0, 0], mat: lm, sides: 6 });
        const blade = fem.child('blade' + i, [Fh, 0, 0], [0, 0, -2.3]);
        blade.box(Fh * 1.0, Math.max(0.9, r * 1.2), Math.max(0.8, r * 0.8), { at: [Fh * 0.5, 0, 0], mat: lm, cuts: [[1, 1, 0, r * 0.8]] });
        blade.box(0.9, 0.9, 0.9, { at: [Fh * 0.98, -r * 0.4, 0], mat: 'secondary' });
        legs.push({ i, s, j, g: 0, hooked: true });
        continue;
      }
      const Tb = (hY + F * Math.sin(up)) / Math.sin(down);
      const fem = root.child('femur' + i, [cox, 0, 0], [0, 0, up]);
      fem.cone('x', r, r * 0.85, F + 0.6, { at: [F / 2, 0, 0], mat: lm, sides: 6 });
      if (style === 'barbed') fem.cone('y', Math.max(0.45, r * 0.5), 0.12, Math.max(1.4, r * 1.2), { at: [F * 0.55, r * 0.8, 0], rot: [0, 0, -0.5], mat: 'secondary', sides: 4 });
      const knee = fem.child('knee' + i, [F, 0, 0], [0, 0, -(up + down)]);
      const tipL = Math.max(1.0, Math.min(2.2, Tb * 0.26));
      knee.cone('x', r * 0.85, Math.max(0.4, r * 0.62), Tb - tipL + 0.3, { at: [(Tb - tipL) / 2, 0, 0], mat: lm, sides: 6 });
      knee.cone('x', Math.max(0.42, r * 0.62), Math.max(0.3, r * 0.4), tipL, { at: [Tb - tipL / 2, 0, 0], mat: 'secondary', sides: 6 });
      reach = Math.max(reach, LG.x + cox + F * Math.cos(up) + Tb * Math.cos(down));
      legs.push({ i, s, j, g: (j + (s > 0 ? 1 : 0)) % 2, hooked: false });
    }
    legs.reach = reach || 10;
    void sp;
    return legs;
  }

  // ------------------------------------------------------------- registration
  const slot = (key, label) => ({ key, label, options: OPT[key], labels: LBL[key] });
  G.registerLine('bug', {
    label: 'Alien bug', group: 'Aliens', weight: 1,
    slots: [slot('species', 'Species'), slot('carapace', 'Carapace'), slot('head', 'Head'), slot('abdomen', 'Abdomen'), slot('markings', 'Markings'), slot('legs', 'Legs')],
    random: randomBug,
    build: buildBug,
    palettes: ALIEN_PALS,
    sizeRange: [0.95, 1.05],
    name(r, bp) { const L = NAMES[bp.species] || NAMES.drone; return `${r.pick(L)} ${bp.number}`; },
  });

  // ------------------------------------------------------------- baking
  // Seen near top-down a bug's body extends below its ground point, so bugs bake into square cells centred on the
  // body. The anchor in the meta is still the unit's ground point, identical in every frame.
  // opts: cell (px, square, default 32), pitch (rad, default 1.0), idle/frames/attack as buildSheet, shadow,
  // finish (default true): the bug finish below; false returns the renderer's raw 1 px outline.
  function bakeSheet(app, unit, opts = {}) {
    const N = +opts.cell || 32;
    const pitch = opts.pitch == null ? 1.0 : opts.pitch;
    const S = app.S, savePitch = S.settings.pitch;
    const raw = app.buildSheet.__bugRaw || app.buildSheet;
    S.settings.pitch = pitch;
    let res;
    try {
      res = raw(unit, { idle: opts.idle !== false, frames: opts.frames || 8, attack: opts.attack == null ? 4 : opts.attack, cell: 'auto', scale: 1, shadow: !!opts.shadow });
    } finally { S.settings.pitch = savePitch; }
    const { canvas, meta } = res;
    const cw = meta.cellWidth, ch = meta.cellHeight, cols = meta.columns.length;
    const offX = Math.round((N - cw) / 2), offY = Math.round((N - ch) / 2);
    const out = document.createElement('canvas');
    out.width = N * cols; out.height = N * 8;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let d = 0; d < 8; d++) for (let c = 0; c < cols; c++) {
      g.save();
      g.beginPath(); g.rect(c * N, d * N, N, N); g.clip();
      g.drawImage(canvas, c * cw, d * ch, cw, ch, c * N + offX, d * N + offY, cw, ch);
      g.restore();
    }
    const SPx = SPECIES[unit.bp && unit.bp.species] || SPECIES.drone;
    // variant: opts.variant (index or object) > bp.variant > legacy shade (opts.shade / bp.shade)
    let V = opts.variant != null ? (typeof opts.variant === 'object' ? opts.variant : VARIANTS[opts.variant | 0]) : null;
    if (!V && opts.shade != null) V = VARIANTS[clamp(opts.shade | 0, 0, 2)];
    if (!V) V = variantOf(unit.bp);
    const shade = VARIANTS.indexOf(V) >= 0 ? VARIANTS.indexOf(V) : 0;
    const vseed = ((unit.bp && unit.bp.seed) | 0) * 31 + shade * 977 + 17;
    if (opts.finish !== false && unit.pal) finish(out, unit.pal, { cell: N, star: !!SPx.star, variant: V, seed: vseed, palette: unit.bp && unit.bp.palette, edgeAlpha: SPx.edgeAlpha || 0, toneK: SPx.toneK || 1, cols: cols });
    const scale = +opts.scale > 1 ? Math.round(+opts.scale) : 1;
    let sheet = out;
    if (scale > 1) {
      sheet = document.createElement('canvas');
      sheet.width = out.width * scale; sheet.height = out.height * scale;
      const s2 = sheet.getContext('2d'); s2.imageSmoothingEnabled = false;
      s2.drawImage(out, 0, 0, sheet.width, sheet.height);
    }
    const m2 = Object.assign({}, meta, {
      cellWidth: N * scale, cellHeight: N * scale, scale, anchor: { x: (offX + meta.anchor.x) * scale, y: (offY + meta.anchor.y) * scale },
      clipped: cw > N || ch > N, contentWidth: cw, contentHeight: ch, pitch, centered: true, finish: opts.finish !== false,
      bakedWith: 'MF.Bugs.bakeSheet', shade: opts.finish !== false ? shade : null,
      variant: opts.finish !== false ? { index: shade, shade: V.shade, hue: V.hue, sat: V.sat, star: SPx.star ? V.star : null, specks: SPx.star ? V.specks : 0 } : null,
    });
    return { canvas: sheet, meta: m2 };
  }

  // ------------------------------------------------------------- bake finish
  // The renderer's ramps are tuned for hero-sized mechs; at 20 px a bug needs a strict pixel budget. The finish:
  //  1. quantises every pixel to its material class's low-key tone (TONES; shade variant applied to the chitin),
  //  2. despeckles 1 px facet stripes inside a class, so shells read as round blobs,
  //  3. turns the 1 px outline into a navy shadow edge: none on top/lit edges, 150 alpha below, a whisper on the
  //     flanks (big bugs keep a full dark rim so they pop out of the swarm),
  //  4. small bugs (SP.star): stamps ONE compact star on the head seed (the 'hair' nub): a #eaf6d0 core, four
  //     #a8dc8c arms, a mint halo filling the 5x5 around it, and one #9fd0dc glint 2 px behind it, so the only bright read is at the front.
  const CHITIN = ['primary', 'metal', 'secondary', 'skin', 'tertiary'];
  const hexRGB = (h) => { const v = parseInt(String(h).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const mixRGB = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
  const keyRGB = (c) => c[0] | (c[1] << 8) | (c[2] << 16);
  const unpack = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
  function sameColors(base, def) {
    if (!base || !def) return false;
    for (const k of ['primary', 'secondary', 'metal', 'skin', 'tertiary']) if (String(base[k] || '').toLowerCase() !== String(def[k] || '').toLowerCase()) return false;
    return true;
  }
  const rgb2hsv = (c) => {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn;
    let h = 0;
    if (dd > 0) h = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    return [(h * 60 + 360) % 360, mx > 0 ? dd / mx : 0, mx];
  };
  const hsv2rgb = (h, s, v) => {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [r + m, g + m, b + m].map((u) => clamp(Math.round(u * 255), 0, 255));
  };
  // variant transform of one chitin tone: hue shift (deg), saturation scale, value scale
  const vTone = (c, V, k) => {
    const [h, s, v] = rgb2hsv(c);
    return hsv2rgb((h + (V.hue || 0) + 360) % 360, clamp(s * (V.sat || 1), 0, 1), clamp(v * k, 0, 1));
  };
  function tonesFor(pal, name, variant, o = {}) {
    const T = TONES[name] && sameColors(pal.base, ALIEN[name]) ? TONES[name] : null;
    const V = typeof variant === 'object' && variant ? variant : VARIANTS[clamp(variant | 0, 0, VARIANTS.length - 1)];
    const out = {};
    const k = (V.shade || 1) * (o.toneK || 1);
    for (const m of CHITIN) {
      let t;
      if (T) t = T[m].map(hexRGB);
      else { const r = pal.ramps[m].map((c) => c.map(Math.round)); t = [r[0], r[1], r[2], mixRGB(r[2], r[3], 0.45), mixRGB(r[2], r[3], 0.8)]; }
      // chitin never crosses the highlight cut (g > 120 is reserved for stars and specks)
      out[m] = m === 'tertiary' ? t : t.map((c) => { const u = vTone(c, V, k); return u[1] > 114 ? u.map((v) => Math.round(v * 114 / u[1])) : u; });
    }
    // big-cluster variants: the head cap's two lit tones glow just over the bright cut, so the soft cluster spreads
    // over the whole head (the ip_01 read: a lit green head on a navy body); 3x3 variants keep a dark head
    if (o.headLit) for (const j of [3, 4]) { const c = out.skin[j]; const kk = (j === 4 ? 125 : 122) / Math.max(1, c[1]); out.skin[j] = c.map((v) => clamp(Math.round(v * kk), 0, 255)); }
    out.star = T ? T.star.map(hexRGB) : [pal.ramps.hair[3], pal.ramps.hair[4], pal.ramps.glass[3], pal.ramps.hair[2], pal.ramps.skin[3], pal.ramps.skin[2]].map((c) => c.map(Math.round));
    out.speck = T ? hexRGB(T.speck || T.star[2]) : out.star[2];
    out.edge = hexRGB(T ? T.edge : pal.base.outline);
    return out;
  }

  // Highlight stamps by size class, as [dx, dy, tone] with dx lateral (across the bug) and dy along it; tone: 1 core,
  // 0 arm, 3 inner halo, 4 tip, 'h' soft halo (the halo tone at 50% alpha over the shell: still reads bright, so the 5x5
  // and 7x5 clusters are 20-35 px soft blobs), 'd' dim corner (30% alpha: the 3x3 stays an 8 px cluster, never > 8).
  const STAMPS = (() => {
    const P = [];
    const s3 = [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, -1, 3], [1, -1, 3], [-1, 1, 3], [1, 1, 'd']];
    const s5 = [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, -1, 3], [1, -1, 3], [-1, 1, 3], [1, 1, 3],
      [-2, 0, 4], [2, 0, 4], [0, -2, 4], [0, 2, 4]];
    for (const [dx, dy] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]]) s5.push([dx, dy, 'h']); // octagon: no corners
    const s7 = [[0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, -1, 3], [1, -1, 3], [-1, 1, 3], [1, 1, 3],
      [-2, 0, 4], [2, 0, 4], [0, -2, 4], [0, 2, 4], [-2, -1, 4], [2, -1, 4], [-2, 1, 4], [2, 1, 4]];
    for (const [dx, dy] of [[-3, 0], [3, 0], [-3, -1], [3, -1], [-3, 1], [3, 1], [-1, -2], [1, -2], [-1, 2], [1, 2], [-2, -2], [2, -2], [-2, 2], [2, 2], [-3, -2], [3, -2], [-3, 2], [3, 2]]) s7.push([dx, dy, 'h']);
    // 3x3 that takes a merged speck: two dim corners, so plus + speck stays an 8 px cluster
    P[3] = s3; P[5] = s5; P[7] = s7; P[4] = s3.map((e) => (e[0] === 1 && e[1] === -1 ? [1, -1, 'd'] : e));
    return P;
  })();
  // screen-space forward vector of each sheet row (S, SE, E, NE, N, NW, W, SW)
  const ROWF = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]].map(([x, y]) => { const l = Math.hypot(x, y); return [x / l, y / l]; });

  // opts: cell (px), star (bool), variant (VARIANTS entry), seed (speck placement), palette (name),
  // edgeAlpha (255 = full rim), toneK (chitin value scale), cols (columns per row)
  function finish(canvas, pal, opts = {}) {
    const g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const N = opts.cell || Math.round(H / 8);
    const img = g.getImageData(0, 0, W, H), d = img.data;
    const V = opts.variant || VARIANTS[clamp(opts.shade | 0, 0, 2)];
    const T = tonesFor(pal, opts.palette, V, { toneK: opts.toneK, headLit: !!opts.star && V.star >= 5 });
    const outl = unpack(pal.outline);
    // source colour -> [class, ramp index]; renderer-derived colours (dusk rim light, depth lines) included
    const src = new Map();
    const add = (c, v) => { const kk = keyRGB(c); if (!src.has(kk)) src.set(kk, v); };
    for (const m of ['hair', 'accent', 'glass', ...CHITIN]) pal.pack[m].forEach((c, i) => add(unpack(c), [m, i]));
    for (const m of [...CHITIN, 'hair']) {
      const r = pal.ramps[m];
      add(mixRGB(r[3], [170, 200, 255], 0.35), [m, 4]);
      add(mixRGB(outl, r[0], 0.5), [m, 0]);
    }
    const chit = [];
    src.forEach((v, kk) => { if (CHITIN.includes(v[0])) chit.push([kk & 255, (kk >> 8) & 255, (kk >> 16) & 255, v]); });
    const lookup = (r, gg, b) => {
      const kk = r | (gg << 8) | (b << 16);
      let v = src.get(kk);
      if (v) return v;
      let best = 1e9;
      for (const c of chit) { const e = (c[0] - r) ** 2 + (c[1] - gg) ** 2 + (c[2] - b) ** 2; if (e < best) { best = e; v = c[3]; } }
      src.set(kk, v);
      return v;
    };
    const isOut = (i) => d[i] === outl[0] && d[i + 1] === outl[1] && d[i + 2] === outl[2];
    const NP = W * H;
    const kind = new Uint8Array(NP);     // 0 empty, 1 body, 2 outline
    const cls = new Int8Array(NP).fill(-1), idx = new Int8Array(NP), seed = new Uint8Array(NP);
    const set = (i, c) => { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; };
    for (let p = 0, i = 0; p < NP; p++, i += 4) {
      if (d[i + 3] === 0) continue;
      if (d[i + 3] === 255 && isOut(i)) { kind[p] = 2; continue; }
      kind[p] = 1; d[i + 3] = 255;
      const [m, k] = lookup(d[i], d[i + 1], d[i + 2]);
      const ci = CHITIN.indexOf(m);
      if (ci >= 0) { cls[p] = ci; idx[p] = k; set(i, T[m][k]); continue; }
      if (m === 'hair') {
        if (opts.star) { seed[p] = 1; cls[p] = 3; idx[p] = 3; set(i, T.skin[3]); } else set(i, T.star[k >= 4 ? 1 : 0]);
      } else if (m === 'accent') {
        if (opts.star) { cls[p] = 3; idx[p] = 4; set(i, T.skin[4]); } else set(i, T.star[0]);
      } else set(i, T.star[2]); // glass: spit glob, big-bug eyes
    }
    // despeckle: a 1 px line of one tone between two pixels of another tone of the same class takes their tone
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x, c = cls[p];
      if (c < 0 || seed[p]) continue;
      let u = -1;
      if (cls[p - 1] === c && cls[p + 1] === c && idx[p - 1] === idx[p + 1] && idx[p - 1] !== idx[p]) u = idx[p - 1];
      else if (cls[p - W] === c && cls[p + W] === c && idx[p - W] === idx[p + W] && idx[p - W] !== idx[p]) u = idx[p - W];
      if (u >= 0) { idx[p] = u; set(p * 4, T[CHITIN[c]][u]); }
    }
    const cols = opts.cols || Math.round(W / N), rows = Math.round(H / N);
    // 2-tone lit cap (small bugs): along the facing axis of each cell, the front third of the carapace (primary) is
    // one tone step lighter and the rear third one step darker, so the shell has a lit fore-back and a shadowed abdomen
    if (opts.star) {
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        const f = ROWF[cy % 8];
        let s0 = 1e9, s1 = -1e9;
        for (let y = cy * N; y < cy * N + N; y++) for (let x = cx * N; x < cx * N + N; x++) {
          const p = y * W + x; if (cls[p] !== 0) continue;
          const s = x * f[0] + y * f[1]; if (s < s0) s0 = s; if (s > s1) s1 = s;
        }
        if (s1 - s0 < 3) continue;
        for (let y = cy * N; y < cy * N + N; y++) for (let x = cx * N; x < cx * N + N; x++) {
          const p = y * W + x; if (cls[p] !== 0) continue;
          const u = (x * f[0] + y * f[1] - s0) / (s1 - s0);
          const k = u > 2 / 3 ? Math.min(4, idx[p] + 1) : u < 1 / 3 ? Math.max(0, idx[p] - 1) : idx[p];
          if (k !== idx[p]) { idx[p] = k; set(p * 4, T.primary[k]); }
        }
      }
    }
    // edges
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : kind[y * W + x]);
    const full = (opts.edgeAlpha | 0) >= 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (kind[p] !== 2) continue;
      const i = p * 4;
      const ring = at(x - 1, y) === 0 || at(x + 1, y) === 0 || at(x, y - 1) === 0 || at(x, y + 1) === 0;
      if (!ring) { set(i, T.primary[0]); continue; } // interior depth line: the shell's deepest tone
      set(i, T.edge);
      if (full) { d[i + 3] = 255; continue; }
      const below = at(x, y + 1) === 1, above = at(x, y - 1) === 1, side = at(x - 1, y) === 1 || at(x + 1, y) === 1;
      d[i + 3] = below ? 0 : above ? 150 : side ? 70 : 0;
    }
    // one highlight per cell on the head seed (size class from the variant) + 1-3 pale-cyan specks on the shell
    if (opts.star) {
      const rng = MF.mulberry32 ? MF.mulberry32(opts.seed | 0) : (() => { let s = (opts.seed | 0) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
      const stamp = (V.star === 3 && V.speckMode === 'merge' ? STAMPS[4] : STAMPS[V.star]) || STAMPS[5];
      const spill = V.star >= 5; // big clusters may glow 1 px past the silhouette
      const paint = (x, y, c, any) => {
        const k = at(x, y);
        if (k === 1 || (any && k === 2) || (spill && k === 0 && x >= 0 && y >= 0 && x < W && y < H)) { const i = (y * W + x) * 4; set(i, c); d[i + 3] = 255; if (k !== 1) kind[y * W + x] = 1; return true; }
        return false;
      };
      // blend c over the pixel at alpha a; cap: 'dim' keeps the result under the bright cut, 'lit' lifts it over
      const blend = (x, y, c, a, cap) => {
        const k0 = at(x, y);
        if (k0 !== 1 && !(cap === 'lit' && (k0 === 2 || (k0 === 0 && x >= 0 && y >= 0 && x < W && y < H)))) return false;
        const i = (y * W + x) * 4;
        if (k0 === 0) { for (let j = 0; j < 3; j++) d[i + j] = T.primary[1][j]; } // glow past the silhouette: over a dark shell tone
        if (k0 !== 1) { d[i + 3] = 255; kind[y * W + x] = 1; } // the soft halo spills over the shadow edge
        const o = [0, 1, 2].map((j) => d[i + j] * (1 - a) + c[j] * a);
        const kk = cap === 'dim' && o[1] > 112 ? 112 / o[1] : cap === 'lit' && o[1] < 121 ? 121 / Math.max(1, o[1]) : cap === 'lit' && o[1] > 127 ? 127 / o[1] : 1;
        for (let j = 0; j < 3; j++) d[i + j] = clamp(Math.round(o[j] * kk), 0, 255);
        return true;
      };
      // speck offsets per row (body frame: lateral, along), fixed across a row's frames; jittered <= 1 px per frame
      const nSp = clamp(V.specks | 0, 0, 3);
      const speckOff = [];
      for (let r = 0; r < 8; r++) {
        const L = [];
        for (let k = 0; k < nSp; k++) L.push([(rng() * 2 - 1) * 0.62, -0.15 - rng() * 0.75]);
        speckOff.push(L);
      }
      for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
        let sx = 0, sy = 0, n = 0;
        const pts = [];
        for (const want of [1, 0]) {
          for (let y = cy * N; y < cy * N + N; y++) for (let x = cx * N; x < cx * N + N; x++) {
            const p = y * W + x;
            if (want ? seed[p] : cls[p] === 3) { sx += x; sy += y; n++; pts.push([x, y]); }
          }
          if (n) break;
        }
        if (!n) continue;
        const mx = sx / n, my = sy / n;
        let bx = pts[0][0], by = pts[0][1], bd = 1e9;
        for (const [x, y] of pts) { const e = (x - mx) ** 2 + (y - my) ** 2; if (e < bd) { bd = e; bx = x; by = y; } }
        const f = ROWF[cy % 8];
        // the cluster sits 1 px further back so it lands on the head and pronotum, not in the air
        {
          const nx = bx - Math.round(f[0]), ny = by - Math.round(f[1]);
          if (at(nx, ny) === 1) { bx = nx; by = ny; }
        }
        // lateral axis: the stamp's dx runs across the bug (the 7x5 blob is wide across, short along)
        const lx = -f[1], ly = f[0];
        const axisX = Math.abs(lx) >= Math.abs(ly);
        // soft blobs (5x5, 7x5): the arms are the #96cc86 arm tone half-mixed into the inner halo, so the blob is
        // one soft mass around a single hot core; the 3x3 keeps crisp full-strength arms
        const tone = { 0: V.star >= 5 ? mixRGB(T.star[0], T.star[3], 0.5) : T.star[0], 1: T.star[1], 3: T.star[3], 4: T.star[4] };
        const halo = [];
        for (const [a, b, t] of stamp) {
          const x = bx + (axisX ? a : b), y = by + (axisX ? b : a);
          if (t === 'h' || t === 'd') halo.push([x, y, t === 'h' ? 0.5 : 0.3]);
          else paint(x, y, tone[t], t === 0 || t === 1 || t === 3);
        }
        for (const [x, y, a] of halo) blend(x, y, T.star[5], a, a < 0.5 ? 'dim' : 'lit');
        // specks: body centre of the cell (shell pixels), then offsets in the body frame (half-extents)
        if (!nSp) continue;
        let qx = 0, qy = 0, qn = 0, e0 = 1e9, e1 = -1e9, w0 = 1e9, w1 = -1e9;
        for (let y = cy * N; y < cy * N + N; y++) for (let x = cx * N; x < cx * N + N; x++) {
          const p = y * W + x; if (cls[p] !== 0 && cls[p] !== 1) continue;
          qx += x; qy += y; qn++;
          const s = x * f[0] + y * f[1], l = x * lx + y * ly;
          if (s < e0) e0 = s; if (s > e1) e1 = s; if (l < w0) w0 = l; if (l > w1) w1 = l;
        }
        if (!qn) continue;
        qx /= qn; qy /= qn;
        const hl = (e1 - e0) / 2, hw = (w1 - w0) / 2;
        // specks form one small chain per bug (1-3 adjacent 1 px specks = a 1-3 px pale-cyan fleck, like the ref's);
        // on 7x5 variants the chain starts against the blob's edge so it reads as part of the soft cluster.
        const [ol, oa] = speckOff[cy % 8][0];
        const jx = Math.floor(rng() * 3) - 1, jy = jx === 0 ? Math.floor(rng() * 3) - 1 : 0; // <= 1 px per frame
        let x0, y0;
        if (V.speckMode === 'merge') {
          const side = ol < 0 ? -1 : 1, ext = (STAMPS[V.star] || STAMPS[5]).reduce((m, e) => Math.max(m, Math.abs(e[0])), 0) + 1;
          x0 = bx + (axisX ? side * ext : 0); y0 = by + (axisX ? 0 : side * ext);
        } else {
          x0 = Math.round(qx + lx * ol * hw + f[0] * oa * hl) + jx; y0 = Math.round(qy + ly * ol * hw + f[1] * oa * hl) + jy;
        }
        const clear = V.speckMode === 'merge' ? -1 : (V.star >= 7 ? 4 : V.star >= 5 ? 3 : 2) + 1;
        const okAt = (X, Y) => {
          const p = Y * W + X;
          if (X < cx * N || Y < cy * N || X >= cx * N + N || Y >= cy * N + N) return false;
          if (kind[p] !== 1 || cls[p] < 0 || cls[p] === 3) return false;
          return Math.max(Math.abs(X - bx), Math.abs(Y - by)) > clear;
        };
        let x = x0, y = y0, ok = false;
        if (V.speckMode === 'merge') {
          // nearest on-shell pixel to (x0, y0) that touches a bright pixel of the stamp, so the fleck joins the blob
          let best = 1e9;
          for (let ddy = -4; ddy <= 4; ddy++) for (let ddx = -4; ddx <= 4; ddx++) {
            const X = x0 + ddx, Y = y0 + ddy;
            if (!okAt(X, Y) || d[(Y * W + X) * 4 + 1] > 120) continue;
            const touch = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([u, v]) => at(X + u, Y + v) === 1 && d[((Y + v) * W + X + u) * 4 + 1] > 120);
            const e = ddx * ddx + ddy * ddy;
            if (touch && e < best) { best = e; x = X; y = Y; ok = true; }
          }
        } else for (let rr = 0; rr <= 2 && !ok; rr++) for (let ddy = -rr; ddy <= rr && !ok; ddy++) for (let ddx = -rr; ddx <= rr && !ok; ddx++) {
          if (okAt(x0 + ddx, y0 + ddy)) { x = x0 + ddx; y = y0 + ddy; ok = true; }
        }
        if (!ok) continue;
        blend(x, y, T.speck, 200 / 255);
        // the rest of the chain: step along the bug's lateral axis (then its long axis) from the first speck
        const steps = axisX ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const done = [[x, y]];
        for (let k = 1; k < nSp; k++) {
          const [px0, py0] = done[done.length - 1];
          const st = steps.find(([u, v]) => okAt(px0 + u, py0 + v) && !done.some(([a2, b2]) => a2 === px0 + u && b2 === py0 + v));
          if (!st) break;
          done.push([px0 + st[0], py0 + st[1]]);
          blend(px0 + st[0], py0 + st[1], T.speck, 200 / 255);
        }
      }
    }
    g.putImageData(img, 0, 0);
  }

  MF.Bugs = { SPECIES, OPT, LBL, PALETTES: Object.keys(ALIEN), TONES, SHADES, VARIANTS, STAMPS, bakeSheet, finish, tonesFor, lungeCurve, ovoid };

  // Route MFApp.buildSheet(bugUnit, { cell: <number> }) through bakeSheet so fixed cells never clip a bug.
  // app.js publishes MFApp at the end of its own (synchronous) init, before DOMContentLoaded fires.
  function wrapApp() {
    const A = window.MFApp;
    if (!A || !A.buildSheet || A.buildSheet.__bugRaw) return;
    const raw = A.buildSheet;
    const wrapped = function (u, opts = {}) {
      if (u && u.bp && u.bp.line === 'bug' && opts.cell !== 'auto' && opts.cell != null) {
        return bakeSheet(A, u, Object.assign({}, opts, { pitch: A.S.settings.pitch, finish: opts.finish }));
      }
      return raw(u, opts);
    };
    wrapped.__bugRaw = raw;
    A.buildSheet = wrapped;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wrapApp);
  else setTimeout(wrapApp, 0);
})();
