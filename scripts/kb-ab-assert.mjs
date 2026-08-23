#!/usr/bin/env node
/**
 * Acceptance gate for the knowledge-injection A/B specs.
 *
 *   node scripts/kb-ab-assert.mjs <topic>
 *
 * Fixed argv, no shell metacharacters, so evidence-harness.resolveTestCommand accepts it exactly
 * as it accepted the old `grep -q -F ...` form (SHELL_META_RE never matches this). It runs in the
 * cell's own worktree (measurement-stop passes repoRoot: cellCwd), reads the deliverable the goal
 * asked for, and exits 0 only when every REQUIRED fact is present.
 *
 * Replaces a single-token grep because that could not discriminate: see lib/experiments/
 * kb-ab-facts.mjs for the measurement showing why (KB insights are prose about this repo, so
 * their concrete identifiers are in the repo too).
 *
 * Output is deliberately per-fact. The judge receives `command` and exit status, but a human
 * reading the run log needs to know WHICH half of the story the agent missed — "wrote the
 * diagnosis but never gave the fix" and "gave a fix for the wrong cause" are different failures
 * and a bare exit code conflates them.
 *
 * Exit codes: 0 all required facts present · 1 one or more missing · 2 usage/deliverable error.
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { FACT_SETS, gradeFacts } from '../lib/experiments/kb-ab-facts.mjs';

const topic = process.argv[2];
if (!topic || !FACT_SETS[topic]) {
  process.stderr.write(
    `usage: kb-ab-assert.mjs <topic>\nknown topics: ${Object.keys(FACT_SETS).join(', ')}\n`,
  );
  process.exit(2);
}

const set = FACT_SETS[topic];
const file = path.resolve(process.cwd(), set.deliverable);

if (!fs.existsSync(file)) {
  // Distinct from "facts missing": the agent produced nothing at the required path at all.
  process.stdout.write(`FAIL ${topic}: deliverable '${set.deliverable}' was not created\n`);
  process.exit(1);
}

let text;
try {
  text = fs.readFileSync(file, 'utf8');
} catch (err) {
  process.stderr.write(`kb-ab-assert: cannot read ${file}: ${err.message}\n`);
  process.exit(2);
}

const { ok, results } = gradeFacts(topic, text);
const passed = results.filter((r) => r.hit).length;

process.stdout.write(`${topic} — ${set.goalSummary}\n`);
process.stdout.write(`deliverable: ${set.deliverable} (${text.length} chars)\n`);
for (const r of results) {
  const tag = r.hit ? 'PASS' : (r.required ? 'FAIL' : 'miss');
  process.stdout.write(`  ${tag}  ${r.id}${r.required ? '' : ' (optional)'} — ${r.why}\n`);
}
process.stdout.write(`\n${passed}/${results.length} facts present; ${ok ? 'ACCEPTED' : 'REJECTED'}\n`);
process.exit(ok ? 0 : 1);
