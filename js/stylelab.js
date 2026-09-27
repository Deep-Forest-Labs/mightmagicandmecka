// Mecha Factory: Style Lab. Candidate art directions rendered live, side by side, from the real generator.
(function () {
  const MF = window.MF, G = MF.Gen, TAU = Math.PI * 2;

  const human = (role, style, fixed, palette) => ({ line: 'human', fixed: Object.assign({ role, style, era: 'fantasy' }, fixed), palette });
  const STYLES = [
    {
      id: 'grim', letter: 'A', name: 'Grim heroic', refs: 'Warhammer Fantasy · Diablo II', look: 'dusk',
      stage: { bg: '#1d1b20', floor: '#29262c' },
      rules: [
        '<b>~5 heads tall.</b> Realistic bodies with exaggerated pauldrons, helms and weapons.',
        '<b>Angular armour</b>: hard chamfers, no rounded shapes.',
        '<b>Faces hidden</b> under hoods, T-visors and eye slits.',
        '<b>Desaturated</b> iron, bone and oxblood, one accent per unit.',
      ],
      units: [
        human('rogue', 'grim', { head: 'hood', extra: 'cape', weaponR: 'dagger', weaponL: 'dagger' }, 'Night Watch'),
        human('soldier', 'grim', { era: 'scifi', head: 'helm', shoulders: 'pauldrons', weaponR: 'mg' }, 'Ashen'),
        human('berserker', 'grim', { weaponR: 'greatsword' }, 'Oxblood'),
      ],
      mech: { line: 'sd', fixed: { sdType: 'knight', sdStyle: 'heroic' }, palette: 'Black Knight' },
    },
    {
      id: 'dark', letter: 'B', name: 'Dark stylized', refs: 'World of Warcraft · Darkest Dungeon', look: 'dusk',
      stage: { bg: '#1c1a22', floor: '#27242e' },
      rules: [
        '<b>~4 heads tall.</b> Oversized hands, forearms, shoulders and weapons.',
        '<b>V-taper</b>: big chest, narrow waist, upright and confident.',
        '<b>Heavy brows</b>, small eyes in shadow, and slit lenses for sci-fi.',
        '<b>Muted base</b> with one saturated accent colour.',
      ],
      units: [
        human('rogue', 'dark', { head: 'hood', extra: 'cape', weaponR: 'dagger', weaponL: 'dagger' }, 'Night Watch'),
        human('soldier', 'dark', { era: 'scifi', head: 'helm', shoulders: 'pauldrons', weaponR: 'mg' }, 'Ashen'),
        human('berserker', 'dark', { weaponR: 'greatsword' }, 'Oxblood'),
      ],
      mech: { line: 'sd', fixed: { sdType: 'commander', sdStyle: 'heroic' }, palette: 'Ghost Camo' },
    },
    {
      id: 'real', letter: 'C', name: 'Gritty realistic', refs: 'Blasphemous · Kingdom Come · Diablo I', look: 'dusk',
      stage: { bg: '#1e1c1a', floor: '#2a2724' },
      rules: [
        '<b>~6 heads tall.</b> Lean, grounded anatomy with natural shoulders.',
        '<b>Real-sized weapons</b>: a greatsword about shoulder height.',
        '<b>Gear detail</b>: straps, belts, pouches and scabbards.',
        '<b>Earthy, muted</b> palettes, small heads, minimal faces.',
      ],
      units: [
        human('rogue', 'real', { head: 'hood', extra: 'cape', weaponR: 'dagger', weaponL: 'dagger' }, 'Night Watch'),
        human('soldier', 'real', { era: 'scifi', head: 'helm', shoulders: 'pauldrons', weaponR: 'mg' }, 'Ashen'),
        human('berserker', 'real', { weaponR: 'greatsword' }, 'Oxblood'),
      ],
      mech: { line: 'sd', fixed: { sdType: 'hero', sdStyle: 'heroic' }, palette: 'Titans Navy' },
    },
    {
      id: 'sd', letter: 'Current', name: 'Heroic SD (for comparison)', refs: 'what you saw last round', look: 'bright', current: true,
      stage: { bg: '#5b5b63', floor: '#4f4f57' },
      rules: ['<b>~3 heads tall</b>, round shapes and bright eyes. Too cute, per your feedback.'],
      units: [
        human('rogue', 'sd', { head: 'hood', weaponR: 'dagger', weaponL: 'dagger' }, 'Night Blade'),
        human('soldier', 'sd', { era: 'scifi', head: 'helm', shoulders: 'pauldrons', weaponR: 'mg' }, 'Ultramarine'),
        human('berserker', 'sd', { head: 'horned', shoulders: 'fur', weaponR: 'greatsword' }, 'Blood Oath'),
      ],
      mech: { line: 'sd', fixed: { sdType: 'hero' }, palette: 'Tricolor' },
    },
  ];

  function makeBp(seed, spec) {
    const def = G.LINES[spec.line];
    const prev = Object.assign({ line: spec.line }, spec.fixed);
    const locks = { line: 1 };
    for (const k in spec.fixed) locks[k] = 1;
    if (MF.PALETTES[spec.palette]) { prev.palette = spec.palette; prev.colors = { ...MF.PALETTES[spec.palette] }; locks.palette = 1; }
    const bp = G.randomBlueprint(seed, locks, prev, { line: spec.line });
    // drop slot values the line doesn't define (keeps old builds working if a slot is missing)
    if (def && def.slots) for (const s of def.slots) if (bp[s.key] == null) delete bp[s.key];
    bp.colors = Object.assign({ tertiary: '#b8323c', skin: '#d99a6c', hair: '#3b2a26', leather: '#6e4a33' }, bp.colors);
    return bp;
  }

  function makeUnit(spec, seed) {
    const bp = makeBp(seed, spec);
    const rig = G.build(bp);
    return { bp, rig, pal: MF.buildPalette(bp.colors), fire: 0, fireN: 0 };
  }

  const W = 320, H = 150;
  const rows = [];
  const host = document.getElementById('rows');

  STYLES.forEach((st, si) => {
    const units = st.units.map((u, i) => makeUnit(u, 11 + i * 7 + si)).concat([makeUnit(st.mech, 5 + si)]);
    // lay the units out left to right by footprint
    let total = 0;
    const widths = units.map((u) => Math.max(20, u.rig.radius * 1.35) + 6);
    for (const w of widths) total += w;
    let x = -total / 2;
    units.forEach((u, i) => { u.x = x + widths[i] / 2; x += widths[i]; });
    const stagePal = MF.buildPalette(Object.assign({}, MF.PALETTES['Snowcat'], { bg: st.stage.bg, floor: st.stage.floor }));

    const row = document.createElement('section');
    row.className = 'row' + (st.current ? ' is-current' : '');
    row.setAttribute('aria-label', `${st.letter}: ${st.name}`);
    row.innerHTML = `
      <div class="row-text">
        <div class="row-letter">${st.letter}</div>
        <h2 class="row-name">${st.name}</h2>
        <p class="row-refs">${st.refs}</p>
        <ul class="row-rules">${st.rules.map((r) => `<li>${r}</li>`).join('')}</ul>
      </div>
      <div class="row-view">
        <div class="stage"><canvas width="${W}" height="${H}" aria-label="${st.name} lineup"></canvas></div>
        <div class="strip"><span class="strip-label">At game size, 1 pixel = 1 pixel:</span><canvas class="one" width="${W}" height="${H}"></canvas></div>
        <div class="names">${units.map((u) => `<span><b>${escapeHtml(u.bp.name)}</b> ${Math.round(u.rig.height)}px</span>`).join('')}</div>
      </div>`;
    host.appendChild(row);
    const R = new MF.Renderer(W, H);
    rows.push({ st, units, stagePal, R, canvases: row.querySelectorAll('canvas') });
  });

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------------------------------------------------------- animation
  let mode = 'idle', t = 0, last = performance.now(), nextAttack = 0.4;
  const facing = document.getElementById('facing');
  document.querySelectorAll('.controls .chip').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.controls .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    nextAttack = t + 0.2;
  }));

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    const fireNow = mode === 'attack' && t >= nextAttack;
    if (fireNow) nextAttack = t + 1.7;
    let yaw = +facing.value;
    if (mode === 'turn') yaw = Math.floor(t / 0.6) * (TAU / 8);
    for (const row of rows) {
      const scene = [];
      for (const u of row.units) {
        if (fireNow) { u.fire = 1; u.fireN++; }
        if (u.fire > 0) u.fire = Math.max(0, u.fire - dt * (u.rig.fireDecay || 5));
        const walking = mode === 'walk';
        u.rig.animate({ phase: walking ? t * TAU * 1.15 : 0, move: walking ? 1 : 0, t, fire: u.fire, fireN: u.fireN });
        const w = MF.matFromEuler(MF.mat(), Math.round(u.x), u.rig.hover || 0, 0, 0, yaw, 0);
        scene.push({ prims: MF.updateRig(u.rig.root, w, []), pal: u.pal, x: Math.round(u.x), z: 0, radius: u.rig.radius, height: u.rig.height + (u.rig.hover || 0) });
      }
      row.R.render({
        units: scene, cam: { x: 0, z: 0, pitch: 0.55, ox: W / 2, oy: H - 16 },
        floor: 'tiles', tileSize: 24, bg: row.stagePal.bg, floorRamp: row.stagePal.floor, shadows: true, look: row.st.look, time: t,
      });
      for (const c of row.canvases) c.getContext('2d').putImageData(row.R.image, 0, 0);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
