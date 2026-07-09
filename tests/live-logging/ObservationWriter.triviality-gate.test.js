/**
 * ObservationWriter — pre-LLM triviality gate
 *
 * Regression coverage for the 2026-07-09 fix that skips the summary LLM call
 * for unique-but-trivial exchanges (a bare ack/greeting with NO tool activity).
 * Background: content-hash dedup only catches EXACT re-fires, so a long
 * autonomous run produces a stream of textually-unique acks ("yes", "proceed",
 * "approved") that each still cost one haiku call the summary LLM answers with
 * "No actionable content." The overnight 2026-07-09 export showed obs-writer at
 * ~73% of proxy calls, dominated by these out=8 responses.
 *
 * The gate is HIGH-PRECISION: it fires only when every user turn is a
 * whole-message ack AND no files were touched. The negative tests below are the
 * important half — they prove a real short request, an ack that DID touch
 * files, and a progress snapshot are NEVER skipped.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-triviality-gate-'));
  lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      content:
        'Intent: Do the real thing\n' +
        'Approach: Direct\n' +
        'Artifacts: none\n' +
        'Result: Persisted',
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
  const kmStoreDbPath = path.join(tmpDir, `${name}-km`, 'leveldb');
  const kmStoreExportDir = path.join(tmpDir, `${name}-km`, 'exports');
  const writer = new ObservationWriter({ configPath, dbPath, kmStoreDbPath, kmStoreExportDir });
  await writer.init();
  return writer;
}

describe('ObservationWriter — pre-LLM triviality gate', () => {
  test('bare ack + no tool work → skipped, no fetch, no observation', async () => {
    const writer = await newInitializedWriter('gate-ack');
    const messages = [
      { role: 'user', content: 'proceed' },
      { role: 'assistant', content: 'Okay, continuing with the next step.' },
    ];
    const result = await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    expect(result.observations).toBe(0);
    expect(result.errors).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('various whole-message acks are all skipped', async () => {
    for (const ack of ['yes', 'ok', 'approved', 'thanks', 'go ahead', 'LGTM', 'do it', 'ship it']) {
      const writer = await newInitializedWriter(`gate-ack-${ack.replace(/\s+/g, '_')}`);
      const messages = [
        { role: 'user', content: ack },
        { role: 'assistant', content: 'Acknowledged.' },
      ];
      const result = await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
      expect(result.observations).toBe(0);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('NEGATIVE: a real short request is NOT skipped (LLM runs)', async () => {
    const writer = await newInitializedWriter('gate-real-request');
    const messages = [
      { role: 'user', content: 'delete the auth module' },
      { role: 'assistant', content: 'Removed src/auth.' },
    ];
    const result = await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    expect(result.observations).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('NEGATIVE: an ack that TOUCHED files is NOT skipped', async () => {
    const writer = await newInitializedWriter('gate-ack-with-files');
    const messages = [
      { role: 'user', content: 'proceed' },
      { role: 'assistant', content: 'Applied the change.' },
    ];
    const result = await writer.processMessages(messages, {
      agent: 'claude', session_id: 's1', modifiedFiles: ['src/foo.ts'],
    });
    expect(result.observations).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('NEGATIVE: a progress snapshot is NOT skipped even if ack-like', async () => {
    const writer = await newInitializedWriter('gate-progress');
    const messages = [
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: 'Working…' },
    ];
    const result = await writer.processMessages(messages, {
      agent: 'claude', session_id: 's1', kind: 'progress',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('NEGATIVE: mixed chunk (one ack + one real request) is NOT skipped', async () => {
    const writer = await newInitializedWriter('gate-mixed');
    const messages = [
      { role: 'user', content: 'yes' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'now refactor the token reconciler to stream' },
      { role: 'assistant', content: 'Done.' },
    ];
    const result = await writer.processMessages(messages, { agent: 'claude', session_id: 's1' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('unit: _looksLikeAck precision', async () => {
    const writer = await newInitializedWriter('gate-unit');
    // acks
    for (const t of ['yes', 'Yes.', 'PROCEED', 'go ahead', 'thanks!', 'ok', 'lgtm']) {
      expect(writer._looksLikeAck(t)).toBe(true);
    }
    // non-acks (real content or too long)
    for (const t of ['fix the bug', 'yes but also add a test', 'proceed with the migration plan', 'delete auth']) {
      expect(writer._looksLikeAck(t)).toBe(false);
    }
  });
});
