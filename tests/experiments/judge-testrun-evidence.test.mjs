// tests/experiments/judge-testrun-evidence.test.mjs
//
// The judge must USE the run's own acceptance command.
//
// The defect this pins: `gatherEvidence` ran the spec's `test_command` against the
// cell's sandbox and put the result in `evidence.testRun`, and `buildJudgeContext`
// serialised the whole evidence object into the prompt — so the data was always there.
// But the prompt's "Rubric evidence sources" line named only "VERIFICATION verdict +
// test summary + goal-vs-diff", and `testSummary` is a DIFFERENT, almost-always-null
// slot read from a phase artifact. The judge therefore never recognised a passing
// acceptance command as corroboration and capped every run on "no corroborating
// evidence" — producing a byte-identical score for all 17 recorded cells of a
// kb-on/kb-off A/B, across both arms and all three tasks, which made the correctness
// axis of that experiment carry zero information.
//
// These are deterministic (stubbed proxy, no LLM). The behavioural check — that a
// passing / failing / absent acceptance command now yield separated scores — was done
// against a real archived cell and is recorded in the commit message.
//
// node:test + node:assert/strict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runJudge } from '../../lib/experiments/judge.mjs';
import { gatherEvidence } from '../../lib/experiments/evidence-harness.mjs';

/** Capture the exact body runJudge would send, and return a well-formed judgment. */
function capturingProxy(sink) {
  return async (body) => {
    sink.body = body;
    return {
      content: JSON.stringify({
        event_labels: [],
        ratio_rationale: 'ok',
        rubric: { goal_achieved: 1, code_quality: 1, test_coverage: null, regressions: 0, spec_drift: null },
        rubric_rationale: 'ok',
      }),
    };
  };
}

const span = { task_id: 't', goal_sentence: 'Create a file that contains the required marker.' };

test('the acceptance command and its outcome reach the judge prompt', async () => {
  const sink = {};
  const evidence = {
    verification: null,
    testSummary: null,
    diffStat: ' file.md | 10 +',
    testRun: { command: 'grep -q -F persistOnClose runbook.md', status: 0, counts: null },
    planTasks: null,
  };
  await runJudge({ span, trace: [], evidence, callProxy: capturingProxy(sink), forceScore: true });

  const user = sink.body.messages.find((m) => m.role === 'user').content;
  // Without the command text, `status: 0` is ambiguous — "tests passed" reads very
  // differently from "grep for the required string passed", and only the latter tells
  // the judge the produced artifact actually contains what was asked for.
  assert.match(user, /grep -q -F persistOnClose runbook\.md/);
  assert.match(user, /"status": 0/);
});

test('the prompt names evidence.testRun as a goal_achieved source', async () => {
  // Asserted against the system message actually SENT, not a module constant — that is
  // the thing the model reads, and it keeps the judge's public surface unchanged.
  const sink = {};
  await runJudge({
    span, trace: [],
    evidence: { testRun: { command: 'x', status: 0, counts: null } },
    callProxy: capturingProxy(sink), forceScore: true,
  });
  const JUDGE_SYSTEM_PROMPT = sink.body.messages.find((m) => m.role === 'system').content;
  // The regression guard proper: the bug was a prompt that described the evidence
  // incompletely, not missing data. If someone rewrites the prompt and drops this,
  // the judge silently goes back to ignoring the acceptance command.
  assert.match(JUDGE_SYSTEM_PROMPT, /evidence\.testRun/);
  assert.match(JUDGE_SYSTEM_PROMPT, /goal_achieved: the run's own acceptance command/);
  // It must also distinguish "no pass/fail counts" from "no test ran" — a grep gate
  // has no counts, and reading that as an absent test is what produced the flat score.
  assert.match(JUDGE_SYSTEM_PROMPT, /counts null = the command reports no pass\/fail totals/);
  assert.match(JUDGE_SYSTEM_PROMPT, /testRun null = no command was resolvable/);
  // And a passing run must never be cited as lacking corroboration.
  assert.match(JUDGE_SYSTEM_PROMPT, /PASSING evidence\.testRun is corroboration/);
});

test('gatherEvidence records WHICH command ran, not just its exit status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-ev-'));
  try {
    fs.writeFileSync(path.join(dir, 'runbook.md'), 'the fix is persistOnClose: false\n');
    const passing = gatherEvidence({
      span: { meta: { test_command: 'grep -q -F persistOnClose runbook.md' } },
      phaseArg: null,
      repoRoot: dir,
    });
    assert.equal(passing.testRun.command, 'grep -q -F persistOnClose runbook.md');
    assert.equal(passing.testRun.status, 0);
    // A content assertion emits no pass/fail totals. That must stay null rather than
    // being invented, and must NOT be read downstream as "no test ran".
    assert.equal(passing.testRun.counts, null);

    const failing = gatherEvidence({
      span: { meta: { test_command: 'grep -q -F absent-marker runbook.md' } },
      phaseArg: null,
      repoRoot: dir,
    });
    assert.notEqual(failing.testRun.status, 0);
    assert.equal(failing.testRun.command, 'grep -q -F absent-marker runbook.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
