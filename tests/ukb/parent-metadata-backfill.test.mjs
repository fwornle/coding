/**
 * Contract for scripts/backfill-parent-metadata.mjs.
 *
 * The script repairs rows whose `metadata.parentEntityName` was erased by the
 * shallow-merge clobber (km-core putEntity ends in graph.mergeNode, so a
 * partial metadata object replaced the stored one wholesale; wave 4's insight
 * stamp passed only two keys and wiped the rest).
 *
 * Two things here are easy to get wrong and expensive to get wrong silently,
 * so they are pinned by source-grep rather than left to review:
 *
 *  1. LEVEL NUMBERING. Two vocabularies exist — the viewer's display depth
 *     (System 0, Project 1, Component 2, SubComponent 3, Detail 4) and the
 *     writer's hierarchy level (Project 0, Component 1, SubComponent 2,
 *     Detail 3). `metadata.hierarchyLevel` is the WRITER's, and
 *     `isScaffoldNode = level < 3` is derived from it. Writing the viewer's
 *     numbers would flip that flag on every repaired row.
 *
 *  2. THE PUT MUST SEND FULL METADATA. The repair lands in the same shallow
 *     mergeNode that caused the damage. A partial object would re-clobber.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(REPO, 'scripts/backfill-parent-metadata.mjs'), 'utf8');

describe('parent-metadata backfill — level numbering', () => {
  test('writes the WRITER hierarchy level, not the viewer display depth', () => {
    assert.match(SRC, /WRITER_LEVEL\s*=\s*\{\s*Project:\s*0,\s*Component:\s*1,\s*SubComponent:\s*2,\s*Detail:\s*3/);
  });

  test('keeps the viewer depth separate, for RANKING parents only', () => {
    // Both maps exist on purpose. The bug would be one map used for both jobs.
    assert.match(SRC, /VIEW_LEVEL\s*=\s*\{\s*System:\s*0,\s*Project:\s*1,\s*Component:\s*2/);
    assert.match(SRC, /hierarchyLevel: level/);
  });

  test('isScaffoldNode is derived from the writer level', () => {
    assert.match(SRC, /isScaffoldNode: level < 3/);
  });
});

describe('parent-metadata backfill — safety', () => {
  test('dry run is the DEFAULT; writing requires --apply', () => {
    assert.match(SRC, /const APPLY = process\.argv\.includes\('--apply'\)/);
    assert.match(SRC, /if \(!APPLY\)/);
  });

  test('refuses to write underneath a live wave-analysis run', () => {
    // obs-api owns the store single-writer and a run writes these same rows;
    // racing it is how a fresh clobber happens.
    assert.match(SRC, /REFUSING to apply/);
    assert.match(SRC, /st\?\.running/);
    assert.match(SRC, /process\.exit\(2\)/);
  });

  test('the PUT sends FULL metadata — a partial object would re-clobber', () => {
    assert.match(SRC, /\.\.\.md,/);
    assert.match(SRC, /body: JSON\.stringify\(\{ metadata: next \}\)/);
  });

  test('roots and online-path classes are never touched', () => {
    // Project/System have no parent by construction; Insight/Digest come from
    // the consolidator, which has no hierarchy notion at all.
    assert.match(SRC, /REPAIRABLE = new Set\(\['Component', 'SubComponent', 'Detail'\]\)/);
  });

  test('[Raw] placeholder rows are skipped — their repair is deletion', () => {
    assert.match(SRC, /startsWith\('\[Raw\]'\)/);
  });

  test('a self-edge cannot root a node in itself', () => {
    assert.match(SRC, /if \(from === to\) continue/);
  });

  test('rows with no parent edge are reported, not invented', () => {
    assert.match(SRC, /unrecoverable/);
    assert.match(SRC, /anchor-unstructured-entities\.mjs --apply/);
  });
});

describe('parent-metadata backfill — parent choice mirrors the viewer', () => {
  test('uses the same parent edge types and ranking as hierarchy-parents.ts', () => {
    const viewer = readFileSync(
      path.join(REPO, 'integrations/unified-viewer/src/graph/hierarchy-parents.ts'),
      'utf8',
    );
    for (const t of ['parent-child', 'contains', 'includes']) {
      assert.ok(viewer.includes(t), `viewer ranks ${t}`);
      assert.ok(SRC.includes(t), `backfill ranks ${t}`);
    }
    // The tie-break that makes a one-level-up parent win.
    assert.match(SRC, /pLevel === cLevel - 1 \? 0 : 1/);
    assert.match(viewer, /pLevel === cLevel - 1 \? 0 : 1/);
  });
});
