/**
 * ObservationWriter — which subsystem a `capturedBy` edge points at.
 *
 * Until 2026-09-21 every one of the 1,244 `capturedBy` edges terminated on the
 * single `LiveLoggingSystem` Component. One distinct target means the edge
 * answered nothing: "captured by" was a provenance name on what is really an
 * anti-orphan tether. The writer now picks the subsystem that actually wrote
 * the row, and the repoint script moved the history to match.
 *
 * The negative cases are the important half. The tether exists because the
 * 2026-06-15 drift orphaned 22 Insights when a lookup raced obs-api's boot and
 * every later write skipped anchoring permanently — so a MISSING subsystem
 * anchor must cost precision and never the edge, and a miss must never be
 * cached.
 */

import { jest } from '@jest/globals';

let ObservationWriter;

beforeAll(async () => {
  ({ ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js'));
});

const ROOT = { id: 'id-root', name: 'LiveLoggingSystem' };
const WRITER = { id: 'id-writer', name: 'ObservationWriter' };
const CONSOLIDATOR = { id: 'id-consolidator', name: 'ObservationConsolidator' };

/** Minimal store: Components and SubComponents by ontology class. */
function storeWith({ components = [ROOT], subComponents = [] } = {}) {
  return {
    calls: 0,
    findByOntologyClass: jest.fn(async function (cls) {
      this.calls += 1;
      if (cls === 'Component') return components;
      if (cls === 'SubComponent') return subComponents;
      return [];
    }),
    findRelations: jest.fn(async () => []),
    addRelation: jest.fn(async () => {}),
  };
}

const writer = () => new ObservationWriter({});

describe('capturedBy anchor target', () => {
  test('an Observation is captured by ObservationWriter', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [WRITER, CONSOLIDATOR] });
    await w._anchorEntity(store, 'row-1', 'capturedBy', 'observation');
    expect(store.addRelation).toHaveBeenCalledTimes(1);
    expect(store.addRelation.mock.calls[0][0]).toMatchObject({
      from: 'row-1', to: WRITER.id, type: 'capturedBy',
    });
  });

  test('an Insight and a Digest are captured by ObservationConsolidator', async () => {
    for (const kind of ['insight', 'digest']) {
      const w = writer();
      const store = storeWith({ subComponents: [WRITER, CONSOLIDATOR] });
      await w._anchorEntity(store, 'row-1', 'capturedBy', kind);
      expect(store.addRelation.mock.calls[0][0]).toMatchObject({ to: CONSOLIDATOR.id });
    }
  });

  test('the two kinds do not share a target — the point of the repoint', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [WRITER, CONSOLIDATOR] });
    await w._anchorEntity(store, 'obs-1', 'capturedBy', 'observation');
    await w._anchorEntity(store, 'ins-1', 'capturedBy', 'insight');
    const targets = store.addRelation.mock.calls.map((c) => c[0].to);
    expect(new Set(targets).size).toBe(2);
  });

  // ---- the tether guarantee ----

  test('a missing subsystem anchor falls back to the root, it does not drop the edge', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [] }); // never minted
    await w._anchorEntity(store, 'row-1', 'capturedBy', 'insight');
    expect(store.addRelation).toHaveBeenCalledTimes(1);
    expect(store.addRelation.mock.calls[0][0]).toMatchObject({ to: ROOT.id });
  });

  test('a missing anchor is NOT cached — the next write retries', async () => {
    const w = writer();
    // First write: the subsystem node does not exist yet.
    const absent = storeWith({ subComponents: [] });
    await w._anchorEntity(absent, 'row-1', 'capturedBy', 'insight');
    expect(absent.addRelation.mock.calls[0][0].to).toBe(ROOT.id);
    // It is minted between the two writes (exactly what the repoint script does
    // to a running obs-api). Caching the miss is the 2026-06-15 drift bug.
    const present = storeWith({ subComponents: [CONSOLIDATOR] });
    await w._anchorEntity(present, 'row-2', 'capturedBy', 'insight');
    expect(present.addRelation.mock.calls[0][0].to).toBe(CONSOLIDATOR.id);
  });

  test('a resolved anchor IS cached — no repeat lookup per write', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [WRITER] });
    await w._anchorEntity(store, 'row-1', 'capturedBy', 'observation');
    const after = store.findByOntologyClass.mock.calls.length;
    await w._anchorEntity(store, 'row-2', 'capturedBy', 'observation');
    expect(store.findByOntologyClass.mock.calls.length).toBe(after);
  });

  test('an unknown kind still anchors, at the root', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [WRITER, CONSOLIDATOR] });
    await w._anchorEntity(store, 'row-1', 'capturedBy', 'something-new');
    expect(store.addRelation.mock.calls[0][0]).toMatchObject({ to: ROOT.id });
  });

  test('the existing dedup probe still runs, against the NEW target', async () => {
    const w = writer();
    const store = storeWith({ subComponents: [WRITER] });
    store.findRelations = jest.fn(async () => [{ id: 'already-there' }]);
    await w._anchorEntity(store, 'row-1', 'capturedBy', 'observation');
    expect(store.findRelations.mock.calls[0][0]).toMatchObject({
      from: 'row-1', to: WRITER.id, type: 'capturedBy',
    });
    expect(store.addRelation).not.toHaveBeenCalled();
  });
});
