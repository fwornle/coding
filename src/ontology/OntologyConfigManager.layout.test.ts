/**
 * Integration tests for OntologyConfigManager wired through resolveOntologyPath
 * (Phase 42.1.1 Plan 01 — Task 2).
 *
 * RED gate:
 *   This file lands BEFORE OntologyConfigManager.ts is rewired. Tests A/B/C
 *   currently fail because validatePaths() still raises against two-tier paths
 *   that the flat on-disk layout does not satisfy.
 *
 * GREEN gate:
 *   After Site-1 (validatePaths) + Site-2 (injectOntology) route through
 *   resolveOntologyPath, every test below passes against the REAL
 *   .data/ontologies/ flat layout.
 *
 * Run from the symlinked submodule:
 *   cd integrations/mcp-server-semantic-analysis && npm run build && \
 *     node --test dist/ontology/OntologyConfigManager.layout.test.js
 *
 * The 4-level repo-root walk is REQUIRED — see ontologyPathResolver.test.ts
 * header for the segment-count rationale.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OntologyConfigManager } from './OntologyConfigManager.js';

// ---------------------------------------------------------------------------
// Repo-root walk — FOUR `..` segments. Two segments resolves to
// dist/.data/ontologies which does not exist (silent-pass regression guard).
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ONTOLOGY_DIR = join(REPO_ROOT, '.data', 'ontologies');

const TEAMS = [
  'agentic',
  'cluster-reprocessing',
  'code-entities',
  'coding',
  'raas',
  'resi',
  'ui',
];

// Two-tier paths that callers (tools.ts:2779-2780) construct today. These do
// NOT exist on disk; the resolver must accept them and find the flat-layout
// equivalents under .data/ontologies/.
function upperTwoTier(): string {
  return join(REPO_ROOT, '.data', 'ontologies', 'upper', 'development-knowledge-ontology.json');
}
function lowerTwoTier(team: string): string {
  return join(REPO_ROOT, '.data', 'ontologies', 'lower', `${team}-ontology.json`);
}

describe('Phase 42.1.1 Plan 01 Task 2 — OntologyConfigManager layout integration', () => {
  // Up-front sanity gate — proves the 4-level walk landed on the real
  // repo-root .data/ontologies/ directory before any test runs.
  before(() => {
    assert.equal(
      basename(ONTOLOGY_DIR),
      'ontologies',
      `sanity-gate: ONTOLOGY_DIR basename === 'ontologies', got '${basename(ONTOLOGY_DIR)}' (path: ${ONTOLOGY_DIR})`,
    );
    assert.ok(
      existsSync(join(ONTOLOGY_DIR, 'upper.json')),
      `sanity-gate: upper.json must exist in ${ONTOLOGY_DIR}`,
    );
    assert.ok(
      existsSync(join(ONTOLOGY_DIR, 'coding-ontology.json')),
      `sanity-gate: coding-ontology.json must exist in ${ONTOLOGY_DIR}`,
    );
  });

  // -------------------------------------------------------------------------
  // Test A: parameterised across all 7 teams — initialize() succeeds against
  // the real flat layout when the caller passes the two-tier paths.
  // -------------------------------------------------------------------------
  it('Test A: initialize() succeeds against REAL flat layout for every team currently on disk', async () => {
    for (const team of TEAMS) {
      OntologyConfigManager.resetInstance();
      const manager = OntologyConfigManager.getInstance({
        enabled: true,
        upperOntologyPath: upperTwoTier(),
        team,
        lowerOntologyPath: lowerTwoTier(team),
        hotReload: false,
      });
      await manager.initialize();
      // If initialize() did not throw, that's the success signal. Capture the
      // resolved upper path for forensic completeness.
      const cfg = manager.getConfig();
      assert.ok(existsSync(cfg.upperOntologyPath), `team=${team}: resolved upper must exist`);
      assert.ok(
        cfg.lowerOntologyPath && existsSync(cfg.lowerOntologyPath),
        `team=${team}: resolved lower must exist`,
      );
    }
    OntologyConfigManager.resetInstance();
  });

  // -------------------------------------------------------------------------
  // Test B: config rewritten in place to resolved absolute paths
  // -------------------------------------------------------------------------
  it('Test B: initialize() rewrites config.{upper,lower}OntologyPath to resolved absolute paths', async () => {
    OntologyConfigManager.resetInstance();
    const beforeUpper = upperTwoTier();
    const beforeLower = lowerTwoTier('coding');
    const manager = OntologyConfigManager.getInstance({
      enabled: true,
      upperOntologyPath: beforeUpper,
      team: 'coding',
      lowerOntologyPath: beforeLower,
      hotReload: false,
    });
    await manager.initialize();
    const cfg = manager.getConfig();

    const afterUpper = cfg.upperOntologyPath;
    const afterLower = cfg.lowerOntologyPath!;

    // Upper assertions
    assert.notEqual(afterUpper, beforeUpper, 'upper config must be rewritten in place');
    assert.ok(isAbsolute(afterUpper), 'upper resolved path must be absolute');
    assert.ok(existsSync(afterUpper), 'upper resolved path must exist on disk');
    const upperBase = basename(afterUpper);
    assert.ok(
      upperBase === 'upper.json' || upperBase === 'development-knowledge-ontology.json',
      `upper basename must be upper.json or development-knowledge-ontology.json, got '${upperBase}'`,
    );

    // Lower assertions
    assert.notEqual(afterLower, beforeLower, 'lower config must be rewritten in place');
    assert.ok(isAbsolute(afterLower), 'lower resolved path must be absolute');
    assert.ok(existsSync(afterLower), 'lower resolved path must exist on disk');
    assert.equal(
      basename(afterLower),
      'coding-ontology.json',
      'lower basename must be coding-ontology.json',
    );

    OntologyConfigManager.resetInstance();
  });

  // -------------------------------------------------------------------------
  // Test C: verification-boundary smoke — fresh OntologyRegistry constructed
  // over the post-initialize ontologyDir loads all 8 on-disk domain JSONs
  // and the canary 'Component' class resolves. In-process equivalent of
  // CONTEXT.md `<decisions>` § "Verification Boundary" bullets 2 AND 3.
  //
  // NOTE (Phase 42.1.1 Option A — locked 2026-05-24):
  //   The original plan asked for `isValidClass('Project') === true` here, but
  //   the on-disk ontology JSONs do NOT declare a `Project` class — `upper.json`
  //   exposes File/Service/Feature/Contract/RuntimeDiagnostics and each
  //   `<team>-ontology.json` declares team-specific L2 classes. Asserting on
  //   `Project` would be impossible without also editing the on-disk JSONs,
  //   which is explicitly out of scope for 42.1.1 (path-b rejected). Per
  //   CONTEXT.md line 93-94, SC#6 pass for Phase 42.1 is the PROMOTION GATE,
  //   not a 42.1.1 acceptance gate — 42.1.1 proves the loader works (layer 1
  //   of the SC#6 root cause); registering a `Project` class on disk (layer 2)
  //   is tracked as a NEW known residual in the SUMMARY and owned separately.
  //
  //   Softened assertions (this test):
  //     - registry.getLoadedDomains().length > 0   (loader works at all)
  //     - registry.getLoadedDomains().length === 8 (all on-disk JSONs loaded)
  //     - registry.isValidClass('Component') === true   (canary that IS in
  //       coding-ontology.json — matches registry-adoption.test.ts:88)
  //     - registry.isValidClass('NonExistentClassXyz123') === false   (negative)
  //
  //   DROPPED: registry.isValidClass('Project') === true   (would require
  //   adding Project to .data/ontologies/upper.json — separate follow-up)
  // -------------------------------------------------------------------------
  it('Test C: fresh OntologyRegistry over post-initialize ontologyDir loads all 8 domains AND canary Component resolves', async () => {
    OntologyConfigManager.resetInstance();
    const manager = OntologyConfigManager.getInstance({
      enabled: true,
      upperOntologyPath: upperTwoTier(),
      team: 'coding',
      lowerOntologyPath: lowerTwoTier('coding'),
      hotReload: false,
    });
    await manager.initialize();

    const ontologyDir = dirname(manager.getConfig().lowerOntologyPath!);
    process.stderr.write(`[Test C] ontologyDir resolved to: ${ontologyDir}\n`);

    const m = await import('@fwornle/km-core');
    const registry = new m.OntologyRegistry({ ontologyDir });

    const domains = registry.getLoadedDomains();
    process.stderr.write(`[Test C] getLoadedDomains().length = ${domains.length}\n`);
    process.stderr.write(`[Test C] domains = ${domains.join(', ')}\n`);

    // (1) Loader works at all
    assert.ok(domains.length > 0, `expected >0 loaded domains, got ${domains.length}`);

    // (2) All 8 on-disk JSONs loaded — proves resolver-then-registry chain reads
    // every flat-layout file under .data/ontologies/ (upper.json + 7 team JSONs)
    assert.equal(
      domains.length,
      8,
      `expected exactly 8 loaded domains (upper + 7 team JSONs), got ${domains.length}: ${domains.join(', ')}`,
    );

    // (3) Component — canary class, sourced from coding-ontology.json
    // (matches registry-adoption.test.ts:88)
    assert.equal(
      registry.isValidClass('Component'),
      true,
      'Component must resolve via the loaded registry (canary class)',
    );

    // (4) Negative-case sanity — registry actually discriminates
    assert.equal(
      registry.isValidClass('NonExistentClassXyz123'),
      false,
      'NonExistentClassXyz123 must NOT resolve (registry is not trivially returning true)',
    );

    // Forensic-trail log line — records that Project is NOT in the loaded set,
    // referencing the SUMMARY known-residuals for the follow-up ticket.
    process.stderr.write(
      `[Test C] domains.length=${domains.length}, sample classes: Component=valid, Project=NOT loaded (see SUMMARY known-residuals)\n`,
    );

    OntologyConfigManager.resetInstance();
  });

  // -------------------------------------------------------------------------
  // Test D: error-message shape — initialize() with bogus inputs rejects with
  // an Error whose message contains "Probed paths:" and lists every alias.
  // -------------------------------------------------------------------------
  it('Test D: bogus inputs -> initialize() throws Error whose message contains "Probed paths:"', async () => {
    OntologyConfigManager.resetInstance();
    const bogusBase = '/nonexistent-base-42-1-1';
    const manager = OntologyConfigManager.getInstance({
      enabled: true,
      upperOntologyPath: `${bogusBase}/.data/ontologies/upper/development-knowledge-ontology.json`,
      team: 'nonexistent-team-xyz',
      lowerOntologyPath: `${bogusBase}/.data/ontologies/lower/nonexistent-team-xyz-ontology.json`,
      hotReload: false,
    });
    let threw: Error | null = null;
    try {
      await manager.initialize();
    } catch (err) {
      threw = err as Error;
    }
    assert.ok(threw, 'expected initialize() to reject');
    assert.match(threw!.message, /Probed paths:/);
    // Each probed alias should appear at least once across the upper and lower
    // error messages. The exact aliases depend on the ancestor walk landing on
    // a path containing `.data/ontologies`; assert on the structural alias
    // names that the resolver always tries.
    assert.match(threw!.message, /upper\/development-knowledge-ontology\.json|development-knowledge-ontology\.json|upper\.json/);
    assert.match(threw!.message, /nonexistent-team-xyz-ontology\.json/);
    OntologyConfigManager.resetInstance();
  });

  // -------------------------------------------------------------------------
  // Test E (CR-01 regression): injectOntology() with hotReload re-registers
  // file watchers against the resolver-canonical path, not the two-tier hint
  // the caller passed.
  //
  // Before the CR-01 fix: getStatus().watchedFiles still contained the
  // two-tier path (which does not exist on disk) — runtime ontology swaps
  // silently broke hot-reload.
  // After the CR-01 fix: getStatus().watchedFiles contains the resolved flat
  // path; the previous watcher is torn down; subsequent on-disk edits fire
  // ontologyChanged events.
  // -------------------------------------------------------------------------
  it('Test E (CR-01): injectOntology with hotReload re-registers watchers against the resolved canonical path', async () => {
    OntologyConfigManager.resetInstance();
    // Construct with hotReload=true but do NOT call initialize() — that would
    // start watchers from validatePaths() and complicate the before/after
    // assertion. We want to drive injectOntology() directly and assert the
    // watcher set transitions to the resolved path.
    const manager = OntologyConfigManager.getInstance({
      enabled: true,
      upperOntologyPath: upperTwoTier(),
      team: 'coding',
      lowerOntologyPath: lowerTwoTier('coding'),
      hotReload: true,
      watchInterval: 60_000, // long enough that no callbacks fire during the test
    });

    // Drive the rewire path. The resolver-canonical path WILL differ from the
    // two-tier hints (real on-disk layout is flat) — that is exactly the
    // condition CR-01 was triggered by.
    await manager.injectOntology({
      upperOntologyPath: upperTwoTier(),
      lowerOntologyPath: lowerTwoTier('coding'),
      team: 'coding',
    });

    const status = manager.getStatus();
    const watched = status.watchedFiles;
    process.stderr.write(`[Test E] watchedFiles after inject: ${watched.join(', ')}\n`);

    // The two-tier hint paths MUST NOT appear in watchedFiles — they do not
    // exist on disk and watching them would silently lose hot-reload events.
    assert.ok(
      !watched.includes(upperTwoTier()),
      `two-tier upper path must NOT be watched (CR-01 regression): ${upperTwoTier()}`,
    );
    assert.ok(
      !watched.includes(lowerTwoTier('coding')),
      `two-tier lower path must NOT be watched (CR-01 regression): ${lowerTwoTier('coding')}`,
    );

    // The resolved (flat) paths MUST be watched.
    const resolvedUpper = manager.getConfig().upperOntologyPath;
    const resolvedLower = manager.getConfig().lowerOntologyPath!;
    assert.ok(
      watched.includes(resolvedUpper),
      `resolved upper path must be watched: ${resolvedUpper}; watched=${watched.join(', ')}`,
    );
    assert.ok(
      watched.includes(resolvedLower),
      `resolved lower path must be watched: ${resolvedLower}; watched=${watched.join(', ')}`,
    );

    OntologyConfigManager.resetInstance();
  });
});
