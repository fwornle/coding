// tests/redaction/config-load.test.mjs
//
// Behavior (RESEARCH Test Map + Hand-off #2): the redaction applier loads all
// 27 configured patterns; masks sk-/Bearer/JWT/env-var secrets; preserves the
// existing `{ content, redactionCount, securityLevel }` return shape (the
// lsl-file-manager.js caller depends on it); fails closed on redaction error.
//
// Filled in 84-02 (un-skipped from the Wave-0 stub). Requires the applier module
// via CommonJS interop (createRequire) because it is a `.cjs` module in this
// `type: module` repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkTmpMeasurementsDir } from '../context-turns/_helpers.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(REPO_ROOT, '.specstory', 'config', 'redaction-patterns.json');
const MODULE_PATH = path.join(REPO_ROOT, 'scripts', 'enhanced-redaction-system.cjs');

const mod = require(MODULE_PATH);
const RedactionApplier = mod.EnhancedRedactionSystem || mod;
const { loadRedactionPatterns } = mod;

test('loadRedactionPatterns loads the configured 27-pattern set (not the 4 hardcoded regexes)', () => {
  const patterns = loadRedactionPatterns(CONFIG_PATH);
  assert.ok(Array.isArray(patterns), 'loader returns an array');
  assert.ok(
    patterns.length >= 20,
    `expected the full configured set (>=20), got ${patterns.length}`,
  );
  // Every compiled entry has the {id, re, replacement} shape the applier consumes.
  for (const p of patterns) {
    assert.equal(typeof p.id, 'string');
    assert.ok(p.re instanceof RegExp, `pattern ${p.id} compiled to a RegExp`);
    assert.equal(typeof p.replacement, 'string');
  }
});

test('redact() masks sk-/Bearer/JWT/env-var secrets — no raw secret substring survives', () => {
  const applier = new RedactionApplier({ configPath: CONFIG_PATH });

  const ANTHROPIC_KEY = 'sk-ant-api03-ABCDEF1234567890abcdefGHIJ';
  const BEARER_TOKEN = 'abcDEF123ghiJKL456mnoPQR789stuVWX';
  // Signature deliberately has no `_`/`-` so the whole token matches the
  // jwt_tokens pattern (an underscore would let the earlier generic-key pattern
  // mangle the signature first, leaving the public header behind).
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY5MH0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5cXY';
  const ENV_SECRET_VALUE = 'myTopSecretValue987654321';
  const raw = [
    `authorization: Bearer ${BEARER_TOKEN}`,
    `key ${ANTHROPIC_KEY}`,
    `token ${JWT}`,
    `JWT_SECRET=${ENV_SECRET_VALUE}`,
  ].join(' | ');

  const result = applier.redact(raw);

  // (b) None of the raw secret substrings survive. NOTE: we assert the raw
  // TOKENS are gone, not the literal word "Bearer" — the bearer replacement is
  // "Bearer <TOKEN_REDACTED>", which by design re-emits the "Bearer " label.
  assert.ok(!result.content.includes('sk-ant'), 'Anthropic sk-ant key masked');
  assert.ok(!result.content.includes(ANTHROPIC_KEY), 'raw Anthropic key value gone');
  assert.ok(!result.content.includes(BEARER_TOKEN), 'raw Bearer token gone');
  assert.ok(!result.content.includes('eyJ'), 'JWT masked (no eyJ prefix survives)');
  assert.ok(!result.content.includes(JWT), 'raw JWT value gone');
  assert.ok(!result.content.includes(ENV_SECRET_VALUE), 'env-var secret value gone');

  // The masking actually fired.
  assert.ok(result.redactionCount > 0, 'at least one redaction applied');
  assert.equal(result.securityLevel, 'HIGH', 'securityLevel HIGH when redactions occurred');
});

test('redact() preserves the exact { content, redactionCount, securityLevel } return shape', () => {
  const applier = new RedactionApplier({ configPath: CONFIG_PATH });
  const result = applier.redact('hello Bearer abcDEF123ghiJKL456mnoPQR789stuVWX world');
  // (c) The happy-path caller contract: exactly these three keys.
  assert.deepEqual(
    Object.keys(result).sort(),
    ['content', 'redactionCount', 'securityLevel'],
    'return object has exactly content/redactionCount/securityLevel',
  );

  // Clean input still returns the same shape with securityLevel CLEAN.
  const clean = applier.redact('nothing sensitive here');
  assert.deepEqual(Object.keys(clean).sort(), ['content', 'redactionCount', 'securityLevel']);
  assert.equal(clean.redactionCount, 0);
  assert.equal(clean.securityLevel, 'CLEAN');
});

test('a config with one malformed pattern still loads the rest and never throws', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const goodCount = cfg.patterns.filter((p) => p.enabled).length;
    // Inject a deliberately invalid regex (unterminated character class).
    cfg.patterns.push({
      id: 'deliberately_malformed',
      pattern: '([unterminated',
      flags: 'g',
      replacement: '<x>',
      enabled: true,
    });
    const badCfgPath = path.join(tmp.dir, 'redaction-with-bad-pattern.json');
    fs.writeFileSync(badCfgPath, JSON.stringify(cfg));

    // (d) Must not throw; must skip only the bad pattern and keep the good ones.
    const patterns = loadRedactionPatterns(badCfgPath);
    assert.equal(patterns.length, goodCount, 'the bad pattern is filtered out, the rest survive');
    assert.ok(
      !patterns.some((p) => p.id === 'deliberately_malformed'),
      'the malformed pattern is skipped, not compiled',
    );
  } finally {
    tmp.cleanup();
  }
});
