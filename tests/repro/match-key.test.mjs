// tests/repro/match-key.test.mjs
//
// Phase 67, Plan 67-01 (Wave 1) — D-07 match-key contract for the pure
// normalize + sha256 + per-key-ordinal primitive in
// lib/repro/fixtures/match-key.mjs. This is the SINGLE hash implementation
// shared by the record tap, the replay tap, and the integration flow, so the
// stability guarantees below are load-bearing: record and replay MUST agree on
// the key for the same logical request.
//
// Contract under test:
//   - normalizeReq drops volatile fields (task_id, subscription, request/trace
//     id, provider-selection hints) and canonicalizes the model alias, so two
//     requests differing ONLY in a volatile field hash to the SAME sha256 base.
//   - Requests differing in model (semantically) or messages hash DIFFERENT.
//   - matchKey returns "<sha256>#<ordinal>"; repeated identical calls get
//     ordinal 0 then 1 (per-key call counter, D-07); resetOrdinals() zeroes it.
//
// Convention: node:test + node:assert/strict (the established tests/experiments/
// pattern — NOT jest globals). Output via process.stderr.write only
// (no console.* — no-console-log).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeReq,
  matchKey,
  resetOrdinals,
} from '../../lib/repro/fixtures/match-key.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '_fixtures');

function loadReq() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'llm-complete.req.json'), 'utf8'));
}

/** sha256 base = the composite key with its "#<ordinal>" suffix stripped. */
function base(key) {
  return key.split('#')[0];
}

describe('normalizeReq', () => {
  test('drops volatile fields so volatile-only differences collapse to the same key', () => {
    resetOrdinals();
    const a = loadReq();
    const b = loadReq();
    // Differ ONLY in volatile fields.
    a.subscription = 'corp-pool-7';
    b.subscription = 'home-pool-99';
    a.task_id = 'task-aaaa';
    b.task_id = 'task-bbbb';
    a.request_id = 'req-1';
    b.request_id = 'req-2';
    a.trace_id = 'trace-xyz';
    b.provider = 'copilot';
    assert.equal(base(matchKey(normalizeReq(a))), base(matchKey(normalizeReq(b))));
  });

  test('canonicalizes model alias — raw alias and canonical name hash the same', () => {
    resetOrdinals();
    const a = loadReq();
    const b = loadReq();
    a.model = 'Claude-Haiku'; // mixed case + alias form
    b.model = '  claude-haiku  '; // whitespace-padded canonical form
    assert.equal(base(matchKey(normalizeReq(a))), base(matchKey(normalizeReq(b))));
  });

  test('a semantically different model produces a DIFFERENT key', () => {
    resetOrdinals();
    const a = loadReq();
    const b = loadReq();
    a.model = 'claude-haiku';
    b.model = 'claude-opus';
    assert.notEqual(base(matchKey(normalizeReq(a))), base(matchKey(normalizeReq(b))));
  });

  test('different messages produce a DIFFERENT key', () => {
    resetOrdinals();
    const a = loadReq();
    const b = loadReq();
    b.messages = [{ role: 'user', content: 'a completely different prompt' }];
    assert.notEqual(base(matchKey(normalizeReq(a))), base(matchKey(normalizeReq(b))));
  });
});

describe('matchKey ordinal (D-07 per-key call counter)', () => {
  test('identical repeated calls yield ordinal 0 then 1', () => {
    resetOrdinals();
    const req = normalizeReq(loadReq());
    const k0 = matchKey(req);
    const k1 = matchKey(req);
    assert.equal(base(k0), base(k1), 'same request → same sha256 base');
    assert.equal(k0.split('#')[1], '0');
    assert.equal(k1.split('#')[1], '1');
    assert.notEqual(k0, k1, 'composite keys differ only by ordinal');
  });

  test('resetOrdinals() restores ordinal 0 for a previously-seen request', () => {
    resetOrdinals();
    const req = normalizeReq(loadReq());
    matchKey(req);
    matchKey(req);
    resetOrdinals();
    const kAfter = matchKey(req);
    assert.equal(kAfter.split('#')[1], '0');
  });

  test('distinct requests each keep their own independent ordinal counter', () => {
    resetOrdinals();
    const a = normalizeReq(loadReq());
    const b = loadReq();
    b.messages = [{ role: 'user', content: 'second distinct request' }];
    const nb = normalizeReq(b);
    const a0 = matchKey(a);
    const b0 = matchKey(nb);
    const a1 = matchKey(a);
    assert.equal(a0.split('#')[1], '0');
    assert.equal(b0.split('#')[1], '0');
    assert.equal(a1.split('#')[1], '1');
  });
});
