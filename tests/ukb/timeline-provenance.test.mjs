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
const learningSource = readFileSync(
  path.join(REPO_ROOT, 'integrations', 'unified-viewer', 'src', 'graph', 'learning-source.ts'),
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

  /**
   * Both surfaces must agree, or a node reads blue in the graph and pink on the
   * timeline for the same run. This used to be asserted by pinning the literal
   * `const isOnline = source === 'auto' || source === 'online'` inside
   * color-fallback.ts — which stopped being true, and rightly so: that check was
   * measured leaving 138 online-learned entities in the blue batch palette,
   * because the writers stamp 'online' far more often than 'auto' and 82 ETM
   * records stamp no source at all. The rule moved into graph/learning-source.ts
   * and grew the subsystem and digest-shape fallbacks that population needs.
   *
   * So the pin moved with it, and split in two. Naming the set where it is now
   * defined is the weaker half; the half that actually buys the guarantee is the
   * second test — a regex over one surface can pass while another surface
   * quietly re-derives the rule and disagrees, which is the exact failure this
   * suite exists to catch. One shared classifier cannot disagree with itself.
   */
  test('the online-learned source set is named in the shared classifier', () => {
    assert.match(
      learningSource,
      /const ONLINE_SOURCES: ReadonlySet<string> = new Set\(\['auto', 'online'\]\)/,
    );
    assert.match(learningSource, /export function isOnlineLearned\b/);
  });

  test('the graph delegates to that classifier instead of re-deriving it', () => {
    assert.match(colorFallback, /import \{ isOnlineLearned \} from '\.\/learning-source'/);
    assert.match(colorFallback, /isOnlineLearned\(/);
    // The re-derivation this suite was written to prevent. `isOnlineSource` is
    // allowed to take a bare string, but it must forward to the shared rule
    // rather than compare against 'auto' itself.
    assert.doesNotMatch(colorFallback, /source === 'auto'/);
  });
});
