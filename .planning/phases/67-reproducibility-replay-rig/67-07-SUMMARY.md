---
phase: 67-reproducibility-replay-rig
plan: 07
subsystem: infra
tags: [measurement-span, record-replay, reproducibility, run-snapshot, fixtures, experiments-kb]

# Dependency graph
requires:
  - phase: 67-01
    provides: "single match/record/replay impl — lib/repro/fixtures/{match-key,llm-replay,llm-record}.mjs"
  - phase: 67-02
    provides: "harness record + honest replay hard-fail (replayHarnessChannel throws REPLAY_UNSUPPORTED_CHANNEL) + deterministic clock shim"
  - phase: 67-04
    provides: "captureSnapshot(task_id, {repoRoot, dataDir, prompt}) → {snapshot_id, dir, clock_base}; full RunSnapshot manifest"
  - phase: 67-05
    provides: "repro-restore.mjs sandbox restore (D-04) + confirm-gated --in-place (D-05)"
  - phase: 67-06
    provides: "proxy /api/complete replay+record taps (D-06 hard-fail on miss)"
provides:
  - "measurement-start.mjs auto-captures a RunSnapshot at span open and arms record (and, with --replay <snapshot>, replay) via the existing startMeasurement meta passthrough — no schema change, no second reader (D-09)"
  - "At-open UNSUPPORTED-channel notice for WebSearch/WebFetch/MCP replay (honest channel gating, D-08/SC-4)"
  - "measurement-stop.mjs archives the span's fixtures into the snapshot dir and threads snapshot_id into writeRun tags"
  - "run-write.mjs:108 populates snapshot_id from tags (was hardcoded null) — the Run entity now links to its RunSnapshot"
  - "Live end-to-end record→replay verified: recorded LLM responses served byte-identical from fixtures; novel prompt hard-fails 409 REPLAY_MISS; default restore leaves live HEAD unchanged (REPRO-01 + REPRO-02 wired end-to-end)"
affects: [68, 71]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture-at-open baseline (Pattern 3): snapshot written before any run mutation, best-effort so a capture failure never aborts the measurement"
    - "Arming via startMeasurement meta passthrough (meta.record / meta.replay_from) — reuses active-measurement.json single reader; no new JSON parser"
    - "snapshot_id threaded through the same 8-tag writeRun block as its siblings (t.snapshot_id ?? null)"

key-files:
  created: []
  modified:
    - "scripts/measurement-start.mjs (+58/-1 — captureSnapshot at open + --replay arming + clock_base + unsupported-channel notice)"
    - "scripts/measurement-stop.mjs (+38 — fixture archival into snapshot dir + snapshot_id threaded into writeRun tags)"
    - "lib/experiments/run-write.mjs (+1/-1 — snapshot_id: t.snapshot_id ?? null at :108, no longer hardcoded null)"
    - "tests/repro/run-link.test.mjs (created, 117 lines — isolated-store round-trip asserting snapshot_id persists on the Run)"

key-decisions:
  - "Arm record/replay via the existing startMeasurement meta passthrough (meta.record / meta.replay_from) rather than a second reader of active-measurement.json — single-reader discipline preserved (T-67-07-04)"
  - "captureSnapshot runs AFTER startMeasurement (span open) and is best-effort try/catch so a capture failure logs to stderr but never aborts the measurement (T-67-07-05 DoS mitigation)"
  - "Fixture archival at close is best-effort into the gitignored .data/run-snapshots/<sanitizeTaskId>/fixtures — no tracked-path writes (T-67-07-03 info-disclosure mitigation)"
  - "At --replay arm, print the UNSUPPORTED-channel notice naming WebSearch/WebFetch/MCP (record-only) so operators know only LLM + clock replay faithfully (D-08/SC-4 honesty, T-67-07-02)"

patterns-established:
  - "One workflow (D-09): capture at span open → record during → archive + snapshot_id link at close → replay via --replay flag; N=1 runs comparable modulo provider non-determinism"

requirements-completed: [REPRO-01, REPRO-02]

# Metrics
duration: ~35min (incl. live E2E checkpoint)
completed: 2026-07-02
---

# Phase 67 Plan 07: Measurement-Span Integration (Capture · Arm · Archive · Link · Live E2E) Summary

**Wired the full record→replay loop through the Phase-68 measurement span: `measurement-start.mjs` captures a RunSnapshot + arms record/replay via the existing `startMeasurement` meta passthrough, `measurement-stop.mjs` archives fixtures + links `snapshot_id` onto the Run, and `run-write.mjs:108` stops hardcoding null — proven live end-to-end against the running proxy daemon (recorded responses served byte-identical, novel prompt hard-fails 409, default restore never touches live HEAD).**

## Performance

- **Duration:** ~35 min (incl. operator-driven live E2E checkpoint)
- **Started:** 2026-07-02T15:42:52+06:00 (first task commit)
- **Completed:** 2026-07-02
- **Tasks:** 3 (Task 2 is TDD: RED → GREEN)
- **Files modified:** 4 (3 edits + 1 new test)

## Accomplishments

- `measurement-start.mjs` at span open: `captureSnapshot(taskId, { repoRoot, dataDir, prompt })` writes the pre-mutation RunSnapshot baseline; `startMeasurement({ task_id, meta: { record: true, ...(replayFrom ? { replay_from } : {}) } })` arms the proxy taps through the single `active-measurement.json` reader — no schema change, no second parser.
- `--replay <snapshot>` prints the honest UNSUPPORTED-channel notice (WebSearch/WebFetch/MCP are record-only; only LLM + clock replay faithfully) and points the proxy at `.data/run-snapshots/<snapshot>/fixtures`.
- `measurement-stop.mjs` at close archives the span's recorded `fixtures/` into the snapshot dir (best-effort) and threads `snapshot_id` into the tags object passed to `writeRun`.
- `run-write.mjs:108` now reads `snapshot_id: t.snapshot_id ?? null` (mirrors its 8 sibling tags) — the Run entity carries its RunSnapshot linkage; `tests/repro/run-link.test.mjs` proves the round-trip on an isolated store (`snapshot_id='snap-abc'` reads back; absent → null, backward compatible).
- Full record→replay loop live-verified end-to-end (evidence below).

## Task Commits

1. **Task 1: capture at open + --replay arming + clock_base + unsupported-channel notice** — `5bd636fc7` (feat)
2. **Task 2 (RED): failing Run↔snapshot_id linkage round-trip test** — `f434b71cc` (test)
3. **Task 2 (GREEN): archive fixtures into RunSnapshot + link snapshot_id** — `f36fa5db4` (feat)
4. **Task 3: LIVE end-to-end record→replay verification** — human-verify checkpoint, operator-driven, APPROVED

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `scripts/measurement-start.mjs` — captureSnapshot at span open + `--replay` arming via `startMeasurement` meta + clock_base fold + at-open unsupported-channel notice; `sanitizeTaskId` on the snapshot dir; capture best-effort.
- `scripts/measurement-stop.mjs` — best-effort fixture archival into `.data/run-snapshots/<task_id>/fixtures/` + `snapshot_id` threaded into the writeRun tags.
- `lib/experiments/run-write.mjs` — `snapshot_id: t.snapshot_id ?? null` at :108 (was hardcoded null // deferred → Phase 67).
- `tests/repro/run-link.test.mjs` — isolated-store (mkdtemp repoRoot + real `.data/ontologies-experiment/`) round-trip asserting `writeRun` persists `snapshot_id` on the Run.

## Live Verification Evidence (Task 3 — human-verify checkpoint, APPROVED)

The orchestrator drove the full live E2E against the running proxy daemon (`:12435`, build `347e496`, providers `claude-code` + `copilot`). All steps passed:

1. **Daemon** refreshed via `launchctl kickstart`; healthy.
2. **RECORD:** `measurement-start --task-id repro-e2e` auto-captured `.data/run-snapshots/repro-e2e/` with `git-sha.txt`, `dirty.patch`, `kb/`, `env-allowlist.json`, `mcp-inventory.json`, `planning/`, `submodules.json`, `llm-settings.json`, `prompt.txt`, `agent-version.txt`, and `manifest.json` carrying `clock_base=1782985632541` + a channels map. `llm-settings.json` verified secret-safe (no `api_key`/`token`/`secret`/`authorization` fields). Two real `/api/complete` calls served live via `claude-code/claude-sonnet-4-6`; the record tap wrote fixtures to `fixtures/llm/` (4 calls recorded).
3. **STOP:** `measurement-stop --task-id repro-e2e` archived and wrote Run `runId=019f223b`; the Run in the experiment store carries `snapshot_id='repro-e2e'` (run-write.mjs no longer hardcodes null).
4. **REPLAY:** `measurement-start --task-id repro-e2e-replay --replay repro-e2e` printed the UNSUPPORTED-channel NOTICE (WebSearch/WebFetch/MCP record-only). Re-issuing the recorded "say hello" prompt returned byte-identical content (`"Hello! 👋 How are you doing today? Is there anything I can help you with?"`) served from fixture `0d445bc…`; the recorded "2+2" prompt returned `"4"` (HTTP 200).
5. **MISS:** a novel prompt while replay armed returned HTTP `409 {"type":"REPLAY_MISS"}` (hard-fail, no live fallthrough); the exact recorded prompt still returned 200.
6. **SAFETY:** `repro-restore --snapshot repro-e2e` built an isolated sandbox worktree + sandbox `LLM_PROXY_DATA_DIR` with replay armed; live checkout HEAD unchanged (`f36fa5db4` main before and after).
7. **CLEANUP:** replay span stopped, active-measurement cleared, unarmed live traffic resumed (HTTP 200, `"ok"`); the restore sandbox worktree was removed.

## Decisions Made

See frontmatter `key-decisions`. In short: arm via meta passthrough (single reader), capture + archive best-effort (never abort the span), honest at-open channel gating, gitignored fixture writes only.

## Deviations from Plan

None — plan executed exactly as written. Tasks 1–2 landed on the acceptance criteria as specified (`node --check` clean on both scripts, `node --test tests/repro/run-link.test.mjs` green, `grep "t.snapshot_id" lib/experiments/run-write.mjs` present, `captureSnapshot` after `startMeasurement`, `sanitizeTaskId` on the snapshot dir, best-effort try/catch on capture + archive).

## Issues Encountered

**km-core submodule not fetchable in the restore sandbox (known limitation, non-fatal).** During step 6 (SAFETY / `repro-restore`), the `lib/km-core` submodule SHA was not fetchable in the isolated sandbox worktree (`unable to read tree`). The restore treated this as a best-effort warning, continued, and hydrated the KB from the JSON export instead (1201 nodes). This is a **known km-core-availability limitation** of the sandbox restore path: if the pinned submodule commit is not present in the sandbox's object store, submodule checkout is skipped with a warning rather than failing the restore. It did not affect record/replay of the LLM channel or the snapshot_id linkage. Follow-up (if it recurs and matters): pre-fetch/mirror the submodule objects into the sandbox before checkout, or surface the skip more prominently in `repro-restore` output.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- REPRO-01 + REPRO-02 fully wired end-to-end and live-verified. Phase 67 (Reproducibility & Replay Rig) is complete (7/7 plans).
- The rig is now integrated into the Phase 68 measurement span, so downstream runs can be captured/replayed via the `--replay` flag with no additional wiring.
- Known limitation to carry forward: km-core-submodule availability in the sandbox restore (documented above) — non-blocking.

## Self-Check: PASSED

- `scripts/measurement-start.mjs` — FOUND (modified in 5bd636fc7)
- `scripts/measurement-stop.mjs` — FOUND (modified in f36fa5db4)
- `lib/experiments/run-write.mjs` — FOUND (modified in f36fa5db4)
- `tests/repro/run-link.test.mjs` — FOUND (created in f434b71cc)
- Commit 5bd636fc7 — FOUND
- Commit f434b71cc — FOUND
- Commit f36fa5db4 — FOUND

---
*Phase: 67-reproducibility-replay-rig*
*Completed: 2026-07-02*
