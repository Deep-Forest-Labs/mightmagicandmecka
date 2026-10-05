# Handoff (paused 2026-10-05, 07:40 UTC)

All agents are stopped. The last one to finish was the game r3 builder; its r3 critic never ran, so the next game round
should start with a critic pass. mission1 loads with every system at 60 fps (state-mission1-final.png in the shots folder).

The user stopped the session for the night. Resume from here. Nothing is committed: everything under `Game/`, `tools/`,
`js/bugs.js`, `docs/WORLD-LOOK.md`, `docs/ImageRefs/InfestedPlanet`, `docs/ImageRefs/WorldLook` and `package.json` is
uncommitted work (see `git status`). Commit only when the user asks.

## Play it
```bash
node tools/serve.js 8711
```
Then open http://localhost:8711/Game/?scenario=mission1 (also `mission1-mid`, `mission1-late`, and every piece demo:
`terrain-basalt`, `terrain-bog`, `swarm-demo`, `marines-demo`, `structures-demo`, `vfx-demo`, `hud-demo`, `stress`).
Controls: click / shift-click / drag-box to select, 1-5 and Space, right-click or long-press to move, A for attack-move,
H hold, R retreat, WASD / edge / middle-drag to pan, wheel to zoom, F3 debug overlay. Progress page: http://localhost:8711/Game/progress/

## The bar (clarified by the user)
- Infested Planet Steam shots (`docs/ImageRefs/InfestedPlanet`) = **gameplay and on-screen density** bar only.
- Art bar = **polished StarCraft Remastered / Warcraft 3 quality in the Mecha Factory style** (`docs/STYLE.md`), world,
  marines and aliens alike. Never push art toward Infested Planet's look.
- World look: the user will pick from the Grok Imagine samples in `docs/ImageRefs/WorldLook/` (see `index.md` there),
  and an alien style (chunky outlined Mecha Factory pixel look vs painterly beetle). **Waiting on this pick.**

## Where every piece stands
| piece | last round | score | state |
| --- | --- | --- | --- |
| engine | r1 | 8 PASS | WebGL2 batcher, 60 fps at 12k sprites, deterministic captures, unified input |
| swarm | r2 | 7 PASS | liquid rivers, pressure front, variants, spitters/brutes/tanks, 3000+ at 60 fps |
| marines | r3 | 7 PASS | full control set (mouse + touch), overlays judged better than the bar |
| structures | r2 | 7 PASS | hives spawn/creep, capture loop with progress, bases, nodes, turrets, barricades |
| vfx | r4 | 6 (loop finished) | gore as flat outlined MF-style decals, tracers, explosions; critic still prefers ip_05 on density/scale contrast: see its r4 to-do in the log |
| game | r3 | 6 at r2 | mission loop: BP, upgrades, 5 mutations, win/lose, mission1 scenarios; r2 critic wanted more fronts/pressure in hive fights; r3 build landed before the stop (see the log for its summary) |
| hud | r2 | 7 (old framing) | full IP-layout HUD in Chakra Petch; paused for the art pick |
| terrain | r1 | pending | both biomes in-engine + passability/flow/creep API; paused for the art pick |
| bake | r5 builder | 3-6 (old framing) | marine sheets; paused for the art pick (critics had been pushing toward IP's look) |
| alien-art | r4 | 6 (old framing) | `bug` line in the factory, 6 drone variants + 4 species; paused for the art pick |
| world-look | r2 | 5 | three procedural specs; superseded by the Grok samples |

The progress log (`Game/progress/log.jsonl`) has every builder summary and critic verdict with image paths.

## Next steps, in order
1. Get the user's world-look + alien-style pick from `docs/ImageRefs/WorldLook/index.md`.
2. Write the chosen look into `docs/STYLE.md` (world section) and `Game/DESIGN.md`; retire the "faithful IP" terrain recipe.
3. Relaunch art loops with critics judging polish + style consistency (not IP likeness): terrain, bake (marines), alien-art,
   hud skin, structures art, vfx look. Use the phase-2b workflow script as the template
   (`~/.claude/projects/-Users-cloudnine-Documents-VIBE-Games-mechafactory/931317da-233f-4da0-a345-f457e60d247b/workflows/scripts/gauntlet-phase2b-*.js`).
4. Composite critic: full 1080p frame vs ip_01/ip_09 for density and "which would you rather play".
5. Engine round 2 to-do (non-blocking): unit-layer depth sort, render interpolation, action-queue ordering, `--max-cpu-ms`.

## Model policy (user)
Orchestrator and every critic: Fable 5.1, high effort. Builders: Opus 5.5. Sonnet 5.5 only for mechanical work.

## Appendix: last critic verdicts for the loops that ended without a pass

### vfx r4 (fail 6)
Rather play ip_05 in both blind pairs (t6: A=ours/B=ref, picked B; t20: A=ref/B=ours, picked A) on density and scale contrast; ours won readability both times, and t20 is close. Verified: byte-identical reruns and identical to the builder PNG; every event renders (rifle/turret dots, sniper comet, fusion blobs, medic crosses, rocket+cel fireballs+puffs+scorch, shred starburst+chips, marine X, hive ring); corpses visible at 0.6 s, gone at 21 s; pool max 728 in the demo, 4000 in bench; bench cpu 0.9/1.26/1.44 ms at load 7-12; stress and all-systems exit 0; bake 101 ms; particle floor 122 (t=11.4, builder said 127), tracers >=2. Red mask on 900x600 crop: lum p5/p50/p95 39/63/148 vs ip05 30/61/150 (match), hot 18% vs 7% (too much flat pink), blood coverage 20% at t6 and 27% at t20 vs ip05 46% (builder said 30%). BIGGEST GAP: the lanes are paved with same-size large pools. stats at t20: large 129, med 54, small 97, dark 505, hugeDemoted 25 of 39 rolls (64%): mediums demote to small, smalls to dark, large never demotes, so what survives is a tiling of 135-200 px pools each with the same pale-pink upper-left echo and lower-right dark core; no single dominant 300 px pool per lane and half the blood area of ip05. OTHER GAPS: smoke puffs are opaque 3-step grey boulders (the t6 plume reads as a rock formation, a readability bug); live FX in the judged crop is one fusion fire + 2 tracers (ip05 has two fireballs, mist and streaks); fringe droplets are all round dots, no directional streaks; the lit echo on every pool is hot-pink at full alpha (hot pixels 12-18%). Style: flat, crisp, 1 px outlines, consistent with STYLE.md; not muddy. Note: game.js and scenarios.js have mtimes after vfx.js (02:10 vs 02:02), presumably the game builder; Game/ is untracked so git cannot confirm.

### game r2 (fail 6)
Rather play theirs in 2 of 3 blind pairs (mid vs ip_09: theirs, more fronts and pressure; play frame vs ip_09: theirs; late vs ip_01: a tie, ours has two converging streams but the squad is buried under explosions). Big step up from r1: the loop now works end to end through the real input path (Space, attack-move button, right-click): hive 0 taken at 43 s with 0 dead, build via the HUD build button + node tap (9->6 BP), research preview/confirm via the HUD (rifle->sniper, 6->3 BP), Armored at 90 s (maxHp 8.9->19.3, rail 1, alert), hive 2 at 134 s, regroup button works, win/lose/dialogue/determinism all pass, bases hold (0 turrets floors at 180 hp, 1-2 turrets stay 1200, Regrowth re-infests an unguarded base at 140 s). BIGGEST GAP: density in play. Across 729 push-seconds of attack-move autopilot on seeds 1-3 the on-screen count is median 66-82, p90 208-241, and >=300 only 2.2% of the time; the hive fight itself (fight25 shot: CAPTURING 13% with ~20 bugs on screen) is a 30 s stand on an empty screen. Cause (probe.json): the assault reserve (700) is debited at the nominal rate (108/s with surge) while structures actually hatches 50-66/s, so a hive's wave is a 7 s puff; worse, any hive within 600 px of any marine spends its reserve even while the squad is capturing a neighbour (hive 2 sat at reserve 0 with rate 7.8 when attacked at t=67 because it drained while the squad stood on hive 0, 604 px away), and the refill is 4/s. Second: fps 52.6-56.7 on mid/late at 610-662 aliens (below 55 in 2 of 5 runs; 60 with --systems minus hud; 60 at 262 aliens in a real fight) - the HUD 183 ms hiccup, logged to hud, is still the number the capture tool prints. Third: attack-move autopilot ends 300 s at 3/7 with 1-3 marines dead (seed 2 wiped at 294 s) and no base lost; pace is fine but the squad bleeds out from 240 s with Armored+Fast+Spitters and no upgrades bought. Minor: late frame hides 2 of 5 rings under explosions; start frame is a single stream in a lot of black; blood decals in long sessions dominate the frame (auto240).

### hud r1 (fail 7)
FAIL 7/10. Chrome is a near-tie: blind crops top bar (vs ip_01), bottom-left = ours or tie (crisper, same geometry); right rail and bottom-right = tie leaning bar (bar's icons 20-35% bigger and bolder); dialogue (vs ip_02) = bar, clearly: our portrait is a flat corporate-avatar placeholder against a painted commander, panel fill lighter (#101e32 vs #081b29), frame dark blue instead of the bar's light steel #7c7485, text 500 weight vs the bar's bold. Overall I'd call it a tie and the rule is every crop near-tie, so fail. Verified: Chakra Petch 400/500/600/700 loaded (document.fonts.check true); mouse click AND touch tap toggle attack-move/build/research/special, select cards (dead card ignored), select-all, regroup stamp, mutation panel; right-click on a HUD button issues no order, right-click and touch longpress on the world still order; tap dismisses dialogue; MEDIC DOWN alert on death; byte-identical captures; 60 fps 0.39 ms; stress exits 0; IP.errors empty. Other gaps: HP bar 11 px (bar 14 px, y 26-39, 4 px stripe pitch, remainder olive #496b36), weapon silhouettes ~20% small, 1 px outline on unselected cards that the bar (ip_09) lacks, dead card fill should be lighter #132031 with grey #72778d, selected frame 7 px #05f8fe fill #072e40, top-left band should end at x~415 with a 20 px gap before the first card, BP digits too heavy, corner masses opaque (bar ~88% alpha), gate object shares the name 'hud' in world.systems.

### bake r4 (fail 6)
FAIL 6/10 (r3 3/10). Split decision in my own blind A/Bs: ip_01 I picked OURS (A): five crisp, role-readable soldiers on separate rings vs the bar's soft purple blobs; ip_05 I picked THEIRS (B): the bar's marines are one sleek family of angular purple chevrons with neon cyan edge lines and long dark rifles pointing where they aim, ours are five differently shaped boxes (rifle_b is a 46 px wide crate with pauldrons, 1091 opaque px vs the medic's 828/38 px) with plain grey rod guns. Pass needs ours/tie on both. BIGGEST GAP: silhouette. Square torso + square pauldrons + short rod gun reads as a crate, not a wedge; no leading-edge cyan lines; five units differ in bulk by 35%. Mechanically the bake is sound: rerun byte-identical, all clipped=false, cell=64 fusion refused, stats verified (vMedian 0.45-0.48, vAbove0.8 0-0.12, sat 0.53-0.69, capFrac 0.07-0.13, bodyS 38-40), 8 facings consistent, legs alternate in S/N/E, guns along the facing on rifles/fusion (barrelErr <=8). Sniper is the weak sheet: pose inconsistent across facings (idle aspect 1.14-1.9), barrel 12-16 deg off, cyan cap at vAbove0.8=0.12. Ownership: bake builder edited js/humans.js (factory code, not in bake's list); the change is a guarded opt-in (stride:'topdown'), stride-proof PNGs are byte-identical and the diff only branches on the flag, but it still needs the orchestrator's blessing or a monkeypatch inside bake.js. index.html/.gitignore diffs predate this round (alien-art/orchestrator). Marines-demo and stress captures exit 0 with the new sheets.

### alien-art r3 (fail 6)
Would rather fight the bar (called B before the key; B=ref). Real progress: body hue/sat/value now match ip_01 (body mean 32,75,94 vs 36,75,87), bright share 11.3 vs 11.5 pct, sheets mechanically clean (8x13, nothing clipped, buildSheet bake md5 matches shipped, lunge reads). Biggest gap: every bug is identical, so the mass reads as a tiled carpet of navy pebbles with one pinpoint star each, not an organic swarm. Measured: body saturation std 0.09 vs ref 0.15; bright-blob median 14 px vs ref 5 px (ref mixes many 1-3 px pale-cyan specks with fewer soft 10-20 px green clusters; ours is one fixed 5x5 star per bug); highlight colour too green (104,157,123 vs ref 98,142,132); ground visible 0.7 pct vs 6.2 pct in the densest crop. Second: the shell is a flat silhouette with no internal form, 1 px leg nubs vanish at 1:1, so no bug reads as a creature. Third: walk cycle is near-static (only 1 px leg nubs change, 1 px bob). Fourth: hangar still shows the raw lit model, not the shipped finish.
