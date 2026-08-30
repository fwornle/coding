/**
 * Which ladder rungs get folded away, and where the survivors sit.
 *
 * This is geometry, but it is geometry two components have to agree on: the
 * ladder draws these rows and the flow diagram lands every caller's edge on
 * them. If they disagree the diagram still renders — the edges just point at the
 * rows the gates used to occupy, and nothing reports it. Hence a pure module
 * with its own tests rather than state inside the renderer.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SRC = path.join(ROOT, 'integrations/system-health-dashboard/src/components/llm-routing');

/** Same transpile-into-one-dir trick as recent-call-selection; see the note there. */
const m = await (async () => {
  const esbuild = require(path.join(ROOT, 'integrations/system-health-dashboard/node_modules/esbuild'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-'));
  for (const name of ['offload-gates', 'ladder-layout']) {
    const ts = fs.readFileSync(path.join(SRC, `${name}.ts`), 'utf8');
    const { code } = esbuild.transformSync(ts, { loader: 'ts', format: 'esm' });
    fs.writeFileSync(path.join(dir, `${name}.mjs`),
      code.replace(/(['"])\.\/offload-gates\1/g, '"./offload-gates.mjs"'));
  }
  return import(path.join(dir, 'ladder-layout.mjs'));
})();

const GATE_COUNT = 7;
const PASS = 6;

/** Rung counts as an array; anything unlisted is zero. */
const counts = (over = {}) =>
  Array.from({ length: GATE_COUNT }, (_, i) => ({ count: over[i] ?? 0 }));

/** Every rung index the layout gives its own row to. */
const ownRows = (l) => l.rows.filter(r => r.kind === 'rung').flatMap(r => r.rungs);
const folds = (l) => l.rows.filter(r => r.kind === 'collapsed');

describe('folding', () => {
  test('the live configuration folds its two dead runs and keeps the rest', () => {
    // Rungs 1/2/3 carry the traffic; 0 stands alone at zero and 4/5 are a run.
    const l = m.layoutLadder(counts({ 1: 3, 2: 19, 3: 17 }));
    assert.deepEqual(folds(l).map(r => r.rungs), [[4, 5]]);
    assert.deepEqual(ownRows(l), [0, 1, 2, 3, 6]);
  });

  test('a run of one is never folded — it would save no height at all', () => {
    // "1 gate nothing reached" is the same row as the gate, so folding trades a
    // real label for a placeholder. Dimming already says "nothing reached this".
    const l = m.layoutLadder(counts({ 1: 5, 3: 5, 5: 5 }));
    assert.deepEqual(folds(l), []);
    assert.deepEqual(ownRows(l), [0, 1, 2, 3, 4, 5, 6]);
  });

  test('the PASS rung is never folded, even at zero — it is the answer', () => {
    // "offloaded to the local target — 0 routes" IS the finding whenever the
    // offload is misconfigured. Folding it hides the state the card exists for.
    const l = m.layoutLadder(counts({}));
    const passRow = l.rows.find(r => r.kind === 'rung' && r.rungs[0] === PASS);
    assert.ok(passRow, 'the outcome row must survive an all-zero ladder');
    assert.deepEqual(folds(l).map(r => r.rungs), [[0, 1, 2, 3, 4, 5]],
      'every GATE folds into one run, and the outcome is not one of them');
  });

  test('a pinned rung keeps its own row at zero, and splits the run around it', () => {
    // The scrubber pins the rung a selected call stopped at. Folding it would
    // leave the highlight pointing at a row that is not on screen.
    const l = m.layoutLadder(counts({}), { pinned: [3] });
    assert.ok(ownRows(l).includes(3));
    assert.deepEqual(folds(l).map(r => r.rungs), [[0, 1, 2], [4, 5]]);
  });

  test('pinning splits a run rather than suppressing folding entirely', () => {
    const l = m.layoutLadder(counts({}), { pinned: [1] });
    // 0 is left alone and so stays a rung; 2..5 remain foldable as one run.
    assert.deepEqual(folds(l).map(r => r.rungs), [[2, 3, 4, 5]]);
    assert.deepEqual(ownRows(l), [0, 1, 6]);
  });
});

describe('folding against a different denominator', () => {
  test('a zero-count gate with callers arriving stays visible when pinned', () => {
    // The Recorded-mode case. Counts are CALLS; the caller column is CONFIG. A
    // gate can read 0 calls and still have routes arriving — `offload: false`
    // pins three of them whether or not any was called in the window. The flow
    // diagram pins every rung its callers land on for exactly this reason.
    const l = m.layoutLadder(counts({ 2: 400 }), { pinned: [1, 2, 3] });
    assert.deepEqual(ownRows(l), [0, 1, 2, 3, 6]);
    assert.deepEqual(folds(l).map(r => r.rungs), [[4, 5]]);
    for (const r of [1, 3]) {
      assert.equal(l.isFolded(r), false, `gate ${r} has edges arriving and must keep its row`);
    }
  });
});

describe('expanding', () => {
  test('an opened run shows its gates plus a header that closes it again', () => {
    const l = m.layoutLadder(counts({ 1: 3, 2: 19, 3: 17 }), { expanded: [4] });
    assert.deepEqual(folds(l), [], 'nothing stays folded once opened');
    assert.deepEqual(ownRows(l), [0, 1, 2, 3, 4, 5, 6]);
    const header = l.rows.find(r => r.kind === 'expanded-header');
    assert.deepEqual(header.rungs, [4, 5]);
    assert.equal(header.runId, 4, 'a run is keyed by its first rung, so the toggle round-trips');
  });

  test('expanding an id that names no run changes nothing', () => {
    const base = m.layoutLadder(counts({ 1: 3 }));
    const odd = m.layoutLadder(counts({ 1: 3 }), { expanded: [99] });
    assert.deepEqual(odd.rows, base.rows);
  });
});

describe('geometry', () => {
  test('rows tile without gap or overlap, and height covers them all', () => {
    const l = m.layoutLadder(counts({ 2: 19 }));
    let cursor = m.LADDER_HEADER;
    for (const row of l.rows) {
      assert.equal(row.top, cursor, `row ${JSON.stringify(row.rungs)} must abut the previous one`);
      cursor += row.height;
    }
    assert.equal(l.height, cursor + 8);
  });

  test('folding makes the ladder shorter, expanding makes it taller again', () => {
    const all = m.layoutLadder(counts({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }));
    const folded = m.layoutLadder(counts({ 1: 3, 2: 19, 3: 17 }));
    const opened = m.layoutLadder(counts({ 1: 3, 2: 19, 3: 17 }), { expanded: [4] });
    assert.ok(folded.height < all.height, 'a fold must actually reclaim height');
    assert.ok(opened.height > folded.height, 'opening must give it back');
    assert.equal(opened.height, all.height + 16, 'plus exactly the close-header row');
  });

  test('a folded gate resolves to the fold, so its edge lands on a row that exists', () => {
    // The failure this prevents: an edge drawn to where the gate WOULD have been.
    const l = m.layoutLadder(counts({ 1: 3, 2: 19, 3: 17 }));
    const fold = folds(l)[0];
    assert.equal(l.isFolded(4), true);
    assert.equal(l.isFolded(5), true);
    assert.equal(l.centerFor(4), fold.top + fold.height / 2);
    assert.equal(l.centerFor(5), l.centerFor(4), 'both gates in a fold share its row');
  });

  test('every gate resolves to a finite y in every folding state', () => {
    for (const opts of [{}, { pinned: [3] }, { expanded: [0] }, { expanded: [4] }]) {
      const l = m.layoutLadder(counts({ 1: 3 }), opts);
      for (let i = 0; i < GATE_COUNT; i++) {
        const y = l.centerFor(i);
        assert.ok(Number.isFinite(y) && y > 0, `gate ${i} must have a real y under ${JSON.stringify(opts)}`);
        assert.ok(y < l.height, `gate ${i} must sit inside the ladder`);
      }
    }
  });
});
