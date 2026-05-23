/**
 * Unit tests for Phase 42 Plan 03 — adopting km-core's OntologyRegistry
 * in place of B's deleted OntologyManager.
 *
 * RED gate:
 *   This file is added before OntologyManager.ts is removed and the two
 *   callers (ontology-classification-agent.ts + tools.ts) are rewired.
 *   The tests assert the post-state.
 *
 * GREEN gate:
 *   After Task 2 lands the rewire + the new LegacyOntologyAdapter, all 5
 *   behavior assertions pass and the build is clean.
 *
 * Run via: `npm run build && node --test dist/ontology/registry-adoption.test.js`
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo-root + the flattened ontology directory.
// `dirname(__filename)` at test runtime resolves under dist/ontology/.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Walk up 3 levels: dist/ontology -> dist -> mcp-server-semantic-analysis ->
// integrations -> coding. Plus `.data/ontologies`.
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ONTOLOGY_DIR = join(REPO_ROOT, '.data', 'ontologies');

// `src/` resolves to the on-disk source tree (not the compiled dist/).
const SRC_DIR = resolve(__dirname, '..', '..', 'src');

describe('Phase 42 Plan 03 — registry adoption', () => {
  // Test 1: zero `import.*OntologyManager` matches across src/
  it('Test 1: no `import.*OntologyManager` references remain in src/', () => {
    const matches = grepDir(SRC_DIR, /^.*import.*OntologyManager.*$/m);
    assert.deepEqual(
      matches,
      [],
      `expected ZERO import statements referencing OntologyManager, got: ${JSON.stringify(matches, null, 2)}`,
    );
  });

  // Test 2: zero `new OntologyManager(...)` instantiations
  it('Test 2: no `new OntologyManager` constructor calls remain in src/', () => {
    const matches = grepDir(SRC_DIR, /new\s+OntologyManager\b/);
    assert.deepEqual(
      matches,
      [],
      'expected ZERO `new OntologyManager` calls, got: ' + JSON.stringify(matches, null, 2),
    );
  });

  // Test 3: new km-core registry instantiation in ontology-classification-agent.ts
  // uses an absolute path matching the Docker bind-mount layout (/coding/.data/ontologies)
  // OR resolves the host path at runtime via process.env / process.cwd.
  it('Test 3: ontology-classification-agent.ts wires `OntologyRegistry` to a Docker-internal ontology dir', () => {
    const path = join(SRC_DIR, 'agents', 'ontology-classification-agent.ts');
    const source = readFileSync(path, 'utf8');
    assert.match(
      source,
      /OntologyRegistry/,
      'expected the agent to reference OntologyRegistry',
    );
    // The agent must wire an ontologyDir that points at the flattened layout.
    // Accept either a literal '/coding/.data/ontologies' (Docker bind-mount) or
    // a runtime-resolved path that joins '.data/ontologies' (host-side run).
    const wiresDir =
      source.includes('/coding/.data/ontologies') ||
      source.includes(".data/ontologies");
    assert.ok(
      wiresDir,
      'expected the agent to wire ontologyDir at .data/ontologies (Docker absolute or host-relative)',
    );
  });

  // Test 4: km-core's `isValidClass` semantics replace OntologyManager's
  // `hasEntityClass` in the new adapter / agent path.
  it('Test 4: km-core registry surface (isValidClass) is exercised where hasEntityClass used to be', async () => {
    // Dynamic import — the registry sub-path resolves only at runtime inside
    // the container or when km-core is symlinked under node_modules.
    const m = await import('@fwornle/km-core');
    const registry = new m.OntologyRegistry({ ontologyDir: ONTOLOGY_DIR });
    assert.equal(typeof registry.isValidClass, 'function');
    // The flattened layout has Component declared in coding-ontology.json.
    assert.equal(registry.isValidClass('Component'), true);
    // A class that is not in any ontology must return false.
    assert.equal(registry.isValidClass('NonExistentClassXyz123'), false);
  });

  // Test 5: the registry loads the 8 flattened ontology JSONs, finds Component
  // (declared in coding-ontology.json) and Detail (added in Task 1 per D-53b),
  // and reports >= 8 loaded domains (upper + 7 lowers).
  it('Test 5: km-core registry loads 8 flattened files and resolves Component + Detail', async () => {
    const m = await import('@fwornle/km-core');
    const registry = new m.OntologyRegistry({ ontologyDir: ONTOLOGY_DIR });

    // Sanity check the directory contents — exactly 8 *.json at the root.
    const files = readdirSync(ONTOLOGY_DIR).filter((f) => f.endsWith('.json'));
    assert.equal(
      files.length,
      8,
      `expected 8 flattened ontology JSONs at root, found ${files.length}: ${files.join(', ')}`,
    );

    // hasClass semantics (km-core named isValidClass): verify Component +
    // Detail both resolve.
    assert.equal(registry.isValidClass('Component'), true, 'Component must be valid');
    assert.equal(registry.isValidClass('Detail'), true, 'Detail must be valid (D-53b)');

    // Domain count: upper + 7 lowers (8 distinct domains, agentic/cluster/code/
    // coding/raas/resi/ui + upper).
    const domains = registry.getLoadedDomains();
    assert.ok(
      domains.length >= 8,
      `expected ≥ 8 loaded domains, got ${domains.length}: ${domains.join(', ')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Tiny grep helper — walks the src/ tree and returns matches.
// ---------------------------------------------------------------------------

function grepDir(root: string, pattern: RegExp): string[] {
  const out: string[] = [];
  walk(root, (file) => {
    if (!file.endsWith('.ts')) return;
    if (file.endsWith('.test.ts')) return; // tests describe the absence; don't self-match
    const content = readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      if (pattern.test(line)) {
        out.push(`${file}: ${line.trim()}`);
      }
    }
  });
  return out;
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else if (st.isFile()) visit(full);
  }
}
