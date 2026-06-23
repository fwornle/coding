// tests/experiments/ontology.test.mjs
//
// SC-1 proof (KB-01): the experiment ontology defines all 7 classes and loads
// into a LIVE km-core OntologyRegistry — isValidClass('Run') is true (entityType
// validation is live, not a noop) AND no "skipping malformed ontology file"
// stderr warning fires during load (RESEARCH Pitfall 2 guard).
//
// Isolation: CODING_REPO is pointed at a tmpdir so the throwaway LevelDB lives
// under <tmp>/.data/experiments/leveldb, never the real store. The ontology
// under test IS the real artifact — we copy .data/ontologies-experiment/ verbatim
// into <tmp>/.data/ontologies-experiment/ so the registry loads the same files
// shipped in this plan.
//
// Forensic lines via process.stderr.write only (no console.* — no-console-log).
// Any future live-only assertion gates on EXPERIMENTS_LIVE (env var, NOT a
// `--live` argv — MEMORY.md node --test argv gotcha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ONTOLOGY_DIR = path.join(REPO_ROOT, '.data', 'ontologies-experiment');

const EXPERIMENT_CLASSES = [
  'Experiment', 'Run', 'Route', 'Step', 'Decision', 'Outcome', 'Report',
];

/**
 * Build an isolated tmp repo-root with the REAL experiment ontology copied in,
 * capture stderr, open the store via the explicit `repoRoot` override (NOT a
 * `process.env.CODING_REPO` mutation — env is process-global and races under
 * concurrent test execution; the explicit arg keeps each open hermetic), and
 * return { store, stderrText, cleanup }.
 */
async function openIsolatedStore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-ontology-test-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  // Copy the real artifacts (upper.json + experiment-ontology.json) verbatim.
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) {
    fs.copyFileSync(path.join(SRC_ONTOLOGY_DIR, f), path.join(tmpOntologyDir, f));
  }

  // Capture stderr around the open to prove no skip-warning (Pitfall 2).
  let stderrText = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    stderrText += typeof chunk === 'string' ? chunk : chunk.toString();
    return origWrite(chunk, ...rest);
  };

  let store;
  try {
    const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
    store = await openExperimentStore({ repoRoot: tmp });
  } finally {
    process.stderr.write = origWrite;
  }

  const cleanup = async () => {
    try { await store?.close(); } catch { /* best-effort */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { store, stderrText, cleanup };
}

test('SC-1: experiment store opens with a LIVE ontology registry (not noop)', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    assert.ok(
      store.ontology,
      'store.ontology must be defined — undefined means ontologyDir was not wired and entityType validation is a noop',
    );
    assert.equal(
      typeof store.ontology.isValidClass,
      'function',
      'live registry must expose isValidClass()',
    );
  } finally {
    await cleanup();
  }
});

test('SC-1: all 7 experiment classes are valid via the real registry accessor', async () => {
  const { store, cleanup } = await openIsolatedStore();
  try {
    for (const cls of EXPERIMENT_CLASSES) {
      assert.equal(
        store.ontology.isValidClass(cls),
        true,
        `isValidClass('${cls}') must be true (loaded from experiment-ontology.json)`,
      );
    }
    // Negative control — a class that was never declared must NOT be valid.
    assert.equal(
      store.ontology.isValidClass('NotARealExperimentClassXyz'),
      false,
      'unknown class must be rejected (proves the registry is real, not a yes-to-all noop)',
    );
  } finally {
    await cleanup();
  }
});

test('SC-1: ontology load emits NO "skipping malformed ontology file" warning (Pitfall 2)', async () => {
  const { stderrText, cleanup } = await openIsolatedStore();
  try {
    assert.ok(
      !stderrText.includes('skipping malformed ontology file'),
      `experiment-ontology.json must load cleanly; got stderr:\n${stderrText}`,
    );
  } finally {
    await cleanup();
  }
});
