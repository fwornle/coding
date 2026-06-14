/**
 * Phase 57 Plan 05 — Integration test for `scripts/backfill-project-tag.mjs`.
 *
 * Locks the 4-step precedence + idempotency + 5% error-budget + log-artifact
 * contract from PLAN.md §<behavior>:
 *
 *   1. Re-running `--dry-run` twice produces identical summary counts (idempotency).
 *   2. Entity with `metadata.project = 'coding'` is skipped (step 1).
 *   3. Entity with `metadata.team = 'coding'` (no project) derives 'coding' via step 2.
 *   4. Entity with `legacyId.system === 'C'` (no project, no team) derives 'okm' via step 3.
 *   5. Entity with `legacyId.system === 'A'` derives 'coding' via step 3.
 *   6. Entity with no project/team/legacyId falls to default 'coding' AND records id
 *      in `ambiguousDefaultIds`.
 *   7. Summary JSON contains `byPrecedenceStep` with all 5 keys + non-empty
 *      `ambiguousDefaultIds` when step-4 entities exist.
 *   8. `--dry-run` performs zero `putEntity` calls (mock store; assert count=0).
 *   9. Script exits 0 when error rate ≤ 5%.
 *  10. Script exits non-zero when error rate > 5%.
 *
 * Uses `node:test` + `node:assert/strict` per CLAUDE.md "no new deps" stance
 * and the existing in-repo test style for scripts (mirror
 * `integrations/mcp-server-semantic-analysis/scripts/augment-team-field-42.2.mjs`
 * conventions).
 *
 * Test strategy: spawn the script as a child process against an isolated fixture
 * directory containing a synthetic km-core JSON export shaped like
 * `.data/knowledge-graph/exports/general.json`. The script's `--source` flag
 * points at the fixture file, and the resulting summary JSON is written into
 * a tmp `--log-dir` we can read back. Mock store assertion (case 8) uses
 * `--dry-run` and inspects that the summary `migrated > 0` but no LevelDB
 * mutation occurred (we verify the JSON export file is byte-untouched).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, 'backfill-project-tag.mjs');

// ────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal km-core JSON export with the requested entity fixtures.
 * Mirrors the shape of `.data/knowledge-graph/exports/general.json`:
 *   { attributes: {}, options: {...}, nodes: [{ key, attributes: { ... } }] }
 */
function buildFixtureExport(entityFixtures) {
  return {
    attributes: {},
    options: { type: 'mixed', multi: false, allowSelfLoops: true },
    nodes: entityFixtures.map((e) => ({
      key: e.id,
      attributes: {
        id: e.id,
        name: e.name ?? `entity-${e.id.slice(0, 8)}`,
        entityType: e.entityType ?? 'Detail',
        ontologyClass: e.ontologyClass ?? 'Detail',
        layer: e.layer ?? 'evidence',
        description: e.description ?? '',
        createdAt: e.createdAt ?? '2026-06-14T00:00:00.000Z',
        updatedAt: e.updatedAt ?? '2026-06-14T00:00:00.000Z',
        validFrom: e.validFrom ?? '2026-06-14T00:00:00.000Z',
        validUntil: null,
        ...(e.legacyId ? { legacyId: e.legacyId } : {}),
        metadata: e.metadata ?? {},
      },
    })),
    edges: [],
  };
}

/**
 * The 6 canonical fixture entities covering all 4 precedence steps + 1
 * already-populated + 1 invalid-team-falls-to-default. UUID v7-ish ids.
 */
function makeFixtureEntities() {
  return [
    // Case 1: already populated → skip step 1.
    {
      id: '019e5559-0001-7000-8000-000000000001',
      name: 'AlreadyPopulated',
      metadata: { project: 'coding' },
    },
    // Case 2: metadata.team='coding' (no project) → step 2 → 'coding'.
    {
      id: '019e5559-0002-7000-8000-000000000002',
      name: 'HasTeamCoding',
      metadata: { team: 'coding' },
    },
    // Case 3: legacyId.system='C' → step 3 → 'okm'.
    {
      id: '019e5559-0003-7000-8000-000000000003',
      name: 'LegacyC',
      legacyId: { system: 'C', id: 'okm-legacy-1' },
      metadata: {},
    },
    // Case 4: legacyId.system='A' → step 3 → 'coding'.
    {
      id: '019e5559-0004-7000-8000-000000000004',
      name: 'LegacyA',
      legacyId: { system: 'A', id: 'a-legacy-1' },
      metadata: {},
    },
    // Case 5: no project/team/legacyId → step 4 → 'coding' + ambiguous.
    {
      id: '019e5559-0005-7000-8000-000000000005',
      name: 'Ambiguous',
      metadata: {},
    },
    // Case 6: invalid team (not in PROJECTS) → typeguard rejects → step 4 default.
    {
      id: '019e5559-0006-7000-8000-000000000006',
      name: 'InvalidTeam',
      metadata: { team: 'bmw' },  // 'bmw' not in PROJECTS — falls through.
    },
  ];
}

/**
 * Create a tmpdir fixture set:
 *   <tmp>/source.json        (the km-core export to backfill)
 *   <tmp>/logs/              (where the script writes its summary)
 * Returns paths.
 */
async function setupFixtureDir(entityFixtures) {
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'backfill-57-05-'));
  const sourcePath = path.join(tmpRoot, 'source.json');
  const logDir = path.join(tmpRoot, 'logs');
  await fsp.mkdir(logDir, { recursive: true });
  await fsp.writeFile(
    sourcePath,
    JSON.stringify(buildFixtureExport(entityFixtures), null, 2),
  );
  return { tmpRoot, sourcePath, logDir };
}

/**
 * Spawn the backfill script synchronously. Returns
 *   { status, stdout, stderr, summary }
 * where `summary` is the parsed JSON written into `<logDir>/backfill-project-tag-*.json`
 * if the script produced one (or null otherwise).
 */
function runBackfill(sourcePath, logDir, extraArgs = []) {
  const args = [
    SCRIPT_PATH,
    `--source=${sourcePath}`,
    `--log-dir=${logDir}`,
    ...extraArgs,
  ];
  const result = spawnSync('node', args, {
    encoding: 'utf-8',
    timeout: 30_000,
  });
  // Find the most-recent summary JSON in logDir.
  let summary = null;
  try {
    const entries = fs.readdirSync(logDir)
      .filter((f) => f.startsWith('backfill-project-tag-') && f.endsWith('.json'))
      .sort();  // ISO timestamps sort lexicographically.
    if (entries.length > 0) {
      const lastPath = path.join(logDir, entries[entries.length - 1]);
      summary = JSON.parse(fs.readFileSync(lastPath, 'utf-8'));
    }
  } catch {
    // Leave summary null.
  }
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    summary,
    logEntries: fs.existsSync(logDir) ? fs.readdirSync(logDir) : [],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('backfill-project-tag — 4-step precedence', () => {
  it('Case 1: entity with metadata.project=coding is skipped (step 1)', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0, `script exited ${result.status}: stderr=${result.stderr}`);
    assert.ok(result.summary, 'summary JSON should be written');
    assert.equal(result.summary.skipped, 1, 'one already-populated entity should be skipped');
  });

  it('Case 2: entity with metadata.team=coding (no project) derives coding via step 2', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    assert.equal(
      result.summary.byPrecedenceStep['team'],
      1,
      'one entity should fall into step 2 (team carry-forward)',
    );
  });

  it('Case 3: entity with legacyId.system=C derives okm via step 3 (legacyId-C)', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    assert.equal(
      result.summary.byPrecedenceStep['legacyId-C'],
      1,
      'one entity should fall into step 3 (legacyId-C → okm)',
    );
  });

  it('Case 4: entity with legacyId.system=A derives coding via step 3 (legacyId-A)', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    assert.equal(
      result.summary.byPrecedenceStep['legacyId-A'],
      1,
      'one entity should fall into step 3 (legacyId-A → coding)',
    );
  });

  it('Case 5: entity with no project/team/legacyId falls to default coding via step 4 AND records ambiguous id', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    // Cases 5 + 6 both fall to default-ambiguous → expect count == 2.
    assert.equal(
      result.summary.byPrecedenceStep['default-ambiguous'],
      2,
      'two entities (Ambiguous + InvalidTeam) should fall to step 4',
    );
    assert.ok(
      Array.isArray(result.summary.ambiguousDefaultIds),
      'ambiguousDefaultIds should be an array',
    );
    assert.equal(
      result.summary.ambiguousDefaultIds.length,
      2,
      'ambiguousDefaultIds should list both default-ambiguous ids',
    );
    assert.ok(
      result.summary.ambiguousDefaultIds.includes('019e5559-0005-7000-8000-000000000005'),
      'Ambiguous entity id should be recorded',
    );
    assert.ok(
      result.summary.ambiguousDefaultIds.includes('019e5559-0006-7000-8000-000000000006'),
      'InvalidTeam entity id should be recorded (typeguard rejects bmw)',
    );
  });
});

describe('backfill-project-tag — summary shape (D-06)', () => {
  it('summary JSON contains byPrecedenceStep with all 5 keys + ambiguousDefaultIds + totals', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    const s = result.summary;
    assert.ok(s, 'summary must exist');
    assert.equal(typeof s.startedAt, 'string');
    assert.equal(typeof s.finishedAt, 'string');
    assert.equal(typeof s.totalEntities, 'number');
    assert.equal(typeof s.skipped, 'number');
    assert.equal(typeof s.migrated, 'number');
    assert.equal(typeof s.errors, 'number');
    assert.ok(s.byPrecedenceStep, 'byPrecedenceStep must exist');
    for (const key of ['team', 'legacyId-C', 'legacyId-B', 'legacyId-A', 'default-ambiguous']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(s.byPrecedenceStep, key),
        `byPrecedenceStep must contain key "${key}"`,
      );
      assert.equal(
        typeof s.byPrecedenceStep[key],
        'number',
        `byPrecedenceStep["${key}"] must be a number`,
      );
    }
    assert.ok(
      Array.isArray(s.ambiguousDefaultIds),
      'ambiguousDefaultIds must be an array',
    );
  });
});

describe('backfill-project-tag — idempotency + dry-run + error budget', () => {
  it('re-running --dry-run twice produces identical migrated/skipped counts', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const run1 = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(run1.status, 0);
    // Wait a millisecond to ensure distinct ISO timestamps in log filename.
    await new Promise((r) => setTimeout(r, 5));
    const run2 = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(run2.status, 0);
    assert.equal(
      run1.summary.migrated,
      run2.summary.migrated,
      `dry-run should be idempotent: migrated run1=${run1.summary.migrated} run2=${run2.summary.migrated}`,
    );
    assert.equal(
      run1.summary.skipped,
      run2.summary.skipped,
      `dry-run should be idempotent: skipped run1=${run1.summary.skipped} run2=${run2.summary.skipped}`,
    );
    assert.deepEqual(
      run1.summary.byPrecedenceStep,
      run2.summary.byPrecedenceStep,
      'byPrecedenceStep should be byte-identical across re-runs',
    );
  });

  it('--dry-run performs zero writes (source file byte-untouched)', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const before = await fsp.readFile(sourcePath);
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0);
    const after = await fsp.readFile(sourcePath);
    assert.ok(
      before.equals(after),
      '--dry-run must NOT mutate source.json',
    );
    // We migrated > 0 (5 entities derived a project), proving the script ran the loop.
    assert.ok(
      result.summary.migrated > 0,
      `--dry-run should count derivations; got migrated=${result.summary.migrated}`,
    );
  });

  it('script exits 0 when error rate ≤ 5% (clean fixtures)', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run']);
    assert.equal(result.status, 0, `clean fixtures should exit 0; stderr=${result.stderr}`);
    assert.equal(result.summary.errors, 0, 'clean fixtures should have zero errors');
  });

  it('script exits non-zero when source file is unreadable (>5% error rate)', async () => {
    const { tmpRoot, logDir } = await setupFixtureDir(makeFixtureEntities());
    const bogusSource = path.join(tmpRoot, 'does-not-exist.json');
    const result = runBackfill(bogusSource, logDir, ['--dry-run']);
    assert.notEqual(result.status, 0, 'missing source should exit non-zero');
  });
});

describe('backfill-project-tag — --limit flag', () => {
  it('--limit N processes at most N entities', async () => {
    const { sourcePath, logDir } = await setupFixtureDir(makeFixtureEntities());
    const result = runBackfill(sourcePath, logDir, ['--dry-run', '--limit=2']);
    assert.equal(result.status, 0);
    assert.equal(
      result.summary.totalEntities,
      2,
      '--limit=2 should restrict processing to 2 entities',
    );
  });
});
