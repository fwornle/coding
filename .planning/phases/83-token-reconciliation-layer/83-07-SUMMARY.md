---
phase: 83-token-reconciliation-layer
plan: 07
subsystem: testing
tags: [token-reconciliation, wire-measurement, golden-comparison, experiment-runner, proxy-fallback, acceptance-gate]

# Dependency graph
requires:
  - phase: 83-02
    provides: proxy task-id hardening, OpenAI cache parse, dup-id constraint
  - phase: 83-03
    provides: cross-user_hash request-id matcher with fuzzy fallback + tolerance flagging
  - phase: 83-04
    provides: reconcile mode in captureForegroundTokens with provenance-tagged fallback
  - phase: 83-05
    provides: reconciliation.json sink + GET read API on the vkb-server
  - phase: 83-06
    provides: copilot BYOK capability gating
provides:
  - "Golden-comparison experiment spec (config/experiments/wire-verify-83-reconcile.yaml) exercising healthy-routed + proxy-down claude cells"
  - "Human-verified acceptance run confirming the three golden-comparison properties (no double-count/loss, proxy-down full fallback, healthy unmatched_wire=0)"
  - "Phase-83 acceptance gate PASSED — the full reconciliation stack proven end-to-end on a live run"
affects: [84-per-turn-context-revelation, 85-experiment-control-center, wire-measurement, token-reconciliation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Golden-comparison acceptance: reconciled routed totals vs pre-change transcript-only baseline (numeric no-double-count/no-loss check)"
    - "Two-cell live reproducer (healthy-routed + operator-induced proxy-down) modeled on wire-verify-82-06-v2"

key-files:
  created:
    - config/experiments/wire-verify-83-reconcile.yaml
  modified: []

key-decisions:
  - "The reconciliation GET route lives on the vkb-server (:8080), NOT obs-api (:12436) — spec comment corrected (F3)"
  - "Proxy-down cell full-transcript fallback lands as a provenance-tagged token-adapter-claude-fallback row; fuzzy matches against task-less interactive wire rows are tolerance-FLAGGED (loud), never silently mis-attributed"

patterns-established:
  - "Acceptance dossier style: verbatim reconciliation.json summaries + token_usage row SUMs quoted per cell, each property mapped to concrete evidence"
  - "Proxy-down live cell requires ANTHROPIC_BASE_URL stripped AND the proxy launchctl-booted-out for the full window (inherited proxy-routed parent env otherwise refuses the direct path)"

requirements-completed: [D-01, D-02, D-04, D-05, D-12]

# Metrics
duration: 28min
completed: 2026-07-06
---

# Phase 83 Plan 07: Golden-Comparison Acceptance Gate Summary

**Live human-verified golden comparison proves the full reconciliation stack: routed-claude reconciled totals equal the pre-change transcript-only baseline (no double-count, no loss), a proxy-down cell falls back to full transcript capture with fallback provenance, and a healthy span shows unmatched_wire=0 — the Phase-83 acceptance gate is PASSED.**

## Performance

- **Duration:** ~28 min (spec authoring + operator-driven live run + recording)
- **Started:** 2026-07-06T08:06:58Z (Task 1 spec commit)
- **Completed:** 2026-07-06T08:34:50Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint, both complete)
- **Files modified:** 1 (spec) + acceptance artifacts recorded

## Accomplishments

- Authored `config/experiments/wire-verify-83-reconcile.yaml` — a fresh-`experiment_id` two-cell golden-comparison spec (healthy-routed claude + operator-induced proxy-down claude) modeled on `wire-verify-82-06-v2`.
- Ran the live acceptance (operator-driven, UNATTENDED) and confirmed all three golden-comparison properties plus the D-08 ambient-leak property under live concurrency.
- Confirmed the reconciliation.json sink is readable verbatim via the Phase-05 GET route (on the vkb-server :8080).
- Recorded three advisory findings (F1–F3) for follow-up without expanding this plan's scope; applied the F3 single-line comment correction.

## Task Commits

1. **Task 1: Author golden-comparison experiment spec** — `6c0a97754` (feat)
2. **Task 2: Live golden-comparison acceptance run** — human-verify checkpoint, approved by operator (no code commit; artifacts on disk)
3. **F3 advisory correction (read-API port comment → :8080 vkb-server)** — `0d3ba54f4` (fix)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created/Modified

- `config/experiments/wire-verify-83-reconcile.yaml` — golden-comparison spec; two claude cells (healthy-routed + proxy-down), header documents the three properties, the UNATTENDED run instruction, the operator proxy stop/start step, and the 47946–72264 calibration reference. F3 comment fix: read-API port corrected to :8080.

## Acceptance Evidence Dossier

Verbatim-quality evidence from the approved live run (2026-07-06).

### Cell A — healthy routed: `wire-verify-83-reconcile--claude-sonnet-straight-default--r0`

- Span 2026-07-06T08:15:31.273Z → 08:16:26.400Z; goal achieved ("Both files created and all 4 tests pass"); `terminal_state=complete`.
- `reconciliation.json` summary (verified on disk): `matched=5, unmatched_wire=0, unmatched_transcript=0, fallback=0, aggregateDeltas={}, flaggedCount=0`; perRequest 6 entries, `method=request-id`, zero deltas, none flagged.
- `token_usage` rows (task_id = Cell A): 4 rows, `process=token-adapter-claude`, SUM input=5, output=677, cache_read=61902.
- **PROPERTY 1 ✅ (no double-count / no loss):** vs pre-change transcript-only baseline `wire-verify-82-06-v2--claude-sonnet-straight-default--r0` (4 rows, input=5, output=679) — equal within run-to-run variance; no doubling, no near-zero loss. Matched-pair cache_read 61902 within the calibrated band 47946–72264.
- **PROPERTY 3 ✅ (healthy span unmatched_wire=0):** `unmatched_wire === 0`; per-request entries carry method + per-field deltas + flags.
- **GET route:** after restarting `web-services:vkb-server` in the coding-services container (the route was committed in Plan 05 but the live process predated it), `GET http://localhost:8080/api/experiments/runs/<taskId>/reconciliation` serves the file verbatim; a nonexistent id returns `200 {"reconciliation":null}`. NOTE: the documented port 12436 is obs-api, NOT the vkb-server — correct live port is 8080 (F3, comment now fixed).

### Cell B — proxy-down: `wire-verify-83-reconcile--claude-sonnet-straight-proxy-down--r0`

- **Attempt 1** (08:19:27 → 08:22:41) aborted: agent died with "API Error: Unable to connect to API (ConnectionRefused)" — a combination of (a) an inherited stale `ANTHROPIC_BASE_URL` from the orchestrator's proxy-routed session env (the runner's fail-soft warns but does not unset it — see F1) and (b) weak hotel wifi on the direct path (operator confirmed the network issue, resolved via hotspot). The capture layer behaved correctly even here: the single attempted call landed as a provenance-tagged fallback row (loud, not silent).
- **Attempt 2** (08:27:42 → 08:29:04), run with `ANTHROPIC_BASE_URL` stripped and the proxy launchctl-booted-out for the full window then restored (health 200 verified): `terminal_state=complete`, goal achieved (fizzbuzz.mjs + test in sandbox).
- `reconciliation.json` summary (verified on disk): `matched=4, unmatched_wire=0, unmatched_transcript=1, fallback=1, flaggedCount=3`.
- **PROPERTY 2 ✅ (proxy-down → full transcript fallback):** the cell's full token payload was captured via transcript fallback — `token_usage` row `process=token-adapter-claude-fallback`, input=3, output=273, cache_read=15934; `summary.fallback=1`; the `:reason:0` row inserted with normal provenance (`token-adapter-claude`) per D-01. The 3 fuzzy matches (against nearby task-less interactive wire rows, same model, in the bounded window) were all tolerance-FLAGGED — loud, visible, no silent mis-attribution; enrich is fill-gaps-only so no wire counts were overwritten.

### Property 6 — D-08 no-inherit (both span windows) ✅

- All concurrent daemon/interactive rows during the span windows (health-coordinator, consolidator-insight, interactive token-adapter-claude rows) carried EMPTY task_id; only genuine cell traffic carries the cell task_ids. The Plan-01 D-08 ambient-leak fix holds under live concurrency.

## Decisions Made

- The reconciliation GET route is served by the vkb-server on :8080; :12436 is obs-api and does NOT serve this route (corrected in the spec comment).
- Proxy-down live cells must have `ANTHROPIC_BASE_URL` stripped and the proxy booted out for the whole window — an inherited proxy-routed parent env otherwise pushes the "direct" call at the dead proxy.

## Deviations from Plan

None — plan executed as written. One documented single-line comment correction (F3) applied as `fix(83-07)` per the plan's explicit allowance.

## Advisory Findings (record-only — NOT fixed in this plan)

- **F1:** `lib/experiments/experiment-runner.mjs` `configureProxyRoutingEnv` fail-soft branch leaves an inherited `ANTHROPIC_BASE_URL` in `baseEnv` when the proxy is unhealthy (WR-05-class; latent — only bites when the runner is invoked from a proxy-routed parent environment). Suggested follow-up: explicitly delete `ANTHROPIC_BASE_URL` / `ANTHROPIC_CUSTOM_HEADERS` on the unhealthy branch.
- **F2:** with zero wire rows in a proxy-down span, non-primary transcript rows can fuzzy-match task-less wire rows from adjacent interactive traffic (correctly flagged). Possible refinement: skip fuzzy when the span window contains zero wire rows.
- **F3:** the spec comment and plan verify steps named port 12436 for the reconciliation GET; the route actually lives on the vkb-server (:8080). Applied as a single-line comment correction to `config/experiments/wire-verify-83-reconcile.yaml` (commit `0d3ba54f4`).

## Issues Encountered

- Cell B attempt 1 aborted (ConnectionRefused) from the F1 inherited-BASE_URL interaction with the direct path and weak hotel wifi. Resolved by stripping `ANTHROPIC_BASE_URL`, booting the proxy out for the full window, and switching to a hotspot; attempt 2 completed clean.
- The live vkb-server process predated Plan 05 and had to be restarted (`web-services:vkb-server`) before the GET route served the new reconciliation files — operational, not a code defect.

## User Setup Required

None.

## Next Phase Readiness

- Phase 83 acceptance gate PASSED — the full reconciliation stack (Plans 01–06) is proven end-to-end. Phases 84 (per-turn context revelation) and 85 (experiment control center) build on this verified substrate.
- Three non-blocking follow-ups (F1/F2 refinements) recorded above for future triage.

## Self-Check: PASSED

- `config/experiments/wire-verify-83-reconcile.yaml` — FOUND
- `.data/measurements/wire-verify-83-reconcile--claude-sonnet-straight-default--r0/reconciliation.json` — FOUND (matched=5, unmatched_wire=0, fallback=0, flaggedCount=0)
- `.data/measurements/wire-verify-83-reconcile--claude-sonnet-straight-proxy-down--r0/reconciliation.json` — FOUND (matched=4, unmatched_transcript=1, fallback=1, flaggedCount=3)
- Task 1 commit `6c0a97754` — FOUND
- F3 fix commit `0d3ba54f4` — FOUND

---
*Phase: 83-token-reconciliation-layer*
*Completed: 2026-07-06*
