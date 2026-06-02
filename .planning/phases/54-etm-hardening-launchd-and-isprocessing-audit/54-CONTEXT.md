---
phase: 54-etm-hardening-launchd-and-isprocessing-audit
status: backlog
type: bug-fix-phase
requirements:
  - ETM-01: ETM must auto-respawn after crash or hang
  - ETM-02: ETM's isProcessing guard must never leak true across exceptions
priority: medium
trigger:
  date: 2026-06-02
  evidence: |
    ETM PID 98287 silently stalled for 16h+ (Jun 1 16:58 UTC → Jun 2 07:25 UTC).
    Process alive (1m17s CPU over 18h55m); no observations written; dashboard
    knowledge indicator faded to black. Manual SIGTERM + nohup relaunch
    cleared the stall; first new observation `2aba0006` landed within ~2s.
---

# Phase 54 — ETM Hardening (launchd + isProcessing audit)

## Why this exists

Observed 2026-06-02 09:21 CEST: the Enhanced Transcript Monitor (`scripts/enhanced-transcript-monitor.js`, host process) was alive for 18h 55m but stopped firing observations 16h 23m earlier. Symptoms:

- Process alive (PID 98287, ELAPSED 18:55:13)
- Cumulative CPU time **1m17s over 19h** — the 2s poll loop was effectively frozen
- DB `MAX(created_at) = 2026-06-01T14:58:52.934Z` (Jun 1 16:58 CEST); zero new rows for 16h+
- obs-api (PID 27474, port 12436) was healthy throughout — the gap is on the ETM side, not the API
- Dashboard knowledge indicator went **green → orange → brown → black** through the silence

The user noticed via the dashboard ("faded to black, no observations"). Manual restart cleared it; first new observation landed within one poll cycle.

## Root cause hypothesis

Two compounding gaps:

### Gap 1 — No launchd wrapper for ETM

Other coding services are launchd-managed and auto-respawn:

| Service | Plist | Behavior on hang |
|---|---|---|
| obs-api | `~/Library/LaunchAgents/com.coding.obs-api.plist` | launchd respawn |
| health-coordinator | `com.coding.health-coordinator.plist` | launchd respawn |
| llm-cli-proxy | `com.coding.llm-cli-proxy.plist` | launchd respawn (per Phase 34) |
| sub-agent-live-{claude,opencode,copilot} | three plists | launchd respawn (Phase 51) |
| lsl-resolver | `com.coding.lsl-resolver.plist` | launchd respawn (Phase 50) |
| **ETM** | **NONE** | **silent stall, no respawn** |

When ETM hangs or crashes, nothing brings it back. The user's session continues producing prompts but observations are silently dropped.

### Gap 2 — `isProcessing` re-entrancy guard can stick

In `scripts/enhanced-transcript-monitor.js`, the poll loop short-circuits if `this.isProcessing` is true (line 3928). The flag is set in 3 places (lines 4085, 4103, 4123) with resets at lines 4092, 4116, 4135. If any of those reset paths is inside a `finally` that's bypassed by an uncaught Promise rejection, the flag stays `true` forever and the loop silently freezes.

Hypothesis: an unhandled rejection in the `_firePromptSetObservation()` → `ObservationApiClient.processMessages()` chain (e.g., transient `ECONNRESET` from obs-api during a restart, or a JSON-parse error on a malformed assistant response) escaped the existing handlers and locked the guard.

## Scope

### Must-have (this phase)

1. **Plan 54-01 — launchd plist for ETM.**
   - Author `~/Library/LaunchAgents/com.coding.etm.plist` modeled on `com.coding.obs-api.plist`
   - `KeepAlive: true` so launchd respawns on exit / signal
   - `StandardErrorPath` + `StandardOutPath` to `~/Library/Logs/coding/etm-{out,err}.log`
   - `ThrottleInterval: 15` (s) to avoid tight respawn loops
   - Environment: same env vars `bin/coding --claude` exports when it starts ETM manually (need to enumerate by reading bin/coding + claude-mcp)
   - Acceptance: `launchctl list | grep com.coding.etm` shows the label with a PID; `kill <pid>` followed by 5s wait shows a new PID under the same label.

2. **Plan 54-02 — `isProcessing` reset audit.**
   - Wrap the entire fire-observation block in `enhanced-transcript-monitor.js:4085-4135` in a top-level `try { … } finally { this.isProcessing = false; }` so the guard always clears, regardless of which inner path threw.
   - Add a watchdog: if `isProcessing` has been true for > N seconds (suggest 60s), force-reset it and emit a `[POLL] isProcessing forced-reset after Ns` line to stderr so the next stall is observable.
   - Add a periodic stall self-check: if `pollCount` advanced but no observation has been written in the last 5 minutes AND the Claude jsonl mtime IS recent, log a `[STALL-DETECT]` line. This gives operators a signal before the dashboard fades to black.
   - Acceptance: induce a thrown error in `_firePromptSetObservation` (test via env var or unit test) and confirm `isProcessing` is `false` after the throw; observations continue from the next poll.

3. **Plan 54-03 — coding startup integration.**
   - Make `bin/coding --claude` use `launchctl kickstart` for ETM instead of `spawn`, mirroring the obs-api startup pattern.
   - If a manually-launched ETM exists at startup, the new launchd-managed one should not collide — bail or kill the orphan with explicit log.
   - Update CLAUDE.md "Startup & Services" section so the launchd label `com.coding.etm` is documented alongside the other services.

### Could-have (defer)

- A `/etm/health` endpoint (or extend the existing health-coordinator) that reads ETM heartbeat + last-write timestamp from the obs DB and surfaces it on the dashboard, so the next stall is caught by the existing 4-layer monitoring rather than the user noticing visually.
- Migrate ETM's polling design from `setInterval` to a `fs.watch` / `fsevents`-based file watcher on the active claude jsonl, eliminating the polling latency entirely.

### Out of scope

- ETM's classification / observation summarization logic — only the host-side lifecycle + guard correctness.
- The dashboard "faded to black" visualization itself — once observations resume flowing, it clears.
- Phase 51 sub-agent capture daemons (already have launchd plists, separate concern).

## Trigger event (forensic)

- 2026-06-01 ~14:28 UTC — ETM started (PID 98287 spawned by `bin/coding --claude`)
- 2026-06-01 14:58 UTC — last successful observation write (`5b71503c-…`)
- 2026-06-01 ~14:58 UTC onwards — silent stall (no error, no exit)
- 2026-06-02 07:21 UTC — user observed "faded to black" on dashboard
- 2026-06-02 07:25 UTC — manual restart fixed (PID 36600 took over, first new obs `2aba0006`)

ETM lost ~16h of live observations. The async lsl-resolver (Phase 50) is the backfill safety net — it should rewind and reconstruct missed observations from the specstory MD file. Worth verifying as a Could-have task.

## Related

- Phase 33 (Health Coordinator) — could surface ETM heartbeat
- Phase 34 (Proxy Supervision) — analogous launchd kickstart pattern for llm-cli-proxy
- Phase 50 (LSL-grounded async observation resolver) — backfill safety net
- Phase 51 (Sub-agent capture) — sister daemons with launchd plists; reuse plist scaffolding
- [[reference_etm_health_contract]] — ETM heartbeat already POSTs to coordinator; could be extended

## Resume point

`/gsd-discuss-phase 54` when ready to lock decisions. Until then this is backlog.
