/**
 * ObservationWriter detector B — capture-time `needs_lsl_resolution` stamp tests
 *
 * Phase 50 Plan 02 Task 2 — when `_buildPriorContext` returns an empty
 * context AND the user's current message contains an unresolved pronoun,
 * stamp `metadata.needs_lsl_resolution = true` on the persisted observation
 * row. The Plan 01 resolver CLI scans these rows preferentially on its
 * next pass (cheap pre-filter — no regex re-scan of all rows).
 *
 * Tests cover the 7 behaviors enumerated in 50-02-PLAN.md Task 2:
 *   1. Pronoun + empty prior context → stamp
 *   2. Pronoun + non-empty prior context → no stamp (resolved upstream)
 *   3. No pronoun + empty prior context → no stamp
 *   4. "do the same again" trigger
 *   5. Standalone "yes" affirmation pattern
 *   6. "the change" with no clarifying noun → triggers; "the change to file X" → no trigger
 *   7. End-to-end: needs_lsl_resolution persists into the observations.metadata JSON
 *
 * Strategy: mock getLSLWindow + fetch so we control prior-context emptiness
 * and the LLM response. For Test 7, we use a real better-sqlite3 tmpdir DB
 * and verify json_extract(metadata, '$.needs_lsl_resolution') returns 1.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let tmpDir;
let lslWindowMockReturn;
let lslWindowMockCalls;
let ObservationWriter;

// Mock getLSLWindow so we can switch between empty + non-empty prior context.
jest.unstable_mockModule('../../lib/lsl/window.mjs', () => ({
  getLSLWindow: jest.fn((observation, opts) => {
    lslWindowMockCalls.push({ observation, opts });
    return lslWindowMockReturn;
  }),
}));

beforeAll(async () => {
  ({ ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js'));
});

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-needs-lsl-'));
  lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
  lslWindowMockCalls = [];

  // Mock fetch globally so summarize() returns a canned LLM result without
  // requiring the live proxy.
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      content: 'Intent: Resolve the pronoun reference\n' +
               'Approach: Heuristic detector flagged\n' +
               'Artifacts: none\n' +
               'Result: Stamp persisted',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      tokens: 100,
      latencyMs: 200,
    }),
    text: async () => '',
  }));
});

afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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

function newWriter(name) {
  const configPath = writeConfig(`${name}-config.json`);
  const dbPath = path.join(tmpDir, `${name}.db`);
  return new ObservationWriter({ configPath, dbPath });
}

describe('ObservationWriter._hasUnresolvedPronoun', () => {
  test('Test 1: empty messages → false', () => {
    const writer = newWriter('detect-empty');
    expect(writer._hasUnresolvedPronoun([])).toBe(false);
  });

  test('Test 2: canonical "implement it now" → true', () => {
    const writer = newWriter('detect-canonical');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'implement it now' },
    ])).toBe(true);
  });

  test('Test 3: standalone "yes" → true', () => {
    const writer = newWriter('detect-yes');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'yes' },
    ])).toBe(true);
  });

  test('Test 4: "do the same again" → true', () => {
    const writer = newWriter('detect-same');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'do the same again' },
    ])).toBe(true);
  });

  test('Test 5: no pronoun → false', () => {
    const writer = newWriter('detect-no');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'Add a delete button to the user profile page' },
    ])).toBe(false);
  });

  test('Test 6a: bare "the change" with no clarifying noun → true', () => {
    const writer = newWriter('detect-bare');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'Apply the change please' },
    ])).toBe(true);
  });

  test('Test 6b: "the change to file X" → false (clarifying noun present)', () => {
    const writer = newWriter('detect-clarified');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'Apply the change to file user-profile.tsx' },
    ])).toBe(false);
  });

  test('Test 7: only the LAST user message is checked', () => {
    const writer = newWriter('detect-last');
    expect(writer._hasUnresolvedPronoun([
      { role: 'user', content: 'Add a delete button' },        // no pronoun
      { role: 'assistant', content: 'Done.' },
      { role: 'user', content: 'implement it now' },           // canonical pronoun
    ])).toBe(true);
  });
});

describe('ObservationWriter.summarize — needs_lsl_resolution stamp', () => {
  test('Test 1: pronoun + empty prior context → stamp set', async () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('summ-stamp');
    const result = await writer.summarize(
      [{ role: 'user', content: 'implement it now' }],
      { agent: 'claude', project: 'coding' }
    );
    expect(result.needs_lsl_resolution).toBe(true);
  });

  test('Test 2: pronoun + non-empty prior context → no stamp', async () => {
    lslWindowMockReturn = {
      exchanges: [
        {
          role: 'user',
          content: '<user>\nrefactor the auth handler\n</user>',
          timestamp: '2026-05-23T07:30:00Z',
        },
      ],
      sourceFile: 'a.md',
      byteCount: 50,
      windowSpanMs: 0,
    };
    const writer = newWriter('summ-no-stamp');
    const result = await writer.summarize(
      [{ role: 'user', content: 'implement it now' }],
      { agent: 'claude', project: 'coding' }
    );
    expect(result.needs_lsl_resolution).toBeFalsy();
  });

  test('Test 3: no pronoun + empty prior context → no stamp', async () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('summ-no-pronoun');
    const result = await writer.summarize(
      [{ role: 'user', content: 'Add a delete button to user profile page' }],
      { agent: 'claude', project: 'coding' }
    );
    expect(result.needs_lsl_resolution).toBeFalsy();
  });
});

describe('ObservationWriter.processMessages — DB persistence of needs_lsl_resolution', () => {
  test('Test 7: stamp persists into observations.metadata JSON column', async () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('persist-stamp');
    await writer.init();

    const messages = [
      { role: 'user', content: 'implement it now' },
      { role: 'assistant', content: 'Done.' },
    ];

    await writer.processMessages(messages, {
      agent: 'claude',
      project: 'coding',
      sessionId: 'test-session',
    });

    // Inspect the persisted row via a read-only Database handle.
    const dbPath = writer.dbPath;
    await writer.close();

    const ro = new Database(dbPath, { readonly: true });
    const row = ro.prepare(
      `SELECT id, summary, json_extract(metadata, '$.needs_lsl_resolution') AS needs FROM observations ORDER BY created_at DESC LIMIT 1`
    ).get();
    ro.close();

    expect(row).toBeDefined();
    // SQLite json_extract returns 1 for true, 0 for false, NULL otherwise.
    expect(row.needs).toBe(1);
  });

  test('Test 8: no stamp when pronoun absent + prior context empty', async () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('persist-no-stamp');
    await writer.init();

    const messages = [
      { role: 'user', content: 'Add a delete button to user profile page' },
      { role: 'assistant', content: 'Done.' },
    ];

    await writer.processMessages(messages, {
      agent: 'claude',
      project: 'coding',
      sessionId: 'test-session-2',
    });

    const dbPath = writer.dbPath;
    await writer.close();

    const ro = new Database(dbPath, { readonly: true });
    const row = ro.prepare(
      `SELECT id, summary, json_extract(metadata, '$.needs_lsl_resolution') AS needs FROM observations ORDER BY created_at DESC LIMIT 1`
    ).get();
    ro.close();

    expect(row).toBeDefined();
    // Absent or null → not stamped. SQLite's json_extract returns null when key missing.
    expect(row.needs).toBeFalsy();
  });
});
