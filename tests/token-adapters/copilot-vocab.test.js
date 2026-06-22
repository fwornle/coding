/**
 * tests/token-adapters/copilot-vocab.test.js
 *
 * Phase 69, Plan 69-04, Task 2 — the Phase-1 event-vocabulary check + the
 * version-keyed verdict (D-04 / D-09 deliverable, NOT optional).
 *
 * Covers:
 *   1. checkCopilotVocabulary enumerates the distinct event `type:` values from a
 *      v1.0.63 events.jsonl — `types` contains session.shutdown, assistant.message,
 *      assistant.turn_end (and the other lifecycle events).
 *   2. v1.0.63 carries NO per-turn token usage (assistant.message has
 *      reasoningOpaque but no inputTokens/outputTokens) → perTurnUsagePresent===false
 *      → verdict==='per-session-aggregate' (D-04 — the upgrade path is inert here).
 *   3. COPILOT_PROBED_VERSION === '1.0.63'.
 *   4. warnOnVersionDrift writes a drift warning to stderr when the installed
 *      version differs from COPILOT_PROBED_VERSION, and is silent when it matches.
 *   5. The per-turn upgrade branch is reachable: a synthetic events file whose
 *      assistant.* event DOES carry a usage payload flips verdict to 'per-turn'.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'copilot-events-sample.jsonl');

const {
  checkCopilotVocabulary,
  warnOnVersionDrift,
  COPILOT_PROBED_VERSION,
} = await import('../../lib/lsl/token/copilot-token-rows.mjs');

function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-vocab-'));
  const dst = path.join(dir, name);
  fs.copyFileSync(srcPath, dst);
  return { dir, dst };
}

test('COPILOT_PROBED_VERSION is the version-keyed baseline 1.0.63', () => {
  expect(COPILOT_PROBED_VERSION).toBe('1.0.63');
});

test('vocabulary check enumerates event types and bakes the v1.0.63 verdict', () => {
  const { dir, dst } = ownedCopy(FIXTURE, 'events.jsonl');
  try {
    const result = checkCopilotVocabulary(dst);

    expect(Array.isArray(result.types)).toBe(true);
    expect(result.types).toContain('session.shutdown');
    expect(result.types).toContain('assistant.message');
    expect(result.types).toContain('assistant.turn_end');

    // v1.0.63: assistant.message has reasoningOpaque but NO per-turn token usage.
    expect(result.perTurnUsagePresent).toBe(false);
    expect(result.verdict).toBe('per-session-aggregate');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('warnOnVersionDrift warns on drift and is silent on a match', () => {
  const writes = [];
  const orig = process.stderr.write;
  // eslint-disable-next-line no-undef
  process.stderr.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  try {
    warnOnVersionDrift('1.0.99');
    warnOnVersionDrift(COPILOT_PROBED_VERSION);
  } finally {
    process.stderr.write = orig;
  }
  const driftLines = writes.filter((w) => w.includes('CLI version drift'));
  expect(driftLines.length).toBe(1);
  expect(driftLines[0]).toContain('installed=1.0.99');
  expect(driftLines[0]).toContain('probed=1.0.63');
});

test('per-turn upgrade branch is reachable when an assistant event carries usage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-vocab-pt-'));
  const dst = path.join(dir, 'events.jsonl');
  try {
    const future = [
      JSON.stringify({
        type: 'assistant.message',
        timestamp: '2026-06-22T11:00:09.000Z',
        data: { usage: { inputTokens: 100, outputTokens: 20 } },
      }),
      JSON.stringify({
        type: 'session.shutdown',
        timestamp: '2026-06-22T11:02:00.000Z',
        data: { modelMetrics: {} },
      }),
    ].join('\n');
    fs.writeFileSync(dst, `${future}\n`);

    const result = checkCopilotVocabulary(dst);
    expect(result.perTurnUsagePresent).toBe(true);
    expect(result.verdict).toBe('per-turn');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-existent file yields an empty vocabulary without throwing', () => {
  let result;
  expect(() => {
    result = checkCopilotVocabulary('/nonexistent/does-not-exist.jsonl');
  }).not.toThrow();
  expect(result.types).toEqual([]);
  expect(result.perTurnUsagePresent).toBe(false);
  expect(result.verdict).toBe('per-session-aggregate');
});
