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
  // over the post-initialize ontologyDir loads >0 classes including 'Project'
  // (the class ensureProjectAnchor mints). In-process equivalent of CONTEXT.md
  // `<decisions>` § "Verification Boundary" bullets 2 AND 3.
  // -------------------------------------------------------------------------
  it('Test C: fresh OntologyRegistry over post-initialize ontologyDir loads >0 classes AND isValidClass(Project) === true', async () => {
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
    assert.ok(domains.length > 0, `expected >0 loaded domains, got ${domains.length}`);

    // Project is the SPECIFIC class ensureProjectAnchor mints
    assert.equal(
      registry.isValidClass('Project'),
      true,
      'Project must resolve via the loaded registry (ensureProjectAnchor unblock smoke)',
    );

    // Component — second canary class, matches registry-adoption.test.ts:88
    assert.equal(
      registry.isValidClass('Component'),
      true,
      'Component must resolve via the loaded registry (canary class)',
    );

    // Negative-case sanity — registry actually discriminates
    assert.equal(
      registry.isValidClass('NonExistentClassXyz123'),
      false,
      'NonExistentClassXyz123 must NOT resolve (registry is not trivially returning true)',
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
});
