/**
 * ObservationWriter._buildPriorContext migration tests
 *
 * Phase 50 Plan 02 Task 1 — migrate from a 30-min wall-clock SQL window on the
 * observations DB to the N-prompt LSL-window primitive shipped by Plan 01
 * (lib/lsl/window.mjs). Both the inline tier and the async resolver tier
 * now agree on what "recent context" means: 3 user prompts, not 30 minutes.
 *
 * Tests cover the 7 behaviors enumerated in 50-02-PLAN.md Task 1:
 *   1. Empty LSL window → '' (preserves existing no-rows fallback)
 *   2. Non-empty window → wrapped in <prior_observations> XML block
 *   3. Intent extraction works for assistant-template exchanges
 *   4. Lines truncated at 200 chars
 *   5. Throw-safety — getLSLWindow exceptions return '' (no propagation)
 *   6. Project scoping — metadata.project is passed through
 *   7. Backward compat — missing agent/project returns '' immediately
 *
 * Strategy: jest.unstable_mockModule mocks getLSLWindow so we control its
 * return value per test. The writer is constructed against a tmpdir config
 * (no db.init() — we exercise _buildPriorContext alone).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

let tmpDir;
let lslWindowMockReturn;
let lslWindowMockThrow;
let lslWindowMockCalls;
let ObservationWriter;

// Mock getLSLWindow at the import path the writer uses. The writer lives at
// src/live-logging/ObservationWriter.js and the plan locks the relative
// import string `from '../../lib/lsl/window.mjs'`. Jest resolves the mock
// against the test's own location so we point at the same canonical path.
jest.unstable_mockModule('../../lib/lsl/window.mjs', () => ({
  getLSLWindow: jest.fn((observation, opts) => {
    lslWindowMockCalls.push({ observation, opts });
    if (lslWindowMockThrow) throw lslWindowMockThrow;
    return lslWindowMockReturn;
  }),
}));

beforeAll(async () => {
  ({ ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js'));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-prior-ctx-'));
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
  lslWindowMockThrow = null;
  lslWindowMockCalls = [];
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

describe('ObservationWriter._buildPriorContext (LSL-window migration)', () => {
  test('Test 1: empty LSL window → returns empty string', () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('t1');
    const result = writer._buildPriorContext({ agent: 'claude', project: 'coding' });
    expect(result).toBe('');
  });

  test('Test 2: non-empty window → wrapped in <prior_observations> XML block', () => {
    lslWindowMockReturn = {
      exchanges: [
        {
          role: 'user',
          content: '<user>\nimplement the auth refactor\n</user>',
          timestamp: '2026-05-23T07:30:00Z',
        },
        {
          role: 'user',
          content: '<user>\nfix the failing test\n</user>',
          timestamp: '2026-05-23T07:35:00Z',
        },
      ],
      sourceFile: '2026-05-23_0700-0800_test.md',
      byteCount: 80,
      windowSpanMs: 300_000,
    };
    const writer = newWriter('t2');
    const result = writer._buildPriorContext({ agent: 'claude', project: 'coding' });
    expect(result).toMatch(/^\n<prior_observations>\n/);
    expect(result).toMatch(/\n<\/prior_observations>$/);
    // Each line is prefixed `  - `
    expect(result).toMatch(/\n  - /);
  });

  test('Test 3: assistant 4-line template → Intent line extracted', () => {
    lslWindowMockReturn = {
      exchanges: [
        {
          role: 'user',
          content:
            '<user>\nrebuild docker\n</user>\n' +
            '<assistant>\n' +
            'Intent: Rebuild the coding-services Docker image\n' +
            'Approach: docker-compose build coding-services\n' +
            'Artifacts: none\n' +
            'Result: Image rebuilt successfully\n' +
            '</assistant>',
          timestamp: '2026-05-23T07:40:00Z',
        },
      ],
      sourceFile: '2026-05-23_0700-0800_test.md',
      byteCount: 200,
      windowSpanMs: 0,
    };
    const writer = newWriter('t3');
    const result = writer._buildPriorContext({ agent: 'claude', project: 'coding' });
    // Should surface the Intent line content
    expect(result).toContain('Rebuild the coding-services Docker image');
    expect(result).toMatch(/^\n<prior_observations>\n/);
  });

  test('Test 4: lines truncated at 200 chars', () => {
    const longUser = 'x'.repeat(500);
    lslWindowMockReturn = {
      exchanges: [
        {
          role: 'user',
          content: `<user>\n${longUser}\n</user>`,
          timestamp: '2026-05-23T07:30:00Z',
        },
      ],
      sourceFile: 'a.md',
      byteCount: 500,
      windowSpanMs: 0,
    };
    const writer = newWriter('t4');
    const result = writer._buildPriorContext({ agent: 'claude', project: 'coding' });
    // Find the line that starts with `  - ` and check its length.
    const lineMatch = result.match(/\n  - (.+)/);
    expect(lineMatch).not.toBeNull();
    // Length cap is 200 + the `…` ellipsis suffix on truncation.
    expect(lineMatch[1].length).toBeLessThanOrEqual(201);
  });

  test('Test 5: getLSLWindow throws → returns "" (no propagation)', () => {
    lslWindowMockThrow = new Error('LSL root not found');
    const writer = newWriter('t5');
    const result = writer._buildPriorContext({ agent: 'claude', project: 'coding' });
    expect(result).toBe('');
  });

  test('Test 6: metadata.project is passed through to getLSLWindow', () => {
    lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
    const writer = newWriter('t6');
    writer._buildPriorContext({ agent: 'claude', project: 'my-project-x' });
    expect(lslWindowMockCalls.length).toBe(1);
    expect(lslWindowMockCalls[0].opts.project).toBe('my-project-x');
    expect(lslWindowMockCalls[0].opts.maxPrompts).toBe(3);
  });

  test('Test 7: missing agent → returns "" immediately (no LSL call)', () => {
    const writer = newWriter('t7a');
    const result = writer._buildPriorContext({ project: 'coding' });
    expect(result).toBe('');
    expect(lslWindowMockCalls.length).toBe(0);
  });

  test('Test 7b: missing project → returns "" immediately (no LSL call)', () => {
    const writer = newWriter('t7b');
    const result = writer._buildPriorContext({ agent: 'claude' });
    expect(result).toBe('');
    expect(lslWindowMockCalls.length).toBe(0);
  });
});
