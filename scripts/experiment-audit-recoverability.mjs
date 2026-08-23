#!/usr/bin/env node
/**
 * Recoverability audit for knowledge-injection A/B specs.
 *
 * WHY THIS EXISTS. A kb-on/kb-off comparison only carries information if the kb-off arm CANNOT
 * reach the graded answer. The 2026-08-22 run failed that precondition silently: all 18 cells
 * scored identically because the restored sandbox shipped the very corpus the treatment injects
 * (a 45 MB graph export, 989 insight files) plus a `.claude/settings.local.json` allow-list
 * naming the host's agent-memory directory by absolute path. 13 of 18 cells followed that
 * pointer; for one it was the FIRST tool call. Nothing in the harness noticed, so the null
 * result read as "injection does not help" when it actually meant "both arms had the answer".
 *
 * This script makes that precondition CHECKABLE instead of assumed. It extracts each spec's
 * graded string from its own `test_command` and greps for it in the tree a cell would actually
 * see — i.e. AFTER neutralizeSandboxRules + neutralizeSandboxKnowledge have run.
 *
 * VERDICTS
 *   FAIL  the graded string is present in the post-strip sandbox → kb-off can grep its way to it,
 *         so the spec cannot discriminate. Exit code 1.
 *   WARN  absent from the sandbox but present off-tree (host agent-memory / the live repo's
 *         CLAUDE.md). Only reachable by escaping the sandbox; the strip removes the pointer, but
 *         it is worth knowing. Exit 0 unless --strict.
 *   PASS  absent from both.
 *
 * A PASS is a statement about RECOVERABILITY BY SEARCH, not about inference. It cannot tell you
 * the model won't simply guess a plausible option name (`persistOnClose` is a natural coinage for
 * "do not persist on close"). Read it as a necessary condition, never a sufficient one.
 *
 * USAGE
 *   node scripts/experiment-audit-recoverability.mjs --spec config/experiments/kb-ab-*.yaml
 *   node scripts/experiment-audit-recoverability.mjs --spec <f> --worktree <path>   # audit a given tree
 *   node scripts/experiment-audit-recoverability.mjs --spec <f> --json
 *   node scripts/experiment-audit-recoverability.mjs --spec <f> --strict            # WARN also exits 1
 *
 * With no --worktree, the newest `.data/run-restores/<snapshot_id>-*` for that spec is used. That
 * is a REAL restored tree, so the audit reflects what the rig actually produces.
 *
 * Diagnostics via process.stdout/stderr .write only (no console.* — no-console-log, CLAUDE.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { neutralizeSandboxRules, neutralizeSandboxKnowledge } from '../lib/experiments/experiment-restore.mjs';
import { FACT_SETS } from '../lib/experiments/kb-ab-facts.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GREP_TIMEOUT_MS = 120_000;

/** Host agent-memory dir — off-tree, reachable only by escaping the sandbox. */
const HOST_MEMORY_DIR = path.join(
  process.env.HOME || '', '.claude', 'projects', '-Users-Q284340-Agentic-coding', 'memory',
);

/** Minimal `key: "value"` reader. Avoids a YAML dep for the four scalars we need. */
function readSpecScalar(text, key) {
  const m = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '');
}

/**
 * The graded string: the operand of `grep -F` in the spec's own test_command. Using the spec's
 * real gate (rather than a hand-maintained second list) means the audit can never drift from
 * what is actually scored.
 */
export function gradedPatternFor(testCommand) {
  if (typeof testCommand !== 'string' || !testCommand.trim()) return null;
  const argv = testCommand.trim().split(/\s+/).filter(Boolean);
  if (!/(^|\/)grep$/.test(argv[0] || '')) return null;
  // Skip flags; the first non-flag operand after them is the pattern (the next one is the file).
  for (let i = 1; i < argv.length; i += 1) {
    if (!argv[i].startsWith('-')) return argv[i];
  }
  return null;
}

/** Newest restored worktree for a snapshot id, or null. */
function newestRestore(snapshotId) {
  const dir = path.join(REPO_ROOT, '.data', 'run-restores');
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir)
    .filter((n) => n.startsWith(`${snapshotId}-`))
    .sort();
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null;
}

/**
 * Files under `root` containing `pattern` (literal). Fixed argv, never a shell string — the
 * pattern comes from a spec file and must not be word-split or glob-expanded.
 */
function filesContaining(root, pattern, { excludeFile } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  const argv = ['-rl', '-F', '--binary-files=without-match', '--exclude-dir=.git', pattern, root];
  if (excludeFile) argv.splice(4, 0, `--exclude=${excludeFile}`);
  const res = spawnSync('/usr/bin/grep', argv, { encoding: 'utf8', timeout: GREP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (res.error || typeof res.stdout !== 'string') return [];
  return res.stdout.split('\n').filter(Boolean).map((p) => path.relative(root, p));
}

/**
 * The topic argument of a `node scripts/kb-ab-assert.mjs <topic>` gate, or null when the
 * test_command is not a checker invocation.
 */
export function checkerTopicFor(testCommand) {
  if (typeof testCommand !== 'string') return null;
  const argv = testCommand.trim().split(/\s+/).filter(Boolean);
  const i = argv.findIndex((a) => a.endsWith('kb-ab-assert.mjs'));
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/**
 * Files under `root` matching a REGEX (not a literal). Used for per-fact recoverability of a
 * checker gate, whose facts are regexes rather than fixed strings.
 *
 * APPROXIMATE BY CONSTRUCTION: this hands the JS source of the pattern to POSIX ERE, which does
 * not share every JS construct. It is a leak DETECTOR, so it is tuned to over-report rather than
 * under-report — a fact wrongly flagged recoverable costs you a spec rewrite, one wrongly cleared
 * costs you another uninformative experiment. Fixed-string facts are checked exactly.
 */
function filesMatchingRegex(root, source, { excludeFile } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  const argv = ['-rlE', '--binary-files=without-match', '--exclude-dir=.git'];
  if (excludeFile) argv.push(`--exclude=${excludeFile}`);
  argv.push(source, root);
  const res = spawnSync('/usr/bin/grep', argv, { encoding: 'utf8', timeout: GREP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (res.error || typeof res.stdout !== 'string') return [];
  return res.stdout.split('\n').filter(Boolean).map((p) => path.relative(root, p));
}

/** Audit one spec against one worktree. Pure given the filesystem. */
export function auditSpec({ specPath, worktree, memoryDir = HOST_MEMORY_DIR }) {
  const text = fs.readFileSync(specPath, 'utf8');
  const experimentId = readSpecScalar(text, 'experiment_id') || path.basename(specPath, '.yaml');
  const snapshotId = readSpecScalar(text, 'snapshot_id');
  const testCommand = readSpecScalar(text, 'test_command');
  // Checker gate: enumerate its facts and measure each one's recoverability separately. A
  // conjunction can discriminate even when SOME of its facts are individually greppable — what
  // matters is whether at least one required fact is out of reach, so the verdict is computed
  // over the facts rather than over a single string.
  const topic = checkerTopicFor(testCommand);
  if (topic) {
    const set = FACT_SETS[topic];
    const tree = worktree || newestRestore(snapshotId);
    if (!set || !tree) {
      return { experimentId, snapshotId, testCommand, pattern: null, verdict: 'SKIP', inSandbox: [], inMemory: [],
               reason: !set ? `unknown checker topic '${topic}'` : `no restored worktree for snapshot '${snapshotId}'` };
    }
    neutralizeSandboxRules(tree);
    neutralizeSandboxKnowledge(tree);
    const facts = set.facts.map((f) => {
      const hits = filesMatchingRegex(tree, f.re.source, { excludeFile: set.deliverable });
      return { id: f.id, required: f.required, recoverable: hits.length > 0, files: hits.slice(0, 3), why: f.why };
    });
    const required = facts.filter((f) => f.required);
    const outOfReach = required.filter((f) => !f.recoverable);
    // FAIL only when EVERY required fact is grep-able — then the control arm can assemble the
    // whole answer from the tree and the cell measures nothing.
    const verdict = outOfReach.length === 0 ? 'FAIL' : (outOfReach.length < required.length ? 'WARN' : 'PASS');
    return { experimentId, snapshotId, testCommand, topic, worktree: tree, facts, verdict,
             pattern: null, inSandbox: [], inMemory: [] };
  }

  const pattern = gradedPatternFor(testCommand);

  if (!pattern) {
    return { experimentId, snapshotId, testCommand, pattern: null, verdict: 'SKIP',
             reason: 'no `grep -F <pattern>` gate in test_command', inSandbox: [], inMemory: [] };
  }

  const tree = worktree || newestRestore(snapshotId);
  if (!tree) {
    return { experimentId, snapshotId, testCommand, pattern, verdict: 'SKIP',
             reason: `no restored worktree for snapshot '${snapshotId}' (pass --worktree)`, inSandbox: [], inMemory: [] };
  }

  // Apply the SAME strips a real cell gets, so the audit measures the tree the agent sees rather
  // than the tree the rig produced. Both are idempotent, so re-auditing a stripped tree is a no-op.
  neutralizeSandboxRules(tree);
  neutralizeSandboxKnowledge(tree);

  // Exclude the deliverable itself: a previous cell's runbook in this tree contains the answer
  // BECAUSE it was the answer, which would otherwise self-report as a leak.
  const deliverable = (testCommand.trim().split(/\s+/).pop()) || undefined;
  const inSandbox = filesContaining(tree, pattern, { excludeFile: deliverable });
  const inMemory = filesContaining(memoryDir, pattern);

  const verdict = inSandbox.length ? 'FAIL' : (inMemory.length ? 'WARN' : 'PASS');
  return { experimentId, snapshotId, testCommand, pattern, worktree: tree, verdict, inSandbox, inMemory };
}

function main(argv) {
  const specs = [];
  let worktree = null; let json = false; let strict = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--spec') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) { specs.push(argv[i + 1]); i += 1; } }
    else if (argv[i] === '--worktree') { worktree = argv[i + 1]; i += 1; }
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--strict') strict = true;
  }
  if (!specs.length) {
    process.stderr.write('usage: experiment-audit-recoverability.mjs --spec <spec.yaml>... [--worktree <p>] [--json] [--strict]\n');
    return 2;
  }

  const results = specs.map((s) => auditSpec({ specPath: s, worktree }));
  if (json) {
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
  } else {
    for (const r of results) {
      process.stdout.write(`\n${r.experimentId}\n`);
      process.stdout.write(`  graded string : ${r.pattern ?? '(none)'}\n`);
      if (r.reason) process.stdout.write(`  skipped       : ${r.reason}\n`);
      if (r.facts) {
        process.stdout.write(`  gate          : checker '${r.topic}' (${r.facts.length} facts)\n`);
        process.stdout.write(`  worktree      : ${r.worktree}\n`);
        for (const f of r.facts) {
          const tag = f.recoverable ? 'grep-able' : 'OUT OF REACH';
          const where = f.recoverable ? ` — ${f.files.join(', ')}${f.files.length === 3 ? ', …' : ''}` : '';
          process.stdout.write(`    ${tag.padEnd(13)} ${f.id}${f.required ? '' : ' (optional)'}${where}\n`);
        }
      }
      if (r.pattern && !r.reason) {
        process.stdout.write(`  worktree      : ${r.worktree}\n`);
        process.stdout.write(`  in sandbox    : ${r.inSandbox.length ? `${r.inSandbox.length} file(s) — ${r.inSandbox.slice(0, 4).join(', ')}${r.inSandbox.length > 4 ? ', …' : ''}` : 'absent'}\n`);
        process.stdout.write(`  in host memory: ${r.inMemory.length ? r.inMemory.join(', ') : 'absent'}\n`);
      }
      process.stdout.write(`  verdict       : ${r.verdict}\n`);
    }
    process.stdout.write('\n');
  }

  const failed = results.some((r) => r.verdict === 'FAIL' || (strict && r.verdict === 'WARN'));
  return failed ? 1 : 0;
}

// Only run main when invoked directly, so the audit functions stay unit-testable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
