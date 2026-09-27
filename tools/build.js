// Bundle index.html + css + js into one self-contained file (dist/mecha-factory.html).
// Usage: node tools/build.js [--fragment] [page.html]   (--fragment strips <html>/<head>/<body> wrappers)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fragment = process.argv.includes('--fragment');
const page = process.argv.slice(2).find((a) => a.endsWith('.html')) || 'index.html';
const base = page === 'index.html' ? 'mecha-factory' : path.basename(page, '.html');
let html = fs.readFileSync(path.join(root, page), 'utf8');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, f) => `<style>\n${fs.readFileSync(path.join(root, f), 'utf8')}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${fs.readFileSync(path.join(root, f), 'utf8')}</script>`);
if (fragment) {
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>')).replace(/<meta[^>]*>\s*/g, '').replace(title, '');
  const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  html = `${title}\n${head.trim()}\n${body.trim()}\n`;
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', fragment ? base + '.artifact.html' : base + '.html');
fs.writeFileSync(out, html);
console.log('wrote', path.relative(root, out), (html.length / 1024).toFixed(1) + ' KB');
