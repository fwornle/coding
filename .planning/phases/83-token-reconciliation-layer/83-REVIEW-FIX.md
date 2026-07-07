---
phase: 83-token-reconciliation-layer
fixed_at: 2026-07-07T12:05:00Z
review_path: .planning/phases/83-token-reconciliation-layer/83-REVIEW.md
iteration: 1
findings_in_scope: 12
fixed: 10
skipped: 2
status: partial
---

# Phase 83: Code Review Fix Report

**Fixed at:** 2026-07-07T12:05:00Z
**Source review:** .planning/phases/83-token-reconciliation-layer/83-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (Critical + Warning): 12
- Fixed: 10 (6 coding repo, 4 proxy repo)
- Skipped: 2 (WR-09, WR-10 — design-level changes, not mechanical fixes)

Fixes span two repos:
- **coding** (this repo): commits on `main` via reviewfix worktree branch
- **rapid-llm-proxy** (`/Users/Q284340/Agentic/_work/rapid-llm-proxy`): commits on `main`

**Proxy daemon restart:** performed per protocol. Health coordinator reported
`location: open` (`:3034/health/state`) before restart; `launchctl kickstart -k
gui/$(id -u)/com.coding.llm-cli-proxy` succeeded and `:12435/health` responds
with build tag `e72666a (2026-07-07)` — the WR-06 commit — confirming the new
code is live. `dist/token-usage.js` was rebuilt (`npm run build`) so the
running daemon carries WR-03/WR-04/WR-08 as well (dist is untracked/local-build
by repo convention).

**Test evidence:** coding: `node --test` reconcile suites 39/39 +
vkb/experiments 10/10 (49 total), jest suites 16/16. Proxy: `node --test`
integration suites 39/39. The CR-01 regression test was verified to FAIL
against pre-fix code and pass post-fix.

## Fixed Issues

### CR-01: Wire-row identity keyed on non-unique bare `id`

**Files modified:** `lib/lsl/token/reconcile.mjs`, `lib/lsl/token/token-db.mjs`,
`lib/lsl/token/stop-adapter-registry.mjs`, `tests/token-adapters/reconcile-mode.test.js`
**Commit:** `4e3f1bd36` (coding)
**Applied fix:** Exactly the verifier's prescription — row identity keys on
`rowid` end-to-end: `FUZZY_CANDIDATES_SQL` and `RECONCILE_PROBE_SQL` select
`rowid AS rid` (probe also `ORDER BY rowid`, which fixes the IN-02 determinism
nit as a side effect); the fuzzy guards use `c.rid`; `reconcileRow` returns
`wireRowId: wireRow.rid`; `snapshotWireRowIds` selects/stores `r.rid`.
`RECONCILE_PROBE_SQL` needed the `rid` too (beyond the two files the verifier
named) — otherwise request-id matches would never populate
`matchedWireRowIds` and every request-id-matched snapshot row would be
miscounted as an orphan. Legacy unscoped behavior when opts are absent is
preserved (all pre-existing unit tests green). Regression test
`CR-01/cross-hash-id-collision` (cladpt id=1 + copadt id=1, same model,
in-window): fails pre-fix (matched=1, unmatched_wire=0, copadt row consumed),
passes post-fix (fallback=1, unmatched_wire=1, copadt row untouched).

### WR-01: `:reason:N` rows bypass the span-window clamp

**Files modified:** `lib/lsl/token/stop-adapter-registry.mjs`
**Commit:** `116d9efc4` (coding)
**Applied fix:** The window clamp now applies to EVERY row in the reconcile
loop (`if (!withinSpanWindow(...)) continue;`); the D-02 match bypass for
reason rows is unchanged (in-window reason rows still always-insert).

### WR-02: Fallback insert overwrites the SUBAGENT_PROCESS marker

**Files modified:** `lib/lsl/token/stop-adapter-registry.mjs`, `scripts/measurement-stop.mjs`
**Commit:** `e0e00ac2f` (coding)
**Applied fix:** Fallback provenance composes
(`token-adapter-<agent>-fallback-subagent` when `batch.process ===
SUBAGENT_PROCESS`); `isSubagentGroup` in the canonical picker matches by
`-subagent` suffix. Verified `BACKGROUND_PROCESS_RE` does not match the
composed marker (fg classification unchanged).

### WR-03: Proxy `logCall` dedup drops the richer duplicate

**Files modified:** `src/token-usage.ts`, `tests/integration/token-usage-dupid-constraint.test.mjs`
**Commit:** `65e3d14` (proxy)
**Applied fix:** Both dedup exits (up-front probe + probe-insert race close)
now run `mergeOnCacheIfRicher()`, mirroring the coding-side
`insertTokenRowDeduped`: enrich the existing row in place only when its cache
sum is 0 and the incoming row carries cache/reasoning (overwrite-once, never
additive). Regression test (4) covers merge and never-overwrite directions.

### WR-04: One-shot dup repair destroys cache on the deleted duplicate

**Files modified:** `src/token-usage.ts`, `tests/integration/token-usage-dupid-constraint.test.mjs`
**Commit:** `b6e83b0` (proxy)
**Applied fix:** Before the DELETE, the survivor (MIN rowid) is gap-filled per
duplicate group: cache read+write taken together from the earliest
cache-bearing doomed row (same donor — no cross-row mixing),
`reasoning_tokens = MAX` across the group. Still one-shot (gated by the
existing `index_list` check) and best-effort. Regression test (5): legacy
duplicate pair collapses to the earliest-rowid survivor carrying the merged
split.

### WR-05: Coding-side `insertTokenRow` has no id-collision retry

**Files modified:** `lib/lsl/token/token-db.mjs`, `tests/token-adapters/token-db.test.js`
**Commit:** `e6e382e72` (coding)
**Applied fix:** The INSERT runs a bounded (3-attempt) recompute-and-retry
using the proxy logCall's D-11 probe-disambiguation: a constraint error that
IS a `(user_hash, tool_call_id)` duplicate drops (dedup semantics, no
double-count); anything else recomputes `MAX(id)+1` and retries. Regression
tests: stale-seed collision retries to a fresh id and inserts; duplicate
request-id under the partial-unique index drops with exactly one row left.

### WR-06: Copilot production wire rows carry `tool_call_id=''` — **requires human verification**

**Files modified:** `proxy-bridge/server.mjs`
**Commit:** `e72666a` (proxy)
**Applied fix:** The OpenAI shim threads a generated per-request id
(`shim-<uuid>`) via `internalBody.tool_call_id`, and the `/api/complete`
pipeline binds `body.tool_call_id` onto the logged row (direct callers that
omit it keep the `''` default). This gives copilot BYOK / opencode / mastra
wire rows an identity, enabling the request-id probe, `reconcileGapFill`
(CR-03 task_id backfill + cache split), and the D-04 `copilotCacheSplit`
merge in production. Flag: no HTTP-level automated test exercises the running
shim (the row-contract suite mirrors logic per IN-13); verified via
`node --check`, the 21-test shim/stamping suite, and the daemon restart
(build tag `e72666a` live on :12435). A live copilot BYOK session should be
observed writing `copadt` rows with non-empty `tool_call_id` before this is
considered closed.

### WR-07: `_validTaskId` accepts `'.'` and `'..'`

**Files modified:** `lib/vkb-server/api-routes.js`, `tests/vkb-server/reconciliation-route.test.js`
**Commit:** `41105d154` (coding)
**Applied fix:** Exactly the review's suggested guard (`id !== '.' && id !==
'..'`), plus the previously-missing dot-only probe test (both `'.'` and
`'..'` now assert 400).

### WR-08: Machine-hash id counter never resynced after a collision retry

**Files modified:** `src/token-usage.ts`, `tests/integration/token-usage-dupid-constraint.test.mjs`
**Commit:** `d292cba` (proxy)
**Applied fix:** New optional `handle.bumpLocalId(id)` (monotonic) on the
`TokenUsageDb` handle; `logCall` calls it after every successful machine-hash
insert, resyncing the counter past a DB-allocated retry id (no-op on the fast
path). Regression test (6): after a forced collision retry, `nextLocalId()`
returns `MAX(id)+1` instead of the stale value.

### WR-11: Snapshot's `task_id=''` arm feeds concurrent interactive rows into fuzzy matching

**Files modified:** `lib/lsl/token/stop-adapter-registry.mjs`, `tests/token-adapters/reconcile-mode.test.js`
**Commit:** `5b451f4b3` (coding)
**Applied fix:** The review's stated minimum: `snapshotWireRowIds` now returns
two sets — `wireRowIds` (all rows; still drives the `unmatched_wire` diff, so
neutral orphans stay REPORTED) and `fuzzyCandidateIds` (task_id-bound rows
only), and fuzzy scoping uses the latter. Neutral `''` rows remain matchable
via the unscoped request-id probe (which only the span's own transcript can
hit), so the CR-03 interactive-launch backfill path is intact — verified by
the existing `CR-03/task_id gap-fill` test staying green. Regression test
`WR-11/neutral-row-capture`: a concurrent `''` tap row is never fuzzy-bound,
the turn falls back, the row keeps `task_id=''`.

## Skipped Issues

### WR-09: CR-02 stamping removes shim agent traffic from the per-window JSON exports

**File:** `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts:356-364`
**Reason:** Design decision, not a mechanical fix. The two options the review
offers (per-adapter-hash export files vs documenting adapter rows as
machine-local/non-durable) change the export/hydrate durability contract and
the on-disk file inventory that `hydrateFromExports` scans; choosing between
them affects `.data` wipe recovery semantics and needs an operator decision.
**Original issue:** `exportToHourFile` exports only machine-hash rows; post
CR-02 the copadt/opcadt/mstadt shim rows are never exported, so a DB wipe
permanently loses agent-attributed wire rows.

### WR-10: Copilot reconcile granularity mismatch (aggregate transcript vs per-call wire)

**File:** `lib/lsl/token/stop-adapter-registry.mjs:487-592`, `lib/lsl/token/copilot-token-rows.mjs`
**Reason:** Semantics change requiring a design decision on copilot reconcile
granularity (suppress the aggregate fallback when copadt wire rows exist vs
aggregate-vs-SUM(wire) comparison vs per-agent unmatched_wire semantics).
Each option changes what the reconciliation report MEANS for copilot spans
and what the property-3 gates should assert — a speculative pick here could
silently redefine the golden properties. Note: the WR-06 fix (wire rows now
carry request ids) is a prerequisite for the better options and is in place.
**Original issue:** healthy copilot spans structurally report
`unmatched_wire = N-1`; an idle-exit session double-counts via the aggregate
fallback.

---

_Fixed: 2026-07-07T12:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
