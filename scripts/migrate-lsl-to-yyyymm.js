#!/usr/bin/env node
/**
 * One-shot migration: move flat LSL files into YYYY/MM/ subdirs.
 *
 * Targets:
 *   .specstory/history/                     (LSL .md files)
 *   .specstory/history/logs/classification/ (dated .jsonl + .md classification logs)
 *   .specstory/history/logs/                (dated metrics-*.json + operational-*.log)
 *
 * Files without a parsable YYYY-MM-DD prefix are left in place.
 */

import fs from 'fs';
import path from 'path';
import { dateSubdirFromFilename } from './lsl-paths.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function migrateDir(absDir, predicate) {
  if (!fs.existsSync(absDir)) {
    return { dir: absDir, moved: 0, skipped: 0, missing: true };
  }
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
    .filter(e => e.isFile() && predicate(e.name));

  let moved = 0;
  let skipped = 0;
  for (const e of entries) {
    const sub = dateSubdirFromFilename(e.name);
    if (!sub) { skipped++; continue; }
    const targetDir = path.join(absDir, sub);
    fs.mkdirSync(targetDir, { recursive: true });
    const src = path.join(absDir, e.name);
    const dst = path.join(targetDir, e.name);
    if (fs.existsSync(dst)) { skipped++; continue; }
    fs.renameSync(src, dst);
    moved++;
  }
  return { dir: absDir, moved, skipped, missing: false };
}

const results = [
  migrateDir(
    path.join(ROOT, '.specstory', 'history'),
    (n) => n.endsWith('.md')
  ),
  migrateDir(
    path.join(ROOT, '.specstory', 'history', 'logs', 'classification'),
    (n) => n.endsWith('.jsonl') || n.endsWith('.md')
  ),
  migrateDir(
    path.join(ROOT, '.specstory', 'history', 'logs'),
    (n) => /^(metrics-|operational-)/.test(n)
  ),
];

for (const r of results) {
  if (r.missing) {
    process.stdout.write(`SKIP (missing): ${r.dir}\n`);
  } else {
    process.stdout.write(`${r.dir}: moved=${r.moved} skipped=${r.skipped}\n`);
  }
}
