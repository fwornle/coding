---
phase: 82-wire-measurement-foundation
plan: 06
subsystem: infra
tags: [llm-proxy, token-usage, wire-measurement, cache-tokens, byok, copilot, opencode, cladpt, tool-passthrough]

# Dependency graph
requires:
  - phase: 82-01
    provides: proxy cache-token schema + logCall/getSummary/export-hydrate
  - phase: 82-02
    provides: /v1/messages tap cache parse + x-task-id/x-agent per-request binding
  - phase: 82-03
    provides: /v1/copilot dedicated path + shim tool-call passthrough + capability gating
  - phase: 82-04
    provides: insertTokenRowDeduped merge-on-cache upgrade
  - phase: 82-05
    provides: coding-repo routing (claude re-route + x-task-id header + copilot BYOK + flag-gated opencode)
provides:
  - Live acceptance evidence that the whole wired substrate holds end-to-end under a concurrent 2-cell + interactive run
  - ANTHROPIC_CUSTOM_HEADERS newline-separated `Name: value` format verified live to bind the tap
  - Fix for a residual /api/complete ambient-span leak on background daemons (background-process denylist; proxy d3f3869)
  - On-disk file proof of copilot BYOK + opencode tool-call passthrough (real agentic loops, not hallucinated success)
affects: [83-reconciliation, 84-per-turn-context, 85-experiment-control-center]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Background-process denylist at the /api/complete stamping site — explicit body.task_id always wins; known daemons never inherit the ambient span; unknown processes keep legacy span fallback"
    - "EARLY header-format verification (sentinel task_id) de-risks the whole binding path before a full concurrent run"
    - "Capability gating: tools-bearing requests are filtered to a function-calling provider (copilot), never the tools-off claude-code CLI — no silent no-op"

key-files:
  created:
    - .planning/phases/82-wire-measurement-foundation/82-06-SUMMARY.md
    - config/experiments/wire-verify-82-06.yaml
    - config/experiments/wire-verify-82-06-v2.yaml
  modified:
    - "_work/rapid-llm-proxy/proxy-bridge/server.mjs (stamping site now consults background-process guard)"
    - "_work/rapid-llm-proxy/src/background-process.ts (new isBackgroundProcess() denylist)"
    - "_work/rapid-llm-proxy/tests/integration/background-process-guard.test.mjs (new regression, 2/2)"

key-decisions:
  - "Residual /api/complete ambient-span leak (proxy-bridge/server.mjs:2656) fixed with a background-process denylist rather than removing the span fallback entirely — unknown processes still get best-effort attribution"
  - "Task-2 gate re-run under a fresh experiment_id (wire-verify-82-06-v2) after the leak fix, leaving v1/v9 resume state untouched"
  - "COPILOT_MODEL for the BYOK acceptance = claude-sonnet-4.6 (dotted names); haiku narrated instead of emitting tool_calls against copilot's large tool schema — model-choice behavior, not a proxy defect"

patterns-established:
  - "Live acceptance gate = concurrent measured cells + interactive daemon traffic sharing one window, PASS iff zero cross-contamination + cache fidelity"
  - "Behavioral tool-passthrough acceptance = a REAL file on disk with verified content/sha256, not a claimed success"

requirements-completed: [WIRE-08]

# Metrics
duration: multi-session (live acceptance gate, 3 human checkpoints)
completed: 2026-07-06
---

# Phase 82 Plan 06: Live Wire-Measurement Acceptance Gate Summary

**Live end-to-end proof that the wired proxy substrate binds every agent's tokens to its own task_id under concurrent load — including a mid-gate fix for a residual /api/complete ambient-span leak — with copilot BYOK and opencode each writing a real file on disk via native tool-call passthrough.**

## Performance

- **Duration:** multi-session (live acceptance gate across three human-verify checkpoints)
- **Completed:** 2026-07-06
- **Tasks:** 3 (all human-approved at their blocking gates)
- **Files modified/created:** 6 (SUMMARY + 2 experiment specs + 3 proxy-side files for the leak fix)

## Accomplishments

- **Task 1 — Deploy + EARLY header-format verification.** Proxy rebuilt (`npm run build`) and kickstarted; coordinator :3034 confirmed `location=open` BEFORE restart (avoided the corporate mis-detect flap); `/health` build `fa7763c` matched proxy HEAD at deploy time (advanced to `d3f3869` after the Task-2 fix). A sentinel claude call with `ANTHROPIC_CUSTOM_HEADERS="x-task-id: verify-82-06-1783271878"` produced **exactly one** `token_usage` row bound to the sentinel (id 164372, `cache_write_tokens=69412`) — proving the newline-separated `Name: value` env-var shape forwards to the tap. `/api/token-usage/recent` exposes `cache_read_tokens` + `cache_write_tokens`.
- **Task 2 — Concurrent 2-cell + interactive run, zero cross-contamination + cache fidelity (HUMAN-APPROVED).** After a mid-gate fix (see Deviations), the v2 re-run PASSED all criteria: zero daemon rows in cell task_ids; claude cell rows `164609-164611` are cladpt with `cache_read` 47946–72264, one row per `tool_call_id` (no shadow dupes); opencode cell rows stamped `agent=opencode` with non-cladpt user_hash. A controlled live-guard span (`wire-verify-82-06-repro`) confirmed health-coordinator/consolidator-insight stay unbound, the `claude` process binds via fallback, and an explicit `body.task_id` binds.
- **Task 3 — Tool-passthrough behavioral acceptance, real files on disk (HUMAN-APPROVED).** Copilot BYOK created `/tmp/byok-proof-1783274148.txt` (content OK, sha256 `565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3`) via a 2-turn agentic loop routed through `/v1/copilot`; opencode created `/tmp/opencode-proof-1783274148.txt` (content OK). Capability gating held — tools-bearing requests landed only on copilot, never the tools-off claude-code CLI.

## Task Commits

This is a live-verification plan; its per-task artifacts are the experiment specs + the proxy-side leak fix, committed under their own repos/commits during execution:

1. **Task 2 mid-gate leak fix** — proxy commit `d3f3869` (feat) + coding commit `cf45d95bb` (`test(82-06)`: experiment specs)
2. **Experiment specs** — `config/experiments/wire-verify-82-06.yaml`, `wire-verify-82-06-v2.yaml` in `cf45d95bb`

**Plan metadata:** this SUMMARY + tracking commits (`docs(82-06)` + `docs(phase-82)`).

## Files Created/Modified

- `.planning/phases/82-wire-measurement-foundation/82-06-SUMMARY.md` — this acceptance-evidence record
- `config/experiments/wire-verify-82-06.yaml` — original Task-2 live gate spec (2-cell claude+opencode)
- `config/experiments/wire-verify-82-06-v2.yaml` — fresh experiment_id re-run after the leak fix
- `_work/rapid-llm-proxy/src/background-process.ts` — new `isBackgroundProcess()` denylist (proxy repo, `d3f3869`)
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `/api/complete` stamping site now consults the guard (proxy repo, `d3f3869`)
- `_work/rapid-llm-proxy/tests/integration/background-process-guard.test.mjs` — regression, 2/2 green (proxy repo, `d3f3869`)

## Decisions Made

- **Fixed the residual leak with a denylist, not by removing the span fallback.** Unknown processes still receive best-effort span attribution; only the known ambient daemons are excluded. This keeps attribution useful for unclassified callers while killing the exact v9 regression.
- **Re-ran the gate under a new experiment_id (`wire-verify-82-06-v2`)** rather than resuming v1, so the v1/v9 resume state stayed a clean historical baseline for the before/after comparison.
- **BYOK acceptance model = `claude-sonnet-4.6`.** Dotted copilot model names are the valid form (`claude-sonnet-4-5` is rejected 400); haiku's narration-instead-of-tool_calls against the large schema was a model-choice behavior, so the acceptance used the model that reliably emits tool_calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Residual /api/complete ambient-span leak stamped daemon rows with cell task_ids**
- **Found during:** Task 2 (v1 gate run, experiment `wire-verify-82-06`, DB baseline 164392)
- **Issue:** The daemon `/api/complete` rows were stamped with the cells' task_ids via the ambient `active-measurement.json` span. Claude cell ids `164402-164405` (health-coordinator ×3 + consolidator-insight) = 7414 of 8599 cell tokens (**86% contamination**); opencode cell ids `164412-164415` (health-coordinator ×4). Root cause: `proxy-bridge/server.mjs:2656` stamped `resolveLiveTaskId()` for ANY `/api/complete` caller without `body.task_id`. Plan 82-02 had killed the ambient singleton only on the `/v1/messages` tap, not on `/api/complete`. (Tap-side binding, cache fidelity, and opencode stamping all PASSED even in v1 — the leak was isolated to daemon `/api/complete` traffic.)
- **Fix:** New `src/background-process.ts` `isBackgroundProcess()` denylist (exact: `health-coordinator`, `observation-writer`; prefixes: `consolidator-`, `token-adapter-`, `wave-analysis-`) applied at the stamping site. Explicit `body.task_id` always wins; unknown processes keep the legacy span fallback.
- **Verification:** Regression test `tests/integration/background-process-guard.test.mjs` 2/2 green; token-stamping + messages-tap suites 7 pass / 1 live-skip; build green; redeployed (`/health` build `d3f3869`). The v2 gate re-run (experiment `wire-verify-82-06-v2`, DB baseline 164571) PASSED all criteria with zero daemon rows in cell task_ids. A controlled live-guard proof (`wire-verify-82-06-repro`) showed health-coordinator/consolidator-insight unbound, the `claude` process bound via fallback, and explicit task_id bound.
- **Committed in:** proxy `d3f3869`; coding `cf45d95bb` (experiment specs)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was essential — the leak IS the exact defect this gate exists to catch (T-82-06-03). Without it the phase could not close. No scope creep; the denylist is the minimal surgical fix at the one unguarded stamping site.

## Known Issues / Findings

**1. Duplicate `id` values in `token_usage` (pre-existing writer collision).**
Observed duplicate id values (e.g. `164411` in v1; `164572/164573/164612/164613/164614/164633` in v2). Root cause is a missing PK/unique constraint between the `/v1/messages` tap and the adapter writers — first-writer-wins id reuse. **Does NOT affect attribution** (task_id/agent/cache columns are correct), but a follow-up is needed to add a unique constraint / distinct id allocation across the tap and adapter writers.

**2. COPILOT_MODEL=`claude-haiku-4.5` narrated instead of emitting tool_calls against copilot's large tool schema.**
Haiku produced no file (Changes +0 −0) against the full copilot tool schema, while `claude-sonnet-4.6` succeeded immediately; direct curl showed haiku DOES emit proper `tool_calls` against a *simple* schema. This is a **model-choice behavior against a large schema, not a proxy defect** — the shim passthrough itself is correct (direct curl to `/v1/copilot` returned NATIVE `tool_calls` in both buffered `finish_reason=tool_calls` and streaming `delta.tool_calls` modes without writing any file, cleanly separating shim passthrough from agent execution). Valid copilot model names are dotted (`claude-sonnet-4.6`); `claude-sonnet-4-5` is rejected 400.

## Evidence Appendix

**Task 1 — EARLY header trace:**
- Sentinel: `ANTHROPIC_CUSTOM_HEADERS="x-task-id: verify-82-06-1783271878"` → row id 164372, task_id == sentinel, `cache_write_tokens=69412`. Working env shape = newline-separated `Name: value`.

**Task 2 — v2 PASS rows:**
- Experiment `wire-verify-82-06-v2`, DB baseline 164571.
- Claude cell: rows 164609-164611, cladpt, `cache_read` 47946–72264, one row per `tool_call_id` (no shadow dupes).
- Opencode cell: `agent=opencode`, non-cladpt user_hash.
- Live-guard span `wire-verify-82-06-repro`: health-coordinator/consolidator-insight unbound; `claude` process bound (fallback); explicit task_id bound.

**Task 3 — on-disk file proof:**
- Copilot BYOK: `/tmp/byok-proof-1783274148.txt` (OK, sha256 `565339bc4d33d72817b583024112eb7f5cdf3e5eef0252d6ec1b9c9a94e12bb3`) via `COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:12435/v1/copilot/t/byok-proof-1783274148-s46`, `COPILOT_MODEL=claude-sonnet-4.6`; DB rows 164690/164691 `agent=copilot provider=copilot`, task-bound via URL path, 2-turn loop.
- Opencode: `/tmp/opencode-proof-1783274148.txt` (OK) via `opencode run -m rapid-proxy/claude-opus-4.6`; DB rows 164711/164712 `agent=opencode`, 2-turn loop.

## Issues Encountered

The v1 gate run surfaced the ambient-span leak (documented as the single deviation above); resolved via the background-process denylist and a clean v2 re-run. No other issues.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **WIRE-08 discharged; Phase 82 complete (6/6 plans).** The wired substrate is live-proven: all four agents' tokens land in `token_usage` with cache split and per-request task binding, zero cross-contamination under concurrent load, claude cache matches cladpt, and tool-passthrough produces real files on disk.
- **Ready for Phase 83 (Token Reconciliation Layer):** wire rows are now the trustworthy primary source that cladpt/copadt adapters will verify/enrich against.
- **Two follow-ups carried forward (non-blocking):** (1) add a unique-id constraint across the tap + adapter writers to eliminate duplicate `id` values; (2) note the copilot large-schema model-choice behavior when selecting BYOK models for measured runs.

---
*Phase: 82-wire-measurement-foundation*
*Completed: 2026-07-06*
