// Mecha Factory — application: hangar, WASD control, editor panel, production line, export.
(function () {
  const MF = window.MF;
  const G = MF.Gen;
  const $ = (id) => document.getElementById(id);
  const TAU = Math.PI * 2;
  const DIR_NAMES = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];

  const store = {
    get(k, d) { try { const v = localStorage.getItem('mf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mf.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ------------------------------------------------------------ state
  const S = {
    units: [],
    nextId: 1,
    selected: new Set(),
    activeId: null,
    locks: store.get('locks', {}),
    settings: Object.assign({ zoom: 3, pitch: 0.55, lightAng: -0.9, floor: 'tiles', shadows: true, snap: true }, store.get('settings', {})),
    preview: { spin: true, step: false, walk: false },
    keys: new Set(),
    cam: { x: 0, z: 0 },
    time: 0,
    history: [],
  };

  // ------------------------------------------------------------ units
  function makeUnit(bp, x = 0, z = 0, yaw = 0) {
    const u = { id: S.nextId++, bp: sanitize(bp), x, z, yaw, targetYaw: yaw, phase: 0, move: 0, dist: 0, t: Math.random() * 10 };
    rebuild(u);
    return u;
  }
  function sanitize(bp) {
    const b = JSON.parse(JSON.stringify(bp));
    b.colors = Object.assign({ tertiary: '#b8323c', skin: '#d99a6c', hair: '#3b2a26', leather: '#6e4a33' }, MF.PALETTES[b.palette] || MF.PALETTES['Rust Crab'], b.colors || {});
    if (!G.LINES[b.line || 'modular']) b.line = 'modular';
    return b;
  }
  function rebuild(u) {
    u.rig = G.build(u.bp);
    u.pal = MF.buildPalette(u.bp.colors);
  }
  const active = () => S.units.find((u) => u.id === S.activeId) || S.units[0];

  function lightVec() {
    const a = S.settings.lightAng;
    return [Math.sin(a) * 0.62, 0.78, Math.cos(a) * 0.62];
  }

  function posedPrims(u, x, z, yaw) {
    u.rig.animate({ phase: u.phase, move: u.move, t: u.t, fire: u.fire || 0, fireN: u.fireN || 0 });
    const w = MF.matFromEuler(MF.mat(), x, u.rig.hover || 0, z, 0, yaw, 0);
    return MF.updateRig(u.rig.root, w, []);
  }

  // ------------------------------------------------------------ hangar rendering
  const hangar = $('hangar');
  const hctx = hangar.getContext('2d');
  const R = new MF.Renderer(320, 200);
  const bufCanvas = document.createElement('canvas');
  let viewW = 320, viewH = 200;

  function resizeHangar() {
    const box = $('stageInner').getBoundingClientRect();
    const z = S.settings.zoom;
    viewW = Math.max(40, Math.floor(box.width / z));
    viewH = Math.max(40, Math.floor(box.height / z));
    R.resize(viewW, viewH);
    hangar.width = viewW; hangar.height = viewH;
    hangar.style.width = viewW * z + 'px';
    hangar.style.height = viewH * z + 'px';
    bufCanvas.width = viewW; bufCanvas.height = viewH;
  }
  new ResizeObserver(resizeHangar).observe($('stageInner'));

  function stagePalette() {
    const a = active();
    return a ? a.pal : MF.buildPalette(MF.PALETTES['Snowcat']);
  }

  function renderHangar() {
    const pal = stagePalette();
    // snap to whole screen pixels so sprites don't shimmer while moving (z is foreshortened by sin(pitch))
    const sp = Math.sin(S.settings.pitch);
    const snapZ = (z) => Math.round(z * sp) / sp;
    const scene = {
      units: S.units.map((u) => {
        const x = Math.round(u.x), z = snapZ(u.z);
        return { prims: posedPrims(u, x, z, u.yaw), pal: u.pal, x, z, radius: u.rig.radius, height: u.rig.height + (u.rig.hover || 0), selected: S.selected.has(u.id) };
      }),
      cam: { x: Math.round(S.cam.x), z: snapZ(S.cam.z), pitch: S.settings.pitch, ox: Math.floor(viewW / 2), oy: Math.floor(viewH * 0.62) },
      floor: S.settings.floor, bg: pal.bg, floorRamp: pal.floor, shadows: S.settings.shadows, light: lightVec(), time: S.time,
      treadOffset: S.units.map((u) => u.dist),
    };
    R.render(scene);
    hctx.putImageData(R.image, 0, 0);
  }

  // ------------------------------------------------------------ preview (turntable)
  const pv = $('preview');
  const pctx = pv.getContext('2d');
  const PR = new MF.Renderer(pv.width, pv.height);
  let pvYaw = 0.6, pvPhase = 0;
  function renderPreview(dt) {
    const u = active();
    if (!u) return;
    if (S.preview.spin) pvYaw += dt * 0.9;
    let yaw = pvYaw;
    if (S.preview.step) yaw = Math.round(pvYaw / (TAU / 8)) * (TAU / 8);
    const savePh = u.phase, saveMove = u.move;
    if (S.preview.walk) { pvPhase += dt * 6; u.phase = pvPhase; u.move = 1; } else { u.move = 0; }
    const prims = posedPrims(u, 0, 0, yaw);
    u.phase = savePh; u.move = saveMove;
    const h = u.rig.height + (u.rig.hover || 0);
    PR.render({
      units: [{ prims, pal: u.pal, x: 0, z: 0, radius: u.rig.radius, height: h }],
      cam: { x: 0, z: 0, pitch: S.settings.pitch, ox: pv.width / 2, oy: Math.round(pv.height * 0.5 + h * 0.42) },
      floor: 'plain', bg: u.pal.bg, floorRamp: u.pal.floor, shadows: S.settings.shadows, light: lightVec(), time: S.time,
    });
    pctx.putImageData(PR.image, 0, 0);
  }

  // ------------------------------------------------------------ simulation
  function update(dt) {
    S.time += dt;
    let vx = 0, vz = 0;
    const k = S.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) vz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) vz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) vx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) vx += 1;
    if (S.touchVec) { vx = S.touchVec[0]; vz = S.touchVec[1]; }
    const moving = vx !== 0 || vz !== 0;
    const len = Math.hypot(vx, vz) || 1;
    vx /= len; vz /= len;
    const run = k.has('ShiftLeft') || k.has('ShiftRight') || (S.touchVec && S.touchVec[2]);

    const trigger = k.has('Space');
    for (const u of S.units) {
      u.t += dt;
      if (u.fire > 0) u.fire = Math.max(0, u.fire - dt * (u.rig.fireDecay || 5));
      if (trigger && S.selected.has(u.id) && !(u.fire > 0.35)) { u.fire = 1; u.fireN = (u.fireN || 0) + 1; }
      const sel = S.selected.has(u.id);
      const go = sel && moving;
      if (go) {
        let ty = Math.atan2(vx, vz);
        if (S.settings.snap) ty = Math.round(ty / (TAU / 8)) * (TAU / 8);
        u.targetYaw = ty;
      }
      // turn toward target (fast, shortest way)
      let dy = ((u.targetYaw - u.yaw + Math.PI * 3) % TAU) - Math.PI;
      const turnRate = 14 * dt;
      u.yaw += Math.abs(dy) < turnRate ? dy : Math.sign(dy) * turnRate;
      const facingOk = Math.abs(dy) < 0.8;
      const target = go ? (run ? 1.25 : 1) : 0;
      u.move += (Math.min(1, target) - u.move) * Math.min(1, dt * 9);
      if (u.move < 0.002) u.move = 0;
      if (go && facingOk) {
        const speed = (u.rig.stride / 1.25) * (run ? 1.8 : 1) * (u.bp.frame === 'hover' ? 1.1 : 1);
        const sp = Math.min(70, Math.max(22, speed));
        const d = sp * dt;
        u.x += vx * d; u.z += vz * d;
        u.dist += d;
        u.phase += (d / u.rig.stride) * TAU;
      } else if (u.move > 0.01) {
        // settle the stride
        u.phase += dt * 3 * u.move;
      }
    }
    // keep units from overlapping
    for (let it = 0; it < 2; it++) for (let i = 0; i < S.units.length; i++) for (let j = i + 1; j < S.units.length; j++) {
      const a = S.units[i], b = S.units[j];
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 0.01;
      const min = (a.rig.radius + b.rig.radius) * 0.72;
      if (d < min) {
        const push = (min - d) / 2, nx = dx / d, nz = dz / d;
        const aw = S.selected.has(a.id) && !S.selected.has(b.id) ? 0.2 : 1, bw = S.selected.has(b.id) && !S.selected.has(a.id) ? 0.2 : 1;
        a.x -= nx * push * aw; a.z -= nz * push * aw; b.x += nx * push * bw; b.z += nz * push * bw;
      }
    }
    // camera follows selection
    const focus = S.units.filter((u) => S.selected.has(u.id));
    const list = focus.length ? focus : S.units;
    if (list.length) {
      let fx = 0, fz = 0;
      for (const u of list) { fx += u.x; fz += u.z; }
      fx /= list.length; fz /= list.length;
      const f = Math.min(1, dt * 3);
      S.cam.x += (fx - S.cam.x) * f; S.cam.z += (fz - S.cam.z) * f;
    }
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    renderHangar();
    renderPreview(dt);
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------ input
  const isTyping = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(el.type)));
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || !$('modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space'].includes(code)) {
      if (code === 'Space') e.preventDefault();
      if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'range' && code.startsWith('Arrow')) return;
      if (e.target && e.target.tagName === 'SELECT') e.target.blur();
      S.keys.add(code);
      if (code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      if (code === 'KeyZ') { e.preventDefault(); undo(); }
      return;
    }
    if (e.altKey) return;
    if (code === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); }
    else if (/^Digit[1-9]$/.test(code)) { const u = S.units[+code.slice(5) - 1]; if (u) selectOnly(u.id); }
    else if (code === 'KeyG') { S.units.forEach((u) => S.selected.add(u.id)); refreshRoster(); }
    else if (code === 'KeyR') randomizeActive();
    else if (code === 'KeyM') mutateActive();
    else if (code === 'KeyN') deployCopy();
    else if (code === 'Delete' || code === 'Backspace') scrapSelected();
    else if (code === 'KeyL') lineUp();
    else if (code === 'KeyP') openSnapshot();
  });
  window.addEventListener('keyup', (e) => S.keys.delete(e.code));
  window.addEventListener('blur', () => S.keys.clear());

  // touch: drag anywhere on the hangar as a virtual stick, tap to select
  let touch = null;
  hangar.addEventListener('pointermove', (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y, len = Math.hypot(dx, dy);
    if (len > 12) { touch.moved = true; S.touchVec = [dx / len, dy / len, len > 90]; }
    else S.touchVec = null;
  });
  const endTouch = (e) => {
    if (!touch || e.pointerId !== touch.id) return;
    const t = touch; touch = null; S.touchVec = null;
    if (!t.moved) pick(t.px, t.py, false);
  };
  hangar.addEventListener('pointerup', endTouch);
  hangar.addEventListener('pointercancel', endTouch);

  function pick(clientX, clientY, multi) {
    const rect = hangar.getBoundingClientRect();
    const X = Math.floor(((clientX - rect.left) / rect.width) * viewW), Y = Math.floor(((clientY - rect.top) / rect.height) * viewH);
    if (X < 0 || Y < 0 || X >= viewW || Y >= viewH) return;
    const ui = R.unitIx[Y * viewW + X];
    if (ui < 0) return;
    const u = S.units[ui];
    if (multi) {
      if (S.selected.has(u.id) && S.selected.size > 1) S.selected.delete(u.id); else S.selected.add(u.id);
      S.activeId = u.id; syncEditor(); refreshRoster();
    } else selectOnly(u.id);
  }

  hangar.addEventListener('pointerdown', (e) => {
    hangar.focus();
    if (e.pointerType === 'touch') {
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, moved: false };
      hangar.setPointerCapture(e.pointerId);
      return;
    }
    pick(e.clientX, e.clientY, e.shiftKey || e.ctrlKey || e.metaKey);
  });

  function selectOnly(id) {
    S.selected = new Set([id]);
    S.activeId = id;
    syncEditor(); refreshRoster();
  }
  function cycle(dir) {
    if (!S.units.length) return;
    const i = S.units.findIndex((u) => u.id === S.activeId);
    const n = S.units[(i + dir + S.units.length) % S.units.length];
    selectOnly(n.id);
  }

  // ------------------------------------------------------------ roster
  function refreshRoster() {
    const el = $('roster');
    el.innerHTML = '';
    S.units.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'unit-chip' + (S.selected.has(u.id) ? ' is-sel' : '') + (u.id === S.activeId ? ' is-active' : '');
      b.innerHTML = `<b>${i + 1}</b><i style="background:${u.bp.colors.primary}"></i>${escapeHtml(u.bp.name.split(' ').slice(-1)[0])}`;
      b.title = u.bp.name + ' — click to select, shift-click to group';
      b.addEventListener('click', (e) => {
        if (e.shiftKey) { S.selected.add(u.id); S.activeId = u.id; syncEditor(); refreshRoster(); }
        else selectOnly(u.id);
        hangar.focus();
      });
      el.appendChild(b);
    });
  }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ editor
  const slotDefs = (bp) => G.lineOf(bp).slots;
  const SLIDERS = [
    ['bulk', 'Bulk', 0.7, 1.5, 0.05],
    ['legLen', 'Legs', 0.6, 1.5, 0.05],
    ['tall', 'Torso', 0.7, 1.5, 0.05],
    ['armLen', 'Arms', 0.7, 1.4, 0.05],
    ['size', 'Scale', 0.7, 1.6, 0.05],
    ['edge', 'Bevel', 0, 3, 0.1],
  ];
  const SWATCHES_MECH = [['primary', 'Armor'], ['secondary', 'Trim'], ['tertiary', 'Accent 2'], ['metal', 'Frame'], ['accent', 'Glow'], ['glass', 'Glass'], ['outline', 'Line'], ['bg', 'Backdrop'], ['floor', 'Floor']];
  const SWATCHES_HUMAN = [['primary', 'Armor'], ['secondary', 'Cloth'], ['tertiary', 'Sash'], ['leather', 'Leather'], ['metal', 'Steel'], ['skin', 'Skin'], ['hair', 'Hair'], ['accent', 'Glow'], ['glass', 'Lens'], ['outline', 'Line'], ['bg', 'Backdrop'], ['floor', 'Floor']];
  const swatchesFor = (bp) => (G.lineOf(bp).group === 'Humans' ? SWATCHES_HUMAN : SWATCHES_MECH);
  const DEFAULT_COLORS = { tertiary: '#b8323c', skin: '#d99a6c', hair: '#3b2a26', leather: '#6e4a33' };
  const DICE = '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="1" y="1" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="4.5" cy="4.5" r="1.2" fill="currentColor"/><circle cx="9.5" cy="9.5" r="1.2" fill="currentColor"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/></svg>';
  let slotsLine = null, swatchSet = null;

  function slotRow(key, label, optionsHtml) {
    const row = document.createElement('div');
    row.className = 'slot';
    row.innerHTML = `<label class="slot-label" for="sl-${key}">${label}</label>
      <select class="select" id="sl-${key}">${optionsHtml}</select>
      <button class="dice" id="dice-${key}" title="Reroll ${label.toLowerCase()}" aria-label="Reroll ${label.toLowerCase()}">${DICE}</button>
      <label class="lock" title="Lock ${label.toLowerCase()}"><input type="checkbox" id="lock-${key}" aria-label="Lock ${label.toLowerCase()}"><span></span></label>`;
    const lk = row.querySelector('input[type=checkbox]');
    lk.checked = !!S.locks[key];
    lk.addEventListener('change', () => { S.locks[key] = lk.checked; store.set('locks', S.locks); });
    row.querySelector('.dice').addEventListener('click', () => rerollSlot(key));
    return row;
  }

  // Parts panel: the Line picker, then the active line's own slots.
  function buildSlots(bp) {
    const slots = $('slots');
    slots.innerHTML = '';
    const groups = {};
    for (const id in G.LINES) (groups[G.LINES[id].group] = groups[G.LINES[id].group] || []).push(G.LINES[id]);
    const lineOpts = Object.keys(groups).map((g) => `<optgroup label="${g}">${groups[g].map((d) => `<option value="${d.id}">${d.label}</option>`).join('')}</optgroup>`).join('');
    const lineRow = slotRow('line', 'Line', lineOpts);
    lineRow.classList.add('slot-line');
    slots.appendChild(lineRow);
    const lsel = lineRow.querySelector('select');
    lsel.addEventListener('change', () => { switchLine(lsel.value); lsel.blur(); });
    for (const d of slotDefs(bp)) {
      const row = slotRow(d.key, d.label, d.options.map((o) => `<option value="${o}">${(d.labels && d.labels[o]) || o}</option>`).join(''));
      slots.appendChild(row);
      const sel = row.querySelector('select');
      // the first slot of a stylized line (role, archetype) re-dresses the unit to match, keeping locked slots
      const cascade = G.lineOf(bp).id !== 'modular' && d === slotDefs(bp)[0];
      sel.addEventListener('change', () => { if (cascade) recast(d.key, sel.value); else editActive((b) => { b[d.key] = sel.value; }); sel.blur(); });
    }
    slotsLine = G.lineOf(bp).id;
  }

  function buildSwatches(bp) {
    const set = swatchesFor(bp);
    if (swatchSet === set) return;
    swatchSet = set;
    const sw = $('swatches');
    sw.innerHTML = '';
    for (const [key, label] of set) {
      const d = document.createElement('label');
      d.className = 'swatch';
      d.innerHTML = `<span>${label}</span><input type="color" id="sw-${key}" aria-label="${label} colour">`;
      sw.appendChild(d);
      const inp = d.querySelector('input');
      inp.addEventListener('input', () => editActive((b) => { b.colors[key] = inp.value; b.palette = 'custom'; }, true));
      inp.addEventListener('change', () => pushHistory());
    }
  }

  function recast(key, value) {
    const u = active();
    if (!u) return;
    const locks = Object.assign({}, S.locks, { line: 1, [key]: 1, bulk: 1, legLen: 1, tall: 1, armLen: 1, edge: 1, size: 1, palette: 1, number: 1, name: 1 });
    const prev = Object.assign({}, u.bp, { [key]: value });
    u.bp = sanitize(G.randomBlueprint(MF.randomSeed(), locks, prev));
    rebuild(u);
    pushHistory(); syncEditor(); refreshRoster(); saveHangar();
  }

  // switching line keeps paint only when it suits the new group
  function switchLine(id) {
    const u = active();
    if (!u) return;
    const locks = { bulk: 1, legLen: 1, tall: 1, armLen: 1, edge: 1, number: 1 };
    const sameGroup = G.LINES[id].group === G.lineOf(u.bp).group;
    if (sameGroup) locks.palette = 1;
    const nb = G.randomBlueprint(MF.randomSeed(), locks, u.bp, { line: id });
    u.bp = sanitize(nb); rebuild(u);
    pushHistory(); syncEditor(); refreshRoster(); saveHangar();
  }

  function buildEditor() {
    const sliders = $('sliders');
    for (const [key, label, min, max, step] of SLIDERS) {
      const row = document.createElement('div');
      row.className = 'slider';
      row.innerHTML = `<label class="slot-label" for="sd-${key}">${label}</label><input type="range" id="sd-${key}" min="${min}" max="${max}" step="${step}"><output id="so-${key}"></output>`;
      sliders.appendChild(row);
      const inp = row.querySelector('input');
      inp.addEventListener('input', () => { $('so-' + key).textContent = (+inp.value).toFixed(2); editActive((bp) => { bp[key] = +inp.value; }, true); });
      inp.addEventListener('change', () => { pushHistory(); inp.blur(); });
    }
    const pre = $('palPreset');
    pre.addEventListener('change', () => {
      if (pre.value !== 'custom') editActive((bp) => { bp.palette = pre.value; bp.colors = { ...DEFAULT_COLORS, ...MF.PALETTES[pre.value] }; });
      pre.blur();
    });
    $('palShuffle').addEventListener('click', () => editActive((bp) => { bp.colors = randomColors(MF.randomSeed(), G.lineOf(bp).group === 'Humans'); bp.palette = 'custom'; }));
    const lp = $('lock-palette');
    lp.checked = !!S.locks.palette;
    lp.addEventListener('change', () => { S.locks.palette = lp.checked; store.set('locks', S.locks); });
    $('mName').addEventListener('input', (e) => editActive((bp) => { bp.name = e.target.value || 'Unnamed'; }, true, true));
    $('mNumber').addEventListener('input', (e) => {
      const v = e.target.value.replace(/[^0-9-]/g, '').slice(0, 3);
      editActive((bp) => { bp.number = v || '0'; }, true);
    });
  }

  function syncEditor() {
    const u = active();
    if (!u) return;
    const bp = u.bp;
    const def = G.lineOf(bp);
    if (slotsLine !== def.id) buildSlots(bp);
    buildSwatches(bp);
    $('sl-line').value = def.id;
    for (const d of def.slots) $('sl-' + d.key).value = bp[d.key];
    for (const [key] of SLIDERS) { $('sd-' + key).value = bp[key] == null ? 1 : bp[key]; $('so-' + key).textContent = (+(bp[key] == null ? 1 : bp[key])).toFixed(2); }
    const human = def.group === 'Humans';
    const pre = $('palPreset');
    const names = Object.keys(MF.PALETTES).filter((k) => !!MF.PALETTES[k].human === human);
    const want = names.join('|');
    if (pre.dataset.set !== want) {
      pre.dataset.set = want;
      pre.innerHTML = names.map((k) => `<option value="${k}">${k}</option>`).join('') + '<option value="custom">Custom</option>';
    }
    pre.value = names.includes(bp.palette) ? bp.palette : 'custom';
    for (const [key] of swatchSet) $('sw-' + key).value = bp.colors[key] || DEFAULT_COLORS[key] || '#888888';
    if (document.activeElement !== $('mName')) $('mName').value = bp.name;
    if (document.activeElement !== $('mNumber')) $('mNumber').value = bp.number;
    const main = def.slots[0];
    $('mSpec').textContent = `seed ${bp.seed}\n${Math.round(u.rig.height + (u.rig.hover || 0))}px tall · ${def.label}${main ? ' · ' + ((main.labels && main.labels[bp[main.key]]) || bp[main.key]) : ''}`;
    const ramps = $('ramps');
    ramps.innerHTML = '';
    for (const k of human ? ['primary', 'secondary', 'tertiary', 'leather', 'skin', 'hair', 'metal', 'accent'] : ['primary', 'secondary', 'tertiary', 'metal', 'accent', 'glass']) {
      const r = document.createElement('div');
      r.className = 'ramp';
      r.innerHTML = u.pal.ramps[k].map((c) => `<i style="background:${MF.color.rgbToHex(c)}"></i>`).join('');
      ramps.appendChild(r);
    }
  }

  function pushHistory() {
    const u = active();
    if (!u) return;
    const snap = JSON.stringify({ id: u.id, bp: u.bp });
    if (S.history[S.history.length - 1] !== snap) S.history.push(snap);
    if (S.history.length > 80) S.history.shift();
  }
  function undo() {
    if (S.history.length < 2) { toast('Nothing to undo'); return; }
    S.history.pop();
    const prev = JSON.parse(S.history[S.history.length - 1]);
    const u = S.units.find((x) => x.id === prev.id);
    if (!u) return;
    u.bp = prev.bp; rebuild(u);
    S.activeId = u.id; S.selected = new Set([u.id]);
    syncEditor(); refreshRoster(); saveHangar();
  }

  // apply a change to the active unit (and all selected units for paint-free part edits)
  function editActive(fn, live = false, skipSync = false) {
    const u = active();
    if (!u) return;
    fn(u.bp);
    rebuild(u);
    if (!live) pushHistory();
    if (!skipSync) syncEditor();
    refreshRoster();
    saveHangar();
  }

  function rerollSlot(key) {
    editActive((bp) => {
      const seed = MF.randomSeed();
      if (key === 'line') { const ids = Object.keys(G.LINES).filter((id) => id !== G.lineOf(bp).id); bp.__switch = ids[Math.floor(Math.random() * ids.length)]; return; }
      const locks = { line: 1 };
      for (const d of slotDefs(bp)) locks[d.key] = d.key !== key;
      for (const k of ['bulk', 'legLen', 'tall', 'armLen', 'edge', 'size', 'palette', 'number', 'name']) locks[k] = true;
      const fresh = G.randomBlueprint(seed, locks, bp);
      let tries = 0;
      let val = fresh[key];
      while (val === bp[key] && tries++ < 8) val = G.randomBlueprint(MF.randomSeed(), locks, bp)[key];
      bp[key] = val;
    });
    const u = active();
    if (u && u.bp.__switch) { const id = u.bp.__switch; delete u.bp.__switch; switchLine(id); }
  }

  function randomizeActive() {
    const u = active();
    if (!u) return;
    const nb = G.randomBlueprint(MF.randomSeed(), S.locks, u.bp);
    u.bp = sanitize(nb); rebuild(u);
    pushHistory(); syncEditor(); refreshRoster(); saveHangar();
  }

  function mutateActive() {
    const u = active();
    if (!u) return;
    const free = slotDefs(u.bp).map((d) => d.key).filter((k) => !S.locks[k]);
    const n = 1 + (Math.random() < 0.4 ? 1 : 0);
    editActive((bp) => {
      for (let i = 0; i < n && free.length; i++) {
        const key = free.splice(Math.floor(Math.random() * free.length), 1)[0];
        const locks = { line: 1 };
        for (const d of slotDefs(bp)) locks[d.key] = d.key !== key;
        Object.assign(locks, { bulk: 1, legLen: 1, tall: 1, armLen: 1, edge: 1, size: 1, palette: 1, number: 1, name: 1 });
        bp[key] = G.randomBlueprint(MF.randomSeed(), locks, bp)[key];
      }
      for (const [k, , min, max] of SLIDERS) if (k !== 'size' && !S.locks[k] && Math.random() < 0.5) bp[k] = +Math.min(max, Math.max(min, bp[k] + (Math.random() - 0.5) * 0.25)).toFixed(2);
    });
  }

  function spawnPoint() {
    // find a free spot near the camera
    for (let r = 0; r < 24; r++) {
      const a = Math.random() * TAU, d = 36 + r * 8;
      const x = S.cam.x + Math.cos(a) * d, z = S.cam.z + Math.sin(a) * d * 0.6;
      if (S.units.every((u) => Math.hypot(u.x - x, u.z - z) > u.rig.radius * 1.6 + 16)) return [x, z];
    }
    return [S.cam.x + 40, S.cam.z];
  }
  function deploy(bp, select = true) {
    if (S.units.length >= 12) { toast('Hangar is full (12 units). Scrap one first.'); return null; }
    const [x, z] = spawnPoint();
    const u = makeUnit(bp, x, z, 0);
    S.units.push(u);
    if (select) selectOnly(u.id); else refreshRoster();
    pushHistory(); saveHangar();
    return u;
  }
  function deployCopy() {
    const u = active();
    const bp = u ? JSON.parse(JSON.stringify(u.bp)) : G.randomBlueprint(MF.randomSeed());
    deploy(bp);
    toast('Deployed ' + bp.name);
  }
  function scrapSelected() {
    if (S.units.length <= 1) { toast('Keep at least one unit in the hangar'); return; }
    const before = S.units.length;
    S.units = S.units.filter((u) => !S.selected.has(u.id));
    if (!S.units.length) S.units.push(makeUnit(G.randomBlueprint(MF.randomSeed())));
    const n = before - S.units.length;
    selectOnly(S.units[0].id);
    saveHangar();
    toast(`Scrapped ${n} unit${n === 1 ? '' : 's'}`);
  }

  // random harmonious colours
  function randomColors(seed, human) {
    const r = new MF.RNG(seed);
    const { hslToRgb, rgbToHex } = MF.color;
    const h = r.range(0, 360);
    const mode = r.pick(['comp', 'analog', 'triad', 'mono']);
    const h2 = mode === 'comp' ? h + 180 + r.range(-20, 20) : mode === 'analog' ? h + r.pick([-40, 40]) : mode === 'triad' ? h + 120 : h + r.range(-10, 10);
    const pl = r.range(0.35, 0.7), ps = r.range(0.25, 0.65);
    const hex = (hh, s, l) => rgbToHex(hslToRgb([hh, s, l]));
    const light = r.chance(0.35);
    const bgL = light ? r.range(0.72, 0.86) : r.range(0.1, 0.2);
    const bgH = r.chance(0.5) ? h + 180 : r.range(0, 360);
    return {
      primary: hex(h, ps, light ? r.range(0.72, 0.85) : pl),
      secondary: hex(h2, r.range(0.4, 0.8), r.range(0.4, 0.6)),
      metal: hex(r.range(200, 280), r.range(0.05, 0.2), r.range(0.22, 0.38)),
      accent: hex(r.pick([h2 + 30, 50, 190, 330, 100]), 1, 0.6),
      glass: hex(r.range(170, 210), 0.8, 0.72),
      outline: hex(r.range(240, 290), 0.3, 0.08),
      bg: hex(bgH, r.range(0.1, 0.35), bgL),
      floor: hex(bgH, r.range(0.1, 0.3), bgL * 0.9),
      tertiary: hex(h2 + r.pick([150, 200, 30]), r.range(0.5, 0.8), r.range(0.4, 0.55)),
      skin: human ? r.pick(['#f0c8a0', '#e0ac85', '#c98d64', '#a8704c', '#7a4e34', '#5a3a28', '#8fb04a', '#8a9aa8']) : '#d99a6c',
      hair: r.pick(['#2a2020', '#3b2a26', '#6a4428', '#c46a2a', '#e6d7a8', '#d8d8d8', '#3a2a4a']),
      leather: hex(r.range(15, 35), r.range(0.3, 0.5), r.range(0.22, 0.35)),
    };
  }

  // ------------------------------------------------------------ production line
  const TR = new MF.Renderer(84, 84), TRs = new MF.Renderer(60, 60);
  function rollLine() {
    const g = $('gallery');
    g.innerHTML = '';
    const base = active() ? active().bp : null;
    for (let i = 0; i < 10; i++) {
      const bp = sanitize(G.randomBlueprint(MF.randomSeed(), S.locks, base, { group: S.lineFilter || undefined }));
      const btn = document.createElement('button');
      btn.className = 'thumb';
      btn.title = bp.name;
      const tmp = makeUnit(bp, 0, 0, 0.62);
      const h = tmp.rig.height + (tmp.rig.hover || 0);
      const small = h < 56, TRx = small ? TRs : TR, cs = small ? 60 : 84;
      const c = document.createElement('canvas');
      c.width = cs; c.height = cs;
      const scale = Math.min(1, 62 / h);
      const oy = small ? Math.round(30 + h * 0.42 + 2) : Math.round(42 + h * 0.45 * scale + 4);
      TRx.render({
        units: [{ prims: posedPrims(tmp, 0, 0, 0.62), pal: tmp.pal, x: 0, z: 0, radius: tmp.rig.radius, height: h }],
        cam: { x: 0, z: 0, pitch: S.settings.pitch, ox: cs / 2, oy },
        floor: 'plain', bg: tmp.pal.bg, floorRamp: tmp.pal.floor, shadows: S.settings.shadows, light: lightVec(), time: 0,
      });
      c.getContext('2d').putImageData(TRx.image, 0, 0);
      const label = document.createElement('span');
      label.textContent = bp.name;
      btn.append(c, label);
      btn.addEventListener('click', (e) => {
        if (e.shiftKey) { deploy(bp); toast('Deployed ' + bp.name); return; }
        const u = active();
        if (!u) { deploy(bp); return; }
        u.bp = sanitize(bp); rebuild(u);
        pushHistory(); syncEditor(); refreshRoster(); saveHangar();
      });
      g.appendChild(btn);
    }
  }

  // ------------------------------------------------------------ export
  function renderFrame(u, R2, yaw, phase, move, t, opts, fire = 0) {
    const sp = u.phase, sm = u.move, st = u.t, sf = u.fire, sn = u.fireN;
    u.phase = phase; u.move = move; u.t = t; u.fire = fire; u.fireN = 1;
    const prims = posedPrims(u, 0, 0, yaw);
    u.phase = sp; u.move = sm; u.t = st; u.fire = sf; u.fireN = sn;
    R2.render({
      units: [{ prims, pal: u.pal, x: 0, z: 0, radius: u.rig.radius, height: u.rig.height + (u.rig.hover || 0) }],
      cam: { x: 0, z: 0, pitch: S.settings.pitch, ox: R2.w / 2, oy: Math.round(R2.h * 0.72) },
      floor: 'none', shadows: opts.shadow, light: lightVec(), time: t, treadOffset: [phase * 3],
      shadowPacked: 0x66000000,
    });
    return new Uint32Array(R2.image.data.buffer.slice(0));
  }

  // Columns: [idle] + walk frames + attack frames; rows: 8 directions.
  // cell 'auto' crops tight; a number gives fixed game cells with the feet at a constant anchor.
  function buildSheet(u, opts) {
    const R2 = new MF.Renderer(240, 240);
    const footX = R2.w / 2, footY = Math.round(R2.h * 0.72);
    const colDefs = [];
    if (opts.idle) colDefs.push({ name: 'idle', phase: 0, move: 0, t: 0, fire: 0 });
    for (let i = 0; i < opts.frames; i++) colDefs.push({ name: 'walk' + i, phase: (i / opts.frames) * TAU, move: 1, t: i * 0.1, fire: 0 });
    for (let i = 0; i < opts.attack; i++) colDefs.push({ name: 'attack' + i, phase: 0, move: 0, t: 0.2 + i * 0.04, fire: 1 - i / opts.attack });
    const frames = [];
    let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
    for (let d = 0; d < 8; d++) {
      const yaw = (d * TAU) / 8;
      const row = [];
      for (const c of colDefs) {
        const px = renderFrame(u, R2, yaw, c.phase, c.move, c.t, opts, c.fire);
        for (let y = 0; y < R2.h; y++) for (let x = 0; x < R2.w; x++) if (px[y * R2.w + x] >>> 24) {
          if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
        row.push(px);
      }
      frames.push(row);
    }
    let cw, ch, ox, oy, clipped = false;
    if (opts.cell === 'auto') {
      const pad = 1;
      cw = maxX - minX + 1 + pad * 2; ch = maxY - minY + 1 + pad * 2;
      ox = minX - pad; oy = minY - pad;
    } else {
      cw = ch = +opts.cell;
      const footInCell = ch - Math.max(3, Math.round(ch * 0.08));
      ox = footX - cw / 2; oy = footY - footInCell;
      clipped = minX < ox || minY < oy || maxX >= ox + cw || maxY >= oy + ch;
    }
    const cols = colDefs.length;
    const sheet = document.createElement('canvas');
    sheet.width = cw * cols; sheet.height = ch * 8;
    const sctx = sheet.getContext('2d');
    const cell = new ImageData(cw, ch);
    const c32 = new Uint32Array(cell.data.buffer);
    frames.forEach((row, d) => row.forEach((px, f) => {
      c32.fill(0);
      for (let y = 0; y < ch; y++) {
        const sy = y + oy;
        if (sy < 0 || sy >= R2.h) continue;
        for (let x = 0; x < cw; x++) {
          const sx = x + ox;
          if (sx >= 0 && sx < R2.w) c32[y * cw + x] = px[sy * R2.w + sx];
        }
      }
      sctx.putImageData(cell, f * cw, d * ch);
    }));
    let out = sheet;
    if (opts.scale > 1) {
      out = document.createElement('canvas');
      out.width = sheet.width * opts.scale; out.height = sheet.height * opts.scale;
      const o = out.getContext('2d');
      o.imageSmoothingEnabled = false;
      o.drawImage(sheet, 0, 0, out.width, out.height);
    }
    const meta = {
      name: u.bp.name, cellWidth: cw * opts.scale, cellHeight: ch * opts.scale, scale: opts.scale,
      rows: DIR_NAMES, columns: colDefs.map((c) => c.name),
      animations: {
        idle: opts.idle ? { from: 0, count: 1 } : null,
        walk: { from: opts.idle ? 1 : 0, count: opts.frames, loop: true },
        attack: opts.attack ? { from: (opts.idle ? 1 : 0) + opts.frames, count: opts.attack, loop: false } : null,
      },
      anchor: { x: (footX - ox) * opts.scale, y: (footY - oy) * opts.scale },
      clipped,
      blueprint: u.bp,
    };
    return { canvas: out, meta };
  }

  const exportOpts = Object.assign({ frames: 8, attack: 4, cell: 'auto', scale: 1, idle: true, shadow: true }, store.get('exportOpts', {}));
  function openExport() {
    const u = active();
    if (!u) return;
    const body = $('modalBody');
    $('modalTitle').textContent = 'Sprite sheet · ' + u.bp.name;
    body.innerHTML = `
      <div class="opt-row">
        <label>Walk frames <select class="select select-sm" id="exFrames">${[4, 6, 8, 12].map((n) => `<option ${n === exportOpts.frames ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Attack frames <select class="select select-sm" id="exAttack">${[0, 3, 4, 6].map((n) => `<option ${n === exportOpts.attack ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Cell <select class="select select-sm" id="exCell">${['auto', '64', '96', '128'].map((n) => `<option value="${n}" ${String(exportOpts.cell) === n ? 'selected' : ''}>${n === 'auto' ? 'Tight crop' : n + '×' + n}</option>`).join('')}</select></label>
        <label>Scale <select class="select select-sm" id="exScale">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === exportOpts.scale ? 'selected' : ''}>${n}×</option>`).join('')}</select></label>
        <label><input type="checkbox" id="exIdle" ${exportOpts.idle ? 'checked' : ''}> Idle column</label>
        <label><input type="checkbox" id="exShadow" ${exportOpts.shadow ? 'checked' : ''}> Drop shadow</label>
        <button class="btn btn-primary btn-sm" id="exPng">Download PNG</button>
        <button class="btn btn-sm" id="exJson">Download JSON</button>
      </div>
      <div class="sheet-view" id="sheetView"></div>
      <pre class="meta" id="exMeta"></pre>
      <p class="hint">Rows run S, SE, E, NE, N, NW, W, SW. Columns: idle, walk loop, then the attack. Fixed cells keep the feet at the same anchor in every frame, ready for a game engine. If your browser blocks the download, right-click the sheet and choose “Save image as”.</p>`;
    let current = null;
    const redraw = () => {
      exportOpts.frames = +$('exFrames').value; exportOpts.scale = +$('exScale').value;
      exportOpts.attack = +$('exAttack').value; exportOpts.cell = $('exCell').value;
      exportOpts.idle = $('exIdle').checked; exportOpts.shadow = $('exShadow').checked;
      store.set('exportOpts', exportOpts);
      current = buildSheet(u, exportOpts);
      const img = new Image();
      img.src = current.canvas.toDataURL('image/png');
      img.alt = 'Sprite sheet for ' + u.bp.name;
      const disp = Math.max(1, Math.round(2 / exportOpts.scale));
      img.style.width = current.canvas.width * disp + 'px';
      $('sheetView').innerHTML = '';
      $('sheetView').appendChild(img);
      $('exMeta').textContent = `${current.canvas.width}×${current.canvas.height}px · cell ${current.meta.cellWidth}×${current.meta.cellHeight} · ${current.meta.columns.length} columns × 8 directions · feet anchor (${current.meta.anchor.x}, ${current.meta.anchor.y})${current.meta.clipped ? ' · this unit is bigger than the cell, so parts are clipped: pick a larger cell' : ''}`;
    };
    ['exFrames', 'exAttack', 'exCell', 'exScale', 'exIdle', 'exShadow'].forEach((id) => $(id).addEventListener('change', redraw));
    const slug = u.bp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    $('exPng').addEventListener('click', () => download(current.canvas.toDataURL('image/png'), slug + '-sheet.png'));
    $('exJson').addEventListener('click', () => download('data:application/json,' + encodeURIComponent(JSON.stringify(current.meta, null, 2)), slug + '-sheet.json'));
    openModal();
    redraw();
  }

  // Inside the claude.ai artifact viewer, saves go through the downloads capability; locally, a plain link.
  let saver = null;
  try { if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => { saver = d; }, () => {}); } catch (e) { /* not in a viewer */ }
  async function download(href, name) {
    if (saver) {
      try {
        const comma = href.indexOf(',');
        const meta = href.slice(5, comma);
        const body = href.slice(comma + 1);
        let blob;
        if (meta.endsWith(';base64')) {
          const bin = atob(body), bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          blob = new Blob([bytes], { type: meta.replace(';base64', '') });
        } else blob = new Blob([decodeURIComponent(body)], { type: meta });
        await saver.save({ filename: name, data: blob });
        toast('Saved ' + name);
      } catch (e) {
        if (e && e.code === 'declined') return;
        toast(e && e.code === 'rate_limited' ? 'A save is already open' : 'Save unavailable here. Right-click the image to save it.');
      }
      return;
    }
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }

  function lineUp() {
    const n = S.units.length;
    let total = 0;
    for (const u of S.units) total += u.rig.radius * 1.5 + 6;
    let x = S.cam.x - total / 2;
    for (const u of S.units) {
      const w = u.rig.radius * 1.5 + 6;
      u.x = x + w / 2; u.z = S.cam.z; u.yaw = u.targetYaw = 0;
      x += w;
    }
    S.selected = new Set(S.units.map((u) => u.id));
    refreshRoster(); saveHangar();
    toast(`Lined up ${n} unit${n === 1 ? '' : 's'}`);
  }

  function openSnapshot() {
    const z = S.settings.zoom;
    const c = document.createElement('canvas');
    c.width = viewW * z; c.height = viewH * z;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(hangar, 0, 0, c.width, c.height);
    const one = hangar.toDataURL('image/png');
    const big = c.toDataURL('image/png');
    $('modalTitle').textContent = 'Hangar snapshot';
    $('modalBody').innerHTML = `
      <div class="opt-row">
        <button class="btn btn-primary btn-sm" id="snapBig">Download ${viewW * z}×${viewH * z}</button>
        <button class="btn btn-sm" id="snapOne">Download 1× pixels (${viewW}×${viewH})</button>
      </div>
      <div class="sheet-view"><img src="${big}" alt="Hangar snapshot" style="width:100%;max-width:${viewW * z}px"></div>
      <p class="hint">Press L before a snapshot to line every unit up facing the camera. If the download is blocked, right-click the image and choose “Save image as”.</p>`;
    $('snapBig').addEventListener('click', () => download(big, 'mecha-hangar.png'));
    $('snapOne').addEventListener('click', () => download(one, 'mecha-hangar-1x.png'));
    openModal();
  }

  function openCode() {
    const u = active();
    if (!u) return;
    const code = encodeBp(u.bp);
    $('modalTitle').textContent = 'Blueprint code';
    $('modalBody').innerHTML = `
      <p class="hint">This code rebuilds ${escapeHtml(u.bp.name)} exactly, paint included. Paste a code below to load it into the active unit.</p>
      <textarea class="code-area" id="codeOut" readonly spellcheck="false">${code}</textarea>
      <div class="opt-row"><button class="btn btn-primary btn-sm" id="codeCopy">Copy code</button></div>
      <textarea class="code-area" id="codeIn" spellcheck="false" placeholder="Paste a blueprint code here"></textarea>
      <div class="opt-row"><button class="btn btn-sm" id="codeLoad">Load into active unit</button><button class="btn btn-sm" id="codeDeploy">Deploy as new unit</button></div>`;
    $('codeCopy').addEventListener('click', () => {
      const ta = $('codeOut');
      const done = () => toast('Blueprint code copied');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, () => { ta.select(); toast('Code selected. Press Ctrl+C to copy.'); });
      else { ta.select(); toast('Code selected. Press Ctrl+C to copy.'); }
    });
    const read = () => { try { return decodeBp($('codeIn').value.trim()); } catch (e) { toast('That code could not be read. Check that it was pasted in full.'); return null; } };
    $('codeLoad').addEventListener('click', () => { const bp = read(); if (!bp) return; const a = active(); a.bp = sanitize(bp); rebuild(a); pushHistory(); syncEditor(); refreshRoster(); saveHangar(); closeModal(); toast('Loaded ' + bp.name); });
    $('codeDeploy').addEventListener('click', () => { const bp = read(); if (!bp) return; closeModal(); deploy(bp); });
    openModal();
  }
  function encodeBp(bp) { return 'MF1.' + btoa(unescape(encodeURIComponent(JSON.stringify(bp)))); }
  function decodeBp(code) {
    const raw = code.startsWith('MF1.') ? code.slice(4) : code;
    const bp = JSON.parse(decodeURIComponent(escape(atob(raw))));
    if (!bp || !(bp.frame || bp.line)) throw new Error('bad');
    return bp;
  }

  function openModal() { $('modal').hidden = false; S.keys.clear(); setTimeout(() => $('modalClose').focus(), 0); }
  function closeModal() { $('modal').hidden = true; hangar.focus(); }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ------------------------------------------------------------ persistence
  let saveTimer = 0;
  function saveHangar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set('hangar.v2', S.units.map((u) => ({ bp: u.bp, x: Math.round(u.x), z: Math.round(u.z), yaw: u.yaw }))), 300);
  }

  // ------------------------------------------------------------ hud controls
  function bindHud() {
    const st = S.settings;
    const save = () => store.set('settings', st);
    $('zoom').value = st.zoom; $('pitch').value = st.pitch; $('lightAng').value = st.lightAng; $('floorMode').value = st.floor;
    $('zoom').addEventListener('input', (e) => { st.zoom = +e.target.value; resizeHangar(); save(); });
    $('pitch').addEventListener('input', (e) => { st.pitch = +e.target.value; save(); });
    $('pitch').addEventListener('change', () => rollLineSoon());
    $('lightAng').addEventListener('input', (e) => { st.lightAng = +e.target.value; save(); });
    $('floorMode').addEventListener('change', (e) => { st.floor = e.target.value; save(); e.target.blur(); });
    const toggle = (id, key) => {
      const b = $(id);
      const paint = () => { b.classList.toggle('is-on', !!st[key]); b.setAttribute('aria-pressed', !!st[key]); };
      paint();
      b.addEventListener('click', () => { st[key] = !st[key]; paint(); save(); b.blur(); });
    };
    toggle('tgShadows', 'shadows');
    toggle('tgSnap', 'snap');
    const pvT = (id, key) => {
      const b = $(id);
      b.addEventListener('click', () => {
        S.preview[key] = !S.preview[key];
        if (key === 'step' && S.preview.step) S.preview.spin = true;
        for (const [i, k] of [['pvSpin', 'spin'], ['pvStep', 'step'], ['pvWalk', 'walk']]) { $(i).classList.toggle('is-on', S.preview[k]); $(i).setAttribute('aria-pressed', S.preview[k]); }
        b.blur();
      });
    };
    pvT('pvSpin', 'spin'); pvT('pvStep', 'step'); pvT('pvWalk', 'walk');
    $('btnRandom').addEventListener('click', randomizeActive);
    $('btnMutate').addEventListener('click', mutateActive);
    $('btnDeploy').addEventListener('click', deployCopy);
    $('btnUndo').addEventListener('click', undo);
    $('btnExport').addEventListener('click', openExport);
    $('btnCode').addEventListener('click', openCode);
    $('btnLine').addEventListener('click', rollLine);
    S.lineFilter = store.get('lineFilter', '');
    document.querySelectorAll('#lineFilter .chip').forEach((b) => {
      const paint = () => document.querySelectorAll('#lineFilter .chip').forEach((x) => { const on = x.dataset.group === S.lineFilter; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
      paint();
      b.addEventListener('click', () => { S.lineFilter = b.dataset.group; store.set('lineFilter', S.lineFilter); paint(); rollLine(); b.blur(); });
    });
    $('btnSnap').addEventListener('click', openSnapshot);
  }
  let lineTimer = 0;
  const rollLineSoon = () => { clearTimeout(lineTimer); lineTimer = setTimeout(rollLine, 200); };

  // ------------------------------------------------------------ starter hangar
  function starterBlueprints() {
    const mk = (seed, o) => Object.assign(G.randomBlueprint(seed, {}, null, { line: 'modular' }), o);
    // a stylized unit: fixed slots are locked so the rest of the kit rolls to match
    const mkLine = (seed, line, fixed, palette, extra = {}) => {
      const prev = Object.assign({ line, palette, colors: { ...MF.PALETTES[palette] } }, fixed);
      const locks = { line: 1, palette: 1 };
      for (const k in fixed) locks[k] = 1;
      return Object.assign(G.randomBlueprint(seed, locks, prev, { line }), extra);
    };
    return [
      mkLine(12, 'sd', { sdType: 'hero' }, 'Tricolor', { name: 'RX-078 Paragon', number: '078' }),
      mkLine(21, 'sd', { sdType: 'commander' }, 'Zaku Green', { name: 'MS-06 Warlord', number: '006' }),
      mkLine(33, 'sd', { sdType: 'knight' }, 'Red Comet', { name: 'XM-07 Ronin', number: '007' }),
      mkLine(2, 'human', { role: 'rogue', era: 'fantasy', head: 'hood', weaponR: 'dagger', weaponL: 'dagger' }, 'Night Blade', { name: 'Vex Nightstep' }),
      mkLine(6, 'human', { role: 'soldier', era: 'scifi', head: 'helm', shoulders: 'pauldrons', weaponR: 'mg' }, 'Ultramarine', { name: 'Sgt. Harlan "Lucky"' }),
      mkLine(3, 'human', { role: 'berserker', era: 'fantasy', head: 'horned', shoulders: 'fur', weaponR: 'greatsword' }, 'Blood Oath', { name: 'Ulfgar Oathbreaker' }),
      mk(318, { frame: 'spider', torso: 'core', head: 'none', armL: 'none', armR: 'none', shoulders: 'none', back: 'missiles', scheme: 'split', bulk: 1.2, legLen: 1.05, tall: 1.05, edge: 2.2, size: 1.15, palette: 'Rust Crab', colors: { ...MF.PALETTES['Rust Crab'] }, number: '318', name: 'TX-318 Tarantula' }),
    ];
  }

  function init() {
    buildEditor();
    bindHud();
    resizeHangar();
    const saved = store.get('hangar.v2', null);
    const starter = () => {
      // humans in front, mechs behind
      const xs = [-80, 0, 80, -54, -8, 42, 150], zs = [-26, -26, -26, 30, 30, 30, 0];
      return starterBlueprints().map((bp, i) => ({ bp, x: xs[i], z: zs[i], yaw: 0 }));
    };
    const list = Array.isArray(saved) && saved.length ? saved : starter();
    for (const s of list) {
      try { S.units.push(makeUnit(s.bp, s.x, s.z, s.yaw || 0)); } catch (e) { /* skip unreadable saved unit */ }
    }
    if (!S.units.length) S.units.push(makeUnit(G.randomBlueprint(MF.randomSeed())));
    const first = S.units.find((u) => G.lineOf(u.bp).group === 'Humans') || S.units[0];
    S.cam.x = first.x; S.cam.z = first.z;
    selectOnly(first.id);
    pushHistory();
    rollLine();
    hangar.focus();
    requestAnimationFrame(loop);
    window.MFApp = { S, toast, deploy, active, buildSheet, openExport };
  }
  init();
})();
