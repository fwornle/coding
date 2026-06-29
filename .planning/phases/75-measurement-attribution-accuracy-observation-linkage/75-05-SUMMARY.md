---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 05
subsystem: live-logging
tags: [etm, observation-recapture, event-time, task-id, obs-01, obs-02, wave-2]

# Dependency graph
requires:
  - phase: 75-01
    provides: "RED jest test tests/live-logging/ETM-recapture.test.js + e0af5b8b fixture (computeRecaptureFires contract)"
  - phase: 69-claude-copilot-adapters
    provides: "resolveLiveTaskIdSafe single-span reader (lib/lsl/token/task-id.mjs)"
provides:
  - "lib/live-logging/etm-recapture.mjs — pure computeRecaptureFires(messages, opts): per-decision/per-tool-batch fire boundary + true event-time + (task_id, batch-last-message-uuid) dedup"
  - "ETM mid-set fire boundary: fires on AskUserQuestion decisions + significant tool-activity batches (>=8 tool_use OR >=10min), stamped at each batch's real last-message timestamp (OBS-02)"
  - "Observations carry metadata.task_id resolved via resolveLiveTaskIdSafe (OBS-01) — queryable per Run"
affects: [75-verify-phase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function fire-boundary extraction (computeRecaptureFires) — unit-testable without booting the ETM daemon; the daemon reuses the same thresholds via an exchange-based splitter"
    - "Per-transcript lastFiredExchangeUuid cursor (batch's LAST message uuid) so re-processing never re-emits a prior batch (Pitfall 4)"
    - "OBS dedup key = (task_id, batch-last-message-uuid) replacing the old count|lastExchangeId key"
    - "Single-span task_id reader (resolveLiveTaskIdSafe) shared by token path AND observation path so attribution + linkage agree (D-09)"

key-files:
  created:
    - lib/live-logging/etm-recapture.mjs
  modified:
    - scripts/enhanced-transcript-monitor.js
    - src/live-logging/ObservationWriter.js

key-decisions:
  - "Pure module target (Plan 01 lock): the test imports computeRecaptureFires from lib/live-logging/etm-recapture.mjs (raw-message API) for a clean RED; the ETM daemon gets a parallel exchange-based splitter (_splitIntoRecaptureBatches) reusing the same DEFAULT_TOOL_BATCH_THRESHOLD / DEFAULT_TIME_THRESHOLD_MS constants rather than re-deriving them"
  - "Decision boundary flushes INCLUDING the AskUserQuestion exchange so the fire's created_at = the decision time (the batch's last-message timestamp)"
  - "task_id stamped only when non-empty so a no-span fire never pollutes metadata with ''"
  - "ETM resolves task_id ONCE per fire (taskIdPromise) and threads it to every batch fire + the dedup key — keeps the writer proxy-free (D-09)"

# Metrics
duration: 7min
completed: 2026-06-29
checkpoint: "Task 3 (checkpoint:human-verify) APPROVED by operator 2026-06-29 on fixture-test (5/5 green) + healthy-daemon evidence (pid 10059, no STALL-DETECT/crash) — live multi-decision session is observable only over real time and was accepted as such"
requirements-completed: [OBS-01, OBS-02]
---

# Phase 75 Plan 05: ETM Observation Re-capture & Run Linkage Summary

**ETM now fires observations mid-prompt-set on AskUserQuestion decisions and significant tool-activity batches (>=8 tool_use OR >=10min), stamps each at its REAL event time instead of collapsing to the prompt-set start (T0), and links every observation to the active Run via task_id — turning the e0af5b8b acceptance case (decisions 05:30-06:03Z) into observations dated ~05:30-06:03Z (OBS-02 + OBS-01).**

## Performance
- **Duration:** ~7 min
- **Started:** 2026-06-29T10:27:47Z
- **Completed (automated tasks):** 2026-06-29T10:35:10Z
- **Tasks:** 3 of 3 complete (Tasks 1–2 automated; Task 3 human-verify checkpoint APPROVED by operator 2026-06-29)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

### Task 1 — ETM mid-set fire boundary + true event-time + cursor dedup (OBS-02) [`9810be5f2`]
- Created `lib/live-logging/etm-recapture.mjs` exporting the pure `computeRecaptureFires(messages, opts)` (the Plan 01 RED contract target) plus `DEFAULT_TOOL_BATCH_THRESHOLD` (8) and `DEFAULT_TIME_THRESHOLD_MS` (10*60*1000). It walks raw Claude transcript messages, cuts a batch at (a) each AskUserQuestion decision and (b) each significant tool-activity batch (>=8 tool_use OR >=10min in a question-less stretch), stamps each fire's `created_at` at the batch's REAL last-message timestamp (D-08), carries the active `task_id` (D-09), and dedups by `(task_id, batch-last-message-uuid)` with a `lastFiredExchangeUuid` resume cursor (Pitfall 4).
- Refactored `enhanced-transcript-monitor.js` `_firePromptSetObservation` from a single whole-set fire (stamped at T0) into a per-batch orchestrator: `_splitIntoRecaptureBatches` (exchange-based, same thresholds via the imported constants) + `_fireBatchObservation` (the former single-fire body, re-keyed). Added a per-transcript `lastFiredExchangeUuid` cursor keyed by session/agent so re-processing never re-emits a prior batch, and changed the OBS fire-dedup key from `count|lastExchangeId` to `(task_id, batch-last-message-uuid)`.
- The existing typed-prompt-set flush (`isUserPrompt` boundary) is preserved — mid-set fires are additive, not a replacement.
- Turned `tests/live-logging/ETM-recapture.test.js` GREEN (5/5): >=2 observations, >=1 dated in 05:30-06:03Z (not 21:00:43Z), every obs with non-empty task_id, no duplicate dedup key.

### Task 2 — task_id on observation metadata (OBS-01) [`659e8f7be`]
- ETM resolves the active task_id once per fire via `resolveLiveTaskIdSafe()` (the same single-span reader the token path uses, D-09 — no proxy coupling) and stamps it on the metadata object passed to `ObservationWriter.processMessages`.
- `ObservationWriter.writeObservation` extends the persisted `entity.metadata` spread with `task_id`, with a best-effort `resolveLiveTaskIdSafe()` fallback so direct callers without ETM still link observations to the active Run. Only a non-empty value is stamped.
- `created_at` logic (`messages.find(m => m.createdAt)?.createdAt`) left untouched; `_redact`-before-persist, content-hash + semantic dedup, and `skipOntologyCheck: true` all preserved. No ontology edit (task_id is metadata only).
- ETM-recapture (5) + ObservationWriter.pre-llm-dedup (7) = 12/12 green, no regression.

## Task Commits
1. **Task 1: ETM mid-set fire boundary + true event-time + cursor dedup (OBS-02)** — `9810be5f2` (feat)
2. **Task 2: task_id on observation metadata (OBS-01)** — `659e8f7be` (feat)

## Files Created/Modified
- `lib/live-logging/etm-recapture.mjs` *(created)* — pure `computeRecaptureFires` fire-boundary + thresholds + dedup; the unit-testable Plan 05 refactor target.
- `scripts/enhanced-transcript-monitor.js` *(modified)* — imports the recapture thresholds + `resolveLiveTaskIdSafe`; `_isAskUserQuestionExchange`, `_splitIntoRecaptureBatches`, per-batch `_firePromptSetObservation` orchestrator + `_fireBatchObservation`; `lastFiredExchangeUuid` cursor; `(task_id, batch-last-message-uuid)` dedup key; `metadata.task_id` at the fire site.
- `src/live-logging/ObservationWriter.js` *(modified)* — `resolveLiveTaskIdSafe` import; `taskId` resolution in `writeObservation`; `task_id` added to the persisted `entity.metadata` spread (best-effort, non-empty only).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jest must run with `NODE_OPTIONS='--experimental-vm-modules'`**
- **Found during:** Task 1 verification
- **Issue:** The plan's verify command is bare `npx jest ...`, but the project's ESM `.test.js` files (package `type: module`, empty `jest: {}`) fail with `Cannot use import statement outside a module` unless `NODE_OPTIONS='--experimental-vm-modules --no-warnings'` is set (the project's `npm test` script sets exactly this).
- **Fix:** Ran the verify commands with the project's documented NODE_OPTIONS. No source/config change required.
- **Files modified:** none.
- **Verification:** `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/live-logging/ETM-recapture.test.js` → 5/5 PASS.

**Total deviations:** 1 auto-fixed (1 blocking, runner-invocation only — no code/config change).

## Acceptance Criteria

### Task 1
- `grep -n "lastFiredExchangeUuid" scripts/enhanced-transcript-monitor.js` → present (cursor map + get/set).
- `grep -nE "AskUserQuestion" scripts/enhanced-transcript-monitor.js` → present (`_isAskUserQuestionExchange` decision trigger).
- `grep -nE ">= ?8|600000|10 ?\* ?60" scripts/enhanced-transcript-monitor.js` → present (`>= 8 tool_use` / `600000` / `10*60*1000` in the splitter).
- ETM-recapture.test.js → 5/5 (>=2 obs, >=1 in 05:30-06:03Z, all task_id-stamped, no dup key).
- `grep -n "isUserPrompt"` → still present (typed-prompt-set flush preserved).

### Task 2
- `grep -n "resolveLiveTaskIdSafe" scripts/enhanced-transcript-monitor.js` → called at the fire site (`taskIdPromise`).
- `grep -n "task_id" src/live-logging/ObservationWriter.js` → added to the metadata spread at the entity build.
- ETM-recapture.test.js → every obs carries non-empty `metadata.task_id`.
- ObservationWriter.pre-llm-dedup.test.js → 7/7 (no regression).
- `grep -n "messages.find(m => m.createdAt)"` → present and untouched.

## Checkpoint — Task 3 (APPROVED 2026-06-29)

Task 3 is a `checkpoint:human-verify` (gate=blocking) requiring a LIVE launchd ETM daemon (`com.coding.etm`) kickstarted to pick up the source change + a real multi-decision session — this CANNOT be done synchronously within the executor run (live re-capture is observable only over real session time).

**Operator response: "approved".** The operator accepted the following as sufficient evidence that ETM fires mid-set on AskUserQuestion/tool-batch boundaries, stamps real event-time, and links task_id:
1. The `e0af5b8b` fixture jest test (`tests/live-logging/ETM-recapture.test.js`) — 5/5 green: >=2 observations, >=1 dated in 05:30-06:03Z (NOT the collapsed 21:00:43Z T0), every obs carries a non-empty `metadata.task_id`, no duplicate `(task_id, batch-last-message-uuid)` keys.
2. A confirmed-healthy ETM daemon: the orchestrator kickstarted `com.coding.etm` (running pid 10059), with no `[STALL-DETECT]` / crash in `.logs/etm.log` after kickstart.

The live multi-decision session (operator decisions at T0+n producing observations dated ~T0+n in production) is observable only over real wall-clock time across a future GSD session; the operator explicitly accepted the fixture-test + healthy-daemon evidence in lieu of waiting for that real-time confirmation. OBS-01 and OBS-02 are discharged.

## Known Stubs
None. `etm-recapture.mjs` is a complete pure function (no placeholder values); the ETM/ObservationWriter edits are wired end-to-end. The only outstanding item is the live operator verification (Task 3 checkpoint).

## Threat Flags
None. No new network endpoints, auth paths, or schema changes. T-75-51 (PII redaction) preserved — `_redact` still runs before persist on the unchanged path; T-75-52 (re-emission inflation) mitigated by the new `lastFiredExchangeUuid` cursor + `(task_id, batch-last-message-uuid)` dedup key + the existing content-hash/semantic dedup; T-75-53 (task_id spoof) accepted — task_id resolved from the local single-span reader.

## User Setup Required
Operator must kickstart the launchd ETM after merge so the daemon picks up the source change: `launchctl kickstart -k gui/$(id -u)/com.coding.etm` (args unchanged → no re-registration). This is the Task 3 checkpoint.

## Next Phase Readiness
- Task 3 human-verify checkpoint APPROVED 2026-06-29 (fixture-test + healthy-daemon evidence). OBS-01 + OBS-02 discharged. Plan 75-05 complete (3/3).
- `/gsd-verify-phase 75` can run the automated gate (ETM-recapture + ObservationWriter suites) now; the live re-measure across a real multi-decision session is the standing phase-gate item per RESEARCH §Sampling Rate (observable only over real time).

## Self-Check: PASSED

All 4 files (1 created + 3 modified incl. SUMMARY) exist on disk; both task commits (`9810be5f2`, `659e8f7be`) present in git log. Task 3 checkpoint discharged via operator approval; OBS-01 + OBS-02 marked Complete in REQUIREMENTS.md; ROADMAP 75-05 row checked; plan counter advanced 5→6.
