/**
 * Contract for the dedupe-entities maintenance endpoint.
 *
 * Repairs the duplicate nodes left by the pre-ff144c4 adapter, which minted a
 * new node on every storeEntity call while storeRelationship resolved edges by
 * name — so each run's nodes were born edgeless. 72 groups / 156 duplicates on
 * 2026-09-07.
 *
 * These assertions pin the two defaults that make the endpoint safe to call.
 * The first dry run over EVERY entity type proposed merging 20 distinct
 * observations that shared the title "Intent: Load and summarize recent
 * session logs" — for an Observation, Digest or Insight the name is a title,
 * not an identity, and merging them would have destroyed data.
 *
 * Runner: node --test tests/ukb/dedupe-entities.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const obsApi = readFileSync(path.join(REPO_ROOT, 'scripts', 'observations-api-server.mjs'), 'utf8');

// Slice from the handler to the next route registration. Do NOT bound this on
// a route name — the file's header comment lists the routes too, so an
// indexOf on one silently produces an inverted (empty) slice.
const start = obsApi.indexOf("app.post('/api/maintenance/dedupe-entities'");
const next = obsApi.indexOf('\napp.', start + 1);
const endpoint = start === -1 ? '' : obsApi.slice(start, next === -1 ? undefined : next);

describe('dedupe-entities defaults are the safe ones', () => {
  test('the endpoint exists on the store owner', () => {
    // Single-owner-rw: only obs-api holds the lock, so the merge runs here.
    assert.ok(endpoint.length > 0, 'endpoint not found');
    assert.match(endpoint, /await ensureKMStore\(\)/);
  });

  test('dryRun defaults to TRUE — the caller must ask for the write', () => {
    assert.match(endpoint, /const dryRun = req\.body\?\.dryRun !== false;/);
  });

  test('only hierarchy types are swept unless explicitly overridden', () => {
    // Observation/Digest/Insight names are titles; merging by name destroys data.
    assert.match(endpoint, /new Set\(\['Project', 'Component', 'SubComponent', 'Detail'\]\)/);
  });

  test('an explicit entityTypes list can still opt in', () => {
    assert.match(endpoint, /Array\.isArray\(req\.body\?\.entityTypes\)/);
  });

  test('the survivor rule is oldest-wins, matching the adapter resolver', () => {
    // km-core-adapter.findEntityByName binds writes to the oldest node; if the
    // merge picked a different survivor, later writes would land elsewhere.
    assert.match(endpoint, /if \(at !== bt\) return at < bt \? -1 : 1;/);
    assert.match(endpoint, /return String\(a\.id\) < String\(b\.id\) \? -1 : 1;/);
  });

  test('it merges via km-core\'s primitive rather than hand-rolling edge rewiring', () => {
    assert.match(endpoint, /await mergeEntities\(store, g\.survivorId, g\.duplicateIds/);
    assert.match(obsApi, /^\s*mergeEntities,$/m);
  });

  test('a per-group failure does not abandon the sweep', () => {
    // WR-02 (duplicate already superseded) is a per-group condition.
    assert.match(endpoint, /already has a successor/);
    assert.match(endpoint, /skipped\.push/);
    assert.match(endpoint, /errors\.push/);
  });

  test('superseded nodes are not re-merged', () => {
    // store.iterate() without includeSuperseded skips closed duplicates —
    // merging one again would trip the single-successor invariant.
    assert.match(endpoint, /for await \(const e of store\.iterate\(\)\)/);
    assert.doesNotMatch(endpoint, /includeSuperseded/);
  });
});
