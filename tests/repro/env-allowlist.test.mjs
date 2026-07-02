// tests/repro/env-allowlist.test.mjs
//
// Phase 67, Plan 67-03 (Wave 1) — REPRO-01 internal-state capture. Golden suite for
// lib/repro/env-allowlist.mjs (secret-safe agent-affecting env capture, T-67-03-01)
// and a best-effort smoke test for lib/repro/mcp-inventory.mjs (never-throws contract).
//
// Convention: node:test + node:assert/strict (established tests/experiments/ pattern —
// NOT jest globals). Output via process.stderr.write only (no console.* — no-console-log).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  captureEnvAllowlist,
  ENV_ALLOWLIST,
  SECRET_DENY_RE,
} from '../../lib/repro/env-allowlist.mjs';
import { captureMcpInventory } from '../../lib/repro/mcp-inventory.mjs';

describe('captureEnvAllowlist', () => {
  test('captures only allowlisted vars that are present', () => {
    const out = captureEnvAllowlist({
      LLM_PROXY_DATA_DIR: '/x',
      HTTPS_PROXY: 'http://proxy:8080',
      TOTALLY_UNRELATED_VAR: 'nope',
    });
    assert.deepEqual(out, { LLM_PROXY_DATA_DIR: '/x', HTTPS_PROXY: 'http://proxy:8080' });
    assert.ok(!('TOTALLY_UNRELATED_VAR' in out), 'non-allowlisted var excluded');
  });

  test('excludes secret-shaped vars (deny-regex)', () => {
    const out = captureEnvAllowlist({
      LLM_PROXY_DATA_DIR: '/x',
      AWS_SECRET_ACCESS_KEY: 's',
      OPENAI_API_KEY: 'k',
    });
    assert.deepEqual(out, { LLM_PROXY_DATA_DIR: '/x' });
  });

  test('deny-regex wins even if a secret-shaped name were in the allowlist', () => {
    // Belt-and-suspenders: SECRET_DENY_RE is applied to the allowlisted name itself.
    const rogueName = 'MY_API_KEY';
    assert.ok(SECRET_DENY_RE.test(rogueName), 'test premise: name is secret-shaped');
    const out = captureEnvAllowlist(
      { [rogueName]: 'leak-me' },
      [rogueName], // inject rogue name into the allowlist for this call
    );
    assert.deepEqual(out, {}, 'secret-shaped name must be denied despite being allowlisted');
  });

  test('SECRET_DENY_RE matches KEY/TOKEN/SECRET/PASSWORD case-insensitively', () => {
    for (const n of ['FOO_KEY', 'my_token', 'A_SECRET_B', 'db_password']) {
      assert.ok(SECRET_DENY_RE.test(n), `${n} should be denied`);
    }
    assert.ok(!SECRET_DENY_RE.test('LLM_PROXY_DATA_DIR'), 'benign name not denied');
  });

  test('ENV_ALLOWLIST includes the RESEARCH-recommended agent-affecting vars', () => {
    for (const n of ['LLM_PROXY_DATA_DIR', 'HTTPS_PROXY', 'CODING_REPO', 'NODE_OPTIONS']) {
      assert.ok(ENV_ALLOWLIST.includes(n), `${n} should be allowlisted`);
    }
  });

  test('TRUE-NEGATIVE: empty env yields an empty object, no throw', () => {
    assert.deepEqual(captureEnvAllowlist({}), {});
  });

  test('defaults to process.env when no arg passed (no throw)', () => {
    assert.doesNotThrow(() => captureEnvAllowlist());
    const out = captureEnvAllowlist();
    assert.equal(typeof out, 'object');
    // Whatever it returns, it must never contain a secret-shaped key.
    for (const k of Object.keys(out)) {
      assert.ok(!SECRET_DENY_RE.test(k), `${k} leaked a secret-shaped key`);
    }
  });
});

describe('captureMcpInventory', () => {
  test('returns { servers[], source } and never throws', () => {
    let inv;
    assert.doesNotThrow(() => {
      inv = captureMcpInventory();
    });
    assert.equal(typeof inv, 'object');
    assert.ok(Array.isArray(inv.servers), 'servers is an array');
    assert.equal(typeof inv.source, 'string');
    assert.ok(
      ['live', 'config', 'unavailable'].includes(inv.source),
      `source '${inv.source}' should be one of live|config|unavailable`,
    );
    for (const s of inv.servers) {
      assert.equal(typeof s.name, 'string');
      assert.ok('version' in s, 'each server entry carries a version field');
    }
  });
});
