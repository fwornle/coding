#!/usr/bin/env node
/**
 * One-shot backfill: redact the corporate staff ID from already-captured
 * measurement data at rest.
 *
 * Output via process.stdout.write / process.stderr.write only — the no-console-log
 * constraint (mirrors the measurement-stop.mjs sibling convention).
 *
 * WHY: Phase-84 per-turn context capture (context-turns / raw-bodies) and the
 * archived span .json records store raw message text, which includes local
 * filesystem paths like /Users/Q284340/… — leaking the operator's staff number
 * into the dashboard timeline + turn-modal. The render-path scrub (dashboard
 * scrubSecrets) and the write-path redaction (measurement-stop closeContextTurns)
 * stop the leak going forward; this script purges data captured BEFORE those fixes.
 *
 * Reuses redactCorporateIds() from measurement-stop.mjs (single source of truth,
 * mirrors .specstory/config/redaction-patterns.json#corporate_user_ids — q + 6
 * alphanumerics with ≥1 digit, so plain words like "quality" are never matched).
 *
 * SCOPE: capture files only — context-turns.jsonl(.gz) and raw-bodies.jsonl(.gz)
 * under .data/measurements/<task_id>/. The archived span .json records are
 * deliberately NOT rewritten: their staff-ID occurrences live in FUNCTIONAL paths
 * (`replay_from` read by the Phase-67 repro-restore rig, `cwd` run dirs), so
 * redacting them would break replay. Any staff ID surfaced from a .json field is
 * masked at display time by the dashboard render scrub instead.
 *
 * SAFETY:
 *  - A file is rewritten ONLY when redaction changed its bytes.
 *  - .gz files are gunzip → redact → gzip (round-trip).
 *
 * Usage:
 *   node scripts/backfill-context-turns-redaction.mjs [--dry-run] [--dir <measurements-dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { redactCorporateIds } from './measurement-stop.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);

// Duplicated here ONLY to count occurrences for the report; the actual redaction
// is always redactCorporateIds() (single source of truth).
const COUNT_RE = /\bq(?=[0-9a-z]{6}\b)(?=[0-9a-z]*\d)[0-9a-z]{6}\b/gi;
const countHits = (s) => (s.match(COUNT_RE) || []).length;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const REPO = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';
const MEAS = dirIdx >= 0 && args[dirIdx + 1]
  ? path.resolve(args[dirIdx + 1])
  : path.join(REPO, '.data/measurements');

if (!fs.existsSync(MEAS)) {
  err(`[backfill] measurements dir not found: ${MEAS}`);
  process.exit(0);
}

let scanned = 0;
let changedFiles = 0;
let totalHits = 0;

/** Redact a gzipped text file in place (gunzip → redact → gzip). */
function processGz(file) {
  scanned++;
  let text;
  try {
    text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  } catch (e) {
    err(`[backfill] skip (gunzip failed): ${file} — ${e.message}`);
    return;
  }
  const red = redactCorporateIds(text);
  if (red === text) return;
  const hits = countHits(text);
  totalHits += hits;
  changedFiles++;
  out(`${dryRun ? '[dry-run] would redact' : '[redacted]'} ${hits} hit(s): ${path.relative(REPO, file)}`);
  if (!dryRun) fs.writeFileSync(file, zlib.gzipSync(Buffer.from(red, 'utf8')));
}

/** Redact a plaintext capture file in place. */
function processPlain(file) {
  scanned++;
  const text = fs.readFileSync(file, 'utf8');
  const red = redactCorporateIds(text);
  if (red === text) return;
  const hits = countHits(text);
  totalHits += hits;
  changedFiles++;
  out(`${dryRun ? '[dry-run] would redact' : '[redacted]'} ${hits} hit(s): ${path.relative(REPO, file)}`);
  if (!dryRun) fs.writeFileSync(file, red, 'utf8');
}

// Per-task capture files under .data/measurements/<task_id>/ ONLY.
// (Span .json records are excluded — see SCOPE note in the header.)
for (const entry of fs.readdirSync(MEAS, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const d = path.join(MEAS, entry.name);
  for (const name of ['context-turns.jsonl', 'raw-bodies.jsonl']) {
    const plain = path.join(d, name);
    if (fs.existsSync(plain)) processPlain(plain);
    const gz = `${plain}.gz`;
    if (fs.existsSync(gz)) processGz(gz);
  }
}

out(
  `\n[backfill] ${dryRun ? 'DRY RUN — ' : ''}scanned ${scanned} file(s); ` +
  `${changedFiles} contained the staff ID (${totalHits} total occurrence(s))` +
  `${dryRun ? '' : ' — redacted in place'}.`,
);
