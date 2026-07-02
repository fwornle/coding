/**
 * tests/integration/observation-writer.turn-dedup-reconcile.test.js
 *
 * Two fixes for the "progress-snapshot-only" turn (a completed turn shown solely
 * as a kind:'progress' row):
 *
 *   Fix 2 (turn-aware semantic dedup) — `_isSemanticallyDuplicate` must only
 *   suppress re-fires of the SAME turn (matched by metadata.turnKey), never two
 *   DISTINCT user turns that happen to read alike. Backward-compatible: when a
 *   turnKey is absent on either side the original agent-scoped behaviour holds.
 *
 *   Fix 1 (reconcile) — when a completed turn's FINAL observation hashes
 *   identically to an earlier mid-turn progress snapshot, promote the snapshot in
 *   place (drop kind:'progress', swap in the final summary) rather than deduping
 *   INTO it and orphaning the turn as "in progress".
 *
 * Harness mirrors observation-writer.dedup.test.js: tmpdir-backed GraphKMStore,
 * writer wired with the store directly, LLM proxy mocked via global.fetch.
 * writeObservation is the surface (explicit summary → no LLM dependency).
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';

const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (_quietStderr && typeof chunk === 'string' && chunk.startsWith('[ObservationWriter]')) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('ObservationWriter turn-aware dedup + progress-snapshot reconcile', () => {
  let dataDir;
  let kmStore;
  let writer;

  // A summary whose Intent+Approach keyword set is rich enough to trip the
  // semantic-dedup thresholds when repeated.
  const SUMMARY = (tag) =>
    `Intent: refactor the authentication module and extract the token parser ${tag}\n` +
    `Approach: rewrite the JWT verification path into a dedicated parser class\n` +
    `Artifacts: none\n` +
    `Result: authentication refactor complete ${tag}`;

  const msgs = (u, a) => [
    { role: 'user', content: u },
    { role: 'assistant', content: a },
  ];

  beforeAll(async () => {
    _quietStderr = true;
    const kmCore = await import('@fwornle/km-core');
    const { GraphKMStore, defaultOntologyDir } = kmCore;
    const { ObservationWriter } = await import('../../src/live-logging/ObservationWriter.js');

    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-writer-turndedup-'));
    const obsDir = path.join(dataDir, '.observations');
    mkdirSync(path.join(dataDir, 'sqlite'), { recursive: true });
    mkdirSync(obsDir, { recursive: true });
    writeFileSync(
      path.join(obsDir, 'config.json'),
      JSON.stringify({
        defaults: {
          model: 'anthropic/claude-haiku-4-5',
          observation: { messageTokens: 20000, bufferTokens: 0.2, retentionDays: 7 },
        },
      }),
    );

    kmStore = new GraphKMStore({
      dbPath: path.join(dataDir, 'km', 'leveldb'),
      exportDir: path.join(dataDir, 'km', 'exports'),
      ontologyDir: defaultOntologyDir(),
    });
    await kmStore.open();

    writer = new ObservationWriter({
      dbPath: path.join(dataDir, 'sqlite', 'obs.db'),
      configPath: path.join(obsDir, 'config.json'),
      kmStore,
    });
    await writer.init();

    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ content: SUMMARY('x'), provider: 'anthropic', model: 'claude-haiku-4-5', tokens: 80, latencyMs: 10 }),
      text: async () => '',
    }));
  }, 30000);

  afterAll(async () => {
    try { if (writer) await writer.close(); } catch { /* best-effort */ }
    try { if (kmStore) await kmStore.close(); } catch { /* best-effort */ }
    try { if (dataDir) rmSync(dataDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    delete global.fetch;
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  test('Fix 2: two DISTINCT turns with near-identical summaries are BOTH kept', async () => {
    const agent = 'turnaware-distinct';
    const a = await writer.writeObservation(SUMMARY('alpha'), msgs('do the auth refactor A', 'refactor done A'), {
      agent, sessionId: 's-A', project: 'coding', turnKey: 'turn-A',
    });
    const b = await writer.writeObservation(SUMMARY('beta'), msgs('do the auth refactor B', 'refactor done B'), {
      agent, sessionId: 's-B', project: 'coding', turnKey: 'turn-B',
    });
    // Distinct turnKeys → the earlier turn is excluded as a semantic candidate →
    // the second turn is NOT deduped, so both land.
    expect(typeof a).toBe('string');
    expect(typeof b).toBe('string');
    expect(b).not.toBeNull();
  });

  test('Fix 2: a RE-FIRE of the SAME turn (same turnKey) is still deduped', async () => {
    const agent = 'turnaware-same';
    const a = await writer.writeObservation(SUMMARY('one'), msgs('same turn first fire', 'assistant first'), {
      agent, sessionId: 's-1', project: 'coding', turnKey: 'turn-X',
    });
    const b = await writer.writeObservation(SUMMARY('two'), msgs('same turn second fire', 'assistant second'), {
      agent, sessionId: 's-2', project: 'coding', turnKey: 'turn-X',
    });
    expect(typeof a).toBe('string');
    expect(b).toBeNull(); // same-turn re-fire → suppressed
  });

  test('Fix 2: no turnKey on either side → original agent-scoped dedup preserved', async () => {
    const agent = 'turnaware-none';
    const a = await writer.writeObservation(SUMMARY('p'), msgs('legacy fire one', 'legacy assistant one'), {
      agent, sessionId: 's-p', project: 'coding',
    });
    const b = await writer.writeObservation(SUMMARY('q'), msgs('legacy fire two', 'legacy assistant two'), {
      agent, sessionId: 's-q', project: 'coding',
    });
    expect(typeof a).toBe('string');
    expect(b).toBeNull(); // no turnKey → filter keeps candidate → old behaviour (deduped)
  });

  test('Fix 1: a FINAL hashing into an earlier progress snapshot PROMOTES it (no orphan)', async () => {
    const agent = 'reconcile';
    const M = msgs('investigate the routing behaviour', 'checked the provider chain and probes');
    const meta = { agent, sessionId: 's-reconcile', project: 'coding', turnKey: 'turn-R' };

    const before = (await kmStore.findByOntologyClass('Observation')).length;

    // Mid-turn progress snapshot.
    const pId = await writer.writeObservation(SUMMARY('snapshot'), M, { ...meta, kind: 'progress' });
    expect(typeof pId).toBe('string');

    // Completed turn's final — SAME messages+session → SAME content-hash → matches
    // the snapshot. Instead of deduping into it (orphan), the snapshot is promoted.
    const fId = await writer.writeObservation(SUMMARY('FINAL'), M, { ...meta });
    expect(fId).toBe(pId); // same entity — promoted in place, not a new row

    const after = (await kmStore.findByOntologyClass('Observation')).length;
    expect(after).toBe(before + 1); // exactly one entity for the turn

    // The promoted entity: progress tag cleared, summary is the FINAL text.
    const entity = await kmStore.findByLegacyId({ system: 'A', id: pId });
    expect(entity).toBeTruthy();
    expect(entity.metadata.kind).toBeUndefined();
    expect(entity.metadata.summary).toContain('FINAL');
    expect(entity.metadata.turnKey).toBe('turn-R');
  });
});
