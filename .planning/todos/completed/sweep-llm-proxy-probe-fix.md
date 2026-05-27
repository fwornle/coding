---
id: sweep-llm-proxy-probe-fix
created: 2026-05-27
status: completed
completed: 2026-05-27T19:42:00Z
priority: high
tags: [phase-51, sub-agent-sweep, llm-proxy, ac-5, runtime-bug]
discovered_in: phase-51, plan-51-16 HUMAN-UAT
resolved_by: commit 0aaf749e0 — "fix(sweep): use GET /health for LLM proxy reachability probe"
---

## Resolution (2026-05-27)

Root cause confirmed: the rapid-llm-proxy returns HTTP 500 (not 400) for
"no messages or prompt provided" validation errors. The probe assumed
4xx for validation rejection — wrong assumption — so a healthy proxy
got classified as unreachable.

Fix landed in commit `0aaf749e0`: switched probe to `GET /health` (returns
200 on a healthy proxy) in both `scripts/sub-agent-sweep-job.sh` and
`scripts/lsl-resolver-job.sh` (same broken pattern in Phase 50 mirror).
Added regression tests (`Test 7a` in sub-agent-launchd-install.test.js,
`Test 5a` in lsl-resolver-launchd.test.js) that lock the new probe shape
and refuse the broken empty-POST pattern. 18/18 tests pass.

End-to-end verified: sub-agent-backfill count moved 117 → 125 (8 new
rows written by the post-fix sweep run). AC #5 idempotency from Phase 51
is now substantive instead of vacuous; AC #2 fresh-LSL-file emission via
sweep cycle is unblocked.

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
