import fs from 'node:fs';
import crypto from 'node:crypto';

import { classifyKnnVector, normalizeVector } from './prompt-classifier-knn.mjs';

const BANDS = ['small', 'medium', 'high'];

export function readLabelledPrompts(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let rows;
  if (file.endsWith('.jsonl')) {
    rows = raw.split('\n').filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
    });
  } else {
    const doc = JSON.parse(raw);
    rows = Array.isArray(doc) ? doc : doc.cases;
  }
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${file}: no labelled prompts`);
  return rows.map((row, index) => {
    const text = String(row.text ?? row.question ?? row.query ?? '').trim();
    const label = String(row.label ?? '').toLowerCase();
    if (!text) throw new Error(`${file}: row ${index + 1} has no text/question/query`);
    if (!BANDS.includes(label)) throw new Error(`${file}: row ${index + 1} has invalid label "${label}"`);
    return {
      id: String(row.id ?? row.query_id ?? `row-${index + 1}`),
      text,
      label,
      group: String(row.group ?? row.task_name ?? row.id ?? row.query_id ?? `row-${index + 1}`),
    };
  });
}

export function readScoreRows(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) {
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  const doc = JSON.parse(raw);
  if (Array.isArray(doc)) return doc;
  const rows = Object.entries(doc)
    .filter(([, value]) => value && typeof value === 'object' && value.scores)
    .map(([id, value]) => ({ query_id: id, ...value }));
  if (!rows.length) throw new Error(`${file}: no score records with a scores object`);
  return rows;
}

export function labelsFromScores(rows, {
  smallModel,
  mediumModel,
  smallModels = smallModel ? [smallModel] : [],
  mediumModels = mediumModel ? [mediumModel] : [],
  passScore = 1,
}) {
  if (!smallModels.length || !mediumModels.length) throw new Error('at least one small and medium model is required');
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('no score rows to label');
  const output = [];
  for (const [index, row] of rows.entries()) {
    const scores = row.scores;
    if (!scores || typeof scores !== 'object') throw new Error(`score row ${index + 1} has no scores object`);
    for (const model of [...smallModels, ...mediumModels]) {
      if (!(model in scores)) throw new Error(`score row ${index + 1} has no model "${model}"`);
    }
    const text = String(row.question ?? row.query ?? row.text ?? '').trim();
    if (!text) throw new Error(`score row ${index + 1} has no question/query/text`);
    // Every possible destination on a rung must pass. This is stricter than
    // choosing the best small model and is intentional: routing may select the
    // on-prem target instead of the account model after the band is returned.
    const smallPasses = smallModels.every(model => Number(scores[model]) >= passScore);
    const mediumPasses = mediumModels.every(model => Number(scores[model]) >= passScore);
    const label = smallPasses
      ? 'small'
      : mediumPasses
        ? 'medium'
        : 'high';
    output.push({
      id: String(row.query_id ?? row.id ?? `row-${index + 1}`),
      text,
      label,
      group: String(row.task_name ?? row.stratum ?? row.query_id ?? row.id ?? `row-${index + 1}`),
      evidence: {
        smallModels: Object.fromEntries(smallModels.map(model => [model, scores[model]])),
        mediumModels: Object.fromEntries(mediumModels.map(model => [model, scores[model]])),
      },
    });
  }
  return output;
}

export function foldForGroup(group, folds) {
  const digest = crypto.createHash('sha256').update(group).digest();
  return digest.readUInt32BE(0) % folds;
}

export function precisionByBand(rows, emittable = ['small', 'medium']) {
  const out = Object.fromEntries(emittable.map(band => [band, { predicted: 0, correct: 0, precision: null }]));
  for (const row of rows) {
    if (!row.accepted || !out[row.predicted]) continue;
    out[row.predicted].predicted += 1;
    // A prediction at or above the least-capable correct band is conservative,
    // not damaging. Only a cheaper-than-truth verdict is a false downgrade.
    if (BANDS.indexOf(row.predicted) >= BANDS.indexOf(row.actual)) out[row.predicted].correct += 1;
  }
  for (const stat of Object.values(out)) {
    stat.precision = stat.predicted ? stat.correct / stat.predicted : null;
  }
  return out;
}

export function chooseDecision(examples, vectors, {
  folds = 5,
  precisionGate = 0.9,
  minPredictionsPerBand = 1,
  kValues = [3, 5, 7],
  votePower = 2,
} = {}) {
  if (examples.length !== vectors.length) throw new Error('examples/vectors length mismatch');
  const normalized = vectors.map(normalizeVector);
  const rawRows = [];
  for (const k of kValues.filter(value => value < examples.length)) {
    for (let index = 0; index < examples.length; index += 1) {
      const validationFold = foldForGroup(examples[index].group, folds);
      const train = examples
        .map((example, trainIndex) => ({ example, trainIndex }))
        .filter(({ example, trainIndex }) => trainIndex !== index && foldForGroup(example.group, folds) !== validationFold)
        .map(({ example, trainIndex }) => ({ id: example.id, label: example.label, vector: normalized[trainIndex] }));
      if (train.length < k) continue;
      const artifact = {
        embedding: { dimensions: normalized[index].length },
        decision: { k, minSimilarity: 0, minMargin: 0, votePower },
        examples: train,
      };
      rawRows.push({ k, index, actual: examples[index].label, ...classifyKnnVector(artifact, normalized[index]) });
    }
  }
  if (!rawRows.length) throw new Error('not enough examples/groups for cross-validation');

  let best = null;
  for (const k of kValues) {
    const rowsForK = rawRows.filter(row => row.k === k);
    // Search exact observed boundaries. Rounding an observed 0.99995 up to 1.0
    // makes the sample that introduced the threshold reject itself.
    const similarityCandidates = [...new Set(rowsForK.map(row => row.nearestSimilarity))].sort((a, b) => a - b);
    const marginCandidates = [...new Set(rowsForK.map(row => row.margin))].sort((a, b) => a - b);
    for (const minSimilarity of similarityCandidates) {
      for (const minMargin of marginCandidates) {
        const rows = rowsForK.map(row => ({
          ...row,
          predicted: row.band,
          accepted: row.nearestSimilarity >= minSimilarity && row.margin >= minMargin,
        }));
        const perBand = precisionByBand(rows);
        const qualified = Object.values(perBand).every(stat =>
          stat.predicted >= minPredictionsPerBand && stat.precision >= precisionGate);
        if (!qualified) continue;
        const accepted = rows.filter(row => row.accepted).length;
        const coverage = accepted / rows.length;
        const worstPrecision = Math.min(...Object.values(perBand).map(stat => stat.precision));
        const candidate = { k, minSimilarity, minMargin, votePower, coverage, accepted, total: rows.length, worstPrecision, perBand };
        if (!best || candidate.coverage > best.coverage
          || (candidate.coverage === best.coverage && candidate.worstPrecision > best.worstPrecision)) {
          best = candidate;
        }
      }
    }
  }
  if (!best) {
    throw new Error(`no KNN thresholds satisfy precision >= ${precisionGate} with ${minPredictionsPerBand} predictions per emittable band`);
  }
  return best;
}
