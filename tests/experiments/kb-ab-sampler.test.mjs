// tests/experiments/kb-ab-sampler.test.mjs
//
// The sampler exists to turn a hand-picked task set into a sampled one, so the A/B can report a
// discrimination rate instead of an existence proof. Most of what can go wrong with it is silent:
// a biased sample still produces a number, a leaked answer still produces a number, and a fact set
// quietly reduced to nothing still produces a number. These tests pin the properties that make the
// number mean what the report will say it means.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KEEP_MIN_FACTS,
  MAX_GAPS_PER_BRANCH,
  patternShapeProblem,
  referencePrompt,
  MIN_SYMPTOM_CHARS,
  buildGoalSentence,
  deriveTask,
  extractSymptoms,
  factCandidatePrompt,
  framePopulation,
  goalLeaksFact,
  parseFactCandidates,
  samplePopulation,
  section,
  seededShuffle,
  selectFacts,
  slugFromTopic,
} from '../../lib/experiments/kb-ab-sampler.mjs';

/**
 * An insight in the shape `.data/observation-export/insights.json` actually carries.
 *
 * The `## Key Files` line carries the synthetic tokens the tests below use as fact sources. That is
 * not padding: `parseFactCandidates` enforces a SELF-MATCH precondition — a pattern that does not
 * match the insight it was derived from is malformed — so a fixture whose facts are absent from its
 * own summary would be rejected before any filter under test could run.
 */
function insight(over = {}) {
  return {
    id: 'i-1',
    project: 'coding',
    confidence: 0.9,
    createdAt: '2026-08-01T00:00:00.000Z',
    topic: 'LevelDB Write Amplification — Read Paths',
    summary: [
      '## Purpose', 'Explains why a read-only route rewrites the graph.', '',
      '## Key Files',
      '- `alpha`, `bravo`, `charlie`, `delta`, `zulu` — tok0 tok1 tok2 tok3 tok4',
      '- when it wedges, restart the service and re-check',
      '',
      '## Troubleshooting',
      '- **Container OOM-killed on roughly every poll of a read-only route**: pass `readOnly: true`, which sets `persistOnClose: false`',
      '- **Wedged**: restart it',
    ].join('\n'),
    ...over,
  };
}

// ── population and sampling ────────────────────────────────────────────────

test('the frame keeps confidence but NOT recency — recency is a covariate, not a criterion', () => {
  const pop = framePopulation([
    insight({ id: 'a', confidence: 0.9, createdAt: '2026-06-01T00:00:00.000Z' }), // pre-snapshot
    insight({ id: 'b', confidence: 0.9, createdAt: '2026-08-01T00:00:00.000Z' }), // post
    insight({ id: 'c', confidence: 0.5 }),                                        // below threshold
    insight({ id: 'd', project: 'other' }),                                       // other project
  ], { snapshotDate: '2026-07-20' });

  assert.deepEqual(pop.map((r) => r.id), ['a', 'b'], 'a pre-snapshot insight must survive the frame');
  // Conditioning the denominator on recency would rebuild the selection bias the sampler removes.
  assert.equal(pop.find((r) => r.id === 'a').postSnapshot, false);
  assert.equal(pop.find((r) => r.id === 'b').postSnapshot, true);
});

test('the same seed draws the same sample, and a different seed does not', () => {
  const pop = framePopulation(
    Array.from({ length: 60 }, (_, i) => insight({ id: `i-${String(i).padStart(2, '0')}` })),
  );
  const a = samplePopulation(pop, { n: 10, seed: 'pilot-1' }).sampled.map((r) => r.id);
  const b = samplePopulation(pop, { n: 10, seed: 'pilot-1' }).sampled.map((r) => r.id);
  const c = samplePopulation(pop, { n: 10, seed: 'pilot-2' }).sampled.map((r) => r.id);

  assert.deepEqual(a, b, 'a seeded sample must be reproducible — "sampled" is only a claim if it replays');
  assert.notDeepEqual(a, c);
});

test('the sample is order-stable against the input order, so export order cannot bias it', () => {
  const rows = Array.from({ length: 40 }, (_, i) => insight({ id: `i-${String(i).padStart(2, '0')}` }));
  const forward = samplePopulation(framePopulation(rows), { n: 8, seed: 's' }).sampled.map((r) => r.id);
  const reversed = samplePopulation(framePopulation(rows.slice().reverse()), { n: 8, seed: 's' }).sampled.map((r) => r.id);
  assert.deepEqual(forward, reversed);
});

test('the ledger opens a row for EVERY population member, not just the drawn ones', () => {
  const pop = framePopulation(Array.from({ length: 25 }, (_, i) => insight({ id: `i-${i}` })));
  const { sampled, ledger } = samplePopulation(pop, { n: 5, seed: 's' });

  assert.equal(ledger.length, 25, 'the denominator has to be inspectable, or the rate is not auditable');
  assert.equal(ledger.filter((r) => r.status === 'sampled').length, sampled.length);
  assert.ok(ledger.filter((r) => r.status === 'not-drawn').every((r) => r.reason));
});

test('seededShuffle does not mutate its input', () => {
  const input = ['a', 'b', 'c', 'd'];
  seededShuffle(input, 'x');
  assert.deepEqual(input, ['a', 'b', 'c', 'd']);
});

// ── symptom extraction: the first line of defence against leaking the answer ─

test('extractSymptoms takes the symptom half and NEVER the resolution half', () => {
  const [first] = extractSymptoms(insight().summary);
  assert.match(first.symptom, /OOM-killed on roughly every poll/);
  // The resolution names the fix. If it reached the goal, kb-off would be handed the answer and
  // the task would report a spurious tie.
  assert.doesNotMatch(first.symptom, /persistOnClose/);
  assert.doesNotMatch(first.symptom, /readOnly/);
});

test('a self-labelled bullet drops the "Symptom:" label, keeping the symptom', () => {
  const s = ['## Troubleshooting',
    '- **Symptom: report prose contradicts the data table entirely**: check for misread dashes',
  ].join('\n');
  const [first] = extractSymptoms(s);
  assert.equal(first.symptom, 'report prose contradicts the data table entirely');
});

test('symptoms shorter than the floor are rejected — they name a component, not a fault', () => {
  const s = ['## Troubleshooting', '- **Wedged obs-api**: restart it'].join('\n');
  assert.equal(extractSymptoms(s).length, 0);
  assert.ok('Wedged obs-api'.length < MIN_SYMPTOM_CHARS);
});

test('section() reads only the named section', () => {
  const s = ['## Purpose', 'purpose text', '', '## Troubleshooting', '- a bullet'].join('\n');
  assert.equal(section(s, 'Purpose'), 'purpose text');
  assert.equal(section(s, 'Troubleshooting'), '- a bullet');
  assert.equal(section(s, 'Nonexistent'), '');
});

// ── goal shape ─────────────────────────────────────────────────────────────

test('the goal is EXECUTION-shaped and names the deliverable', () => {
  const goal = buildGoalSentence({ slug: 'foo-bar', symptom: 'the thing breaks in a specific way' });
  // Analysis-shaped goals are short-circuited by isTrivialRun before the judge is paid for, and
  // headless agents narrate-then-yield on them — both destroy the cell silently rather than failing.
  assert.match(goal, /^Create a file named foo-bar-runbook\.md at the repository root/);
  assert.match(goal, /state the root cause/);
  assert.match(goal, /fixes it\.$/);
});

test('slugFromTopic truncates on a word boundary, never mid-word', () => {
  const slug = slugFromTopic('km-core Host node_modules Bind-Mount — Dual Consumers And More Words');
  assert.ok(slug.length <= 48);
  // A mid-word cut reads as a typo in the filename the goal names; an agent that "corrects" it
  // writes a file the gate never looks for, and the cell scores zero for a cosmetic reason.
  assert.doesNotMatch(slug, /-$/);
  assert.ok(!slug.endsWith('consum'), `truncated mid-word: ${slug}`);
});

// ── the leak guard ─────────────────────────────────────────────────────────

test('goalLeaksFact catches a goal that states its own answer', () => {
  const facts = [{ id: 'persist', source: 'persistOnClose', flags: '' }];
  const leaky = buildGoalSentence({ slug: 'x', symptom: 'the route OOMs unless persistOnClose is set' });
  const clean = buildGoalSentence({ slug: 'x', symptom: 'the route OOMs on roughly every poll' });

  assert.deepEqual(goalLeaksFact(leaky, facts), ['persist']);
  assert.deepEqual(goalLeaksFact(clean, facts), []);
});

// ── candidate parsing ──────────────────────────────────────────────────────

test('parseFactCandidates survives a code fence and surrounding prose', () => {
  const reply = 'Here you go:\n```json\n{"facts":[{"id":"a","source":"foo","flags":"i","why":"w"}]}\n```\n';
  const { candidates } = parseFactCandidates(reply);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'a');
});

test('parseFactCandidates rejects a pattern that matches everything', () => {
  const { candidates, rejected } = parseFactCandidates('{"facts":[{"id":"all","source":".*"},{"id":"ok","source":"foo"}]}');
  // `.*` would pass the gate unconditionally, inflating the rate while looking like a clean result.
  assert.deepEqual(candidates.map((c) => c.id), ['ok']);
  assert.equal(rejected[0].reason, 'matches the empty string');
});

test('parseFactCandidates rejects an invalid regex and a duplicate id rather than guessing', () => {
  const { candidates, rejected } = parseFactCandidates(
    '{"facts":[{"id":"bad","source":"([unclosed"},{"id":"x","source":"foo"},{"id":"x","source":"bar"}]}',
  );
  assert.deepEqual(candidates.map((c) => c.id), ['x'], 'only the first valid, non-duplicate id survives');
  assert.equal(rejected.length, 2);
  assert.ok(rejected.some((r) => r.reason.startsWith('invalid regex:')));
  assert.ok(rejected.some((r) => r.reason === 'duplicate id'));
});

test('parseFactCandidates returns a reason, not a throw, on junk', () => {
  const { candidates, rejected } = parseFactCandidates('no json here at all');
  assert.equal(candidates.length, 0);
  assert.equal(rejected[0].reason, 'no JSON object in reply');
});

test('the candidate prompt shows the model the insight and never the repository', () => {
  const msgs = factCandidatePrompt(insight());
  const joined = msgs.map((m) => m.content).join('\n');
  assert.match(joined, /LevelDB Write Amplification/);
  // Literal-first, not sentence-template. Measured: a prompt asking for spanning patterns produced
  // candidates where 5 of 6 failed to match even their own source insight.
  assert.match(joined, /WRITE LITERALS, NOT SENTENCE TEMPLATES/);
  assert.match(joined, /at most ONE bounded gap/);
  // A generator with repo access proposes facts it found in the tree — the failure that retired
  // kb-ab-proxy-endpoint, where every graded token was grep-able and the gate measured nothing.
  assert.doesNotMatch(joined, /repository (tree|root|files)|source code of/i);
});

// ── fact selection: the rule most likely to be "helpfully" broken ───────────

test('a grep-able fact is KEPT, with inSandbox recorded — the etm regression', () => {
  // kb-ab-etm-crashloop audits FAIL (all four facts grep-able) and still discriminated 4.00/4 vs
  // 1.33/4: kb-off searched 123 times across three cells and never found them. Dropping grep-able
  // facts would have removed that task's entire fact set, rebuilding the selection bias the
  // sampler exists to avoid. `inSandbox` is recorded, never applied.
  const candidates = [{ id: 'symlink', source: 'node_modules/@fwornle/km-core', flags: '', why: 'root cause' }];
  const signals = new Map([['symlink', { injected: true, referenced: true, coined: false, inSandbox: true }]]);

  const { kept, dropped } = selectFacts(candidates, signals);
  assert.equal(dropped.length, 0, 'a grep-able fact must NOT be dropped');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].inSandbox, true, 'grep-ability is recorded as a covariate');
});

test('the three blind signals drop, and only they', () => {
  const candidates = [
    { id: 'absent-from-block', source: 'aaa', flags: '', why: '' },
    { id: 'ungradeable', source: 'bbb', flags: '', why: '' },
    { id: 'coinable', source: 'ccc', flags: '', why: '' },
    { id: 'good', source: 'ddd', flags: '', why: '' },
  ];
  const signals = new Map([
    ['absent-from-block', { injected: false, referenced: false, coined: false, inSandbox: false }],
    ['ungradeable', { injected: true, referenced: false, coined: false, inSandbox: false }],
    ['coinable', { injected: true, referenced: true, coined: true, inSandbox: false }],
    ['good', { injected: true, referenced: true, coined: false, inSandbox: false }],
  ]);

  const { kept, dropped } = selectFacts(candidates, signals);
  assert.deepEqual(kept.map((f) => f.id), ['good']);
  assert.deepEqual(
    dropped.map((f) => [f.id, f.reason]),
    [['absent-from-block', 'not-injected'], ['ungradeable', 'absent-from-reference'], ['coinable', 'model-coins-it']],
  );
});

test('a candidate with no measured signals is dropped, never silently kept', () => {
  const { kept, dropped } = selectFacts([{ id: 'x', source: 'foo', flags: '', why: '' }], new Map());
  assert.equal(kept.length, 0);
  assert.equal(dropped[0].reason, 'not-injected');
});

// ── end to end, with fakes ─────────────────────────────────────────────────

/**
 * Probe set where, by default, every candidate passes all three blind filters.
 *
 * `reference` defaults to two texts that mention every candidate, i.e. "a correct answer would
 * contain this" — so a test that wants to exercise the reference filter overrides it explicitly.
 */
function probes({
  facts, injectedExtra = '', coinage = [], reference, inSandbox = () => false, onCoinage, onReference,
} = {}) {
  const mentionsAll = facts.map((f) => `matches ${f.probe ?? f.source}`).join('\n');
  return {
    complete: async () => JSON.stringify({ facts }),
    retrieve: async () => `${mentionsAll}\n${injectedExtra}`,
    reference: async (goal) => {
      if (onReference) onReference(goal);
      return reference ?? [mentionsAll, mentionsAll];
    },
    coinage: async (goal) => { if (onCoinage) onCoinage(goal); return coinage; },
    inSandbox: async (c) => inSandbox(c),
    symptom: async () => null,
  };
}

test('deriveTask emits a spec and a fact set when enough facts survive', async () => {
  const facts = [
    { id: 'f1', source: 'alpha', flags: '', why: 'a' },
    { id: 'f2', source: 'bravo', flags: '', why: 'b' },
    { id: 'f3', source: 'charlie', flags: '', why: 'c' },
  ];
  const row = await deriveTask(insight(), probes({ facts }));

  assert.equal(row.status, 'derived');
  assert.equal(row.factSet.facts.length, 3);
  assert.equal(row.factSet.topic, row.spec.experimentId);
  assert.equal(row.spec.testCommand, `node scripts/kb-ab-assert.mjs ${row.factSet.topic}`);
  assert.equal(row.spec.taskClass, 'docs');
  assert.deepEqual(row.spec.variants.map((v) => v.env), ['kb-on', 'kb-off']);
  assert.ok(row.spec.variants.every((v) => v.model === 'claude-sonnet-4-6'),
    'the model is pinned, never the `sonnet` alias, or it changes mid-matrix');
  assert.equal(row.factSet.deliverable, `${row.slug}-runbook.md`);
});

test('deriveTask excludes a task that falls below the fact floor, and says why', async () => {
  const facts = [{ id: 'f1', source: 'alpha', flags: '', why: 'a' }, { id: 'f2', source: 'bravo', flags: '', why: 'b' }];
  const row = await deriveTask(insight(), probes({ facts }));

  assert.equal(row.status, 'excluded');
  assert.match(row.reason, new RegExp(`need ${KEEP_MIN_FACTS}`));
  assert.equal(row.spec, undefined);
});

test('the keep rule fires at exactly KEEP_MIN_FACTS', async () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, source: `tok${i}`, flags: '', why: '' }));
  const below = await deriveTask(insight(), probes({ facts: mk(KEEP_MIN_FACTS - 1) }));
  const at = await deriveTask(insight(), probes({ facts: mk(KEEP_MIN_FACTS) }));

  assert.equal(below.status, 'excluded');
  assert.equal(at.status, 'derived');
});

test('a fact leaked by the goal is dropped, and can sink the task below the floor', async () => {
  // "OOM-killed on roughly every poll of a read-only route" is the extracted symptom, so a fact
  // matching `read-only` is stated by the goal itself.
  const facts = [
    { id: 'leaky', source: 'read-only', flags: 'i', why: 'x' },
    { id: 'f2', source: 'bravo', flags: '', why: 'b' },
    { id: 'f3', source: 'charlie', flags: '', why: 'c' },
  ];
  const row = await deriveTask(insight(), probes({ facts }));

  assert.equal(row.status, 'excluded');
  assert.ok(row.dropped.some((d) => d.id === 'leaky' && d.reason === 'leaked-by-goal'));
});

test('deriveTask excludes an insight with no usable symptom rather than inventing one', async () => {
  const thin = insight({ summary: '## Purpose\nsomething\n\n## Troubleshooting\n- **Wedged**: restart' });
  const row = await deriveTask(thin, probes({ facts: [] }));

  assert.equal(row.status, 'excluded');
  assert.match(row.reason, /no usable symptom/);
});

test('a fact the bare model coins is dropped — it cannot distinguish the arms', async () => {
  const facts = [
    { id: 'coinable', source: 'restart the service', flags: 'i', why: '' },
    { id: 'f2', source: 'bravo', flags: '', why: '' },
    { id: 'f3', source: 'charlie', flags: '', why: '' },
  ];
  // One bare answer already contains the "coinable" fact, so injection cannot be credited for it.
  const row = await deriveTask(insight(), probes({
    facts, coinage: ['you should Restart The Service and check logs', 'unrelated', 'unrelated'],
  }));

  assert.equal(row.status, 'excluded');
  assert.ok(row.dropped.some((d) => d.id === 'coinable' && d.reason === 'model-coins-it'));
});

test('the coinage corpus is sampled ONCE per task, not once per fact', async () => {
  const calls = [];
  const facts = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, source: `tok${i}`, flags: '', why: '' }));
  const row = await deriveTask(insight(), probes({ facts, onCoinage: (g) => calls.push(g) }));

  // "Asked this goal with nothing to look at, does the model write this fact" is one question per
  // TASK. Per-fact probing would answer an easier one and cost a call per fact.
  assert.equal(calls.length, 1);
  assert.equal(calls[0], row.goal);
});

test('the coinage probe is skipped entirely when nothing was injected', async () => {
  const calls = [];
  const p = probes({ facts: [{ id: 'a', source: 'zulu', flags: '', why: '' }], onCoinage: (g) => calls.push(g) });
  p.retrieve = async () => 'the block mentions nothing relevant';
  const row = await deriveTask(insight(), p);

  assert.equal(calls.length, 0, 'bare answers cost LLM calls and are worthless with no injectable fact');
  assert.equal(row.status, 'excluded');
});

// ── the coinage tier guard ─────────────────────────────────────────────────

test('modelTier ranks the families the routing config actually serves', async () => {
  const { modelTier } = await import('../../scripts/kb-ab-sample-tasks.mjs');
  assert.equal(modelTier('claude-haiku-4-5-20251001'), 1);
  // The three spellings of one model must rank identically, or the guard fires on a rename.
  assert.equal(modelTier('claude-sonnet-4.6'), 2);
  assert.equal(modelTier('claude-sonnet-4-6'), 2);
  assert.equal(modelTier('claude-sonnet-5'), 2, 'sonnet-5 is a PEER of sonnet-4.6 here, not a superior');
  assert.equal(modelTier('claude-opus-5'), 3);
  // `mini` must not be swallowed by the gpt-4o branch.
  assert.equal(modelTier('gpt-4o'), 2);
  assert.equal(modelTier('gpt-4o-mini'), 1);
});

test('an unrecognised model ranks BELOW the floor, so it fails loudly', async () => {
  const { modelTier } = await import('../../scripts/kb-ab-sample-tasks.mjs');
  // Silently accepting an unknown id is how a coinage probe ends up on something cheap without
  // anyone noticing — the shape of report pitfall 3. Unknown must be rejected, not assumed fine.
  assert.equal(modelTier('some-new-id-nobody-mapped'), 0);
  assert.ok(modelTier('some-new-id-nobody-mapped') < modelTier('claude-sonnet-4-6'));
});

test('the guard is ONE-SIDED: peer-or-stronger passes, weaker fails', async () => {
  const { modelTier } = await import('../../scripts/kb-ab-sample-tasks.mjs');
  const cell = modelTier('claude-sonnet-4-6');
  // Coinage on a stronger model drops facts the cells might not have coined — conservative, it can
  // only UNDERSTATE the rate, so it is allowed. A weaker model misses facts the cells WOULD coin;
  // those survive the filter and inflate the rate, so it must not be.
  assert.ok(modelTier('claude-opus-5') >= cell);
  assert.ok(modelTier('claude-sonnet-5') >= cell);
  assert.ok(modelTier('claude-haiku-4.5') < cell);
});

// ── pattern shape: the first guard against a transcribed sentence ──────────

test('every CURATED fact passes the shape guard — the guard must not outlaw published work', async () => {
  const { FACT_SETS } = await import('../../lib/experiments/kb-ab-facts.mjs');
  for (const [topic, set] of Object.entries(FACT_SETS)) {
    if (set.generated) continue; // sampled sets are the thing being judged, not the yardstick
    for (const fact of set.facts) {
      assert.equal(
        patternShapeProblem(fact.re.source), null,
        `curated fact ${topic}/${fact.id} was rejected by the shape guard`,
      );
    }
  }
});

test('gaps are counted PER BRANCH, so a multi-alternative fact is not punished for its arms', () => {
  // The curated read-open-still-writes shape: three alternatives, four gaps in total, two in any
  // one branch. A global cap would reject it — which is precisely the bug this counting avoids.
  const threeArms = 'read-only[^.]{0,60}(open|store)[^.]{0,80}(persist|write)'
    + '|persist[^.]{0,60}(on|at)\\s+close|close\\(\\)[^.]{0,80}persist';
  assert.equal(patternShapeProblem(threeArms), null);
});

test('a pattern chaining gaps within one branch is rejected as a phrasing demand', () => {
  // Real output from the first working derivation: five specific emoji, each within 40 characters
  // of the next. No correct runbook would ever emit that, so it scores 0 in BOTH arms and the task
  // masquerades as hard when the gate is simply broken.
  const pictograms = '⏰[^.]{0,40}⏳[^.]{0,40}🔇[^.]{0,40}❓[^.]{0,40}🚫';
  const problem = patternShapeProblem(pictograms);
  assert.ok(problem, 'the emoji-sequence pattern must be rejected');
  assert.match(problem, new RegExp(`max ${MAX_GAPS_PER_BRANCH}`));
});

test('an over-long pattern is rejected even when its gap count is fine', () => {
  assert.match(patternShapeProblem(`${'a'.repeat(210)}`), /transcribing prose/);
});

test('parseFactCandidates applies the shape guard, with the reason recorded', () => {
  const reply = JSON.stringify({ facts: [
    { id: 'transcription', source: 'a[^.]{0,40}b[^.]{0,40}c[^.]{0,40}d', flags: 'i' },
    { id: 'claim', source: 'persistOnClose', flags: '' },
  ] });
  const { candidates, rejected } = parseFactCandidates(reply);
  assert.deepEqual(candidates.map((c) => c.id), ['claim']);
  assert.match(rejected[0].reason, /bounded gaps/);
});

// ── the reference filter ───────────────────────────────────────────────────

test('a fact no correct answer contains is dropped as ungradeable', async () => {
  const facts = [
    { id: 'overfit', source: 'alpha', flags: '', why: '' },
    { id: 'f2', source: 'bravo', flags: '', why: '' },
    { id: 'f3', source: 'charlie', flags: '', why: '' },
    { id: 'f4', source: 'delta', flags: '', why: '' },
  ];
  // `overfit` IS in the injected block (the KB prose contains it) but in NEITHER reference — the
  // signature of a pattern that transcribes the insight's wording rather than asserting something
  // a correct runbook would state. This is the case the injection filter alone cannot see.
  const ref = ['matches bravo charlie delta', 'matches bravo charlie delta'];
  const row = await deriveTask(insight(), probes({ facts, reference: ref }));

  assert.equal(row.status, 'derived', 'the three gradeable facts still clear the floor');
  assert.deepEqual(row.factSet.facts.map((f) => f.id), ['f2', 'f3', 'f4']);
  assert.ok(row.dropped.some((d) => d.id === 'overfit' && d.reason === 'absent-from-reference'));
});

test('a fact must appear in EVERY reference, not merely one', async () => {
  const facts = [
    { id: 'only-in-one', source: 'alpha', flags: '', why: '' },
    { id: 'f2', source: 'bravo', flags: '', why: '' },
    { id: 'f3', source: 'charlie', flags: '', why: '' },
  ];
  // Present in the first reference, absent from the second: phrasing-dependent, so not a safe gate.
  const row = await deriveTask(insight(), probes({
    facts, reference: ['matches alpha bravo charlie', 'matches bravo charlie'],
  }));

  assert.equal(row.status, 'excluded');
  assert.ok(row.dropped.some((d) => d.id === 'only-in-one' && d.reason === 'absent-from-reference'));
});

test('the reference corpus is sampled once per task, before coinage', async () => {
  const order = [];
  const facts = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, source: `tok${i}`, flags: '', why: '' }));
  await deriveTask(insight(), probes({
    facts,
    onReference: () => order.push('reference'),
    onCoinage: () => order.push('coinage'),
  }));
  // References usually eliminate the over-fits, and coinage is meaningless for a fact no correct
  // answer would contain — so paying for coinage first would be paying for nothing.
  assert.deepEqual(order, ['reference', 'coinage']);
});

test('coinage is never paid for when the reference filter left nothing', async () => {
  const calls = [];
  const facts = [{ id: 'overfit', source: 'zulu', flags: '', why: '' }];
  const row = await deriveTask(insight(), probes({
    facts, reference: ['nothing relevant here', 'nor here'], onCoinage: () => calls.push(1),
  }));
  assert.equal(calls.length, 0);
  assert.equal(row.status, 'excluded');
});

test('a reference probe that returns nothing excludes the task rather than grading it', async () => {
  const facts = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, source: `tok${i}`, flags: '', why: '' }));
  // An empty corpus must not vacuously satisfy `every()` — that would wave through every candidate
  // precisely when the filter failed to run.
  const row = await deriveTask(insight(), probes({ facts, reference: [] }));
  assert.equal(row.status, 'excluded');
  assert.equal(row.factSet, undefined);
});

test('the reference prompt is open-book and varies its wording per sample', () => {
  const a = referencePrompt(insight(), 'GOAL TEXT', 0).map((m) => m.content).join('\n');
  const b = referencePrompt(insight(), 'GOAL TEXT', 1).map((m) => m.content).join('\n');
  // Open-book: it models a CORRECT deliverable, unlike the closed-book coinage probe.
  assert.match(a, /LevelDB Write Amplification|read-only route/);
  assert.match(a, /GOAL TEXT/);
  // Different style directives keep a surviving fact from being an echo of one turn of phrase.
  assert.notEqual(a, b);
});

test('the self-match precondition rejects a pattern absent from its own source insight', () => {
  // The measured failure: a generator writing spanning patterns produced six candidates of which
  // five matched nothing — not the runbook, not even the insight they were derived from. Catching
  // that at parse time costs nothing; catching it later costs a reference probe and a coinage probe.
  const reply = JSON.stringify({ facts: [
    { id: 'grounded', source: 'persistOnClose', flags: '' },
    { id: 'invented', source: 'token-usage-logger\\.ts', flags: '' },
  ] });
  const { candidates, rejected } = parseFactCandidates(reply, insight().summary);
  assert.deepEqual(candidates.map((c) => c.id), ['grounded']);
  assert.match(rejected[0].reason, /does not match the insight/);
});

test('without a source text the precondition is skipped, not silently failed', () => {
  const reply = JSON.stringify({ facts: [{ id: 'x', source: 'anything', flags: '' }] });
  assert.equal(parseFactCandidates(reply).candidates.length, 1);
});

test('coinage must come from the cells\' model FAMILY, not merely an equal tier', async () => {
  const { modelFamily, modelTier } = await import('../../scripts/kb-ab-sample-tasks.mjs');
  // The fallback chain behind the coinage route ends in groq/llama-3.3-70b-versatile and
  // openai/gpt-4o. Both clear the tier floor. Neither answers "do THESE weights already carry the
  // fact", which is the only question coinage asks.
  assert.equal(modelFamily('claude-sonnet-4-6'), 'claude');
  assert.equal(modelFamily('claude-haiku-4.5'), 'claude');
  assert.equal(modelFamily('llama-3.3-70b-versatile'), 'open-weights');
  assert.equal(modelFamily('gpt-4o'), 'openai');
  assert.ok(modelTier('llama-3.3-70b-versatile') >= modelTier('claude-sonnet-4-6'),
    'llama clears the tier floor — which is exactly why family is checked separately');
  assert.notEqual(modelFamily('llama-3.3-70b-versatile'), modelFamily('claude-sonnet-4-6'));
});

test('a pattern carrying a redaction placeholder is rejected', () => {
  // The insight corpus is redacted, so `<company>` and `<USER_ID_REDACTED>` appear in insight text.
  // A pattern inheriting one passes self-match (it matches the insight) and then matches no
  // deliverable ever written — a broken gate wearing the costume of a hard task.
  const problem = patternShapeProblem('span\\.<company>\\.cwd');
  assert.ok(problem, 'the placeholder pattern must be rejected');
  assert.match(problem, /redaction placeholder/);
  assert.match(patternShapeProblem('<USER_ID_REDACTED>/Agentic'), /redaction placeholder/);
});

test('ordinary regex groups are not mistaken for redaction placeholders', () => {
  // `<` is legal in a pattern; only a bare <word> placeholder is the tell. A guard that fired on
  // lookbehind or a named group would reject perfectly good facts.
  assert.equal(patternShapeProblem('(?<name>foo)bar'), null);
  assert.equal(patternShapeProblem('a<b'), null);
  assert.equal(patternShapeProblem('persistOnClose'), null);
});
