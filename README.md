# Mecha Factory

A browser tool for generating pixel-art mechs and walking them around a hangar with WASD.

Open `index.html` in a browser. There's no build step and nothing to install. It runs from `file://`.

## How it works

Mechs are built from chunky 3D primitives: boxes with chamfered edges, octagonal cylinders and cones. They're ray-cast into a low-resolution buffer and shaded like hand-made pixel art:

- **5-step colour ramps with hue shifting.** Shadows lean blue/violet and lights lean warm.
- **Quantised lighting.** Top faces are light, fronts are mid-tone and far sides are dark.
- **Rim highlights** on edges that border a brighter face.
- **1px outlines** around the silhouette, and darker lines where parts overlap.
- **Shadow-map shadows** on the floor and between parts.
- **Procedural decals**: panel seams, vents, missile-pod holes, eye slits, lights, hazard bands, bolts, tread links and hull numbers.

Because the model is 3D underneath, every mech gets all 8 directions (and every walk frame) for free. That's what makes WASD movement and sprite-sheet export possible.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Walk the selected units (8 directions) |
| `Space` | Attack: fire, slash or swing |
| `Shift` | Run |
| `Tab`, `1`–`9`, click | Select a unit |
| Shift-click, `G` | Add to the group, or select all |
| `R` / `M` / `N` | Randomize, mutate, or deploy a copy of the active mech |
| `L` | Line every unit up facing the camera |
| `P` | Save a snapshot of the hangar |
| `Del` | Scrap the selected units |
| `Ctrl+Z` | Undo |

On touch screens, drag anywhere on the hangar to steer and tap a mech to select it.

## Product lines

Pick a line at the top of the Parts panel. Each line has its own part slots.

- **Heroic frame (SD):** super-deformed, Gundam-inspired mechs. There are seven archetypes: hero, commander, heavy, knight, sniper, brawler and ace. Each has its own head, backpack, and separate weapon slots for the right hand, left hand, right back and left back. Weapons include beam rifles, machine guns, bazookas, rocket launchers, missile and homing-missile pods, shoulder cannons, beam sabers, heat axes, katanas, lances, knuckles and shields.
- **Human:** heroic SD infantry about 3 heads tall, for 64 px sprite cells. The roles are rogue, soldier, berserker, sniper, knight and heavy flamer trooper. The era can be high fantasy or grimdark sci-fi, and it swaps each role's gear. Head, shoulders, right and left hand weapons, and extras (scarf, cape, backpack, banner) are separate slots.
- **Modular frame:** the original mechs. Chassis (biped, reverse-joint, quadruped, spider, crawler, treads, hover), torso, head, arms, shoulders and backpack.

Changing the role or archetype re-dresses the unit to match, but locked slots stay as they are.

## Factory panel

- **Parts:** the dice button rerolls one slot. The lock keeps a slot through Randomize, Mutate and the production line.
- **Proportions:** bulk, legs, torso, arms, overall scale and bevel softness.
- **Paint:** palettes for each group, plus shuffle and colour pickers. Humans add skin, hair, leather and a third cloth colour. Ramps are generated from each base colour.
- **Production line:** a batch of ten random units that respects your locks, filterable to All, Mechs or Humans. Click one to load it into the active unit. Shift-click to deploy it as a new unit.
- **Sprite sheet:** 8 rows (S, SE, E, NE, N, NW, W, SW). The columns are idle, the walk loop, then the attack. Choose a tight crop or fixed 64/96/128 px game cells, where the feet sit at the same anchor in every frame. It exports a transparent PNG at 1–4×, plus JSON with the animation ranges and the blueprint.
- **Blueprint code:** a copy/paste string that rebuilds a unit exactly.

`docs/ARCHITECTURE.md` explains how this feeds the game: baked sprites for 50+ units on screen, and Armored Core-style loadouts.

## Files

- `js/core.js`: RNG, transforms, palettes and ramps, convex primitives, and the rig nodes
- `js/render.js`: the pixel renderer (raster, shadow map, shading, decals, outlines)
- `js/mechgen.js`: blueprints, the product-line registry, and the modular mech parts, rigs and walk cycles
- `js/sdmechs.js`: the Heroic frame (SD) line and its shared weapon table (`MF.Gen.sdWeapons`)
- `js/humans.js`: the Human line: roles, IK arms and its weapon table (`MF.Gen.humanWeapons`)
- `js/app.js`: the hangar, input, editor, production line and export
- `tools/build.js`: bundles everything into one file (`dist/mecha-factory.html`)
- `tools/preview.html`: a dev view that renders blueprints from every direction (`?seeds=1,2&dirs=8&walk=1.57`)
