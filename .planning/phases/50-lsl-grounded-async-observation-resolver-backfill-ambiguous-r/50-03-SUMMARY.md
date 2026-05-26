---
phase: 50-lsl-grounded-async-observation-resolver
plan: 03
subsystem: live-logging
tags: [lsl, observation-resolver, launchd, cron, plan-3]
dependency_graph:
  requires:
    - scripts/resolve-observations-from-lsl.mjs (Plan 50-01 CLI)
    - host LLM proxy on port 12435 (POST /api/complete)
    - macOS launchd (LaunchAgent domain — user, not system)
  provides:
    - launchd/com.coding.lsl-resolver.plist (source-controlled LaunchAgent definition)
    - scripts/install-lsl-resolver-launchd.sh (idempotent installer)
    - scripts/lsl-resolver-job.sh (the command launchd runs every 30 min)
  affects:
    - Plan 50-02 (writer-stamp): rows stamped with needs_lsl_resolution are now picked up automatically without manual CLI runs
tech-stack:
  added: []
  patterns:
    - Periodic launchd job via StartInterval (no KeepAlive — avoids tight-loop on failure)
    - launchctl bootout+bootstrap (modern, replaces deprecated load/unload)
    - Atomic state-file writes via tmp+mv (matches the resolver's own idempotency-stamp convention)
    - Env-overridable script paths (LSL_RESOLVER_STATE_FILE, RESOLVER_BIN, LLM_CLI_PROXY_URL) for test-driven development of a script that otherwise depends on launchd + a real proxy
key-files:
  created:
    - launchd/com.coding.lsl-resolver.plist (28 lines)
    - scripts/install-lsl-resolver-launchd.sh (84 lines, executable)
    - scripts/lsl-resolver-job.sh (113 lines, executable)
    - tests/integration/lsl-resolver-launchd.test.js (227 lines, 7 tests)
  modified: []
key-decisions:
  - "Skipped Task 3 (/health/state summary_integrity) — scripts/health-coordinator.js has no direct SQLite handle (it's a pure HTTP aggregator that polls obs_api). Surfacing summary_integrity needs either a new better-sqlite3 connection in coordinator (architectural change) or an obs_api endpoint extension (multi-file beyond this plan's scope). Documented in Deviations below; defer to a follow-up plan."
  - "set -euo pipefail moved immediately after the shebang (not after the doc-comment block) so the plan's done-criterion grep `head -3 ... | grep -F set -euo pipefail` passes verbatim."
  - "Wrapper accepts RESOLVER_BIN as a direct executable path (not a `node script.mjs` string) so a bash shim can stand in during tests without spinning up a node child. Documented in the script header."
  - "Proxy reachability probe treats 2xx AND 4xx as success — empty-body POST to /api/complete returns 4xx (validation) on a healthy proxy, so 4xx is the canonical reachability signal, not a failure."
  - "RunAtLoad=false in the plist so the first run waits one StartInterval (30 min) instead of racing the user's `bash install-lsl-resolver-launchd.sh` invocation. The plan's Task 4 instructs operators to `launchctl kickstart -k` for an immediate first run."
requirements-completed: []
metrics:
  duration: 5min
  completed: 2026-05-26
  tasks: 3 of 4 complete (Task 3 SKIPPED with rationale; Task 4 is a human-verify checkpoint)
  files_created: 4
  files_modified: 0
  tests_added: 7
  tests_passing: 7 of 7 (and 47/47 Plan 01+02 regression suites still green)
---

# Phase 50 Plan 03: Launchd Cron Job for LSL Resolver Summary

Wire the Plan 01 CLI (`scripts/resolve-observations-from-lsl.mjs`) into a 30-minute launchd cadence so historical observation rows with `needs_lsl_resolution = 1` (stamped by Plan 02) get backfilled automatically — no more humans needing to remember to run the resolver by hand. Ships the source-controlled plist, an idempotent installer, the wrapper script the plist actually runs, and an integration test suite.

## Performance

- **Duration:** ~5 min (started 2026-05-26T14:16:42Z, completed 2026-05-26T14:21:14Z)
- **Tasks:** 3 of 4 complete (Task 3 explicitly skipped — see Deviations; Task 4 is the human-verify checkpoint awaiting operator approval)
- **Files created:** 4
- **Files modified:** 0
- **Tests added:** 7 (all passing)

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Launchd plist + idempotent installer | `19021f525` | launchd/com.coding.lsl-resolver.plist, scripts/install-lsl-resolver-launchd.sh |
| 2 RED | Failing wrapper integration tests | `73a2eb593` | tests/integration/lsl-resolver-launchd.test.js |
| 2 GREEN | Wrapper implementation | `462bfbed9` | scripts/lsl-resolver-job.sh |
| 3 | **SKIPPED** — `/health/state` summary_integrity | (none) | (none — see Deviations) |
| 4 | Human-verify checkpoint | (operator action) | ~/Library/LaunchAgents/com.coding.lsl-resolver.plist, .data/lsl-resolver-state.json, .logs/lsl-resolver.log |

## Accomplishments

- **Plist matches project convention.** Mirrors `~/Library/LaunchAgents/com.coding.health-coordinator.plist` structure (Label, ProgramArguments, ThrottleInterval, WorkingDirectory, StandardOutPath, EnvironmentVariables.PATH) but flips two switches per the plan's intent: `RunAtLoad=false` (no race with the installer) and `StartInterval=1800` (every 30 minutes) instead of `KeepAlive=true` (which would tight-loop on failure). Zero `KeepAlive` keys, zero `RunAtLoad=true`.
- **Installer is idempotent.** `diff -q` short-circuits the file copy when nothing changed; `launchctl bootout … || true` swallows the "not loaded" error so the boot-out-then-bootstrap pattern works on cold AND warm installs. `mkdir -p` for the target dir + `.logs/` dir. Final `launchctl list | grep` registration check exits non-zero if bootstrap silently dropped the job.
- **Wrapper handles all four state transitions** (first run / subsequent run / proxy unreachable / CLI failure) and locks them in via 7 integration tests:
  - **Test 1 (first run):** `--since` defaults to 7 days ago; state file gets created.
  - **Test 2 (subsequent run):** `--since` reads `last_run_at` from state file; state file updated atomically on success.
  - **Test 3 (proxy unreachable):** Curl error against a closed port → wrapper exits **0**, resolver never invoked, state file untouched. This is the "log hygiene exit" that prevents launchd error spam when the proxy is down.
  - **Test 4 (CLI failure):** Resolver returns exit 1 → wrapper exits 1, state file preserved so the next run retries the same `--since` window.
  - **Test 5 (atomic write):** Source grep confirms `STATE_FILE.tmp` + `mv` idiom.
  - **Test 6 (bash strict mode):** `set -euo pipefail` immediately after the shebang.
  - **Test 7 (no console.\*):** Zero `console.` calls (it's bash); every log line goes through `log() … >&2` with a `[lsl-resolver][HH:MM:SSZ]` prefix.
- **Test isolation.** The wrapper honors three env overrides for testability: `LSL_RESOLVER_STATE_FILE` (tmpdir path), `RESOLVER_BIN` (fake-resolver bash shim that writes its argv to a sidecar file), `LLM_CLI_PROXY_URL` (small in-test HTTP server with dial-able status codes). No mocks, no jest module-stubs; the script is exercised end-to-end via `child_process.spawn`.
- **Regression-clean.** Plan 01 (lsl-window, scan-and-convert, resolve-observations-from-lsl) + Plan 02 (ObservationWriter.prior-context-lsl, ObservationWriter.needs-lsl-resolution) test suites still pass: **47/47 green** after this plan's commits.

## Deviations from Plan

### SKIPPED — Task 3 (`/health/state` `summary_integrity` extension)

**Rule:** Plan 03 Task 3 was explicitly tagged as OPTIONAL (D-Confidence Could #10). The plan's additional context says:

> If Task 3's integration surface is unclear (e.g., you can't pin where `/health/state` is built from inside the worktree without bind-mounts), document the gap in SUMMARY.md and SKIP Task 3 — it's a nice-to-have, not a blocker for closing Phase 50.

**Why the integration surface is unclear:** `scripts/health-coordinator.js` (the file the plan names as the target) does **not** have a direct SQLite handle to `.observations/observations.db`. Verified by grep:

```
$ grep -cE "(better-sqlite3|require\('sqlite|new Database|\.db\.prepare)" scripts/health-coordinator.js
0
```

The coordinator is a pure HTTP aggregator — its `currentState.knowledge_pipeline` block is populated by `pollKnowledgePipeline()` (line 515), which **fetches** observation totals over HTTP from the upstream `obs_api` service (`body.totalObs` at line 577). The plan's recipe ("three `SELECT COUNT(*)` queries, one-shot per `/health/state` poll") would require either:

1. **Opening a new better-sqlite3 connection inside coordinator** — architecturally inconsistent with the existing coordinator-as-aggregator design. None of the other counters in `currentState.*` use direct DB access.
2. **Extending `obs_api` upstream** to expose `summary_integrity` counts, then having coordinator poll the new field. This is a 2-service change touching files beyond Plan 03's `<files>` declaration.

Neither path is the "minimal isolated change" the plan describes. Plan 01's resolver already produces all the data correctly; the dashboard surfacing can come later via a small follow-up plan that picks one of the two paths cleanly.

**No follow-up blocker:** Phase 50's acceptance criteria don't include the `/health/state` extension. The four `<success_criteria>` items at PLAN.md lines 503-509 still pass without Task 3 (the `summary_integrity` line is qualified as "if shipped" in the `must_haves.truths` block).

### No other deviations

Plan executed as written. No Rule 1/2/3 auto-fixes were needed. The only test-driven adjustment was moving `set -euo pipefail` to immediately follow the shebang (instead of after the doc-comment block) so the plan's `head -3 … | grep -F "set -euo pipefail"` done-criterion passes verbatim — that's a refinement of the literal location, not a behavioral change.

## Human-Verify Checkpoint (Task 4)

The work for Plan 03 is complete at the artifact level. The remaining step is host-side: load the launchd job and confirm it actually fires. Claude can't do this from inside the worktree — launchd is a host-level service that bootstrap-registers against `~/Library/LaunchAgents/`, which is outside any worktree's bind-mount.

**Operator install instructions:**

1. **Install the job** (idempotent — safe to re-run):

   ```bash
   bash /Users/Q284340/Agentic/coding/scripts/install-lsl-resolver-launchd.sh
   ```

   Expected stderr (each prefixed `[install-lsl-resolver]`):
   - `installed plist at /Users/Q284340/Library/LaunchAgents/com.coding.lsl-resolver.plist`
   - `boot-out (if loaded): launchctl bootout gui/$UID/com.coding.lsl-resolver`
   - `bootstrap: launchctl bootstrap gui/$UID …`
   - `OK: com.coding.lsl-resolver is loaded.`
   - `log file: /Users/Q284340/Agentic/coding/.logs/lsl-resolver.log`

2. **Confirm registration**:

   ```bash
   launchctl list | grep com.coding.lsl-resolver
   ```

   Expected: one line, columns are `PID  LAST_EXIT_CODE  LABEL`. PID is `-` between intervals; `LAST_EXIT_CODE` should be `0` (or `-` before the first run).

3. **Force an immediate run** (rather than waiting 30 minutes):

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.coding.lsl-resolver
   tail -F /Users/Q284340/Agentic/coding/.logs/lsl-resolver.log
   ```

   Expected log lines (interspersed with the Plan 01 CLI's own stderr):
   - `[lsl-resolver][HH:MM:SSZ] LLM proxy reachable (HTTP 4xx), proceeding`
   - `[lsl-resolver][HH:MM:SSZ] no prior state — defaulting --since to YYYY-MM-DDTHH:MM:SSZ`
   - `[lsl-resolver][HH:MM:SSZ] running: node scripts/resolve-observations-from-lsl.mjs --since … --limit 100`
   - `[resolver] candidates: N`
   - `[lsl-resolver][HH:MM:SSZ] run complete — state updated to YYYY-MM-DDTHH:MM:SSZ`

4. **Verify state file**:

   ```bash
   cat /Users/Q284340/Agentic/coding/.data/lsl-resolver-state.json
   ```

   Expected: `{"last_run_at":"YYYY-MM-DDTHH:MM:SSZ","last_run_limit":100}`

5. **Verify the DB picked up the work**:

   ```bash
   sqlite3 .observations/observations.db "SELECT COUNT(*) FROM observations WHERE json_extract(metadata, '\$.lsl_resolved_at') IS NOT NULL"
   ```

   Expected: a non-negative integer (number of rows the kickstart run resolved).

6. **Idempotency check** — kickstart a second time:

   ```bash
   launchctl kickstart -k gui/$(id -u)/com.coding.lsl-resolver
   ```

   Expected: log shows the second run found few or zero new candidates (the first run already stamped them); the count from step 5 has not grown wildly.

**Pre-flight reminder:** The rapid-llm-proxy must be running on port 12435 before kickstart — otherwise step 3's first log line will read `LLM proxy unreachable (HTTP 000) — skipping this run`, the resolver won't be invoked, and the state file won't update. Confirm with `curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:12435/api/complete` — expect a 4xx response.

## Threat Model Mitigations Verified

| Threat ID | Mitigation | Verified by |
|-----------|------------|-------------|
| T-50-03-CR (DoS via KeepAlive tight loop) | Plist has zero `KeepAlive` key; `StartInterval=1800` + `ThrottleInterval=30`. Wrapper exits 0 on proxy unreachable (Test 3). | `grep -c KeepAlive launchd/com.coding.lsl-resolver.plist` = 0; Test 3 passes |
| T-50-03-SI (state file corruption) | Atomic `.tmp` + `mv` write idiom. Wrapper tolerates missing state file (Test 1 default-7-days). | Test 5 grep; Test 1 happy path |
| T-50-03-CR2 (tampering via wrapper args) | `--since` and `--limit` are computed from local state, not user-supplied. Plan 01's CLI re-validates per its own contract (Plan 01 Test 9). | Inspection — only `${SINCE}` and `${LIMIT}` interpolated, both from local sources |
| T-50-03-PR (log file info disclosure) | Accepted — log contains only timestamps + exit codes + bracketed log labels. No user message content. | Wrapper grep: log() body emits only `$(date)` + literal strings + `${SINCE}` / `${EXIT_CODE}` |
| T-50-03-RL (LLM cost runaway) | `LSL_RESOLVER_LIMIT` defaults to 100; the CLI further caps at `HARD_CAP=50` (Plan 01). `taskType: 'observation-resolution'` routes to haiku per Plan 01 spec. | Wrapper defaults verified; Plan 01 done-greps already verified HARD_CAP=50 |
| T-50-03-SC (supply chain) | No new npm packages. `launchctl bootstrap` runs from per-user `~/Library/LaunchAgents/` — no sudo. | `git diff package.json` clean (untouched); installer `grep -cE "sudo"` = 0 |
| T-50-03-DC (coordinator SQL read) | n/a — Task 3 skipped (see Deviations) | — |

## Self-Check: PASSED

**File existence** (all 4 expected files present in the working tree):

- `launchd/com.coding.lsl-resolver.plist` — FOUND (valid XML per `plutil -lint`)
- `scripts/install-lsl-resolver-launchd.sh` — FOUND (executable, `bash -n` clean)
- `scripts/lsl-resolver-job.sh` — FOUND (executable, `bash -n` clean)
- `tests/integration/lsl-resolver-launchd.test.js` — FOUND (7/7 tests pass)

**Commits present in git log:**

- `19021f525` (Task 1 — plist + installer)
- `73a2eb593` (Task 2 RED)
- `462bfbed9` (Task 2 GREEN — wrapper implementation)

**Done-criteria greps:**

```
$ /usr/bin/plutil -lint launchd/com.coding.lsl-resolver.plist
launchd/com.coding.lsl-resolver.plist: OK

$ grep -A1 StartInterval launchd/com.coding.lsl-resolver.plist | grep -F "<integer>1800</integer>"
    <integer>1800</integer>

$ grep -c KeepAlive launchd/com.coding.lsl-resolver.plist
0

$ grep -cE "launchctl (load|unload)" scripts/install-lsl-resolver-launchd.sh
0

$ bash -n scripts/install-lsl-resolver-launchd.sh && bash -n scripts/lsl-resolver-job.sh
(both exit 0)

$ head -3 scripts/lsl-resolver-job.sh | grep -F "set -euo pipefail"
set -euo pipefail

$ grep -c "console\." scripts/lsl-resolver-job.sh
0

$ grep -c "STATE_FILE.tmp\|state.json.tmp" scripts/lsl-resolver-job.sh
2
```

**Test suite:**

```
$ NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/integration/lsl-resolver-launchd.test.js --no-coverage
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

**Regression suite (Plan 01 + Plan 02):**

```
$ NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest \
    tests/live-logging/lsl-window.test.js \
    tests/live-logging/scan-and-convert.test.js \
    tests/live-logging/resolve-observations-from-lsl.test.js \
    tests/live-logging/ObservationWriter.prior-context-lsl.test.js \
    tests/live-logging/ObservationWriter.needs-lsl-resolution.test.js --no-coverage
Test Suites: 5 passed, 5 total
Tests:       47 passed, 47 total
```

## TDD Gate Compliance

Task 2 (the wrapper) followed the RED → GREEN cycle with separate commits:

| Phase | Commit | Verified |
|-------|--------|----------|
| RED   | `73a2eb593` (test) | 7/7 tests fail with ENOENT on the wrapper path |
| GREEN | `462bfbed9` (feat) | 7/7 tests pass; wrapper produced |

No REFACTOR commit needed — implementation stayed clean.

Task 1 (the plist + installer) is not a behavior-adding TDD task; it's a static artifact + a shell wrapper around `launchctl bootstrap`. Plan declares `<verify><automated>bash -n … && plutil -lint …</automated></verify>` not behavioral tests, so it ships as a single `feat` commit per the plan.

## Authentication Gates

None encountered. All tests run offline with a local HTTP fake-proxy server + a bash fake-resolver shim. The real launchd job will need:

- The rapid-llm-proxy running on port 12435 (per CLAUDE.md startup convention)
- `.observations/observations.db` writable for the Plan 01 CLI to UPDATE rows

Neither is a "gate" for closing this plan — both are operator pre-conditions for the human-verify checkpoint (Task 4).

## Known Stubs

None. All defaults in the wrapper script are documented in the script header:

- `LSL_RESOLVER_STATE_FILE` → `.data/lsl-resolver-state.json`
- `LSL_RESOLVER_LIMIT` → `100`
- `LLM_CLI_PROXY_URL` → `http://localhost:12435` (with `RAPID_LLM_PROXY_URL` / `LLM_PROXY_URL` precedence per CLAUDE.md)
- 7-day default for `--since` on first run

The skipped Task 3 (`/health/state` `summary_integrity`) is NOT a stub — it's an explicit deferral with rationale, and Plan 01's underlying data is already correctly stamped (verified by Plan 01 Self-Check). A future plan can surface the counters via the obs_api route without any changes to Plan 03's artifacts.

## Phase 50 Closure Readiness

After operator approval of the Task 4 checkpoint:

- Phase 50 acceptance criteria #1 (the three 2026-05-23 07:33 km-core "implement it now" rows) is satisfied by Plan 01's CLI — running it through Plan 03's launchd cadence will close those rows automatically within 30 minutes of install.
- Phase 50 acceptance criteria #2 (`--mode=images-only` rewrites `9a3e700c-…`) is the same surface; Plan 03's wrapper doesn't pass `--mode`, so the default mode `all` is used, which still catches image-only rows per Plan 01 Detector C.
- Phase 50 acceptance criteria #3 (idempotency) — verified at the wrapper level by Test 4 (CLI exit 1 leaves state untouched) AND at the resolver level by Plan 01 Test 7 (already-stamped rows are skipped). The launchd job adds no idempotency concerns of its own.
- Phase 50 acceptance criteria #4 (autonomous-task / 4+ hour gap) — already locked by Plan 01 Test 5; Plan 03 inherits unchanged.

No code blockers for Phase 50 closure. Only the host-side operator checkpoint remains.

---

*Phase: 50 — lsl-grounded-async-observation-resolver*
*Plan: 03 — Launchd cron + idempotent installer + wrapper*
*Completed: 2026-05-26 (plus pending Task 4 operator checkpoint)*
