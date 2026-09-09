#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

import { labelsFromScores, readScoreRows } from './lib/prompt-classifier-training.mjs';

const args = process.argv.slice(2);
const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const input = value('input');
const output = value('output');
const list = name => value(name).split(',').map(item => item.trim()).filter(Boolean);
const smallModels = list('small-models').length ? list('small-models') : list('small-model');
const mediumModels = list('medium-models').length ? list('medium-models') : list('medium-model');
const passScore = Number(value('pass-score') || '1');
if (!input || !output || !smallModels.length || !mediumModels.length) {
  process.stderr.write('Usage: node scripts/prepare-prompt-classifier-labels.mjs --input=<scores.json|jsonl> --output=<labels.jsonl> --small-models=<id[,id]> --medium-models=<id[,id]> [--pass-score=1]\n');
  process.exit(2);
}

try {
  const labels = labelsFromScores(readScoreRows(input), { smallModels, mediumModels, passScore });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, `${labels.map(row => JSON.stringify(row)).join('\n')}\n`);
  const counts = labels.reduce((out, row) => ({ ...out, [row.label]: (out[row.label] ?? 0) + 1 }), {});
  process.stdout.write(`wrote ${labels.length} labels to ${output}: ${JSON.stringify(counts)}\n`);
} catch (error) {
  process.stderr.write(`label preparation failed: ${error.message}\n`);
  process.exit(1);
}
