/* Infested Planet Gauntlet: vfx.
 * Tracers, muzzle flashes, hit sparks, a persistent blood decal layer (2048 px render-target chunks), fading corpses,
 * shred bursts, explosions (flash, shock ring, fire balls that cool to smoke, debris, scorch, camera shake), marine
 * death markers and hive capture bursts. Consumes world.events every tick (see Game/DESIGN.md "Phase 2 additions").
 *
 * Gore (round 4): flat, outlined, ramped decals in the Mecha Factory look (never glossy tubes). Each splat = a
 * see-through body, 2-3 off-centre dark pools (two ramp steps) and a lighter fresh zone inside it, then one quad from
 * a baked edge atlas (8 light directions per medium/large/huge shape) carrying a 1 px maroon outline and a 1 px lit
 * step on the key-light side only (no drop shadow: blood lies on the ground). Small splats carry their 1 px outline in
 * the body stamp. Medium and bigger splats throw a fringe of 20-40 hard droplets out to 1.6x their radius, so a pool
 * goes pool -> spatter -> ground. Size classes: small 20-50 px, medium 70-130, large 130-200 (never demoted by
 * coverage), huge 220-300 (one thin tongue along the death direction, with 3-5 shrinking droplets past its tip).
 * A coverage grid (32 px cells, sim side, deterministic) darkens overlaps and caps only the small splats.
 * Particles live in a fixed 4000-slot structure-of-arrays pool; nothing is allocated per frame.
 * Scenarios: 'vfx-demo' (a sustained scripted fight), 'vfx-bench' (pool held at 4000), 'vfx-corpse' (one death).
 * Public helpers: IP.vfx.{shake, splat, explosion, burst, stats, rocketTime}.
 */
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;
  const TAU = Math.PI * 2, STEP = 1 / 60;
  const MAXP = 4000, MAXT = 1024, MAXC = 2048, MAXREC = 8192, MAXSHOT = 256, MAXEX = 64;
  const CHUNK = 2048, CORPSE_HOLD = 2, CORPSE_FADE = 18, CG = 32;

  // ------------------------------------------------------------------ colours (engine packing: r | g<<8 | b<<16 | a<<24)
  const hex = (h) => (((h >> 16) & 255) | (((h >> 8) & 255) << 8) | ((h & 255) << 16)) >>> 0;
  const withA = (c24, a) => ((c24 & 0xffffff) | (((a <= 0 ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0)) << 24)) >>> 0;
  function lerpC(a, b, t) {
    const r = (a & 255) + ((b & 255) - (a & 255)) * t, g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
    const bl = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
    return ((r | 0) | ((g | 0) << 8) | ((bl | 0) << 16)) >>> 0;
  }
  const COL = {
    white: hex(0xffffff), hotWhite: hex(0xfff6dc),
    fireWhite: hex(0xfff3c4), fireYel: hex(0xffcf4a), fireOr: hex(0xff8a2a), fireRed: hex(0xd2461e), fireDark: hex(0x4a1c14), fireLine: hex(0x5c1006),
    heatWarm: hex(0xffc890), heatRed: hex(0xd8583a), heatSoot: hex(0x3a1c16),
    ring: hex(0xffd890), smoke: hex(0x2a2428), smokeMid: hex(0x4a4248), smokeLit: hex(0x6e6268), smokeLine: hex(0x141014), brass: hex(0xd8a648), smokeTrail: hex(0x6a6468), scorch: hex(0x0b0709), debris: hex(0x221a1c),
    rifle: hex(0xff4058), rifleGlow: hex(0xff2040), rifleHead: hex(0xffd0d4),
    sniper: hex(0xf6fbff), sniperGlow: hex(0x8fd4ff),
    fusion: hex(0xff8a2a), fusionCore: hex(0xfff0b0), medic: hex(0x5dff7a), turret: hex(0xffe04a), turretGlow: hex(0xffb020), rocket: hex(0xffb060),
    sparkAlien: hex(0xffd0a0), sparkPink: hex(0xff7aa0), sparkMarine: hex(0xffa040), sparkStruct: hex(0xfff070),
    magenta: hex(0xe050e8), magentaHot: hex(0xffb0ff), greyX: hex(0xa4a2aa), darkX: hex(0x121014), shred: hex(0xf2f4ff),
  };
  // carapace ramp for shred chips (the bugs' teal), darkest to lightest
  const CHIP_COLS = [hex(0x1d4a54), hex(0x2d6a72), hex(0x3f8a8c), hex(0x5fb0a4)];
  // blood ramps (5-step, hue-shifted: shadows lean plum, lights lean warm): o outline, core/b2 dark pools, b1/b0 body
  // by overlap level (old -> fresh), lit fresh zone, hi (1 px lit step), spec glint, drop
  const PAL_ALIEN = {
    o: hex(0x1a0412), core: hex(0x44081f), b2: hex(0x6a0f2e), b1: hex(0x94163c), b0: hex(0xe02e50), lit: hex(0xff6676), hi: hex(0xff7078), spec: hex(0xffd4c8), drop: hex(0xd8304f),
  };
  PAL_ALIEN.b12 = lerpC(PAL_ALIEN.b1, PAL_ALIEN.b2, 0.5);
  const PAL_MARINE = {
    o: hex(0x1c0805), core: hex(0x400a07), b2: hex(0x701812), b1: hex(0xa02414), b0: hex(0xd8381a), lit: hex(0xf8602c), hi: hex(0xff8050), spec: hex(0xffdcb8), drop: hex(0xd8401c),
  };
  PAL_MARINE.b12 = lerpC(PAL_MARINE.b1, PAL_MARINE.b2, 0.5);

  // ------------------------------------------------------------------ stamp atlas (generated once, deterministic pixel maths)
  const S_CLOUD = 0 /* 4 */, S_BLOB = 4 /* 4 */, S_DROP = 8, S_DROP2 = 9, S_STREAK = 10, S_GLOW = 11, S_SPARK = 12, S_FLASH = 13,
    S_SHARD = 14, S_CROSS = 15, S_DISC = 16, S_FIRE = 17 /* 2: silhouettes */, S_COMET = 19,
    G_SPL_S = 20 /* 4 small omni, 64 */, G_SPL_O = 24 /* 4 omni, 128 */, G_SPL_D = 28 /* 4 directional, 160 */, G_SPL_H = 32 /* 2 huge, 256 */,
    G_CORE = 34 /* 3 */, G_SHEEN = 37, G_DOT = 39, G_SOOT = 40 /* 2 */, G_CHIP = 42 /* 3 */, S_FIREC = 45 /* 2: baked colour */, G_CASE = 47;
  const UV = [], ASPECT = [], EUV = [], NDIR = 8;
  // huge shapes: the tongue tip (stamp-centred uv) and its angle, for the droplets painted past it
  const TIPU = [], TIPV = [], TIPA = [];
  // body centre of each splat stamp, as a fraction of the stamp along +x (directional stamps sit back from the centre)
  const BODYX = [], BODYR = [];
  let ART = null, BAKE_MS = 0;
  const BAKE_PARTS = {};

  function hash2(x, y, s) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, p, s) {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = hash2(x0, y0, s), b = hash2(x1, y0, s), c = hash2(x0, y1, s), d = hash2(x1, y1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }
  const sstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

  // a liquid splat: lumpy body + tapered finger lobes with bulbous tips + loose droplets, as a signed distance (uv units)
  function makeSplat(rng, o) {
    const bx = o.bx || (o.dir ? 0.44 : 0.5), by = 0.5, br = o.body;
    const harm = [];
    for (let h = 2; h <= 6; h++) harm.push(h, (br * (0.1 + rng() * 0.12)) / Math.sqrt(h), rng() * TAU);
    const caps = [], tips = [], sats = [], subs = [], tongs = [];
    // the body is a few merged pools, not one disc
    for (let i = 0, n = 2 + ((rng() * 2) | 0); i < n; i++) {
      const a = o.dir ? (rng() - 0.5) * 1.2 : rng() * TAU, d = br * (0.3 + 0.32 * rng());
      subs.push(bx + Math.cos(a) * d, by + Math.sin(a) * d, br * (0.36 + 0.2 * rng()));
    }
    const nl = o.lobes[0] + ((rng() * (o.lobes[1] - o.lobes[0] + 1)) | 0);
    for (let i = 0; i < nl; i++) {
      let a, len;
      if (o.dir) {
        a = (rng() + rng() + rng() - 1.5) * (o.spread || 1.5);
        len = (o.reach * (0.6 + 0.4 * rng())) * (0.6 + 0.4 * Math.cos(a));
      } else {
        a = (i / nl) * TAU + (rng() - 0.5) * (TAU / nl) * 0.8;
        len = o.reach * (0.6 + 0.4 * rng());
      }
      len = Math.max(br * 1.3, len);
      const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
      // spiky splash fingers: a modest root tapering to a thin streak that ends in a small drop
      const r0 = br * (0.14 + 0.12 * rng()), r1 = o.thin * (0.45 + 0.4 * rng());
      caps.push(bx + Math.cos(a) * br * 0.5, by + Math.sin(a) * br * 0.5, ex, ey, r0, r1);
      tips.push(ex + Math.cos(a) * r1 * 0.6, ey + Math.sin(a) * r1 * 0.6, Math.max(r1 * 1.25, o.tip * (0.45 + 0.35 * rng())));
    }
    for (let i = 0, n = o.sats[0] + ((rng() * (o.sats[1] - o.sats[0] + 1)) | 0); i < n; i++) {
      const a = o.dir ? (rng() + rng() - 1) * 1.6 : rng() * TAU;
      const d = o.dir ? o.reach * (0.7 + 0.5 * rng()) * (0.6 + 0.4 * Math.cos(a)) : o.reach * (0.75 + 0.45 * rng());
      const rad = o.tip * (0.35 + 0.6 * rng());
      const sx = Math.max(0.04 + rad, Math.min(0.96 - rad, bx + Math.cos(a) * d)), sy = Math.max(0.04 + rad, Math.min(0.96 - rad, by + Math.sin(a) * d));
      sats.push(sx, sy, rad);
    }
    // tongue (huge splashes): at most one thin streak within +-15 deg of the death direction (+x). Root width
    // <= 0.12 x the body diameter, length (past the body edge) <= 0.8 x the body diameter, tapering to a point (no
    // bead). Droplets past its tip are painted at runtime (shrinking G_DOTs), so the tip is recorded.
    let tip = null;
    if (o.tongue) {
      const Bd = 2 * br * 0.85, a = (rng() - 0.5) * 0.5, ca = Math.cos(a), sa = Math.sin(a);
      const len = Bd * (0.62 + 0.18 * rng()), r0 = 0.055 * Bd, r1 = 0.012 * Bd;
      const ax = bx + ca * Bd * 0.3, ay = by + sa * Bd * 0.3, ex = bx + ca * (Bd * 0.5 + len), ey = by + sa * (Bd * 0.5 + len);
      tongs.push(ax, ay, ex, ey, r0, r1);
      tip = { u: ex - 0.5, v: ey - 0.5, a, bd: Bd };
    }
    return { bx, by, br: br * 0.85, harm, caps, tips, sats, subs, tongs, tip };
  }
  // the splat's signed distance field (uv units) over an N x N stamp. Each primitive is only evaluated inside its own
  // bounding box (grown by its blend radius + a clamp margin): outside that box it cannot change a value that is
  // already clamped to CLAMP px outside the shape, so the result equals the full evaluation wherever it matters.
  function splatField(S, N) {
    const CL = 6 / N + 0.0625, F = new Float32Array(N * N).fill(CL);   // >= 6 px + 1.25 x the widest blend radius
    const lo = (x) => Math.max(0, Math.floor(x * N)), hi = (x) => Math.min(N - 1, Math.ceil(x * N));
    let amp = 0;
    for (let i = 0; i < S.harm.length; i += 3) amp += Math.abs(S.harm[i + 1]);
    // the lumpy body radius by angle, tabulated (1024 steps, linear between)
    const RL = new Float32Array(1025);
    for (let q = 0; q <= 1024; q++) {
      const th = (q / 1024) * TAU - Math.PI;
      let rad = S.br;
      for (let i = 0; i < S.harm.length; i += 3) rad += S.harm[i + 1] * Math.sin(S.harm[i] * th + S.harm[i + 2]);
      RL[q] = rad;
    }
    {
      const RB = S.br + amp + CL, X = S.bx, Y = S.by;
      for (let j = lo(Y - RB), j1 = hi(Y + RB); j <= j1; j++) {
        const dy = (j + 0.5) / N - Y;
        for (let i = lo(X - RB), i1 = hi(X + RB); i <= i1; i++) {
          const dx = (i + 0.5) / N - X, f = ((Math.atan2(dy, dx) + Math.PI) / TAU) * 1024, q = Math.min(1023, f | 0), k = j * N + i;
          const d = Math.sqrt(dx * dx + dy * dy) - (RL[q] + (RL[q + 1] - RL[q]) * (f - q));
          if (d < F[k]) F[k] = d;
        }
      }
    }
    // discs (subs, tips: smooth union with blend radius kk; sats: hard union when kk = 0)
    const discs = (A, kk) => {
      for (let n = 0; n < A.length; n += 3) {
        const X = A[n], Y = A[n + 1], r = A[n + 2], m = r + kk + CL;
        for (let j = lo(Y - m), j1 = hi(Y + m); j <= j1; j++) {
          const dy = (j + 0.5) / N - Y;
          for (let i = lo(X - m), i1 = hi(X + m); i <= i1; i++) {
            const dx = (i + 0.5) / N - X, k = j * N + i, d = Math.sqrt(dx * dx + dy * dy) - r, c = F[k];
            if (kk > 0) { const h = kk - Math.abs(c - d); F[k] = (c < d ? c : d) - (h > 0 ? (h * h) / (kk * 4) : 0); } else if (d < c) F[k] = d;
          }
        }
      }
    };
    // tapered capsules (lobes, tongues), smooth union; the taper exponent is tabulated
    const caps = (C, kk, pw) => {
      const PW = new Float32Array(257);
      for (let q = 0; q <= 256; q++) PW[q] = Math.pow(q / 256, pw);
      for (let n = 0; n < C.length; n += 6) {
        const ax = C[n], ay = C[n + 1], bx = C[n + 2], by = C[n + 3], r0 = C[n + 4], r1 = C[n + 5], ex = bx - ax, ey = by - ay, il = 1 / (ex * ex + ey * ey);
        const m = Math.max(r0, r1) + kk + CL;
        for (let j = lo(Math.min(ay, by) - m), j1 = hi(Math.max(ay, by) + m); j <= j1; j++) {
          const py = (j + 0.5) / N - ay;
          for (let i = lo(Math.min(ax, bx) - m), i1 = hi(Math.max(ax, bx) + m); i <= i1; i++) {
            const pxx = (i + 0.5) / N - ax;
            let t = (pxx * ex + py * ey) * il; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const qx = pxx - ex * t, qy = py - ey * t, k = j * N + i, c = F[k];
            const d = Math.sqrt(qx * qx + qy * qy) - (r0 + (r1 - r0) * PW[(t * 256) | 0]);
            const h = kk - Math.abs(c - d);
            F[k] = (c < d ? c : d) - (h > 0 ? (h * h) / (kk * 4) : 0);
          }
        }
      }
    };
    discs(S.subs, 0.05);
    caps(S.caps, 0.03, 0.7);
    caps(S.tongs, 0.02, 0.8);
    discs(S.tips, 0.018);
    discs(S.sats, 0);
    for (let i = 0; i < F.length; i++) F[i] *= N;
    return F;
  }

  function buildArt() {
    const T0 = performance.now();
    let TL = T0;
    const lap = (k) => { const n = performance.now(); BAKE_PARTS[k] = +(n - TL).toFixed(1); TL = n; };
    const AW = 2048, AH = 1024, PAD = 6;
    const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(AW, AH), D = img.data;
    let sx = 0, sy = 0, shelf = 0;
    const out = [1, 1, -1, 0, 0]; // [lum, alpha, r, g, b]: r < 0 means grey (lum); otherwise a baked colour stamp
    // reserve a w x h slot in the atlas, set its UV; returns its [x, y] origin
    function place(id, w, h) {
      if (sx + w + PAD * 2 > AW) { sx = 0; sy += shelf + PAD * 2; shelf = 0; }
      const ox = sx + PAD, oy = sy + PAD;
      sx += w + PAD * 2; shelf = Math.max(shelf, h);
      if (oy + h > AH) console.warn('vfx atlas overflow', id);
      UV[id] = [ox / AW, oy / AH, (ox + w) / AW, (oy + h) / AH];
      ASPECT[id] = w / h;
      return [ox, oy];
    }
    function stamp(id, w, h, fn) {
      const [ox, oy] = place(id, w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        out[0] = 1; out[1] = 0; out[2] = -1;
        fn((x + 0.5) / w, (y + 0.5) / h, out, x, y);
        const i = ((oy + y) * AW + ox + x) * 4, l = Math.max(0, Math.min(1, out[0])), a = Math.max(0, Math.min(1, out[1]));
        if (out[2] < 0) { D[i] = D[i + 1] = D[i + 2] = Math.round(l * 255); }
        else { D[i] = Math.round(out[2] * 255); D[i + 1] = Math.round(out[3] * 255); D[i + 2] = Math.round(out[4] * 255); }
        D[i + 3] = Math.round(a * 255);
      }
    }
    // edge atlas: per medium/large/huge splat shape, NDIR light directions of an "edge" stamp = a 1 px plum outline
    // ring just outside the body and a 1 px lit step just inside it on the key-light side. No drop shadow. Tinted
    // with the palette's hi colour; the ring's lum (0.12 x hi) lands on the plum outline colour.
    const EP = 3, EW = 2048, EH0 = 2048, eimg = cx.createImageData(EW, EH0), E = eimg.data;
    let ex = 0, ey = 0, eshelf = 0, eUsed = 0;
    const eslots = [];
    // reserve an N x N slot in the edge atlas; returns its [x, y] origin (or null on overflow)
    function estampAt(slot, N) {
      if (ex + N + EP * 2 > EW) { ex = 0; ey += eshelf + EP * 2; eshelf = 0; }
      const ox = ex + EP, oy = ey + EP;
      ex += N + EP * 2; eshelf = Math.max(eshelf, N);
      if (oy + N > EH0) { console.warn('vfx edge atlas overflow', slot); return null; }
      eUsed = Math.max(eUsed, oy + N + EP);
      eslots.push(slot, ox, oy, N);
      return [ox, oy];
    }
    const rng = IP.mulberry32(0x5eed0f);
    // ---- gore: splats (alpha only, a crisp 1-texel AA edge; tinted per layer). The signed distance field of each
    // medium+ shape is kept (in stamp pixels) to bake its edge stamps afterwards; small shapes carry their own outline.
    const SDF = [];
    const splatStamp = (id, N, o, seed, edge) => {
      const S = makeSplat(rng, o), F = splatField(S, N);
      BODYX[id] = S.bx - 0.5; BODYR[id] = S.br;
      if (S.tip) { TIPU[id] = S.tip.u; TIPV[id] = S.tip.v; TIPA[id] = S.tip.a; }
      if (edge) {
        // alpha only (lum 255), written directly
        const o = place(id, N, N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const f = F[y * N + x];
          if (f >= 0.7) continue;
          const i = ((o[1] + y) * AW + o[0] + x) * 4;
          D[i] = D[i + 1] = D[i + 2] = 255; D[i + 3] = f <= -0.7 ? 255 : Math.round(sstep(0.7, -0.7, f) * 255);
        }
        SDF.push({ id, N, F, edge });
      } else {
        // small: body (lum 1) inside a ~2 stamp px outline ring (lum 0.16: tinted by the body colour it is the
        // dark plum line), so a small splat is one quad with its own 1 px outline at 20-50 px
        stamp(id, N, N, (u, v, oo, x, y) => {
          const f = F[y * N + x], ins = sstep(0.6, -0.6, f), a = sstep(0.6, -0.6, f - 2.1);
          oo[1] = a; oo[0] = a > 0 ? (ins + 0.16 * (a - ins)) / a : 1;
        });
      }
    };
    // chunky shapes: a lumpy body of merged pools, a few short thick lobes leaning along the death direction, and
    // loose droplets. Huge shapes add one thin tongue (no bead) whose tip droplets are painted at runtime.
    const EH_ = { rim: 1.15, ol: 1.15 }, ED_ = { rim: 1.35, ol: 1.4 }, EO_ = { rim: 1.3, ol: 1.35 };
    for (let k = 0; k < 2; k++) splatStamp(G_SPL_H + k, 256, { dir: true, bx: 0.3, body: 0.235, reach: 0.33, thin: 0.022, tip: 0.028, lobes: [4, 6], sats: [3, 5], spread: 1.3, tongue: true }, 300 + k, EH_);
    for (let k = 0; k < 4; k++) splatStamp(G_SPL_D + k, 160, { dir: true, body: 0.28, reach: 0.44, thin: 0.03, tip: 0.04, lobes: [4, 6], sats: [3, 5], spread: 1.1 }, 310 + k, ED_);
    for (let k = 0; k < 4; k++) splatStamp(G_SPL_O + k, 128, { dir: false, body: 0.28, reach: 0.42, thin: 0.035, tip: 0.045, lobes: [5, 7], sats: [2, 4] }, 320 + k, EO_);
    for (let k = 0; k < 4; k++) splatStamp(G_SPL_S + k, 64, { dir: false, body: 0.31, reach: 0.42, thin: 0.06, tip: 0.065, lobes: [3, 5], sats: [1, 2] }, 330 + k, null);
    lap('splats');
    for (const sh of SDF) {
      const { N, F, edge } = sh, OL = edge.ol, W = edge.rim;
      // bilinear sample of the field at pixel-centre coords; outside the stamp is outside the splat
      const sd = (x, y) => {
        const fx = x - 0.5, fy = y - 0.5;
        if (fx < 0 || fy < 0 || fx >= N - 1 || fy >= N - 1) return 9;
        const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, j = iy * N + ix;
        const a = F[j] + (F[j + 1] - F[j]) * tx, b = F[j + N] + (F[j + N + 1] - F[j + N]) * tx;
        return a + (b - a) * ty;
      };
      // the pixels near the edge (the only ones any light direction can touch), found once per shape
      const BAND = new Int32Array(N * N);
      let nb = 0;
      for (let j = 0; j < N * N; j++) { const v = F[j]; if (v <= OL + 1 && v >= -W - 1) BAND[nb++] = j; }
      for (let d = 0; d < NDIR; d++) {
        const lx = Math.cos(d * TAU / NDIR) * W, ly = Math.sin(d * TAU / NDIR) * W;
        const o = estampAt(sh.id * NDIR + d, N);
        if (!o) continue;
        for (let q = 0; q < nb; q++) {
          const j = BAND[q], x = j % N, y = (j / N) | 0, s0 = F[j];
          const ain = sstep(0.55, -0.55, s0);
          const ring = sstep(0.55, -0.55, s0 - OL) * (1 - ain);
          const hi = s0 < 0.6 ? ain * (1 - sstep(0.55, -0.55, sd(x + 0.5 + lx, y + 0.5 + ly))) : 0;
          const a = Math.min(1, ring * 0.92 + hi);
          if (a <= 0.004) continue;
          const i = ((o[1] + y) * EW + o[0] + x) * 4;
          E[i] = E[i + 1] = E[i + 2] = Math.round(((ring * 0.92 * 0.12 + hi) / a) * 255); E[i + 3] = Math.round(a * 255);
        }
      }
    }
    lap('edges');
    // dark core pools: lumpy hard-edged blobs
    for (let k = 0; k < 3; k++) {
      const harm = [];
      for (let h = 2; h <= 6; h++) harm.push(h, (0.06 + rng() * 0.06) / Math.sqrt(h), rng() * TAU);
      stamp(G_CORE + k, 64, 64, (u, v, o) => {
        const dx = u - 0.5, dy = v - 0.5, th = Math.atan2(dy, dx);
        let rad = 0.4;
        for (let i = 0; i < harm.length; i += 3) rad += 0.4 * harm[i + 1] * Math.sin(harm[i] * th + harm[i + 2]);
        o[1] = sstep(-0.9, 0.9, (rad - Math.hypot(dx, dy)) * 64);
      });
    }
    stamp(G_DOT, 16, 16, (u, v, o, x, y) => { o[1] = sstep(0.75, -0.75, Math.hypot(x + 0.5 - 8, y + 0.5 - 8) - 6.6); });
    // scorch: soot with radial blast rays, darker ring near the rim
    for (let k = 0; k < 2; k++) {
      const p = rng() * TAU;
      stamp(G_SOOT + k, 128, 128, (u, v, o) => {
        const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy) * 2, th = Math.atan2(dy, dx);
        const rays = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(th * 7 + p + Math.sin(th * 3) * 0.8)), 3);
        const reach = 0.62 + 0.38 * rays;
        o[1] = Math.pow(sstep(reach, reach * 0.35, d), 0.8) * (0.75 + 0.25 * vnoise(u * 12, v * 12, 12, k + 401)) * (0.9 + 0.1 * sstep(0.2, 0.6, d));
      });
    }
    // carapace chips: chunky chamfered shards, lit face upper-left, dark face lower-right, 1 px dark outline
    for (let k = 0; k < 3; k++) {
      const n = 5 + k, pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU + (rng() - 0.5) * 0.6, rr = 7 + rng() * 4; pts.push(12 + Math.cos(a) * rr, 12 + Math.sin(a) * rr * (0.6 + 0.2 * k)); }
      stamp(G_CHIP + k, 24, 24, (u, v, o, x, y) => {
        const X = x + 0.5, Y = y + 0.5;
        let inside = true, md = 1e9;
        for (let i = 0; i < n; i++) {
          const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
          const ex = bx - ax, ey = by - ay, c = (X - ax) * ey - (Y - ay) * ex;
          if (c < 0) inside = false;
          md = Math.min(md, Math.abs(c) / Math.hypot(ex, ey));
        }
        if (!inside) { o[1] = 0; return; }
        o[1] = 1;
        o[0] = md < 1.4 ? 0.2 : (X - 12) + (Y - 12) < -1 ? 1 : 0.62;
      });
    }
    lap('gore-misc');
    // ---- smoke clouds: soft lumpy masses of overlapping dabs
    for (let k = 0; k < 4; k++) {
      const dots = [];
      for (let i = 0; i < 46; i++) {
        const a = rng() * TAU, d = Math.abs(rng() + rng() + rng() - 1.5) * 0.19;
        dots.push(0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, (0.05 + rng() * 0.11) * (1 - d * 1.4), 0.5 + rng() * 0.5);
      }
      // density accumulated dab by dab over each dab's own box (same sum, a fraction of the work)
      const CN = 128, DEN = new Float32Array(CN * CN);
      for (let i = 0; i < dots.length; i += 4) {
        const cx0 = dots[i], cy0 = dots[i + 1], rr = dots[i + 2], w = dots[i + 3];
        if (rr <= 0) continue;
        const i0 = Math.max(0, Math.floor((cx0 - rr) * CN - 1)), i1 = Math.min(CN - 1, Math.ceil((cx0 + rr) * CN)), j0 = Math.max(0, Math.floor((cy0 - rr) * CN - 1)), j1 = Math.min(CN - 1, Math.ceil((cy0 + rr) * CN));
        for (let y = j0; y <= j1; y++) for (let x = i0; x <= i1; x++) {
          const dx = (x + 0.5) / CN - cx0, dy = (y + 0.5) / CN - cy0, q = 1 - (dx * dx + dy * dy) / (rr * rr);
          if (q > 0) DEN[y * CN + x] += w * q * q;
        }
      }
      stamp(S_CLOUD + k, CN, CN, (u, v, o, x, y) => {
        const dens = DEN[y * CN + x];
        const edge = sstep(0.5, 0.4, Math.hypot(u - 0.5, v - 0.5));
        const a0 = 1 - Math.exp(-dens * 2.6), g2 = vnoise(u * 30, v * 30, 30, k + 41);
        o[1] = a0 * sstep(0.18, 0.62, a0 + (g2 - 0.5) * 0.5) * edge;
        // lit from the upper left: puffs are lighter on that side
        o[0] = 0.78 + 0.22 * sstep(0.25, -0.25, (u - 0.5) + (v - 0.5)) + 0.06 * vnoise(u * 22, v * 22, 22, k + 11);
      });
    }
    for (let k = 0; k < 4; k++) {
      const harm = [];
      for (let h = 2; h <= 8; h++) harm.push(h, ((rng() * 0.16) / Math.pow(h, 0.55)), rng() * TAU);
      stamp(S_BLOB + k, 64, 64, (u, v, o) => {
        const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
        let rad = 0.36;
        for (let i = 0; i < harm.length; i += 3) rad += 0.36 * harm[i + 1] * Math.sin(harm[i] * th + harm[i + 2]);
        o[1] = sstep(-1, 1, (rad - d) * 64);
      });
    }
    lap('clouds+blobs');
    stamp(S_DROP, 32, 32, (u, v, o) => { o[1] = sstep(-1.2, 1.2, (0.4 - Math.hypot(u - 0.5, v - 0.5)) * 32); });
    stamp(S_DROP2, 48, 24, (u, v, o) => {
      const head = (0.4 - Math.hypot((u - 0.68) * 2, v - 0.5)) * 24;
      const tw = 0.3 * sstep(0.05, 0.68, u), tail = (tw - Math.abs(v - 0.5)) * 24;
      o[1] = sstep(-1, 1, Math.max(head, u < 0.7 ? tail : -9));
    });
    stamp(S_GLOW, 64, 64, (u, v, o) => { const d2 = (u - 0.5) ** 2 + (v - 0.5) ** 2; o[1] = Math.exp(-d2 * 18) * sstep(0.5, 0.44, Math.sqrt(d2)); });
    stamp(S_SPARK, 64, 16, (u, v, o) => { const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2; o[1] = Math.exp(-(dx * dx * 2.2 + dy * dy * 5)) * sstep(1, 0.85, Math.abs(dx)); });
    // muzzle flash: hot core at the left, a cone and two side spikes opening to the right
    stamp(S_FLASH, 64, 32, (u, v, o) => {
      const dy = v - 0.5, w = 0.05 + 0.2 * u;
      const cone = Math.exp(-(dy * dy) / (w * w)) * Math.pow(1 - u, 1.1);
      const core = Math.exp(-(((u - 0.14) * 3) ** 2 + (dy * 4) ** 2) * 3);
      const sp = Math.exp(-(((Math.abs(dy) - u * 0.45) * 22) ** 2)) * Math.pow(1 - u, 2) * 0.7;
      o[1] = Math.min(1, cone + core + sp);
    });
    stamp(S_SHARD, 64, 16, (u, v, o) => {
      const hw = 0.46 * (1 - u);
      o[1] = sstep(-0.8, 0.8, (hw - Math.abs(v - 0.5)) * 16);
    });
    stamp(S_CROSS, 16, 16, (u, v, o) => {
      const x = Math.abs(u - 0.5) * 16, y = Math.abs(v - 0.5) * 16;
      o[1] = sstep(-0.7, 0.7, Math.max(Math.min(6.5 - x, 2 - y), Math.min(6.5 - y, 2 - x)));
    });
    stamp(S_DISC, 32, 32, (u, v, o) => { o[1] = sstep(-1, 1, (0.46 - Math.hypot(u - 0.5, v - 0.5)) * 32); });
    // fire ball silhouettes (S_FIRE, lum 1: outlines and tinted uses) and the matching baked-colour balls (S_FIREC):
    // a lumpy edge, then hard hue-shifted steps: white-hot core (to ~30 % radius, sitting toward the key light),
    // yellow (to ~60 %), orange, and a red-orange lip on the shadow (lower-right) rim. Tinted toward red as it cools.
    const FC = [[1, 0.97, 0.86], [1, 0.82, 0.3], [1, 0.55, 0.17], [0.86, 0.3, 0.1]];
    for (let k = 0; k < 2; k++) {
      const p0 = rng() * TAU, p1 = rng() * TAU, p2 = rng() * TAU, p3 = rng() * TAU, p4 = rng() * TAU;
      const edgeR = (th) => 0.84 + 0.07 * Math.sin(3 * th + p0) + 0.045 * Math.sin(5 * th + p1) + 0.03 * Math.sin(9 * th + p2);
      stamp(S_FIRE + k, 96, 96, (u, v, o) => {
        const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy) * 2, th = Math.atan2(dy, dx);
        o[1] = sstep(1.0, 0.975, d / edgeR(th));
        o[0] = 1;
      });
      stamp(S_FIREC + k, 96, 96, (u, v, o) => {
        const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy) * 2, th = Math.atan2(dy, dx), R = edgeR(th);
        o[1] = sstep(1.0, 0.975, d / R);
        if (o[1] <= 0) return;
        // hot centre offset toward the upper left; lumpy step boundaries
        const hx = dx + 0.07, hy = dy + 0.08, hd = Math.hypot(hx, hy) * 2 / R, ht = Math.atan2(hy, hx);
        const c1 = 0.3 + 0.05 * Math.sin(4 * ht + p3), c2 = 0.6 + 0.06 * Math.sin(5 * ht + p4);
        const lip = d / R > 0.86 && dx + dy > 0.05 ? 1 : 0;
        const w0 = sstep(c1 + 0.02, c1 - 0.02, hd), w1 = sstep(c2 + 0.02, c2 - 0.02, hd) - w0, w3 = lip * (1 - w0 - w1), w2 = 1 - w0 - w1 - w3;
        for (let c = 0; c < 3; c++) o[2 + c] = FC[0][c] * w0 + FC[1][c] * w1 + FC[2][c] * w2 + FC[3][c] * w3;
      });
    }
    // spent brass casing: a 1 px dark outline around a lit/dark split body
    stamp(G_CASE, 16, 8, (u, v, o, x, y) => {
      const X = Math.abs(x + 0.5 - 8), Y = Math.abs(y + 0.5 - 4);
      const out_ = X < 6.5 && Y < 3, inn = X < 5.5 && Y < 2;
      o[1] = out_ ? 1 : 0; o[0] = inn ? (y < 4 ? 1 : 0.62) : 0.2;
    });
    // comet: a white wedge, round bright nose on the right tapering to nothing on the left
    stamp(S_COMET, 128, 16, (u, v, o) => {
      const nose = 0.9;
      const hw = u < nose ? 0.42 * Math.pow(u / nose, 1.1) : 0.42 * Math.sqrt(Math.max(0, 1 - ((u - nose) / (1 - nose)) ** 2));
      o[1] = sstep(-1, 1, (hw - Math.abs(v - 0.5)) * 16) * (0.15 + 0.85 * Math.pow(Math.min(1, u / nose), 0.9));
    });
    lap('stamps');
    cx.putImageData(img, 0, 0);
    const atlas = IP.gfx.texture(cv, { filter: 'linear', mipmap: true, name: 'vfx-atlas' });
    // the edge atlas is cropped to the rows it uses
    const EH = Math.max(8, (eUsed + 7) & ~7);
    for (let i = 0; i < eslots.length; i += 4) EUV[eslots[i]] = [eslots[i + 1] / EW, eslots[i + 2] / EH, (eslots[i + 1] + eslots[i + 3]) / EW, (eslots[i + 2] + eslots[i + 3]) / EH];
    const ecv = document.createElement('canvas'); ecv.width = EW; ecv.height = EH;
    ecv.getContext('2d').putImageData(eimg, 0, 0, 0, 0, EW, EH);
    const edges = IP.gfx.texture(ecv, { filter: 'linear', mipmap: true, name: 'vfx-edges' });
    lap('upload');

    // repeat-wrapped tracer textures, drawn at 1:1 so the dots stay crisp
    const tile = (w, h, fn, name) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'), im = x.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
        const a = fn(xx + 0.5, y + 0.5), i = (y * w + xx) * 4;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
      x.putImageData(im, 0, 0);
      return IP.gfx.texture(c, { filter: 'linear', wrap: 'repeat', name });
    };
    const dotR = tile(10, 6, (x, y) => sstep(0.6, -0.6, Math.hypot(x - 5, y - 3) - 2.2), 'vfx-dot-rifle');
    const dotRG = tile(10, 14, (x, y) => Math.exp(-((x - 5) ** 2 + (y - 7) ** 2) / 9), 'vfx-dot-glow');
    const dotT = tile(12, 6, (x, y) => sstep(0.6, -0.6, Math.hypot(x - 6, y - 3) - 2.1), 'vfx-dot-turret');

    // fallback basalt ground for the vfx scenarios when terrain is not running
    const G = 256, gc = document.createElement('canvas'); gc.width = gc.height = G;
    const gx = gc.getContext('2d'), gi = gx.createImageData(G, G);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      const u = x / G, v = y / G;
      const cloud = vnoise(u * 2, v * 2, 2, 1) * 0.55 + vnoise(u * 5, v * 5, 5, 2) * 0.3 + vnoise(u * 12, v * 12, 12, 3) * 0.15;
      const speck = hash2(x, y, 7), dust = speck > 0.985 ? 0.08 : speck < 0.02 ? -0.05 : 0;
      const l = 1.0 + (cloud - 0.5) * 0.6 + dust + (vnoise(u * 32, v * 32, 32, 4) - 0.5) * 0.08;
      const i = (y * G + x) * 4;
      gi.data[i] = Math.round(25 * l + 3 * cloud); gi.data[i + 1] = Math.round(23 * l); gi.data[i + 2] = Math.round(30 * l + 5 * cloud); gi.data[i + 3] = 255;
    }
    gx.putImageData(gi, 0, 0);
    const ground = IP.gfx.texture(gc, { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'vfx-ground' });
    lap('tiles+ground');
    ART = { atlas, edges, dotR, dotRG, dotT, ground };
  }

  // corpse sheets: the alien's own sheet, desaturated toward plum, darkened, with its glow put out; same outlines and
  // pixel grid as the living sprite (nearest filtered), so a corpse reads as a dead bug of the same kind
  const corpseSheets = {};
  function corpseSheet(sh) {
    if (!sh || !sh.tex || !sh.tex.src) return null;
    const key = sh.name || (sh.meta && sh.meta.name) || sh.tex.id;
    if (corpseSheets[key] !== undefined) return corpseSheets[key];
    let out = null;
    try {
      const src = sh.tex.src, c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const x = c.getContext('2d');
      x.drawImage(src, 0, 0);
      const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        let r = d[i], g = d[i + 1], b = d[i + 2];
        const l = r * 0.3 + g * 0.55 + b * 0.15;
        const glow = g > r + 50 && g > b - 10 && l > 110;
        // dead: the carapace's own value structure kept (mid-tones stay at ~35-45 % luminance, outlines stay dark),
        // the hue drained to a cool plum-grey so a corpse never reads as a live teal bug, the glow put out
        const L = l * (glow ? 0.5 : 0.9);
        d[i] = Math.min(255, L * 1.02 + 9); d[i + 1] = L * 0.84; d[i + 2] = Math.min(255, L * 0.98 + 7);
      }
      x.putImageData(im, 0, 0);
      out = IP.assets.sheetFromCanvas(c, sh.meta, { name: 'vfx-corpse-' + key, filter: 'nearest' });
    } catch (e) { out = null; }
    corpseSheets[key] = out;
    return out;
  }

  // ------------------------------------------------------------------ pools (structure of arrays)
  const px = new Float32Array(MAXP), py = new Float32Array(MAXP), pvx = new Float32Array(MAXP), pvy = new Float32Array(MAXP);
  const page = new Float32Array(MAXP), plife = new Float32Array(MAXP), ps0 = new Float32Array(MAXP), ps1 = new Float32Array(MAXP);
  const prot = new Float32Array(MAXP), pvrot = new Float32Array(MAXP), pdrag = new Float32Array(MAXP), pasp = new Float32Array(MAXP);
  const pa0 = new Float32Array(MAXP), pcol = new Uint32Array(MAXP), pcol2 = new Uint32Array(MAXP), pstamp = new Uint8Array(MAXP), pflag = new Uint8Array(MAXP), pfade = new Uint8Array(MAXP);
  const F_ADD = 1, F_STRETCH = 2, F_RING = 4, F_LERP = 8, F_FIRE = 16, F_PUFF = 32;
  const FD_LIN = 0, FD_QUAD = 1, FD_HOLD = 2, FD_INOUT = 3;
  let np = 0, steal = 0;
  // tracers
  const tx0 = new Float32Array(MAXT), ty0 = new Float32Array(MAXT), tx1 = new Float32Array(MAXT), ty1 = new Float32Array(MAXT);
  const tage = new Float32Array(MAXT), tlife = new Float32Array(MAXT), tkind = new Uint8Array(MAXT);
  let nt = 0;
  const T_RIFLE = 0, T_SNIPER = 1, T_FUSION = 2, T_MEDIC = 3, T_TURRET = 4, T_ROCKET = 5;
  const TLIFE = [0.18, 0.14, 0.3, 0.45, 0.14, 0.2];
  const SNIPER_TRAVEL = 0.1, SNIPER_TAIL = 78, ROCKET_SPEED = 2400;
  const rocketTime = (len) => Math.max(0.08, Math.min(0.3, len / ROCKET_SPEED));
  // corpses (ring)
  const cxs = new Float32Array(MAXC), cys = new Float32Array(MAXC), cborn = new Float32Array(MAXC);
  const crow = new Uint8Array(MAXC), ckind = new Uint8Array(MAXC), csheet = new Uint16Array(MAXC);
  let chead = 0, ccount = 0;
  const CLIST = new Int32Array(MAXC);
  // decal records (ring log; also the paint queue and the context-loss replay log)
  const rx = new Float32Array(MAXREC), ry = new Float32Array(MAXREC), rs = new Float32Array(MAXREC), rdir = new Float32Array(MAXREC);
  const rseed = new Uint32Array(MAXREC), rkind = new Uint8Array(MAXREC), rlev = new Uint8Array(MAXREC);
  let rhead = 0, rpainted = 0;
  const R_ALIEN = 0, R_DARK = 1, R_MARINE = 2, R_X = 3, R_SCORCH = 4, R_CHIPS = 5;
  // recent shots (to fling blood along the killing shot)
  const shX = new Float32Array(MAXSHOT), shY = new Float32Array(MAXSHOT), shA = new Float32Array(MAXSHOT), shT = new Int32Array(MAXSHOT);
  let shHead = 0;
  // rocket shots of the current tick, and explosions waiting for their rocket to arrive
  const rkX = new Float32Array(32), rkY = new Float32Array(32), rkT = new Float32Array(32);
  let nrk = 0;
  const exX = new Float32Array(MAXEX), exY = new Float32Array(MAXEX), exR = new Float32Array(MAXEX), exK = new Uint8Array(MAXEX), exAt = new Int32Array(MAXEX);
  let nex = 0;
  const EXKINDS = ['rocket', 'spitter', 'hive'];

  const KINDS = ['drone', 'runner', 'spitter', 'brute', 'tank'];
  const KIND_SHEET = ['bug_drone', 'bug_runner', 'bug_spitter', 'bug_brute', 'bug_tank'];
  // splat class odds per kind, cumulative: [small, medium, large] (the rest is huge); size scale per kind.
  // drone 58/25/12/5 %, runner 68/19/10/3 %, spitter 42/30/18/10 %.
  const KIND_ODDS = [[0.58, 0.83, 0.95], [0.68, 0.87, 0.97], [0.42, 0.72, 0.9], [0, 0.4, 0.75], [0, 0, 0.5]];
  const KIND_SCALE = [1, 0.85, 1.1, 1.1, 1.2];
  const kindIndex = (k) => { const i = KINDS.indexOf(k); return i < 0 ? 0 : i; };

  let V = null;      // world.vfx of the current world
  let RNG = null;    // vfx rng stream (forked)

  function spawn(stamp, x, y, vx, vy, life, s0, s1, rot, vrot, drag, c24, a0, flags, aspect, fade) {
    let i;
    if (np < MAXP) i = np++;
    else { i = steal; steal = (steal + 1) % MAXP; }
    px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy; page[i] = 0; plife[i] = life; ps0[i] = s0; ps1[i] = s1;
    prot[i] = rot; pvrot[i] = vrot; pdrag[i] = drag; pcol[i] = c24; pcol2[i] = c24; pa0[i] = a0; pstamp[i] = stamp; pflag[i] = flags;
    pasp[i] = aspect; pfade[i] = fade;
    return i;
  }
  function addTracer(kind, x0, y0, x1, y1, life) {
    let i;
    if (nt < MAXT) i = nt++; else i = (V.tsteal = (V.tsteal + 1) % MAXT);
    tx0[i] = x0; ty0[i] = y0; tx1[i] = x1; ty1[i] = y1; tage[i] = 0; tlife[i] = life || TLIFE[kind]; tkind[i] = kind;
  }
  function addRecord(kind, x, y, s, dir, lev) {
    const i = rhead & (MAXREC - 1);
    rx[i] = x; ry[i] = y; rs[i] = s; rdir[i] = dir; rkind[i] = kind; rlev[i] = lev || 0; rseed[i] = (RNG() * 4294967296) >>> 0;
    rhead++;
    if (rhead - rpainted > MAXREC) rpainted = rhead - MAXREC;
  }
  function sheetIndex(name) {
    let i = V.snames.indexOf(name);
    if (i < 0) { i = V.snames.length; V.snames.push(name); V.sheets.push(null); V.csheets.push(null); }
    return i;
  }
  function addCorpse(k, x, y, facing, sheetName) {
    const i = chead;
    chead = (chead + 1) % MAXC; if (ccount < MAXC) ccount++;
    cxs[i] = x; cys[i] = y; cborn[i] = V.time; ckind[i] = k;
    csheet[i] = sheetIndex(sheetName || KIND_SHEET[k]);
    crow[i] = IP.dirIndex(facing + (RNG() - 0.5) * 1.6);
  }
  const gauss = () => (RNG() + RNG() + RNG() - 1.5) / 1.5;

  // ------------------------------------------------------------------ coverage grid (sim side): overlap darkening + density cap
  function covSetup(world) {
    const m = world.map || { w: 3840, h: 2160 };
    V.gw = Math.max(1, Math.ceil(m.w / CG)); V.gh = Math.max(1, Math.ceil(m.h / CG));
    V.cov = new Float32Array(V.gw * V.gh);
    V.cmark = new Uint32Array(V.gw * V.gh); V.ccnt = new Uint8Array(V.gw * V.gh); V.cframe = 0;
  }
  function covAt(x, y, r) {
    const g = V.cov, gw = V.gw, gh = V.gh;
    const x0 = Math.max(0, Math.floor((x - r) / CG)), x1 = Math.min(gw - 1, Math.floor((x + r) / CG));
    const y0 = Math.max(0, Math.floor((y - r) / CG)), y1 = Math.min(gh - 1, Math.floor((y + r) / CG));
    let s = 0, n = 0;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { s += Math.min(1, g[j * gw + i]); n++; }
    return n ? s / n : 1;
  }
  function covAdd(x, y, r, amt) {
    const g = V.cov, gw = V.gw, gh = V.gh;
    if (r < CG * 0.6) {
      const i = Math.floor(x / CG), j = Math.floor(y / CG);
      if (i >= 0 && j >= 0 && i < gw && j < gh) g[j * gw + i] += (Math.PI * r * r) / (CG * CG) * amt;
      return;
    }
    const x0 = Math.max(0, Math.floor((x - r) / CG)), x1 = Math.min(gw - 1, Math.floor((x + r) / CG));
    const y0 = Math.max(0, Math.floor((y - r) / CG)), y1 = Math.min(gh - 1, Math.floor((y + r) / CG));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const d = Math.hypot((i + 0.5) * CG - x, (j + 0.5) * CG - y), f = Math.max(0, Math.min(1, (r - d) / CG + 0.5));
      if (f > 0) g[j * gw + i] += f * amt;
    }
  }

  // ------------------------------------------------------------------ event handlers
  function tracerKind(w) {
    switch (w) { case 'sniper': return T_SNIPER; case 'fusion': case 'flamer': case 'flame': return T_FUSION; case 'medic': return T_MEDIC;
      case 'turret': return T_TURRET; case 'rocket': return T_ROCKET; default: return T_RIFLE; }
  }
  function onShot(e) {
    const x = +e.x, y = +e.y, tx = e.tx != null ? +e.tx : x, ty = e.ty != null ? +e.ty : y;
    if (!(x === x && y === y && tx === tx && ty === ty)) return;
    const k = tracerKind(e.weapon), a = Math.atan2(ty - y, tx - x), ca = Math.cos(a), sa = Math.sin(a);
    const len = Math.hypot(tx - x, ty - y);
    addTracer(k, x, y, tx, ty, k === T_ROCKET ? rocketTime(len) : 0);
    const j = shHead++ & (MAXSHOT - 1);
    shX[j] = tx; shY[j] = ty; shA[j] = a; shT[j] = V.tick;
    // additive muzzle flash: a coloured cone + a small white-hot core
    let fc = COL.fireYel, fs = 24;
    if (k === T_RIFLE) { fc = COL.fireYel; fs = 22; } else if (k === T_SNIPER) { fc = COL.sniperGlow; fs = 34; } else if (k === T_FUSION) { fc = COL.fusion; fs = 30; }
    else if (k === T_MEDIC) { fc = COL.medic; fs = 14; } else if (k === T_TURRET) { fc = COL.turret; fs = 20; } else if (k === T_ROCKET) { fc = COL.rocket; fs = 36; }
    const life = 0.05 + RNG() * 0.03;
    spawn(S_FLASH, x + ca * fs * 0.42, y + sa * fs * 0.42, 0, 0, life, fs, fs * 1.15, a + gauss() * 0.12, 0, 1, fc, 0.95, F_ADD, 2, FD_LIN);
    spawn(S_GLOW, x, y, 0, 0, life * 1.3, fs * 0.8, fs * 0.9, 0, 0, 1, fc, 0.5, F_ADD, 1, FD_QUAD);
    spawn(S_DISC, x + ca * 3, y + sa * 3, 0, 0, life * 0.7, fs * 0.28, fs * 0.2, 0, 0, 1, COL.hotWhite, 1, F_ADD, 1, FD_LIN);
    if (k === T_RIFLE || k === T_TURRET || k === T_SNIPER) {
      // a spent casing flicked out to the right of the barrel, and a little gun smoke drifting off the muzzle
      const ev = 70 + RNG() * 70, side = k === T_TURRET && RNG() < 0.5 ? -1 : 1;
      spawn(G_CASE, x - ca * 8, y - sa * 8, -sa * ev * side + gauss() * 20 - ca * 30, ca * ev * side + gauss() * 20 - sa * 30, 1.8 + RNG() * 0.6,
        k === T_SNIPER ? 7 : 5.5, k === T_SNIPER ? 7 : 5.5, RNG() * TAU, gauss() * 14, 0.9, COL.brass, 1, 0, 2, FD_HOLD);
      spawn(S_CLOUD + ((RNG() * 4) | 0), x + ca * fs * 0.5, y + sa * fs * 0.5, ca * 26 + gauss() * 8, sa * 26 + gauss() * 8 - 10, 0.6 + RNG() * 0.3,
        6 + RNG() * 3, 15 + RNG() * 6, RNG() * TAU, gauss(), 0.96, COL.smokeMid, 0.42, 0, 1, FD_INOUT);
    } else if (k === T_FUSION) {
      // the fusion blob lands (0.15 s later): a burst of flame that cools in place, embers, and a few small flames
      // that keep licking the ground for a second
      const T = 0.15;
      for (let i = 0, n = 2 + ((RNG() * 2) | 0); i < n; i++) {
        const p = spawn(S_FIRE + (i & 1), tx + gauss() * 8, ty + gauss() * 8, gauss() * 30, gauss() * 30 - 14, 0.36 + RNG() * 0.16 + T, 14 + RNG() * 6, 26 + RNG() * 8,
          RNG() * TAU, gauss() * 0.6, 0.93, COL.fireOr, 1, F_FIRE, 1, FD_HOLD);
        page[p] = -T;
      }
      for (let i = 0; i < 5; i++) {
        const a = RNG() * TAU, sp = 120 + RNG() * 200, p = spawn(S_SPARK, tx, ty, Math.cos(a) * sp, Math.sin(a) * sp - 40, 0.3 + RNG() * 0.25 + T, 9 + RNG() * 5, 4, a, 0, 0.92,
          RNG() < 0.5 ? COL.fireYel : COL.fireOr, 1, F_ADD | F_STRETCH, 3, FD_LIN);
        page[p] = -T;
      }
      for (let i = 0; i < 5; i++) {
        const p = spawn(S_FIRE + (i & 1), tx + gauss() * 18, ty + gauss() * 18, gauss() * 6, -16 - RNG() * 12, 1.2 + RNG() * 0.6 + T, 7 + RNG() * 4, 12 + RNG() * 5,
          RNG() * TAU, gauss() * 0.4, 0.97, COL.fireOr, 1, F_FIRE, 1, FD_HOLD);
        page[p] = -T - 0.05 * i;
      }
      // embers drifting up off the burning patch
      for (let i = 0; i < 2; i++) {
        const p = spawn(S_DISC, tx + gauss() * 16, ty + gauss() * 16, gauss() * 12, -40 - RNG() * 30, 0.7 + RNG() * 0.4 + T, 3 + RNG() * 1.5, 2, 0, 0, 0.98,
          RNG() < 0.5 ? COL.fireYel : COL.fireOr, 1, F_ADD, 1, FD_HOLD);
        page[p] = -T - 0.15 - RNG() * 0.3;
      }
    }
    if (k === T_ROCKET) {
      // lingering grey smoke puffs that appear as the head passes them
      const T = rocketTime(len), n = Math.min(12, 2 + (len / 55) | 0);
      for (let i = 0; i < n; i++) {
        const u = (i + 0.3 + RNG() * 0.4) / n;
        const p = spawn(S_CLOUD + ((RNG() * 4) | 0), x + (tx - x) * u + gauss() * 3, y + (ty - y) * u + gauss() * 3, gauss() * 8, gauss() * 8 - 6,
          0.5 + RNG() * 0.3, 14 + 6 * RNG(), 30 + 10 * RNG(), RNG() * TAU, gauss(), 0.97, COL.smokeTrail, 0.5, 0, 1, FD_INOUT);
        page[p] = -u * T;
      }
      if (nrk < 32) { rkX[nrk] = tx; rkY[nrk] = ty; rkT[nrk] = rocketTime(len); nrk++; }
    }
  }
  function onHit(e) {
    const x = +e.x, y = +e.y;
    if (!(x === x && y === y)) return;
    const n = 2 + ((RNG() * 3) | 0);
    let c1 = COL.sparkAlien, c2 = COL.sparkPink;
    if (e.targetKind === 'marine') { c1 = COL.sparkMarine; c2 = PAL_MARINE.hi; } else if (e.targetKind === 'structure') { c1 = COL.sparkStruct; c2 = COL.sparkStruct; }
    for (let i = 0; i < n; i++) {
      const a = RNG() * TAU, sp = 160 + RNG() * 260;
      spawn(S_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.1 + RNG() * 0.12, 9 + RNG() * 7, 6, a, 0, 0.9, i & 1 ? c2 : c1, 1, F_ADD | F_STRETCH, 3.2, FD_LIN);
    }
    if (e.targetKind !== 'structure') {
      const a = RNG() * TAU, P = e.targetKind === 'marine' ? PAL_MARINE : PAL_ALIEN;
      spawn(S_DROP, x, y, Math.cos(a) * 70, Math.sin(a) * 70, 0.16, 4 + RNG() * 2, 2.5, 0, 0, 0.9, P.drop, 1, 0, 1, FD_LIN);
      // a small puff of ichor mist hanging where the round went in
      spawn(S_CLOUD + ((RNG() * 4) | 0), x, y, gauss() * 14, gauss() * 14, 0.45 + RNG() * 0.25, 6 + RNG() * 3, 14 + RNG() * 6, RNG() * TAU, gauss(), 0.94, P.b1, 0.45, 0, 1, FD_INOUT);
    }
  }
  function flingDir(x, y, fallback) {
    // the most recent shot that landed within 34 px of the death (this tick or the last few)
    let best = -1, bd = 34 * 34;
    for (let k = 0; k < 64; k++) {
      const j = (shHead - 1 - k) & (MAXSHOT - 1);
      if (shHead - 1 - k < 0 || V.tick - shT[j] > 6) break;
      const dx = shX[j] - x, dy = shY[j] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    return best >= 0 ? shA[best] + gauss() * 0.25 : fallback;
  }
  // pick a splat size class and diameter and log it. Classes: 0 small 20-50 px, 1 medium 70-130, 2 large 130-200,
  // 3 huge 220-300. Scale contrast must survive a lane that has been fought over: a huge roll is demoted to large when
  // another huge splash landed within HUGE_R px in the last HUGE_AGE s; a medium only on ground that is nearly full
  // (cov > 0.7); a large is never demoted. Only small splats fall into the darken-only path once an area is saturated.
  const CAP = 0.72, HUGE_N = 32, HUGE_R = 240, HUGE_AGE = 4;
  const hugeX = new Float32Array(HUGE_N), hugeY = new Float32Array(HUGE_N), hugeT = new Float32Array(HUGE_N);
  let hugeHead = 0;
  function hugeNear(x, y) {
    for (let i = 0, n = Math.min(hugeHead, HUGE_N); i < n; i++) {
      if (V.time - hugeT[i] > HUGE_AGE) continue;
      const dx = hugeX[i] - x, dy = hugeY[i] - y;
      if (dx * dx + dy * dy < HUGE_R * HUGE_R) return true;
    }
    return false;
  }
  const classD = (cls) => (cls === 0 ? 22 + 30 * RNG() : cls === 1 ? 75 + 60 * Math.pow(RNG(), 1.3) : cls === 2 ? 135 + 65 * RNG() : 225 + 75 * RNG());
  function bloodAt(x, y, k, dir, P, marine) {
    const odds = KIND_ODDS[k], u = RNG();
    let cls = u < odds[0] ? 0 : u < odds[1] ? 1 : u < odds[2] ? 2 : 3;
    let D = classD(cls) * KIND_SCALE[k];
    if (cls === 3) V.hugeRolls++;
    if (cls === 3 && hugeNear(x, y)) { V.hugeDemoted++; cls = 2; D = classD(2) * KIND_SCALE[k]; }
    let cov = covAt(x, y, Math.max(CG * 0.5, D * 0.28));
    if (cls === 1 && cov > 0.7) { cls = 0; D = 36 + 16 * RNG(); }
    if (cls === 0) {
      cov = covAt(x, y, CG * 0.5);
      if (cov > CAP && !marine) {
        // saturated: deepen the pool that is already there (with a lit fleck), don't spread
        addRecord(R_DARK, x, y, Math.min(D, 70), dir, 0);
        covAdd(x, y, Math.min(D, 70) * 0.2, 0.2);
        return 0;
      }
      if (cov > 0.32) D *= Math.max(0.6, 1 - (cov - 0.32) * 1.4);
    }
    if (cls === 3) { const h = hugeHead++ % HUGE_N; hugeX[h] = x; hugeY[h] = y; hugeT[h] = V.time; }
    const lvl = Math.min(2, (cov < 0.2 ? 0 : cov < 0.6 ? 1 : 2) + (RNG() < 0.08 ? 1 : 0));
    addRecord(marine ? R_MARINE : R_ALIEN, x, y, D, dir, lvl | (cls << 2));
    const rb = D * (cls === 0 ? 0.25 : cls === 3 ? 0.2 : 0.24);
    covAdd(x, y, rb, 1.1);
    if (cls > 0) covAdd(x + Math.cos(dir) * D * 0.28, y + Math.sin(dir) * D * 0.28, D * 0.12, 0.6);
    return D;
  }
  function onAlienDied(e) {
    const x = +e.x, y = +e.y;
    if (!(x === x && y === y)) return;
    const k = kindIndex(e.kind), facing = e.dir != null && e.dir === e.dir ? +e.dir : RNG() * TAU;
    const dir = flingDir(x, y, facing);
    const D = bloodAt(x, y, k, dir, PAL_ALIEN, false) || 40;
    addCorpse(k, x + Math.cos(dir) * 4, y + Math.sin(dir) * 4, facing, typeof e.sheet === 'string' ? e.sheet : null);
    // airborne droplets for a beat (the decal layer already has where they land)
    const n = 2 + ((RNG() * 3) | 0) + (k >= 3 ? 6 : 0);
    for (let i = 0; i < n; i++) {
      const a = dir + gauss() * 0.7, sp = 140 + RNG() * 240 * (k >= 3 ? 1.5 : 1);
      spawn(S_DROP2, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.16 + RNG() * 0.14, 6 + RNG() * 5, 3, a, 0, 0.88, RNG() < 0.6 ? PAL_ALIEN.b0 : PAL_ALIEN.drop, 1, F_STRETCH, 2, FD_LIN);
    }
    // a blood mist that hangs over the splash for half a second
    spawn(S_CLOUD + ((RNG() * 4) | 0), x + Math.cos(dir) * 6, y + Math.sin(dir) * 6, Math.cos(dir) * 30, Math.sin(dir) * 30, 0.45 + RNG() * 0.2, Math.min(30, D * 0.3), Math.min(56, D * 0.5),
      RNG() * TAU, gauss() * 0.5, 0.93, PAL_ALIEN.b1, 0.4, 0, 1, FD_INOUT);
    // a brief wet pop
    spawn(S_GLOW, x, y, 0, 0, 0.1, Math.min(60, D * 0.5), Math.min(80, D * 0.7), 0, 0, 1, PAL_ALIEN.hi, 0.35, F_ADD, 1, FD_QUAD);
    if (k >= 3) shred(x, y, k === 4 ? 1.25 : 1, dir);
  }
  function shred(x, y, sc, dir) {
    // a white-hot rip: starburst flash, white shred spikes, chunky carapace chips that tumble and settle as debris
    spawn(S_GLOW, x, y, 0, 0, 0.12, 50 * sc, 110 * sc, 0, 0, 1, COL.white, 0.95, F_ADD, 1, FD_LIN);
    spawn(S_GLOW, x, y, 0, 0, 0.3, 90 * sc, 150 * sc, 0, 0, 1, PAL_ALIEN.hi, 0.25, F_ADD, 1, FD_QUAD);
    // white shred: bone-white splinters ripping outward (normal blend, crisp) over a brief additive streak each
    const nsp = 16 + ((RNG() * 6) | 0);
    for (let i = 0; i < nsp; i++) {
      const a = (i / nsp) * TAU + gauss() * 0.3, sp = (380 + RNG() * 420) * sc, len = (18 + RNG() * 26) * sc;
      spawn(S_SHARD, x + Math.cos(a) * 8, y + Math.sin(a) * 8, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + RNG() * 0.16, len * 1.4, len * 0.6, a, 0, 0.85, COL.white, 0.9, F_ADD | F_STRETCH, 4, FD_LIN);
      if (i & 1) spawn(S_SHARD, x, y, Math.cos(a) * sp * 0.6, Math.sin(a) * sp * 0.6, 0.45 + RNG() * 0.25, len * 0.8, len * 0.55, a, 0, 0.87, COL.shred, 1, F_STRETCH, 3, FD_HOLD);
    }
    const nc = 20 + ((RNG() * 9) | 0);
    for (let i = 0; i < nc; i++) {
      const a = dir + gauss() * 1.6, sp = (160 + RNG() * 380) * sc, s = (9 + RNG() * 10) * sc;
      spawn(G_CHIP + ((RNG() * 3) | 0), x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.6 + RNG() * 0.35, s, s, RNG() * TAU, gauss() * 14, 0.88,
        CHIP_COLS[1 + ((RNG() * 3) | 0)], 1, 0, 1, FD_HOLD);
    }
    addRecord(R_CHIPS, x, y, 70 * sc, dir, 0);
  }
  function explosion(x, y, r, kind) {
    r = r > 0 ? r : 80;
    const big = kind === 'hive' ? 1.5 : 1, s = Math.max(24, r * big), vs = s / 100;
    // 1. a short white-hot flash and a warm light bloom on the ground
    spawn(S_GLOW, x, y, 0, 0, 0.1, s * 0.7, s * 1.0, 0, 0, 1, COL.fireWhite, 0.9, F_ADD, 1, FD_LIN);
    spawn(S_GLOW, x, y, 0, 0, 0.45, s * 1.6, s * 2.4, 0, 0, 1, COL.fireOr, 0.3, F_ADD, 1, FD_QUAD);
    // 2. a brief shock band, 1.4 x the blast, gone in 0.08 s
    spawn(S_GLOW, x, y, 0, 0, 0.08, s * 0.5, s * 1.4, 0, 0, 1, COL.ring, 0.5, F_ADD | F_RING, 3, FD_LIN);
    // 3. fire balls (normal blend, F_FIRE): baked white-hot core / yellow / orange / red lip steps with a lumpy edge,
    // tinted from white toward red and soot as they cool; a 1 px dark-red outline only in the last 40 % of life
    let p;
    const nb = 5 + (s > 90 ? 3 : 0) + (big > 1 ? 3 : 0);
    for (let i = 0; i < nb; i++) {
      const a = RNG() * TAU, d = i === 0 ? 0 : (0.15 + 0.3 * RNG()) * s, sz = s * (0.5 + 0.35 * RNG()) * (i === 0 ? 1.2 : 1);
      const life = 0.32 + RNG() * 0.2, delay = i === 0 ? 0 : RNG() * 0.06, sp = (60 + RNG() * 80) * vs;
      const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
      p = spawn(S_FIRE + (i & 1), bx, by, Math.cos(a) * sp, Math.sin(a) * sp - 10, life + delay, sz * 0.55, sz * 1.1, RNG() * TAU, gauss() * 0.5, 0.94,
        COL.fireOr, 1, F_FIRE, 1, FD_HOLD);
      page[p] = -delay;
      p = spawn(S_GLOW, bx, by, Math.cos(a) * sp, Math.sin(a) * sp - 10, life * 0.5 + delay, sz * 1.1, sz * 1.4, 0, 0, 0.94, COL.fireOr, 0.35, F_ADD, 1, FD_QUAD);
      page[p] = -delay;
    }
    // 4. embers and chunky debris
    const ne = 8 + ((RNG() * 6) | 0);
    for (let i = 0; i < ne; i++) {
      const a = RNG() * TAU, sp = (300 + RNG() * 420) * Math.sqrt(vs);
      spawn(S_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.25 + RNG() * 0.3, 12 + RNG() * 8, 4, a, 0, 0.92, RNG() < 0.5 ? COL.fireYel : COL.fireWhite, 1, F_ADD | F_STRETCH, 3.5, FD_LIN);
    }
    const nd = 5 + ((RNG() * 5) | 0);
    for (let i = 0; i < nd; i++) {
      const a = RNG() * TAU, sp = (180 + RNG() * 320) * Math.sqrt(vs), sz = 5 + RNG() * 6;
      spawn(G_CHIP + ((RNG() * 3) | 0), x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + RNG() * 0.3, sz, sz, RNG() * TAU, gauss() * 16, 0.9, COL.debris, 1, 0, 1, FD_HOLD);
    }
    // 5. smoke: chunky puffs (F_PUFF: 1 px dark edge, dark base, lit top) that rise as the fire dies
    const ns = 5 + ((RNG() * 4) | 0) + (big > 1 ? 3 : 0);
    for (let i = 0; i < ns; i++) {
      const a = RNG() * TAU, d = RNG() * s * 0.45, sp = (14 + RNG() * 36) * vs;
      p = spawn(S_BLOB + ((RNG() * 4) | 0), x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * sp, Math.sin(a) * sp - 22, 0.85 + RNG() * 0.5,
        s * (0.45 + RNG() * 0.25), s * (0.9 + RNG() * 0.4), RNG() * TAU, gauss() * 0.3, 0.985, COL.smoke, 0.92, F_PUFF, 1, FD_HOLD);
      page[p] = -0.14 - RNG() * 0.12;
    }
    addRecord(R_SCORCH, x, y, s, RNG() * TAU, 0);
    shake(V.world, Math.min(18, 3 + s * 0.08), x, y);
  }
  function onExplosion(e) {
    const x = +e.x, y = +e.y;
    if (!(x === x && y === y)) return;
    // an explosion at the target of a rocket fired this tick waits for the rocket head to get there
    for (let i = 0; i < nrk; i++) {
      const dx = rkX[i] - x, dy = rkY[i] - y;
      if (dx * dx + dy * dy < 48 * 48 && nex < MAXEX) {
        exX[nex] = x; exY[nex] = y; exR[nex] = +e.r || 0; exK[nex] = Math.max(0, EXKINDS.indexOf(e.kind)); exAt[nex] = V.tick + Math.max(1, Math.round(rkT[i] * 60)); nex++;
        return;
      }
    }
    explosion(x, y, +e.r, e.kind);
  }
  function onMarineDied(e) {
    const x = +e.x, y = +e.y;
    if (!(x === x && y === y)) return;
    const dir = flingDir(x, y, RNG() * TAU);
    addRecord(R_MARINE, x, y, 140, dir, (2 << 2) | 1);
    covAdd(x, y, 24, 1.5);
    addRecord(R_X, x, y, 15, 0, 0);
    for (let i = 0; i < 10; i++) {
      const a = RNG() * TAU, sp = 100 + RNG() * 200;
      spawn(S_DROP2, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.2 + RNG() * 0.12, 7, 3, a, 0, 0.88, PAL_MARINE.b0, 1, F_STRETCH, 2, FD_LIN);
    }
    spawn(S_GLOW, x, y, 0, 0, 0.3, 60, 90, 0, 0, 1, COL.sparkMarine, 0.5, F_ADD, 1, FD_QUAD);
    shake(V.world, 5, x, y);
  }
  function onHiveCaptured(e) {
    const x = +e.x, y = +e.y;
    if (!(x === x && y === y)) return;
    burst(x, y, COL.magenta, 32, 1);
  }
  function burst(x, y, c24, n, scale) {
    const sc = scale || 1;
    spawn(S_GLOW, x, y, 0, 0, 0.9, 120 * sc, 320 * sc, 0, 0, 1, c24, 0.55, F_ADD, 1, FD_QUAD);
    spawn(S_GLOW, x, y, 0, 0, 0.35, 90 * sc, 60 * sc, 0, 0, 1, COL.magentaHot, 0.9, F_ADD, 1, FD_QUAD);
    spawn(S_GLOW, x, y, 0, 0, 0.8, 40 * sc, 480 * sc, 0, 0, 1, c24, 0.9, F_ADD | F_RING, 1, FD_QUAD);
    spawn(S_GLOW, x, y, 0, 0, 0.6, 20 * sc, 300 * sc, 0, 0, 1, COL.magentaHot, 0.7, F_ADD | F_RING, 1, FD_QUAD);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + gauss() * 0.1, sp = (220 + RNG() * 260) * sc;
      spawn(S_SPARK, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.5 + RNG() * 0.4, 18 + RNG() * 12, 8, a, 0, 0.95, i & 1 ? COL.magentaHot : c24, 1, F_ADD | F_STRETCH, 3.5, FD_LIN);
    }
  }
  function shake(world, amp, x, y) {
    if (!V || !world) return;
    let k = 1;
    if (x != null && world.camera) {
      const c = world.camera, d = Math.hypot(x - c.x, y - c.y);
      k = d < 900 ? 1 : Math.max(0, 1 - (d - 900) / 900);
    }
    V.shakeAmp = Math.min(24, V.shakeAmp + amp * k);
  }

  // ------------------------------------------------------------------ decal painting (draw time, into render-target chunks)
  let R = null, RS = 0;
  function rr() {
    RS = (RS + 0x6d2b79f5) >>> 0;
    let t = RS;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rg = () => (rr() + rr() + rr() - 1.5) / 1.5;
  const QO = { layer: 'decal', tex: null, uv: null, center: true, rot: 0 };
  function st(stamp, x, y, w, h, rot, c24, a) {
    QO.uv = UV[stamp]; QO.rot = rot;
    R.quad(x, y, w, h, withA(c24, a), QO);
  }
  // scratch list for one splat's droplets (outlines first, colour after)
  const DR = new Float32Array(64 * 4);
  const LW = -0.75 * Math.PI;       // key light from the upper left (world angle toward the light)
  const EO = { layer: 'decal', tex: null, uv: null, center: true, rot: 0 };
  function edge(id, d, x, y, s, rot, c24) {
    EO.tex = ART.edges; EO.uv = EUV[id * NDIR + d]; EO.rot = rot;
    R.quad(x, y, s, s, withA(c24, 1), EO);
  }
  // one death's splat. cls 0 small (20-50 px), 1 medium (70-130), 2 large (130-200), 3 huge (220-300). lvl 0..2 = how
  // much blood was already there (fresh splats are bright crimson, splats landing on old blood use darker body steps).
  // Flat value steps at 1:1, back to front: spatter fringe (1 px outlined hard droplets out to 1.6x the radius), a
  // see-through body (the ground mottling reads through), 2-3 off-centre dark pools (two ramp steps), a lighter fresh
  // zone on the lit side, then one edge quad (1 px outline + 1 px lit step on the key-light side), tip droplets.
  function paintSplat(x, y, D, dir, lvl, cls, P) {
    const body = lvl === 0 ? P.b0 : P.b1;
    // landing on old blood: first deepen what is already there around it (overlap darkening)
    if (lvl === 2) st(G_CORE + ((rr() * 3) | 0), x, y, D * 0.5, D * 0.44, rr() * TAU, P.core, 0.22);
    let id, rot;
    if (cls === 3) { id = G_SPL_H + ((rr() * 2) | 0); rot = dir + rg() * 0.1; }
    else if (cls === 2) { id = G_SPL_D + ((rr() * 4) | 0); rot = dir + rg() * 0.2; }
    else if (cls === 1) { if (rr() < 0.7) { id = G_SPL_D + ((rr() * 4) | 0); rot = dir + rg() * 0.25; } else { id = G_SPL_O + ((rr() * 4) | 0); rot = rr() * TAU; } }
    else { id = G_SPL_S + ((rr() * 4) | 0); rot = rr() * TAU; }
    // the shape keeps its exact rotation; the edge stamp is the baked light direction nearest the key light
    const ed = (((Math.round((LW - rot) / (TAU / NDIR))) % NDIR) + NDIR) % NDIR;
    // the body centre lands on the death point; the stamp centre sits ahead of it for directional shapes
    const bxo = BODYX[id] * D, cr = Math.cos(rot), sr = Math.sin(rot), sx = x - cr * bxo, sy = y - sr * bxo, bd = BODYR[id] * 2 * D;
    const lcx = Math.cos(LW), lcy = Math.sin(LW);
    if (cls === 0) {
      // small: one quad with its own outline, a lit fleck, nothing else
      st(id, sx, sy, D, D, rot, body, 0.93);
      { const f = bd * (0.36 + 0.12 * rr()); st(G_CORE + ((rr() * 3) | 0), x + lcx * bd * 0.14, y + lcy * bd * 0.14, f, f * 0.75, LW + Math.PI / 2 + rg() * 0.4, P.lit, 1); }
      return;
    }
    // spatter fringe: 20-40 hard droplets from the body edge out to 1.6x its radius, mostly flung forward
    const Rr = Math.max(bd * 0.5, D * 0.3), nsp = cls === 1 ? 20 + ((rr() * 7) | 0) : cls === 2 ? 26 + ((rr() * 9) | 0) : 32 + ((rr() * 9) | 0);
    for (let i = 0; i < nsp; i++) {
      const fwd = rr() < 0.65, a = fwd ? dir + rg() * 1.1 : rr() * TAU, q = Math.pow(rr(), 0.8);
      const d = Rr * (1.0 + 0.6 * q) * (fwd ? 1 : 0.92);
      const sz = Math.max(2, (2 + 4 * rr() * rr()) * (1.15 - 0.45 * q));
      DR[i * 4] = x + Math.cos(a) * d; DR[i * 4 + 1] = y + Math.sin(a) * d; DR[i * 4 + 2] = sz; DR[i * 4 + 3] = rr();
    }
    for (let i = 0; i < nsp; i++) { const sz = DR[i * 4 + 2]; if (sz >= 2.6) st(G_DOT, DR[i * 4], DR[i * 4 + 1], sz + 2, sz + 2, 0, P.o, 0.9); }
    for (let i = 0; i < nsp; i++) {
      const sz = DR[i * 4 + 2], c = DR[i * 4 + 3];
      st(G_DOT, DR[i * 4], DR[i * 4 + 1], sz, sz, 0, sz < 2.6 ? P.b1 : c < 0.55 ? body : c < 0.8 ? P.b0 : P.lit, 1);
    }
    // the body, see-through
    st(id, sx, sy, D, D, rot, body, 0.92);
    // interior, flat ramp steps: an inset echo of the silhouette one step darker (pooled, thicker blood) sitting toward
    // the shadow side, 2 off-centre dark pools (two steps) inside it, and a thinner, lighter zone toward the key light
    {
      const k = 0.52 + 0.08 * rr(), sh = bd * 0.08, ex = x - lcx * sh, ey = y - lcy * sh;
      st(id, ex + (sx - x) * k, ey + (sy - y) * k, D * k, D * k, rot, lvl === 2 ? P.b2 : lvl === 1 ? P.b12 : P.b1, 0.9);
      // nested, not side by side: a b2 pool, the deepest core inside it (pushed further into the shadow), and
      // sometimes a small b2 satellite pool out toward the death direction
      const a = LW + Math.PI + rg() * 0.7, off = bd * (0.08 + 0.08 * rr()), f = bd * (0.4 + 0.12 * rr());
      const px_ = x + Math.cos(a) * off, py_ = y + Math.sin(a) * off;
      st(G_CORE + ((rr() * 3) | 0), px_, py_, f, f * (0.75 + 0.2 * rr()), rr() * TAU, P.b2, 0.9);
      const f2 = f * (0.5 + 0.14 * rr()), a2 = a + rg() * 0.5;
      st(G_CORE + ((rr() * 3) | 0), px_ + Math.cos(a2) * f * 0.14, py_ + Math.sin(a2) * f * 0.14, f2, f2 * (0.75 + 0.2 * rr()), rr() * TAU, P.core, 0.9);
      if (rr() < 0.5) {
        const f3 = bd * (0.16 + 0.08 * rr()), d3 = bd * (0.26 + 0.08 * rr()), a3 = dir + rg() * 0.5;
        st(G_CORE + ((rr() * 3) | 0), x + Math.cos(a3) * d3, y + Math.sin(a3) * d3, f3, f3 * 0.8, rr() * TAU, P.b2, 0.9);
      }
      // the lit step: a smaller echo of the same silhouette pushed toward the key light, so it follows the shape
      // and stays inside it (a flat cel light/shadow split, not a glossy spot)
      const k2 = 0.4 + 0.06 * rr(), sl = bd * 0.2, lx2 = x + lcx * sl, ly2 = y + lcy * sl;
      st(id, lx2 + (sx - x) * k2, ly2 + (sy - y) * k2, D * k2, D * k2, rot, P.lit, 1);
    }
    // 1 px outline + 1 px lit step, over the whole shape including its tongue
    edge(id, ed, sx, sy, D, rot, P.hi);
    // huge: 3-5 shrinking droplets past the tongue tip, along the tongue
    if (cls === 3 && TIPU[id] !== undefined) {
      const tu = TIPU[id] * D, tv = TIPV[id] * D, tx = sx + cr * tu - sr * tv, ty = sy + sr * tu + cr * tv, ta = rot + TIPA[id];
      const k = D / 260, n = 3 + ((rr() * 3) | 0), SZ = [6, 4, 3, 2, 1.6];
      let d = 2.5 * k;
      for (let i = 0; i < n; i++) {
        const sz = Math.max(1.6, SZ[i] * k * (0.9 + 0.2 * rr()));
        d += sz * 0.5 + (4 + 3 * i) * k * (0.8 + 0.4 * rr());
        const px_ = tx + Math.cos(ta) * d + rg() * 1.2, py_ = ty + Math.sin(ta) * d + rg() * 1.2;
        if (sz >= 2.6) st(G_DOT, px_, py_, sz + 2, sz + 2, 0, P.o, 0.92);
        st(G_DOT, px_, py_, sz, sz, 0, i === 0 ? body : P.b0, 1);
        d += sz * 0.5;
      }
    }
    // one or two small specular flecks on the lit side
    for (let i = 0, n = cls === 1 ? 1 : 2; i < n; i++) {
      const a = LW + rg() * 0.6, d = bd * (0.2 + 0.14 * rr()), g = 2 + rr() * (cls === 3 ? 2 : 1.2);
      st(G_DOT, x + Math.cos(a) * d, y + Math.sin(a) * d, g, g, 0, P.spec, 0.95);
    }
  }
  // a death on ground that is already saturated: deepen it a step, drop a small fresh fleck on top and a few flung
  // droplets, so a saturated zone keeps flat ramped detail instead of going one colour
  function paintDark(x, y, D, dir, P) {
    const s = D * (0.55 + 0.2 * rr());
    st(G_CORE + ((rr() * 3) | 0), x, y, s, s * (0.8 + 0.25 * rr()), rr() * TAU, P.core, 0.24 + 0.14 * rr());
    const f = s * (0.32 + 0.14 * rr()), lx = Math.cos(LW), ly = Math.sin(LW);
    st(G_CORE + ((rr() * 3) | 0), x + lx * s * 0.12, y + ly * s * 0.12, f, f * 0.8, rr() * TAU, rr() < 0.5 ? P.b0 : P.lit, 0.75);
    for (let i = 0, n = 3 + ((rr() * 4) | 0); i < n; i++) {
      const a = dir + rg() * 1.0, d = s * (0.45 + 0.5 * rr()), g = 2 + 2.5 * rr() * rr();
      st(G_DOT, x + Math.cos(a) * d, y + Math.sin(a) * d, g, g, 0, i & 1 ? P.b0 : P.b1, 1);
    }
  }
  function paintScorch(x, y, s, rot) {
    const d = s * 2.1;
    st(G_SOOT + ((rr() * 2) | 0), x, y, d, d * (0.9 + 0.15 * rr()), rot, COL.scorch, 0.62);
    st(G_CORE + ((rr() * 3) | 0), x, y, s * 0.55, s * 0.5, rr() * TAU, COL.scorch, 0.4);
  }
  function paintChips(x, y, s, dir) {
    for (let i = 0, n = 7 + ((rr() * 5) | 0); i < n; i++) {
      const a = dir + rg() * 1.6, d = s * (0.4 + 1.2 * rr()), sz = 6 + rr() * 7, cx = x + Math.cos(a) * d, cy = y + Math.sin(a) * d, r0 = rr() * TAU;
      st(G_CHIP + ((rr() * 3) | 0), cx + 0.8, cy + 1.2, sz + 2, sz + 2, r0, PAL_ALIEN.o, 0.7);
      st(G_CHIP + ((rr() * 3) | 0), cx, cy, sz, sz, r0, CHIP_COLS[(rr() * 3) | 0], 1);
    }
  }
  const LO = { layer: 'decal' };
  function paintX(x, y, s) {
    QO.uv = UV[S_DISC]; QO.rot = 0;
    R.quad(x, y, s * 2.4, s * 2.4, withA(COL.darkX, 0.45), QO);
    R.line(x - s, y - s, x + s, y + s, 7, withA(COL.darkX, 0.9), LO);
    R.line(x - s, y + s, x + s, y - s, 7, withA(COL.darkX, 0.9), LO);
    R.line(x - s + 1.5, y - s + 1.5, x + s - 1.5, y + s - 1.5, 3.5, withA(COL.greyX, 1), LO);
    R.line(x - s + 1.5, y + s - 1.5, x + s - 1.5, y - s + 1.5, 3.5, withA(COL.greyX, 1), LO);
  }
  function paintRecord(i) {
    RS = rseed[i];
    const x = rx[i], y = ry[i], s = rs[i], d = rdir[i], l = rlev[i];
    QO.tex = ART.atlas;
    switch (rkind[i]) {
      case R_ALIEN: paintSplat(x, y, s, d, l & 3, l >> 2, PAL_ALIEN); break;
      case R_DARK: paintDark(x, y, s, d, PAL_ALIEN); break;
      case R_MARINE: paintSplat(x, y, s, d, l & 3, l >> 2, PAL_MARINE); break;
      case R_X: paintX(x, y, s); break;
      case R_SCORCH: paintScorch(x, y, s, d); break;
      case R_CHIPS: paintChips(x, y, s, d); break;
    }
  }
  // decal reach in px from the record centre (for chunk overlap tests)
  const reach = (i) => (rkind[i] === R_SCORCH ? rs[i] * 1.2 : rkind[i] === R_CHIPS ? rs[i] * 1.8 : rs[i] * 1.3) + 24;
  let curChunk = null, pFrom = 0, pTo = 0;
  const CLEAR = { clear: 0 };
  function paintChunk(r) {
    R = r;
    const c = curChunk;
    for (let k = pFrom; k < pTo; k++) {
      const i = k & (MAXREC - 1), m = reach(i);
      if (rx[i] + m < c.x || rx[i] - m > c.x + c.w || ry[i] + m < c.y || ry[i] - m > c.y + c.h) continue;
      paintRecord(i);
    }
  }
  const rtPool = {};
  function acquireTarget(w, h) {
    const key = w + 'x' + h, list = rtPool[key];
    const t = list && list.length ? list.pop() : IP.gfx.target(w, h, { filter: 'linear' });
    t.onRestore = onRestore;
    return t;
  }
  function onRestore() {
    // targets come back empty after a context loss: replay the record log (last MAXREC decals)
    if (!V) return;
    rpainted = Math.max(0, rhead - MAXREC);
    for (const c of V.chunks) c.dirty = true;
    V.anyDirty = true;
  }
  function setupChunks(world) {
    const m = world.map || { w: 3840, h: 2160 };
    const res = IP.budget && IP.budget.decalRes ? IP.budget.decalRes : (IP.mobile ? 0.5 : 1);
    const chunks = [];
    for (let y = 0; y < m.h; y += CHUNK) for (let x = 0; x < m.w; x += CHUNK) {
      const w = Math.min(CHUNK, m.w - x), h = Math.min(CHUNK, m.h - y);
      chunks.push({ x, y, w, h, tw: Math.max(1, Math.round(w * res)), th: Math.max(1, Math.round(h * res)), rt: null, dirty: true });
    }
    V.chunks = chunks; V.mapW = m.w; V.mapH = m.h;
    covSetup(world);
  }
  function flushDecals(r) {
    if (rpainted >= rhead && !V.anyDirty) return;
    if (V.mapW !== (V.world.map && V.world.map.w) || V.mapH !== (V.world.map && V.world.map.h)) { releaseChunks(); setupChunks(V.world); }
    pFrom = rpainted; pTo = rhead;
    for (const c of V.chunks) {
      let hit = false;
      for (let k = pFrom; k < pTo && !hit; k++) {
        const i = k & (MAXREC - 1), m = reach(i);
        if (!(rx[i] + m < c.x || rx[i] - m > c.x + c.w || ry[i] + m < c.y || ry[i] - m > c.y + c.h)) hit = true;
      }
      if (!hit && !(c.dirty && c.rt)) continue;
      if (!c.rt) { c.rt = acquireTarget(c.tw, c.th); c.dirty = true; }
      curChunk = c;
      if (c.dirty) { c.dirty = false; r.renderTo(c.rt, c, paintChunk, CLEAR); }
      else r.renderTo(c.rt, c, paintChunk);
    }
    rpainted = rhead;
    V.anyDirty = false;
  }
  function releaseChunks() {
    if (!V || !V.chunks) return;
    for (const c of V.chunks) if (c.rt) { const key = c.rt.w + 'x' + c.rt.h; (rtPool[key] = rtPool[key] || []).push(c.rt); c.rt = null; }
  }

  // ------------------------------------------------------------------ the system
  const PO = { layer: 'fx', tex: null, uv: null, center: true, rot: 0, add: false };
  const RO = { layer: 'fx', width: 3, add: true };
  const TO = { layer: 'fx', tex: null, uv: [0, 0, 1, 1], center: true, rot: 0, add: false };
  const CO = { layer: 'decal', tint: 0 };
  const CHO = { layer: 'decal', tex: null };

  const vfx = {
    init(world) {
      releaseChunks();
      if (!ART && IP.gfx.gl) { const t0 = performance.now(); buildArt(); BAKE_MS = performance.now() - t0; }
      RNG = IP.fork(world, 'vfx');
      V = world.vfx = { world, time: 0, tick: 0, chunks: [], mapW: 0, mapH: 0, anyDirty: false, shakeAmp: 0, ox: 0, oy: 0, ph: RNG() * 100, tsteal: 0,
        snames: [], sheets: [], csheets: [], loading: new Set(), cov: null, gw: 0, gh: 0, hugeRolls: 0, hugeDemoted: 0 };
      np = 0; steal = 0; nt = 0; chead = 0; ccount = 0; hugeHead = 0; rhead = 0; rpainted = 0; shHead = 0; nrk = 0; nex = 0;
      setupChunks(world);
      for (const n of KIND_SHEET) sheetIndex(n);
      KIND_SHEET.forEach((n, i) => { IP.assets.load(n).then((s) => { if (V && V.world === world) V.sheets[i] = s; }, () => {}); });
    },
    start(world) {
      // the scenario may have changed the map size after init
      if (V && (V.mapW !== world.map.w || V.mapH !== world.map.h)) { releaseChunks(); setupChunks(world); }
      if (V) for (let i = 0; i < KIND_SHEET.length; i++) V.sheets[i] = V.sheets[i] || IP.assets.sheet(KIND_SHEET[i]);
    },
    update(world, dt) {
      if (!V || V.world !== world) return;
      const cam = world.camera;
      if (V.ox || V.oy) { cam.x -= V.ox; cam.y -= V.oy; V.ox = V.oy = 0; }
      V.time = world.time; V.tick = world.tick;
      if (world.vfxDemo) demoUpdate(world);
      if (world.vfxBench) benchUpdate(world);
      const ev = world.events;
      nrk = 0;
      // rocket shots first, so an explosion at their target (in any event order) waits for the head to land
      for (let i = 0; i < ev.length; i++) if (ev[i].type === 'shot' && ev[i].weapon === 'rocket') onShot(ev[i]);
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        switch (e.type) {
          case 'shot': if (e.weapon !== 'rocket') onShot(e); break;
          case 'hit': onHit(e); break;
          case 'alien-died': onAlienDied(e); break;
          case 'explosion': onExplosion(e); break;
          case 'marine-died': onMarineDied(e); break;
          case 'hive-captured': onHiveCaptured(e); break;
        }
      }
      // deferred explosions whose rocket has arrived
      for (let i = 0; i < nex; i++) {
        if (exAt[i] > V.tick) continue;
        explosion(exX[i], exY[i], exR[i], EXKINDS[exK[i]]);
        const j = --nex;
        exX[i] = exX[j]; exY[i] = exY[j]; exR[i] = exR[j]; exK[i] = exK[j]; exAt[i] = exAt[j];
        i--;
      }
      // particles (a negative age is a spawn delay: the particle waits, unmoved and undrawn)
      for (let i = 0; i < np; i++) {
        const a = (page[i] += dt);
        if (a >= plife[i]) {
          const j = --np;
          if (i !== j) {
            px[i] = px[j]; py[i] = py[j]; pvx[i] = pvx[j]; pvy[i] = pvy[j]; page[i] = page[j]; plife[i] = plife[j]; ps0[i] = ps0[j]; ps1[i] = ps1[j];
            prot[i] = prot[j]; pvrot[i] = pvrot[j]; pdrag[i] = pdrag[j]; pcol[i] = pcol[j]; pcol2[i] = pcol2[j]; pa0[i] = pa0[j]; pstamp[i] = pstamp[j]; pflag[i] = pflag[j];
            pasp[i] = pasp[j]; pfade[i] = pfade[j];
          }
          i--; continue;
        }
        if (a < 0) continue;
        px[i] += pvx[i] * dt; py[i] += pvy[i] * dt;
        const dr = pdrag[i]; pvx[i] *= dr; pvy[i] *= dr;
        prot[i] += pvrot[i] * dt; pvrot[i] *= dr;
      }
      if (steal >= np) steal = 0;
      // tracers
      for (let i = 0; i < nt; i++) {
        if ((tage[i] += dt) >= tlife[i]) {
          const j = --nt;
          if (i !== j) { tx0[i] = tx0[j]; ty0[i] = ty0[j]; tx1[i] = tx1[j]; ty1[i] = ty1[j]; tage[i] = tage[j]; tlife[i] = tlife[j]; tkind[i] = tkind[j]; }
          i--;
        }
      }
      // camera shake: deterministic, decaying, applied as an offset that is removed next tick
      if (V.shakeAmp > 0.05) {
        const t = world.tick + V.ph;
        V.ox = V.shakeAmp * (Math.sin(t * 1.31) * 0.65 + Math.sin(t * 2.17 + 1.3) * 0.35);
        V.oy = V.shakeAmp * (Math.sin(t * 1.73 + 0.7) * 0.65 + Math.sin(t * 2.71 + 2.1) * 0.35);
        cam.x += V.ox; cam.y += V.oy;
        V.shakeAmp *= 0.89;
      } else V.shakeAmp = 0;
    },
    draw(world, r) {
      if (!V || V.world !== world || !ART) return;
      const cam = world.camera, z = cam.zoom || 1, hw = 960 / z, hh = 540 / z;
      const vx0 = cam.x - hw, vx1 = cam.x + hw, vy0 = cam.y - hh, vy1 = cam.y + hh;
      if ((world.vfxDemo || world.vfxBench) && !world.terrain) {
        const m = world.map;
        r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: ART.ground, uv: [0, 0, m.w / 256, m.h / 256] });
        r.quad(0, 0, m.w, m.h, 'rgba(8,6,12,0.22)', { layer: 'ground', tex: ART.ground, uv: [0.31, 0.57, 0.31 + m.w / 2900, 0.57 + m.h / 2900] });
      }
      // 1. persistent blood: paint pending records, then one quad per chunk
      flushDecals(r);
      for (const c of V.chunks) {
        if (!c.rt || c.x > vx1 || c.x + c.w < vx0 || c.y > vy1 || c.y + c.h < vy0) continue;
        CHO.tex = c.rt;
        r.quad(c.x, c.y, c.w, c.h, 0xffffffff, CHO);
      }
      // 2. corpses: the bug's own sprite, dead-coloured, held 2 s then fading out over 18 s. At most 3 per 32 px
      // cell are drawn (newest first), so a pile at a stream front never turns into a murk that hides live bugs.
      if (ccount) {
        const now = V.time, LIFE = CORPSE_HOLD + CORPSE_FADE, gw = V.gw, gh = V.gh, mark = V.cmark, cnt = V.ccnt;
        const frame = (V.cframe = (V.cframe + 1) >>> 0) || (V.cframe = 1);
        let n = 0;
        for (let k = 0; k < ccount; k++) {
          const i = (chead - 1 - k + MAXC) % MAXC, age = now - cborn[i];
          if (age >= LIFE) break;           // the ring is in birth order: everything older is gone too
          const x = cxs[i], y = cys[i];
          if (x < vx0 - 80 || x > vx1 + 80 || y < vy0 - 80 || y > vy1 + 80) continue;
          const c = Math.min(gh - 1, Math.max(0, (y / CG) | 0)) * gw + Math.min(gw - 1, Math.max(0, (x / CG) | 0));
          if (mark[c] !== frame) { mark[c] = frame; cnt[c] = 0; }
          if (cnt[c] >= 3) continue;
          cnt[c]++;
          CLIST[n++] = i;
        }
        for (let q = n - 1; q >= 0; q--) {
          const i = CLIST[q], age = now - cborn[i], x = cxs[i], y = cys[i];
          const si = csheet[i];
          let sh = V.csheets[si];
          if (!sh) {
            let src = V.sheets[si];
            if (!src) src = V.sheets[si] = IP.assets.sheet(V.snames[si]) || null;
            if (!src && !V.loading.has(si)) { V.loading.add(si); const w0 = V; IP.assets.load(V.snames[si]).then((s) => { if (V === w0) V.sheets[si] = s; }, () => {}); }
            if (!src) src = V.sheets[ckind[i]];
            if (src) sh = V.csheets[si] = corpseSheet(src);
          }
          const a = age < CORPSE_HOLD ? 1 : 1 - (age - CORPSE_HOLD) / CORPSE_FADE;
          if (sh) {
            CO.tint = withA(0xffffff, 0.9 * a * a);
            r.sprite(sh, sh.frame(crow[i] % sh.rows, 'idle', 0), x, y, CO);
          } else {
            QO.tex = ART.atlas; QO.uv = UV[S_BLOB]; QO.rot = 0; QO.layer = 'decal';
            r.quad(x, y, 18, 14, withA(PAL_ALIEN.o, a), QO);
          }
        }
      }
      if (world.vfxDemo) demoDraw(world, r);
      // 3. tracers
      for (let i = 0; i < nt; i++) drawTracer(r, i, vx0, vx1, vy0, vy1);
      // 4. particles: normal-blend pass (smoke, blood, fire bodies, chips) then additive pass (glows, sparks, flashes)
      PO.tex = ART.atlas;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < np; i++) {
          const f = pflag[i];
          if ((f & F_ADD ? 1 : 0) !== pass || page[i] < 0) continue;
          const x = px[i], y = py[i], s1 = ps1[i];
          if (x < vx0 - s1 || x > vx1 + s1 || y < vy0 - s1 || y > vy1 + s1) continue;
          const t = page[i] / plife[i];
          let al;
          switch (pfade[i]) {
            case FD_QUAD: al = (1 - t) * (1 - t); break;
            case FD_HOLD: al = t < 0.55 ? 1 : (1 - t) / 0.45; break;
            case FD_INOUT: al = (t < 0.12 ? t / 0.12 : 1) * (1 - t); break;
            default: al = 1 - t;
          }
          const e = 1 - (1 - t) * (1 - t), s = ps0[i] + (s1 - ps0[i]) * e;
          const col = withA(f & F_LERP ? lerpC(pcol[i], pcol2[i], Math.min(1, t * 1.6)) : pcol[i], pa0[i] * al);
          if (f & F_RING) {
            RO.width = pasp[i] > 1 ? pasp[i] * (1 - 0.4 * t) : 1.5 + 4 * (1 - t);
            r.circle(x, y, s * 0.5, col, RO);
            continue;
          }
          if (f & F_FIRE) { drawFire(r, i, x, y, s, t, pa0[i] * al); continue; }
          if (f & F_PUFF) { drawPuff(r, i, x, y, s, t, pa0[i] * al); continue; }
          PO.uv = UV[pstamp[i]];
          PO.rot = f & F_STRETCH ? Math.atan2(pvy[i], pvx[i]) : prot[i];
          PO.add = pass === 1;
          r.quad(x, y, s, s / pasp[i], col, PO);
        }
      }
    },
  };

  // a fire ball: the baked colour steps, tinted by heat (white -> warm -> red -> soot); opaque while it burns (it
  // shrinks as it cools and only fades in the last 15 %); the 1 px dark-red outline appears in the last 40 %
  function drawFire(r, i, x, y, s, t, al) {
    const k = (pstamp[i] - S_FIRE) & 1, rot = prot[i];
    al = pa0[i] * (t < 0.85 ? 1 : (1 - t) / 0.15);
    if (t > 0.55) s *= 1 - (t - 0.55) * 0.9;
    const heat = t < 0.22 ? COL.white : t < 0.5 ? lerpC(COL.white, COL.heatWarm, (t - 0.22) / 0.28) : t < 0.78 ? lerpC(COL.heatWarm, COL.heatRed, (t - 0.5) / 0.28) : lerpC(COL.heatRed, COL.heatSoot, (t - 0.78) / 0.22);
    PO.add = false; PO.rot = rot;
    if (t > 0.6) { PO.uv = UV[S_FIRE + k]; r.quad(x + 0.4, y + 0.5, s + 2, s + 2, withA(COL.fireLine, al * Math.min(1, (t - 0.6) / 0.08)), PO); }
    PO.uv = UV[S_FIREC + k];
    r.quad(x, y, s, s, withA(heat, al), PO);
  }
  // a smoke puff: 1 px dark edge, then a 3-step ramp (base, mid, lit cap on the upper left)
  function drawPuff(r, i, x, y, s, t, al) {
    const st0 = pstamp[i], rot = prot[i];
    PO.add = false; PO.uv = UV[st0]; PO.rot = rot;
    r.quad(x + 0.4, y + 0.6, s + 2, s + 2, withA(COL.smokeLine, al), PO);
    r.quad(x, y, s, s, withA(COL.smoke, al), PO);
    PO.uv = UV[S_BLOB + ((st0 - S_BLOB + 1) & 3)]; PO.rot = rot + 0.9;
    r.quad(x - s * 0.07, y - s * 0.08, s * 0.76, s * 0.72, withA(COL.smokeMid, al), PO);
    PO.uv = UV[S_BLOB + ((st0 - S_BLOB + 2) & 3)]; PO.rot = rot + 2.1;
    r.quad(x - s * 0.16, y - s * 0.17, s * 0.44, s * 0.4, withA(COL.smokeLit, al), PO);
  }
  function drawTracer(r, i, vx0, vx1, vy0, vy1) {
    const x0 = tx0[i], y0 = ty0[i], x1 = tx1[i], y1 = ty1[i];
    if (Math.max(x0, x1) < vx0 - 40 || Math.min(x0, x1) > vx1 + 40 || Math.max(y0, y1) < vy0 - 40 || Math.min(y0, y1) > vy1 + 40) return;
    const age = tage[i], life = tlife[i], t = age / life, k = tkind[i];
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
    if (len < 2) return;
    const a = Math.atan2(dy, dx), ux = dx / len, uy = dy / len;
    const uv = TO.uv;
    PO.tex = ART.atlas;
    switch (k) {
      case T_RIFLE: {
        // red dotted line at 1:1 (3.8 px dots every 10 px) over a soft additive glow; a pale bullet head runs ahead
        const fade = (1 - t) * (1 - t * 0.5), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        TO.rot = a; TO.add = true; TO.tex = ART.dotRG;
        uv[0] = -age * 30; uv[1] = 0; uv[2] = uv[0] + len / 10; uv[3] = 1;
        r.quad(mx, my, len, 14, withA(COL.rifleGlow, 0.7 * fade), TO);
        TO.add = false; TO.tex = ART.dotR;
        r.quad(mx, my, len, 6, withA(COL.rifle, fade), TO);
        const h = Math.min(1, age / 0.05);
        if (h < 1) {
          const seg = Math.min(30, len), c = seg / 2 + (len - seg) * h;
          TO.add = true;
          uv[0] = 0; uv[2] = seg / 10;
          r.quad(x0 + ux * c, y0 + uy * c, seg, 6, withA(COL.rifleHead, 1), TO);
        }
        break;
      }
      case T_SNIPER: {
        // a bullet streak, not a beam: a 60-90 px comet (2 px white head, tail fading into the blue glow) that
        // travels origin -> target in 0.1 s, then a brief pop where it lands
        const hd = Math.min(1, age / SNIPER_TRAVEL), s1 = hd * len, tl = Math.min(SNIPER_TAIL, s1);
        const fa = age <= SNIPER_TRAVEL ? 1 : Math.max(0, 1 - (age - SNIPER_TRAVEL) / (life - SNIPER_TRAVEL));
        const hx = x0 + ux * s1, hy = y0 + uy * s1;
        if (tl > 2 && age <= SNIPER_TRAVEL + 1 / 60) {
          PO.uv = UV[S_COMET]; PO.rot = a; PO.add = true;
          r.quad(hx - ux * tl * 0.5, hy - uy * tl * 0.5, tl, 8, withA(COL.sniperGlow, 0.75), PO);
          r.quad(hx - ux * tl * 0.3, hy - uy * tl * 0.3, tl * 0.6, 3, withA(COL.sniper, 1), PO);
          PO.uv = UV[S_GLOW]; PO.rot = 0;
          r.quad(hx, hy, 16, 16, withA(COL.sniperGlow, 0.55), PO);
          PO.uv = UV[S_DISC];
          r.quad(hx, hy, 3, 3, withA(COL.white, 1), PO);
        } else if (hd >= 1) {
          PO.uv = UV[S_GLOW]; PO.rot = 0; PO.add = true;
          r.quad(x1, y1, 22, 22, withA(COL.sniperGlow, 0.6 * fa), PO);
          r.quad(x1, y1, 8, 8, withA(COL.white, fa), PO);
        }
        break;
      }
      case T_FUSION: {
        // 2 hot orange blobs travelling the line, each with a short fading wake
        PO.rot = 0;
        for (let b = 0; b < 2; b++) {
          const u = (age - b * 0.07) / 0.15;
          if (u < 0) continue;
          const uu = Math.min(1, u), bx = x0 + dx * uu, by = y0 + dy * uu, fa = u <= 1 ? 1 : Math.max(0, 1 - (age - b * 0.07 - 0.15) / 0.08);
          if (fa <= 0) continue;
          const s = b ? 46 : 56;
          PO.add = true; PO.uv = UV[S_GLOW];
          for (let w = 1; w <= 3; w++) {
            const wu = Math.max(0, uu - w * 0.06);
            r.quad(x0 + dx * wu, y0 + dy * wu, s * (0.8 - w * 0.15), s * (0.8 - w * 0.15), withA(COL.fusion, 0.4 * fa * (1 - w * 0.25)), PO);
          }
          r.quad(bx, by, s, s, withA(COL.fusion, 0.9 * fa), PO);
          PO.uv = UV[S_FIREC + b]; PO.add = false;
          r.quad(bx, by, s * 0.5, s * 0.5, withA(COL.white, fa), PO);
          PO.uv = UV[S_DISC]; PO.add = true;
          r.quad(bx, by, s * 0.24, s * 0.24, withA(COL.fusionCore, fa), PO);
        }
        break;
      }
      case T_MEDIC: {
        PO.uv = UV[S_CROSS]; PO.rot = 0; PO.add = false;
        for (let b = 0; b < 3; b++) {
          const u = (age - b * 0.07) / 0.3;
          if (u < 0 || u > 1.3) continue;
          const uu = Math.min(1, u), bx = x0 + dx * uu, by = y0 + dy * uu, fa = u > 1 ? (1.3 - u) / 0.3 : 1;
          r.quad(bx, by, 10, 10, withA(COL.medic, 0.95 * fa), PO);
        }
        break;
      }
      case T_TURRET: {
        // a short run of crisp yellow dots racing to the target, over an amber glow
        const seg = Math.min(72, len), h = Math.min(1, t / 0.75), c = seg / 2 + (len - seg) * h;
        const cx = x0 + ux * c, cy = y0 + uy * c, fa = 1 - t * 0.6;
        TO.rot = a; TO.add = true; TO.tex = ART.dotRG;
        uv[0] = 0; uv[1] = 0; uv[2] = seg / 10; uv[3] = 1;
        r.quad(cx, cy, seg, 14, withA(COL.turretGlow, 0.45 * fa), TO);
        TO.tex = ART.dotT; uv[2] = seg / 12;
        r.quad(cx, cy, seg, 6, withA(COL.turret, fa), TO);
        break;
      }
      case T_ROCKET: {
        // a 12 px orange head flying to the target with a 40 px grey smoke trail behind it
        const hx = x0 + dx * t, hy = y0 + dy * t, tl = Math.min(40, len * t);
        PO.add = false;
        for (let s = 5; s >= 1; s--) {
          const d = (tl * s) / 5, w = 9 + 3.5 * s;
          PO.uv = UV[S_CLOUD + (s % 4)]; PO.rot = s * 1.7 + age * 3;
          r.quad(hx - ux * d, hy - uy * d, w * 1.4, w * 1.4, withA(COL.smokeTrail, 0.7 * (1 - (s - 1) / 5)), PO);
        }
        PO.uv = UV[S_GLOW]; PO.rot = 0; PO.add = true;
        r.quad(hx, hy, 34, 34, withA(COL.rocket, 0.5), PO);
        r.quad(hx, hy, 18, 18, withA(COL.rocket, 1), PO);
        r.quad(hx, hy, 7, 7, withA(COL.hotWhite, 1), PO);
        break;
      }
    }
  }
  IP.registerSystem('vfx', vfx);

  IP.vfx = {
    shake: (world, amp, x, y) => shake(world || IP.world, amp, x, y),
    explosion: (world, x, y, r, kind) => { if (V && V.world === world) explosion(x, y, r, kind); },
    splat: (world, x, y, size, dir, marine) => {
      if (!V || V.world !== world) return;
      addRecord(marine ? R_MARINE : R_ALIEN, x, y, size, dir || 0, (size >= 215 ? 3 : size >= 130 ? 2 : size >= 65 ? 1 : 0) << 2);
      covAdd(x, y, size * 0.22, 1.5);
    },
    burst: (world, x, y, hexColor, n) => { if (V && V.world === world) burst(x, y, hex(hexColor || 0xe050e8), n || 24, 1); },
    stats: () => {
      let huge = 0, large = 0, med = 0, small = 0, dark = 0;
      for (let k = Math.max(0, rhead - MAXREC); k < rhead; k++) {
        const i = k & (MAXREC - 1);
        if (rkind[i] === R_DARK) dark++;
        else if (rkind[i] === R_ALIEN) { const c = rlev[i] >> 2; if (c === 3) huge++; else if (c === 2) large++; else if (c === 1) med++; else small++; }
      }
      let cmax = 0, csum = 0;
      if (V && V.cov) for (let i = 0; i < V.cov.length; i++) { const c = Math.min(1, V.cov[i]); csum += c; if (c > cmax) cmax = c; }
      let live = 0;
      if (V) for (let k = 0; k < ccount; k++) { const i = (chead - 1 - k + MAXC) % MAXC; if (V.time - cborn[i] >= CORPSE_HOLD + CORPSE_FADE) break; live++; }
      return { particles: np, tracers: nt, corpses: live, corpseRing: ccount, decals: rhead, pending: rhead - rpainted, small, med, large, huge, dark,
        coverage: V && V.cov ? +(csum / V.cov.length).toFixed(4) : 0, chunks: V ? V.chunks.filter((c) => c.rt).length : 0, pendingExplosions: nex,
        hugeRolls: V ? V.hugeRolls : 0, hugeDemoted: V ? V.hugeDemoted : 0, bakeMs: +BAKE_MS.toFixed(1), bakeParts: BAKE_PARTS };
    },
    rocketTime,
    MAXP,
  };

  // ------------------------------------------------------------------ 'vfx-demo': scripted battle aftermath
  // Stub entities follow the DESIGN.md contract; only the vfx system (plus terrain if present) runs.
  function bez(p, u, o) {
    const iu = 1 - u;
    o.x = iu * iu * p.x0 + 2 * iu * u * p.cx + u * u * p.x1; o.y = iu * iu * p.y0 + 2 * iu * u * p.cy + u * u * p.y1;
    const tx = 2 * iu * (p.cx - p.x0) + 2 * u * (p.x1 - p.cx), ty = 2 * iu * (p.cy - p.y0) + 2 * u * (p.y1 - p.cy), l = Math.hypot(tx, ty) || 1;
    o.tx = tx / l; o.ty = ty / l;
    return o;
  }
  const TMP = { x: 0, y: 0, tx: 0, ty: 0 };
  function placeBug(b, p, t) {
    bez(p, b.p, TMP);
    const w = Math.sin(t * 3 + b.phase) * 5, off = b.lane * p.width + w;
    b.x = TMP.x - TMP.ty * off; b.y = TMP.y + TMP.tx * off;
    b.dir = Math.atan2(TMP.ty, TMP.tx) + Math.cos(t * 3 + b.phase) * 0.3;
  }
  const terrainOn = (world) => !!(IP.terrain && IP.terrain.generate && world.systems && world.systems.some((s) => s.name === 'terrain'));
  const DEMO_KINDS = ['drone', 'drone', 'drone', 'drone', 'runner', 'drone', 'spitter', 'drone'];
  async function demoScenario(world) {
    world.map = { w: 3840, h: 2160 };
    world.camera = { x: 1860, y: 1110, zoom: 1 };   // the squad sits mid-frame with streams closing from both sides
    const rng = IP.fork(world, 'vfx-demo');
    const D = (world.vfxDemo = { rng, nextId: 1, paths: [], sheets: {}, turret: { x: 2075, y: 905, cool: 0 }, hive: { x: 2330, y: 690 }, rockets: [] });
    D.paths = [
      { x0: 380, y0: 240, cx: 1050, cy: 520, x1: 1835, y1: 1065, width: 70 },
      { x0: 300, y0: 1880, cx: 1150, cy: 1500, x1: 1845, y1: 1215, width: 80 },
      { x0: 2760, y0: 640, cx: 2420, cy: 1060, x1: 2045, y1: 1065, width: 50 },   // a third stream from the east
    ];
    const names = ['rifle_a', 'sniper', 'fusion', 'rifle_b', 'medic'];
    const cls = ['rifle', 'sniper', 'fusion', 'rifle', 'medic'];
    const cools = [0.11, 0.85, 0.32, 0.12, 0.5];
    const ranges = [400, 700, 300, 400, 280];
    const sheets = await Promise.all(names.concat(KIND_SHEET).map((n) => IP.assets.load(n).catch(() => null)));
    names.concat(KIND_SHEET).forEach((n, i) => (D.sheets[n] = sheets[i]));
    const spots = [[1960, 1095], [2030, 1150], [1925, 1185], [2000, 1235], [2085, 1215]];
    for (let i = 0; i < 5; i++) {
      world.marines.push({ id: i + 1, name: cls[i].toUpperCase(), cls: cls[i], x: spots[i][0], y: spots[i][1], r: 16, dir: Math.PI, hp: 100, maxHp: 100, state: 'idle', order: null,
        weapon: { kind: cls[i], range: ranges[i], dps: 10, cooldown: cools[i], ammo: 999, maxAmmo: 999 }, sheet: names[i], anim: 'idle', frame: 0, selected: true, cool: rng() * 0.3, aim: Math.PI });
    }
    for (let i = 0; i < 330; i++) {
      const path = i % 3 === 2 && rng() < 0.6 ? 2 : i % 2, k = DEMO_KINDS[(rng() * DEMO_KINDS.length) | 0];
      const b = { id: D.nextId++, kind: k, x: 0, y: 0, vx: 0, vy: 0, r: 9, dir: 0, hp: k === 'spitter' ? 7 : 4, maxHp: 4, speed: 80 + rng() * 50, state: 'move', targetId: 0,
        sheet: KIND_SHEET[kindIndex(k)], variant: 0, anim: 'walk', frame: 0, hitT: 0, path, p: 0.08 + rng() * 0.66, lane: (rng() + rng() + rng() - 1.5) / 1.5, phase: (rng() * 40) | 0 };
      placeBug(b, D.paths[path], 0);
      world.aliens.push(b);
    }
    // a brute and a tank lumbering down the two main paths
    for (const [k, path, p, hp] of [['brute', 0, 0.5, 1e9], ['tank', 1, 0.5, 1e9]]) {
      const b = { id: D.nextId++, kind: k, x: 0, y: 0, vx: 0, vy: 0, r: k === 'tank' ? 30 : 20, dir: 0, hp, maxHp: hp, speed: 42, state: 'move', targetId: 0,
        sheet: KIND_SHEET[kindIndex(k)], variant: 0, anim: 'walk', frame: 0, hitT: 0, path, p, lane: 0, phase: 3, big: true };
      placeBug(b, D.paths[path], 0);
      world.aliens.push(b);
    }
    // the real ground (when terrain runs): basalt, with the battle lanes kept clear of rock
    if (terrainOn(world)) {
      const keep = [{ x: 1960, y: 1150, r: 230 }, { x: 2330, y: 690, r: 160 }, { x: 2075, y: 905, r: 90 }];
      for (const p of D.paths) for (let u = 0.25; u <= 1.001; u += 0.125) { bez(p, u, TMP); keep.push({ x: TMP.x, y: TMP.y, r: p.width + 70 }); }
      await IP.terrain.generate(world, { biome: 'basalt', w: 3840, h: 2160, seed: world.seed, keepClear: keep });
    }
  }
  function demoKill(world, b, dir, cause) {
    IP.emit(world, 'alien-died', { x: b.x, y: b.y, kind: b.kind, dir, cause });
    const D = world.vfxDemo, rng = D.rng;
    if (b.big) { b.state = 'dead'; const i = world.aliens.indexOf(b); if (i >= 0) world.aliens.splice(i, 1); return; }
    // the dead bug rejoins its stream further back, so the streams keep coming and the fight never runs dry
    b.p = 0.18 + rng() * 0.32; b.hp = b.kind === 'spitter' ? 7 : 4; b.lane = (rng() + rng() + rng() - 1.5) / 1.5;
    placeBug(b, D.paths[b.path], world.time);
  }
  function demoFire(world, m, target, weaponKind) {
    const D = world.vfxDemo, rng = D.rng;
    const a = Math.atan2(target.y - m.y, target.x - m.x);
    m.aim = a; m.dir = a;
    const mx = m.x + Math.cos(a) * 18, my = m.y - 12 + Math.sin(a) * 18;
    const tx = target.x + (rng() - 0.5) * 8, ty = target.y + (rng() - 0.5) * 8;
    IP.emit(world, 'shot', { x: mx, y: my, tx, ty, weapon: weaponKind, hit: true });
    if (weaponKind === 'medic') return;
    IP.emit(world, 'hit', { x: tx, y: ty, dmg: 1, targetKind: 'alien' });
    target.hp -= weaponKind === 'sniper' ? 99 : weaponKind === 'fusion' ? 3 : 1;
    if (target.hp <= 0) demoKill(world, target, a, weaponKind);
  }
  function nearestBug(world, x, y, range, bigFirst) {
    let best = null, bd = range * range;
    for (const b of world.aliens) {
      if (b.state === 'dead') continue;
      const dx = b.x - x, dy = b.y - y;
      let d = dx * dx + dy * dy;
      if (bigFirst && b.big) d *= 0.15;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function demoUpdate(world) {
    const D = world.vfxDemo, rng = D.rng, t = world.time, tick = world.tick;
    // aliens walk; the front of each stream walks into the guns
    for (const b of world.aliens) {
      if (b.state === 'dead') continue;
      const p = D.paths[b.path];
      const lenApprox = Math.hypot(p.x1 - p.x0, p.y1 - p.y0) * 1.1;
      b.p += (b.speed * STEP) / lenApprox;
      if (b.p > 0.97) b.p = 0.97;
      placeBug(b, p, t);
      b.frame = ((tick + b.phase) / 4) | 0;
    }
    // earlier waves: a thin stream of deaths along the paths plus clumps where a volley caught a knot of bugs
    if (t < 1.6) {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const path = rng() < 0.42 ? 0 : rng() < 0.65 ? 1 : 2, p = D.paths[path], u = 0.4 + Math.pow(rng(), 0.6) * 0.57;
        bez(p, u, TMP);
        const off = (rng() + rng() + rng() - 1.5) / 1.5 * p.width * 1.2;
        const x = TMP.x - TMP.ty * off, y = TMP.y + TMP.tx * off;
        const k = rng() < 0.08 ? 'spitter' : rng() < 0.2 ? 'runner' : 'drone';
        IP.emit(world, 'alien-died', { x, y, kind: k, dir: Math.atan2(-TMP.ty, -TMP.tx) + (rng() - 0.5) * 2.4, cause: 'rifle' });
      }
      if (tick % 10 === 4) {
        const path = rng() < 0.5 ? 0 : rng() < 0.6 ? 1 : 2, p = D.paths[path], u = 0.42 + rng() * 0.5;
        bez(p, u, TMP);
        const cx = TMP.x, cy = TMP.y, dir = Math.atan2(-TMP.ty, -TMP.tx);
        for (let i = 0, m = 4 + ((rng() * 3) | 0); i < m; i++) {
          IP.emit(world, 'alien-died', { x: cx + (rng() - 0.5) * 50, y: cy + (rng() - 0.5) * 50, kind: rng() < 0.15 ? 'runner' : 'drone', dir: dir + (rng() - 0.5) * 1.6, cause: 'fusion' });
        }
      }
    }
    const volley = t >= 2.95 && t < 3.15;
    // marines
    for (const m of world.marines) {
      if (m.state === 'dead') continue;
      m.cool -= STEP;
      const forced = volley && (tick & 1) === 0;
      if (m.cool > 0 && !forced) continue;
      m.cool = m.cls === 'fusion' && t >= 2 ? 0.32 : m.weapon.cooldown * (0.8 + rng() * 0.4);
      if (m.cls === 'medic' && rng() < 0.35) {
        const mates = world.marines.filter((o) => o !== m && o.state !== 'dead');
        const o = mates[(rng() * mates.length) | 0];
        if (o) demoFire(world, m, o, 'medic');
        continue;
      }
      // everyone shoots the stream fronts once they come in range (so the fronts push right up to the squad); the
      // fusion gunner reaches for the nearest front when nothing is in range, so a fusion blob is always in flight after t = 2
      let b = nearestBug(world, m.x, m.y, m.weapon.range, t > 2.2 && t < 2.6 || t > 4.5 && t < 4.95);
      if (!b && m.cls === 'fusion' && t >= 2) b = nearestBug(world, m.x, m.y, 1400, false);
      if (b) { demoFire(world, m, b, m.cls === 'medic' ? 'rifle' : m.cls); m.state = 'attack'; }
    }
    // turret: steady fire plus a fan burst during the volley
    const tu = D.turret;
    tu.cool -= STEP;
    if (tu.cool <= 0 || volley) {
      tu.cool = 0.09;
      const b = nearestBug(world, tu.x, tu.y, 450, false);
      if (b) demoFire(world, { x: tu.x, y: tu.y + 12, dir: 0, aim: 0 }, b, 'turret');
      if (volley) {
        for (let i = 0; i < 3; i++) {
          const a = Math.PI + 0.25 + (rng() - 0.5) * 1.3, d = 300 + rng() * 260;
          IP.emit(world, 'shot', { x: tu.x - 14, y: tu.y, tx: tu.x + Math.cos(a) * d, ty: tu.y + Math.sin(a) * d, weapon: rng() < 0.5 ? 'turret' : 'rifle', hit: false });
        }
      }
    }
    // scripted beats. Rockets: the shot is emitted at launch, the explosion (and its kills) when the head lands.
    const at = (s) => tick === Math.round(s * 60);
    const launch = (path, u, r) => {
      const p = D.paths[path];
      bez(p, u, TMP);
      const m = world.marines[0], x0 = m.x, y0 = m.y - 12;
      IP.emit(world, 'shot', { x: x0, y: y0, tx: TMP.x, ty: TMP.y, weapon: 'rocket', hit: true });
      D.rockets.push({ x: TMP.x, y: TMP.y, r, at: tick + Math.max(1, Math.round(rocketTime(Math.hypot(TMP.x - x0, TMP.y - y0)) * 60)) });
    };
    for (let i = 0; i < D.rockets.length; i++) {
      const k = D.rockets[i];
      if (k.at !== tick) continue;
      IP.emit(world, 'explosion', { x: k.x, y: k.y, r: k.r, kind: 'rocket' });
      for (const b of world.aliens.slice()) {
        if (b.state === 'dead' || b.big) continue;
        if (Math.hypot(b.x - k.x, b.y - k.y) < k.r * 1.1) demoKill(world, b, Math.atan2(b.y - k.y, b.x - k.x), 'rocket');
      }
    }
    if (at(1.85)) launch(0, 0.66, 110);
    if (at(4.15)) launch(1, 0.7, 135);
    // from t = 5, a rocket every 4 s into the front of alternating streams
    if (t >= 5 && (tick - 300) % 240 === 0) {
      const path = ((tick - 300) / 240) & 1 ? 1 : 0;
      let front = 0.5;
      for (const b of world.aliens) if (b.path === path && b.state !== 'dead' && !b.big && b.p > front) front = b.p;
      launch(path, Math.max(0.5, front - 0.06), 115);
    }
    const bigDie = (kind) => {
      const b = world.aliens.find((a) => a.kind === kind && a.state !== 'dead');
      if (b) { b.hp = 0; demoKill(world, b, Math.atan2(b.y - 1150, b.x - 2000), 'fusion'); }
    };
    if (at(2.6)) bigDie('brute');
    if (at(4.9)) bigDie('tank');
    if (t > 3.25 && t < 3.6 && tick % 7 === 0) {
      const m = world.marines[3];
      IP.emit(world, 'hit', { x: m.x + (rng() - 0.5) * 16, y: m.y - 10 + (rng() - 0.5) * 16, dmg: 8, targetKind: 'marine' });
    }
    if (at(3.6)) {
      const m = world.marines[3];
      m.state = 'dead'; m.hp = 0;
      IP.emit(world, 'marine-died', { x: m.x, y: m.y, name: m.name });
    }
    if (at(5.62)) IP.emit(world, 'hive-captured', { id: 99, x: D.hive.x, y: D.hive.y });
  }
  const DO_RING = { layer: 'shadow', width: 3 }, DO_FILL = { layer: 'shadow' }, DO_SPR = { layer: 'unit', scale: 0.82 }, DO_BUG = { layer: 'unit' };
  function demoDraw(world, r) {
    const D = world.vfxDemo;
    // stub hive (dark hex with a pink mouth) and turret, so the capture burst has a subject
    const h = D.hive;
    r.ngon(h.x, h.y, 58, 6, '#1a1420', { layer: 'shadow', rot: Math.PI / 6 });
    r.ngon(h.x, h.y, 58, 6, '#d64fd6', { layer: 'shadow', rot: Math.PI / 6, width: 3 });
    r.circle(h.x, h.y, 22, '#5a1a4a', { layer: 'shadow' });
    r.ngon(D.turret.x, D.turret.y, 22, 6, '#20262c', { layer: 'shadow', rot: Math.PI / 6 });
    r.ngon(D.turret.x, D.turret.y, 22, 6, '#f2e14c', { layer: 'shadow', rot: Math.PI / 6, width: 2 });
    r.circle(D.turret.x, D.turret.y, 7, '#f2e14c', { layer: 'unit' });
    // aliens (stub swarm) sorted by y
    const al = world.aliens;
    if (!D.order || D.order.length !== al.length) D.order = al.map((_, i) => i);
    D.order.sort((i, j) => al[i].y - al[j].y || i - j);
    for (let k = 0; k < D.order.length; k++) {
      const b = al[D.order[k]];
      const sh = D.sheets[b.sheet];
      if (sh) r.sprite(sh, sh.frame(sh.dir(b.dir), 'walk', b.frame), b.x, b.y, DO_BUG);
      else r.circle(b.x, b.y, b.r, '#2b4c51', { layer: 'unit' });
    }
    for (const m of world.marines) {
      if (m.state === 'dead') continue;
      r.circle(m.x, m.y, 25, 'rgba(255,90,110,0.9)', DO_RING);
      r.circle(m.x, m.y, 22, 'rgba(60,200,190,0.22)', DO_FILL);
      const sh = D.sheets[m.sheet];
      if (sh) r.sprite(sh, sh.frame(sh.dir(m.aim), m.state === 'attack' ? 'attack' : 'idle', 1), m.x, m.y + 8, DO_SPR);
    }
  }
  IP.scenario('vfx-demo', demoScenario, { systems: IP.system('terrain') ? ['terrain', 'vfx'] : ['vfx'], seed: 1 });

  // ------------------------------------------------------------------ 'vfx-corpse': one death, for checking the corpse fade
  IP.scenario('vfx-corpse', (world) => {
    world.map = { w: 3840, h: 2160 };
    world.camera = { x: 1920, y: 1080, zoom: 1 };
    world.vfxDemo = null;
    world.vfxBench = { rng: IP.fork(world, 'vfx-corpse'), corpse: true };
    if (terrainOn(world)) IP.terrain.generate(world, { biome: 'basalt', w: 3840, h: 2160, seed: world.seed, keepClear: [{ x: 1920, y: 1080, r: 300 }] });
  }, { systems: IP.system('terrain') ? ['terrain', 'vfx'] : ['vfx'], seed: 1 });

  // ------------------------------------------------------------------ 'vfx-bench': hold the pool at 4000 live particles
  function benchUpdate(world) {
    const B = world.vfxBench, rng = B.rng, t = world.tick;
    if (B.corpse) {
      if (t === 6) {
        IP.emit(world, 'alien-died', { x: 1880, y: 1080, kind: 'drone', dir: 0.3 });
        IP.emit(world, 'alien-died', { x: 1990, y: 1100, kind: 'runner', dir: 2.6 });
        IP.emit(world, 'alien-died', { x: 1930, y: 1010, kind: 'spitter', dir: -1.2 });
      }
      return;
    }
    const cx = 1920, cy = 1080;
    for (let i = 0; i < 24; i++) {
      const x = cx + (rng() - 0.5) * 1700, y = cy + (rng() - 0.5) * 900;
      IP.emit(world, 'shot', { x: cx, y: cy, tx: x, ty: y, weapon: ['rifle', 'sniper', 'fusion', 'medic', 'turret', 'rocket'][i % 6], hit: true });
      IP.emit(world, 'hit', { x, y, dmg: 1, targetKind: 'alien' });
    }
    if (t % 3 === 0) IP.emit(world, 'alien-died', { x: cx + (rng() - 0.5) * 1600, y: cy + (rng() - 0.5) * 800, kind: rng() < 0.9 ? 'drone' : 'brute', dir: rng() * TAU });
    if (t % 20 === 0) IP.emit(world, 'explosion', { x: cx + (rng() - 0.5) * 1400, y: cy + (rng() - 0.5) * 700, r: 90, kind: 'rocket' });
    // top up with smoke so the pool sits at its cap
    while (np < MAXP) spawn(S_CLOUD + ((rng() * 4) | 0), cx + (rng() - 0.5) * 1800, cy + (rng() - 0.5) * 1000, (rng() - 0.5) * 40, (rng() - 0.5) * 40, 1 + rng() * 2, 20, 50, rng() * TAU, 0, 0.99, COL.smoke, 0.3, 0, 1, FD_INOUT);
    V.shakeAmp = 0;
  }
  IP.scenario('vfx-bench', (world) => {
    world.map = { w: 3840, h: 2160 };
    world.camera = { x: 1920, y: 1080, zoom: 1 };
    world.vfxBench = { rng: IP.fork(world, 'vfx-bench') };
  }, { systems: ['vfx'], seed: 1 });
})();
