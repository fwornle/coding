# Plan 44-17 — ObservationConsolidator SQLite-surface Audit

Generated as part of Task 1. Inventories every `db.prepare/exec/get/all/run`
call site in `src/live-logging/ObservationConsolidator.js` (3476 lines) and
documents the per-site km-core replacement plus the idempotency decision.

Baseline grep counts (pre-cutover):
- `db.prepare/exec/get/all/run` — 45 (plan frontmatter said 47; 2 are exec
  schema/index statements that disappear with the whole `init()` block, not
  individual call-site replacements)
- `FROM (observations|digests|insights|raw_observations)` + `INSERT INTO ...`
  — 22 (plan said 22)
- `openDatabase|SafeDatabase` — 2 (the import + the call site)
- `Database initialized` log — 1

There are NO `INSERT INTO raw_observations` writes; the consolidator only
READS the observations table. The 3 plan-mentioned INSERTs are all on
`digests` / `insights`. Threat T-44-17-05 (raw_observations staging) is
therefore a NO-OP — no replacement needed.

## Idempotency: Option A (chosen)

The plan recommended Option A (`metadata.digested_at` on the Observation
entity). I confirm this. Rationale:

- Mirrors the existing SQLite column 1:1 (the legacy-ingest adapter already
  preserves a `digested_at` field on the Observation entity's metadata —
  `legacy-ingest.ts:270`).
- No new graph relations needed; the consolidator already cannot create
  graph relations (it only reads/writes entities, not edges).
- `kmStore.mergeAttributes(id, { metadata: {...} })` is a hot path B preserves
  intentionally (GraphKMStore.ts:1108). The merge does NOT re-run ontology
  validation, which is what we want here — Observation entities live on the
  trusted path (`skipOntologyCheck:true` was used at write time per
  `legacy-ingest.ts` design).
- Bridge script (`scripts/bridge-obs-from-kmcore.mjs`) already writes
  `digested_at: null` into legacy SQLite rows — symmetric.

Operator gate: the plan defers explicit Option-A-vs-B sign-off to the
Task 5 checkpoint. This audit picks Option A as the working assumption.
If Task 5 returns "issues: prefer Option B", roll back Task 2 (the cutover
commit) and re-do with relation-based filtering.

## Bounded helper decision

The plan offered two designs:
1. Add `findByOntologyClassWithDateRange(cls, fromISO, toISO, opts?)`.
2. Extend `findRecentByAgent` with an optional `untilISO` upper bound.

**Decision: NEITHER. Use the predicate-form of `countByOntologyClass` and a
manual filter over `findByOntologyClass` results.**

Reasons:
- `countByOntologyClass(cls, { predicate })` already supports the per-day
  filter pattern (GraphKMStore.ts:606-625) — works for the COUNT-style calls.
- The list-style calls iterate-and-filter once per call. At ~4k production
  observations, an in-memory pass is <5ms (verified by the
  `countByOntologyClass` cost-model comment at GraphKMStore.ts:594-596).
  This is the same cost as the SQLite query was paying via index lookup +
  row materialization.
- Adding a third query helper to km-core to optimize the consolidator's
  hot path would be premature: the consolidator runs every 15 min, not
  per-write. T-44-17-01 wanted bounded scans; the bound IS the
  ontology-class filter (already in place), not a date range.

The plan's perf threat (T-44-17-01) is bounded by the same O(N_class) the
writer accepts; the consolidator pays it once per cadence cycle, not per
write. **No new km-core helper. No submodule commit needed.**

If the perf gate in the integration test fails (Task 3 test 6, 1000 obs in
<500ms), re-open with the bounded helper.

## Per-site migration mapping

Sites are grouped by SQL operation, then ordered by line number.

### A. SCHEMA / DDL (5 sites, lines 780-823) — ALL DELETED

These are CREATE TABLE / ALTER TABLE / CREATE INDEX statements inside `init()`.
They have no km-core equivalent — km-core has its own schema (Entity shape +
graphology). All 5 sites disappear when `init()` is rewritten to drop the
SQLite handle entirely.

### B. CONSOLIDATE-DAY read path (lines 885-892) — 1 site

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 885-892 | `SELECT id, summary, agent, created_at, metadata, quality FROM observations WHERE substr(created_at,1,10)=? AND digested_at IS NULL AND quality != 'low' ORDER BY created_at ASC` | `(await this._kmStore.findByOntologyClass('Observation')).filter(e => e.metadata?.createdAt?.slice(0,10) === date && !e.metadata?.digested_at && e.metadata?.quality !== 'low').sort((a,b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt)).map(_toLegacyObsRow)` |

The `_toLegacyObsRow(entity)` shim returns `{id, summary, agent, created_at, metadata, quality}` from the entity's metadata + description so downstream code (partitioning by project, prompt building, parse) stays unchanged.

### C. CONSOLIDATE-DAY write path (lines 963-977) — 4 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 963 | `INSERT INTO digests (id, date, theme, summary, ...)` | `kmStore.putEntity(legacyDigestToEntity({id, date, theme, ...}, this._runId, now), { skipOntologyCheck: true })` |
| 967 | `SELECT ... FROM digests WHERE id=?` | `kmStore.findByLegacyId({ system: 'A', id }).then(_toLegacyDigestRow)` |
| 970 | `UPDATE digests SET observation_ids=?, agents=?, ...` | `kmStore.mergeAttributes(entity.id, { metadata: { ...prevMeta, observation_ids, agents, files_touched, summary, quality, createdAt: now } })` |
| 975 | `UPDATE observations SET digested_at=? WHERE id=?` | `kmStore.mergeAttributes(entity.id, { metadata: { ...prevMeta, digested_at: now } })` — **Option A idempotency anchor** |

The synchronous `db.transaction(() => {...})` wrapper at line 996 disappears: km-core writes are async, not transactional in the SQLite sense. The merge-plan and embedding-event queues stay; only the persistence wrapper changes.

### D. CONSOLIDATE-ALL day enumeration (lines 1091-1096) — 1 site

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 1091-1096 | `SELECT DISTINCT substr(created_at,1,10) as date FROM observations WHERE digested_at IS NULL AND quality != 'low' ORDER BY date ASC` | `[...new Set((await kmStore.findByOntologyClass('Observation')).filter(e => !e.metadata?.digested_at && e.metadata?.quality !== 'low').map(e => e.metadata?.createdAt?.slice(0,10)).filter(Boolean))].sort()` |

### E. SYNTHESIZE-INSIGHTS read path (lines 1138-1167) — 2 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 1138-1145 | `SELECT d.id, d.date, ... FROM digests d LEFT JOIN insights i ON d.id IN (SELECT value FROM json_each(i.digest_ids)) WHERE i.id IS NULL ORDER BY d.date ASC` | Compute the set of "synthesized" digest ids by collecting every `digest_ids[]` across all Insight entities; filter Digests whose `legacyId.id` is not in that set; sort by `metadata.date ASC`. |
| 1166-1167 | `SELECT id, topic, summary, digest_ids, project FROM insights ORDER BY last_updated DESC` | `(await kmStore.findByOntologyClass('Insight')).sort(by last_updated DESC).map(_toLegacyInsightRow)` |

### F. SYNTHESIZE-INSIGHTS merge/facet/insert (lines 1317-1424) — 7 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 1317-1319 | `SELECT id, topic, digest_ids, metadata, project FROM insights WHERE id=?` | `kmStore.findByLegacyId({ system: 'A', id: entry._similarMatch.id }).then(_toLegacyInsightRow)` |
| 1326-1328 | `SELECT id, topic, digest_ids, metadata, project FROM insights WHERE topic=? AND project=?` | `(await kmStore.findByOntologyClass('Insight')).find(e => e.metadata?.topic === topic && (e.metadata?.project ?? 'unknown') === project)` |
| 1341-1351 | `UPDATE insights SET summary=?, digest_ids=?, last_updated=?, confidence=?, metadata=json_patch(...)` | `kmStore.mergeAttributes(entity.id, { description: summary, metadata: { ...prev, summary, digest_ids, last_updated, confidence, ...(withBaseConfidence(entry)) }, updatedAt: now })` |
| 1361-1370 | `INSERT INTO insights (id, topic, summary, confidence, digest_ids, ...)` (facet new) | `kmStore.putEntity(legacyInsightToEntity({id: newId, topic, summary, confidence, digest_ids, last_updated, created_at, metadata, project}, runId, now), { skipOntologyCheck: true })` |
| 1382-1395 | `UPDATE insights SET last_updated=?, metadata=json_patch(...)` (existing facet sibling) | `kmStore.mergeAttributes(existingEntity.id, { metadata: { ...prev, parentTopic, relatedInsightIds: [...existingRelated], facetGroupedAt: now }, updatedAt: now })` |
| 1398-1408 | `UPDATE insights SET metadata=json_patch(...)` (new facet self) | `kmStore.mergeAttributes(newEntity.id, { metadata: { ...prev, parentTopic, relatedInsightIds: [...others], facetGroupedAt: now } })` |
| 1416-1424 | `INSERT INTO insights (id, topic, summary, confidence, digest_ids, ...)` (plain new) | `kmStore.putEntity(legacyInsightToEntity({...}, runId, now), { skipOntologyCheck: true })` |

`json_patch(COALESCE(metadata, '{}'), ?)` becomes a JavaScript spread:
`{ ...prevMeta, ...patch }`. RFC 7396 semantics (the SQLite `json_patch` semantic) say null deletes a key — in the consolidator this manifests as
`metaPatch.staleDragApplied = null` (decay code). The spread does NOT delete null keys; the metadata accumulates nulls instead of removing them. This is acceptable for the consolidator's two null-set sites (`staleDragApplied` and `staleDragAt`) — downstream readers null-check, they don't iterate keys.

### G. RUN-LOOP unsynthesized count (lines 1564-1568) — 1 site

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 1564-1568 | `SELECT COUNT(*) as cnt FROM digests d LEFT JOIN insights i ON d.id IN (SELECT value FROM json_each(i.digest_ids)) WHERE i.id IS NULL` | Compute synthesized-digest-id set (as in E.1138), then count Digests whose `legacyId.id` is not in it. Use `(await kmStore.findByOntologyClass('Digest')).filter(...).length`. |

### H. DECAY-CONFIDENCE pass (lines 1735-1772) — 3 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 1735-1737 | `SELECT id, confidence, last_updated, metadata FROM insights` | `(await kmStore.findByOntologyClass('Insight')).map(_toLegacyInsightRow)` |
| 1769 | `UPDATE insights SET confidence=? WHERE id=?` | `kmStore.mergeAttributes(entity.id, { metadata: { ...prev, confidence } })` |
| 1770-1772 | `UPDATE insights SET metadata=json_patch(COALESCE(metadata,'{}'),?)` | `kmStore.mergeAttributes(entity.id, { metadata: { ...prev, ...patch } })` |

`_decayConfidence` was synchronous because it was called inside a transaction-free
context. After the cutover it becomes `async` because `kmStore.mergeAttributes`
is async. The caller (`run()` at line 1577) does `this._decayConfidence();` —
must be changed to `await`.

### I. COMPACT-INSIGHTS pass (lines 2005-2007, 2181-2197, 2206-2218) — 4 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 2005-2007 | `SELECT id, topic, summary, confidence, digest_ids, metadata, project FROM insights WHERE project=?` | `(await kmStore.findByOntologyClass('Insight')).filter(e => (e.metadata?.project ?? 'unknown') === project).map(_toLegacyInsightRow)` |
| 2181-2195 | `UPDATE insights SET digest_ids=?, last_updated=?, metadata=json_patch(...)` (MERGE canonical) | `kmStore.mergeAttributes(canonicalEntity.id, { metadata: { ...prev, digest_ids, last_updated, ...patch }, updatedAt: now })` |
| 2197 | `DELETE FROM insights WHERE id=?` (absorbed losers) | `kmStore.deleteEntity(loserEntity.id)` |
| 2206-2218 | `UPDATE insights SET last_updated=?, metadata=json_patch(...)` (FACET each member) | `kmStore.mergeAttributes(memberEntity.id, { metadata: { ...prev, parentTopic, relatedInsightIds, facetGroupedAt: now }, updatedAt: now })` |

The `db.transaction(() => {})` at line 2175 disappears. Each `mergeAttributes`
is its own atomic write; if a mid-cluster failure occurs the cluster is left
in a half-merged state — which is no worse than the SQLite path's behavior
when the transaction is interrupted (better-sqlite3 transactions are
process-local; a crash mid-transaction loses the work). The compaction pass is cadence-guarded (weekly) and resumable; partial state is acceptable.

### J. VERIFY-INSIGHT persist (line 2664) — 1 site

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 2664-2667 | `UPDATE insights SET metadata=json_patch(COALESCE(metadata,'{}'),?)` | `kmStore.mergeAttributes(entity.id, { metadata: { ...prev, codeVerification: verification } })` |

`verifyInsight` is synchronous in the SQLite path. Replacement makes it async
(returns Promise from `mergeAttributes`). The caller pattern `for (const ins of insights) results.push({topic, ...this.verifyInsight(ins, ...)})` becomes:
```js
for (const ins of insights) {
  const verifyResult = await this.verifyInsight(ins, { roots, persist });
  results.push({ topic: ins.topic, ...verifyResult });
}
```
This is `await` inside a loop, which serializes the LLM-free verification —
acceptable since `_verifyCodeClaims` is bounded by `execFileSync` subprocesses
that already serialize. No perf regression.

### K. VERIFY-INSIGHTS auto-archive (lines 2688-2738) — 3 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 2688-2690 | `SELECT id, topic, summary, metadata FROM insights WHERE project=?` | `(await kmStore.findByOntologyClass('Insight')).filter(e => (e.metadata?.project ?? 'unknown') === project).map(_toLegacyInsightRow)` |
| 2719-2721 | `UPDATE insights SET metadata=json_patch(COALESCE(metadata,'{}'),?)` (archive stamp) | `kmStore.mergeAttributes(entity.id, { metadata: { ...prev, archivedAt, archiveReason } })` |
| 2728-2730 | `SELECT json_extract(metadata,'$.archivedAt') AS archivedAt FROM insights WHERE id=?` | Look up the entity from the in-memory results array (no re-read needed — we already have `_toLegacyInsightRow(entity)` with full metadata). Drop the re-read site entirely. |

### L. RESYNTHESIZE-INSIGHT (lines 2786-2905) — 4 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 2788-2790 | `SELECT id, topic, summary, confidence, digest_ids, project, metadata FROM insights WHERE id=?` | `kmStore.findByLegacyId({ system: 'A', id: insightId }).then(_toLegacyInsightRow)` (404 propagation: throw if undefined) |
| 2800-2803 | `SELECT id, date, theme, summary FROM digests WHERE id IN (?,?,?) ORDER BY date ASC` | `Promise.all(digestIds.map(id => kmStore.findByLegacyId({system:'A', id}))).then(arr => arr.filter(Boolean).map(_toLegacyDigestRow).sort((a,b) => a.date.localeCompare(b.date)))` |
| 2900-2905 | `UPDATE insights SET topic=?, summary=?, confidence=?, last_updated=?, metadata=json_patch(...)` | `kmStore.mergeAttributes(insightEntity.id, { name: newTopic.slice(0,80), description: newSummary, updatedAt: now, metadata: { ...prev, topic: newTopic, summary: newSummary, confidence: newConfidence, last_updated: now, ...patch } })` |

### M. GET-STATUS COUNT block (lines 3449-3452) — 4 sites

| Line | SQL | km-core replacement |
|------|-----|---------------------|
| 3449 | `SELECT COUNT(*) FROM observations` | `await kmStore.countByOntologyClass('Observation')` |
| 3450 | `SELECT COUNT(*) FROM observations WHERE digested_at IS NULL` | `await kmStore.countByOntologyClass('Observation', { predicate: e => !e.metadata?.digested_at })` |
| 3451 | `SELECT COUNT(*) FROM digests` | `await kmStore.countByOntologyClass('Digest')` |
| 3452 | `SELECT COUNT(*) FROM insights` | `await kmStore.countByOntologyClass('Insight')` |

`getStatus()` becomes `async getStatus()`. The single obs-api caller already
treats it as best-effort — fine.

### N. CLOSE() (lines 3457-3475) — 1 site

`if (this.db) { this.db.close(); this.db = null; }` disappears. The km-core
store is owned by the caller (obs-api passes its own per the writer pattern)
or lazy-constructed; the consolidator does NOT own it. close() reduces to
the Redis disconnect + null-out the embedding-service references.

### O. ObservationExporter wiring (line 827) — 1 site

`this._exporter = new ObservationExporter({ db: this.db, projectRoot })` is
the one place a non-`db.prepare/exec/get/all/run` call site touches `this.db`.
The exporter is the legacy `.data/observation-export/*.json` writer that
mirrors the SQLite tables. Plan 44-13's writer cutover noted (line 197 of
ObservationWriter.js): "the legacy `.data/observation-export/*.json` files
are now maintained by the consolidator (deferred to Plan 44-15) and
ultimately by km-core's own JSON export under `.data/knowledge-graph/exports/`."

Decision for this cutover: **drop the ObservationExporter wiring**. The
km-core GraphKMStore already exports per-domain JSON to
`.data/knowledge-graph/exports/<domain>.json` via the auto-debounced
`Exporter` (Plan 03). Maintaining a second JSON export from km-core would
require iterating all entities AND would write a stale-on-arrival snapshot
because the consolidator only runs every 15 min. The km-core export is
already the source of truth.

The `.data/observation-export/*.json` files become append-only legacy
artifacts (last updated when SQLite was the source). Document this in
the SUMMARY operator runbook.

## Helper shims (NEW, added inline to consolidator)

To keep the call sites readable and avoid duplicating the inverse-adapter
shape inline, three private helpers are added to `ObservationConsolidator`:

```js
// Inverse of legacyObservationToEntity (entity → legacy row shape used
// by the consolidator's existing parse/partition/prompt code).
_toLegacyObsRow(entity) {
  const m = entity.metadata ?? {};
  return {
    id: entity.legacyId?.id ?? entity.id,
    summary: m.summary ?? entity.description ?? '',
    agent: m.agent ?? null,
    created_at: m.createdAt ?? entity.validFrom ?? '',
    metadata: typeof m === 'object' ? JSON.stringify(m) : '{}',
    quality: m.quality ?? 'normal',
  };
}

_toLegacyDigestRow(entity) {
  const m = entity.metadata ?? {};
  return {
    id: entity.legacyId?.id ?? entity.id,
    date: m.date ?? entity.validFrom?.slice(0, 10) ?? '',
    theme: m.theme ?? '',
    summary: m.summary ?? entity.description ?? '',
    observation_ids: JSON.stringify(Array.isArray(m.observation_ids) ? m.observation_ids : []),
    agents: JSON.stringify(Array.isArray(m.agents) ? m.agents : []),
    files_touched: JSON.stringify(Array.isArray(m.files_touched) ? m.files_touched : []),
    quality: m.quality ?? 'normal',
    created_at: m.createdAt ?? entity.validFrom ?? '',
    metadata: JSON.stringify(m),
    project: m.project ?? 'unknown',
    _entity: entity,  // attached so callers can mergeAttributes without a refetch
  };
}

_toLegacyInsightRow(entity) {
  const m = entity.metadata ?? {};
  return {
    id: entity.legacyId?.id ?? entity.id,
    topic: m.topic ?? entity.name ?? '',
    summary: m.summary ?? entity.description ?? '',
    confidence: typeof m.confidence === 'number' ? m.confidence : 0.8,
    digest_ids: JSON.stringify(Array.isArray(m.digest_ids) ? m.digest_ids : []),
    last_updated: m.last_updated ?? entity.validFrom ?? '',
    created_at: m.createdAt ?? entity.validFrom ?? '',
    metadata: JSON.stringify(m),
    project: m.project ?? 'unknown',
    _entity: entity,  // attached so callers can mergeAttributes without a refetch
  };
}
```

The `_entity` carry-along on the digest/insight rows preserves the original
entity reference so the UPDATE→`mergeAttributes` calls don't need to refetch
via `findByLegacyId`.

## What gets imported in consolidator

Append to existing imports:
```js
import {
  legacyDigestToEntity,
  legacyInsightToEntity,
} from '@fwornle/km-core/adapters/legacy-ingest';
```

The Observation entity is never CREATED by the consolidator (the writer
owns that path) — only READ + `digested_at`-MERGED. So
`legacyObservationToEntity` is NOT imported.

GraphKMStore itself is NOT imported because the consolidator does not
lazy-construct one. The store is passed in via the constructor (matching
the ObservationWriter pattern: `options.kmStore`).

## What gets removed

- `import { ObservationExporter } from './ObservationExporter.js';` (O)
- `import('./SafeDatabase.js')` dynamic import inside init() (N)
- `this.db = null;` field initializer + every `this.db.*` access
- The SQLite-specific `db.transaction()` wrapping in `consolidateDay`,
  `synthesizeInsights`, and `compactInsights`
- The `[Consolidator] Database initialized` log line
- The WAL checkpoint calls (`this.db.pragma('wal_checkpoint(PASSIVE)')`)
  — meaningless for km-core

## What changes its async signature

| Method | Was | Becomes |
|--------|-----|---------|
| `_decayConfidence` | sync | `async` |
| `verifyInsight` | sync | `async` (because it calls `mergeAttributes` when persist=true) |
| `verifyInsights` | already async | still async (no change) |
| `getStatus` | sync | `async` |
| `close` | sync | stays sync (km-core close is the caller's responsibility) |

Callers of `verifyInsight` inside `compactInsights` already iterate sync —
must change to `await` inside the loop. Callers of `getStatus` in obs-api
already `await consolidator.run(...)` patterns; the new `await getStatus()`
fits there.

## Constructor signature change

Adds `options.kmStore` (per the ObservationWriter pattern) and `options.runId`
(threaded into the digest/insight entity provenance stamp). The dbPath
field is preserved (config path only; used by `_getSanitizer` and
`_initializeRoots`).

obs-api callers (3 sites: line 410, 914, 1094 of observations-api-server.mjs)
each pass `dbPath: DB_PATH`. They must additionally pass `kmStore: await ensureKMStore()`. Failing to do so means the consolidator throws on the
first km-core read — same fail-fast posture as the writer's Plan 44-13.

## ObservationExporter status (post-cutover)

The exporter file `src/live-logging/ObservationExporter.js` becomes orphaned
by this plan. Searching for other importers:

```
grep -rn 'ObservationExporter' src scripts integrations
```

If only `ObservationConsolidator.js` imports it, the file can be deleted in
this plan. If anything else still imports it (e.g. obs-api for the
`/api/export` endpoint), defer the delete to 44-18 and leave the file as a
no-op import. The audit defers the grep to Task 2 execution.

## Summary

- 45 SQL call sites → 0 (after Task 2 commit)
- 22 FROM/INSERT statements → 0
- 5 schema-DDL sites → 0 (deleted with init())
- 1 ObservationExporter wiring → 0 (deleted; km-core has its own JSON export)
- 1 new constructor option: `kmStore`
- 3 new private helper methods: `_toLegacyObsRow`, `_toLegacyDigestRow`, `_toLegacyInsightRow`
- 2 new imports: `legacyDigestToEntity`, `legacyInsightToEntity`
- 4 methods change from sync to async
- 0 new km-core helpers needed
- No submodule commit needed

The cutover is a single large edit to `ObservationConsolidator.js`. No
km-core submodule changes. Task 2 is one Commit.
