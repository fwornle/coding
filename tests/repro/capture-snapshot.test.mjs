// tests/repro/capture-snapshot.test.mjs
//
// Phase 67, Plan 67-04 (Wave 2) — REPRO-01 / SC-1. Golden suite for
// lib/repro/capture-snapshot.mjs: captureSnapshot(task_id) must assemble EVERY
// internal-state item into one traversal-safe `.data/run-snapshots/<task_id>/` dir with a
// manifest carrying clock_base + an honest per-channel capability map + the kb_caveat.
// Composes the Plan 03 primitives (git/env/mcp) + Task 1 kb-capture over a fully synthetic
// repoRoot + dataDir (real throwaway git repo, fake KB, fake llm-settings) so the suite is
// hermetic and needs no live services / km-core.
//
// Convention: node:test + node:assert/strict (established tests/repro/ pattern). Output via
// process.stderr.write only (no console.* — no-console-log, CLAUDE.md).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { captureSnapshot } from '../../lib/repro/capture-snapshot.mjs';

/** Run a fixed-argv git command in `cwd`, throwing on non-zero (test setup only). */
function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15_000 });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

function seedRepo(repoRoot) {
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Repro Test']);
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'original\n');
  git(repoRoot, ['add', 'tracked.txt']);
  git(repoRoot, ['commit', '-q', '-m', 'initial']);
  fs.writeFileSync(path.join(repoRoot, 'tracked.txt'), 'original\nEDIT\n');
  fs.writeFileSync(path.join(repoRoot, 'untracked.txt'), 'new\n');
  // .planning/ state to be captured.
  const planDir = path.join(repoRoot, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'STATE.md'), '# state\n');
}

function seedDataDir(dataDir, { withSecret = false } = {}) {
  const kg = path.join(dataDir, 'knowledge-graph');
  fs.mkdirSync(path.join(kg, 'leveldb'), { recursive: true });
  fs.mkdirSync(path.join(kg, 'exports'), { recursive: true });
  fs.writeFileSync(path.join(kg, 'leveldb', 'CURRENT'), 'MANIFEST-1\n');
  fs.writeFileSync(path.join(kg, 'exports', 'general.json'), JSON.stringify({ nodes: [], edges: [] }));
  const proxyDir = path.join(dataDir, 'llm-proxy');
  fs.mkdirSync(proxyDir, { recursive: true });
  const settings = withSecret
    ? { processOverrides: { 'wave-analysis': { provider: 'copilot' } }, apiKey: 'sk-should-not-copy' }
    : { processOverrides: { 'wave-analysis': { provider: 'copilot' } } };
  fs.writeFileSync(path.join(proxyDir, 'llm-settings.json'), JSON.stringify(settings));
}

describe('captureSnapshot', () => {
  let repoRoot;
  let dataDir;

  before(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-snap-repo-'));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-snap-data-'));
    seedRepo(repoRoot);
    seedDataDir(dataDir);
  });

  after(() => {
    for (const d of [repoRoot, dataDir]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  test('returns snapshot_id (sanitized task_id), dir, clock_base', () => {
    const res = captureSnapshot('task-123', { repoRoot, dataDir, prompt: 'do the thing' });
    assert.equal(res.snapshot_id, 'task-123');
    assert.equal(typeof res.clock_base, 'number');
    assert.ok(res.dir.includes(path.join('.data', 'run-snapshots', 'task-123')));
  });

  test('assembles ALL SC-1 artifacts in the snapshot dir', () => {
    const { dir } = captureSnapshot('task-abc', { repoRoot, dataDir, prompt: 'p' });
    const required = [
      'git-sha.txt',
      'dirty.patch',
      'submodules.json',
      path.join('kb', 'exports', 'general.json'),
      'llm-settings.json',
      'mcp-inventory.json',
      'env-allowlist.json',
      'agent-version.txt',
      'prompt.txt',
      'manifest.json',
    ];
    for (const rel of required) {
      assert.ok(fs.existsSync(path.join(dir, rel)), `missing artifact: ${rel}`);
    }
    // A planning artifact must exist (planning/ dir copy or planning.tar).
    const hasPlanning =
      fs.existsSync(path.join(dir, 'planning')) || fs.existsSync(path.join(dir, 'planning.tar'));
    assert.ok(hasPlanning, 'missing planning artifact (planning/ or planning.tar)');
  });

  test('manifest carries clock_base, git_sha, kb_caveat, and honest channel map', () => {
    const { dir } = captureSnapshot('task-mani', { repoRoot, dataDir, prompt: 'p' });
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(typeof manifest.clock_base, 'number');
    assert.match(manifest.git_sha, /^[0-9a-f]{40}$/);
    assert.equal(typeof manifest.kb_caveat, 'string');
    assert.ok(manifest.kb_caveat.length > 0);
    assert.equal(manifest.channels.llm, 'record');
    assert.equal(manifest.channels.WebSearch, 'record-only');
    assert.equal(manifest.channels.WebFetch, 'record-only');
    assert.equal(manifest.channels.MCP, 'record-only');
    assert.equal(manifest.channels.clock, 'virtualized');
  });

  test('prompt.txt holds the run prompt', () => {
    const { dir } = captureSnapshot('task-prompt', { repoRoot, dataDir, prompt: 'REPRO_PROMPT_XYZ' });
    const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
    assert.ok(prompt.includes('REPRO_PROMPT_XYZ'));
  });

  test('T-67-04-01: path-traversal task_id is neutralized (stays under run-snapshots)', () => {
    const { dir, snapshot_id } = captureSnapshot('../evil', { repoRoot, dataDir, prompt: 'p' });
    const snapRoot = path.join(repoRoot, '.data', 'run-snapshots');
    const resolved = path.resolve(dir);
    assert.ok(resolved.startsWith(path.resolve(snapRoot) + path.sep), `escaped: ${resolved}`);
    assert.ok(!snapshot_id.includes('..'), 'snapshot_id must not contain ..');
    assert.ok(!snapshot_id.includes('/'), 'snapshot_id must not contain path separators');
  });

  test('T-67-04-03: env-allowlist.json carries no secret-shaped values', () => {
    const { dir } = captureSnapshot('task-env', { repoRoot, dataDir, prompt: 'p' });
    const envJson = fs.readFileSync(path.join(dir, 'env-allowlist.json'), 'utf8');
    assert.ok(!/KEY|TOKEN|SECRET|PASSWORD/i.test(Object.keys(JSON.parse(envJson)).join(',')));
  });

  test('T-67-04-03: llm-settings.json with a secret field is omitted + noted in manifest', () => {
    const secretData = fs.mkdtempSync(path.join(os.tmpdir(), 'repro-snap-secret-'));
    try {
      seedDataDir(secretData, { withSecret: true });
      const { dir } = captureSnapshot('task-secret', { repoRoot, dataDir: secretData, prompt: 'p' });
      assert.ok(
        !fs.existsSync(path.join(dir, 'llm-settings.json')),
        'llm-settings.json with a secret field must NOT be copied',
      );
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      assert.ok(
        manifest.llm_settings_omitted_reason && /secret/i.test(manifest.llm_settings_omitted_reason),
        'manifest must note the secret-omission reason',
      );
    } finally {
      fs.rmSync(secretData, { recursive: true, force: true });
    }
  });

  test('TRUE-NEGATIVE: a broken dataDir still yields a manifest, never throws', () => {
    const bogusData = path.join(os.tmpdir(), 'repro-snap-nope-' + Date.now());
    let res;
    assert.doesNotThrow(() => {
      res = captureSnapshot('task-bogus', { repoRoot, dataDir: bogusData, prompt: 'p' });
    });
    assert.ok(fs.existsSync(path.join(res.dir, 'manifest.json')), 'manifest still written');
  });
});
