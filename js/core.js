// Mecha Factory — core: RNG, transforms, palettes, convex primitives, rig nodes.
// Everything hangs off the global MF namespace so the app runs from file:// with plain <script> tags.
(function () {
  const MF = (window.MF = window.MF || {});

  // ---------------------------------------------------------------- RNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  class RNG {
    constructor(seed) { this.f = mulberry32(seed >>> 0); }
    next() { return this.f(); }
    range(a, b) { return a + (b - a) * this.f(); }
    int(a, b) { return Math.floor(this.range(a, b + 1)); }
    pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
    chance(p) { return this.f() < p; }
    // weighted pick from {key: weight}
    weighted(obj) {
      let total = 0; for (const k in obj) total += obj[k];
      let r = this.f() * total;
      for (const k in obj) { r -= obj[k]; if (r <= 0) return k; }
      return Object.keys(obj)[0];
    }
  }
  MF.RNG = RNG;
  MF.randomSeed = () => (Math.random() * 0xffffffff) >>> 0;

  // ---------------------------------------------------------------- transforms
  // Rigid transform stored as Float64Array(12): row-major 3x3 rotation then translation.
  const mat = () => { const m = new Float64Array(12); m[0] = m[4] = m[8] = 1; return m; };

  // R = Ry(ry) * Rx(rx) * Rz(rz)
  function matFromEuler(o, px, py, pz, rx, ry, rz) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    o[0] = cy * cz + sy * sx * sz; o[1] = -cy * sz + sy * sx * cz; o[2] = sy * cx;
    o[3] = cx * sz;               o[4] = cx * cz;                o[5] = -sx;
    o[6] = -sy * cz + cy * sx * sz; o[7] = sy * sz + cy * sx * cz; o[8] = cy * cx;
    o[9] = px; o[10] = py; o[11] = pz;
    return o;
  }
  function matMul(o, a, b) {
    const r0 = a[0] * b[0] + a[1] * b[3] + a[2] * b[6], r1 = a[0] * b[1] + a[1] * b[4] + a[2] * b[7], r2 = a[0] * b[2] + a[1] * b[5] + a[2] * b[8];
    const r3 = a[3] * b[0] + a[4] * b[3] + a[5] * b[6], r4 = a[3] * b[1] + a[4] * b[4] + a[5] * b[7], r5 = a[3] * b[2] + a[4] * b[5] + a[5] * b[8];
    const r6 = a[6] * b[0] + a[7] * b[3] + a[8] * b[6], r7 = a[6] * b[1] + a[7] * b[4] + a[8] * b[7], r8 = a[6] * b[2] + a[7] * b[5] + a[8] * b[8];
    const tx = a[0] * b[9] + a[1] * b[10] + a[2] * b[11] + a[9];
    const ty = a[3] * b[9] + a[4] * b[10] + a[5] * b[11] + a[10];
    const tz = a[6] * b[9] + a[7] * b[10] + a[8] * b[11] + a[11];
    o[0] = r0; o[1] = r1; o[2] = r2; o[3] = r3; o[4] = r4; o[5] = r5; o[6] = r6; o[7] = r7; o[8] = r8;
    o[9] = tx; o[10] = ty; o[11] = tz;
    return o;
  }
  MF.mat = mat; MF.matFromEuler = matFromEuler; MF.matMul = matMul;

  // ---------------------------------------------------------------- colour
  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb([h, s, l]) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // rotate hue h toward target by at most amt degrees
  function hueToward(h, target, amt) {
    let d = ((target - h + 540) % 360) - 180;
    if (Math.abs(d) < amt) return target;
    return h + Math.sign(d) * amt;
  }
  // Pixel-art ramp: 5 swatches [deepest, dark, base, light, highlight] with hue shifting
  // (shadows lean toward blue/violet, lights toward warm yellow).
  function makeRamp(hex, opts = {}) {
    const [h, s, l] = rgbToHsl(hexToRgb(hex));
    const step = opts.step || 0.12;
    const shift = opts.shift == null ? 9 : opts.shift;
    const out = [];
    for (let i = -2; i <= 2; i++) {
      let hh = h, ss = s, ll;
      if (i < 0) {
        hh = hueToward(h, 255, shift * -i);
        ss = Math.min(1, s * (1 + 0.08 * -i));
        ll = l * Math.pow(0.7, -i) - 0.02 * -i;
      } else if (i > 0) {
        hh = hueToward(h, 55, shift * i * 0.8);
        ss = Math.min(1, s * (1 + 0.04 * i));
        ll = l + (1 - l) * (i === 1 ? 0.2 : 0.46);
      } else ll = l;
      out.push(hslToRgb([hh, Math.max(0, ss), Math.max(0.02, Math.min(0.97, ll))]));
    }
    return out;
  }
  const packRGBA = (r, g, b, a = 255) => ((a << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
  MF.color = { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, makeRamp, packRGBA };

  // Palette presets. Base colours feed the ramp generator; everything is editable in the UI.
  MF.PALETTES = {
    'Rust Crab':    { primary: '#8c2d45', secondary: '#d27838', metal: '#5b5c6b', accent: '#ff7a3d', glass: '#8fd0ff', outline: '#22111b', bg: '#d9d1c4', floor: '#c7bdae' },
    'Snowcat':      { primary: '#c3cad6', secondary: '#6b7890', metal: '#3a3c55', accent: '#78e2ff', glass: '#5fd2ff', outline: '#181524', bg: '#4b3f5e', floor: '#3e3450' },
    'Jade Sentinel':{ primary: '#3e6a5c', secondary: '#b8494b', metal: '#2b3634', accent: '#e8b33c', glass: '#c6ecec', outline: '#18221f', bg: '#9ad8c8', floor: '#85c5b5' },
    'Desert Ops':   { primary: '#b99c64', secondary: '#687047', metal: '#433d35', accent: '#ff5b39', glass: '#9be7d8', outline: '#201914', bg: '#dcc093', floor: '#c9a978' },
    'Hazard':       { primary: '#e5b12c', secondary: '#34333d', metal: '#4d4d59', accent: '#ff3d3d', glass: '#7fe0ff', outline: '#16151b', bg: '#3a3944', floor: '#302f39' },
    'Navy Knight':  { primary: '#dfe5ee', secondary: '#2f5cbc', metal: '#2b3042', accent: '#ffd23f', glass: '#76f0ff', outline: '#141826', bg: '#27314a', floor: '#212a40' },
    'Toxic':        { primary: '#56663a', secondary: '#c8d33c', metal: '#2e2d34', accent: '#a2ff4d', glass: '#b7ff7a', outline: '#141610', bg: '#262a22', floor: '#20241c' },
    'Crimson Ronin':{ primary: '#b3242f', secondary: '#2c2733', metal: '#4b4655', accent: '#ffe066', glass: '#ff9f8a', outline: '#150f15', bg: '#1f1b24', floor: '#1a1720' },
    'Midnight':     { primary: '#3c4066', secondary: '#8b5dd8', metal: '#262638', accent: '#ff4fd8', glass: '#6ff7ff', outline: '#0d0c16', bg: '#17151f', floor: '#13111a' },
    'Olive Drab':   { primary: '#6b7443', secondary: '#c9b98b', metal: '#383932', accent: '#ffb347', glass: '#a8e0ff', outline: '#16170f', bg: '#8c8a78', floor: '#7d7b69' },
  };

  // Build render-ready palette: RGB ramps per material + packed outline/floor colours.
  MF.buildPalette = function (base) {
    const ramps = {
      primary: makeRamp(base.primary),
      secondary: makeRamp(base.secondary),
      metal: makeRamp(base.metal, { shift: 6 }),
      accent: makeRamp(base.accent, { shift: 4 }),
      glass: makeRamp(base.glass, { shift: 4 }),
    };
    const pack = {};
    for (const k in ramps) pack[k] = ramps[k].map((c) => packRGBA(c[0], c[1], c[2]));
    const o = hexToRgb(base.outline);
    const bg = hexToRgb(base.bg);
    // floor tiles: [seam, base, alt, lit edge] — low contrast so mechs pop
    const fh = rgbToHsl(hexToRgb(base.floor));
    const fl = [
      hslToRgb([hueToward(fh[0], 255, 6), Math.min(1, fh[1] * 1.1), fh[2] * 0.72]),
      hslToRgb(fh),
      hslToRgb([fh[0], fh[1], Math.min(0.97, fh[2] * 1.05 + 0.008)]),
      hslToRgb([hueToward(fh[0], 55, 4), fh[1] * 0.95, Math.min(0.97, fh[2] * 1.12 + 0.02)]),
    ];
    return {
      base, ramps, pack,
      outline: packRGBA(o[0], o[1], o[2]),
      bg: packRGBA(bg[0], bg[1], bg[2]),
      bgHex: base.bg,
      floor: fl.map((c) => packRGBA(c[0], c[1], c[2])),
    };
  };

  // ---------------------------------------------------------------- convex primitives
  // Every primitive is a convex polytope: a list of planes (n·p <= d is inside) in its own local frame.
  // Boxes can have edges/corners cut (chamfers, wedges). Frustums cover cylinders, cones, barrels.
  class Prim {
    constructor(planes, half, opts) {
      this.np = planes.length / 4;
      this.planes = new Float64Array(planes);
      this.hx = half[0]; this.hy = half[1]; this.hz = half[2];
      this.brad = Math.hypot(half[0], half[1], half[2]);
      this.mat = opts.mat || 'primary';
      this.detail = opts.detail || null;
      this.shadow = opts.shadow !== false;
      this.local = matFromEuler(mat(), ...(opts.at || [0, 0, 0]), ...(opts.rot || [0, 0, 0]));
      this.world = mat();
      this.node = null;
      this.kind = opts.kind || 'box';
      this.axis = opts.axis || 'y';
      // per-frame scratch
      this.inv = new Float64Array(12);
      this.frame = new Float64Array(this.np * 4); // den, a, b, c per plane
      this.v = new Float64Array(12); // o00, exl, eyl, dl
    }
  }

  // w,h,d: full size. cuts: [[ax,ay,az,depth], ...]
  function boxPlanes(hx, hy, hz, cuts) {
    const p = [1, 0, 0, hx, -1, 0, 0, hx, 0, 1, 0, hy, 0, -1, 0, hy, 0, 0, 1, hz, 0, 0, -1, hz];
    if (cuts) for (const [ax, ay, az, c] of cuts) {
      const len = Math.hypot(ax, ay, az);
      if (!len || c <= 0) continue;
      const d = (Math.abs(ax) * hx + Math.abs(ay) * hy + Math.abs(az) * hz - c) / len;
      p.push(ax / len, ay / len, az / len, d);
    }
    return p;
  }

  // chamfer presets for boxes
  const EDGES = {
    all: [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0],[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1],[0,1,1],[0,1,-1],[0,-1,1],[0,-1,-1]],
    vert: [[1,0,1],[1,0,-1],[-1,0,1],[-1,0,-1]],
    top: [[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]],
    bottom: [[1,-1,0],[-1,-1,0],[0,-1,1],[0,-1,-1]],
    front: [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1]],
    frontTop: [[0,1,1]],
    frontBottom: [[0,-1,1]],
    backTop: [[0,1,-1]],
    sidesTop: [[1,1,0],[-1,1,0]],
    ends: [[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]], // z-ends (tank treads)
    xends: [[1,1,0],[1,-1,0],[-1,1,0],[-1,-1,0]],
  };
  function chamfer(set, c, list = []) {
    for (const e of EDGES[set]) list.push([e[0], e[1], e[2], c]);
    return list;
  }

  function makeBox(w, h, d, opts = {}) {
    const hx = w / 2, hy = h / 2, hz = d / 2;
    let cuts = opts.cuts ? opts.cuts.slice() : [];
    if (opts.bevel) cuts = chamfer(opts.bevelSet || 'all', opts.bevel, cuts);
    return new Prim(boxPlanes(hx, hy, hz, cuts), [hx, hy, hz], { ...opts, kind: 'box' });
  }

  // n-sided frustum along axis; r1 at -len/2, r2 at +len/2 (apothem radii)
  function makeFrustum(axis, r1, r2, len, opts = {}) {
    const n = opts.sides || 8;
    const L = len / 2, k = (r2 - r1) / len;
    const p = [];
    const put = (radA, radB, ax, d) => {
      // (radA, radB) radial components, ax axial
      let v;
      if (axis === 'y') v = [radA, ax, radB];
      else if (axis === 'x') v = [ax, radA, radB];
      else v = [radA, radB, ax];
      p.push(v[0], v[1], v[2], d);
    };
    const off = opts.twist != null ? opts.twist : 0;
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * Math.PI * 2 + off;
      const c = Math.cos(phi), s = Math.sin(phi);
      const nl = Math.hypot(1, k);
      put(c / nl, s / nl, -k / nl, (r1 + r2) / 2 / nl);
    }
    put(0, 0, 1, L); put(0, 0, -1, L);
    const R = Math.max(r1, r2) / Math.cos(Math.PI / n);
    const half = axis === 'y' ? [R, L, R] : axis === 'x' ? [L, R, R] : [R, R, L];
    return new Prim(p, half, { ...opts, kind: 'frustum', axis });
  }

  MF.makeBox = makeBox; MF.makeFrustum = makeFrustum; MF.chamfer = chamfer; MF.Prim = Prim;

  // ---------------------------------------------------------------- rig nodes
  class Node {
    constructor(name, pos = [0, 0, 0], rot = [0, 0, 0]) {
      this.name = name;
      this.pos = pos.slice(); this.rot = rot.slice();
      this.base = { pos: pos.slice(), rot: rot.slice() };
      this.children = []; this.prims = [];
      this.local = mat(); this.world = mat();
    }
    add(child) { this.children.push(child); return child; }
    child(name, pos, rot) { return this.add(new Node(name, pos, rot)); }
    box(w, h, d, opts) { const p = makeBox(w, h, d, opts); p.node = this; this.prims.push(p); return p; }
    cyl(axis, r, len, opts = {}) { const p = makeFrustum(axis, r, r, len, opts); p.node = this; this.prims.push(p); return p; }
    cone(axis, r1, r2, len, opts = {}) { const p = makeFrustum(axis, r1, r2, len, opts); p.node = this; this.prims.push(p); return p; }
    reset() { this.pos = this.base.pos.slice(); this.rot = this.base.rot.slice(); for (const c of this.children) c.reset(); }
  }
  MF.Node = Node;

  // Update world matrices under a parent transform and collect prims.
  MF.updateRig = function (node, parentWorld, out) {
    matFromEuler(node.local, node.pos[0], node.pos[1], node.pos[2], node.rot[0], node.rot[1], node.rot[2]);
    matMul(node.world, parentWorld, node.local);
    for (const p of node.prims) { matMul(p.world, node.world, p.local); out.push(p); }
    for (const c of node.children) MF.updateRig(c, node.world, out);
    return out;
  };

  MF.findNodes = function (root) {
    const map = {};
    (function walk(n) { map[n.name] = n; n.children.forEach(walk); })(root);
    return map;
  };
})();
