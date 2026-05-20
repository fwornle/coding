---
phase: 39-entity-data-model
reviewed: 2026-05-20T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/backfill/checkpoint.ts
  - src/backfill/index.ts
  - src/index.ts
  - src/segments/index.ts
  - src/segments/merge.ts
  - src/store/GraphKMStore.ts
  - src/store/types.ts
  - src/types/entity.ts
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 39: Code Review Report

**Reviewed:** 2026-05-20
**Depth:** standard
**Files Reviewed:** 8 (all in `/Users/Q284340/Agentic/km-core/`)
**Status:** issues_found

## Summary

Phase 39 ships writer-side provenance stamping (D-30/D-31/D-32), supersession closure with active-only filtering (D-33/D-34/D-35), a pure `mergeDescriptionSegment` helper (D-39/D-40/D-41), and a resumable backfill function (D-36/D-37/D-38). The overall architecture is sound and the decisions are implemented faithfully. ESM `.js` suffixes are consistent throughout. No `console.*` calls were found. BC-2 widening is preserved.

Two **BLOCKER**-grade defects were found, both in `GraphKMStore.ts`:

1. The supersession closure calls `this.batch(...)` with two `putEntity` ops whose `id` fields are non-v7 strings whenever the old entity was originally stored via the trusted path (legacy nanoid / layer-prefixed keys). `batch()` Phase 1 validation unconditionally calls `parseEntityId` on every `putEntity` op's `id`, which throws for non-v7 ids — breaking D-33 atomicity for any legacy-keyed predecessor.

2. The supersession closure `batch()` call does not short-circuit the supersession-closure block inside `putEntity` for the new entity's write. Because `batch()` calls `putEntity(entity, { skipOntologyCheck: true })` for the new entity (`{ supersedes: oldId }`), and the new entity still carries `supersedes`, the trusted-path `putEntity` body reaches `mergeNode` with `entity.supersedes` intact — but crucially does NOT re-trigger the closure (trusted path bypasses `!trusted` block). However, the `entity` passed to `batch` for the new write is the already-provenance-stamped entity, and `batch` re-writes it with `skipOntologyCheck: true`, which means the store will call `mergeNode` for the new entity a second time after `batch` returns only `undefined` (no id return). This is not itself a crash, but the control flow after `return id` means the trailing `mergeNode + emit` block at lines 443-449 is NEVER reached for the superseded case — the entity's final write goes through `batch`'s trusted `putEntity`, which DOES reach `mergeNode`. This part is actually correct. Retract — see full analysis under WR-01 instead.

Four **WARNING**-grade issues were also found.

---

## Critical Issues

### CR-01: batch() Phase-1 Validation Rejects Non-v7 Entity IDs During Supersession Closure

**File:** `src/store/GraphKMStore.ts:428-431`

**Issue:** The D-33 supersession closure calls `this.batch([{ type: 'putEntity', entity: closedOld }, { type: 'putEntity', entity }])`. `batch()` Phase 1 (lines 624-638) calls `parseEntityId(op.entity.id as unknown as string)` for every `putEntity` op **regardless** of whether the entity was originally stored via the trusted path. Entities stored via `skipOntologyCheck: true` (fixture replay, legacy migration, backfill) routinely carry non-v7 ids (nanoid-style, C's `layer:uuid` prefix, raw incrementing integers). For any such predecessor, `parseEntityId` will throw in Phase 1, aborting the batch before any mutation — the supersession closure silently fails with an exception at the moment a new v7-id entity tries to supersede a legacy-id entity. This is a correctness bug: D-33 atomicity is broken for the cross-epoch case (v7 successor superseding a legacy-id entity).

The comment at `batch()` line 626 even acknowledges "batch is strict-by-default" for `parseEntityId` — but this was not reconciled with the supersession closure path that passes `closedOld` (which may be a legacy-id entity) as one of the batch ops.

**Fix:** Pass `{ skipOntologyCheck: true }` per-op in the batch call from within the supersession closure, OR bypass `parseEntityId` in `batch()` Phase 1 when the entity already exists in the graph (it was already validated when first stored). The simplest safe fix: when the supersession closure assembles the `closedOld` entity, write it directly via `this.putEntity(closedOld, { skipOntologyCheck: true })` instead of going through `batch()`. Since `batch()` is called with exactly two ops (both are the puts), the only atomicity benefit is the validate-all-first phase, which is irrelevant when the entities are already in-graph. Replace the `batch` call with two sequential trusted-path puts:

```typescript
// Replace the this.batch([...]) call with:
await this.putEntity(closedOld, { skipOntologyCheck: true });
await this.putEntity(entity, { skipOntologyCheck: true });
// (addRelation call below is unchanged)
```

Note: this loses the all-or-nothing guarantee for the two-write pair. For true atomicity, the correct fix is to widen `BatchOp` with an optional `skipOntologyCheck` flag (deferred to Phase 42 per the summaries), OR to suppress `parseEntityId` in `batch()` Phase 1 for ops that carry an entity already in the graph. Document the accepted trade-off in code if the two-sequential-puts approach is chosen.

---

### CR-02: Checkpoint `skipped` Counter Carries Forward from Prior Run — Resume Arithmetic Is Wrong

**File:** `src/backfill/index.ts:161`

**Issue:** On resume, `skipped` is initialized from `prior?.skipped ?? 0` (line 161). During the resume pass, every entity up to `lastStampedId` is counted as `skipped += 1` again (lines 182-188). This double-counts: an entity that was skipped on the prior run because it already had `validFrom` gets counted in `skipped` both from the checkpoint carry-forward AND from the resume-cursor skip increment on the new run. The final `BackfillResult.skipped` therefore over-reports the true count on any resumed run.

Concrete example: initial run on a 3-entity store where entity 1 already had `validFrom` (so first run: `scanned:3, stamped:2, skipped:1`). On resume with the checkpoint present: `prior.skipped = 1`, then in the loop entity 1 hits the `sawCheckpointCursor = false` branch and increments `skipped` again → final `skipped = 2`, but only 1 entity was actually skipped for the semantic reason (already-stamped). The test for idempotent second run (test 2) happens to avoid this because it runs a complete second pass from scratch (checkpoint from first run has `lastStampedId` pointing past the last entity, so `sawCheckpointCursor` starts `false` but immediately becomes `true` on the first entity… actually this depends on whether the last entity's id matches `lastStampedId`). The resume test (test 9) asserts `result.stamped === 3` (cumulative) but does not assert the `skipped` or `scanned` values precisely, so this bug is not caught by the test suite.

**Fix:** Do not carry `skipped` forward from the checkpoint. `skipped` should be a fresh per-run counter. Only `stamped` needs to carry forward for the cumulative display contract. Change initialization:

```typescript
// Before:
let skipped = prior?.skipped ?? 0;

// After:
let skipped = 0;
// The result.skipped is always the THIS-RUN skipped count.
// result.stamped stays cumulative (prior.stamped + this run's stamps).
```

Alternatively, document clearly in the `BackfillResult` JSDoc whether `skipped` is cumulative or per-run, and fix the checkpoint write to not include `skipped` if it is per-run. Either way, the current implementation is inconsistent: `stamped` is explicitly documented as cumulative ("a 100K-entity backfill interrupted 3 times still reports `stamped: 100000`") but `skipped` follows the same carry-forward without the same intent, leading to double-counting.

---

## Warnings

### WR-01: Supersession Closure Passes the Full New Entity (with `supersedes` Set) into `batch()` — Second Put Has `supersedes` Intact on the Trusted Path

**File:** `src/store/GraphKMStore.ts:429-431`

**Issue:** The `batch()` call includes `{ type: 'putEntity', entity }` where `entity` is the fully-assembled new entity including `entity.supersedes = oldId`. When `batch()` Phase 2 calls `putEntity(entity, { skipOntologyCheck: true })`, the trusted path runs `entity = { ...e, id }` (line 346) and proceeds to `mergeNode(id, entity)`. The stored node will carry `supersedes: oldId` in the graph attributes — which is correct. However, if this entity is ever later passed as an input to another `putEntity` call via a read-modify-write pattern, the `supersedes` field will be present on the read-back entity, and a careless caller could inadvertently re-trigger the supersession closure on a subsequent strict-path write of the same entity if they don't clear `supersedes`.

This is not an immediate crash but is a latent footgun: the `supersedes` field is never cleared by the store after the supersession is applied, and `getEntity` returns the raw node attributes including `supersedes`. Downstream callers (Phase 40/42/43) that load and re-store entities must explicitly strip `supersedes` or the OQ#4 `!existing` guard is the only thing preventing a repeat closure attempt. The guard saves them, but this is an undocumented hazard.

**Fix:** After the supersession closure succeeds (before `return id`), clear `supersedes` from the stored node attributes so the settled state is unambiguous:

```typescript
// After await this.addRelation(...):
this.graph.mergeNodeAttributes(id, { supersedes: undefined });
return id;
```

Alternatively, document in the JSDoc for `putEntity` and `getEntity` that the `supersedes` field on a returned entity is the author's declaration, not a store-maintained invariant — and that callers must strip it before re-storing.

---

### WR-02: `getSupersessionChain` Forward Walk Does Not Handle Multiple SUPERSEDED_BY Out-Edges from the Same Node

**File:** `src/store/GraphKMStore.ts:598-612`

**Issue:** The forward-walk loop (Phase 2, lines 598-612) uses `forEachOutEdge` and takes the **last** `SUPERSEDED_BY` edge it encounters whose target is not in `visited` (the `next = tgt` assignment overwrites any earlier candidate). If a node has more than one `SUPERSEDED_BY` out-edge pointing to unvisited targets (a data-integrity violation, but one that could arise from a partial migration or bug), the chain walk silently picks a non-deterministic successor (the last one in Graphology's internal edge order).

The contract says a superseded entity has exactly one successor, but the store never enforces this uniqueness constraint — two rapid concurrent (or buggy) `putEntity` calls with `supersedes: sameOldId` could each write a SUPERSEDED_BY edge from `oldId`, violating the single-successor assumption. The cycle guard catches circular chains but not forking chains.

**Fix:** Either assert/enforce single-successor at write time in the supersession closure:

```typescript
// In the supersession closure, before batch():
const existingSuccessors = this.graph
  .filterOutEdges(oldId, (_, attrs) => (attrs as Relation).type === 'SUPERSEDED_BY')
  .length;
if (existingSuccessors > 0) {
  throw new Error(`Entity ${String(oldId)} already has a successor — cannot supersede twice`);
}
```

Or, in `getSupersessionChain`, emit a stderr-warn and pick the first match consistently instead of last:

```typescript
if (r.type === 'SUPERSEDED_BY' && !visited.has(tgt as EntityId)) {
  if (next === undefined) {   // take first, not last
    next = tgt as EntityId;
  } else {
    process.stderr.write(`[km-core/store] multiple successors at ${String(cursor)}; picking first\n`);
  }
}
```

---

### WR-03: `readCheckpoint` Does Not Validate the Parsed JSON Shape — Malformed Checkpoint Passes Through as Garbage Data

**File:** `src/backfill/checkpoint.ts:79-83`

**Issue:** `readCheckpoint` returns `JSON.parse(raw) as Checkpoint` without any shape validation. If the checkpoint file is truncated (write interrupted mid-JSON), has an unexpected `version` value, or is corrupted by an external agent, the function returns a structurally wrong object. Downstream code in `backfill/index.ts` then reads `prior.lastStampedId`, `prior.stamped`, and `prior.skipped` from this garbage object — potentially getting `undefined` or wrong types, which silently corrupts the resume state. For example, a truncated file will cause `JSON.parse` to throw a `SyntaxError`, which is NOT `ENOENT`, so it will be re-thrown from `readCheckpoint` — this case is handled correctly. But a file where `version` is `2` (after a schema change) would be silently accepted and could produce wrong results.

The immediate failure mode (interrupted write) is actually safe because `writeCheckpointAtomic` uses rename — a partial write to the temp file followed by a crash before rename leaves the old checkpoint intact. The corruption scenario requires external interference. However, the `version` field is documented as a "structural version marker — bump on shape changes" but is never checked.

**Fix:** Add a version check after parsing:

```typescript
const cp = JSON.parse(raw) as Checkpoint;
if (cp.version !== 1) {
  throw new Error(
    `backfill checkpoint version mismatch: expected 1, got ${String(cp.version)}. Delete ${checkpointPath} to start fresh.`
  );
}
return cp;
```

---

### WR-04: `mergeDescriptionSegment` Accepts `newSegment.confirmations` from Caller and Propagates Them Unvalidated on a Cache Miss (D-40 Miss Branch)

**File:** `src/segments/merge.ts:125-128`

**Issue:** On a D-40 miss (no normalized-text match), the code pushes:

```typescript
segments.push({
  ...newSegment,
  confirmations: newSegment.confirmations ?? [],
});
```

The spread `...newSegment` includes all fields of `newSegment` (text, runId, provider, model, quality, timestamp, confirmations), and `confirmations` is then overridden only when `newSegment.confirmations` is `undefined` (the `?? []` guard). If the caller passes a `newSegment` whose `confirmations` array already contains entries, those entries are propagated verbatim into the stored segment — even if those entries are structurally invalid (e.g. missing `runId`, wrong timestamp format, or entries injected by an untrusted external source).

This is a provenance injection vector: a caller can pre-populate `newSegment.confirmations` with arbitrary data that will appear in the entity's confirmation history without going through the normal confirmation-append path. For internal callers (Phase 40/42/43) this is a disciplinary issue; for any path where `newSegment` is constructed from external data (e.g. a deserialized API payload), it is a security concern.

The note in the summary ("Returned entity has a NEW reference. `confirmations[]` on the pushed (no-match) segment preserves caller-supplied confirmations.") documents this behavior but it is a footgun that violates the spirit of structured provenance.

**Fix:** On a D-40 miss, always start with an empty `confirmations[]` regardless of what the caller passed. If there is a legitimate reason to carry forward pre-existing confirmations (e.g. during a migration restore), the caller should use a separate restore API, not the ingest-time merge helper:

```typescript
segments.push({
  ...newSegment,
  confirmations: [],  // always start fresh on a cache miss
});
```

If the intent to forward confirmations is deliberate for some use case, document it clearly and add a test that explicitly asserts the behavior is intentional (no current test exercises `newSegment.confirmations` being non-empty on a miss).

---

## Info

### IN-01: `iterate` Return Type Annotation Says `AsyncIterable<Entity>` but the Method Is an `async *` Generator

**File:** `src/store/GraphKMStore.ts:689`

**Issue:** The `async *iterate` method is declared with return type `AsyncIterable<Entity>`. While `AsyncGenerator<Entity>` is assignable to `AsyncIterable<Entity>`, the stricter type would be `AsyncGenerator<Entity, void, undefined>`. This is a minor annotation inconsistency rather than a bug, but it means callers that receive the iterator object cannot call `.return()` or `.throw()` on it without a type assertion. No current caller does this.

**Fix:** Either keep the annotation as-is (acceptable — the method's public contract is `AsyncIterable`, hiding the generator detail) and document it, or annotate as `AsyncGenerator<Entity>` for precision. No behavior change.

---

### IN-02: `BackfillResult.skipped` JSDoc Is Ambiguous About Cumulative vs Per-Run Semantics

**File:** `src/backfill/index.ts:100-111`

**Issue:** The `BackfillResult.skipped` JSDoc says "`scanned - stamped` on a non-dry-run" but (per CR-02 above) the implementation carries forward `prior.skipped` from the checkpoint, making it cumulative — inconsistent with the stated formula. Even if CR-02 is fixed to make `skipped` per-run, the current description could be read as either per-run or cumulative. The `stamped` counter is explicitly documented as cumulative in the behavior-surprises section of 39-04-SUMMARY.md, but `skipped` has no such clarification.

**Fix:** After resolving CR-02, update the JSDoc to be explicit:

```typescript
/**
 * - `skipped`: per-run count of entities that were not stamped because
 *   they already had `validFrom` (idempotency skip) or were skipped
 *   by the resume cursor. Always a fresh count for this invocation
 *   (not cumulative across resumed runs).
 */
skipped: number;
```

---

_Reviewed: 2026-05-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
