---
phase: 84-per-turn-context-revelation
plan: 03
subsystem: retention
tags: [launchd, sweeper, retention, age-gate, context-turns, raw-bodies, wave-1]

# Dependency graph
requires:
  - "84-01 — tests/context-turns/_helpers.mjs (mkTmpMeasurementsDir) + skipped sweeper stub"
provides:
  - "com.coding.context-turns-sweeper launchd job (hourly, RunAtLoad) reclaiming .data/measurements/<task>/context-turns.jsonl(.gz) + raw-bodies.jsonl(.gz) by age"
  - "scripts/context-turns-sweeper-job.sh — portable never-throw age-gate sweep (CONTEXT_TURNS_RETENTION_DAYS)"
  - "scripts/install-context-turns-sweeper-launchd.sh — plutil-lint -> copy -> bootout -> bootstrap -> verify installer (pipefail-safe verify)"
  - ".planning/config.json context_turns.retention_days documented default"
affects: [84-04, 84-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "launchd sweeper trio cloned from com.coding.lsl-lock-sweeper (plist + portable job.sh + idempotent installer)"
    - "Portable BSD/GNU dual-form file_mtime helper with numeric-only accept"
    - "Per-file mtime independence so a secrets-bearing raw-bodies file is reclaimed on schedule even while a companion digest is fresh"

key-files:
  created:
    - launchd/com.coding.context-turns-sweeper.plist
    - scripts/context-turns-sweeper-job.sh
    - scripts/install-context-turns-sweeper-launchd.sh
  modified:
    - .planning/config.json
    - tests/context-turns/sweeper.test.mjs

key-decisions:
  - "Cadence changed to StartInterval 3600 (hourly) and the 30s ThrottleInterval dropped — age-based retention has no lock-race, unlike the lsl-lock analog."
  - "Per-file mtime age-gate (D-05): context-turns and raw-bodies files are evaluated independently so a stale raw-bodies.jsonl.gz drops on schedule even while its digest survives."
  - "Retention window ships as config.json context_turns.retention_days:14 (documentation) AND is read at runtime from the CONTEXT_TURNS_RETENTION_DAYS env var (the bash sweeper's source of truth) per D-02."

patterns-established:
  - "pipefail-safe launchctl verify: capture `launchctl list` to a variable before `grep -qF`, never pipe directly (grep -q early-exit + SIGPIPE + pipefail = false FAIL)."

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-07-07
---

# Phase 84 Plan 03: Context-Turns Age-Retention Sweeper Summary

**A dedicated hourly launchd job (`com.coding.context-turns-sweeper`) that reclaims per-request `context-turns.jsonl(.gz)` and `raw-bodies.jsonl(.gz)` files under `.data/measurements/<task>/` by age (default 14 days, `CONTEXT_TURNS_RETENTION_DAYS`-configurable), decoupled from span close and best-effort never-throw — cloned from the proven lsl-lock-sweeper trio, registered and verified live via launchctl.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-07-07
- **Tasks:** 2
- **Files created:** 3, modified: 2

## Accomplishments
- Cloned the sweeper trio retargeted at `.data/measurements/*/`: plist (Label `com.coding.context-turns-sweeper`, `RunAtLoad` + `StartInterval 3600`, no ThrottleInterval), portable `context-turns-sweeper-job.sh` (BSD/GNU dual-form `file_mtime`, per-file age-gate over the four target names, `set -uo pipefail` + `exit 0` never-throw), and an idempotent installer.
- Documented the retention default in `.planning/config.json` (`context_turns.retention_days: 14`) with a note that the sweeper reads `CONTEXT_TURNS_RETENTION_DAYS` at runtime (D-02).
- Un-skipped `tests/context-turns/sweeper.test.mjs`: seeds a 30-day-old `context-turns.jsonl` + 30-day-old `raw-bodies.jsonl.gz` and a 1-day-old `context-turns.jsonl.gz` under a temp `CODING_REPO`, runs the real job with `CONTEXT_TURNS_RETENTION_DAYS=14`, asserts the aged files are deleted while the fresh file survives, then drives a non-existent measurements dir and asserts exit 0.
- Ran the installer on the host: `com.coding.context-turns-sweeper` is registered and appears in `launchctl list` (PID 49543, last exit 0); the RunAtLoad sweep logged `sweep complete — retention 14d, checked 0, removed 0`.

## Task Commits

1. **Task 1: Clone the sweeper trio (plist + job.sh + installer), retargeted to .data/measurements** — `3f63896f8` (feat)
2. **Task 2: Drive the sweeper via a temp measurements dir + register the job** — `e03885119` (test)

## Files Created/Modified
- `launchd/com.coding.context-turns-sweeper.plist` — hourly + RunAtLoad launchd job; ProgramArguments → the sweep job
- `scripts/context-turns-sweeper-job.sh` — portable age-gate sweep over `.data/measurements/*/`, per-file mtime, never-throw
- `scripts/install-context-turns-sweeper-launchd.sh` — plutil-lint → copy → bootout → bootstrap → (pipefail-safe) verify
- `.planning/config.json` — `context_turns.retention_days: 14` + `CONTEXT_TURNS_RETENTION_DAYS` override note
- `tests/context-turns/sweeper.test.mjs` — age-gated delete + never-throw driver

## Decisions Made
- Hourly cadence (`StartInterval 3600`), ThrottleInterval dropped — a 14-day age policy needs no sub-minute cadence and there is no lock-race to throttle.
- Per-file mtime independence (D-05): the four target names are evaluated separately so a secrets-bearing `raw-bodies` file is reclaimed even while its `context-turns` digest is still within the window.
- config.json documents the shipped default; the bash job's runtime truth is the env var (D-02 says config.json OR env — both wired, no divergence risk since config is documentation-only here).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Installer verify reported a false FAIL under `set -o pipefail`**
- **Found during:** Task 2 (running the installer to register the job)
- **Issue:** The cloned installer's verify line `launchctl list | grep -qF "${LABEL}"` runs under `set -euo pipefail`. `grep -q` exits on the first match and closes the pipe, so the still-writing `launchctl list` (large output) is killed with SIGPIPE (141); `pipefail` then propagates 141 as the pipeline status, sending the installer down the FAIL branch and `exit 1` — even though the job was correctly registered (`launchctl list` independently showed it loaded, exit 0, and the RunAtLoad sweep ran). The bug is latent in the `lsl-lock-sweeper` analog; my label `com.coding.context-turns-sweeper` sorts earlier in launchctl's output, so grep matches sooner, leaving more unwritten output and reliably triggering the SIGPIPE.
- **Fix:** Capture `launchctl list` into a variable first (`LAUNCHCTL_LIST="$(launchctl list || true)"`) then `grep -qF "${LABEL}" <<<"${LAUNCHCTL_LIST}"` — no pipe, no SIGPIPE. Installer now reports `OK` and exits 0.
- **Files modified:** `scripts/install-context-turns-sweeper-launchd.sh`
- **Verification:** re-run installer → `OK: com.coding.context-turns-sweeper is loaded`, exit 0; `launchctl list | grep` returns a row.
- **Committed in:** `e03885119`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** No scope change. Same fix should be back-ported to `install-lsl-lock-sweeper-launchd.sh` if that installer's false-FAIL is ever observed (out of scope here — logged as an advisory, not fixed).

## Issues Encountered
- None beyond the installer pipefail bug documented above.

## Threat Surface
- T-84-03-01 (DoS via bad/missing dir) mitigated: `set -uo pipefail` + per-file best-effort + `exit 0`; the test drives a non-existent measurements dir and asserts exit 0.
- T-84-03-02 (Information Disclosure via lingering raw-bodies) mitigated: `raw-bodies.jsonl(.gz)` is age-deleted independently of digests, so secrets-bearing files are reclaimed on schedule.
- T-84-03-SC (npm install tampering) N/A: no packages installed.

## Next Phase Readiness
- Retention is now honest and bounded regardless of span lifecycle; 84-04/84-05 (write-line/cache-split/close-gzip) can rely on the age sweeper to reclaim their measurement artifacts.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-07*

## Self-Check: PASSED
- All 5 created/modified files verified present on disk.
- Both task commits (`3f63896f8`, `e03885119`) verified in git log.
- `com.coding.context-turns-sweeper` verified registered via `launchctl list` (PID 49543, exit 0).
