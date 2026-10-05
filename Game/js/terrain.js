// Game/js/terrain.js: painterly ground, organic impassable masses, spreading creep, map data and passability.
// Owner: terrain piece. Plain script, registers onto window.IP (load order: engine, terrain, ...).
//
// Usage from a scenario (terrain is opt-in; a scenario that never calls generate() gets an open map):
//   IP.terrain.generate(world, { biome: 'basalt' | 'bog', seed, w, h,
//                                count /* masses, default 6-10 */, arenas /* open arenas, default 3 */,
//                                keepClear: [{x, y, r}] /* hive/base spots kept open */,
//                                masses: [{x, y, rx, ry, rot, kind:'rock'|'crater'|'bank'}] /* explicit layout */ });
//   -> world.map = { w, h, cell: 32, cols, rows, blocked: Uint8Array }   (1 = impassable cell)
//   -> world.terrain = { biome, masses, arenas, creep: [...], vignette, quality, paintMs, ... }
// Queries (all safe without terrain: the map is then open):
//   IP.terrain.passable(world, x, y)            fine mask (4 px), false outside the map
//   IP.terrain.sdf(world, x, y)                 signed px distance to impassable terrain (+ free, - inside)
//   IP.terrain.collide(world, ent, r)           pushes a circle {x, y} out of terrain; returns true if moved
//   IP.terrain.flowTo(world, x, y)              cached flow field toward (x, y):
//        { cell, cols, rows, dx: Float32Array, dy: Float32Array, dist: Float32Array, tx, ty, dir(x, y) -> [dx, dy] }
//   IP.terrain.nearestFree(world, x, y)         {x, y} of the closest passable point
//   IP.terrain.los(world, x0, y0, x1, y1)       true if the segment does not cross impassable terrain
//   IP.terrain.creepAt(world, x, y)             0..1
//   IP.terrain.growCreep(world, x, y, r)        grows (never shrinks) the creep patch at (x, y) to radius r
//   IP.terrain.setCreep(world, x, y, r)         sets the radius exactly (0 removes it; e.g. on hive capture)
//   IP.terrain.check(world)                     { minGap, minEdgeGap, blockedFrac, masses, paintMs } (debug/tests)
// Drawing: ground layer (wash, detail, creep, painted mass tiles) + an optional screen-space vignette
// (world.terrain.vignette = 0 turns it off). world.terrain.debug = true overlays blocked cells.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;

  const TAU = Math.PI * 2;
  const CELL = 32;  // pathing grid (world px)
  const LR = 4;     // fine mask / SDF / ground wash resolution (world px per sample)
  const TILE = 1024; // painted mass tiles (world px)
  const PAD = 48;   // painted margin around each tile so blurs and strokes never seam
  const LIGHT = [-0.55, -0.83]; // dusk key light from the top-left (unit vector toward the light)

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const hex = (s) => { const n = parseInt(s.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const css = (c, a) => (a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
  const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
  function gauss(rng) { return (rng() + rng() + rng() + rng() - 2) * 1.2247; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  const now = () => (window.performance ? performance.now() : 0);

  // ------------------------------------------------------------------ palettes (docs/WORLD-LOOK.md, retuned per the round-3 brief)
  const BIOMES = {
    basalt: {
      ground: { base: hex('#151418'), mottle: hex('#1e1b22'), dark: hex('#0a090c'), light: hex('#332d38'), haze: hex('#291c2f') },
      gp: { pool: 0.72, mottle: 0.24, haze: 0.5, halo: 0.18, hazeCell: 260 },
      detail: { over: 0.55, light: [88, 80, 96], blotch: 0.085, fine: 0.05, dapple: 0.02, speckle: 0.0025, speckleAmp: 0.09 },
      rock: {
        fill: hex('#211d20'), light: hex('#352e34'), dark: hex('#141114'), seamL: hex('#463c4d'), seamD: hex('#151118'),
        band: hex('#62257a'), bandDim: hex('#3a1f4a'), bandHot: hex('#8a35a0'), bloom: hex('#7a2470'),
        ring: hex('#82256c'), ringHot: hex('#b0408e'), ringDark: hex('#4e1546'), floor: hex('#1b161d'),
      },
      creep: { dark: hex('#2e1836'), mid: hex('#5e2250'), bright: hex('#9a3478'), dots: hex('#4fe0d0'), strength: 1 },
      vignette: 0.26,
    },
    bog: {
      ground: { base: hex('#302e15'), mottle: hex('#56491d'), dark: hex('#1e210e'), light: hex('#806a2b'), haze: hex('#3e441c') },
      gp: { pool: 0.85, mottle: 0.12, haze: 0.35, halo: 0.42, hazeCell: 300 },
      detail: { over: 0.4, light: [150, 132, 70], blotch: 0.075, fine: 0.035, dapple: 0.035, speckle: 0.002, speckleAmp: 0.07 },
      bank: {
        fill: hex('#464621'), dark: hex('#262810'), hairD: hex('#1a1f0b'), hairL: hex('#6c7232'),
        rimD: hex('#46491a'), rim: hex('#71762f'), rimHot: hex('#9c9c48'),
        tendril: hex('#9a9d4c'), tendrilHot: hex('#c9c97e'), tendrilEdge: hex('#262a0e'),
      },
      creep: { dark: hex('#3a2230'), mid: hex('#6a2a48'), bright: hex('#a8406a'), dots: hex('#4fe0d0'), strength: 0.7 },
      vignette: 0.3,
    },
  };

  // ------------------------------------------------------------------ deterministic value noise
  function makeNoise(rng) {
    const N = 256, M = 255, v = new Float32Array(N * N);
    for (let i = 0; i < v.length; i++) v[i] = rng();
    // raw value noise in lattice units, period = per (power of two <= 256) for tileable textures
    function raw(x, y, per) {
      const m = per ? per - 1 : M;
      const xi = Math.floor(x), yi = Math.floor(y);
      let fx = x - xi, fy = y - yi;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = xi & m, y0 = yi & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m;
      const a = v[y0 * N + x0], b = v[y0 * N + x1], c = v[y1 * N + x0], d = v[y1 * N + x1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    // a normalised [0,1] fBm field at `cell` world px, stretched by sampled 1st/99th percentiles
    function field(cell, oct, pers, per) {
      oct = oct || 1; pers = pers || 0.5;
      const ox = rng() * 256, oy = rng() * 256, inv = 1 / cell;
      let tot = 0;
      for (let o = 0, a = 1; o < oct; o++, a *= pers) tot += a;
      const itot = 1 / tot;
      const f = (x, y) => {
        let s = 0, a = 1, fx = x * inv + ox, fy = y * inv + oy, p = per;
        for (let o = 0; o < oct; o++) { s += a * raw(fx, fy, p); a *= pers; fx *= 2; fy *= 2; if (p) p = Math.min(256, p * 2); }
        return s * itot;
      };
      if (per) { // tileable fields: per is the period in lattice cells; keep offsets on the lattice
        const fo = (x, y) => {
          let s = 0, a = 1, fx = x * inv, fy = y * inv, p = per;
          for (let o = 0; o < oct; o++) { s += a * raw(fx + ox, fy + oy, p); a *= pers; fx *= 2; fy *= 2; p = Math.min(256, p * 2); }
          return s * itot;
        };
        return stretch(fo);
      }
      return stretch(f);
    }
    function stretch(f) {
      const xs = [];
      const r2 = mulberry(Math.floor(rng() * 4294967296));
      for (let i = 0; i < 1500; i++) xs.push(f(r2() * 20000, r2() * 20000));
      xs.sort((a, b) => a - b);
      const lo = xs[15], hi = xs[1485], k = 1 / Math.max(1e-6, hi - lo);
      const g = (x, y) => { const t = (f(x, y) - lo) * k; return t < 0 ? 0 : t > 1 ? 1 : t; };
      return g;
    }
    return { raw, field };
  }
  const mulberry = (s) => IP.mulberry32(s >>> 0);

  // ------------------------------------------------------------------ exact Euclidean distance transform (Felzenszwalb)
  function edt(feat, w, h) {
    const INF = 1e20, n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = feat[i] ? 0 : INF;
    const dt = (len) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let p = v[k], s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
        while (s <= z[k]) { k--; p = v[k]; s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; }
    };
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = out[y * w + x];
      dt(h);
      for (let y = 0; y < h; y++) out[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) f[x] = out[o + x];
      dt(w);
      for (let x = 0; x < w; x++) out[o + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  // ------------------------------------------------------------------ layout: organic masses, corridors >= 160 px, open arenas
  function ellPt(m, t, k, add) {
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const ex = (m.rx * k + (add || 0)) * Math.cos(t), ey = (m.ry * k + (add || 0)) * Math.sin(t);
    return [m.x + ex * c - ey * s, m.y + ex * s + ey * c];
  }
  function reachPts(m) { // conservative outline of everything the mass may paint as impassable
    const pts = [];
    const k = m.kind === 'bank' ? 1.0 : 1.12, add = m.kind === 'bank' ? 56 : 8;
    for (const e of [m].concat(m.subs || [])) for (let i = 0; i < 48; i++) pts.push(ellPt(e, (i / 48) * TAU, k, add));
    return pts;
  }
  function layout(rng, W, H, biome, o) {
    // GAP is measured between conservative reach outlines; the painted masses sit well inside them,
    // so real corridors come out >= ~200 px (IP.terrain.check reports the true minimum)
    const GAP = biome === 'bog' ? 150 : 100, EDGE_OUT = -40, EDGE_IN = 190;
    const area = (W * H) / (3840 * 2160);
    const want = o.count != null ? o.count : clamp(Math.round((6 + rng() * 4) * clamp(area, 0.75, 1.25)), 6, 10);
    const arenas = [];
    const keep = (o.keepClear || []).map((k) => ({ x: k.x, y: k.y, r: k.r || 200 }));
    const nA = o.arenas != null ? o.arenas : 3;
    const masses = [];
    const fits = (m) => {
      const pts = reachPts(m);
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const [x, y] of pts) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      const sideOk = (g) => g <= EDGE_OUT || g >= EDGE_IN;
      if (!sideOk(minX) || !sideOk(W - maxX) || !sideOk(minY) || !sideOk(H - maxY)) return false;
      if (maxX < 60 || minX > W - 60 || maxY < 60 || minY > H - 60) return false; // mostly off-map
      for (const c of arenas.concat(keep)) {
        if (Math.hypot(c.x - m.x, c.y - m.y) < c.r + Math.min(m.rx, m.ry)) return false;
        for (const [x, y] of pts) if (Math.hypot(x - c.x, y - c.y) < c.r) return false;
      }
      const inEll = (e, x, y, k) => { const c = Math.cos(e.rot), s = Math.sin(e.rot), dx = x - e.x, dy = y - e.y; const u = (dx * c + dy * s) / (e.rx * k), v = (-dx * s + dy * c) / (e.ry * k); return u * u + v * v < 1; };
      for (const q of masses) {
        if (inEll(q, m.x, m.y, 1.3) || inEll(m, q.x, q.y, 1.3)) return false;
        if (Math.hypot(q.x - m.x, q.y - m.y) > Math.max(q.rx, q.ry) + Math.max(m.rx, m.ry) + 200 + GAP) continue;
        const qp = q._reach || (q._reach = reachPts(q));
        for (const [x, y] of pts) for (const [qx, qy] of qp) if ((x - qx) * (x - qx) + (y - qy) * (y - qy) < GAP * GAP) return false;
      }
      return true;
    };
    const arenaFits = (x, y, r) => {
      if (arenas.some((a) => Math.hypot(a.x - x, a.y - y) < a.r + r + 260)) return false;
      for (const q of masses) { const qp = q._reach || (q._reach = reachPts(q)); for (const [px, py] of qp) if (Math.hypot(px - x, py - y) < r) return false; if (Math.hypot(q.x - x, q.y - y) < r + Math.min(q.rx, q.ry)) return false; }
      return true;
    };
    const mk = (x, y, big, kind) => {
      let rx, ry;
      if (kind === 'crater') { rx = 105 + rng() * 55; ry = rx * (0.85 + rng() * 0.15); }
      else if (big) { rx = 360 + rng() * 320; ry = rx * (0.42 + rng() * 0.36); }
      else { rx = 150 + rng() * 170; ry = rx * (0.5 + rng() * 0.45); }
      const m = { x, y, rx, ry, rot: (rng() - 0.5) * Math.PI, kind };
      if (kind === 'bank') { // 0-2 satellite lobes make winding, organic masses rather than ellipses
        m.subs = [];
        for (let i = 0, n = Math.floor(rng() * 3); i < n; i++) {
          const a = rng() * TAU, srx = rx * (0.35 + rng() * 0.25), sub = { rx: srx, ry: srx * (0.55 + rng() * 0.4), rot: rng() * Math.PI };
          const p = ellPt(m, a, 0.62 + rng() * 0.25);
          sub.x = p[0]; sub.y = p[1];
          m.subs.push(sub);
        }
      }
      return m;
    };
    const kindOf = () => (biome === 'bog' ? 'bank' : 'rock');
    // arena 0 sits near the centre so the default camera opens on a fight space framed by terrain
    if (nA > 0) arenas.push({ x: W / 2 + (rng() - 0.5) * 300, y: H / 2 + (rng() - 0.5) * 200, r: 230 + rng() * 60 });
    const a0 = arenas[0] || { x: W / 2, y: H / 2, r: 260 };
    let craters = biome === 'basalt' ? (o.craters != null ? o.craters : 1 + (rng() < 0.5 ? 1 : 0)) : 0;
    // feature masses framing the central arena (what the default 1920x1080 camera sees)
    const base = rng() * TAU, nf = 4;
    for (let f = 0; f < nf && masses.length < want; f++) {
      const kind = craters > 0 && f === 1 ? 'crater' : kindOf();
      for (let i = 0; i < 40; i++) {
        const ang = base + (f * TAU) / nf + (rng() - 0.5) * 0.7;
        const m = mk(0, 0, kind !== 'crater' && (f % 2 === 0 || rng() < 0.4), kind);
        let ok = false;
        for (let d = a0.r + Math.min(m.rx, m.ry) * 0.6; d < a0.r + Math.max(m.rx, m.ry) * 1.3 + 400; d += 30) {
          const nx = a0.x + Math.cos(ang) * d * 1.35, ny = a0.y + Math.sin(ang) * d * 0.8;
          for (const q of m.subs || []) { q.x += nx - m.x; q.y += ny - m.y; }
          m.x = nx; m.y = ny;
          if (fits(m)) { ok = true; break; }
        }
        if (ok) { masses.push(m); if (kind === 'crater') craters--; break; }
      }
    }
    for (let tries = 0; arenas.length < nA && tries < 600; tries++) {
      const r = 260 + rng() * 140, x = r + rng() * (W - 2 * r), y = r + rng() * (H - 2 * r);
      if (arenaFits(x, y, r)) arenas.push({ x, y, r });
    }
    for (let tries = 0; masses.length < want && tries < 2000; tries++) {
      const big = rng() < 0.5;
      const kind = craters > 0 && rng() < 0.3 ? 'crater' : kindOf();
      const m = mk(-0.12 * W + rng() * 1.24 * W, -0.12 * H + rng() * 1.24 * H, big, kind);
      if (fits(m)) { masses.push(m); if (kind === 'crater') craters--; }
    }
    for (const m of masses) delete m._reach;
    return { masses, arenas, keep };
  }

  // ------------------------------------------------------------------ geometry per mass (world coords, deterministic)
  function rockPolygon(m, rng, N, n, kmin, kmax) {
    const ts = [];
    for (let i = 0; i < n; i++) ts.push(rng() * TAU);
    ts.sort((a, b) => a - b);
    const base = rng() * TAU;
    const verts = ts.map((t, i) => {
      const tt = t * 0.6 + (base + (i / n) * TAU) * 0.4;
      return ellPt(m, tt, kmin + rng() * (kmax - kmin));
    });
    return verts;
  }
  // subdivide straight edges and displace along the edge normal so the contour is painted, not ruled
  function roughen(verts, N, amp1, amp2, step) {
    const out = [];
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = verts[i], [x1, y1] = verts[(i + 1) % n];
      const L = Math.hypot(x1 - x0, y1 - y0), segs = Math.max(1, Math.round(L / step));
      const nx = -(y1 - y0) / (L || 1), ny = (x1 - x0) / (L || 1);
      for (let s = 0; s < segs; s++) {
        const t = s / segs, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const d = (N.w1(x, y) - 0.5) * 2 * amp1 + (N.w2(x, y) - 0.5) * 2 * amp2;
        out.push(x + nx * d, y + ny * d);
      }
    }
    return out;
  }
  function polyPath(p, path) {
    path = path || new Path2D();
    path.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
    path.closePath();
    return path;
  }
  function polyArea(p) { let a = 0; for (let i = 0, n = p.length; i < n; i += 2) { const j = (i + 2) % n; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }
  function bboxOf(p, pad) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < p.length; i += 2) { if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1]; }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  function buildRock(m, rng, N) {
    const crater = m.kind === 'crater';
    let verts = rockPolygon(m, rng, N, crater ? 14 : 7 + Math.floor(rng() * 5), crater ? 0.92 : 0.74, crater ? 1.05 : 1.08);
    if (!crater) { // 1-3 concave bites: notch an edge inward
      const bites = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < bites; b++) {
        const k = Math.floor(rng() * verts.length), [ax, ay] = verts[k], [bx, by] = verts[(k + 1) % verts.length];
        const depth = (0.12 + rng() * 0.18) * Math.min(m.rx, m.ry);
        const t0 = 0.2 + rng() * 0.2, t1 = 0.6 + rng() * 0.2;
        const pull = (t, f) => { const x = ax + (bx - ax) * t, y = ay + (by - ay) * t; const dx = m.x - x, dy = m.y - y, l = Math.hypot(dx, dy) || 1; return [x + (dx / l) * depth * f, y + (dy / l) * depth * f]; };
        verts.splice(k + 1, 0, pull(t0, 0.7 + rng() * 0.3), pull((t0 + t1) / 2, 1), pull(t1, 0.5 + rng() * 0.4));
      }
    }
    const pts = roughen(verts, N, 6, 1.6, 9);
    if (polyArea(pts) < 0) { // keep a consistent winding (clockwise in screen space)
      const r = [];
      for (let i = pts.length - 2; i >= 0; i -= 2) r.push(pts[i], pts[i + 1]);
      pts.length = 0; pts.push(...r);
    }
    const R = { m, kind: m.kind, pts, verts, path: polyPath(pts), bbox: bboxOf(pts, 0) };
    R.glow = crater ? 1 : 0.35 + rng() * 0.65; // per-rock rim intensity (ip_02: dim thin lines; ip_09: bright bands)
    if (crater) {
      const inner = rockPolygon({ x: m.x + (rng() - 0.5) * m.rx * 0.16, y: m.y + (rng() - 0.5) * m.ry * 0.16, rx: m.rx * 0.8, ry: m.ry * 0.8, rot: m.rot }, rng, N, 11, 0.9, 1.07);
      R.inner = roughen(inner, N, 3, 1.2, 8);
      R.innerPath = polyPath(R.inner);
      R.cloudOuter = [];
      for (let i = 0; i < pts.length; i += 2) {
        const dx = pts[i] - m.x, dy = pts[i + 1] - m.y, l = Math.hypot(dx, dy) || 1;
        const k = Math.max(0, (N.w2(pts[i] * 1.7, pts[i + 1] * 1.7) - 0.35)) * 12 + Math.max(0, N.w3(pts[i], pts[i + 1]) - 0.5) * 10;
        R.cloudOuter.push(pts[i] + (dx / l) * k, pts[i + 1] + (dy / l) * k);
      }
    }
    return R;
  }

  function buildBank(m, rng) {
    const parts = [m].concat(m.subs || []);
    const lobes = [];
    const cores = parts.map((e) => ({ x: e.x, y: e.y, rx: e.rx * 0.9, ry: e.ry * 0.9, rot: e.rot, c: Math.cos(e.rot), s: Math.sin(e.rot) }));
    const field = (q, x, y) => { const dx = x - q.x, dy = y - q.y; const u = (dx * q.c + dy * q.s) / q.rx, v = (-dx * q.s + dy * q.c) / q.ry; return u * u + v * v; };
    const inCore = (x, y, skip) => { for (let i = 0; i < cores.length; i++) if (i !== skip && field(cores[i], x, y) < 1) return true; return false; };
    parts.forEach((e, pi) => {
      const per = Math.PI * (3 * (e.rx + e.ry) - Math.sqrt((3 * e.rx + e.ry) * (e.rx + 3 * e.ry)));
      const n = Math.max(8, Math.round(per / 36));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU + gauss(rng) * (0.5 / n);
        const p = ellPt(e, t, 0.84 + rng() * 0.16);
        if (cores.some((q, qi) => qi !== pi && field(q, p[0], p[1]) < 0.7)) continue; // buried inside another part
        lobes.push([p[0], p[1], 18 + rng() * 38]);
      }
      const nin = Math.max(3, Math.round((Math.PI * e.rx * e.ry) / 5500));
      for (let i = 0; i < nin; i++) {
        const t = rng() * TAU, s2 = Math.sqrt(0.05 + rng() * 0.7);
        const p = ellPt(e, t, s2);
        lobes.push([p[0], p[1], 26 + rng() * 20]);
      }
    });
    const inLobe = (x, y, skip) => { for (let j = 0; j < lobes.length; j++) { if (j === skip) continue; const l = lobes[j]; const dx = x - l[0], dy = y - l[1]; if (dx * dx + dy * dy < (l[2] - 0.6) * (l[2] - 0.6)) return true; } return false; };
    const path = new Path2D();
    for (const l of lobes) { path.moveTo(l[0] + l[2], l[1]); path.arc(l[0], l[1], l[2], 0, TAU); }
    for (const q of cores) { path.moveTo(q.x + q.rx * q.c, q.y + q.rx * q.s); path.ellipse(q.x, q.y, q.rx, q.ry, q.rot, 0, TAU); }
    // outer contour samples (x, y, outward normal, lobe index) every ~3 px
    const edge = [];
    lobes.forEach((l, i) => {
      const k = Math.max(12, Math.round((TAU * l[2]) / 3));
      for (let j = 0; j < k; j++) {
        const a = (j / k) * TAU, nx = Math.cos(a), ny = Math.sin(a), x = l[0] + nx * l[2], y = l[1] + ny * l[2];
        if (inCore(x, y, -1) || inLobe(x, y, i)) continue;
        edge.push({ x, y, nx, ny, lobe: i });
      }
    });
    cores.forEach((q, qi) => {
      const per = Math.PI * (3 * (q.rx + q.ry) - Math.sqrt((3 * q.rx + q.ry) * (q.rx + 3 * q.ry)));
      const k = Math.round(per / 3);
      for (let j = 0; j < k; j++) {
        const t = (j / k) * TAU, ex = q.rx * Math.cos(t), ey = q.ry * Math.sin(t);
        const x = q.x + ex * q.c - ey * q.s, y = q.y + ex * q.s + ey * q.c;
        if (inLobe(x, y, -1) || inCore(x, y, qi)) continue;
        const gx = Math.cos(t) / q.rx, gy = Math.sin(t) / q.ry;
        const nx = gx * q.c - gy * q.s, ny = gx * q.s + gy * q.c, l = Math.hypot(nx, ny) || 1;
        edge.push({ x, y, nx: nx / l, ny: ny / l, lobe: -1 });
      }
    });
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const l of lobes) { x0 = Math.min(x0, l[0] - l[2]); y0 = Math.min(y0, l[1] - l[2]); x1 = Math.max(x1, l[0] + l[2]); y1 = Math.max(y1, l[1] + l[2]); }
    for (const q of cores) { const r = Math.max(q.rx, q.ry); x0 = Math.min(x0, q.x - r); y0 = Math.min(y0, q.y - r); x1 = Math.max(x1, q.x + r); y1 = Math.max(y1, q.y + r); }
    return { m, kind: 'bank', lobes, cores, path, edge, bbox: { x0, y0, x1, y1 } };
  }

  // ------------------------------------------------------------------ masks, SDF and the pathing grid
  function rasterMask(T) {
    const gw = T.gw, gh = T.gh;
    const c = canvas(gw, gh), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff';
    x.setTransform(1 / LR, 0, 0, 1 / LR, 0, 0);
    for (const M of T.shapes) x.fill(M.path);
    const d = x.getImageData(0, 0, gw, gh).data;
    const mask = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    return mask;
  }
  function buildFields(world, T) {
    const gw = T.gw, gh = T.gh, mask = T.mask;
    const inv = new Uint8Array(gw * gh);
    for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
    const dOut = edt(mask, gw, gh), dIn = edt(inv, gw, gh);
    const sdf = new Float32Array(gw * gh);
    for (let i = 0; i < sdf.length; i++) sdf[i] = mask[i] ? -(dIn[i] - 0.5) * LR : (dOut[i] - 0.5) * LR;
    T.sdf = sdf;
    // 32 px pathing cells: blocked when at least half of the fine samples are
    const m = world.map, cols = Math.ceil(m.w / CELL), rows = Math.ceil(m.h / CELL), k = CELL / LR;
    const blocked = new Uint8Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let b = 0, t = 0;
      for (let y = cy * k; y < Math.min(gh, (cy + 1) * k); y++) for (let x = cx * k; x < Math.min(gw, (cx + 1) * k); x++) { t++; b += mask[y * gw + x]; }
      blocked[cy * cols + cx] = t && b * 2 >= t ? 1 : 0;
    }
    // seal enclosed pockets: free cells not connected to the largest open region can never be reached
    const lab = new Int32Array(cols * rows).fill(-1), sizes = [];
    const st = [];
    for (let i = 0; i < blocked.length; i++) {
      if (blocked[i] || lab[i] >= 0) continue;
      const id = sizes.length; let n = 0; st.push(i); lab[i] = id;
      while (st.length) {
        const c = st.pop(); n++;
        const cx = c % cols, cy = (c / cols) | 0;
        if (cx > 0 && !blocked[c - 1] && lab[c - 1] < 0) { lab[c - 1] = id; st.push(c - 1); }
        if (cx < cols - 1 && !blocked[c + 1] && lab[c + 1] < 0) { lab[c + 1] = id; st.push(c + 1); }
        if (cy > 0 && !blocked[c - cols] && lab[c - cols] < 0) { lab[c - cols] = id; st.push(c - cols); }
        if (cy < rows - 1 && !blocked[c + cols] && lab[c + cols] < 0) { lab[c + cols] = id; st.push(c + cols); }
      }
      sizes.push(n);
    }
    let main = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;
    T.sealed = 0;
    for (let i = 0; i < blocked.length; i++) if (!blocked[i] && lab[i] !== main) { blocked[i] = 1; T.sealed++; }
    Object.assign(m, { cell: CELL, cols, rows, blocked });
    T.blocked0 = blocked;
  }

  // ------------------------------------------------------------------ ground wash (LR) and the tileable detail texture
  function paintGround(T, B, N) {
    const gw = T.gw, gh = T.gh, G = B.ground, P = B.gp;
    const c = canvas(gw, gh), x = c.getContext('2d');
    const img = x.createImageData(gw, gh), d = img.data;
    const wa = N.field(160, 2), wb = N.field(160, 2);
    const drift = N.field(320, 2), pool = N.field(230, 2), mot = N.field(60, 2), mot2 = N.field(24, 2);
    const haze = N.field(P.hazeCell, 3, 0.55), bstr = N.field(100, 1), bwid = N.field(120, 1), cloud = N.field(22, 2, 0.6);
    const bw1 = N.field(36, 2), bw2 = N.field(36, 2);
    const basalt = T.biome === 'basalt';
    const bloomC = basalt ? B.rock.bloom : null;
    const craters = T.shapes.filter((s) => s.kind === 'crater');
    for (let j = 0; j < gh; j++) {
      const wy = (j + 0.5) * LR;
      for (let i = 0; i < gw; i++) {
        const wx = (i + 0.5) * LR, k = j * gw + i;
        const qx = wx + (wa(wx, wy) - 0.5) * 80, qy = wy + (wb(wx, wy) - 0.5) * 80;
        const dr = drift(qx, qy);
        let r = G.base[0], g = G.base[1], b = G.base[2];
        let t = ss(0.42, 0.9, dr) * 0.85;
        r += (G.mottle[0] - r) * t; g += (G.mottle[1] - g) * t; b += (G.mottle[2] - b) * t;
        t = ss(0.38, 0.06, dr) * 0.6;
        r += (G.dark[0] - r) * t; g += (G.dark[1] - g) * t; b += (G.dark[2] - b) * t;
        t = ss(0.62, 0.95, pool(qx * 1.1 + 300, qy * 1.1)) * P.pool;
        r += (G.light[0] - r) * t; g += (G.light[1] - g) * t; b += (G.light[2] - b) * t;
        t = ss(0.45, 0.95, haze(qx, qy)) * P.haze;
        r += (G.haze[0] - r) * t; g += (G.haze[1] - g) * t; b += (G.haze[2] - b) * t;
        const mv = 1 + P.mottle * ((mot(wx, wy) - 0.5) * 2 * 0.7 + (mot2(qx, qy) - 0.5) * 2 * 0.5);
        r *= mv; g *= mv; b *= mv;
        const sd = T.sdf[k];
        const dout = sd > 0 ? sd : 0;
        if (!basalt) { // dark halo on the ground around each bank
          const h = 1 - P.halo * Math.exp(-dout / 36);
          r *= h; g *= h; b *= h;
        } else if (dout < 220) {
          // cloudy magenta bloom: strength 0-1 with a dead zone (a third of every contour has none), 9-30 px wide
          let force = 0;
          for (const cr of craters) { const e = Math.hypot((wx - cr.m.x) / (cr.m.rx * 1.7), (wy - cr.m.y) / (cr.m.ry * 1.7)); force = Math.max(force, clamp((1 - e) * 2.2, 0, 1)); }
          let s = ss(0.5, 0.82, bstr(wx, wy)) * 0.85;
          s = Math.max(s, force * 0.75);
          if (s > 0.01) {
            const wid = mix(9 + 21 * bwid(wx, wy), 24, force);
            const dw = Math.max(0, dout + (bw1(wx, wy) - 0.5) * 18 + (bw2(wx + 99, wy) - 0.5) * 10);
            const bl = s * Math.exp(-dw / wid) * (0.45 + 0.55 * cloud(wx, wy));
            const a = Math.min(1, bl * 1.1);
            r += (bloomC[0] - r) * a + bloomC[0] * bl * bl * 0.25; g += (bloomC[1] - g) * a + bloomC[1] * bl * bl * 0.25; b += (bloomC[2] - b) * a + bloomC[2] * bl * bl * 0.25;
          }
          const h = 1 - P.halo * Math.exp(-dout / 10) * (sd > 0 ? 1 : 0);
          r *= h; g *= h; b *= h;
        }
        d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  function paintDetail(B, N, size) {
    // tileable value-only detail: 2-6 px blotch mottle, 9 px dapple, sparse 1-2 px dust speckle.
    // Each texel either darkens (black, alpha) or lightens (biome light tint, alpha), drawn over the wash.
    const D = B.detail, c = canvas(size, size), x = c.getContext('2d');
    const img = x.createImageData(size, size), d = img.data;
    const bl = N.field(16, 2, 0.55, size / 16), bl2 = N.field(32, 1, 0.5, size / 32), dap = N.field(8, 1, 0.5, size / 8), fn = N.field(4, 1, 0.5, size / 4);
    const sp = mulberry(0x5eed + size);
    const L = D.light;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let v = (bl(i, j) - 0.5) * 2 * D.blotch * (0.6 + 0.8 * bl2(i, j)) + (dap(i, j) - 0.5) * 2 * D.dapple + (fn(i, j) - 0.5) * 2 * (D.fine || 0) * bl2(i, j);
      if (sp() < D.speckle) v += D.speckleAmp * (0.4 + 0.6 * sp());
      if (v < 0) { d[k * 4] = 0; d[k * 4 + 1] = 0; d[k * 4 + 2] = 0; d[k * 4 + 3] = Math.min(255, -v * 255); }
      else { d[k * 4] = L[0]; d[k * 4 + 1] = L[1]; d[k * 4 + 2] = L[2]; d[k * 4 + 3] = Math.min(255, v * 255 * 1.4); }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------------ brushes (pre-rendered soft dabs, tinted per colour)
  const brushCache = new Map();
  function softDisc(rgb, hard, key) {
    const id = 'disc:' + rgb.join(',') + ':' + hard + (key || '');
    let c = brushCache.get(id);
    if (c) return c;
    const S = 64; c = canvas(S, S); const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, css(rgb, 1)); g.addColorStop(hard, css(rgb, 0.75)); g.addColorStop(1, css(rgb, 0));
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    brushCache.set(id, c);
    return c;
  }
  // a lit puff: highlight toward the key light, body, soft darker skirt (bank rims, crater ring, cauliflower lumps)
  function puff(hi, mid, lo, id) {
    const key = 'puff:' + id;
    let c = brushCache.get(key);
    if (c) return c;
    const S = 64; c = canvas(S, S); const x = c.getContext('2d');
    const g = x.createRadialGradient(S * 0.36, S * 0.32, 0, S * 0.5, S * 0.5, S * 0.5);
    g.addColorStop(0, css(hi, 1)); g.addColorStop(0.42, css(mid, 1)); g.addColorStop(0.78, css(lo, 0.92)); g.addColorStop(1, css(lo, 0));
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    brushCache.set(key, c);
    return c;
  }
  // cauliflower lump: a cluster of soft lit bumps (crater ring, bank rims)
  function cauli(hi, mid, lo, id) {
    const key = 'cauli:' + id;
    let c = brushCache.get(key);
    if (c) return c;
    const S = 64; c = canvas(S, S); const x = c.getContext('2d'), r = mulberry(IP.hash(key));
    for (let i = 0; i < 9; i++) {
      const a = r() * TAU, d = S * (0.04 + r() * 0.2), rr = S * (0.13 + r() * 0.12);
      const cx = S / 2 + Math.cos(a) * d, cy = S / 2 + Math.sin(a) * d;
      const g = x.createRadialGradient(cx - rr * 0.35, cy - rr * 0.4, 0, cx, cy, rr);
      g.addColorStop(0, css(hi, 1)); g.addColorStop(0.5, css(mid, 1)); g.addColorStop(0.85, css(lo, 0.9)); g.addColorStop(1, css(lo, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
    }
    brushCache.set(key, c);
    return c;
  }
  function dab(ctx, img, x, y, r, a) { ctx.globalAlpha = a; ctx.drawImage(img, x - r, y - r, 2 * r, 2 * r); }

  // ------------------------------------------------------------------ basalt rock brushwork (precomputed per rock)
  function planRock(R, rng, N, T, B) {
    const C = B.rock, bb = R.bbox, crater = R.kind === 'crater';
    const inside = (x, y) => T.sdfAt(x, y) < -2;
    // 3-5 broad dry-brush facets: Voronoi regions of a few anchors, each scanned with parallel jittered strokes
    const nf = crater ? 3 : 3 + Math.floor(rng() * 3);
    const anchors = [];
    for (let t = 0; anchors.length < nf && t < 200; t++) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), y = bb.y0 + rng() * (bb.y1 - bb.y0);
      if (inside(x, y)) anchors.push({ x, y, ang: -0.6 + gauss(rng) * 0.5 + (rng() < 0.3 ? Math.PI / 2 : 0), lvl: [-1, -0.45, 0.4, 1][Math.floor(rng() * 4)] });
    }
    const own = (x, y) => { let best = 0, bd = 1e18; for (let i = 0; i < anchors.length; i++) { const a = anchors[i]; const dx = (x - a.x) + (N.w3(x, y) - 0.5) * 70, dy = (y - a.y) + (N.w4(x, y) - 0.5) * 70; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; };
    const strokes = [];
    const diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
    // sponge/dry-brush dabs: irregular soft blobs laid on a jittered grid, each taking its facet's value
    // (owner decided at the dab centre, so facet borders interleave raggedly instead of being ruled)
    const dabs = [];
    const sp = 32;
    for (let y = bb.y0; y < bb.y1; y += sp) for (let x = bb.x0; x < bb.x1; x += sp) {
      const cx = x + rng() * sp, cy = y + rng() * sp;
      if (T.sdfAt(cx, cy) > 6) continue;
      const a = anchors[own(cx, cy)];
      if (!a) continue;
      const lv = clamp(a.lvl + gauss(rng) * 0.1, -1, 1);
      const col = lv > 0 ? mixc(C.fill, C.light, 0.6 * lv) : mixc(C.fill, C.dark, -0.6 * lv);
      const r = 30 + rng() * 34, n = 6 + Math.floor(rng() * 4), rot = rng() * TAU, el = 0.38 + rng() * 0.3;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const t = rot + (k / n) * TAU, rr = r * (0.6 + rng() * 0.4);
        const ex = Math.cos(t) * rr, ey = Math.sin(t) * rr * el;
        pts.push(cx + ex * Math.cos(a.ang) - ey * Math.sin(a.ang), cy + ex * Math.sin(a.ang) + ey * Math.cos(a.ang));
      }
      dabs.push({ pts, col, a: 0.7 + rng() * 0.25, x: cx, y: cy, r });
    }
    R.dabs = dabs;
    R.strokes = strokes;
    // soft dark and light blotches
    R.blots = [];
    for (let i = 0, n = Math.round(((bb.x1 - bb.x0) * (bb.y1 - bb.y0)) / 22000); i < n; i++) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), y = bb.y0 + rng() * (bb.y1 - bb.y0);
      if (!inside(x, y)) continue;
      R.blots.push({ x, y, r: 16 + rng() * 40, dark: rng() < 0.6, a: 0.12 + rng() * 0.16 });
    }
    // short soft seams: tapered, slightly bent strokes, mostly following a facet boundary direction
    R.seams = [];
    const ns = crater ? 3 : 4 + Math.floor(rng() * 5);
    for (let i = 0, t = 0; i < ns && t < 60; t++) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), y = bb.y0 + rng() * (bb.y1 - bb.y0);
      if (T.sdfAt(x, y) > -12) continue;
      const a = -0.6 + gauss(rng) * 0.8, L = 26 + rng() * 90, bend = gauss(rng) * 0.004;
      const pts = [];
      let px = x, py = y, ang = a;
      for (let s = 0; s < L; s += 3) { pts.push(px, py); px += Math.cos(ang) * 3; py += Math.sin(ang) * 3; ang += bend * 3; if (T.sdfAt(px, py) > -6) break; }
      if (pts.length < 8) continue;
      R.seams.push({ pts, w: 2.4 + rng() * 2.4, light: rng() < 0.5, a: 0.18 + rng() * 0.18 });
      i++;
    }
    // rim band: contour chunks with their own width and intensity (soft 3-5 px glow band, absent on some stretches)
    const p = R.pts, n = p.length / 2;
    // which contour points are on the boundary of the union (overlapping rocks must not draw edges inside each other)
    R.exposed = new Uint8Array(n);
    let all = true;
    for (let i = 0; i < n; i++) { R.exposed[i] = T.sdfAt(p[i * 2], p[i * 2 + 1]) > -3.5 ? 1 : 0; if (!R.exposed[i]) all = false; }
    if (all) R.edgePath = R.path;
    else {
      R.edgePath = new Path2D();
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (R.exposed[i] && R.exposed[j]) { R.edgePath.moveTo(p[i * 2], p[i * 2 + 1]); R.edgePath.lineTo(p[j * 2], p[j * 2 + 1]); }
      }
    }
    R.chunks = [];
    if (!crater) {
      let i = 0;
      while (i < n) {
        const len = 3 + Math.floor(rng() * 4), j = Math.min(n, i + len);
        const cx = p[(i * 2) % p.length], cy = p[(i * 2 + 1) % p.length];
        const s = R.glow * (0.25 + 0.75 * ss(0.25, 0.75, N.band(cx, cy)));
        R.chunks.push({ i0: i, i1: j, w: 2.6 + 4.2 * s, s });
        i = j;
      }
    } else {
      // crater ring: dense lit puffs filling the annulus, cloudy lumps past the outer edge, one ring only
      R.puffs = [];
      const outer = R.pts, inner = R.inner;
      const no = outer.length / 2, ni = inner.length / 2;
      const steps = Math.round(no * 1.1);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const oi = Math.floor(t * no) * 2, ii = Math.floor(t * ni) * 2;
        const ox = outer[oi], oy = outer[oi + 1], ix = inner[ii], iy = inner[ii + 1];
        const bw = Math.hypot(ox - ix, oy - iy);
        for (let q = 0; q < 2; q++) {
          const u = q === 1 ? 0.9 + rng() * 0.3 : 0.1 + rng() * 0.85;
          const x = ix + (ox - ix) * u + gauss(rng) * 3, y = iy + (oy - iy) * u + gauss(rng) * 3;
          const lit = 0.5 + 0.5 * (((ox - ix) / bw) * LIGHT[0] + ((oy - iy) / bw) * LIGHT[1]);
          R.puffs.push({ x, y, r: (q === 1 ? 4 + rng() * 6 : 5 + rng() * 8) * (0.7 + 0.3 * Math.min(1, bw / 30)), u, tone: clamp(0.1 + 0.5 * u + 0.45 * (rng() - 0.5) + 0.3 * lit, 0, 1) });
        }
      }
      R.puffs.sort((a, b) => a.u - b.u);
    }
  }
  function drawRock(ctx, R, B, tb, scratch) {
    const C = B.rock, bb = R.bbox, crater = R.kind === 'crater';
    ctx.save();
    ctx.clip(R.path);
    ctx.fillStyle = css(C.fill); ctx.fillRect(bb.x0 - 4, bb.y0 - 4, bb.x1 - bb.x0 + 8, bb.y1 - bb.y0 + 8);
    if (crater) { ctx.globalAlpha = 0.15; ctx.fillStyle = css(C.floor); ctx.fill(R.innerPath); ctx.globalAlpha = 1; }
    // slab gradient across the rock
    const sa = R.m.rot + 0.9, cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, L = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
    const g = ctx.createLinearGradient(cx - Math.cos(sa) * L, cy - Math.sin(sa) * L, cx + Math.cos(sa) * L, cy + Math.sin(sa) * L);
    g.addColorStop(0, css(C.light, 0.2)); g.addColorStop(0.5, css(C.fill, 0)); g.addColorStop(1, css(C.dark, 0.32));
    ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    // dry-brush facets: strokes laid down hard in a scratch layer, then pulled in softly (blurred) through the clip
    const sx = scratch.getContext('2d');
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, scratch.width, scratch.height);
    sx.setTransform(ctx.getTransform());
    sx.lineCap = 'round';
    for (const s of R.strokes) {
      if (Math.max(s.x0, s.x1) < tb.x0 || Math.min(s.x0, s.x1) > tb.x1 || Math.max(s.y0, s.y1) < tb.y0 || Math.min(s.y0, s.y1) > tb.y1) continue;
      sx.globalAlpha = s.a; sx.strokeStyle = css(s.col); sx.lineWidth = s.w;
      sx.setLineDash(s.dash || []);
      sx.beginPath(); sx.moveTo(s.x0, s.y0); sx.lineTo(s.x1, s.y1); sx.stroke();
    }
    sx.setLineDash([]);
    for (const d of R.dabs) {
      if (d.x + d.r < tb.x0 || d.x - d.r > tb.x1 || d.y + d.r < tb.y0 || d.y - d.r > tb.y1) continue;
      sx.globalAlpha = d.a; sx.fillStyle = css(d.col);
      sx.beginPath(); sx.moveTo(d.pts[0], d.pts[1]);
      for (let i = 2; i < d.pts.length; i += 2) sx.lineTo(d.pts[i], d.pts[i + 1]);
      sx.closePath(); sx.fill();
    }
    for (const b of R.blots) dab(sx, softDisc(b.dark ? C.dark : C.light, 0.35), b.x, b.y, b.r, b.a);
    sx.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'blur(2px)'; ctx.globalAlpha = 0.85; ctx.drawImage(scratch, 0, 0);
    ctx.restore();
    // seams: a wide faint stroke under a narrow one, both blurred, tapered by drawing the core shorter
    ctx.filter = 'blur(1.3px)';
    for (const s of R.seams) {
      const col = s.light ? C.seamL : C.seamD;
      ctx.strokeStyle = css(col);
      ctx.globalAlpha = s.a * 0.3; ctx.lineWidth = s.w * 2.6; seamPath(ctx, s.pts, 0, 1); ctx.stroke();
      ctx.globalAlpha = s.a; ctx.lineWidth = s.w; seamPath(ctx, s.pts, 0.15, 0.8); ctx.stroke();
    }
    ctx.filter = 'none';
    // inner dark edge (not on the crater, whose ring is lit paint)
    if (!crater) {
      ctx.filter = 'blur(7px)'; ctx.globalAlpha = 0.42; ctx.strokeStyle = css(C.dark); ctx.lineWidth = 24; ctx.lineCap = 'round'; ctx.stroke(R.edgePath); ctx.filter = 'none';
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (crater) drawCrater(ctx, R, B);
  }
  function seamPath(ctx, p, a, b) {
    const n = p.length / 2, i0 = Math.floor(a * (n - 1)), i1 = Math.max(i0 + 1, Math.floor(b * (n - 1)));
    ctx.beginPath(); ctx.moveTo(p[i0 * 2], p[i0 * 2 + 1]);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
  }
  // the rim band, drawn per tile into a scratch layer then composited twice (wide soft glow + soft core)
  function drawBands(ctx, scratch, rocks, B, tb) {
    const C = B.rock;
    const sx = scratch.getContext('2d');
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, scratch.width, scratch.height);
    sx.setTransform(ctx.getTransform());
    sx.lineCap = 'round'; sx.lineJoin = 'round';
    let any = false;
    for (const R of rocks) {
      if (!R.chunks || !R.chunks.length) continue;
      const p = R.pts, n = p.length / 2;
      for (const ch of R.chunks) {
        const x0 = p[(ch.i0 % n) * 2], y0 = p[(ch.i0 % n) * 2 + 1];
        if (x0 < tb.x0 - 40 || x0 > tb.x1 + 40 || y0 < tb.y0 - 40 || y0 > tb.y1 + 40) continue;
        any = true;
        sx.strokeStyle = css(mixc(C.bandDim, ch.s > 0.75 ? mixc(C.band, C.bandHot, (ch.s - 0.75) * 2) : C.band, clamp(ch.s * 1.4, 0, 1)));
        sx.lineWidth = ch.w;
        sx.beginPath(); sx.moveTo(x0, y0);
        for (let i = ch.i0 + 1; i <= ch.i1; i++) {
          const k = (i % n) * 2;
          if (R.exposed[i % n] && R.exposed[(i - 1) % n]) sx.lineTo(p[k], p[k + 1]); else sx.moveTo(p[k], p[k + 1]);
        }
        sx.stroke();
      }
    }
    if (!any) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = 'blur(7px)'; ctx.globalAlpha = 0.45; ctx.drawImage(scratch, 0, 0);
    ctx.filter = 'blur(3px)'; ctx.globalAlpha = 0.3; ctx.drawImage(scratch, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'blur(1.5px)'; ctx.globalAlpha = 0.78; ctx.drawImage(scratch, 0, 0);
    ctx.filter = 'none';
    ctx.restore();
  }
  function drawCrater(ctx, R, B) {
    const C = B.rock;
    // floor shadow: the lip on the lit side throws a soft shadow into the pit
    ctx.save();
    ctx.clip(R.innerPath);
    const bb = bboxOf(R.inner, 4);
    const L = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2, cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const g = ctx.createLinearGradient(cx + LIGHT[0] * L, cy + LIGHT[1] * L, cx - LIGHT[0] * L, cy - LIGHT[1] * L);
    g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, css(C.light, 0.1));
    ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    ctx.filter = 'blur(7px)'; ctx.globalAlpha = 0.45; ctx.strokeStyle = '#0a070c'; ctx.lineWidth = 22; ctx.stroke(R.innerPath);
    ctx.filter = 'none';
    ctx.restore();
    // the ring: one solid painted band (cloud-edged outer contour minus floor), darker toward the pit,
    // pink catching the light on the outer lumps; soft dabs only (no shaded spheres)
    const ring = new Path2D();
    polyPath(R.cloudOuter, ring); ring.addPath(R.innerPath);
    ctx.save();
    ctx.filter = 'blur(1.4px)'; ctx.fillStyle = css(C.ring); ctx.globalAlpha = 0.96; ctx.fill(ring, 'evenodd');
    ctx.filter = 'none';
    ctx.clip(ring, 'evenodd');
    ctx.filter = 'blur(4px)'; ctx.globalAlpha = 0.75; ctx.strokeStyle = css(C.ringDark); ctx.lineWidth = 14; ctx.stroke(R.innerPath);
    ctx.filter = 'none';
    ctx.restore();
    const hot = softDisc(C.ringHot, 0.55), mid = softDisc(C.ring, 0.6), dk = softDisc(C.ringDark, 0.5);
    for (const p of R.puffs) { const h = p.tone > 0.62; dab(ctx, h ? hot : p.tone < 0.22 ? dk : mid, p.x, p.y, p.r * (h ? 1.6 : 1), p.u > 0.95 ? 0.75 : h ? 0.28 : 0.4); }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ bog bank brushwork
  function planBank(K, rng, N, T, B) {
    const bb = K.bbox, m = K.m;
    const sdfAt = T.sdfAt;
    const area = [m].concat(m.subs || []).reduce((a, e) => a + Math.PI * e.rx * e.ry, 0);
    // hair: dense short curly fur; density and lightness clump into 20-40 px tufts (N.clump), dark dominates
    const strands = [[], [], [], []]; // buckets: dark thick, dark thin, light, light faint
    const ns = Math.round(area / 13);
    for (let t = 0; t < ns; t++) {
      const x0 = bb.x0 + rng() * (bb.x1 - bb.x0), y0 = bb.y0 + rng() * (bb.y1 - bb.y0);
      if (sdfAt(x0, y0) > -5) continue;
      const clump = N.clump(x0, y0);
      if (rng() > 0.35 + 0.65 * clump) continue;
      let x = x0, y = y0, ang = N.flow(x0, y0) * TAU * 1.5 + gauss(rng) * 0.6;
      const k = (N.curv(x0, y0) - 0.5) * 0.18 + gauss(rng) * 0.08, L = 6 + rng() * 12;
      const pts = [x, y];
      for (let l = 0; l < L; l += 2.5) { x += Math.cos(ang) * 2.5; y += Math.sin(ang) * 2.5; ang += k * 2.5; if (sdfAt(x, y) > -3) break; pts.push(x, y); }
      if (pts.length < 6) continue;
      const light = rng() < 0.2 + 0.45 * clump * clump;
      strands[light ? (rng() < 0.5 ? 2 : 3) : (rng() < 0.4 ? 0 : 1)].push(pts);
    }
    // ringlets (the bar's fur is full of small curls)
    K.curls = [];
    for (let i = 0, n = Math.round(area / 650); i < n; i++) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), y = bb.y0 + rng() * (bb.y1 - bb.y0);
      if (sdfAt(x, y) > -8) continue;
      K.curls.push({ x, y, r: 2.5 + rng() * 4.5, a0: rng() * TAU, sweep: 3.8 + rng() * 2.2, light: rng() < 0.55 });
    }
    K.strands = strands;
    // soft value variation and inner darkening dabs
    K.dabs = [];
    for (let i = 0, n = Math.round(area / 1400); i < n; i++) {
      const x = bb.x0 + rng() * (bb.x1 - bb.x0), y = bb.y0 + rng() * (bb.y1 - bb.y0);
      const d = -sdfAt(x, y);
      if (d < 4) continue;
      const deep = ss(14, 100, d);
      K.dabs.push({ x, y, r: 22 + rng() * 40, dark: rng() < 0.45 + 0.5 * deep, a: 0.1 + 0.22 * (rng() * 0.5 + deep * 0.6) });
    }
    // interior lobe bumps (light toward the key light, a dark crescent opposite)
    K.bumps = K.lobes.filter((l) => sdfAt(l[0], l[1]) < -l[2] * 0.3).map((l) => ({ x: l[0], y: l[1], r: l[2] }));
    // rim: the cauliflower lip, strongest on south-facing edges (the bank is a raised mass seen from above).
    // Lumps are scattered at random depths through the lip band (normal from the SDF gradient), so they merge
    // into one band instead of radial columns.
    K.rim = [];
    const nrm = (x, y) => { const gx = sdfAt(x + 6, y) - sdfAt(x - 6, y), gy = sdfAt(x, y + 6) - sdfAt(x, y - 6), l = Math.hypot(gx, gy) || 1; return [gx / l, gy / l]; };
    for (const e of K.edge) { const n = nrm(e.x, e.y); e.gx = n[0]; e.gy = n[1]; }
    const nl = Math.round(K.edge.length * 2.0);
    for (let i = 0; i < nl && K.edge.length; i++) {
      const e = K.edge[Math.floor(rng() * K.edge.length)];
      const south = clamp((e.gy + 0.35) / 1.2, 0, 1), lit = 0.5 + 0.5 * (e.gx * LIGHT[0] + e.gy * LIGHT[1]);
      const band = 14 + 40 * south, d = Math.pow(rng(), 0.9) * band - 3, t = (rng() - 0.5) * 10;
      const x = e.x - e.gx * d - e.gy * t, y = e.y - e.gy * d + e.gx * t;
      const outer = 1 - clamp(d / band, 0, 1);
      K.rim.push({ x, y, r: 5.5 + rng() * 6 + 4 * south * outer, d, tone: clamp(0.25 + 0.5 * south * (0.35 + 0.65 * outer) + 0.2 * lit + (rng() - 0.5) * 0.35, 0, 1) });
    }
    K.rim.sort((a, b) => b.d - a.d);
    // a continuous soft lip under the lumps so they merge into one band, brightest on south-facing edges
    K.base = [];
    for (let i = 0; i < K.edge.length; i += 2) {
      const e = K.edge[i], south = clamp((e.gy + 0.35) / 1.2, 0, 1), band = 14 + 40 * south;
      K.base.push({ x: e.x - e.gx * band * 0.55, y: e.y - e.gy * band * 0.55, r: band * 0.95, a: 0.12 + 0.2 * south });
    }
    // tendrils: bunched along the contour, drooping south, 5-7 px at the base tapering to 2, many hooked at the tip
    K.tendrils = [];
    let acc = 0;
    for (let i = 0; i < K.edge.length; i++) {
      const e = K.edge[i];
      acc += 3;
      if (acc < 5) continue;
      acc = 0;
      const south = clamp((e.ny + 0.45) / 1.3, 0, 1);
      const bunch = ss(0.3, 0.7, N.bunch(e.x, e.y));
      if (rng() > (0.06 + 0.94 * south) * (0.3 + 0.7 * bunch)) continue;
      const droop = 0.65 * clamp(e.ny + 0.6, 0, 1);
      let dx = e.nx * (1 - droop), dy = e.ny * (1 - droop) + droop;
      const l0 = Math.hypot(dx, dy) || 1;
      let ang = Math.atan2(dy / l0, dx / l0) + gauss(rng) * 0.3;
      const L = (40 + rng() * 64) * (0.55 + 0.45 * south), w0 = 5 + rng() * 2.2;
      const side = rng() < 0.5 ? -1 : 1, k0 = side * (0.002 + rng() * 0.01);
      const hook = rng() < 0.75, hk = (0.13 + rng() * 0.08) * (rng() < 0.75 ? side : -side), hookAt = 0.62 + rng() * 0.1;
      const pts = [];
      let x = e.x - e.nx * 6, y = e.y - e.ny * 6;
      const step = 1.5, nst = Math.round((L * (hook ? 1.25 : 1)) / step);
      for (let s = 0; s <= nst; s++) {
        pts.push(x, y);
        const t = s / nst;
        x += Math.cos(ang) * step; y += Math.sin(ang) * step;
        ang += (k0 + (hook && t > hookAt ? hk * ss(hookAt, hookAt + 0.12, t) : 0)) * step + gauss(rng) * 0.01;
      }
      K.tendrils.push({ pts, w0, tone: clamp(0.35 + 0.5 * south + (rng() - 0.5) * 0.4, 0, 1), hook });
    }
  }
  function tendrilOutline(t, dx, dy) {
    const p = t.pts, n = p.length / 2, L = [], Rr = [];
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = p[b * 2] - p[a * 2], ty = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const u = i / (n - 1), w = Math.max(2.6, t.w0 * (1 - 0.55 * Math.pow(u, 0.9))) / 2;
      L.push(p[i * 2] - ty * w + dx, p[i * 2 + 1] + tx * w + dy);
      Rr.push(p[i * 2] + ty * w + dx, p[i * 2 + 1] - tx * w + dy);
    }
    const ex = p[(n - 1) * 2] + dx, ey = p[(n - 1) * 2 + 1] + dy;
    // reconnect into a single closed ribbon
    const rib = new Path2D();
    rib.moveTo(L[0], L[1]);
    for (let i = 2; i < L.length; i += 2) rib.lineTo(L[i], L[i + 1]);
    for (let i = Rr.length - 2; i >= 0; i -= 2) rib.lineTo(Rr[i], Rr[i + 1]);
    rib.closePath();
    rib.moveTo(ex + 1, ey); rib.arc(ex, ey, Math.max(1.9, t.w0 * 0.38) / 2 + 0.2, 0, TAU);
    return rib;
  }
  function inTile(b, tb, m) { return !(b.x1 + m < tb.x0 || b.x0 - m > tb.x1 || b.y1 + m < tb.y0 || b.y0 - m > tb.y1); }
  function drawTendrils(ctx, scratch, banks, B, tb) {
    const K = B.bank;
    // shadows first (blurred, offset away from the light), then the ribbons
    const sx = scratch.getContext('2d');
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, scratch.width, scratch.height);
    sx.setTransform(ctx.getTransform());
    sx.fillStyle = '#000';
    const live = [];
    for (const Kb of banks) for (const t of Kb.tendrils) {
      const x = t.pts[0], y = t.pts[1];
      if (x < tb.x0 - 140 || x > tb.x1 + 140 || y < tb.y0 - 140 || y > tb.y1 + 140) continue;
      live.push(t);
      sx.fill(tendrilOutline(t, 3, 5));
    }
    if (!live.length) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'blur(3px)'; ctx.globalAlpha = 0.26; ctx.drawImage(scratch, 0, 0); ctx.filter = 'none';
    ctx.restore();
    // ribbons into the scratch layer, then composited with a slight softening
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(0, 0, scratch.width, scratch.height);
    sx.setTransform(ctx.getTransform());
    sx.lineJoin = 'round'; sx.lineCap = 'round';
    for (const t of live) {
      const rib = tendrilOutline(t, 0, 0);
      sx.globalAlpha = 0.6; sx.strokeStyle = css(K.tendrilEdge); sx.lineWidth = 1.2; sx.stroke(rib);
      sx.globalAlpha = 1; sx.fillStyle = css(mixc(mixc(K.tendril, K.rimD, 0.45), K.tendril, t.tone)); sx.fill(rib);
      // a lit core line toward the key light
      const p = t.pts, n = p.length / 2;
      sx.globalAlpha = 0.5 + 0.3 * t.tone; sx.strokeStyle = css(K.tendrilHot); sx.lineWidth = Math.max(1, t.w0 * 0.3);
      sx.beginPath();
      for (let i = 0; i < n - 2; i++) { const x = p[i * 2] - 0.9, y = p[i * 2 + 1] - 1.0; if (i === 0) sx.moveTo(x, y); else sx.lineTo(x, y); }
      sx.stroke();
    }
    sx.globalAlpha = 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'blur(0.45px)'; ctx.globalAlpha = 0.96; ctx.drawImage(scratch, 0, 0); ctx.filter = 'none';
    ctx.restore();
  }
  function drawBank(ctx, Kb, B, tb) {
    const K = B.bank, bb = Kb.bbox;
    ctx.save();
    ctx.clip(Kb.path);
    ctx.fillStyle = css(K.fill); ctx.fillRect(bb.x0 - 2, bb.y0 - 2, bb.x1 - bb.x0 + 4, bb.y1 - bb.y0 + 4);
    { // the bank is a raised mound lit from the top-left
      const m = Kb.m, L = Math.max(m.rx, m.ry);
      const g = ctx.createLinearGradient(m.x + LIGHT[0] * L, m.y + LIGHT[1] * L, m.x - LIGHT[0] * L, m.y - LIGHT[1] * L);
      g.addColorStop(0, css(mixc(K.fill, K.rim, 0.5), 0.3)); g.addColorStop(0.5, css(K.fill, 0)); g.addColorStop(1, css(K.dark, 0.35));
      ctx.fillStyle = g; ctx.fillRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    }
    const dk = softDisc(K.dark, 0.3), lt = softDisc(mixc(K.fill, K.rim, 0.35), 0.3);
    for (const d of Kb.dabs) if (d.x + d.r > tb.x0 && d.x - d.r < tb.x1 && d.y + d.r > tb.y0 && d.y - d.r < tb.y1) dab(ctx, d.dark ? dk : lt, d.x, d.y, d.r, d.a);
    // lobe bumps
    const bl = softDisc(mixc(K.fill, K.rimHot, 0.3), 0.2), bd = softDisc(K.hairD, 0.4);
    for (const b of Kb.bumps) {
      if (b.x + b.r < tb.x0 || b.x - b.r > tb.x1 || b.y + b.r < tb.y0 || b.y - b.r > tb.y1) continue;
      dab(ctx, bd, b.x - LIGHT[0] * b.r * 0.45, b.y - LIGHT[1] * b.r * 0.45, b.r * 0.95, 0.22);
      dab(ctx, bl, b.x + LIGHT[0] * b.r * 0.3, b.y + LIGHT[1] * b.r * 0.3, b.r * 0.75, 0.14);
    }
    // hair, batched by bucket
    const style = [
      [K.hairD, 0.3, 1.4], [K.hairD, 0.26, 1.0], [K.hairL, 0.22, 1.1], [mixc(K.hairL, K.fill, 0.3), 0.2, 0.9],
    ];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let b = 0; b < 4; b++) {
      const path = new Path2D();
      let n = 0;
      for (const p of Kb.strands[b]) {
        const x = p[0], y = p[1];
        if (x < tb.x0 - 50 || x > tb.x1 + 50 || y < tb.y0 - 50 || y > tb.y1 + 50) continue;
        path.moveTo(x, y);
        for (let i = 2; i < p.length - 2; i += 2) path.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
        path.lineTo(p[p.length - 2], p[p.length - 1]);
        n++;
      }
      if (!n) continue;
      ctx.globalAlpha = style[b][1]; ctx.strokeStyle = css(style[b][0]); ctx.lineWidth = style[b][2];
      ctx.stroke(path);
    }
    for (const lightPass of [false, true]) {
      const path = new Path2D();
      for (const c of Kb.curls) { if (c.light !== lightPass) continue; path.moveTo(c.x + Math.cos(c.a0) * c.r, c.y + Math.sin(c.a0) * c.r); path.arc(c.x, c.y, c.r, c.a0, c.a0 + c.sweep); }
      ctx.globalAlpha = lightPass ? 0.22 : 0.28; ctx.strokeStyle = css(lightPass ? K.hairL : K.hairD); ctx.lineWidth = lightPass ? 1.0 : 1.2;
      ctx.stroke(path);
    }
    // a soft dark band just inside the rim so the lip reads as raised
    ctx.globalAlpha = 0.35; ctx.filter = 'blur(6px)'; ctx.strokeStyle = css(K.hairD); ctx.lineWidth = 34; ctx.stroke(Kb.path); ctx.filter = 'none';
    ctx.restore();
    // cauliflower rim lumps (unclipped: the lumps make the silhouette): a soft shadow under each lump,
    // its body, and a highlight toward the key light; soft discs only, so neighbours merge into one lip
    const sh = softDisc(K.hairD, 0.3), body = [0, 1, 2, 3, 4].map((i) => softDisc(mixc(K.rimD, mixc(K.rim, K.rimHot, 0.35), i / 4), 0.6)), hi = softDisc(mixc(K.rimHot, [220, 220, 140], 0.25), 0.5);
    const baseB = softDisc(mixc(K.rimD, K.rim, 0.55), 0.45);
    for (const e of Kb.base) {
      if (e.x + e.r < tb.x0 || e.x - e.r > tb.x1 || e.y + e.r < tb.y0 || e.y - e.r > tb.y1) continue;
      dab(ctx, baseB, e.x, e.y, e.r, e.a);
    }
    for (const p of Kb.rim) {
      if (p.x + p.r * 1.5 < tb.x0 || p.x - p.r * 1.5 > tb.x1 || p.y + p.r * 1.5 < tb.y0 || p.y - p.r * 1.5 > tb.y1) continue;
      dab(ctx, sh, p.x + p.r * 0.3, p.y + p.r * 0.45, p.r * 1.3, 0.26);
      dab(ctx, body[Math.min(4, Math.round(p.tone * 4.4))], p.x, p.y, p.r * 1.05, 0.95);
      if (p.tone > 0.3) dab(ctx, hi, p.x + LIGHT[0] * p.r * 0.3, p.y + LIGHT[1] * p.r * 0.3, p.r * 0.72, (p.tone - 0.3) * 1.0);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ painting (start): wash, detail, mass tiles
  function own(T, t) { T.tex.push(t); live.push(t); return t; }
  function paint(world) {
    const T = world.terrain, B = BIOMES[T.biome];
    const t0 = now();
    const rng = mulberry(T.seed ^ 0x9e3779b9);
    const N = makeNoise(mulberry(T.seed ^ 0x51ed270b));
    N.w1 = N.field(160, 1); N.w2 = N.field(24, 1); N.w3 = N.field(30, 2); N.w4 = N.field(30, 2);
    N.band = N.field(90, 1); N.flow = N.field(70, 2); N.curv = N.field(50, 1); N.bunch = N.field(40, 1); N.clump = N.field(26, 2);
    // geometry
    T.shapes = T.masses.map((m, i) => {
      const r = mulberry((T.seed * 31 + i * 7919) ^ 0x2545f491);
      return m.kind === 'bank' ? buildBank(m, r) : buildRock(m, r, N);
    });
    T.mask = rasterMask(T);
    buildFields(world, T);
    const tGeo = now();
    // ground wash + detail
    T.groundCanvas = paintGround(T, B, N);
    own(T, (T.groundTex = IP.gfx.texture(T.groundCanvas, { filter: 'linear', wrap: 'clamp', mipmap: true, name: 'terrain-ground' })));
    T.detailCanvas = paintDetail(B, N, 512);
    own(T, (T.detailTex = IP.gfx.texture(T.detailCanvas, { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'terrain-detail' })));
    const tGround = now();
    // per-mass brushwork plans
    T.shapes.forEach((S, i) => {
      const r = mulberry((T.seed * 131 + i * 104729) ^ 0x68e31da4);
      if (S.kind === 'bank') planBank(S, r, N, T, B); else planRock(S, r, N, T, B);
    });
    const tPlan = now();
    // tiles: only where something is painted
    const m = world.map, Q = T.quality, S = Math.round((TILE + 2 * PAD) * Q);
    const scratch = canvas(S, S);
    T.tiles = [];
    for (let ty = 0; ty < m.h; ty += TILE) for (let tx = 0; tx < m.w; tx += TILE) {
      const tb = { x0: tx - PAD, y0: ty - PAD, x1: tx + TILE + PAD, y1: ty + TILE + PAD };
      const here = T.shapes.filter((s) => inTile(s.bbox, tb, 150));
      if (!here.length) continue;
      const c = canvas(S, S), ctx = c.getContext('2d');
      ctx.setTransform(Q, 0, 0, Q, (PAD - tx) * Q, (PAD - ty) * Q);
      if (T.biome === 'bog') {
        drawTendrils(ctx, scratch, here, B, tb);
        for (const K of here) if (inTile(K.bbox, tb, 60)) drawBank(ctx, K, B, tb);
      } else {
        // a soft dark cut just outside each exposed contour seats the rocks into the ground (all cuts first)
        ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.filter = 'blur(3px)'; ctx.globalAlpha = 0.55; ctx.strokeStyle = '#050407'; ctx.lineWidth = 9;
        for (const R of here) if (inTile(R.bbox, tb, 30)) ctx.stroke(R.edgePath);
        ctx.filter = 'none'; ctx.restore();
        for (const R of here) if (inTile(R.bbox, tb, 30)) drawRock(ctx, R, B, tb, scratch);
        drawBands(ctx, scratch, here, B, tb);
      }
      const tex = IP.gfx.texture(c, { filter: 'linear', wrap: 'clamp', mipmap: true, name: 'terrain-tile' });
      own(T, tex);
      T.tiles.push({ x: tx, y: ty, w: Math.min(TILE, m.w - tx), h: Math.min(TILE, m.h - ty), tex, canvas: c, S });
    }
    T.vignTex = own(T, vignetteTexture());
    T.puffTex = own(T, creepPuffTexture(T.seed));
    T.dotTex = own(T, IP.gfx.texture(softDisc([255, 255, 255], 0.5, 'dot'), { filter: 'linear', name: 'terrain-dot' }));
    T.painted = true;
    T.paintMs = Math.round(now() - t0);
    T.paintBreakdown = { geometry: Math.round(tGeo - t0), ground: Math.round(tGround - tGeo), plan: Math.round(tPlan - tGround), tiles: Math.round(now() - tPlan), tileCount: T.tiles.length };
  }
  function vignetteTexture() {
    const w = 256, h = 144, c = canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = ((i + 0.5) / w - 0.5) * 2, v = ((j + 0.5) / h - 0.5) * 2;
      const r = Math.min(1, Math.sqrt(u * u + v * v) / Math.SQRT2);
      const k = (j * w + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 0; d[k + 3] = Math.round(255 * Math.pow(r, 2.6));
    }
    x.putImageData(img, 0, 0);
    return IP.gfx.texture(c, { filter: 'linear', name: 'terrain-vignette' });
  }
  function creepPuffTexture(seed) {
    // a sponge-textured cumulus lump: union of soft bumps (lumpy outline), alpha broken by 3-8 px sponge noise
    const S = 128, c = canvas(S, S), x = c.getContext('2d'), r = mulberry(seed ^ 0xc4ee9);
    const bumps = [[S / 2, S / 2, S * 0.3]];
    for (let i = 0; i < 14; i++) { const a = r() * TAU, d = S * (0.12 + r() * 0.2); bumps.push([S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.08 + r() * 0.1)]); }
    const N = makeNoise(r), f1 = N.field(5, 2, 0.6), f2 = N.field(14, 1);
    const img = x.createImageData(S, S), d = img.data;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      let m = 0;
      for (const [bx, by, br] of bumps) { const q = 1 - Math.hypot(i + 0.5 - bx, j + 0.5 - by) / br; if (q > m) m = q; }
      const edge = ss(0, 0.35, m);
      const sponge = 0.62 + 0.38 * ss(0.25, 0.75, f1(i, j)) * (0.7 + 0.3 * f2(i, j));
      const k = (j * S + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(255 * edge * sponge);
    }
    x.putImageData(img, 0, 0);
    return IP.gfx.texture(c, { filter: 'linear', mipmap: true, name: 'terrain-creep-puff' });
  }

  // ------------------------------------------------------------------ creep
  function creepEdge(src, ang) {
    // irregular edge radius per angle from a periodic 1D value noise (12 lobes)
    const n = src.edgeN, k = (ang / TAU) * n, i = Math.floor(k), f = k - i, a = src.edgeV[((i % n) + n) % n], b = src.edgeV[(((i + 1) % n) + n) % n];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  }
  function makeSource(T, x, y, r) {
    const id = T.creepSeq++;
    const rr = mulberry(T.seed * 977 + id * 7);
    const edgeN = 14, edgeV = new Float32Array(edgeN);
    for (let i = 0; i < edgeN; i++) edgeV[i] = 0.74 + rr() * 0.46;
    return { id, x, y, r, edgeN, edgeV, rings: [], seed: (T.seed * 7919 + id * 104729) >>> 0 };
  }
  function ensureRings(src, upto) {
    const RING = 32;
    while (src.rings.length * RING < upto) {
      const k = src.rings.length, r0 = k * RING, r1 = r0 + RING;
      const rr = mulberry(src.seed + k * 2654435761);
      const area = Math.PI * (r1 * r1 - r0 * r0), n = Math.max(3, Math.round(area / 520));
      const st = [];
      for (let i = 0; i < n; i++) {
        const d = Math.sqrt(r0 * r0 + rr() * (r1 * r1 - r0 * r0)), a = rr() * TAU;
        const kind = rr();
        st.push({ d, a, s: 40 + rr() * 70, rot: rr() * TAU, kind: kind < 0.5 ? 0 : kind < 0.85 ? 1 : 2, al: 0.5 + rr() * 0.5, dot: rr() < 0.12, dx: (rr() - 0.5) * 30, dy: (rr() - 0.5) * 30 });
      }
      src.rings.push(st);
    }
  }
  function renderCreep(world, r) {
    const T = world.terrain, B = BIOMES[T.biome], C = B.creep, m = world.map;
    if (!T.creepRT) {
      const q = 0.5;
      T.creepRT = IP.gfx.target(Math.ceil(m.w * q), Math.ceil(m.h * q), { filter: 'linear' });
      T.creepRT.onRestore = () => { T.creepDirty = true; };
      own(T, T.creepRT);
    }
    const cols = [IP.rgba(C.dark[0], C.dark[1], C.dark[2], 1), IP.rgba(C.mid[0], C.mid[1], C.mid[2], 1), IP.rgba(C.bright[0], C.bright[1], C.bright[2], 1)];
    const so = { tex: T.puffTex, center: true, rot: 0, alpha: 1, layer: 'ground' }, dotO = { tex: T.dotTex, center: true, alpha: 1, layer: 'decal' };
    const brightO = { tex: T.puffTex, center: true, rot: 0, alpha: 1, layer: 'shadow' };
    r.renderTo(T.creepRT, { x: 0, y: 0, w: m.w, h: m.h }, (rr) => {
      for (const src of T.creep) {
        if (src.r <= 0) continue;
        ensureRings(src, src.r * 1.25 + 64);
        // a soft underwash so the lumps merge into one sheet inside the patch
        so.rot = 0; so.tex = T.dotTex; so.alpha = 0.55 * C.strength;
        rr.quad(src.x, src.y, src.r * 1.5, src.r * 1.5, cols[1], so);
        so.tex = T.puffTex;
        for (const ring of src.rings) for (const s of ring) {
          const e = src.r * creepEdge(src, s.a);
          if (s.d > e + 20) continue;
          const fade = clamp((e - s.d) / 70 + 0.25, 0, 1), core = clamp(1 - s.d / (e * 0.7), 0, 1);
          const x = src.x + Math.cos(s.a) * s.d, y = src.y + Math.sin(s.a) * s.d;
          if (IP.terrain.sdf(world, x, y) < -20) continue;
          so.rot = s.rot;
          if (s.kind === 0 || (s.kind === 2 && core <= 0.05)) { so.alpha = 0.7 * fade * s.al * C.strength; rr.quad(x, y, s.s * 1.2, s.s * 1.2, cols[0], so); continue; }
          so.alpha = Math.min(1, (0.6 + 0.35 * core) * fade * (0.6 + 0.4 * s.al)) * C.strength;
          rr.quad(x, y, s.s, s.s, cols[1], so);
          if (s.kind === 2 && core > 0) { brightO.rot = s.rot + 1; brightO.alpha = core * 0.3 * s.al * C.strength; rr.quad(x + s.dx * 0.3, y + s.dy * 0.3, s.s * 0.6, s.s * 0.6, cols[2], brightO); }
          if (s.dot && s.d < e * 0.9) { dotO.alpha = 0.75 * fade; rr.quad(x + s.dx, y + s.dy, 4, 4, IP.rgba(C.dots[0], C.dots[1], C.dots[2], 1), dotO); }
        }
      }
    }, { clear: [0, 0, 0, 0] });
    T.creepDirty = false;
    T.creepRenderedAt = world.time;
  }

  // ------------------------------------------------------------------ navigation: flow fields
  function nav(world) {
    const m = world.map;
    if (!m.blocked || !m.cols) {
      const cols = Math.ceil(m.w / CELL), rows = Math.ceil(m.h / CELL);
      Object.assign(m, { cell: CELL, cols, rows, blocked: new Uint8Array(cols * rows) });
    }
    if (!world._terrainNav || world._terrainNav.blocked !== m.blocked) world._terrainNav = { blocked: m.blocked, cache: new Map(), order: [] };
    return world._terrainNav;
  }
  function heapPush(h, hv, i, v) { let k = h.length; h.push(i); hv.push(v); while (k > 0) { const p = (k - 1) >> 1; if (hv[p] <= v) break; h[k] = h[p]; hv[k] = hv[p]; k = p; } h[k] = i; hv[k] = v; }
  function heapPop(h, hv) {
    const top = h[0], li = h.pop(), lv = hv.pop();
    if (h.length) {
      let k = 0; const n = h.length;
      for (;;) { let c = 2 * k + 1; if (c >= n) break; if (c + 1 < n && hv[c + 1] < hv[c]) c++; if (hv[c] >= lv) break; h[k] = h[c]; hv[k] = hv[c]; k = c; }
      h[k] = li; hv[k] = lv;
    }
    return top;
  }
  function nearestFreeCell(m, c) {
    if (!m.blocked[c]) return c;
    const seen = new Uint8Array(m.cols * m.rows), q = [c]; seen[c] = 1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % m.cols, y = (i / m.cols) | 0;
      if (!m.blocked[i]) return i;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) { if (nx < 0 || ny < 0 || nx >= m.cols || ny >= m.rows) continue; const j = ny * m.cols + nx; if (!seen[j]) { seen[j] = 1; q.push(j); } }
    }
    return c;
  }
  const DX8 = [1, -1, 0, 0, 1, 1, -1, -1], DY8 = [0, 0, 1, -1, 1, -1, 1, -1];
  function buildFlow(world, m, target, tx, ty) {
    const cols = m.cols, rows = m.rows, n = cols * rows, bl = m.blocked;
    const dist = new Float32Array(n).fill(Infinity);
    const h = [], hv = [];
    dist[target] = 0; heapPush(h, hv, target, 0);
    while (h.length) {
      const c = heapPop(h, hv), dc = dist[c];
      const cx = c % cols, cy = (c / cols) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX8[k], ny = cy + DY8[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (bl[j]) continue;
        if (k >= 4 && (bl[cy * cols + nx] || bl[ny * cols + cx])) continue; // no corner cutting
        const nd = dc + (k >= 4 ? Math.SQRT2 : 1);
        if (nd < dist[j]) { dist[j] = nd; heapPush(h, hv, j, nd); }
      }
    }
    const dx = new Float32Array(n), dy = new Float32Array(n);
    const T = world.terrain;
    for (let c = 0; c < n; c++) {
      const cx = c % cols, cy = (c / cols) | 0;
      if (bl[c] || dist[c] === Infinity) {
        // inside rock (or sealed): point out along the SDF gradient so stuck units slide free
        const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
        let gx = 0, gy = 0;
        if (T && T.sdf) { gx = sdfAt(world, x + 8, y) - sdfAt(world, x - 8, y); gy = sdfAt(world, x, y + 8) - sdfAt(world, x, y - 8); }
        const l = Math.hypot(gx, gy);
        if (l > 1e-6) { dx[c] = gx / l; dy[c] = gy / l; }
        continue;
      }
      if (c === target) continue;
      let vx = 0, vy = 0;
      const d0 = dist[c];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX8[k], ny = cy + DY8[k];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (bl[j] || dist[j] >= d0) continue;
        if (k >= 4 && (bl[cy * cols + nx] || bl[ny * cols + cx])) continue;
        const len = k >= 4 ? Math.SQRT2 : 1, w = (d0 - dist[j]) / len;
        vx += (DX8[k] / len) * w; vy += (DY8[k] / len) * w;
      }
      const l = Math.hypot(vx, vy);
      if (l > 1e-6) { dx[c] = vx / l; dy[c] = vy / l; }
    }
    const out = [0, 0];
    const field = {
      cell: CELL, cols, rows, dx, dy, dist, tx, ty, target,
      // unit direction at a world point (nearest cell; at the target cell, straight at the target point)
      dir(x, y) {
        const cx = clamp((x / CELL) | 0, 0, cols - 1), cy = clamp((y / CELL) | 0, 0, rows - 1), c = cy * cols + cx;
        if (c === target) { const ex = tx - x, ey = ty - y, l = Math.hypot(ex, ey); if (l < 1e-6) { out[0] = 0; out[1] = 0; } else { out[0] = ex / l; out[1] = ey / l; } return out; }
        out[0] = dx[c]; out[1] = dy[c];
        return out;
      },
      distAt(x, y) { const cx = clamp((x / CELL) | 0, 0, cols - 1), cy = clamp((y / CELL) | 0, 0, rows - 1); return dist[cy * cols + cx] * CELL; },
    };
    return field;
  }

  // ------------------------------------------------------------------ queries
  function sdfAt(world, x, y) {
    const T = world.terrain;
    if (!T || !T.sdf) return 1e4;
    const fx = x / LR - 0.5, fy = y / LR - 0.5;
    const gw = T.gw, gh = T.gh;
    const i = clamp(Math.floor(fx), 0, gw - 2), j = clamp(Math.floor(fy), 0, gh - 2);
    const u = clamp(fx - i, 0, 1), v = clamp(fy - j, 0, 1), k = j * gw + i, s = T.sdf;
    return (s[k] * (1 - u) + s[k + 1] * u) * (1 - v) + (s[k + gw] * (1 - u) + s[k + gw + 1] * u) * v;
  }
  function passable(world, x, y) {
    const m = world.map;
    if (!(x >= 0 && y >= 0 && x < m.w && y < m.h)) return false;
    const T = world.terrain;
    if (!T || !T.mask) {
      if (m.blocked && m.cols) return !m.blocked[((y / (m.cell || CELL)) | 0) * m.cols + ((x / (m.cell || CELL)) | 0)];
      return true;
    }
    if (T.mask[((y / LR) | 0) * T.gw + ((x / LR) | 0)]) return false;
    // another system (barricades) may have swapped in its own copy of the grid: honour its extra cells
    if (m.blocked && m.blocked !== T.blocked0) return !m.blocked[((y / CELL) | 0) * m.cols + ((x / CELL) | 0)];
    return true;
  }

  const API = {
    BIOMES, CELL, LR,
    generate(world, o) {
      o = o || {};
      const biome = BIOMES[o.biome] ? o.biome : 'basalt';
      const w = o.w || (world.map && world.map.w) || 3840, h = o.h || (world.map && world.map.h) || 2160;
      const seed = (o.seed != null ? o.seed : (IP.fork(world, 'terrain')() * 4294967296)) >>> 0;
      const rng = mulberry(seed ^ IP.hash('terrain-layout'));
      world.map = { w, h };
      const L = o.masses ? { masses: o.masses.map((q) => Object.assign({ rot: 0, kind: biome === 'bog' ? 'bank' : 'rock' }, q, { ry: q.ry || q.rx })), arenas: o.arenaList || [], keep: o.keepClear || [] } : layout(rng, w, h, biome, o);
      for (const q of L.masses) if (biome === 'bog') q.kind = 'bank'; else if (q.kind === 'bank') q.kind = 'rock';
      const T = (world.terrain = {
        biome, seed, masses: L.masses, arenas: L.arenas, keepClear: L.keep,
        gw: Math.ceil(w / LR), gh: Math.ceil(h / LR), quality: o.quality || 1,
        vignette: o.vignette != null ? o.vignette : BIOMES[biome].vignette,
        creep: [], creepSeq: 0, creepDirty: false, tex: [], tiles: [], painted: false, debug: !!o.debug,
      });
      T.sdfAt = (x, y) => sdfAt(world, x, y);
      // geometry, mask, nav grid and textures are built right away (scenarios place things with passable())
      paint(world);
      return T;
    },
    passable,
    sdf: sdfAt,
    collide(world, e, r) {
      const T = world.terrain;
      r = r != null ? r : e.r || 0;
      let moved = false;
      const m = world.map;
      if (T && T.sdf) {
        for (let it = 0; it < 3; it++) {
          const d = sdfAt(world, e.x, e.y);
          if (d >= r) break;
          const gx = sdfAt(world, e.x + 3, e.y) - sdfAt(world, e.x - 3, e.y), gy = sdfAt(world, e.x, e.y + 3) - sdfAt(world, e.x, e.y - 3);
          const l = Math.hypot(gx, gy);
          if (l < 1e-6) break;
          const push = r - d + 0.25;
          e.x += (gx / l) * push; e.y += (gy / l) * push; moved = true;
        }
      }
      const x = clamp(e.x, r, m.w - r), y = clamp(e.y, r, m.h - r);
      if (x !== e.x || y !== e.y) { e.x = x; e.y = y; moved = true; }
      return moved;
    },
    nearestFree(world, x, y) {
      if (passable(world, x, y)) return { x, y };
      const m = world.map;
      x = clamp(x, 1, m.w - 1); y = clamp(y, 1, m.h - 1);
      for (let rad = LR; rad < 2000; rad += LR) {
        const n = Math.max(8, Math.round((TAU * rad) / LR));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU, px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
          if (passable(world, px, py) && sdfAt(world, px, py) > 6) return { x: px, y: py };
        }
      }
      return { x, y };
    },
    los(world, x0, y0, x1, y1) {
      const L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / LR);
      for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; if (!passable(world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
      return true;
    },
    flowTo(world, x, y) {
      const S = nav(world), m = world.map;
      const cx = clamp((x / CELL) | 0, 0, m.cols - 1), cy = clamp((y / CELL) | 0, 0, m.rows - 1);
      const target = nearestFreeCell(m, cy * m.cols + cx);
      let f = S.cache.get(target);
      if (f) {
        f.tx = x; f.ty = y;
        const i = S.order.indexOf(target);
        if (i >= 0) S.order.splice(i, 1);
        S.order.push(target);
        return f;
      }
      f = buildFlow(world, m, target, x, y);
      S.cache.set(target, f); S.order.push(target);
      while (S.order.length > 24) S.cache.delete(S.order.shift());
      return f;
    },
    creepAt(world, x, y) {
      const T = world.terrain;
      if (!T || !T.creep.length) return 0;
      if (!passable(world, x, y)) return 0;
      let best = 0;
      for (const s of T.creep) {
        if (s.r <= 0) continue;
        const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy);
        if (d > s.r * 1.25) continue;
        const e = s.r * creepEdge(s, (Math.atan2(dy, dx) + TAU) % TAU);
        const v = clamp((e - d) / 60 + 0.25, 0, 1);
        if (v > best) best = v;
      }
      return best;
    },
    growCreep(world, x, y, r) { return setCreep(world, x, y, r, true); },
    setCreep(world, x, y, r) { return setCreep(world, x, y, r, false); },
    check(world) {
      const T = world.terrain;
      if (!T || !T.mask) return null;
      const gw = T.gw, gh = T.gh, mask = T.mask;
      // label each impassable pixel with its mass (map border = label 0), then a labelled chamfer sweep finds
      // the closest pair of different masses: that is the narrowest corridor on the map
      const lab = new Int32Array(gw * gh).fill(-1);
      const cv = canvas(gw, gh), cx2 = cv.getContext('2d', { willReadFrequently: true });
      T.shapes.forEach((S, k) => {
        cx2.setTransform(1, 0, 0, 1, 0, 0); cx2.clearRect(0, 0, gw, gh);
        cx2.setTransform(1 / LR, 0, 0, 1 / LR, 0, 0); cx2.fillStyle = '#fff'; cx2.fill(S.path);
        const d = cx2.getImageData(0, 0, gw, gh).data;
        for (let i = 0; i < gw * gh; i++) if (d[i * 4 + 3] >= 128 && mask[i]) lab[i] = k + 1;
      });
      for (let i = 0; i < gw * gh; i++) if (mask[i] && lab[i] < 0) lab[i] = 999;
      const nl = T.shapes.length + 1;
      const D = new Float32Array(gw * gh).fill(1e9), Lb = new Int32Array(gw * gh).fill(-1);
      for (let i = 0; i < gw * gh; i++) if (mask[i]) { D[i] = 0; Lb[i] = lab[i]; }
      // the map border acts as label 0 at distance (x+0.5) etc.: seed a virtual ring
      const relax = (i, j, c) => { if (D[j] + c < D[i]) { D[i] = D[j] + c; Lb[i] = Lb[j]; } };
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; if (mask[i]) continue; const b = Math.min(x + 0.5, y + 0.5, gw - x - 0.5, gh - y - 0.5); if (b < D[i]) { D[i] = b; Lb[i] = 0; } }
      for (let pass = 0; pass < 2; pass++) {
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; if (x > 0) relax(i, i - 1, 1); if (y > 0) { relax(i, i - gw, 1); if (x > 0) relax(i, i - gw - 1, 1.4142); if (x < gw - 1) relax(i, i - gw + 1, 1.4142); } }
        for (let y = gh - 1; y >= 0; y--) for (let x = gw - 1; x >= 0; x--) { const i = y * gw + x; if (x < gw - 1) relax(i, i + 1, 1); if (y < gh - 1) { relax(i, i + gw, 1); if (x < gw - 1) relax(i, i + gw + 1, 1.4142); if (x > 0) relax(i, i + gw - 1, 1.4142); } }
      }
      let minGap = 1e9, minEdge = 1e9;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (mask[i]) continue;
        for (const j of [x + 1 < gw ? i + 1 : -1, y + 1 < gh ? i + gw : -1]) {
          if (j < 0 || mask[j] || Lb[j] === Lb[i]) continue;
          const g = (D[i] + D[j] + 1) * LR;
          if (Lb[i] === 0 || Lb[j] === 0) minEdge = Math.min(minEdge, g); else minGap = Math.min(minGap, g);
        }
      }
      let b = 0;
      for (let i = 0; i < mask.length; i++) b += mask[i];
      return { minGap: Math.round(minGap), minEdgeGap: Math.round(minEdge), blockedFrac: +(b / mask.length).toFixed(3), masses: T.masses.length, components: nl - 1, sealedCells: T.sealed, paintMs: T.paintMs, breakdown: T.paintBreakdown };
    },
  };
  function setCreep(world, x, y, r, grow) {
    const T = world.terrain;
    if (!T) return null;
    let s = T.creep.find((q) => Math.hypot(q.x - x, q.y - y) < 48);
    if (!s) { if (r <= 0) return null; s = makeSource(T, x, y, r); T.creep.push(s); T.creepDirty = true; return s; }
    const nr = grow ? Math.max(s.r, r) : Math.max(0, r);
    if (Math.abs(nr - s.r) > 0.5) { s.r = nr; T.creepDirty = true; }
    return s;
  }
  IP.terrain = API;

  // ------------------------------------------------------------------ the system
  let live = []; // textures of the previous world, released on the next init
  IP.registerSystem('terrain', {
    init(world) {
      for (const t of live) { try { t.dispose(); } catch (e) { /* already gone */ } }
      live = [];
      world.terrain = null;
      world._terrainNav = null;
    },
    update(world) {},
    draw(world, r) {
      const T = world.terrain;
      if (!T || !T.painted) return;
      const m = world.map, B = BIOMES[T.biome];
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: T.groundTex });
      const ds = 512;
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: T.detailTex, uv: [0, 0, m.w / ds, m.h / ds] });
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: T.detailTex, uv: [0.37, 0.61, 0.37 + m.w / (ds * 1.73), 0.61 + m.h / (ds * 1.73)], alpha: 0.5 });
      if (T.creep.length) {
        if (T.creepDirty && (T.creepRenderedAt == null || world.time - T.creepRenderedAt >= 0.2 || !T.creepRT)) renderCreep(world, r);
        if (T.creepRT) r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: T.creepRT });
      }
      const v = IP.viewRect(world, 8);
      for (const t of T.tiles) {
        if (t.x > v.x1 || t.x + t.w < v.x0 || t.y > v.y1 || t.y + t.h < v.y0) continue;
        const u0 = PAD / (TILE + 2 * PAD), s = 1 / (TILE + 2 * PAD);
        r.quad(t.x, t.y, t.w, t.h, 0xffffffff, { layer: 'ground', tex: t.tex, uv: [u0, u0, u0 + t.w * s, u0 + t.h * s] });
      }
      // paint grain over everything terrain (rock planes and fur get the same fine texture as the ground)
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: T.detailTex, uv: [0.21, 0.83, 0.21 + m.w / (ds * 0.87), 0.83 + m.h / (ds * 0.87)], alpha: B.detail.over });
      if (T.debug) {
        const c = m.cell, red = 'rgba(255,40,40,0.28)';
        for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.blocked[y * m.cols + x]) r.quad(x * c, y * c, c - 1, c - 1, red, { layer: 'over' });
        for (const a of T.arenas) r.circle(a.x, a.y, a.r, 'rgba(80,220,255,0.6)', { layer: 'over', width: 3 });
        if (T.debugFlow) {
          const f = API.flowTo(world, T.debugFlow.x, T.debugFlow.y);
          for (let y = 0; y < m.rows; y += 2) for (let x = 0; x < m.cols; x += 2) {
            const i = y * m.cols + x; if (m.blocked[i]) continue;
            const px = (x + 0.5) * c, py = (y + 0.5) * c;
            r.line(px, py, px + f.dx[i] * 22, py + f.dy[i] * 22, 2, 'rgba(255,255,120,0.8)', { layer: 'over' });
            r.circle(px + f.dx[i] * 22, py + f.dy[i] * 22, 2.5, 'rgba(255,255,120,0.9)', { layer: 'over' });
          }
          r.circle(T.debugFlow.x, T.debugFlow.y, 10, '#38e0e0', { layer: 'over' });
        }
      }
      if (T.vignette > 0) r.quad(0, 0, 1920, 1080, IP.rgba(0, 0, 0, T.vignette), { layer: 'screen', tex: T.vignTex });
    },
  });

  // ------------------------------------------------------------------ scenarios
  const demo = (biome, extra) => (world, o) => {
    IP.terrain.generate(world, { biome, w: 3840, h: 2160, seed: world.seed });
    world.camera = { x: 1920, y: 1080, zoom: 1 };
    if (extra) extra(world, o);
  };
  IP.scenario('terrain-basalt', demo('basalt'), { systems: ['terrain'], seed: 1 });
  IP.scenario('terrain-bog', demo('bog'), { systems: ['terrain'], seed: 1 });
  IP.scenario('terrain-creep', demo('basalt', (world) => {
    const T = world.terrain, a = T.arenas[0];
    const p1 = IP.terrain.nearestFree(world, a.x - 380, a.y - 120), p2 = IP.terrain.nearestFree(world, a.x + 420, a.y + 200);
    IP.terrain.growCreep(world, p1.x, p1.y, 420);
    IP.terrain.growCreep(world, p2.x, p2.y, 260);
    world.terrainDemo = { p1, p2 };
  }), { systems: ['terrain'], seed: 1 });
  IP.scenario('terrain-creep-bog', demo('bog', (world) => {
    const a = world.terrain.arenas[0];
    const p1 = IP.terrain.nearestFree(world, a.x - 300, a.y), p2 = IP.terrain.nearestFree(world, a.x + 380, a.y + 150);
    IP.terrain.growCreep(world, p1.x, p1.y, 300);
    IP.terrain.growCreep(world, p2.x, p2.y, 200);
  }), { systems: ['terrain'], seed: 1 });
  // debug: blocked cells + a flow field toward the arena centre
  IP.scenario('terrain-debug', (world, o) => {
    const biome = (o && o.biome) || 'basalt';
    IP.terrain.generate(world, { biome, w: 3840, h: 2160, seed: world.seed, debug: true });
    const a = world.terrain.arenas[0];
    world.terrain.debugFlow = { x: a.x, y: a.y };
    world.camera = { x: 1920, y: 1080, zoom: 0.5 };
  }, { systems: ['terrain'], seed: 1 });
  // 4096 x 4096 paint-time / memory check
  IP.scenario('terrain-big', (world) => {
    IP.terrain.generate(world, { biome: 'bog', w: 4096, h: 4096, seed: world.seed });
    world.camera = { x: 2048, y: 2048, zoom: 0.5 };
  }, { systems: ['terrain'], seed: 3 });
})();
