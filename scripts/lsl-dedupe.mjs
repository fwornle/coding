#!/usr/bin/env node
// LSL maintenance: remove duplicate prompt-set blocks across all part-files in
// a day's directory. Keeps the LARGEST block per ps_id (most-complete content)
// and removes all others. Idempotent; safe to run repeatedly.
//
// Usage: node scripts/lsl-dedupe.mjs [YYYY-MM-DD] [--dry-run]
//   default date: today (local)
//   --dry-run: report what would change, write nothing

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const log = (msg) => process.stdout.write(msg + '\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dateArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const date = dateArg || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
})();

const [year, month] = date.split('-');
const dir = path.join(REPO_ROOT, '.specstory', 'history', year, month);
if (!fs.existsSync(dir)) {
  log(`No directory: ${dir}`);
  process.exit(0);
}

const files = fs.readdirSync(dir)
  .filter(n => n.startsWith(date) && n.endsWith('.md'))
  .map(n => path.join(dir, n));

log(`Date: ${date} | Files: ${files.length} | Mode: ${dryRun ? 'dry-run' : 'write'}`);

const psIdLocations = new Map();
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const anchorRe = /<a name="(ps_\d+)"><\/a>/g;
  let m;
  const matches = [];
  while ((m = anchorRe.exec(content)) !== null) {
    matches.push({ psId: m[1], start: m.index });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const blockEnd = i + 1 < matches.length ? matches[i+1].start : content.length;
    const blockLen = blockEnd - cur.start;
    if (!psIdLocations.has(cur.psId)) psIdLocations.set(cur.psId, []);
    psIdLocations.get(cur.psId).push({ file, blockStart: cur.start, blockEnd, blockLen });
  }
}

let dupePsIds = 0;
let totalDupes = 0;
for (const locs of psIdLocations.values()) {
  if (locs.length > 1) {
    dupePsIds++;
    totalDupes += locs.length - 1;
  }
}
log(`Unique ps_ids: ${psIdLocations.size} | Duplicate ps_ids: ${dupePsIds} | Extra blocks: ${totalDupes}`);

if (totalDupes === 0) {
  log('Nothing to dedupe.');
  process.exit(0);
}

const removalsByFile = new Map();
for (const [psId, locs] of psIdLocations.entries()) {
  if (locs.length === 1) continue;
  const keepIdx = locs.reduce((best, cur, i) => cur.blockLen > locs[best].blockLen ? i : best, 0);
  log(`  ${psId}: ${locs.length} blocks → keep largest (${locs[keepIdx].blockLen}B in ${path.basename(locs[keepIdx].file)})`);
  for (let i = 0; i < locs.length; i++) {
    if (i === keepIdx) continue;
    const loc = locs[i];
    if (!removalsByFile.has(loc.file)) removalsByFile.set(loc.file, []);
    removalsByFile.get(loc.file).push([loc.blockStart, loc.blockEnd]);
  }
}

if (dryRun) {
  log('\n[dry-run] No changes written.');
  process.exit(0);
}

for (const [file, ranges] of removalsByFile.entries()) {
  let content = fs.readFileSync(file, 'utf8');
  const before = content.length;
  ranges.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of ranges) content = content.slice(0, start) + content.slice(end);
  fs.writeFileSync(file, content);
  log(`  ${path.basename(file)}: ${ranges.length} block(s) removed, ${before} → ${content.length} bytes`);
}

log('\nDone.');
