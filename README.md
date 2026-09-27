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
| `W` `A` `S` `D` / arrows | Walk the selected mechs (8 directions) |
| `Shift` | Run |
| `Tab`, `1`–`9`, click | Select a unit |
| Shift-click, `G` | Add to the group, or select all |
| `R` / `M` / `N` | Randomize, mutate, or deploy a copy of the active mech |
| `L` | Line every unit up facing the camera |
| `P` | Save a snapshot of the hangar |
| `Del` | Scrap the selected units |
| `Ctrl+Z` | Undo |

On touch screens, drag anywhere on the hangar to steer and tap a mech to select it.

## Factory panel

- **Parts:** chassis (biped, reverse-joint, quad spider, hex crawler, treads, hover and more), torso, head, each arm, shoulders, backpack, and how the paint splits. The dice button rerolls one slot. The lock keeps a slot through Randomize, Mutate and the production line.
- **Proportions:** bulk, leg length, torso height, arm length and bevel softness.
- **Paint:** ten presets based on the reference art (Rust Crab, Snowcat, Jade Sentinel…). You can also shuffle, or pick base colours yourself. Ramps are generated from each base colour.
- **Production line:** a batch of ten random mechs that respects your locks. Click one to load it into the active unit. Shift-click to deploy it as a new unit.
- **Sprite sheet:** 8 rows (S, SE, E, NE, N, NW, W, SW) × idle + 4–12 walk frames. Exports a transparent PNG at 1–4× with an optional drop shadow, plus JSON metadata (cell size, feet anchor, and the blueprint).
- **Blueprint code:** a copy/paste string that rebuilds a mech exactly.

## Files

- `js/core.js`: RNG, transforms, palettes and ramps, convex primitives, and the rig nodes
- `js/render.js`: the pixel renderer (raster, shadow map, shading, decals, outlines)
- `js/mechgen.js`: blueprints, the part library, locomotion rigs and walk cycles
- `js/app.js`: the hangar, input, editor, production line and export
- `tools/build.js`: bundles everything into one file (`dist/mecha-factory.html`)
- `tools/preview.html`: a dev view that renders blueprints from every direction (`?seeds=1,2&dirs=8&walk=1.57`)
