/**
 * The Features tab map (integrations/system-health-dashboard/src/components/
 * features/feature-map.tsx) is hand-placed. A feature the catalogue gains later
 * is still offered there (listed under the drawing, fail-open), but it is not
 * drawn, so this test fails the build until the map places it, gives it a
 * family and draws its dependency edges.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FEATURES, FEATURE_IDS } = require('../../lib/features/catalogue.cjs');
const MAP = new URL('../../integrations/system-health-dashboard/src/components/features/feature-map.tsx', import.meta.url);
const src = readFileSync(MAP, 'utf8');

/** The object literal assigned to `const <name>`, up to its closing line. */
function block(name) {
  const start = src.indexOf(`const ${name}`);
  assert.ok(start >= 0, `feature-map.tsx has no const ${name}`);
  const end = src.indexOf('\n}', start);
  const endArr = src.indexOf('\n]', start);
  return src.slice(start, Math.min(...[end, endArr].filter((i) => i > 0)));
}

const key = (id) => new RegExp(`(^|[\\s{,])'?${id}'?\\s*:`, 'm');

test('every catalogue feature has a position and a short label on the map', () => {
  const pos = block('POS');
  const short = block('SHORT');
  for (const id of FEATURE_IDS) {
    assert.match(pos, key(id), `${id} has no position in POS`);
    assert.match(short, key(id), `${id} has no label in SHORT`);
  }
});

test('every catalogue feature belongs to exactly one family', () => {
  const families = block('FAMILIES');
  for (const id of FEATURE_IDS) {
    const hits = families.match(new RegExp(`'${id}'`, 'g')) || [];
    assert.equal(hits.length, 1, `${id} appears in ${hits.length} families`);
  }
});

test('every catalogue dependency is drawn as an edge', () => {
  const edges = block('REQUIRES_EDGES');
  for (const id of FEATURE_IDS) {
    for (const dep of FEATURES[id].requires) {
      assert.match(edges, new RegExp(`from: '${dep}', to: '${id}'`), `${dep} → ${id} is not drawn`);
    }
  }
});
