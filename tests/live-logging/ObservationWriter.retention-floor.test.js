/**
 * ObservationWriter retention-floor invariant tests
 *
 * Phase 35 plan 35-01 (CONTEXT.md L4):
 *   The `_isSemanticallyDuplicate` window in ObservationWriter.js reads the last 4h.
 *   `retentionDays` must therefore be >= 1 (24h), giving a 20h margin over the dedup
 *   window. Anything below the floor must throw at construction so a misconfigured
 *   operator cannot silently break dedup correctness when the 35-04 pruner runs.
 *
 * These tests are deliberately db-free: the invariant lives in the constructor, so
 * we never call writer.init(). Fixture configs are written to a tmpdir and passed
 * via the `configPath` option.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let ObservationWriter;
let tmpDir;

beforeAll(async () => {
  ({ ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js'));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-retention-'));
});

afterAll(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

/**
 * Write a fixture config file and return its absolute path.
 * @param {string} name - file name (e.g. 'valid-config.json')
 * @param {Object} obsBlock - contents of defaults.observation
 */
function writeConfig(name, obsBlock) {
  const cfg = {
    version: 1,
    defaults: {
      model: 'anthropic/claude-haiku-4-5',
      observation: obsBlock,
    },
  };
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
  return p;
}

function throwawayDbPath() {
  return path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe('ObservationWriter retentionDays invariant', () => {
  it('accepts retentionDays = 1 (at the floor)', () => {
    const configPath = writeConfig('valid-config.json', {
      retentionDays: 1,
      messageTokens: 20000,
      bufferTokens: 0.2,
    });
    const writer = new ObservationWriter({ configPath, dbPath: throwawayDbPath() });
    expect(writer.retentionDays).toBe(1);
  });

  it('rejects retentionDays = 0 with a clear error', () => {
    const configPath = writeConfig('bad-config.json', {
      retentionDays: 0,
      messageTokens: 20000,
      bufferTokens: 0.2,
    });
    expect(
      () => new ObservationWriter({ configPath, dbPath: throwawayDbPath() })
    ).toThrow(/retentionDays must be >= 1/);
  });

  it('rejects retentionDays = 0.5 (below the 1-day floor)', () => {
    const configPath = writeConfig('half-day-config.json', {
      retentionDays: 0.5,
      messageTokens: 20000,
      bufferTokens: 0.2,
    });
    expect(
      () => new ObservationWriter({ configPath, dbPath: throwawayDbPath() })
    ).toThrow(/retentionDays must be >= 1/);
  });

  it('defaults to 7 when retentionDays is missing from config', () => {
    const configPath = writeConfig('missing-retention-config.json', {
      messageTokens: 20000,
      bufferTokens: 0.2,
    });
    const writer = new ObservationWriter({ configPath, dbPath: throwawayDbPath() });
    expect(writer.retentionDays).toBe(7);
  });

  it('defaults to 7 when retentionDays is a non-finite value (string "3")', () => {
    const configPath = writeConfig('string-retention-config.json', {
      retentionDays: '3',
      messageTokens: 20000,
      bufferTokens: 0.2,
    });
    const writer = new ObservationWriter({ configPath, dbPath: throwawayDbPath() });
    expect(writer.retentionDays).toBe(7);
  });
});
