#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import { KNN_EMBEDDING_MODEL, KNN_SCHEMA_VERSION, normalizeVector } from './lib/prompt-classifier-knn.mjs';
import { chooseDecision, readLabelledPrompts } from './lib/prompt-classifier-training.mjs';

const args = process.argv.slice(2);
const value = (name, fallback = '') => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const input = value('input', 'tests/fixtures/prompt-classifier-labels.json');
const output = value('output', '.data/prompt-classifier/knn-model.json');
const cacheDir = path.resolve(value('cache-dir', '.data/fastembed-cache'));
const precisionGate = Number(value('precision-gate', '0.9'));
const folds = Number(value('folds', '5'));
const minPredictionsPerBand = Number(value('min-predictions-per-band', '1'));
const kValues = value('k', '3,5,7').split(',').map(Number).filter(Number.isInteger);

try {
  const examples = readLabelledPrompts(input);
  process.stdout.write(`loading ${KNN_EMBEDDING_MODEL}; cache=${cacheDir}\n`);
  const embedder = await FlagEmbedding.init({ model: EmbeddingModel.AllMiniLML6V2, cacheDir });
  const vectors = [];
  // Use the same generic embedding operation runtime uses. Mixing passageEmbed
  // for training with queryEmbed for inference creates two different vector
  // spaces and makes cross-validation better than production.
  for await (const batch of embedder.embed(examples.map(row => row.text), 64)) {
    for (const vector of batch) vectors.push(normalizeVector(vector));
  }
  if (vectors.length !== examples.length) throw new Error(`embedded ${vectors.length}/${examples.length} prompts`);

  const decision = chooseDecision(examples, vectors, {
    folds,
    precisionGate,
    minPredictionsPerBand,
    kValues,
  });
  const artifact = {
    schemaVersion: KNN_SCHEMA_VERSION,
    trainedAt: new Date().toISOString(),
    source: { input: path.resolve(input), examples: examples.length, folds },
    embedding: { model: KNN_EMBEDDING_MODEL, dimensions: vectors[0].length },
    decision: {
      k: decision.k,
      minSimilarity: decision.minSimilarity,
      minMargin: decision.minMargin,
      votePower: decision.votePower,
    },
    evaluation: {
      precisionGate,
      minPredictionsPerBand,
      coverage: decision.coverage,
      accepted: decision.accepted,
      total: decision.total,
      worstBandPrecision: decision.worstPrecision,
      perBand: decision.perBand,
    },
    examples: examples.map((row, index) => ({ id: row.id, label: row.label, vector: vectors[index] })),
  };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  const target = path.resolve(output);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(artifact)}\n`);
  fs.renameSync(temporary, target);
  process.stdout.write(`trained ${examples.length} prompts -> ${output}\n`);
  process.stdout.write(`${JSON.stringify(artifact.evaluation, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`KNN training failed: ${error.message}\n`);
  process.exit(1);
}
