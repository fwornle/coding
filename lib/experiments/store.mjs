// lib/experiments/store.mjs
//
// openExperimentStore() — the SINGLE dedicated-store factory for the v7.4
// performance-measurement experiment KB (Phase 71, KB-01 / D-01 / D-02).
//
// Every experiment CLI (run-write, query, classify) MUST open the store through
// this factory — never `new GraphKMStore` inline. This guarantees the mandatory
// explicit `ontologyDir` (CLAUDE.md "km-core scripts" rule) so the strict-path
// `putEntity` validates `entityType` against the live OntologyRegistry. Without
// `ontologyDir` the registry getter returns undefined and entityType validation
// silently degrades to a noop (KB-01 regression — see RESEARCH Pitfall 2 +
// Anti-Patterns).
//
// Store location (D-01): a DEDICATED LevelDB at .data/experiments/ — NEVER the
// shared .data/knowledge-graph/ store. Ontology dir (D-02): a STANDALONE dir
// holding ONLY upper.json (copied) + experiment-ontology.json so the experiment
// registry's class catalog is exactly the 7 experiment classes + upper bases.
//
// Analog: scripts/backfill-project-tag.mjs (GraphKMStore construction + open).
import path from 'node:path';
import process from 'node:process';
import { GraphKMStore } from '@fwornle/km-core';

const REPO = process.env.CODING_REPO || '/Users/Q284340/Agentic/coding';

/**
 * Open the dedicated experiment km-core store with the experiment ontology.
 *
 * Callers OWN the close: wrap usage in `try { ... } finally { await store.close(); }`.
 * The store is opened on-demand per-CLI-invocation and closed promptly — LevelDB
 * is single-owner, so two CLIs must not run concurrently against it (Pitfall 5).
 *
 * @returns {Promise<import('@fwornle/km-core').GraphKMStore>} the opened store
 */
export async function openExperimentStore() {
  const store = new GraphKMStore({
    dbPath:      path.join(REPO, '.data', 'experiments', 'leveldb'),
    exportDir:   path.join(REPO, '.data', 'experiments', 'exports'),
    ontologyDir: path.join(REPO, '.data', 'ontologies-experiment'),
    ontologyStrict: false,
    debounceMs: 0,
    domains: ['experiment'],
  });
  await store.open();
  process.stderr.write(
    `[experiments] opened store dbPath=${path.join(REPO, '.data', 'experiments', 'leveldb')}\n`,
  );
  return store;
}
