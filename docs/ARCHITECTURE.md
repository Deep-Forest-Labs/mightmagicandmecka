# Architecture and roadmap

Mecha Factory is the **art pipeline** for a future RTS / party dungeon-crawler: StarCraft II / Total Annihilation-style control, Armored Core-style loadouts, and mobile, Steam and Xbox targets. This note records the decisions that keep the factory reusable for that game.

## 1. Author in 3D, ship baked sprites

The factory renders units live: convex primitives are ray-cast into pixel art. That's ideal for designing, but it's too expensive to run per unit in a game with 50+ units on screen, especially on mobile.

So the game never runs this renderer. It plays **baked sprite sheets**:

- The sprite-sheet export produces 8 direction rows, with columns for `idle`, the `walk` loop and `attack`. Choose between a tight crop and **fixed 64 / 96 / 128 px cells**, where the feet sit at the same anchor in every frame.
- The JSON beside each sheet lists the cell size, the feet anchor, animation ranges (`from`, `count`, `loop`), and the full blueprint, so a unit can always be re-baked.
- Target cells: humans 64 px (≈36–42 px tall, heavies ≈52 px). Mechs use 96–128 px.

Still to do on the pipeline:
- Batch-bake a whole roster into texture atlases.
- Death and hit animations.
- Palette-swap and team-colour masks, so each blueprint only needs baking once per team.
- Optional 16 directions for large units.

## 2. Blueprints are the source of truth

A unit is a small JSON **blueprint**: product line, part slots, proportions, size and paint. Building from a blueprint is deterministic, so a blueprint (or its `MF1.` share code) always rebuilds the same unit. The game can store blueprints and bake them at build time.

## 3. Product lines

`MF.Gen.registerLine(id, def)` adds a family of units. Each line defines:

- its own part slots (the UI builds dropdowns from them)
- random rules that respect locks
- a builder that assembles the rig and pushes animators
- palettes, a size range and a naming scheme

Current lines:

| Line | File | What it is |
| --- | --- | --- |
| `modular` | `js/mechgen.js` | The original mechs: 7 chassis types, and interchangeable torso, head, arm, shoulder and back parts |
| `sd` | `js/sdmechs.js` | "Heroic frame": super-deformed, Gundam-inspired archetypes |
| `human` | `js/humans.js` | Heroic super-deformed infantry (rogue, soldier, berserker…), in fantasy or sci-fi gear |

## 4. Loadouts (Armored Core direction)

Players will customise units by swapping weapons and parts. The groundwork:

- **Hardpoints.** Every chassis exposes named mount nodes: right arm, left arm, right back, left back, plus shoulders. Weapons attach to mounts, not to a specific chassis.
- **Weapon library.** Each weapon is a self-contained builder, `build(ctx, mountNode, side)`, that owns its muzzle flash and its attack animation (keyed off `st.fire`). Weapons live in shared tables (`MF.Gen.sdWeapons`, `MF.Gen.humanWeapons`), so any line can mount them.
  - Weapon families: guns, cannons, rocket launchers, heat-seeking and homing missile pods, plasma swords and beam sabers, shields, flamers, drills.
- **Frames.** The Armored Core parts map onto the modular slots: head, core (torso), arms, legs (biped, reverse-joint, tetrapod/quadruped, treads, hover), and a back booster or generator.

Next steps:
- Merge the per-line weapon tables into one registry, with tags for mount size and hand/back.
- Add per-part stats (weight, energy, armour) alongside the art.
- A loadout editor that validates slot compatibility.

## 5. Animation contract

Animators receive `st = { phase, move, t, fire, fireN }`:

- `phase`: the walk phase in radians. It advances with the distance walked, using the rig's `stride`.
- `move`: the 0..1 walk blend.
- `t`: time in seconds.
- `fire`: jumps to 1 on attack and decays at the rig's `fireDecay` per second.
- `fireN`: counts attacks, so weapons can alternate hands.

New animations (death, hit, special) should follow the same pattern: a state value that the export can sample into frames.
