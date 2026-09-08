/**
 * Contract for timeline provenance colouring (batch vs online).
 *
 * The bug: obs-api's /api/coding/lsl/sessions marked a window 'batch' only
 * when a matched entity carried metadata.source === 'manual'. The UKB batch
 * run stamps 'wave-analysis', so a window containing nothing but batch output
 * fell through to 'online' and the timeline strip painted it pink — reading as
 * auto-learned knowledge when it came from a batch run.
 *
 * The viewer's own contract already said what the rule should be
 * (useLslSessions.ts: "'batch' = any matched entity tagged manual/wave-analysis").
 *
 * Runner: node --test tests/ukb/timeline-provenance.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const obsApi = readFileSync(path.join(REPO_ROOT, 'scripts', 'observations-api-server.mjs'), 'utf8');
const viewerHook = readFileSync(
  path.join(REPO_ROOT, 'integrations', 'unified-viewer', 'src', 'panels', 'coding', 'useLslSessions.ts'),
  'utf8',
);
const colorFallback = readFileSync(
  path.join(REPO_ROOT, 'integrations', 'unified-viewer', 'src', 'graph', 'color-fallback.ts'),
  'utf8',
);

describe('timeline provenance', () => {
  test('wave-analysis counts as a BATCH writer', () => {
    assert.match(obsApi, /const BATCH_SOURCES = new Set\(\['manual', 'wave-analysis'\]\);/);
  });

  test('the session predicate uses the set, not a bare manual check', () => {
    assert.match(obsApi, /matches\.some\(\(m\) => BATCH_SOURCES\.has\(m\.source\)\) \? 'batch' : 'online'/);
    assert.doesNotMatch(obsApi, /matches\.some\(\(m\) => m\.source === 'manual'\)/);
  });

  test('the server matches the contract the viewer documents', () => {
    // useLslSessions.ts states the intended rule in prose; it was the server
    // that disagreed with it.
    assert.match(viewerHook, /'batch' = any matched entity tagged manual\/wave-analysis/);
  });

  test('the graph treats only auto/online as online-learned', () => {
    // Both surfaces must agree, or a node reads blue in the graph and pink on
    // the timeline for the same run.
    assert.match(colorFallback, /const isOnline = source === 'auto' \|\| source === 'online'/);
  });
});
