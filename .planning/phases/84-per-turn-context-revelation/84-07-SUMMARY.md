---
phase: 84-per-turn-context-revelation
plan: 07
subsystem: read-surfaces
tags: [context-turns, vkb-server, dashboard-proxy, gunzip, graceful-empty, traversal-guard, read-api, wave-2]

# Dependency graph
requires:
  - "84-04 — proxy appends plaintext context-turns.jsonl per measured request (+ GET /api/context-turns proxy route)"
  - "84-05 — span close gzips context-turns.jsonl -> .gz and enriches observation_ref"
provides:
  - "handleContextTurns(req,res) in lib/vkb-server/api-routes.js — GET /api/experiments/runs/:taskId/context-turns; gunzip .gz (plaintext fallback), 200 graceful-empty on miss, _validTaskId traversal guard"
  - "route registration parallel to handleReconciliation"
  - "dashboard backend /api/context-turns same-origin proxy mirror to the LLM proxy :12435"
  - "tests/vkb/context-turns-route.test.mjs — the last Wave-0 skipped stub, now un-skipped (8 tests)"
affects: [84-08, 84-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vkb read pass-through cloned VERBATIM from handleReconciliation (D-13 pattern): validate -> path.join under .data/measurements -> read file -> serve verbatim -> ENOENT graceful-empty -> 500 only on unexpected error"
    - "dashboard same-origin proxy mirror cloned from /api/context-breakdown (forward query, mirror status, 502 on unreachable)"

key-files:
  created: []
  modified:
    - lib/vkb-server/api-routes.js
    - integrations/system-health-dashboard/server.js
    - tests/vkb/context-turns-route.test.mjs

key-decisions:
  - "handleContextTurns prefers the span-close .gz (zlib.gunzip -> split -> JSON.parse each line) and falls back to the plaintext .jsonl only when the .gz is ENOENT (span still open); when BOTH are ENOENT it returns 200 {contextTurns:[]} (graceful, NOT 500, D-10). 500 is reserved for an unexpected read/decompress failure — mirroring handleReconciliation exactly."
  - "Traversal safety reuses the existing _validTaskId guard ([A-Za-z0-9._-], <=80, rejects '.'/'..') BEFORE the path build, so the read can never escape .data/measurements/ (T-84-07-01) — no new guard invented."
  - "zlib.gunzip is promisified (promisify(zlib.gunzip)) and fed the RAW buffer (fs.readFile with no encoding) so gunzip gets bytes, not a decoded string."
  - "The dashboard's vkb context-turns route rides the EXISTING /api/experiments/* reverse-proxy (server.js:330) — no new experiment-proxy line needed. Only the /api/context-turns -> :12435 mirror (paralleling /api/context-breakdown) was added."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-07-08
---

# Phase 84 Plan 07: Context-Turns Read Surfaces (vkb pass-through + dashboard proxy mirror) Summary

**The per-span context-turns file is now readable through the read surfaces (D-10): a thin vkb-server pass-through (`handleContextTurns`) cloned verbatim from `handleReconciliation` — gunzip the span-close `.gz` (plaintext `.jsonl` fallback while the span is open), 200 graceful-empty `{contextTurns:[]}` on miss (never 500), traversal-guarded by the existing `_validTaskId` — plus the dashboard backend `/api/context-turns` same-origin proxy mirror to the LLM proxy :12435, giving the Plan 84-08 cache explainer a data source. The file is served VERBATIM (no re-shaping).**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-08
- **Tasks:** 2
- **Files modified:** 3 (vkb api-routes + dashboard server.js + the vkb route test)

## Accomplishments

- **Task 1 — `handleContextTurns` in vkb-server.** Cloned `handleReconciliation`: validate `req.params.taskId` via `_validTaskId` (400 on invalid/traversal), resolve `.data/measurements/<taskId>/context-turns.jsonl.gz`, read the raw buffer, `zlib.gunzip` (promisified), split on newlines, `JSON.parse` each non-empty line, and `res.status(200).json({ contextTurns })`. When the `.gz` is ENOENT it falls back to the plaintext `context-turns.jsonl` (span not yet closed); when BOTH are ENOENT it returns `200 {contextTurns:[]}` (graceful, D-10), never 500. Registered `GET /api/experiments/runs/:taskId/context-turns` parallel to the reconciliation registration. Un-skipped the last Wave-0 stub `tests/vkb/context-turns-route.test.mjs` and filled it with 8 tests: gunzip round-trip, plaintext fallback, `.gz`-preferred-over-stale-plaintext, ENOENT→200 empty, and four traversal/invalid-taskId 400 cases.
- **Task 2 — dashboard backend proxy mirror.** Added the `/api/context-turns` same-origin passthrough cloned from `/api/context-breakdown` (forward the query string to `http://host.docker.internal:12435/api/context-turns`, mirror the upstream status, 502 on unreachable). Verified the vkb `/api/experiments/runs/:taskId/context-turns` route already rides the existing `/api/experiments/*` reverse-proxy (server.js:330 forwards all subpaths to vkb :8080) — no new experiment-proxy line needed.

## Task Commits

1. **Task 1: handleContextTurns + route + un-skipped vkb test** — `b89d3582d` (feat)
2. **Task 2: dashboard backend /api/context-turns proxy mirror** — `720775e27` (feat)

## Files Created/Modified

- `lib/vkb-server/api-routes.js` (**MODIFIED**) — `import zlib` + `promisify`; `const gunzip = promisify(zlib.gunzip)`; `handleContextTurns(req,res)`; route registration parallel to reconciliation.
- `integrations/system-health-dashboard/server.js` (**MODIFIED**) — `/api/context-turns` same-origin proxy mirror to :12435.
- `tests/vkb/context-turns-route.test.mjs` (**MODIFIED**) — un-skipped (was a Wave-0 stub), 8 tests.

## Deviations from Plan

**1. [Environment-directed] Task 2 acceptance criterion #3 (docker restart + live curl) intentionally deferred to Plan 84-09.**
- **Found during:** Task 2.
- **Issue:** The plan's Task-2 acceptance #3 asks for `docker-compose restart coding-services` then `curl http://localhost:3032/api/context-turns?task_id=nonexistent` → 200. The execution environment notes explicitly instruct NOT to restart/redeploy for this plan and to NOT claim the route is live in the container — live verification is Plan 84-09's job (matching how 84-04/84-05 deferred the proxy redeploy).
- **Fix:** Verified the code + the two static acceptance greps (`'/api/context-turns'` targeting `:12435`) and the unit test path; the container-restart + end-to-end curl are left for 84-09. The code is correct and the vkb graceful-empty path is unit-proven, but the container is NOT claimed live here.
- **Files modified:** none beyond the planned edit.
- **Commit:** `720775e27`.

## Threat Surface

- **T-84-07-01 (Tampering, :taskId path param)** mitigated: `_validTaskId` ([A-Za-z0-9._-], ≤80, rejects `.`/`..`) runs BEFORE the path build; traversal + slash + dot-only + empty ids all return 400 (four unit tests assert rejection). The read can never escape `.data/measurements/`.
- **T-84-07-02 (Info Disclosure, verbatim serve)** accepted per plan: the file is per-task context-turns digests (≤120-char previews); raw bodies are a separate gated file; read APIs are local same-origin.
- **T-84-07-03 (DoS, proxy/vkb unreachable)** mitigated: the dashboard mirror returns 502 on unreachable; the vkb route returns 200 graceful-empty on ENOENT, never 500 for a missing file.
- **T-84-07-SC** N/A: no package installs (pure Node stdlib — `node:zlib`, `node:util`).

## Verification

- `node --check lib/vkb-server/api-routes.js` — clean.
- `node --check integrations/system-health-dashboard/server.js` — clean.
- Grep gates: `handleContextTurns`=2 (definition + registration), `runs/:taskId/context-turns`=2, dashboard `'/api/context-turns'`=1 targeting `12435/api/context-turns`=1.
- `node --test tests/vkb/*.test.mjs` → **8 pass / 0 fail / 0 skipped** (the last Wave-0 vkb stub is now filled).

## Next Phase Readiness

- 84-08 (cache explainer UI) consumes `GET /api/context-turns?task_id=` through the dashboard mirror (proxy :12435) and/or `GET /api/experiments/runs/:taskId/context-turns` through the vkb reverse-proxy — both now wired, both graceful-empty on miss.
- 84-09 (live E2E / redeploy) exercises the full write→close→read path end to end and performs the deferred `docker-compose restart coding-services` + curl verification. **NOT redeployed here** by design.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08*

## Self-Check: PASSED
- All modified files verified present (`lib/vkb-server/api-routes.js`, `integrations/system-health-dashboard/server.js`, `tests/vkb/context-turns-route.test.mjs`, this SUMMARY).
- Commits `b89d3582d` (feat) and `720775e27` (feat) verified in git log.
