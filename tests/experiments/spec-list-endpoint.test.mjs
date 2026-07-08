// tests/experiments/spec-list-endpoint.test.mjs
//
// Phase 85-04 (Wave 3) — handleSpecList on lib/vkb-server/api-routes.js.
// D-09: preview the resolved variant matrix for every config/experiments/*.yaml.
// cellCount === variantCount * repeats. A MALFORMED spec is LISTED with
// { file, error }, NOT fatal — the endpoint still 200s with the rest.
//
// Isolation idiom mirrors runs-endpoint.test.mjs: Object.create + injected
// experimentRepoRoot pointing at a tmp repo-root with a config/experiments dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

/** A repo-root with one VALID spec (2 variants × 3 repeats = 6 cells) + one MALFORMED. */
function makeRepoRoot(label) {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), `spec-list-${label}-`));
  const specDir = path.join(root, 'config', 'experiments');
  fsSync.mkdirSync(specDir, { recursive: true });
  const valid = {
    goal_sentence: 'Implement a fizzbuzz function that passes the tests.',
    repeats: 3,
    axes: { agent: ['claude', 'copilot'], model: ['sonnet'] },
  };
  fsSync.writeFileSync(path.join(specDir, 'good.yaml'), yaml.dump(valid));
  // Malformed: no goal_sentence (resolveExperimentSpec throws).
  fsSync.writeFileSync(path.join(specDir, 'bad.yaml'), 'axes:\n  agent: [claude]\n');
  return root;
}

async function makeCtx(repoRoot) {
  const { ApiRoutes } = await import('../../lib/vkb-server/api-routes.js');
  const ctx = Object.create(ApiRoutes.prototype);
  ctx.experimentRepoRoot = repoRoot;
  return ctx;
}

test('spec list: valid spec previews cellCount = variantCount * repeats; malformed listed with error', async () => {
  const repoRoot = makeRepoRoot('t1');
  const ctx = await makeCtx(repoRoot);
  const res = mockRes();
  await ctx.handleSpecList({}, res);

  assert.equal(res.statusCode, 200, 'a malformed spec must NOT make the endpoint 500');
  assert.ok(Array.isArray(res.body.specs));
  assert.equal(res.body.specs.length, 2, 'both specs are listed');

  const good = res.body.specs.find((s) => s.file === 'good.yaml');
  assert.ok(good, 'the valid spec is listed');
  assert.equal(good.variantCount, 2, 'two variants (claude, copilot)');
  assert.equal(good.repeats, 3);
  assert.equal(good.cellCount, good.variantCount * good.repeats, 'cellCount = variantCount * repeats');
  assert.equal(good.cellCount, 6);
  assert.ok(Array.isArray(good.variants) && good.variants.length === 2, 'variant names surfaced');
  assert.ok(!('error' in good), 'a valid spec has no error key');

  const bad = res.body.specs.find((s) => s.file === 'bad.yaml');
  assert.ok(bad, 'the malformed spec is still listed');
  assert.ok(bad.error, 'the malformed spec carries an error key (not a 500)');
});

test('spec list: an empty config/experiments dir -> 200 { specs: [] }', async () => {
  const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'spec-list-empty-'));
  fsSync.mkdirSync(path.join(root, 'config', 'experiments'), { recursive: true });
  const ctx = await makeCtx(root);
  const res = mockRes();
  await ctx.handleSpecList({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.specs, []);
});
