---
phase: 83-token-reconciliation-layer
verified: 2026-07-07T11:30:00Z
status: gaps_found
score: 24/26 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 22/26
  gaps_closed:
    - "Truth 24 (proxy-down fallback): CR-01 fix correctly uses an empty snapshot for proxy-down cells — no wire rows means candidateWireIds is an empty Set, so no fuzzy match is possible for any turn; proxy-down fallback=2/matched=0 test passes"
    - "Truth 25 (unmatched_wire meaningful for copilot): CR-02 proxy fix stamps user_hash='copadt' on /api/complete BYOK wire rows (server.mjs:2717-2719); snapshotWireRowIds now sees a non-empty copadt snapshot; copilot orphan test (unmatched_wire=1) and healthy test (unmatched_wire=0) both pass"
  gaps_remaining:
    - "NEW BLOCKER: Wire-row identity in scoping Sets uses bare integer `id` (non-unique per table PK (user_hash, id)) — cross-adapter same-numeric-id collision can defeat the fuzzy candidate filter, corrupt unmatched_wire, and cause silent transcript-token loss in concurrent multi-agent scenarios"
  regressions: []
gaps:
  - truth: "Wire-row scoping identity uses a globally unique key — a cross-adapter same-numeric-id collision cannot cause a different-hash wire row to pass the candidateWireIds filter, steal a matchedWireRowIds slot, or corrupt unmatched_wire in concurrent multi-agent measurement"
    status: failed
    reason: >
      The table PK is composite (user_hash, id) — the D-11 migration allocates ids
      per-adapter hash starting at MAX(id)+1 within that hash's namespace, so
      cladpt id=1 and copadt id=1 coexist by design. But every 83-09 identity
      structure uses the bare integer id:
      snapshotWireRowIds (stop-adapter-registry.mjs:624) stores Set(r.id);
      FUZZY_CANDIDATES_SQL (reconcile.mjs:71-74) selects across ALL user hashes and
      the candidateWireIds/consumedWireIds filters use c.id (reconcile.mjs:143-144);
      matchedWireRowIds.add(result.wireRowId) records wireRow.id (reconcile.mjs:323,
      stop-adapter-registry.mjs:550); the post-loop diff keys on Set(id)
      (stop-adapter-registry.mjs:586-587). A copadt row with numeric id=1 passes
      candidateWireIds.has(1) because the cladpt snapshot also has id=1. The review's
      PoC (cladpt id=1 + copadt id=1, same model, in-window): result matched=1,
      fallback=0, unmatched_wire=0; the turn's tokens were silently dropped onto the
      copadt row, and the genuine cladpt wire row was hidden from the unmatched_wire
      diff. Because per-hash sequences all count from similar epochs, numeric overlap
      in a concurrent multi-agent session (cladpt+copadt active simultaneously) is
      near-certain.
    artifacts:
      - path: lib/lsl/token/reconcile.mjs
        issue: "Lines 143-144: candidateWireIds.has(c.id) / consumedWireIds.has(c.id) use bare integer id; FUZZY_CANDIDATES_SQL (71-74) selects across all user hashes so different-hash same-numeric-id rows reach the filter"
      - path: lib/lsl/token/stop-adapter-registry.mjs
        issue: "Line 624 (snapshotWireRowIds): ids.add(r.id) stores bare integer id; line 550: matchedWireRowIds.add(result.wireRowId) same; post-loop diff at 586-587 keys on bare integers"
      - path: lib/lsl/token/reconcile.mjs
        issue: "Line 323: wireRowId: wireRow.id ?? null returns the bare integer; rowid (globally unique SQLite rowid) is not selected"
    missing:
      - "Select rowid in FUZZY_CANDIDATES_SQL: `SELECT rowid AS rid, id, tool_call_id, model, timestamp, ...` and use c.rid for the candidateWireIds/consumedWireIds checks; return wireRowId: wireRow.rid"
      - "Select rowid in snapshotWireRowIds query: `SELECT rowid AS rid, id, tool_call_id, ...` and store ids.add(r.rid)"
      - "Add a regression test: seed cladpt id=N wire row + copadt id=N wire row (same model, in-window, different task), one claude transcript turn with unmatched request-id; assert report.fallback=1 and the cladpt wire row appears in unmatched_wire=1 (not consumed by the copadt collision)"
---

# Phase 83: Token Reconciliation Layer — Verification Report (Re-Verification after Plan 83-09)

**Phase Goal:** Token Reconciliation Layer — reconcile proxy wire-tap token rows with transcript-derived rows so per-span token attribution is complete, deduplicated, and meaningful across agents (claude, copilot), per CONTEXT decisions D-01..D-13.
**Verified:** 2026-07-07T11:30:00Z
**Status:** gaps_found
**Re-verification:** Yes — after plan 83-09 gap closure (closed prior NEW CR-01 fuzzy scoping + NEW CR-02 copilot copadt); 83-REVIEW.md post-83-09 surfaces one new critical (composite PK identity)

---

## Step 0: Re-Verification Mode

Previous VERIFICATION.md existed with `gaps:` section (status: gaps_found, score: 22/26, 2 blockers). This is re-verification mode.

**Previous gaps:**
1. Truth 24 — Proxy-down cell silently loses turn 2+ tokens via fuzzy match of turn 1's fallback row (FUZZY_CANDIDATES_SQL unscoped)
2. Truth 25 — unmatched_wire structurally 0 for copilot BYOK spans (machine USER_HASH on /api/complete logTokenCall)

Both were verified CLOSED by direct code inspection. One new critical found via the 83-REVIEW.md (post-83-09 re-review): composite PK collision.

---

## Previous Gap Status

| Previous Gap | Status | Evidence |
|---|---|---|
| NEW CR-01: FUZZY_CANDIDATES_SQL unscoped — turn 2 consumes turn 1's fallback in proxy-down runs | CLOSED | reconcile.mjs:143-144 guards `candidateWireIds.has(c.id)` / `consumedWireIds.has(c.id)`; stop-adapter-registry.mjs:516 threads both Sets into reconcileRow opts; proxy-down test passes (fallback=2, matched=0) |
| NEW CR-02: copilot BYOK wire rows carry machine USER_HASH — snapshot always empty — unmatched_wire vacuously 0 | CLOSED | server.mjs:2717-2719 stamps `user_hash: adapterUserHash(body.agent)` when body.agent non-empty; copilot-orphan test (unmatched_wire=1) and copilot-healthy test (unmatched_wire=0) pass; proxy daemon running build `9f9ab3d` |

---

## Plan 83-09 Must-Have Verification

| # | Must-Have | Status | Evidence |
|---|---|---|---|
| P09-1 | Proxy-down same-model two-turn: fallback=2, matched=0 — turn 2 never fuzzy-matches turn 1's just-inserted fallback row | VERIFIED | Empty snapshot (no cladpt wire rows) → candidateWireIds is empty Set → all fuzzy candidates filtered → fallback=2. Test `CR-01/proxy-down` passes. NOTE: composite PK does not affect this case — empty snapshot prevents any match regardless |
| P09-2 | Fuzzy match scoped to pre-loop wire snapshot minus already-consumed rows — no double-consumption, no loop-inserted fallback match | PARTIAL | Double-consumption and loop-inserted fallback guards work for same-hash scenarios (both tests pass). BUT: cross-adapter same-numeric-id row passes candidateWireIds.has(c.id) (bare integer, not globally unique) — a concurrent-session copadt row with id=N collides with a cladpt snapshot id=N and passes the filter (PoC by 83-REVIEW.md CR-01) |
| P09-3 | Copilot BYOK wire rows carry user_hash='copadt' — copadt snapshot non-empty — genuine orphan counted >= 1; matched span reports 0 | VERIFIED | server.mjs:2717-2719 stamps copadt; 4/4 proxy envelope tests pass (agent=copilot→copadt, opencode→opcadt, omitted→machine); copilot-orphan (unmatched_wire=1) and copilot-healthy (0) pass |

**Plan 83-09 score:** 2/3 must-haves fully verified; P09-2 partial due to composite PK defect.

---

## Goal Achievement (Full Phase — 26 Original Truths)

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Malformed x-task-id header cannot crash proxy tap | VERIFIED | `safeSanitizeTaskId` + try/catch at server.mjs:2032-2035 (unchanged) |
| 2 | Header-less tap rows carry no measured-cell task_id (D-08) | VERIFIED | server.mjs:2038-2045: blank header → `taskId = ''` (unchanged) |
| 3 | One sanitized task_id form keys DB/in-memory-map/breakdown-filename | VERIFIED | `safeSanitizeTaskId` at all three seams (unchanged) |
| 4 | Copilot/opencode wire rows carry real cache_read_tokens (D-09) | VERIFIED | `parseOpenAICache` wired at server.mjs:803/913/1094; 4/4 tests pass (unchanged) |
| 5 | Concurrent tap+adapter id collisions eliminated (D-11) | VERIFIED | `idx_token_usage_reqid` + retry in token-usage.ts:663-686; 3/3 tests pass (unchanged) |
| 6 | Proxy daemon alive after build+kickstart | UNCERTAIN | Proxy health check returns `{"status":"ok","build":"9f9ab3d"}` on :12435/health; PID 12178 confirmed running. Cannot re-verify daemon liveness programmatically in the future without re-running the check |
| 7 | Transcript row matches wire row by tool_call_id across user_hash (D-04) | VERIFIED | `probeWireRowByRequestId` in token-db.mjs uses `WHERE tool_call_id = ?` only; 18/18 matcher tests pass; request-id probe is deliberately unscoped (safe: partial-unique index gives ≤1 row per (user_hash, tool_call_id)) |
| 8 | Fuzzy time+model fallback when no request-id match | VERIFIED | reconcile.mjs:118-141 mechanism correct; CR-01 scoping guards added at 143-144; proxy-down and double-consumption tests pass. NOTE: scoping uses bare integer id — see new gap below for composite PK collision risk in concurrent multi-agent scenarios |
| 9 | Wire counts never overwritten; enrich fills only wire-empty gaps (D-04) | VERIFIED | RECONCILE_GAP_FILL_SQL: MAX/COALESCE/CASE guards (unchanged) |
| 10 | Every nonzero per-field delta recorded; out-of-tolerance flagged; aggregateDeltas sums perRequest (D-05) | VERIFIED | `aggregatePerRequestDeltas` at reconcile.mjs:216-230 unwraps `.delta`; measurement-stop.mjs imports and calls it; 18/18 matcher tests pass (unchanged from 83-08 closure) |
| 11 | captureForegroundTokens in reconcile mode matches instead of blindly inserting | VERIFIED | stop-adapter-registry.mjs:487-581; reconcileOpts now passes candidateWireIds+consumedWireIds; reconcileRow called per row (unchanged) |
| 12 | No-match transcript rows insert as fallback with distinct provenance | VERIFIED | `token-adapter-claude-fallback` stamp at line 548; proxy-down test confirms two distinct fallback rows |
| 13 | :reason:N rows always insert regardless of wire state | VERIFIED | reconcile.mjs:265-266 alwaysInsert; Test 4 passes (unchanged) |
| 14 | Interactive Stop/sweep path (non-reconcile) behavior unchanged | VERIFIED | `opts.reconcile` guard; 4/4 dedup-merge regression tests pass (unchanged) |
| 15 | captureForegroundTokens returns reconciliation report with meaningful unmatched_wire — across agents including copilot | VERIFIED | Old CR-02 closed for claude (PK snapshot); NEW CR-02 closed: copadt stamp → copilot snapshot non-empty; copilot-orphan (unmatched_wire=1), copilot-healthy (0) pass. WR-10 caveat: in production, copilot adapter emits ONE aggregate row per (session, model) while wire has per-call rows → healthy N-call span reports unmatched_wire≈N-1 (see Warnings section) |
| 16 | measurement-stop invokes reconcile:true and writes reconciliation.json | VERIFIED | measurement-stop.mjs:420-422 (`reconcile: true`), :474-479 (sink write) (unchanged) |
| 17 | reconciliation.json has proper top-level summary + per-request array (D-12) | VERIFIED | summary.aggregateDeltas carries real per-field sums; perRequest array correct; all fields present (closed in 83-08) |
| 18 | Flagged discrepancy never fails or invalidates the run (D-06) | VERIFIED | No taint marker written; advisory-only (unchanged) |
| 19 | GET /api/experiments/runs/:taskId/reconciliation: valid/400/ENOENT (D-13) | VERIFIED | api-routes.js:90, :605-625; 5/5 route tests pass (unchanged) |
| 20 | Interactive copilot does NOT export COPILOT_PROVIDER_* (D-03) | VERIFIED | copilot.sh:72-79: explicit `unset COPILOT_PROVIDER_*` on interactive path (unchanged) |
| 21 | Measured copilot launches keep BYOK env | VERIFIED | launch-agent-common.sh:448-465: TASK_ID-gated BYOK export (unchanged) |
| 22 | Unhealthy/no-span branch never leaves stale COPILOT_PROVIDER_BASE_URL | VERIFIED | copilot.sh:77: explicit unset (unchanged) |
| 23 | Routed claude cell totals == transcript-only totals (no double-count, no loss) | VERIFIED | RECONCILE_GAP_FILL_SQL backfills task_id on task_id='' wire rows; interactive-launch spans recover foreground attribution; 15/15 reconcile-mode tests pass (closed in 83-08) |
| 24 | Proxy-down cell fully falls back with fallback provenance — ALL tokens captured via transcript fallback (golden property 2) | NOW VERIFIED | Plan 83-09 CR-01 fix: empty snapshot (no proxy tap wire rows) → candidateWireIds is empty Set → fuzzyMatch skips all candidates → every turn falls back. Test `CR-01/proxy-down` (fallback=2, matched=0, two distinct fallback rows in DB) passes. Composite PK defect does NOT affect this case: the copadt snapshot for a proxy-down scenario is empty regardless, so cross-hash collisions are impossible |
| 25 | Healthy span shows unmatched_wire=0 (metric meaningful, not vacuously true) — across agents including copilot | NOW VERIFIED | Plan 83-09 CR-02 fix: copadt stamp on /api/complete → snapshotWireRowIds keyed on 'copadt' sees real wire rows; `CR-02/copilot-orphan` (unmatched_wire=1) and `CR-02/copilot-healthy` (0) pass. No longer vacuously 0. WR-10 caveat (aggregate-vs-per-call granularity mismatch) makes metric noisy in multi-call production sessions but does not make it vacuous |
| 26 | reconciliation.json well-formed and readable via GET route | VERIFIED | aggregateDeltas carries real data; perRequest array well-formed; 5/5 route tests pass (unchanged from 83-08 closure) |

**Score: 24/26 original truths verified** (up from 22/26; 2 gaps closed; 0 regressions to previously-verified truths)

---

### New Critical Finding (Post-83-09 Review)

**Not counted in the 26 original truths — new defect introduced by the 83-09 scoping mechanism.**

| Finding | Status | Evidence |
|---|---|---|
| Wire-row identity in candidateWireIds/consumedWireIds/matchedWireRowIds/unmatched_wire diff uses bare integer `id` (not globally unique) — cross-adapter same-numeric-id collision defeats the fuzzy scoping invariant in concurrent multi-agent scenarios | BLOCKER | reconcile.mjs:143-144 uses `c.id`; stop-adapter-registry.mjs:624 stores `r.id`; snapshotWireRowIds queries cladpt rows but FUZZY_CANDIDATES_SQL selects all hashes; PoC from 83-REVIEW.md CR-01: cladpt id=1 + copadt id=1 → turn "matched" the copadt row, transcript tokens dropped, unmatched_wire=0 (should be 1). D-11 per-hash sequences make same-numeric-id near-certain in any concurrent multi-agent session |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/lsl/token/reconcile.mjs` | fuzzyMatch scoped with candidateWireIds/consumedWireIds guards; aggregatePerRequestDeltas exported | VERIFIED (with composite PK caveat) | 306 lines; guards at :143-144; aggregatePerRequestDeltas at :216; composite PK defect: uses `c.id` not `c.rid` |
| `lib/lsl/token/stop-adapter-registry.mjs` | reconcileBatches threads candidateWireIds+consumedWireIds; snapshotWireRowIds for copadt | VERIFIED (with composite PK caveat) | reconcileOpts at :516; wireRowIds/matchedWireRowIds threaded; snapshot queries copadt user_hash; stores `r.id` (bare int, not rowid) |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | /api/complete logTokenCall stamps user_hash: adapterUserHash(body.agent) | VERIFIED | Lines 2717-2719; copilot BYOK shim sets body.agent='copilot'; omitted agent → machine hash (backward compatible); build `9f9ab3d` live on running daemon |
| `tests/token-adapters/reconcile-mode.test.js` | proxy-down two-turn + double-consumption + copilot orphan + copilot healthy tests | VERIFIED | 4 new tests at lines 708-848; all 15 pass (11 existing + 4 new) |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/tests/integration/agent-envelope-passthrough.test.mjs` | copilot→copadt / opencode→opcadt / omitted→machine row-contract test | VERIFIED | Test (d) at line 162; 4/4 pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fuzzyMatch` (reconcile.mjs:127) | pre-loop wire snapshot (candidateWireIds) | `opts.candidateWireIds instanceof Set` guard at :143 | VERIFIED (with composite PK caveat) | Guard exists and executes; but Set contains bare integer ids (not globally unique) |
| `fuzzyMatch` (reconcile.mjs:127) | already-consumed rows (consumedWireIds) | `opts.consumedWireIds instanceof Set` guard at :144 | VERIFIED (with composite PK caveat) | Guard exists; prevents same-id re-match for single-hash scenarios |
| `reconcileBatches` reconcileOpts | `reconcileRow` opts | `candidateWireIds: wireRowIds, consumedWireIds: matchedWireRowIds` at stop-adapter-registry.mjs:516 | VERIFIED | Both Sets threaded by reference before loop; consumedWireIds populated after each match |
| `/api/complete` logTokenCall | copilot BYOK user_hash stamp | `user_hash: adapterUserHash(body.agent)` at server.mjs:2717-2719 | VERIFIED | Conditional stamp; omitted-agent path keeps machine hash; shim sets body.agent='copilot' |
| copadt-keyed `snapshotWireRowIds` | copilot BYOK wire rows | `WHERE user_hash = 'copadt'` now matches proxy-stamped rows | VERIFIED | Copilot orphan test seeds copadt rows and reports unmatched_wire=1 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `stop-adapter-registry.mjs` proxy-down fallback | `report.fallback` | Empty candidateWireIds Set → all fuzzy candidates filtered → every turn fallback-inserts | Yes — two distinct fallback rows in DB | FLOWING |
| `stop-adapter-registry.mjs` copilot unmatched_wire | `wireRowIds.size - matchedWireRowIds.size` | snapshotWireRowIds keyed on 'copadt'; proxy now stamps copadt on /api/complete | Yes — copadt snapshot non-empty; orphan counted | FLOWING |
| `fuzzyMatch` cross-adapter concurrent scenario | `candidateWireIds.has(c.id)` | Set of bare integer ids from cladpt snapshot; FUZZY_CANDIDATES_SQL selects all hashes | No — a copadt row with same numeric id passes the filter (PoC proven) | HOLLOW (composite PK) |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| reconcile-mode: 15 tests (11 existing + 4 new: proxy-down, double-consumption, copilot-orphan, copilot-healthy) | `node --test tests/token-adapters/reconcile-mode.test.js` | 15 pass / 0 fail | PASS |
| reconcile-matcher: 18 tests (unchanged) | `node --test tests/token-adapters/reconcile-matcher.test.js` | 18 pass / 0 fail | PASS |
| token-db-dedup-merge regression: 4 tests | `node --test tests/token-adapters/token-db-dedup-merge.test.js` | 4 pass / 0 fail | PASS |
| reconciliation-route: 5 tests | `node --test tests/vkb-server/reconciliation-route.test.js` | 5 pass / 0 fail | PASS |
| proxy agent-envelope-passthrough: 4 tests (including new copilot→copadt test) | `node --test tests/integration/agent-envelope-passthrough.test.mjs` (in proxy repo) | 4 pass / 0 fail | PASS |
| Proxy daemon liveness | `launchctl list com.coding.llm-cli-proxy` + `curl :12435/health` | PID 12178, status:ok, build:9f9ab3d | PASS |
| Cross-adapter same-numeric-id collision: copadt id=N collides with cladpt snapshot id=N | No test exists (PoC from 83-REVIEW.md) | cladpt turn silently matched copadt row; unmatched_wire=0 instead of 1 | FAIL (composite PK) |

---

### Requirements Coverage (D-Decisions)

| Decision | Plan | Status | Notes |
|----------|------|--------|-------|
| D-01 | 04, 05, 07 | VERIFIED | reconcile mode for measured spans only |
| D-02 | 04, 07, 09 | VERIFIED | fallback loud-not-silent; proxy-down captures all turns as fallback (golden property 2 restored by 83-09 CR-01); composite PK does not affect proxy-down (empty snapshot) |
| D-03 | 06 | VERIFIED | BYOK gated; interactive copilot unsets COPILOT_PROVIDER_* |
| D-04 | 03, 04, 07, 09 | VERIFIED | fill-gaps-only enrich; wire counts authoritative; copadt orphan counted |
| D-05 | 03, 07, 08 | VERIFIED | per-request deltas correct; aggregateDeltas carries real sums |
| D-06 | 03, 04, 05 | VERIFIED | advisory-only; no run taint |
| D-07 | 01 | VERIFIED | safeSanitizeTaskId guard |
| D-08 | 01, 07, 08 | VERIFIED | no-inherit correct; interactive-launch attribution recovery via CR-03 gap-fill |
| D-09 | 02 | VERIFIED | parseOpenAICache wired at 3 shim sites |
| D-10 | 01 | VERIFIED | unified task_id seams |
| D-11 | 02 | VERIFIED | idx_token_usage_reqid + retry; NOTE: D-11's per-hash id sequences make same-numeric-id cross-adapter collisions near-certain — a correctness gap for the 83-09 scoping mechanism |
| D-12 | 05, 07, 08 | VERIFIED | per-request array correct; summary.aggregateDeltas real; copilot unmatched_wire no longer vacuously 0 |
| D-13 | 05 | VERIFIED | GET route registered; 5/5 tests |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `lib/lsl/token/reconcile.mjs` | 71-74, 143-144 | `candidateWireIds.has(c.id)` / `consumedWireIds.has(c.id)` use bare integer `id`; `FUZZY_CANDIDATES_SQL` selects across all user_hashes | BLOCKER | Cross-adapter same-numeric-id collision passes the filter — a copadt row with id=N defeats a cladpt snapshot id=N (PoC: 83-REVIEW.md CR-01) |
| `lib/lsl/token/stop-adapter-registry.mjs` | 624, 550, 586-587 | `ids.add(r.id)`, `matchedWireRowIds.add(result.wireRowId)`, post-loop diff all use bare integer id | BLOCKER | Same root cause as above — all three PK uses must switch to rowid |
| `tests/token-adapters/reconcile-mode.test.js` | (no test) | No test for cross-adapter same-numeric-id collision scenario | WARNING | The PoC scenario is unguarded; a regression could re-introduce the failure silently |
| `lib/lsl/token/stop-adapter-registry.mjs` | 528-531 | `:reason:N` rows bypass the span-window clamp in reconcile mode | WARNING | Out-of-window reasoning rows inflate the measured run's reasoning_tokens (WR-01 from 83-REVIEW) |
| `lib/lsl/token/stop-adapter-registry.mjs` | 559 | Fallback insert replaces batch.process with fallbackProcess — destroys SUBAGENT_PROCESS marker | WARNING | Proxy-down sub-agent row loses sub-agent identity; canonical model picker can be hijacked (WR-02) |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | 2717-2719 | CR-02 stamp removes all shim agent traffic from per-window JSON exports (exportToHourFile queries machine USER_HASH only) | WARNING | After a DB reset, every copilot/opencode/mastra agent wire row is unrecoverable; only machine-hash daemon rows survive (WR-09 from 83-REVIEW) |
| `lib/lsl/token/stop-adapter-registry.mjs` | 487-592 + copilot-token-rows.mjs | Copilot transcript emits ONE aggregate row per (session, model); wire side has per-call rows → healthy N-call copilot span reports unmatched_wire≈N-1 | WARNING | The copilot unmatched_wire metric is structurally noisy even for healthy spans; also risk of double-counting if session's last wire call precedes shutdown by >2 min (WR-10 from 83-REVIEW) |

---

### Human Verification Required

None beyond automated checks. All plan-09 correctness properties are verifiable programmatically.

---

### Gaps Summary

**One new critical defect found in the codebase by direct code inspection, confirmed by 83-REVIEW.md PoC. The two blockers from the previous verification are confirmed closed.**

**NEW BLOCKER — Wire-row identity uses non-unique bare integer `id` (reconcile.mjs:143-144, stop-adapter-registry.mjs:624,550,586-589)**

The table PK is composite `(user_hash, id)`. Each adapter hash has its own `MAX(id)+1` sequence (D-11), so `cladpt id=1` and `copadt id=1` coexist by design. The 83-09 scoping Sets (`wireRowIds`, `matchedWireRowIds`, `candidateWireIds`, `consumedWireIds`) all store bare integer ids. `FUZZY_CANDIDATES_SQL` (model-bound only) selects candidates across ALL user hashes. A copadt row with numeric id=N therefore passes `candidateWireIds.has(N)` when the cladpt snapshot contains id=N — the row is from the wrong adapter but the bare-integer filter cannot distinguish it.

Consequences (PoC-verified by 83-REVIEW.md):
1. The fuzzy match returns the wrong row (copadt instead of cladpt).
2. The transcript turn is marked "matched" against the copadt row; its tokens are not inserted (silent token loss for that turn).
3. `matchedWireRowIds.add(result.wireRowId)` records N — the legitimate cladpt wire row also has id=N and is now treated as consumed.
4. The cladpt wire row is hidden from the `unmatched_wire` diff (wireRowIds has N, matchedWireRowIds has N → diff = 0).

In a concurrent multi-agent session (cladpt + copadt active simultaneously — the exact milestone target), all four per-hash sequences start at similar epochs and quickly share numeric ids. The remaining preconditions (same model, in-window timestamp, a fuzzy-path turn) are satisfied by normal operation.

**Fix:** Use the SQLite `rowid` (globally unique across all rows, not per-hash) as the scoping key end-to-end:
- `FUZZY_CANDIDATES_SQL`: add `rowid AS rid` to the SELECT
- `snapshotWireRowIds`: add `rowid AS rid` to the SELECT; store `ids.add(r.rid)`
- `fuzzyMatch`: `candidateWireIds.has(c.rid)` / `consumedWireIds.has(c.rid)`
- `reconcileRow`: return `wireRowId: wireRow.rid ?? null`
- Add a regression test seeding same-numeric-id cladpt and copadt rows; assert the cladpt turn falls back (not consumed by the copadt collision)

**Root-cause note:** The CR-01 mechanism (candidateWireIds/consumedWireIds) is architecturally correct — the scoping approach is sound. The sole defect is the key type. Switching to `rowid` is a surgical 3-file fix with no behavioral change for the single-hash cases the existing 15 tests exercise (those tests never seed cross-adapter collisions).

**Relationship to previous gaps:** Truths 24 and 25 are genuinely closed by plan 83-09 — the proxy-down scenario uses an empty snapshot (no wire rows at all) which prevents any fuzzy match regardless of composite PK, and the copadt stamp + tests correctly verify the copilot unmatched_wire contract. The composite PK issue is a new defect discovered in the 83-09 fix itself, not a re-opening of the previous gaps.

---

_Verified: 2026-07-07T11:30:00Z_
_Verifier: Claude (gsd-verifier)_
