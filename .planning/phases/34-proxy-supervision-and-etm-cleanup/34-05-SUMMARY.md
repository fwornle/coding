# Plan 34-05 SUMMARY — ETM Plan B + [🧠] proxy badge + dashboard surface

**Status:** Tasks 1 + 2 (partial) complete and on main. Task 2(d) dead-reader
cleanup, Task 3 (dashboard card), W-1 live tmux render, and browser-driven
dashboard verification are deferred operator gates.

**Commit:** `3351f6e89` — feat(34-05): delete 6 dead modules + add [🧠] proxy badge to statusline (Tasks 1+2 partial)

## What landed

### Task 1 — file deletions (D-08 Plan B)

Six source files deleted:
- `src/live-logging/RealTimeTrajectoryAnalyzer.js`
- `src/knowledge-management/StreamingKnowledgeExtractor.js`
- `src/knowledge-management/KnowledgeExtractor.js`
- `src/knowledge-management/KnowledgeDecayTracker.js`
- `src/knowledge-management/ConceptAbstractionAgent.js`
- `src/knowledge-management/TrajectoryAnalyzer.js`

Two standalone test files deleted:
- `tests/unit/knowledge-management/KnowledgeExtraction.test.ts`
- `scripts/test-knowledge-extraction.js`

Two partial-skip tests cleaned:
- `tests/unit/ontology/integration.test.js` — only had a dangling `import`
  for the deleted streaming-extractor; the describe blocks below it were
  ontology-only and never instantiated the deleted module. Dropped the
  import; left the suites running.
- `tests/acceptance/knowledge-system-acceptance.test.js` — gutted to a
  27-line skip-stub. The original 765+ LoC dynamic imports referenced
  `src/knowledge/*` paths that **never existed** in this codebase shape
  (the actual modules lived under `src/knowledge-management/`), so the
  suite had been a dead acceptance file before deletion. Replaced body
  with `describe.skip(...)` placeholder so CI surfaces "skipped" rather
  than a hard import failure.

KEEP-list audit confirmed all 7 live consumers untouched: `KnowledgeRetriever`,
`UKBDatabaseWriter`, `QdrantSyncService`, `KnowledgeStorageService`,
`GraphDatabaseService`, `KnowledgeQueryService`, `KnowledgeExportService`.

**SPEC AC #8 grep**: returns 0 lines across `.js / .ts / .cjs / .mjs`,
excluding `node_modules / dist / .specstory / site / .spec-workflow /
worktrees`. Verified end-to-end.

### Task 2 (partial) — getProxySystemStatus + [🧠] badge

`scripts/combined-status-line.js`:

1. **New `getProxySystemStatus()` method** mirrors `getKnowledgeSystemStatus()`
   pattern: GET `${HEALTH_COORDINATOR_URL}/health/state`, read `state.proxy`
   slice, map `(semantic_ok, auto_heal_status)` to the D-12 6-state enum:
   - `auto_heal_status === 'disabled'` → `'disabled'`
   - `auto_heal_status === 'cooldown'` → `'cooling'`
   - `semantic_ok === null` → `'unknown'`
   - `semantic_ok === true` → `'healthy'`
   - else → `'degraded'`
   - Catch-all → `{ status: 'unreachable', reason: error.message }` (Pattern A)

2. **Wired into `buildCombinedStatus`** after `knowledgeStatus` — the
   call chain in the `generateStatusLine` getter now passes
   `proxyStatus` through. Method signature was extended; all
   callers updated.

3. **New [🧠] switch block** placed immediately after the `[📚]` switch.
   Six cases: ✅ healthy / ⚠️ degraded (green→yellow) / 🚫 cooling (forces
   red) / 🔇 disabled / ❓ unknown / ❌ unreachable.

4. **Collision resolution (PATTERNS.md anomaly #1)**. The existing UKB
   workflow indicator below ALSO opens with `[🧠`. Resolved by suffix
   shape — proxy emits a single status emoji; UKB emits an N+counter
   form (e.g. `[🧠1⏳2⚠️]`). Both badges coexist visually. A code
   comment marks the resolution.

## Verification

| Check | Result |
|---|---|
| `node --check scripts/combined-status-line.js` | PASS |
| Plan acceptance grep `function getProxySystemStatus\|getProxySystemStatus()` ≥ 2 | PASS (2 — definition + call) |
| All 6 [🧠X] tokens present in source | PASS |
| Existing UKB `ukbPart` references unchanged | PASS (6 occurrences preserved) |
| SPEC AC #8 grep returns 0 lines | PASS |
| Offline render emits `[🧠✅]` after `[📚✅]` | PASS (verified: `… [📚✅] [🧠✅] [📋16-17] 16:20`) |
| Unreachable-coordinator graceful exit | PASS (`HEALTH_COORDINATOR_URL=http://127.0.0.1:1` exits 0) |

## Deferred — operator gate

This plan is `autonomous: false` and three of its acceptance items
need operator-side validation that this session can't credibly drive:

### 1. Task 2(d) — dead-reader cleanup in `combined-status-line.js`

The plan calls for cleaning ~100 LoC of `.health/<project>-transcript-monitor-health.json`
reads inside the legacy `ensureTranscriptMonitorRunning`,
`ensureTranscriptMonitorsRunning`, and `getRunningTranscriptMonitorsSync`
methods. Current state: those methods are still wired into the spawn
path and read from the dead `.health` directory. SPEC AC #8's primary
grep target (the deleted-module names) is already clean without this
cleanup.

Why deferred:
- The methods are still call-graph-live (not isolated dead code), so
  removing the `.health` reads requires careful PSM-only-fallback
  rewiring.
- Plan acceptance's wording ("decreases significantly", line 593 leave-
  alone) signals the task is loose-spec; high regression risk against
  legacy spawn machinery without a clearer rewrite contract.
- Not blocking SPEC AC #8 grep clean.

Recommended follow-up: a small focused commit replacing each
`existsSync(healthFile)` branch with `psm.isProcessAlive(...)` (already
present at line 1099-1101 of combined-status-line.js). Test by hard-
restarting both ETMs and watching `state.lsl[<sid>].lastBeat` advance.

### 2. Task 3 — LLM Proxy Health dashboard card

Touches `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx`
(add `getProxyHealthItems()` builder + `<HealthStatusCard title="LLM Proxy Health" …>`
render), then:
- `cd integrations/system-health-dashboard && npm run build`
- `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`
- Browser visual verify at http://localhost:3032 via `/playwright-cli`

All three operations involve disrupting the live dashboard mid-session;
Task 3 is also `autonomous: false`. Deferring keeps the user's open
dashboard tab undisturbed.

### 3. W-1 live tmux render check

`tmux capture-pane` can't see `status-right`'s `#(…)` substitution
output — it's rendered by tmux itself, not by the shell inside the
pane. Offline render is verifiably correct (`[🧠✅]` in the right
position), but ground truth is the actual tmux pane render in an
attached session per project memory `feedback_test_statusline_in_tmux.md`.

Operator runbook: open a fresh tmux pane in the coding project (which
already wires `status-line-fast.cjs` into `status-right`), look at the
right side of the bar, confirm the `[🧠]` token appears between
`[📚]` and the timer/lifecycle clusters. If a colour cell appears
where the badge should be (a known cell-width artifact), the regex
that drives left-padding may need adjustment — file as a follow-up.

### 4. R3 / R4 destructive tests for [🧠] state transitions

The plan calls for exercising `auto_heal_status='cooldown'` to confirm
the `[🧠🚫]` badge renders + forces overallColor red, and the dashboard
card surfaces "cooldown — N/3 kickstarts in last 5 min". These need
the same destructive setup deferred from Plan 34-03 (force OAuth
failure for 5+ min, cycle 3 kickstarts).

## Phase 34 progress after this commit

| Plan | Status |
|---|---|
| 34-01 | ✅ on main |
| 34-02 | ✅ on main |
| 34-03 | ✅ on main (R3/R4 destructive tests deferred) |
| 34-04 | ✅ on main |
| **34-05** | **🟡 partial** — Tasks 1 + 2 (badge) done; Task 2(d) dead-reader cleanup + Task 3 dashboard card deferred to operator |
| 34-06 | ⏸ paused at Task 1 gate |

When Task 2(d) and Task 3 ship, this SUMMARY's "Status" line graduates to
"Complete pending live operator validation".
