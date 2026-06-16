# Phase 59: Digest / Insight Writer-Edge Repair — Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 5 new/modified surfaces
**Analogs found:** 5 / 5 (every site has at least one on-disk analog with concrete excerpts)

## Drift from CONTEXT.md — verified on disk

CONTEXT.md was written 2026-06-15 and quotes a few line numbers / names that need correction. Planner should consume the corrected coordinates below:

| CONTEXT.md says | On disk (verified 2026-06-16) | Correction |
|---|---|---|
| `_executeDigestStage` method at `OC.js:~1149-1320` | No method by that name exists. Digest insert lives in `consolidateDay` (entry `OC.js:1093`); the insert block is `OC.js:1215-1297` (the `for (let i = 0; i < digestEntries.length; i++) { … }` loop). The plain-insert branch is `OC.js:1271-1296`. | Planner should refer to "the digest-insert loop inside `consolidateDay` at `OC.js:1215-1297`" — there is no separate `_executeDigestStage` to find with grep. |
| `_pushInsightToKG` writer-signature consumer at `OC.js:660-661` | Exact match. `OC.js:659` is `await writer.writeInsight(row, { mentionsTargetIds })`; `:660-661` is the `findByLegacyId` race the writer-signature refactor closes. | OK. |
| `has_insight` follower at `OC.js:679-705` (D-03.2) | Exact match. | OK. |
| `bridgeRemainingOrphans` at `OC.js:1903-1925` | Method is now `_relinkOrphanOnlineInsights` at `OC.js:2045`. The Phase 58 "bridge" extension at `:2148, :2188` uses `mentions` dedup probes. | Planner reads `_relinkOrphanOnlineInsights` — name changed since CONTEXT.md was written. Phase 59 D-03 still does **not** extend it. |
| `ObservationWriter.writeInsight` at line `~1165` | Method is at `OW.js:1284`; the existing `return row.id` is at `OW.js:1315`. | Update the D-03 refactor target line. |
| `ObservationWriter._anchorEntity` at line `~412` | `_anchorEntity` is at `OW.js:425`. `_resolveAnchorId` is at `OW.js:385`. The `addRelation('capturedBy')` is at `OW.js:430-435`. | Update line numbers in plans. |
| `derivedFrom` literal at `observation-generation-agent.ts:1396-1397` | Confirmed at `:1396` (`relationType: 'derivedFrom'`) and `:1397` (`type: 'derivedFrom'`). | OK. |
| `OC.js:1294` `findByLegacyId` to resolve observation ids | The current code at `:1294` is `await kmStore.putEntity(entity, { skipOntologyCheck: true });`. The new `addRelation` loop must be inserted at `:1295` (or `:1296`, between `createdCount++` and the `digestedObsIds.add` line). | New code lands BETWEEN existing `:1294` `putEntity` and `:1295` `createdCount++`. |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/live-logging/ObservationConsolidator.js` (digest-insert loop edit) | writer-fix | km-core `putEntity` + N×`addRelation` + `findByLegacyId` | `OC.js:679-705` (has_insight follower, post-Phase 58) + `OW.js:478-522` (`_emitMentionsEdges`) | exact (in-file analog) |
| `src/live-logging/ObservationConsolidator.js` (`_pushInsightToKG` refactor :660-661) | signature-refactor consumer | discards `findByLegacyId` race; reads `mintedId` from writer return | The Phase 58 introduction of the writer-route-through itself at `OC.js:656-661` | exact (same file, same function) |
| `src/live-logging/ObservationWriter.js` (`writeInsight` return-shape refactor) | signature-refactor | km-core `putEntity` minted id propagation | `OW.js:1217-1240` (`writeDigest`) returns `row.id` — sibling writer, same return convention; the refactor changes BOTH `writeInsight` and (optionally) `writeDigest` for symmetry | role-match (sibling writers in same file) |
| `scripts/repair-orphan-digest-insight-edges.mjs` (NEW one-shot script) | one-shot-script | HTTP `GET /api/v1/graph/orphans` → `findByLegacyId` × N → probe-before-write `addRelation` × N; Layer 2: read+scrub+atomic-rename `.data/observation-export/digests.json` | Layer 1: `scripts/purge-kmcore-orphans.mjs` (1:1) + `scripts/link-collective-to-projects.mjs` (addRelation idiom); Layer 2: `scripts/evict-ghost-digests.mjs` (1:1 — same target file, same tmp+rename) | exact (two-layer split has two distinct exact analogs) |
| `scripts/poll-orphan-floor-soak.mjs` (NEW polling harness) | polling-script | HTTP `GET /api/v1/stats` × 24 samples × 1h → JSON append → exit-code-on-threshold | No exact analog. Closest: `scripts/purge-kmcore-orphans.mjs` (same `/api/v1/stats` consumer + JSON-summary write); `scripts/backfill-insight-mentions.mjs` (CLI flags + exit-code semantics + log-dir writes) | role-match (synthesized from two analogs — flagged below in "No Analog Found") |

## Pattern Assignments

---

### `src/live-logging/ObservationConsolidator.js` — D-02 Digest `derivedFrom` loop (digest-insert at lines ~1294-1296)

**Primary analog:** `src/live-logging/ObservationConsolidator.js:679-705` (the post-Phase 58 `has_insight` follower in `_pushInsightToKG`). Same file, same surrounding code-style, same probe-before-write idiom, same metadata stamp shape.

**Secondary analog:** `src/live-logging/ObservationWriter.js:478-522` (`_emitMentionsEdges`). N-edge generalization of `_anchorEntity`; its loop is the cleanest reference for "iterate target ids, probe-then-write, swallow per-iteration errors".

**Imports pattern** — no new imports required. The digest-insert loop already has `kmStore` in scope (line 1099 — `const kmStore = await this._kmStore`-equivalent via `this._kmStore` field).

**Core pattern — has_insight follower (`OC.js:684-705`):**

```javascript
if (projectName && mintedId) {
  try {
    const projects = await this._kmStore.findByOntologyClass('Project');
    const projectId = projects.find((p) => p.name === projectName)?.id;
    if (projectId) {
      const existingHasInsight = await this._kmStore.findRelations({
        from: projectId,
        to: mintedId,
        type: 'has_insight',
      });
      if (!Array.isArray(existingHasInsight) || existingHasInsight.length === 0) {
        await this._kmStore.addRelation({
          from: projectId,
          to: mintedId,
          type: 'has_insight',
          metadata: {
            source: 'observation-consolidator',
            team: project,
            confidence: 1.0,
          },
        });
      }
    }
  } catch (err) {
    process.stderr.write(`[Consolidator→KG] has_insight ${projectName} → ${entry.topic} failed: ${err.message}\n`);
  }
}
```

**Per-edge guards reference (`OW.js:485-521`):**

```javascript
for (const toId of targetIds) {
  if (!toId || toId === fromId) continue;  // Self-loop guard
  try {
    const existing = await kmStore.findRelations({ from: fromId, to: toId, type: 'mentions' });
    if (Array.isArray(existing) && existing.length > 0) continue;
  } catch (err) {
    process.stderr.write(`[ObservationWriter] mentions dedup probe ${fromId}->${toId} failed (non-fatal): ${err.message}\n`);
    // Fall through — better to risk a duplicate edge than to drop the write.
  }
  try {
    await kmStore.addRelation({
      from: fromId, to: toId, type: 'mentions',
      metadata: { source: 'observation-writer', classifiedAt: new Date().toISOString(), classifier: 'llm-haiku' },
    });
  } catch (err) {
    process.stderr.write(`[ObservationWriter] mentions edge ${fromId}->${toId} failed (non-fatal): ${err.message}\n`);
  }
}
```

**Observation id resolution — `findByLegacyId` shape (`OC.js:1306`):**

```javascript
const obsEntity = await kmStore.findByLegacyId({ system: 'A', id: obsId });
if (!obsEntity) continue;  // Observation not yet persisted — skip this edge, log and move on
```

**`derivedFrom` literal source (`integrations/mcp-server-semantic-analysis/src/agents/observation-generation-agent.ts:1393-1400`):**

```typescript
relationships: [
  {
    from: entityName,
    to: 'SemanticAnalysis',
    relationType: 'derivedFrom',
    type: 'derivedFrom',
    target: 'SemanticAnalysis',
    description: 'Generated through semantic analysis of multiple data sources'
  }
],
```

**Synthesized D-02 implementation (planner reference — NOT for verbatim paste):**

The new code lands BETWEEN existing `OC.js:1294` (`await kmStore.putEntity(entity, { skipOntologyCheck: true });`) and `OC.js:1295` (`createdCount++;`). The minted Digest km-core id is the return value of `putEntity` — capture it. Then loop `row.observation_ids`, resolve each via `findByLegacyId({system:'A', id})`, and emit a probe-then-write `addRelation('derivedFrom')`. Per-edge errors log to stderr and continue the loop (matches `_emitMentionsEdges` precedent). No new metadata shape — reuse the `{source: 'observation-consolidator', confidence, addedAt}` payload from `:694-698` adapted: `{source: 'observation-consolidator', addedAt: new Date().toISOString()}`.

---

### `src/live-logging/ObservationConsolidator.js` — D-03 `_pushInsightToKG` consumer of writer's new return signature (lines ~656-661)

**Analog:** the same block of `OC.js` as it stands today, post-Phase 58 Plan 02. The CURRENT code is the diff baseline; the refactor surgically removes lines 660-661 (`findByLegacyId` race) and replaces them with reading the writer's return value.

**Current pattern (`OC.js:654-665`) — to be replaced:**

```javascript
let mintedId;
try {
  // writeInsight returns row.id (the legacyId.id), NOT the freshly
  // minted km-core id. For the has_insight edge we need the minted
  // km-core id — look it up via the legacyId after the write returns.
  await writer.writeInsight(row, { mentionsTargetIds });
  const persisted = await this._kmStore.findByLegacyId({ system: 'A', id: entry.topic });
  mintedId = persisted?.id || null;
} catch (err) {
  process.stderr.write(`[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}\n`);
  return;
}
```

**Target shape after D-03:**

```javascript
let mintedId;
try {
  const result = await writer.writeInsight(row, { mentionsTargetIds });
  mintedId = result.mintedId;   // direct, no findByLegacyId race
  // legacyId is result.legacyId === entry.topic by construction; unused here.
} catch (err) {
  process.stderr.write(`[Consolidator→KG] writeInsight failed for ${entry.topic}: ${err.message}\n`);
  return;
}
```

The block at `OC.js:679-705` (the `if (projectName && mintedId)` follower) stays AS-IS per D-03.2 — its role shifts from "race-safe lookup" to "idempotent re-write protection".

---

### `src/live-logging/ObservationWriter.js` — D-03 `writeInsight` signature refactor (lines 1284-1322)

**Primary analog:** `src/live-logging/ObservationWriter.js:1217-1240` (`writeDigest`). Sibling writer in the same file, returns `row.id` today (line 1233) just like `writeInsight` does (line 1315). The refactor MAY optionally extend `writeDigest` to the same `{legacyId, mintedId}` shape for symmetry — Claude's Discretion per CONTEXT.md.

**Current `writeInsight` end-of-try (`OW.js:1309-1315`):**

```javascript
const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
// Phase 58 Plan 02 — emit N mentions edges synchronously inside the
// same try-block as putEntity. The km-core JSON exporter debounce
// (5s) batches putEntity + every addRelation into one export tick.
await this._emitMentionsEdges(kmStore, mintedId, mentionsTargetIds);
await this._anchorEntity(kmStore, mintedId);
return row.id;
```

`mintedId` is already in scope on line 1309. The refactor:

```javascript
const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
await this._emitMentionsEdges(kmStore, mintedId, mentionsTargetIds);
await this._anchorEntity(kmStore, mintedId);
return { legacyId: row.id, mintedId };   // NEW return shape
```

**JSDoc update reference (`OW.js:1282`):**

```javascript
* @returns {Promise<string>} The persisted entity's legacyId.id (= row.id).
```

becomes:

```javascript
* @returns {Promise<{legacyId: string, mintedId: string}>} legacyId is the
*   stable system='A' surrogate (= row.id); mintedId is the freshly-minted
*   km-core entity id (= return of internal kmStore.putEntity). The mintedId
*   eliminates the post-write findByLegacyId race that pre-D-03 callers paid.
```

**Call-site enumeration grep (D-03.1 — planner runs to find all consumers):**

```bash
grep -rn "writeInsight(" src/ scripts/ integrations/ | grep -v node_modules
```

Expected hits (verified on disk 2026-06-16):
- `src/live-logging/ObservationConsolidator.js:659` — primary consumer, USES return value via the `findByLegacyId` post-write workaround. Rename to `result.legacyId` + `result.mintedId` per D-03.
- All other hits in `OW.js` itself (docstrings and the method definition) — non-call-sites, no change.
- Test surfaces — check `scripts/__tests__/` and `tests/` for any `writeInsight` stub mocks; update return shape there.

---

### `scripts/repair-orphan-digest-insight-edges.mjs` (NEW one-shot two-layer repair) — D-05

**Layer 1 (graph orphan repair) — primary analog:** `scripts/purge-kmcore-orphans.mjs` (entire 59-line file). Same `/api/v1/graph/orphans` consumer, same per-orphan iteration, same `--dry-run` semantics, same stderr-only logging convention, same end-of-run `/api/v1/stats` verification fetch.

**Layer 1 secondary analog (addRelation REST shape):** `scripts/link-collective-to-projects.mjs:38-51` — the canonical `POST /api/v1/relations` body shape.

**Layer 2 (cold-store JSON scrub) — primary analog:** `scripts/evict-ghost-digests.mjs` (entire 82-line file). Same target (`.data/observation-export/digests.json`), same `--apply`/`--dry-run` flip, same backup-before-rewrite + tmp+rename atomic write pattern.

**Layer 1 analog excerpt — `purge-kmcore-orphans.mjs:13-49`:**

```javascript
import process from 'node:process'

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:12436'
const dryRun = process.argv.includes('--dry-run')

function log(msg) { process.stderr.write(`[purge-orphans] ${msg}\n`) }

async function main() {
  log(`mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`)
  const res = await fetch(`${OBS_API}/api/v1/graph/orphans`)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching orphans`)
  const body = await res.json()
  const orphans = body.data || []
  log(`orphan count: ${orphans.length}`)

  const typeCounts = new Map()
  for (const e of orphans) {
    const t = e.entityType || 'unknown'
    typeCounts.set(t, (typeCounts.get(t) || 0) + 1)
  }
  for (const [t, n] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    log(`  ${t}: ${n}`)
  }

  if (dryRun) return

  let ok = 0, fail = 0
  for (let i = 0; i < orphans.length; i++) {
    const id = orphans[i].id
    if (!id) { fail++; continue }
    // … per-orphan write (DELETE in purge; addRelation in repair) …
  }
  log(`DONE: ok=${ok} fail=${fail}`)

  const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
  const s = after.data
  log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1) })
```

**`POST /api/v1/relations` shape (`link-collective-to-projects.mjs:39-48`):**

```javascript
const r = await fetch(`${KM}/api/v1/relations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: keeper.id,
    to: p.id,
    relationType: 'parent-child',
    metadata: { source: 'collective-link', anchoredAt: '2026-06-11' },
  }),
})
if (r.ok) added++
```

**Layer 2 analog excerpt — `evict-ghost-digests.mjs:24-81`:**

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, '.data', 'observation-export', 'digests.json');

const apply = process.argv.includes('--apply');

const raw = fs.readFileSync(TARGET, 'utf8');
const all = JSON.parse(raw);
if (!Array.isArray(all)) {
  process.stderr.write('digests.json root is not an array — refusing\n');
  process.exit(1);
}

// … filter ghost rows …

if (!apply) {
  process.stdout.write('Dry run. Re-run with --apply to rewrite digests.json.\n');
  process.exit(0);
}

// Write atomically: temp + rename. Keep a timestamped backup so the
// operator has a recovery path if the eviction heuristic misclassified.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = TARGET + `.bak-${stamp}`;
fs.copyFileSync(TARGET, backup);
const tmp = TARGET + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(kept, null, 2));
fs.renameSync(tmp, TARGET);
process.stdout.write(`Backup written: ${backup}\n`);
```

**CLI / log-dir convention (planner reference — pulled from `backfill-insight-mentions.mjs:75-145`):**

```javascript
// Exit codes:
//   0   success
//   1   error budget exceeded / fatal in repair phase
//   2   pre-flight failure (obs-api unreachable, file missing)
//   3   uncaught exception in main()

const ERROR_BUDGET_RATIO = 0.05;
const ERROR_BUDGET_MIN_POPULATION = 20;
const EDGE_SOURCE = 'repair-orphan-digest-insight-edges';  // metadata.source tag
```

The repair script gets two CLI flags beyond `--dry-run`: `--layer=graph|cold-store|both` (default `both`) so operators can isolate either layer for testing.

**Aggregate stdout summary shape (mirror `backfill-insight-mentions.mjs` D-05.1 convention) — per-entity record:**

```javascript
{
  layer: 'graph' | 'cold-store',
  entityId: '…',         // km-core id (graph layer) or digest.id (cold-store layer)
  entityType: 'Digest' | 'Insight',
  edgesAdded: 0,          // probe-before-write may zero this for re-runs
  dangling_refs_dropped: 0,  // cold-store layer only
  errors: ['…']
}
```

---

### `scripts/poll-orphan-floor-soak.mjs` (NEW 24h polling harness) — D-04

**No exact analog exists on disk.** This is the closest synthesis from two existing scripts:

**Analog A (HTTP shape, OBS_API consumer):** `scripts/purge-kmcore-orphans.mjs:13-22, 53-55` — the `/api/v1/stats` fetch + `body.data` unwrap.

```javascript
const after = await (await fetch(`${OBS_API}/api/v1/stats`)).json()
const s = after.data
log(`km-core now: nodes=${s.nodeCount} edges=${s.edgeCount} orphans=${s.orphanCount}`)
```

**Analog B (CLI + log-dir + exit-code semantics):** `scripts/backfill-insight-mentions.mjs:75-146`.

**Synthesized poll-soak shape (planner reference):**

```javascript
#!/usr/bin/env node
import process from 'node:process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

const OBS_API = process.env.OBS_API_BASE || 'http://localhost:3848';  // km-core REST mount, port 3848 per CONTEXT.md
const ORPHAN_THRESHOLD = 10;          // SC#4: orphanCount ≤ 10
const SAMPLE_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
const TOTAL_SAMPLES = 24;
const LOG_DIR = path.resolve(process.cwd(), '.data');

function log(msg) { process.stderr.write(`[orphan-soak] ${msg}\n`); }

async function sampleStats() {
  const res = await fetch(`${OBS_API}/api/v1/stats`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching stats`);
  const body = await res.json();
  const s = body.data;
  return {
    timestamp: new Date().toISOString(),
    orphanCount: s.orphanCount,
    nodeCount: s.nodeCount,
    connectivity: s.connectivity,
  };
}

async function main() {
  const samples = [];
  const sessionTs = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(LOG_DIR, `orphan-floor-soak-${sessionTs}.json`);
  let breached = false;
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    const sample = await sampleStats();
    samples.push(sample);
    log(`sample ${i+1}/${TOTAL_SAMPLES}: orphans=${sample.orphanCount} nodes=${sample.nodeCount}`);
    if (sample.orphanCount > ORPHAN_THRESHOLD) {
      breached = true;
      log(`THRESHOLD BREACH: orphans=${sample.orphanCount} > ${ORPHAN_THRESHOLD}`);
    }
    // Append intermediate state so a crash midway still has partial evidence
    await fsp.writeFile(outPath, JSON.stringify({ samples, breached }, null, 2));
    if (i < TOTAL_SAMPLES - 1) {
      await new Promise(r => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
  }
  log(`DONE: ${samples.length} samples written to ${outPath}`);
  process.exit(breached ? 1 : 0);
}

main().catch((e) => { log(`FATAL: ${e.stack}`); process.exit(1); });
```

**Notes on this synthesis (planner can refine):**
- CONTEXT.md `Claude's Discretion` allows native `fetch` over `curl` — used here. The km-core REST endpoint is at `:3848` per CONTEXT.md `<canonical_refs>`, not `:12436` (which is the OBS API for the live-logging side). Confirm at planning time whether the soak should hit `:3848` (semantic-analysis SSE / km-core REST) or `:12436` (obs-api). Per the dependency note at `sse-server.ts:270`, `:3848` is correct for km-core stats.
- One-shot — no launchd plist per D-04.1. Operator runs from a tmux pane, retrieves the JSON at completion, then deletes the script.

---

## Shared Patterns

### Shared Pattern A — `addRelation` is NOT idempotent on `(from, to, type)`

**Source:** `OC.js:677-678` comment + `OW.js:460-463` JSDoc + the four probe-before-write sites listed below.

**Apply to:** every new `addRelation` call introduced by Phase 59 — the D-02 digest-`derivedFrom` loop, the D-03/D-05.1 `synthesizedFrom` writes, the D-05.1 `has_insight` re-emission.

**Canonical probe-then-write shape (from `OC.js:684-700`):**

```javascript
const existing = await kmStore.findRelations({ from, to, type });
if (!Array.isArray(existing) || existing.length === 0) {
  await kmStore.addRelation({ from, to, type, metadata: { source, addedAt: new Date().toISOString(), ... } });
}
```

**Probe failures are non-fatal** — `OW.js:496-501` precedent:

```javascript
} catch (err) {
  process.stderr.write(`[...] dedup probe ${fromId}->${toId} failed (non-fatal): ${err.message}\n`);
  // Fall through — better to risk a duplicate edge than to drop the write.
}
```

**Other probe sites confirmed on disk:**
- `OC.js:684-690` — has_insight probe (writer-side)
- `OW.js:489-501` — mentions probe (writer-side, `_emitMentionsEdges`)
- `OC.js:2148, :2188` — bridge mentions probe (backfill-side)

### Shared Pattern B — D-02 atomicity (Phase 58 D-04 verbatim, applied to Digests)

**Source:** `OW.js:1309-1315` (the post-Phase 58 `writeInsight` body).

**Apply to:** the digest-insert block at `OC.js:1294-1296`. The contract: same try-block, same microtask, `putEntity` immediately followed by the `addRelation` loop, no intervening awaits beyond what km-core demands.

```javascript
const mintedId = await kmStore.putEntity(entity, { skipOntologyCheck: true });
await this._emitMentionsEdges(kmStore, mintedId, mentionsTargetIds);   // N edges
await this._anchorEntity(kmStore, mintedId);                            // 1 edge
return { legacyId: row.id, mintedId };
```

Per-iteration awaits inside `_emitMentionsEdges` are fine — the km-core JSON exporter's 5s debounce window swallows the whole microtask batch (`OW.js:450-455` JSDoc).

### Shared Pattern C — `findByLegacyId({system:'A', id})` for legacyId → minted-id resolution

**Source:** every km-core consumer in `OC.js` (10+ sites).

**Apply to:** D-02's observation-id resolution loop. The repair script's Layer 1 also calls this for each id in `metadata.observation_ids` / `metadata.digest_ids`.

**Canonical site (`OC.js:1306`):**

```javascript
const obsEntity = await kmStore.findByLegacyId({ system: 'A', id: obsId });
if (!obsEntity) continue;  // not yet persisted — skip; never throw.
```

D-02.2 in CONTEXT.md is explicit: "If an Observation is not yet persisted at consolidation time, that single edge is skipped (logged), but the Digest still lands with its remaining edges — the missing edge is picked up by the next repair-script run."

### Shared Pattern D — `process.stderr.write` for all logging (no console.*)

**Source:** CLAUDE.md `no-console-log` constraint + every `*.mjs` script under `scripts/`.

**Apply to:** every new log line in Phase 59 — writer-fix in `OC.js`, signature refactor in `OW.js`, repair script, poll-soak script. The `[Consolidator]`, `[Consolidator→KG]`, `[ObservationWriter]` prefixes are the canonical channel tags; new scripts pick a short bracketed prefix (`[repair-orphans]`, `[orphan-soak]`) following `purge-kmcore-orphans.mjs:18` convention.

### Shared Pattern E — Two-layer scripts use single CLI entry, `--layer` selector

**Source:** N/A — D-05 introduces this convention. The closest precedent is the `--dry-run` flag in `purge-knowledge-entities.js:82-101`.

**Apply to:** `repair-orphan-digest-insight-edges.mjs` only. Planner mirrors the parseArgs shape from `purge-knowledge-entities.js:73-102` (`for (const arg of args)` loop, `--key=value` style for layer selector).

### Shared Pattern F — `--dry-run` + atomic backup-then-rename for any `.data/observation-export/*.json` mutation

**Source:** `scripts/evict-ghost-digests.mjs:74-81`.

**Apply to:** Layer 2 of repair script. Verbatim re-use is acceptable — pull out into a helper if the planner wants to keep the script's body compact, but the 8-line idiom is small enough to inline.

```javascript
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = TARGET + `.bak-${stamp}`;
fs.copyFileSync(TARGET, backup);
const tmp = TARGET + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(kept, null, 2));
fs.renameSync(tmp, TARGET);
```

---

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|---|---|---|---|
| `scripts/poll-orphan-floor-soak.mjs` | polling-script | hourly HTTP sample → JSON append → exit-on-threshold | No 24h hourly-poll script exists in the repo. **Mitigation:** synthesized above from Analog A (`purge-kmcore-orphans.mjs` `/api/v1/stats` consumer) + Analog B (`backfill-insight-mentions.mjs` CLI + log-dir + exit-code shape). The planner has 100% of the building blocks; the assembly is novel but mechanical. |

No other files in scope lack an analog.

---

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/coding/src/live-logging/` (in-file analogs for OC.js / OW.js refactors)
- `/Users/Q284340/Agentic/coding/scripts/` (one-shot scripts + soak harness)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/` (`derivedFrom` vocabulary)

**Files scanned (Read tool):** 7 — `59-CONTEXT.md`, `STATE.md`, `ROADMAP.md` (Phase 59 entry), `58-CONTEXT.md` (Phase 58 D-04 reference), `OC.js` (4 targeted sections), `OW.js` (3 targeted sections), `observation-generation-agent.ts`, `backfill-raw-observations.mjs`, `purge-knowledge-entities.js`, `purge-kmcore-orphans.mjs`, `link-collective-to-projects.mjs`, `evict-ghost-digests.mjs`, `backfill-insight-mentions.mjs`, `observations-api-server.mjs` (`/api/v1/stats` handler).

**Verified on-disk drift versus CONTEXT.md:** 6 line-number / method-name corrections (table at top). Planner consumes the corrected coordinates.

**Pattern extraction date:** 2026-06-16
