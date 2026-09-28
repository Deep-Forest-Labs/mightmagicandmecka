# Style sheet (draft, round 4)

This records the direction the art director picked in the Style Lab. It's a draft until they sign off. The history and the reference descriptions are in `STYLE-REFS.md`.

## Humans: "Dark heroic" (A grim heroic × B dark stylized)

Implemented as `style: 'blend'` in `js/humans.js`. It's the default for new human units.

| Rule | Spec |
| --- | --- |
| Proportions | ≈4.5 heads tall. Oversized hands, forearms and shoulders; a V-taper (big chest, narrow waist); chunky weapons. |
| Height at size 1 | Rogue ≈47 px, soldier ≈50 px, berserker ≈57 px. It fits a 64 px cell at rest. The berserker's overhead windup needs a 96 px cell for attack frames. |
| Posture | Upright and confident. The spine is vertical and the head level. There's no hunch or forward lean. |
| Idle | Relaxed and natural: daggers low in a reverse grip, guns carried low across the body, and the greatsword resting over the shoulder with the free arm hanging loose. Weapons come up only to attack. Breathing is subtle. |
| Legs | Two clearly separate legs from the front and ¾ views. Hip joints are wider than the belt, and the feet land about 1.6× the hip width apart. The stance is staggered (left foot forward). The inner thighs are slim, and no plates or cloth fill the gap. |
| Shapes | Angular, chamfered armour. Rounded bevels only on fur, cloth and muscle, never on armour or heads. |
| Faces | Hidden or shadowed: hoods with dark faces, T-slit and eye-slit helms. Eyes are at most 1 px. Sci-fi lenses glow only as thin slits. |
| Gear | Diablo-style armour rather than "RPG skin and leather". The barbarian wears dark plate, bladed pauldrons and a crested war helm with no animal horns. Skin shows only on the upper arms at most. |
| Palette | Low value, low saturation, one accent colour: Night Watch, Iron Pilgrim, Ashen, Oxblood, Grave Moss, Bone & Rust. |
| Lighting | The `dusk` look: low key, deep shadows and a cool rim light on the back edges. |

## Mechs: "Military frame"

Implemented as `sdStyle: 'frame'` in `js/sdmechs.js` (the "Mech frame" line). It's the default for new mechs.

| Rule | Spec |
| --- | --- |
| Head | Tiny (≈1/10 of the height) and recessed: under a chest hood or sunk between the shoulders. Only a visor slit or mono-eye shows. |
| Body | A big faceted upper chest over a narrow mechanical waist, with side skirts. |
| Legs | Massive thighs (the widest part of the body) tapering to slim shins, with knee guards. Long feet with a toe cap and rear spur. Knees slightly bent, a wide stance and a clear leg gap. |
| Surfaces | Faceted, low-poly wedge armour. Hazard stripes, stencil numbers, emblem plates and small orange marks. |
| Loadouts | Asymmetric: stacked-plate or tower shields, arm cannons, rifles, missile boxes, containers and antenna fins. |
| Idle | Weapons lowered, raised on attack. Upright, with the chest slightly forward and the head never drooping. |
| Height at size 1 | ≈85–100 px. Use 128 px cells. |
| Palette | Sand Frame, Field Olive, Navy Anchor, Bone White and Titans Navy for military units. Costume mechs like the Corsair get vivid signature colours. |

## Still open
- Sign-off on the blend and the frame direction, then roll the rules out to the remaining human roles (sniper, knight, heavy) and all mech archetypes.
- Whether the modular line gets retired or restyled to the frame rules.
