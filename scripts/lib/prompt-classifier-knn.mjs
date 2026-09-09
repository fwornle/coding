// Local semantic KNN classifier used by prompt-classifier-service.mjs.
//
// The model artifact contains labelled prompt embeddings, not executable code.
// Runtime computes one local MiniLM embedding, performs a weighted nearest-
// neighbor vote, and abstains unless both similarity and vote margin clear the
// thresholds selected during held-out evaluation.

import fs from 'node:fs';
import path from 'node:path';

export const KNN_SCHEMA_VERSION = 1;
export const KNN_EMBEDDING_MODEL = 'fast-all-MiniLM-L6-v2';
export const KNN_BANDS = ['small', 'medium', 'high'];

const EPSILON = 1e-12;

export function normalizeVector(vector) {
  if (!Array.isArray(vector) && !ArrayBuffer.isView(vector)) {
    throw new Error('embedding must be an array');
  }
  const values = Array.from(vector, Number);
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= EPSILON) throw new Error('embedding has zero or invalid norm');
  return values.map(value => value / norm);
}

export function cosineSimilarityNormalized(a, b) {
  if (a.length !== b.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export function parseKnnArtifact(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('KNN artifact must be an object');
  if (doc.schemaVersion !== KNN_SCHEMA_VERSION) {
    throw new Error(`unsupported KNN artifact schemaVersion ${String(doc.schemaVersion)}`);
  }
  if (doc.embedding?.model !== KNN_EMBEDDING_MODEL) {
    throw new Error(`KNN artifact embedding.model must be ${KNN_EMBEDDING_MODEL}`);
  }
  const dimensions = Number(doc.embedding?.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error('KNN artifact embedding.dimensions must be positive');

  const decision = doc.decision ?? {};
  const k = Number(decision.k);
  const minSimilarity = Number(decision.minSimilarity);
  const minMargin = Number(decision.minMargin);
  const votePower = Number(decision.votePower ?? 2);
  if (!Number.isInteger(k) || k < 1) throw new Error('KNN artifact decision.k must be a positive integer');
  for (const [name, value] of [['minSimilarity', minSimilarity], ['minMargin', minMargin]]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`KNN artifact decision.${name} must be between 0 and 1`);
    }
  }
  if (!Number.isFinite(votePower) || votePower <= 0) {
    throw new Error('KNN artifact decision.votePower must be positive');
  }

  if (!Array.isArray(doc.examples) || doc.examples.length < k) {
    throw new Error(`KNN artifact needs at least decision.k (${k}) examples`);
  }
  const examples = doc.examples.map((example, index) => {
    if (!KNN_BANDS.includes(example?.label)) throw new Error(`KNN artifact examples[${index}].label is invalid`);
    if (!Array.isArray(example.vector) || example.vector.length !== dimensions) {
      throw new Error(`KNN artifact examples[${index}].vector must have ${dimensions} values`);
    }
    return {
      id: String(example.id ?? index),
      label: example.label,
      vector: normalizeVector(example.vector),
    };
  });

  return {
    schemaVersion: KNN_SCHEMA_VERSION,
    trainedAt: typeof doc.trainedAt === 'string' ? doc.trainedAt : null,
    source: doc.source ?? null,
    embedding: { model: KNN_EMBEDDING_MODEL, dimensions },
    decision: { k, minSimilarity, minMargin, votePower },
    evaluation: doc.evaluation ?? null,
    examples,
  };
}

export function loadKnnArtifact(modelPath) {
  return parseKnnArtifact(JSON.parse(fs.readFileSync(modelPath, 'utf8')));
}

export function classifyKnnVector(artifact, vector) {
  const query = normalizeVector(vector);
  if (query.length !== artifact.embedding.dimensions) {
    throw new Error(`query embedding has ${query.length} dimensions; model needs ${artifact.embedding.dimensions}`);
  }

  const nearest = artifact.examples
    .map(example => ({
      id: example.id,
      label: example.label,
      similarity: cosineSimilarityNormalized(query, example.vector),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, artifact.decision.k);

  const votes = Object.fromEntries(KNN_BANDS.map(band => [band, 0]));
  for (const neighbor of nearest) {
    const weight = Math.max(0, neighbor.similarity) ** artifact.decision.votePower;
    votes[neighbor.label] += weight;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const [band, winningVote] = ranked[0];
  const runnerUpVote = ranked[1]?.[1] ?? 0;
  const totalVote = ranked.reduce((sum, [, vote]) => sum + vote, 0);
  const confidence = totalVote > 0 ? winningVote / totalVote : 0;
  const margin = totalVote > 0 ? (winningVote - runnerUpVote) / totalVote : 0;
  const nearestSimilarity = nearest[0]?.similarity ?? Number.NEGATIVE_INFINITY;
  const accepted = Number.isFinite(nearestSimilarity)
    && nearestSimilarity >= artifact.decision.minSimilarity
    && margin >= artifact.decision.minMargin;

  return {
    band,
    accepted,
    confidence,
    margin,
    nearestSimilarity,
    neighbors: nearest.map(({ id, label, similarity }) => ({ id, label, similarity })),
    reason: accepted
      ? ''
      : nearestSimilarity < artifact.decision.minSimilarity
        ? `nearest similarity ${nearestSimilarity.toFixed(3)} < ${artifact.decision.minSimilarity.toFixed(3)}`
        : `vote margin ${margin.toFixed(3)} < ${artifact.decision.minMargin.toFixed(3)}`,
  };
}

export class PromptKnnClassifier {
  constructor({ modelPath, cacheDir }) {
    this.modelPath = modelPath;
    this.cacheDir = cacheDir;
    this.artifact = null;
    this.modelMtimeMs = 0;
    this.embedder = null;
    this.initPromise = null;
  }

  async load() {
    const stat = fs.statSync(this.modelPath);
    if (this.artifact && stat.mtimeMs === this.modelMtimeMs) return this.artifact;
    const next = loadKnnArtifact(this.modelPath);
    // Publish atomically. A malformed replacement keeps the last known-good
    // model instead of dropping the classifier mid-session.
    this.artifact = next;
    this.modelMtimeMs = stat.mtimeMs;
    return this.artifact;
  }

  async initializeEmbedder() {
    if (this.embedder) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const { EmbeddingModel, FlagEmbedding } = await import('fastembed');
      this.embedder = await FlagEmbedding.init({
        model: EmbeddingModel.AllMiniLML6V2,
        cacheDir: this.cacheDir,
      });
    })();
    try {
      await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  async classify(text) {
    const artifact = await this.load();
    await this.initializeEmbedder();
    let vector = null;
    for await (const batch of this.embedder.embed([text], 1)) {
      vector = batch[0] ?? null;
      break;
    }
    if (!vector) throw new Error('embedding model returned no vector');
    return classifyKnnVector(artifact, vector);
  }

  status() {
    let exists = false;
    let error = null;
    try {
      exists = fs.existsSync(this.modelPath);
      if (exists) {
        const stat = fs.statSync(this.modelPath);
        if (!this.artifact || stat.mtimeMs !== this.modelMtimeMs) {
          const next = loadKnnArtifact(this.modelPath);
          this.artifact = next;
          this.modelMtimeMs = stat.mtimeMs;
        }
      }
    } catch (cause) {
      error = String(cause?.message || cause);
    }
    return {
      modelPath: this.modelPath,
      cacheDir: this.cacheDir,
      exists,
      loaded: Boolean(this.artifact),
      trainedAt: this.artifact?.trainedAt ?? null,
      examples: this.artifact?.examples.length ?? 0,
      decision: this.artifact?.decision ?? null,
      evaluation: this.artifact?.evaluation ?? null,
      error,
    };
  }
}

export function resolveKnnPaths(repo, config) {
  const modelPath = path.resolve(repo, config.modelPath);
  const cacheDir = path.resolve(repo, config.cacheDir);
  return { modelPath, cacheDir };
}
