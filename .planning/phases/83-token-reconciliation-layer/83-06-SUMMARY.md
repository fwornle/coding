---
phase: 83-token-reconciliation-layer
plan: 06
subsystem: token-measurement / agent-launch-wiring
tags: [copilot, byok, proxy-routing, measurement, fail-soft, shell]
requires:
  - Phase 82 proxy /v1/copilot BYOK path + copadt transcript capture
provides:
  - Interactive copilot is copadt-only (no wire double-write, WR-02 discharged)
  - Interactive copilot fail-soft protected from a stale/dead proxy URL (WR-05)
  - Copilot BYOK gated to measured spans only, from exactly one home (D-03)
affects:
  - config/agents/copilot.sh
  - scripts/launch-agent-common.sh
tech-stack:
  added: []
  patterns:
    - "Measured-launch gating: BYOK env exported only when TASK_ID (measured span) is set, behind the curl health gate"
    - "Defensive unset on the interactive/no-span path so a dead proxy URL cannot break fail-soft"
key-files:
  created:
    - .planning/phases/83-token-reconciliation-layer/83-06-SUMMARY.md
  modified:
    - config/agents/copilot.sh
    - scripts/launch-agent-common.sh
decisions:
  - "copilot.sh agent_pre_launch delegates ALL BYOK to the health-gated launcher branch + experiment cells; it only defensively unsets COPILOT_PROVIDER_* (WR-05)"
  - "experiment-runner.mjs left UNCHANGED — verified as the correct per-cell measured home; cells spawn the agent binary directly (never the bash launcher), so there is no double-set with configure_proxy_routing"
  - "Dropped the forced COPILOT_MODEL=claude-haiku-4-5 default from interactive agent_pre_launch (it was BYOK-scoped); the measured launcher/cell paths still set the model. Kept COPILOT_AUTO_UPDATE=false (benign, non-routing)"
metrics:
  tasks: 2
  files_changed: 2
  completed: 2026-07-06
---

# Phase 83 Plan 06: Gate Copilot BYOK to Measured Launches Summary

Moved the copilot `COPILOT_PROVIDER_*` BYOK env out of the unconditional interactive launch path and into the health-gated measured wiring only — killing the WR-02 wire+transcript double-writer on interactive copilot and closing WR-05's dead-URL fail-soft break, while measured launches (experiment cells + health-gated launcher branch) keep BYOK from exactly one home (D-03).

## What Was Built

### Task 1 — Remove/gate the unconditional BYOK exports from `copilot.sh` (D-03, WR-02, WR-05)
`agent_pre_launch()` runs for EVERY copilot launch, including interactive sessions with no measured span. It previously exported `COPILOT_PROVIDER_BASE_URL` / `COPILOT_PROVIDER_TYPE` / `COPILOT_PROVIDER_API_KEY` unconditionally, which (a) double-wrote tokens (proxy wire + copadt transcript) and (b) left a dead proxy URL in place that broke copilot's fail-soft.

- Removed all three `COPILOT_PROVIDER_*` exports and the `if [ -n "$TASK_ID" ]` URL-construction block.
- Added a defensive `unset COPILOT_PROVIDER_BASE_URL COPILOT_PROVIDER_TYPE COPILOT_PROVIDER_API_KEY` so any value inherited from the environment is cleared — a stale/dead URL can never reach an interactive copilot (WR-05).
- Retained `_copilot_proxy_port` resolution (referenced in the log line; per CLAUDE.md the LLM proxy host port is 12435, not 3033) and `COPILOT_AUTO_UPDATE=false`.
- Commit: `e68c9b37a`

### Task 2 — Keep measured BYOK in the health-gated launcher + verify cell wiring unchanged (D-03)
`scripts/launch-agent-common.sh configure_proxy_routing()` is the single measured home for launcher-driven copilot BYOK (copilot.sh now delegates to it). It already had the `CODING_PROXY_ROUTE=0` opt-out + curl `/health` gate, but its copilot branch still exported the unbound `/v1/copilot` URL for the no-`TASK_ID` case — i.e. interactive copilot through a healthy proxy would still double-write.

- Gated the copilot branch so `COPILOT_PROVIDER_*` are exported ONLY when `TASK_ID` (a measured span) is set.
- Removed the unbound `/v1/copilot` else-branch (the interactive double-writer) and replaced it with an explicit `unset COPILOT_PROVIDER_*` on the no-span path, so nothing stale survives into an unmeasured copilot session.
- Verified (read-only, no change) that `lib/experiments/experiment-runner.mjs configureProxyRoutingEnv` copilot case still builds the per-cell `COPILOT_PROVIDER_BASE_URL` (task-scoped `/v1/copilot/t/<taskId>`) and passes it to `launchCell` — experiment cells spawn the resolved agent binary DIRECTLY (`resolveAgentBinary` + `argvForAgent`, lines 403-405), never routing through the bash `configure_proxy_routing`, so the two measured homes are mutually exclusive and cannot double-set. Cells always have a `taskId` (`composeTaskId`), so they are measured by definition.
- Commit: `4205ac17c`

## Verification

- `bash -n config/agents/copilot.sh` → exit 0.
- `bash -n scripts/launch-agent-common.sh` → exit 0.
- `node --check lib/experiments/experiment-runner.mjs` → exit 0.
- `grep COPILOT_PROVIDER config/agents/copilot.sh`: only the defensive `unset` + comments remain — no `export COPILOT_PROVIDER_*`.
- `grep COPILOT_PROVIDER_BASE_URL scripts/launch-agent-common.sh`: the sole `export` (line 455) sits inside the `if [ -n "${TASK_ID:-}" ]` guard, itself behind the health gate.
- `grep COPILOT_PROVIDER_BASE_URL lib/experiments/experiment-runner.mjs`: per-cell env assignment (line 184) present and unchanged.

### End-to-end fail-soft chain (WR-05)
For a launcher-driven copilot with a DEAD proxy: `agent_pre_launch` unsets `COPILOT_PROVIDER_*` → `configure_proxy_routing` health gate fails and returns early (never re-sets) → copilot runs unrouted/unmeasured but NOT broken (no stale dead URL). For a HEALTHY proxy with no measured span: the copilot branch's no-`TASK_ID` else unsets `COPILOT_PROVIDER_*` → interactive copilot stays copadt-only.

## Success Criteria

- [x] Interactive copilot returns to copadt-only capture; no wire double-write (D-03 / WR-02).
- [x] A dead proxy URL cannot break interactive copilot's fail-soft (WR-05).
- [x] Measured copilot launches keep BYOK env (experiment cells + health-gated launcher) with no double-set (D-03).

## Deviations from Plan

### Adjustments (not auto-fixes)

**1. [Design choice within Task 2 discretion] Removed the launcher's unbound `/v1/copilot` else-branch**
- The plan's Task 2 quoted the existing branch (which set the unbound URL for the no-`TASK_ID` case) as the structure to copy. Copying it verbatim would have left interactive copilot (launched through a healthy proxy) routed and double-writing — violating the plan's own must_have truth "Interactive copilot launch does NOT export COPILOT_PROVIDER_*" and "The unhealthy / no-span branch never leaves a stale COPILOT_PROVIDER_BASE_URL set."
- Resolution: the copilot branch now exports BYOK ONLY when `TASK_ID` is set and unsets on the no-span path. This is squarely within the task's stated discretion ("copy its existing `if [ -n "${TASK_ID:-}" ]` structure so the BYOK env is set only when routing is active and a task is measured") and is required to satisfy the must_haves.
- Files: `scripts/launch-agent-common.sh`. Commit: `4205ac17c`.

**2. [Minor] Dropped the forced `COPILOT_MODEL=claude-haiku-4-5` default from interactive `agent_pre_launch`**
- This default was introduced with the Phase-82 BYOK block and forced haiku onto every interactive copilot session. Since interactive copilot should behave normally (its own default model), the forced default was dropped. The measured paths (`configure_proxy_routing` and `configureProxyRoutingEnv`) still set the model, so measured behavior is unchanged.
- `COPILOT_AUTO_UPDATE=false` (benign, non-routing) was retained to avoid a behavioral regression.
- Files: `config/agents/copilot.sh`. Commit: `e68c9b37a`.

**3. [Verify-only] `lib/experiments/experiment-runner.mjs` not modified**
- Task 2 required verifying (read-only) that the per-cell BYOK wiring stays unchanged. Inspection confirmed it is correct and needs no change, so it was left untouched. `experiment-runner.mjs` appears in the plan's `files_modified` list as a superset; the read-only verification satisfies the task.

## Threat Model Compliance

- **T-83-06-01 (Tampering — stale/dead proxy URL on interactive copilot):** mitigated — `agent_pre_launch` unsets `COPILOT_PROVIDER_*` on every launch; the launcher's no-span branch also unsets. Dead URL can never break fail-soft.
- **T-83-06-03 (Repudiation — interactive double-write wire+transcript):** mitigated — BYOK gated off the interactive path → copadt-only capture.
- **T-83-06-02 / T-83-06-SC:** accepted (literal non-secret placeholder on 127.0.0.1; no package installs — shell + JS-inspection only).

## Known Stubs

None.

## Self-Check: PASSED
- FOUND: config/agents/copilot.sh (modified)
- FOUND: scripts/launch-agent-common.sh (modified)
- FOUND: commit e68c9b37a (Task 1)
- FOUND: commit 4205ac17c (Task 2)
