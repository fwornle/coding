import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyKnnVector,
  KNN_EMBEDDING_MODEL,
  KNN_SCHEMA_VERSION,
  parseKnnArtifact,
} from '../../scripts/lib/prompt-classifier-knn.mjs';
import {
  chooseDecision,
  foldForGroup,
  labelsFromScores,
  precisionByBand,
  readScoreRows,
} from '../../scripts/lib/prompt-classifier-training.mjs';

function artifact(overrides = {}) {
  return parseKnnArtifact({
    schemaVersion: KNN_SCHEMA_VERSION,
    embedding: { model: KNN_EMBEDDING_MODEL, dimensions: 2 },
    decision: { k: 3, minSimilarity: 0.7, minMargin: 0.2, votePower: 2 },
    examples: [
      { id: 's1', label: 'small', vector: [1, 0] },
      { id: 's2', label: 'small', vector: [0.99, 0.01] },
      { id: 'm1', label: 'medium', vector: [0, 1] },
      { id: 'm2', label: 'medium', vector: [0.01, 0.99] },
      { id: 'h1', label: 'high', vector: [-1, 0] },
      ...overrides.examples ?? [],
    ],
    ...overrides,
  });
}

describe('semantic KNN runtime', () => {
  it('accepts a close, decisive vote and returns evidence', () => {
    const result = classifyKnnVector(artifact(), [1, 0]);
    assert.equal(result.accepted, true);
    assert.equal(result.band, 'small');
    assert.equal(result.neighbors.length, 3);
    assert.ok(result.nearestSimilarity > 0.99);
  });

  it('abstains below the similarity threshold', () => {
    const result = classifyKnnVector(artifact({
      decision: { k: 3, minSimilarity: 1, minMargin: 0, votePower: 2 },
    }), [0.8, 0.2]);
    assert.equal(result.accepted, false);
    assert.match(result.reason, /nearest similarity/);
  });

  it('refuses artifacts trained in a different embedding space', () => {
    assert.throws(() => artifact({ embedding: { model: 'other', dimensions: 2 } }), /embedding\.model/);
  });
});

describe('training labels and gates', () => {
  it('derives the least capable successful band from objective scores', () => {
    const rows = labelsFromScores([
      { query_id: 'a', question: 'easy', scores: { haiku: 1, sonnet: 1 } },
      { query_id: 'b', question: 'mid', scores: { haiku: 0, sonnet: 1 } },
      { query_id: 'c', question: 'hard', scores: { haiku: 0, sonnet: 0 } },
    ], { smallModel: 'haiku', mediumModel: 'sonnet' });
    assert.deepEqual(rows.map(row => row.label), ['small', 'medium', 'high']);
  });

  it('refuses a stale score table without the configured band model', () => {
    assert.throws(
      () => labelsFromScores([{ question: 'x', scores: { old: 1 } }], { smallModel: 'haiku', mediumModel: 'sonnet' }),
      /no model "haiku"/,
    );
  });

  it('refuses a non-score JSON document instead of writing an empty dataset', () => {
    assert.throws(
      () => readScoreRows(new URL('../fixtures/prompt-classifier-labels.json', import.meta.url).pathname),
      /no score records/,
    );
  });

  it('requires every possible small destination to pass', () => {
    const [row] = labelsFromScores([
      { question: 'x', scores: { haiku: 1, qwen: 0, sonnet: 1 } },
    ], { smallModels: ['haiku', 'qwen'], mediumModels: ['sonnet'] });
    assert.equal(row.label, 'medium');
  });

  it('scores conservative overclassification as safe, not a false downgrade', () => {
    const stats = precisionByBand([
      { accepted: true, predicted: 'medium', actual: 'small' },
      { accepted: true, predicted: 'small', actual: 'medium' },
    ]);
    assert.equal(stats.medium.precision, 1);
    assert.equal(stats.small.precision, 0);
  });

  it('selects held-out thresholds that satisfy per-band precision', () => {
    const examples = [];
    const vectors = [];
    const groups = [];
    for (let fold = 0; fold < 3; fold += 1) {
      let candidate = 0;
      while (foldForGroup(`family-${fold}-${candidate}`, 3) !== fold) candidate += 1;
      groups.push(`family-${fold}-${candidate}`);
    }
    for (const [bandIndex, label] of ['small', 'medium', 'high'].entries()) {
      for (let fold = 0; fold < 3; fold += 1) {
        for (let repeat = 0; repeat < 2; repeat += 1) {
          const id = `${label}-${fold}-${repeat}`;
          const offset = (fold * 2 + repeat) / 100;
          const vector = bandIndex === 0 ? [1, offset]
            : bandIndex === 1 ? [offset, 1]
              : [-1, offset];
          examples.push({ id, text: id, label, group: groups[fold] });
          vectors.push(vector);
        }
      }
    }
    const decision = chooseDecision(examples, vectors, {
      folds: 3,
      precisionGate: 0.9,
      minPredictionsPerBand: 1,
      kValues: [1, 3],
    });
    assert.ok(decision.worstPrecision >= 0.9);
    assert.ok(decision.coverage > 0);
  });
});
