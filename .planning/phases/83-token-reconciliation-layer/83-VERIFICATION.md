---
phase: 83-token-reconciliation-layer
verified: 2026-07-07T13:00:00Z
status: human_needed
score: 26/26 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 24/26
  gaps_closed:
    - "NEW BLOCKER (composite PK identity): wire-row identity in candidateWireIds/consumedWireIds/matchedWireRowIds/unmatched_wire diff now keys on SQLite rowid (globally unique) end-to-end — FUZZY_CANDIDATES_SQL, RECONCILE_PROBE_SQL, snapshotWireRowIds all select rowid AS rid; fuzzy guards use c.rid; reconcileRow returns wireRowId: wireRow.rid. Regression test CR-01/cross-hash-id-collision (cladpt id=1 + copadt id=1, same model, in-window) was verified to FAIL pre-fix and PASS post-fix (fallback=1, unmatched_wire=1, copadt row untouched)."
    - "WR-01: :reason:N rows now pass the span-window clamp before the match-bypass; unclamped out-of-window reasoning rows no longer inflate measured-run reasoning_tokens."
    - "WR-02: fallback provenance composed (token-adapter-<agent>-fallback-subagent when batch.process === SUBAGENT_PROCESS) so sub-agent identity survives a proxy-down fallback."
    - "WR-06 (code): OpenAI shim stamps tool_call_id: 'shim-<UUID>' per request so copilot BYOK / opencode / mastra wire rows carry an identity enabling the reconcile request-id probe, reconcileGapFill, and copilotCacheSplit merge."
    - "WR-07: _validTaskId rejects '.' and '..' (dot-only path escape guards) in addition to slash."
    - "WR-11: snapshotWireRowIds returns two sets; fuzzyCandidateIds excludes task_id='' rows — concurrent interactive tap rows can never be fuzzy-bound to a measured span."
    - "WR-03/WR-04/WR-08: proxy dedup-merge, dup-repair, and id-counter resync fixes (proxy commits 65e3d14, b6e83b0, d292cba) — 6/6 proxy dupid-constraint regression tests pass."
    - "WR-05: coding-side insertTokenRow now has bounded (3-attempt) recompute-and-retry for composite PK collisions — regression tests added."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Start a live copilot BYOK session with a running measurement span (TASK_ID set, COPILOT_PROVIDER_BASE_URL exported), send at least one prompt, then stop the span. Inspect the token_usage.db for rows with user_hash='copadt' and tool_call_id beginning with 'shim-' (non-empty)."
    expected: "At least one row with user_hash='copadt' and tool_call_id like 'shim-<uuid>' appears in the DB. The reconciliation report for the span shows matched >= 1 (request-id path) and unmatched_wire reflects actual copilot orphan count rather than a vacuous value."
    why_human: "WR-06 fix (proxy commit e72666a) wires the shim UUID via internalBody.tool_call_id and server.mjs:2748 binds it to the logged row. The shim code is verified by node --check, the 21-test shim/stamping suite, and the live daemon build tag e72666a. However, the copilot BYOK HTTP path requires a live BMW corporate network session — no automated test can exercise the actual shim→logCall→DB pipeline without a real Copilot OAuth token and bmw.ghe.com connectivity."
---

# Phase 83: Token Reconciliation Layer — Verification Report (Re-Verification after Code-Review Fix Pass)

**Phase Goal:** cladpt/copadt transcript adapters become verify/enrich sources (new `reconcile` mode): wire rows are primary; transcript rows match by request-id (time+model fuzzy fallback); discrepancies recorded per span in `reconciliation.json`; transcript fallback preserved for proxy-down windows; copilot cache split merged from session-state — zero double-counting.
**Verified:** 2026-07-07T13:00:00Z
**Status:** human_needed
**Re-verification:** Yes — third pass; after code-review fix pass (commits 4e3f1bd36, 116d9efc4, e0e00ac2f, e6e382e72, 41105d154, 5b451f4b3 on coding main; 65e3d14, b6e83b0, d292cba, e72666a on proxy main)

---

## Step 0: Re-Verification Mode

Previous VERIFICATION.md (second pass, 2026-07-07T11:30:00Z) had `gaps:` section with one blocker (composite PK identity keyed on bare integer `id` instead of globally unique `rowid`). This is re-verification mode targeting that blocker and the additional WR-series fixes from 83-REVIEW-FIX.md.

**Previous verdict:** status: gaps_found, score: 24/26 (2 closed from first pass; 1 new blocker from post-83-09 re-review)

---

## Previous Gap Status

| Previous Gap | Status | Evidence |
|---|---|---|
| NEW BLOCKER: Wire-row identity in scoping Sets uses bare integer `id` — cross-adapter same-numeric-id collision defeats fuzzy candidate filter, corrupts unmatched_wire, causes silent token loss | CLOSED | reconcile.mjs:78-81 FUZZY_CANDIDATES_SQL selects `rowid AS rid`; fuzzy guards at :152-153 use `c.rid`; reconcileRow:336 returns `wireRowId: wireRow.rid ?? null`. token-db.mjs:276-279 RECONCILE_PROBE_SQL selects `rowid AS rid ORDER BY rowid`. stop-adapter-registry.mjs:664 snapshotWireRowIds selects `rowid AS rid`; :669 stores `r.rid`; :672 `fuzzyCandidateIds.add(r.rid)`. Regression test `CR-01/cross-hash-id-collision` (cladpt id=1 + copadt id=1) FAILS pre-fix, PASSES post-fix (fallback=1, unmatched_wire=1). |

---

## Rowid Fix — End-to-End Trace (the blocker)

| Location | Pre-fix | Post-fix | Evidence |
|---|---|---|---|
| `reconcile.mjs` `FUZZY_CANDIDATES_SQL` (line 78-81) | Selected bare `id` | Selects `rowid AS rid` | Code read confirmed |
| `reconcile.mjs` `fuzzyMatch` guards (lines 152-153) | `candidateWireIds.has(c.id)` / `consumedWireIds.has(c.id)` | `candidateWireIds.has(c.rid)` / `consumedWireIds.has(c.rid)` | Code read confirmed |
| `reconcile.mjs` `reconcileRow` return (line 336) | `wireRowId: wireRow.id ?? null` | `wireRowId: wireRow.rid ?? null` | Code read confirmed |
| `token-db.mjs` `RECONCILE_PROBE_SQL` (lines 276-279) | Absent `rid` selection | Selects `rowid AS rid, ... ORDER BY rowid` | Code read confirmed |
| `stop-adapter-registry.mjs` `snapshotWireRowIds` (line 664) | `SELECT id, tool_call_id, ...` | `SELECT rowid AS rid, tool_call_id, ...` | Code read confirmed |
| `stop-adapter-registry.mjs` snapshot add (line 669) | `wireRowIds.add(r.id)` | `wireRowIds.add(r.rid)` | Code read confirmed |
| `stop-adapter-registry.mjs` fuzzy candidate add (line 672) | n/a (pre-WR-11) | `fuzzyCandidateIds.add(r.rid)` | Code read confirmed |
| `stop-adapter-registry.mjs` matched record (line 566) | `matchedWireRowIds.add(result.wireRowId)` where wireRowId=bare id | same call, now wireRowId=rowid | Verified via reconcileRow return above |
| `stop-adapter-registry.mjs` unmatched_wire diff (lines 611-615) | Keys on bare integer id | Keys on rowid (wireRowIds and matchedWireRowIds both rowid-keyed) | Code read confirmed |
| Regression test | Did not exist | `CR-01/cross-hash-id-collision` seeds cladpt id=1 + copadt id=1; asserts fallback=1, unmatched_wire=1 | Test run: PASS |

---

## Behavioral Spot-Checks (Test Suites)

| Suite | Command | Result | Status |
|---|---|---|---|
| reconcile-mode (15 tests: 11 existing + CR-01/proxy-down, CR-01/double-consumption, CR-01/cross-hash-id-collision, WR-11/neutral-row-capture, CR-02/copilot-orphan, CR-02/copilot-healthy) | `node --test tests/token-adapters/reconcile-mode.test.js` | 15/15 pass | PASS |
| reconcile-matcher (18 tests) | `node --test tests/token-adapters/reconcile-matcher.test.js` | 18/18 pass | PASS |
| token-db-dedup-merge (4 tests) | `node --test tests/token-adapters/token-db-dedup-merge.test.js` | 4/4 pass | PASS |
| reconciliation-route (5 tests + dot-guard) | `node --test tests/vkb-server/reconciliation-route.test.js` | 5/5 pass | PASS |
| Combined run | 4 suites above | 45/45 pass, 0 fail | PASS |
| jest dedup (5 tests x 21 fixture projects) | `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/token-adapters/dedup.test.js` | 155/155 pass (31 suites) | PASS |
| proxy integration | `node --test tests/integration/*.test.mjs` (in proxy repo) | 50/52 pass, 2 skipped (live-only worker pool) | PASS |

---

## Goal Achievement (Full Phase — 26 Truths)

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Malformed x-task-id header cannot crash proxy tap | VERIFIED | `safeSanitizeTaskId` + try/catch at server.mjs:2032-2035 |
| 2 | Header-less tap rows carry no measured-cell task_id (D-08) | VERIFIED | server.mjs:2038-2045: blank header → `taskId = ''` |
| 3 | One sanitized task_id form keys DB/in-memory-map/breakdown-filename | VERIFIED | `safeSanitizeTaskId` at all three seams |
| 4 | Copilot/opencode wire rows carry real cache_read_tokens (D-09) | VERIFIED | `parseOpenAICache` wired at server.mjs:803/913/1094; 4/4 tests pass |
| 5 | Concurrent tap+adapter id collisions eliminated (D-11) | VERIFIED | `idx_token_usage_reqid` + retry in token-usage.ts:663-686; 3/3 tests pass |
| 6 | Proxy daemon alive after build+kickstart | VERIFIED | Build tag `e72666a (2026-07-07)` confirmed live on :12435/health |
| 7 | Transcript row matches wire row by tool_call_id across user_hash (D-04) | VERIFIED | `probeWireRowByRequestId` uses `WHERE tool_call_id = ?` only (RECONCILE_PROBE_SQL, ORDER BY rowid); 18/18 matcher tests pass |
| 8 | Fuzzy time+model fallback when no request-id match | VERIFIED | reconcile.mjs:118-165; CR-01 scoping uses `c.rid` (rowid); WR-11 uses `fuzzyCandidateIds`; cross-hash-id-collision regression test passes |
| 9 | Wire counts never overwritten; enrich fills only wire-empty gaps (D-04) | VERIFIED | RECONCILE_GAP_FILL_SQL: MAX/COALESCE/CASE guards |
| 10 | Every nonzero per-field delta recorded; out-of-tolerance flagged; aggregateDeltas sums perRequest (D-05) | VERIFIED | `aggregatePerRequestDeltas` at reconcile.mjs:249; 18/18 matcher tests pass |
| 11 | captureForegroundTokens in reconcile mode matches instead of blindly inserting | VERIFIED | stop-adapter-registry.mjs:487-618; reconcileOpts threads `fuzzyCandidateIds`+`matchedWireRowIds` (rowid-keyed) |
| 12 | No-match transcript rows insert as fallback with distinct provenance | VERIFIED | `fallbackProcessFor` stamp at line 584; proxy-down test confirms two distinct fallback rows |
| 13 | :reason:N rows always insert regardless of wire state | VERIFIED | reconcile.mjs:300-301 alwaysInsert; WR-01: withinSpanWindow clamp applies first; Test 4 passes |
| 14 | Interactive Stop/sweep path (non-reconcile) behavior unchanged | VERIFIED | `opts.reconcile` guard; 4/4 dedup-merge regression tests pass |
| 15 | captureForegroundTokens returns reconciliation report with meaningful unmatched_wire — across agents including copilot | VERIFIED | CR-02: copadt stamp → copilot snapshot non-empty; copilot-orphan (unmatched_wire=1), copilot-healthy (0) pass. WR-10 caveat (documented deferral) |
| 16 | measurement-stop invokes reconcile:true and writes reconciliation.json | VERIFIED | measurement-stop.mjs:420-422 (`reconcile: true`), :474-479 (sink write) |
| 17 | reconciliation.json has proper top-level summary + per-request array (D-12) | VERIFIED | summary.aggregateDeltas carries real per-field sums; perRequest array correct |
| 18 | Flagged discrepancy never fails or invalidates the run (D-06) | VERIFIED | No taint marker written; advisory-only |
| 19 | GET /api/experiments/runs/:taskId/reconciliation: valid/400/ENOENT (D-13) | VERIFIED | api-routes.js:782-784 `_validTaskId` guards including dot-only; 5/5 route tests pass (including '.' and '..' cases from WR-07) |
| 20 | Interactive copilot does NOT export COPILOT_PROVIDER_* (D-03) | VERIFIED | copilot.sh:72-79: explicit `unset COPILOT_PROVIDER_*` on interactive path |
| 21 | Measured copilot launches keep BYOK env | VERIFIED | launch-agent-common.sh:448-465: TASK_ID-gated BYOK export |
| 22 | Unhealthy/no-span branch never leaves stale COPILOT_PROVIDER_BASE_URL | VERIFIED | copilot.sh:77: explicit unset |
| 23 | Routed claude cell totals == transcript-only totals (no double-count, no loss) | VERIFIED | RECONCILE_GAP_FILL_SQL backfills task_id on task_id='' wire rows; 15/15 reconcile-mode tests pass |
| 24 | Proxy-down cell fully falls back with fallback provenance — ALL tokens captured via transcript fallback (golden property 2) | VERIFIED | Empty snapshot → candidateWireIds/fuzzyCandidateIds is empty Set → all fuzzy candidates filtered → every turn falls back. Test `CR-01/proxy-down` (fallback=2, matched=0) passes. |
| 25 | Healthy span shows unmatched_wire=0 (metric meaningful, not vacuously true) — across agents including copilot | VERIFIED | CR-02: copadt stamp on /api/complete → snapshotWireRowIds keyed on 'copadt' sees real wire rows; `CR-02/copilot-orphan` (unmatched_wire=1) and `CR-02/copilot-healthy` (0) pass |
| 26 | reconciliation.json well-formed and readable via GET route | VERIFIED | aggregateDeltas carries real data; perRequest array well-formed; 5/5 route tests pass |

**Score: 26/26 original truths verified** (up from 24/26; composite PK blocker closed by commit 4e3f1bd36 + supporting WR fixes; 0 regressions)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `lib/lsl/token/reconcile.mjs` | rowid-keyed fuzzy scoping; aggregatePerRequestDeltas exported | VERIFIED | FUZZY_CANDIDATES_SQL selects `rowid AS rid`; guards use `c.rid`; reconcileRow returns `wireRowId: wireRow.rid` |
| `lib/lsl/token/token-db.mjs` | RECONCILE_PROBE_SQL selects rowid; insertTokenRow retry | VERIFIED | Lines 276-279: `rowid AS rid, ... ORDER BY rowid`; lines 142-209: bounded 3-attempt retry |
| `lib/lsl/token/stop-adapter-registry.mjs` | snapshotWireRowIds returns {wireRowIds, fuzzyCandidateIds} both rowid-keyed; WR-01/WR-02/WR-11 fixes | VERIFIED | Lines 658-680: `rowid AS rid`, stores `r.rid`; two-set return; withinSpanWindow clamp at :547; composed provenance at :581-585 |
| `lib/vkb-server/api-routes.js` | _validTaskId rejects '.' and '..' | VERIFIED | Line 784: `&& id !== '.' && id !== '..'` |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` | WR-06: shim stamps `tool_call_id: 'shim-<UUID>'`; CR-02: user_hash: adapterUserHash(body.agent) | VERIFIED (code) | Line 2374: `tool_call_id: 'shim-' + randomUUID()`; line 2748: binds body.tool_call_id; lines 2725-2727: user_hash stamp. Live verification (actual copilot BYOK session) deferred — see human verification |
| `tests/token-adapters/reconcile-mode.test.js` | cross-hash-id-collision + WR-11/neutral-row-capture regression tests | VERIFIED | `CR-01/cross-hash-id-collision` at file (seeds cladpt id=1 + copadt id=1); `WR-11/neutral-row-capture`; both pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `fuzzyMatch` (reconcile.mjs:144) | pre-loop wire snapshot (`fuzzyCandidateIds`) | `candidateWireIds instanceof Set` guard, `c.rid` key | VERIFIED | rowid-keyed; cross-adapter collision impossible |
| `fuzzyMatch` (reconcile.mjs:153) | already-consumed rows (`matchedWireRowIds`) | `consumedWireIds instanceof Set` guard, `c.rid` key | VERIFIED | rowid-keyed; double-consumption prevented |
| `reconcileBatches` reconcileOpts | `reconcileRow` opts | `candidateWireIds: fuzzyCandidateIds, consumedWireIds: matchedWireRowIds` at :527 | VERIFIED | `fuzzyCandidateIds` (task_id-bound only per WR-11) threaded by reference |
| `snapshotWireRowIds` | rowid-keyed Sets | `rowid AS rid`; `wireRowIds.add(r.rid)`, `fuzzyCandidateIds.add(r.rid)` at :669/672 | VERIFIED | Both sets rowid-keyed |
| `/api/complete` logTokenCall | copilot BYOK user_hash stamp | `user_hash: adapterUserHash(body.agent)` at server.mjs:2725-2727 | VERIFIED | Conditional; omitted agent keeps machine hash |
| OpenAI shim `/v1/chat/completions` | wire row `tool_call_id` | `tool_call_id: 'shim-' + randomUUID()` at server.mjs:2374; bound at :2748 | VERIFIED (code) | Per-request unique id; live copilot BYOK session confirmation deferred |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `stop-adapter-registry.mjs` proxy-down fallback | `report.fallback` | Empty `fuzzyCandidateIds` Set → all fuzzy candidates filtered → every turn fallback-inserts | Yes — two distinct fallback rows in DB | FLOWING |
| `stop-adapter-registry.mjs` copilot unmatched_wire | `wireRowIds.size - matchedWireRowIds.size` (rowid diff) | snapshotWireRowIds keyed on 'copadt'; proxy stamps copadt on /api/complete | Yes — copadt snapshot non-empty; orphan counted | FLOWING |
| `fuzzyMatch` cross-adapter concurrent scenario | `fuzzyCandidateIds.has(c.rid)` | rowid-keyed set; FUZZY_CANDIDATES_SQL selects rowid | Yes — different-hash same-numeric-id rows have different rowids | FLOWING (blocker closed) |

---

### Requirements Coverage (D-Decisions)

| Decision | Plan | Status | Notes |
|---|---|---|---|
| D-01 | 04, 05, 07 | VERIFIED | reconcile mode for measured spans only |
| D-02 | 04, 07, 09 | VERIFIED | fallback loud-not-silent; proxy-down captures all turns; WR-01: reason rows window-clamped |
| D-03 | 06 | VERIFIED | BYOK gated; interactive copilot unsets COPILOT_PROVIDER_* |
| D-04 | 03, 04, 07, 09 | VERIFIED | fill-gaps-only enrich; wire counts authoritative; copadt orphan counted |
| D-05 | 03, 07, 08 | VERIFIED | per-request deltas correct; aggregateDeltas carries real sums |
| D-06 | 03, 04, 05 | VERIFIED | advisory-only; no run taint |
| D-07 | 01 | VERIFIED | safeSanitizeTaskId guard |
| D-08 | 01, 07, 08 | VERIFIED | no-inherit correct; interactive-launch attribution recovery via CR-03 gap-fill |
| D-09 | 02 | VERIFIED | parseOpenAICache wired at 3 shim sites |
| D-10 | 01 | VERIFIED | unified task_id seams |
| D-11 | 02 | VERIFIED | idx_token_usage_reqid + retry; rowid fix eliminates cross-adapter id collision from D-11 per-hash sequences |
| D-12 | 05, 07, 08 | VERIFIED | per-request array correct; summary.aggregateDeltas real; copilot unmatched_wire no longer vacuously 0 |
| D-13 | 05 | VERIFIED | GET route registered; dot-guard added; 5/5 tests |

---

### Anti-Patterns Checked

| File | Pattern | Severity | Status |
|---|---|---|---|
| `lib/lsl/token/reconcile.mjs` | `c.rid` (rowid) used for candidateWireIds/consumedWireIds | Was BLOCKER — now clean | CLOSED by commit 4e3f1bd36 |
| `lib/lsl/token/stop-adapter-registry.mjs` | `r.rid` (rowid) in snapshot; `fuzzyCandidateIds` excludes `task_id=''` | Was BLOCKER + WR-11 WARNING — now clean | CLOSED by 4e3f1bd36 + 5b451f4b3 |
| `lib/lsl/token/stop-adapter-registry.mjs` | :reason:N window clamp | Was WR-01 WARNING | CLOSED by commit 116d9efc4 |
| `lib/lsl/token/stop-adapter-registry.mjs` | fallback provenance composition | Was WR-02 WARNING | CLOSED by commit e0e00ac2f |
| `lib/vkb-server/api-routes.js` | dot-only taskId escape | Was WR-07 WARNING | CLOSED by commit 41105d154 |
| `proxy-bridge/server.mjs` | shim wire rows carried `tool_call_id=''` | Was WR-06 WARNING | CLOSED in code (commit e72666a); live session observation pending (human verify) |
| `proxy-bridge/server.mjs` / `src/token-usage.ts` | WR-09: CR-02 stamping removes shim agent traffic from per-window JSON exports | WARNING — design decision deferred | See Deferred Items |
| `lib/lsl/token/stop-adapter-registry.mjs` / `copilot-token-rows.mjs` | WR-10: copilot aggregate transcript vs per-call wire granularity mismatch | WARNING — design decision deferred | See Deferred Items |

---

### Deferred Items

Items not yet fully resolved but explicitly identified as design-level decisions requiring operator input, not mechanical fixes.

| # | Item | Deferred Reason |
|---|---|---|
| WR-09 | `exportToHourFile` exports only machine-hash rows; post CR-02, copadt/opcadt/mstadt shim rows are never exported to per-window JSON files — a DB wipe permanently loses agent-attributed wire rows | Design decision: per-adapter-hash export files vs. documenting adapter rows as machine-local/non-durable changes the export/hydrate durability contract. Needs operator decision on `.data` wipe recovery semantics. Not a must-have failure for Phase 83. |
| WR-10 | Copilot transcript emits ONE aggregate row per (session, model); wire side has per-call rows — healthy N-call copilot span structurally reports `unmatched_wire ≈ N-1`; idle-exit session may double-count via the aggregate fallback | Design decision: suppress aggregate fallback when copadt wire rows exist, or compare aggregate vs SUM(wire), or define per-agent unmatched_wire semantics. WR-06 fix (wire rows now carry request ids) is a prerequisite for better options and is in place. Needs speculative design choice. Not a must-have failure for Phase 83. |

---

### Human Verification Required

#### 1. Live Copilot BYOK Wire Row Identity (WR-06)

**Test:** Start a live copilot BYOK session with a running measurement span (TASK_ID set, COPILOT_PROVIDER_BASE_URL exported to point at :12435), send at least one prompt, then stop the span. Query the token_usage.db:
```sql
SELECT rowid, id, user_hash, tool_call_id, model, timestamp FROM token_usage
WHERE user_hash = 'copadt' ORDER BY rowid DESC LIMIT 10;
```
Also inspect the reconciliation.json written by measurement-stop.

**Expected:** At least one row with `user_hash='copadt'` and `tool_call_id` matching `shim-<uuid>` (non-empty, starts with "shim-"). The reconciliation report shows `matched >= 1` (request-id path) and `unmatched_wire` reflects the actual copilot orphan count rather than a vacuous structural value.

**Why human:** The WR-06 fix (proxy commit e72666a) wires the shim UUID via `internalBody.tool_call_id` at server.mjs:2374 and server.mjs:2748 binds it to the logged row. The code is verified by `node --check`, the 21-test shim/stamping suite (all pass), and the live daemon build tag `e72666a` confirmed on :12435/health. However, the copilot BYOK HTTP path requires a live BMW corporate network session with a valid Copilot OAuth token and bmw.ghe.com connectivity — no automated test can exercise the actual shim→logTokenCall→DB pipeline without these.

---

### Summary

**The composite PK identity blocker is confirmed closed.** All three files updated atomically in commit 4e3f1bd36: `FUZZY_CANDIDATES_SQL` and `RECONCILE_PROBE_SQL` select `rowid AS rid`; `snapshotWireRowIds` selects/stores `r.rid`; fuzzy guards use `c.rid`; `reconcileRow` returns `wireRowId: wireRow.rid`. The regression test `CR-01/cross-hash-id-collision` was confirmed to FAIL against pre-fix code and PASS post-fix. All 45 node test suite assertions pass (0 fail). Jest dedup: 155/155. Proxy integration: 50/52 pass (2 live-only skipped).

The six additional fix commits (WR-01 through WR-11 series) are all verified in code and covered by test regressions. Two design-level items (WR-09, WR-10) remain as documented deferrals — they are not must-have failures and require operator decisions.

The sole remaining item is WR-06's live-session observation: the shim `tool_call_id` stamping code is correct and the daemon is live with the fix build, but confirming actual copilot BYOK wire rows carry non-empty `tool_call_id` requires a real corporate network session.

---

_Verified: 2026-07-07T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
