---
phase: 84-per-turn-context-revelation
plan: 06
subsystem: proxy-instrumentation
tags: [raw-bodies, redaction, secrets, flag-gated, fail-closed, node-test, wave-2, cross-repo]

# Dependency graph
requires:
  - "84-02 — scripts/enhanced-redaction-system.cjs exported loadRedactionPatterns(configPath) (shared 27-pattern loader)"
  - "84-04 — proxy contextTurnsDir(taskId) + both logContextTurn write sites (/v1/messages, /api/complete)"
provides:
  - "proxy-bridge/raw-bodies.mjs — pure sibling: loadRawBodyRedactionPatterns / makeRedactRawBody (fail-closed) / rawBodyCaptureEnabled (default-OFF gate) / appendRawBody (never-throw, awaitable)"
  - "server.mjs redactRawBody (compiled once at startup from the shared config) + flag-gated redacted raw-body append at BOTH write sites → raw-bodies.jsonl sibling"
affects: [84-03, 84-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cross-repo shared-loader reuse: the proxy sibling requires the coding repo's enhanced-redaction-system.cjs via createRequire(import.meta.url), falling back to a byte-identical inline twin against the SAME config JSON (one source of truth, never a second regex set)"
    - "Pure side-effect-free sibling module so the coding-repo unit test imports the REAL redaction+append path without booting the proxy HTTP server (mirror of Plan 04's context-turns.mjs)"

key-files:
  created:
    - ../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs
    - tests/redaction/proxy-raw-body.test.mjs
  modified:
    - ../_work/rapid-llm-proxy/proxy-bridge/server.mjs

key-decisions:
  - "Extracted the redaction + append + gate helpers into a NEW pure sibling proxy-bridge/raw-bodies.mjs (Rule 3): server.mjs boots an HTTP server on import and cannot be imported by a unit test — the identical constraint Plan 04 solved with context-turns.mjs. The plan's Task 2 explicitly anticipates 'the extracted redactRawBody + append helper', so the test drives the REAL production path cross-repo."
  - "The proxy prefers Plan 02's shared loadRedactionPatterns from enhanced-redaction-system.cjs (cross-repo createRequire); on any require failure it falls back to a byte-identical inline loader against the SAME config file — one source of truth, no divergent second pattern set (T-84-06-04)."
  - "appendRawBody returns an awaitable Promise that RESOLVES (never rejects) to a boolean — server.mjs calls it fire-and-forget (ignores the result, never blocks); the unit test awaits it for deterministic file assertions."
  - "rawBodyCaptureEnabled(span) is a strict === true gate (default OFF): missing span / missing meta / falsy / truthy-but-not-true all → false, so a non-consenting span never persists raw bodies (T-84-06-02)."
  - "Anthropic-wire raw response is accumulated from the SAME single decoder.decode(chunk) that already feeds the SSE usage tap (no second decode → no multi-byte-boundary corruption); accumulation only happens when captureRaw is on."

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-07-08
---

# Phase 84 Plan 06: Flag-Gated Redacted Raw-Body Capture Summary

**The proxy now captures FULL raw request/response bodies for a measured span — but only when the per-span flag `span.meta.capture_raw_bodies` is `true` (default OFF), with every body redacted via the shared 27-pattern configured set BEFORE write (fail-closed to `[REDACTION_ERROR_CONTENT_BLOCKED]` on any redaction error, never crashing the daemon), appended to a SEPARATE `raw-bodies.jsonl` sibling so retention can drop raw bodies independently of the always-on context-turns digest.**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-07-08
- **Tasks:** 2
- **Files created:** 2 (1 proxy sibling module, 1 coding test); **modified:** 1 (proxy server.mjs)

## Accomplishments
- **Task 1 — proxy-side redaction applier.** New pure sibling `proxy-bridge/raw-bodies.mjs`:
  `loadRawBodyRedactionPatterns(codingRoot[, configPath])` compiles the 27-pattern set from `<CODING_ROOT>/.specstory/config/redaction-patterns.json`, preferring Plan 02's shared `loadRedactionPatterns` (cross-repo `createRequire` of `enhanced-redaction-system.cjs`) and falling back to a byte-identical inline twin — never a second regex set; `makeRedactRawBody(patterns)` returns a fail-closed `redactRawBody(str)` (any error → `[REDACTION_ERROR_CONTENT_BLOCKED]`, never throws). server.mjs compiles the set ONCE at startup (reusing the CODING_ROOT it already resolves for CTX_BREAKDOWN_DIR).
- **Task 2 — flag-gated redacted append at both write sites + test.** At `/v1/messages` (Anthropic) and `/api/complete` (OpenAI), a `rawBodyCaptureEnabled(getActiveMeasurement()|span)` gate (default OFF) decides whether to build a `{ ts, task_id, request_id, wire, request, response }` line with BOTH bodies redacted before write, appended to the `raw-bodies.jsonl` sibling via the never-throw `appendRawBody`. Anthropic-wire raw response is accumulated from the existing SSE decoder (or the buffered non-streaming body) only when the flag is on. The new `tests/redaction/proxy-raw-body.test.mjs` (6 tests, 0 skipped) drives the real production module cross-repo.

## Task Commits
1. **Task 1: proxy-side raw-body redaction applier (shared loader)** — `a1d0912` (proxy repo, feat)
2. **Task 2: flag-gated redacted raw-body append at both write sites** — `b1e0a49` (proxy repo, feat)
3. **Task 2: raw-body redaction + flag-gate + fail-closed test** — `5f214fd3b` (coding repo, test)

## Files Created/Modified
- `../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs` (**NEW, proxy repo**) — pure redaction + gate + append helpers; no side effects on import.
- `../_work/rapid-llm-proxy/proxy-bridge/server.mjs` (**MODIFIED, proxy repo**) — import from `./raw-bodies.mjs`; startup config compile + `redactRawBody`; `captureRaw` flag + raw-response accumulation + flag-gated redacted append at call-site A (Anthropic) and B (OpenAI).
- `tests/redaction/proxy-raw-body.test.mjs` (**NEW, coding repo**) — 6 assertions against the real sibling module.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extracted the redaction/append/gate helpers into a NEW pure sibling module `proxy-bridge/raw-bodies.mjs`**
- **Found during:** Task 1 / Task 2 (deciding how the coding-repo unit test reaches `redactRawBody`)
- **Issue:** `server.mjs` boots an HTTP server on import, so a `node --test` unit file cannot import it to exercise `redactRawBody`/`appendRawBody`. This is the identical constraint Plan 04 resolved by extracting `context-turns.mjs`.
- **Fix:** Created the side-effect-free sibling `proxy-bridge/raw-bodies.mjs` exporting `loadRawBodyRedactionPatterns` / `makeRedactRawBody` / `rawBodyCaptureEnabled` / `appendRawBody`; server.mjs imports and uses them; the test imports the SAME module cross-repo. The plan's Task 2 explicitly references "the extracted redactRawBody + append helper", so extraction was anticipated. `files_modified` listed only server.mjs + the test — the sibling is an additive new file.
- **Files modified:** `../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs` (new)
- **Commit:** `a1d0912`

**2. [Rule 3 - Blocking] The `raw-bodies.jsonl` filename literal lives in the sibling's `appendRawBody`; server.mjs references it in the two write-site comments**
- **Found during:** Task 2 (satisfying the `grep -c 'raw-bodies.jsonl' server.mjs` gate)
- **Issue:** The actual `path.join(dir, 'raw-bodies.jsonl')` write now lives in the extracted sibling, so the string does not appear in server.mjs code. The grep gate (`>=1`) is satisfied by the two honest write-site comments documenting the sibling target; the behavior (writing to `raw-bodies.jsonl`) is real and test-proven.
- **Fix:** No functional change — noted for transparency. The literal `raw-bodies.jsonl` appears twice in server.mjs (both site comments) and once in `appendRawBody` (the actual write).
- **Commit:** `b1e0a49`

**Total deviations:** 2 auto-fixed (both the module-extraction consequence of a non-importable server.mjs). No scope change to the security contract.

## Threat Surface
- **T-84-06-01 (Info disclosure — secret leakage into raw-bodies.jsonl)** mitigated: both request AND response are redacted via the shared 27-pattern set BEFORE the line object is built; the test asserts no `sk-ant`/Bearer-token/JWT substrings survive in the persisted line.
- **T-84-06-02 (Info disclosure — non-consenting span)** mitigated: `rawBodyCaptureEnabled` is a strict `=== true` default-OFF gate; the test proves flag-OFF writes no `raw-bodies.jsonl`; raw bodies go to a SEPARATE sibling for independent retention (Plan 03 sweeper).
- **T-84-06-03 (DoS — redaction error crashing the tap)** mitigated: `redactRawBody` is fail-closed (`[REDACTION_ERROR_CONTENT_BLOCKED]`, never throws); both appends sit in best-effort try/catch → `logErr`; `appendRawBody` never rejects.
- **T-84-06-04 (Tampering — second divergent regex set)** mitigated: single source of truth is the config JSON compiled by the shared loader; the inline fallback is byte-identical against the SAME file.
- **T-84-06-SC (npm installs)** N/A: no packages installed; both files are runtime JS (no build).

## Verification
- `node --check ../_work/rapid-llm-proxy/proxy-bridge/raw-bodies.mjs` — clean.
- `node --check ../_work/rapid-llm-proxy/proxy-bridge/server.mjs` — clean.
- `node --test tests/redaction/proxy-raw-body.test.mjs` → **6 pass / 0 fail / 0 skipped**.
- Full globs: `tests/redaction/*.test.mjs` → 10 pass / 0 fail; `tests/context-turns/*.test.mjs` → 13 pass / 0 fail (no regression).
- Grep gates (server.mjs): `redaction-patterns.json`=2, `redactRawBody|loadRedactionPatterns`=2, `capture_raw_bodies`=2, `raw-bodies.jsonl`=2.
- Runtime spot-check: 27 patterns loaded via the shared loader; `sk-ant-...` masked; a throwing input returns `[REDACTION_ERROR_CONTENT_BLOCKED]`.

## Cross-Repo / Runtime Note (IMPORTANT)
- `server.mjs` + `raw-bodies.mjs` are the runtime proxy files in the SEPARATE `_work/rapid-llm-proxy` git repo (NOT tracked by this coding repo). Plain runtime JS — **NO `npm run build`**. Proxy commits `a1d0912` + `b1e0a49` are in that repo; the coding repo's atomic commit `5f214fd3b` covers only the test.
- **NOT redeployed here** by design: live redeploy (`launchctl kickstart` after confirming coordinator :3034 `location=open`) + the golden E2E run are **Plan 84-09's** job.

## Next Phase Readiness
- 84-03 (retention sweeper) drops `raw-bodies.jsonl(.gz)` on the same age window as `context-turns.jsonl`.
- 84-09 (live E2E) sets `span.meta.capture_raw_bodies=true` on a measured cell and verifies the redacted sibling file end-to-end after redeploy.

---
*Phase: 84-per-turn-context-revelation*
*Completed: 2026-07-08*

## Self-Check: PASSED
- All created/modified files verified present (`raw-bodies.mjs`, `proxy-raw-body.test.mjs`, this SUMMARY).
- Proxy commits `a1d0912` + `b1e0a49` verified in the `_work/rapid-llm-proxy` repo; coding test commit `5f214fd3b` verified in the coding repo.
