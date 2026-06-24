// tests/experiments/taxonomy.test.mjs
// SC-3 / KB-03 proof: the closed-6 taxonomy loads (6 defs), isValidClass rejects
// any free string (the D-09/SC-4 write-path enforcement primitive), and the
// zero-LLM deriveClassFromText maps verbs to classes deterministically (D-11).
//
// Pure unit suite — no LLM, no network. Any live gate keys off the EXPERIMENTS_LIVE
// env var (NOT a `--live` argv, which the node:test per-file child proc drops —
// see memory/reference_node_test_argv_live_gate.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadTaxonomy,
  isValidClass,
  deriveClassFromText,
} from '../../lib/experiments/taxonomy.mjs';

/** Write `contents` to a throwaway tmp YAML file and return its path. */
function writeTmpYaml(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxonomy-test-'));
  const p = path.join(dir, 'task-taxonomy.yaml');
  fs.writeFileSync(p, contents, 'utf8');
  return p;
}

const CLOSED_6 = ['refactor', 'bugfix', 'new-feature', 'migration', 'debug', 'docs'];

test('loadTaxonomy: parses config/task-taxonomy.yaml → { version, classes }', () => {
  const tax = loadTaxonomy();
  assert.equal(tax.version, 0, 'version is 0');
  const keys = Object.keys(tax.classes).sort();
  assert.deepEqual(keys, [...CLOSED_6].sort(), 'exactly the closed-6 classes');
  for (const cls of CLOSED_6) {
    assert.ok(
      typeof tax.classes[cls].definition === 'string' && tax.classes[cls].definition.trim().length > 0,
      `class ${cls} has a non-empty definition`,
    );
    assert.ok(
      Array.isArray(tax.classes[cls].keywords) && tax.classes[cls].keywords.length > 0,
      `class ${cls} has a non-empty keywords list`,
    );
  }
});

test('loadTaxonomy: empty YAML throws a CLEAR error, not an opaque TypeError (WR-03)', () => {
  const emptyPath = writeTmpYaml('');
  assert.throws(
    () => loadTaxonomy(emptyPath),
    /empty or malformed: missing classes/,
    'empty file must throw a clear "missing classes" error',
  );
  const nullPath = writeTmpYaml('null\n');
  assert.throws(
    () => loadTaxonomy(nullPath),
    /empty or malformed: missing classes/,
    'explicit YAML null must throw a clear "missing classes" error',
  );
  const noClassesPath = writeTmpYaml('version: 0\n');
  assert.throws(
    () => loadTaxonomy(noClassesPath),
    /empty or malformed: missing classes/,
    'YAML lacking a classes map must throw a clear error',
  );
});

test('deriveClassFromText: tolerates a taxonomy with no classes without crashing (WR-03)', () => {
  // A taxonomy whose classes map is absent must NOT throw — it derives nothing.
  for (const tax of [{}, { classes: undefined }, { classes: {} }]) {
    const r = deriveClassFromText('add a new feature', tax);
    assert.equal(r.taskClass, null, 'no classes → no derived class');
    assert.equal(r.confident, false, 'no classes → not confident');
  }
});

test('isValidClass: accepts the closed-6, rejects unclassified + free strings (SC-4 primitive)', () => {
  for (const cls of CLOSED_6) {
    assert.equal(isValidClass(cls), true, `${cls} is valid`);
  }
  // The quarantine sentinel is NOT a member of the curated taxonomy.
  assert.equal(isValidClass('unclassified'), false, 'unclassified rejected');
  // Arbitrary free strings rejected — this is the write-path enforcement.
  assert.equal(isValidClass('frobnicate'), false, 'free string frobnicate rejected');
  assert.equal(isValidClass('anything-else'), false, 'free string anything-else rejected');
  assert.equal(isValidClass(''), false, 'empty string rejected');
  assert.equal(isValidClass(null), false, 'null rejected');
  assert.equal(isValidClass(undefined), false, 'undefined rejected');
});

test('deriveClassFromText: migrate → migration (confident)', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('migrate the database to postgres', tax);
  assert.equal(r.taskClass, 'migration');
  assert.equal(r.confident, true);
});

test('deriveClassFromText: fix...bug → bugfix (confident)', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('fix the broken login bug', tax);
  assert.equal(r.taskClass, 'bugfix');
  assert.equal(r.confident, true);
});

test('deriveClassFromText: add new ... → new-feature', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('add a new export button', tax);
  assert.equal(r.taskClass, 'new-feature');
  assert.equal(r.confident, true);
});

test('deriveClassFromText: gibberish → null, not confident (no keyword hit)', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('xyzzy plugh', tax);
  assert.equal(r.taskClass, null);
  assert.equal(r.confident, false);
});

test('deriveClassFromText: deterministic — same input yields same output', () => {
  const tax = loadTaxonomy();
  const a = deriveClassFromText('refactor and simplify this module', tax);
  const b = deriveClassFromText('refactor and simplify this module', tax);
  assert.deepEqual(a, b);
  assert.equal(a.taskClass, 'refactor');
});

test('deriveClassFromText: document/readme text → docs', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('update the readme documentation', tax);
  assert.equal(r.taskClass, 'docs');
  assert.equal(r.confident, true);
});

test('deriveClassFromText: investigate/diagnose text → debug', () => {
  const tax = loadTaxonomy();
  const r = deriveClassFromText('investigate and diagnose the race condition', tax);
  assert.equal(r.taskClass, 'debug');
  assert.equal(r.confident, true);
});
