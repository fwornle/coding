# Plan 44-18 Audit — Pruner + Retrieval SQLite Surface

Date: 2026-06-05
Branch/HEAD: `156b7e6a2` (post-44-17 close)

## 1. Remaining SQLite call sites (4 statements across 2 files)

| # | File | Line | Statement | Purpose |
|---|------|------|-----------|---------|
| 1 | `src/live-logging/ObservationPruner.js` | 67 | `SELECT datetime('now', ?) AS t` | Cutoff calc (echo cutoff timestamp for log) |
| 2 | `src/live-logging/ObservationPruner.js` | 70 | `DELETE FROM observations WHERE created_at < datetime('now', ?)` | Retention prune (observations) |
| 3 | `src/live-logging/ObservationPruner.js` | 71 | `DELETE FROM digests WHERE created_at < datetime('now', ?)` | Retention prune (digests) |
| 4 | `src/retrieval/retrieval-service.js` | 341 | `SELECT id, json_extract(metadata, '$.codeVerification.verificationRatio') AS ratio FROM insights WHERE id IN (...)` | Freshness-rerank metadata lookup |

## 2. km-core replacement map

| SQLite | km-core |
|--------|---------|
| `SELECT datetime('now', ?)` | JS: `new Date(Date.now() - retentionDays*86400000).toISOString()` |
| `DELETE FROM observations WHERE created_at < ?` | `kmStore.findByOntologyClass('Observation')` → filter `entity.createdAt < cutoffISO` → loop `kmStore.deleteEntity(e.id)` |
| `DELETE FROM digests WHERE created_at < ?` | Same pattern for `'Digest'` class |
| `SELECT json_extract(metadata, '$.codeVerification.verificationRatio') FROM insights WHERE id IN (...)` | `await Promise.all(ids.map(id => kmStore.findByLegacyId({system:'A', id}).then(e => e?.metadata?.codeVerification?.verificationRatio)))` |

### 2a. Metadata path confirmation (post-cutover Insight entity)

Confirmed from `node_modules/@fwornle/km-core/dist/adapters/legacy-ingest.js:210-235` (`legacyInsightToEntity`):

```js
metadata: {
    ...meta,                      // <— SQLite `metadata` JSON blob spread verbatim
    topic: row.topic,
    summary: row.summary,
    // ...
    createdAt: row.created_at,
},
```

The legacy SQLite `metadata` JSON-blob column is spread into `entity.metadata` via `...meta`. SQLite insights carried
`metadata.codeVerification.verificationRatio` (set by `ObservationConsolidator.verifyInsights`). After
the legacy-ingest adapter spread, the same path is preserved on the km-core entity: `entity.metadata.codeVerification.verificationRatio`.

Confirmed live: querying `/api/coding/insights?limit=1` returns the canonical view shape; raw entity carries
`metadata.codeVerification` for verified insights (sampling shows topic + summary + confidence + digestIds in the view-reshaped output; raw entity exposes the full metadata blob).

### 2b. Pruner cutoff field — `entity.createdAt` (top-level), NOT `metadata.created_at`

The plan-mapping table referenced `metadata.created_at`, but `legacyObservationToEntity`
(`node_modules/@fwornle/km-core/dist/adapters/legacy-ingest.js:135-164`) stamps:

- top-level `entity.createdAt = row.created_at`
- `metadata.createdAt = row.created_at` (camelCase, NOT snake_case)

There is no `metadata.created_at` (snake_case) on a post-cutover entity. Both top-level `createdAt`
and `metadata.createdAt` carry the same ISO-8601 string. The pruner will compare against
**top-level `entity.createdAt`** since it is:

- the authoritative field on the Entity contract (D-31 stamping target)
- always present on every entity that flowed through legacy-ingest OR the writer's own create path
- compatible with the lexicographic ISO-8601 comparison strategy already used by km-core's `findRecentByAgent`

## 3. obs-api plumbing to remove (Task 4)

| Line(s) | Symbol | Action |
|---------|--------|--------|
| 40 | `import { openDatabase as openLegacyDb } from '../src/live-logging/SafeDatabase.js'` | DELETE |
| 90 | `let _legacyDb = null` | DELETE |
| 91-101 | `function ensureLegacyDb() { ... }` | DELETE |
| 142 | `_retrieval = new RetrievalService({ dbGetter: () => ensureLegacyDb() })` | REPLACE with `new RetrievalService({ kmStoreGetter: () => _kmStore || null })` (or `kmStore: await ensureKMStore()` eager — Task 3 decides) |
| 163-165 | pruner construction with `db: legacyDb` | REPLACE with `new ObservationPruner({ kmStore, retentionDays })` |
| 1536-1542 | shutdown handler `if (_legacyDb) { ... }` | DELETE |
| 68 | `const DB_PATH = ...` | KEEP for Task 5 archive rename target (commented as such); drop in Task 5 cleanup if archive succeeds |

## 4. External `observations.db` references audit

`grep -rlE 'observations\.db' . --include='*.js' --include='*.mjs' --include='*.ts' --include='*.sh' --include='*.json'`
returned **32 files** (filtered for node_modules / specstory / .planning / archived / .data). Bucketing:

### 4a. Production runtime code (in scope for this plan)

- `scripts/observations-api-server.mjs` — cut in Task 4
- `src/live-logging/ObservationPruner.js` — cut in Task 2
- `src/retrieval/retrieval-service.js` — cut in Task 3

### 4b. Test files (out of scope — use tmpdir SQLite, not production file)

- `tests/integration/obs-api.legacy-endpoints.km-core.test.js`
- `tests/integration/observation-consolidator.km-core.test.js`
- `tests/integration/sub-agent-live-opencode.test.js`
- `tests/live-logging/ObservationExporter.source-field.test.js`
- `tests/live-logging/resolve-observations-from-lsl.test.js`
- `tests/live-logging/adapter-opencode.test.js`
- `tests/live-logging/ObservationPruner.test.js` — rewritten in Task 2 (uses tmpdir GraphKMStore now)

These all spin up tmpdir-isolated DBs; the production `.observations/observations.db` rename is invisible to them.

### 4c. Utility / maintenance scripts (out of scope — operator tools, not runtime)

These scripts run on demand to repair, migrate, or backfill the SQLite file. They are NOT part of any
production code path after Plan 44-17. None are launchd-managed. They will become non-functional after the
Task 5 archive, which is acceptable — by definition they target a SQLite file the system no longer uses.

- `scripts/backfill-raw-observations.mjs` / `.js` — backfill helper for stuck `[Raw]` rows; pre-44-17 use case
- `scripts/dedupe-observations.mjs`, `scripts/dedup-digests-by-embedding.js`, `scripts/dedup-insights-by-embedding.js` — pre-cutover dedup helpers
- `scripts/cleanup-useless-observations.mjs`, `scripts/sanitize-observations.js`, `scripts/repair-redaction-corruption.js`, `scripts/consolidate-observations.js`, `scripts/consolidate-insight-clusters.mjs`, `scripts/compact-insights.mjs` — one-shot data-hygiene scripts
- `scripts/verify-insight-claims.mjs`, `scripts/prune-orphan-vectors.mjs`, `scripts/resolve-observations-from-lsl.mjs`, `scripts/restore-observations-from-export.js`, `scripts/dedup-digests-by-embedding.js` — diagnostic/repair scripts
- `scripts/migrate-sqlite-to-kmcore.mjs`, `scripts/migrate-add-project-column.js` — completed migration scripts
- `scripts/sub-agent-live-opencode.mjs`, `lib/lsl/adapters/opencode-sqlite.mjs` — read opencode's OWN SQLite, not the project one (path string matches but it's `opencode.db` not `observations.db`)
- `scripts/start-services-robust.js` — referenced only in a comment/log
- `src/embedding/backfill.ts` (line 5, 358) — pre-44-12 backfill, references `.observations/observations.db` as input source. Out of scope; will be archived along with the file (Task 5).

### 4d. Documentation / comments (no action)

- `integrations/system-health-dashboard/server.js` (lines 24, 4151, 4453, 4617) — comments noting the dashboard intentionally does NOT open observations.db; clarifying why the HTTP proxy exists. These are accurate post-44-17 and post-44-18 and need no update.
- `install.sh:2991` — `"storagePath": ".observations/observations.db"` in a JSON config blob the installer writes. Out of scope for this plan; would matter only on a fresh installation, where the operator should be told the file is being archived. Leave alone for now; revisit if a fresh-install bug surfaces.

## 5. T-44-18-01 mitigation strategy (pruner delete loop)

Per the threat-model entry: chunk the delete loop to 100 ids per `Promise.all` batch. Log progress every batch so a long prune is observable. Perf gate: 1000-obs prune ≤ 1s on this machine, asserted in the integration test (Task 4).

The km-core `deleteEntity` is a single-node graph mutation + LevelDB delete + debounced export schedule, so 100 in-flight deletes parallel-stream cleanly without overwhelming the LevelDB lock. If a bulk `deleteEntities([])` helper lands later, swap in (one-line change).

## 6. T-44-18-02 mitigation strategy (rerank lookup)

`Promise.all(ids.map(id => kmStore.findByLegacyId({system:'A', id})))` — each call is an O(N) ontology-class scan today (no legacyId index). At ~3.9k entities and typical 20-id rerank batches: 20 × ~5ms = ~100ms worst case. Perf gate: ≤ 50ms in test setup with controlled seeding (test seeds 5 insights, so cost is 5 × sub-ms = trivial).

Note: in production at 4k entities the per-call cost will scale (~5ms each on the audit machine, so ~100ms for 20 ids). If this becomes a tight budget the mitigation is the same path as the consolidator's `findRecentByAgent`-style helper — a future `getEntitiesByLegacyIds(['ids'])` helper in km-core would be the right shape. Not blocking this plan.

## 7. Pruner construction site decision

`scripts/observations-api-server.mjs:163-165` — pruner is constructed AFTER `ensureWriter()` resolves, at which point `_writer.retentionDays` is known. The construction site already has access to `ensureKMStore()` via `ensureWriter` itself (Plan 44-12 wired them in series). The natural shape:

```js
const kmStore = await ensureKMStore();
if (!kmStore) return null;
_pruner = new ObservationPruner({ kmStore, retentionDays: _writer.retentionDays });
```

`ensureKMStore()` is called from many sites and is memoised, so the extra call is free.

## 8. Retrieval construction site decision — `kmStoreGetter` (lazy) vs `kmStore` (eager)

`ensureRetrieval()` (`scripts/observations-api-server.mjs:135-148`) currently constructs the service eagerly at first GET, passing `dbGetter: () => ensureLegacyDb()`. This pattern is lazy: the SQLite handle is opened on-demand inside `_applyFreshnessRerank`, not at construction.

We will preserve that lazy semantics by introducing `kmStoreGetter` — a thin equivalent that returns the km-core store handle (or null while it's still initializing). The service stays construction-eager but DB-access-lazy. This matches the existing pattern with no behavior change for callers.

## 9. Acceptance gates (all 5)

| Task | Gate | Command |
|------|------|---------|
| 2 | Pruner free of SQLite calls | `grep -cE '\bdb\.(prepare\|exec\|get\|all\|run)\b' src/live-logging/ObservationPruner.js` → 0 |
| 2 | Pruner free of SQL | `grep -c 'DELETE FROM' src/live-logging/ObservationPruner.js` → 0 |
| 2 | Pruner uses kmStore | `grep -c 'kmStore' src/live-logging/ObservationPruner.js` → ≥ 3 |
| 3 | Retrieval free of `db.prepare` | `grep -c 'db\.prepare' src/retrieval/retrieval-service.js` → 0 |
| 3 | Retrieval uses kmStore | `grep -c 'kmStore' src/retrieval/retrieval-service.js` → ≥ 2 |
| 4 | obs-api free of legacyDb plumbing | `grep -cE '_legacyDb\|openLegacyDb\|SafeDatabase\|ensureLegacyDb' scripts/observations-api-server.mjs` → 0 |
| 4 | obs-api free of observations.db refs | `grep -cE 'observations\.db' scripts/observations-api-server.mjs` → 0 or 1 (only DB_PATH if still kept for Task 5 archive target) |

## 10. Decisions

- **D-44-18-01**: Pruner cutoff comparison uses **top-level `entity.createdAt`**, NOT `metadata.created_at`. The latter doesn't exist on post-cutover entities. The audit confirms `legacyObservationToEntity` stamps `entity.createdAt = row.created_at` (line 159) and also stamps `metadata.createdAt` (camelCase); we use the canonical top-level field.
- **D-44-18-02**: Delete loop chunks to 100 ids, with `process.stderr.write` progress log per chunk. Matches T-44-18-01 mitigation.
- **D-44-18-03**: Retrieval uses `kmStoreGetter` (lazy) to mirror the existing `dbGetter` pattern. No behavior change for callers.
- **D-44-18-04**: `DB_PATH` constant stays in obs-api through Task 4, with a "Task 5 archive target only — drop after archive" comment. Task 5 cleanup drops it.
- **D-44-18-05**: `tests/live-logging/ObservationPruner.test.js` is **rewritten** (option a from Plan Task 2 step 5) to use a tmpdir GraphKMStore + write Observation/Digest entities + assert prune behavior. The legacy SQLite invariant tests (FTS5 sync, SQLite error messages, "no 'insights' substring") are dropped or adapted — FTS5 is no longer relevant; the error-message invariant moves to the km-core handle check; the source-grep invariant stays.

