// Infested Planet Gauntlet: the HUD (owner: hud piece). Drawn on the 2D overlay at logical 1920x1080.
// Top-left: magenta "05 BP" + yellow segmented AMMO bar. Top: five marine cards (hex-cut frames, class name, striped HP
// bar, weapon silhouette; the selected card drops 8 px and gets a thick cyan frame; a dead card greys out with a circled X).
// Right edge: a rail of dark hex buttons with yellow biohazards (alien mutations). Bottom-left: build / squad / research.
// Bottom-right: attack-move (toggle), regroup, special weapon. Centre: fading alerts. Dialogue box (ip_02) when
// world.hud.dialogue = { portrait:'commander', text } (the rest of the HUD hides while it shows, as in the bar).
//
// Data in (all optional): world.bp, world.ammo (0..1, marines) or world.hud.ammo (override), world.marines (contract),
// world.selection (Set of ids), world.game.mutations | world.hud.mutations (number, or [{name, desc}|string]),
// world.hud.alert (string | {text, color, dur, kind}), world.hud.dialogue, world.hud.objective, world.hud.disabled {action:true}.
// Out: world.flags.attackMove / buildMode / research / special (toggles), world.flags.regroup (tick of the last request),
// IP.emit(world, 'ui', { action, ... }) for every press. Selection goes through IP.marines.select when present.
// API: IP.hud = { layout, hit(x, y), alert(world, text, opts), say(world, text, opts), close(world) }.
//
// Input: the HUD must see pointer events before the world systems (marines are earlier in script order), so init()
// puts a tiny input gate (system name 'hud-gate') at the front of world.systems. A press that lands on the HUD is handled there and marked
// ev.consumed (+ ev.hud), and every later event of that pointer is consumed too, so no move order or box select
// starts under a button. Consumed events (camera gestures) are ignored.
(function () {
  'use strict';
  const IP = window.IP;
  if (!IP) return;
  const W = 1920, H = 1080;
  const FONT = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';
  const f = (w, px) => w + ' ' + px + 'px ' + FONT;

  // ------------------------------------------------------------------ palette (sampled from ip_01 / ip_09 / ip_02)
  // r2: re-sampled from the bar (ip_01 / ip_09 / ip_02 pixel reads, see the round-2 builder notes)
  const C = {
    navy: 'rgba(11,31,46,0.93)', navySolid: '#0b1f2e', navyEdge: 'rgba(36,74,98,0.75)',
    hexFill: 'rgba(11,29,43,0.88)',                       // corner masses + rail: the ground shows faintly
    card: 'rgba(11,35,58,0.94)', cardSel: 'rgba(7,46,64,0.95)', cardDead: 'rgba(19,32,49,0.94)',
    cyan: '#05f8fe', icon: '#05f8fe', iconHot: '#b4fdff', iconOff: '#4f6573',
    text: '#d6e1e6', textDim: '#8a8ca3', label: '#dfe6ee',
    bp: '#b866ea', yellow: '#f3e72c', yellowSep: '#7c6c06', yellowDim: '#838056', yellowDimSep: '#4b4b31', ammoEdge: '#0a1420',
    hp: '#e6606a', hpBg: '#a83238', hpMiss: '#496b36', hpMissBg: '#2c4220', dead: '#9a9cb3', deadBg: '#62647b', deadMark: '#8a8ca3',
    bio: '#e9df5e', alert: '#ffe14a', danger: '#ff5f5f', good: '#5ff0a0',
    dlgPanel: '#081b29', dlgEdge: '#1b3344', dlgFrame: '#12405f', dlgFrameIn: '#0a2a42', dlgText: '#f4f6f8',
  };
  const WEAPON_COL = { sniper: '#3fe0ee', rifle: '#f2e23a', fusion: '#5ee06a', medic: '#f0605a', rocket: '#ff9a3a' };
  const CLASS_LABEL = { sniper: 'SNIPER', rifle: 'RIFLE', fusion: 'FUSION', medic: 'MEDIC', rocket: 'ROCKET' };

  // ------------------------------------------------------------------ static layout
  const HEX_R = 58, HEX_HALF = 29, HEX_H = 50;      // flat-top hexes, 116 x 100, honeycomb pitch 87 x 100
  const CARD = { x0: 437, pitch: 181, max: 6 };
  const RAIL = { cx: 1866, y0: 210, pitch: 100, max: 7 };
  const BUTTONS = {
    build: { cx: 40, cy: 960, action: 'build', icon: 'build', toggle: 'buildMode' },
    squad: { cx: 127, cy: 910, action: 'select-all', icon: 'squad' },
    research: { cx: 127, cy: 1010, action: 'research', icon: 'research', toggle: 'research' },
    attackMove: { cx: 1793, cy: 910, action: 'attack-move', icon: 'attackMove', toggle: 'attackMove' },
    regroup: { cx: 1880, cy: 960, action: 'regroup', icon: 'regroup' },
    weapon: { cx: 1793, cy: 1010, action: 'weapon', icon: 'weapon', toggle: 'special' },
  };
  const FILLERS = [[40, 1060], [127, 1110], [1880, 1060], [1793, 1110]];
  const TOP_PANEL_H = 52;
  // ammo: 10 skewed cells, 18 px pitch (16 px cell + 2 px darker seam), 31 px tall, 17 px skew (ip_01 / ip_09 pixel rows)
  const AMMO = { x: 132, y: 10, h: 31, n: 10, cw: 16, gap: 2, skew: 17 };
  const DLG = {
    portrait: { cx: 489, cy: 829, r: 144, frame: 12 },
    panel: [[600, 836], [1508, 836], [1542, 876], [1474, 1008], [576, 1008]],
    textX: 683, textY: 884, textW: 780, line: 30,
  };

  function hexPts(cx, cy, r) {
    const hr = r === HEX_R ? HEX_HALF : Math.round(r / 2), hh = r === HEX_R ? HEX_H : Math.round(r * 0.866);
    return [cx - r, cy, cx - hr, cy - hh, cx + hr, cy - hh, cx + r, cy, cx + hr, cy + hh, cx - hr, cy + hh];
  }
  // card outline relative to its left point; sel cards are 8 px taller (the ref drops the selected card)
  function cardPts(x0, sel) {
    const mid = sel ? 56 : 48, bot = sel ? 108 : 98, lp = Math.round(bot / 2);
    return [x0, lp, x0 + 29, 0, x0 + 206, 0, x0 + 176, mid, x0 + 110, mid, x0 + 82, bot, x0 + 29, bot];
  }
  // the band ends in the cards' own diagonal (29 px over 49), ~20 px short of the first card's left tip
  function topPanelPts() { return [0, 0, 424, 0, 424 - Math.round(TOP_PANEL_H * 29 / 49), TOP_PANEL_H, 0, TOP_PANEL_H]; }

  function path(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.closePath();
  }
  function inPoly(p, x, y) {
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------------ state + data access
  function hudOf(world) { return world.hud || (world.hud = {}); }
  function St(world) {
    const h = hudOf(world);
    if (!h._s) h._s = { owned: new Set(), press: null, hpPrev: {}, flash: {}, alive: {}, mutPrev: -1, mutFlash: -1, mutFlashT: 0, mutOpen: -1, mutOpenT: 0, lastTap: null, alertKey: null, alertT0: 0, dlgKey: null, dlgT0: 0, dlgShown: Infinity };
    return h._s;
  }
  const alive = (m) => m && m.state !== 'dead' && !(m.hp <= 0);
  function isSelected(world, m) {
    return alive(m) && (world.selection && (world.selection.has(m.id) || world.selection.has(m)) || !!m.selected);
  }
  function ammoOf(world) {
    const h = world.hud || {};
    if (typeof h.ammo === 'number') return IP.clamp(h.ammo, 0, 1);
    if (typeof world.ammo === 'number') return IP.clamp(world.ammo, 0, 1);
    const g = world.game;
    if (g && typeof g.ammo === 'number') return IP.clamp(g.ammo, 0, 1);
    let a = 0, mx = 0;
    for (const m of world.marines || []) if (alive(m) && m.weapon && m.weapon.maxAmmo > 0) { a += m.weapon.ammo; mx += m.weapon.maxAmmo; }
    return mx > 0 ? IP.clamp(a / mx, 0, 1) : 1;
  }
  function mutationsOf(world) {
    const g = world.game;
    let m = g && g.mutations != null ? g.mutations : world.hud && world.hud.mutations != null ? world.hud.mutations : 3;
    if (typeof m === 'number') m = Array.from({ length: Math.max(0, m | 0) }, (_, i) => ({ name: 'MUTATION ' + (i + 1), desc: '' }));
    if (!Array.isArray(m)) m = [];
    return m.slice(0, RAIL.max).map((x) => (typeof x === 'string' ? { name: x, desc: '' } : x || { name: '?' }));
  }
  function marineLabel(m) { return String(CLASS_LABEL[m.cls] || m.label || m.name || 'MARINE').toUpperCase(); }

  // ------------------------------------------------------------------ layout (exposed as IP.hud.layout for tests)
  const layout = {
    W, H, hexR: HEX_R,
    topLeft: { poly: topPanelPts(), bp: { x: 16, y: 10, w: 104, h: 36 }, ammo: { x: AMMO.x, y: AMMO.y, w: AMMO.n * (AMMO.cw + AMMO.gap) - AMMO.gap + AMMO.skew, h: AMMO.h, cells: AMMO.n } },
    cards: [], rail: [], buttons: {}, fillers: FILLERS.map(([x, y]) => ({ cx: x, cy: y, r: HEX_R, poly: hexPts(x, y, HEX_R) })),
    dialogue: null, hidden: false,
  };
  for (const k in BUTTONS) {
    const b = BUTTONS[k];
    layout.buttons[k] = { key: k, action: b.action, cx: b.cx, cy: b.cy, r: HEX_R, poly: hexPts(b.cx, b.cy, HEX_R),
      // the visible, clickable part (hexes run off the screen edges)
      x: Math.max(0, b.cx - HEX_R), y: b.cy - HEX_H, w: Math.min(W, b.cx + HEX_R) - Math.max(0, b.cx - HEX_R), h: HEX_H * 2 };
  }
  function computeLayout(world) {
    const ms = (world.marines || []).slice(0, CARD.max);
    layout.cards.length = 0;
    ms.forEach((m, i) => {
      const x0 = CARD.x0 + i * CARD.pitch, sel = isSelected(world, m);
      layout.cards.push({ i, id: m.id, x: x0, y: 0, w: 206, h: sel ? 108 : 98, selected: sel, dead: !alive(m), poly: cardPts(x0, sel), cx: x0 + 103, cy: sel ? 54 : 49 });
    });
    const muts = mutationsOf(world);
    layout.rail.length = 0;
    muts.forEach((mu, i) => {
      const cy = RAIL.y0 + i * RAIL.pitch;
      layout.rail.push({ i, name: mu.name, cx: RAIL.cx, cy, r: HEX_R, poly: hexPts(RAIL.cx, cy, HEX_R) });
    });
    const d = world.hud && world.hud.dialogue;
    layout.dialogue = d ? { portrait: DLG.portrait, panel: DLG.panel.flat(), text: { x: DLG.textX, y: DLG.textY, w: DLG.textW } } : null;
    layout.hidden = !!(d && d.hud !== true);
    return layout;
  }

  // hit test in logical coords -> { kind, key, ... } | null
  function hitTest(world, x, y) {
    const L = computeLayout(world);
    if (L.dialogue) {
      const P = DLG.portrait;
      if (inPoly(L.dialogue.panel, x, y) || inPoly(hexPts(P.cx, P.cy, P.r), x, y)) return { kind: 'dialogue', key: 'dialogue' };
      if (L.hidden) return null;
    }
    for (let i = L.cards.length - 1; i >= 0; i--) { const c = L.cards[i]; if (inPoly(c.poly, x, y)) return { kind: 'card', key: 'card' + i, i, id: c.id }; }
    if (inPoly(L.topLeft.poly, x, y)) return { kind: 'panel', key: 'topLeft' };
    for (const r of L.rail) if (inPoly(r.poly, x, y)) return { kind: 'mutation', key: 'mut' + r.i, i: r.i };
    for (const k in L.buttons) { const b = L.buttons[k]; if (inPoly(b.poly, x, y)) return { kind: 'button', key: k, action: b.action }; }
    for (const fl of L.fillers) if (inPoly(fl.poly, x, y)) return { kind: 'panel', key: 'filler' };
    return null;
  }

  // ------------------------------------------------------------------ actions
  const shiftHeld = () => IP.input.keys.has('ShiftLeft') || IP.input.keys.has('ShiftRight');
  function selectIds(world, ids, add) {
    if (IP.marines && IP.marines.select) { IP.marines.select(world, ids, add); return; }
    if (!world.selection) world.selection = new Set();
    if (!add) world.selection.clear();
    const want = ids === 'all' ? (world.marines || []).filter(alive).map((m) => m.id) : [].concat(ids);
    for (const id of want) world.selection.add(id);
    for (const m of world.marines || []) m.selected = alive(m) && world.selection.has(m.id);
  }
  function activate(world, h) {
    const S = St(world), fl = world.flags || (world.flags = {}), dis = (world.hud && world.hud.disabled) || {};
    if (h.kind === 'dialogue') { advanceDialogue(world); return; }
    if (h.kind === 'card') {
      const m = (world.marines || [])[h.i];
      if (!alive(m)) return;
      const dbl = S.lastTap && S.lastTap.key === h.key && world.time - S.lastTap.t < 0.4;
      S.lastTap = { key: h.key, t: world.time };
      if (dbl && world.camera) {
        world.camera.x = m.x; world.camera.y = m.y;
        if (IP.clampCamera) IP.clampCamera(world);
        IP.emit(world, 'ui', { action: 'focus', id: m.id });
        return;
      }
      const add = shiftHeld();
      if (add && world.selection && world.selection.has(m.id)) {
        world.selection.delete(m.id);
        m.selected = false;
        if (IP.marines && IP.marines.select) IP.marines.select(world, [], true);
      } else selectIds(world, [m.id], add);
      IP.emit(world, 'ui', { action: 'select', id: m.id, add });
      return;
    }
    if (h.kind === 'mutation') {
      S.mutOpen = S.mutOpen === h.i ? -1 : h.i;
      S.mutOpenT = world.time;
      const mu = mutationsOf(world)[h.i];
      IP.emit(world, 'ui', { action: 'mutation', index: h.i, name: mu && mu.name });
      return;
    }
    if (h.kind !== 'button') return;
    const b = BUTTONS[h.key];
    if (dis[b.action] || dis[h.key]) return;
    if (b.toggle) {
      fl[b.toggle] = !fl[b.toggle];
      if (h.key === 'attackMove' && IP.marines && IP.marines.armAttackMove) IP.marines.armAttackMove(world, fl.attackMove);
      IP.emit(world, 'ui', { action: b.action, on: fl[b.toggle] });
    } else if (b.action === 'select-all') {
      selectIds(world, 'all', false);
      IP.emit(world, 'ui', { action: 'select-all' });
    } else if (b.action === 'regroup') {
      fl.regroup = world.tick;
      IP.emit(world, 'ui', { action: 'regroup' });
    }
  }
  function advanceDialogue(world) {
    const h = hudOf(world), S = St(world), d = h.dialogue;
    if (!d) return;
    const full = String(d.text || '').length;
    if (S.dlgShown < full) { S.dlgT0 = -1e9; return; }          // first tap reveals the whole line
    IP.emit(world, 'ui', { action: 'dialogue-next', portrait: d.portrait });
    if (d.dismiss === false) return;
    const q = h.dialogueQueue;
    h.dialogue = q && q.length ? q.shift() : null;
  }

  // input gate: runs first (see header). Ignores consumed events.
  function gateInput(world, ev) {
    if (!ev || ev.consumed) return;
    const S = St(world), t = ev.type;
    if (t === 'keydown') {
      if (world.hud && world.hud.dialogue && (ev.key === 'Enter' || ev.key === 'NumpadEnter' || ev.key === 'Escape')) advanceDialogue(world);
      return;
    }
    if (ev.x == null) return;
    if (t === 'down') {
      const h = hitTest(world, ev.x, ev.y);
      if (h) {
        S.owned.add(ev.id);
        S.press = { id: ev.id, hit: h, button: ev.button || 0 };
        ev.consumed = true; ev.hud = h.key;
      } else S.owned.delete(ev.id);
      return;
    }
    if (!S.owned.has(ev.id)) return;
    if (t === 'move') return;   // hover/cursor tracking stays with everyone
    if (t === 'up') {
      const p = S.press;
      S.press = null;
      if (p && p.id === ev.id && p.button === 0) {
        const h = hitTest(world, ev.x, ev.y);
        if (h && h.key === p.hit.key) activate(world, h);
      }
    } else if (t === 'cancel') S.press = null;
    ev.consumed = true; ev.hud = true;
  }
  const GATE = { name: 'hud-gate', onInput: gateInput };

  // ------------------------------------------------------------------ icons
  function bioSprite(size, color) {
    const sc = IP.hudScale || 1, key = size + '|' + sc + '|' + color;
    bioSprite.cache = bioSprite.cache || {};
    if (bioSprite.cache[key]) return bioSprite.cache[key];
    const px = Math.ceil(size * sc);
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = px; const x = c.getContext('2d'); x.setTransform(px / 54, 0, 0, px / 54, px / 2, px / 2 + 0.8 * px / 54); return [c, x]; };
    const ang = [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6];
    const circ = (x, cx, cy, r) => { x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); };
    // crescents: outer r15 @ d11 minus inner r10.5 @ d15 (the standard construction, unit = 1/54 of the icon)
    const crescents = (rOut, rIn) => {
      const [c, x] = mk();
      for (const a of ang) {
        const [t, tx] = mk();
        tx.fillStyle = '#fff'; circ(tx, Math.cos(a) * 11, Math.sin(a) * 11, rOut);
        tx.globalCompositeOperation = 'destination-out'; circ(tx, Math.cos(a) * 15, Math.sin(a) * 15, rIn);
        x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(t, 0, 0);
      }
      return c;
    };
    const [c, x] = mk();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(crescents(15, 10.5), 0, 0);
    x.setTransform(px / 54, 0, 0, px / 54, px / 2, px / 2 + 0.8 * px / 54);
    x.globalCompositeOperation = 'destination-out';
    circ(x, 0, 0, 3.2);
    // gaps between the crescents (thin radial slits) like the real symbol
    x.lineWidth = 1.1; x.strokeStyle = '#000';
    for (const a of ang) { const b = a + Math.PI; x.beginPath(); x.moveTo(Math.cos(b) * 3, Math.sin(b) * 3); x.lineTo(Math.cos(b) * 9, Math.sin(b) * 9); x.stroke(); }
    // the ring (r 20.5, width 3.4): visible in the gaps and the crescent mouths, cut 1 unit around the crescent bodies
    const [ring, rx] = mk();
    rx.strokeStyle = '#fff'; rx.lineWidth = 3.4; rx.beginPath(); rx.arc(0, 0, 20.5, 0, Math.PI * 2); rx.stroke();
    rx.setTransform(1, 0, 0, 1, 0, 0); rx.globalCompositeOperation = 'destination-out'; rx.drawImage(crescents(16.4, 9.4), 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ring, 0, 0);
    // tint
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, px, px);
    bioSprite.cache[key] = c;
    return c;
  }

  // pixel-blocky weapon silhouettes, centred on (cx, cy); rect lists in logical px [x, y, w, h]
  const WEAPON_RECTS = {
    sniper: [[-36, -1, 12, 4], [-24, -1, 34, 3], [-15, -5, 11, 3], [-11, -3, 3, 2], [10, 0, 10, 2], [24, 0, 10, 2]],
    rifle: [[-34, -3, 22, 7], [-32, 4, 14, 2], [-14, -6, 6, 3], [-12, -1, 14, 3], [4, 0, 6, 2], [14, 1, 5, 2], [23, 2, 5, 2]],
    fusion: [[-34, -2, 26, 6], [-30, -6, 16, 4], [-8, -4, 8, 9], [0, -2, 6, 5], [8, -1, 3, 3], [12, -6, 2, 4], [12, 3, 2, 4], [15, -1, 5, 3], [11, -1, 2, 3]],
    medic: [[-30, -2, 30, 8], [-26, -6, 9, 4], [-12, -6, 9, 4], [-32, 6, 34, 2], [10, -1, 12, 4], [14, -5, 4, 12]],
    rocket: [[-34, -3, 44, 6], [-38, -4, 5, 8], [10, -4, 4, 8], [14, -3, 4, 6], [18, -2, 3, 4], [-16, 3, 4, 6]],
  };
  // r2: silhouettes are 1.2x the round-1 rects (bar rifle ~75 px long), rounded to whole pixels so they stay crisp
  const WSCALE = 1.2;
  const WEAPON_PX = {};
  for (const k in WEAPON_RECTS) WEAPON_PX[k] = WEAPON_RECTS[k].map(([x, y, w, h]) => {
    const x0 = Math.round(x * WSCALE), y0 = Math.round(y * WSCALE);
    return [x0, y0, Math.max(1, Math.round((x + w) * WSCALE) - x0), Math.max(2, Math.round((y + h) * WSCALE) - y0)];
  });
  function drawWeapon(ctx, cls, cx, cy, col) {
    const rs = WEAPON_PX[cls] || WEAPON_PX.rifle;
    ctx.fillStyle = col;
    for (const r of rs) ctx.fillRect(cx + r[0], cy + r[1], r[2], r[3]);
  }
  function drawCircleX(ctx, cx, cy, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(cx - 8, cy - 8); ctx.lineTo(cx + 8, cy + 8); ctx.moveTo(cx + 8, cy - 8); ctx.lineTo(cx - 8, cy + 8); ctx.stroke();
  }

  // cyan button icons, drawn as vector shapes in a ~60 px box centred on (cx, cy)
  const ICONS = {
    build(x) {
      // hammer: handle bottom-right -> top-left, head across the top-left end
      x.save(); x.rotate(-Math.PI / 4);
      x.fillRect(-3, -14, 6, 36);                 // handle
      x.fillRect(-12, -24, 24, 11);               // head
      x.fillRect(-14, -22, 3, 7);
      x.restore();
      // pick / spade: handle bottom-left -> top-right, pointed head
      x.save(); x.rotate(Math.PI / 4);
      x.fillRect(-3, -12, 6, 34);
      x.beginPath(); x.moveTo(0, -30); x.lineTo(10, -18); x.lineTo(6, -11); x.lineTo(-6, -11); x.lineTo(-10, -18); x.closePath(); x.fill();
      x.restore();
    },
    research(x) {
      x.fillRect(-20, 20, 34, 6);                         // base
      x.fillRect(-4, 8, 22, 4);                           // stage
      x.lineWidth = 6; x.lineCap = 'butt';
      x.beginPath(); x.arc(2, 6, 15, Math.PI * 0.55, Math.PI * 1.45); x.stroke();   // arm
      x.fillRect(-10, 16, 6, 6);
      x.save(); x.translate(6, -6); x.rotate(-0.55);
      x.fillRect(-5, -20, 11, 26);                        // tube
      x.fillRect(-7, -25, 15, 6);                         // eyepiece
      x.fillRect(-3, 6, 7, 5);                            // objective
      x.restore();
    },
    squad(x) {
      const bust = (cx, cy, k) => {
        x.beginPath();
        x.arc(cx, cy - 10 * k, 8 * k, Math.PI, 0);                       // helmet dome
        x.lineTo(cx + 8 * k, cy - 4 * k); x.lineTo(cx + 5 * k, cy - 1 * k);
        x.quadraticCurveTo(cx + 13 * k, cy, cx + 14 * k, cy + 6 * k);       // shoulder
        x.lineTo(cx + 14 * k, cy + 15 * k); x.lineTo(cx - 14 * k, cy + 15 * k); x.lineTo(cx - 14 * k, cy + 6 * k);
        x.quadraticCurveTo(cx - 13 * k, cy, cx - 5 * k, cy - 1 * k); x.lineTo(cx - 8 * k, cy - 4 * k);
        x.closePath();
        x.save(); x.lineWidth = 3.5; x.lineJoin = 'round'; x.strokeStyle = '#0b1f2e'; x.stroke(); x.restore();
        x.fill();
      };
      bust(-5, -13, 0.8);
      bust(10, -2, 1);
      bust(-8, 12, 0.9);
    },
    attackMove(x) {
      const sword = (flip) => {
        x.save(); x.scale(flip, 1); x.rotate(-Math.PI / 4);
        x.beginPath(); x.moveTo(0, -27); x.lineTo(4, -21); x.lineTo(4, 4); x.lineTo(-4, 4); x.lineTo(-4, -21); x.closePath(); x.fill();
        x.fillRect(-9, 4, 18, 4);     // guard
        x.fillRect(-2.5, 8, 5, 8);    // grip
        x.fillRect(-4, 15, 8, 4);     // pommel
        x.restore();
      };
      x.save(); x.translate(0, -8); sword(1); sword(-1); x.restore();
      // up arrow below
      x.beginPath(); x.moveTo(0, 12); x.lineTo(10, 21); x.lineTo(4, 21); x.lineTo(4, 28); x.lineTo(-4, 28); x.lineTo(-4, 21); x.lineTo(-10, 21); x.closePath(); x.fill();
    },
    regroup(x) {
      x.lineWidth = 8; x.lineCap = 'butt';
      for (const a0 of [Math.PI * 0.12, Math.PI * 1.12]) {
        x.beginPath(); x.arc(0, 0, 17, a0, a0 + Math.PI * 0.62); x.stroke();
        const a = a0 + Math.PI * 0.62, ex = Math.cos(a) * 17, ey = Math.sin(a) * 17, tx = -Math.sin(a), ty = Math.cos(a);
        const nx = Math.cos(a), ny = Math.sin(a);
        x.beginPath(); x.moveTo(ex + nx * 10, ey + ny * 10); x.lineTo(ex - nx * 10, ey - ny * 10); x.lineTo(ex + tx * 12, ey + ty * 12); x.closePath(); x.fill();
      }
    },
    weapon(x) {
      x.save(); x.rotate(-Math.PI / 4);
      x.fillRect(-26, -3.5, 38, 7);                                      // tube
      x.beginPath(); x.moveTo(12, -6); x.lineTo(22, -6); x.quadraticCurveTo(34, -3, 36, 0); x.quadraticCurveTo(34, 3, 22, 6); x.lineTo(12, 6); x.closePath(); x.fill(); // warhead
      x.beginPath(); x.moveTo(-26, -3.5); x.lineTo(-33, -7); x.lineTo(-33, 7); x.lineTo(-26, 3.5); x.closePath(); x.fill(); // flared back
      x.fillRect(-12, 3, 5, 9);                                          // grip
      x.fillRect(-2, 3, 4, 6);                                           // fore grip
      x.restore();
    },
  };
  // r2 sizes measured on ip_09: squad 60 px tall, swords+arrow 52, rocket ~65 px box, hammer/pick ~50 with 7 px strokes
  const ICON_SCALE = { build: 1.2, squad: 1.25, attackMove: 1.21, weapon: 1.22, research: 1, regroup: 1.1 };
  function drawIcon(ctx, name, cx, cy, col) {
    ctx.save();
    ctx.translate(cx, cy);
    const k = ICON_SCALE[name] || 1;
    if (k !== 1) ctx.scale(k, k);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    ICONS[name](ctx);
    ctx.restore();
  }

  // ------------------------------------------------------------------ drawing pieces
  // BP digits: the bar's own techno numerals (30 x 30 boxes, ~6 px strokes, rounded outer corners, slashed zero).
  // Polylines on a 0..1 grid, stroked on the centre line of the box inset by half a stroke.
  const DIGITS = {
    0: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], 1: [[[0.25, 0.18], [0.6, 0], [0.6, 1]]],
    2: [[[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1]]], 3: [[[0, 0], [1, 0], [1, 1], [0, 1]], [[0.3, 0.5], [1, 0.5]]],
    4: [[[0, 0], [0, 0.55], [1, 0.55]], [[1, 0], [1, 1]]], 5: [[[1, 0], [0, 0], [0, 0.5], [1, 0.5], [1, 1], [0, 1]]],
    6: [[[1, 0], [0, 0], [0, 1], [1, 1], [1, 0.5], [0, 0.5]]], 7: [[[0, 0], [1, 0], [1, 1]]],
    8: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], [[0, 0.5], [1, 0.5]]], 9: [[[1, 0.5], [0, 0.5], [0, 0], [1, 0], [1, 1], [0, 1]]],
  };
  const DIG = { w: 30, h: 30, sw: 7, pitch: 36 };
  function drawDigit(ctx, ch, x, y, col) {
    const segs = DIGITS[ch];
    if (!segs) return;
    const i = DIG.sw / 2, ww = DIG.w - DIG.sw, hh = DIG.h - DIG.sw;
    ctx.strokeStyle = col; ctx.lineWidth = DIG.sw; ctx.lineJoin = 'round'; ctx.lineCap = 'square';
    for (const sg of segs) {
      ctx.beginPath();
      sg.forEach(([u, v], k) => { const px = x + i + u * ww, py = y + i + v * hh; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      if (sg.length === 5 && sg[0][0] === sg[4][0] && sg[0][1] === sg[4][1]) ctx.closePath();
      ctx.stroke();
    }
    if (ch === '0') {
      // the slash joins the inner bottom-left and top-right corners
      ctx.save(); ctx.beginPath(); ctx.rect(x + DIG.sw, y + DIG.sw, DIG.w - 2 * DIG.sw, DIG.h - 2 * DIG.sw); ctx.clip();
      ctx.lineCap = 'butt'; ctx.lineWidth = DIG.sw;
      ctx.beginPath(); ctx.moveTo(x + DIG.sw - 2, y + DIG.h - DIG.sw + 2); ctx.lineTo(x + DIG.w - DIG.sw + 2, y + DIG.sw - 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawTopLeft(ctx, world) {
    ctx.fillStyle = C.navy;
    path(ctx, topPanelPts()); ctx.fill();
    // BP: two violet techno digits (slashed zero), "BP" small and thin
    const bp = Math.max(0, Math.floor(world.bp || 0));
    const s = bp < 100 ? String(bp).padStart(2, '0') : String(bp);
    let x = 17;
    for (const ch of s) { drawDigit(ctx, ch, x, 10, C.bp); x += DIG.pitch; }
    const base = 40;
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(400, 19);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    ctx.fillStyle = C.label;
    ctx.fillText('BP', x + 1, base);
    // ammo: skewed cells with a darker 2 px seam; yellow = loaded, olive = spent; 1 px dark outline round the bar
    const a = ammoOf(world), A = AMMO, filled = a * A.n, pitch = A.cw + A.gap;
    const barW = A.n * pitch - A.gap;
    const outline = [A.x, A.y + A.h, A.x + A.skew, A.y, A.x + A.skew + barW, A.y, A.x + barW, A.y + A.h];
    ctx.save();
    ctx.strokeStyle = C.ammoEdge; ctx.lineWidth = 2; path(ctx, outline); ctx.stroke();   // 1 px shows outside the fill
    path(ctx, outline); ctx.clip();
    for (let i = 0; i < A.n; i++) {
      const x0 = A.x + i * pitch;
      let k = IP.clamp(filled - i, 0, 1);
      if (k < 0.02) k = 0; else if (k > 0.98) k = 1;
      const seam = k > 0 ? C.yellowSep : C.yellowDimSep;
      // the cell plus its trailing seam in the seam colour, then the cell body
      ctx.fillStyle = seam;
      path(ctx, [x0, A.y + A.h, x0 + A.skew, A.y, x0 + A.skew + pitch, A.y, x0 + pitch, A.y + A.h]); ctx.fill();
      const cell = [x0, A.y + A.h, x0 + A.skew, A.y, x0 + A.skew + A.cw, A.y, x0 + A.cw, A.y + A.h];
      ctx.fillStyle = k >= 1 ? C.yellow : C.yellowDim;
      path(ctx, cell); ctx.fill();
      if (k > 0 && k < 1) {
        // partial cell: the lower part fills first (the bar's notch)
        ctx.save(); path(ctx, cell); ctx.clip();
        ctx.fillStyle = C.yellow;
        const top = Math.round(A.y + A.h * (1 - k));
        ctx.fillRect(x0, top, A.cw + A.skew, A.y + A.h - top);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.font = f(400, 19);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.fillStyle = a <= 0.001 && ((world.time * 2) | 0) % 2 ? C.danger : C.label;
    ctx.fillText('AMMO', A.x + barW + A.skew + 6, base);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const obj = world.hud && world.hud.objective;
    if (obj) {
      ctx.font = f(500, 17);
      const tw = Math.ceil(ctx.measureText(String(obj).toUpperCase()).width);
      ctx.fillStyle = 'rgba(11,31,46,0.78)';
      path(ctx, [0, TOP_PANEL_H + 4, tw + 34, TOP_PANEL_H + 4, tw + 22, TOP_PANEL_H + 30, 0, TOP_PANEL_H + 30]); ctx.fill();
      ctx.fillStyle = '#8fd3e3';
      ctx.fillText(String(obj).toUpperCase(), 16, TOP_PANEL_H + 23);
    }
  }

  function stripes(ctx, x, y, w, h, frac, colA, bgA, colB, bgB) {
    // a skewed bar of slanted stripes (bar: ~7 px pitch, 5 px light + 2 px dark seam); [0, frac) in colA, the rest in colB
    const sk = 6, pitch = 7, sw = 5;
    const outline = [x, y + h, x + sk, y, x + w + sk, y, x + w, y + h];
    const split = Math.round(x + w * IP.clamp(frac, 0, 1));
    ctx.save();
    path(ctx, outline); ctx.clip();
    ctx.fillStyle = bgA; ctx.fillRect(x, y, split - x + sk, h);
    ctx.fillStyle = bgB; ctx.fillRect(split + sk, y, x + w + sk - split, h);
    for (let sx = x - pitch; sx < x + w + sk; sx += pitch) {
      ctx.fillStyle = sx + sw / 2 < split ? colA : colB;
      path(ctx, [sx, y + h, sx + sk, y, sx + sk + sw, y, sx + sw, y + h]); ctx.fill();
    }
    ctx.restore();
  }

  function drawCards(ctx, world, hover) {
    const S = St(world);
    const ms = (world.marines || []).slice(0, CARD.max);
    // unselected first so a selected card's thick frame sits on top
    const order = layout.cards.slice().sort((a, b) => (a.selected ? 1 : 0) - (b.selected ? 1 : 0));
    for (const c of order) {
      const m = ms[c.i];
      if (!m) continue;
      const sel = c.selected, dead = c.dead, dy = sel ? 8 : 0, x0 = c.x;
      const hot = hover && hover.key === 'card' + c.i;
      ctx.save();
      path(ctx, c.poly);
      ctx.fillStyle = sel ? C.cardSel : dead ? C.cardDead : C.card;
      ctx.fill();
      ctx.clip();
      if (hot && !dead) { ctx.fillStyle = 'rgba(80,200,230,0.10)'; ctx.fillRect(x0, 0, 220, 120); }
      // damage flash
      const fl = S.flash[c.i];
      if (fl != null && world.time - fl < 0.35) { ctx.fillStyle = 'rgba(255,70,70,' + (0.35 * (1 - (world.time - fl) / 0.35)).toFixed(3) + ')'; ctx.fillRect(x0, 0, 220, 120); }
      // selected: a 7 px cyan frame inside the edge (a 14 px stroke clipped to the card); unselected cards have no outline
      if (sel) { ctx.strokeStyle = C.cyan; ctx.lineWidth = 14; path(ctx, c.poly); ctx.stroke(); }
      ctx.restore();
      // name
      ctx.font = f(400, 20);
      ctx.textBaseline = 'alphabetic';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
      ctx.fillStyle = dead ? C.textDim : C.text;
      ctx.fillText(dead ? 'DEAD' : marineLabel(m), x0 + 32, 20 + dy);
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      // hp: 14 px tall at y 26..39 (selected +8)
      const hp = dead ? 1 : IP.clamp((m.hp || 0) / (m.maxHp || 1), 0, 1);
      if (dead) stripes(ctx, x0 + 18, 26 + dy, 152, 14, 1, C.dead, C.deadBg, C.dead, C.deadBg);
      else stripes(ctx, x0 + 18, 26 + dy, 152, 14, hp, hp < 0.25 && ((world.time * 3) | 0) % 2 ? '#ff8a8a' : C.hp, C.hpBg, C.hpMiss, C.hpMissBg);
      // weapon / dead mark in the lower tab
      const cls = (m.weapon && m.weapon.kind) || m.cls;
      if (dead) drawCircleX(ctx, x0 + 54, 74 + dy, C.deadMark);
      else drawWeapon(ctx, cls, x0 + 54, 71 + dy, WEAPON_COL[cls] || C.icon);
    }
  }

  function fillHexes(ctx, hexes, style) {
    ctx.beginPath();
    for (const p of hexes) { ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); }
    ctx.fillStyle = style; ctx.fill();
  }
  function edgeHex(ctx, p, col, w) {
    ctx.save(); path(ctx, p); ctx.clip();
    ctx.strokeStyle = col; ctx.lineWidth = w * 2; path(ctx, p); ctx.stroke();
    ctx.restore();
  }

  function drawRail(ctx, world, hover) {
    const S = St(world);
    if (!layout.rail.length) return;
    fillHexes(ctx, layout.rail.map((r) => r.poly), C.hexFill);
    const sz = 64, spr = bioSprite(sz, C.bio);   // bar: ~62 px biohazards
    for (const r of layout.rail) {
      const hot = hover && hover.key === 'mut' + r.i, open = S.mutOpen === r.i;
      if (hot || open) { ctx.fillStyle = open ? 'rgba(233,223,94,0.12)' : 'rgba(80,200,230,0.08)'; path(ctx, r.poly); ctx.fill(); }
      if (open) edgeHex(ctx, r.poly, 'rgba(233,223,94,0.8)', 2);   // the bar's rail hexes carry no outline
      if (S.mutFlash === r.i && world.time - S.mutFlashT < 2.4) {
        const k = 1 - (world.time - S.mutFlashT) / 2.4, pulse = 0.5 + 0.5 * Math.sin((world.time - S.mutFlashT) * 12);
        edgeHex(ctx, r.poly, 'rgba(233,223,94,' + (k * (0.4 + 0.6 * pulse)).toFixed(3) + ')', 4);
      }
      ctx.drawImage(spr, r.cx - 4 - sz / 2, r.cy - sz / 2, sz, sz);
    }
    // info panel for the opened mutation
    if (S.mutOpen >= 0 && S.mutOpen < layout.rail.length) {
      if (world.time - S.mutOpenT > 6) { S.mutOpen = -1; return; }
      const r = layout.rail[S.mutOpen], mu = mutationsOf(world)[S.mutOpen] || {};
      const name = String(mu.name || 'MUTATION').toUpperCase(), desc = String(mu.desc || '');
      ctx.font = f(600, 20);
      let w = ctx.measureText(name).width;
      ctx.font = f(500, 16);
      const lines = wrap(ctx, desc, 300);
      for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
      w = Math.ceil(w) + 36;
      const h = 40 + lines.length * 20, x1 = r.cx - HEX_R - 6, x0 = x1 - w, y0 = Math.round(r.cy - h / 2);
      ctx.fillStyle = C.navy;
      path(ctx, [x0 + 12, y0, x1, y0, x1, y0 + h, x0 + 12, y0 + h, x0, y0 + h / 2]); ctx.fill();
      ctx.fillStyle = C.bio; ctx.font = f(600, 20); ctx.fillText(name, x0 + 22, y0 + 27);
      ctx.fillStyle = C.text; ctx.font = f(500, 16);
      lines.forEach((l, i) => ctx.fillText(l, x0 + 22, y0 + 49 + i * 20));
    }
  }

  function drawCorners(ctx, world, hover, pressKey) {
    const fl = world.flags || {}, dis = (world.hud && world.hud.disabled) || {};
    const all = FILLERS.map(([x, y]) => hexPts(x, y, HEX_R));
    for (const k in layout.buttons) all.push(layout.buttons[k].poly);
    fillHexes(ctx, all, C.hexFill);
    for (const k in layout.buttons) {
      const b = layout.buttons[k], def = BUTTONS[k];
      const on = def.toggle && fl[def.toggle], off = dis[def.action] || dis[k];
      const hot = hover && hover.key === k, pressed = pressKey === k;
      if (on) { ctx.fillStyle = 'rgba(22,240,236,0.16)'; path(ctx, b.poly); ctx.fill(); edgeHex(ctx, b.poly, C.cyan, 3); }
      else if (pressed) { ctx.fillStyle = 'rgba(80,200,230,0.18)'; path(ctx, b.poly); ctx.fill(); }
      else if (hot && !off) { ctx.fillStyle = 'rgba(80,200,230,0.08)'; path(ctx, b.poly); ctx.fill(); }
      // icons sit in the visible part of the edge hexes
      const ix = b.cx < 60 ? b.cx + 2 : b.cx > W - 60 ? b.cx - 2 : b.cx;
      drawIcon(ctx, def.icon, ix, b.cy, off ? C.iconOff : on ? C.iconHot : C.icon);
    }
  }

  function wrap(ctx, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const t = line + word;
        if (line && ctx.measureText(t.trimEnd()).width > maxW) { out.push(line.trimEnd()); line = word.trimStart(); }
        else line = t;
      }
      if (line) out.push(line.trimEnd());
    }
    return out;
  }

  function drawAlert(ctx, world) {
    const h = world.hud, S = St(world);
    let a = h && h.alert;
    if (!a) return;
    if (typeof a === 'string') a = { text: a };
    const key = a.text + '|' + (a.t != null ? a.t : '') + '|' + (a._id || '');
    if (S.alertKey !== key) { S.alertKey = key; S.alertT0 = a.t != null ? a.t : world.time; }
    const dur = a.dur != null ? a.dur : 2.6, t = world.time - S.alertT0;
    const alpha = t < 0.15 ? t / 0.15 : t > dur ? 1 - (t - dur) / 0.6 : 1;
    if (alpha <= 0) { if (t > dur + 0.6 && h.alert === a) h.alert = null; return; }
    const txt = String(a.text).toUpperCase();
    ctx.save();
    ctx.globalAlpha = IP.clamp(alpha, 0, 1);
    ctx.font = f(700, 30);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '2px';
    const tw = Math.ceil(ctx.measureText(txt).width), cy = 172, hw = Math.round(tw / 2) + 46;
    ctx.fillStyle = 'rgba(8,24,36,0.82)';
    path(ctx, [W / 2 - hw, cy, W / 2 - hw + 16, cy - 24, W / 2 + hw - 16, cy - 24, W / 2 + hw, cy, W / 2 + hw - 16, cy + 24, W / 2 - hw + 16, cy + 24]);
    ctx.fill();
    const col = a.color || (a.kind === 'danger' ? C.danger : a.kind === 'good' ? C.good : a.kind === 'info' ? C.icon : C.alert);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha *= 0.6;
    ctx.beginPath(); ctx.moveTo(W / 2 - hw + 16, cy - 23.5); ctx.lineTo(W / 2 + hw - 16, cy - 23.5); ctx.moveTo(W / 2 - hw + 16, cy + 23.5); ctx.lineTo(W / 2 + hw - 16, cy + 23.5); ctx.stroke();
    ctx.globalAlpha = IP.clamp(alpha, 0, 1);
    ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, W / 2, cy + 1);
    ctx.restore();
  }

  // ------------------------------------------------------------------ painted commander portrait (procedural, cached)
  // ip_02: a painted, rim-lit commander in three-quarter view (face turned to his right), swept-back grey hair, short
  // grey beard, cigar at the mouth corner with a smoke wisp, light grey high-collar jacket over a dark collar, a blue
  // shoulder plate, against a soft light grey-blue interior. Drawn once at 2x into a canvas: smooth shapes, hard
  // 3-tone cel shading (base / shadow / highlight), a cool rim light on the left edges, then ~7% brush-stroke texture.
  // Real art can replace it: dialogue.portrait may be an Image/canvas, or IP.hud.portraits[name] = Image.
  const portraitArt = {};
  const PR = { w: 133, h: 116, k: 2 };          // half extents of the cached canvas (covers the inner hex), 2x density
  function paintCommander() {
    const k = PR.k, c = document.createElement('canvas');
    c.width = PR.w * 2 * k; c.height = PR.h * 2 * k;
    const x = c.getContext('2d');
    const rng = IP.mulberry32(20461);
    const R = (a, b) => a + (b - a) * rng();
    x.setTransform(k, 0, 0, k, PR.w * k, PR.h * k);
    // smooth closed (or open) curve through the midpoints of a control polygon
    const blob = (pts, open) => {
      x.beginPath();
      const n = pts.length, mid = (i, j) => [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
      if (open) {
        x.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < n - 1; i++) { const m = mid(i, i + 1); x.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
        x.lineTo(pts[n - 1][0], pts[n - 1][1]);
        return;
      }
      const m0 = mid(n - 1, 0); x.moveTo(m0[0], m0[1]);
      for (let i = 0; i < n; i++) { const m = mid(i, (i + 1) % n); x.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
      x.closePath();
    };
    const fillBlob = (pts, col, soft) => { if (soft) x.filter = 'blur(' + soft + 'px)'; blob(pts); x.fillStyle = col; x.fill(); if (soft) x.filter = 'none'; };
    const within = (pts, fn) => { x.save(); blob(pts); x.clip(); fn(); x.restore(); };
    const strokes = (n, area, col, len, w, ang, jit, alpha) => {
      x.strokeStyle = col; x.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const px = R(area[0], area[2]), py = R(area[1], area[3]), a = ang + R(-jit, jit), l = R(len * 0.5, len);
        x.globalAlpha = R(alpha * 0.5, alpha); x.lineWidth = R(w * 0.6, w);
        x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + R(-2, 2), py + Math.sin(a) * l * 0.5 + R(-2, 2), px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
      x.globalAlpha = 1;
    };

    // --- background: cool light grey-blue interior, darker at the left, a bright window glow behind the smoke
    const bg = x.createLinearGradient(-130, -60, 130, 60);
    bg.addColorStop(0, '#4a5470'); bg.addColorStop(0.4, '#7c87a4'); bg.addColorStop(1, '#6f7a96');
    x.fillStyle = bg; x.fillRect(-PR.w, -PR.h, PR.w * 2, PR.h * 2);
    x.filter = 'blur(8px)';
    x.fillStyle = '#c4cbe2'; x.fillRect(46, -120, 30, 104);                     // pale wall panels at the right
    x.fillStyle = '#98a2c0'; x.fillRect(86, -120, 56, 150);
    x.fillStyle = '#7d86a4'; x.fillRect(78, -40, 70, 14);
    x.fillStyle = '#e6eafc'; x.beginPath(); x.ellipse(-84, 26, 30, 56, 0.2, 0, Math.PI * 2); x.fill();   // window glow
    x.fillStyle = '#464960'; x.fillRect(-150, -130, 54, 116);                   // dark doorway at the far left
    x.fillStyle = '#6a7190'; x.fillRect(-140, 54, 64, 80);
    x.filter = 'none';
    // broad, soft brush dabs (painted, not scratched)
    const dabs = (n, area, cols, len, w, ang, jit, alpha, blur) => {
      if (blur) x.filter = 'blur(' + blur + 'px)';
      strokesMulti(n, area, cols, len, w, ang, jit, alpha);
      if (blur) x.filter = 'none';
    };
    function strokesMulti(n, area, cols, len, w, ang, jit, alpha) {
      x.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const px = R(area[0], area[2]), py = R(area[1], area[3]), a = ang + R(-jit, jit), l = R(len * 0.5, len);
        x.strokeStyle = cols[(rng() * cols.length) | 0]; x.globalAlpha = R(alpha * 0.5, alpha); x.lineWidth = R(w * 0.6, w);
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
      x.globalAlpha = 1;
    }
    dabs(70, [-PR.w, -PR.h, PR.w, PR.h], ['#dfe4f6', '#4a4f6a', '#9aa4c4'], 40, 16, -0.5, 0.6, 0.2, 4);

    // the figure fills the frame like the bar's (head ~150 px with hair): scale 1.1 about the collar
    x.save(); x.translate(-6, 20); x.scale(1.08, 1.08);
    // --- jacket (light grey, lit from the left) with a dark high collar and a blue shoulder plate at the right
    const JACKET = [[-140, 140], [-128, 78], [-100, 58], [-60, 46], [-30, 40], [26, 36], [62, 36], [98, 46], [120, 68], [140, 140]];
    fillBlob(JACKET, '#76778f');
    within(JACKET, () => {
      fillBlob([[-140, 50], [-64, 44], [-38, 66], [-50, 140], [-140, 140]], '#9a9ab6', 1.2);         // lit lapel plane
      fillBlob([[-18, 54], [30, 44], [70, 54], [70, 140], [-6, 140]], '#4a5260', 1.2);                // shadowed right side
      x.lineCap = 'round';
      x.strokeStyle = '#363e4a'; x.lineWidth = 3.5;                                                   // lapel edge + fold
      blob([[-46, 52], [-38, 80], [-26, 118]], true); x.stroke();
      blob([[-92, 70], [-78, 96], [-74, 130]], true); x.stroke();
      x.strokeStyle = '#c8c8de'; x.lineWidth = 2;
      blob([[-50, 52], [-42, 80], [-31, 118]], true); x.stroke();
      blob([[-110, 66], [-120, 90]], true); x.stroke();
      dabs(90, [-130, 40, 120, 116], ['#f2f4fa', '#40445a'], 12, 5, 1.25, 0.3, 0.12, 0.8);
    });
    const PAD = [[56, 36], [94, 38], [118, 56], [130, 96], [124, 130], [88, 120], [66, 92], [58, 60]];
    fillBlob(PAD, '#6f90bc');
    within(PAD, () => {
      fillBlob([[84, 68], [134, 72], [134, 132], [88, 126]], '#41608c', 1);
      x.strokeStyle = '#2c4468'; x.lineWidth = 3;
      for (const yy of [62, 80, 98]) { x.beginPath(); x.moveTo(58, yy); x.lineTo(132, yy + 10); x.stroke(); }
      x.strokeStyle = '#b4d0f0'; x.lineWidth = 2.5;
      x.beginPath(); x.moveTo(60, 42); x.quadraticCurveTo(94, 38, 116, 58); x.stroke();
    });
    const COLLAR = [[-30, 46], [-26, 28], [-4, 32], [20, 26], [28, 42], [20, 76], [-2, 94], [-20, 78]];
    fillBlob(COLLAR, '#1d2232');
    within(COLLAR, () => {
      fillBlob([[-36, 28], [-22, 30], [-16, 62], [-26, 84], [-38, 62]], '#3c445a', 0.8);             // lit collar rim
      x.strokeStyle = '#0d1018'; x.lineWidth = 2; x.beginPath(); x.moveTo(-24, 50); x.quadraticCurveTo(0, 58, 24, 46); x.stroke();
    });

    // --- neck (mostly in the jaw's shadow)
    fillBlob([[-26, 10], [20, 10], [24, 40], [0, 48], [-26, 42]], '#8a5f5c');
    fillBlob([[-28, 16], [-14, 16], [-12, 40], [-28, 40]], '#bb9c99', 1);

    // --- ear (near side)
    fillBlob([[30, -22], [42, -26], [47, -10], [43, 6], [32, 4]], '#bb8b89');
    fillBlob([[35, -16], [41, -18], [42, -4], [36, -2]], '#7a4e4c', 0.8);

    // --- face: three-quarter view; the face front is the left contour
    const FACE = [[-44, -58], [-48, -34], [-50, -14], [-47, 8], [-39, 30], [-23, 48], [-4, 53], [14, 41], [29, 18], [35, -8], [38, -44], [22, -70], [-14, -74]];
    fillBlob(FACE, '#c99a94');
    within(FACE, () => {
      // light plane on the front (forehead, cheek, nose bridge): soft gradient into the base, then the hard 3 tones
      const lg = x.createLinearGradient(-50, 0, 10, 0);
      lg.addColorStop(0, 'rgba(236,208,204,0.9)'); lg.addColorStop(1, 'rgba(236,208,204,0)');
      x.fillStyle = lg; x.fillRect(-60, -80, 80, 140);
      // shadow side: the near cheek plane turning away, under the cheekbone, the jaw
      fillBlob([[16, -80], [12, -54], [22, -34], [18, -10], [10, 6], [16, 24], [6, 42], [-10, 62], [60, 62], [60, -80]], '#7e5250', 1.2);
      fillBlob([[-4, 2], [12, -2], [14, 22], [-2, 32]], '#a8726e', 1.6);
      // eye sockets and the brow's cast shadow
      fillBlob([[-48, -21], [-36, -26], [-24, -20], [-26, -9], [-40, -7], [-48, -12]], '#8e625e', 1);
      fillBlob([[-14, -21], [4, -27], [20, -22], [18, -7], [0, -5], [-12, -9]], '#6a4440', 1);
      // nose side shadow
      fillBlob([[-21, -18], [-14, 2], [-17, 10], [-27, 10], [-22, -2]], '#74484a', 0.8);
      fillBlob([[-34, 8], [-18, 8], [-20, 13], [-32, 13]], '#7a4c4c', 1);
      // highlights: brow ridge, nose bridge, far cheekbone (hard but small)
      fillBlob([[-46, -50], [-30, -56], [-14, -52], [-24, -44], [-42, -40]], '#ecd0cc', 1.6);
      fillBlob([[-26, -24], [-22, -24], [-28, 2], [-32, 2]], '#f4dcd8', 0.6);
      fillBlob([[-50, -6], [-41, -6], [-40, 2], [-49, 6]], '#e6c4c0', 0.8);
      dabs(70, [-56, -76, 44, 56], ['#f6e0dc', '#5a3434'], 6, 3, 0.7, 0.6, 0.12, 0.6);
      // smile line from the nose wing to the mouth corner
      x.strokeStyle = '#6a4232'; x.lineWidth = 2; x.lineCap = 'round';
      blob([[-17, 8], [-12, 14], [-9, 22]], true); x.stroke();
      // forehead creases
      x.strokeStyle = 'rgba(110,70,52,0.55)'; x.lineWidth = 1.5;
      blob([[-38, -38], [-24, -41], [-8, -38]], true); x.stroke();
    });

    // --- beard: short grey stubble-beard along the jaw and chin; skin shows through at its upper edge
    const BEARD = [[34, -4], [34, 16], [22, 38], [4, 52], [-18, 52], [-32, 42], [-43, 24], [-46, 12], [-38, 14], [-28, 14], [-14, 12], [0, 14], [10, 18], [18, 12], [26, 2]];
    x.globalAlpha = 0.9; fillBlob(BEARD, '#74605f', 0.8); x.globalAlpha = 1;
    within(BEARD, () => {
      fillBlob([[10, 12], [40, -6], [40, 60], [-4, 60]], '#4e3c3c', 1.2);
      fillBlob([[-48, 10], [-34, 16], [-28, 42], [-44, 32]], '#9a8c8e', 1.2);
      dabs(70, [-48, 10, 36, 54], ['#cfc8cc', '#a8a0a6'], 5, 1.4, 1.5, 0.4, 0.5, 0);
      dabs(40, [-48, 10, 36, 54], ['#3d383c'], 5, 1.4, 1.5, 0.4, 0.4, 0);
    });
    // mustache
    fillBlob([[-36, 13], [-24, 9], [-8, 10], [6, 14], [8, 18], [-10, 16], [-26, 17], [-38, 19]], '#5e4c4e', 0.4);
    dabs(18, [-34, 10, 4, 16], ['#b8b0b6'], 4, 1.2, 0.2, 0.3, 0.6, 0);
    // smirking mouth (rises at the near corner)
    fillBlob([[-28, 21], [-14, 20], [0, 18], [9, 13], [6, 21], [-6, 27], [-20, 27]], '#2e1a1c', 0.3);   // grin
    fillBlob([[-20, 21.5], [-8, 20.5], [3, 18], [1, 21], [-10, 22.5], [-19, 23]], '#b4a29e', 0.4);          // teeth in shade
    x.strokeStyle = 'rgba(200,150,146,0.8)'; x.lineWidth = 2; x.lineCap = 'round'; blob([[-20, 29], [-10, 29], [-1, 27]], true); x.stroke();

    // --- nose tip + nostril
    fillBlob([[-31, -1], [-24, -4], [-19, 4], [-25, 9], [-33, 6]], '#e4c0ba', 0.4);
    fillBlob([[-26, 6], [-20, 5], [-19, 9], [-25, 10]], '#4a2c22', 0.3);
    x.fillStyle = '#fbe6d2'; x.fillRect(-30, -1, 3, 2);

    // --- eyes: narrowed, mostly in shadow, a glint each; heavy brows (far one raised)
    // squinting: a sliver of white, dark iris, heavy upper lids, brows pulled down toward the nose
    fillBlob([[-43, -12], [-37, -14], [-31, -12], [-37, -10.5]], '#b8aaa4', 0.3);
    fillBlob([[-39, -14], [-35, -14], [-35, -10.5], [-39, -10.5]], '#22161a', 0.2);
    fillBlob([[-8, -12], [0, -15], [10, -13], [2, -10.5]], '#a49692', 0.3);
    fillBlob([[-1, -15], [4, -15], [4, -10.5], [-1, -10.5]], '#1c1216', 0.2);
    x.fillStyle = '#f4f0f0'; x.fillRect(-37, -13.5, 1.5, 1.5); x.fillRect(1, -14, 1.5, 1.5);
    x.strokeStyle = '#2a1a1c'; x.lineWidth = 3; x.lineCap = 'round';
    blob([[-45, -12], [-37, -16], [-29, -13]], true); x.stroke();
    blob([[-11, -12], [0, -17], [12, -14]], true); x.stroke();
    fillBlob([[-54, -26], [-42, -30], [-26, -24], [-24, -19], [-40, -22], [-52, -21]], '#3e3436', 0.4);
    fillBlob([[-14, -19], [2, -25], [24, -24], [24, -20], [4, -20], [-12, -15]], '#342c30', 0.4);
    dabs(16, [-50, -30, 22, -18], ['#8e8890'], 5, 1.2, 0.1, 0.3, 0.6, 0);
    // crow's feet + cheek crease of the grin
    x.strokeStyle = 'rgba(100,60,58,0.7)'; x.lineWidth = 1.4;
    blob([[14, -12], [19, -8], [20, -3]], true); x.stroke();
    blob([[-46, -8], [-49, -4]], true); x.stroke();

    // --- hair: a tall swept-back quiff, dark brown-grey roots, grey-white tips; shorter and greyer at the side
    const HAIR = [[-46, -48], [-56, -68], [-60, -90], [-48, -94], [-44, -108], [-30, -100], [-18, -112], [-6, -101], [10, -106], [22, -96], [40, -80], [47, -54], [44, -28], [37, -30], [33, -46], [24, -58], [6, -64], [-16, -66], [-34, -60]];
    fillBlob(HAIR, '#3e3c4a');
    within(HAIR, () => {
      fillBlob([[16, -72], [52, -72], [52, -20], [30, -30]], '#6e5d63', 1.2);                         // short side
      // volume: lighter crown, darker roots at the hairline
      const hg = x.createLinearGradient(0, -106, 0, -56);
      hg.addColorStop(0, 'rgba(140,146,166,0.7)'); hg.addColorStop(0.55, 'rgba(90,92,110,0.35)'); hg.addColorStop(1, 'rgba(40,32,30,0.4)');
      x.fillStyle = hg; x.fillRect(-60, -110, 90, 60);
      x.lineCap = 'round';
      for (let i = 0; i < 46; i++) {
        // clumps sweeping from the hairline up and back toward the crown
        const t = rng(), sx = -48 + t * 66, sy = -56 - t * 8 + R(-3, 3), ex = sx + R(24, 40), ey = sy - R(28, 42);
        const r = rng();
        x.strokeStyle = r < 0.22 ? '#c4c6d2' : r < 0.6 ? '#7c7c90' : '#26242e';
        x.globalAlpha = R(0.55, 0.95); x.lineWidth = R(1.6, 3.6);
        x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(sx - R(2, 8), sy - R(20, 30), ex, ey); x.stroke();
      }
      x.globalAlpha = 1;
      dabs(36, [16, -70, 48, -28], ['#a89ca2', '#4a3e44'], 6, 1.6, -1.9, 0.3, 0.7, 0);
      // top highlight along the quiff
      x.strokeStyle = 'rgba(200,206,222,0.3)'; x.lineWidth = 3;
      blob([[-56, -86], [-44, -100], [-30, -98], [-18, -106], [-4, -100], [12, -100]], true); x.stroke();
    });

    // loose strands breaking the quiff's outline (swept up and back), so it reads as hair, not a cap
    x.lineCap = 'round';
    for (let i = 0; i < 34; i++) {
      const t = rng(), sx = -56 + t * 76, sy = -92 - Math.sin(t * Math.PI) * 10 + R(0, 8);
      const ex = sx + R(10, 22), ey = sy - R(6, 16) + t * 10;
      const r = rng();
      x.strokeStyle = r < 0.35 ? '#a6a8ba' : r < 0.7 ? '#5c5a6c' : '#2e2c38';
      x.globalAlpha = R(0.5, 0.9); x.lineWidth = R(1.4, 3);
      x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(sx + 2, sy - 8, ex, ey); x.stroke();
    }
    x.globalAlpha = 1;
    // a cool rim on the quiff's front edge only
    within(HAIR, () => {
      const g = x.createLinearGradient(-62, 0, -40, 0);
      g.addColorStop(0, 'rgba(223,232,240,0.85)'); g.addColorStop(1, 'rgba(223,232,240,0)');
      x.strokeStyle = g; x.lineWidth = 5; blob(HAIR); x.stroke();
    });

    // --- cigar at the far mouth corner + ember + smoke wisp
    x.lineCap = 'round';
    x.strokeStyle = '#4e3224'; x.lineWidth = 7; x.beginPath(); x.moveTo(-24, 24); x.lineTo(-62, 34); x.stroke();
    x.strokeStyle = '#8c603f'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(-26, 22); x.lineTo(-60, 31); x.stroke();
    x.strokeStyle = '#c9a25a'; x.lineWidth = 7; x.lineCap = 'butt'; x.beginPath(); x.moveTo(-30, 25.5); x.lineTo(-34, 26.6); x.stroke();
    x.strokeStyle = '#9d968f'; x.lineWidth = 7; x.beginPath(); x.moveTo(-61, 33.7); x.lineTo(-66, 35); x.stroke();
    x.fillStyle = '#ff8a3c'; x.fillRect(-68, 33, 3, 3);
    x.filter = 'blur(0.8px)';
    x.strokeStyle = 'rgba(240,244,252,0.85)'; x.lineWidth = 1.8; x.lineCap = 'round';
    blob([[-67, 31], [-73, 20], [-67, 8], [-77, -6], [-71, -20], [-79, -36], [-74, -50]], true); x.stroke();
    x.strokeStyle = 'rgba(240,244,252,0.3)'; x.lineWidth = 5;
    blob([[-70, 14], [-80, 0], [-74, -14], [-84, -30]], true); x.stroke();
    x.filter = 'none';

    // --- rim light: a cool sliver on the left edges of the face, hair and shoulder
    const rim = (pts, w) => {
      within(pts, () => {
        const g = x.createLinearGradient(-62, 0, -26, 0);
        g.addColorStop(0, 'rgba(223,232,240,0.95)'); g.addColorStop(1, 'rgba(223,232,240,0)');
        x.strokeStyle = g; x.lineWidth = w; blob(pts); x.stroke();
      });
    };
    rim(FACE, 4); rim(JACKET, 6);
    x.restore();

    // --- overall paint texture (~7%): broad soft dabs, then a soft vignette so it sits in the frame
    dabs(520, [-PR.w, -PR.h, PR.w, PR.h], ['#ffffff', '#0e1020'], 9, 5, -0.9, 0.5, 0.06, 1.2);
    const vg = x.createRadialGradient(0, -10, 80, 0, 0, 150);
    vg.addColorStop(0, 'rgba(10,16,30,0)'); vg.addColorStop(1, 'rgba(10,16,30,0.3)');
    x.fillStyle = vg; x.fillRect(-PR.w, -PR.h, PR.w * 2, PR.h * 2);
    return c;
  }
  function portraitFor(d) {
    const p = d.portrait;
    if (p && typeof p === 'object') return p;                                   // Image / canvas supplied by the caller
    const name = typeof p === 'string' ? p : 'commander';
    if (IP.hud && IP.hud.portraits && IP.hud.portraits[name]) return IP.hud.portraits[name];
    return portraitArt.commander || (portraitArt.commander = paintCommander());
  }
  function drawPortrait(ctx, world, d) {
    const P = DLG.portrait, outer = hexPts(P.cx, P.cy, P.r), inner = hexPts(P.cx, P.cy, P.r - P.frame);
    ctx.fillStyle = C.dlgFrame; path(ctx, outer); ctx.fill();
    ctx.save(); path(ctx, inner); ctx.clip();
    const img = portraitFor(d);
    if (img === portraitArt.commander) ctx.drawImage(img, P.cx - PR.w, P.cy - PR.h, PR.w * 2, PR.h * 2);
    else { const s = (P.r - P.frame) * 2; ctx.drawImage(img, P.cx - s / 2, P.cy - s / 2, s, s); }
    ctx.restore();
    // 1 px darker line inside the frame, 1 px dark line round the outside
    ctx.lineWidth = 1;
    ctx.strokeStyle = C.dlgFrameIn; path(ctx, hexPts(P.cx, P.cy, P.r - P.frame + 0.5)); ctx.stroke();
    ctx.strokeStyle = 'rgba(8,20,32,0.8)'; path(ctx, hexPts(P.cx, P.cy, P.r + 0.5)); ctx.stroke();
  }

  function drawDialogue(ctx, world) {
    const h = world.hud, d = h && h.dialogue, S = St(world);
    if (!d) { S.dlgKey = null; return; }
    if (typeof d === 'string') { h.dialogue = { text: d, portrait: 'commander' }; return drawDialogue(ctx, world); }
    const key = String(d.text) + '|' + (d.t != null ? d.t : '');
    if (S.dlgKey !== key) { S.dlgKey = key; S.dlgT0 = d.t != null ? d.t : world.time; }
    const t = world.time - S.dlgT0, cps = d.cps || 70;
    const text = String(d.text || '');
    const shown = Math.min(text.length, Math.floor(Math.max(0, t) * cps));
    S.dlgShown = shown;
    const appear = IP.clamp(t / 0.18, 0, 1);
    ctx.save();
    ctx.globalAlpha = appear;
    // panel: one flat #081b29 fill with a 1 px #1b3344 edge (no lighter band; ip_02 reads a uniform fill)
    ctx.fillStyle = C.dlgPanel;
    path(ctx, DLG.panel.flat()); ctx.fill();
    ctx.save(); path(ctx, DLG.panel.flat()); ctx.clip();
    ctx.strokeStyle = C.dlgEdge; ctx.lineWidth = 2; path(ctx, DLG.panel.flat()); ctx.stroke();
    ctx.restore();
    drawPortrait(ctx, world, d);
    // the bar's dialogue face is wide and bold: Chakra Petch 600 opened up with letter spacing
    const TXT = f(600, 30);
    ctx.font = TXT;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.dlgText;
    const lines = wrap(ctx, text, DLG.textW);
    let left = shown, y = DLG.textY;
    if (d.name) {
      ctx.font = f(600, 18); ctx.fillStyle = C.icon;
      ctx.fillText(String(d.name).toUpperCase(), DLG.textX, DLG.textY - 30);
      ctx.font = TXT; ctx.fillStyle = C.dlgText;
    }
    for (const line of lines) {
      if (left <= 0) break;
      const part = line.slice(0, left);
      ctx.fillText(part, DLG.textX, y);
      left -= line.length + 1;
      y += DLG.line;
    }
    if (shown >= text.length && d.dismiss !== false) {
      // "tap to continue" chevron
      const k = 0.55 + 0.45 * Math.sin(world.time * 5);
      ctx.globalAlpha = appear * k;
      ctx.fillStyle = C.icon;
      ctx.beginPath(); ctx.moveTo(1470, 978); ctx.lineTo(1482, 986); ctx.lineTo(1470, 994); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(1456, 978); ctx.lineTo(1468, 986); ctx.lineTo(1456, 994); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ demo ground (only in the hud scenarios)
  let demoTex = null;
  function makeDemoGround() {
    const S = 256, rng = IP.mulberry32(9071);
    const oct = [4, 8, 16, 32, 64];
    const field = (cells) => { const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rng(); return g; };
    const n = new Float32Array(S * S), m = new Float32Array(S * S);
    const addOct = (out, cells, amp) => {
      const g = field(cells), k = cells / S;
      for (let y = 0; y < S; y++) {
        const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), y0 = iy % cells, y1 = (iy + 1) % cells;
        for (let x = 0; x < S; x++) {
          const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), x0 = ix % cells, x1 = (ix + 1) % cells;
          const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
          out[y * S + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
        }
      }
    };
    let amp = 1, tot = 0;
    for (const c of oct) { addOct(n, c, amp); tot += amp; amp *= 0.55; }
    addOct(m, 3, 1); addOct(m, 6, 0.5);
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const cx = cv.getContext('2d'), img = cx.createImageData(S, S), D = img.data;
    const stops = [[0, [10, 6, 14]], [0.45, [26, 12, 30]], [0.62, [52, 18, 52]], [0.8, [92, 28, 82]], [1, [140, 44, 112]]];
    for (let i = 0; i < S * S; i++) {
      let v = (n[i] / tot - 0.5) * 2.1 + 0.5;
      v = v * 0.75 + (m[i] / 1.5 - 0.5) * 0.9 + 0.12;
      v = IP.clamp(v, 0, 1);
      let col = stops[stops.length - 1][1];
      for (let j = 1; j < stops.length; j++) if (v <= stops[j][0]) {
        const [a, ca] = stops[j - 1], [b, cb] = stops[j], t = (v - a) / (b - a);
        col = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
        break;
      }
      const sp = rng() < 0.04 ? 0.7 : 1;
      D[i * 4] = col[0] * sp; D[i * 4 + 1] = col[1] * sp; D[i * 4 + 2] = col[2] * sp; D[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    return cv;
  }

  // ------------------------------------------------------------------ system
  let fontsAsked = false;
  const hud = {
    init(world) {
      // the init loop re-visits us after the unshift below: make it idempotent per world
      if (world.systems.includes(GATE)) return;
      world.systems.unshift(GATE);
      if (!world.flags) world.flags = {};
      St(world);
      if (!fontsAsked && IP.assets && IP.assets.font) {
        fontsAsked = true;
        const base = (IP.assets.base || 'assets/') + 'fonts/ChakraPetch-';
        for (const w of ['400', '500', '600', '700']) IP.assets.font('Chakra Petch', base + w + '.woff2', { weight: w }).catch(() => {});
      }
    },
    update(world) {
      const S = St(world);
      // state diffs (order-independent): hp drops flash the card, deaths raise an alert, new mutations pulse the rail
      const ms = world.marines || [];
      for (let i = 0; i < ms.length && i < CARD.max; i++) {
        const m = ms[i], key = m.id != null ? m.id : i, a = alive(m);
        const prev = S.hpPrev[key];
        if (prev != null && a && m.hp < prev - 0.01) S.flash[i] = world.time;
        S.hpPrev[key] = m.hp;
        if (S.alive[key] === true && !a) alert(world, marineLabel(m) + ' DOWN', { kind: 'danger' });
        S.alive[key] = a;
      }
      const nm = mutationsOf(world).length;
      if (S.mutPrev >= 0 && nm > S.mutPrev) {
        S.mutFlash = nm - 1; S.mutFlashT = world.time;
        const mu = mutationsOf(world)[nm - 1];
        alert(world, 'ALIEN MUTATION' + (mu && mu.name && !/^MUTATION \d+$/.test(mu.name) ? ': ' + mu.name : ''), { kind: 'danger' });
      }
      S.mutPrev = nm;
      for (const e of world.events) {
        if (e.type === 'hive-captured') alert(world, 'HIVE CAPTURED', { kind: 'good' });
        else if (e.type === 'mutation' && e.name) alert(world, 'ALIEN MUTATION: ' + e.name, { kind: 'danger' });
      }
    },
    draw(world, r) {
      const h = world.hud;
      if (!h || !h.demoGround) return;
      if (!demoTex) demoTex = IP.gfx.texture(makeDemoGround(), { filter: 'linear', wrap: 'repeat', mipmap: true, name: 'hud-demo-ground' });
      const m = world.map;
      r.quad(0, 0, m.w, m.h, 0xffffffff, { layer: 'ground', tex: demoTex, uv: [0, 0, m.w / 1100, m.h / 1100] });
      // stand-in squad when the marines system is not running (so the frame reads like the game)
      if (world.systems.some((s) => s.name === 'marines')) return;
      for (const mm of world.marines) {
        if (!alive(mm)) continue;
        const sel = isSelected(world, mm);
        r.circle(mm.x, mm.y, 24, sel ? 'rgba(255,90,100,0.95)' : 'rgba(255,90,100,0.55)', { layer: 'shadow', width: 3 });
        r.circle(mm.x, mm.y, 21, 'rgba(40,160,150,0.28)', { layer: 'shadow' });
        const sh = mm.sheet && IP.assets.sheet(mm.sheet);
        if (sh) r.sprite(sh, sh.frame(IP.dirIndex(mm.dir || 0), 'idle', 0), mm.x, mm.y + 10, { layer: 'unit' });
        else r.circle(mm.x, mm.y, 9, WEAPON_COL[mm.cls] || '#ccc', { layer: 'unit' });
      }
    },
    drawHud(world, ctx) {
      const S = St(world);
      computeLayout(world);
      const inp = IP.input;
      const hover = inp && inp.pointerType === 'mouse' && inp.inFrame && !IP.headless ? hitTest(world, inp.x, inp.y) : null;
      ctx.textBaseline = 'alphabetic';
      if (!layout.hidden) {
        drawTopLeft(ctx, world);
        drawCards(ctx, world, hover);
        drawRail(ctx, world, hover);
        drawCorners(ctx, world, hover, S.press && S.press.hit && S.press.hit.key);
      }
      drawAlert(ctx, world);
      drawDialogue(ctx, world);
    },
  };
  IP.registerSystem('hud', hud);

  function alert(world, text, opts) {
    const h = hudOf(world);
    alert.n = (alert.n || 0) + 1;
    h.alert = Object.assign({ text, t: world.time, _id: alert.n }, opts || {});
    return h.alert;
  }
  IP.hud = {
    layout,
    hit: (x, y, world) => hitTest(world || IP.world, x, y),
    alert,
    say(world, text, opts) { const h = hudOf(world); h.dialogue = Object.assign({ portrait: 'commander', text }, opts || {}); return h.dialogue; },
    close(world) { const h = hudOf(world); h.dialogue = null; },
    computeLayout,
  };

  // ------------------------------------------------------------------ demo scenarios
  const DEMO_SQUAD = [
    { cls: 'sniper', sheet: 'sniper', hp: 0, state: 'dead' },
    { cls: 'rifle', sheet: 'rifle_a', hp: 0.9 },
    { cls: 'fusion', sheet: 'fusion', hp: 0.55 },
    { cls: 'rifle', sheet: 'rifle_b', hp: 0.8, selected: true },
    { cls: 'medic', sheet: 'medic', hp: 0.35 },
  ];
  function stubSquad(world, spec) {
    const cx = 1980, cy = 1120;
    spec.forEach((s, i) => {
      const a = (i / spec.length) * Math.PI * 2 + 0.6;
      const m = {
        id: 'm' + i, name: CLASS_LABEL[s.cls], cls: s.cls, x: Math.round(cx + Math.cos(a) * 52), y: Math.round(cy + Math.sin(a) * 44), r: 14, dir: -Math.PI / 2 + 0.4 * i,
        hp: Math.round(100 * s.hp), maxHp: 100, state: s.state || 'idle', order: null,
        weapon: { kind: s.cls, range: 300, dps: 30, cooldown: 0.2, ammo: 1, maxAmmo: 1 }, sheet: s.sheet, anim: 'idle', frame: 0, selected: !!s.selected,
      };
      world.marines.push(m);
      if (s.selected) world.selection.add(m.id);
      if (IP.assets && IP.assets.load) IP.assets.load(s.sheet).catch(() => {});
    });
  }
  function demoBase(world) {
    world.map = { w: 3840, h: 2160 };
    world.camera = { x: 1920, y: 1080, zoom: 1 };
    world.bp = 5;
    world.ammo = 0.65;
    const h = hudOf(world);
    h.mutations = [
      { name: 'Hardened Carapace', desc: 'Drones take 20% less damage from rifles.' },
      { name: 'Acid Blood', desc: 'Dying aliens splash acid on nearby marines.' },
      { name: 'Swarm Instinct', desc: 'Aliens move 15% faster near a hive.' },
    ];
    h.demoGround = true;
  }
  IP.scenario('hud-demo', (world) => {
    demoBase(world);
    stubSquad(world, DEMO_SQUAD);
  }, { systems: ['hud', 'marines'] });
  IP.scenario('hud-dialogue', (world) => {
    demoBase(world);
    stubSquad(world, DEMO_SQUAD.map((s) => Object.assign({}, s, { state: 'idle', hp: Math.max(0.6, s.hp), selected: true })));
    hudOf(world).dialogue = {
      portrait: 'commander', t: -10,
      text: "Good work, marines. That nest won't be bothering anyone now.  Push on and take the rest of the sector.\n\nI'll be waiting for you back at base.",
    };
  }, { systems: ['hud', 'marines'] });
  // alerts + toggled buttons + an opened mutation panel, for checking states
  IP.scenario('hud-states', (world) => {
    demoBase(world);
    stubSquad(world, DEMO_SQUAD);
    world.flags.attackMove = true;
    world.ammo = 0;
    hudOf(world).objective = 'Capture every hive  1 / 4';
    hudOf(world).disabled = { regroup: true };
    hudOf(world).alert = { text: 'Hive captured', kind: 'good', t: 0, dur: 30 };
    St(world).mutOpen = 1; St(world).mutOpenT = 0;
  }, { systems: ['hud', 'marines'] });
})();
