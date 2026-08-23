// tests/experiments/kb-ab-facts.test.mjs
//
// The A/B acceptance gate must be able to FAIL.
//
// The defect this pins: the specs graded with `grep -q -F <one-token> <file>`, and every one of
// the 18 cells of the 2026-08-22 run passed — including cells that gave the fix without the cause
// and cells that never mentioned the decisive trap at all. A gate that cannot separate those is
// not measuring the thing the experiment is about. Re-graded with these conjunctions, the same 18
// deliverables spread across 2/4, 3/4 and 4/4.
//
// These tests are about the GATE's discrimination, not about any particular run's score.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACT_SETS, gradeFacts } from '../../lib/experiments/kb-ab-facts.mjs';

test('every fact set names a deliverable and carries at least one required fact', () => {
  for (const [topic, set] of Object.entries(FACT_SETS)) {
    assert.ok(set.deliverable && set.deliverable.endsWith('.md'), `${topic}: needs a .md deliverable`);
    assert.ok(set.facts.some((f) => f.required), `${topic}: a gate with no required fact can never fail`);
    for (const f of set.facts) {
      assert.ok(f.re instanceof RegExp, `${topic}/${f.id}: fact must be a RegExp`);
      assert.ok(f.why && f.why.length > 20, `${topic}/${f.id}: needs a rationale, not a label`);
    }
  }
});

test('a partial answer is REJECTED — the failure the single-token gate could not see', () => {
  // Names the fixing option but never explains the mechanism or how to confirm it. Under the old
  // `grep -F persistOnClose` gate this passed outright.
  const partial = 'Set `persistOnClose: false` when opening the store for reads. That fixes it.';
  const { ok, results } = gradeFacts('kb-ab-leveldb-amplification', partial);
  assert.equal(ok, false, 'naming the option alone must not be accepted');
  assert.equal(results.find((r) => r.id === 'persist-option').hit, true);
  // `read-open-still-writes` replaced `whole-graph-one-key` on 2026-08-23: the old fact scored
  // 0/6 across BOTH arms because its phrasing lives in this repo's CLAUDE.md, not in the KB, so
  // retrieval never injected it and the treatment could not supply what the gate demanded.
  assert.equal(results.find((r) => r.id === 'read-open-still-writes').hit, false);
});

test('a complete answer is ACCEPTED', () => {
  const full = [
    '`GraphKMStore.close()` persists by default: `persistGraph` writes the entire graph as a',
    'single value under one LevelDB key, so a read-only handler rewrites everything on close.',
    'Fix: pass `readOnly: true`, which sets `persistOnClose: false`.',
    'Confirm first: `du -sh .data/experiments/leveldb`, fire one GET, and watch a ~1 MB .ldb',
    'appear. Do not trust `docker stats` — read /sys/fs/cgroup/memory.events (oom_kill) instead.',
  ].join('\n');
  const { ok, results } = gradeFacts('kb-ab-leveldb-amplification', full);
  assert.ok(ok, `expected acceptance, missing: ${results.filter((r) => !r.hit).map((r) => r.id).join(', ')}`);
});

test('an empty or irrelevant deliverable is REJECTED for every topic', () => {
  for (const topic of Object.keys(FACT_SETS)) {
    assert.equal(gradeFacts(topic, '').ok, false, `${topic}: empty must fail`);
    assert.equal(gradeFacts(topic, '# Notes\n\nTODO: write this up later.\n').ok, false, `${topic}: stub must fail`);
  }
});

test('an unknown topic throws rather than silently accepting', () => {
  // A typo'd topic in a spec's test_command must not read as "no facts, therefore all present".
  assert.throws(() => gradeFacts('kb-ab-does-not-exist', 'anything'), /unknown topic/);
});

test('a `node <script>` gate resolves against this repo, not the cell sandbox', () => {
  // The defect this pins: gatherEvidence spawns the acceptance command with cwd = the cell's
  // restored sandbox. A repo-relative script path therefore resolved INSIDE that snapshot, which
  // predates the checker and does not contain it — so the gate exited 1 for BOTH arms and the
  // cell measured nothing. That failure is indistinguishable from "the agent did badly", which is
  // exactly the kind of silent floor the 2026-08-22 run already suffered once.
  //
  // Copying the checker into the sandbox is NOT the fix: its fact patterns spell out the answers,
  // so a readable checker would hand the graded content to the agent.
  const src = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'experiments', 'evidence-harness.mjs'),
    'utf8',
  );
  assert.match(src, /cmd === 'node'/, 'the node-gate resolution must exist');
  assert.match(src, /!fs\.existsSync\(inCell\) && fs\.existsSync\(inRepo\)/,
    'resolution must be conditional on the cell lacking the script — never an unconditional rewrite');
});
