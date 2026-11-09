/**
 * The agent-box access diagram (docs + overview deck) and the table on the
 * Agent Box page come from ONE list, scripts/render-agent-box-access-svg.mjs.
 * Both committed outputs must be what that list renders — edit the list and
 * re-run the script, never the SVG or the table by hand.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, withTable, ROWS, KINDS } from '../../scripts/render-agent-box-access-svg.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

describe('agent-box access diagram', () => {
  test('the committed SVG is what the rows render', () => {
    assert.equal(read('docs-content/images/agent-box-access.svg'), render(),
      'run: node scripts/render-agent-box-access-svg.mjs');
  });

  test('the Agent Box page table is what the rows render', () => {
    const doc = read('docs-content/core-systems/agent-box.md');
    assert.equal(withTable(doc), doc, 'run: node scripts/render-agent-box-access-svg.mjs');
  });

  test('every row uses a known kind', () => {
    for (const r of ROWS) if (typeof r !== 'string') assert.ok(KINDS[r[0]], `${r[1]}: unknown kind ${r[0]}`);
  });

  test('both the docs page and the overview deck show it', () => {
    assert.match(read('docs-content/core-systems/agent-box.md'), /\(\.\.\/images\/agent-box-access\.svg\)/);
    assert.match(read('docs-content/overview.md'), /\(images\/agent-box-access\.svg\)/);
  });
});
