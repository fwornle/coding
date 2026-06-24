// tests/experiments/goal-sentence.test.mjs
// ROUTE-01 / D-03 proof: deriveGoalSentence is a PURE zero-LLM extractor of the
// '**Goal**:' line. PLAN.md is the primary source; the ROADMAP phase block is the
// fallback; a missing/empty source yields '' (the caller quarantines headless per
// D-05) and the helper NEVER throws.
//
// Unit suite only — no LLM, no network. No `--live` argv gate is needed here (and
// would be dropped by node:test's per-file child proc anyway — see
// memory/reference_node_test_argv_live_gate.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveGoalSentence } from '../../lib/experiments/goal-sentence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(__dirname, '..', 'fixtures', 'route');
const SAMPLE_PLAN = path.join(FIX, 'sample-PLAN.md');
const SAMPLE_ROADMAP = path.join(FIX, 'sample-ROADMAP.md');

/** A path under tmp that is guaranteed not to exist. */
function missingPath(name) {
  return path.join(os.tmpdir(), `goal-sentence-missing-${process.pid}-${name}.md`);
}

test('PLAN.md primary: extracts the **Goal**: line from the fixture PLAN.md', () => {
  const goal = deriveGoalSentence({ phase: 99, planPath: SAMPLE_PLAN, roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal, 'Ship the fixture goal sentence so the extractor returns this text.');
});

test('PLAN.md wins over ROADMAP when both exist (primary precedence)', () => {
  // Even though the ROADMAP fixture has a phase-72 goal, the PLAN.md goal must win.
  const goal = deriveGoalSentence({ phase: 72, planPath: SAMPLE_PLAN, roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal, 'Ship the fixture goal sentence so the extractor returns this text.');
});

test('ROADMAP fallback: PLAN.md absent → reads the matching phase **Goal**: line', () => {
  const goal = deriveGoalSentence({ phase: 72, planPath: missingPath('plan'), roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal, 'Fallback fixture goal sentence for phase seventy-two.');
});

test('ROADMAP fallback selects the requested phase block, not adjacent phases', () => {
  const goal71 = deriveGoalSentence({ phase: 71, planPath: missingPath('p71'), roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal71, 'This is the wrong phase goal and must NOT be returned.');
  const goal73 = deriveGoalSentence({ phase: 73, planPath: missingPath('p73'), roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal73, 'Also the wrong phase goal and must NOT be returned.');
});

test('phase arg tolerates string form (e.g. "72") and full "72-name" slugs', () => {
  const goalStr = deriveGoalSentence({ phase: '72', planPath: missingPath('ps'), roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goalStr, 'Fallback fixture goal sentence for phase seventy-two.');
});

test('empty source: both PLAN.md and ROADMAP absent → "" without throwing', () => {
  let goal;
  assert.doesNotThrow(() => {
    goal = deriveGoalSentence({ phase: 72, planPath: missingPath('a'), roadmapPath: missingPath('b') });
  });
  assert.equal(goal, '');
});

test('no paths supplied at all → "" without throwing', () => {
  let goal;
  assert.doesNotThrow(() => {
    goal = deriveGoalSentence({ phase: 72 });
  });
  assert.equal(goal, '');
});

test('PLAN.md present but has no **Goal**: line → falls back to ROADMAP', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sentence-nogoal-'));
  const noGoalPlan = path.join(dir, 'PLAN.md');
  fs.writeFileSync(noGoalPlan, '# Plan with no goal marker\n\nNothing to extract here.\n', 'utf8');
  const goal = deriveGoalSentence({ phase: 72, planPath: noGoalPlan, roadmapPath: SAMPLE_ROADMAP });
  assert.equal(goal, 'Fallback fixture goal sentence for phase seventy-two.');
});

test('regex tolerates surrounding whitespace and a trailing period; trims the sentence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-sentence-ws-'));
  const wsPlan = path.join(dir, 'PLAN.md');
  fs.writeFileSync(wsPlan, '   **Goal**:    Trim me well.   \n', 'utf8');
  const goal = deriveGoalSentence({ phase: 1, planPath: wsPlan });
  assert.equal(goal, 'Trim me well.');
});

test('zero-LLM / zero-network: extraction does no async work, returns synchronously', () => {
  // A pure fs.readFileSync + regex returns a string immediately (not a Promise).
  const goal = deriveGoalSentence({ phase: 99, planPath: SAMPLE_PLAN });
  assert.equal(typeof goal, 'string');
  assert.ok(!(goal instanceof Promise), 'result is not a Promise (no async LLM/network call)');
});
