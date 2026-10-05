#!/usr/bin/env node
// Headless capture of the game (Game/index.html) at an exact 1920x1080 frame.
// Usage:
//   node tools/capture.js --scenario=stress --t=5 --out=Game/progress/shots/x.png [--seed=1] [--actions=JSON|@file.json]
//        [--fps-ms=2000] [--no-fps] [--aliens=N] [--gpu=metal|swiftshader] [--debug] [--systems=terrain,swarm  (only run these systems)]
//   Page screenshot instead of IP.capture() (e.g. phone letterboxing):
//   node tools/capture.js --scenario=stress --t=5 --out=m.png --viewport=390x844 --dpr=3 --mobile --page
// Prints "fps=<n> aliens=<n>" (fps = the real rAF loop run for --fps-ms after the capture, not stepTo).
// Same args => byte-identical PNG (the sim is fixed-step and seeded; capture happens before the fps run).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/s);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const root = path.join(__dirname, '..');
const scenario = args.scenario || 'stress';
const t = args.t !== undefined ? +args.t : 5;
const out = args.out;
if (!out) { console.error('need --out=PATH.png'); process.exit(2); }
const seed = args.seed !== undefined ? +args.seed : undefined;
let actions = null;
if (args.actions) actions = JSON.parse(String(args.actions).startsWith('@') ? fs.readFileSync(String(args.actions).slice(1), 'utf8') : args.actions);
const [vw, vh] = String(args.viewport || '1920x1080').split('x').map(Number);
const dpr = +(args.dpr || 1);
const fpsMs = args['no-fps'] ? 0 : +(args['fps-ms'] || 2000);
const gpu = args.gpu || 'metal';

// static server (same behaviour as tools/serve.js) on a free port
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.md': 'text/plain', '.txt': 'text/plain', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (!f.startsWith(root)) { resp.writeHead(403); return resp.end(); }
      fs.readFile(f, (err, data) => {
        if (err) { resp.writeHead(404); return resp.end('404 ' + p); }
        resp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        resp.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const launchArgs = gpu === 'swiftshader' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'];
  const browser = await chromium.launch({ args: launchArgs });
  let code = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: dpr, isMobile: !!args.mobile, hasTouch: !!args.mobile });
    const page = await ctx.newPage();
    const missing = /Failed to load resource: the server responded with a status of 404|GPU stall due to ReadPixels/;
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !missing.test(m.text())) console.error('[page ' + m.type() + '] ' + m.text()); });
    page.on('pageerror', (e) => console.error('[page exception] ' + e.message));
    const q = new URLSearchParams({ headless: '1' });
    if (args.aliens) q.set('aliens', args.aliens);
    if (args.debug) q.set('debug', '1');
    await page.goto(`http://127.0.0.1:${port}/Game/index.html?${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.IP && window.IP.ready === true, null, { timeout: 30000 });
    const info = await page.evaluate(async ({ scenario, seed, t, actions, systems }) => {
      await IP.loadScenario(scenario, { seed, systems });
      if (actions) IP.queueActions(actions);
      IP.stepTo(t);
      return { aliens: IP.count(IP.world.aliens), url: IP.capture(), renderer: (() => { const gl = IP.gfx.gl, e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(), errors: IP.errors.slice() };
    }, { scenario, seed, t, actions, systems: args.systems || undefined });
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    if (args.page) await page.screenshot({ path: out });
    else fs.writeFileSync(out, Buffer.from(info.url.split(',')[1], 'base64'));
    let fps = 'na', extra = '';
    if (fpsMs > 0) {
      const m = await page.evaluate((ms) => IP.measureFps(ms), fpsMs);
      fps = m.fps;
      extra = ` cpu_ms=${m.cpuMs} quads=${m.quads} draws=${m.draws} ticks_per_s=${m.ticksPerSec}`;
    }
    console.log(`fps=${fps} aliens=${info.aliens}${extra} out=${out}`);
    if (args.verbose) console.error('renderer: ' + info.renderer);
    if (info.errors.length) { console.error('system errors: ' + info.errors.join(' | ')); code = 1; }
  } catch (e) {
    console.error('capture failed: ' + (e && e.stack || e));
    code = 1;
  } finally {
    await browser.close();
    srv.close();
  }
  process.exit(code);
})();
