// tests/experiments/experiment-runner.integration.test.mjs
//
// SC#4 end-to-end proof (Phase 78, Plan 78-04): a full variant×repeat matrix driven by the
// shipped runMatrix engine (78-03) against a REAL isolated experiment store lands EXACTLY
// one Run per variant×repeat cell, is idempotent on re-run (D-10), and records every
// terminal state (complete | abort) without dropping a cell (D-04 / Q3).
//
// This is the automated SC#4 gate: it wires the real runMatrix loop + the real writeRun
// materialization + the real readRuns ledger. Only the outer-world seams are stubbed —
// restore (a fake sandbox, no git worktree), the agent launch (a stub mapping to a terminal
// state, no live claude/opencode), and the measurement CLI (an in-process writeRun instead of
// shelling scripts/measurement-{start,stop}.mjs). The Run count / task_id / terminal_state
// assertions all read the REAL km-core store via readRuns — so the idempotency + one-per-cell
// invariant is proven against shipped persistence, not a mock.
//
// Isolation (mirrors run-write.test.mjs / seed-experiment-store.mjs): a fresh mkdtemp repoRoot
// whose .data/ontologies-experiment is the REAL ontology copied verbatim, so the strict-path
// putEntity validates entityType:'Run' against the live registry (KB-01). The real single-owner
// .data/experiments store is NEVER touched. Output via process.stderr.write only (no-console-log).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMatrix } from '../../lib/experiments/experiment-runner.mjs';
import { openExperimentStore } from '../../lib/experiments/store.mjs';
import { writeRun } from '../../lib/experiments/run-write.mjs';
import { readRuns } from '../../lib/experiments/query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');
const AGENTS_DIR = path.join(REPO_ROOT, 'config', 'agents');
const GOAL = 'prove exactly one Run per variant×repeat cell (SC#4)';

// ---------------------------------------------------------------------------
// Isolation helpers
// ---------------------------------------------------------------------------

/** Fresh tmp repoRoot with the REAL experiment ontology copied in verbatim. */
function makeIsolatedRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-runner-integration-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  return { repoRoot: tmp, cleanup };
}

/** Read every Run in the isolated store via the shipped readRuns (caller-owns-close). */
async function readAllRuns(repoRoot) {
  const store = await openExperimentStore({ repoRoot });
  try {
    return await readRuns(store, { includePending: true });
  } finally {
    await store.close();
  }
}

/** Positional value that follows `flag` in a fixed-argv array (mirrors the CLI parse). */
function argAfter(argv, flag) {
  const i = argv.indexOf(flag);
  return i < 0 ? null : (argv[i + 1] ?? null);
}

/** Derive the agent from the fixed argv argvForAgent emits (claude '-p' / opencode 'run'). */
function agentFromArgv(argv) {
  if (argv[0] === 'run') return 'opencode';
  if (argv.includes('--prompt')) return 'mastracode';
  return 'claude'; // the `-p` path (claude/copilot); these tests use claude only
}

/**
 * In-process replacement for the measurement-{start,stop} CLIs: on 'start' capture the cell
 * fields off the fixed argv; on 'stop' materialize a REAL Run via the shipped writeRun with the
 * mapped --terminal-state (or --skip-reason). Sequential-by-construction (runMatrix awaits each
 * cell), so a single `pending` slot is safe and the single-owner store is opened one cell at a time.
 */
function makeMeasurementWriter(repoRoot, rec) {
  let pending = null;
  return async (phase, argv) => {
    if (phase === 'start') {
      pending = {
        task_id: argAfter(argv, '--task-id'),
        variant: argAfter(argv, '--variant'),
        repeat: argAfter(argv, '--repeat'),
        agent: argAfter(argv, '--agent'),
        model: argAfter(argv, '--model'),
        framework: argAfter(argv, '--framework'),
        goal: argAfter(argv, '--goal'),
      };
      rec.starts.push(pending.task_id);
      return 0;
    }
    // stop → write one scored Run for the captured cell (D-11 inline score analog).
    const terminal_state = argAfter(argv, '--terminal-state');
    const skip_reason = argAfter(argv, '--skip-reason');
    const p = pending;
    rec.stops.push(p.task_id);
    const store = await openExperimentStore({ repoRoot });
    try {
      await writeRun(store, {
        span: { task_id: p.task_id, goal_sentence: p.goal },
        taskClass: 'unclassified',
        pending: false,
        tags: {
          agent: p.agent, model: p.model, framework: p.framework,
          variant: p.variant, repeat: p.repeat,
          terminal_state, skip_reason,
        },
        totals: {},
      });
    } finally {
      await store.close();
    }
    return 0;
  };
}

/**
 * Build a runMatrix opts bundle driving the REAL store/writeRun/readRuns with stubbed
 * outer-world seams. `terminalFor(argv)` maps a launched cell to its terminal state
 * (default 'complete'); every launch is recorded in `rec.launched` for retry assertions.
 */
function buildOpts({ repoRoot, cells, repeats, rec, terminalFor = () => 'complete' }) {
  return {
    repoRoot,
    dataDir: path.join(repoRoot, '.data'),
    agentsDir: AGENTS_DIR,
    snapshotId: 'snap-1', // ignored by the fake restore
    // Serve exactly these cells/repeats (bypass the on-disk spec — the loop is what we prove).
    resolveSpec: () => ({ goal_sentence: GOAL, repeats, cells }),
    // Fake restore: a static sandbox (no git worktree) — the injected seams never touch it.
    restore: async () => ({ worktree: path.join(repoRoot, 'fake-wt'), sandboxDataDir: path.join(repoRoot, 'fake-wt', '.data') }),
    // Stub agent: record the launch, map to a terminal state.
    spawnAgent: async ({ argv }) => {
      rec.launched.push(argv);
      return terminalFor(argv);
    },
    // In-process measurement → real writeRun into the isolated store.
    runMeasurement: makeMeasurementWriter(repoRoot, rec),
  };
}

function freshRec() {
  return { starts: [], stops: [], launched: [] };
}

const TWO_VARIANTS = [
  { agent: 'claude', model: 'sonnet', framework: 'straight', env: 'default', test_command: undefined },
  { agent: 'opencode', model: 'haiku', framework: 'straight', env: 'default', test_command: undefined },
];

// ---------------------------------------------------------------------------
// SC#4: exactly one Run per variant×repeat cell
// ---------------------------------------------------------------------------

test('SC#4: a 2×2 matrix with a stub agent lands exactly one Run per variant×repeat cell', async () => {
  const { repoRoot, cleanup } = makeIsolatedRepo();
  try {
    const rec = freshRec();
    const summary = await runMatrix({}, buildOpts({ repoRoot, cells: TWO_VARIANTS, repeats: 2, rec }));

    // 4 cells attempted, all ran to complete.
    assert.equal(summary.length, 4, 'summary has one entry per variant×repeat cell');
    for (const s of summary) {
      assert.equal(s.status, 'ran');
      assert.equal(s.terminal_state, 'complete');
    }

    // The REAL store holds exactly 4 Runs, each a distinct composite task_id, all complete.
    const rows = await readAllRuns(repoRoot);
    assert.equal(rows.length, 4, 'exactly one Run per variant×repeat cell (SC#4)');
    const ids = new Set(rows.map((r) => r.task_id));
    assert.equal(ids.size, 4, 'each Run carries a distinct composite task_id');
    for (const r of rows) {
      assert.equal(r.terminal_state, 'complete', `Run ${r.task_id} recorded terminal_state complete`);
      assert.match(r.task_id, /--r[01]$/, 'task_id encodes the repeat index');
    }
    assert.equal(rec.launched.length, 4, 'the stub agent launched once per cell');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// D-10: idempotent resume — a re-run adds NO new Runs
// ---------------------------------------------------------------------------

test('D-10: re-running the identical matrix adds NO new Runs and launches no agent', async () => {
  const { repoRoot, cleanup } = makeIsolatedRepo();
  try {
    // First run: all four cells complete.
    await runMatrix({}, buildOpts({ repoRoot, cells: TWO_VARIANTS, repeats: 2, rec: freshRec() }));
    assert.equal((await readAllRuns(repoRoot)).length, 4, 'first run lands 4 Runs');

    // Second identical run against the same store: every cell is already complete → skipped.
    const rec2 = freshRec();
    const summary2 = await runMatrix({}, buildOpts({ repoRoot, cells: TWO_VARIANTS, repeats: 2, rec: rec2 }));

    assert.equal((await readAllRuns(repoRoot)).length, 4, 'no new Runs on the idempotent re-run (D-10)');
    assert.equal(rec2.launched.length, 0, 'no agent launched on the resume');
    assert.equal(rec2.stops.length, 0, 'no measurement write on the resume');
    for (const s of summary2) {
      assert.equal(s.status, 'skipped');
      assert.equal(s.reason, 'already-complete');
    }
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// D-04 / Q3: an abort cell is RECORDED (not dropped) and retried on resume
// ---------------------------------------------------------------------------

test('D-04/Q3: an abort cell records terminal_state=abort, is not dropped, and is retried on resume', async () => {
  const { repoRoot, cleanup } = makeIsolatedRepo();
  try {
    // First run: claude completes, opencode aborts.
    const abortOpencode = (argv) => (agentFromArgv(argv) === 'opencode' ? 'abort' : 'complete');
    const rec1 = freshRec();
    await runMatrix({}, buildOpts({ repoRoot, cells: TWO_VARIANTS, repeats: 1, rec: rec1, terminalFor: abortOpencode }));

    let rows = await readAllRuns(repoRoot);
    assert.equal(rows.length, 2, 'both cells recorded — the abort cell is NOT silently dropped (D-04)');
    const aborted = rows.find((r) => r.task_id.includes('opencode'));
    const completed = rows.find((r) => r.task_id.includes('claude'));
    assert.equal(aborted.terminal_state, 'abort', 'the aborted cell recorded terminal_state abort');
    assert.equal(completed.terminal_state, 'complete', 'the completed cell recorded terminal_state complete');

    // Resume: only the prior-abort cell is retried (Q3 — complete cells skip, abort re-runs);
    // this time it completes, proving the retry path lands a fresh terminal state on the SAME Run.
    const rec2 = freshRec();
    const summary2 = await runMatrix({}, buildOpts({ repoRoot, cells: TWO_VARIANTS, repeats: 1, rec: rec2 }));

    assert.equal(rec2.launched.length, 1, 'exactly one cell retried on resume (the prior abort)');
    assert.equal(agentFromArgv(rec2.launched[0]), 'opencode', 'the retried cell is the prior-abort opencode cell');
    const claudeEntry = summary2.find((s) => s.task_id.includes('claude'));
    assert.equal(claudeEntry.status, 'skipped', 'the already-complete claude cell is skipped on resume');
    assert.equal(claudeEntry.reason, 'already-complete');

    rows = await readAllRuns(repoRoot);
    assert.equal(rows.length, 2, 'the retry UPDATES the same Run — still exactly 2 (no duplicate)');
    const nowOpencode = rows.find((r) => r.task_id.includes('opencode'));
    assert.equal(nowOpencode.terminal_state, 'complete', 'the retried abort cell now records complete');
  } finally {
    cleanup();
  }
});
