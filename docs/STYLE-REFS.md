# Art direction log

This is the running record of the art director's feedback. It will become `docs/STYLE.md` once a direction is locked.

## Round 1: modular mechs
- Liked: chunky pixel mechs close to the original comps (penusbmic-style pixel mecha, a rust-red spider tank, a white mech with a cannon, a teal/red walker next to a pilot).
- Too generic. Wants more stylized, unique silhouettes.

## Round 2: SD / chibi
- Liked: strong silhouettes, exaggerated shoulder pads, helmets and weapons (micro Warhammer, WoW, Gundam).
- Reference: a pixel goblin sheet in 64 px cells (≈40–55 px tall characters).
- Result: **too chibi / too cute.** It needs to be darker, more fantasy, realistic and stylized.

## Round 3: Style Lab (A grim heroic, B dark stylized, C gritty realistic)
- Everything felt **hunched over**, especially B. The characters and the barbarian lean down.
- **Mech heads too big** (in A and B); in B the mech was tilted over, as if leaning down.
- Idles must be **relaxed and natural**. For example, the barbarian's sword over the shoulder (as in the SD version) or on his back, with his arms not bent.
- There must be **space between the legs**: a real pose, less blocky.
- The barbarian was too "typical RPG" (skin, leather, horned helmet). He should be a **Diablo-esque / new-age barbarian with really cool armour**.

Response:
- All styles are upright.
- Relaxed idles: the greatsword rests over the shoulder; daggers are held low; guns are carried low.
- Wider stance with tapered limbs and contrapposto.
- An armoured barbarian with a crested war helm.
- Mechs get "heroic" proportions: smaller level heads and upright.

## Mech references (two-legged), round 3
1. Faceted sand/white mech: low-poly wedge armour, a huge sloped chest carapace with the head hidden under a brow plate, massive thighs tapering to thin shins, long spurred feet, side skirts, a forearm blade, and grille detail on the thighs.
2. Frame Arms, tan: bulky; a shield built from stacked rectangular plates; a cannon with missile tubes; a tall curved antenna fin; no visible head; white stripes; a bent-knee stance; orange toe caps.
3. Navy "anchor" mech: a massive chest with an emblem, a tiny head sunk between huge shoulders, a striped backpack container, an oversized gun, segmented thighs, black joints and stencil text.
4. Pink pirate mech: a tricorn-hat helm with a skull, a tabard banner, a torn cape, a giant tower shield with a skull, a sabre, long legs with spiked gold sabatons, and gold trim.
5. Military sheet: small sensor heads set low, stacked plates, missile-box and shield backpacks, rifles, orange accent marks, stencils, and olive/cream/grey camo.

Common rules drawn from these:
- A tiny, recessed head.
- Faceted armour.
- A big upper chest with a narrow waist.
- Massive thighs over slim shins.
- A wide, powerful stance.
- Asymmetric loadouts.
- Hazard stripes, stencils and emblems.
- Military palettes, plus costume-driven "character" mechs (the corsair).

This is implemented as the SD line's `sdStyle: 'frame'` ("Military frame").
