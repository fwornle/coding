/**
 * Re-labelling observations: the cold-store pass (scripts/lib/observation-relabel.mjs)
 * and the CLI's plan (scripts/relabel-observations.mjs).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { relabelColdStore, pruneColdStore, validRelabelProject } from '../../scripts/lib/observation-relabel.mjs';
import { planRelabel } from '../../scripts/relabel-observations.mjs';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'relabel-')); }
const write = (dir, name, rows) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), JSON.stringify(rows)); };
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));

describe('relabelColdStore', () => {
  test('re-labels the matching rows in all three combined files, nothing else', () => {
    const d = tmp();
    write(d, 'observations.json', [{ id: 'o1', project: 'memory' }, { id: 'o2', project: 'glass' }]);
    write(d, 'digests.json', [{ id: 'd1', project: 'memory' }]);
    const r = relabelColdStore({ exportDir: d, ids: new Set(['o1', 'd1', 'nope']), project: 'coding' });
    assert.equal(r.relabelled, 2);
    assert.deepEqual(r.previous, { memory: 2 });
    assert.deepEqual([...r.ids].sort(), ['d1', 'o1']);
    assert.deepEqual(read(d, 'observations.json').map((x) => x.project), ['coding', 'glass']);
    assert.equal(read(d, 'digests.json')[0].project, 'coding');
  });

  test('a moved row leaves other projects\' slices (they union-merge, so it would stay), not the target\'s', () => {
    const d = tmp();
    const glass = path.join(d, 'glass');
    const coding = path.join(d, 'coding');
    write(d, 'observations.json', [{ id: 'o1', project: 'glass' }]);
    write(glass, 'observations.json', [{ id: 'o1', project: 'glass' }, { id: 'o9', project: 'glass' }]);
    write(coding, 'observations.json', [{ id: 'o1', project: 'coding' }]);
    const r = relabelColdStore({
      exportDir: d, ids: new Set(['o1']), project: 'coding',
      slices: [{ project: 'glass', dir: glass }, { project: 'coding', dir: coding }],
    });
    assert.equal(r.slicePruned, 1);
    assert.deepEqual(read(glass, 'observations.json').map((x) => x.id), ['o9']);
    assert.deepEqual(read(coding, 'observations.json').map((x) => x.id), ['o1']);
  });

  test('dryRun counts but writes nothing', () => {
    const d = tmp();
    write(d, 'observations.json', [{ id: 'o1', project: 'memory' }]);
    const r = relabelColdStore({ exportDir: d, ids: new Set(['o1']), project: 'coding', dryRun: true });
    assert.equal(r.relabelled, 1);
    assert.equal(read(d, 'observations.json')[0].project, 'memory');
  });
});

describe('validRelabelProject', () => {
  test('accepts repo slugs, rejects the learning checkout and junk', () => {
    assert.equal(validRelabelProject('a2a-xpr'), true);
    assert.equal(validRelabelProject('WiMa'), true);
    assert.equal(validRelabelProject('.coding'), false);
    assert.equal(validRelabelProject('../x'), false);
    assert.equal(validRelabelProject(''), false);
    assert.equal(validRelabelProject(null), false);
  });
});

describe('planRelabel', () => {
  test('--set wins over --move; rows already right are skipped', () => {
    const rows = [
      { id: 'a', project: 'memory' },
      { id: 'b', project: 'memory' },
      { id: 'c', project: 'coding' },
      { id: 'd', project: 'history' },
    ];
    const plan = planRelabel(rows, new Map([['memory', 'coding']]), new Map([['b', 'glass'], ['c', 'coding']]));
    assert.deepEqual(plan.map((p) => `${p.id}:${p.to}`), ['a:coding', 'b:glass']);
  });
});

describe('pruneColdStore', () => {
  test('deletes a digest id too, from the combined files and every slice; reports what it found', () => {
    const d = tmp();
    const s = tmp();
    write(d, 'observations.json', [{ id: 'o1' }, { id: 'o2' }]);
    write(d, 'digests.json', [{ id: 'g1', observationIds: ['gone'] }, { id: 'g2' }]);
    write(s, 'digests.json', [{ id: 'g1' }]);
    const r = pruneColdStore({ exportDir: d, slices: [{ project: 'coding', dir: s }], ids: new Set(['o1', 'g1', 'nope']) });
    assert.equal(r.pruned, 2);
    assert.equal(r.slicePruned, 1);
    assert.deepEqual([...r.ids].sort(), ['g1', 'o1']);
    assert.deepEqual(read(d, 'observations.json').map((x) => x.id), ['o2']);
    assert.deepEqual(read(d, 'digests.json').map((x) => x.id), ['g2']);
    assert.deepEqual(read(s, 'digests.json'), []);
  });

  test('a missing or unreadable file is skipped, not an error', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'insights.json'), '{not json');
    const r = pruneColdStore({ exportDir: d, slices: [{ project: 'x', dir: path.join(d, 'absent') }], ids: new Set(['a']) });
    assert.deepEqual({ pruned: r.pruned, slicePruned: r.slicePruned, n: r.ids.size }, { pruned: 0, slicePruned: 0, n: 0 });
  });
});
