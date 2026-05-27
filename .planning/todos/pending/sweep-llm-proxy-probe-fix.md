---
id: sweep-llm-proxy-probe-fix
created: 2026-05-27
status: pending
priority: high
tags: [phase-51, sub-agent-sweep, llm-proxy, ac-5, runtime-bug]
discovered_in: phase-51, plan-51-16 HUMAN-UAT
---

# Fix sub-agent sweep — LLM proxy probe returning HTTP 500 on every run

`.data/live-sub-agent-sweep.log` shows every sweep run since 2026-05-26 has
exited at the LLM proxy reachability check:

```
[sub-agent-sweep][08:12:57Z] LLM proxy unreachable (HTTP 500) — skipping this run
[sub-agent-sweep][08:42:57Z] LLM proxy unreachable (HTTP 500) — skipping this run
… (15+ identical entries through 18:29:51Z 2026-05-27)
```

The CR-04 fix (Plan 51-12) makes the launchd daemon **boot** cleanly with the
correct node binary, but the daemon's own internal proxy probe is failing. The
sweep job exits 0 (looks healthy in `launchctl list`) but does **no work**.

## Impact

- AC #5 idempotency on backfill rows is technically vacuous — the sweep never
  performs a write, so the unchanged 117 count proves nothing about idempotency.
- AC #2 fresh sub-agent LSL files don't appear because the sweep that would
  flush them aborts before reaching the writer.
- Live tier (Plans 51-07/08/09) still works (proven by 3 fresh `source='sub-agent'`
  rows in `.observations/observations.db`) — the live path uses ObservationWriter's
  own LLM client, not the sweep's probe path.

## Action

1. Find the sweep's LLM proxy probe in `scripts/sub-agent-sweep-job.sh` (and
   downstream callers).
2. Confirm which port it probes:
   - LLM CLI proxy: **port 12435** (per CLAUDE.md, `LLM_CLI_PROXY_URL`)
   - Health API: **port 3033** (Docker container — wrong target for this probe)
   - Host coordinator: **port 3034** (also wrong for an LLM check)
3. If the probe was hitting the wrong port (likely — analogous to the 3033 vs
   3034 confusion already documented in 51-16-SUMMARY post-merge), point it at
   12435 + `/api/complete` (per CLAUDE.md `host.docker.internal:12435` pattern
   or host-side via `RAPID_LLM_PROXY_URL` / `LLM_CLI_PROXY_URL`).
4. Add a unit test that the sweep's proxy probe targets the documented URL.
5. After fix, run a sweep manually:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-sweep
   sleep 30
   tail -5 .data/live-sub-agent-sweep.log
   # Expected: "[sub-agent-sweep] processed N sub-agents" (or similar) NOT "LLM proxy unreachable"
   ```

## Context

- Discovered during Phase 51 Plan 51-16 HUMAN-UAT (sweep evidence step).
- The 15+ identical errors stretching back to 2026-05-26 mean the production
  sweep cron has been silently no-op for at least 24 hours — backfill rows
  are stable at 117 (the Plan 51-02 historical load) only because nothing has
  been writing since then.
- Live tier saved the verification: the FSEvents path bypasses the sweep
  proxy check, which is why AC #3 still passes.
