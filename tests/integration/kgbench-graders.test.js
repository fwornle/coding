/**
 * Grader and aggregation contract for kgbench.
 *
 * These are the parts that decide what every number in the report means, and they
 * are pure — so they are tested without spawning a single model call, and they run
 * in lite CI. The specific behaviours pinned here are the ones whose absence made
 * the predecessor harness misreport: silent dropping of failures, precision-free
 * set scoring, and un-gated winner declarations at low n.
 */

import {
  gradePath, gradeContains, gradeRegex, gradeSet, gradeChecklist, gradeAbstain, grade,
  gradeQuestion, resolveGrader, detectContamination, assertiveSegments,
} from '../../lib/kgbench/graders.mjs';
import { summaryStats, classifyRow, declareWinner, aggregate } from '../../lib/kgbench/report.mjs';

describe('gradePath', () => {
  it('scores exact, basename-only, and miss distinctly', () => {
    const gt = 'integrations/graphify/graphify/detect.py';
    expect(gradePath(gt, gt).score).toBe(1);
    expect(gradePath('other/dir/detect.py', gt).score).toBe(0.5);
    expect(gradePath('lib/nope.py', gt).score).toBe(0);
  });

  it('tolerates the decorations models actually emit', () => {
    const gt = 'lib/a/b.py';
    expect(gradePath('`lib/a/b.py`', gt).score).toBe(1);
    expect(gradePath('./lib/a/b.py', gt).score).toBe(1);
    expect(gradePath('  lib/a/b.py  ', gt).score).toBe(1);
  });

  it('scores an empty answer 0 rather than crashing', () => {
    expect(gradePath('', 'a/b.py').score).toBe(0);
  });
});

describe('gradeSet', () => {
  const gt = ['a/one.py', 'b/two.py', 'c/three.py'];

  it('is 1.0 only for an exact set', () => {
    expect(gradeSet(gt.join('\n'), gt).score).toBeCloseTo(1, 5);
  });

  it('penalises over-listing — recall alone would reward a shotgun answer', () => {
    const shotgun = [...gt, 'x/1.py', 'x/2.py', 'x/3.py', 'x/4.py', 'x/5.py'].join('\n');
    const s = gradeSet(shotgun, gt).score;
    expect(s).toBeLessThan(1);
    expect(s).toBeGreaterThan(0);
  });

  it('penalises under-listing', () => {
    expect(gradeSet('a/one.py', gt).score).toBeLessThan(1);
  });
});

describe('gradeChecklist', () => {
  const spec = {
    checklist: [
      { id: 'f1', must: true, match: { type: 'path', value: 'scripts/graphify-reindex.sh' } },
      { id: 'f2', must: true, match: { type: 'regex', value: '/api/cgr/reindex' } },
      { id: 'f3', must: false, match: { type: 'any-of', value: ['progress.json'] } },
    ],
    forbidden: [{ id: 'x1', match: { type: 'regex', value: 'memgraph' } }],
  };

  it('scores required facts recovered', () => {
    expect(gradeChecklist('nothing useful', spec).score).toBe(0);
    expect(gradeChecklist('it calls scripts/graphify-reindex.sh', spec).score).toBeCloseTo(0.5, 5);
    const both = gradeChecklist('POST /api/cgr/reindex spawns scripts/graphify-reindex.sh', spec);
    expect(both.score).toBeCloseTo(1, 5);
  });

  it('optional facts add a capped bonus, never exceeding 1.0', () => {
    const r = gradeChecklist('POST /api/cgr/reindex spawns scripts/graphify-reindex.sh and polls progress.json', spec);
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('a forbidden fact forces 0 and flags hallucination even when every required fact is present', () => {
    // The whole point: confidently wrong is worse than incomplete.
    const r = gradeChecklist('POST /api/cgr/reindex spawns scripts/graphify-reindex.sh against Memgraph', spec);
    expect(r.score).toBe(0);
    expect(r.hallucinated).toBe(true);
    expect(r.forbiddenHit).toContain('x1');
  });

  it('reports which required facts were missed, for offline re-grading', () => {
    expect(gradeChecklist('only /api/cgr/reindex', spec).missing).toEqual(['f1']);
  });
});

describe('gradeAbstain', () => {
  const spec = { forbidden: [{ id: 'x', match: { type: 'regex', value: 'src/payments' } }] };

  it('rewards an honest miss', () => {
    expect(gradeAbstain('That is not present in this repository.', spec).score).toBe(1);
  });

  it('scores 0 and flags hallucination when the arm invents a location', () => {
    const r = gradeAbstain('It is defined in src/payments/handler.ts', spec);
    expect(r.score).toBe(0);
    expect(r.hallucinated).toBe(true);
  });

  it('scores 0 for a confident non-answer that never abstains', () => {
    expect(gradeAbstain('The function initialises the widget subsystem.', spec).score).toBe(0);
  });
});

describe('grade() dispatch', () => {
  it('defers llm-type questions to the judge rather than scoring them 0', () => {
    const g = grade('anything', { type: 'llm', rubric: 'x' });
    expect(g.score).toBeNull();
    expect(g.judgeOnly).toBe(true);
  });

  it('returns null (not 0) for an unknown grader type', () => {
    expect(grade('x', { type: 'nonsense' }).score).toBeNull();
  });
});

/**
 * Regression pins for the four defects the coding-v1 pilot exposed. Each `it` below
 * corresponds to a case that was scored WRONG before, in a way that would have been
 * published as a finding about a backend.
 */
describe('grader wiring — questions author facts at the top level', () => {
  // 13 of coding-v1's 17 questions look like this: checklist, no `grader` block.
  const q = {
    id: 'L1', cls: 'lookup', prompt: 'x',
    checklist: [{ id: 'f1', must: true, match: { type: 'path', value: 'install.sh' } }],
  };

  it('infers a checklist grader instead of scoring null "no grader"', () => {
    expect(grade('install.sh', q.grader).score).toBeNull();      // the old path
    expect(gradeQuestion(q, 'it is install.sh').score).toBe(1);  // the fixed path
  });

  it('routes question-level forbidden into abstain questions', () => {
    // Previously spec.forbidden was undefined here, so the fabrication check that the
    // entire abstain class exists to perform never ran even once.
    const t = {
      id: 'T9', cls: 'abstain', prompt: 'x', grader: { type: 'abstain' },
      forbidden: [{ id: 'x1', match: { type: 'regex', value: 'src/payments' } }],
    };
    expect(resolveGrader(t).forbidden).toHaveLength(1);
    expect(gradeQuestion(t, 'It lives in src/payments/handler.ts').hallucinated).toBe(true);
  });

  it('infers abstain from cls even with no grader block at all', () => {
    expect(resolveGrader({ id: 'T', cls: 'abstain', prompt: 'x' }).type).toBe('abstain');
  });
});

describe('gradeAbstain — phrasing variety', () => {
  // The exact wording graphify used on T3, which the substring list did not contain.
  // It scored 0 + hallucinated, and that artefact was nearly published as
  // "graphify fabricated an answer".
  const real = 'No, this repository does not contain a payment reconciliation service. '
    + 'Searching for "payment" combined with "reconciliation" across the codebase only turns up '
    + 'unrelated hits — things like `lib/lsl/token/reconcile.mjs` and `scripts/measurement-reconciler.mjs`, '
    + 'which reconcile *token/observation measurements*, not payments. There is no module, service, '
    + 'or file implementing payment reconciliation anywhere in this repo.';

  const spec = {
    forbidden: [{
      id: 'x1',
      match: { type: 'near', value: ['payment|reconcil', '(?:src|lib|services|scripts)/[\\w./-]+\\.(?:js|mjs|ts|py)'], within: 120 },
    }],
  };

  it('recognises "does not contain" and "there is no" as abstentions', () => {
    expect(gradeAbstain('This repository does not contain such a service.', {}).abstained).toBe(true);
    expect(gradeAbstain('There is no module implementing that.', {}).abstained).toBe(true);
    expect(gradeAbstain('That was removed and no longer exists.', {}).abstained).toBe(true);
  });

  it('scores the real graphify answer 1.0 and does NOT flag hallucination', () => {
    const r = gradeAbstain(real, spec);
    expect(r.abstained).toBe(true);
    expect(r.hallucinated).toBe(false);
    expect(r.score).toBe(1);
  });

  it('still catches a genuine fabrication', () => {
    const fake = 'The payment reconciliation service is implemented in lib/payments/reconcile.mjs.';
    expect(gradeAbstain(fake, spec).score).toBe(0);
    expect(gradeAbstain(fake, spec).hallucinated).toBe(true);
  });

  it('catches a fabrication hidden behind a denial clause', () => {
    // Sentence-level splitting alone would treat this as negated and let it through.
    const sneaky = 'It is not in src/foo.js but in lib/payments/reconcile.mjs.';
    expect(gradeAbstain(sneaky, spec).hallucinated).toBe(true);
  });
});

describe('assertiveSegments — mentioning vs asserting', () => {
  it('drops segments that dismiss, keeps segments that assert', () => {
    const segs = assertiveSegments('There is no such file. It lives in lib/real.mjs.');
    expect(segs.join(' ')).toContain('lib/real.mjs');
    expect(segs.join(' ')).not.toContain('no such file');
  });
});

describe('near matcher — claims, not shapes', () => {
  // T1's forbidden fact used to be the regex `\.(js|json|...)`, i.e. "mentions any
  // filename". Every correct answer explains which config file DOES exist, so every
  // correct answer tripped it. `near` binds the path to the forbidden claim.
  const m = { type: 'near', value: ['memgraph', '[\\w./-]+\\.(?:js|json)\\b'], within: 120 };
  const spec = { forbidden: [{ id: 'x1', match: m }] };

  it('ignores a filename mentioned far from the forbidden claim', () => {
    expect(gradeAbstain('No such file exists. The registry is config/code-graph.json.', spec).score).toBe(1);
  });

  it('fires when the path is tied to the claim', () => {
    expect(gradeAbstain('Memgraph is configured in config/memgraph.json.', spec).hallucinated).toBe(true);
  });
});

describe('assertiveSegments — retirement verbs are stems', () => {
  // The real r6 answer that this cost. A textbook-correct abstention was scored 0 and
  // flagged as a fabrication, because `replaced` was in the cue list but `replace` was
  // not — so "was merged in to replace X and uses a static graph.json" read as an
  // assertion, and it puts the retired subject next to a path. Naming the artefact that
  // REPLACED the subject is what a correct answer does, so the rule punished being right.
  const correct = 'No file in this repository configures a Memgraph connection — it does not exist. '
    + 'The current code-graph backend is graphify, which was merged in to replace '
    + 'CodeGraphRAG+Memgraph and uses a static `graph.json` output.';

  const t1 = {
    id: 'T1', cls: 'abstain', prompt: 'x', grader: { type: 'abstain' },
    forbidden: [{
      id: 'x1',
      match: { type: 'near', value: ['memgraph', '[\\w./-]+\\.(?:js|mjs|ts|json|yml|yaml|py|sh)\\b'], within: 120 },
    }],
  };

  it('drops present-tense retirement narrative, not just past participles', () => {
    for (const v of ['replace', 'replaces', 'replacing', 'retires', 'removing', 'supersedes', 'deprecates']) {
      expect(assertiveSegments(`graphify ${v} the old backend in graph.json`)).toEqual([]);
    }
  });

  it('scores the correct abstention 1.00 instead of flagging a fabrication', () => {
    const g = gradeQuestion(t1, correct);
    expect(g.hallucinated).toBe(false);
    expect(g.score).toBe(1);
  });

  it('still catches a real fabrication that names a config file', () => {
    for (const f of ['The Memgraph connection is configured in config/memgraph.json.',
                     'It is set up in docker/docker-compose.yml, which defines the Memgraph service.']) {
      expect(gradeQuestion(t1, f).hallucinated).toBe(true);
    }
  });
});

describe('detectContamination', () => {
  // grep's real pilot answer to T3 — a perfect score earned by reading the answer key.
  const leaked = 'This question is a known "abstain" probe from '
    + '`config/kgbench/questions/coding-v1.json:184` (id `T3`) — its own provenance note '
    + 'calls it a pure fabrication probe. There is no payment reconciliation service here.';

  it('flags an answer that cites the benchmark ground truth', () => {
    expect(detectContamination(leaked).contaminated).toBe(true);
  });

  it('does not flag an ordinary correct abstention', () => {
    expect(detectContamination('There is no such module in this repository.').contaminated).toBe(false);
  });

  it('refuses to rank a contaminated answer, keeping the raw score for forensics', () => {
    const q = { id: 'T3', cls: 'abstain', prompt: 'x', grader: { type: 'abstain' } };
    const r = gradeQuestion(q, leaked);
    expect(r.contaminated).toBe(true);
    expect(r.score).toBeNull();          // must not count as a win
    expect(r.score_if_clean).toBe(1);    // what it would have scored
  });

  // ---- the r5 miss ----------------------------------------------------------
  // These three shapes all scored a clean 1.00 in the published r5 run. The arm had
  // grepped a comment in the harness's own grading source that named a trap's subject,
  // then reported the probe as a probe. Every signal of the day missed it: one by a
  // single quote character, the rest because nothing looked for an answer citing the
  // machinery that marks it.

  it('detects self-identification through punctuation, as a soft signal', () => {
    // The quote character alone used to defeat this. It is now a SOFT signal, so what
    // must survive is DETECTION — the row is flagged and counted, not voided.
    for (const t of ['a benchmark "abstain" probe', "an 'abstain' probe", 'a `trap` probe']) {
      const d = detectContamination(`This is ${t} — nothing here implements it.`);
      expect(d.weak).toContain('self-identifies-as-probe');
      expect(d.contaminated).toBe(false);
    }
  });

  it('flags an answer that cites the grading or containment machinery', () => {
    const real = 'No such service exists. The only hits are in `lib/kgbench/graders.mjs`, '
      + 'a comment describing this exact scenario as a fabrication test case.';
    const d = detectContamination(real);
    expect(d.contaminated).toBe(true);
    expect(d.signals).toContain('cites-grading-machinery');
    expect(detectContamination('containment is verified in `lib/kgbench/sandbox.mjs`, which strips '
      + 'the benchmark answer key from the tree').signals).toContain('cites-grading-machinery');
  });

  it('needs the citation to be load-bearing, not merely a filename', () => {
    // A bare path is where the first version over-fired. The file being named is not the
    // signal; the answer reporting what the BENCHMARK does with it is.
    expect(detectContamination('see lib/kgbench/sandbox.mjs').contaminated).toBe(false);
    expect(detectContamination('modified lib/kgbench/graders.mjs').contaminated).toBe(false);
  });

  it('treats self-identification as SOFT — recorded, not score-voiding', () => {
    // Real r6 answer, scored 1.00 and voided by the hard version of this signal. The arm
    // queried the graph, found only false positives, and concluded the question looked
    // like a probe. That is the inference the abstain class rewards, reached without
    // reading anything — and voiding it loses a correct answer, which biases the result
    // exactly as much as scoring a wrong one.
    const inferred = 'No such module exists. The only hits are false positives — a parser '
      + 'test fixture and dashboard data reconciliation, unrelated. This matches prior '
      + 'findings in memory (this looks like a repeated fabrication probe).';
    const d = detectContamination(inferred);
    expect(d.contaminated).toBe(false);
    expect(d.weak).toContain('self-identifies-as-probe');

    const q = { id: 'T3', cls: 'abstain', prompt: 'x', grader: { type: 'abstain' } };
    const g = gradeQuestion(q, inferred);
    expect(g.score).toBe(1);
    expect(g.contaminated).toBeFalsy();
    expect(g.contamination_weak).toContain('self-identifies-as-probe');
  });

  it('still voids an answer that cites a source, even while calling it a probe', () => {
    const cited = 'This is a benchmark "abstain" probe — the only hits are in '
      + '`lib/kgbench/graders.mjs`, a comment describing it as a fabrication test case.';
    expect(detectContamination(cited).contaminated).toBe(true);
  });

  it('does not flag a correct abstention that merely lists the file among grep hits', () => {
    // Real r6 answer, scored 1.00 and voided by the first version of this signal. The arm
    // enumerated every file mentioning the trap's subject, named graders.mjs among four,
    // and correctly dismissed all of them. Voiding it would delete a right answer.
    const correct = 'No such file exists. The repo has no active configuration for it — '
      + '`docker/Dockerfile.coding-services`, `install.sh`, `lib/kgbench/graders.mjs`, and '
      + '`.planning/**` docs still mention it in passing (mostly legacy/historical context), '
      + "but there's no connection string or env var wiring it up today.";
    expect(detectContamination(correct).contaminated).toBe(false);
  });

  it('leaves harness modules that ARE question evidence alone', () => {
    // L2, B1, B2, A2 and A3 legitimately cite these files. Flagging them would void
    // correct answers and read as those arms failing.
    for (const f of ['lib/kgbench/report.mjs', 'lib/kgbench/runner.mjs', 'lib/kgbench/arms.mjs',
                     'config/kgbench/arms.json', 'scripts/kgbench-run.mjs']) {
      expect(detectContamination(`The value is read in \`${f}\`.`).contaminated).toBe(false);
    }
  });
});

describe('summaryStats — null-not-zero', () => {
  it('filters nulls instead of averaging them as 0', () => {
    // A stalled run recorded as 0 tokens makes the stalling arm look cheapest.
    expect(summaryStats([10, null, 20, undefined]).mean).toBe(15);
    expect(summaryStats([10, null, 20]).n).toBe(2);
  });

  it('returns nulls, not NaN, for an empty set', () => {
    expect(summaryStats([]).median).toBeNull();
    expect(summaryStats([null, null]).n).toBe(0);
  });
});

describe('classifyRow — every row lands in exactly one bucket', () => {
  it('separates failed, ungraded and ranked', () => {
    expect(classifyRow({ outcome: 'timeout' })).toBe('failed');
    expect(classifyRow({ outcome: 'ok', hard_fail: true, score: 1 })).toBe('failed');
    expect(classifyRow({ outcome: 'ok', score: null })).toBe('ungraded');
    expect(classifyRow({ outcome: 'ok', score: 0 })).toBe('ranked');
  });

  it('a zero score is ranked, not discarded', () => {
    expect(classifyRow({ outcome: 'ok', score: 0 })).toBe('ranked');
  });
});

describe('declareWinner — gated so low-n noise does not become a claim', () => {
  it('calls a tie below the ratio threshold', () => {
    const r = declareWinner([
      { arm: 'a', values: [1.0, 1.0, 1.0] },
      { arm: 'b', values: [0.9, 0.9, 0.9] },
    ]);
    expect(r.winner).toBeNull();
    expect(r.reason).toMatch(/tie/);
  });

  it('declares a winner on a large, separated gap', () => {
    const r = declareWinner([
      { arm: 'a', values: [1.0, 1.0, 1.0, 1.0] },
      { arm: 'b', values: [0.2, 0.2, 0.2, 0.2] },
    ]);
    expect(r.winner).toBe('a');
  });

  it('calls a tie when spreads overlap despite a large median gap', () => {
    const r = declareWinner([
      { arm: 'a', values: [1.0, 0.1, 1.0, 0.1] },
      { arm: 'b', values: [0.3, 0.9, 0.3, 0.9] },
    ]);
    expect(r.winner).toBeNull();
  });

  it('honours lowerIsBetter for cost-style metrics', () => {
    const r = declareWinner([
      { arm: 'cheap', values: [10, 10, 10, 10] },
      { arm: 'dear', values: [100, 100, 100, 100] },
    ], { lowerIsBetter: true });
    expect(r.winner).toBe('cheap');
  });
});

describe('aggregate', () => {
  const questions = [{ id: 'Q1', cls: 'lookup' }, { id: 'Q2', cls: 'arch' }];
  const rows = [
    { arm: 'grep', id: 'Q1', cls: 'lookup', outcome: 'ok', score: 1, total_tokens: 100, content_tokens: 10, tool_calls: 2, wall_s: 5, cost_usd: 0.1 },
    { arm: 'grep', id: 'Q2', cls: 'arch', outcome: 'ok', score: 0.5, total_tokens: 120, content_tokens: 20, tool_calls: 3, wall_s: 6, cost_usd: 0.1 },
    { arm: 'graph', id: 'Q1', cls: 'lookup', outcome: 'timeout', hard_fail: true },
    { arm: 'graph', id: 'Q2', cls: 'arch', outcome: 'ok', score: 1, total_tokens: 90, content_tokens: 5, tool_calls: 1, wall_s: 4, cost_usd: 0.2 },
  ];

  it('counts failures into hard_fail_rate instead of dropping them', () => {
    const { byArm } = aggregate(rows, { arms: ['grep', 'graph'], questions });
    expect(byArm.graph.failed).toBe(1);
    expect(byArm.graph.hard_fail_rate).toBeCloseTo(0.5, 5);
    expect(byArm.grep.hard_fail_rate).toBe(0);
    // ...and the failure must not drag the median down as if it scored 0.
    expect(byArm.graph.metrics.score.median).toBe(1);
    expect(byArm.graph.metrics.score.n).toBe(1);
  });

  it('produces a per-class winner entry for every class', () => {
    const { byClass, classes } = aggregate(rows, { arms: ['grep', 'graph'], questions });
    expect(classes).toEqual(['arch', 'lookup']);
    for (const c of classes) expect(byClass[c].winner).toHaveProperty('winner');
  });
});
