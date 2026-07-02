// tests/repro/harness-stub.test.mjs
//
// Phase 67, Plan 67-02 (Wave 2) — record-present / replay-hard-fails suite for
// the D-08 harness channel (lib/repro/fixtures/harness-record.mjs). Per
// RESEARCH's feasibility verdict (Assumption A1): WebSearch/WebFetch/MCP tools
// run inside the Claude harness, NOT the proxy, so replay CANNOT be fed
// synthetic tool results in-repo. We therefore ship an honest split:
//   - record() is REAL — a post-hoc scrape of the Claude transcript JSONL for
//     tool_use/tool_result pairs within the span window.
//   - replay() HARD-FAILS with REPLAY_UNSUPPORTED_CHANNEL — never a fabricated
//     or live result (D-06 / SC-4 comparability guarantee).
//
// Contract under test:
//   - recordHarnessFixtures against the shared transcript-fragment.jsonl with a
//     window BRACKETING its entries writes >= 1 harness fixture (a WebSearch
//     tool_result); with an EXCLUDING window it writes 0.
//   - replayHarnessChannel(name) THROWS /REPLAY_UNSUPPORTED_CHANNEL: <name>/ for
//     WebSearch, WebFetch, and MCP — and NEVER returns a value.
//   - recordHarnessFixtures is best-effort: a bad transcript dir never throws.
//
// Every test writes fixtures into a mkdtempSync temp dir and removes it in
// cleanup — NEVER a real .data path (T-67-02-01).
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only
// (no console.* — no-console-log).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordHarnessFixtures,
  replayHarnessChannel,
} from '../../lib/repro/fixtures/harness-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '_fixtures');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repro-harness-'));
}

function readHarnessFiles(outDir) {
  const dir = path.join(outDir, 'harness');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

describe('recordHarnessFixtures — transcript scrape (real)', () => {
  test('a window bracketing the fixture entries writes >= 1 WebSearch fixture', () => {
    const outDir = mkTmp();
    try {
      const count = recordHarnessFixtures({
        transcriptDir: FIXTURE_DIR,
        startedAt: '2026-07-02T10:15:00.000Z',
        endedAt: '2026-07-02T10:15:10.000Z',
        outDir,
      });
      const files = readHarnessFiles(outDir);
      assert.ok(files.length >= 1, `expected >= 1 harness fixture, got ${files.length}`);
      assert.equal(count, files.length);
      // At least one is the WebSearch tool_result pair.
      const webSearch = files.find((f) => f.tool === 'WebSearch');
      assert.ok(webSearch, 'expected a WebSearch harness fixture');
      assert.equal(webSearch.tool_use_id, 'toolu_REDACTED01');
      assert.ok(webSearch.result, 'the recorded pair carries the tool_result payload');
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('a window EXCLUDING the fixture entries writes 0 fixtures', () => {
    const outDir = mkTmp();
    try {
      const count = recordHarnessFixtures({
        transcriptDir: FIXTURE_DIR,
        startedAt: '2026-07-02T11:00:00.000Z',
        endedAt: '2026-07-02T11:00:10.000Z',
        outDir,
      });
      assert.equal(count, 0);
      assert.deepEqual(readHarnessFiles(outDir), []);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('is best-effort: a non-existent transcript dir never throws (writes 0)', () => {
    const outDir = mkTmp();
    try {
      let count;
      assert.doesNotThrow(() => {
        count = recordHarnessFixtures({
          transcriptDir: path.join(outDir, 'does-not-exist'),
          startedAt: '2026-07-02T10:15:00.000Z',
          endedAt: '2026-07-02T10:15:10.000Z',
          outDir,
        });
      });
      assert.equal(count, 0);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('replayHarnessChannel — honest hard-fail (D-06 / SC-4)', () => {
  for (const name of ['WebSearch', 'WebFetch', 'MCP']) {
    test(`replay of ${name} throws REPLAY_UNSUPPORTED_CHANNEL and never returns`, () => {
      assert.throws(
        () => replayHarnessChannel(name),
        new RegExp(`REPLAY_UNSUPPORTED_CHANNEL: ${name}`),
      );
    });
  }

  test('replayHarnessChannel never returns a value for the three channels', () => {
    for (const name of ['WebSearch', 'WebFetch', 'MCP']) {
      let returned = false;
      try {
        replayHarnessChannel(name);
        returned = true;
      } catch {
        // expected — hard fail
      }
      assert.equal(returned, false, `${name} must throw, never return`);
    }
  });
});
