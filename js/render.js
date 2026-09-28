// Mecha Factory — pixel renderer.
// Orthographic ray-casting of convex primitives into a low-res buffer, then pixel-art shading:
// quantised light ramps, rim highlights, cast shadows, panel details and 1px outlines.
(function () {
  const MF = window.MF;
  const DIGITS = {
    '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '011', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'], '-': ['000', '000', '111', '000', '000'],
  };

  const LOOKS = {
    bright: { t3: 0.62, t2: 0.08, shadowMin: 1 },
    dusk: { t3: 0.72, t2: 0.28, shadowMin: 0, rim: { x: 0.62, y: 0.3, z: -0.72, min: -0.25, top: false }, rimTint: MF.color.packRGBA(170, 200, 255), rimMix: 0.35 },
  };

  class Renderer {
    constructor(w, h) { this.resize(w, h); }
    resize(w, h) {
      w = Math.max(8, w | 0); h = Math.max(8, h | 0);
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      const n = w * h;
      this.depth = new Float32Array(n);
      this.primIx = new Int32Array(n);
      this.planeIx = new Uint8Array(n);
      this.color = new Uint32Array(n);
      this.unitIx = new Int16Array(n);
      this.outlineMark = new Uint8Array(n);
      this.image = new ImageData(w, h);
      this.out32 = new Uint32Array(this.image.data.buffer);
    }

    // Generic orthographic raster of convex prims. Ray for cell (X,Y) starts at P + X*ts*ex + Y*ts*ey and runs along d.
    // Leaves per-prim frame data (p.v, p.frame) for the last basis rendered.
    _raster(prims, P, ex, ey, d, ts, W, H, depth, primIx, planeIx, unitIx, castersOnly) {
      for (let pi = 0; pi < prims.length; pi++) {
        const p = prims[pi];
        if (castersOnly && !p.shadow) continue;
        const m = p.world, inv = p.inv, v = p.v, fr = p.frame, pl = p.planes, np = p.np;
        inv[0] = m[0]; inv[1] = m[3]; inv[2] = m[6]; inv[3] = m[1]; inv[4] = m[4]; inv[5] = m[7]; inv[6] = m[2]; inv[7] = m[5]; inv[8] = m[8];
        const tx = m[9], ty = m[10], tz = m[11];
        const qx = P[0] - tx, qy = P[1] - ty, qz = P[2] - tz;
        v[0] = inv[0] * qx + inv[1] * qy + inv[2] * qz; v[1] = inv[3] * qx + inv[4] * qy + inv[5] * qz; v[2] = inv[6] * qx + inv[7] * qy + inv[8] * qz;
        const ax = ex[0] * ts, ay = ex[1] * ts, az = ex[2] * ts, bx = ey[0] * ts, by = ey[1] * ts, bz = ey[2] * ts;
        v[3] = inv[0] * ax + inv[1] * ay + inv[2] * az; v[4] = inv[3] * ax + inv[4] * ay + inv[5] * az; v[5] = inv[6] * ax + inv[7] * ay + inv[8] * az;
        v[6] = inv[0] * bx + inv[1] * by + inv[2] * bz; v[7] = inv[3] * bx + inv[4] * by + inv[5] * bz; v[8] = inv[6] * bx + inv[7] * by + inv[8] * bz;
        v[9] = inv[0] * d[0] + inv[1] * d[1] + inv[2] * d[2]; v[10] = inv[3] * d[0] + inv[4] * d[1] + inv[5] * d[2]; v[11] = inv[6] * d[0] + inv[7] * d[1] + inv[8] * d[2];
        for (let j = 0; j < np; j++) {
          const nx = pl[j * 4], ny = pl[j * 4 + 1], nz = pl[j * 4 + 2];
          fr[j * 4] = nx * v[9] + ny * v[10] + nz * v[11];
          fr[j * 4 + 1] = pl[j * 4 + 3] - (nx * v[0] + ny * v[1] + nz * v[2]);
          fr[j * 4 + 2] = nx * v[3] + ny * v[4] + nz * v[5];
          fr[j * 4 + 3] = nx * v[6] + ny * v[7] + nz * v[8];
        }
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        for (let k = 0; k < 8; k++) {
          const lx = k & 1 ? p.hx : -p.hx, ly = k & 2 ? p.hy : -p.hy, lz = k & 4 ? p.hz : -p.hz;
          const rx = m[0] * lx + m[1] * ly + m[2] * lz + tx - P[0];
          const ry = m[3] * lx + m[4] * ly + m[5] * lz + ty - P[1];
          const rz = m[6] * lx + m[7] * ly + m[8] * lz + tz - P[2];
          const sx = (rx * ex[0] + ry * ex[1] + rz * ex[2]) / ts, sy = (rx * ey[0] + ry * ey[1] + rz * ey[2]) / ts;
          if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
        }
        const x0 = Math.max(0, Math.floor(minX)), x1 = Math.min(W - 1, Math.ceil(maxX));
        const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(H - 1, Math.ceil(maxY));
        if (x0 > x1 || y0 > y1) continue;
        for (let Y = y0; Y <= y1; Y++) {
          const row = Y * W;
          for (let X = x0; X <= x1; X++) {
            let tE = -1e9, tX = 1e9, pe = -1, hit = true;
            for (let j = 0, o = 0; j < np; j++, o += 4) {
              const den = fr[o];
              const dist = fr[o + 1] - X * fr[o + 2] - Y * fr[o + 3];
              if (den < -1e-9) { const t = dist / den; if (t > tE) { tE = t; pe = j; } }
              else if (den > 1e-9) { const t = dist / den; if (t < tX) tX = t; }
              else if (dist < 0) { hit = false; break; }
              if (tE > tX) { hit = false; break; }
            }
            if (!hit || pe < 0) continue;
            const ix = row + X;
            if (tE < depth[ix]) { depth[ix] = tE; primIx[ix] = pi; if (planeIx) planeIx[ix] = pe; if (unitIx) unitIx[ix] = p._unit; }
          }
        }
      }
    }

    // Shadow map: raster all casters from the light's direction over the units' bounds.
    _shadowPass(prims, units, L) {
      const d = [-L[0], -L[1], -L[2]];
      let up = Math.abs(d[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0];
      // ex = normalize(up x d), ey = d x ex
      let ex = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
      const el = Math.hypot(ex[0], ex[1], ex[2]); ex = ex.map((c) => c / el);
      const ey = [d[1] * ex[2] - d[2] * ex[1], d[2] * ex[0] - d[0] * ex[2], d[0] * ex[1] - d[1] * ex[0]];
      let minA = 1e9, maxA = -1e9, minB = 1e9, maxB = -1e9;
      for (const u of units) {
        const cy = (u.height || 60) / 2, r = Math.max(u.radius || 30, cy) + 4;
        const a = u.x * ex[0] + cy * ex[1] + u.z * ex[2], b = u.x * ey[0] + cy * ey[1] + u.z * ey[2];
        minA = Math.min(minA, a - r); maxA = Math.max(maxA, a + r); minB = Math.min(minB, b - r); maxB = Math.max(maxB, b + r);
      }
      let ts = 1;
      while ((maxA - minA) / ts > 1400 || (maxB - minB) / ts > 1400) ts *= 2;
      const W = Math.ceil((maxA - minA) / ts) + 2, H = Math.ceil((maxB - minB) / ts) + 2;
      const sm = this.sm || (this.sm = {});
      if (!sm.depth || sm.depth.length < W * H) { sm.depth = new Float32Array(W * H); sm.prim = new Int32Array(W * H); }
      sm.depth.fill(1e9, 0, W * H); sm.prim.fill(-1, 0, W * H);
      const P = [minA * ex[0] + minB * ey[0], minA * ex[1] + minB * ey[1], minA * ex[2] + minB * ey[2]];
      Object.assign(sm, { W, H, P, ex, ey, d, ts });
      this._raster(prims, P, ex, ey, d, ts, W, H, sm.depth, sm.prim, null, null, true);
    }

    // Rim light: silhouette pixels on the side facing the back light (screen right/top), on surfaces turned toward it.
    _rimEdge(ix, X, Y, W, H, prims, planeIx, rim) {
      const primIx = this.primIx;
      const right = X === W - 1 || primIx[ix + 1] < 0;
      const up = Y === 0 || primIx[ix - W] < 0;
      if (!right && !(up && rim.top)) return false;
      const p = prims[primIx[ix]], m = p.world, pl = p.planes, pe = planeIx[ix];
      const nx = pl[pe * 4], ny = pl[pe * 4 + 1], nz = pl[pe * 4 + 2];
      const wx = m[0] * nx + m[1] * ny + m[2] * nz, wy = m[3] * nx + m[4] * ny + m[5] * nz, wz = m[6] * nx + m[7] * ny + m[8] * nz;
      return wx * rim.x + wy * rim.y + wz * rim.z > rim.min;
    }

    // Is world point q in shadow? self = prim index of the surface (convex prims never shadow themselves).
    _inShadow(qx, qy, qz, self, bias) {
      const sm = this.sm;
      const rx = qx - sm.P[0], ry = qy - sm.P[1], rz = qz - sm.P[2];
      const i = Math.round((rx * sm.ex[0] + ry * sm.ex[1] + rz * sm.ex[2]) / sm.ts);
      const j = Math.round((rx * sm.ey[0] + ry * sm.ey[1] + rz * sm.ey[2]) / sm.ts);
      if (i < 0 || j < 0 || i >= sm.W || j >= sm.H) return false;
      const k = j * sm.W + i;
      const pr = sm.prim[k];
      if (pr < 0 || pr === self) return false;
      return sm.depth[k] < rx * sm.d[0] + ry * sm.d[1] + rz * sm.d[2] - bias;
    }

    // scene: { units:[{prims, pal, x, z, radius, height, selected}], cam:{x,z,pitch,ox,oy},
    //          floor: 'tiles'|'grid'|'plain'|'none', bg: packed, floorRamp, light:[x,y,z], shadows:bool, time }
    render(scene) {
      const W = this.w, H = this.h, N = W * H;
      const depth = this.depth, primIx = this.primIx, planeIx = this.planeIx, color = this.color, unitIx = this.unitIx;
      depth.fill(1e9); primIx.fill(-1); unitIx.fill(-1);
      const cam = scene.cam;
      const pitch = cam.pitch, S = Math.sin(pitch), C = Math.cos(pitch);
      const ox = cam.ox, oy = cam.oy, cx = cam.x, cz = cam.z;
      const Lraw = scene.light || [-0.5, 0.78, 0.38];
      const Ll = Math.hypot(Lraw[0], Lraw[1], Lraw[2]);
      const Lx = Lraw[0] / Ll, Ly = Lraw[1] / Ll, Lz = Lraw[2] / Ll;
      const shadowOn = scene.shadows !== false;
      // lighting look: 'bright' (default) or 'dusk' (low key, deeper shadows, cool rim light from behind)
      const look = LOOKS[scene.look] || LOOKS.bright;
      const T3 = look.t3, T2 = look.t2, shadowMin = look.shadowMin;

      const prims = [];
      const units = scene.units;
      for (let u = 0; u < units.length; u++) for (const p of units[u].prims) { p._unit = u; prims.push(p); }

      if (shadowOn && units.length) this._shadowPass(prims, units, [Lx, Ly, Lz]);
      // main camera: pixel (X,Y) centre ray origin P00 + X*ex + Y*ey, direction d
      const P00 = [0.5 - ox + cx, (oy - 0.5) * C, cz - (oy - 0.5) * S];
      this._raster(prims, P00, [1, 0, 0], [0, -C, S], [0, -S, -C], 1, W, H, depth, primIx, planeIx, unitIx, false);

      // ---------------- floor & background
      const floorMode = scene.floor || 'tiles';
      const transparent = floorMode === 'none';
      const bg = scene.bg;
      const fl = scene.floorRamp;
      const tile = scene.tileSize || 32;
      const floorShade = this.floorShade && this.floorShade.length === N ? this.floorShade : (this.floorShade = new Uint8Array(N));
      floorShade.fill(0);
      for (let Y = 0; Y < H; Y++) {
        const u = oy - Y - 0.5;
        const wz = cz - u / S;
        const tzI = Math.floor(wz / tile);
        const tzUp = Math.floor((cz - (u + 1) / S) / tile);
        const seamZ = tzI !== tzUp;
        const inTileZ = ((wz % tile) + tile) % tile;
        for (let X = 0; X < W; X++) {
          const ix = Y * W + X;
          if (primIx[ix] >= 0) continue;
          const wx = X + 0.5 - ox + cx;
          if (shadowOn && this._inShadow(wx, 0, wz, -1, 0.6)) floorShade[ix] = 1;
          if (transparent) continue;
          let c = bg;
          if (floorMode === 'tiles') {
            const txI = Math.floor(wx / tile);
            const inX = ((wx % tile) + tile) % tile;
            const checker = (txI + tzI) & 1;
            c = fl[checker ? 2 : 1];
            if (seamZ || inX < 1) c = fl[0];
            else if (inTileZ < 2 && inX < tile - 1) c = fl[3];
            else if (inX >= 3 && inX < 4 && inTileZ >= 4 && inTileZ < 6) c = fl[0];
          } else if (floorMode === 'grid') {
            const inX = ((wx % tile) + tile) % tile;
            c = seamZ || inX < 1 ? fl[0] : bg;
          }
          color[ix] = floorShade[ix] ? darken(c, 0.74) : c;
        }
      }
      // selection rings
      if (!transparent) for (let u = 0; u < units.length; u++) {
        const un = units[u];
        if (!un.selected) continue;
        const rr = (un.radius || 30) * 0.72;
        const X0 = Math.max(0, Math.floor(un.x - rr - 2 - cx + ox)), X1 = Math.min(W - 1, Math.ceil(un.x + rr + 2 - cx + ox));
        const Y0 = Math.max(0, Math.floor(oy + (un.z - rr - 2 - cz) * S)), Y1 = Math.min(H - 1, Math.ceil(oy + (un.z + rr + 2 - cz) * S));
        for (let Y = Y0; Y <= Y1; Y++) {
          const wz = cz - (oy - Y - 0.5) / S;
          for (let X = X0; X <= X1; X++) {
            const ix = Y * W + X;
            if (primIx[ix] >= 0) continue;
            const dx = X + 0.5 - ox + cx - un.x, dz = wz - un.z;
            const r = Math.sqrt(dx * dx + dz * dz);
            if (Math.abs(r - rr) < 1.15) {
              const ang = Math.atan2(dz, dx) + (scene.time || 0) * 1.5;
              if (((ang / (Math.PI * 2)) * 16 + 16) % 2 < 1.25) { color[ix] = un.pal.pack.accent[3]; floorShade[ix] = 2; }
            }
          }
        }
      }

      // ---------------- shade geometry
      const EW = 0.95; // rim width in world px
      for (let Y = 0; Y < H; Y++) {
        for (let X = 0; X < W; X++) {
          const ix = Y * W + X;
          const pi = primIx[ix];
          if (pi < 0) continue;
          const p = prims[pi], pal = units[p._unit].pal, m = p.world, v = p.v, pl = p.planes;
          const pe = planeIx[ix], t = depth[ix];
          // local hit
          const lx = v[0] + X * v[3] + Y * v[6] + t * v[9];
          const ly = v[1] + X * v[4] + Y * v[7] + t * v[10];
          const lz = v[2] + X * v[5] + Y * v[8] + t * v[11];
          const nlx = pl[pe * 4], nly = pl[pe * 4 + 1], nlz = pl[pe * 4 + 2];
          const nwx = m[0] * nlx + m[1] * nly + m[2] * nlz, nwy = m[3] * nlx + m[4] * nly + m[5] * nlz, nwz = m[6] * nlx + m[7] * nly + m[8] * nlz;
          const lum = nwx * Lx + nwy * Ly + nwz * Lz;
          const matName = p.mat;
          const ramp = pal.pack[matName] || pal.pack.primary;
          if (matName === 'accent' || matName === 'lamp') {
            // emissive: flat bright, subtle pulse
            let e = lum > 0.2 ? 4 : 3;
            if (units[p._unit].blink && ((scene.time || 0) * 2 + p._unit) % 3 < 0.25) e = 2;
            color[ix] = (pal.pack.accent)[e];
            continue;
          }
          let idx = lum >= T3 ? 3 : lum >= T2 ? 2 : 1;
          if (matName === 'glass') idx = Math.min(4, idx + (((X + Y) & 3) === 0 && lum > 0 ? 1 : 0));
          // rim highlight: near an edge shared with a brighter visible face
          let best = EW, bj = -1;
          for (let j = 0; j < p.np; j++) {
            if (j === pe) continue;
            if (p.frame[j * 4] >= 0) continue; // only front-facing neighbours
            const s = pl[j * 4 + 3] - (pl[j * 4] * lx + pl[j * 4 + 1] * ly + pl[j * 4 + 2] * lz);
            if (s < best) { best = s; bj = j; }
          }
          if (bj >= 0) {
            const ax = pl[bj * 4], ay = pl[bj * 4 + 1], az = pl[bj * 4 + 2];
            const lj = (m[0] * ax + m[1] * ay + m[2] * az) * Lx + (m[3] * ax + m[4] * ay + m[5] * az) * Ly + (m[6] * ax + m[7] * ay + m[8] * az) * Lz;
            if (lj > lum + 0.12) idx = Math.min(4, idx + 1); else if (lj < lum - 0.5 && idx > 1 && lum > 0.5) idx--;
          }
          // cast shadow from other parts
          if (shadowOn && lum > -0.25) {
            const wx = m[0] * lx + m[1] * ly + m[2] * lz + m[9];
            const wy = m[3] * lx + m[4] * ly + m[5] * lz + m[10];
            const wz = m[6] * lx + m[7] * ly + m[8] * lz + m[11];
            if (this._inShadow(wx, wy, wz, pi, 1.3)) idx = Math.max(shadowMin, idx - 1);
          }
          // surface details
          let rampUse = ramp;
          if (p.detail) {
            const r = applyDetail(p, pe, lx, ly, lz, nlx, nly, nlz, idx, scene, pal);
            if (r !== null) {
              if (r >= 100) { rampUse = r >= 200 ? pal.pack.accent : pal.pack[p.detail.mat2 || 'secondary']; idx = r % 100; }
              else idx = r;
            }
          }
          color[ix] = rampUse[Math.max(0, Math.min(4, idx))];
        }
      }

      // ---------------- outlines
      const om = this.outlineMark; om.fill(0);
      const out = this.out32;
      const thr = scene.lineThreshold || 2.2;
      for (let Y = 0; Y < H; Y++) {
        for (let X = 0; X < W; X++) {
          const ix = Y * W + X;
          const pi = primIx[ix];
          if (pi < 0) {
            // silhouette: any neighbour with geometry?
            let nb = -1;
            if (X > 0 && primIx[ix - 1] >= 0) nb = ix - 1;
            else if (X < W - 1 && primIx[ix + 1] >= 0) nb = ix + 1;
            else if (Y > 0 && primIx[ix - W] >= 0) nb = ix - W;
            else if (Y < H - 1 && primIx[ix + W] >= 0) nb = ix + W;
            if (nb >= 0) { out[ix] = units[unitIx[nb]].pal.outline; om[ix] = 1; unitIx[ix] = unitIx[nb]; }
            else out[ix] = transparent ? (floorShade[ix] === 1 ? scene.shadowPacked || 0x55000000 : 0) : color[ix];
            continue;
          }
          const d = depth[ix];
          let line = false, far = false;
          if (X > 0 && primIx[ix - 1] >= 0 && primIx[ix - 1] !== pi && depth[ix - 1] < d - thr) { line = true; if (depth[ix - 1] < d - thr * 4) far = true; }
          if (!line && X < W - 1 && primIx[ix + 1] >= 0 && primIx[ix + 1] !== pi && depth[ix + 1] < d - thr) { line = true; if (depth[ix + 1] < d - thr * 4) far = true; }
          if (!line && Y > 0 && primIx[ix - W] >= 0 && primIx[ix - W] !== pi && depth[ix - W] < d - thr) { line = true; if (depth[ix - W] < d - thr * 4) far = true; }
          if (!line && Y < H - 1 && primIx[ix + W] >= 0 && primIx[ix + W] !== pi && depth[ix + W] < d - thr) { line = true; if (depth[ix + W] < d - thr * 4) far = true; }
          if (line) {
            const p = prims[pi];
            const pal = units[p._unit].pal;
            out[ix] = far || unitIx[ix] !== unitIx[ix - 1] ? pal.outline : mix(pal.outline, (pal.pack[p.mat] || pal.pack.primary)[0], 0.5);
          } else if (look.rim && this._rimEdge(ix, X, Y, W, H, prims, planeIx, look.rim)) {
            const p = prims[pi];
            const ramp = units[p._unit].pal.pack[p.mat] || units[p._unit].pal.pack.primary;
            out[ix] = mix(ramp[p.mat === 'accent' ? 4 : 3], look.rimTint, look.rimMix);
          } else out[ix] = color[ix];
        }
      }
      return this.image;
    }

  }

  // Procedural decals. Returns new ramp index, index+100 for mat2 ramp, index+200 for accent ramp, or null.
  function applyDetail(p, pe, lx, ly, lz, nx, ny, nz, idx, scene, pal) {
    const det = p.detail;
    const list = Array.isArray(det) ? det : [det];
    let res = null;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    let face, u, v, hu, hv;
    if (ax >= ay && ax >= az) { face = nx > 0 ? '+x' : '-x'; u = lz * Math.sign(nx); v = ly; hu = p.hz; hv = p.hy; }
    else if (ay >= az) { face = ny > 0 ? '+y' : '-y'; u = lx; v = lz; hu = p.hx; hv = p.hz; }
    else { face = nz > 0 ? '+z' : '-z'; u = -lx * Math.sign(nz); v = ly; hu = p.hx; hv = p.hy; }
    for (const d of list) {
      if (d.face && d.face !== 'any') {
        if (d.face === 'side') { if (face !== '+x' && face !== '-x') continue; }
        else if (d.face === 'front+side') { if (face !== '+z' && face !== '+x' && face !== '-x') continue; }
        else if (d.face === 'notTop') { if (face === '+y' || face === '-y') continue; }
        else if (d.face !== face) continue;
      }
      const cur = res === null ? idx : res % 100;
      switch (d.type) {
        case 'panel': { // a seam line across the face
          const pos = d.at || 0;
          if (Math.abs((d.dir === 'h' ? v : u) - pos) < 0.5) res = Math.max(0, cur - 2);
          break;
        }
        case 'vent': {
          const ins = d.inset == null ? 1.5 : d.inset;
          if (Math.abs(u) < hu - ins && Math.abs(v) < hv - ins) {
            const k = Math.floor((v + hv) / (d.pitch || 2));
            res = k % 2 === 0 ? 0 : Math.max(1, cur - 1);
          }
          break;
        }
        case 'grid': { // missile pod holes
          const cell = d.cell || 3.5;
          const ins = d.inset == null ? 1 : d.inset;
          if (Math.abs(u) < hu - ins && Math.abs(v) < hv - ins) {
            const fu = (((u + hu - ins) % cell) + cell) % cell, fv = (((v + hv - ins) % cell) + cell) % cell;
            if (fu < cell - 1 && fv < cell - 1) res = fu < 1 && fv < 1 ? 202 : 0;
          }
          break;
        }
        case 'stripe': { // hazard stripes
          const w = d.width || 3;
          if (d.band == null || Math.abs(v - (d.band || 0)) < (d.bandH || 2)) {
            if ((((u + v) % (w * 2)) + w * 2) % (w * 2) < w) res = 100 + cur;
          }
          break;
        }
        case 'band': { // solid colour band on mat2
          if (Math.abs((d.dir === 'v' ? u : v) - (d.at || 0)) < (d.size || 1.5)) res = 100 + cur;
          break;
        }
        case 'light': { // small emissive light(s)
          const pts = d.pts || [[0, 0]];
          for (const q of pts) if (Math.abs(u - q[0]) < (d.size || 0.9) && Math.abs(v - q[1]) < (d.size || 0.9)) res = 200 + (d.dim ? 3 : 4);
          break;
        }
        case 'eye': { // horizontal slit visor
          if (Math.abs(v - (d.at || 0)) < (d.h || 0.9) && Math.abs(u) < (d.w || hu - 1)) res = 200 + 4;
          break;
        }
        case 'slit': { // helm openings: rects [[u, v, halfW, halfH], ...] cut dark (or glowing thin lenses)
          for (const q of d.rects || []) if (Math.abs(u - q[0]) < q[2] && Math.abs(v - q[1]) < q[3]) res = d.glow ? 200 + (d.dim ? 3 : 4) : (d.dark != null ? d.dark : 0);
          break;
        }
        case 'face': { // tiny face: eye blocks (dark or glowing), optional angry brows (mat2), mouth, beard below `band` (mat2)
          const pts = d.pts || [[-2, 0], [2, 0]];
          const ew = d.size || 0.6, eh = d.h || ew;
          // fill: whole face in shadow (hooded); shade: darken everything above v (brow / helm shadow)
          if (d.fill != null) res = d.fill;
          else if (d.shade != null && v > d.shade) res = Math.max(0, cur - 2);
          if (d.band != null && v < d.band) res = 100 + cur;
          for (const q of pts) {
            const du = Math.abs(u - q[0]), dv = v - q[1];
            if (du < ew && Math.abs(dv) < eh) res = d.glint != null ? d.glint : d.glow ? 204 : (d.dark != null ? d.dark : 0);
            else if (d.brow) {
              const by = q[1] + eh + 0.7 + (d.angry ? (Math.abs(u) - Math.abs(q[0])) * 0.45 : 0);
              if (du < ew + 0.7 + (d.browW || 0) && Math.abs(v - by) < (d.browT || 0.55)) res = 100 + Math.max(0, Math.min(1, cur - 2));
            }
          }
          if (d.v != null && Math.abs(v - d.v) < 0.5 && Math.abs(u) < (d.mw || 1.2)) res = d.band != null && d.v < d.band ? 100 : 0;
          break;
        }
        case 'tread': {
          const off = scene.treadOffset ? scene.treadOffset[p._unit] || 0 : 0;
          const k = d.axis === 'v' ? v : u;
          if ((((k + off * (d.dirSign || 1)) % 3) + 3) % 3 < 1.1) res = Math.max(0, cur - 2);
          break;
        }
        case 'bolts': {
          const ins = d.inset || 1.6;
          if (Math.abs(Math.abs(u) - (hu - ins)) < 0.55 && Math.abs(Math.abs(v) - (hv - ins)) < 0.55) res = Math.min(4, cur + 1) === cur ? cur - 1 : Math.min(4, cur + 1);
          break;
        }
        case 'number': {
          const text = String(d.text || '318');
          const sc = d.scale || 1;
          const tw = text.length * 4 - 1;
          const bu = Math.floor(-(u - (d.u || 0)) / sc + tw / 2), bv = Math.floor(((d.v || 0) - v) / sc + 2.5);
          if (bv >= 0 && bv < 5 && bu >= 0 && bu < tw) {
            const ci = Math.floor(bu / 4), col = bu % 4;
            const g = DIGITS[text[ci]];
            if (col < 3 && g && g[bv][col] === '1') res = d.dark ? 1 : 100 + Math.min(4, cur + 1);
          }
          break;
        }
      }
    }
    return res;
  }

  function mix(a, b, t) {
    const r = (a & 255) * (1 - t) + (b & 255) * t, g = ((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t, bl = ((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t;
    return MF.color.packRGBA(r, g, bl);
  }
  function darken(c, k, tint) {
    let r = (c & 255) * k, g = ((c >> 8) & 255) * k, b = ((c >> 16) & 255) * k;
    // shadows lean cool
    b = Math.min(255, b + 10); r = Math.max(0, r - 4);
    return MF.color.packRGBA(r, g, b);
  }
  MF.Renderer = Renderer;
})();
