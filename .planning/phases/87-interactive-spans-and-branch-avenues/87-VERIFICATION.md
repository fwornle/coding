---
phase: 87-interactive-spans-and-branch-avenues
verified: 2026-07-11T00:00:00Z
status: gaps_found
score: 4/9 must-haves verified (AVN-01 through AVN-09)
overrides_applied: 0
gaps:
  - truth: "A fork request (dashboard 'Fork into avenues' launch) actually forks the origin span into avenue Runs on avenue/<task_id> branches, grouped by origin_span_id"
    status: failed
    reason: >
      CR-01 CONFIRMED. `runMatrix` (lib/experiments/experiment-runner.mjs:675-793), the only
      production caller of `runCell`, never destructures or forwards `avenue`, `originSpanId`, or
      `commitAvenue` from its `opts` (destructure at 676-685) into the `runCell({...})` call site
      (769-774). `runCell` itself (461-611) correctly implements avenue-mode branch restore,
      `--origin-span-id` argv, and commit-on-close — but this logic is unreachable dead code via
      the only real caller. No alternate caller threads these values either: scripts/experiment-run.mjs
      has zero avenue/origin-span references (grep confirmed) and no --avenue/--origin-span-id CLI
      flag; lib/experiments/run-launch.mjs's buildRunArgv override list (62-105) has no
      origin_span_id/avenue entry; lib/experiments/experiment-executor.mjs has no avenue field
      anywhere. Result: every fork request launches a plain (non-avenue) matrix run — no
      avenue/<task_id> branch is ever created by a real launch.
    artifacts:
      - path: "lib/experiments/experiment-runner.mjs"
        issue: "runMatrix opts destructure (676-685) and runCell call site (769-774) omit avenue/originSpanId/commitAvenue"
      - path: "scripts/experiment-run.mjs"
        issue: "No --avenue or --origin-span-id CLI flag; opts passed to runMatrix carry no avenue fields"
      - path: "lib/experiments/run-launch.mjs"
        issue: "buildRunArgv override list has no origin_span_id/avenue passthrough"
    missing:
      - "Thread avenue/originSpanId/commitAvenue from runMatrix opts into the runCell call"
      - "Add --avenue/--origin-span-id CLI flags to scripts/experiment-run.mjs and thread through run-launch.mjs buildRunArgv"
  - truth: "The dashboard fork-launch request reaches the server with origin_span_id and the chosen fork axes, and the server synthesizes/launches the forked spec accordingly"
    status: failed
    reason: >
      CR-02 CONFIRMED. `handleExperimentRun` in lib/vkb-server/api-routes.js:957 destructures only
      `{ spec, overrides, rerun_of }` from the request body — `origin_span_id` is never read, and
      the coordinator POST body (~1073-1075) forwards only `{ spec, run_id, run_dir, overrides }`.
      `synthesizeAvenueSpec` (lib/experiments/avenue-spec.mjs) is never imported or called from
      api-routes.js; repo-wide grep confirms its only callers are its own module and its own test.
      The coordinator's own /experiments/run handler (scripts/health-coordinator.js:2735-2766) also
      destructures only `{ spec, run_id, run_dir, overrides }` — no origin_span_id awareness at any
      server layer. Independently discovered: the client's own fork-axis picker preview
      (experiment-launcher.tsx previewCellCount/avenueCount, lines 142-163) is computed entirely
      from selectedSpec.variantCount/cellCount/repeats (the pre-existing origin spec's own YAML
      metadata) — NOT from forkAxes (agent/model/framework/injection selections). The code comment
      at lines 156-161 claims 'The axis selections shape WHAT is forked; the SERVER resolves HOW
      MANY' but forkAxes is never included in the launchExperiment dispatch payload at all — this
      is aspirational text, not implemented behavior. A fork launch runs the origin spec's
      unmodified matrix regardless of which agent/model/framework/injection boxes are checked.
    artifacts:
      - path: "lib/vkb-server/api-routes.js"
        issue: "handleExperimentRun (930-1100) never reads origin_span_id or forkAxes from the request body; never calls synthesizeAvenueSpec"
      - path: "scripts/health-coordinator.js"
        issue: "/experiments/run handler (2735-2766) has zero origin_span_id awareness, matching api-routes.js's omission"
      - path: "integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx"
        issue: "buildOverrides() (206-218) never includes forkAxes/sweep; previewCellCount/avenueCount (142-163) derive from the origin spec's own metadata, independent of the axis picker"
    missing:
      - "handleExperimentRun must read origin_span_id + forkAxes from the request body and call synthesizeAvenueSpec to build the forked spec before launch"
      - "experiment-launcher.tsx must include forkAxes/sweep in the launchExperiment dispatch payload"
      - "previewCellCount must reflect a server-computed count of the ACTUAL fork request (axes-aware), not the origin spec's static metadata"
  - truth: "Completed avenue Runs carry a non-null origin_span_id so the dashboard's origin-grouped ranked panel (AVN-07/08/09) has real data to group and rank"
    status: failed
    reason: >
      CR-03 CONFIRMED as the direct downstream symptom of CR-01/CR-02. performanceSlice.ts's
      launchExperiment thunk (964-994) does POST origin_span_id at the top level, and its code
      comment (975-979) explicitly claims 'The server threads it to the runner's --origin-span-id
      (Plan 87-03) so avenue Runs group by origin' — this claim is false per CR-02. run-write.mjs
      (line 139: origin_span_id: t.origin_span_id ?? null) and measurement-stop.mjs (line 180) are
      correctly implemented to persist origin_span_id IF it reaches them, and
      measurement-start.mjs correctly parses --origin-span-id IF passed (lines 113-116, 199) — but
      per CR-01 no real caller ever passes that flag. selectAvenuesByOrigin (performanceSlice.ts
      ~1881) is correctly implemented to group Runs by origin_span_id, and rankAvenues/
      avenueOutcomeScore/MergeStatusBadge/AvenuePanel (Plan 06) are all genuinely well-built and
      unit/spec-collection tested — but structurally unreachable with real data, since no Run
      produced by the actual launch path ever carries a non-null origin_span_id.
    artifacts:
      - path: "integrations/system-health-dashboard/src/store/slices/performanceSlice.ts"
        issue: "launchExperiment code comment (975-979) falsely claims server-side origin_span_id persistence; selectAvenuesByOrigin has no real data to group in production"
    missing:
      - "Fix CR-01 and CR-02 first; origin_span_id will then flow end-to-end without further changes to run-write.mjs/measurement-start.mjs/measurement-stop.mjs/performanceSlice.ts grouping logic, which are already correct"
deferred: []
human_verification:
  - test: "Rebuild the real (main-tree) dashboard, navigate to Performance > Avenues tab, fork a completed span with a chosen agent/model axis, wait for completion, and visually confirm a ranked origin-grouped row appears with a real (non-em-dash) outcome score and a git-computed merge-status badge, in both light and dark themes"
    expected: "A ranked avenue row appears under the origin's Card, sorted best-first, with a merge badge and working Promote/Prune actions"
    why_human: "Requires live e2e execution against a real forked Run; the worktree-authored performance-compare.spec.ts spec was only typecheck/collection-gated (6 tests collected, not run against live data per 87-06-SUMMARY.md) because the bind-mounted dashboard reflects main-tree code, not the worktree. This check is ALSO currently impossible to pass because CR-01/CR-02 mean no real fork ever produces an origin_span_id-bearing Run — the panel's empty state will show even after a real fork attempt until the gaps above are closed."
---

# Phase 87: Interactive Spans & Branch Avenues Verification Report

**Phase Goal:** A measurement span started from the main interactive agent captures origin snapshot + initial prompt; completed spans fork into "avenues" — headless re-runs of the initial prompt with modified agent/model/framework, each on a persistent `avenue/<task_id>` git branch — grouped by origin, compared in the dashboard, merge-status tracked; measurement data survives across branches (main-`.data` stores).

**Verified:** 2026-07-11
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (mapped to AVN-ID) | Status | Evidence |
|---|---------|--------|----------|
| 1 | AVN-01: An avenue span's Run record carries `origin_span_id`, threaded from the fork request through to persistence | ✗ FAILED | CR-01/CR-02 confirmed: no production caller ever passes `origin_span_id`/`avenue` into the runner. `run-write.mjs`/`measurement-start.mjs`/`measurement-stop.mjs` are correctly implemented but never invoked with the flag. `writeRun` unit test (AVN-01 test in experiment-runner.test.mjs) passes only in isolation with an injected `origin_span_id` tag — not exercised via the real launch path. |
| 2 | AVN-02: Dashboard "Fork into avenues" launch is a thin wrapper over the existing `launchExperiment` → vkb-server → coordinator bridge (no UI-only path) | ⚠️ PARTIAL | The button exists, dispatches through the real bridge (confirmed: `runs-table.tsx` Fork button → `buildForkPrefill` → `launchExperiment` thunk → `/api/experiments/run` → coordinator `/experiments/run`), so the WIRING PATTERN is real (no client-side fake fork). But per CR-02 the bridge silently drops `origin_span_id`/fork axes en route, so the "fork" that reaches the server is indistinguishable from a plain rerun. |
| 3 | AVN-03: 4-axis picker (agent/model/framework/injection) is curated-default with a sweep toggle and a SERVER-resolved count/cost preview before launch | ✗ FAILED | Picker UI exists (`experiment-launcher.tsx` `forkAxes` state, 4-axis controls). But `previewCellCount`/`avenueCount` (142-163) derive from `selectedSpec.variantCount/cellCount/repeats` — the origin spec's own static YAML metadata — NOT from the chosen `forkAxes`. `buildOverrides()` (206-218) never includes `forkAxes` in the launch payload. The "server-resolved" claim in the code comment is true only for the (irrelevant) origin-spec count, not for the actual fork request; the axis picker is decorative. |
| 4 | AVN-04: Knowledge-injection toggle is a per-avenue axis, threading `CODING_KNOWLEDGE_INJECTION=0` into spawned agent env without affecting the interactive session | ✓ VERIFIED | `experiment-spec.mjs` encodes the injection axis in the existing `env` field (87-02 Plan). `knowledge-injection-hook.js` and `launch-agent-common.sh` both early-return on `CODING_KNOWLEDGE_INJECTION=0` (grep-confirmed patterns present). This primitive is real and scoped to spawned agent env — but per AVN-03's failure, no real fork request currently selects/threads this axis end-to-end from the dashboard. |
| 5 | AVN-05: Avenue branches are named `avenue/<task_id>` worktrees (not detached); prune removes worktree+branch; measurement data survives; detached default preserved when avenue mode not requested | ✓ VERIFIED | `avenue-branch.mjs` primitives independently tested — 12/12 tests pass live against real git fixtures (createAvenueBranch named-worktree, pruneAvenueBranch removal+idempotency, path-traversal sanitization, commitAvenueWorktree). Genuinely solid in isolation, consistent with 87-REVIEW.md's positive assessment of the git layer. |
| 6 | AVN-06: Avenue span writes to MAIN `.data` (not the branch worktree), with no double-count across branches | ✓ VERIFIED | `experiment-runner.mjs` documents and implements the span→MAIN dataDir split (lines 485-491); `runCell` unit tests confirm `--capture-raw-bodies`/dataDir forwarding. This is a data-integrity guarantee for avenue mode's storage target, verified structurally even though avenue mode itself is unreachable via the launch path (Truth 1). |
| 7 | AVN-07: Origin-grouped, outcome-ranked N-way avenue panel (best-first, git-computed merge badges) | ⚠️ PARTIAL | `AvenuePanel`/`MergeStatusBadge`/`selectAvenuesByOrigin`/`rankAvenues` are all genuinely well-implemented (verified via source read) and the e2e spec is collection/typecheck-gated (6 tests). But this UI has ZERO real data to render given Truths 1-3's failures — `selectAvenuesByOrigin` will return an empty grouping against any real dataset today, so the panel is functionally unreachable, not just unverified. Live visual verification was explicitly deferred per 87-06-SUMMARY.md and could not pass today even if run, because no forked Run exists. |
| 8 | AVN-08: Merge-status computed from git without mutating main; promote blocked on conflicts | ✓ VERIFIED | `avenueMergeStatus`/`promoteAvenue` primitives pass 12/12 live git tests (merged/unmerged/conflicts/unknown states; conflict-blocked promote; no-main-mutation guarantee). Coordinator endpoints (`scripts/health-coordinator.js:2806-2900+`) and vkb-server proxy routes (`api-routes.js` `handleAvenueMergeStatus`/`handleAvenuePromote`/`handleAvenuePrune`, `_proxyAvenue`) read directly — fully wired, origin-gated, verbatim pass-through, host-only state-changing ops per the Pitfall-6 trust boundary. This layer is genuinely solid end-to-end. |
| 9 | AVN-09: Prune removes worktree+branch via the coordinator seam (never the container); reachable via vkb-server→coordinator routes | ✓ VERIFIED | Same evidence as Truth 8 — `pruneAvenueBranch` primitive tested, coordinator endpoint (`/experiments/avenue-prune`) and vkb-server proxy (`handleAvenuePrune`) both read and confirmed wired with origin validation and task_id sanitization. |

**Score:** 4/9 truths fully VERIFIED (AVN-04, AVN-05, AVN-06, AVN-08, AVN-09); 2/9 PARTIAL (AVN-02, AVN-07 — real primitives, unreachable/decorative in practice); 3/9 FAILED (AVN-01, AVN-03, and the composite fork-launch truth underlying CR-01/02/03)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/experiments/avenue-branch.mjs` | createAvenueBranch/pruneAvenueBranch/commitAvenueWorktree/avenueMergeStatus/promoteAvenue | ✓ VERIFIED | All 6 exports present; 12/12 live tests pass |
| `lib/experiments/experiment-runner.mjs` (runCell avenue mode) | avenue/originSpanId/commitAvenue params implemented | ✓ VERIFIED (substantive) / ⚠️ ORPHANED (wiring) | Logic correct but unreachable — no caller passes these params |
| `lib/experiments/experiment-runner.mjs` (runMatrix) | Threads avenue/originSpanId/commitAvenue from opts into runCell | ✗ MISSING | opts destructure (676-685) and runCell call site (769-774) omit all three fields |
| `lib/experiments/avenue-spec.mjs` (synthesizeAvenueSpec) | Synthesizes forked spec from origin RunSnapshot + fork axes | ✓ VERIFIED (substantive) / ⚠️ ORPHANED (wiring) | Module correct per its own tests; zero production callers repo-wide |
| `lib/vkb-server/api-routes.js` (handleExperimentRun) | Reads origin_span_id + fork axes, calls synthesizeAvenueSpec | ✗ STUB | Destructures only `{ spec, overrides, rerun_of }`; no origin_span_id/axes read; no synthesizeAvenueSpec call |
| `lib/vkb-server/api-routes.js` (avenue-merge-status/promote/prune proxies) | Proxy to coordinator with task_id validation | ✓ VERIFIED | Fully wired, origin-gated |
| `scripts/health-coordinator.js` (avenue-merge-status/promote/prune endpoints) | Host-only git ops, verbatim primitive results | ✓ VERIFIED | Fully wired, task_id-sanitized, origin-gated |
| `integrations/system-health-dashboard/.../experiment-launcher.tsx` | 4-axis picker + server-resolved preview | ⚠️ ORPHANED | Axis picker UI exists but its selections never reach the launch payload or the preview computation |
| `integrations/system-health-dashboard/.../avenue-panel.tsx` + `merge-status-badge.tsx` | Origin-grouped ranked panel | ✓ VERIFIED (substantive) / ⚠️ HOLLOW (data flow) | Well-built, but `selectAvenuesByOrigin` has no real grouped data given upstream gaps |
| `integrations/system-health-dashboard/.../performanceSlice.ts` (launchExperiment, selectAvenuesByOrigin, rankAvenues) | origin_span_id threading + grouping/ranking | ✓ VERIFIED (substantive) / ✗ HOLLOW (data flow) | Client-side logic correct; server never returns/persists the data it needs |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `runs-table.tsx` Fork button | `setLauncherPrefill(buildForkPrefill(run))` | dispatch | ✓ WIRED | Confirmed present |
| `experiment-launcher.tsx` forkAxes state | `launchExperiment` dispatch payload | buildOverrides() | ✗ NOT_WIRED | forkAxes never appears in the POST body (only spec/overrides/rerun_of/origin_span_id) |
| `performanceSlice.ts` launchExperiment thunk | `POST /api/experiments/run` body.origin_span_id | fetch | ✓ WIRED (client-side send) | Confirmed POST includes origin_span_id |
| `api-routes.js` handleExperimentRun | request body.origin_span_id | destructure | ✗ NOT_WIRED | Field never read server-side — CR-02 |
| `api-routes.js` handleExperimentRun | `synthesizeAvenueSpec` | import + call | ✗ NOT_WIRED | Zero production callers repo-wide |
| `api-routes.js` handleExperimentRun | coordinator `/experiments/run` | POST proxy | ✗ PARTIAL | Forwards spec/run_id/run_dir/overrides only — no origin_span_id/axes |
| `scripts/experiment-run.mjs` CLI opts | `runMatrix(spec, opts)` | opts object | ✗ NOT_WIRED | No avenue/origin_span_id in opts; no CLI flags exist for them |
| `runMatrix` opts | `runCell({...})` call site | destructure + pass | ✗ NOT_WIRED | CR-01 — avenue/originSpanId/commitAvenue dropped between destructure and call |
| `runCell` (avenue=true) | `measurement-start.mjs --origin-span-id` | argv | ✓ WIRED (in isolation) | Correct when avenue=true reaches runCell — but nothing ever sets avenue=true in production |
| `measurement-stop.mjs` | `run-write.mjs writeRun` origin_span_id | span.meta passthrough | ✓ WIRED (in isolation) | Correct given a populated span.meta.origin_span_id — never populated in production |
| `api-routes.js` avenue-merge-status/promote/prune | coordinator `/experiments/avenue-*` | `_proxyAvenue` | ✓ WIRED | Fully verified, origin-gated, task_id-validated |
| `coordinator avenue-merge-status/promote/prune` | `avenue-branch.mjs` primitives | direct import + call | ✓ WIRED | Verbatim pass-through, verified |
| `avenue-panel.tsx` | `selectAvenuesByOrigin` selector | useSelector | ✓ WIRED (code) / ✗ HOLLOW (data) | Selector call is real; upstream data source is empty in production |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `avenue-panel.tsx` | `avenuesByOrigin` (via `selectAvenuesByOrigin`) | `fetchRuns` → Run[] filtered by non-null `origin_span_id` | No — no Run in production ever carries a non-null origin_span_id (CR-01/CR-02 chain) | ✗ DISCONNECTED |
| `experiment-launcher.tsx` | `avenueCount`/`previewCellCount` | `selectedSpec.variantCount/cellCount` (origin spec YAML, via handleSpecList) | Real data, but the WRONG data — reflects the origin spec's static metadata, not the fork axes selected | ⚠️ STATIC (wrong source) |
| `merge-status-badge.tsx` | `mergeStatusByTaskId[taskId]` | `fetchMergeStatus` thunk → coordinator `avenueMergeStatus` (real git query) | Yes, IF a task_id with a real avenue branch is queried — but no such task_id is ever produced by a real fork | ✓ FLOWING (primitive) / N/A (no real invocation target) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AVN-01 | 87-03 | Run record carries origin_span_id | ✗ BLOCKED | run-write.mjs correct but unreachable (CR-01/CR-02) |
| AVN-02 | 87-05 | Dashboard Fork = thin wrapper over existing bridge | ? PARTIAL/NEEDS HUMAN | Wiring pattern real, but payload incomplete (CR-02) |
| AVN-03 | 87-02, 87-05 | Curated 4-axis picker + sweep + server-resolved preview | ✗ BLOCKED | Axis selections never reach launch or preview computation |
| AVN-04 | 87-02 | Knowledge-injection per-avenue axis | ✓ SATISFIED | Hook/injector guards correctly implemented (primitive-level) |
| AVN-05 | 87-01 | avenue/<task_id> worktree branch; prune; data survival; detached default preserved | ✓ SATISFIED | 12/12 live tests pass |
| AVN-06 | 87-03 | Cross-branch: avenue span writes MAIN .data, no double-count | ✓ SATISFIED | Structural guarantee verified; unreachable via launch path but the guarantee itself holds when avenue mode IS invoked (e.g., directly via runCell) |
| AVN-07 | 87-06 | Origin-grouped, outcome-ranked N-way panel | ✗ BLOCKED | Well-built but no real grouped data (downstream of CR-01/02/03) |
| AVN-08 | 87-04 | Merge status computed from git, no main mutation | ✓ SATISFIED | Fully verified end-to-end |
| AVN-09 | 87-04, 87-01, 87-06 | Prune via coordinator seam only; reachable via vkb-server routes | ✓ SATISFIED | Fully verified end-to-end |

**IMPORTANT — Requirements traceability gap:** `.planning/REQUIREMENTS.md` contains **zero entries for AVN-01 through AVN-09**. A full-file read and repeated greps (`AVN`, `AVN-0`) confirm no match anywhere in the file. REQUIREMENTS.md currently documents only v7.4 (phases 67-75) and v7.5 (phases 76-80) requirement sections; Phase 87's entire requirement set (used throughout ROADMAP.md and all 6 PLAN.md frontmatter blocks) has no corresponding formal entry in the requirements ledger. This is a documentation/traceability process gap independent of the implementation gaps above, and should be closed by adding an AVN-* section to REQUIREMENTS.md regardless of how the CR-01/02/03 gaps are resolved.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `integrations/system-health-dashboard/.../performanceSlice.ts` | 975-979 | Code comment falsely claims server-side origin_span_id persistence ("The server threads it to the runner's --origin-span-id (Plan 87-03) so avenue Runs group by origin") | 🛑 Blocker | Misleading comment masks CR-02/CR-03; a future maintainer would trust this comment over tracing the actual server code |
| `integrations/system-health-dashboard/.../experiment-launcher.tsx` | 156-161 | Code comment claims "The axis selections shape WHAT is forked; the SERVER resolves HOW MANY" — forkAxes is never sent to the server at all | 🛑 Blocker | Same class of issue — aspirational comment describes unimplemented behavior as fact |
| `lib/experiments/experiment-runner.mjs` | 461-611 vs 675-793 | `runCell` implements avenue mode; `runMatrix` (its only caller) never passes the params | 🛑 Blocker | Dead code — CR-01 |
| `.planning/REQUIREMENTS.md` | n/a | No AVN-01..09 entries exist | ⚠️ Warning | Traceability gap, not a code defect |

No `TBD`/`FIXME`/`XXX` markers found in the phase's modified files. No placeholder/"coming soon" strings found. The issues found are misleading-but-confident code comments describing unimplemented cross-layer wiring, not stub markers — a more insidious anti-pattern than an honest TODO because it actively asserts false completeness.

### Human Verification Required

### 1. Live avenue-panel visual + functional verification (post-gap-closure)

**Test:** Rebuild the real dashboard (`npm run build` in `integrations/system-health-dashboard` → `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`), fork a completed span from the Performance tab choosing a non-default agent/model axis, wait for the avenue run to complete, then check the Avenues sub-tab in both light and dark themes.

**Expected:** A ranked avenue row appears under the origin span's Card with a real outcome score, a git-computed merge-status badge, and working 2-of-N compare / Promote / Prune actions.

**Why human:** Requires live e2e execution against a genuinely forked Run with real measurement data; the authored `performance-compare.spec.ts` was only typecheck/collection-gated (6 tests listed, not run against live data) per 87-06-SUMMARY.md's own deferral note. This check is currently guaranteed to fail (empty state only) until the CR-01/CR-02 gaps are closed, since no real fork produces an origin_span_id-bearing Run today.

## Gaps Summary

The phase's headline capability — forking a completed span into avenues, grouped/compared/tracked in the dashboard — is broken at the seam between the dashboard launch request and the runner. Three confirmed, source-verified breaks form a single causal chain:

1. **CR-01 (runner):** `runMatrix`, the only production caller of `runCell`, never threads `avenue`/`originSpanId`/`commitAvenue` into the call — `runCell`'s otherwise-correct avenue-mode implementation is dead code.
2. **CR-02 (server):** `handleExperimentRun` never reads `origin_span_id` or fork axes from the request body and never calls `synthesizeAvenueSpec` — a fork request launches the origin spec unmodified. The client's own count/cost preview is derived from the origin spec's static metadata, not the chosen axes, making the axis picker decorative.
3. **CR-03 (dashboard grouping):** As the direct downstream consequence of 1 and 2, no Run ever carries a non-null `origin_span_id` in production, so the well-built origin-grouped ranked panel (Plan 06) has no real data to display.

By contrast, the git-branch-lifecycle layer (Plan 01: create/prune/commit; Plan 04: merge-status/promote/prune + coordinator/vkb-server wiring) is genuinely solid — independently confirmed via 12/12 passing live-git tests and a direct read of the fully-wired coordinator endpoints and proxy routes. The knowledge-injection axis primitive (Plan 02, AVN-04) is also correctly implemented at the hook/injector layer, though it cannot currently be exercised via a real fork for the same CR-01/CR-02 reasons.

Two misleading code comments (performanceSlice.ts:975-979, experiment-launcher.tsx:156-161) assert cross-layer behavior that does not exist — both should be corrected as part of closing these gaps to prevent future maintainers from trusting the comment over the code.

Separately, REQUIREMENTS.md has zero AVN-01..09 entries despite these IDs being the phase's formal requirement set throughout ROADMAP.md and all 6 PLAN.md files — a traceability gap that should be closed regardless of the implementation gaps.

**This looks intentional in the sense that it is a genuine implementation gap, not a deviation to accept.** No override is suggested — CR-01/CR-02/CR-03 must be fixed to achieve the phase goal as written. Recommended fix scope for a closure plan:

- Thread `avenue`/`originSpanId`/`commitAvenue` from `runMatrix` opts into the `runCell` call (experiment-runner.mjs)
- Add `--avenue`/`--origin-span-id`/fork-axis CLI flags to `scripts/experiment-run.mjs`, threaded through `run-launch.mjs`'s `buildRunArgv`
- Wire `handleExperimentRun` (api-routes.js) to read `origin_span_id` + fork axes from the request body and call `synthesizeAvenueSpec` before delegating to the coordinator; forward the synthesized spec's own axis-derived cell count back to the client for an honest preview
- Include `forkAxes`/`sweep` in the `launchExperiment` dispatch payload (experiment-launcher.tsx) and recompute `previewCellCount` from a server round-trip that reflects the actual fork request, not the origin spec's static metadata
- Correct the two misleading code comments once the real wiring exists
- Add an AVN-01..09 section to REQUIREMENTS.md

---

_Verified: 2026-07-11_
_Verifier: Claude (gsd-verifier)_
