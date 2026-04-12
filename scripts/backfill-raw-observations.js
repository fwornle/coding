#!/usr/bin/env node
/**
 * Backfill [Raw] observations by re-summarizing them through the LLM CLI proxy.
 * Run from the coding project root: node scripts/backfill-raw-observations.js
 */
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../.observations/observations.db');
const PROXY_PORT = process.env.LLM_CLI_PROXY_PORT || '12435';
const PROXY_URL = `http://localhost:${PROXY_PORT}/api/complete`;
const BATCH_DELAY_MS = 2000;

const db = new Database(DB_PATH);

const rawObs = db.prepare(`
  SELECT id, summary, messages, metadata, created_at
  FROM observations
  WHERE summary LIKE '[Raw] % messages%'
  ORDER BY created_at ASC
`).all();

process.stderr.write(`Found ${rawObs.length} [Raw] observations to backfill\n`);

let success = 0, failed = 0, skipped = 0;

for (let i = 0; i < rawObs.length; i++) {
  const obs = rawObs[i];

  let messages;
  try { messages = JSON.parse(obs.messages); }
  catch { skipped++; continue; }

  if (!messages || messages.length < 2) { skipped++; continue; }

  let metadata = {};
  try { metadata = JSON.parse(obs.metadata || '{}'); } catch { /* ignore */ }
  const projectName = metadata.project || 'coding';

  const exchangeBlock = messages
    .map(m => `<${m.role}>\n${m.content}\n</${m.role}>`)
    .join('\n');

  const modifiedFiles = metadata.modifiedFiles || [];
  let artifactHint = '';
  if (modifiedFiles.length > 0) {
    artifactHint = `\n\nGROUND TRUTH — Files modified/created:\n` +
      modifiedFiles.map(f => `  - edited ${f}`).join('\n');
  }

  const requestBody = {
    messages: [
      {
        role: 'system',
        content: `You produce structured observation summaries from coding exchanges.\n` +
          `The developer is working in the "${projectName}" project.\n\n` +
          'Respond using ONLY this template:\n\n' +
          'Intent: [what the developer asked]\n' +
          'Approach: [solution strategy — 1-4 sentences]\n' +
          'Artifacts: [files modified/created with verb, or "none"]\n' +
          'Result: [concrete outcome — 1-4 sentences]\n\n' +
          'If no real work, respond: "No actionable content."' +
          (artifactHint || ''),
      },
      {
        role: 'user',
        content: `<project>${projectName}</project>\n<exchange>\n${exchangeBlock}\n</exchange>\n\nProduce the observation summary.`,
      },
    ],
  };

  try {
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      process.stderr.write(`  [${i+1}/${rawObs.length}] ERR ${response.status}: ${errBody.slice(0,60)}\n`);
      failed++;
      continue;
    }

    const result = await response.json();
    const summary = result.content;

    if (!summary || summary.length < 10) { skipped++; continue; }

    const quality = summary.toLowerCase().includes('no actionable content') ? 'low' : 'normal';
    const llmMeta = {
      ...metadata,
      llmModel: result.model || null,
      llmProvider: result.provider || null,
      llmTokens: result.tokens || null,
      llmLatencyMs: result.latencyMs || null,
    };

    db.prepare(`UPDATE observations SET summary = ?, metadata = ?, quality = ? WHERE id = ?`)
      .run(summary, JSON.stringify(llmMeta), quality, obs.id);

    process.stderr.write(`  [${i+1}/${rawObs.length}] ${quality === 'low' ? 'LOW' : 'OK'}: ${obs.created_at.slice(0,19)} — ${summary.slice(0,50)}\n`);
    success++;
  } catch (err) {
    process.stderr.write(`  [${i+1}/${rawObs.length}] FAIL: ${err.message}\n`);
    failed++;
  }

  if (i < rawObs.length - 1) {
    await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
  }
}

process.stderr.write(`\nDone: ${success} updated, ${failed} failed, ${skipped} skipped\n`);
db.close();
