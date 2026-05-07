# Phase 33 Verification Precheck

Run date: 2026-05-07T07:57:53Z (acceptance suite started) — finished 2026-05-07T08:06:41Z
Coordinator PID at start: 92419
Coordinator PID after AC#11 (kill -9): 13099 (respawned in 2s by launchd KeepAlive)
Coordinator PID after AC#13 (kickstart): 17627
Coordinator uptime at preflight: 3227s (~54 min)
Acceptance run duration: ~9 min

## SPEC Acceptance Criteria

| AC # | Description                                                | Status              | Evidence (one-line)                                                                                       |
|------|------------------------------------------------------------|---------------------|-----------------------------------------------------------------------------------------------------------|
| 1    | No legacy daemons running                                  | PASS                | `pgrep -fl '(system-monitor-watchdog\|global-process-supervisor\|global-service-coordinator\|global-lsl-coordinator)'` returns empty |
| 2    | Exactly 1 `com.coding.*` launchctl entry                   | FAIL (deviation)    | n=2 (`com.coding.health-coordinator`, `com.coding.llm-cli-proxy`) — LLM proxy out of Phase 33 scope; same as 33-07 Deviation #2 |
| 3    | `/health/state` has all 7 top-level keys                   | PASS                | All required keys present + `databases`, `files` (additive)                                               |
| 4    | Container reader matches host reader (structure)           | PASS-DEVIATION      | Host & container `keys` identical; SPEC's literal `.container.healthcheck` jq path returns null on both (G4 schema drift) |
| 5    | Two-session agreement                                      | FAIL                | LSL signal handling works; project-rollup `lsl_by_project["coding"]="healthy"` correct; FAILS at the dashboard agreement step (`/api/health-verifier/status` returns SPA HTML, not JSON) — G2 |
| 6    | P95 ≤ 10s, P99 ≤ 15s detection latency                     | FAIL                | obs-api is NOT in coordinator services registry; trial 1 hangs forever waiting for status flip (G1)        |
| 6-g  | No `force-recreate` references                             | PASS                | grep returns empty                                                                                        |
| 7    | No `readFileSync(.health/...)` in 4 consumers              | PASS                | grep returns empty across all 4 files                                                                     |
| 8    | Prompt-hook JSON shape preserved                           | PASS                | Exact SPEC pipe invocation passes; `hookSpecificOutput.additionalContext` present                          |
| 9    | Dashboard endpoints preserved                              | FAIL                | `/api/health-verifier/status` returns `text/html` (SPA index, HTTP 200), not JSON (G2)                     |
| 10   | Rules schema validates                                     | PASS                | `node --test` exit 0; 3 sub-tests pass (Ajv schema, bind_mount_freshness deleted, supervisord_status deleted) |
| 11   | Keepalive: kill -9 → respawn ≤30s                          | PASS                | Respawned in 2s (92419 → 13099)                                                                           |
| 12   | Docker health passthrough                                  | FAIL (G4)           | docker reports `healthy`, coordinator's `.container.healthcheck = null` (schema drift — coord emits `.container.status`) |
| 13   | Injection: forced throw → unknown                          | FAIL                | `HEALTH_COORDINATOR_INJECT_THROW=db_health` not propagated through plist; `.databases.status` stays `healthy` |

## Eviction Test (D-10)

**Result:** FAIL (timing-fragile, not a SoT regression)
**Detail:** Test sleeps 17s after a heartbeat and asserts `.status="stopped"`. Manual probe shows the transition actually happens at ~19s (5s tick + 15s threshold; the next tick after age>15s catches it). Test threshold is too tight for the 5s tick cadence.

## Aggregate

- `run-all.sh` exit code: **1** (fails fast on first FAIL — `docker-health-passthrough.test.sh`)
- Total SPEC ACs: 13
- **PASS: 7** — AC #1, #3, #6-grep, #7, #8, #10, #11
- **PASS-DEVIATION: 1** — AC #4 (structure equal, schema drift on the literal jq path)
- **FAIL: 5** — AC #2 (deviation, LLM CLI proxy out of scope), #5, #9 (both G2), #12 (G4), #13 (env not propagated)
- **FAIL-no-run: 1** — AC #6 (G1: obs-api not registered → trial 1 hangs; capped at 30s)

## Notes

- Smoke tests (`quick.sh`) all pass: coordinator HTTP responsive, /health/state structure correct.
- The 33-07 Option A patch landed: SPEC AC #1 is now satisfied (legacy daemons gone). This is a real improvement over the pre-patch state.
- All grep gates (AC #6-grep, #7, #10) pass: source code is clean.
- Real fail-modes cluster around 3 gaps (G1, G2, G4 from 33-07-SUMMARY) plus 2 newly-surfaced gaps (AC #13 plist env propagation; eviction-test timing fragility).
- Two ACs surfaced new findings beyond the documented G1-G6:
  - **AC #5 root cause** is partially G3-shaped (session-id handling) but the test fails at the dashboard step, which is squarely G2.
  - **AC #13 root cause** is plist `EnvironmentVariables` dict not declaring `HEALTH_COORDINATOR_INJECT_THROW` as inheritable. The coordinator code DOES honor the env var (`scripts/health-coordinator.js:64,176-378`), but the var doesn't reach the running process. Confirmed via `ps eww`.
