/**
 * ObservationExporter — a proxy-failure receipt survives the export
 *
 * Regression coverage for 2026-09-23. When the LLM proxy was unreachable the
 * writer did exactly what it promised: it stored the turn under a `[Raw]`
 * placeholder with the full messages attached, and logged "Storing raw
 * summary". The row reached the graph. Nothing could read it.
 *
 * `ObservationExporter` filtered out every `quality: 'low'` row, and
 * `/api/coding/observations` serves the dashboard from that export via
 * ColdStoreReader (`_metadata.source: 'observation-export'`) — not from the
 * graph. So the only consumer that could have shown the gap was reading a file
 * the row had been removed from. 26 turns went that way; 7 of them had no
 * successfully summarised counterpart and existed solely as a row nothing could
 * see, including `scripts/backfill-raw-observations.mjs`, whose entire job is to
 * re-summarise them.
 *
 * The rule these tests pin: `quality: 'low'` means "the summariser judged this
 * turn to contain no work". A `[Raw]` row has made no such judgement — it has no
 * content YET — so the dud filter must not claim it.
 *
 * The negative test is the important half. The filter exists to keep genuine
 * duds out of the cold store, and an exception keyed too broadly (on quality
 * alone, or on "has no Intent: line") would readmit every one of them.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ObservationExporter } from '../../src/live-logging/ObservationExporter.js';
import { isRawFallbackSummary } from '../../src/live-logging/raw-fallback.js';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-raw-fallback-'));
});

afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Minimal stand-in for the km-core graph the exporter reads. Only the surface
 * `_kmEntitiesByType` touches is modelled: `nodes()` + `getNodeAttributes()`.
 * A real GraphKMStore would drag LevelDB and fastembed into a filter test.
 */
function fakeKmStore(entities) {
  const byId = new Map(entities.map((e, i) => [e.id || `n${i}`, e]));
  return {
    graph: {
      nodes: () => [...byId.keys()],
      getNodeAttributes: (id) => byId.get(id),
    },
  };
}

/** The exact row the writer produces when all 4 proxy attempts fail. */
function rawFallbackEntity(id, createdAt) {
  const summary = '[Raw] 2 messages (1 user, 1 assistant). LLM summary unavailable.';
  return {
    id,
    name: summary.slice(0, 80),
    entityType: 'Observation',
    ontologyClass: 'Observation',
    description: summary,
    createdAt,
    metadata: {
      agent: 'claude',
      project: 'coding',
      quality: 'low',
      createdAt,
      // The receipt half: what makes the row repairable rather than noise.
      messages: [
        { role: 'user', content: 'resume - you wanted to drill down from intent...' },
        { role: 'assistant', content: '[Tool calls] Bash: find . -name "intent-spine*"' },
      ],
    },
  };
}

/** A row the summariser actually judged: real verdict, no work in the turn. */
function genuineDudEntity(id, createdAt) {
  const summary = 'Intent: user acknowledged.\nApproach: none.\nArtifacts: none.\nResult: No actionable content.';
  return {
    id,
    name: summary.slice(0, 80),
    entityType: 'Observation',
    ontologyClass: 'Observation',
    description: summary,
    createdAt,
    metadata: { agent: 'claude', project: 'coding', quality: 'low', createdAt },
  };
}

function goodEntity(id, createdAt) {
  const summary = 'Intent: fix the export filter.\nApproach: narrow it.\nArtifacts: edited ObservationExporter.js\nResult: done.';
  return {
    id,
    name: summary.slice(0, 80),
    entityType: 'Observation',
    ontologyClass: 'Observation',
    description: summary,
    createdAt,
    metadata: { agent: 'claude', project: 'coding', quality: 'high', createdAt },
  };
}

function newExporter(entities) {
  return new ObservationExporter({
    kmStore: fakeKmStore(entities),
    exportDir: path.join(tmpDir, 'observation-export'),
  });
}

describe('ObservationExporter — [Raw] fallback rows reach the export', () => {
  test('a proxy-failure receipt is exported despite quality:low', () => {
    const exporter = newExporter([rawFallbackEntity('raw-1', '2026-09-22T15:58:55.698Z')]);

    const rows = exporter._exportObservations();

    expect(rows).toHaveLength(1);
    expect(isRawFallbackSummary(rows[0].summary)).toBe(true);
    // Quality is NOT promoted. The consolidator and the dashboard both read it
    // to hold contentless rows back (ObservationConsolidator.js:1392,1687);
    // changing the value to buy visibility would have flipped both.
    expect(rows[0].quality).toBe('low');
  });

  test('NEGATIVE: a genuine "no actionable content" dud is still filtered out', () => {
    const exporter = newExporter([genuineDudEntity('dud-1', '2026-09-22T16:00:00.000Z')]);

    expect(exporter._exportObservations()).toHaveLength(0);
  });

  test('mixed set: the receipt and the real row survive, the dud does not', () => {
    const exporter = newExporter([
      goodEntity('good-1', '2026-09-22T15:00:00.000Z'),
      rawFallbackEntity('raw-1', '2026-09-22T15:58:55.698Z'),
      genuineDudEntity('dud-1', '2026-09-22T16:00:00.000Z'),
    ]);

    const ids = exporter._exportObservations().map((r) => r.id);

    expect(ids).toEqual(['good-1', 'raw-1']);
  });

  test('the exported receipt is written to observations.json, not just returned', () => {
    // The bug was never in _exportObservations alone — it was that the file
    // /api/coding/observations reads had no such row in it. Assert on the file.
    const exporter = newExporter([
      goodEntity('good-1', '2026-09-22T15:00:00.000Z'),
      rawFallbackEntity('raw-1', '2026-09-22T15:58:55.698Z'),
    ]);

    exporter.exportAll();

    const written = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'observation-export', 'observations.json'), 'utf-8'),
    );
    expect(written.filter((r) => isRawFallbackSummary(r.summary))).toHaveLength(1);
  });

  test('the legacy "[Raw] needs backfill" spelling counts too', () => {
    // The 2026-05-28 generation of these rows reads "[Raw] needs backfill".
    // They are in the export today only because they predate the quality rule;
    // a re-export must not now drop them.
    const legacy = rawFallbackEntity('raw-legacy', '2026-05-28T15:39:25.696Z');
    legacy.description = '[Raw] needs backfill';
    legacy.metadata.quality = 'low';

    expect(newExporter([legacy])._exportObservations()).toHaveLength(1);
  });
});
