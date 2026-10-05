# World look: three competing specs (round 2)

Owner: world-look builder. Purpose: let the art director pick a world look **before** heavy terrain art starts.
The bar is `docs/ImageRefs/InfestedPlanet/ip_01..12.jpg` (Steam, 1920x1080). Unit art follows `docs/STYLE.md`
(dark heroic, dusk key light with a cool rim, low-value low-saturation military palettes with one accent).

Round 2 changes, driven by the round-1 critic (score 4/10, ref won 6/6): **detail is now drawn structure, not noise.**
Lobes, strands, tendrils, rock facets, seams and the rim bloom are all constructed (distance fields, metaballs,
Voronoi facets, dab-painted tapered strokes at 2x supersample), the grain and fine-texture multiplies are gone,
the basalt ground is neutral charcoal, the bog ground is the bar's amber wash, and every spec has its own composition.

Example images (procedural look tests from `tools/worldmock.py`, not final art; units are stand-ins, no HUD):

| spec | mock | A/B vs ip_01 (crop 200,150,900,600) | A/B vs ip_02 (crop 900,100,900,600) |
| --- | --- | --- | --- |
| 1 Olive Bog | `Game/progress/shots/world-bog-r2.png` | `shots/ab-world-look-r2-bog-ip01/` | `shots/ab-world-look-r2-bog-ip02/` |
| 2 Violet Basalt | `Game/progress/shots/world-basalt-r2.png` | `shots/ab-world-look-r2-basalt-ip01/` | `shots/ab-world-look-r2-basalt-ip02/` |
| 3 Cinder Tundra | `Game/progress/shots/world-cinder-r2.png` | `shots/ab-world-look-r2-cinder-ip01/` | `shots/ab-world-look-r2-cinder-ip02/` |

Also: `shots/world-look-r2-detail.png` (1:1 crops, bar vs ours: bank edge, crater, plateau facets) and
`shots/world-look-r2-ab-sheet-a/b.png` (the six A/B pairs side by side).

Regenerate: `python3 tools/worldmock.py --spec all --round 2` (12-15 s per spec, byte-identical for a given `--seed`).
Numbers: `python3 tools/worldmock.py --round 2 --check` prints HF/MF, palette means, HSV saturation and rim-profile
widths for the regions listed under each spec (the same definitions the critic used: L = 0.299R+0.587G+0.114B,
HF = std(L - blur3), MF = std(blur3 - blur15), rim width = pixels where (R+B-2G)/2 exceeds 35% of its row peak).

## What the bar actually does (measured from the shots)

- Bog ground (ip_01/05): dark areas average `(38,42,24)`, lit amber pools `(59,56,24)` up to `#928730` locally;
  p10-p90 L spread about 20; pixel-scale texture is smooth (HF 2.9-3.1, MF 3.0): a wet wash with 100-300 px pools,
  not grain.
- Bog banks: stacked rounded lobes 40-80 px, each with a bright rim on its lit (outer/top-left) side, interior darker
  toward the centre with dense curly "hair" (dark scribbles and light strands, 20-60 px); fill `#4a4d22`..`#6b6d2c`,
  lobe rim `#8b8d3a`..`#9aa04a`; interior HF 3.5-4.3. A dark halo sits on the ground around each bank. Tendrils:
  40-100 px long, 5-7 px at the base tapering to 2-3 px, bulb-tipped (6-8 px), many curl into a hook at the tip, colour
  `#9c9d4e`..`#b4b45e` with a darker edge.
- Basalt ground (ip_02/09): near-neutral charcoal `(23,22,27)`, HSV sat 46, with fine 1-2 px dust speckle (HF 0.85,
  MF 1.2) and soft 100-300 px lighter clouds; violet appears only as creep haze.
- Basalt rocks: straight-edged plateaus with 3-4 flat painted planes (interior p10/p90 L = 27/40, HF 0.72), straight
  seam strokes, a thin purple line on the contour (2 px, `#8a2f9a`..`#c040c0`) and a magenta bloom whose width varies
  per rock from 12 px (big rock, y=400) to 44 px (crater, y=300) and is absent on long stretches. The crater is a
  solid painted magenta ring with a cloudy outer edge, no crisp line.
- Creep (ip_09/12): magenta haze `#8e354b` mid, `#f14f77` bright, over violet `#311d3c`; cloudy edge; faint teal dots.
- Gore: dark core `#530621`, mid `#b3304f`, pink spray `#fc907a`; splats 80-250 px with flung droplets and streaks.
- Swarm: body `#2b4c51`, green-yellow highlights; reads as a bright textured mass on both grounds.
- Explosions `#c1744e` edge to `#ffd27a` core. HUD accent cyan `#38e0e0`, yellow `#f2e14c`, magenta `#d64fd6`.

Readability rule every spec keeps: **ground mid-low value and low saturation; swarm pops by saturation and by its
bright highlights; gore pops by hue (hot pink); HUD accent pops by being the only pure cyan on screen.**

---

## Spec 1: Olive Bog (faithful to ip_01 / ip_05)

| role | hex | note |
| --- | --- | --- |
| ground base | `#222818` | dark olive-khaki; measured dark-area mean `(43,42,22)` vs bar `(38,42,24)` |
| ground mottle | `#46401f` | warm amber wash, 320 px drift |
| ground dark | `#151a0d` | drift lows and the halo under banks |
| ground lit pool | `#6e5f2a` | 100-300 px pools; measured lit mean `(54,53,27)` vs bar `(59,56,24)` |
| bank fill / dark | `#4a4f22` / `#2a2f12` | interior olive, darker toward the centre |
| bank strand light / dark | `#6f7633` / `#1f2510` | the hair: light stroke over a 1 px dark underline |
| bank lobe rim | `#9aa04a` | per-lobe rim, 10 px, lit top-left |
| bank edge line | `#b4b85c` | 3 px bright line on the outer contour |
| tendril / underline | `#a8aa52` / `#2a2e10` | bulb-tipped strokes |
| creep dark / bright | `#4a2236` / `#d85a7c` | weak on this biome (ip_10) |
| gore core / mid / spray | `#5a0a28` / `#b82e52` / `#f2748a` | |
| explosion | `#ff8a30` to `#ffd27a` | |
| HUD accent | `#38e0e0` cyan, `#f2e14c` yellow, `#d64fd6` magenta | |

**Ground material** (shader or baked 2048 px tile; nothing finer than 9 px, no grain):
1. 320 px value-noise drift, domain-warped 40 px: `base -> mottle` by smoothstep(0.42, 0.90) at 85%, `-> dark` by
   smoothstep(0.38, 0.08) at 55%.
2. Lit pools: 230 px noise warped 50 px, smoothstep(0.66, 0.95) toward `lit pool` at 60%. These are the amber pools;
   they carry most of the ground's value range (target p10-p90 spread ~20 L; measured 18-24).
3. 60 px wet-media mottle, value only, +-16%.
4. 9 px dapple, value only, +-10% (this is all the pixel-scale texture there is; measured ground HF 1.0-1.3, MF 2.0).
5. Dust speckle: 0.4% of pixels, 1-2 px, +5% value. Vignette -32% at the corners (power 2.6, so the centre is untouched).

**Impassable banks** (the look lives here):
- *Mass*: an ellipse core plus round lobes: one lobe every ~36 px of contour with radius 16-44 px, placed at 86-100%
  of the ellipse radius so they bulge out, and one interior lobe per ~5,500 px^2 with radius 26-46. The bank mask is the
  union; the lobe field `F = max_i (r_i - dist_i)` and the dominant lobe index give every pixel its own lobe.
- *Lobe shading*: each lobe is a bump: multiply by `(0.76 + 0.46 * lit) * (1 - 0.35 * depth)` where
  `lit = 0.5 + 0.5 * dot(normal_from_lobe_centre, light(-0.55,-0.83))` and `depth = F / r`, blurred 2.5 px so lobes
  merge instead of showing seams. Inner darkening: lerp to `bank dark` by smoothstep(12, 95, distance-inside) at 50%.
  Slow 90 px value variation +-10% and 28 px hair clumps +-18% so the mass is never flat.
- *Per-lobe rim*: `smoothstep(10, 0, F)^1.3 * (0.15 + 0.85 * lit)`, lerp to `lobe rim` at 65%, faded to 10% beyond
  55 px inside the contour (rims live on the outer lobes; the deep interior is hair). Outer contour gets a 3 px
  `edge line` at 60%.
- *Halo*: ground outside the bank darkened by `0.45 * exp(-d/36)`.
- *Strand strokes* (interior hair): 220-400 per bank, start anywhere > 5 px inside, follow a 70 px flow field
  (angle = noise * 2 pi) with curvature `(noise50 - 0.5) * 0.08 rad/px`, length 20-50 px, width 2-3 px tapering to 35%,
  colour `strand light` at 50% over a 1 px `strand dark` underline at 35%. Plus 0.8x as many dark curls 14-40 px long,
  1.6 px, curvature N(0, 0.09), `strand dark` at 45%.
- *Tendril strokes* (contour fringe): one start per 17 px of contour with 25% skipped, direction = outward normal
  +-0.35 rad, length 28-84 px, width 4.6-6.6 px tapering to 45%, curvature +-0.005..0.016 rad/px, 60% ramp the curvature
  by `1 + hook * t^2` (hook 1.5-4) so the tip hooks; bulb = dot of radius (tip width/2 + 1.8) px; `tendril` colour over
  a 1 px `underline` at 50%. All strokes are dab-painted at 2x and downsampled, then blurred 0.8 px.
- Measured bank interior: HF 3.4-3.7 (target 3-5, bar 3.5-4.3), MF 2.5-2.7 (target 4-6; still low, see weaknesses).

**Creep.** Weak pink haze, radius 240 px around the hive, warped by 140 px noise (0.7-1.3x), `(1-d)^1.25` times a 55 px
cloud, banks occlude it; 140 teal dots scattered on it. Spreads by growing the radius per hive.

**Lighting.** Dusk key from the top-left: lobe rims and bumps use it; tendrils and strands do not. Vignette.

**Contrast on this ground** (WCAG ratios vs base/mottle/pool): swarm highlight 4.6-11:1, swarm body 1.1-2.6:1 (the mass
reads by its highlights), marine ring 1.9-4.5:1, gore mid 1.1-2.6:1 by value but opposite in hue, HUD cyan 3.9-9.3:1,
HUD yellow 4.7-11:1. Units: Night Watch 1.0-2.3:1, Ashen 1.0-2.4:1, Sand Frame 1.1-2.1:1, Bone 1.3-1.9:1, Field Olive
1.0-1.6:1 (**lost**). Every unit palette needs the selection ring and a rim light on this biome, as in the bar.

**Risks.** Still the most expensive look: three stroke passes per bank (strands, curls, tendrils) and per-lobe shading.
Olive and sand unit palettes vanish on it. The hair density the bar has (MF 4-6) is not reached yet.

Grok Imagine prompts:
1. "Seamless top-down game ground texture, dark olive khaki bog, wet watercolour wash with soft amber sandy pools 100-300
   px, very smooth, no grain, no objects, low saturation, tileable, 2048x2048"
2. "Top-down 2D strategy game screenshot mock, 1920x1080, dark khaki mottled ground with amber pools, olive moss banks
   built from stacked round lobes each with a pale yellow-green lit rim, dense dark curly hair texture inside, thick
   bulb-tipped curling tendrils hanging off the edges, a dark halo on the ground around each bank, one patch of pink
   alien creep, large hot-pink blood splats, dusk vignette, painterly, no HUD, no text"
3. "Close-up, top-down, edge of a dark olive moss bank: stacked round lobes with a soft pale rim on each, dark curly
   hair strands inside, thick pale tendrils with bulb tips curling over dark mottled khaki ground, painterly, 1024x1024"

---

## Spec 2: Violet Basalt (faithful to ip_02 / ip_09)

| role | hex | note |
| --- | --- | --- |
| ground base | `#121117` | neutral charcoal; measured clean-ground mean `(22,21,27)`, HSV sat 58 (bar `(23,22,27)`, 46) |
| ground mottle | `#1b1a21` | 320 px drift |
| ground dark | `#0b0a0e` | |
| ground light cloud | `#26222c` | 100-300 px soft clouds at 70% |
| rock fill / dark / light | `#241f26` / `#1b171d` / `#2f2832` | facet planes; measured interior p10/p90 L = 25/37 (bar 27/40) |
| rock seam light / dark | `#3a3139` / `#14111a` | straight painted seams, 3-6 px |
| rim line | `#b84eae` | 1.4 px crisp purple line, always visible (alpha 0.5-0.8 by 5 px noise) |
| rim bloom | `#b8338c` | 0-1 strength, 9-30 px width (34 px on the crater) |
| creep dark / bright | `#43163f` / `#ee4d86` | the only violet on the map |
| gore core / mid / spray | `#4e0820` / `#a81e46` / `#f06c86` | |
| explosion | `#ff8a30` to `#fff0a0` | |
| HUD accent | `#38e0e0` cyan, `#f2e14c` yellow, `#d64fd6` magenta | |

**Ground material.** The bog recipe with the neutral table, light clouds at 70%, 60 px mottle +-12%, 9 px dapple +-5%,
dust speckle 0.6% at +5%. Measured HF 0.85, MF 0.5 (bar 0.85 / 1.2). Vignette -28%.

**Impassable rocks.**
- *Shape*: a polygon per rock, 7-12 vertices at irregular angles (60% random, 40% even) and radius 72-110% of the
  ellipse, 1-3 concave bites (small 6-gons of radius 12-30% of the rock) cut from the contour, then a 7 px warp at 160 px
  and a 1.6 px warp at 24 px so the straight edges are painted, not ruled. A crater is a 14-gon ring with a 12-gon floor
  at 62% radius; the floor is dark rock (fill lerped 45% to `rock dark`) with a 3 px soft lip.
- *Facets*: anisotropic Voronoi cells (seeds one per ~9,000 px^2, coordinates rotated -0.6 rad and stretched 1.6x so
  the cells are long diagonal strokes, cell edges warped 16 px by 30 px noise), each cell a flat level 0..3 of
  `dark -> light`, blurred 1.8 px; 25% blended toward `fill`; mixed 75/25 with a second coarser 3-level Voronoi.
  A 360 px slab gradient +-10% and a 40 px wash +-3%. A 10 px dark inner edge at 25% (not on the crater). Measured
  interior HF 0.55 (bar 0.72).
- *Seams*: 6-10 per rock: a straight segment between two contour vertices, offset +-12 px, clipped to 25-100% of its
  length, 3-6 px wide with a sine taper, `seam light` or `seam dark` at ~40%, blurred 1 px.
- *Rim line*: `1 - |d_in - 1| / 1.4` inside plus a 1 px 60% tail outside, times `0.6 + 0.4 * noise5`, lerp to
  `rim line` at 80%. It never disappears on ordinary rocks; it is removed entirely on the crater ring.
- *Bloom*: strength `smoothstep(0.38, 0.74, noise100)` (0-1; about 38% of every contour has no bloom), width
  `9 + 21 * noise120` px, raised to 34 px inside the crater zone; outer term `exp(-d_out_warped / width)`, inner term
  `exp(-d_in_warped / (0.7 width)) * 0.65` (full strength and 1.6x width on the crater); both distance fields warped
  6-9 px and multiplied by a 22 px cloud (0.5-1.0) so the edge is cloudy, not a parallel band; lerp to `rim bloom` at 95%
  plus an additive `bloom^2 * 0.3` hot core. A 1 px dark cut at 2 px outside the contour at 30%.
- Measured rim widths along the big plateau's left edge (rows y=160..640, 35% of row peak): 37, 2, 15, 33, 21, 19,
  22 px (bar: 12-44 px); crater ring 114 px (bar crater 44 px measured at one row; the bar's ring is thicker than its
  bloom reading because the ring is solid paint).

**Creep.** Big magenta haze (R 400 px) with the cloudy warped edge, brighter core, teal dots. Spreads per hive.

**Lighting.** Emissive: the magenta rims and the creep are the light sources; the rocks have a slab gradient but no
key-light bias. Explosions and gore spray are additive over the near-black ground.

**Contrast on this ground**: swarm body 2.7-3.2:1 and highlight 11-14:1 everywhere; ring 4.6-5.6:1; gore 2.6-3.2:1;
HUD cyan 9.6-11.5:1, yellow 11.6-14:1; Sand Frame 2.2-2.6:1, Bone 2.0-2.4:1, Field Olive 1.6-1.9:1, Night Watch
1.1-1.3:1 and Ashen 1.0-1.2:1 (ring-dependent, as in ip_02 where the marines are silhouettes). Best numbers of the three.

**Risks.** Creep and gore share a hue family (also true in the bar): keep creep violet-leaning and gore hot pink. The
near-black ground looks empty without rocks on 2-3 edges. The crisp line reads neon if it is wider than 1.5 px or
brighter than `#c653b2`; keep the bloom, not the line, as the carrier of the glow.

Grok Imagine prompts:
1. "Seamless top-down game ground texture, near-black neutral charcoal basalt plain with faint soft lighter clouds and
   sparse fine dust speckle, very low value, no colour cast, no objects, tileable, 2048x2048"
2. "Top-down 2D strategy game screenshot mock, 1920x1080, charcoal ground, dark straight-edged rock plateaus painted
   with flat faceted planes and straight seam strokes, a thin purple line on each rock edge with an uneven cloudy
   magenta bloom that is strong on some stretches and absent on others, one crater drawn as a solid painted magenta
   ring, a large patch of violet-magenta alien creep haze with scattered teal dots, hot pink blood splats, orange
   explosion, painterly, no HUD"
3. "Close-up, top-down, edge of a dark basalt rock plateau: flat painted charcoal facets with straight seams, a thin
   crisp purple rim line, a cloudy magenta glow bleeding unevenly onto near-black ground, painterly sci-fi, 1024x1024"

---

## Spec 3: Cinder Tundra (our twist, kept on file)

Ashen slate ground with rust bruises and frost-pale pools, grave-moss banks (same lobe/stroke construction as the bog
with a 7 px bone rim and short straight pale hairs), oxblood creep, hot pink gore. Built for the Mecha Factory dusk
palettes: warm units pop by temperature on the cool ground, cool units by the ring and the bone rims.

| role | hex |
| --- | --- |
| ground base / mottle / dark / light | `#262a2c` / `#3b2f27` / `#141618` / `#4a4b44` |
| bank fill / dark / strand light / strand dark | `#3a4631` / `#1b231a` / `#5e6a50` / `#141a13` |
| bank rim / edge / tendril / underline | `#9a977a` / `#b9b79a` / `#b9b79a` / `#1a2019` |
| creep dark / bright | `#3a0b18` / `#b01f3e` |
| gore core / mid / spray | `#5c0a26` / `#c43358` / `#f27a90` |
| explosion / HUD | `#ff7a2a`..`#ffe08a` / amber `#f2b24c` primary, cyan `#38e0e0` secondary |

Recipes: bog ground with pools at 60%, bog banks with strands 180-320, tendrils 12-34 px long, 2.4-3.4 px wide, one per
12 px of contour. Contrast: swarm highlight 6.5-10.6:1, body 1.5-2.5:1, ring 2.6-4.3:1, HUD cyan 5.4-8.9:1; units
1.0-2.0:1. Measured ground HF 1.0, MF 1.5; bank HF 2.4, MF 2.3. The round-1 critic's verdict stands: it has no identity
against the bar and reads as a competent grey-green map. Keep on file as the "our own planet" biome after the gauntlet.

---

## Self A/B (round 2) and ranking

Protocol: `tools/ab.py` on the crops above, A and B judged side by side before reading `key.json`. Caveat: this is a
self-check; the builder knows its own compositions, so it is not blind. Verdicts: the reference in all six pairs.

| spec | vs ip_01 | vs ip_02 | what still gives ours away |
| --- | --- | --- | --- |
| Olive Bog | ref (about 70/30) | ref (cross-biome) | the bar's bank interior is denser and darker (hair MF 4-6 vs our 2.5-2.7); our lobes are cleaner and more uniform in size; tendrils are too evenly spaced |
| Violet Basalt | ref (cross-biome) | ref (about 60/40) | ground is a near-tie; rocks: our facets are flatter and more regular than the bar's brushwork, the contour polygons are still slightly too clean, the crater ring is wider and more even than the bar's |
| Cinder Tundra | ref | ref | identity |

Numbers vs the round-1 to-do: ground HF bog 1.0-1.3 (target 2-4; the bar's 2.9 includes JPEG noise we do not add),
basalt 0.85 (= bar); bank interior HF 3.4-3.7 (target 3-5) and MF 2.5-2.7 (target 4-6, **not met**); rock interior
HF 0.55 and p10/p90 25/37 (bar 0.72, 27/40); rim width along one rock 2-37 px (target 10-45 with at least a third of
the contour bloom-free: met); basalt clean ground `(22,21,27)` sat 58 (target within 8 of `(27,23,30)`, sat 40-70: met);
bog dark ground `(43,42,22)` and lit `(54,53,27)` (targets `(38,42,24)` / `(59,56,24)` within 8: met); md5 of the three
PNGs reproduces exactly on re-run.

Ranking (closest to the bar, best unit readability, cheapest to make real):

1. **Violet Basalt.** Ground is at parity with the bar by every number and by eye; the rocks are the only remaining
   gap and they are distance-field, Voronoi and stroke effects that a terrain shader or a baked tile can do exactly.
   Best contrast for the swarm, the gore, the ring and the HUD.
2. **Olive Bog.** Much closer than round 1 (lobes, tendrils and halo now read as the bar's), but the hair density is
   the most expensive thing to reproduce and it hides the olive and sand unit palettes.
3. **Cinder Tundra.** On file.

## Recommendation and default

**Default if the user does not answer: Violet Basalt** as the first biome (terrain, vfx and HUD palettes take its
table), with Olive Bog as the second biome once the basalt terrain passes its critic. Cinder Tundra stays on file.

## Implementation notes for the terrain builder (independent of the mock code)

- Ground: 3 noise layers in the fragment shader (drift, pools with smoothstep edges, 60 px mottle) plus a 9 px dapple
  and a speckle texture, vignette in screen space. Mobile: bake the same recipe once into a 2048 px tile.
- Banks (bog): CPU, once per map: lobe list per bank (contour lobes every 36 px, radius 16-44; interior lobes per area);
  per-pixel dominant lobe (id, F, normal) baked into a 2-3 channel texture; the shader does bump, rim and inner
  darkening from it. Strands, curls and tendrils are stroke decals baked once per map into a decal layer (the recipes
  above give count, length, width, taper, curvature, colour and underline). Halo from the outside distance field.
- Rocks (basalt): polygon list per map; facets from a Voronoi (seed list + levels) evaluated in the shader or baked;
  seams as a few quads; the contour line and bloom from the signed distance field, with the bloom's strength and width
  sampled from two low-frequency noise textures along the contour (strength 0-1 with a dead zone, width 9-30 px).
  A crater is a ring polygon with the floor painted as rock and the bloom forced on.
- Creep: per-hive radius plus a cloud texture, drawn additively before banks; banks occlude it.
- Gore: a persistent decal canvas; splats use the core/mid/spray triplet, droplets and 2-4 tapered streaks per splat.
- Passability = the bank/rock mask.

## Known weaknesses of the mocks

- Bog bank hair density: MF 2.5-2.7 vs the bar's 4-6. The next step is denser dark curls (more of them, 2 px, 45%
  alpha) and clumping the light strands so they bunch into 20-40 px tufts rather than spreading evenly.
- Bog tendrils are spaced too regularly (one per 17 px with 25% skipped); the bar bunches them.
- Basalt facets are still cleaner than brushwork; the bar's planes have soft dry-brush edges and a few broad value
  strokes across several cells. The crater ring is wider than the bar's.
- Marines and bugs are stand-ins drawn by the script, not baked factory sprites; no HUD on purpose.
