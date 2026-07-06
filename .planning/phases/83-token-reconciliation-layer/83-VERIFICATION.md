---
phase: 83-token-reconciliation-layer
verified: 2026-07-06T10:45:00Z
status: gaps_found
score: 20/26 must-haves verified
overrides_applied: 0
re_verification: null
gaps:
  - truth: "reconciliation.json summary.aggregateDeltas contains the per-field SUM of perRequest[].deltas"
    status: failed
    reason: >
      CR-01: The roll-up loop in scripts/measurement-stop.mjs:449-453 guards on
      `typeof val === 'number'`, but computeDeltas (reconcile.mjs:181-192) produces
      objects `{wire, transcript, delta, flagged}` — never a plain number.
      The guard is always false; aggregateDeltas is written as `{}` on every span close.
      The 83-07 SUMMARY quotes `aggregateDeltas={}` as "zero deltas" evidence, but the
      code would produce `{}` even if every request had a large delta. The Plan-07 golden
      run happened to have zero actual deltas (perfect matches), so the dead code was not
      observable in the acceptance evidence — but the Phase-86 badge and any future flagged
      run will read empty aggregate data.
    artifacts:
      - path: scripts/measurement-stop.mjs
        issue: "Lines 449-453: `typeof val === 'number'` guard always false; val is {wire,transcript,delta,flagged}"
    missing:
      - "Fix guard to extract `val.delta` when val is an object: `const d = val && typeof val === 'object' ? val.delta : val; if (typeof d === 'number' && Number.isFinite(d)) { aggregateDeltas[field] = (aggregateDeltas[field] ?? 0) + d; }`"
      - "Add a unit test for the aggregateDeltas roll-up that seeds a perRequest with a non-zero delta and asserts the sum appears in the summary"

  - truth: "A healthy span shows unmatched_wire=0 (and the metric is meaningful, not vacuously true)"
    status: failed
    reason: >
      CR-02: `countUnmatchedWireRows` (stop-adapter-registry.mjs:589-595) queries
      `WHERE task_id = ? AND user_hash != ?`, excluding rows where user_hash equals
      adapterUserHash ('cladpt' for claude). But the proxy tap (server.mjs:2217) stamps
      claude wire rows with user_hash: adapterUserHash('claude') == 'cladpt'. So for
      a measured claude span, ALL wire rows are excluded by the filter; unmatched_wire
      is structurally 0 regardless of how many orphan wire rows exist. Plan-04's
      acceptance criteria explicitly said "never defaulted to 0 — which a silent default
      would make trivially pass"; the query achieves the same vacuous result by
      exclusion. The reconcile-mode test masks this by seeding wire rows with
      user_hash='wire01' (not 'cladpt'), which the production tap never writes for claude.
      Golden property 3 ("healthy span unmatched_wire=0") passes vacuously in the live run.
    artifacts:
      - path: lib/lsl/token/stop-adapter-registry.mjs
        issue: "Lines 589-595: WHERE user_hash != 'cladpt' excludes all claude tap wire rows; unmatched_wire is always 0 for claude spans"
      - path: tests/token-adapters/reconcile-mode.test.js
        issue: "Line 105: wire rows seeded with user_hash='wire01' — never matches production cladpt tap rows"
    missing:
      - "Change the query to scope by process/provenance rather than user_hash exclusion, or track matched wire row PKs (rowid) directly during the loop and query for rows with task_id whose rowid is not in the matched set"
      - "Add a reconcile-mode test that seeds wire rows with user_hash='cladpt' (production shape) and asserts the orphan is counted in unmatched_wire"

  - truth: "A routed claude cell's reconciled totals equal the pre-change transcript-only totals for all measured-span launch patterns"
    status: failed
    reason: >
      CR-03: Agents launched without TASK_ID (the normal `coding --claude` / `claude-mcp`
      interactive case) send `x-task-id: ` (blank header) for their entire lifetime because
      launch-agent-common.sh:418 exports ANTHROPIC_CUSTOM_HEADERS once at launch.
      After D-08 (server.mjs:2038-2045), a blank header stamps task_id='' on wire rows
      instead of inheriting the ambient span. When a span is later opened via dashboard
      Start/Stop (Phase 74) or manual measurement-start, measurement-stop invokes
      reconcile mode: transcript rows carry the span's task_id, they match the wire rows
      by tool_call_id (request-id), but RECONCILE_GAP_FILL_SQL (token-db.mjs:253-260)
      has no task_id column — the matched wire rows stay task_id=''. After the close,
      aggregateByTaskId(span.task_id) finds no foreground rows and the run reports
      total_tokens=0 with null canonical model. This is a regression: pre-83, the
      ambient inheritance stamped those rows with the span's task_id. The acceptance
      gate (Plan-07 golden comparison) used EXPERIMENT CELLS that launch WITH TASK_ID
      already set, so this interactive-launch regression was not exercised.
      The stale comment at launch-agent-common.sh:415-416 still says "the tap falls
      back to its ambient resolveLiveTaskId() (safety valve)" — the opposite of what
      D-08 now does — hiding the regression from operators reading the launcher (WR-09).
    artifacts:
      - path: lib/lsl/token/token-db.mjs
        issue: "RECONCILE_GAP_FILL_SQL (lines 253-260) has no task_id update; matched wire rows with task_id='' are never stamped with the span task_id"
      - path: scripts/launch-agent-common.sh
        issue: "Lines 415-416: stale comment claims blank header falls back to ambient span (was true pre-D-08; now stamps task_id='')"
    missing:
      - "Add `task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END` to RECONCILE_GAP_FILL_SQL and pass transcriptRow.task_id as the bind parameter"
      - "Add a reconcile-mode test where the seeded wire row has task_id='' and assert the reconcile gap-fill stamps the span task_id onto it"
      - "Correct the stale comment at launch-agent-common.sh:415-416 to state the no-inherit rule (D-08)"
---

# Phase 83: Token Reconciliation Layer — Verification Report

**Phase Goal:** cladpt/copadt transcript adapters become verify/enrich sources (new `reconcile` mode): wire rows are primary; transcript rows match by request-id (time+model fuzzy fallback); discrepancies recorded per span in `reconciliation.json`; transcript fallback preserved for proxy-down windows; copilot cache split merged from session-state — zero double-counting.
**Verified:** 2026-07-06T10:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Approach

Three critical code-review findings (CR-01, CR-02, CR-03) were independently verified against the actual source code before evaluating the must-have truths. The review's word was not taken — each finding was traced to exact file and line.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Malformed x-task-id header cannot crash proxy tap | VERIFIED | `safeSanitizeTaskId` wrapper + try/catch at server.mjs:2032-2035; WR-01-no-inherit sentinel at :2038 |
| 2 | Header-less tap rows carry no measured-cell task_id (D-08) | VERIFIED | server.mjs:2038-2045: blank header → `taskId = ''`; sentinel `WR-01-no-inherit` confirmed |
| 3 | One sanitized task_id form keys DB/in-memory-map/breakdown-filename | VERIFIED | `safeSanitizeTaskId` wraps the canonical `sanitizeTaskId` at every seam; server.mjs:2327-2329 |
| 4 | Copilot/opencode wire rows carry real cache_read_tokens (D-09) | VERIFIED | `parseOpenAICache` exported from usage-cache.ts:88; wired into server.mjs at :803, :913, :1094; 4/4 tests pass |
| 5 | Concurrent tap+adapter id collisions eliminated (D-11) | VERIFIED | `idx_token_usage_reqid` partial UNIQUE index + DB-authoritative id retry in token-usage.ts:663-686, :967; 3/3 tests pass |
| 6 | Proxy daemon alive after build+kickstart (Plan 02) | UNCERTAIN | Cannot re-verify live daemon; SUMMARY records confirmed live smoke test on 2026-07-06 |
| 7 | Transcript row matches wire row by tool_call_id across user_hash (D-04) | VERIFIED | `probeWireRowByRequestId` in token-db.mjs:272 uses `WHERE tool_call_id = ?` only; 13/13 matcher tests pass |
| 8 | Fuzzy time+model fallback when no request-id match | VERIFIED | reconcile.mjs:111-134; Test2/fuzzy passes |
| 9 | Wire counts never overwritten; enrich fills only wire-empty gaps (D-04) | VERIFIED | `RECONCILE_GAP_FILL_SQL`: MAX/COALESCE/CASE guards; Test confirms non-zero wire fields untouched |
| 10 | Every nonzero per-field delta recorded; out-of-tolerance flagged (D-05) | PARTIAL | Per-request deltas: VERIFIED (`computeDeltas` at reconcile.mjs:181-192 correctly returns `{wire,transcript,delta,flagged}` per field; 13/13 tests pass). But CR-01: the `summary.aggregateDeltas` roll-up in measurement-stop.mjs:449-453 is dead code — guard `typeof val === 'number'` is always false because `val` is the delta object, never a number |
| 11 | captureForegroundTokens in reconcile mode matches instead of blindly inserting | VERIFIED | stop-adapter-registry.mjs:467-557; reconcileRow called per row; zero-net-row match verified in Test 2 |
| 12 | No-match transcript rows insert as fallback with distinct provenance | VERIFIED | `token-adapter-claude-fallback` process stamp; Test 3 (fallback provenance) passes; live run Cell B confirmed |
| 13 | :reason:N rows always insert regardless of wire state | VERIFIED | reconcile.mjs:218-230 alwaysInsert logic; Test6 passes; live run Cell B confirmed |
| 14 | Interactive Stop/sweep path (non-reconcile) behavior unchanged | VERIFIED | `opts.reconcile` guard; Tests 1 and 6; dedup-merge regression suite 4/4 pass |
| 15 | captureForegroundTokens returns reconciliation report object | PARTIAL | Report shape VERIFIED. But CR-02: `unmatched_wire` is structurally always 0 for claude (query excludes all claude tap rows by user_hash) — the metric is vacuously correct, not meaningfully measured |
| 16 | measurement-stop invokes reconcile:true and writes reconciliation.json | VERIFIED | measurement-stop.mjs:420-422 (`reconcile: true`), :474-479 (sink write); grep confirms |
| 17 | reconciliation.json has a proper top-level summary + per-request array | FAILED | CR-01: `summary.aggregateDeltas` is always `{}` (dead roll-up guard). The `perRequest` array and all other summary fields are correct. The D-12 per-field aggregate is dead. |
| 18 | Flagged discrepancy never fails or invalidates the run (D-06) | VERIFIED | No taint marker written; advisory-only; D-06 comments throughout |
| 19 | GET /api/experiments/runs/:taskId/reconciliation: valid/400/ENOENT | VERIFIED | api-routes.js:90, :605-625; 5/5 route tests pass (including traversal-rejection) |
| 20 | Interactive copilot does NOT export COPILOT_PROVIDER_* (D-03) | VERIFIED | copilot.sh:72-79: explicit `unset COPILOT_PROVIDER_*` on interactive path |
| 21 | Measured copilot launches keep BYOK env | VERIFIED | launch-agent-common.sh:448-465: health-gated TASK_ID branch exports BYOK; experiment-runner.mjs unchanged |
| 22 | Unhealthy/no-span branch never leaves stale COPILOT_PROVIDER_BASE_URL | VERIFIED | copilot.sh:77: `unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY` |
| 23 | Routed claude cell totals == transcript-only totals (no double-count, no loss) | PARTIAL | VERIFIED for experiment cells (launched with TASK_ID). FAILED for interactive-launch spans (CR-03): agents launched without TASK_ID send blank x-task-id for their lifetime; after D-08 those wire rows get task_id=''; RECONCILE_GAP_FILL_SQL has no task_id column; aggregateByTaskId returns 0 foreground tokens. The acceptance run used only experiment cells. |
| 24 | Proxy-down cell fully falls back with fallback provenance | VERIFIED | Live run Cell B: reconciliation.json fallback=1, process=token-adapter-claude-fallback; summary confirmed on disk |
| 25 | Healthy span shows unmatched_wire=0 (metric meaningful) | FAILED | CR-02: countUnmatchedWireRows queries `WHERE user_hash != 'cladpt'` — excludes ALL claude tap wire rows (adapterUserHash('claude') = 'cladpt' at server.mjs:71). unmatched_wire is structurally 0 for any claude span. Golden property 3 passes vacuously. Test fixture uses user_hash='wire01' (never written by the production tap) to mask this. |
| 26 | reconciliation.json well-formed and readable via GET route | PARTIAL | per-request array: well-formed. summary.aggregateDeltas: always `{}` due to CR-01. All other fields correct. GET route verified. |

**Score:** 20/26 truths verified (3 FAILED, 3 PARTIAL — 3 BLOCKERS below)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/lsl/token/reconcile.mjs` | match+enrich+delta+tolerance, exports reconcileRow/matchWireRow/computeDeltas, min 60 lines | VERIFIED | 248 lines, all 3 exports present, 13/13 unit tests pass |
| `lib/lsl/token/token-db.mjs` | probeWireRowByRequestId + reconcileGapFill (cross-user_hash probe, gap-fill) | VERIFIED | Both functions exported; RECONCILE_PROBE_SQL keyed on tool_call_id ALONE |
| `tests/token-adapters/reconcile-matcher.test.js` | match/enrich/fallback/delta/tolerance unit coverage | VERIFIED | 13/13 pass including :reason: bypass and never-throw |
| `lib/lsl/token/stop-adapter-registry.mjs` | reconcile branch + copadt session-state cache merge | VERIFIED (with CR-02 gap) | reconcileRow wired; unmatched_wire query structurally broken for claude |
| `tests/token-adapters/reconcile-mode.test.js` | dispatch/fallback/report/unmatched_wire coverage | VERIFIED (masks CR-02) | 8/8 pass; wire rows seeded as 'wire01' not 'cladpt' |
| `scripts/measurement-stop.mjs` | reconcile invocation + reconciliation.json sink | VERIFIED (with CR-01 gap) | reconcile:true invoked; sink writes; aggregateDeltas dead code |
| `lib/vkb-server/api-routes.js` | handleReconciliation GET route | VERIFIED | Registered at line 90; 5/5 route tests pass |
| `tests/vkb-server/reconciliation-route.test.js` | valid/invalid/ENOENT + traversal gate | VERIFIED | 5/5 pass |
| `config/agents/copilot.sh` | BYOK removed from unconditional path | VERIFIED | Lines 72-79: defensive unset + log message |
| `scripts/launch-agent-common.sh` | BYOK in health-gated measured branch | VERIFIED | Lines 448-465: TASK_ID-gated export |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/usage-cache.ts` | parseOpenAICache helper (cached_tokens) | VERIFIED | Exported at line 88; 4/4 tests pass |
| `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` | duplicate-id constraint / coordinated allocation | VERIFIED | idx_token_usage_reqid; 3/3 tests pass |
| `config/experiments/wire-verify-83-reconcile.yaml` | golden-comparison spec (experiment_id, goal_sentence, variants) | VERIFIED | All required fields present; fresh experiment_id |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| reconcile.mjs `matchWireRow` | token_usage wire row | `WHERE tool_call_id = ?` (cross-user_hash) | VERIFIED | token-db.mjs:235-238 RECONCILE_PROBE_SQL confirmed |
| reconcile.mjs `reconcileRow` enrich | gap-fill UPDATE | `reconcileGapFill` fill-gaps-only | VERIFIED | token-db.mjs:253-260; does NOT include task_id (CR-03 root) |
| `captureForegroundTokens(reconcile:true)` | `reconcileRow` per row | stop-adapter-registry.mjs:515 | VERIFIED | import at :48; called per transcript row in the reconcile branch |
| fallback branch | `insertTokenRowDeduped` with fallback process tag | `token-adapter-claude-fallback` stamp | VERIFIED | stop-adapter-registry.mjs:540-547 |
| `countUnmatchedWireRows` | actual claude tap wire rows | `WHERE user_hash != 'cladpt'` EXCLUDES them | FAILED (CR-02) | Query inverts the correct filter; all production claude wire rows have user_hash='cladpt' |
| measurement-stop capture call | `captureForegroundTokens({reconcile:true})` | line 420-422 | VERIFIED | Only invocation of reconcile:true confirmed |
| `aggregateDeltas` roll-up | `perRequest[].deltas` field `.delta` | `typeof val === 'number'` guard | FAILED (CR-01) | val is `{wire,transcript,delta,flagged}` not a number; guard is always false |
| `handleReconciliation` | `.data/measurements/<taskId>/reconciliation.json` | `_validTaskId` gate + fs.readFile | VERIFIED | api-routes.js:605-624; traversal-rejection tested |
| ANTHROPIC_CUSTOM_HEADERS | `x-task-id: ${TASK_ID:-}` | launch-agent-common.sh:418 (once at launch) | WIRED (triggers CR-03) | Set once; blank when TASK_ID empty at launch; combined with D-08 no-inherit, all wire rows get task_id='' |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `scripts/measurement-stop.mjs` aggregateDeltas | `perRequest[r].deltas[field]` | `computeDeltas` → `{wire,transcript,delta,flagged}` object | No — guard rejects objects | HOLLOW: aggregateDeltas always `{}` (CR-01) |
| `stop-adapter-registry.mjs` unmatched_wire | `countUnmatchedWireRows` DB query | `WHERE task_id=? AND user_hash!='cladpt'` | No — excludes all production claude wire rows | HOLLOW: structurally 0 for claude (CR-02) |
| `aggregateByTaskId(span.task_id)` in measurement-stop | wire rows tagged with span task_id | `RECONCILE_GAP_FILL_SQL` (no task_id update) | No — wire rows stay task_id='' for interactive-launch agents | HOLLOW for interactive spans (CR-03) |

---

### Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| reconcile-matcher: all 13 unit behaviors | `node --test tests/token-adapters/reconcile-matcher.test.js` | 13/13 pass | PASS |
| reconcile-mode: all 8 unit behaviors | `node --test tests/token-adapters/reconcile-mode.test.js` | 8/8 pass (but wire rows use 'wire01' not 'cladpt') | PASS (masks CR-02) |
| reconciliation-route: 5 route behaviors | `node --test tests/vkb-server/reconciliation-route.test.js` | 5/5 pass | PASS |
| openai-cache-parse: 4 helper behaviors | `node --test tests/integration/openai-cache-parse.test.mjs` (proxy repo) | 4/4 pass | PASS |
| token-usage-dupid-constraint: 3 behaviors | `node --test tests/integration/token-usage-dupid-constraint.test.mjs` (proxy repo) | 3/3 pass | PASS |
| token-db-dedup-merge regression | `node --test tests/token-adapters/token-db-dedup-merge.test.js` | 4/4 pass | PASS |
| aggregateDeltas roll-up on non-zero delta | No unit test exists for this path | No test — dead code undetected | FAIL — dead code (CR-01) |

---

### Requirements Coverage (D-Decisions)

All 13 context decisions have at least one plan claiming them. Verified coverage:

| Decision | Plan | Verification Status | Notes |
|----------|------|--------------------|----|
| D-01 | 04, 05, 07 | VERIFIED | reconcile mode for measured spans only |
| D-02 | 04, 07 | VERIFIED | fallback with provenance; :reason: always-insert |
| D-03 | 06 | VERIFIED | BYOK gated; interactive copilot unsets COPILOT_PROVIDER_* |
| D-04 | 03, 04, 07 | VERIFIED | fill-gaps-only enrich; wire counts authoritative |
| D-05 | 03, 07 | PARTIAL | per-request deltas correct; aggregateDeltas summary dead (CR-01) |
| D-06 | 03, 04, 05 | VERIFIED | advisory-only; no run taint |
| D-07 | 01 | VERIFIED | safeSanitizeTaskId guard |
| D-08 | 01, 07 | VERIFIED in isolation; REGRESSION revealed by CR-03 | no-inherit correct; but combined with launcher header-set-at-launch, interactive spans lose attribution |
| D-09 | 02 | VERIFIED | parseOpenAICache wired at 3 shim sites |
| D-10 | 01 | VERIFIED | unified task_id seams |
| D-11 | 02 | VERIFIED | idx_token_usage_reqid + retry |
| D-12 | 05, 07 | PARTIAL | per-request array: correct. summary.aggregateDeltas: dead (CR-01) |
| D-13 | 05 | VERIFIED | GET route registered; 5/5 tests |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/measurement-stop.mjs` | 449-453 | `typeof val === 'number'` on a delta-object — dead guard | BLOCKER | aggregateDeltas always `{}` (CR-01) |
| `lib/lsl/token/stop-adapter-registry.mjs` | 589-595 | `user_hash != adapterUserHash` excludes the exact rows it should count | BLOCKER | unmatched_wire structurally 0 for claude (CR-02) |
| `lib/lsl/token/token-db.mjs` | 253-260 | RECONCILE_GAP_FILL_SQL lacks `task_id` update | BLOCKER | matched wire rows stay task_id=''; interactive spans lose attribution (CR-03) |
| `scripts/launch-agent-common.sh` | 415-416 | Stale comment: "tap falls back to ambient resolveLiveTaskId() (safety valve)" | WARNING | Documents the opposite of D-08 behavior; hides CR-03 from operators |
| `tests/token-adapters/reconcile-mode.test.js` | 105 | Wire rows seeded with user_hash='wire01' (not 'cladpt') | WARNING | Masks CR-02 — test passes while production query is broken |
| `lib/lsl/token/reconcile.mjs` | 21-24 | Comment: "wire and transcript rows carry DIFFERENT user_hash by design" — false for claude | INFO | Same as Review IN-01; the cross-hash framing misled CR-02 query design |

---

### Gaps Summary

Three critical defects were independently confirmed in the codebase, all flagged by the 83-REVIEW and each verified against the actual source:

**CR-01 — Dead aggregateDeltas roll-up (measurement-stop.mjs:449-453)**
The `summary.aggregateDeltas` in every `reconciliation.json` is always `{}`. The loop extracts `deltas[field]` but `computeDeltas` returns objects (`{wire,transcript,delta,flagged}`), not numbers. The `typeof val === 'number'` guard is always false. The acceptance run's `aggregateDeltas={}` in the SUMMARY was treated as "zero actual deltas" — which happened to be true for that run (perfectly matched pairs), but the dead code means Phase 86's badge will always read empty aggregate deltas even for mismatching runs. Fix: unwrap the `.delta` field before the type guard.

**CR-02 — unmatched_wire structurally 0 for claude (stop-adapter-registry.mjs:589-595)**
The post-loop `countUnmatchedWireRows` query excludes rows where `user_hash = 'cladpt'` (the `adapterUserHash` for claude). The proxy tap (server.mjs:2217) stamps claude wire rows with exactly `user_hash = 'cladpt'`. So for any measured claude span, all wire rows are excluded and `unmatched_wire` is trivially 0. The reconcile-mode unit test masks this by using `user_hash='wire01'` for seeded wire rows, which the production tap never writes. Plan-04 explicitly required that unmatched_wire "never defaulted to 0 — which a silent default would make trivially pass"; the query achieves the same vacuous result via exclusion. Fix: distinguish wire rows by `process` or track matched wire row PKs during the loop.

**CR-03 — Interactive-launch spans lose all foreground attribution (token-db.mjs:253-260 + launch-agent-common.sh:418)**
Agents launched without `TASK_ID` (normal interactive `coding --claude` case) export `ANTHROPIC_CUSTOM_HEADERS="x-task-id: "` (blank) for their entire lifetime. After D-08, the tap stamps `task_id=''` on blank-header wire rows. When a span is later opened via Phase 74's Start/Stop, measurement-stop invokes reconcile mode: transcript rows (with the span's task_id) match wire rows by tool_call_id, but `RECONCILE_GAP_FILL_SQL` has no `task_id` column update, so matched wire rows stay `task_id=''`. `aggregateByTaskId(span.task_id)` then returns 0 foreground rows. This is a regression from pre-83 behaviour (where ambient inheritance stamped those rows). The acceptance gate used experiment cells (launched WITH TASK_ID), which are unaffected. A stale comment at launch-agent-common.sh:415-416 still documents the pre-D-08 ambient fallback, hiding the regression. Fix: add `task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END` to `RECONCILE_GAP_FILL_SQL`.

**Root-cause grouping:** All three defects share a testing gap — the suite tests abstracted the production data shape away (wire01 not cladpt; no test for the sink roll-up path; no test for an interactive-launch wire row with task_id=''). The core reconcile machinery (matcher, enrich SQL, fallback, API route) is correct and fully tested; only the wiring around the output stage and the unmatched_wire metric is broken.

---

_Verified: 2026-07-06T10:45:00Z_
_Verifier: Claude (gsd-verifier)_
