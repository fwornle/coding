---
phase: 33-health-monitoring-consolidation
plan: 10
subsystem: dashboard
tags: [gap-closure, reverse-proxy, route-order, spa-fallback, express, node-http, docker-compose, bind-mount]
status: complete
gap_closure: true
closes_gaps: [G2]

# Dependency graph
requires:
  - phase: 33-05
    provides: api-server (server.js on :3033) with `_forwardCoordinator` reverse-proxy + SPEC R8 reshape — we just forward through it
  - phase: 33-07
    provides: Live cutover state — coordinator on :3034, plist loaded, dashboard frontend on :3032 in supervisord
  - phase: 33-08
    provides: 33-VERIFICATION-PRECHECK.md surfacing G2 — `/api/health-verifier/status` returns text/html (SPA hijack)

provides:
  - SPA static-server.js with /api/* reverse-proxy mounted BEFORE express.static and the `*` catch-all
  - docker-compose bind-mount for static-server.js (mirrors the existing server.js bind-mount on line 98) — host edits now apply on container restart with no Docker image rebuild
  - scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh — AC#9 regression test (4 assertions, all PASS)
  - SPEC AC #5 (two-session-agreement, dashboard step) unblocked: full test now exits 0
  - SPEC AC #9 (dashboard endpoints preserved) unblocked: /api/health-verifier/{status,report,verify} all return application/json with SPEC R8 envelope
  - G2 closed

affects:
  - 33-VERIFY-FIXES (verifier step) — re-runs the acceptance suite; expects AC#5 and AC#9 PASS
  - Phase 33 declaration of completion — G2 no longer blocking; remaining gaps: G1 (AC#6), G4 (AC#4/#12), G7 (AC#13), G8 (eviction timing)
  - Future plans editing static-server.js — host-side edits now propagate to the container without rebuild (recurring deployment-friction gap fixed)

# Tech tracking
tech-stack:
  added: []  # node:http already in stdlib; no new packages
  patterns:
    - "Express route order — /api/* proxy mounted BEFORE express.static and BEFORE the `app.get('*', ...)` SPA fallback (Express matches in declaration order; first match wins). Reaffirmed for any future SPA + API split where the catch-all could swallow JSON routes."
    - "node:http reverse-proxy via req.pipe(upstream) — preserves method, headers, streaming bodies (POST), and avoids buffer + reserialize (mitigates T-33-10-02 tampering risk in threat model)."
    - "SPEC R6 invariant on upstream failure — when api-server is unreachable, return 503 with `{status:'unknown', error, hint}`, NEVER 'healthy'. Mirrors the same pattern used in server.js `_forwardCoordinator` (lines 308-330)."
    - "Live-mount any file the SPA-frontend supervisord program needs to evolve — added static-server.js to docker-compose.yml bind-mounts so future fixes ship with `supervisorctl restart` instead of a full image rebuild."

key-files:
  created:
    - scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh
    - .planning/phases/33-health-monitoring-consolidation/33-10-SUMMARY.md
  modified:
    - integrations/system-health-dashboard/static-server.js
    - docker/docker-compose.yml
  deleted: []

key-decisions:
  - "Mounted reverse-proxy at app.use('/api', ...) BEFORE express.static and the `*` catch-all. Express matches handlers in registration order — the original 21-line static-server.js had only `express.static(distDir)` + `app.get('*', sendFile)`, so any `/api/*` request fell through to the catch-all and was served the React index.html with text/html content-type. Closes G2 root cause."
  - "Forwarded to the api-server on 127.0.0.1:3033 (which already proxies the host coordinator with SPEC R8 reshape) instead of going direct to coordinator on :3034. Keeps the reshape logic in one place (server.js handleGetHealthStatus / handleGetHealthReport / handleTriggerVerification) and gives the static-server a stable, reshape-aware upstream. The api-server already handles upstream failures with the SPEC R6 envelope; static-server adds a second 503 layer for the case when api-server itself is down."
  - "Used node:http with req.pipe(upstream) instead of fetch() — fetch() requires await + arrayBuffer for POST bodies (lossy for streamed payloads, blocks event-loop on large bodies). req.pipe is non-buffering and works for any HTTP verb."
  - "Added a docker-compose bind-mount for static-server.js (mirrors the existing line 98 server.js mount). The plan assumed `static-server.js` was already bind-mounted per the CLAUDE.md note 'Dashboard UI: Bind-mounted, no Docker rebuild needed' but inspection showed only `dist/` and `server.js` were live-mounted — `static-server.js` was baked into the image. This was a recurring deployment-friction gap; fixed atomically with the G2 fix so future edits propagate via `docker exec ... supervisorctl restart` (or recreate-from-compose) instead of an image rebuild."
  - "Replaced `console.log` with `process.stdout.write` per the project's no-console-log constraint. Original 21-line file used console.log; constraint monitor blocked the Write hook. Per the 'Constraint Violations = Real Issues' memory rule, fixed inline rather than overriding."

patterns-established:
  - "SPA + API on same port: when serving a SPA from an Express server that ALSO needs to expose JSON routes, the JSON-route mount MUST come before the SPA static-asset mount AND before the `*` fallback. This pattern now codified in static-server.js comments + the dashboard-endpoints.test.sh regression test."
  - "Phase-33 G2 regression gate: dashboard-endpoints.test.sh asserts on every release that /api/health-verifier/status returns application/json (NOT text/html), the JSON parses, and SPA paths still serve text/html. Adding it to run-all.sh in a future plan would prevent this regression from recurring."

requirements-completed: [R2, R8]

# Metrics
duration: 6min
completed: 2026-05-07
tasks_completed: 2
tasks_pending: 0
files_created: 2
files_modified: 2
total_commits: 2
---

# Phase 33 Plan 10: Mount /api/* reverse-proxy in static-server.js (G2) — Summary

**SPA dashboard frontend on :3032 now reverse-proxies /api/* to the api-server on :3033 BEFORE the express.static + `*` catch-all, fixing the SPA-hijack of /api/health-verifier/* JSON routes (G2). AC #5 and AC #9 unblocked.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-07T09:00:11Z
- **Completed:** 2026-05-07T09:06:00Z
- **Tasks:** 2 (Task 1 — TDD reverse-proxy fix; Task 2 — AC re-run + G2 closure proof)
- **Files created:** 2 (regression test + this summary)
- **Files modified:** 2 (static-server.js + docker-compose.yml)
- **Total commits:** 2 (RED test + GREEN fix)

## Accomplishments

- **G2 closed.** /api/health-verifier/{status,report,verify} on :3032 now return application/json (SPEC R8 envelope) instead of the SPA index.html.
- **AC #9 PASS.** Full keys present: `data.{overallStatus,violationCount,criticalCount,lastUpdate,autoHealingActive}`.
- **AC #5 PASS.** `bash scripts/__tests__/health-coordinator/two-session-agreement.test.sh` exits 0 — both LSL signal-handling AND dashboard-agreement steps pass. (Previously failed at line 49 with `jq: parse error: Invalid numeric literal at line 1, column 10` against the SPA HTML response.)
- **No SPA regression.** GET / and GET /ukb-history (React Router client-side route) still serve text/html / index.html.
- **New regression test** `scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh` codifies the four-assertion contract (status content-type, JSON parse + key shape, SPA root, React Router fallback).
- **Deployment-friction fix:** `static-server.js` now bind-mounted from host via docker-compose (mirrors `server.js` line 98). Future edits propagate with `supervisorctl restart web-services:health-dashboard-frontend` — no Docker image rebuild.

## Before / After Evidence

### Before (broken)

```text
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/api/health-verifier/status
200 text/html; charset=UTF-8

$ curl -fs http://localhost:3032/api/health-verifier/status | head -c 80
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
```

### After (fixed)

```text
$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/api/health-verifier/status
200 application/json; charset=utf-8

$ curl -fs http://localhost:3032/api/health-verifier/status | python3 -m json.tool
{
    "status": "success",
    "data": {
        "overallStatus": "degraded",
        "violationCount": 8,
        "criticalCount": 0,
        "lastUpdate": "2026-05-07T09:04:56.600Z",
        "autoHealingActive": false
    }
}

$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/api/health-verifier/report
200 application/json; charset=utf-8

$ curl -s -X POST -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/api/health-verifier/verify
200 application/json; charset=utf-8

$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/
200 text/html; charset=UTF-8

$ curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/ukb-history
200 text/html; charset=UTF-8

$ bash scripts/__tests__/health-coordinator/two-session-agreement.test.sh
PASS: two-session agreement — A=stopped, B=running, project=healthy
exit 0

$ bash scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh
=== AC #9 / G2 — dashboard endpoints reverse-proxy ===
  GET /api/health-verifier/status -> 200 application/json; charset=utf-8
  PASS: content-type is application/json
  PASS: JSON body parses and has data/status key
  GET /                              -> 200 text/html; charset=UTF-8
  PASS: SPA root still serves index.html
  GET /ukb-history                    -> 200 text/html; charset=UTF-8
  PASS: React Router fallback still works
=== AC #9 / G2 — ALL ASSERTIONS PASS ===
```

## Task Commits

1. **Task 1 (RED): Add dashboard-endpoints test for G2** — `8d998a3ec` (`test(33-10): ...`) — captured the bug as a failing regression test before the fix.
2. **Task 1 (GREEN): Mount /api/* reverse-proxy + bind-mount** — `01069517a` (`feat(33-10): ...`) — applied the static-server.js fix + added the docker-compose bind-mount.
3. **Task 2 (verification only):** No source changes — verified AC#5 + AC#9 closure via curl + dashboard-endpoints.test.sh + two-session-agreement.test.sh. No commit needed.

_TDD: RED commit (test failing) → GREEN commit (test passing). REFACTOR skipped — code is already minimal._

## Files Created/Modified

- `scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh` — 73-line bash test, 4 assertions: status content-type, JSON shape, SPA root, React Router. Used as RED gate, will protect against G2 regression in future runs.
- `integrations/system-health-dashboard/static-server.js` — full rewrite (84 lines vs 21 before). Reverse-proxy at app.use('/api') BEFORE static + `*`. Uses `node:http` request piping (no new dependency, streams bodies). Per SPEC R6: 503 + `{status:'unknown'}` on upstream failure. `process.stdout.write` instead of `console.log` per project no-console-log constraint.
- `docker/docker-compose.yml` — added `${CODING_REPO:-.}/integrations/system-health-dashboard/static-server.js:/coding/integrations/system-health-dashboard/static-server.js:ro` bind-mount alongside the existing server.js mount on line 98.

## Restart Command (informational, for ops)

The static-server is launched inside the `coding-services` container by supervisord under the program name `web-services:health-dashboard-frontend`. After editing the host file (or pulling new code via `git pull`), re-deploy with:

```bash
# If running container was started before this plan added the bind-mount:
#   docker-compose up -d --force-recreate coding-services   # picks up the new mount
# Otherwise (bind-mount already active from this plan onward):
docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend
sleep 3
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3032/api/health-verifier/status
# Expect: 200 application/json
```

For the verification run during this plan, `docker cp` was used to push the new file directly into the live container (since the bind-mount in this commit only takes effect on the NEXT container recreate from this compose file), then `supervisorctl restart web-services:health-dashboard-frontend` swapped the process. The cp is a one-time bridge; future deploys use the bind-mount.

## Decisions Made

See `key-decisions` in frontmatter:

1. Mount reverse-proxy at `app.use('/api', ...)` BEFORE static + `*` (Express order is critical).
2. Forward to api-server :3033 (which has SPEC R8 reshape), not direct to coordinator :3034.
3. Use `node:http` + `req.pipe(upstream)` instead of `fetch()` (preserves streaming for POST bodies).
4. Add docker-compose bind-mount for static-server.js (the deployment-friction fix).
5. Replace `console.log` with `process.stdout.write` (no-console-log constraint).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] static-server.js was NOT bind-mounted; added bind-mount in docker-compose.yml**

- **Found during:** Task 1, deployment-verification step.
- **Issue:** The plan stated the integration is "BIND-MOUNTED per CLAUDE.md ('integrations/system-health-dashboard — bind-mounted, just `npm run build`')". Inspection showed only `dist/` (line 96) and `server.js` (line 98) were bind-mounted; `static-server.js` was baked into the Docker image. Confirmed with a mutation probe: `echo "// probe" >> static-server.js` on host did NOT appear in `docker exec coding-services head static-server.js`. So a host-side fix would have been silently ignored without a Docker image rebuild — a recurring deployment-friction gap.
- **Fix:** Added `${CODING_REPO:-.}/integrations/system-health-dashboard/static-server.js:/coding/integrations/system-health-dashboard/static-server.js:ro` to docker-compose.yml, mirroring the existing `server.js` mount on line 98. For the verification run during this plan, used `docker cp` to push the new file into the live container (one-time bridge), then `supervisorctl restart web-services:health-dashboard-frontend`. From this commit onward the bind-mount makes future edits live.
- **Files modified:** docker/docker-compose.yml (1 line added — bind-mount + comment).
- **Verification:** After `docker cp` + supervisorctl restart, /api/health-verifier/status now returns application/json. Future container recreate will pick up the bind-mount automatically.
- **Committed in:** `01069517a` (rolled into the GREEN commit alongside the static-server.js fix — single-task atomic commit per plan).

**2. [Rule 1 — Bug fix] Replaced `console.log` with `process.stdout.write` (no-console-log constraint)**

- **Found during:** Task 1, GREEN commit attempt.
- **Issue:** The plan's drop-in replacement code used `console.log(...)` (mirroring the original 21-line file). Project's mcp-constraint-monitor pre-tool hook fired `no-console-log` and blocked the Write. Per the project's "Constraint Violations = Real Issues — NEVER work around" memory rule, fixed inline rather than overriding.
- **Fix:** Replaced both `console.log(...)` calls in the listen callback with `process.stdout.write(...)`. Same observable behavior (both write to stdout); satisfies the constraint.
- **Files modified:** integrations/system-health-dashboard/static-server.js (2 lines).
- **Verification:** Write hook accepted; supervisorctl restart succeeded; startup log lines visible in container stdout per `docker logs coding-services | grep "Health dashboard frontend"`.
- **Committed in:** `01069517a` (rolled into the GREEN commit).

---

**Total deviations:** 2 auto-fixed (1 Rule 3 — blocking deployment-friction, 1 Rule 1 — constraint-driven bug fix).
**Impact on plan:** Both deviations were necessary to (a) make the fix actually take effect in the running container and (b) pass project constraint checks. Both rolled into the single GREEN commit per the plan's Task 1 atomic-commit contract; no scope creep beyond the planned files (the docker-compose addition is a single line and directly enables the planned fix to deploy).

## Issues Encountered

- **supervisorctl program name** initially attempted as `health-dashboard-frontend` (per the supervisord config `[program:...]` directive on line 213), which returned `ERROR (no such process)`. Resolved by querying `supervisorctl status`, which showed the program is grouped under `web-services` — actual full name is `web-services:health-dashboard-frontend`. Documented in the restart-command section.
- **Constraint monitor false-positive concern surfaced + dismissed.** The hook also reads constraint violations from a real running mcp-constraint-monitor on :3030; the dashboard's `overallStatus=degraded, violationCount=8` reading is the constraint-monitor's normal output, NOT a regression caused by this plan. Verified: same pattern observed in 33-08-SUMMARY's pre-fix curl evidence (api-server :3033 returned `degraded` even when /3032/api was broken).

## Threat Flags

None new. The threat model entries T-33-10-01..T-33-10-04 from the plan all hold:

- **T-33-10-02** (mitigate, tampering): used `req.pipe(upstream)` — no buffer + reserialize.
- **T-33-10-04** (mitigate, repudiation): upstream-error path writes to stderr with host:port + err.code.

No new attack surface. The proxy is localhost-only (forwards to 127.0.0.1:3033) and inherits the api-server's existing CORS + body-size limits.

## User Setup Required

None. The fix takes effect after either:

- **Live (this run):** Done via `docker cp` + `supervisorctl restart web-services:health-dashboard-frontend`. /api/health-verifier/* is already returning application/json.
- **Future deploys:** Run `docker-compose up -d --force-recreate coding-services` (after `cd /Users/Q284340/Agentic/coding/docker`) to pick up the new bind-mount; subsequent edits to `static-server.js` only need `supervisorctl restart web-services:health-dashboard-frontend`.

## Next Phase Readiness

- **G2: closed.** AC #5 + AC #9 both PASS.
- **Remaining gaps** (separate plans, NOT this plan's scope per the gap-closure boundary stated in 33-10-PLAN's `<objective>`):
  - **G1** — coordinator's check registry has no port-liveness probes for services that don't POST signals; breaks AC #6 (detection-latency). Plan 33-09 owns.
  - **G4** — schema name drift (`.container.status` vs SPEC's `.container.healthcheck`); breaks AC #4 + AC #12. Plan 33-11 (or wherever the gap-closure planner routed it) owns.
  - **G7** — plist `EnvironmentVariables` doesn't propagate `HEALTH_COORDINATOR_INJECT_THROW`; breaks AC #13.
  - **G8** — eviction.test.sh sleeps 17s but transition is 5s+15s = ~20s; timing-fragile.
- **Re-run** `bash scripts/__tests__/health-coordinator/run-all.sh` after G1, G4, G7, G8 land; expect 13/13 PASS at that point.
- **Verifier next step:** /gsd-verify-fixes 33 — re-runs the SPEC suite; expects AC#5 + AC#9 PASS this round (was FAIL pre-G2-fix).

## Self-Check: PASSED

| Artifact | Status |
|----------|--------|
| `.planning/phases/33-health-monitoring-consolidation/33-10-SUMMARY.md` (this file) | FOUND |
| `scripts/__tests__/health-coordinator/dashboard-endpoints.test.sh` | FOUND (created, 73 lines, executable) |
| `integrations/system-health-dashboard/static-server.js` | MODIFIED (84 lines, route order verified: /api at line 39, static at line 77, * at line 80) |
| `docker/docker-compose.yml` | MODIFIED (bind-mount line added below the existing server.js mount) |
| `node --check static-server.js` exits 0 | FOUND |
| `grep -c "app.use('/api'"` returns 1 | FOUND (=1) |
| RED commit `8d998a3ec` exists | FOUND |
| GREEN commit `01069517a` exists | FOUND |
| `curl /api/health-verifier/status` returns 200 application/json | FOUND |
| `curl /` returns 200 text/html (SPA preserved) | FOUND |
| `curl /ukb-history` returns 200 text/html (React Router preserved) | FOUND |
| `two-session-agreement.test.sh` exits 0 (AC#5 dashboard step) | FOUND |
| `dashboard-endpoints.test.sh` exits 0 (AC#9 + four assertions) | FOUND |
| No deletions in either commit (`git diff --diff-filter=D HEAD~2 HEAD` empty) | FOUND |
| Branch is `worktree-agent-a1fe43083eb921224` (not main/master/develop) | FOUND |
| STATE.md NOT modified by this executor | VERIFIED — `git status` shows clean for STATE.md |
| ROADMAP.md NOT modified by this executor | VERIFIED — `git status` shows clean for ROADMAP.md |

State management note: STATE.md and ROADMAP.md NOT modified by this executor (per parallel-executor instructions — orchestrator-owned writes happen after worktree merge).

---

*Phase: 33-health-monitoring-consolidation*
*Plan: 10 (gap closure for G2)*
*Completed: 2026-05-07*
*Worktree: agent-a1fe43083eb921224 (parallel executor)*
