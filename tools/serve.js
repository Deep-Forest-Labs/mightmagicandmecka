// Tiny static server for the repo root (no cache). Usage: node tools/serve.js [port]
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const port = +process.argv[2] || 8711;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jsonl': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.md': 'text/plain', '.txt': 'text/plain', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404 ' + p); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}).listen(port, () => console.log('serving', root, 'on http://localhost:' + port));
