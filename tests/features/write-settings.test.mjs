/**
 * setSettings — the writer behind `coding-features run|agents` and the
 * dashboard's run-mode and agent controls.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.CODING_REPO || new URL('../..', import.meta.url).pathname;
const { setSettings, setProfile } = await import(join(REPO, 'lib/features/write.mjs'));
const { invalidateFeatures } = await import(join(REPO, 'lib/features/index.mjs'));

let dir;
// repoPath is a sandbox repo, not this checkout: the writer appends to
// <repo>/.logs/features-audit.log, which must not collect test writes. It gets
// its own config/agents/ so the agent list is the real one.
const opts = () => ({ repoPath: join(dir, 'repo'), homeConfigPath: join(dir, 'features.yaml'), force: true });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'write-settings-'));
  mkdirSync(join(dir, 'repo', 'config', 'agents'), { recursive: true });
  for (const a of ['claude', 'copilot', 'opencode', 'pi']) writeFileSync(join(dir, 'repo', 'config', 'agents', `${a}.sh`), '');
  invalidateFeatures();
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); invalidateFeatures(); });

describe('setSettings', () => {
  test('writes run and agents and returns the resolved settings', () => {
    const r = setSettings({ run: 'host', agents: ['pi', 'claude'] }, opts());
    assert.equal(r.settings.run.effective, 'host');
    assert.deepEqual(r.settings.agents.enabled, ['claude', 'pi']);
    const text = readFileSync(join(dir, 'features.yaml'), 'utf8');
    assert.match(text, /run: host/);
  });

  test('null removes a key, so it falls back to auto / every agent', () => {
    setSettings({ run: 'host', agents: ['pi'] }, opts());
    const r = setSettings({ run: null, agents: null }, opts());
    assert.equal(r.settings.run.value, 'auto');
    assert.equal(r.settings.agents.enabled.length, 4);
  });

  test('an unknown agent is refused BEFORE anything is written', () => {
    assert.throws(() => setSettings({ agents: ['nope'] }, opts()), /unknown agent nope/);
    assert.equal(existsSync(join(dir, 'features.yaml')), false);
  });

  test('an empty agents list and an unknown run mode are refused', () => {
    assert.throws(() => setSettings({ agents: [] }, opts()), /non-empty/);
    assert.throws(() => setSettings({ run: 'boxed' }, opts()), /run must be one of/);
  });

  test('a profile switch keeps run and agents (a profile is a set of features)', () => {
    setSettings({ run: 'strict-box', agents: ['copilot'] }, opts());
    const { resolved } = setProfile('everything', opts());
    assert.equal(resolved.settings.run.effective, 'strict-box');
    assert.deepEqual(resolved.settings.agents.enabled, ['copilot']);
  });

  test('other keys in the file survive', () => {
    writeFileSync(join(dir, 'features.yaml'), 'features:\n  codegraph: off\n');
    const r = setSettings({ run: 'host' }, opts());
    assert.equal(r.features.codegraph.enabled, false);
  });
});
