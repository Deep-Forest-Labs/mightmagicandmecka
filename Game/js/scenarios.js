// Infested Planet Gauntlet: mission scenarios (owner: game piece). Plain script, loaded last.
//   mission1       the mission from the start: landing zone top-left of the squad, hive 0 already pouring a stream at it
//                  from the north-east and a second, smaller one coming in from hive 2 in the east; seven hives on an
//                  authored basalt map (seed-stable); the commander's line comes in at t=2 for 5 s
//   mission1-mid   the same map ~3.5 min in: hives 0 and 2 captured with turrets, two mutations, the squad pushing east on
//                  hive 5 with a second stream coming down from hive 3 round the rock (scripted warm-up: the fight is
//                  already running at t=0)
//   mission1-late  ~9 min in: five of seven hives captured, every mutation, a rocket swap, the worn squad assaulting the
//                  deep nest (hive 6) while hive 5's stream climbs at it from the south and base 3 holds on the left
// IP.defaultScenario becomes 'mission1' so http://localhost:8711/Game/ opens on the game.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP || !IP.game) return;

  const SYSTEMS = ['terrain', 'swarm', 'marines', 'structures', 'vfx', 'hud', 'game'];
  const CALM = ['drone', 'drone', 'drone', 'runner'];

  // The map: 4000 x 2800, terrain authored (not random) so streams route round rock: lanes, two-front approaches.
  // Index = hive number in the plans below. The camera opens with the landing zone top-left of the squad (clear of the
  // commander's portrait) and hive 0 pouring a stream at it from the upper right.
  const MAP = {
    biome: 'basalt', w: 4000, h: 2800,
    base: { x: 560, y: 2280 },
    squad: { x: 1000, y: 2330, dir: -0.47 },
    camera: { x: 1240, y: 2260, zoom: 1 },
    hives: [
      { x: 1650, y: 2000, hp: 2200, creep: 280 },  // 0 the nest next to the landing zone
      { x: 560, y: 1000, hp: 2600 },               // 1 north-west
      { x: 2250, y: 2300, hp: 2600 },              // 2 south lowlands
      { x: 2250, y: 1000, hp: 3000 },              // 3 the centre
      { x: 1180, y: 380, hp: 3000 },               // 4 far north
      { x: 3080, y: 1820, hp: 3400 },              // 5 east
      { x: 3380, y: 640, hp: 3800, creep: 360 },   // 6 the deep nest
    ],
    terrain: {
      masses: [
        { x: 2720, y: 1480, rx: 284, ry: 142, rot: 0.35 },
        { x: 3170, y: 1170, rx: 256, ry: 155, rot: -0.5 },
        { x: 1480, y: 1200, rx: 236, ry: 202, rot: 0.2 },
        { x: 1180, y: 1830, rx: 223, ry: 128, rot: -0.3 },
        { x: 2640, y: 660, rx: 364, ry: 162, rot: 1.35 },
        { x: 3800, y: 1720, rx: 513, ry: 256, rot: 0.95 },
        { x: 620, y: 1560, rx: 284, ry: 155, rot: 0.15 },
        { x: 1850, y: 2600, rx: 270, ry: 122, rot: 0.1 },
        { x: 3600, y: 2470, rx: 351, ry: 189, rot: -0.2 },
        { x: 650, y: 300, rx: 310, ry: 189, rot: 0.4 },
        { x: 1950, y: 330, rx: 284, ry: 135, rot: -0.15 },
        { x: 3760, y: 260, rx: 256, ry: 162, rot: 0.6 },
        { x: 2900, y: 2260, rx: 120, ry: 110, kind: 'crater' },
        { x: 1900, y: 1560, rx: 120, ry: 105, kind: 'crater' },
      ],
    },
    // the opening stream: hive 0 is already pouring out toward the squad when the mission starts
    // and a second, smaller stream is already on its way from hive 2 (east, along the lowlands) toward the landing zone
    prefill: [{ from: 0, n: 200, lat: 45, u0: 0.05, reach: 0.55 }, { from: 2, n: 70, lat: 40, u0: 0.04, reach: 0.4, to: { x: 640, y: 2330 } }],
  };

  const mission = (plan) => (world, o) => {
    IP.game.setupMission(world, Object.assign({}, MAP, { difficulty: (o && o.difficulty) || 'normal' }));
    if (plan) IP.game.applyPlan(world, plan);
  };

  IP.scenario('mission1', mission(null), { systems: SYSTEMS, seed: 1 });

  // ~3.5 minutes in. Hives 0 and 2 are ours (turrets on both), two mutations. The squad is pushing east on hive 5 from
  // the lowlands: hive 5 pours a stream straight at it, hive 3's stream comes down round the north side of the rock,
  // and a third stream breaks on base 2's turrets bottom-left.
  IP.scenario('mission1-mid', mission({
    t0: 205, captured: [0, 2], turrets: [[0, 1], [2, 0], [2, 1]], mutations: 2, bp: 5, capturedAgo: 60,
    squad: { x: 2540, y: 1840, attack: 5, hp: [0.85, 0.7, 0.9, 0.55, 0.8] },
    prefill: [{ from: 5, n: 300, lat: 70, u0: 0.08, reach: 0.6 }, { from: 3, n: 230, lat: 55, u0: 0.1, reach: 0.5 },
      { from: 5, n: 150, lat: 45, u0: 0.5, reach: 0.22, to: { x: 2250, y: 2190 } }],
    warm: 2, immortal: true, follow: { dx: 40, dy: 70 },
  }), { systems: SYSTEMS, seed: 1 });

  // ~9 minutes in. Five hives captured, all five mutations; rifle_a was re-armed with rockets, the squad is worn down.
  // The squad assaults the deep nest (hive 6) from the south-west: hive 6 pours down from the upper right, hive 5's
  // stream climbs round the east rock from below, and base 3 (left) holds with its turrets.
  IP.scenario('mission1-late', mission({
    t0: 545, captured: [0, 1, 2, 3, 4], turrets: [[0, 1], [1, 3], [2, 1], [3, 2], [3, 3], [4, 2]], mutations: 5, bp: 7, capturedAgo: 50,
    squad: { x: 2755, y: 965, attack: 6, hp: [0.6, 0.75, 0.8, 0.35, 0.5], swaps: [[1, 'rocket']] },
    // (the streams' heads are still ~150 px out and carry no spitters, so the squad's five rings read through the fight)
    prefill: [{ from: 6, n: 300, lat: 75, u0: 0.1, reach: 0.5, brutes: 3, kinds: CALM }, { from: 5, n: 230, lat: 60, u0: 0.15, reach: 0.5, brutes: 2, kinds: CALM },
      { from: 6, n: 70, lat: 45, u0: 0.4, reach: 0.35, to: { x: 2300, y: 950 } }],
    warm: 2, immortal: true, follow: { dx: 40, dy: -40 },
  }), { systems: SYSTEMS, seed: 1 });

  IP.defaultScenario = 'mission1';
  IP.game.MAP = MAP;
})();
