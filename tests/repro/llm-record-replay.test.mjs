// tests/repro/llm-record-replay.test.mjs
//
// Phase 67, Plan 67-01 (Wave 1) — D-06/D-07 record→replay round-trip for the
// pure fixture recorder (lib/repro/fixtures/llm-record.mjs) and replay lookup
// (lib/repro/fixtures/llm-replay.mjs). No live proxy daemon is required — these
// are exercised as pure functions (RESEARCH Wave 0 Gaps).
//
// Contract under test:
//   - recordFixture(dir, key, resp) then replayLookup(dir, key) returns the
//     recorded { content, provider, model, tokens, latencyMs } BYTE-IDENTICAL
//     (deep-equal AND JSON.stringify equal).
//   - A lookup for an un-recorded key returns null — the D-06 hard-fail signal.
//     replayLookup NEVER synthesizes or falls through to a live response.
//   - Two identical recorded calls replay in recorded order via the D-07 ordinal.
//   - recordFixture is best-effort: a forced write failure never throws.
//
// Every test writes fixtures into a mkdtempSync temp dir and removes it in
// cleanup — NEVER a real .data path.
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
  normalizeReq,
  matchKey,
  resetOrdinals,
} from '../../lib/repro/fixtures/match-key.mjs';
import { recordFixture } from '../../lib/repro/fixtures/llm-record.mjs';
import { replayLookup } from '../../lib/repro/fixtures/llm-replay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '_fixtures');

function loadReq() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'llm-complete.req.json'), 'utf8'));
}
function loadResp() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'llm-complete.resp.json'), 'utf8'));
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'repro-llm-fixtures-'));
}

describe('record → replay round-trip', () => {
  test('replayLookup returns the recorded response byte-identical', () => {
    resetOrdinals();
    const dir = mkTmp();
    try {
      const key = matchKey(normalizeReq(loadReq()));
      const resp = loadResp();
      recordFixture(dir, key, resp);
      const hit = replayLookup(dir, key);
      assert.deepEqual(hit, resp);
      assert.equal(JSON.stringify(hit), JSON.stringify(resp));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recorded fixture stores exactly the response contract keys', () => {
    resetOrdinals();
    const dir = mkTmp();
    try {
      const key = matchKey(normalizeReq(loadReq()));
      const resp = loadResp();
      recordFixture(dir, key, resp);
      const hit = replayLookup(dir, key);
      assert.deepEqual(
        Object.keys(hit).sort(),
        ['content', 'latencyMs', 'model', 'provider', 'tokens'],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('replay miss (D-06 hard-fail signal)', () => {
  test('an un-recorded key returns null — never a live/synthesized response', () => {
    resetOrdinals();
    const dir = mkTmp();
    try {
      const missKey = matchKey(normalizeReq(loadReq())) + 'nonexistent';
      const hit = replayLookup(dir, missKey);
      assert.equal(hit, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('lookup against an empty fixtures dir returns null', () => {
    const dir = mkTmp();
    try {
      assert.equal(replayLookup(dir, 'anything#0'), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ordinal ordering (D-07 identical repeats)', () => {
  test('two identical recorded calls replay in recorded order', () => {
    resetOrdinals();
    const dir = mkTmp();
    try {
      const norm = normalizeReq(loadReq());
      const key0 = matchKey(norm); // "<sha>#0"
      const key1 = matchKey(norm); // "<sha>#1"
      assert.notEqual(key0, key1);
      const resp0 = { ...loadResp(), content: 'first call' };
      const resp1 = { ...loadResp(), content: 'second call' };
      recordFixture(dir, key0, resp0);
      recordFixture(dir, key1, resp1);

      // Replay side reconstructs the same ordinal sequence.
      resetOrdinals();
      const replayKey0 = matchKey(norm);
      const replayKey1 = matchKey(norm);
      assert.equal(replayLookup(dir, replayKey0).content, 'first call');
      assert.equal(replayLookup(dir, replayKey1).content, 'second call');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('recordFixture is best-effort (never throws)', () => {
  test('a write into a read-only directory does not throw', () => {
    resetOrdinals();
    const dir = mkTmp();
    try {
      fs.chmodSync(dir, 0o500); // read + execute, no write
      const key = matchKey(normalizeReq(loadReq()));
      // Must not throw even though the write cannot succeed.
      assert.doesNotThrow(() => recordFixture(dir, key, loadResp()));
    } finally {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
