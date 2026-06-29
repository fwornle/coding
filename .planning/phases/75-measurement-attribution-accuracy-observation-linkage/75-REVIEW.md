---
phase: 75-measurement-attribution-accuracy-observation-linkage
reviewed: 2026-06-29T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - lib/experiments/run-write.mjs
  - lib/experiments/token-aggregate.mjs
  - lib/live-logging/etm-recapture.mjs
  - lib/lsl/token/stop-adapter-registry.mjs
  - scripts/measurement-stop.mjs
  - scripts/enhanced-transcript-monitor.js
  - src/live-logging/ObservationWriter.js
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
  - integrations/system-health-dashboard/src/components/performance/score-drawer.tsx
  - integrations/system-health-dashboard/src/components/performance/timeline.tsx
  - integrations/system-health-dashboard/src/components/nav-bar.tsx
  - playwright.config.ts
  - tests/experiments/canonical-attribution.test.mjs
  - tests/experiments/run-write.test.mjs
  - tests/experiments/token-aggregate.test.mjs
  - tests/live-logging/ETM-recapture.test.js
  - tests/lsl/token/stop-adapter-registry.test.mjs
  - tests/e2e/performance/canonical-columns.spec.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 75: Code Review Report

**Reviewed:** 2026-06-29
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 75 (measurement attribution accuracy & observation linkage). The core
phase invariants are well honored: `token-aggregate.mjs` opens the proxy DB
`readonly: true` with bound `?` params and no schema migration; only `claude`
carries a transcript `build` in `stop-adapter-registry.mjs` (copilot/opencode/
mastra are stamp-only — the double-count guard holds); `measurement-stop.mjs`
computes canonical from the first FOREGROUND group and persists `null` (never a
dominant-by-count fallback); all three dashboard surfaces READ the persisted
`canonical_model`/`background_models` rather than recomputing; and `writeRun`
keeps `null` heuristics null. The test suite is thorough and pins the finding-B
regression precisely.

However, the event-time re-capture path has two real crash defects around
invalid/absent message timestamps (one in the "pure" extracted helper, one as an
unhandled rejection in the ETM fire path), and there is a debug `console.log`
left in the phase-touched fire loop in violation of the project no-console rule.
Several robustness and type-correctness gaps round out the warnings.

## Critical Issues

### CR-01: `makeFire` throws `RangeError: Invalid time value` on a missing/unparseable last-message timestamp

**File:** `lib/live-logging/etm-recapture.mjs:96` (also `tsMs` at :77, `makeFire` at :91-104)
**Issue:** `makeFire` computes `const createdAt = new Date(tsMs(last)).toISOString();`.
`tsMs(m)` returns `Date.parse(m?.timestamp ?? '')`, which is `NaN` whenever the
last message in a batch lacks a `timestamp` (or carries an unparseable one).
`new Date(NaN).toISOString()` throws `RangeError: Invalid time value` (verified).
This exception escapes `computeRecaptureFires`, which the module header
explicitly advertises as a side-effect-free pure function. A single timestamp-less
transcript message at a batch boundary therefore takes down the whole re-capture
computation — exactly the kind of malformed-input the best-effort observation
path is supposed to survive. Note the header claims `created_at` is "the batch's
REAL last-message timestamp (D-08), never T0" but provides no fallback when that
timestamp is absent.
**Fix:**
```js
function makeFire(batch, taskId) {
  if (!batch || batch.length === 0) return null;
  const last = batch[batch.length - 1];
  const batchLastMessageUuid = last?.uuid ?? '';
  const lastMs = tsMs(last);
  // D-08: prefer the batch's real last-message timestamp; fall back to the
  // most-recent parseable message in the batch, then to now — NEVER throw.
  let ms = lastMs;
  if (!Number.isFinite(ms)) {
    for (let i = batch.length - 1; i >= 0; i--) {
      const t = tsMs(batch[i]);
      if (Number.isFinite(t)) { ms = t; break; }
    }
  }
  if (!Number.isFinite(ms)) ms = Date.now();
  const createdAt = new Date(ms).toISOString();
  return { created_at: createdAt, metadata: { task_id: taskId }, batchLastMessageUuid, dedupKey: batchLastMessageUuid, messages: batch };
}
```

### CR-02: ETM batch fire throws → unhandled promise rejection on an invalid exchange timestamp

**File:** `scripts/enhanced-transcript-monitor.js:880-882` (throw sites: `:925`, `:961`)
**Issue:** `_fireBatchObservation` builds message rows with
`createdAt: new Date(exchange.timestamp).toISOString()` (lines 925 and 961). When
`exchange.timestamp` is absent/unparseable, `new Date(undefined).toISOString()`
throws `RangeError: Invalid time value`. `_fireBatchObservation` is invoked from
`taskIdPromise.then((taskId) => { this._fireBatchObservation(...) })` in
`_firePromptSetObservation` (line 880-882) with **no `.catch`**, so the synchronous
throw inside the `.then` callback becomes an unhandled promise rejection. The
multi-transcript poll loop also has a `Number.isNaN(batchFirstMs)` guard in
`_splitIntoRecaptureBatches` (line 819) acknowledging timestamps can be missing,
yet the downstream stamp does not guard the same case. An unhandled rejection can
crash the long-lived ETM daemon (Node may terminate on unhandledRejection
depending on config) — i.e. a single malformed exchange can stall the entire
observation pipeline, the precise failure class this phase is meant to harden.
**Fix:** guard the timestamp before stamping AND attach a `.catch` to the fire:
```js
// helper
const safeIso = (ts) => {
  const ms = Date.parse(ts ?? '');
  return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
};
// at the two call sites:
createdAt: safeIso(exchange.timestamp),
// and in _firePromptSetObservation:
taskIdPromise.then((taskId) => {
  this._fireBatchObservation(batch, taskId, batchLastMessageUuid);
}).catch((err) => {
  process.stderr.write(`[ObservationTap] batch fire failed (non-fatal): ${err.message}\n`);
});
```

## Warnings

### WR-01: Debug `console.log` left in the phase-touched fire loop (no-console-log rule)

**File:** `scripts/enhanced-transcript-monitor.js:587`, `:590`, `:600`
**Issue:** Lines 587/590 are `console.log("[ObsDebug] ...")` debug artifacts and
line 600 is `console.log("⏰ Time-based flush ...")`, all inside the
multi-transcript processing path that this phase edits. CLAUDE.md / project rule
explicitly forbids `console.log` in `.js/.ts/.mjs` — use `process.stderr.write`
or the file's `this.debug()` logger (the rest of this very method already uses
`this.debug(...)` and `process.stderr.write(...)`). The `[ObsDebug]` lines are
left-over diagnostics that should be removed or downgraded to `this.debug`.
(Note: many other `console.*` calls exist elsewhere in this 4868-line file and
predate the phase — those are pre-existing, but 587/590/600 sit in the touched
fire path and should be cleaned as part of this work.)
**Fix:** replace with `this.debug(...)` (gated, no-op when debug off) or
`process.stderr.write(...)`; delete the `[ObsDebug]` lines outright.

### WR-02: `RunScore.not_scored` typed as `boolean` but persisted/consumed as the string `'trivial'`

**File:** `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:29` (consumer at `:625`)
**Issue:** The slice declares `not_scored?: boolean | null`, but the writer
(`lib/experiments/score-write.mjs:145` / `judge.mjs`) persists `not_scored` as the
string literal `'trivial'` (or `null`). `scoreStateOf` (line 625) does
`if (!run.score || run.score.not_scored) return 'not_scored'`, which is truthy for
`'trivial'` so it happens to work at runtime, but the TypeScript type is wrong —
any future code that does `run.score.not_scored === true` (matching the declared
type) would silently never match. Given the phase brief calls out TS strictness in
the slice, this latent type/value divergence should be corrected.
**Fix:** type it to the real domain: `not_scored?: 'trivial' | boolean | null`
(or narrow to `'trivial' | null` to match the writer) and keep the truthy check.

### WR-03: Foreground capture silently lost when the session JSONL mtime falls after `ended_at`

**File:** `lib/lsl/token/stop-adapter-registry.mjs:123-141` (`locateMainSessionJsonl`)
**Issue:** The locator filters candidate JSONLs to `mtime >= startMs && mtime <= endMs`
where `endMs = tsMs(span.ended_at, Date.now())`. For an interactive Claude session
the transcript is appended right up to (and often just after) the recorded
`ended_at` — the OS mtime can therefore be a few ms/seconds AFTER `ended_at`. When
that happens the active session file is excluded, `locateMainSessionJsonl` returns
`''`, and `captureForegroundTokens` logs "no main-session JSONL located" and
captures **zero** foreground tokens — defeating ATTR-03 (the whole point of the
stop adapter) for the most common case. The upper bound is too tight for the
file-being-written-now scenario.
**Fix:** widen the upper bound with a grace margin (and/or prefer the most-recent
file overlapping the window), e.g. `e.mtime >= startMs && e.mtime <= endMs + GRACE_MS`
with `GRACE_MS` on the order of a few minutes; or drop the upper bound entirely
and pick the most-recently-touched file whose mtime is `>= startMs`.

### WR-04: Direct-DB Artifacts patch builds a `LIKE '%Artifacts: none%'` query but is documented as a legacy fallback that should be dead

**File:** `scripts/enhanced-transcript-monitor.js:1051-1056` (and the parallel block at `:1108-1113`)
**Issue:** `_patchRecentObservationsWithArtifacts`/`_patchHistoricalArtifacts` keep a
"Direct DB path (legacy fallback)" that runs raw SQL against
`this.observationWriter.db`. Per ObservationWriter's own header (Plan 44-13) the
SQLite handle is GONE and the writer is HTTP-only via `ObservationApiClient`, so
`this.observationWriter.db` is always undefined and the guard
`if (!this.observationWriter.db) return;` makes this dead code. Dead DB-access
code that constructs SQL strings is a maintenance and audit hazard (it reads like
a live write path). It also embeds the agent via bound `?` (good) but the
`UPDATE ... SET summary = ?` path could resurrect direct DB mutation if a future
caller ever sets `.db`.
**Fix:** delete the legacy direct-DB branches now that the writer is HTTP-only, or
assert/`throw` if `.db` is ever truthy so the dead path can't silently reactivate.

### WR-05: `nav-bar.tsx` calls the Health API on a hardcoded `http://localhost:3033` cross-origin base

**File:** `integrations/system-health-dashboard/src/components/nav-bar.tsx:5-6,15,20`
**Issue:** Every other dashboard data path in this phase uses same-origin
`/api/...` (see `performanceSlice.ts` thunks, deliberately same-origin per their
comments). `nav-bar` instead hardcodes `http://localhost:${API_PORT||3033}` and
fetches cross-origin. This is brittle (breaks behind any reverse proxy / non-local
host / different port mapping) and inconsistent with the slice's same-origin
contract; the counts silently go to `null` on any CORS/host mismatch. Not a
security hole per se, but a correctness/robustness inconsistency introduced/kept
in a reviewed file.
**Fix:** route through the same-origin `/api/...` proxy like the performance
thunks, or document why the nav badges must bypass it; at minimum derive the base
from the same config the rest of the app uses rather than a literal.

### WR-06: `aggregateByTaskId` does not validate `taskId` type before binding

**File:** `lib/experiments/token-aggregate.mjs:92-116`
**Issue:** `taskId` is bound as a `?` param (correct — no injection), but the
function never checks it is a non-empty string. A `null`/`undefined`/object
`taskId` (e.g. a malformed span where `span.task_id` is missing) is passed
straight to better-sqlite3's `.get()/.all()`, which throws a binding TypeError.
The aggregator is otherwise carefully best-effort (missing DB → zero result), so
an unguarded bad `taskId` is an inconsistent failure mode. `measurement-stop.mjs`
calls `aggregateByTaskId(span.task_id)` and `span` can be the minimal
`{ task_id: closeMarker.task_id }` fallback — if a malformed marker ever yields a
non-string, the close path throws here instead of degrading.
**Fix:** early-guard: `if (typeof taskId !== 'string' || taskId === '') return { totals: zeroTotals(), byAgentModel: [] };`

## Info

### IN-01: `findPendingCloseRequest` sorts by string `localeCompare` on `requested_at`

**File:** `scripts/measurement-stop.mjs:175`
**Issue:** Markers are ordered by `String(b.requested_at).localeCompare(String(a.requested_at))`.
This only yields newest-first if `requested_at` is a lexically-sortable ISO-8601
string. It works for ISO timestamps but is fragile if a marker ever carries a
non-ISO or epoch-ms value. Minor.
**Fix:** parse to `Date.parse(...)` and compare numerically with NaN-last
fallback.

### IN-02: `_firedPromptKeys` / `_lastFiredExchangeUuid` keyed on `this.sessionId || this.agentType || 'default'` can collapse cursors across transcripts

**File:** `scripts/enhanced-transcript-monitor.js:859`
**Issue:** The cursor map key falls back to `this.agentType` (or `'default'`) when
`sessionId` is unset. In the multi-transcript loop `this.agentType` is swapped to
each transcript's agent, so two concurrent transcripts of the same agent type
without distinct session ids could share a cursor key and skip each other's
batches. In practice `sessionId` is usually set, so this is a latent edge case.
**Fix:** include the transcript path in the cursor key (the loop already iterates
`[tPath, tracker]`), e.g. `${this.sessionId || this.agentType}|${this.transcriptPath}`.

### IN-03: `timeline.tsx` `isEstimated` treats `tokens_estimated === 1` but the type allows arbitrary number

**File:** `integrations/system-health-dashboard/src/components/performance/timeline.tsx:39-41`
**Issue:** `tokens_estimated` is typed `number | null` (slice line 97) but
`isEstimated` only matches the exact value `1`. If the backend ever emits a
truthy non-1 count it would not be treated as estimated. Cosmetic/robustness only.
**Fix:** `row.tokens_estimated != null && row.tokens_estimated > 0` (or compare to
a documented boolean flag).

### IN-04: `playwright.config.ts` comment references a `webServer.reuseExistingServer` block that does not exist

**File:** `playwright.config.ts:13-15` vs `:70-88`
**Issue:** The top comment describes `webServer.reuseExistingServer: true`
behavior, but the config intentionally OMITS the `webServer:` block (explained at
the bottom). The stale top comment contradicts the actual config and could
mislead a future maintainer into expecting auto-spawn. Documentation only.
**Fix:** remove or correct the lines 13-15 comment to match the "operator runs the
server" contract documented at the bottom.

---

_Reviewed: 2026-06-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
