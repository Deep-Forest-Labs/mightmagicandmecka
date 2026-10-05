// Append an entry to the live progress log. Every builder/critic round must log.
// Usage: node tools/progress.js --piece=terrain --round=2 --role=critic --status=fail --score=4 \
//          --text="..." --img=Game/progress/shots/terrain-r2.png[,more.png] [--ab=Game/progress/shots/ab-terrain-r2/]
// status: working | done | pass | fail | info | pick
const fs = require('fs'), path = require('path');
const args = {};
for (const a of process.argv.slice(2)) { const m = a.match(/^--([^=]+)=(.*)$/s); if (m) args[m[1]] = m[2]; }
if (!args.piece || !args.role || !args.text) { console.error('need --piece --role --text'); process.exit(1); }
const entry = {
  ts: new Date().toISOString(), piece: args.piece, round: +(args.round || 0), role: args.role,
  status: args.status || 'info', score: args.score !== undefined ? +args.score : null,
  text: args.text, images: (args.img || '').split(',').filter(Boolean).map((p) => p.replace(/^Game\//, '')),
  ab: args.ab ? args.ab.replace(/^Game\//, '') : null, model: args.model || null,
};
const file = path.join(__dirname, '..', 'Game', 'progress', 'log.jsonl');
fs.appendFileSync(file, JSON.stringify(entry) + '\n');
console.log('logged', entry.piece, 'r' + entry.round, entry.role, entry.status);
