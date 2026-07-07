---
phase: 83-token-reconciliation-layer
reviewed: 2026-07-06T14:31:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/openai-cache-parse.test.mjs
  - /Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/token-usage-dupid-constraint.test.mjs
  - config/agents/copilot.sh
  - config/experiments/wire-verify-83-reconcile.yaml
  - lib/lsl/token/reconcile.mjs
  - lib/lsl/token/stop-adapter-registry.mjs
  - lib/lsl/token/token-db.mjs
  - lib/vkb-server/api-routes.js
  - scripts/launch-agent-common.sh
  - scripts/measurement-stop.mjs
  - tests/token-adapters/reconcile-matcher.test.js
  - tests/token-adapters/reconcile-mode.test.js
  - tests/vkb-server/reconciliation-route.test.js
findings:
  critical: 2
  warning: 8
  info: 12
  total: 22
status: issues_found
---

# Phase 83: Code Review Report (Re-Review after Plan 83-08 Gap Closure)

**Reviewed:** 2026-07-06T14:31:00Z
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Re-review of the Phase 83 token-reconciliation scope after Plan 83-08
(commits b48979db8..a5caca166) closed the three blockers from the
2026-07-06T08:49Z review. **All three prior fixes are verified sound on the
claude path:**

- **Prior CR-01 (aggregateDeltas dead typeof guard) — FIXED.**
  `aggregatePerRequestDeltas` (`lib/lsl/token/reconcile.mjs:216-230`) correctly
  unwraps `.delta` before summing, skips non-finite values, never throws, and is
  wired into the sink (`scripts/measurement-stop.mjs:62,451`). Unit coverage
  (`tests/token-adapters/reconcile-matcher.test.js:486-530`) is adequate.
- **Prior CR-02 (vacuous unmatched_wire) — FIXED for claude.** The PK snapshot
  (`snapshotWireRowIds`, `lib/lsl/token/stop-adapter-registry.mjs:603-621`) keys on
  row identity; `countUnmatchedWireRows` and its user_hash exclusion are gone;
  regression tests seed production-shape `cladpt` wire rows. **However the same
  vacuous-zero defect persists for copilot via a different route** — new CR-02 below.
- **Prior CR-03 (task_id='' wire rows) — FIXED.** `RECONCILE_GAP_FILL_SQL`
  (`lib/lsl/token/token-db.mjs:260-268`) adds `task_id = CASE WHEN task_id = ''
  THEN ? ELSE task_id END`; bind order in `reconcileGapFill` (:311-321) matches the
  SQL positionally; the CR-03 test proves both backfill and never-overwrite.

Also resolved since the prior review: the stale launcher ambient-fallback comment
(prior WR-09 — `scripts/launch-agent-common.sh:414-421` now documents the
no-inherit + CR-03 recovery correctly) and the false "DIFFERENT user_hash by
design" header claim (prior IN-01 — `reconcile.mjs:25-31` now carries the CR-02
correction).

**New blockers found in this pass.** Adversarial tracing of the reconcile loop
shows the fuzzy matcher can consume rows that are not wire rows — including
fallback rows inserted seconds earlier in the same loop — silently dropping
transcript tokens in exactly the proxy-down scenario golden property (2) exists to
protect (an escalation of prior WR-02, which Plan 83-08 did not address). And the
CR-02 fix does not extend to copilot: copilot wire rows carry the machine hash, so
the copadt-keyed snapshot is always empty and `unmatched_wire` is structurally 0
for copilot spans.

Prior warnings/infos not addressed by 83-08 and re-verified as still present are
carried forward below with fresh line references.

## Critical Issues

### CR-01: Fuzzy matcher matches non-wire rows — including fallback rows inserted earlier in the same loop — silently dropping transcript tokens in the proxy-down scenario

**File:** `lib/lsl/token/reconcile.mjs:71-141` (`FUZZY_CANDIDATES_SQL` / `fuzzyMatch`), `lib/lsl/token/stop-adapter-registry.mjs:487-581` (`reconcileBatches`)

**Issue:** `FUZZY_CANDIDATES_SQL` selects **every** `token_usage` row with the
transcript's model — no restriction to the pre-loop wire snapshot, no exclusion of
rows inserted during the current loop, no exclusion of already-matched wire rows.
Three concrete failure modes:

1. **Proxy-down token loss (defeats golden property 2).** In the proxy-down cell
   there are no wire rows. Turn 1's request-id probe misses and it is
   fallback-inserted (same model, in-window timestamp). Turn 2's probe also misses,
   but `fuzzyMatch` now finds **turn 1's just-inserted fallback row** — consecutive
   agent turns are typically seconds apart, well inside the 2-min
   `DEFAULT_FUZZY_WINDOW_MS`. Turn 2 is reported `matched`, its tokens are **never
   inserted** (matched → zero net rows), and gap-fill mangles turn 1's row with
   turn 2's cache/reasoning values. Every subsequent turn within 2 min of any prior
   fallback row is likewise swallowed. The wire-verify gate
   (`config/experiments/wire-verify-83-reconcile.yaml` property 2) only asserts
   `summary.fallback > 0`, which turn 1 alone satisfies — the acceptance run passes
   while most of the cell's tokens are silently lost. The CR-02b test
   (`tests/token-adapters/reconcile-mode.test.js:513-548`) explicitly sidesteps this
   by giving the fallback turn "a DISTINCT model so it cannot fuzzy-match" — the
   hazard is acknowledged in the test but unguarded in production code.
2. **Double-consumption of one wire row** (prior WR-02, unfixed and escalated).
   `matchedWireRowIds` is recorded (`stop-adapter-registry.mjs:539`) but never fed
   back to exclude already-matched rows from later fuzzy matches. Two transcript
   rows can both "match" the same wire row; the second row's tokens are dropped
   with no fallback insert.
3. **Cross-session task_id stamping.** A fuzzy match can land on a same-model,
   in-window row belonging to a concurrent interactive session (`task_id=''`), and
   the CR-03 gap-fill then stamps the measured span's task_id onto that unrelated
   row while the measured transcript row's tokens are dropped.

**Fix:** Scope fuzzy candidates to the pre-loop wire snapshot and consume matches:

```js
// stop-adapter-registry.mjs — reconcileBatches: pass snapshot + consumed set
result = reconcileRow(db, transcriptRow, span, {
  ...opts,
  candidateWireIds: wireRowIds,        // pre-loop snapshot (Set<number>)
  consumedWireIds: matchedWireRowIds,  // already-matched PKs
});

// reconcile.mjs — fuzzyMatch: honor both sets
for (const c of candidates) {
  if (opts.candidateWireIds && !opts.candidateWireIds.has(c.id)) continue;
  if (opts.consumedWireIds && opts.consumedWireIds.has(c.id)) continue;
  ...
}
```

The request-id probe path is safe as-is (the partial unique index guarantees at
most one row per `(user_hash, tool_call_id)`, and a fallback row never carries a
later turn's request-id); only the fuzzy path needs the restriction.

### CR-02: `unmatched_wire` is still structurally 0 for copilot — the CR-02 fix repaired claude only

**File:** `lib/lsl/token/stop-adapter-registry.mjs:504,603-610` (`snapshotWireRowIds` keyed on `adapter.userHash`), `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2666-2736` (shim wire rows)

**Issue:** `snapshotWireRowIds` queries `WHERE user_hash = ?` bound to
`adapter.userHash` — `'copadt'` for copilot. But copilot BYOK wire rows are written
by the `/api/complete` pipeline `logTokenCall` at `server.mjs:2668`, which passes
**no `user_hash` field**, so `logCall` (`token-usage.ts:926`) defaults them to the
machine `USER_HASH`. Only the `/v1/messages` Anthropic tap stamps
`adapterUserHash(agent)` (`server.mjs:2217`) — copilot traffic never hits that
route (it uses `/v1/copilot/t/<taskId>/chat/completions`). Result: for a copilot
measured span the snapshot is always the **empty set** and `report.unmatched_wire`
is vacuously 0 — the exact defect class the prior CR-02 fix was supposed to
eliminate ("a matching bug surfaces as a metric, never a silent zero"). The
`snapshotWireRowIds` docstring's premise ("every row carrying the adapter
`user_hash` is a proxy-tap WIRE row") holds only for claude. As a knock-on, copilot
transcript rows only ever match via fuzzy (the wire rows carry `tool_call_id=''` —
see WR-06 — so the request-id probe can never hit), and fuzzy finds the machine-hash
rows precisely because it has no hash filter — so `matched` can be non-zero while
the snapshot that is supposed to audit those same rows sees none of them.

**Fix:** Stamp shim-originated agent traffic with the per-agent adapter hash at the
source, mirroring the `/v1/messages` tap — in the `/api/complete` `logTokenCall`
(`server.mjs:2668`):

```js
...(typeof body.agent === 'string' && body.agent
  ? { user_hash: adapterUserHash(body.agent) }
  : {}),
```

(`copadt` rows already take the DB-authoritative MAX(id)+1 allocation path, which is
collision-safe post-D-11.) Alternatively, scope `snapshotWireRowIds` for non-claude
agents by `task_id = ?` (copilot BYOK rows always carry an explicit path-bound
task_id) instead of the adapter hash.

## Warnings

### WR-01: `:reason:N` rows bypass the span-window clamp in reconcile mode — whole-session reasoning over-attribution

**File:** `lib/lsl/token/stop-adapter-registry.mjs:517-520`
**Issue:** (Carried forward — not addressed by 83-08.) The interactive loop
window-scopes **every** row (:433); the reconcile loop exempts reason-steps:
`if (!reasonStep && !withinSpanWindow(...)) continue;`. D-02 justifies bypassing the
*match* (the wire never carries a reasoning split), not the *window*.
`buildClaudeTokenRows` returns the whole ambient transcript, so a short measured
span over a long-lived session inserts every out-of-window `:reason:N` row stamped
with the span's task_id. Impact is bounded to `reasoning_tokens` (reason rows carry
`input/output/total = 0`, `claude-token-rows.mjs:218-232`), but it inflates the
measured run's reasoning metric with hours of unrelated thinking.
**Fix:** Apply the window clamp before the `reasonStep` branch (keep the match
bypass): `if (!withinSpanWindow(transcriptRow, span)) continue;`

### WR-02: Fallback insert overwrites the SUBAGENT_PROCESS marker — canonical-model selection can be hijacked in proxy-down runs

**File:** `lib/lsl/token/stop-adapter-registry.mjs:548`
**Issue:** `insertTokenRowDeduped(db, { ...transcriptRow, process: fallbackProcess })`
replaces whatever `batch.process` stamped — for sub-agent batches that is
`token-adapter-claude-subagent`. A proxy-down sub-agent row lands as
`token-adapter-claude-fallback`, so `isSubagentGroup`
(`scripts/measurement-stop.mjs:501`) no longer recognizes it, and a cheap
high-volume Explore sub-agent can win `fgGroups.find(...)` and become the run's
canonical chat model — the exact hijack SUBAGENT_PROCESS exists to prevent.
**Fix:** Compose provenance instead of replacing it (e.g.
`` process: batch.process ? `${fallbackProcess}-subagent` : fallbackProcess ``) and
match sub-agent groups by suffix in the canonical picker.

### WR-03: Proxy `logCall` dedup drops the richer duplicate — diverges from the coding-side merge-on-cache semantics

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:993-996,1016`
**Issue:** (Carried forward.) On a `(user_hash, tool_call_id)` hit, `logCall` drops
the incoming row even when the existing row is cache-less and the incoming row
carries cache/reasoning — whereas the coding-side `insertTokenRowDeduped`
(`token-db.mjs:331-361`) merges-on-cache in that situation. If a stop-time
transcript row lands first (e.g. proxy restart mid-session), a later tap write with
the real cache split is discarded.
**Fix:** Mirror the merge-on-cache branch (UPDATE cache/reasoning when the existing
row's cache sum is 0), or explicitly document first-writer-wins on the tap.

### WR-04: One-shot dup repair keeps the earliest rowid without merging — cache/reasoning data on the deleted duplicate is lost

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:671-684`
**Issue:** (Carried forward.) The pre-index repair `DELETE ... WHERE rowid NOT IN
(SELECT MIN(rowid) ... GROUP BY user_hash, tool_call_id)` unconditionally deletes
the later duplicate. When the earlier row is a cache-less transcript row and the
later one the cache-bearing tap row, the cache split is destroyed rather than
merged before deletion.
**Fix:** Before deleting, gap-fill the survivor from the doomed row (cache when
survivor cache sum is 0; `MAX(reasoning_tokens)`), mirroring `MERGE_ON_CACHE_SQL`.

### WR-05: Coding-side `insertTokenRow` still has no id-collision retry — the race D-11 fixed on the proxy side drops adapter rows on the coding side

**File:** `lib/lsl/token/token-db.mjs:132-173`
**Issue:** (Carried forward.) `insertTokenRow` computes `MAX(id)+1` and does a
single INSERT; a concurrent proxy write into the same adapter hash space (which now
happens by design — the tap stamps `cladpt`) between the SELECT and the INSERT
raises `SQLITE_CONSTRAINT` and the row is silently dropped (`return false`), with
no recompute-and-retry equivalent to `logCall`'s D-11 loop.
**Fix:** Wrap the INSERT in a bounded retry that recomputes `MAX(id)+1` on a
constraint error that is not a `(user_hash, tool_call_id)` duplicate — the same
probe-disambiguation `logCall` uses.

### WR-06: Copilot production wire rows carry `tool_call_id=''` — request-id matching, gap-fill, and cache-merge are all no-ops for copilot

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2716-2718` (comment: "tool_call_id/parent_call_id/reasoning_tokens stay unset here")
**Issue:** (Carried forward.) The `/api/complete` pipeline never sets
`tool_call_id`, so copilot BYOK wire rows have an empty request-id. Consequences in
the reconcile layer: the request-id probe can never match a copilot wire row;
`reconcileGapFill` returns false for a fuzzy-matched empty-id wire row (`token-db.mjs:310`),
so the CR-03 task_id backfill and the cache split never land; `wireToolCallId` is
falsy so the D-04 `copilotCacheSplit` merge (`stop-adapter-registry.mjs:644-660`)
can never apply in production (only in tests that seed synthetic shared ids).
**Fix:** Stamp a per-request id on shim-originated rows (e.g. the upstream
response id / a generated UUID threaded through `internalBody.tool_call_id`) so
copilot wire rows carry an identity.

### WR-07: `_validTaskId` accepts `'.'` and `'..'` — one-level path escape from `.data/measurements/`

**File:** `lib/vkb-server/api-routes.js:777-779` (used by `handleReconciliation` :614)
**Issue:** (Carried forward.) The regex `/^[A-Za-z0-9._-]+$/` matches dot-only
strings. `taskId='..'` (URL-encoded `%2E%2E` survives Express param decoding)
resolves `path.join(dataDir, 'measurements', '..', 'reconciliation.json')` →
`.data/reconciliation.json`, outside the intended directory. The docstring claims it
"mirrors the proxy span gate", but the proxy's `sanitizeTaskId`
(`measurement-span.ts:90`) explicitly rejects `'.'`/`'..'`. Impact is bounded (only
a file named `reconciliation.json` one level up), but the T-83-05-01 traversal
guard is incomplete and the test suite never probes dot-only ids.
**Fix:**
```js
_validTaskId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80
    && /^[A-Za-z0-9._-]+$/.test(id) && id !== '.' && id !== '..';
}
```

### WR-08: Machine-hash id counter never resynced after a collision retry — every subsequent `logCall` pays a failed INSERT + probe

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:999-1023`
**Issue:** (Carried forward.) When the first attempt (`handle.nextLocalId()`)
collides, the retry recomputes `MAX(id)+1` from the DB but never updates
`_localIdSeq` — which is now permanently behind, so **every** future machine-hash
insert first fails on the composite PK, runs the dedup probe, then retries. Correct
but wasteful and noisy in the constraint-error path.
**Fix:** After a successful retry insert, resync the counter (expose a
`handle.bumpLocalId(id)` or re-run `seedLocalSeq`).

## Info

### IN-01: `RECONCILE_GAP_FILL_SQL` updates every row sharing the tool_call_id (no user_hash/rowid scope)

**File:** `lib/lsl/token/token-db.mjs:260-268`
**Issue:** `WHERE tool_call_id = ?` has no `user_hash`/`id` bound; the partial
unique index only constrains per-hash, so a same-request-id row under a different
hash is also stamped with the span task_id/cache. `reconcileRow` now carries
`wireRowId` — consider `WHERE rowid = ?` keyed on the probed row.

### IN-02: `RECONCILE_PROBE_SQL` comment overstates determinism

**File:** `lib/lsl/token/token-db.mjs:230-238`
**Issue:** "ORDER BY id makes the earliest (wire) row the deterministic winner" —
ids are per-user_hash sequences, so a cross-hash comparison by bare `id` does not
order by insertion time. Deterministic, but not "earliest". Fix the comment (or
order by rowid).

### IN-03: `withinSpanWindow` duplicated in two modules

**File:** `lib/lsl/token/reconcile.mjs:102-110`, `lib/lsl/token/stop-adapter-registry.mjs:342-351`
**Issue:** Two copies of the same clamp (acknowledged in comments) with different
signatures; a future grace-window change must be made twice. Export one from a
shared location.

### IN-04: Shim/tap degrade a malformed explicit x-task-id to the ambient span

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs:2030-2036`
**Issue:** A malformed explicit `x-task-id` falls back to
`safeSanitizeTaskId(resolveLiveTaskId())` — i.e. the ambient span — which is the
inheritance behavior D-08 forbids for header-less requests. A caller that *tried*
to bind explicitly and failed gets silently rebound to whatever span is live.
Falling back to `''` (neutral) would be safer.

### IN-05: `logCall` re-prepares two statements on every insert

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:983-988`
**Issue:** `nextIdStmt`/`dedupStmt` are prepared per call in the hot path. Hoist to
module/handle scope like `insertStmt` (better-sqlite3 statement cache mitigates,
but the intent-level fix is trivial).

### IN-06: Reconciliation route's ENOENT shape differs from the served-file shape

**File:** `lib/vkb-server/api-routes.js:620-623`
**Issue:** A hit returns the file verbatim (`{schemaVersion, span, summary, perRequest}`);
a miss returns `{reconciliation: null}` — a different envelope. Consumers need two
shape branches. Consider `204`, or a consistent envelope for both cases.

### IN-07: Re-running a close re-counts `fallback` without inserting

**File:** `lib/lsl/token/stop-adapter-registry.mjs:545-548`
**Issue:** `report.fallback`/`unmatched_transcript` increment regardless of
`insertTokenRowDeduped`'s return value; on a re-run the dedup hit returns false but
the counters still climb, so a second close of the same span reports phantom
fallbacks. Count only when the insert returned true (or record a `deduped` counter).

### IN-08: Sink writes under `sanitizeTaskId(task_id)` while the read route looks up the raw id

**File:** `scripts/measurement-stop.mjs:471-476` vs `lib/vkb-server/api-routes.js:614`
**Issue:** If a task_id contains characters `sanitizeTaskId` strips, the file lands
under the sanitized name but `GET .../runs/<rawId>/reconciliation` joins the raw
id → permanent graceful-empty. Experiment ids are currently charset-safe, so this
is latent; align by sanitizing in the route too.

### IN-09: Stale test comments describe the deleted post-loop `unmatched_wire` query

**File:** `tests/token-adapters/reconcile-mode.test.js:26-27,413-415`
**Issue:** The header ("counted via the POST-LOOP DB query") and Test 7 banner still
describe the removed `countUnmatchedWireRows` design; the implementation is now a
pre-loop PK snapshot diff. Update the comments.

### IN-10: `num()` coalesces only null/undefined — NaN and strings pass through

**File:** `lib/lsl/token/reconcile.mjs:51-53`, `lib/lsl/token/token-db.mjs:88-90`
**Issue:** `v ?? 0` lets `NaN`/strings into `computeDeltas` arithmetic (a NaN delta
is recorded un-flagged; the aggregate helper then skips it) and into DB binds
(better-sqlite3 throws, caught non-fatally). Contrast `usage-cache.ts`'s
`Number.isFinite` guard. Fix:
`return typeof v === 'number' && Number.isFinite(v) ? v : 0;`

### IN-11: `unmatched_transcript` and `fallback` are always identical

**File:** `lib/lsl/token/stop-adapter-registry.mjs:546-547`
**Issue:** Both counters increment together in the single no-match branch — two
names for one number. Either document the intended divergence or make `fallback`
count actual successful inserts (see IN-07).

### IN-12: Wire snapshot admits concurrent-session `task_id=''` rows — `unmatched_wire` inflation when run attended

**File:** `lib/lsl/token/stop-adapter-registry.mjs:608`
**Issue:** `(task_id = ? OR task_id = '')` plus the span-window clamp means a
concurrent interactive claude session's tap rows (blank task_id per D-08) enter the
snapshot and, having no transcript counterpart in the measured cell, inflate
`unmatched_wire`. The wire-verify YAML mitigates by mandating UNATTENDED runs;
document the metric caveat or restrict the `''` arm to rows the CR-03 backfill
actually stamped.

---

_Reviewed: 2026-07-06T14:31:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
