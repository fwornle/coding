#!/usr/bin/env node
/**
 * Build the kb-on-ONLY specs used to collect treatment-arm deliverables for fact mining.
 *
 *   node scripts/kb-ab-make-mine-specs.mjs            # .data/kb-ab-sampler/specs -> mine-specs
 *   node scripts/kb-ab-make-mine-specs.mjs --dry-run
 *
 * WHY A SEPARATE SPEC SET RATHER THAN RUNNING THE REAL ONES. Mining needs deliverables that are
 * unambiguously from the TREATMENT arm, and nothing on disk records which arm produced a sandbox:
 * the runner writes no sandbox path into run metadata, and `--parallel` without a `--run-id` writes
 * no per-cell log. The only reliable attribution is construction — run a matrix that contains ONLY
 * kb-on cells, and every deliverable created after the window opened is treatment-arm by
 * definition. That is what these specs are for.
 *
 * THREE EDITS, EACH LOad-BEARING:
 *
 *   experiment_id gets a `mine-` prefix. `task_id` is the runner's idempotency key (D-10/D-14), so
 *   mining cells sharing ids with matrix cells would make each pass skip the other's work — and,
 *   worse, would land mining runs in the store under the ids the real matrix is meant to occupy.
 *
 *   variants are filtered to kb-on. That is the whole point; a kb-off cell here would put control
 *   output into the corpus the gate is derived from, which inverts the measurement.
 *
 *   test_command is dropped. These cells are collecting output, not being scored, and the gate they
 *   would run does not exist yet — it is the thing mining is about to produce.
 *
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(REPO_ROOT, '.data', 'kb-ab-sampler');
const SPECS = path.join(OUT_ROOT, 'specs');
const MINE_SPECS = path.join(OUT_ROOT, 'mine-specs');
const WINDOW_FILE = path.join(OUT_ROOT, 'mine-window-start');

const out = (s) => process.stdout.write(s);
const err = (s) => process.stderr.write(s);

function main(argv) {
  const dryRun = argv.includes('--dry-run');

  const names = fs.existsSync(SPECS)
    ? fs.readdirSync(SPECS).filter((n) => n.endsWith('.yaml')).sort()
    : [];
  if (!names.length) {
    err(`[kb-ab-mine-specs] no specs in ${SPECS} — run the sampler first\n`);
    return 2;
  }

  // A stale mine-specs set from an earlier round would silently add topics this draw never
  // produced, and their deliverables would land in the window looking like this round's.
  if (!dryRun) fs.rmSync(MINE_SPECS, { recursive: true, force: true });
  if (!dryRun) fs.mkdirSync(MINE_SPECS, { recursive: true });

  let written = 0;
  const skipped = [];
  for (const name of names) {
    const spec = yaml.load(fs.readFileSync(path.join(SPECS, name), 'utf8'));
    const kbOn = (spec.variants ?? []).filter((v) => v.env === 'kb-on');
    if (!kbOn.length) {
      skipped.push(`${name} (no kb-on variant)`);
      continue;
    }
    spec.experiment_id = `mine-${spec.experiment_id}`;
    spec.variants = kbOn;
    delete spec.test_command;
    if (!dryRun) fs.writeFileSync(path.join(MINE_SPECS, name), yaml.dump(spec), 'utf8');
    written += 1;
  }

  // The window MUST be stamped here, not by the caller: it has to open before the first cell runs,
  // and a caller that stamps it afterwards would exclude the deliverables it is meant to select.
  const since = Math.floor(Date.now() / 1000);
  if (!dryRun) fs.writeFileSync(WINDOW_FILE, `${since}\n`, 'utf8');

  for (const s of skipped) err(`[kb-ab-mine-specs] skipped ${s}\n`);
  out(`${written} kb-on-only mining spec(s) ${dryRun ? 'would be written' : 'written'} to ${MINE_SPECS}\n`);
  out(`mining window opens ${new Date(since * 1000).toISOString()}`
    + `${dryRun ? ' (dry run: not recorded)' : ` -> ${WINDOW_FILE}`}\n`);
  const repeats = new Set(names.map((n) => yaml.load(fs.readFileSync(path.join(SPECS, n), 'utf8')).repeats ?? 1));
  out(`cells to run: ${written} spec(s) x ${[...repeats].join('/')} repeat(s) = ${written * Math.max(...repeats)}\n`);
  return written ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
