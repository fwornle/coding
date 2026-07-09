---
phase: 85-experiment-control-center
plan: 06
subsystem: experiment-control-center
tags: [deploy, e2e, playwright, dashboard, health-coordinator, detached-spawn, capture-raw-bodies, opencode, live-gate]

# Dependency graph
requires:
  - phase: 85-01
    provides: "run-progress emitter + rerun_of/base_variant Run metadata + capture_raw_bodies CLI flag"
  - phase: 85-02
    provides: "host-side run-launch primitives (detached fixed-argv spawn + process-group cancel)"
  - phase: 85-03
    provides: "health-coordinator :3034 experiment seam (delegates spawn/cancel; clears stale span)"
  - phase: 85-04
    provides: "vkb-server /api/experiments/{run,run-status,run-cancel,specs} routes"
  - phase: 85-05
    provides: "dashboard launcher + 5s monitor grid + Re-run button (performanceSlice thunks)"
provides:
  - "Deployed, human-verified Experiment Control Center: browser click → host runner spawn → 5s-poll monitor → cancel/re-run/capture, all live-proven end-to-end"
  - "tests/e2e/performance/experiment-control.spec.ts — Playwright launcher/matrix-preview/re-run/capture structure gate (4/4 green)"
  - "Per-run runner.log diagnosability (detached stdio no longer discarded) + per-cell abort reason surfaced in the monitor"
  - "opencode cell now COMPLETES (was silently aborting) via a canonical ~/.opencode/bin/opencode binary pin"
  - "capture_raw_bodies=ON produces raw-bodies.jsonl(.gz); OFF produces none (D-12 live-proven)"
affects:
  - "Phase 86 (Timeline v2) + Phase 87 (Interactive Spans) build on this live control surface"
  - integrations/system-health-dashboard/src/pages/performance.tsx
  - lib/experiments/run-launch.mjs
  - lib/experiments/experiment-runner.mjs
  - scripts/experiment-run.mjs

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detached-spawn stdio → per-run runner.log (openSync fd in stdio slots, fail-soft to 'ignore', D-01 detach preserved) — a silent runner failure always leaves evidence on disk"
    - "launchCell resolves { state, code, signal, reason? } (was a bare string) so a non-complete terminal state carries a human-readable reason; normalizeCellResult keeps the legacy bare-string seam compatible"
    - "PATH-ambiguous agent binaries pinned to a canonical absolute path when present — the launchd runner inherits a different PATH than an interactive shell"
    - "Presence-flag threading end-to-end: launcher toggle → API overrides → run-launch argv → runner CLI parse → per-cell measurement-start argv (the capture_raw_bodies chain)"
    - "Re-run affordance = scrollIntoView(id anchor) + transient highlight ring + confirmation banner, because the launcher sits far above the runs-table trigger"

key-files:
  created:
    - tests/e2e/performance/experiment-control.spec.ts
  modified:
    - integrations/system-health-dashboard/src/pages/performance.tsx
    - integrations/system-health-dashboard/src/components/performance/experiment-launcher.tsx
    - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
    - integrations/system-health-dashboard/src/components/performance/timeline.tsx
    - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
    - lib/experiments/run-launch.mjs
    - lib/experiments/experiment-runner.mjs
    - lib/experiments/agent-headless.mjs
    - scripts/experiment-run.mjs
    - lib/vkb-server/api-routes.js
    - config/experiments/compare-fizzbuzz.yaml
    - docker/docker-compose.yml

key-decisions:
  - "server.js needed NO edit — the /api/experiments req.path passthrough forwards the four new subpaths for free (verified by curl before touching it)"
  - "The container cannot spawn agent CLIs (Pitfall 4) — every launch/cancel delegates to the host health-coordinator :3034 seam; lib/repro + config/experiments were bind-mounted into coding-services so the container-side resolution succeeds"
  - "Runner stdio is captured to runner.log (not discarded) — this single change turned the opaque opencode abort into a one-line diagnosis"
  - "opencode is pinned to ~/.opencode/bin/opencode (the -m-capable v1.15.x build), NOT the PATH-first /opt/homebrew/bin/opencode Cobra build that has no -m"
  - "capture_raw_bodies is a pure presence flag threaded through the runner into each cell's measurement-start — OFF by default, byte-identical when absent"

patterns-established:
  - "Live human-verify gate for a container↔host spawn boundary that unit/fake-seam tests cannot prove"
  - "A1-style diagnosability first: capture the evidence surface BEFORE hunting the root cause"

requirements: [D-01, D-02, D-08, D-09, D-10, D-11, D-12]

# Metrics
duration: ~5h (multi-round, spanning 2026-07-08 16:17 → 2026-07-08 21:18 +0600, incl. 4 checkpoint-feedback rounds)
completed: 2026-07-09
tasks: 2
commits: 13
files_created: 1
files_modified: 12
---

# Phase 85 Plan 06: E2E Deploy + Human-Verified Experiment Control Center Summary

**The whole Experiment Control Center proven LIVE end-to-end: a dashboard click spawns a real cross-agent runner ON THE HOST (via the coordinator :3034 seam), the 5s-poll monitor advances, Cancel reaps the detached process group and frees the 409 slot, Re-run pre-fills the launcher with a constant task_hash, and capture_raw_bodies produces raw bodies only when ON — with per-run runner.log diagnosability and a Playwright structure gate.**

## Performance

- **Duration:** ~5h across 4 checkpoint-feedback rounds
- **Started:** 2026-07-08T16:17:12+06:00 (first plan commit)
- **Completed:** 2026-07-09 (human-verify gate APPROVED)
- **Tasks:** 2 (Task 1 auto deploy/wire + e2e; Task 2 live human-verify gate)
- **Files modified:** 12 (+1 created); 13 commits

## Accomplishments

- **Proxy passthrough verified with NO server.js edit** — `curl http://localhost:3032/api/experiments/specs` returned the spec list through the existing `req.path` reverse proxy; the four new subpaths forward for free.
- **UI deployed** via the bind-mount recipe (`npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`); launcher + 5s monitor wired into `performance.tsx`.
- **Playwright spec** `tests/e2e/performance/experiment-control.spec.ts` authored (launcher structure + matrix preview + Re-run pre-fill + capture checkbox) — **4/4 green**.
- **Live gate APPROVED** after four rounds of operator click-through feedback, each defect fixed, redeployed, and re-verified at API + UI level.
- **Diagnosability**: detached runner stdio now lands in `<runDir>/runner.log`; aborted cells record a `reason` the monitor renders.
- **opencode cell now COMPLETES** (was a silent abort) — root cause was a PATH-ambiguous binary, found via the new runner.log.
- **D-12 live-proven** (orchestrator's paired run): capture ON → `raw-bodies.jsonl.gz`; capture OFF → none.

## Task Commits

**Task 1 — deploy + wire + e2e spec (with all round-1..round-4 checkpoint fixes):**

1. `43f0b9367` — mount `lib/repro` + `config/experiments` into coding-services (container bind-mount so the host-delegating seam resolves)
2. `5dc47a679` — wire `ExperimentLauncher` + `RunMonitor` into the Performance page + author the e2e spec
3. `1e8987a86` — host-agnostic seam paths + host-side D-02 live-run slot guard
4. `464653f7e` — honor the `variants` SUBSET override end-to-end (repeatable `--variant`)
5. `e60de65ea` — self-consistent matrix preview text + ignore per-run runtime dirs
6. `c3feaa323` — (docs) log out-of-scope pre-existing dashboard tsc errors to deferred-items
7. `97225442c` — label an experiment-cell span 409 as the RUN holder + completion regression tests
8. `d61ac249f` — thread `task_class` (flag > spec field) so spec-launched Runs land VISIBLE (not quarantined `unclassified`)

**Task 2 — live human-verify gate (round-3/round-4 fixes from the operator's click-through, gate now APPROVED):**

9. `3b7076ee8` — terminal-state runs refresh + dismissible launch error + cell-scoped timeline + goal-joined re-run prefill
10. `072b87504` — **(A1)** capture runner stdio to per-run `runner.log` + record abort reason
11. `e48b77702` — **(B)** Re-run scrolls launcher into view + visible pre-fill affordance (ring + confirmation banner)
12. `bcab1b430` — **(A2)** pin canonical `~/.opencode/bin/opencode` — the PATH-ambiguous bare name aborted the cell
13. `55501c057` — **(D-12)** thread `--capture-raw-bodies` from the runner into each cell's `measurement-start`

**Plan metadata:** this SUMMARY + STATE.md + ROADMAP.md (`docs(85-06): complete E2E deploy + human-verified experiment control center`).

## Files Created/Modified

- `tests/e2e/performance/experiment-control.spec.ts` — Playwright launcher/matrix/re-run/capture structure gate (created)
- `integrations/system-health-dashboard/src/pages/performance.tsx` — mounts `ExperimentLauncher` (id anchor) + `RunMonitor`
- `.../performance/experiment-launcher.tsx` — id anchor + transient highlight ring + pre-fill confirmation banner (B)
- `.../performance/runs-table.tsx` — Re-run scrollIntoView + defensive `fetchSpecList` so the spec truly pre-selects (B)
- `.../performance/timeline.tsx`, `.../store/slices/performanceSlice.ts` — cell-scoped timeline + terminal-state runs refresh + dismissible launch error
- `lib/experiments/run-launch.mjs` — detached stdio → `runner.log` fd; `run.json` records `log` (A1)
- `lib/experiments/experiment-runner.mjs` — `launchCell` returns `{state,code,signal,reason?}`; `normalizeCellResult`; abort reason threaded to progress; `captureRawBodies` threaded to per-cell measurement-start (A1 + D-12)
- `lib/experiments/agent-headless.mjs` — `resolveAgentBinary` pins canonical `~/.opencode/bin/opencode` (A2)
- `scripts/experiment-run.mjs` — parse `--capture-raw-bodies` presence flag → `runMatrix` opts (D-12)
- `lib/vkb-server/api-routes.js` — experiment run/status/cancel/specs handlers (dual-source 409 → delegate)
- `config/experiments/compare-fizzbuzz.yaml`, `docker/docker-compose.yml` — the live smoke spec + the container bind-mounts

## Decisions Made

- **No server.js edit** — the proxy passthrough was verified by curl before touching it; the four subpaths forward via `req.path`. (No full container restart was needed for the proxy layer.)
- **Diagnosability before root-cause hunt (A1 first)** — capturing runner.log turned an evidence-free abort into a one-line diagnosis (`unknown shorthand flag: 'm' in -m`).
- **opencode canonical-path pin (A2)** — the host has TWO opencode builds; the launchd runner's PATH found the wrong `-m`-incapable one. Pinning the absolute canonical path is the fix; the argv was already correct.

## Deviations from Plan

The plan was a live-gate/deploy plan; nearly all substantive work was checkpoint-feedback fixes discovered during the operator's click-through. All are Rule 1 (bug) / Rule 2 (missing critical) auto-fixes.

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Container could not resolve host-delegating seam paths**
- **Found during:** Task 1 (deploy)
- **Issue:** `lib/repro` + `config/experiments` were not mounted into coding-services, so the container-side path resolution failed.
- **Fix:** Added the bind-mounts in `docker/docker-compose.yml`; made seam paths host-agnostic.
- **Committed in:** `43f0b9367`, `1e8987a86`

**2. [Rule 2 - Missing Critical] Host-side D-02 live-run slot guard**
- **Found during:** Task 1
- **Issue:** No host-side guard preventing a second concurrent live run holding the measurement slot.
- **Fix:** Added the D-02 slot guard (returns a 409 naming the holder — correct refusal, verified not a leak).
- **Committed in:** `1e8987a86`

**3. [Rule 1 - Bug] `variants` SUBSET override was dropped; full matrix ran**
- **Found during:** Task 1
- **Fix:** Honored the repeatable `--variant` end-to-end (launcher → API → run-launch argv → runner parse).
- **Committed in:** `464653f7e`

**4. [Rule 1 - Bug] Matrix-preview text inconsistent with the picked subset**
- **Committed in:** `e60de65ea`

**5. [Rule 1 - Bug] An experiment-cell span 409 was mislabeled**
- **Fix:** Label the 409 as the RUN holder + added completion regression tests.
- **Committed in:** `97225442c`

**6. [Rule 2 - Missing Critical] Spec-launched Runs quarantined invisible (no task_class)**
- **Fix:** Thread `task_class` (flag > spec field) so Runs land CLASSIFIED and visible in the default runs query.
- **Committed in:** `d61ac249f`

**7. [Rule 1 - Bug] Freshly-completed run invisible + stale 409 + timeline not cell-scoped + re-run spec not derived**
- **Fix:** Terminal-state runs refresh, dismissible launch error, cell-scoped timeline, goal-joined re-run prefill.
- **Committed in:** `3b7076ee8`

**8. [Rule 1 - Bug] (A1) opencode abort had ZERO diagnosability**
- **Issue:** The detached runner spawned `stdio:'ignore'`, discarding all evidence; an aborted cell recorded no reason.
- **Fix:** Redirect stdout+stderr to `<runDir>/runner.log` (fail-soft, D-01 detach preserved); `launchCell` returns a reason surfaced by the monitor.
- **Verification:** Live opencode run → `runner.log` captured the full output; progress.json cell reason = `agent exited with code 1`.
- **Committed in:** `072b87504`

**9. [Rule 1 - Bug] (B) Re-run looked dead — pre-fill happened off-screen**
- **Fix:** Re-run click `scrollIntoView`s the launcher + a highlight ring + a confirmation banner; defensive `fetchSpecList` so the spec truly pre-selects.
- **Verification:** gsd-browser — Re-run brought the pre-filled launcher into view (`launcherTop:16` from scrollY 567) with the banner + spec selected.
- **Committed in:** `e48b77702`

**10. [Rule 1 - Bug] (A2) opencode cell aborted — wrong binary on the runner's PATH**
- **Root cause (via A1's runner.log):** `Error: unknown shorthand flag: 'm' in -m`. Two host opencode builds exist; the launchd runner's PATH found `/opt/homebrew/bin/opencode` (Cobra, no `-m`) instead of `~/.opencode/bin/opencode` (v1.15.x, `-m`-capable). The argv was correct.
- **Fix:** `resolveAgentBinary` pins the canonical absolute path when present.
- **Verification:** Re-run COMPLETES (`> build · claude-haiku-4-5`; agent wrote the files; `terminal_state=complete`; `totalTokens=26738 calls=2`).
- **Committed in:** `bcab1b430`

**11. [Rule 1 - Bug] (D-12) capture_raw_bodies=ON produced no raw bodies**
- **Issue:** The flag reached the runner's own argv but `scripts/experiment-run.mjs` never parsed it and `runCell` never forwarded it into the per-cell `measurement-start` — so the span was never armed (`span.meta.capture_raw_bodies` undefined).
- **Fix (the single missing hop):** parse `--capture-raw-bodies` in the runner; thread `captureRawBodies` `runMatrix→runCell` and append `--capture-raw-bodies` to the cell's `measurement-start` argv. Pure presence flag, OFF by default, byte-identical when absent.
- **Verification:** Local live run showed `span.meta.capture_raw_bodies: true` while the span was open; orchestrator's paired proof (below) confirmed the raw-bodies file ON/OFF.
- **Committed in:** `55501c057`

---

**Total deviations:** 11 auto-fixed (7 bug, 3 missing-critical, 1 blocking).
**Impact on plan:** All fixes were necessary for the live control center to actually work as specified (D-01/D-02/D-08/D-09/D-10/D-11/D-12). No scope creep — every fix maps to a plan requirement discovered broken during the live gate.

## Evidence

- **Unit:** full experiments suite **336 pass / 0 fail** (2 live-gated skips); new tests cover stdio→log fd, log-open fail-soft, abort-reason propagation, opencode canonical-path pin, and both directions of the `--capture-raw-bodies` threading.
- **Playwright:** `tests/e2e/performance/experiment-control.spec.ts` **4/4 green** (incl. the pre-fill-confirmation assertion).
- **Live D-12 paired proof (orchestrator):** run `rmrcu6xa9` (capture ON) produced `raw-bodies.jsonl.gz` (175 KB, 4 records) + `span.meta.capture_raw_bodies=true`; run `rmrcuat7g` (capture OFF) had NO raw-bodies file + `capture_raw_bodies` undefined.
- **Live cross-agent:** opencode cell now COMPLETES (was abort); a claude cell completes with no regression from the stdio change. Both live runs freed the slot (no zombie, no held `active-measurement.json`).

## Issues Encountered

- The opencode abort required A1's runner.log to become diagnosable at all — without it the failure was evidence-free. Once captured, the root cause (PATH-ambiguous binary) was a one-line diagnosis.

## Deferred / Out of Scope

- **Pre-existing tsc diagnostic in `src/pages/token-usage.tsx`** (a `Formatter<number,string>` type mismatch) — NOT this plan's file; the vite bundle still builds. Logged to deferred-items (`c3feaa323`); not fixed here per the scope boundary.

## User Setup Required

None — deploy used the existing `npm run build` bind-mount recipe; no external service configuration required.

## Next Phase Readiness

- The live Experiment Control Center is proven and deployed. Phase 86 (Timeline v2 + declutter) and Phase 87 (Interactive Spans & Branch Avenues) can build on this control surface.
- No blockers. The only open follow-up is the unrelated pre-existing token-usage.tsx tsc diagnostic.

## Self-Check: PASSED

- SUMMARY file present at `.planning/phases/85-experiment-control-center/85-06-SUMMARY.md`.
- All 13 plan commits verified present in git (`43f0b9367 … 55501c057`).

---
*Phase: 85-experiment-control-center*
*Completed: 2026-07-09*
