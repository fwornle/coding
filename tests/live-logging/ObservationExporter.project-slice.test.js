/**
 * ObservationExporter — the per-project slice in a learning checkout is
 * merged with what is already there, never replaced (T8).
 *
 * Found by the two-user simulation: user B cloned coding-history, started
 * obs-api, and the exporter rewrote `<repo>/.coding/kb/observation-export/`
 * from B's store alone — 6910 observations became 180. Hydrate reads only the
 * graph exports, so a teammate's rows (and the owner's history beyond
 * retention) are in the slice and nowhere in this store. The next commit and
 * push would have deleted them for everyone.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ObservationExporter } from '../../src/live-logging/ObservationExporter.js';

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-slice-')); });
afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

function fakeKmStore(entities) {
  const byId = new Map(entities.map((e) => [e.id, e]));
  return { graph: { nodes: () => [...byId.keys()], getNodeAttributes: (id) => byId.get(id) } };
}

const obs = (id, project = 'coding') => ({
  id,
  name: `Intent: ${id}`,
  entityType: 'Observation',
  ontologyClass: 'Observation',
  description: `Intent: work on ${id}.\nApproach: edit.\nArtifacts: a.js\nResult: done.`,
  createdAt: '2026-10-03T10:00:00.000Z',
  metadata: { agent: 'claude', project, quality: 'high', createdAt: '2026-10-03T10:00:00.000Z' },
});

function setup(entities, existingSlice) {
  const kbDir = path.join(tmpDir, 'repo', '.coding', 'kb');
  const sliceDir = path.join(kbDir, 'observation-export');
  fs.mkdirSync(sliceDir, { recursive: true });
  if (existingSlice) fs.writeFileSync(path.join(sliceDir, 'observations.json'), JSON.stringify(existingSlice, null, 2) + '\n');
  const exporter = new ObservationExporter({
    kmStore: fakeKmStore(entities),
    exportDir: path.join(tmpDir, 'data', 'observation-export'),
    projectKbDirs: () => ({ coding: { kbDir, kind: 'linked' } }),
  });
  const read = () => JSON.parse(fs.readFileSync(path.join(sliceDir, 'observations.json'), 'utf8'));
  return { exporter, read };
}

describe('ObservationExporter — per-project slice', () => {
  test('a teammate\'s rows in the slice survive an export from a store that lacks them', () => {
    const { exporter, read } = setup([obs('b-1')], [
      { id: 'a-1', summary: 'A learned this', project: 'coding' },
      { id: 'a-2', summary: 'and this', project: 'coding' },
    ]);
    exporter.exportAll();
    expect(read().map((r) => r.id).sort()).toEqual(['a-1', 'a-2', 'b-1']);
  });

  test('more rows in the store than in the slice is no evidence the store holds the slice\'s rows', () => {
    const { exporter, read } = setup([obs('b-1'), obs('b-2'), obs('b-3')], [{ id: 'a-1', summary: 'A', project: 'coding' }]);
    exporter.exportAll();
    expect(read().map((r) => r.id).sort()).toEqual(['a-1', 'b-1', 'b-2', 'b-3']);
  });

  test('only that project\'s rows are written, and an unchanged slice is not rewritten', () => {
    const { exporter, read } = setup([obs('b-1'), obs('x-1', 'other')], null);
    exporter.exportAll();
    expect(read().map((r) => r.id)).toEqual(['b-1']);
    const file = path.join(tmpDir, 'repo', '.coding', 'kb', 'observation-export', 'observations.json');
    const before = fs.statSync(file).mtimeMs;
    exporter.exportAll();
    expect(fs.statSync(file).mtimeMs).toBe(before);
  });
});
