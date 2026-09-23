/**
 * ObservationWriter — post-LLM evidence floor
 *
 * Regression coverage for 2026-09-23. The gate inside writeObservation() tested
 * the summary TEXT and nothing else, so when haiku answered "No actionable
 * content." (22 characters) for a turn that made ~40 tool calls and produced two
 * commits and a merge, the entire turn was discarded on that say-so. Nothing
 * downstream noticed — the ETM had fired, obs-api had answered — and the next
 * observation landed 14 hours later.
 *
 * The rule these tests pin: the summariser's "no work here" verdict is only
 * trusted when the turn shows no evidence of work. Evidence is the tool-call
 * count AND the modified-file list, not the files alone — `bashWriteTargets`
 * strips heredoc bodies before scanning, so an edit made by
 * `python3 - <<'PY' ... open(p,'w').write(s)` reports zero modified files, and
 * a files-only floor would not have caught the turn that motivated this.
 *
 * The negative test is the important half: a genuinely empty turn must still be
 * skipped, or this trades a silent data loss for a stream of worthless rows.
 *
 * Assertions are on `lastObservationId`, NOT on `observations`. That counter is
 * incremented once per chunk ATTEMPTED, not per row written — it reports 1 for a
 * skipped write and for a deduped one, which ObservationWriter.pre-llm-dedup
 * test:122 pins deliberately. Asserting on it here would have passed whether or
 * not the fix worked, which is exactly the failure mode that let the original
 * data loss go unnoticed.
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

/** Make the summary LLM answer with the exact verdict that caused the loss. */
function mockSummary(content) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      content,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      tokens: 8,
      latencyMs: 90,
    }),
    text: async () => '',
  }));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-evidence-floor-'));
  lslWindowMockReturn = { exchanges: [], sourceFile: null, byteCount: 0, windowSpanMs: 0 };
  mockSummary('No actionable content.');
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  delete global.fetch;
});

async function newInitializedWriter(name) {
  const configPath = path.join(tmpDir, `${name}-config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    defaults: {
      model: 'anthropic/claude-haiku-4-5',
      observation: { retentionDays: 7, messageTokens: 20000, bufferTokens: 0.2 },
    },
  }, null, 2), 'utf-8');
  const writer = new ObservationWriter({
    configPath,
    dbPath: path.join(tmpDir, `${name}.db`),
    kmStoreDbPath: path.join(tmpDir, `${name}-km`, 'leveldb'),
    kmStoreExportDir: path.join(tmpDir, `${name}-km`, 'exports'),
  });
  await writer.init();
  return writer;
}

/** A turn that is plainly not an ack, so the PRE-LLM gate never fires. */
const REAL_TURN = [
  { role: 'user', content: 'apply it' },
  {
    role: 'assistant',
    content:
      '[Tool calls]\nBash: node scripts/derive-intent-spine.mjs --apply\n\n'
      + 'Applied the spine: 14 aggregates edges added, 0 duplicates.',
  },
];

describe('ObservationWriter — post-LLM evidence floor', () => {
  test('a "no actionable content" verdict is overruled when the turn made tool calls', async () => {
    const writer = await newInitializedWriter('floor-toolcalls');
    const result = await writer.processMessages(REAL_TURN, {
      agent: 'claude',
      session_id: 's1',
      // The exact shape of the turn that was lost: plenty of tool calls, and
      // zero modified files because the edits went through heredocs.
      toolCallCount: 40,
      modifiedFiles: undefined,
    });
    expect(result.lastObservationId).not.toBeNull()
    expect(result.errors).toBe(0);
  });

  test('modified files alone are also enough to overrule it', async () => {
    const writer = await newInitializedWriter('floor-files');
    const result = await writer.processMessages(REAL_TURN, {
      agent: 'claude',
      session_id: 's1',
      toolCallCount: 0,
      modifiedFiles: ['src/live-logging/ObservationWriter.js'],
    });
    expect(result.lastObservationId).not.toBeNull()
  });

  test('NEGATIVE: a turn with no evidence at all is still skipped', async () => {
    const writer = await newInitializedWriter('floor-empty');
    const result = await writer.processMessages(REAL_TURN, {
      agent: 'claude',
      session_id: 's1',
      toolCallCount: 0,
      modifiedFiles: [],
    });
    // Without this the fix would trade a silent data loss for a stream of
    // worthless rows, which is the reason the gate exists at all.
    expect(result.lastObservationId).toBeNull()
  });

  test('NEGATIVE: a caller that reports no evidence keeps the old behaviour', async () => {
    const writer = await newInitializedWriter('floor-absent');
    // Backfill tools call writeObservation without the ETM's evidence fields.
    // Absent must read as "no evidence", never as "assume work happened" —
    // otherwise the gate silently stops working for every non-ETM caller.
    const result = await writer.processMessages(REAL_TURN, { agent: 'claude', session_id: 's1' });
    expect(result.lastObservationId).toBeNull()
  });

  test('the other no-work phrases are gated the same way', async () => {
    for (const [i, verdict] of [
      'This was a trivial exchange.',
      'No new work was performed in this turn.',
    ].entries()) {
      mockSummary(verdict);
      const kept = await newInitializedWriter(`floor-phrase-kept-${i}`);
      expect((await kept.processMessages(REAL_TURN, {
        agent: 'claude', session_id: 's1', toolCallCount: 12,
      })).lastObservationId).not.toBeNull()

      const dropped = await newInitializedWriter(`floor-phrase-dropped-${i}`);
      expect((await dropped.processMessages(REAL_TURN, {
        agent: 'claude', session_id: 's1', toolCallCount: 0,
      })).lastObservationId).toBeNull()
    }
  });

  test('a normal summary is untouched by any of this', async () => {
    mockSummary('Intent: Apply the intent spine\nApproach: Ran the producer\nArtifacts: none\nResult: 14 edges added');
    const writer = await newInitializedWriter('floor-normal');
    const result = await writer.processMessages(REAL_TURN, {
      agent: 'claude', session_id: 's1', toolCallCount: 0,
    });
    expect(result.lastObservationId).not.toBeNull()
  });
});
