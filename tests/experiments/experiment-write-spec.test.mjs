// tests/experiments/experiment-write-spec.test.mjs
//
// Fix (v7.3): code-guaranteed persistence of /experiment specs into config/experiments/
// so they appear in the dashboard Launch listbox. buildExperimentSpec must VALIDATE
// through the same resolver the listbox + launch gate use; writeExperimentSpec must land
// a path-safe, gen-prefixed file the listbox can enumerate.
//
// Convention: node:test + node:assert/strict, stderr-only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  buildExperimentSpec,
  writeExperimentSpec,
} from '../../scripts/experiment-write-spec.mjs';

const VALID = {
  experimentId: 'unit-fix4-v1',
  goal: 'Create a hello.mjs exporting hello() returning "hi".',
  variants: [
    { agent: 'claude', model: 'sonnet', framework: 'straight', env: 'default' },
    { agent: 'opencode', model: 'rapid-proxy/claude-haiku-4-5', framework: 'straight', env: 'default' },
  ],
  snapshotId: 'smoke-spec',
  taskClass: 'new-feature',
  testCommand: 'node --test hello.test.mjs',
  repeats: 2,
};

describe('buildExperimentSpec', () => {
  test('assembles a fully-populated, resolver-valid spec', () => {
    const spec = buildExperimentSpec(VALID);
    assert.equal(spec.experiment_id, 'unit-fix4-v1');
    assert.equal(spec.goal_sentence, VALID.goal);
    assert.equal(spec.task_class, 'new-feature');
    assert.equal(spec.snapshot_id, 'smoke-spec');
    assert.equal(spec.repeats, 2);
    assert.equal(spec.test_command, 'node --test hello.test.mjs');
    assert.equal(spec.variants.length, 2);
  });

  test('defaults task_class→new-feature, snapshot→smoke-spec, repeats→1', () => {
    const spec = buildExperimentSpec({
      experimentId: 'd', goal: 'g', variants: [{ agent: 'claude' }],
    });
    assert.equal(spec.task_class, 'new-feature');
    assert.equal(spec.snapshot_id, 'smoke-spec');
    assert.equal(spec.repeats, 1);
    assert.equal(spec.test_command, undefined); // omitted when empty → ungated run
  });

  test('rejects a non-closed-6 task_class', () => {
    assert.throws(() => buildExperimentSpec({ ...VALID, taskClass: 'bogus' }), /closed-6/);
  });

  test('rejects an unknown agent (KNOWN_AGENTS gate, via resolveExperimentSpec)', () => {
    assert.throws(
      () => buildExperimentSpec({ experimentId: 'a', goal: 'g', variants: [{ agent: 'gemini' }] }),
      /unknown value 'gemini'|invalid cell/i,
    );
  });

  test('rejects empty variants and missing goal / experiment_id', () => {
    assert.throws(() => buildExperimentSpec({ experimentId: 'a', goal: 'g', variants: [] }), /variants/);
    assert.throws(() => buildExperimentSpec({ experimentId: 'a', goal: '', variants: [{ agent: 'claude' }] }), /goal/);
    assert.throws(() => buildExperimentSpec({ experimentId: '', goal: 'g', variants: [{ agent: 'claude' }] }), /experiment-id/);
  });
});

describe('writeExperimentSpec', () => {
  test('writes a gen-prefixed, path-safe YAML under config/experiments and round-trips', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-'));
    const spec = buildExperimentSpec(VALID);
    const out = writeExperimentSpec(spec, { repoRoot });
    assert.equal(path.basename(out), 'gen-unit-fix4-v1.yaml');
    assert.ok(out.includes(path.join('config', 'experiments')));
    const back = yaml.load(fs.readFileSync(out, 'utf8'));
    assert.equal(back.experiment_id, 'unit-fix4-v1');
    assert.equal(back.variants.length, 2);
  });

  test('sanitizes a traversal-y experiment_id into a safe basename', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-'));
    const spec = buildExperimentSpec({ ...VALID, experimentId: '../../etc/passwd' });
    const out = writeExperimentSpec(spec, { repoRoot });
    // sanitizeTaskId basenames + allowlists → no separators escape config/experiments
    assert.equal(path.dirname(out), path.join(repoRoot, 'config', 'experiments'));
    assert.match(path.basename(out), /^gen-[A-Za-z0-9._-]+\.yaml$/);
    assert.ok(!path.basename(out).includes('/'));
  });

  test('prefix:"" writes an un-prefixed name (curated-style)', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-'));
    const out = writeExperimentSpec(buildExperimentSpec(VALID), { repoRoot, prefix: '' });
    assert.equal(path.basename(out), 'unit-fix4-v1.yaml');
  });
});
