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
  projectSlug,
  ANCHORED_CLASSES,
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
