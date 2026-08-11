#!/usr/bin/env node
/**
 * Re-resolve the token fields of a completed kgbench run, offline.
 *
 *   kgbench-backfill-tokens.mjs --run <runId>
 *   kgbench-backfill-tokens.mjs --run <runId> --dry-run
 *   kgbench-backfill-tokens.mjs --run <runId> --all      # re-resolve measured cells too
 *
 * WHY THIS EXISTS. A cell's tokens cannot always be known when the cell ends. copilot's and
 * opencode's rows are written by their stop-adapters, and those run on their own schedule:
 *
 *   cell ran        09:57:01.869 → 09:57:35.267
 *   row timestamp   09:57:34.810   (inside the cell — the join is correct)
 *   row WRITTEN     ~60s later     (after the runner had already recorded `unmeasured`)
 *
 * The runner polls for a couple of seconds, which is enough for opencode and not for copilot.
 * Waiting a minute per cell is not an option — a 200-cell matrix would spend three hours
 * asleep. So the runner records what it can see and this script fills in the rest afterwards,
 * from the `task_id` and the wall-clock window stored on every row.
 *
 * That is the same discipline kgbench already applies to grading: results.jsonl keeps the full
 * answer so a fixed grader can be re-applied offline instead of re-running the matrix. Tokens
 * now work the same way, and for the same reason — re-running a cell to learn its cost changes
 * the cost.
 *
 * IDEMPOTENT and NON-DESTRUCTIVE. Only cells whose `token_source` is `unmeasured` are touched
 * by default, a first-party `stream-json` number is never overwritten, and the previous file
 * is kept as results.jsonl.bak before anything is written.
 *
 * Operator output goes through process.stdout.write, the convention this repo already uses for
 * CLI/diagnostic output (see lib/experiments/agent-routing.mjs) under the no-console-log rule.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../lib/kgbench/arms.mjs';
import { resolveCellTokens, TOKEN_FIELDS } from '../lib/kgbench/tokens.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const out = (s) => process.stdout.write(`${s}\n`);
const die = (m) => { process.stderr.write(`kgbench-backfill-tokens: ${m}\n`); process.exit(2); };

const runId = opt('run', null);
if (!runId) die('usage: kgbench-backfill-tokens.mjs --run <runId> [--dry-run] [--all]');

const repoRoot = opt('repo', REPO_ROOT);
const resultsFile = path.join(repoRoot, '.data/kgbench/runs', runId, 'results.jsonl');
if (!existsSync(resultsFile)) die(`no results at ${resultsFile}`);

const lines = readFileSync(resultsFile, 'utf8').split('\n').filter((l) => l.trim());
const rows = [];
for (const line of lines) {
  try { rows.push(JSON.parse(line)); } catch { die('results.jsonl has an unparseable line; refusing to rewrite it'); }
}

/**
 * The window to re-resolve this row on, or a refusal.
 *
 * GUARD A — NEVER RE-RESOLVE ON A WINDOW NARROWER THAN THE CELL. A row written before attempt
 * windows existed carries its LAST attempt's `started_at`, while its stored token total was
 * resolved over ALL attempts. Re-resolving from the row's own window therefore returns roughly
 * half the cell — and `--all` would have written that over the correct number, silently, on all 21
 * retried rows of run coding-v1-r8. The row carries the evidence to catch it: `attempts[].wall_s`
 * sums to the cell's real duration, and a window shorter than that cannot be the window that
 * produced the number.
 *
 * @returns {{ok: true, windows: Array<{started_at, ended_at}>|null} | {ok: false, reason: string}}
 */
function resolutionWindowFor(r) {
  const attempts = Array.isArray(r.attempts) ? r.attempts : [];
  const attemptWallMs = attempts.reduce((a, x) => a + (Number(x?.wall_s) || 0), 0) * 1000;
  const spanMs = Date.parse(r.ended_at) - Date.parse(r.started_at);
  // 1s of tolerance absorbs the per-attempt toFixed(1) rounding, and nothing larger.
  if (attemptWallMs > 0 && Number.isFinite(spanMs) && spanMs + 1000 < attemptWallMs) {
    return {
      ok: false,
      reason: `window ${(spanMs / 1000).toFixed(1)}s is narrower than its ${attempts.length} `
        + `attempts (${(attemptWallMs / 1000).toFixed(1)}s) — the row predates attempt windows`,
    };
  }
  const timed = attempts.filter((a) => a?.started_at && a?.ended_at);
  return {
    ok: true,
    windows: timed.length > 1 && timed.length === attempts.length
      ? timed.map(({ started_at, ended_at }) => ({ started_at, ended_at }))
      : null,
  };
}

// A row is a candidate when it has a window to join on and no first-party number. --all also
// re-resolves window-joined cells, which is what you want after fixing an ambiguity (an
// interactive session that was running alongside the matrix) — never for stream-json rows,
// whose numbers did not come from the DB in the first place.
const candidates = rows.filter((r) => {
  if (r.token_source === 'stream-json') return false;
  if (!r.started_at || !r.ended_at) return false;
  return flag('all') ? true : (r.token_source === 'unmeasured' || r.token_source == null);
});

out(`kgbench: ${rows.length} row(s) in ${runId}; ${candidates.length} eligible for token backfill`);
if (!candidates.length) { out('kgbench: nothing to do'); process.exit(0); }

let filled = 0, stillEmpty = 0, ambiguous = 0;
const refused = [];
for (const r of candidates) {
  const before = r.token_source;
  const cell = `${String(r.arm).padEnd(10)} ${String(r.id).padEnd(4)} r${r.rep} ${String(r.agent ?? 'claude').padEnd(9)}`;

  const win = resolutionWindowFor(r);
  if (!win.ok && !flag('allow-narrow-window')) {
    refused.push({ cell, reason: win.reason });
    out(`  ${cell} REFUSED — ${win.reason}`);
    continue;
  }

  // No polling here: the rows either exist by now or they do not, and this script can simply
  // be run again later. attempts=1 keeps a large run's backfill to one DB query per cell.
  const t = await resolveCellTokens({
    result: {},                       // force DB resolution; the row's own nulls are what we are fixing
    agent: r.agent ?? 'claude',
    taskId: r.task_id ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    // Present only on rows written after attempt windows existed, or repaired into them. A row
    // without them resolves exactly as it did before.
    windows: win.ok ? win.windows : null,
    bound: !!r.token_bound,
    attempts: 1,
    settleMs: 0,
  });
  if (t.token_source === 'unmeasured') { stillEmpty++; continue; }

  // GUARD B — A RE-RESOLUTION MUST NOT SHRINK A STORED TOTAL. The proxy's token DB is
  // append-only, so a fresh resolution returning LESS than the stored number never means the
  // data changed; it means the window moved. That is the signature of the halving Guard A
  // catches, reached through a different sense — and it covers rows whose `attempts` array is
  // missing or untimed, which Guard A has to wave through.
  const prevTotal = Number(r.total_tokens);
  if (Number.isFinite(prevTotal) && Number(t.total_tokens) < prevTotal && !flag('allow-shrink')) {
    const reason = `would shrink ${prevTotal.toLocaleString('en-US')} → ${Number(t.total_tokens).toLocaleString('en-US')}`;
    refused.push({ cell, reason });
    out(`  ${cell} REFUSED — ${reason}`);
    continue;
  }

  // CLEAR BEFORE MERGE. Object.assign only overwrites keys the new result HAS, so any field
  // the previous resolution set and this one does not would survive as a verdict about a
  // computation that no longer exists. That is not hypothetical: when attribution moved from
  // window sums to session sets, every re-attributed cell kept its old
  // `token_ambiguous: true` and the old "2 distinct sessions ran inside this cell's window"
  // message, sitting next to fresh fields saying the cell was cleanly attributed to exactly
  // one session. The run looked unimproved because the stale verdict was what the report read.
  //
  // Same shape as the stale answer file this harness fixed earlier: a merge that only ever
  // adds lets a previous answer outlive the question.
  for (const k of TOKEN_FIELDS) delete r[k];
  Object.assign(r, t);
  // content_tokens is derived, so it has to be recomputed from the new in_tokens or it stays
  // null next to a populated total — the exact inconsistency that makes a reader distrust a table.
  if (r.baseline_in_tokens != null && r.in_tokens != null) {
    r.content_tokens = Math.max(0, r.in_tokens - r.baseline_in_tokens) + (r.out_tokens ?? 0);
  }
  r.token_backfilled_at = new Date().toISOString();
  filled++;
  if (t.token_ambiguous) ambiguous++;
  out(`  ${cell} ${before ?? 'null'} -> ${t.token_source}  total=${t.total_tokens}${t.token_ambiguous ? '  AMBIGUOUS' : ''}`);
}

out('');
out(`kgbench: filled ${filled}, still unmeasured ${stillEmpty}${ambiguous ? `, ambiguous ${ambiguous}` : ''}`
  + `${refused.length ? `, REFUSED ${refused.length}` : ''}`);

if (refused.length) {
  out('');
  out(`kgbench: ${refused.length} row(s) were left untouched because re-resolving them would have`);
  out('kgbench: replaced a correct number with a worse one. These rows describe a window that does');
  out('kgbench: not cover the cell they measure — their stored totals span every attempt while');
  out('kgbench: their started_at is the LAST attempt\'s, so a join on the row itself sees half the cell.');
  out(`kgbench: repair them first:  node scripts/kgbench-repair-attempt-windows.mjs --run ${runId}`);
  out('kgbench: or override with --allow-narrow-window / --allow-shrink if you know better.');
}

if (flag('dry-run')) { out('kgbench: --dry-run, results.jsonl not written'); }
if (flag('strict') && refused.length) process.exit(1);
if (flag('dry-run')) process.exit(0);
if (!filled) { out('kgbench: no changes to write'); process.exit(0); }

copyFileSync(resultsFile, `${resultsFile}.bak`);
writeFileSync(resultsFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
out(`kgbench: rewrote ${resultsFile} (previous kept as results.jsonl.bak)`);
if (ambiguous) {
  out(`kgbench: ${ambiguous} cell(s) are AMBIGUOUS — more than one session of that agent ran inside`);
  out('kgbench: their window, so the sum may include traffic that is not the cell. The report marks them.');
}
out(`kgbench: re-render with  node scripts/kgbench-report.mjs --run ${runId}`);
