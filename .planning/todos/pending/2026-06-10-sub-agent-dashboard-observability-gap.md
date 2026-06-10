---
created: 2026-06-10T09:10:00.000Z
title: Sub-agent observations from worktree-isolated Agent() calls don't reach dashboard
area: observability
relates_to_phase: 51
files:
  - integrations/system-health-dashboard/server.js
  - integrations/system-health-dashboard/static-server.js
  - src/live-logging/ObservationWriter.js
  - launchd com.coding.sub-agent-live-{claude,copilot,opencode}
---

## Problem

During Phase 55 wave 6 execution, the operator noticed that the gsd-executor
sub-agent running plan 55-13 did not emit any intent/approach/result
observation rows to the dashboard at `localhost:3032/observations`. Only
the orchestrator's own observations (plan dispatches, merges, progress
checks) appeared. The sub-agent transcript was correctly written by
Claude Code to its task output file (`/private/tmp/claude-502/.../tasks/<agentId>.output`),
but no observation was derived from it.

This is the same gap Phase 51 was scoped to close ("sub-agent transcripts
are not captured"), so this is likely Phase 51 incompleteness — but it
should be verified, and if Phase 51 has shipped, the wiring may have
regressed for the `isolation="worktree"` Agent() spawn flow specifically.

## Likely root causes

1. **Worktree-spawned agents write to a non-tailed path.** The
   `com.coding.sub-agent-live-{claude,copilot,opencode}` launchd daemons
   likely tail a fixed `.specstory/history/` path. Worktree subagents
   may either write their transcript to the task `output` file only
   (not to `.specstory/history/`) or write to a per-worktree path the
   daemon doesn't watch.
2. **Phase 51 not fully shipped.** Memory shows Phase 51 status as
   "Planning, Discussion, and Research" rather than "complete".
3. **Inactivity-threshold bias.** The 10-second inactivity threshold
   used by the LSL capture may not fire if the sub-agent transcript is
   written in one append at task end (no idle period to detect).

## Reproduction

1. Run a Phase 55-class workflow that spawns `gsd-executor` via
   `Agent(isolation="worktree", run_in_background=true)`.
2. While the agent is running, open `localhost:3032/observations`.
3. Filter by date: observe only orchestrator rows appear; no sub-agent
   rows (intent/approach/result) are present.
4. Confirm the sub-agent task output file exists at
   `/private/tmp/claude-502/<session>/.../tasks/<agentId>.output` and
   has non-trivial content.

## Suggested first step

1. Inspect `com.coding.sub-agent-live-claude` daemon config: which path
   does it tail?
2. Check whether worktree-spawned agents leave a transcript in
   `.specstory/history/` or only in the task output file.
3. If only in task output, add a sub-agent task output reader pipeline
   that emits to ObservationWriter using the same shape as the primary
   session reader.

## Why this matters

Without sub-agent observations, the dashboard (and downstream entity/
digest/insight aggregation) is blind to the work the orchestrator
delegates. Token usage attribution, intent tracking, and surface area
analysis all under-count the sub-agent's contribution — which on
Phase-55-class executions can be 80-90% of total LLM token spend.

## Scope

This is a Phase 51 follow-up. If Phase 51 has shipped and this is a
regression, file as a debug session against the daemon. If Phase 51
is not yet complete, fold into the Phase 51 acceptance criteria.
