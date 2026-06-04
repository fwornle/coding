/**
 * tests/integration/observation-writer.km-core.test.js
 *
 * Phase 44 Plan 12 (A-1 architectural close-out) — round-trip integration
 * test for the new ObservationWriter → km-core write path.
 *
 * SCOPE:
 *   * Spin up an in-process ObservationWriter against a tmpdir-backed
 *     GraphKMStore (T-44-12-04 mitigation — no contention with the live
 *     production store that ETM writes to).
 *   * Write 1 observation + 1 digest + 1 insight through the writer's
 *     public API (`writeObservation` / `writeDigest` / `writeInsight`).
 *   * Read them back via `store.findByOntologyClass(class)` and assert:
 *       - legacyId.system === 'A'
 *       - entityType === 'Observation' | 'Digest' | 'Insight'
 *       - ontologyClass === entityType (Pitfall 3 — both fields stamped)
 *       - createdBy.provider === 'observation-writer'
 *       - createdBy.model === 'live-pipeline'
 *       - createdBy.runId starts with 'obs-writer-' (per-process stamp)
 *
 * NOTES:
 *   * Jest 29 test (matches the repo's tests/integration/*.test.js
 *     convention — package.json "test": "... jest").
 *   * The writer's `init()` opens BOTH a SQLite handle and a km-core store.
 *     SQLite open is non-fatal — even with `dbPath` pointing at a tmpdir
 *     location, init succeeds because SafeDatabase creates the file. The
 *     km-core store is the one under test.
 *   * Cleanup: tmpdir removed in afterAll; the SQLite file goes with it.
 *
 * RED → GREEN trajectory:
 *   * Before Plan 44-12: `writeObservation` did `INSERT INTO observations`;
 *     no km-core entity ever landed; `findByOntologyClass('Observation')`
 *     returned [] → assertion failure on .length === 1.
 *   * After Plan 44-12: `writeObservation` calls
 *     `legacyObservationToEntity(row, runId, ts)` + `kmStore.putEntity(...)`
 *     on the trusted path; assertion passes.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Suppress writer's startup chatter to stderr during the test run.
// `process.stderr.write` is wrapped because the writer emits ~10 stderr
// lines on init (redactor + km-core open + DB init) which clutter the
// jest output.
const origStderrWrite = process.stderr.write.bind(process.stderr);
let _quietStderr = false;
process.stderr.write = function quietWrap(chunk, ...rest) {
  if (_quietStderr && typeof chunk === 'string' && chunk.startsWith('[ObservationWriter]')) {
    return true;
  }
  return origStderrWrite(chunk, ...rest);
};

describe('ObservationWriter → km-core round-trip (Phase 44 Plan 12)', () => {
  let dataDir;
  let kmStore;
  let writer;
  let GraphKMStore;
  let defaultOntologyDir;
  let ObservationWriter;

  // ontologyDir resolved once — the writer's own resolver uses km-core's
  // `defaultOntologyDir()` helper. The test mirrors that resolution so the
  // tmpdir-backed store agrees with the writer's lazy-init defaults.
  let ontologyDir;

  beforeAll(async () => {
    _quietStderr = true;
    // Dynamic ESM imports — the integration test file is CommonJS-ish but the
    // production modules are ESM. Jest 29 + ts-jest ESM preset handles the
    // transform; we use dynamic import to defer module resolution until the
    // test runtime is initialized.
    const kmCore = await import('@fwornle/km-core');
    GraphKMStore = kmCore.GraphKMStore;
    defaultOntologyDir = kmCore.defaultOntologyDir;
    const writerModule = await import('../../src/live-logging/ObservationWriter.js');
    ObservationWriter = writerModule.ObservationWriter;

    // tmpdir layout:
    //   <tmpdir>/obs-writer-test-<rand>/km/leveldb        ← km-core LevelDB
    //   <tmpdir>/obs-writer-test-<rand>/km/exports        ← km-core JSON export
    //   <tmpdir>/obs-writer-test-<rand>/sqlite/obs.db     ← legacy SQLite
    //   <tmpdir>/obs-writer-test-<rand>/.observations/config.json
    dataDir = mkdtempSync(path.join(tmpdir(), 'obs-writer-test-'));
    const kmDbPath = path.join(dataDir, 'km', 'leveldb');
    const kmExportDir = path.join(dataDir, 'km', 'exports');
    const sqliteDir = path.join(dataDir, 'sqlite');
    const obsDir = path.join(dataDir, '.observations');
    mkdirSync(sqliteDir, { recursive: true });
    mkdirSync(obsDir, { recursive: true });
    // Stub config so loadConfig doesn't reach into the real .observations/
    // folder and pick up the retentionDays from the dev box.
    writeFileSync(
      path.join(obsDir, 'config.json'),
      JSON.stringify({
        defaults: {
          model: 'anthropic/claude-haiku-4-5',
          observation: { messageTokens: 20000, bufferTokens: 0.2, retentionDays: 7 },
        },
      }),
    );

    // Resolve ontologyDir via km-core helper — same path the writer uses
    // in `resolveKmCoreOntologyDir()`. Asserts the CLAUDE.md mandatory
    // rule (Phase 41) holds in the test setup too.
    ontologyDir = defaultOntologyDir();
    expect(typeof ontologyDir).toBe('string');
    expect(ontologyDir.length).toBeGreaterThan(0);

    // Build a tmpdir-backed store FIRST, then hand it to the writer so the
    // test exercises the "caller-supplied kmStore" path (preferred — obs-api
    // wires it this way).
    kmStore = new GraphKMStore({
      dbPath: kmDbPath,
      exportDir: kmExportDir,
      ontologyDir,
    });
    await kmStore.open();

    writer = new ObservationWriter({
      dbPath: path.join(sqliteDir, 'obs.db'),
      configPath: path.join(obsDir, 'config.json'),
      kmStore,
    });
    await writer.init();
  }, 30000);

  afterAll(async () => {
    try {
      if (writer) await writer.close();
    } catch { /* best-effort */ }
    try {
      if (kmStore) await kmStore.close();
    } catch { /* best-effort */ }
    try {
      if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
    _quietStderr = false;
    process.stderr.write = origStderrWrite;
  });

  test('writeObservation persists Observation entity with legacyId + provenance', async () => {
    const messages = [
      { role: 'user', content: 'test prompt — please summarize this exchange' },
      { role: 'assistant', content: 'Intent: test\nApproach: stub\nArtifacts: none\nResult: test row' },
    ];
    const summary = 'Intent: test\nApproach: stub\nArtifacts: none\nResult: test row';
    const metadata = { agent: 'test-agent', project: 'coding', sessionId: 'sid-1' };

    const obsId = await writer.writeObservation(summary, messages, metadata);
    expect(typeof obsId).toBe('string');
    expect(obsId.length).toBeGreaterThan(0);

    const matches = await kmStore.findByOntologyClass('Observation');
    expect(matches.length).toBe(1);
    const entity = matches[0];

    expect(entity.legacyId).toBeDefined();
    expect(entity.legacyId.system).toBe('A');
    expect(entity.legacyId.id).toBe(obsId);
    expect(entity.entityType).toBe('Observation');
    expect(entity.ontologyClass).toBe('Observation');
    expect(entity.layer).toBe('evidence');
    expect(entity.createdBy).toBeDefined();
    expect(entity.createdBy.provider).toBe('observation-writer');
    expect(entity.createdBy.model).toBe('live-pipeline');
    expect(entity.createdBy.runId).toMatch(/^obs-writer-/);
    expect(typeof entity.createdBy.timestamp).toBe('string');
  });

  test('writeDigest persists Digest entity with legacyId + provenance', async () => {
    const digestRow = {
      id: 'digest-uuid-1',
      date: '2026-06-04',
      theme: 'TestTheme',
      summary: 'Digest summary text',
      observation_ids: ['obs-id-1', 'obs-id-2'],
      agents: ['claude', 'opencode'],
      files_touched: ['src/foo.ts', 'lib/bar.js'],
      project: 'coding',
      quality: 'high',
      created_at: '2026-06-04T12:00:00Z',
    };
    const returnedId = await writer.writeDigest(digestRow);
    expect(returnedId).toBe('digest-uuid-1');

    const matches = await kmStore.findByOntologyClass('Digest');
    expect(matches.length).toBe(1);
    const entity = matches[0];

    expect(entity.legacyId).toBeDefined();
    expect(entity.legacyId.system).toBe('A');
    expect(entity.legacyId.id).toBe('digest-uuid-1');
    expect(entity.entityType).toBe('Digest');
    expect(entity.ontologyClass).toBe('Digest');
    expect(entity.layer).toBe('pattern');
    expect(entity.createdBy).toBeDefined();
    expect(entity.createdBy.provider).toBe('observation-writer');
    expect(entity.createdBy.model).toBe('live-pipeline');
    // Array fields preserved verbatim in metadata
    expect(entity.metadata.observation_ids).toEqual(['obs-id-1', 'obs-id-2']);
    expect(entity.metadata.agents).toEqual(['claude', 'opencode']);
    expect(entity.metadata.files_touched).toEqual(['src/foo.ts', 'lib/bar.js']);
    expect(entity.metadata.project).toBe('coding');
  });

  test('writeInsight persists Insight entity with legacyId + provenance', async () => {
    const insightRow = {
      id: 'insight-uuid-1',
      topic: 'TestInsight',
      summary: 'Insight summary text',
      confidence: 0.85,
      digest_ids: ['dig-id-1'],
      last_updated: '2026-06-04T12:30:00Z',
      created_at: '2026-06-04T12:00:00Z',
      project: 'coding',
    };
    const returnedId = await writer.writeInsight(insightRow);
    expect(returnedId).toBe('insight-uuid-1');

    const matches = await kmStore.findByOntologyClass('Insight');
    expect(matches.length).toBe(1);
    const entity = matches[0];

    expect(entity.legacyId).toBeDefined();
    expect(entity.legacyId.system).toBe('A');
    expect(entity.legacyId.id).toBe('insight-uuid-1');
    expect(entity.entityType).toBe('Insight');
    expect(entity.ontologyClass).toBe('Insight');
    expect(entity.layer).toBe('pattern');
    expect(entity.createdBy).toBeDefined();
    expect(entity.createdBy.provider).toBe('observation-writer');
    expect(entity.createdBy.model).toBe('live-pipeline');
    expect(entity.metadata.confidence).toBe(0.85);
    expect(entity.metadata.digest_ids).toEqual(['dig-id-1']);
    expect(entity.metadata.last_updated).toBe('2026-06-04T12:30:00Z');
    expect(entity.metadata.project).toBe('coding');
    // updatedAt prefers last_updated when present
    expect(entity.updatedAt).toBe('2026-06-04T12:30:00Z');
  });
});
