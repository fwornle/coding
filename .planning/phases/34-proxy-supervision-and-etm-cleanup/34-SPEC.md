# Phase 34: Proxy Supervision and ETM Legacy Cleanup — Specification

**Created:** 2026-05-09
**Ambiguity score:** 0.148 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

The central health coordinator at `localhost:3034` becomes the honest single source of truth for LLM proxy semantic-readiness AND the ETM hot path stops doing dead work — by adding a real semantic-work probe + central network-mode publishing + auto-heal wiring + on-the-fly VPN/CN re-detection AND deleting the dead `StreamingKnowledgeExtractor` / `RealTimeTrajectoryAnalyzer` / related modules that the ETM still runs but whose output nothing reads since commit `0049fc179`.

## Background

### Proxy supervision (current state)

- `~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist` runs `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` with `KeepAlive.SuccessfulExit=false` (catches **crash**, never **stuck**).
- Wrapper probes BMW PAC host once at boot, exports `LLM_NETWORK_MODE=vpn|public` + `HTTPS_PROXY` if corporate. **Never re-fetched** — switching VPN on/off mid-session leaves stale env.
- `proxy-bridge/server.mjs:76-83,624` has `detectNetworkMode()` cached 5 min; surfaces `networkMode` in its own `/health` response. Coordinator does not publish this anywhere.
- Coordinator rule (`config/health-verification-rules.json` → `services.llm_cli_proxy`) is `http_health` against `/health` with 3s timeout, 5s tick — **only checks 200 OK**, no semantic round-trip. `auto_heal:false` with manual-restart note.
- Live state confirms: `state.services[llm_cli_proxy] = {status:running, latency_ms:3}`. Coordinator can't see `networkMode`, providers, or whether the proxy can actually do work.

### ETM legacy (current state)

- Phase A (commit `0049fc179`) rewired the **statusline reader**: `[📚]` badge now queries `state.knowledge_pipeline` from the coordinator instead of reading `.health/<project>-transcript-monitor-health.json`.
- Phase B was **deferred** — commit message: *"the vector-storage path may still feed something else and needs an audit before removal."* Audit completed this session (see KEEP/DELETE list below).
- `scripts/enhanced-transcript-monitor.js` still imports `RealTimeTrajectoryAnalyzer` (line 68) and `StreamingKnowledgeExtractor` (line 78), initializes both at startup (lines 187–213, 740–800), calls `trajectoryAnalyzer.analyzeTrajectoryState()` **per exchange** (line 3683 → LLM call), calls `extractKnowledgeAsync()` **per prompt set** (line 3808 → another LLM call), still emits `trajectory:` and `knowledgeExtraction:` fields in health output (lines 4372–4373).
- Two ETM processes run today (PID 30761 coding, PID 54103 rapid-automations).
- **Cost:** 2 LLM calls per exchange + 1 per prompt set, all to `copilot/claude-sonnet-4.6` via the proxy. Output unread by the rewired statusline.

### Deferred Phase 33 leftovers being closed in Phase 34

- AC #6 (8-min P95 detection-latency test) — `DEFERRED-TO-USER` per `33-VERIFICATION.md`
- AC #11 (destructive `kill -9` → respawn ≤30s) — `DEFERRED` per `33-VERIFICATION.md`
- 3 dead env keys in `~/Library/LaunchAgents/com.coding.health-coordinator.plist` (`HEALTH_COORDINATOR_INJECT_THROW`, `_INJECT_FAIL`, `TICK_MS`) added by the falsified 33-12 attempt

## Requirements

1. **Semantic-work probe**: Coordinator periodically issues a real completion through the proxy and surfaces a boolean readiness signal.
   - Current: Coordinator only checks `GET /health` returns 200; a hung CLI / expired OAuth would read as healthy
   - Target: Every 60s coordinator POSTs a tiny prompt (e.g., 3-token "say OK") to `localhost:12435/api/complete` via copilot, surfaces `state.proxy.semantic_ok` (bool) and `state.proxy.last_round_trip_ms` (int) in `/health/state`
   - Acceptance: Forcing a copilot OAuth failure causes `semantic_ok` to flip to `false` within 90s (1.5× probe interval) at the coordinator's `/health/state` endpoint

2. **Central network-mode publishing**: Coordinator polls and surfaces the proxy's `networkMode` so all consumers (statusline, prompt-hook, MCP servers) can read one source of truth.
   - Current: Each consumer would have to poke `localhost:12435/health` themselves; coordinator's `/health/state` has no `proxy.networkMode` field
   - Target: Coordinator's per-tick proxy poll extracts `networkMode` from proxy `/health` and publishes as `state.proxy.networkMode` ∈ `{vpn, public, unknown}`
   - Acceptance: Setting `LLM_NETWORK_MODE=vpn` in the proxy environment and restarting it causes coordinator's `/health/state.proxy.networkMode` to read `"vpn"` within 30s

3. **VPN/CN flap re-detection**: When the actual network changes, the proxy's `HTTPS_PROXY` env is refreshed automatically.
   - Current: PAC is fetched once at launchd boot. Switching VPN on/off mid-session leaves stale `HTTPS_PROXY`; requests start hanging until manual restart
   - Target: Coordinator detects `state.proxy.networkMode` change between consecutive ticks and triggers `launchctl kickstart -k gui/$UID/com.coding.llm-cli-proxy`. Re-exec runs `start-llm-proxy.sh` again, which re-probes PAC and resets `HTTPS_PROXY`. ~3-5s downtime per flap; in-flight requests fail
   - Acceptance: With proxy initially `LLM_NETWORK_MODE=public`, set env to `vpn` and restart. Then with proxy as `vpn`, externally re-set to `public` and verify coordinator triggers kickstart within one tick (5s), proxy PID changes within 10s, and final `state.proxy.networkMode` reads `"public"` within 30s

4. **Auto-heal wiring**: Proxy auto-heal goes through coordinator's `/health/remediate` (added in 33-15) when semantic readiness fails persistently.
   - Current: `config/health-verification-rules.json` → `services.llm_cli_proxy.auto_heal=false` with manual-restart note
   - Target: Flip to `auto_heal=true`. When `state.proxy.semantic_ok=false` for ≥60s sustained, coordinator dispatches `restart_llm_cli_proxy` action via `launchctl kickstart`. Cooldown: max 3 kickstarts per 5 min, then escalate to alert-only (logged + surfaced as `state.proxy.auto_heal_status="cooldown"`)
   - Acceptance: Force `semantic_ok=false` for 60s, verify proxy PID changes (launchd respawn). Force again repeatedly within 5 min, verify cooldown engages after 3rd kickstart and `auto_heal_status` reads `"cooldown"`

5. **ETM legacy code removal**: All dead online-learning paths in the ETM hot path are deleted.
   - Current: ETM imports + initializes + per-exchange/prompt-set calls `RealTimeTrajectoryAnalyzer` + `StreamingKnowledgeExtractor`; emits unread `trajectory:` / `knowledgeExtraction:` fields; still writes `.health/<project>-transcript-monitor-health.json`
   - Target: Strip lines 66–83, 187–213, 736–846, 3681–3698, 3808, 4257–4258, 4372–4373 from `scripts/enhanced-transcript-monitor.js` (~80 LoC). Delete: `src/live-logging/RealTimeTrajectoryAnalyzer.js` + `src/knowledge-management/{StreamingKnowledgeExtractor,KnowledgeExtractor,KnowledgeDecayTracker,ConceptAbstractionAgent,TrajectoryAnalyzer}.js` (6 files). Clean dead readers in `combined-status-line.js` (lines 593, 1114, 1324, 1871, 1880). KEEP `KnowledgeRetriever`, `UKBDatabaseWriter`, `QdrantSyncService`, `KnowledgeStorageService`, `GraphKnowledge*`, `GraphDatabaseService`, `KnowledgeQueryService`, `KnowledgeExportService` (audit-confirmed live consumers in `lib/vkb-server`, `lib/ukb-database`, MCP semantic-analysis)
   - Acceptance: `grep -rn "StreamingKnowledgeExtractor\|RealTimeTrajectoryAnalyzer\|KnowledgeDecayTracker\|ConceptAbstractionAgent" --include="*.js" --include="*.ts" --include="*.cjs" --include="*.mjs" .` returns empty (excluding `.specstory/`, `node_modules/`, `dist/`, `site/`, `.spec-workflow/`)

6. **ETM behavior preserved across projects**: After cleanup, both coding-project and rapid-automations ETMs continue posting heartbeats and observations.
   - Current: PID 30761 (coding) and PID 54103 (rapid-automations) both run the same ETM
   - Target: Both processes after restart continue (a) POSTing `lsl_heartbeat` to coordinator (state.lsl[<sid>].lastBeat advances), (b) feeding observations to obs_api (state.knowledge_pipeline.lastObservationAt advances on new prompt sets)
   - Acceptance: Restart both ETMs, send a test prompt in each project, verify within 30s: `state.lsl[<coding-sid>].lastBeat` and `state.lsl[<rapid-sid>].lastBeat` both advance; `state.knowledge_pipeline.lastObservationAt` advances; statusline `[📚]` badge stays `healthy ✅`

7. **Phase 33 leftover closure**: Outstanding deferred AC items get inline-verified.
   - Current: AC #6 P95 detection-latency = `DEFERRED-TO-USER`; AC #11 kill -9 respawn = `DEFERRED`; coordinator plist has 3 dead env keys
   - Target: Run AC #6 (`bash scripts/__tests__/health-coordinator/detection-latency.test.sh`, ≥10-min budget) and AC #11 inline as part of Phase 34 verification. Edit `~/Library/LaunchAgents/com.coding.health-coordinator.plist` to remove `HEALTH_COORDINATOR_INJECT_THROW`, `_INJECT_FAIL`, `TICK_MS` keys with empty defaults (no longer used since 33-15 switched to POST `/test/inject`). Bootout/bootstrap to apply
   - Acceptance: AC #6 P95 ≤ 10s; AC #11 respawn ≤ 30s (both pass without the prior `DEFERRED` flag in `34-VERIFICATION.md`); plist diff shows exactly those 3 keys removed; coordinator restart succeeds and `state.coordinator_uptime_s` increments from 0

## Boundaries

**In scope:**
- Coordinator semantic-work probe (every 60s) + new `state.proxy.{semantic_ok, last_round_trip_ms, networkMode, auto_heal_status}` fields
- VPN-flap re-exec via `launchctl kickstart` (driven by coordinator)
- Proxy auto-heal flip + cooldown policy (3/5min then alert-only)
- ETM hot-path cleanup (~80 LoC out of `enhanced-transcript-monitor.js`) + 6 source files deleted
- Dead-reader cleanup in `combined-status-line.js`
- Inline verification of Phase 33 AC #6 + AC #11
- Coordinator plist cosmetic cleanup (3 dead env keys)

**Out of scope:**
- In-process undici dispatcher swap for proxy (Round 1 alternative B was rejected) — deferred until re-exec downtime proves intolerable
- Multi-provider semantic probe (round-robin per cycle) — copilot-only is enough; per-provider failover is already the proxy's job
- LLM-CLI-proxy AC #2 deviation (Phase 33 documented two `com.coding.*` launchctl entries as out-of-scope — this stays out)
- Restructuring `KnowledgeRetriever` / VKB consumers — keep working modules untouched
- Test files for removed modules (`tests/unit/knowledge-management/KnowledgeExtraction.test.ts`, `scripts/test-knowledge-extraction.js`) — delete or skip but don't rewrite for replacement
- Removing the per-project `.health/<project>-transcript-monitor-state.json` file (state-resume artifact, still written by ETM at line 284 — different from the deleted `-health.json` writer)

## Constraints

- **Probe quota:** ~60 probes/hour × ~10 tokens copilot = ~600 tokens/h to copilot. Acceptable.
- **Re-exec downtime:** ~3-5s during VPN flap; in-flight requests fail. Acceptable per Round 1 decision.
- **Auto-heal cooldown:** Max 3 kickstarts per 5 min, then alert-only (no infinite restart loop on persistent provider failure).
- **Cross-project blast radius:** ETM cleanup must not break rapid-automations (PID 54103) or any other project ETM. Verification covers both.
- **Compatibility:** Phase 33 D-09 contract preserved — ETM continues posting `lsl_heartbeat` to coordinator with same payload schema after cleanup.
- **No undici dispatcher refactor** in this phase. If re-exec downtime proves problematic, a follow-up phase can revisit.

## Acceptance Criteria

- [ ] `state.proxy.semantic_ok` flips to `false` within 90s of a forced copilot OAuth failure
- [ ] `state.proxy.networkMode` matches `LLM_NETWORK_MODE` env within 30s of a proxy restart
- [ ] Coordinator triggers `launchctl kickstart` within one tick (5s) of detecting `networkMode` flip; proxy PID changes within 10s
- [ ] Coordinator triggers auto-heal kickstart within 60s of sustained `semantic_ok=false`; proxy PID changes
- [ ] Auto-heal cooldown engages after 3rd kickstart in 5 min; `state.proxy.auto_heal_status="cooldown"`
- [ ] AC #6 (Phase 33 deferred): detection-latency P95 ≤ 10s on a fresh 8-min run
- [ ] AC #11 (Phase 33 deferred): proxy respawn ≤ 30s after `kill -9`
- [ ] `grep -rn "StreamingKnowledgeExtractor\|RealTimeTrajectoryAnalyzer\|KnowledgeDecayTracker\|ConceptAbstractionAgent" --include="*.js" --include="*.ts" --include="*.cjs" --include="*.mjs" .` (excluding `.specstory/`, `node_modules/`, `dist/`, `site/`, `.spec-workflow/`) returns empty
- [ ] After ETM restart, `state.lsl[<coding-sid>].lastBeat` advances within 30s of a new prompt
- [ ] After ETM restart, `state.lsl[<rapid-sid>].lastBeat` advances within 30s of a new prompt in rapid-automations
- [ ] After ETM restart, `state.knowledge_pipeline.lastObservationAt` advances within 30s of a new prompt
- [ ] Statusline `[📚]` badge reads `healthy ✅` after ETM restart
- [ ] ETM per-prompt-set duration drops by ≥2s vs. pre-cleanup baseline (proves dead LLM calls stopped)
- [ ] Coordinator plist diff shows exactly `HEALTH_COORDINATOR_INJECT_THROW`, `_INJECT_FAIL`, `TICK_MS` removed; coordinator uptime increments from 0 after bootout/bootstrap

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                            |
|--------------------|-------|------|--------|------------------------------------------------------------------|
| Goal Clarity       | 0.95  | 0.75 | ✓      | Both threads + leftover closure crisply specified                |
| Boundary Clarity   | 0.80  | 0.70 | ✓      | KEEP/DELETE lists explicit; out-of-scope reasoning attached      |
| Constraint Clarity | 0.75  | 0.65 | ✓      | Quota, downtime, cooldown all locked                             |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 13 pass/fail criteria covering all 7 requirements                |
| **Ambiguity**      | 0.148 | ≤0.20| ✓      | Gate passed in 3 rounds                                          |

## Interview Log

| Round | Perspective     | Question summary                                  | Decision locked                                                                  |
|-------|-----------------|---------------------------------------------------|----------------------------------------------------------------------------------|
| 1     | Researcher      | How to slice Phase 34?                            | Both threads in one phase, ~5-7 plans                                            |
| 1     | Researcher      | VPN flap handling strategy?                       | Re-exec via `launchctl kickstart` on detected flap (not in-process undici swap)  |
| 1     | Researcher      | Semantic probe provider?                          | Copilot only (~1-2s direct HTTP, available on both VPN and public)               |
| 2     | Simplifier      | Bundle Phase 33 leftovers?                        | Yes to all three: AC #6, AC #11, plist cleanup                                   |
| 2     | Simplifier      | Probe interval?                                   | 60s (~600 tokens/h copilot)                                                      |
| 2     | Boundary Keeper | Flap test strategy?                               | LLM_NETWORK_MODE env override (no real VPN switch needed)                        |
| 3     | Failure Analyst | Proxy supervision pass criteria?                  | All 4: semantic_ok flip, networkMode visibility, kickstart trigger, AC #6 P95    |
| 3     | Failure Analyst | ETM cleanup pass criteria?                        | All 4: heartbeat, observation flow, grep-clean, ≥2s perf delta                   |
| 3     | Failure Analyst | Worst failure to guard against?                   | Cross-project ETM (rapid-automations) must keep working                          |

---

*Phase: 34-proxy-supervision-and-etm-cleanup*
*Spec created: 2026-05-09*
*Next step: /gsd-discuss-phase 34 — implementation decisions (probe-prompt content, kickstart cmd flags, ETM strip patches, cooldown state machine)*
