/**
 * Unit tests for src/ontology/ontologyPathResolver.ts (Phase 42.1.1 Plan 01 — Task 1)
 *
 * RED gate:
 *   Tests added before ontologyPathResolver.ts implementation. Compile + run MUST
 *   fail until Task 1's GREEN implementation lands.
 *
 * GREEN gate:
 *   After ontologyPathResolver.ts is created, every test below passes.
 *
 * Run from the symlinked submodule (where the TS sources are compiled into dist/):
 *   cd integrations/mcp-server-semantic-analysis && npm run build && \
 *     node --test dist/ontology/ontologyPathResolver.test.js
 *
 * The repo-root walk MUST be FOUR `..` segments because compiled tests live at
 * `integrations/mcp-server-semantic-analysis/dist/ontology/<file>.test.js`:
 *   dist/ontology -> dist -> mcp-server-semantic-analysis -> integrations -> coding
 * Two segments resolves to `dist/.data/ontologies` which does not exist (Phase 42.1.1
 * forensic-report lesson; replicates `registry-adoption.test.ts:29`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveOntologyPath,
  OntologyPathNotFoundError,
  __resetProbeCounter,
  __getProbeCount,
} from './ontologyPathResolver.js';

// ---------------------------------------------------------------------------
// Repo-root walk — FOUR `..` segments (sanity gate enforced inside Test 6).
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ONTOLOGY_DIR = join(REPO_ROOT, '.data', 'ontologies');

// ---------------------------------------------------------------------------
// Fixture helpers — each test builds its own tmpdir so there is no shared state.
// ---------------------------------------------------------------------------
function newFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ont-resolver-'));
  // Resolver expects to find the `.data/ontologies` ancestor — create the full
  // shape so the ancestor walk works for `configHint`-based probes.
  const ontologyDir = join(dir, '.data', 'ontologies');
  mkdirSync(ontologyDir, { recursive: true });
  return ontologyDir;
}

function writeOntology(dir: string, file: string, body: object = {}): string {
  const full = join(dir, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(body));
  return full;
}

describe('Phase 42.1.1 Plan 01 Task 1 — ontologyPathResolver', () => {
  // -------------------------------------------------------------------------
  // Test 1: flat-only, alias upper.json
  // -------------------------------------------------------------------------
  it('Test 1: kind=upper, flat-only dir with only upper.json -> alias=upper.json', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'upper.json');
    const basePath = resolve(fixture, '..', '..');
    const result = resolveOntologyPath({ kind: 'upper', basePath });
    assert.equal(result.resolvedPath, join(fixture, 'upper.json'));
    assert.equal(result.layout, 'flat');
    assert.equal(result.alias, 'upper.json');
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 2: flat-only, canonical filename
  // -------------------------------------------------------------------------
  it('Test 2: kind=upper, flat-only dir with development-knowledge-ontology.json -> alias=canonical', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'development-knowledge-ontology.json');
    const basePath = resolve(fixture, '..', '..');
    const result = resolveOntologyPath({ kind: 'upper', basePath });
    assert.equal(
      result.resolvedPath,
      join(fixture, 'development-knowledge-ontology.json'),
    );
    assert.equal(result.layout, 'flat');
    assert.equal(result.alias, 'canonical');
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 3: two-tier upper
  // -------------------------------------------------------------------------
  it('Test 3: kind=upper, two-tier dir with upper/development-knowledge-ontology.json -> layout=two-tier', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'upper/development-knowledge-ontology.json');
    const basePath = resolve(fixture, '..', '..');
    const result = resolveOntologyPath({ kind: 'upper', basePath });
    assert.equal(
      result.resolvedPath,
      join(fixture, 'upper', 'development-knowledge-ontology.json'),
    );
    assert.equal(result.layout, 'two-tier');
    assert.equal(result.alias, 'canonical');
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 4: flat lower
  // -------------------------------------------------------------------------
  it('Test 4: kind=lower team=coding, flat coding-ontology.json -> layout=flat', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'coding-ontology.json');
    const basePath = resolve(fixture, '..', '..');
    const result = resolveOntologyPath({ kind: 'lower', team: 'coding', basePath });
    assert.equal(result.resolvedPath, join(fixture, 'coding-ontology.json'));
    assert.equal(result.layout, 'flat');
    assert.equal(result.alias, 'canonical');
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 5: two-tier lower
  // -------------------------------------------------------------------------
  it('Test 5: kind=lower team=coding, two-tier lower/coding-ontology.json -> layout=two-tier', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'lower/coding-ontology.json');
    const basePath = resolve(fixture, '..', '..');
    const result = resolveOntologyPath({ kind: 'lower', team: 'coding', basePath });
    assert.equal(
      result.resolvedPath,
      join(fixture, 'lower', 'coding-ontology.json'),
    );
    assert.equal(result.layout, 'two-tier');
    assert.equal(result.alias, 'canonical');
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 6: real on-disk iteration across every current team
  //
  // SANITY GATE: assert basename === 'ontologies' AND upper.json AND
  // coding-ontology.json exist BEFORE iterating. A 2-vs-4 segment walk
  // regression resolves to dist/.data/ontologies which does not exist —
  // without this gate, the test silently passes on an empty directory.
  // -------------------------------------------------------------------------
  it('Test 6: real .data/ontologies/ — every team currently on disk resolves to an existing file', () => {
    // Sanity gate
    assert.equal(
      basename(ONTOLOGY_DIR),
      'ontologies',
      `expected ONTOLOGY_DIR basename === 'ontologies', got '${basename(ONTOLOGY_DIR)}' (path: ${ONTOLOGY_DIR})`,
    );
    assert.ok(
      existsSync(join(ONTOLOGY_DIR, 'upper.json')),
      `sanity-gate: upper.json must exist in ${ONTOLOGY_DIR}`,
    );
    assert.ok(
      existsSync(join(ONTOLOGY_DIR, 'coding-ontology.json')),
      `sanity-gate: coding-ontology.json must exist in ${ONTOLOGY_DIR}`,
    );

    // Upper resolves (via upper.json alias on the real flat layout).
    const upper = resolveOntologyPath({ kind: 'upper', basePath: REPO_ROOT });
    assert.ok(
      existsSync(upper.resolvedPath),
      `upper.resolvedPath must exist on disk: ${upper.resolvedPath}`,
    );
    assert.equal(upper.layout, 'flat');

    // Every team currently in .data/ontologies/ resolves.
    const TEAMS = [
      'agentic',
      'cluster-reprocessing',
      'code-entities',
      'coding',
      'raas',
      'resi',
      'ui',
    ];
    for (const team of TEAMS) {
      const result = resolveOntologyPath({ kind: 'lower', team, basePath: REPO_ROOT });
      assert.ok(
        existsSync(result.resolvedPath),
        `team=${team} resolvedPath must exist on disk: ${result.resolvedPath}`,
      );
      assert.equal(result.layout, 'flat');
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: upper miss -> error lists every probed alias
  // -------------------------------------------------------------------------
  it('Test 7: kind=upper miss -> OntologyPathNotFoundError message lists all 3 probed paths', () => {
    const fixture = newFixture();
    const basePath = resolve(fixture, '..', '..');
    let threw: Error | null = null;
    try {
      resolveOntologyPath({ kind: 'upper', basePath });
    } catch (err) {
      threw = err as Error;
    }
    assert.ok(threw, 'expected resolveOntologyPath to throw');
    assert.ok(threw instanceof OntologyPathNotFoundError, 'must be OntologyPathNotFoundError');
    assert.match(threw!.message, /Probed paths:/);
    assert.match(threw!.message, /upper\/development-knowledge-ontology\.json/);
    assert.match(threw!.message, /development-knowledge-ontology\.json/);
    assert.match(threw!.message, /upper\.json/);
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 8: lower miss for unknown team -> error lists both alias paths
  // -------------------------------------------------------------------------
  it('Test 8: kind=lower team=nonexistent-team miss -> error lists both lower aliases', () => {
    const fixture = newFixture();
    const basePath = resolve(fixture, '..', '..');
    let threw: Error | null = null;
    try {
      resolveOntologyPath({ kind: 'lower', team: 'nonexistent-team', basePath });
    } catch (err) {
      threw = err as Error;
    }
    assert.ok(threw, 'expected resolveOntologyPath to throw');
    assert.ok(threw instanceof OntologyPathNotFoundError, 'must be OntologyPathNotFoundError');
    assert.match(threw!.message, /Probed paths:/);
    assert.match(threw!.message, /lower\/nonexistent-team-ontology\.json/);
    assert.match(threw!.message, /nonexistent-team-ontology\.json/);
    rmSync(basePath, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Test 9: cache-hit semantics via the probe counter
  // -------------------------------------------------------------------------
  it('Test 9: cache hit — second call adds zero new probes', () => {
    const fixture = newFixture();
    writeOntology(fixture, 'upper.json');
    const basePath = resolve(fixture, '..', '..');

    __resetProbeCounter();
    const first = resolveOntologyPath({ kind: 'upper', basePath });
    assert.ok(first.resolvedPath.endsWith('/upper.json'), 'first call must resolve to upper.json');
    const n1 = __getProbeCount();
    assert.ok(n1 >= 1, `expected n1 >= 1 (at least one probe), got ${n1}`);

    const second = resolveOntologyPath({ kind: 'upper', basePath });
    assert.equal(second.resolvedPath, first.resolvedPath, 'second call must return identical path');
    assert.equal(
      __getProbeCount(),
      n1,
      `expected cache hit (probe count unchanged at ${n1}), got ${__getProbeCount()}`,
    );

    rmSync(basePath, { recursive: true, force: true });
  });
});
