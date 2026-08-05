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
