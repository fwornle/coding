/**
 * Contract for the structural-anchor invariant and the health slice that
 * guards it.
 *
 * Background: "orphan" (degree 0) is not what an operator sees. `capturedBy`
 * and `mentions` are ~89% of this graph's edges and are hidden by default in
 * the viewer, so a row whose only edges are provenance is connected in the
 * data and a floating dot on screen. The header reported "orphans 14" over a
 * picture showing ~81 strays for exactly that reason.
 *
 * These tests pin the distinction — orphans and stranded counted SEPARATELY,
 * Observations exempt, project slug matching — because every one of those was
 * a bug that shipped before it was a rule.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  auditStructuralAnchors,
  auditParentMetadata,
  projectSlug,
  ANCHORED_CLASSES,
  HIERARCHY_CLASSES,
  STRUCTURAL_EDGE_TYPES,
} from '../../lib/knowledge/structural-anchors.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const ent = (id, ontologyClass, extra = {}) => ({ id, name: id, ontologyClass, ...extra });
const rel = (from, to, type) => ({ from, to, type });

describe('structural-anchor invariant', () => {
  test('a row anchored by a structural edge is not a violation', () => {
    const a = auditStructuralAnchors(
      [ent('p1', 'Project'), ent('i1', 'Insight')],
      [rel('p1', 'i1', 'has_insight')],
    );
    assert.equal(a.unanchored, 0);
  });

  test('provenance-only is a violation, counted as STRANDED not orphaned', () => {
    const a = auditStructuralAnchors(
      [ent('o1', 'Observation'), ent('i1', 'Insight')],
      [rel('i1', 'o1', 'capturedBy'), rel('i1', 'o1', 'mentions')],
    );
    assert.equal(a.unanchored, 1, 'the Insight violates the invariant');
    assert.equal(a.stranded, 1, 'it has edges, so it is stranded');
    assert.equal(a.orphans, 0, 'and is NOT an orphan — this is the distinction');
  });

  test('degree-0 is counted as an orphan, not stranded', () => {
    const a = auditStructuralAnchors([ent('i1', 'Insight')], []);
    assert.equal(a.orphans, 1);
    assert.equal(a.stranded, 0);
  });

  test('orphans + stranded always equals unanchored', () => {
    const a = auditStructuralAnchors(
      [ent('i1', 'Insight'), ent('i2', 'Insight'), ent('o1', 'Observation'), ent('d1', 'Digest')],
      [rel('i2', 'o1', 'mentions')],
    );
    assert.equal(a.orphans + a.stranded, a.unanchored);
  });

  test('Observations are exempt — capturedBy IS their real relationship', () => {
    // Holding ~13k raw rows to this rule would report permanent violations and
    // make the guard useless noise.
    const a = auditStructuralAnchors([ent('o1', 'Observation')], []);
    assert.equal(a.unanchored, 0);
    assert.ok(!ANCHORED_CLASSES.has('Observation'));
  });

  test('derivedFrom does not anchor — it points DOWN at observations', () => {
    // This is exactly why 140 of 148 Digests were unanchored: their only edge
    // pointed at their own observations, so nothing pointed AT them.
    assert.ok(!STRUCTURAL_EDGE_TYPES.has('derivedFrom'));
    const a = auditStructuralAnchors(
      [ent('d1', 'Digest'), ent('o1', 'Observation')],
      [rel('d1', 'o1', 'derivedFrom')],
    );
    assert.equal(a.unanchored, 1);
  });

  test('entityType is honoured when ontologyClass is absent', () => {
    const a = auditStructuralAnchors([{ id: 'x', name: 'x', entityType: 'Insight' }], []);
    assert.equal(a.unanchored, 1);
  });

  test('source/target edges are read as well as from/to', () => {
    // The read API spells them source/target; the write API from/to. Reading
    // only one shape would score every fetched edge as absent.
    const a = auditStructuralAnchors(
      [ent('p1', 'Project'), ent('i1', 'Insight')],
      [{ source: 'p1', target: 'i1', attributes: { type: 'has_insight' } }],
    );
    assert.equal(a.unanchored, 0);
  });
});

describe('project slug matching', () => {
  test('CamelCase entity names match slug metadata', () => {
    // A lowercase compare missed 136 rows and reported them as "project does
    // not resolve" when the project entity was right there.
    assert.equal(projectSlug('A2aXpr'), projectSlug('a2a-xpr'));
    assert.equal(projectSlug('SecondBrainPrivate'), projectSlug('second-brain-private'));
    assert.equal(projectSlug('RapidLlmProxy'), projectSlug('rapid-llm-proxy'));
  });

  test('distinct projects still differ', () => {
    assert.notEqual(projectSlug('second-brain'), projectSlug('second-brain-private'));
  });
});

describe('health coordinator wiring', () => {
  const src = readFileSync(path.join(REPO, 'scripts/health-coordinator.js'), 'utf8');

  test('graph_integrity slice exists and starts unknown (SPEC R6)', () => {
    assert.match(src, /graph_integrity:\s*\{[\s\S]{0,200}status:\s*'unknown'/);
  });

  test('the slice uses the SHARED audit, not its own copy of the rule', () => {
    assert.match(src, /from '\.\.\/lib\/knowledge\/structural-anchors\.mjs'/);
    assert.match(src, /fetchAndAudit\(OBS_API_URL/);
  });

  test('probe is called from runAllChecks', () => {
    assert.match(src, /await pollGraphIntegrity\(\)/);
  });

  test('probe is rate-limited — the audit reads the WHOLE graph', () => {
    // At the 5s tick this would be a self-inflicted load test on obs-api.
    assert.match(src, /GRAPH_INTEGRITY_INTERVAL_MS/);
    assert.match(src, /if \(now - last < GRAPH_INTEGRITY_INTERVAL_MS\) return/);
  });

  test('an unreachable store never reports healthy (SPEC R6)', () => {
    const probe = src.slice(src.indexOf('async function pollGraphIntegrity'),
      src.indexOf('async function runAllChecks'));
    assert.match(probe, /status: 'unreachable'/);
    assert.ok(!/catch[\s\S]{0,300}status: 'healthy'/.test(probe),
      'the catch branch must not claim healthy');
  });

  test('violations are logged with the repair command', () => {
    assert.match(src, /anchor-unstructured-entities\.mjs --apply/);
  });
});

describe('anchors are DIRECTIONAL', () => {
  const ent = (id, ontologyClass) => ({ id, name: id, ontologyClass });
  const rel = (from, to, type) => ({ from, to, type });

  test('a node that CONTAINS children but that nothing contains is a violation', () => {
    // This counted both directions at first, and the bug hid itself: such a
    // node scored as anchored while being exactly the dead end that strands
    // its own subtree. Hide it and its children have no ladder up, because
    // their parent has no parent. Three stranded nodes in the rendered view
    // traced to it (FileWatchManager, SpecstoryIntegration) while the guard
    // read 0 violations.
    const a = auditStructuralAnchors(
      [ent('sub', 'SubComponent'), ent('d1', 'Detail'), ent('d2', 'Detail')],
      [rel('sub', 'd1', 'contains'), rel('sub', 'd2', 'contains')],
    );
    assert.equal(a.unanchored, 1, 'the SubComponent has no parent of its own');
    assert.deepEqual(a.byClass, { SubComponent: 1 });
  });

  test('an inbound structural edge satisfies it', () => {
    const a = auditStructuralAnchors(
      [ent('comp', 'Component'), ent('sub', 'SubComponent')],
      [rel('comp', 'sub', 'contains')],
    );
    assert.equal(a.byClass.SubComponent, undefined);
  });

  test('a self-edge does not let a node anchor itself', () => {
    const a = auditStructuralAnchors([ent('x', 'Detail')], [rel('x', 'x', 'contains')]);
    assert.equal(a.unanchored, 1);
  });
});


/**
 * The parent-METADATA invariant.
 *
 * This is a SECOND, independent invariant. The one above asks "does anything
 * CONTAIN this row" (edges); this one asks "does it declare a parent that
 * exists" (metadata). They were conflated once in review and the separation is
 * the whole point: on the day this shipped the graph held 17 edge violations
 * and 749 metadata ones, so summing them would have flipped graph_integrity to
 * degraded permanently and trained everyone to ignore the slice.
 */
describe('parent-metadata invariant', () => {
  const ents = [
    { id: 'a', name: 'A', ontologyClass: 'Component', metadata: { parentEntityName: 'Root' } },
    { id: 'b', name: 'B', ontologyClass: 'SubComponent', metadata: {} },
    { id: 'c', name: 'C', ontologyClass: 'Detail', metadata: { parentEntityName: 'Ghost' } },
    { id: 'r', name: 'Root', ontologyClass: 'Project', metadata: {} },
    { id: 's', name: 'Sys', ontologyClass: 'System', metadata: {} },
    { id: 'i', name: 'I', ontologyClass: 'Insight', metadata: {} },
    { id: 'd', name: 'D', ontologyClass: 'Digest', metadata: {} },
    { id: 'od', name: 'OD', ontologyClass: 'OnlineDigest', metadata: {} },
    { id: 'raw', name: '[Raw] junk', ontologyClass: 'Detail', metadata: {} },
  ];

  test('a parentEntityName naming an existing entity is clean', () => {
    const r = auditParentMetadata(ents);
    assert.ok(!r.rows.some((x) => x.name === 'A'));
  });

  test('a missing parentEntityName is NOT counted as unanchored', () => {
    // The separation test. B has no parent metadata but IS contained by Root,
    // so the edge invariant is satisfied and only the metadata one is not.
    const rels = [{ from: 'r', to: 'b', type: 'contains' }];
    const anchors = auditStructuralAnchors(ents, rels);
    const parents = auditParentMetadata(ents);
    assert.equal(anchors.rows.some((x) => x.name === 'B'), false,
      'B has a contains edge — the edge invariant holds for it');
    assert.equal(parents.missingParent, 1);
    assert.equal(parents.rows.find((x) => x.name === 'B').reason, 'missing');
  });

  test('a parentEntityName naming nothing is dangling, counted separately', () => {
    const r = auditParentMetadata(ents);
    assert.equal(r.danglingParent, 1);
    const row = r.rows.find((x) => x.name === 'C');
    assert.equal(row.reason, 'dangling');
    assert.equal(row.parentEntityName, 'Ghost');
  });

  test('Insight / Digest / OnlineDigest are exempt — they have no hierarchy', () => {
    // Measured on the live store: Insight 0/912, Digest 0/176, OnlineDigest
    // 0/8 carry parentEntityName. The online consolidator anchors by
    // has_insight / includes edges and has no parent notion at all, so holding
    // those ~1096 rows to this invariant reports a permanent non-violation.
    assert.ok(!HIERARCHY_CLASSES.has('Insight'));
    assert.ok(!HIERARCHY_CLASSES.has('Digest'));
    assert.ok(!HIERARCHY_CLASSES.has('OnlineDigest'));
    const r = auditParentMetadata(ents);
    assert.ok(!r.rows.some((x) => ['I', 'D', 'OD'].includes(x.name)));
  });

  test('Project and System are exempt — the roots legitimately have no parent', () => {
    assert.ok(!HIERARCHY_CLASSES.has('Project'));
    assert.ok(!HIERARCHY_CLASSES.has('System'));
    const r = auditParentMetadata(ents);
    assert.ok(!r.rows.some((x) => ['Root', 'Sys'].includes(x.name)));
  });

  test('[Raw] rows are skipped here too — their repair is deletion', () => {
    const r = auditParentMetadata(ents);
    assert.ok(!r.rows.some((x) => x.name.startsWith('[Raw]')));
    assert.equal(r.checked, 3, 'A, B and C only');
  });

  test('a row failing BOTH invariants counts once in each', () => {
    const rels = [];
    const anchors = auditStructuralAnchors(ents, rels);
    const parents = auditParentMetadata(ents);
    assert.ok(anchors.rows.some((x) => x.name === 'B'));
    assert.ok(parents.rows.some((x) => x.name === 'B'));
    assert.equal(anchors.orphans + anchors.stranded, anchors.unanchored,
      'the edge invariant\'s own arithmetic still holds');
  });
});

describe('parent-metadata wiring', () => {
  const src = readFileSync(path.join(REPO, 'scripts/health-coordinator.js'), 'utf8');
  const cli = readFileSync(path.join(REPO, 'scripts/anchor-unstructured-entities.mjs'), 'utf8');

  test('the slice reports the new counters', () => {
    assert.match(src, /missing_parent:/);
    assert.match(src, /dangling_parent:/);
  });

  test('strict mode is opt-in via env, not a code change', () => {
    assert.match(src, /HEALTH_GRAPH_PARENT_STRICT/);
  });

  test('by DEFAULT status still keys on the EDGE invariant', () => {
    // If this regresses, every machine goes degraded on the next deploy.
    const probe = src.slice(src.indexOf('async function pollGraphIntegrity'),
      src.indexOf('async function runAllChecks'));
    assert.match(probe, /audit\.unanchored === 0/);
    assert.match(probe, /!GRAPH_PARENT_STRICT \|\| parentViolations === 0/);
  });

  test('the CLI guard shares the audit and keeps --check edge-only', () => {
    assert.match(cli, /auditParentMetadata/);
    assert.match(cli, /--check-parents/);
    assert.match(cli, /CHECK_PARENTS && parentViolations > 0/);
  });
});
