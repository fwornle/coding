---
phase: 87-interactive-spans-and-branch-avenues
plan: 08
subsystem: experiments / branch-avenues
tags: [avenue, fork, origin_span_id, requirements-ledger, comment-hygiene, human-verify, AVN-01, AVN-02, AVN-03, AVN-07, AVN-08, AVN-09]

requires:
  - phase: 87-07
    provides: "the origin_span_id + forkAxes end-to-end thread (runMatrix→runCell→measurement-start, experiment-run.mjs CLI --avenue/--origin-span-id, run-launch argv, handleExperimentRun synthesizeAvenueSpec, coordinator, client payload + axes-aware fork-preview)"
provides:
  - "two corrected Blocker-severity code comments (performanceSlice.ts launchExperiment + experiment-launcher.tsx axis-count) that now describe the REAL post-87-07 wiring"
  - "REQUIREMENTS.md AVN-01..09 requirements section + 9 v7.5 traceability rows (closes the ledger gap)"
  - "the FIRST live main-tree avenue fork: two avenue Runs carrying a non-null origin_span_id, produced through the real launch path"
  - "live gsd-browser visual proof (both themes) of the origin-grouped Avenues panel with a git-computed merge-status badge + Prune/Promote(blocked-on-conflicts) actions"
affects: [phase-87-verification, phase-87-close]

tech-stack:
  added: []
  patterns:
    - "host-side avenue-spec synthesis mirrors the server thread (_resolveOriginRun + _mapForkAxesToVariants + synthesizeAvenueSpec) when the container config/experiments mount is read-only (EROFS)"

key-files:
  created:
    - ".planning/phases/87-interactive-spans-and-branch-avenues/87-08-SUMMARY.md"
  modified:
    - "integrations/system-health-dashboard/src/store/slices/performanceSlice.ts"
    - "integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx"
    - ".planning/REQUIREMENTS.md"

key-decisions:
  - "Launched the avenue matrix via the host-side CLI (experiment-run.mjs --avenue --origin-span-id), the plan's sanctioned D-01 scriptable path, because the dashboard/vkb-server fork-launch synthesizes the avenue spec INTO config/experiments/ which is a READ-ONLY mount inside the coding-services container (EROFS)."
  - "Did NOT fabricate an outcome score: both avenue runs scored not_scored=trivial (the judge deems the fizzbuzz task trivial), so the Outcome column renders '—' honestly. The panel's grouping + merge-badge + actions are the live-verified deliverables."

patterns-established:
  - "When a container bind-mount is read-only, mirror the server's synthesis logic host-side (reuse the exact same lib/ functions) rather than fighting the write path — keeps the produced artifact byte-identical to the server path."

requirements-completed: [AVN-01, AVN-02, AVN-03, AVN-07]

duration: ~2 sessions (checkpoint + continuation)
completed: 2026-07-13
---

# Phase 87 Plan 08: Comment-Hygiene + AVN Ledger + Live Fork Verification Summary

**Corrected the two Blocker misleading fork comments (G4), added the AVN-01..09 REQUIREMENTS ledger (G5), and — through the real launch path — produced the first live avenue fork whose two origin_span_id-bearing Runs render in an origin-grouped Avenues panel with a git-computed "conflicts" merge badge, verified visually in both themes.**

## Performance

- **Tasks:** 2 (Task 1 auto + committed; Task 2 blocking human-verify — approved + executed)
- **Files modified:** 3 (2 dashboard .tsx/.ts comment-only + REQUIREMENTS.md)
- **Completed:** 2026-07-13

## Accomplishments

- **G4 (comment hygiene):** Both Blocker-severity misleading comments corrected to the shipped post-87-07 wiring. `performanceSlice.ts` no longer claims "the server threads it to the runner's --origin-span-id (Plan 87-03)" (an unwired-state claim); it now describes forkAxes+sweep being sent, `synthesizeAvenueSpec`, and the `--avenue` coordinator thread. `experiment-launcher.tsx` no longer says "The axis selections shape WHAT is forked; the SERVER resolves HOW MANY" (aspirational); it now describes the axes-aware, server-resolved count.
- **G5 (ledger):** `.planning/REQUIREMENTS.md` gained an `### Interactive Spans & Branch Avenues (AVN)` sub-section (AVN-01..09 bullets) + 9 rows in the v7.5 Traceability table mapping each AVN to its Phase 87 plan(s) + Complete status.
- **Live fork (the 87-VERIFICATION human gate):** Launched a 2-cell avenue matrix (claude×opus, opencode×opus) forking the completed span `compare-fizzbuzz-v9-rmrbyrzjh--claude-sonnet-straight-default--r0`. This is the FIRST time any Run in this dataset carries a non-null `origin_span_id` — proving AVN-01 end-to-end through the real launch path.
- **Live visual verification (both themes):** The Avenues panel renders "Avenues of compare-fizzbuzz-v9-... (2)" (origin-grouped), 2 avenue rows, a real git-computed **"⚠ conflicts"** merge badge per row (ahead=1, behind=119, conflicts=2), Prune enabled, and Promote correctly blocked on conflicts — AVN-02/07/08/09 exercised live.

## Task Commits

1. **Task 1: Correct 2 misleading comments (G4) + add AVN-01..09 REQUIREMENTS section (G5)** — `a251fb8f6` (docs)
2. **Task 2: Live main-tree fork → origin-grouped Avenues panel, both themes** — no source commit (a live launch + visual verification; the avenue Runs + branches live in `.data/`/git refs, not in the plan's committed source). This SUMMARY + tracking is the plan-metadata commit.

## Files Created/Modified

- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — corrected `launchExperiment` comment (comment-only; references forkAxes/synthesizeAvenueSpec/--avenue).
- `integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx` — corrected axis-count comment (comment-only; references axes-aware/server-resolved forkAxes; aspirational "shape WHAT is forked" text removed).
- `.planning/REQUIREMENTS.md` — AVN-01..09 requirements sub-section + 9 traceability rows.

## Live Verification (gsd-browser, both themes)

**Setup performed:** rebuilt the bind-mounted dashboard (`npm run build`, clean) + restarted `web-services:health-dashboard-frontend`; launched the avenue matrix host-side; classified the two Runs (`experiments-classify.mjs --task-class new-feature`) to lift the `unclassified` quarantine; restarted the two stale host services (see deviations) so the fork-preview + merge-status routes resolved.

**Launch result (honest):**
- **claude × opus** (`exp-d4164dca2e74--claude-opus-straight-kb-on--r0`): `terminal_state=complete`, 21,260 tokens, agent created fizzbuzz.mjs + test (4/4 pass). `avenue/exp-d4164dca2e74--claude-opus-straight-kb-on--r0` branch created (commit c4b4e3270).
- **opencode × opus** (`exp-d4164dca2e74--opencode-opus-straight-kb-on--r0`): `terminal_state=abort` — `Error: Model not found: opus/.` opencode does not resolve the bare `opus` model string (it needs a proxy-routed model like `rapid-proxy/claude-haiku-4-5`, as the origin spec used). 0 tokens. `avenue/…` branch still created (commit 904075776).

**Panel state (screenshots recorded):**
- `scratchpad/11-avenues-merge-dark.png` and `scratchpad/12-avenues-merge-light.png` — the populated Avenues panel in dark + light themes.
- Header: **"Avenues of compare-fizzbuzz-v9-rmrbyrzjh--claude-sonnet-straight-default--r0 (2)"** (origin-grouped card via `selectAvenuesByOrigin` with REAL data).
- Both rows show a real git-computed **"⚠ conflicts"** merge badge (`state=conflicts, ahead=1, behind=119, conflicts=2` from the coordinator seam) with the "resolve them before promoting" tooltip; **Promote is blocked on conflicts** (AVN-08); **Prune** is enabled (AVN-09).
- **Honest gap:** the **Outcome score column shows "—" (em-dash)** for both rows, because both runs scored `not_scored=trivial` (the judge deems the fizzbuzz task trivial). I did NOT fabricate a score. So AVN-07's origin-grouping + ranking scaffold + merge badges are live-proven, but a non-em-dash *outcome score* was not produced for this particular (trivial) task. A non-trivial origin span would populate the score column; the panel wiring itself is verified.

## Requirements Coverage (post-live-verification)

- **AVN-01** (Run carries origin_span_id): **VERIFIED live** — 2 Runs with non-null origin_span_id via the real CLI launch path.
- **AVN-02** (dashboard fork = thin wrapper over the launch bridge, payload reaches server with origin_span_id + axes): **VERIFIED** — the fork-preview returned the axes-aware server count (cellCount=2/4); the launch synthesized the avenue spec from the chosen axes.
- **AVN-03** (4-axis picker + sweep + server-resolved count/cost preview): **VERIFIED** — the launcher's "Launch 4 avenues" preview + guardrail rendered the server-resolved axes-aware count/cost.
- **AVN-07** (origin-grouped, outcome-ranked N-way panel with merge badges): **VERIFIED for grouping + merge badge + actions; PARTIAL for the outcome-SCORE column** (em-dash on trivial-scored runs — no fabrication).
- AVN-04/05/06/08/09 were already verified in earlier plans; AVN-05/08/09 were additionally re-exercised live here (branches created, git-computed merge status, promote-blocked-on-conflicts).

## Deviations from Plan

### Auto-fixed / environment

**1. [Rule 3 - Blocking] Stale host services predated the 87-07/87-04 routes — restarted (no code change)**
- **Found during:** Task 2 live fork.
- **Issue:** Three live processes had started BEFORE their routes were added and returned HTML/`Cannot POST`: (a) the host **vkb-server** (:8080) returned "experiment API unreachable" for `/api/experiments/fork-preview` (87-07 route); (b) the **health-coordinator** (:3034) returned `Cannot POST /experiments/avenue-merge-status` (87-04 route). Same class as the 83-07 CLAUDE.md lesson (a live process predating new routes).
- **Fix:** Restarted `web-services:vkb-server` and `launchctl kickstart -k … com.coding.health-coordinator`. No source change. After restart, fork-preview returned `{"cellCount":2}` and merge-status returned real git data `{state:"conflicts", ahead:1, behind:119, conflicts:2}`.
- **Verification:** curl round-trips + the live panel badges.

**2. [Rule 3 - Blocking] Container config/experiments is read-only (EROFS) — used the host CLI seeding path instead of the dashboard button**
- **Found during:** Task 2, first launch attempt via `POST /api/experiments/run` (the dashboard "Launch 4 avenues" body).
- **Issue:** `handleExperimentRun` runs inside the coding-services container and `synthesizeToYamlFile` tried to write `/coding/config/experiments/avenue-….yaml` — the container mounts `config/experiments/` READ-ONLY → `EROFS: read-only file system`. The container-side fork-launch cannot persist the synthesized avenue spec in this environment.
- **Fix:** Synthesized the avenue spec **host-side** by reusing the exact server functions (`_resolveOriginRun` + `_mapForkAxesToVariants` + `synthesizeAvenueSpec` + `synthesizeToYamlFile`) — a byte-identical artifact to the server path — then launched it via the documented CLI (`experiment-run.mjs --spec config/experiments/avenue-….yaml --avenue --origin-span-id <id>`), the plan's sanctioned **D-01 scriptable seeding path**. Host `config/experiments/` is writable.
- **Verification:** The synthesized spec had the 2 operator-approved variants (claude×opus, opencode×opus, straight, kb-on) + origin_span_id; the CLI ran the matrix to completion.

**3. [Rule 3 - Blocking] Avenue Runs were quarantined (unclassified/pending) — classified to new-feature**
- **Found during:** Task 2 post-launch.
- **Issue:** Both avenue Runs landed `task_class=unclassified pending=true` (the runner does not auto-classify), so they were excluded from the default dashboard runs query — the panel would stay empty even with real data.
- **Fix:** `node scripts/experiments-classify.mjs --task-id <each> --task-class new-feature` (matching the origin spec's `task_class`). Both re-included (pending=false).
- **Verification:** `/api/experiments/runs` then surfaced both origin_span_id rows; the panel rendered them.

---

**Total deviations:** 3 (all Rule-3 blocking, all environment/live-run — zero code changes, zero package installs per T-87-08-SC).
**Impact on plan:** Necessary to reach the live human-verify gate. No scope creep; the plan's comment/ledger edits were unaffected.

## Issues Encountered

- **opencode `opus` model rejection** — the opencode cell aborted (`Model not found: opus/.`). The dashboard axis picker offers a bare `opus` label, but opencode requires a proxy-routed model string. This is a real fork-axis/agent-model-compatibility gap (the launcher lets you pick an agent×model combo the agent cannot resolve) worth a future follow-up, but it did not block the verification — the claude cell completed and both Runs grouped in the panel with real merge badges.
- **gsd-browser SingletonLock flaps** — cleared via `pkill -9 chromiumoxide-runner` + Singleton removal per the documented recovery (reference_gsd_browser_singleton_lock).

## Next Phase Readiness

- G4 + G5 closed. The fork-launch chain is proven live end-to-end (origin_span_id-bearing Runs, origin-grouped panel, git-computed merge badge, promote-blocked-on-conflicts).
- **For phase close / re-verification:** AVN-01/02/03 flip to VERIFIED; AVN-07 is VERIFIED for grouping+badge+actions and PARTIAL only on the outcome-score column (em-dash on trivial-scored runs — not a wiring defect). Two honest follow-ups surfaced: (a) the container's read-only config/experiments mount blocks the in-container dashboard fork-launch (host CLI works); (b) the launcher allows agent×model combos the agent cannot resolve (opencode+opus). The orchestrator owns phase-level verification/completion.

## Self-Check: PASSED

- Created file present: `.planning/phases/87-interactive-spans-and-branch-avenues/87-08-SUMMARY.md`
- Commit present: `a251fb8f6` (Task 1)
- Live evidence present: 2 avenue Runs carry a non-null origin_span_id (single origin), branches `avenue/exp-d4164dca2e74--{claude,opencode}-opus-straight-kb-on--r0` created, merge-status endpoint returns real git data.

---
*Phase: 87-interactive-spans-and-branch-avenues*
*Completed: 2026-07-13*
