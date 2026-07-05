---
phase: 82-wire-measurement-foundation
plan: 05
subsystem: measurement-launchers
tags: [proxy-routing, token-attribution, byok, copilot, opencode, claude]
requires:
  - "Plan 02 (cache tap keeps cache accounting)"
  - "Plan 04 (dedup merge-on-cache — cladpt row no longer shadowed)"
  - "Plan 03 (/v1/copilot task-scoped path)"
  - "Phase 81 (copilot BYOK verified live)"
provides:
  - "claude experiment cells + interactive launcher route through the proxy with x-task-id per-request binding"
  - "copilot BYOK env (measured) for experiment cells + interactive launcher"
  - "flag-gated (opt-in) opencode anthropic-native provider entry"
affects:
  - lib/experiments/experiment-runner.mjs
  - scripts/launch-agent-common.sh
  - config/agents/copilot.sh
  - config/agents/opencode.sh
tech-stack:
  added: []
  patterns:
    - "configureProxyRoutingEnv switch — explicit per-agent cases (claude/copilot/mastracode split from default)"
    - "task-scoped base-URL path (/v1/copilot/t/<task_id>) as header-less per-request binding seam"
    - "flag-gated config splice with byte-identical default"
key-files:
  created: []
  modified:
    - lib/experiments/experiment-runner.mjs
    - scripts/launch-agent-common.sh
    - config/agents/copilot.sh
    - config/agents/opencode.sh
decisions:
  - "opencode anthropic-native: config-rewrite via env-interpolated string splice (not a separate config file) — single source of truth, guaranteed byte-identical default"
  - "mastra documented ambient-bound this phase — no launcher-controlled base-URL path seam"
  - "COPILOT_PROVIDER_WIRE_MODEL left inherited (not forced) — launcher has no wire-name mapping"
metrics:
  duration: ~15m
  completed: 2026-07-05
requirements: [WIRE-07]
---

# Phase 82 Plan 05: Wire Coding-Side Launchers (claude re-route + copilot BYOK + opencode opt-in) Summary

Re-routed claude experiment cells through the proxy with an `x-task-id` per-request binding header (removing the deliberate unroute workaround, now safe after Plans 02+04), wired copilot into measurement via the Phase-81 BYOK seam pointed at the task-scoped `/v1/copilot/t/<task_id>` path, and landed a flag-gated opt-in opencode anthropic-native provider entry.

## What Was Built

### Task 1 — `lib/experiments/experiment-runner.mjs` (commit `93274259e`)
- Removed the `default:` claude special-case that ran `delete env.ANTHROPIC_BASE_URL` (the unroute workaround).
- Split the switch into explicit cases:
  - `claude` → `env.ANTHROPIC_BASE_URL = base` + `env.ANTHROPIC_CUSTOM_HEADERS = 'x-task-id: ' + taskId` (per-request tap binding; `x-agent` omitted — the Plan-02 tap treats absent `x-agent` as claude).
  - `copilot` → `COPILOT_PROVIDER_BASE_URL = base + '/v1/copilot/t/' + encodeURIComponent(taskId)` (falls back to `/v1/copilot` when no taskId), `COPILOT_PROVIDER_TYPE='openai'`, `COPILOT_PROVIDER_API_KEY='rapid-proxy-no-auth-placeholder'`, `COPILOT_MODEL` from the cell model, `COPILOT_AUTO_UPDATE='false'`.
  - `default` (mastracode) → no-op, documented ambient-bound.
- Threaded `taskId` + `model` into `configureProxyRoutingEnv` via `opts`; updated the `runCell` caller to pass `{ port, taskId, model: cell.model }`. COPY-of-baseEnv discipline preserved.

### Task 2 — `scripts/launch-agent-common.sh` + `config/agents/copilot.sh` (commit `b8f7f1203`)
- Interactive claude case now exports `ANTHROPIC_CUSTOM_HEADERS="x-task-id: ${TASK_ID:-}"` alongside `ANTHROPIC_BASE_URL`.
- Copilot case: dropped the "NOT yet proxy-measured (follow-up)" warning, replaced with BYOK env exports (task-scoped base URL when `TASK_ID` set, else unbound `/v1/copilot`; type openai; placeholder key; `COPILOT_MODEL` default `claude-haiku-4-5`; auto-update off).
- `config/agents/copilot.sh` `agent_pre_launch` lands the same BYOK exports so the interactive launcher inherits them (health-gated `configure_proxy_routing` runs after and has the final say).

### Task 3 — `config/agents/opencode.sh` (commit `eed2e426a`)
- Added `OPENCODE_ANTHROPIC_NATIVE` (default OFF) gate. When set to `1`, splices a `"provider":{"anthropic":{"options":{"baseURL":".../v1","headers":{"x-task-id":...,"x-agent":"opencode"}}}}` block into `OPENCODE_CONFIG_CONTENT` after the leading `{`.
- baseURL is the proxy `/v1` root — the `@ai-sdk/anthropic` client appends `/messages` → `/v1/messages`.
- Default-off leaves `OPENCODE_CONFIG_CONTENT` byte-identical to today.

## Acceptance Criteria — Results

| Check | Result |
|-------|--------|
| `delete env.ANTHROPIC_BASE_URL` absent from experiment-runner.mjs | PASS |
| claude branch sets `ANTHROPIC_CUSTOM_HEADERS` = `x-task-id: <taskId>` | PASS |
| copilot case sets `COPILOT_PROVIDER_BASE_URL` at `/v1/copilot` (openai + placeholder key + model) | PASS |
| `node --check experiment-runner.mjs` exits 0 | PASS |
| `bash -n` on all three shell files exits 0 | PASS |
| `ANTHROPIC_CUSTOM_HEADERS` in launch-agent-common.sh claude case | PASS |
| `COPILOT_PROVIDER_BASE_URL` /v1/copilot in BOTH launcher + copilot.sh (port 12435) | PASS |
| "NOT yet proxy-measured" warning gone from launcher | PASS |
| opencode flag OFF-by-default; default config byte-identical | PASS (splice test) |
| opencode provider entry targets `/v1/messages` + headers x-task-id + x-agent: opencode | PASS |

## Safety Valve — byte-unchanged (as required)

- **experiment-runner.mjs** `CODING_PROXY_ROUTE` opt-out (the `['0','false','no','off']` block) and the `/health` gate: **byte-unchanged**. Only the `switch (agent)` block and the function signature/JSDoc/caller were touched.
- **launch-agent-common.sh** `case "${CODING_PROXY_ROUTE:-1}"` opt-out and the `curl -sf .../health` gate: **byte-unchanged**. Only the `claude`, `mastra`, and `copilot` case bodies inside `configure_proxy_routing()` were touched.

## Rendered-default diff (opencode, flag unset)

With `OPENCODE_ANTHROPIC_NATIVE` unset the `if [ ... = "1" ]` block is skipped entirely, so:
- VPN: `{"model":"github-copilot-enterprise/claude-opus-4.6","disabled_providers":["anthropic"]}`
- Public: `{"model":"claude-opus-4-6","disabled_providers":["copilot"]}`

Both are byte-identical to the pre-change blob (only the two original `export OPENCODE_CONFIG_CONTENT=...` lines produce the default). Verified by a splice test that confirmed the OFF path leaves the blob unchanged and the ON path produces valid JSON with the provider entry.

## Deviations from Plan

### mastra ambient-bound (documented, not silent)
- **Rule 4-adjacent / plan-anticipated:** The plan Task 1 + Task 2 instructed: if the mastra base-URL seam is NOT launcher-controlled per-launch, document mastra as ambient-bound (deviation, not silent).
- **Finding:** mastra (`mastracode`) is a standalone OAuth TUI self-routed via `MASTRACODE_MODEL_ID=rapid-proxy-mastra` → proxy `/v1/mastra`. There is **no launcher-controlled base-URL path seam** to embed a per-request `task_id` (`config/agents/mastra.sh` sets `MASTRACODE_MODEL_ID` only; no base-URL env). No `/v1/mastra/t/<task_id>` form is available.
- **Decision:** mastra stays **ambient-bound this phase**. In `experiment-runner.mjs` it falls into the `default` no-op case; in `launch-agent-common.sh` the mastra case carries a one-line comment noting ambient-binding. Making mastra per-request-bound is out of scope (would need a proxy-side path seam like copilot's).

### COPILOT_PROVIDER_WIRE_MODEL left inherited
- The plan mentions setting `COPILOT_PROVIDER_WIRE_MODEL` "when the wire name differs". Neither the runner nor the launcher has a model→wire-name mapping, and the Phase-81 spike command set only `COPILOT_MODEL`. `COPILOT_PROVIDER_WIRE_MODEL` is therefore **left inherited** (honoured if the operator pre-sets it) rather than forced. Documented inline in both `launch-agent-common.sh` and this SUMMARY.

## Threat Model Compliance

- **T-82-05-01** (placeholder key disclosure, accept): the literal `rapid-proxy-no-auth-placeholder` is used verbatim — no real credential. Documented inline.
- **T-82-05-02** (x-task-id spoofing, mitigate): value is the launcher-owned span/cell task id, not user input; the Plan-02 tap sanitizes it. Header set only from `taskId`/`${TASK_ID}`.
- **T-82-05-03** (re-route regresses cache accounting, mitigate): re-route depends on Plans 02+04 (declared in `requires`); `CODING_PROXY_ROUTE` opt-out + health gate remain byte-unchanged as the reversible safety valve.
- **T-82-05-04** (opencode provider becomes default prematurely, mitigate): entry is OFF-by-default behind `OPENCODE_ANTHROPIC_NATIVE`; default config byte-identical; default deferred pending cache_control live-verification.
- **T-82-05-SC** (npm install, accept): no new packages — pure launcher/config env edits.

No new threat surface beyond the register.

## Live-verification note (out of scope here)

Per the plan's `<verification>`, live end-to-end validation (header actually forwarded by the claude CLI, copilot BYOK produces a real file, opencode emits `cache_control` on the native path) is **Plan 06's EARLY gate**. This plan is static (syntax + grep) only; the `ANTHROPIC_CUSTOM_HEADERS` newline `Name: value` format remains a flagged risk verified there.

## Self-Check: PASSED
- `lib/experiments/experiment-runner.mjs` — FOUND
- `scripts/launch-agent-common.sh` — FOUND
- `config/agents/copilot.sh` — FOUND
- `config/agents/opencode.sh` — FOUND
- commit `93274259e` — FOUND
- commit `b8f7f1203` — FOUND
- commit `eed2e426a` — FOUND
