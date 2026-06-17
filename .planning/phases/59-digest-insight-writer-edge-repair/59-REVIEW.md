---
phase: 59-digest-insight-writer-edge-repair
reviewed: 2026-06-17T08:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - scripts/poll-orphan-floor-soak.mjs
  - scripts/repair-orphan-digest-insight-edges.mjs
  - src/live-logging/ObservationConsolidator.js
  - src/live-logging/ObservationConsolidator.test.js
  - src/live-logging/ObservationWriter.js
  - src/live-logging/ObservationWriter.test.js
findings:
  critical: 2
  warning: 7
  info: 4
  total: 13
status: issues_found
---

# Phase 59: Code Review Report

**Reviewed:** 2026-06-17T08:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 59's writer-side root-cause closure (Wave 1+2) is structurally sound: the `{legacyId, mintedId}` return shape from `writeInsight` removes the racy `findByLegacyId` post-write lookup, the test suite (Tests 5/6/7 in `ObservationConsolidator.test.js`; Tests 9/10/11 in `ObservationWriter.test.js`) locks the contract cleanly, and the `derivedFrom` emission loop in `consolidateDay`'s plain-insert branch correctly mirrors the OW.js mentions-edges pattern with per-edge try/catch and skip-and-log on unresolved observation legacy ids. Atomicity boundaries (Phase 58 D-04 envelope applied verbatim) are honored.

However, the Wave 2 repair script (`scripts/repair-orphan-digest-insight-edges.mjs`) has **two serious correctness problems** that undermine its stated purpose:

1. **`resolveLegacyId()` is structurally broken** — the docstring (lines 232-246) admits the km-core REST wire surface strips `legacyId` and "the wire surface cannot resolve legacy ids — return null." The script's `meta.observation_ids` / `meta.digest_ids` ARE legacy system-A ids, so the resolver will return null for virtually every entry, the script will log "not yet persisted" for already-persisted entities, and Layer 1 will silently no-op the repair while reporting success.

2. **The error budget never engages on resolution failure** — `record.errors.push("unresolved observation ...")` does NOT increment `totalAttempts` or `totalFailures` (only `addRelation` outcomes do). A 100%-no-op run exits clean with `attempts=0 failures=0` and an misleadingly-confident summary.

The soak script's port discipline is correct (`:3848` only, no obs-api `:3033` fallback), but its env-override logic has a subtle off-by-zero defect and its threshold-breach behavior (continue past breach, then exit 1 at the end) is inconsistent with the documented "sustained baseline" intent.

The consolidator's plain-insert `derivedFrom` loop is fine in isolation, but its interaction with `_buildDigestMergePlan` introduces a missed-edge edge case (D-02 vs D-02.1) and its bookkeeping of `digestedObsIds` is inconsistent across the merge vs insert branches.

## Critical Issues

### CR-01: `resolveLegacyId()` cannot resolve legacy ids; Layer 1 silently no-ops on every orphan whose metadata refs are legacy-system-A surrogates

**File:** `scripts/repair-orphan-digest-insight-edges.mjs:232-258`
**Issue:** The function docstring explicitly states:

> "The km-core REST surface strips `legacyId` on the wire ... No `/api/v1/entities/legacy/A/<id>` endpoint exists. ... if the legacy id IS the minted id (rare but possible for entities ingested without the legacyId distinction), GET /entities/:id returns the entity. Otherwise the wire surface cannot resolve legacy ids — return null."

But Layer 1's entire orphan-repair strategy depends on resolving legacy ids stored in `meta.observation_ids` (line 336) and `meta.digest_ids` (line 367) to minted km-core entity ids. These metadata fields carry legacy system-A surrogates — the same surrogates the consolidator stamps via `legacyDigestToEntity` / `legacyInsightToEntity`. So `resolveLegacyId` will return null for essentially every entry, every iteration logs `"not yet persisted, skipping edge"` (line 342, line 373), and Layer 1 emits ZERO edges while exiting with `aborted: false` and `edgesAdded: 0`.

The log message is also misleading — it implies a timing race ("not yet persisted") when the actual failure is "REST API cannot translate legacy id to minted id at all."

**Fix:** Either (a) add a `/api/v1/entities/legacy/:system/:id` endpoint to the km-core REST surface and use it here, or (b) resolve by querying `/api/v1/entities?ontologyClass=Observation` once, build an in-memory `legacyId.id → minted id` index, and look up against the index. Example for option (b):

```javascript
async function buildLegacyIndex(klass) {
  const res = await fetch(`${KMCORE_REST_BASE}/api/v1/entities?ontologyClass=${klass}&limit=10000`);
  if (!res.ok) return new Map();
  const body = await res.json();
  const items = Array.isArray(body.data) ? body.data : [];
  const map = new Map();
  for (const e of items) {
    if (e.legacyId?.id) map.set(e.legacyId.id, e);
    // also self-map so callers that already pass minted ids resolve too
    map.set(e.id, e);
  }
  return map;
}
// then in processGraphLayer:
const obsIndex = await buildLegacyIndex('Observation');
const digIndex = await buildLegacyIndex('Digest');
// replace resolveLegacyId(obsId) with obsIndex.get(obsId)
```

Without this fix, the entire Wave 2 repair script is a no-op in production.

---

### CR-02: Repair script error-budget never engages on `resolveLegacyId` returning null

**File:** `scripts/repair-orphan-digest-insight-edges.mjs:340-345, 371-376, 437-441`
**Issue:** When `resolveLegacyId` returns null, the script logs and `record.errors.push(...)` but does NOT increment `totalAttempts` or `totalFailures` — those counters only advance on `addRelation` calls (line 349, 380, 405). Combined with CR-01, this means a 100%-no-op run sees `totalAttempts=0`, the gate `totalAttempts >= ERROR_BUDGET_MIN_POPULATION` (line 438) is never satisfied, and the script exits with `aborted: false` and a "summary" that claims success (exit code 0).

The dual-counter shape (per-orphan `record.errors` array + aggregate counters) treats resolution failures as bookkeeping-only events with no effect on the run-level outcome. The phase prompt called out "any silent-truncation or fallback patterns that could mask the orphan signal" — this is exactly that pattern.

**Fix:** Count unresolved legacy ids against the error budget, OR add a separate gate "if `unresolvedCount > N && edgesAdded === 0 → exit 1 with reason=resolution-failure". Example:

```javascript
let unresolvedRefCount = 0;
// inside the Digest branch:
if (!obsEntity) {
  unresolvedRefCount++;
  log(`derivedFrom: observation ${obsId.slice(0,8)} unresolvable, skipping edge`);
  record.errors.push(`unresolved observation ${obsId}`);
  continue;
}
// at end of Layer 1:
if (unresolvedRefCount > 50 && edgesAddedAggregate === 0) {
  log(`FATAL: ${unresolvedRefCount} unresolved refs, zero edges emitted — likely a legacy-id resolution failure, NOT a no-op success`);
  process.exit(1);
}
```

## Warnings

### WR-01: Soak-script env override silently falls back to canonical when override is `0` or non-numeric

**File:** `scripts/poll-orphan-floor-soak.mjs:52-53`
**Issue:**

```javascript
const EFFECTIVE_SAMPLE_INTERVAL_MS = Number(process.env.SAMPLE_INTERVAL_MS_OVERRIDE) || SAMPLE_INTERVAL_MS;
const EFFECTIVE_TOTAL_SAMPLES = Number(process.env.TOTAL_SAMPLES_OVERRIDE) || TOTAL_SAMPLES;
```

`Number(undefined) === NaN` (falsy → fallback, OK), but `Number("0") === 0` (falsy → falls back to the canonical 1h / 24-sample value) and `Number("garbage") === NaN` (falls back silently). An operator who types `TOTAL_SAMPLES_OVERRIDE=O` (letter O instead of digit 0) thinks they're running a 0-sample probe but actually starts a 24-hour soak. Silent fallback on typos is a real foot-gun for a 24h script.

**Fix:** Use a typed parser and treat `0` as a valid override:

```javascript
function parseOverride(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    process.stderr.write(`[orphan-soak] ${name}=${JSON.stringify(raw)} not numeric — aborting\n`);
    process.exit(2);
  }
  return n;
}
const EFFECTIVE_TOTAL_SAMPLES = parseOverride('TOTAL_SAMPLES_OVERRIDE', TOTAL_SAMPLES);
const EFFECTIVE_SAMPLE_INTERVAL_MS = parseOverride('SAMPLE_INTERVAL_MS_OVERRIDE', SAMPLE_INTERVAL_MS);
```

### WR-02: Soak threshold-breach semantics — "continue past breach, exit 1 at end" contradicts the SC#4 sustained-baseline intent

**File:** `scripts/poll-orphan-floor-soak.mjs:157-160, 232`
**Issue:** When `sample.orphanCount > ORPHAN_THRESHOLD`, the script sets `breached = true`, logs `"THRESHOLD BREACH ... (continuing — see when else)"`, and keeps sampling. At the end it exits 1 if breached. But SC#4 is documented as "max(orphanCount) <= 10 sustained across 24h" — a single transient spike on sample 3 (e.g. during an obs-api restart) will mark the entire 24h run as failed even if samples 4-24 all read 0. There is no notion of "sustained breach" (e.g. N consecutive breaches required) and no way to distinguish a transient spike from a sustained regression.

Additionally, the log phrase "(continuing — see when else)" is broken English and provides no actionable instruction.

**Fix:** Either tighten the doc to "any single breach = fail" (and fix the log text) OR implement sustained-breach detection (e.g. require 3 consecutive breaches before flipping `breached`).

### WR-03: Consolidator `for (const obsId of d.observationIds)` at line 1338 is unguarded; line 1308 uses `Array.isArray(...) ? ... : []`

**File:** `src/live-logging/ObservationConsolidator.js:1308 vs 1338`
**Issue:** Inside the plain-insert branch, the `derivedFrom` emission loop at line 1309 uses a safe guard:

```javascript
const obsIds = Array.isArray(d.observationIds) ? d.observationIds : [];
for (const obsId of obsIds) { ... }
```

But ten lines later, the `digestedObsIds` bookkeeping loop at line 1338 is unguarded:

```javascript
for (const obsId of d.observationIds) digestedObsIds.add(obsId);
```

The merge branch at line 1263 uses `d.observationIds || []`. Three different guards across a single function. While `_parseDigests` (line 4190) currently always sets `observationIds` to an array AND skips digests with empty arrays (line 4169), a future refactor that ever lets `d.observationIds` be undefined will throw `TypeError: undefined is not iterable` only on line 1338, mid-batch. Inconsistent defensive guards are a latent bug.

**Fix:** Normalize to one shape at the top of the iteration:

```javascript
const d = digestEntries[i];
d.observationIds = Array.isArray(d.observationIds) ? d.observationIds : [];
// ... merge branch and insert branch both use d.observationIds directly
```

### WR-04: `obsId.slice(0, 8)` will throw if `obsId` is ever non-string; `if (!obsId) continue` only catches empty/null

**File:** `src/live-logging/ObservationConsolidator.js:1315, 1319, 1354`; `scripts/repair-orphan-digest-insight-edges.mjs:255, 327, 342, 373, 411, 423, 441`
**Issue:** Multiple call sites call `obsId.slice(0, 8)` (or `legacyId.slice(0, 8)`, `eId.slice(0, 8)`) inside stderr/log statements. The `if (!obsId) continue;` guard at OC.js:1310 catches null/undefined/empty-string, but if `_parseDigests` ever returns a numeric id (legacy SQLite rows used INTEGER PRIMARY KEY at one point), `.slice` throws. The stderr-log throw would NOT be caught by the surrounding try/catch (the try wraps `findByLegacyId`, not the catch's stderr log) — meaning a single non-string obsId crashes `consolidateDay` and aborts the entire batch.

Same pattern in the repair script — `obsId.slice` at line 342 and `eId.slice` at line 327 are outside any try/catch.

**Fix:** Wrap with `String(obsId).slice(0, 8)` or define a helper:

```javascript
const short = (s) => (typeof s === 'string' ? s.slice(0, 8) : String(s).slice(0, 8));
process.stderr.write(`... ${short(obsId)} ...`);
```

### WR-05: Repair script `resolveLegacyId(legacyId)` accepts any string but calls `legacyId.slice(0, 8)` in error path without type guard

**File:** `scripts/repair-orphan-digest-insight-edges.mjs:255`
**Issue:** Same family as WR-04 but worth calling out separately because `resolveLegacyId` is reached on every observation/digest id walked from orphan metadata, and the catch block stringifies via `.slice(0, 8)`. A `meta.observation_ids` containing a number (from a legacy SQLite ingest where the column was INTEGER) crashes the script mid-Layer-1 with an unhandled TypeError. The outer `main().catch` then exits 3 — appearing as "uncaught" rather than "metadata shape mismatch."

**Fix:** Cast at the top of the function:

```javascript
async function resolveLegacyId(legacyId) {
  if (!legacyId) return null;
  const id = String(legacyId);
  try {
    const res = await fetch(`${KMCORE_REST_BASE}/api/v1/entities/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.data || null;
  } catch (err) {
    log(`resolveLegacyId ${id.slice(0, 8)} threw: ${err.message}`);
    return null;
  }
}
```

### WR-06: D-02.1 (probe-before-write) is intentionally omitted in `consolidateDay` but the comment claims `_buildDigestMergePlan` "dedupes upstream" — the merge plan only handles same-date semantic duplicates, not re-runs of the same Digest

**File:** `src/live-logging/ObservationConsolidator.js:1293-1306, 1308-1336`
**Issue:** The comment block at line 1299-1306 reads:

> "No probe-before-write per D-02.1 — `_buildDigestMergePlan` (above) dedupes upstream, so the plain-insert branch only runs for genuinely new Digests."

But `_buildDigestMergePlan` (lines 943-1028) dedupes via **embedding cosine similarity** against same-date+same-project Digests in Qdrant. If the embedder/Qdrant is unavailable (line 948 fallback returns all-`insert`), the merge plan returns "all-insert" → every digest goes to the plain-insert branch → `addRelation({type:'derivedFrom'})` is called WITHOUT a probe-before-write. Per the comment at OW.js:486-501, km-core `addRelation` is "NOT idempotent on the (from, to, type) triple" — a Qdrant outage during a re-run will multiply `derivedFrom` edges.

The writer-side `_emitMentionsEdges` (OW.js:478-522) DOES probe-before-write via `findRelations`. The consolidator's `derivedFrom` loop intentionally skips this, on the (Qdrant-dependent) assumption that the merge plan is its dedup gate. That assumption is brittle.

**Fix:** Add the dedup probe before `addRelation` to match the writer-side pattern. The same probe is already present in `_pushInsightToKG` for `has_insight` (OC.js:682-687):

```javascript
const existing = await kmStore.findRelations({
  from: digestMintedId, to: obsEntity.id, type: 'derivedFrom',
});
if (Array.isArray(existing) && existing.length > 0) continue;
await kmStore.addRelation({...});
```

### WR-07: `digestedObsIds` bookkeeping differs between merge and insert branches — merge branch only counts obs ids from the **incoming** digest, not the merged-target's prior list

**File:** `src/live-logging/ObservationConsolidator.js:1263, 1338`
**Issue:** In the merge branch (line 1263), only `d.observationIds` (the incoming digest's ids) are added to `digestedObsIds`. But the merge target's pre-existing `observation_ids` (loaded into `oidUnion` at line 1222) are NOT added. Since `digestedObsIds` drives the later `mergeAttributes({digested_at: now})` stamping loop at line 1346, observation ids that are already on the merge target but appear ONLY in the merge target (not in the incoming digest) will not get re-stamped. This is probably fine semantically (those ids were already stamped on a prior consolidation), but the asymmetry is confusing and could become incorrect if the stamping logic ever changes to "stamp on every merge cycle."

**Fix:** Document explicitly that `digestedObsIds` represents "ids processed in THIS pass" rather than "ids on the resulting Digest." Or, more robust, add the union:

```javascript
for (const oid of oidUnion) digestedObsIds.add(oid);
```

## Info

### IN-01: Variable shadowing — `orphans` at repair-script line 461 shadows outer `orphans` array

**File:** `scripts/repair-orphan-digest-insight-edges.mjs:294, 461, 469`
**Issue:** Outer `let orphans` at line 294 holds the array of orphan entities. Inside the post-stats `try` block at line 461, `const orphans = s.orphanCount ?? s.orphans ?? '?'` shadows it with a SCALAR. Currently safe because the inner const is block-scoped to inside the `if (res.ok)` and the try{}, so the return statement at line 469 sees the outer array. But this is fragile under refactor.

**Fix:** Rename the inner one: `const orphanCount = s.orphanCount ?? s.orphans ?? '?';`

### IN-02: `process.exit(2)` from inside `processGraphLayer` and `preflightGraph` bypasses session-log flush

**File:** `scripts/repair-orphan-digest-insight-edges.mjs:159, 172, 299, 305, 488, 491`
**Issue:** `process.exit(2)` is called from inside async helpers. The session log is flushed only via `appendSession` (sync writeFileSync, OK) or via the end-of-function paths, so an early exit-2 may leave the session log without a final marker recording the abort cause. Not data-loss-critical, just inconvenient for forensics.

**Fix:** Call `appendSession({event: 'preflight-abort', kmcoreRestBase: KMCORE_REST_BASE, reason})` before each `process.exit(2)` so the session log records the abort cause.

### IN-03: Consolidator test does not test the `addRelation` self-loop guard, only the merge path

**File:** `src/live-logging/ObservationConsolidator.test.js:190-226`
**Issue:** The plain-insert `derivedFrom` loop at OC.js:1310 has `if (!obsId) continue;` but no `if (obsId === digestMintedId) continue;` self-loop guard. The repair script has one (line 339). Probably impossible in practice (a freshly-minted Digest id cannot equal a pre-seeded Observation legacy id), but the writer-side `_emitMentionsEdges` has a `if (toId === fromId) continue;` guard for the same family of concern. Worth either adding for symmetry or adding a test that confirms the absence is intentional.

**Fix:** Either add the self-loop guard:

```javascript
if (!obsId) continue;
if (obsEntity.id === digestMintedId) continue; // defensive self-loop guard
```

Or add a comment explaining why it isn't needed here.

### IN-04: Soak summary computes median via `Math.round((a+b)/2)` for even counts — loses fractional precision

**File:** `scripts/poll-orphan-floor-soak.mjs:204-206`
**Issue:** For an even-length sorted array `[1, 2]`, the canonical median is `1.5`. The code rounds to `2`. For integer orphan counts this typically doesn't matter, but the field is named `median` in the summary JSON and an analyst reading `[1, 2, 2, 3] → median: 2` (correct) vs `[1, 2] → median: 2` (rounded up from 1.5) may misinterpret.

**Fix:** Drop the rounding for the even-pair case, or document that the median is rounded to the nearest integer:

```javascript
const median = sortedOrphans.length
  ? sortedOrphans.length % 2 === 0
    ? (sortedOrphans[medianIdx - 1] + sortedOrphans[medianIdx]) / 2
    : sortedOrphans[medianIdx]
  : null;
```

---

_Reviewed: 2026-06-17T08:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
