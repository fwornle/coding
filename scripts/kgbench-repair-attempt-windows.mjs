#!/usr/bin/env node
/**
 * Reconstruct the per-attempt windows of a run recorded before the runner wrote them, and
 * re-resolve its tokens from them.
 *
 *   kgbench-repair-attempt-windows.mjs --run <runId> [--dry-run] [--force]
 *
 * WHY THIS EXISTS. `runCell` resolved a cell's tokens over a window spanning every attempt, then
 * built the row by spreading the LAST attempt's result. The row therefore carried the last
 * attempt's `started_at` and `wall_s` beside a token total covering all of them. Three things
 * followed, and this script repairs all three on data already on disk:
 *
 *   - The row could not reproduce its own number. Re-resolving a retried cell from its own window
 *     returns roughly half the cell, and `--all` on the backfill would have written that back as
 *     an improvement. (That is now refused; see kgbench-backfill-tokens.mjs Guard A.)
 *   - `wall_s` understated every retried cell — 35.6s recorded for a cell that burned 73.6s.
 *   - Every retried cell was flagged `token_ambiguous`, because a retry is a fresh spawn and so
 *     opens a session of its own. On run coding-v1-r8 the 21 flagged cells were EXACTLY the 21
 *     retried cells; nothing foreign ran. The published analysis then dropped those rows as
 *     over-counts, which — since a retried cell pays for two attempts — moved that agent's
 *     measured cost DOWN. A correction in the wrong direction, applied to correct data.
 *
 * THIS SCRIPT IS TRANSITIONAL. The runner now records attempt windows itself, so rows that already
 * carry them are skipped and a run recorded after that change has nothing to repair.
 *
 * RECONSTRUCTION. The runner spawns attempt N+1 immediately after attempt N returns, so walking
 * back from the row's `started_at` (which, pre-fix, IS the last attempt's start) and subtracting
 * each earlier attempt's `wall_s` recovers the earlier boundaries. The last attempt's window is
 * exact; the earlier ones are inferred, and marked `reconstructed: true` so no reader mistakes
 * them for measurements.
 *
 * WHY THE RECONSTRUCTION CAN BE TRUSTED — CONTROL C1. Per-attempt windows are the whole span minus
 * the gaps between attempts, so summing sessions per attempt can only be LESS THAN OR EQUAL TO
 * summing them over the whole span. It is strictly less exactly when a session's start falls in a
 * gap, which is the only way a misplaced boundary can hurt. So if the two totals are EQUAL, every
 * session the wide window saw sits inside exactly one attempt window, and the boundaries did their
 * only job: separating the attempts' sessions. C1 does not pin a boundary to the millisecond and
 * does not need to — any boundary between one session's last call and the next session's first
 * call passes it, and they are all equally correct.
 *
 * WHAT IS NOT ASSERTED, AND WHY. The fresh total is NOT required to equal the stored total. The
 * proxy's token DB is append-only and the stop-adapters write late: on coding-v1-r8, seven of the
 * 21 rows gained tokens after the runner resolved them (six by ~700, one by 26,661). Re-running the
 * ORIGINAL whole-span method today reproduces those same higher numbers, which is what identifies
 * the difference as DB drift rather than reconstruction error. Asserting equality would abort the
 * repair on a third of the rows for a reason that has nothing to do with the repair. Drift is
 * reported per row instead (C4), and the fresh numbers are adopted, because a row that reproduces
 * its own number is the entire point of the exercise.
 *
 * Operator output goes through process.stdout.write, the convention this repo uses for CLI output
 * under the no-console-log rule.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/kgbench/arms.mjs';
import { resolveCellTokens, TOKEN_FIELDS } from '../lib/kgbench/tokens.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const out = (s) => process.stdout.write(`${s}\n`);
const die = (m) => { process.stderr.write(`kgbench-repair-attempt-windows: ${m}\n`); process.exit(2); };
const iso = (ms) => new Date(ms).toISOString();
const n = (x) => Number(x).toLocaleString('en-US');

const runId = opt('run', null);
if (!runId) die('usage: kgbench-repair-attempt-windows.mjs --run <runId> [--dry-run] [--force]');

const repoRoot = opt('repo', REPO_ROOT);
const resultsFile = path.join(repoRoot, '.data/kgbench/runs', runId, 'results.jsonl');
if (!existsSync(resultsFile)) die(`no results at ${resultsFile}`);

// NOT results.jsonl.bak: this run already has one from the token backfill, and clobbering it
// destroys the pre-backfill state. The directory's own convention is a named suffix per repair
// (results.jsonl.bak-prefloor, .bak-rejudge).
const backupFile = `${resultsFile}.bak-attempt-windows`;
if (existsSync(backupFile) && !flag('force') && !flag('dry-run')) {
  die(`${path.basename(backupFile)} already exists — this run looks repaired. Re-run with --force to overwrite it.`);
}

const rows = readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim()).map((line) => {
  try { return JSON.parse(line); } catch { return die('results.jsonl has an unparseable line; refusing to rewrite it'); }
});

/** Cells that ran more than once and do not already carry per-attempt windows. */
const candidates = rows.filter((r) => {
  const a = Array.isArray(r.attempts) ? r.attempts : [];
  if (a.length < 2) return false;
  if (a.every((x) => x?.started_at && x?.ended_at)) return false;  // already recorded by the runner
  return !!r.started_at && !!r.ended_at && a.every((x) => Number.isFinite(Number(x?.wall_s)));
});

out(`kgbench: ${rows.length} row(s) in ${runId}; ${candidates.length} multi-attempt row(s) to repair`);
if (!candidates.length) { out('kgbench: nothing to do'); process.exit(0); }

/** Walk back from the last attempt's start, which the row already holds exactly. */
function reconstruct(row) {
  const a = row.attempts;
  const spans = new Array(a.length);
  spans[a.length - 1] = { started_at: row.started_at, ended_at: row.ended_at, exact: true };
  let t = Date.parse(row.started_at);
  for (let i = a.length - 2; i >= 0; i--) {
    const end = t;                                   // attempt i ended when attempt i+1 spawned
    const start = end - Number(a[i].wall_s) * 1000;
    spans[i] = { started_at: iso(start), ended_at: iso(end), exact: false };
    t = start;
  }
  return spans;
}

const resolveOn = (row, windows) => resolveCellTokens({
  result: {},                        // force DB resolution; the row's own fields are what we check
  agent: row.agent ?? 'claude',
  taskId: row.task_id ?? null,
  startedAt: windows[0].started_at,
  endedAt: windows[windows.length - 1].ended_at,
  windows,
  bound: !!row.token_bound,
  attempts: 1,
  settleMs: 0,
});

let repaired = 0, failed = 0, drifted = 0;
const drift = [];

for (const row of candidates) {
  const cell = `${row.arm}/${row.agent}/${row.id} rep${row.rep}`;
  const spans = reconstruct(row);
  const windows = spans.map(({ started_at, ended_at }) => ({ started_at, ended_at }));

  // Both resolutions run NOW, against the same DB, so drift cancels out between them and the
  // only thing C1 can see is whether the boundaries partition the sessions.
  const wide = await resolveOn(row, [{ started_at: windows[0].started_at, ended_at: windows[windows.length - 1].ended_at }]);
  const perAttempt = await resolveOn(row, windows);

  const failures = [];
  if (Number(wide.total_tokens) !== Number(perAttempt.total_tokens)) {
    failures.push(`C1 whole-span ${n(wide.total_tokens)} != per-attempt ${n(perAttempt.total_tokens)} `
      + '— a session starts in a gap between the reconstructed windows, so a boundary is wrong');
  }
  const per = perAttempt.token_attempt_sessions ?? [];
  if (per.some((x) => x > 1)) {
    failures.push(`C2 an attempt holds ${Math.max(...per)} session starts [${per.join(',')}] — genuine concurrency, flag stays`);
  }
  if (Number.isFinite(Number(row.total_tokens)) && Number(perAttempt.total_tokens) < Number(row.total_tokens)) {
    failures.push(`C3 fresh ${n(perAttempt.total_tokens)} < stored ${n(row.total_tokens)} — sessions were lost, not gained`);
  }

  if (failures.length) {
    failed++;
    out(`  FAIL  ${cell}`);
    for (const f of failures) out(`          ${f}`);
    continue;
  }

  // C4: report drift, do not assert on it.
  const delta = Number(perAttempt.total_tokens) - Number(row.total_tokens);
  if (delta !== 0) { drifted++; drift.push({ cell, stored: Number(row.total_tokens), fresh: Number(perAttempt.total_tokens), delta }); }

  const wallBefore = row.wall_s;
  if (!flag('dry-run')) {
    row.attempts = row.attempts.map((a, i) => ({
      ...a,
      started_at: spans[i].started_at,
      ended_at: spans[i].ended_at,
      ...(spans[i].exact ? {} : { reconstructed: true }),
    }));
    row.started_at = windows[0].started_at;
    row.wall_s = +row.attempts.reduce((s, a) => s + (Number(a.wall_s) || 0), 0).toFixed(1);
    // CLEAR BEFORE MERGE. Object.assign only overwrites keys the new result HAS, so the 21
    // `token_ambiguous: true` values would survive a merge that only ever adds — and the repair
    // would read as inert while the report went on printing the stale verdict. That exact failure
    // already happened once on this file's data (defect 18).
    for (const k of TOKEN_FIELDS) delete row[k];
    Object.assign(row, perAttempt);
    if (row.baseline_in_tokens != null && row.in_tokens != null) {
      row.content_tokens = Math.max(0, row.in_tokens - row.baseline_in_tokens) + (row.out_tokens ?? 0);
    }
    row.attempt_windows_repaired_at = new Date().toISOString();
  }
  repaired++;
  const wallAfter = +row.attempts.reduce((s, a) => s + (Number(a.wall_s) || 0), 0).toFixed(1);
  // The FRESH verdict, not the row's. On a --dry-run the row still holds the stale
  // `token_ambiguous: true`, and printing that would report the repair as having changed nothing.
  const ambiguousNow = perAttempt.token_ambiguous ? 'yes' : 'no';
  out(`  ok    ${String(cell).padEnd(28)} wall_s ${wallBefore} -> ${wallAfter}`
    + `  sessions [${per.join(',')}]  ambiguous ${row.token_ambiguous ? 'yes' : 'no'} -> ${ambiguousNow}`
    + `${delta ? `  (+${n(delta)} since the run)` : ''}`);
}

out('');
out(`kgbench: repaired ${repaired}, failed ${failed}${drifted ? `, drifted ${drifted}` : ''}`);

if (drift.length) {
  out('');
  out('kgbench: these rows gained tokens between the run and now. The proxy DB is append-only and');
  out('kgbench: the stop-adapters write late, so the run resolved them before their last calls');
  out('kgbench: landed. The fresh numbers are adopted — a row that reproduces its own number is');
  out('kgbench: the point of this repair.');
  for (const d of drift) out(`  ${d.cell.padEnd(28)} ${n(d.stored)} -> ${n(d.fresh)}  (+${n(d.delta)})`);
}

if (failed) {
  out('');
  out(`kgbench: ${failed} row(s) failed their controls and were left untouched. C1 and C3 both mean`);
  out('kgbench: the walk-back landed in the wrong place: C1 that a session start fell into a gap');
  out('kgbench: between the reconstructed windows, C3 that the reconstructed span missed sessions');
  out('kgbench: the cell really owned. The usual cause is an attempt that spent CONTINUATIONS,');
  out('kgbench: whose wall_s the runner under-recorded before this fix (it summed only the first');
  out('kgbench: and last leg), so the boundary walked back from it sits too late. Those cells');
  out('kgbench: cannot be repaired from the row alone — re-run them.');
}

if (flag('dry-run')) {
  out('');
  out('kgbench: --dry-run, results.jsonl not written');
  process.exit(failed ? 1 : 0);
}
if (!repaired) { out('kgbench: no changes to write'); process.exit(failed ? 1 : 0); }

copyFileSync(resultsFile, backupFile);
writeFileSync(resultsFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
out('');
out(`kgbench: rewrote ${resultsFile} (previous kept as ${path.basename(backupFile)})`);
out(`kgbench: re-render with  node scripts/kgbench-report.mjs --run ${runId}`);
process.exit(failed ? 1 : 0);
