// tests/redaction/proxy-raw-body.test.mjs
//
// Behavior (Phase 84 Plan 06, D-05/D-06): the proxy captures FULL raw request/
// response bodies ONLY when the per-span flag span.meta.capture_raw_bodies is
// true (default OFF); every captured body is redacted via the shared 27-pattern
// configured set BEFORE write; a redaction error blocks that body's content
// (fail-closed) but never throws; raw bodies land in a SEPARATE raw-bodies.jsonl
// sibling. This test imports the REAL production module cross-repo (server.mjs
// boots an HTTP server on import → not unit-importable; the pure redaction +
// append + gate helpers live in proxy-bridge/raw-bodies.mjs, mirroring Plan 04's
// context-turns.mjs extraction) and drives the exact production path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRawBodyRedactionPatterns,
  makeRedactRawBody,
  rawBodyCaptureEnabled,
  appendRawBody,
} from '../../../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CODING_ROOT = path.join(__dirname, '..', '..');

const patterns = loadRawBodyRedactionPatterns(CODING_ROOT);
const redactRawBody = makeRedactRawBody(patterns);

// Proven secret fixtures (same shapes as the Plan 02 config-load test). The JWT
// signature has no `_`/`-` so the whole token matches the jwt_tokens pattern.
const ANTHROPIC_KEY = 'sk-ant-api03-ABCDEF1234567890abcdefGHIJ';
const BEARER_TOKEN = 'abcDEF123ghiJKL456mnoPQR789stuVWX';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY5MH0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5cXY';

test('loadRawBodyRedactionPatterns compiles the configured 27-pattern set from the shared config', () => {
  assert.ok(Array.isArray(patterns), 'loader returns an array');
  assert.ok(patterns.length >= 20, `expected the full configured set (>=20), got ${patterns.length}`);
  for (const p of patterns) {
    assert.ok(p.re instanceof RegExp, `pattern ${p.id} compiled to a RegExp`);
    assert.equal(typeof p.replacement, 'string');
  }
});

test('redactRawBody masks sk-/Bearer/JWT secrets — no raw secret substring survives before write', () => {
  const body = JSON.stringify({
    authorization: `Bearer ${BEARER_TOKEN}`,
    apiKey: ANTHROPIC_KEY,
    idToken: JWT,
  });
  const red = redactRawBody(body);
  assert.ok(!red.includes('sk-ant'), 'Anthropic sk-ant key masked');
  assert.ok(!red.includes(ANTHROPIC_KEY), 'raw Anthropic key value gone');
  assert.ok(!red.includes(BEARER_TOKEN), 'raw Bearer token gone');
  assert.ok(!red.includes('eyJ'), 'JWT masked (no eyJ prefix survives)');
  assert.ok(!red.includes(JWT), 'raw JWT value gone');
});

test('redactRawBody is fail-closed on content and never throws', () => {
  // A value whose String() coercion throws forces a redaction error.
  const exploding = { toString() { throw new Error('boom'); } };
  let out;
  assert.doesNotThrow(() => { out = redactRawBody(exploding); }, 'redactRawBody must never throw');
  assert.equal(out, '[REDACTION_ERROR_CONTENT_BLOCKED]', 'content is blocked on redaction error');
});

test('rawBodyCaptureEnabled defaults OFF and is true only for capture_raw_bodies === true', () => {
  assert.equal(rawBodyCaptureEnabled(undefined), false, 'no span → OFF');
  assert.equal(rawBodyCaptureEnabled(null), false, 'null span → OFF');
  assert.equal(rawBodyCaptureEnabled({}), false, 'no meta → OFF');
  assert.equal(rawBodyCaptureEnabled({ meta: {} }), false, 'meta without flag → OFF');
  assert.equal(rawBodyCaptureEnabled({ meta: { capture_raw_bodies: false } }), false, 'flag false → OFF');
  assert.equal(rawBodyCaptureEnabled({ meta: { capture_raw_bodies: 'true' } }), false, 'truthy-but-not-true → OFF');
  assert.equal(rawBodyCaptureEnabled({ meta: { capture_raw_bodies: true } }), true, 'flag true → ON');
});

test('flag ON writes a redacted raw-bodies.jsonl line with no secret substrings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-body-on-'));
  try {
    const span = { meta: { capture_raw_bodies: true } };
    const reqBody = { model: 'claude', auth: `Bearer ${BEARER_TOKEN}`, key: ANTHROPIC_KEY };
    const respBody = { content: 'ok', idToken: JWT };

    // Mirror the server.mjs write site exactly: gate → redact both → append.
    let wrote = false;
    if (rawBodyCaptureEnabled(span)) {
      wrote = await appendRawBody(tmp, {
        ts: new Date().toISOString(),
        task_id: 'exp--claude--r0',
        request_id: 'req-1',
        wire: 'anthropic',
        request: redactRawBody(JSON.stringify(reqBody)),
        response: redactRawBody(JSON.stringify(respBody)),
      });
    }
    assert.equal(wrote, true, 'append reported success');

    const file = path.join(tmp, 'raw-bodies.jsonl');
    assert.ok(fs.existsSync(file), 'raw-bodies.jsonl written when flag ON');
    const raw = fs.readFileSync(file, 'utf8');
    // The whole persisted line must carry NO secret substrings.
    assert.ok(!raw.includes('sk-ant'), 'no sk-ant in file');
    assert.ok(!raw.includes(ANTHROPIC_KEY), 'no raw Anthropic key in file');
    assert.ok(!raw.includes(BEARER_TOKEN), 'no raw Bearer token in file');
    assert.ok(!raw.includes('eyJ'), 'no JWT prefix in file');
    assert.ok(!raw.includes(JWT), 'no raw JWT in file');

    const line = JSON.parse(raw.trim());
    assert.equal(line.wire, 'anthropic');
    assert.equal(line.task_id, 'exp--claude--r0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('flag OFF writes no raw-bodies.jsonl', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'raw-body-off-'));
  try {
    const span = { meta: { capture_raw_bodies: false } };
    // Mirror the server.mjs gate: the append is never reached when OFF.
    let attempted = false;
    if (rawBodyCaptureEnabled(span)) {
      attempted = true;
      await appendRawBody(tmp, { ts: 't', task_id: 'x', wire: 'anthropic', request: 'r', response: 's' });
    }
    assert.equal(attempted, false, 'append is gated out when the flag is OFF');
    assert.ok(!fs.existsSync(path.join(tmp, 'raw-bodies.jsonl')), 'no raw-bodies.jsonl when flag OFF');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
