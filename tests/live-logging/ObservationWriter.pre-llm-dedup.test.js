/**
 * ObservationWriter — pre-LLM content-hash dedup
 *
 * Regression coverage for the 2026-06-04 fix that moved the content-hash
 * dedup check ahead of the LLM call. Background: overnight audit found
 * 1,506 obs-writer calls between 21:00-03:00 local that burned ~1.2M
 * sonnet input tokens — 98% returned <10 output tokens because the
 * downstream dedup in writeObservation() discarded the summary. The LLM
 * had already been invoked and billed; the dedup just stopped the row
 * from being persisted twice.
 *
 * These tests assert that a second processMessages() call for the same
 * (agent, content_hash) does NOT call fetch (= no LLM cost) yet still
 * returns the existing observation id and counts as observations++.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let tmpDir;
let ObservationWriter;
let lslWindowMockReturn;

jest.unstable_mockModule('../../lib/lsl/window.mjs', () => ({
  getLSLWindow: jest.fn(() => lslWindowMockReturn),
}));

beforeAll(async () => {
  ({ ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js'));
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-pre-llm-dedup-'));
  lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };

  // Canned LLM response — return a summary the downstream code will accept
  // (not flagged as low-value, has all 4 template lines).
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      content:
        'Intent: First fire — write the row\n' +
        'Approach: Direct DB insert\n' +
        'Artifacts: none\n' +
        'Result: Observation persisted',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      tokens: 80,
      latencyMs: 120,
    }),
    text: async () => '',
  }));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete global.fetch;
});

function writeConfig(name) {
  const cfg = {
    version: 1,
    defaults: {
      model: 'anthropic/claude-haiku-4-5',
      observation: { retentionDays: 7, messageTokens: 20000, bufferTokens: 0.2 },
    },
  };
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
  return p;
}

async function newInitializedWriter(name) {
  const configPath = writeConfig(`${name}-config.json`);
  const dbPath = path.join(tmpDir, `${name}.db`);
  const writer = new ObservationWriter({ configPath, dbPath });
  await writer.init();
  return writer;
}

describe('ObservationWriter — pre-LLM dedup', () => {
  test('second identical processMessages() call does NOT invoke fetch', async () => {
    const writer = await newInitializedWriter('pre-llm-no-fetch');
    const messages = [
      { role: 'user', content: 'investigate the proxy slowdown' },
      { role: 'assistant', content: 'I checked the queue depth and found a backlog.' },
    ];
    const metadata = { agent: 'claude', session_id: 'session-abc' };

    const first = await writer.processMessages(messages, metadata);
    expect(first.observations).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call with identical inputs must short-circuit before fetch.
    const second = await writer.processMessages(messages, metadata);
    expect(second.observations).toBe(1);
    expect(second.errors).toBe(0);
    expect(global.fetch).toHaveBeenCalledTimes(1); // unchanged — the smoking gun
    expect(second.lastObservationId).toBe(first.lastObservationId);
  });

  test('different session_id with identical messages → not deduped', async () => {
    const writer = await newInitializedWriter('pre-llm-session-scope');
    const messages = [
      { role: 'user', content: 'identical prompt' },
      { role: 'assistant', content: 'identical reply' },
    ];
    await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    await writer.processMessages(messages, { agent: 'claude', session_id: 's2' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('different agent with identical messages → not deduped', async () => {
    const writer = await newInitializedWriter('pre-llm-agent-scope');
    const messages = [
      { role: 'user', content: 'identical prompt' },
      { role: 'assistant', content: 'identical reply' },
    ];
    await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    await writer.processMessages(messages, { agent: 'opencode', session_id: 's1' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('skip: sub-agent transcript source → no fetch, no DB write', async () => {
    const writer = await newInitializedWriter('skip-subagent');
    const messages = [
      { role: 'user', content: 'real user prompt' },
      { role: 'assistant', content: 'subagent did something' },
    ];
    const result = await writer.processMessages(messages, {
      agent: 'claude',
      session_id: 's1',
      sourceFile: '/Users/u/.claude/projects/-Users-u-Agentic-coding/abc/subagents/agent-xyz.jsonl',
    });
    expect(result).toEqual({ observations: 0, errors: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('skip: no user-message-bearing content (continuation chain) → no fetch', async () => {
    const writer = await newInitializedWriter('skip-no-user');
    // Pure assistant-only chain — OpenCode continuation pattern.
    const messages = [
      { role: 'assistant', content: '[tool: bash]' },
      { role: 'assistant', content: '[tool: read]\n[tool: read]' },
      { role: 'assistant', content: 'Now let me check X' },
    ];
    const result = await writer.processMessages(messages, { agent: 'opencode', session_id: 's1' });
    expect(result).toEqual({ observations: 0, errors: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('skip: user message present but whitespace-only → no fetch', async () => {
    const writer = await newInitializedWriter('skip-whitespace-user');
    const messages = [
      { role: 'user', content: '   \n\t  ' },
      { role: 'assistant', content: 'Some response' },
    ];
    const result = await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    expect(result).toEqual({ observations: 0, errors: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('pre-LLM patch path: existing has "Artifacts: none" and second fire adds modifiedFiles → patches without LLM', async () => {
    const writer = await newInitializedWriter('pre-llm-patch');
    const messages = [
      { role: 'user', content: 'fix the routing config' },
      { role: 'assistant', content: 'Done.' },
    ];

    // First fire: no modifiedFiles → summary stays "Artifacts: none"
    await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second fire: same content but now with modifiedFiles — should patch
    // the existing row WITHOUT calling the LLM again.
    const result = await writer.processMessages(messages, {
      agent: 'claude',
      session_id: 's1',
      modifiedFiles: ['scripts/configure-wave-analysis-routing.sh'],
    });
    expect(global.fetch).toHaveBeenCalledTimes(1); // no second LLM call
    expect(result.observations).toBe(1);

    // Inspect the DB to confirm the artifacts line was patched.
    const dbPath = path.join(tmpDir, 'pre-llm-patch.db');
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT summary FROM observations LIMIT 1').get();
    db.close();
    expect(row.summary).toMatch(/Artifacts:\s*edited configure-wave-analysis-routing\.sh/);
    expect(row.summary).not.toMatch(/Artifacts:\s*none/i);
  });
});
