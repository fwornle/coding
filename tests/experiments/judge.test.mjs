// tests/experiments/judge.test.mjs
//
// Phase 73, Plan 73-04 (Wave 2) — unit suite for lib/experiments/judge.mjs
// (ROUTE-03 + SCORE-01). Proves, WITHOUT any network, the four contract paths via
// an INJECTED fake callProxy:
//   1. trivial run (only Read/Glob) → not_scored:'trivial', and the proxy is
//      NEVER called (D-04 — the close is not paid for a no-op run).
//   2. proxy throws → pending:true, all judged fields null, runJudge does NOT
//      throw (D-03 / T-73-04-BLOCK).
//   3. unparseable content → pending:true (parse-failure quarantine, T-73-04-PARSE).
//   4. happy path → pending:false, not_scored:null, goal_aligned_ratio computed
//      IN CODE (2 toward, 1 away, 1 neutral → 2/3, neutral excluded), rubric populated.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runJudge } from '../../lib/experiments/judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'route');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

const SPAN = { task_id: 'judge-test-1', goal_sentence: 'Fix the failing auth test.' };
const EVIDENCE = {
  verification: 'PASSED',
  reviewFindings: 0,
  testSummary: { passed: 12, failed: 0 },
  diffStat: ' lib/auth.mjs | 4 +-',
  planTasks: ['Fix the failing auth test'],
};

// A spy wrapper that counts invocations and returns/throws what the test wants.
function makeFakeProxy(impl) {
  const fake = async (body) => {
    fake.calls += 1;
    fake.lastBody = body;
    return impl(body);
  };
  fake.calls = 0;
  fake.lastBody = null;
  return fake;
}

describe('runJudge — trivial guard (D-04)', () => {
  test('a Read/Glob-only trace skips the proxy entirely and returns not_scored:trivial', async () => {
    const trace = [
      { seq: 0, tool_call_id: 'n0', tool_name: 'Read', inputs_digest: 'd0', target_path: '/a', started_at: '2026-06-24T11:00:00.000Z', ended_at: '2026-06-24T11:00:01.000Z', outcome: 'success', agent: 'claude' },
      { seq: 1, tool_call_id: 'n1', tool_name: 'Glob', inputs_digest: 'd1', target_path: null, started_at: '2026-06-24T11:00:02.000Z', ended_at: '2026-06-24T11:00:03.000Z', outcome: 'success', agent: 'copilot' },
    ];
    const fake = makeFakeProxy(() => { throw new Error('proxy must NOT be called on a trivial run'); });

    const j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake });

    assert.equal(fake.calls, 0, 'proxy must never be invoked for a trivial run');
    assert.equal(j.not_scored, 'trivial');
    assert.equal(j.pending, false);
    assert.equal(j.goal_aligned_ratio, null);
    assert.deepEqual(j.event_labels, []);
    assert.deepEqual(j.rubric, {
      goal_achieved: null, code_quality: null, test_coverage: null, regressions: null, spec_drift: null,
    });
  });

  test('forceScore bypasses the trivial guard — an empty experiment cell IS judged (failure, not hidden)', async () => {
    // A spec-driven cell that produced no consequential events is a FAILURE to score
    // from evidence, not a "trivial" run to omit. With forceScore the proxy IS called
    // even on an empty trace, and the judged verdict (here goal_achieved 0) is returned.
    const failVerdict = {
      goal_aligned_ratio: 0, event_labels: [], ratio_rationale: 'no work done',
      rubric: { goal_achieved: 0, code_quality: null, test_coverage: 0, regressions: null, spec_drift: null },
      rubric_rationale: 'agent wrote nothing; test fails',
    };
    const fake = makeFakeProxy(() => ({ content: JSON.stringify(failVerdict) }));

    const j = await runJudge({ span: SPAN, trace: [], evidence: EVIDENCE, callProxy: fake, forceScore: true });

    assert.equal(fake.calls, 1, 'proxy MUST be called for a force-scored experiment cell');
    assert.notEqual(j.not_scored, 'trivial');
    assert.equal(j.rubric.goal_achieved, 0);
  });
});

describe('runJudge — proxy-failure quarantine (D-03)', () => {
  test('a rejecting proxy returns pending:true with all-null fields and never throws', async () => {
    const trace = loadFixture('loop'); // 3 Bash events → non-trivial
    const fake = makeFakeProxy(() => { throw new Error('ECONNREFUSED 12435'); });

    let j;
    await assert.doesNotReject(async () => { j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake }); });

    assert.equal(fake.calls, 1, 'proxy is invoked once for a non-trivial run');
    assert.equal(j.pending, true);
    assert.equal(j.not_scored, null);
    assert.equal(j.goal_aligned_ratio, null);
    assert.deepEqual(j.event_labels, []);
    assert.equal(j.rubric.goal_achieved, null);
    assert.equal(j.rubric.regressions, null);
  });
});

describe('runJudge — parse-failure quarantine (T-73-04-PARSE)', () => {
  test('unparseable content yields pending:true (no exception)', async () => {
    const trace = loadFixture('loop');
    const fake = makeFakeProxy(() => ({ content: 'not json', provider: 'x', model: 'y' }));

    const j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake });

    assert.equal(j.pending, true);
    assert.equal(j.not_scored, null);
    assert.equal(j.goal_aligned_ratio, null);
  });

  test('a non-object proxy response also quarantines to pending', async () => {
    const trace = loadFixture('loop');
    const fake = makeFakeProxy(() => null);

    const j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake });

    assert.equal(j.pending, true);
  });
});

describe('runJudge — happy path (ratio computed in code)', () => {
  test('valid JSON with 2 toward / 1 away / 1 neutral → ratio 2/3, rubric populated', async () => {
    const trace = loadFixture('loop');
    const llmContent = JSON.stringify({
      event_labels: [
        { seq: 0, label: 'toward', reason: 'edits the auth module' },
        { seq: 1, label: 'away', reason: 'reverts a needed change' },
        { seq: 2, label: 'toward', reason: 'adds the missing assertion' },
        { seq: 3, label: 'neutral', reason: 'housekeeping' },
      ],
      ratio_rationale: 'Most actions advanced the goal.',
      rubric: {
        goal_achieved: 0.9,
        code_quality: 0.8,
        test_coverage: 0.75,
        regressions: 0,
        spec_drift: 0.1,
      },
      rubric_rationale: 'VERIFICATION passed; tests green; small diff.',
    });
    const fake = makeFakeProxy(() => ({ content: llmContent, provider: 'copilot', model: 'claude-haiku-4-5' }));

    const j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake });

    assert.equal(fake.calls, 1);
    assert.equal(j.pending, false);
    assert.equal(j.not_scored, null);
    // 2 toward, 1 away, 1 neutral → toward/(toward+away) = 2/3 (neutral excluded).
    assert.equal(j.goal_aligned_ratio, 2 / 3);
    assert.equal(j.event_labels.length, 4);
    assert.equal(j.rubric.goal_achieved, 0.9);
    assert.equal(j.rubric.code_quality, 0.8);
    assert.equal(j.rubric.test_coverage, 0.75);
    assert.equal(j.rubric.regressions, 0);
    assert.equal(j.rubric.spec_drift, 0.1);
    assert.equal(j.ratio_rationale, 'Most actions advanced the goal.');
    // the request routed via taskType (Haiku tier)
    assert.equal(fake.lastBody.taskType, 'route_judge');
    assert.equal(fake.lastBody.process, 'route-judge');
  });

  test('out-of-range rubric values clamp; non-numbers → null (no-evidence)', async () => {
    const trace = loadFixture('loop');
    const llmContent = JSON.stringify({
      event_labels: [{ seq: 0, label: 'toward' }],
      rubric: {
        goal_achieved: 1.7, // over-range → clamp to 1
        code_quality: -0.5, // under-range → clamp to 0
        test_coverage: 'n/a', // non-number → null
        regressions: 1,
        // spec_drift omitted → null
      },
    });
    const fake = makeFakeProxy(() => ({ content: '```json\n' + llmContent + '\n```' }));

    const j = await runJudge({ span: SPAN, trace, evidence: EVIDENCE, callProxy: fake });

    assert.equal(j.pending, false);
    assert.equal(j.rubric.goal_achieved, 1);
    assert.equal(j.rubric.code_quality, 0);
    assert.equal(j.rubric.test_coverage, null);
    assert.equal(j.rubric.regressions, 1);
    assert.equal(j.rubric.spec_drift, null);
    // single toward label, no away → ratio 1
    assert.equal(j.goal_aligned_ratio, 1);
  });
});
