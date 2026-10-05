#!/usr/bin/env node
// Bake Mecha Factory blueprints into game sprite sheets (Infested Planet Gauntlet, piece "bake").
//
//   node tools/bake.js [--roster=Game/assets/roster.json] [--only=<id>[,<id>]] [--pitch=<rad>] [--cell=<n>]
//                      [--look=dusk|bright] [--out=Game/assets/sprites]
//
// Loads the factory (index.html) from file:// in headless Chromium, builds every roster unit from its stored
// blueprint exactly like the app does (sanitize -> MF.Gen.build -> MF.buildPalette), sets the camera pitch / light /
// look, then calls MFApp.buildSheet(unit, {idle, frames, attack, cell, scale:1, shadow:false}) and writes
//   <out>/<id>.png   8 rows (S,SE,E,NE,N,NW,W,SW) x [idle, walk0..7, attack0..3], fixed cells, feet on one anchor
//   <out>/<id>.json  the factory's export meta + id, role, weapon, pitch, look, lightAng, roster version
// It fails (exit 1) if any unit is clipped by its cell.
//
// Candidate explorer (for picking blueprints with the line's own random rules):
//   node tools/bake.js --explore --line=human --fixed='{"role":"soldier","style":"blend","era":"scifi"}' \
//        --n=24 --seed0=100 --out=path/contact.png [--team] [--pitch=1.0]
// renders idle S/SE/E/N + walk S frames of n random blueprints (locked slots kept) at 2x and labels each with
// its seed; with --team the roster's team colours are applied. --dump=path.json writes the blueprints too.
//
// Review captures:  node tools/bake.js --mocks=<round> [--ring=27.5] [--ringw=6] [--prefix=Game/progress/shots/bake-r<round>]
//
// Note: the factory's renderFrame does not pass a lighting look, so --look is applied by wrapping
// MF.Renderer.prototype.render inside the headless page (the factory source is untouched).
// Round 4 roster fields (all optional): team.colors / team.paints (squad-wide), cap (head only), marks (extra plates,
// e.g. the medic's crosses), pose {hold, attack[]} (weapon held up along the facing), blueprint.stride:'topdown'
// (opt-in top-down walk in js/humans.js). Per unit the bake prints S-idle value/saturation stats, capFrac, idle
// aspect and barrel error per facing, and the visible walk-foot travel for S/N (--debugkeys writes the leg probe).
// Known limitation: the factory has no death animation yet, so sheets have idle / walk / attack only.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/s);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const rel = (p) => path.relative(ROOT, p);
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

// Top-down stride (round 4 idea, moved here in round 5): only blueprints with stride:'topdown' take these branches, so
// every other unit animates exactly as in the factory. Seen from a near top-down camera the knee lift is invisible
// and the feet stay hidden under the shoulders, so while walking: a longer hip swing (feet travel further fore/aft
// along the facing), less knee lift, and a wider A-frame so the feet clear the hips. Spliced into stylizedBody() of
// js/humans.js as served to the bake page; fails loudly if the anchors move.
function strideHumans() {
  let src = fs.readFileSync(path.join(ROOT, 'js', 'humans.js'), 'utf8');
  if (src.includes("H.bp.stride === 'topdown'")) return src; // already carries the branches (e.g. adopted upstream)
  const A1 = '    const sp = P.splay || 0;\n';
  const A2 = '      let dk = Math.max(0, Math.cos(p)) * P.lift * m;\n';
  const n1 = src.split(A1).length - 1, n2 = src.split(A2).length - 1;
  if (n1 !== 1 || n2 !== 1) throw new Error(`stride patch: anchors not unique in js/humans.js (${n1}, ${n2}); update strideHumans() in tools/bake.js`);
  src = src.replace(A1, "    let sp = P.splay || 0;\n    const td = H.bp.stride === 'topdown' ? m1 : 0;\n" +
    "    if (td) { sp += 0.12 * td; for (const s of [-1, 1]) if (n['splay' + s]) n['splay' + s].rot[2] = s * sp; }\n");
  src = src.replace(A2, A2 + '      if (td) { dh *= 1 + 0.45 * td; dk *= 1 - 0.65 * td; }\n');
  return src;
}

async function openFactory() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // the factory links Google Fonts; nothing off-disk is needed to bake, so block every network request
  await page.route(/^https?:/, (r) => r.abort());
  // round 5: the opt-in top-down stride lives here, not in js/humans.js (bake does not own that file). The headless
  // page gets js/humans.js with the stride branches spliced in at load time; the file on disk is untouched.
  await page.route(/\/js\/humans\.js$/, (r) => r.fulfill({ body: strideHumans(), contentType: 'text/javascript' }));
  await page.goto(pathToFileURL(path.join(ROOT, 'index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MFApp && window.MF && window.MF.Gen && window.MF.Gen.LINES.human, null, { timeout: 20000 });
  if (errors.length) throw new Error('factory page errors:\n' + errors.join('\n'));
  await page.evaluate(() => {
    const MF = window.MF, G = MF.Gen, A = window.MFApp;
    // lighting look injection (buildSheet's renderFrame never sets scene.look)
    const proto = MF.Renderer.prototype;
    if (!proto.__bakeWrapped) {
      const orig = proto.render;
      proto.render = function (scene) {
        if (window.__bakeLook && !scene.look) scene = Object.assign({}, scene, { look: window.__bakeLook });
        return orig.call(this, scene);
      };
      proto.__bakeWrapped = true;
    }
    // supersampling: buildSheet allocates new MF.Renderer(240, 240); scale that buffer while __bakeRS > 1
    if (!MF.Renderer.__bakeScaled) {
      const Orig = MF.Renderer;
      const Scaled = class extends Orig { constructor(w, h) { const k = window.__bakeRS || 1; super(w * k, h * k); } };
      Scaled.__bakeScaled = true;
      MF.Renderer = Scaled;
    }
    // baked VFX off by default: muzzle flashes / beams / flame cones are drawn by the game's vfx piece, so the sheet's
    // attack frames carry only the pose and recoil. Every line builds its flare through MF.Gen.parts.muzzleFlash.
    if (!G.parts.__bakeWrapped) {
      const origFlash = G.parts.muzzleFlash;
      G.parts.muzzleFlash = function (n, kind) { if (window.__bakeVfx) return origFlash.call(this, n, kind); };
      G.parts.__bakeWrapped = true;
    }
    // same as app.js sanitize(): fill colour slots from the named palette, then the blueprint's own colours win
    const sanitize = (bp) => {
      const b = JSON.parse(JSON.stringify(bp));
      b.colors = Object.assign({ tertiary: '#b8323c', skin: '#d99a6c', hair: '#3b2a26', leather: '#6e4a33' },
        MF.PALETTES[b.palette] || MF.PALETTES['Rust Crab'], b.colors || {});
      if (!G.LINES[b.line || 'modular']) b.line = 'modular';
      return b;
    };
    // identity cap: repaint the top plates (helmet + pauldrons by default) with a vivid per-unit colour through two
    // extra palette materials ('cap', 'capTrim'), so each marine reads from across the screen like the bar's.
    //   cap = { color, trim?, nodes?: ['head','pad-1','pad1'], mats?: ['primary'], trimMats?: ['secondary'],
    //           parts?: { <node>: { color, trim } } }   (a per-node override gives e.g. the medic a white helm + red pads)
    // own 5-step ramp for caps: the factory ramp's highlight steps wash a vivid colour towards pastel (HSV sat < 0.5),
    // so here lights are only a small mix towards white and shadows lean slightly blue, keeping the plate vivid.
    const packRamp = (hex) => {
      const c = MF.color.hexToRgb(hex), P = MF.color.packRGBA;
      const sh = (k, blue) => P(c[0] * k, c[1] * k, Math.min(255, c[2] * k + blue));
      const li = (t) => P(c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t);
      return [sh(0.42, 18), sh(0.66, 12), P(c[0], c[1], c[2]), li(0.1), li(0.22)];
    };
    // round 4: the cap repaints ONLY the 'head' node by default (helmet), with darker still-saturated marks.
    // key = true paints every cap / mark material one flat magenta (#ff00ff) so the bake can count the cap's share
    // of the sprite (capFrac).
    const KEY = '#ff00ff';
    const keyRamp = () => { const P = MF.color.packRGBA; return [0, 0, 0, 0, 0].map(() => P(255, 0, 255)); };
    const applyCap = (u, cap, key, pre = 'cap') => {
      if (!cap || !cap.color) return;
      const nodes = cap.nodes || ['head'];
      const mats = cap.mats || ['primary'], trimMats = cap.trimMats || ['secondary'];
      let k = 0;
      const matFor = (spec) => {
        const id = pre + k++;
        u.pal.pack[id] = key ? keyRamp() : packRamp(spec.color);
        let tid = null;
        if (spec.trim) { tid = pre + 'Trim' + k; u.pal.pack[tid] = key ? keyRamp() : packRamp(spec.trim); }
        return { id, tid };
      };
      const base = matFor(cap), per = {};
      for (const n in cap.parts || {}) per[n] = matFor(Object.assign({}, cap, cap.parts[n]));
      const walk = (n, m) => {
        if (nodes.includes(n.name)) m = per[n.name] || base;
        if (m) for (const p of n.prims) {
          if (mats.includes(p.mat)) p.mat = m.id;
          else if (m.tid && trimMats.includes(p.mat)) p.mat = m.tid;
        }
        for (const c of n.children) walk(c, m);
      };
      walk(u.rig.root, null);
    };
    // marks: small extra plates added to a rig node in its own colour, e.g. the medic's red cross on the backpack.
    //   marks = [{ node: 'pack', prim?: 0|'top', face?: 'top'|'back', color: '#c81e2a', boxes: [[w, h, d, x, y, z], ...] }]
    // boxes are in design units (scaled by the blueprint size like every part), offset from the centre of the chosen
    // face of the node's prim (or from the node origin when no face is given).
    // round 5: face 'front' (+z), per-box rotation (boxes entries [w, h, d, x, y, z, rx, ry, rz]), flat: true (one
    // unshaded colour, i.e. a neon line that reads as emissive), and keyAs: 'edge' (counted as edgeFrac, not capFrac).
    const EKEY = [255, 255, 0];
    const applyMarks = (u, marks, key, pre = 'mark', keyEdge = false) => {
      (marks || []).forEach((mk, i) => {
        const node = u.rig.nodes[mk.node];
        if (!node) { if (mk.optional) return; throw new Error('mark node not found: ' + mk.node); }
        const id = pre + i, K = u.bp.size || 1, P = MF.color.packRGBA;
        const isEdge = mk.keyAs === 'edge';
        if (isEdge && keyEdge) u.pal.pack[id] = [0, 0, 0, 0, 0].map(() => P(...EKEY));
        else if (!isEdge && key) u.pal.pack[id] = keyRamp();
        else if (mk.flat) { const c = MF.color.hexToRgb(mk.color); u.pal.pack[id] = [0, 0, 0, 0, 0].map(() => P(c[0], c[1], c[2])); }
        else u.pal.pack[id] = packRamp(mk.color);
        let o = [0, 0, 0];
        // prim: an index, or 'top' = the node's prim whose top face is highest (e.g. a helmet's crown), or 'big' = the
        // largest prim (e.g. a chest block)
        const vol = (q) => (q.hx || 0) * (q.hy || 0) * (q.hz || 0);
        const pr = mk.prim === 'top' ? node.prims.reduce((a, q) => (!a || q.local[10] + q.hy > a.local[10] + a.hy ? q : a), null)
          : mk.prim === 'big' ? node.prims.reduce((a, q) => (!a || vol(q) > vol(a) ? q : a), null) : node.prims[mk.prim || 0];
        if (mk.face && pr) {
          const L = pr.local;
          o = [L[9] / K, L[10] / K, L[11] / K];
          if (mk.face === 'top') o[1] += pr.hy / K; else if (mk.face === 'back') o[2] -= pr.hz / K;
          else if (mk.face === 'front') o[2] += pr.hz / K;
          else if (mk.face === 'topfront') { o[1] += pr.hy / K; o[2] += pr.hz / K; }
        }
        MF.setBuildScale(K);
        try {
          for (const [w, h, d, x, y, z, rx = 0, ry = 0, rz = 0] of mk.boxes) {
            node.box(w, h, d, { at: [o[0] + x, o[1] + y, o[2] + z], rot: [rx, ry, rz], mat: id, shadow: false });
          }
        } finally { MF.setBuildScale(1); }
      });
    };
    // carve (round 5): cut the torso (and the plates riding on it) into a forward-pointing wedge seen from above, like
    // the bar's chevron marines. For each spec, two vertical planes through a nose at the front of the ref node's largest
    // prim, swept back by `angle` degrees from the facing, clip every prim of the listed nodes (the ref node itself or
    // its direct children, placed by their build offset). Planes are added to the prims' convex polytopes, so the
    // renderer shades the new faces like any chamfer. spec = { ref: 'chest', nodes: [...], angle: 30, nose: 0.2 }
    const applyCarve = (u, carve) => {
      for (const sp of carve || []) {
        const ref = u.rig.nodes[sp.ref];
        if (!ref || !ref.prims.length) continue;
        const vol = (q) => q.hx * q.hy * q.hz;
        const big = ref.prims.reduce((a, q) => (!a || vol(q) > vol(a) ? q : a), null);
        const th = ((sp.angle || 30) * Math.PI) / 180, sn = Math.sin(th), cs = Math.cos(th);
        const zF = big.local[11] + big.hz + (sp.dz || 0) * (u.bp.size || 1), xN = (sp.nose || 0) * big.hx, x0 = big.local[9];
        for (const name of sp.nodes || [sp.ref]) {
          const node = u.rig.nodes[name];
          if (!node) continue;
          if (node !== ref && !ref.children.includes(node)) throw new Error(`carve: ${name} is not ${sp.ref} or its child`);
          const off = node === ref ? [0, 0, 0] : node.base.pos;
          for (const q of node.prims) {
            const m = q.local, t = [m[9] + off[0], m[10] + off[1], m[11] + off[2]];
            const add = [];
            for (const s of [-1, 1]) {
              const n = [s * sn, 0, cs], d = sn * xN + s * sn * x0 + cs * zF; // plane through (x0 + s*xN, zF)
              const nl = [m[0] * n[0] + m[3] * n[1] + m[6] * n[2], m[1] * n[0] + m[4] * n[1] + m[7] * n[2], m[2] * n[0] + m[5] * n[1] + m[8] * n[2]];
              add.push(nl[0], nl[1], nl[2], d - (n[0] * t[0] + n[1] * t[1] + n[2] * t[2]));
            }
            const pl = new Float64Array(q.planes.length + add.length);
            pl.set(q.planes); pl.set(add, q.planes.length);
            q.planes = pl; q.np = pl.length / 4; q.frame = new Float64Array(q.np * 4);
          }
        }
        // leading-edge neon: a flat accent strip along each carved front edge, on the top face of the largest prim of
        // every node in sp.edge.nodes (1-2 px at 1x), inset so it never pokes out of the wedge.
        //   sp.edge = { nodes: [...], w: 1.4, h: 0.8, color: '#5ff0ff', inset: 0.2, trim: 0 }   (design units)
        if (sp.edge) {
          const E = sp.edge, K = u.bp.size || 1, P = MF.color.packRGBA;
          const ec = MF.color.hexToRgb(E.color || '#5ff0ff');
          u.pal.pack.edgeC = [0, 0, 0, 0, 0].map(() => (u.__keyEdge ? P(...EKEY) : P(ec[0], ec[1], ec[2])));
          for (const name of E.nodes || [sp.ref]) {
            const node = u.rig.nodes[name];
            if (!node || !node.prims.length) continue;
            const off = node === ref ? [0, 0, 0] : node.base.pos;
            const pb = node.prims.reduce((a, q) => (!a || vol(q) > vol(a) ? q : a), null);
            const t = [pb.local[9] + off[0], pb.local[10] + off[1], pb.local[11] + off[2]];
            const w = (E.w || 1.4) * K, h = (E.h || 0.8) * K, ins = (E.inset == null ? 0.2 : E.inset) * K;
            for (const s of [-1, 1]) {
              const d = sn * xN + s * sn * x0 + cs * zF;
              const zAt = (x) => (d - s * sn * x) / cs; // the carve line in ref space
              // x span: the prim's extent on this side, from the nose (or the prim's inner edge) outward
              let xa = t[0] - pb.hx, xb = t[0] + pb.hx;
              const xn = x0 + s * xN;
              if (s > 0) xa = Math.max(xa, xn); else xb = Math.min(xb, xn);
              // keep only where the line lies inside the prim's z range
              const zMin = t[2] - pb.hz, zMax = t[2] + pb.hz;
              const inZ = (x) => zAt(x) >= zMin - 1e-6 && zAt(x) <= zMax + 1e-6;
              const xs = []; for (let k2 = 0; k2 <= 40; k2++) { const x = xa + ((xb - xa) * k2) / 40; if (inZ(x)) xs.push(x); }
              if (xs.length < 2) continue;
              const x1 = xs[0], x2 = xs[xs.length - 1], trim = (E.trim || 0) * K;
              const len = Math.hypot(x2 - x1, zAt(x2) - zAt(x1)) - trim;
              if (len <= w) continue;
              const xm = (x1 + x2) / 2, zm = zAt(xm);
              const cx = xm - s * sn * (w / 2 + ins), cz = zm - cs * (w / 2 + ins); // inset along -normal
              const ry = Math.atan2(s * cs, -sn);
              node.prims.push(MF.makeBox(w, h, len, { at: [cx - off[0], t[1] + pb.hy + h * 0.15 - off[1], cz - off[2]], rot: [0, ry, 0], mat: 'edgeC', shadow: false }));
              node.prims[node.prims.length - 1].node = node;
            }
          }
        }
      }
    };
    // gun (round 5): the weapon read like the bar's rifles, long and dark with cyan ticks. Repaints the weapon hand's
    // grip subtree (every listed material) with one dark ramp and extends the barrel forward from the muzzle end.
    //   gun = { color: '#2a2c3a', mats: [...], extend: <design units past the muzzle>, r: <barrel half-thickness>,
    //           dashes: [[z0, len], ...] (cyan ticks along the extension, z from the old muzzle), dashColor }
    const applyGun = (u, gun, gripName, keyEdge) => {
      if (!gun || !gripName) return;
      const grip = u.rig.nodes[gripName];
      if (!grip) return;
      const P = MF.color.packRGBA, K = u.bp.size || 1;
      u.pal.pack.gunMat = packRamp(gun.color || '#2a2c3a');
      const mats = gun.mats || ['primary', 'secondary', 'metal', 'leather', 'tertiary'];
      const paint = (n) => { if (/^mz/.test(n.name)) return; for (const q of n.prims) if (mats.includes(q.mat)) q.mat = 'gunMat'; for (const c of n.children) paint(c); };
      // muzzle: the grip prim reaching furthest along +z (the barrel tip)
      let tip = null;
      for (const q of grip.prims) if (!tip || q.local[11] + q.hz > tip.local[11] + tip.hz) tip = q;
      paint(grip);
      // clip: [zMin, zMax] in design units along the grip's +z (the barrel axis): trims a stock or an over-long barrel
      if (gun.clip) {
        const [za, zb] = gun.clip.map((v) => v * K);
        const cut = (n) => {
          for (const q of n.prims) {
            const m = q.local, add = [];
            for (const [sg, lim] of [[1, zb], [-1, za]]) add.push(sg * m[6], sg * m[7], sg * m[8], sg * lim - sg * m[11]);
            const pl = new Float64Array(q.planes.length + 8);
            pl.set(q.planes); pl.set(add, q.planes.length);
            q.planes = pl; q.np = pl.length / 4; q.frame = new Float64Array(q.np * 4);
          }
        };
        cut(grip);
      }
      if (!tip || !(gun.extend > 0)) return;
      const z0 = (tip.local[11] + tip.hz) / K, y0 = tip.local[10] / K, r = gun.r || Math.min(tip.hx, tip.hy) / K;
      const dc = MF.color.hexToRgb(gun.dashColor || '#5ff0ff');
      u.pal.pack.gunDash = [0, 0, 0, 0, 0].map(() => (keyEdge ? P(...EKEY) : P(dc[0], dc[1], dc[2])));
      MF.setBuildScale(K);
      try {
        grip.box(2 * r, 2 * r, gun.extend + 0.6, { at: [0, y0, z0 + gun.extend / 2 - 0.3], mat: 'gunMat', shadow: false });
        for (const [dz, len] of gun.dashes || []) grip.box(r * 1.3, 0.7, len, { at: [0, y0 + r + 0.2, z0 + dz + len / 2], mat: 'gunDash', shadow: false });
      } finally { MF.setBuildScale(1); }
    };
    // pose: remap the factory's per-column animation state so the long gun is held up along the facing.
    //   pose = { hold: f, walk?: f, attack: [f0, f1, ...] }   f = the weapon's attack progress (1 = trigger, 0 = rest).
    // buildSheet asks for idle (fire 0, move 0), walk (fire 0, move 1) and attack i (fire 1 - i/n); the weapon's own
    // pose() turns a mid-cycle f into "aimed, no kick", so idle/walk get f = hold (aimed) and the attack columns a
    // kick sequence inside the aimed window. Nothing in the factory source changes; only the state passed to animate().
    const applyPose = (u, pose) => {
      if (!pose) return;
      const orig = u.rig.animate.bind(u.rig);
      u.rig.animate = (st) => {
        const s = Object.assign({}, st);
        if (!(st.fire > 0)) s.fire = st.move > 0 && pose.walk != null ? pose.walk : pose.hold;
        else if (pose.attack) {
          const n = pose.attack.length, i = Math.max(0, Math.min(n - 1, Math.round((1 - st.fire) * n)));
          s.fire = pose.attack[i];
        }
        const res = orig(s);
        // round 5: forward lean (radians) on top of the factory pose, so the torso tapers toward the gun from above
        if (pose.lean && u.rig.nodes.chest) u.rig.nodes.chest.rot[0] += pose.lean;
        // aim fix: a small torso yaw so the barrel lies along the facing on screen (found by fitAim below)
        if (u.__twist && u.rig.nodes.chest) u.rig.nodes.chest.rot[1] += u.__twist;
        return res;
      };
    };
    const makeUnit = (bp, cap, o = {}) => {
      const b = sanitize(bp);
      const u = { id: 0, bp: b, x: 0, z: 0, yaw: 0, phase: 0, move: 0, dist: 0, t: 0, fire: 0, fireN: 0, rig: G.build(b), pal: MF.buildPalette(b.colors) };
      // team paints (round 4): cap-like repaints shared by the whole squad, e.g. teal shoulder plates like the bar's;
      // applied first, never keyed (they are not identity), so the identity cap still wins on its own nodes
      (o.paints || []).forEach((pt, i) => applyCap(u, pt, false, 'paint' + i + '_'));
      applyCap(u, cap, o.key);
      applyMarks(u, o.marks, o.key);
      u.__keyEdge = !!o.keyEdge;
      applyCarve(u, o.carve); // round 5: wedge torso (before the edge lines, which sit on the carved front)
      applyMarks(u, o.edges, false, 'edge', o.keyEdge); // round 5: team leading-edge neon lines
      applyGun(u, o.gun, o.grip, o.keyEdge);
      if (o.hideGun && o.grip && u.rig.nodes[o.grip]) { // body-only probe: drop the weapon hand's grip subtree
        const strip = (n) => { n.prims.length = 0; for (const c of n.children) strip(c); };
        strip(u.rig.nodes[o.grip]);
      }
      applyPose(u, o.pose);
      if (o.keyLegs) { // leg visibility probe: the unit's left leg (hip1 subtree) flat magenta, right leg (hip-1) flat green
        const P = MF.color.packRGBA;
        u.pal.pack.keyL = [0, 0, 0, 0, 0].map(() => P(255, 0, 255));
        u.pal.pack.keyR = [0, 0, 0, 0, 0].map(() => P(0, 255, 0));
        const paint = (n, id) => { for (const q of n.prims) q.mat = id; for (const c of n.children) paint(c, id); };
        if (u.rig.nodes.hip1) paint(u.rig.nodes.hip1, 'keyL');
        if (u.rig.nodes['hip-1']) paint(u.rig.nodes['hip-1'], 'keyR');
      }
      return u;
    };
    // barrel axis per facing row: the weapon hand's grip node +z (the weapon's business end) in the idle pose,
    // projected to the screen with the bake pitch (screen y = sin(p)*z - cos(p)*y), vs the row's facing direction
    // (S = down, E = right, ...). Returns signed errors in degrees for rows S..SW.
    const barrelErr = (u, pitch, gripName) => {
      const S = Math.sin(pitch), C = Math.cos(pitch), out = [];
      for (let d = 0; d < 8; d++) {
        const yaw = (d * Math.PI * 2) / 8;
        u.rig.animate({ phase: 0, move: 0, t: 0, fire: 0, fireN: 1 });
        MF.updateRig(u.rig.root, MF.matFromEuler(MF.mat(), 0, u.rig.hover || 0, 0, 0, yaw, 0), []);
        const g = u.rig.nodes[gripName];
        if (!g) return null;
        const w = g.world, sx = w[2], sy = S * w[8] - C * w[5];
        const fx = Math.sin(yaw), fy = Math.cos(yaw);
        let e = (Math.atan2(sy, sx) - Math.atan2(fy, fx)) * 180 / Math.PI;
        e = ((e + 540) % 360) - 180;
        out.push(+e.toFixed(1));
      }
      return out;
    };
    const setView = (o) => {
      if (o.pitch != null) A.S.settings.pitch = +o.pitch;
      if (o.lightAng != null) A.S.settings.lightAng = +o.lightAng;
      window.__bakeLook = o.look || null;
    };
    // the app's own random rules with some slots locked (same as app.js starterBlueprints mkLine)
    const random = (seed, line, fixed, palette) => {
      const prev = Object.assign({ line }, palette ? { palette, colors: { ...MF.PALETTES[palette] } } : {}, fixed);
      const locks = { line: 1 };
      if (palette) locks.palette = 1;
      for (const k in fixed) locks[k] = 1;
      return G.randomBlueprint(seed, locks, prev, { line });
    };
    window.__bake = {
      sanitize, makeUnit, setView, random,
      // Pipeline (round 2): render at ss x size (bp.size*ss, renderer buffer *ss) as a tight 'auto' sheet ->
      // soften the hard outline (pixels equal to the palette outline become a mix with their body neighbours) ->
      // re-pack into square game cells (feet anchor at x = cell/2, global box centred vertically) while baking a
      // walk sway into the walk columns (rotate about the feet by sin(phase)*swayDeg, shift sin(phase)*swayPx
      // perpendicular to the facing) -> box-filter downsample ss:1 with premultiplied alpha, so edges are
      // antialiased instead of hard 1-px pixel art. Every frame keeps the same feet anchor.
      sheetCanvas(bp, o) {
        setView(o);
        const ss = Math.max(1, Math.round(o.ss || 1));
        const b = JSON.parse(JSON.stringify(bp));
        b.size = +(bp.size || 1) * ss;
        window.__bakeVfx = !!o.vfx;
        const u = makeUnit(b, o.cap, { marks: o.marks, pose: o.pose, key: o.key, keyLegs: o.keyLegs, paints: o.paints, edges: o.edges, gun: o.gun, grip: o.grip, keyEdge: o.keyEdge, carve: o.carve, hideGun: o.hideGun });
        // pose.aim 'auto': search the torso yaw (-0.6..0.6 rad, 0.01 steps) that minimises the worst barrel error over
        // the 8 facings (deterministic, recomputed identically for every keyed pass)
        if (o.pose && o.pose.aim === 'auto' && o.grip) {
          let best = null;
          for (let k = -60; k <= 60; k++) {
            u.__twist = k / 100;
            const e = barrelErr(u, +o.pitch, o.grip), m = Math.max(...e.map(Math.abs));
            if (!best || m < best[0] - 1e-9) best = [m, u.__twist];
          }
          u.__twist = best[1];
        }
        window.__bakeRS = ss;
        let t;
        try { t = A.buildSheet(u, { idle: true, frames: o.frames, attack: o.attack, cell: 'auto', scale: 1, shadow: false }); }
        finally { window.__bakeRS = 1; }
        const tm = t.meta, tw = tm.cellWidth, th = tm.cellHeight, cols = tm.columns.length;
        // ---- outline soften (on the hi-res tight sheet, before any resampling)
        const tight = t.canvas, tg = tight.getContext('2d');
        const soft = o.soften == null ? 0.6 : +o.soften; // weight of the outline colour in the mix (1 = untouched)
        if (soft < 1) {
          const img = tg.getImageData(0, 0, tight.width, tight.height), d = img.data, src = new Uint8ClampedArray(d), W = tight.width, H = tight.height;
          const oc = (b.colors.outline || '#0b0a12').replace('#', ''), oR = parseInt(oc.slice(0, 2), 16), oG = parseInt(oc.slice(2, 4), 16), oB = parseInt(oc.slice(4, 6), 16);
          const isO = (j) => src[j] === oR && src[j + 1] === oG && src[j + 2] === oB;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (!src[i + 3] || !isO(i)) continue;
            let r = 0, g = 0, bb = 0, n = 0;
            for (let rad = 1; rad <= 2 && !n; rad++) for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
              const X = x + dx, Y = y + dy;
              if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
              const j = (Y * W + X) * 4;
              if (!src[j + 3] || isO(j)) continue;
              r += src[j]; g += src[j + 1]; bb += src[j + 2]; n++;
            }
            if (!n) { r = 90; g = 84; bb = 110; n = 1; }
            d[i] = Math.round(oR * soft + (r / n) * (1 - soft));
            d[i + 1] = Math.round(oG * soft + (g / n) * (1 - soft));
            d[i + 2] = Math.round(oB * soft + (bb / n) * (1 - soft));
          }
          tg.putImageData(img, 0, 0);
        }
        // ---- re-pack into hi-res game cells with the walk sway
        const N = o.cell, NH = N * ss;
        const dx = NH / 2 - tm.anchor.x;
        let dy = Math.round((NH - th) / 2);
        dy -= (((dy + tm.anchor.y) % ss) + ss) % ss; // the feet anchor lands on a whole 1x pixel
        let clipped = dx < 0 || dy < 0 || dx + tw > NH || dy + th > NH;
        const hc = document.createElement('canvas');
        hc.width = NH * cols; hc.height = NH * 8;
        const g = hc.getContext('2d');
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        const swayDeg = o.swayDeg == null ? 0 : +o.swayDeg, swayPx = o.swayPx == null ? 0 : +o.swayPx;
        for (let r = 0; r < 8; r++) {
          const fa = (r * Math.PI) / 4, fx = Math.sin(fa), fy = Math.cos(fa); // screen facing (y down): S=(0,1), E=(1,0)
          for (let k = 0; k < cols; k++) {
            const name = tm.columns[k];
            let ang = 0, ox = 0, oy = 0;
            if (/^walk\d+$/.test(name) && (swayDeg || swayPx)) {
              const s = Math.sin((+name.slice(4) / o.frames) * Math.PI * 2);
              ang = (s * swayDeg * Math.PI) / 180;
              ox = fy * s * swayPx * ss; oy = -fx * s * swayPx * ss; // perpendicular to the facing
            }
            g.save(); g.beginPath(); g.rect(k * NH, r * NH, NH, NH); g.clip();
            g.translate(k * NH + dx + tm.anchor.x + ox, r * NH + dy + tm.anchor.y + oy);
            if (ang) g.rotate(ang);
            g.drawImage(tight, k * tw, r * th, tw, th, -tm.anchor.x, -tm.anchor.y, tw, th);
            g.restore();
          }
        }
        // ---- box downsample ss:1 (premultiplied alpha)
        let c = hc;
        if (ss > 1) {
          const hd = g.getImageData(0, 0, hc.width, hc.height).data, W = hc.width;
          c = document.createElement('canvas');
          c.width = N * cols; c.height = N * 8;
          const og = c.getContext('2d'), out = og.createImageData(c.width, c.height), od = out.data, k2 = ss * ss;
          for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
            let r = 0, gg = 0, bb = 0, a = 0;
            for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
              const q = ((y * ss + j) * W + x * ss + i) * 4, al = hd[q + 3];
              r += hd[q] * al; gg += hd[q + 1] * al; bb += hd[q + 2] * al; a += al;
            }
            const p = (y * c.width + x) * 4;
            if (a) { od[p] = Math.round(r / a); od[p + 1] = Math.round(gg / a); od[p + 2] = Math.round(bb / a); od[p + 3] = Math.round(a / k2); }
          }
          og.putImageData(out, 0, 0);
        }
        // ---- feather (round 5): the silhouette's outermost 1x pixels (alpha > 0 with a transparent 4-neighbour) keep
        // (1 - feather) of their alpha, so the edge is soft like the bar's painted units instead of a hard pixel step
        const feather = o.feather == null ? 0 : +o.feather;
        if (feather > 0) {
          const fg = c.getContext('2d'), fi = fg.getImageData(0, 0, c.width, c.height), fd = fi.data, fs = new Uint8ClampedArray(fd), FW = c.width, FH = c.height;
          for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
            const q = (y * FW + x) * 4;
            if (!fs[q + 3]) continue;
            const cx0 = x - (x % N), cy0 = y - (y % N); // stay inside the cell
            const open = (X, Y) => X < cx0 || Y < cy0 || X >= cx0 + N || Y >= cy0 + N || !fs[(Y * FW + X) * 4 + 3];
            if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) fd[q + 3] = Math.round(fs[q + 3] * (1 - feather));
          }
          fg.putImageData(fi, 0, 0);
        }
        // ---- metrics at 1x: body centre (mean idle box centre over 8 facings), idle box, edge clipping
        const gx = c.getContext('2d'), px = gx.getImageData(0, 0, c.width, c.height).data, AT = 48;
        let sx = 0, sy = 0, bw = 0, bh = 0;
        for (let r = 0; r < 8; r++) {
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[((r * N + y) * c.width + x) * 4 + 3] >= AT) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          sx += (x0 + x1 + 1) / 2; sy += (y0 + y1 + 1) / 2; bw = Math.max(bw, x1 - x0 + 1); bh = Math.max(bh, y1 - y0 + 1);
        }
        for (let r = 0; r < 8 && !clipped; r++) for (let k = 0; k < cols && !clipped; k++) for (let q = 0; q < N; q++) {
          const e = [[q, 0], [q, N - 1], [0, q], [N - 1, q]];
          for (const [x, y] of e) if (px[((r * N + y) * c.width + k * N + x) * 4 + 3]) { clipped = true; break; }
          if (clipped) break;
        }
        // S idle body box: opaque px within 20 px of the body centre (excludes a long gun barrel)
        const ccx = sx / 8, ccy = sy / 8;
        let b0 = 1e9, b1 = 1e9, b2 = -1, b3 = -1;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[(y * c.width + x) * 4 + 3] >= AT && Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy) <= 20) {
          if (x < b0) b0 = x; if (x > b2) b2 = x; if (y < b1) b1 = y; if (y > b3) b3 = y;
        }
        // attack-frame reach: farthest opaque px from the body centre over every attack frame (baked VFX would show here)
        let reach = 0;
        for (let r = 0; r < 8; r++) for (let k = 0; k < cols; k++) {
          if (!/^attack/.test(tm.columns[k])) continue;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[((r * N + y) * c.width + k * N + x) * 4 + 3] >= AT) reach = Math.max(reach, Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy));
        }
        const meta = Object.assign({}, tm, {
          cellWidth: N, cellHeight: N, scale: 1, anchor: { x: (dx + tm.anchor.x) / ss, y: (dy + tm.anchor.y) / ss }, clipped,
          anchorMode: 'feet; global box centred in the cell', ringAt: 'center',
          center: { x: +(sx / 8).toFixed(1), y: +(sy / 8).toFixed(1) }, idleBox: { w: bw, h: bh }, bodyBoxS: { w: b2 - b0 + 1, h: b3 - b1 + 1 }, attackReach: +reach.toFixed(1), tightBox: { w: Math.ceil(tw / ss), h: Math.ceil(th / ss) },
          render: { supersample: ss, soften: soft, feather, swayDeg, swayPx, filter: 'box, premultiplied alpha', vfx: !!o.vfx },
          cap: o.cap || null, marks: o.marks || null, paints: o.paints || null, pose: o.pose ? Object.assign({}, o.pose, u.__twist ? { twist: +u.__twist.toFixed(2) } : {}) : null, edges: o.edges || null, gun: o.gun || null, carve: o.carve || null,
          blueprint: bp,
        });
        // ---- round-4 value / colour stats on the S idle frame (row 0, col 0), opaque px = alpha > 200
        const hsv = (r, g, b2) => { const mx = Math.max(r, g, b2), mn = Math.min(r, g, b2); return [mx ? (mx - mn) / mx : 0, mx / 255]; };
        const sv = [], ss2 = [];
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const q = (y * c.width + x) * 4;
          if (px[q + 3] > 200) { const [s1, v1] = hsv(px[q], px[q + 1], px[q + 2]); ss2.push(s1); sv.push(v1); }
        }
        const med = (a) => { const b2 = a.slice().sort((p, q) => p - q); return b2.length ? b2[b2.length >> 1] : 0; };
        // per-facing idle box aspect (alpha >= 48), long side / short side
        const aspect = [];
        for (let r = 0; r < 8; r++) {
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[((r * N + y) * c.width + x) * 4 + 3] >= AT) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          const w = x1 - x0 + 1, h = y1 - y0 + 1;
          aspect.push({ w, h, r: +(Math.max(w, h) / Math.min(w, h)).toFixed(2) });
        }
        meta.stats = {
          sIdle: { opaquePx: sv.length, vMedian: +med(sv).toFixed(3), vAbove08: +(sv.filter((v) => v > 0.8).length / Math.max(1, sv.length)).toFixed(3), satMedian: +med(ss2).toFixed(3) },
          idleAspect: aspect,
          barrelErr: o.grip && o.barrel !== false ? barrelErr(u, +o.pitch, o.grip) : null,
        };
        { // round 5: S idle footprint, alpha > 200 (the critic's measure): bbox w x h and opaque px
          let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (px[(y * c.width + x) * 4 + 3] > 200) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
          meta.stats.sIdle.bboxW = x1 - x0 + 1; meta.stats.sIdle.bboxH = y1 - y0 + 1;
        }
        if (o.edgeStats && o.grip) { // body-only idle aspect per facing (weapon removed), alpha >= 48
          const k = this.sheetCanvas(bp, Object.assign({}, o, { hideGun: true, frames: 0, attack: 0, capStats: false, legStats: false, edgeStats: false, barrel: false }));
          const kp = k.canvas.getContext('2d').getImageData(0, 0, N, N * 8).data, ba = [];
          for (let r = 0; r < 8; r++) {
            let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
            for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (kp[((r * N + y) * N + x) * 4 + 3] >= AT) {
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
            const w = x1 - x0 + 1, h = y1 - y0 + 1;
            ba.push({ w, h, r: +(Math.max(w, h) / Math.min(w, h)).toFixed(2) });
          }
          meta.stats.bodyAspect = ba;
        }
        if (o.edgeStats && (o.edges || o.carve || (o.gun && o.gun.dashes))) { // edges + gun ticks keyed yellow (idle only)
          const k = this.sheetCanvas(bp, Object.assign({}, o, { keyEdge: true, frames: 0, attack: 0, capStats: false, legStats: false, edgeStats: false, barrel: false }));
          const kp = k.canvas.getContext('2d').getImageData(0, 0, N, N).data;
          let op = 0, ep = 0;
          for (let q = 0; q < kp.length; q += 4) if (kp[q + 3] > 200) { op++; if (kp[q] > 150 && kp[q + 1] > 150 && kp[q + 2] < 100) ep++; }
          meta.stats.edgeFrac = +(ep / Math.max(1, op)).toFixed(3);
        }
        if (o.capStats && (o.cap || o.marks)) { // second render with the cap / marks keyed magenta (idle only)
          const k = this.sheetCanvas(bp, Object.assign({}, o, { key: true, frames: 0, attack: 0, capStats: false, legStats: false, edgeStats: false, barrel: false }));
          const kp = k.canvas.getContext('2d').getImageData(0, 0, N, N).data;
          let op = 0, cp = 0;
          for (let q = 0; q < kp.length; q += 4) if (kp[q + 3] > 200) { op++; if (kp[q] > 150 && kp[q + 2] > 150 && kp[q + 1] < 100) cp++; }
          meta.stats.capFrac = +(cp / Math.max(1, op)).toFixed(3);
        }
        if (o.legStats && o.frames > 0 && b.line === 'human') {
          // stride probe: re-render idle + walk with the legs keyed (left magenta, right green), then per walk frame
          // of the S and N rows measure each leg's VISIBLE px (alpha > 200, after occlusion by body and gun) and its
          // centroid along the facing (S = +y, N = -y). stride = half the peak-to-peak of (left - right) offset.
          const k = this.sheetCanvas(bp, Object.assign({}, o, { keyLegs: true, attack: 0, capStats: false, legStats: false, edgeStats: false, barrel: false }));
          const kc = k.canvas, kd = kc.getContext('2d').getImageData(0, 0, kc.width, kc.height).data, kcols = k.meta.columns.length;
          const w0 = k.meta.animations.walk.from, nf = k.meta.animations.walk.count, res = {};
          for (const [row, nm] of [[0, 'S'], [4, 'N']]) {
            // per leg: visible px and its visible far end on the facing axis (the lowest keyed px on screen: the forward
            // foot for S, the trailing foot for N, which are the feet that clear the body from those views)
            const tip = { L: [], R: [] }, vis = { L: [], R: [] };
            for (let f = 0; f < nf; f++) {
              let nL = 0, nR = 0, tL = -1e9, tR = -1e9;
              for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
                const q = ((row * N + y) * kc.width + (w0 + f) * N + x) * 4;
                if (kd[q + 3] <= 200) continue;
                const r0 = kd[q], g0 = kd[q + 1], b0 = kd[q + 2];
                if (r0 > 150 && b0 > 150 && g0 < 100) { nL++; tL = Math.max(tL, y); } else if (g0 > 150 && r0 < 100 && b0 < 100) { nR++; tR = Math.max(tR, y); }
              }
              vis.L.push(nL); vis.R.push(nR); tip.L.push(nL ? tL : null); tip.R.push(nR ? tR : null);
            }
            const amp = (a) => { const v = a.filter((q) => q != null); return v.length > 1 ? +((Math.max(...v) - Math.min(...v)) / 2).toFixed(1) : 0; };
            res[nm] = { strideL: amp(tip.L), strideR: amp(tip.R), visFramesL: vis.L.filter(Boolean).length, visFramesR: vis.R.filter(Boolean).length, visL: vis.L, visR: vis.R };
          }
          meta.stats.legs = res;
          if (o.debugKeys) meta.debugLegKey = kc.toDataURL('image/png');
          void kcols;
        }
        return { canvas: c, meta, height: u.rig.height / ss };
      },
      sheet(bp, o) {
        const r = this.sheetCanvas(bp, o);
        return { png: r.canvas.toDataURL('image/png'), meta: r.meta, height: r.height };
      },
    };
  });
  return { browser, page };
}

function loadRoster(file) {
  const roster = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(roster.units) || !roster.units.length) throw new Error('roster has no units: ' + rel(file));
  return roster;
}

async function bake() {
  const rosterFile = abs(args.roster || 'Game/assets/roster.json');
  const roster = loadRoster(rosterFile);
  const outDir = abs(args.out || 'Game/assets/sprites');
  fs.mkdirSync(outDir, { recursive: true });
  const only = args.only ? String(args.only).split(',') : null;
  const units = roster.units.filter((u) => !only || only.includes(u.id));
  if (!units.length) throw new Error('no roster unit matches --only=' + args.only);
  const { browser, page } = await openFactory();
  const bad = [], gateBad = [];
  try {
    for (const u of units) {
      const o = {
        pitch: +(args.pitch ?? u.pitch ?? roster.pitch ?? 1.0),
        lightAng: +(u.lightAng ?? roster.lightAng ?? -0.9),
        look: args.look || u.look || roster.look || null,
        cell: args.cell ? +args.cell : u.cell || 64,
        frames: u.frames || roster.frames || 8,
        attack: u.attack ?? roster.attack ?? 4,
        ss: +(args.ss ?? u.supersample ?? roster.supersample ?? 1),
        soften: +(args.soften ?? u.soften ?? roster.soften ?? 1),
        feather: +(args.feather ?? u.feather ?? roster.feather ?? 0),
        swayDeg: +(args.swayDeg ?? u.swayDeg ?? roster.swayDeg ?? 0),
        swayPx: +(args.swayPx ?? u.swayPx ?? roster.swayPx ?? 0),
        vfx: !!(args.vfx ?? u.vfx ?? roster.vfx ?? false),
        cap: args.nocap ? null : u.cap || null,
        marks: args.nocap ? null : u.marks || null,
        paints: args.nocap || u.team === false || u.group !== 'squad' ? null : u.paints || (roster.team && roster.team.paints) || null,
        pose: args.nopose ? null : u.pose || null,
        edges: args.nocap || u.team === false || u.group !== 'squad' ? null : u.edges || (roster.team && roster.team.edges) || null,
        gun: u.team === false || u.group !== 'squad' ? null : u.gun === null ? null : Object.assign({}, roster.team && roster.team.gun, u.gun || {}),
        carve: u.team === false || u.group !== 'squad' ? null : u.carve || (roster.team && roster.team.carve) || null,
        edgeStats: true,
        grip: u.grip || (u.blueprint && u.blueprint.line === 'human' ? 'grip-1' : null),
        capStats: true, legStats: true, debugKeys: !!args.debugkeys,
      };
      if (o.look === 'bright') o.look = null;
      if (!(o.pitch > 0.05 && o.pitch < 1.571)) throw new Error(`bad pitch for ${u.id}: ${o.pitch} (radians, 0.05..1.57)`);
      if (![48, 64, 96, 128, 160, 192, 256].includes(o.cell)) throw new Error(`bad cell for ${u.id}: ${o.cell}`);
      if (!u.blueprint) throw new Error(`roster unit ${u.id} has no blueprint`);
      // round 4: squad units wear the roster's team colours (+ their own colorOverrides) so the whole squad is
      // re-darkened from one place; units with "team": false (the mech) keep their blueprint colours.
      const bp = JSON.parse(JSON.stringify(u.blueprint));
      if (u.team !== false && u.group === 'squad' && roster.team && roster.team.colors) {
        bp.colors = Object.assign({}, bp.colors, roster.team.colors, (u.provenance && u.provenance.colorOverrides) || {});
      }
      const res = await page.evaluate(([bp, o]) => window.__bake.sheet(bp, o), [bp, o]);
      const png = Buffer.from(res.png.split(',')[1], 'base64');
      if (res.meta.debugLegKey) { // --debugkeys: write the leg-keyed probe sheet next to the output (not a game asset)
        fs.writeFileSync(path.join(outDir, u.id + '.legkey.png'), Buffer.from(res.meta.debugLegKey.split(',')[1], 'base64'));
        delete res.meta.debugLegKey;
      }
      const meta = Object.assign({ id: u.id, label: u.label || u.id, role: u.role || null, weapon: u.weapon || null },
        res.meta, { pitch: o.pitch, lightAng: o.lightAng, look: o.look || 'bright', modelHeight: +res.height.toFixed(1), rosterVersion: roster.version || 1, bakedBy: 'tools/bake.js' });
      // round 5 gate (roster.gate, squad units only): S idle footprint, opaque px, edge share, value, reach, barrel
      // error and idle aspect spread per unit. A unit outside its gate is reported and not written (exit 1), unless
      // --nogate (exploration).
      const gate = u.group === 'squad' && u.team !== false ? Object.assign({}, roster.gate || {}, u.gate || {}) : {};
      const fails = [];
      const st0 = meta.stats || {}, si = st0.sIdle || {};
      const chk = (name, v, lo, hi) => { if (v == null || lo == null && hi == null) return; if ((lo != null && v < lo) || (hi != null && v > hi)) fails.push(`${name}=${v} (want ${lo ?? ''}..${hi ?? ''})`); };
      chk('sIdleW', si.bboxW, null, gate.sIdleWMax);
      chk('opaquePx', si.opaquePx, gate.opaqueMin, gate.opaqueMax);
      chk('edgeFrac', st0.edgeFrac, null, gate.edgeFracMax);
      chk('vMedian', si.vMedian, null, gate.vMedianMax);
      chk('vAbove0.8', si.vAbove08, null, gate.vAbove08Max);
      chk('reach', meta.attackReach, gate.reachMin, null);
      if (st0.barrelErr) chk('barrelErr', Math.max(...st0.barrelErr.map(Math.abs)), null, gate.barrelErrMax);
      if (st0.idleAspect) { const a = st0.idleAspect.map((q) => q.r); chk('aspectSpread', +(Math.max(...a) - Math.min(...a)).toFixed(2), null, gate.aspectSpreadMax); }
      if (st0.bodyAspect) { const a = st0.bodyAspect.map((q) => q.r); chk('bodyAspectSpread', +(Math.max(...a) - Math.min(...a)).toFixed(2), null, gate.bodyAspectSpreadMax); }
      meta.gate = { limits: gate, pass: !fails.length, fails };
      const writeIt = !meta.clipped && (!fails.length || args.nogate);
      if (writeIt) { // never overwrite a good sheet with a clipped (or gate-failing) one
        fs.writeFileSync(path.join(outDir, u.id + '.png'), png);
        fs.writeFileSync(path.join(outDir, u.id + '.json'), JSON.stringify(meta, null, 2) + '\n');
      }
      const cols = meta.columns.length;
      console.log(`${u.id.padEnd(10)} cell=${meta.cellWidth}x${meta.cellHeight} cols=${cols} sheet=${meta.cellWidth * cols}x${meta.cellHeight * 8} anchor=(${meta.anchor.x},${meta.anchor.y}) box=${meta.tightBox.w}x${meta.tightBox.h} idle=${meta.idleBox.w}x${meta.idleBox.h} bodyS=${meta.bodyBoxS.w}x${meta.bodyBoxS.h} reach=${meta.attackReach} pitch=${o.pitch} look=${meta.look} clipped=${meta.clipped}`);
      const st = meta.stats || {};
      if (st.sIdle) {
        const a = st.idleAspect.map((q) => q.r), be = st.barrelErr;
        console.log(`           S idle (alpha>200): bbox=${st.sIdle.bboxW}x${st.sIdle.bboxH} opaquePx=${st.sIdle.opaquePx} vMedian=${st.sIdle.vMedian} vAbove0.8=${st.sIdle.vAbove08} satMedian=${st.sIdle.satMedian} capFrac=${st.capFrac ?? 'n/a'} edgeFrac=${st.edgeFrac ?? 'n/a'} reach=${meta.attackReach}`);
        if (st.bodyAspect) { const b2 = st.bodyAspect.map((q) => q.r); console.log(`           body aspect (weapon removed) S..SW=[${b2.join(',')}] spread=${(Math.max(...b2) - Math.min(...b2)).toFixed(2)}`); }
        console.log(`           idle aspect S..SW=[${a.join(',')}] spread=${(Math.max(...a) - Math.min(...a)).toFixed(2)}${be ? `  barrelErr deg S..SW=[${be.join(',')}] max|e|=${Math.max(...be.map(Math.abs))}` : ''}`);
      }
      if (st.legs) {
        const f = (q) => `strideL=${q.strideL} strideR=${q.strideR} px, visible frames L/R ${q.visFramesL}/${q.visFramesR} of 8 (px L [${q.visL}] R [${q.visR}])`;
        console.log(`           walk legs (visible foot end on the facing axis, half peak-to-peak): S ${f(st.legs.S)}`);
        console.log(`                                                                     N ${f(st.legs.N)}`);
      }
      if (meta.gate && Object.keys(meta.gate.limits).length) console.log(`           gate ${meta.gate.pass ? 'PASS' : 'FAIL: ' + meta.gate.fails.join(', ')}${!meta.gate.pass && !args.nogate ? ' (not written)' : ''}`);
      if (meta.clipped) bad.push(u.id);
      if (!meta.gate.pass) gateBad.push(u.id);
    }
  } finally {
    await browser.close();
  }
  if (bad.length) console.error(`CLIPPED: ${bad.join(', ')} exceed their cell (not written). Use a larger cell (96 or 128) in the roster.`);
  if (gateBad.length) console.error(`GATE: ${gateBad.join(', ')} outside roster.gate${args.nogate ? ' (written anyway: --nogate)' : ' (not written)'}.`);
  if (bad.length || gateBad.length) process.exit(1);
}

// candidate contact sheet: n random blueprints from the line's own random rules
async function explore() {
  const line = args.line || 'human';
  const fixed = args.fixed ? JSON.parse(args.fixed) : {};
  const n = +(args.n || 24), seed0 = +(args.seed0 || 1);
  const out = abs(args.out || 'explore.png');
  let team = null, pitch = +(args.pitch || 1.0), look = args.look || null, lightAng = -0.9, post = { ss: 1, soften: 1, swayDeg: 0, swayPx: 0 };
  if (args.team) {
    const roster = loadRoster(abs(args.roster || 'Game/assets/roster.json'));
    team = roster.team || null;
    if (!args.pitch && roster.pitch) pitch = roster.pitch;
    if (!args.look && roster.look) look = roster.look;
    if (roster.lightAng != null) lightAng = roster.lightAng;
    post = { ss: roster.supersample || 1, soften: roster.soften ?? 1, feather: roster.feather || 0, swayDeg: roster.swayDeg || 0, swayPx: roster.swayPx || 0 };
    // round 5: candidates wear the squad's carve / gun / lean / aim fix, so the contact sheet shows what the bake ships
    if (team) Object.assign(post, { carve: team.carve || null, gun: team.gun || null, grip: 'grip-1', pose: { hold: 0.5, lean: 0.2, aim: 'auto' } });
  }
  for (const k of ['ss', 'soften', 'feather', 'swayDeg', 'swayPx']) if (args[k] != null) post[k] = +args[k];
  if (look === 'bright') look = null;
  const { browser, page } = await openFactory();
  try {
    const res = await page.evaluate(([line, fixed, n, seed0, team, pitch, look, lightAng, cell, ground, attack, post]) => {
      const B = window.__bake;
      const cs = cell, z = 2, per = 5; // idle S, SE, E, N + walk2 S
      const cols = 6, rows = Math.ceil(n / cols), tw = cs * per * z, th = cs * z + 30;
      const c = document.createElement('canvas');
      c.width = cols * tw + (cols - 1) * 6; c.height = rows * th;
      const g = c.getContext('2d');
      g.fillStyle = ground; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = false;
      const bps = [];
      for (let i = 0; i < n; i++) {
        const seed = seed0 + i;
        const bp = B.random(seed, line, fixed, team && team.palette);
        if (team && team.colors) bp.colors = Object.assign({}, bp.colors, team.colors);
        bps.push(bp);
        const r = B.sheetCanvas(bp, Object.assign({ pitch, look, lightAng, cell: cs, frames: 8, attack: +attack }, post));
        const meta = r.meta, png = r.canvas;
        const x0 = (i % cols) * (tw + 6), y0 = Math.floor(i / cols) * th;
        const pick = [[0, 0], [1, 0], [2, 0], [4, 0], [0, 3]]; // [row, col]
        pick.forEach(([r, col], k) => g.drawImage(png, col * cs, r * cs, cs, cs, x0 + k * cs * z, y0, cs * z, cs * z));
        g.fillStyle = meta.clipped ? '#ff5050' : '#e8e8d0';
        g.font = '12px monospace';
        const si = (meta.stats && meta.stats.sIdle) || {};
        g.fillText(`seed ${seed} S ${si.bboxW}w ${si.opaquePx}px`, x0 + 4, y0 + th - 18);
        g.fillText(`seed ${seed} ${meta.tightBox.w}x${meta.tightBox.h} ${bp.role || bp.sdType || ''} ${bp.head || ''} ${bp.shoulders || ''} ${bp.weaponR || ''}/${bp.weaponL || ''} ${bp.extra || ''}${meta.clipped ? ' CLIP' : ''}`, x0 + 4, y0 + th - 4);
      }
      return { png: c.toDataURL('image/png'), bps };
    }, [line, fixed, n, seed0, team, pitch, look, lightAng, +(args.cell || 64), args.ground || '#4a4a26', +(args.attack || 0), post]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
    if (args.dump) fs.writeFileSync(abs(args.dump), JSON.stringify(res.bps, null, 1));
    console.log('wrote', rel(out), `(${n} candidates, seeds ${seed0}..${seed0 + n - 1}, pitch ${pitch}, look ${look || 'bright'})`);
  } finally {
    await browser.close();
  }
}

// review captures (python3 + PIL): <prefix>-contact.png (8 idle dirs + walk S + walk E per unit, 2x nearest),
// <prefix>-attack.png (attack frames facing S/E/N/SE, 2x) and <prefix>-scale.png (1920x1080, the squad at 1:1 on
// mottled olive ground with IP-style selection rings, placed where ip_01's marines stand: x 1130-1360, y 500-720).
function mocks() {
  const { spawnSync } = require('child_process');
  const round = args.mocks === true ? '1' : String(args.mocks);
  const prefix = abs(args.prefix || 'Game/progress/shots/bake-r' + round);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const r = spawnSync('python3', ['-', ROOT, abs(args.roster || 'Game/assets/roster.json'), abs(args.out || 'Game/assets/sprites'), prefix, args.which || 'all'],
    { input: MOCKS_PY, encoding: 'utf8', env: Object.assign({}, process.env, { RING_R: String(args.ring || 27.5), RING_W: String(args.ringw || 6) }) });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

const MOCKS_PY = String.raw`#!/usr/bin/env python3
# bake mocks: contact sheet, attack strip and a 1:1 1920x1080 scale mock of the squad on olive ground.
# usage: mocks.py ROOT ROSTER_JSON SPRITE_DIR OUT_PREFIX
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root, roster_path, sprite_dir, prefix = sys.argv[1:5]
roster = json.load(open(roster_path))
DIRS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']
GROUND = (0x4a, 0x4a, 0x26)

def font(sz):
    try:
        return ImageFont.load_default(size=sz)
    except Exception:
        return ImageFont.load_default()

def load(uid):
    meta = json.load(open(os.path.join(sprite_dir, uid + '.json')))
    sheet = Image.open(os.path.join(sprite_dir, uid + '.png')).convert('RGBA')
    return meta, sheet

def frame(meta, sheet, row, col):
    n = meta['cellWidth']
    return sheet.crop((col * n, row * n, col * n + n, row * n + n))

def union_box(frames):
    box = None
    for f in frames:
        b = f.getbbox()
        if not b:
            continue
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    return box or (0, 0, 1, 1)

units = roster['units']
loaded = {u['id']: load(u['id']) for u in units if os.path.exists(os.path.join(sprite_dir, u['id'] + '.json'))}

# ---------------------------------------------------------------- contact sheet: 8 idle dirs + 8 walk S, 2x nearest
def strip(cells, z, pad=6):
    box = union_box(cells)
    w, h = (box[2] - box[0] + 2) * z, (box[3] - box[1] + 2) * z
    out = Image.new('RGBA', (len(cells) * (w + pad), h), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        c = c.crop((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1)).resize((w, h), Image.NEAREST)
        out.alpha_composite(c, (i * (w + pad), 0))
    return out, w, pad

def contact(z=2):
    rows = []
    for u in units:
        if u['id'] not in loaded:
            continue
        meta, sheet = loaded[u['id']]
        walk = meta['animations']['walk']
        cells = [frame(meta, sheet, r, 0) for r in range(8)] + [frame(meta, sheet, 0, walk['from'] + k) for k in range(walk['count'])] + [frame(meta, sheet, 2, walk['from'] + k) for k in range(walk['count'])]
        st, w, pad = strip(cells, z)
        rows.append((u, meta, st, w, pad))
    lab = 26
    W = max(r[2].width for r in rows) + 24
    H = sum(r[2].height + lab + 18 for r in rows) + 10
    img = Image.new('RGB', (W, H), GROUND)
    d = ImageDraw.Draw(img)
    f = font(16)
    y = 8
    for u, meta, st, w, pad in rows:
        d.text((12, y), f"{u['id']}  ({u.get('label', '')})  cell {meta['cellWidth']}  idle box {meta['idleBox']['w']}x{meta['idleBox']['h']} px  pitch {meta['pitch']}  look {meta['look']}   |  idle S SE E NE N NW W SW  |  walk S 0-7  |  walk E 0-7   (2x nearest)", fill=(235, 232, 200), font=f)
        y += lab
        img.paste(st, (12, y), st)
        # divider between the idle block and the walk block
        xdiv = 12 + 8 * (w + pad) - pad // 2 - 1
        for kk in (8, 16):
            xdiv = 12 + kk * (w + pad) - pad // 2 - 1
            d.line([(xdiv, y), (xdiv, y + st.height)], fill=(30, 30, 14), width=2)
        y += st.height + 18
    img.save(prefix + '-contact.png')
    print('wrote', prefix + '-contact.png', img.size)

def attack(z=2):
    rows = []
    for u in units:
        if u['id'] not in loaded:
            continue
        meta, sheet = loaded[u['id']]
        a = meta['animations'].get('attack')
        if not a:
            continue
        cells = []
        for r in (0, 2, 4, 1):
            cells += [frame(meta, sheet, r, a['from'] + k) for k in range(a['count'])]
        st, w, pad = strip(cells, z)
        rows.append((u, meta, st))
    W = max(r[2].width for r in rows) + 24
    H = sum(r[2].height + 44 for r in rows) + 10
    img = Image.new('RGB', (W, H), GROUND)
    d = ImageDraw.Draw(img)
    y = 8
    for u, meta, st in rows:
        d.text((12, y), f"{u['id']} attack 0-3 facing S | E | N | SE  (2x)", fill=(235, 232, 200), font=font(16))
        y += 26
        img.paste(st, (12, y), st)
        y += st.height + 18
    img.save(prefix + '-attack.png')
    print('wrote', prefix + '-attack.png', img.size)

# ---------------------------------------------------------------- 1:1 scale mock
def noise(h, w, cell, rng):
    gh, gw = h // cell + 3, w // cell + 3
    g = rng.random((gh, gw)).astype(np.float32)
    ys = np.arange(h) / cell
    xs = np.arange(w) / cell
    y0 = ys.astype(int); x0 = xs.astype(int)
    fy = (ys - y0)[:, None]; fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def ground(w=1920, h=1080, seed=7):
    rng = np.random.default_rng(seed)
    n = noise(h, w, 260, rng) * 0.5 + noise(h, w, 90, rng) * 0.3 + noise(h, w, 24, rng) * 0.14 + noise(h, w, 6, rng) * 0.06
    n = (n - n.min()) / (n.max() - n.min())
    dark = np.array([0x2c, 0x31, 0x18], np.float32)
    mid = np.array([0x4a, 0x4a, 0x26], np.float32)
    khaki = np.array([0x6e, 0x5e, 0x2e], np.float32)
    t = n[..., None]
    col = np.where(t < 0.5, dark + (mid - dark) * (t / 0.5), mid + (khaki - mid) * ((t - 0.5) / 0.5))
    hue = noise(h, w, 140, rng)[..., None]  # some patches lean green, some brown
    col = col * (0.92 + 0.16 * np.concatenate([1 - hue, 0.5 + 0 * hue, hue], axis=2) * 0.5)
    speck = rng.random((h, w))[..., None]
    col = col * (0.94 + 0.12 * speck)
    return Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).convert('RGBA')

def ring(selected=True, ro=None, w=None, ss=4):
    # Ring measured on the bar itself (ip_01, the lone ring at 1305,557, radial profile): pink band from r ~20 to
    # r ~28 (peak ~(170,85,75) after JPEG blur over olive ground), a translucent dark teal-green disc inside (~(50,85,62)
    # over the ground) for selected units. Drawn here at radius RING_R (outer) with a RING_W px band.
    ro = float(os.environ.get('RING_R', 27.5)) if ro is None else ro
    w = float(os.environ.get('RING_W', 6)) if w is None else w
    R = int(ro + 3)
    S = (2 * R + 1) * ss
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    if selected:
        rd = (ro - w) * ss
        d.ellipse([c - rd, c - rd, c + rd, c + rd], fill=(40, 150, 120, 95))
    band = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    nseg = int(os.environ.get('RING_SEG', 12))
    for k in range(nseg):  # segmented band with thin gaps, as the bar's rings read up close
        a0 = k * 360 / nseg + 3
        bd.pieslice([c - ro * ss, c - ro * ss, c + ro * ss, c + ro * ss], a0, a0 + 360 / nseg - 4, fill=(255, 106, 122, 200))
    ri = (ro - w) * ss
    bd.ellipse([c - ri, c - ri, c + ri, c + ri], fill=(0, 0, 0, 0))
    im.alpha_composite(band)
    from PIL import ImageFilter
    im = im.resize((2 * R + 1, 2 * R + 1), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.7))
    return im

IP01 = os.path.join(root, 'docs', 'ImageRefs', 'InfestedPlanet', 'ip_01.jpg')
IP05 = os.path.join(root, 'docs', 'ImageRefs', 'InfestedPlanet', 'ip_05.jpg')
PATCH_SRC = (1100, 120, 300, 300)   # a marine-free stretch of ip_01's ground (review strip tiles)

def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]

def cover(img_path, discs, search=(-320, 320, -240, 240), step=8):
    # Remove the bar's own marines + rings: each disc (cx, cy, r) is filled from an offset copy of the same frame,
    # chosen per disc so the copied ground best matches the ring of real ground just outside it (patch match on the
    # annulus r+2..r+12) and carries no marine / ring colours and no dark structures. Each disc is then gain-matched to
    # its own annulus luminance and feathered, so the squad stands on the bar's real ground at the bar's brightness.
    img = Image.open(img_path).convert('RGB')
    a = np.asarray(img).astype(np.float32)
    H, W = a.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    hsv = np.asarray(img.convert('HSV')).astype(np.float32)
    hue, sat, val = hsv[..., 0] * 360 / 255, hsv[..., 1] / 255, hsv[..., 2] / 255
    marine = (sat > 0.35) & (val > 0.3) & (((hue > 160) & (hue < 300)) | (hue > 340) | (hue < 12))
    struct = ((val < 0.2) & (sat < 0.45)) | ((val > 0.8) & (sat < 0.25))
    allin = np.zeros((H, W), bool)
    for cx, cy, r in discs:
        allin |= np.hypot(xx - cx, yy - cy) <= r + 6
    out = a.copy(); offs = []
    for cx, cy, r in discs:
        d = np.hypot(xx - cx, yy - cy)
        inside = d <= r + 6
        am = (d > r + 2) & (d <= r + 12) & ~allin
        iy, ix = np.nonzero(inside); ay, ax = np.nonzero(am)
        best = None
        for dy in range(search[2], search[3] + 1, step):
            for dx in range(search[0], search[1] + 1, step):
                sy, sx = iy + dy, ix + dx
                if sy.min() < 0 or sx.min() < 0 or sy.max() >= H or sx.max() >= W or allin[sy, sx].any():
                    continue
                say, sax = ay + dy, ax + dx
                if say.min() < 0 or sax.min() < 0 or say.max() >= H or sax.max() >= W:
                    continue
                cost = np.abs(a[say, sax] - a[ay, ax]).mean() + 400 * marine[sy, sx].mean() + 400 * struct[sy, sx].mean() + 0.02 * np.hypot(dx, dy)
                if best is None or cost < best[0]:
                    best = (cost, dx, dy)
        _, dx, dy = best
        src = a[np.clip(yy + dy, 0, H - 1), np.clip(xx + dx, 0, W - 1)]
        clean = am & ~marine
        g = a[clean].mean(0) / np.maximum(1.0, src[d <= r].mean(0))   # per-channel gain: match the annulus colour too
        patch = np.clip(src * np.clip(g, 0.6, 1.6), 0, 255)
        mask = np.clip((r + 6 - d) / 12.0, 0, 1)[..., None]
        out = np.where(inside[..., None], out * (1 - mask) + patch * mask, out)
        offs.append(f'({dx},{dy}) cost {best[0]:.0f}')
    print(f'  cover {os.path.basename(img_path)}: {len(discs)} discs, offsets ' + ', '.join(offs))
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert('RGBA')

def ground_tile():
    # a clean, marine-free tile of the bar's ground for the review strips (mirrored 2x2 so tiling has no seams)
    x, y, w, h = PATCH_SRC
    t = Image.open(IP01).convert('RGBA').crop((x + 12, y + 12, x + w - 12, y + h - 40))
    W, H = t.size
    out = Image.new('RGBA', (W * 2, H * 2))
    out.paste(t, (0, 0)); out.paste(t.transpose(Image.FLIP_LEFT_RIGHT), (W, 0))
    out.paste(t.transpose(Image.FLIP_TOP_BOTTOM), (0, H)); out.paste(t.transpose(Image.ROTATE_180), (W, H))
    return out

# The bar's own marine positions (ring centres, measured on the frames) and the discs that hide them.
IP01_DISCS = [(1168, 550, 56), (1305, 557, 38), (1233, 627, 52), (1338, 712, 40)]
# round 4: five separate rings (the bar's ring spots + one more on clean ground at 1100,630); centre spacing >= 60 px
IP01_SPOTS = [(1162, 545, 'NE', 'rifle_a'), (1305, 557, 'N', 'sniper'), (1233, 630, 'N', 'rifle_b'), (1338, 712, 'N', 'fusion'), (1100, 630, 'NE', 'medic')]
IP05_DISCS = [(885, 605, 46), (930, 635, 44), (968, 605, 44), (1017, 642, 48), (1068, 636, 46), (1040, 598, 26), (868, 572, 18)]
IP05_SPOTS = [(890, 610, 'NE', 'rifle_a'), (930, 636, 'NE', 'fusion'), (970, 604, 'E', 'rifle_b'), (1017, 642, 'NE', 'medic'), (1068, 636, 'NE', 'sniper')]
FLAT_SPOTS = [(1170, 560, 'NE', 'rifle_a'), (1240, 640, 'N', 'rifle_b'), (1305, 560, 'NE', 'sniper'), (1205, 712, 'E', 'fusion'), (1335, 700, 'NW', 'medic')]

def place_squad(img, spots, selected=True):
    R = ring(selected)
    for x, y, dname, uid in spots:
        if uid not in loaded:
            continue
        meta, sheet = loaded[uid]
        fr = frame(meta, sheet, DIRS.index(dname), 0)
        img.alpha_composite(R, (x - R.width // 2, y - R.height // 2))   # ring at the body centre (meta.center)
        cx, cy = meta['center']['x'], meta['center']['y']
        img.alpha_composite(fr, (int(round(x - cx)), int(round(y - cy))))
    return img

def cap_patch(img, spots, half=20):
    # largest contiguous vivid patch (HSV sat > 0.5 and value > 0.8) inside a 48x48 window on each marine, measured
    # as the largest k such that a k x k square of qualifying px exists; only px within 20 px of the ring centre count,
    # so the ring band (r >= 21.5) never does
    hsv = np.asarray(img.convert('RGB').convert('HSV')).astype(np.float32) / 255
    out = []
    for x, y, _, uid in spots:
        w = hsv[y - half:y + half, x - half:x + half]
        yy, xx = np.mgrid[-half:half, -half:half]
        q = ((w[..., 1] > 0.5) & (w[..., 2] > 0.8) & (np.hypot(xx + 0.5, yy + 0.5) <= half)).astype(np.int32)  # inside the ring
        dp = np.zeros_like(q); k = 0
        for j in range(q.shape[0]):
            for i in range(q.shape[1]):
                if q[j, i]:
                    dp[j, i] = 1 + (min(dp[j - 1, i], dp[j, i - 1], dp[j - 1, i - 1]) if i and j else 0)
                    k = max(k, dp[j, i])
        white = int(((w[..., 1] < 0.15) & (w[..., 2] > 0.8) & (np.hypot(xx + 0.5, yy + 0.5) <= half)).sum())
        out.append(f'{uid} {k}x{k} (vivid px {int(q.sum())}, white px {white})')
    return out

def spacing(spots):
    d = [((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5 for i, a in enumerate(spots) for b in spots[i + 1:]]
    return min(d)

def scale_mock():
    print(f'  ip_01 ring centres: {[(x, y) for x, y, _, _ in IP01_SPOTS]}, min centre spacing {spacing(IP01_SPOTS):.0f} px')
    ref = np.asarray(Image.open(IP01).convert('RGB')).astype(np.float32)
    L_ref = lum(ref[500:760, 1100:1400]).mean()
    g01 = cover(IP01, IP01_DISCS)
    L_cov = lum(np.asarray(g01.convert('RGB')).astype(np.float32)[500:760, 1100:1400]).mean()
    m01 = place_squad(g01, IP01_SPOTS)
    L_m = lum(np.asarray(m01.convert('RGB')).astype(np.float32)[500:760, 1100:1400]).mean()
    m01.convert('RGB').save(prefix + '-scale.png')
    print('wrote', prefix + '-scale.png', '(squad on ip_01 at the bar marines\' own spots, originals covered)')
    print(f'  mean luminance x1100-1400,y500-760: ip_01 {L_ref:.1f} | covered ground {L_cov:.1f} | final mock {L_m:.1f} (diff {L_m - L_ref:+.1f})')
    print(f'  ring: outer radius {os.environ.get("RING_R", 27.5)} px, band {os.environ.get("RING_W", 6)} px, #ff6a7a @ ~78% + teal disc (all five selected, as in ip_01)')
    print('  cap patch (ip_01 mock):', '; '.join(cap_patch(m01, IP01_SPOTS)))
    ref5 = np.asarray(Image.open(IP05).convert('RGB')).astype(np.float32)
    g05 = cover(IP05, IP05_DISCS)
    m05 = place_squad(g05, IP05_SPOTS)
    m05.convert('RGB').save(prefix + '-scale05.png')
    L5r = lum(ref5[480:840, 700:1340]).mean(); L5m = lum(np.asarray(m05.convert('RGB')).astype(np.float32)[480:840, 700:1340]).mean()
    print('wrote', prefix + '-scale05.png', f'(squad on ip_05 at the bar marines\' spots; lum x700-1340,y480-840 ip_05 {L5r:.1f} vs mock {L5m:.1f})')
    place_squad(ground(), FLAT_SPOTS).convert('RGB').save(prefix + '-scale-flat.png')
    print('wrote', prefix + '-scale-flat.png', '(squad on flat procedural olive ground)')

# ---------------------------------------------------------------- walk strip: 4x nearest, idle 8 dirs / walk S / walk N / walk E
def walk_diff(meta, sheet, row):
    w0 = meta['animations']['walk']['from']
    fr = [np.asarray(frame(meta, sheet, row, w0 + k)).astype(np.int16) for k in range(8)]
    out = []
    for k in range(8):
        A, B = fr[k], fr[(k + 1) % 8]
        u = (A[..., 3] > 0) | (B[..., 3] > 0)
        dd = np.abs(A - B).max(axis=2)
        out.append(float(((dd > 24) & u).sum()) / max(1, int(u.sum())))
    return out

def walk(z=4):
    tile = ground_tile()
    blocks = []
    for u in units:
        if u['id'] not in loaded or u.get('group', 'squad') != 'squad':
            continue
        meta, sheet = loaded[u['id']]
        w0 = meta['animations']['walk']['from']
        rows = [('idle S..SW', [frame(meta, sheet, r, 0) for r in range(8)]),
                ('walk S 0-7', [frame(meta, sheet, 0, w0 + k) for k in range(8)]),
                ('walk N 0-7', [frame(meta, sheet, 4, w0 + k) for k in range(8)]),
                ('walk E 0-7', [frame(meta, sheet, 2, w0 + k) for k in range(8)])]
        box = union_box([f for _, fs in rows for f in fs])
        bw, bh = (box[2] - box[0] + 2) * z, (box[3] - box[1] + 2) * z
        dS, dN = walk_diff(meta, sheet, 0), walk_diff(meta, sheet, 4)
        blocks.append((u, rows, box, bw, bh, dS, dN))
    W = max(8 * (b[3] + 8) for b in blocks) + 150
    H = sum(28 + 4 * (b[4] + 6) for b in blocks) + 10
    img = Image.new('RGBA', (W, H))
    for ty in range(0, H, tile.height):
        for tx in range(0, W, tile.width):
            img.paste(tile, (tx, ty))
    d = ImageDraw.Draw(img)
    y = 6
    for u, rows, box, bw, bh, dS, dN in blocks:
        d.rectangle([0, y, W, y + 24], fill=(20, 22, 10, 255))
        lg = (loaded[u['id']][0].get('stats') or {}).get('legs')  # this unit's own meta (was the last-loaded one)
        ls = f"   |  visible foot travel L/R px: S {lg['S']['strideL']}/{lg['S']['strideR']}, N {lg['N']['strideL']}/{lg['N']['strideR']}" if lg else ''
        d.text((10, y + 4), f"{u['id']}  walk frame-to-neighbour change (max-channel diff > 24): S min {min(dS):.2f} / N min {min(dN):.2f}{ls}   (4x nearest, 1x = 1 game px, stride {loaded[u['id']][0]['blueprint'].get('stride', 'default')})", fill=(235, 232, 200), font=font(15))
        y += 28
        for label, fs in rows:
            d.text((8, y + bh // 2 - 8), label, fill=(235, 232, 200), font=font(15))
            for i, f in enumerate(fs):
                c = f.crop((box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1)).resize((bw, bh), Image.NEAREST)
                img.alpha_composite(c, (140 + i * (bw + 8), y))
            y += bh + 6
    img.convert('RGB').save(prefix + '-walk.png')
    print('wrote', prefix + '-walk.png', img.size)

# ---------------------------------------------------------------- pitch study (sprite dirs from tools/bake.js --pitchstudy)
def pitch_study(spec):
    # spec: "pitch=dir,pitch=dir,..." each dir holds a bake of the same unit at that pitch
    R = ring(True)
    uid = os.environ.get('PITCH_UNIT', 'rifle_a')
    entries = [e.split('=', 1) for e in spec.split(',')]
    tile = ground_tile()
    z = 3
    rows = []
    for pitch, dpath in entries:
        meta = json.load(open(os.path.join(dpath, uid + '.json')))
        sheet = Image.open(os.path.join(dpath, uid + '.png')).convert('RGBA')
        rows.append((pitch, meta, sheet))
    N = max(m['cellWidth'] for _, m, _ in rows)
    sp = 60   # 1:1 spacing per facing
    W = 160 + 8 * sp + 30 + 8 * 44 * z
    H = len(rows) * (48 * z + 40) + 10
    img = Image.new('RGBA', (W, H))
    for ty in range(0, H, tile.height):
        for tx in range(0, W, tile.width):
            img.paste(tile, (tx, ty))
    d = ImageDraw.Draw(img)
    y = 8
    for pitch, meta, sheet in rows:
        cx, cy = meta['center']['x'], meta['center']['y']
        s = frame(meta, sheet, 0, 0); b = s.getbbox()
        d.rectangle([0, y, W, y + 22], fill=(20, 22, 10, 255))
        d.text((8, y + 3), f"{uid} pitch {pitch} rad ({float(pitch) * 57.2958:.0f} deg)   idle S box {b[2] - b[0]}x{b[3] - b[1]} px   |  1:1 with 26 px rings: S SE E NE N NW W SW   |  3x nearest", fill=(235, 232, 200), font=font(15))
        y += 26
        my = y + 24 * z // 2
        for i in range(8):
            fr = frame(meta, sheet, i, 0)
            x = 160 + i * sp
            img.alpha_composite(R, (x - R.width // 2, my - R.height // 2))
            img.alpha_composite(fr, (int(round(x - cx)), int(round(my - cy))))
            c = fr.crop((int(cx) - 24, int(cy) - 24, int(cx) + 24, int(cy) + 24)).resize((48 * z, 48 * z), Image.NEAREST)
            img.alpha_composite(c, (160 + 8 * sp + 30 + i * 44 * z - 40, y))
        y += 48 * z + 14
    img.convert('RGB').save(prefix + '-pitch.png')
    print('wrote', prefix + '-pitch.png', img.size)

which = sys.argv[5] if len(sys.argv) > 5 else 'all'
if which in ('all', 'contact'):
    contact()
if which in ('all', 'attack'):
    attack()
if which in ('all', 'scale'):
    scale_mock()
if which in ('all', 'walk'):
    walk()
if which.startswith('pitch:'):
    pitch_study(which[6:])
`;

// pitch study: bake one unit at several pitches into temp dirs, then compose <prefix>-pitch.png
//   node tools/bake.js --pitchstudy=1.15,1.3,1.4 [--unit=rifle_a] --mocks=<round>
function pitchStudy() {
  const { spawnSync } = require('child_process');
  const os = require('os');
  const unit = args.unit || 'rifle_a';
  const round = args.mocks === true || !args.mocks ? '1' : String(args.mocks);
  const prefix = abs(args.prefix || 'Game/progress/shots/bake-r' + round);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-pitch-'));
  const spec = [];
  for (const p of String(args.pitchstudy).split(',')) {
    const out = path.join(tmp, 'p' + p);
    const r = spawnSync(process.execPath, [__filename, '--only=' + unit, '--pitch=' + p, '--out=' + out].concat(args.roster ? ['--roster=' + args.roster] : []), { encoding: 'utf8' });
    process.stdout.write(r.stdout || '');
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    spec.push(p + '=' + out);
  }
  const r = spawnSync('python3', ['-', ROOT, abs(args.roster || 'Game/assets/roster.json'), abs(args.out || 'Game/assets/sprites'), prefix, 'pitch:' + spec.join(',')],
    { input: MOCKS_PY, encoding: 'utf8', env: Object.assign({}, process.env, { RING_R: String(args.ring || 27.5), RING_W: String(args.ringw || 6), PITCH_UNIT: unit }) });
  process.stdout.write(r.stdout || '');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (args.pitchstudy) pitchStudy();
else if (args.mocks) mocks();
else (args.explore ? explore() : bake()).catch((e) => { console.error('bake failed:', e.stack || e.message); process.exit(1); });
