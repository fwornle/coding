/**
 * Layer 0 (session filter) runs when path, keyword, embedding and semantic
 * analysis all leave the exchange undecided. It asks isNeutralPromptSet about
 * the embedding result, which was declared inside the embedding branch, so the
 * lookup threw a ReferenceError and every undecided exchange fell into the
 * error path instead of following the conversation bias.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ReliableCodingClassifier from '../../src/live-logging/ReliableCodingClassifier.js';

function undecidedClassifier(embeddingResult) {
  const c = new ReliableCodingClassifier({ codingRepo: '/nonexistent/coding', enableLogging: false, skipSemanticAnalysis: true });
  c.pathAnalyzer = { analyzePaths: async () => ({ isCoding: false, confidence: 0, fileOperations: [] }) };
  c.keywordMatcher = { matchKeywords: async () => ({ isCoding: false, confidence: 0, score: 0 }) };
  c.embeddingClassifier = { classifyByEmbedding: async () => embeddingResult };
  c.operationalLogger = null;
  c.performanceMonitor = { recordMeasurement: () => {} };
  let seen;
  c.biasTracker = {
    neutralityThresholds: { path_confidence: 0.5, keyword_score: 0.3, embedding_similarity_diff: 0.15, embedding_threshold: 0.7 },
    hasSufficientBias: () => true,
    getBiasDecision: () => ({ target: 'CODING_INFRASTRUCTURE', confidence: 0.8, reason: 'bias' }),
    getState: () => ({}),
    addClassification: () => {},
  };
  const isNeutral = c.isNeutralPromptSet.bind(c);
  c.isNeutralPromptSet = (p, k, e) => { seen = e; return isNeutral(p, k, e); };
  return { c, seenEmbedding: () => seen };
}

test('an undecided exchange follows the conversation bias', async () => {
  const embedding = { isCoding: null, inconclusive: true, similarity_scores: { max_similarity: 0.4, score_difference: 0.02 } };
  const { c, seenEmbedding } = undecidedClassifier(embedding);
  const result = await c.classify({ content: 'sounds good, go ahead' });
  assert.equal(result.layer, 'session-filter');
  assert.equal(result.classification, 'CODING_INFRASTRUCTURE');
  assert.equal(seenEmbedding(), embedding);
});

test('a strong embedding signal keeps the exchange out of the session filter', async () => {
  const embedding = { isCoding: null, inconclusive: true, similarity_scores: { max_similarity: 0.95, score_difference: 0.5 } };
  const { c } = undecidedClassifier(embedding);
  const result = await c.classify({ content: 'sounds good, go ahead' });
  assert.equal(result.layer, 'default');
  assert.equal(result.classification, 'NOT_CODING_INFRASTRUCTURE');
});
