#!/usr/bin/env python3
"""World-look mocks for the Infested Planet gauntlet (piece: world-look, round 2).

Paints a 1920x1080 procedural look test per spec. Round 2 replaces noise detail with DRAWN structure:
  * ground: a smooth layered wash (drift, 100-300 px pools with smoothstep edges, faint 60 px mottle) plus a sparse
    1-2 px dust speckle; no grain, no fine-texture multiply.
  * bog banks: metaballs of round lobes (40-80 px) with a lit rim taken from each lobe's own distance field, inner
    darkening, a 36 px dark halo on the ground, 300-600 tapered strand strokes per bank along a flow field, and
    bulb-tipped tendril strokes on the contour (each over a dark underline). Strokes are dab-painted at 2x and
    downsampled so they are antialiased.
  * basalt rocks: straight-edged polygons, interior posterised to 4 flat planes with hard edges plus straight seam
    strokes, a crisp 2 px rim line that is always visible, and a magenta bloom whose strength is a 0-1 contour noise
    (about a third of every contour has no bloom) and whose width varies 10-45 px along one rock.
  * each spec has its own composition (bank layout, hive, swarm, gore, marines).
Units are stand-ins (teal bug dots, marine rings), not baked factory sprites.

Usage:
  python3 tools/worldmock.py [--spec bog|basalt|cinder|all] [--round 2] [--out Game/progress/shots] [--seed 7]
  python3 tools/worldmock.py --check [--spec ...] [--round 2] [--out ...]   # prints HF/MF, palette and rim numbers
Writes <out>/world-<slug>-r<round>.png. Deterministic for a given seed.
"""
import argparse, math, os, sys
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
SS = 2  # supersample factor for stroke overlays
YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
LIGHT = (-0.55, -0.83)  # key light from the top-left (unit vector pointing toward the light)


# ------------------------------------------------------------------ helpers
def hexc(s):
    s = s.lstrip('#')
    return np.array([int(s[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def rgb8(s):
    return tuple(int(c * 255) for c in hexc(s))


def lerp(a, b, t):
    t = np.asarray(t, np.float32)
    if t.ndim == 2: t = t[..., None]
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def noise(rng, cell, octaves=1, persistence=0.5):
    """Value-noise fBm in [0,1] (percentile-normalised), built by cubic-upsampling random grids."""
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0.0
    cy, cx = (float(cell[0]), float(cell[1])) if isinstance(cell, (tuple, list)) else (float(cell), float(cell))
    for _ in range(octaves):
        gh, gw = int(math.ceil(H / cy)) + 3, int(math.ceil(W / cx)) + 3
        z = ndi.zoom(rng.random((gh, gw)).astype(np.float32), (cy, cx), order=3)[:H, :W]
        out += amp * z; tot += amp; amp *= persistence; cy = max(2.0, cy / 2); cx = max(2.0, cx / 2)
    out /= tot
    lo, hi = np.percentile(out, 1), np.percentile(out, 99)
    return np.clip((out - lo) / max(hi - lo, 1e-6), 0, 1)


def warp(img, rng, amp, cell, octaves=2):
    dy = (noise(rng, cell, octaves) - 0.5) * 2 * amp
    dx = (noise(rng, cell, octaves) - 0.5) * 2 * amp
    return ndi.map_coordinates(img, [YY + dy, XX + dx], order=1, mode='reflect')


def blur(img, s):
    return ndi.gaussian_filter(img, s)


def ellipse_pt(e, t, sc=1.0):
    cx, cy, rx, ry, rot = e[:5]
    ex, ey = rx * sc * math.cos(t), ry * sc * math.sin(t)
    return cx + ex * math.cos(rot) - ey * math.sin(rot), cy + ex * math.sin(rot) + ey * math.cos(rot)


def ellipse_field(cx, cy, rx, ry, rot):
    x, y = XX - cx, YY - cy
    c, s = math.cos(rot), math.sin(rot)
    u, v = (x * c + y * s) / rx, (-x * s + y * c) / ry
    return 1 - np.sqrt(u * u + v * v)


def vignette(canvas, strength, power=2.6):
    r = np.sqrt(((XX - W / 2) / (W / 2)) ** 2 + ((YY - H / 2) / (H / 2)) ** 2) / math.sqrt(2)
    return canvas * (1 - strength * np.clip(r, 0, 1) ** power)[..., None]


def composite(canvas, overlay):
    """Alpha-composite a PIL RGBA overlay (already at 1x) onto the float canvas."""
    o = np.asarray(overlay, np.float32) / 255
    a = o[..., 3:4]
    return canvas * (1 - a) + o[..., :3] * a


def new_overlay():
    return Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))


def down(ov):
    return ov.resize((W, H), Image.LANCZOS)


def dab(d, x, y, r, col):
    r = max(r, 0.5) * SS
    d.ellipse([x * SS - r, y * SS - r, x * SS + r, y * SS + r], fill=col)


def paint_stroke(d, pts, widths, col, ucol=None, step=1):
    """Dab-paint a tapered stroke. ucol draws the dark underline first (1 px wider)."""
    if ucol is not None:
        for (x, y), w in zip(pts[::step], widths[::step]):
            dab(d, x, y, w / 2 + 0.8, ucol)
    for (x, y), w in zip(pts[::step], widths[::step]):
        dab(d, x, y, w / 2, col)


# ------------------------------------------------------------------ specs
SPECS = {
    'bog': dict(
        name='Olive Bog', bank_style='lobes',
        ground=dict(base='#222818', mottle='#46401f', dark='#151a0d', light='#6e5f2a'),
        ground_params=dict(pool=0.6, mottle_amp=0.16, dapple_amp=0.10, speckle=0.004, speckle_amp=0.05),
        bank=dict(fill='#4a4f22', dark='#2a2f12', light='#6f7633', strand_dark='#1f2510', rim='#9aa04a',
                  edge='#b4b85c', tendril='#a8aa52', tendril_dark='#2a2e10'),
        bank_params=dict(rim_w=10, halo=0.45, strands=(220, 400), tendril_len=(28, 84), tendril_w=(4.6, 6.6),
                         tendril_spacing=17, strand_len=(20, 50), strand_w=(2.0, 3.0)),
        creep=dict(dark='#4a2236', bright='#d85a7c', strength=0.6, R=240),
        gore=dict(core='#5a0a28', mid='#b82e52', haze='#f2748a'),
        explosion=dict(core='#ffd27a', mid='#ff8a30'), vignette=0.32,
    ),
    'basalt': dict(
        name='Violet Basalt', bank_style='rock',
        ground=dict(base='#121117', mottle='#1b1a21', dark='#0b0a0e', light='#26222c'),
        ground_params=dict(pool=0.7, mottle_amp=0.12, dapple_amp=0.05, speckle=0.006, speckle_amp=0.05),
        bank=dict(fill='#241f26', dark='#1b171d', light='#2f2832', seam_light='#3a3139', seam_dark='#14111a',
                  line='#b84eae', bloom='#b8338c', cut='#0a070c'),
        bank_params=dict(line_w=1.4, bloom_w=(9, 30)),
        creep=dict(dark='#43163f', bright='#ee4d86', strength=0.95, R=400),
        gore=dict(core='#4e0820', mid='#a81e46', haze='#f06c86'),
        explosion=dict(core='#fff0a0', mid='#ff8a30'), vignette=0.28,
    ),
    'cinder': dict(
        name='Cinder Tundra', bank_style='lobes',
        ground=dict(base='#262a2c', mottle='#3b2f27', dark='#141618', light='#4a4b44'),
        ground_params=dict(pool=0.6, mottle_amp=0.14, dapple_amp=0.08, speckle=0.004, speckle_amp=0.05),
        bank=dict(fill='#3a4631', dark='#1b231a', light='#5e6a50', strand_dark='#141a13', rim='#9a977a',
                  edge='#b9b79a', tendril='#b9b79a', tendril_dark='#1a2019'),
        bank_params=dict(rim_w=7, halo=0.35, strands=(180, 320), tendril_len=(12, 34), tendril_w=(2.4, 3.4),
                         tendril_spacing=12, strand_len=(14, 40), strand_w=(1.8, 2.8)),
        creep=dict(dark='#3a0b18', bright='#b01f3e', strength=0.85, R=280),
        gore=dict(core='#5c0a26', mid='#c43358', haze='#f27a90'),
        explosion=dict(core='#ffe08a', mid='#ff7a2a'), vignette=0.30,
    ),
}

# Per-spec compositions. banks: (cx, cy, rx, ry, rot[, kind]); kind 'crater' makes an annulus rock with a full bloom.
LAYOUTS = {
    'bog': dict(
        seed_offset=11,
        banks=[(330, 50, 470, 250, 0.12), (860, 520, 190, 160, -0.25), (1810, 520, 260, 380, -0.08),
               (820, 1130, 540, 180, 0.05), (1500, 70, 200, 115, 0.0)],
        hive=(330, 650), creep_R=240,
        stream=[(410, 660), (560, 730), (720, 790), (900, 800), (1070, 750), (1190, 700)],
        patch=(540, 300, 230, 150), gore=[(1270, 760, 95), (1120, 660, 55), (1430, 830, 42), (1010, 420, 48)],
        marines=[(1380, 640), (1430, 700), (1350, 760), (1470, 770), (1300, 705)], explosion=(1200, 725),
        move=((1430, 700), (1600, 560)), tracer=((1380, 640), (1000, 430)), sniper=((1350, 760), (760, 780)),
        check=dict(ground=(1130, 290, 240, 130), ground_dark=(1560, 940, 160, 100), bank=(200, 40, 220, 110),
                   bank2=(1740, 420, 120, 160)),
    ),
    'basalt': dict(
        seed_offset=23,
        banks=[(1760, 420, 330, 430, 0.18), (110, 190, 270, 230, 0.3), (1480, 1090, 420, 150, 0.0),
               (1130, 330, 130, 118, 0.2, 'crater'), (1360, 640, 70, 66, 0.4), (120, 980, 200, 140, -0.3)],
        hive=(640, 180), creep_R=400,
        stream=[(620, 240), (520, 380), (420, 480), (330, 600), (380, 760), (520, 860)],
        patch=(300, 360, 260, 190), gore=[(760, 420, 100), (1260, 850, 60), (660, 760, 46), (1000, 170, 38)],
        marines=[(980, 720), (1030, 650), (1010, 790), (940, 840), (1060, 715)], explosion=(560, 470),
        move=((1030, 650), (1180, 560)), tracer=((980, 720), (700, 330)), sniper=((1010, 790), (430, 560)),
        check=dict(ground=(1250, 40, 220, 120), ground_lit=None, bank=(1620, 200, 220, 360), bank2=None),
    ),
    'cinder': dict(
        seed_offset=37,
        banks=[(200, 900, 420, 270, -0.2), (1680, 120, 380, 220, 0.1), (700, 330, 170, 140, 0.4),
               (1860, 800, 180, 260, 0.0)],
        hive=(1520, 820), creep_R=280,
        stream=[(1440, 790), (1280, 740), (1120, 700), (960, 690), (820, 720)],
        patch=(1160, 380, 240, 160), gore=[(640, 700, 90), (800, 640, 50), (520, 830, 40)],
        marines=[(560, 640), (500, 700), (610, 720), (470, 760), (580, 790)], explosion=(720, 690),
        move=((500, 700), (300, 560)), tracer=((560, 640), (1000, 690)), sniper=((610, 720), (1300, 730)),
        check=dict(ground=(950, 100, 220, 150), ground_lit=None, bank=(80, 820, 220, 150), bank2=None),
    ),
}


# ------------------------------------------------------------------ ground
def paint_ground(spec, rng):
    g = {k: hexc(v) for k, v in spec['ground'].items()}
    p = spec['ground_params']
    canvas = np.broadcast_to(g['base'], (H, W, 3)).astype(np.float32).copy()
    # L1: slow 320 px drift between the base and the warm mottle, soft edged
    drift = warp(noise(rng, 320, 2), rng, 40, 160)
    canvas = lerp(canvas, g['mottle'], smoothstep(0.42, 0.9, drift) * 0.85)
    canvas = lerp(canvas, g['dark'], smoothstep(0.38, 0.08, drift) * 0.55)
    # L2: lit pools, 100-300 px, smoothstep edges (ip_05's amber pools)
    pool = warp(noise(rng, 230, 2, 0.5), rng, 50, 120)
    canvas = lerp(canvas, g['light'], smoothstep(0.66, 0.95, pool) * p['pool'])
    # L3: wet-media mottle at 60 px, value only, low amplitude
    mot = warp(noise(rng, 60, 2), rng, 12, 40)
    canvas *= (1 + p['mottle_amp'] * (mot - 0.5) * 2)[..., None]
    # L4: 9 px dapple at very low amplitude (this is all the pixel-scale texture there is)
    dap = noise(rng, 9, 2, 0.6)
    canvas *= (1 + p['dapple_amp'] * (dap - 0.5) * 2)[..., None]
    # L5: sparse 1-2 px dust speckle
    spk = (rng.random((H, W)) < p['speckle']).astype(np.float32) * rng.uniform(0.4, 1.0, (H, W)).astype(np.float32)
    spk = np.maximum(spk, ndi.maximum_filter(spk, 2) * 0.6 * (rng.random((H, W)) < 0.5))
    canvas += (spk * p['speckle_amp'])[..., None]
    return np.clip(canvas, 0, 1)


# ------------------------------------------------------------------ lobed banks (bog / cinder)
def make_lobes(e, rng, spacing=36, r_edge=(16, 44), r_in=(26, 46)):
    """Round lobes on the contour of an ellipse (dense) and a few inside. Lobe = (cx, cy, r)."""
    cx, cy, rx, ry, rot = e[:5]
    perim = math.pi * (3 * (rx + ry) - math.sqrt((3 * rx + ry) * (rx + 3 * ry)))
    lobes = []
    n = max(6, int(perim / spacing))
    for i in range(n):
        t = 2 * math.pi * i / n + rng.normal(0, 0.6 / n)
        r = rng.uniform(*r_edge)
        px, py = ellipse_pt(e, t, rng.uniform(0.86, 1.0))
        lobes.append((px, py, r))
    m = max(4, int(math.pi * rx * ry / 5500))
    for _ in range(m):
        t, s = rng.uniform(0, 2 * math.pi), math.sqrt(rng.uniform(0.05, 0.75))
        px, py = ellipse_pt(e, t, s)
        lobes.append((px, py, rng.uniform(*r_in)))
    return lobes


def lobe_fields(lobes):
    """F = max_i (r_i - dist_i) (depth inside the dominant lobe), IDX = that lobe."""
    F = np.full((H, W), -1e4, np.float32)
    IDX = np.full((H, W), -1, np.int32)
    for i, (cx, cy, r) in enumerate(lobes):
        x0, x1 = max(0, int(cx - r - 2)), min(W, int(cx + r + 3))
        y0, y1 = max(0, int(cy - r - 2)), min(H, int(cy + r + 3))
        if x1 <= x0 or y1 <= y0: continue
        d = r - np.hypot(XX[y0:y1, x0:x1] - cx, YY[y0:y1, x0:x1] - cy)
        sub = F[y0:y1, x0:x1]; isub = IDX[y0:y1, x0:x1]
        better = d > sub
        sub[better] = d[better]; isub[better] = i
    return F, IDX


def flow_path(rng, x, y, ang, L, k, inside=None, step=2.0, hook=0.0, wobble=0.0):
    """Walk a curved path. k = curvature (rad/px); hook ramps curvature toward the tip (a curled tendril)."""
    pts = []
    n = max(3, int(L / step))
    for i in range(n):
        if inside is not None:
            xi, yi = int(x), int(y)
            if not (0 <= xi < W and 0 <= yi < H) or not inside[yi, xi]: break
        pts.append((x, y))
        t = i / n
        x += math.cos(ang) * step; y += math.sin(ang) * step
        ang += (k * (1 + hook * t * t)) * step + wobble * rng.normal(0, 1)
    return pts


def lobed_mask(layout, rng):
    lobes, core = [], np.full((H, W), -1.0, np.float32)
    for e in layout['banks']:
        lobes += make_lobes(e, rng)
        core = np.maximum(core, ellipse_field(*e[:5]))
    F, IDX = lobe_fields(lobes)
    mask = (F > 0) | (core > 0.08)
    mask = blur(mask.astype(np.float32), 1.2) > 0.5  # knock the hard union corners off
    return mask, dict(lobes=lobes, F=F, IDX=IDX)


def bank_mask(spec, layout, rng):
    if spec['bank_style'] == 'rock':
        mask, info = rock_mask(layout, rng)
    else:
        mask, info = lobed_mask(layout, rng)
    layout['_mask_info'] = info
    return mask


def paint_lobed_banks(canvas, spec, layout, rng, mask):
    b = {k: hexc(v) for k, v in spec['bank'].items()}
    bp = spec['bank_params']
    mi = layout['_mask_info']; lobes, F, IDX = mi['lobes'], mi['F'], mi['IDX']
    din = ndi.distance_transform_edt(mask).astype(np.float32)
    dout = ndi.distance_transform_edt(~mask).astype(np.float32)
    # per-lobe normal and lighting (the dominant lobe at each pixel)
    cxs = np.array([l[0] for l in lobes] + [0], np.float32); cys = np.array([l[1] for l in lobes] + [0], np.float32)
    rs = np.array([l[2] for l in lobes] + [1], np.float32)
    nx, ny = XX - cxs[IDX], YY - cys[IDX]
    nl = np.hypot(nx, ny) + 1e-6; nx /= nl; ny /= nl
    lit = 0.5 + 0.5 * (nx * LIGHT[0] + ny * LIGHT[1])
    has = F > 0
    depth = np.where(has, F / rs[IDX], 0)  # 0 at the lobe edge, 1 at its centre
    # ground halo under the bank
    halo = np.exp(-dout / 36) * bp['halo'] * (~mask)
    canvas = canvas * (1 - halo)[..., None]
    # interior: fill, each lobe shaded as a bump, dark toward the bank centre, lit rim per lobe
    fill = np.broadcast_to(b['fill'], (H, W, 3)).astype(np.float32).copy()
    soft = blur(warp(noise(rng, 90, 2), rng, 15, 50), 3)  # slow value variation so the mass is not one flat olive
    fill *= (0.9 + 0.2 * soft)[..., None]
    clump = blur(warp(noise(rng, 28, 2), rng, 6, 20), 1.5)  # 20-40 px hair clumps
    fill *= (0.82 + 0.36 * clump)[..., None]
    fill *= (0.92 + 0.16 * blur(noise(rng, 14, 1), 1))[..., None]
    bump = np.where(has, (0.76 + 0.46 * lit) * (1 - 0.35 * smoothstep(0.0, 1.0, depth)), 1.0)
    fill *= blur(bump, 2.5)[..., None]
    fill = lerp(fill, b['dark'], smoothstep(12, 95, din) * 0.5)
    rim = np.where(has, smoothstep(bp['rim_w'], 0, F) ** 1.3, 0) * (0.15 + 0.85 * lit)
    rim *= 0.1 + 0.9 * smoothstep(55, 12, din)  # lobe rims live near the contour; the deep interior is curls
    rim *= 0.75 + 0.25 * noise(rng, 6, 1)
    fill = lerp(fill, b['rim'], rim * 0.65)
    edge = np.clip(1 - din / 3.0, 0, 1) * (0.55 + 0.45 * noise(rng, 5, 1))
    fill = lerp(fill, b['edge'], edge * 0.6)
    canvas = np.where(mask[..., None], fill, canvas)
    # strokes: interior strands along a flow field, contour tendrils with bulbs
    ov = new_overlay(); d = ImageDraw.Draw(ov)
    A = noise(rng, 70, 2) * 2 * math.pi
    K = (noise(rng, 50, 1) - 0.5) * 0.08
    strand_col, strand_dark = rgb8(spec['bank']['light']) + (125,), rgb8(spec['bank']['strand_dark']) + (90,)
    inner = din > 5
    cand = np.argwhere(inner)
    n_banks = len(layout['banks'])
    n_str = int(rng.uniform(*bp['strands']) * n_banks)
    picks = cand[rng.permutation(len(cand))[:n_str]]
    for (py, px) in picks:
        L = rng.uniform(*bp['strand_len']); w0 = rng.uniform(*bp['strand_w'])
        pts = flow_path(rng, float(px), float(py), A[py, px] + rng.normal(0, 0.5), L, K[py, px] + rng.normal(0, 0.05), inside=mask)
        if len(pts) < 4: continue
        n = len(pts); widths = [w0 * (1 - 0.65 * i / n) for i in range(n)]
        paint_stroke(d, pts, widths, strand_col, strand_dark)
    # dark curls (the bar's interior has dark scribbles as well as light strands)
    for (py, px) in cand[rng.permutation(len(cand))[:int(n_str * 0.8)]]:
        L = rng.uniform(14, 40)
        pts = flow_path(rng, float(px), float(py), A[py, px] + rng.normal(0, 0.7), L, rng.normal(0, 0.09), inside=mask)
        if len(pts) < 4: continue
        n = len(pts); widths = [1.6 * (1 - 0.5 * i / n) for i in range(n)]
        paint_stroke(d, pts, widths, rgb8(spec['bank']['strand_dark']) + (110,))
    # tendrils on the contour
    tcol, tdark = rgb8(spec['bank']['tendril']) + (245,), rgb8(spec['bank']['tendril_dark']) + (130,)
    contour = np.argwhere((din > 0.5) & (din < 2.5))
    contour = contour[rng.permutation(len(contour))]
    sp = bp['tendril_spacing']
    taken = np.zeros((H // sp + 2, W // sp + 2), bool)
    gy, gx = np.gradient(blur(mask.astype(np.float32), 4))
    gl = np.hypot(gx, gy) + 1e-6
    count = 0
    for (py, px) in contour:
        cell = (py // sp, px // sp)
        if cell[0] >= taken.shape[0] or cell[1] >= taken.shape[1] or taken[cell]: continue
        taken[cell] = True
        if rng.random() < 0.25: continue  # uneven spacing
        ox, oy = -gx[py, px] / gl[py, px], -gy[py, px] / gl[py, px]  # outward normal
        ang = math.atan2(oy, ox) + rng.normal(0, 0.35)
        L = rng.uniform(*bp['tendril_len']); w0 = rng.uniform(*bp['tendril_w'])
        sign = 1 if rng.random() < 0.5 else -1
        curl = sign * rng.uniform(0.005, 0.016)
        hook = rng.uniform(1.5, 4.0) if rng.random() < 0.6 else 0.0  # 60 % curl into a hook at the tip
        pts = flow_path(rng, float(px) + ox * 2, float(py) + oy * 2, ang, L, curl, hook=hook, wobble=0.05)
        if len(pts) < 4: continue
        n = len(pts); widths = [w0 * (1 - 0.55 * i / n) for i in range(n)]
        paint_stroke(d, pts, widths, tcol, tdark)
        bx, by = pts[-1]
        dab(d, bx, by, widths[-1] / 2 + 1.8 + 0.8, tdark); dab(d, bx, by, widths[-1] / 2 + 1.8, tcol)
        count += 1
    canvas = composite(canvas, down(ov).filter(ImageFilter.GaussianBlur(0.8)))
    return np.clip(canvas, 0, 1), mask, dict(din=din, dout=dout, tendrils=count, strands=n_str)


# ------------------------------------------------------------------ rocks (basalt)
def rock_polygon(e, rng, n=None):
    cx, cy, rx, ry, rot = e[:5]
    n = n or int(rng.integers(7, 12))
    ts = np.sort(rng.uniform(0, 2 * math.pi, n))
    ts = ts * 0.6 + np.linspace(0, 2 * math.pi, n, endpoint=False) * 0.4  # irregular but not clumped
    return [ellipse_pt(e, float(t), rng.uniform(0.72, 1.1)) for t in ts]


def rock_mask(layout, rng):
    m = Image.new('L', (W, H), 0); dm = ImageDraw.Draw(m)
    fl = Image.new('L', (W, H), 0); dfl = ImageDraw.Draw(fl)
    bloom_force = np.zeros((H, W), np.float32)
    polys = []
    for e in layout['banks']:
        if len(e) > 5 and e[5] == 'crater':
            outer = rock_polygon(e, rng, 14)
            inner = rock_polygon((e[0], e[1], e[2] * 0.62, e[3] * 0.62, e[4]), rng, 12)
            dm.polygon(outer, fill=255); dm.polygon(inner, fill=0); dfl.polygon(inner, fill=255)
            bloom_force = np.maximum(bloom_force, np.clip(ellipse_field(e[0], e[1], e[2] * 1.6, e[3] * 1.6, e[4]), 0, 1) * 2)
            polys.append(outer)
        else:
            p = rock_polygon(e, rng); dm.polygon(p, fill=255); polys.append(p)
            for _ in range(int(rng.integers(1, 4))):  # concave bites out of the contour
                k = int(rng.integers(len(p))); bx, by = p[k]
                r = rng.uniform(0.12, 0.3) * min(e[2], e[3])
                dm.polygon(rock_polygon((bx + rng.normal(0, 8), by + rng.normal(0, 8), r, r * rng.uniform(0.6, 1), rng.uniform(0, 3)), rng, 6), fill=0)
    mask = np.asarray(m, np.float32) / 255
    mask = warp(mask, rng, 7, 160) > 0.5  # a gentle low-frequency wobble so the straight edges are painted, not ruled
    mask = warp(mask.astype(np.float32), rng, 1.6, 24) > 0.5  # and a hand-drawn jitter
    floor = warp(np.asarray(fl, np.float32) / 255, rng, 7, 160) > 0.5
    return mask, dict(polys=polys, bloom_force=bloom_force, floor=floor & ~mask)


def voronoi_planes(rng, polys, levels=4, rot=-0.6, aniso=1.6):
    """Painted facets: anisotropic Voronoi cells (long diagonal strokes) with a flat level per cell."""
    seeds = []
    for p in polys:
        xs = [q[0] for q in p]; ys = [q[1] for q in p]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        n = max(8, int((x1 - x0) * (y1 - y0) / 9000))
        for _ in range(n): seeds.append((rng.uniform(x0, x1), rng.uniform(y0, y1)))
    seeds = np.array(seeds, np.float32)
    c, s_ = math.cos(rot), math.sin(rot)
    def tf(x, y): return np.stack([x * c + y * s_, (-x * s_ + y * c) * aniso], -1)
    tree = cKDTree(tf(seeds[:, 0], seeds[:, 1]))
    wx = XX + (noise(rng, 30, 2) - 0.5) * 16; wy = YY + (noise(rng, 30, 2) - 0.5) * 16  # ragged cell edges
    _, idx = tree.query(tf(wx.ravel(), wy.ravel()).astype(np.float32))
    lv = rng.integers(0, levels, len(seeds)).astype(np.float32) / (levels - 1)
    return lv[idx].reshape(H, W)


def paint_rocks(canvas, spec, layout, rng, mask):
    b = {k: hexc(v) for k, v in spec['bank'].items()}
    bp = spec['bank_params']
    mi = layout['_mask_info']; polys, bloom_force = mi['polys'], mi['bloom_force']
    din = ndi.distance_transform_edt(mask).astype(np.float32)
    dout = ndi.distance_transform_edt(~mask).astype(np.float32)
    # interior planes: 4 flat facet levels (anisotropic Voronoi, soft 1 px edges), a slab-lighting gradient, seams
    planes = blur(voronoi_planes(rng, polys), 1.8) * 0.75 + 0.25 * blur(voronoi_planes(rng, polys, 3, rot=0.9, aniso=1.3), 1.8)
    fill = lerp(np.broadcast_to(b['dark'], (H, W, 3)), b['light'], planes)
    fill = lerp(fill, b['fill'], 0.25)
    slab = blur(warp(noise(rng, 360, 1), rng, 40, 200), 10)
    fill *= (0.9 + 0.2 * slab)[..., None]
    fill *= (0.97 + 0.06 * blur(noise(rng, 40, 1), 2))[..., None]
    nocrater = 1 - np.clip(bloom_force, 0, 1)
    fill = lerp(fill, b['dark'], np.clip(1 - din / 10, 0, 1) * 0.25 * nocrater)  # a dark inner edge (not on the crater ring)
    canvas = np.where(mask[..., None], fill, canvas)
    fa = blur(mi['floor'].astype(np.float32), 3)[..., None]  # crater floor is dark rock with a soft lip
    canvas = canvas * (1 - fa) + lerp(fill, b['dark'], 0.45) * fa
    # seam strokes: straight painted lines crossing each rock
    ov = new_overlay(); d = ImageDraw.Draw(ov)
    sl, sd = rgb8(spec['bank']['seam_light']) + (95,), rgb8(spec['bank']['seam_dark']) + (105,)
    for p in polys:
        n = int(rng.integers(6, 11))
        for _ in range(n):
            i = int(rng.integers(len(p))); j = (i + int(rng.integers(2, len(p) - 1))) % len(p)
            (x0, y0), (x1, y1) = p[i], p[j]
            x0 += rng.normal(0, 12); y0 += rng.normal(0, 12); x1 += rng.normal(0, 12); y1 += rng.normal(0, 12)
            t0, t1 = sorted(rng.uniform(0, 1, 2)); t1 = min(1.0, t0 + max(0.25, t1 - t0))
            x0, y0, x1, y1 = x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1
            w = rng.uniform(3.0, 6.0); col = sl if rng.random() < 0.55 else sd
            steps = max(4, int(math.hypot(x1 - x0, y1 - y0) / 2))
            pts = [(x0 + (x1 - x0) * t / steps, y0 + (y1 - y0) * t / steps) for t in range(steps)]
            widths = [w * (0.6 + 0.4 * math.sin(math.pi * t / steps)) for t in range(steps)]
            paint_stroke(d, pts, widths, col)
    seams = np.asarray(down(ov).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    a = seams[..., 3:4] * mask[..., None] * (din > 3)[..., None]
    canvas = canvas * (1 - a) + seams[..., :3] * a
    # rim: a crisp 2 px line that is always visible, then a bloom with 0-1 strength and 10-45 px width
    line = np.clip(1 - np.abs(din - 1.0) / bp['line_w'], 0, 1) * mask
    line = np.maximum(line, np.clip(1 - dout / 1.0, 0, 1) * (~mask) * 0.6)
    line *= 0.6 + 0.4 * noise(rng, 5, 1)  # painted, not ruled: the line breathes but never disappears
    line *= np.clip(1 - blur(mi['floor'].astype(np.float32), 3) * 1.5, 0, 1) * (1 - np.clip(bloom_force, 0, 1))  # the crater is a painted ring, no crisp line at all
    strength = smoothstep(0.38, 0.74, noise(rng, 100, 1))
    strength = np.clip(np.maximum(strength, bloom_force), 0, 1)
    wid = bp['bloom_w'][0] + (bp['bloom_w'][1] - bp['bloom_w'][0]) * noise(rng, 120, 1)
    bf = np.clip(bloom_force, 0, 1)
    wid = wid + (34.0 - wid) * bf
    dout_w, din_w = warp(dout, rng, 9, 36), warp(din, rng, 6, 30)  # cloudy edge, not a parallel band
    cloud = 0.5 + 0.5 * noise(rng, 22, 2, 0.6)
    inner_w = wid * (0.7 + 0.9 * bf)  # the crater ring glows right through
    bloom = strength * (np.exp(-dout_w / wid) * (~mask) + np.exp(-din_w / inner_w) * mask * (0.65 + 0.35 * bf)) * cloud
    canvas = lerp(canvas, b['bloom'], np.clip(bloom * 0.95, 0, 1))
    canvas += b['bloom'] * (bloom * bloom * 0.3)[..., None]
    canvas = lerp(canvas, b['cut'], np.clip(1 - np.abs(dout - 2.2) / 1.2, 0, 1) * (~mask) * (~mi['floor']) * nocrater * 0.3)
    canvas = lerp(canvas, b['line'], np.clip(line, 0, 1) * 0.8)
    return np.clip(canvas, 0, 1), mask, dict(din=din, dout=dout, strength=strength, wid=wid)


# ------------------------------------------------------------------ creep, hive, gore, units
def paint_creep(canvas, spec, layout, rng, mask):
    c = spec['creep']; dark, bright = hexc(c['dark']), hexc(c['bright'])
    cx, cy = layout['hive']; R = layout['creep_R']
    d = np.sqrt((XX - cx) ** 2 + (YY - cy) ** 2) / R
    d = d * (0.7 + 0.6 * warp(noise(rng, 140, 3), rng, 30, 80))
    cloud = 0.5 + 0.5 * noise(rng, 55, 3, 0.6)
    a = np.clip(1 - d, 0, 1) ** 1.25 * cloud * c['strength']
    a = blur(a, 2) * (~mask)
    col = lerp(np.broadcast_to(dark, (H, W, 3)), bright, np.clip(1 - d * 1.15, 0, 1) ** 2 * 0.9)
    canvas = lerp(canvas, col, a)
    canvas += bright * (a * a * 0.35)[..., None]
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dr = ImageDraw.Draw(ov)
    bcol = tuple(int(v * 255) for v in bright)
    for _ in range(140):
        x, y = rng.normal(cx, R * 0.45), rng.normal(cy, R * 0.45)
        if 0 <= x < W and 0 <= y < H and not mask[int(y), int(x)]:
            dr.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill=bcol + (150,))
    return np.clip(composite(canvas, ov), 0, 1)


def hexagon(d, cx, cy, r, fill, outline=None, width=2, rot=0.0):
    pts = [(cx + r * math.cos(rot + i * math.pi / 3), cy + r * math.sin(rot + i * math.pi / 3)) for i in range(6)]
    d.polygon(pts, fill=fill, outline=outline, width=width)


def draw_hive(canvas, layout):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    cx, cy = layout['hive']
    for i in range(6):
        a = i * math.pi / 3 + 0.3; r = 92
        hexagon(d, cx + r * math.cos(a), cy + r * math.sin(a), 15, (26, 30, 38, 255), (60, 66, 80, 255), 2, 0.5)
        d.ellipse([cx + r * math.cos(a) - 4, cy + r * math.sin(a) - 4, cx + r * math.cos(a) + 4, cy + r * math.sin(a) + 4], fill=(214, 70, 160, 255))
    hexagon(d, cx, cy, 44, (24, 28, 40, 255), (70, 80, 110, 255), 3, 0.0)
    hexagon(d, cx, cy, 30, (40, 24, 60, 255), (214, 70, 160, 255), 3, 0.5)
    d.ellipse([cx - 16, cy - 16, cx + 16, cy + 16], fill=(120, 230, 90, 255))
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=(20, 10, 30, 255))
    for i in range(6):
        a = i * math.pi / 3
        d.ellipse([cx + 36 * math.cos(a) - 5, cy + 36 * math.sin(a) - 5, cx + 36 * math.cos(a) + 5, cy + 36 * math.sin(a) + 5], fill=(230, 60, 150, 255))
    return composite(canvas, ov)


def paint_gore(canvas, spec, layout, rng, mask):
    g = {k: hexc(v) for k, v in spec['gore'].items()}
    field = np.full((H, W), -1.0, np.float32)
    coref = np.zeros((H, W), np.float32)
    ov = new_overlay(); d = ImageDraw.Draw(ov)
    mid8 = rgb8(spec['gore']['mid'])
    for (cx, cy, R) in layout['gore']:
        field = np.maximum(field, ellipse_field(cx, cy, R, R * rng.uniform(0.8, 1.1), rng.uniform(0, 3)))
        coref = np.maximum(coref, np.clip(ellipse_field(cx, cy, R * 0.55, R * 0.5, rng.uniform(0, 3)), 0, 1))
        for _ in range(int(rng.integers(8, 16))):  # droplets flung outward
            a = rng.uniform(0, 2 * math.pi); dist = R * rng.uniform(0.7, 1.9); r = rng.uniform(5, 18)
            field = np.maximum(field, ellipse_field(cx + dist * math.cos(a), cy + dist * math.sin(a), r * 1.6, r, a))
        for _ in range(int(rng.integers(2, 5))):  # streaks: a stroke that thins out and ends in droplets
            a = rng.uniform(0, 2 * math.pi); L = R * rng.uniform(0.8, 1.7)
            pts = flow_path(rng, cx + math.cos(a) * R * 0.5, cy + math.sin(a) * R * 0.5, a, L, rng.normal(0, 0.004))
            n = len(pts)
            if n < 4: continue
            widths = [max(2.0, 13 * (1 - i / n) ** 1.1) for i in range(n)]
            paint_stroke(d, pts, widths, mid8 + (230,))
            for k in range(int(rng.integers(2, 5))):
                t = rng.uniform(0.5, 1.0); x, y = pts[min(n - 1, int(t * n))]
                rr = rng.uniform(2, 6); dab(d, x + rng.normal(0, 6), y + rng.normal(0, 6), rr, mid8 + (230,))
    field += 0.22 * (noise(rng, 26, 3) - 0.5)
    m = (field > 0.08) & (~mask)
    core = smoothstep(0.1, 0.8, coref + 0.25 * (noise(rng, 20, 2) - 0.5)) * m
    col = lerp(np.broadcast_to(g['mid'], (H, W, 3)), g['core'], core)
    col *= (0.88 + 0.24 * blur(noise(rng, 7, 2), 1))[..., None]
    haze = blur(m.astype(np.float32), 22) * 0.75 * (~mask)
    canvas = lerp(canvas, g['haze'], haze * 0.75)
    canvas = np.where(m[..., None], col, canvas)
    streaks = down(ov)
    sa = (np.asarray(streaks, np.float32)[..., 3] / 255) * (~mask)
    canvas = lerp(canvas, g['mid'], sa)
    return np.clip(canvas, 0, 1)


def bug_sprite():
    s = Image.new('RGBA', (28, 28), (0, 0, 0, 0)); d = ImageDraw.Draw(s)
    d.ellipse([6, 9, 22, 19], fill=(16, 44, 48, 255))
    d.ellipse([7, 10, 21, 18], fill=(46, 110, 116, 255))
    d.ellipse([18, 11, 24, 17], fill=(30, 80, 90, 255))
    for (x, y) in [(10, 12), (14, 15), (12, 16)]:
        d.ellipse([x, y, x + 2, y + 2], fill=(190, 236, 110, 255))
    d.point((21, 13), fill=(240, 255, 220, 255))
    d.line([(8, 11), (4, 8)], fill=(16, 44, 48, 255)); d.line([(8, 17), (4, 20)], fill=(16, 44, 48, 255))
    return s


def draw_bugs(canvas, layout, rng, mask):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    spr = bug_sprite()
    pts = []
    stream = layout['stream']
    for i in range(len(stream) - 1):
        (x0, y0), (x1, y1) = stream[i], stream[i + 1]
        for _ in range(130):
            t = rng.random(); x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            x += rng.normal(0, 26); y += rng.normal(0, 26)
            pts.append((x, y, math.degrees(math.atan2(y1 - y0, x1 - x0)) + rng.normal(0, 25)))
    px, py, pw, ph = layout['patch']
    for _ in range(460):
        pts.append((rng.normal(px + pw / 2, pw / 3.2), rng.normal(py + ph / 2, ph / 3.0), rng.uniform(0, 360)))
    for (x, y, a) in pts:
        if 0 <= x < W and 0 <= y < H and not mask[int(y), int(x)]:
            r = spr.rotate(-a, resample=Image.BICUBIC, expand=False)
            ov.alpha_composite(r, (int(x) - 14, int(y) - 14))
    return composite(canvas, ov)


def draw_marines(canvas, layout):
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    bodies = [(34, 40, 56), (96, 86, 60), (58, 70, 52), (40, 36, 44), (88, 78, 70)]  # Night Watch, Sand, Field Olive, Ashen, Bone
    for i, (x, y) in enumerate(layout['marines']):
        for k in range(4):
            a0 = k * 90 + 8
            d.arc([x - 23, y - 23, x + 23, y + 23], a0, a0 + 74, fill=(236, 92, 92, 255), width=4)
        d.ellipse([x - 13, y - 13, x + 13, y + 13], fill=(0, 0, 0, 70))
        bc = bodies[i % len(bodies)]
        d.rounded_rectangle([x - 9, y - 11, x + 9, y + 11], radius=4, fill=bc, outline=(12, 12, 16, 255))
        d.ellipse([x - 4, y - 5, x + 4, y + 3], fill=tuple(min(255, c + 40) for c in bc))
        d.line([(x + 4, y - 2), (x + 20, y - 8)], fill=(20, 20, 24, 255), width=3)
        d.line([(x + 4, y - 2), (x + 20, y - 8)], fill=(150, 150, 160, 255), width=1)
    (x, y), (tx, ty) = layout['move']
    n = 22
    for i in range(n):
        t = i / n; px, py = x + (tx - x) * t, y + (ty - y) * t
        d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=(70, 230, 220, 255))
    d.ellipse([tx - 5, ty - 5, tx + 5, ty + 5], fill=(70, 230, 220, 255))
    (x, y), (tx, ty) = layout['tracer']
    for i in range(10):
        t = i / 10; px, py = x + (tx - x) * t, y + (ty - y) * t
        d.polygon([(px, py - 3), (px + 4, py + 2), (px - 4, py + 2)], fill=(250, 60, 60, 255))
    (x, y), (tx, ty) = layout['sniper']
    d.line([(x, y), (tx, ty)], fill=(255, 255, 255, 180), width=2)
    return composite(canvas, ov)


def paint_explosion(canvas, spec, layout, rng):
    e = {k: hexc(v) for k, v in spec['explosion'].items()}
    cx, cy = layout['explosion']
    d = np.sqrt((XX - cx) ** 2 + (YY - cy) ** 2)
    a = np.clip(1 - d / 48, 0, 1) ** 1.6 * (0.7 + 0.3 * noise(rng, 10, 2))
    canvas = lerp(canvas, e['mid'], a * 0.9)
    canvas += e['core'] * (np.clip(1 - d / 22, 0, 1) ** 1.2 * 0.9)[..., None]
    canvas += e['mid'] * (np.exp(-d / 60) * 0.35)[..., None]
    return np.clip(canvas, 0, 1)


# ------------------------------------------------------------------ render + check
def render(slug, seed):
    spec, layout = SPECS[slug], LAYOUTS[slug]
    rng = np.random.default_rng(seed + layout['seed_offset'])
    canvas = paint_ground(spec, rng)
    mask = bank_mask(spec, layout, rng)
    canvas = paint_creep(canvas, spec, layout, rng, mask)
    canvas = paint_gore(canvas, spec, layout, rng, mask)
    if spec['bank_style'] == 'rock':
        canvas, mask, info = paint_rocks(canvas, spec, layout, rng, mask)
    else:
        canvas, mask, info = paint_lobed_banks(canvas, spec, layout, rng, mask)
    canvas = draw_hive(canvas, layout)
    canvas = draw_bugs(canvas, layout, rng, mask)
    canvas = paint_explosion(canvas, spec, layout, rng)
    canvas = draw_marines(canvas, layout)
    canvas = vignette(canvas, spec['vignette'])
    return Image.fromarray((np.clip(canvas, 0, 1) * 255 + 0.5).astype(np.uint8))


def stats(path, slug):
    """The critic's numbers: HF = std(L - blur3), MF = std(blur3 - blur15), palette mean + HSV sat, rim widths."""
    im = np.asarray(Image.open(path).convert('RGB'), np.float32)
    L = 0.299 * im[..., 0] + 0.587 * im[..., 1] + 0.114 * im[..., 2]
    ck = LAYOUTS[slug]['check']
    out = {}

    def region(name, box):
        if not box: return
        x, y, w, h = box; sub = L[y:y + h, x:x + w]
        hf = float((sub - blur(sub, 3)).std()); mf = float((blur(sub, 3) - blur(sub, 15)).std())
        rgb = im[y:y + h, x:x + w].reshape(-1, 3)
        mean = rgb.mean(0); mx, mn = mean.max(), mean.min()
        sat = 255 * (mx - mn) / max(mx, 1e-6)
        p10, p90 = np.percentile(sub, 10), np.percentile(sub, 90)
        out[name] = dict(box=box, HF=round(hf, 2), MF=round(mf, 2), mean=[int(round(v)) for v in mean], sat=int(round(sat)),
                         L_p10=round(float(p10), 1), L_p90=round(float(p90), 1))
    for k, v in ck.items():
        region(k, v)
    if slug == 'basalt':
        # rim profiles: walk rows across the big right plateau's left edge and the crater
        m = (im[..., 0] + im[..., 2] - 2 * im[..., 1]) / 2
        rows = []
        for y in (160, 240, 320, 400, 480, 560, 640):
            seg = m[y, 1300:1700]
            pk = seg.max(); wdt = int((seg > 0.35 * pk).sum())
            rows.append((y, round(float(pk), 1), wdt))
        out['rim_rows_plateau'] = rows
        seg = m[330, 950:1150]; out['rim_crater_left'] = (round(float(seg.max()), 1), int((seg > 0.35 * seg.max()).sum()))
    return out


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--spec', default='all'); ap.add_argument('--round', type=int, default=2)
    ap.add_argument('--out', default='Game/progress/shots'); ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--check', action='store_true', help='print the look-test numbers for existing outputs')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for slug in (SPECS if a.spec == 'all' else [a.spec]):
        path = os.path.join(a.out, f'world-{slug}-r{a.round}.png')
        if a.check:
            print(slug, stats(path, slug))
            continue
        render(slug, a.seed).save(path)
        print('wrote', path)
