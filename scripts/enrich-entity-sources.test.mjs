/**
 * Unit suite for `scripts/enrich-entity-sources.mjs`.
 *
 * What is worth locking here is not "does it compute an array" but the four
 * decisions that are invisible once the data is written and expensive to
 * discover afterwards:
 *
 *   1. The metadata write is FULL, never partial. km-core's PUT lands in a
 *      shallow `mergeNodeAttributes`, so a partial `metadata` erases the rest
 *      of the row — the incident that produced
 *      scripts/backfill-parent-metadata.mjs. Test 6 asserts every pre-existing
 *      key survives.
 *   2. Document lookup is case-SENSITIVE. macOS would have matched `rec` to
 *      `Rec.md` and stamped 12 entities with someone else's document.
 *   3. The occurrence cap takes the 50 NEWEST, not the first 50 the export
 *      happened to list. A cap applied before the sort is silently wrong and
 *      renders identically.
 *   4. An undateable edge contributes NOTHING rather than an occurrence with an
 *      empty timestamp — which would render as "Invalid Date" in the panel.
 *
 * @module scripts/enrich-entity-sources.test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  MARKER_AT,
  MARKER_FROM,
  OCCURRENCE_CAP,
  INSIGHT_DOC_EVIDENCE_TYPE,
  edgeTimestamp,
  readInsightDocIndex,
  indexIncomingEvidence,
  planEntity,
  mergeEnrichment,
  buildEnrichmentPlan,
  applyEnrichment,
} from './enrich-entity-sources.mjs';

/** A wire-shaped relation, as /api/v1/relations returns it. */
const rel = (source, target, type, metadata = {}, createdAt = '') => ({
  key: `${source}->${target}`,
  source,
  target,
  attributes: { type, metadata, createdAt },
});

const entity = (id, name, metadata = {}, ontologyClass = 'Detail') => ({
  id,
  name,
  ontologyClass,
  metadata,
});

describe('edgeTimestamp', () => {
  it('prefers classifiedAt, then anchoredAt, then backfilledAt, then createdAt', () => {
    assert.equal(
      edgeTimestamp(rel('a', 'b', 'mentions', { classifiedAt: 'C', anchoredAt: 'A' }, 'X')),
      'C',
    );
    assert.equal(edgeTimestamp(rel('a', 'b', 'capturedBy', { anchoredAt: 'A' }, 'X')), 'A');
    assert.equal(edgeTimestamp(rel('a', 'b', 'mentions', { backfilledAt: 'B' }, 'X')), 'B');
    assert.equal(edgeTimestamp(rel('a', 'b', 'mentions', {}, 'X')), 'X');
  });

  it('returns null when every candidate is absent or empty', () => {
    // The real corpus has 13,174 mentions edges whose Graphology `createdAt`
    // is the EMPTY STRING. Treating that as a date yields "Invalid Date" in
    // the Occurrence History and a NaN-sorted Timeline.
    assert.equal(edgeTimestamp(rel('a', 'b', 'mentions', {}, '')), null);
    assert.equal(edgeTimestamp(rel('a', 'b', 'mentions')), null);
  });

  it('reads the flat shape too, not only attributes', () => {
    assert.equal(edgeTimestamp({ metadata: { classifiedAt: 'C' } }), 'C');
  });
});

describe('readInsightDocIndex', () => {
  it('keys by the real document name and is case-sensitive', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-docs-'));
    fs.writeFileSync(path.join(dir, 'Rec.md'), '# Rec');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const index = readInsightDocIndex(dir);

    assert.equal(index.size, 1, 'only .md files are documents');
    assert.ok(index.has('Rec'));
    // The whole point: on a case-insensitive filesystem `existsSync` would say
    // yes to this and the entity `rec` would be handed `Rec.md`.
    assert.equal(index.has('rec'), false);

    const ref = index.get('Rec');
    assert.equal(ref.type, INSIGHT_DOC_EVIDENCE_TYPE);
    assert.equal(ref.url, '/api/insights/doc/Rec');
    assert.ok(!ref.url.startsWith('http'), 'url stays origin-relative — it is committed data');
    assert.ok(Date.parse(ref.addedAt) > 0, 'addedAt is the document mtime');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('percent-encodes a name that needs it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrich-docs-'));
    fs.writeFileSync(path.join(dir, 'A B.md'), '#');
    assert.equal(readInsightDocIndex(dir).get('A B').url, '/api/insights/doc/A%20B');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty index for a missing directory rather than throwing', () => {
    assert.equal(readInsightDocIndex('/nonexistent-insight-dir-xyz').size, 0);
  });
});

describe('indexIncomingEvidence', () => {
  it('collects only mentions and capturedBy, keyed by the edge TARGET', () => {
    const idx = indexIncomingEvidence([
      rel('ins1', 'e1', 'mentions', { classifiedAt: '2026-01-01T00:00:00Z' }),
      rel('obs1', 'e1', 'capturedBy', { anchoredAt: '2026-02-01' }),
      rel('e1', 'e2', 'contains', { classifiedAt: '2026-01-01T00:00:00Z' }),
      rel('e1', 'e3', 'has_insight', { classifiedAt: '2026-01-01T00:00:00Z' }),
    ]);
    assert.deepEqual([...idx.keys()], ['e1']);
    assert.equal(idx.get('e1').length, 2);
    assert.deepEqual(
      idx.get('e1').map((o) => o.sourceEvidenceId).sort(),
      ['ins1', 'obs1'],
    );
  });

  it('skips self-edges and undateable edges', () => {
    const idx = indexIncomingEvidence([
      rel('e1', 'e1', 'mentions', { classifiedAt: '2026-01-01T00:00:00Z' }),
      rel('ins1', 'e2', 'mentions', {}, ''),
    ]);
    assert.equal(idx.size, 0);
  });

  it('caps at the 50 NEWEST, not the first 50 seen', () => {
    // Ascending input, so a cap applied before sorting would keep the OLDEST.
    const edges = [];
    for (let i = 0; i < 120; i++) {
      const day = String(i + 1).padStart(3, '0');
      edges.push(rel(`ins${day}`, 'e1', 'mentions', { classifiedAt: `2026-01-${day}T00:00:00Z` }));
    }
    const occ = indexIncomingEvidence(edges).get('e1');
    assert.equal(occ.length, OCCURRENCE_CAP);
    assert.equal(occ[0].sourceEvidenceId, 'ins120', 'newest first');
    assert.equal(occ[OCCURRENCE_CAP - 1].sourceEvidenceId, 'ins071');
    assert.ok(
      occ.every((o) => o.timestamp >= '2026-01-071'),
      'the oldest 70 are dropped, not the newest 70',
    );
  });
});

describe('planEntity', () => {
  const docIndex = new Map([
    ['Known', { type: 'mkdocs', url: '/api/insights/doc/Known', addedAt: '2026-01-01T00:00:00Z' }],
  ]);
  const incoming = new Map([['e1', [{ timestamp: '2026-01-01T00:00:00Z', sourceEvidenceId: 'ins1' }]]]);

  it('derives both arrays when both sources exist', () => {
    const plan = planEntity(entity('e1', 'Known'), { docIndex, incoming });
    assert.equal(plan.additions.sourceRefs.length, 1);
    assert.equal(plan.additions.occurrences.length, 1);
    assert.deepEqual(plan.from, ['insight-document', 'evidence-edge']);
  });

  it('returns null when neither source exists', () => {
    assert.equal(planEntity(entity('nope', 'Unknown'), { docIndex, incoming }), null);
  });

  it('honours the idempotency marker, and --force overrides it', () => {
    const marked = entity('e1', 'Known', { [MARKER_AT]: '2026-01-01T00:00:00Z' });
    assert.equal(planEntity(marked, { docIndex, incoming }), null);
    assert.ok(planEntity(marked, { docIndex, incoming, force: true }));
  });

  it('honours --only', () => {
    const docsOnly = planEntity(entity('e1', 'Known'), { docIndex, incoming, only: 'docs' });
    assert.ok('sourceRefs' in docsOnly.additions);
    assert.ok(!('occurrences' in docsOnly.additions));

    const edgesOnly = planEntity(entity('e1', 'Known'), { docIndex, incoming, only: 'edges' });
    assert.ok('occurrences' in edgesOnly.additions);
    assert.ok(!('sourceRefs' in edgesOnly.additions));
  });

  it('appends to existing sourceRefs but never duplicates the same url', () => {
    const withOther = entity('e9', 'Known', {
      sourceRefs: [{ type: 'github', url: 'https://example.invalid/x', addedAt: '2025-01-01T00:00:00Z' }],
    });
    assert.equal(planEntity(withOther, { docIndex, incoming }).additions.sourceRefs.length, 2);

    const already = entity('e9', 'Known', {
      sourceRefs: [{ type: 'mkdocs', url: '/api/insights/doc/Known', addedAt: '2025-01-01T00:00:00Z' }],
    });
    assert.equal(planEntity(already, { docIndex, incoming }), null);
  });

  it('leaves a row that already has occurrences alone', () => {
    // Real occurrences would come from a writer that knows more than an edge
    // date does; recomputing over the top of one would lose that.
    const e = entity('e1', 'Unknown', { occurrences: [{ timestamp: 'x', sourceEvidenceId: 'y' }] });
    assert.equal(planEntity(e, { docIndex, incoming }), null);
  });
});

describe('mergeEnrichment', () => {
  it('carries EVERY pre-existing key through — the shallow-merge trap', () => {
    const existing = {
      parentEntityName: 'LiveLoggingSystem',
      hierarchyLevel: 2,
      provenance: { createdBy: { provider: 'p', model: 'm' } },
      validated_file_path: '/some/path.md',
    };
    const next = mergeEnrichment(existing, {
      additions: { sourceRefs: [{ type: 'mkdocs', url: '/u', addedAt: 'T' }] },
      from: ['insight-document'],
    }, '2026-09-27T10:00:00Z');

    for (const key of Object.keys(existing)) {
      assert.deepEqual(next[key], existing[key], `${key} must survive the merge`);
    }
    assert.equal(next.sourceRefs.length, 1);
    assert.equal(next[MARKER_AT], '2026-09-27T10:00:00Z');
    assert.equal(next[MARKER_FROM], 'insight-document');
  });

  it('tolerates a row with no metadata at all', () => {
    const next = mergeEnrichment(undefined, { additions: {}, from: ['evidence-edge'] });
    assert.equal(next[MARKER_FROM], 'evidence-edge');
  });
});

describe('buildEnrichmentPlan', () => {
  it('counts each cohort and sorts the report by name', () => {
    const docIndex = new Map([
      ['Bravo', { type: 'mkdocs', url: '/api/insights/doc/Bravo', addedAt: 'T' }],
      ['Alpha', { type: 'mkdocs', url: '/api/insights/doc/Alpha', addedAt: 'T' }],
    ]);
    const { planned, counts } = buildEnrichmentPlan({
      entities: [
        entity('e-b', 'Bravo'),                                   // doc only
        entity('e-a', 'Alpha'),                                   // doc + edges
        entity('e-c', 'Charlie'),                                 // edges only
        entity('e-d', 'Delta'),                                   // nothing
        entity('e-e', 'Alpha', { [MARKER_AT]: 'T' }),             // marked
      ],
      relations: [
        rel('ins1', 'e-a', 'mentions', { classifiedAt: '2026-01-01T00:00:00Z' }),
        rel('ins2', 'e-c', 'capturedBy', { anchoredAt: '2026-01-02' }),
      ],
      docIndex,
    });

    assert.deepEqual(counts, {
      docsOnly: 1, edgesOnly: 1, both: 1, skippedMarker: 1, noSource: 1,
    });
    assert.deepEqual(planned.map((p) => p.entity.name), ['Alpha', 'Bravo', 'Charlie']);
  });
});

describe('applyEnrichment', () => {
  it('writes the full metadata per entity and isolates a per-row failure', async () => {
    const seen = [];
    const planned = [
      { entity: entity('ok1', 'Ok1', { keep: 1 }), additions: { occurrences: [] }, from: ['evidence-edge'] },
      { entity: entity('bad', 'Bad'), additions: {}, from: ['evidence-edge'] },
      { entity: entity('ok2', 'Ok2'), additions: {}, from: ['evidence-edge'] },
    ];
    const { written, failures } = await applyEnrichment(planned, async (id, metadata) => {
      if (id === 'bad') throw new Error('boom');
      seen.push([id, metadata]);
    });

    assert.equal(written, 2, 'a failure does not abort the remaining rows');
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, 'Bad');
    assert.equal(seen[0][1].keep, 1);
    assert.ok(seen[0][1][MARKER_AT]);
  });
});
