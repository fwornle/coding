# Phase 34: Proxy Supervision and ETM Legacy Cleanup - Context

**Gathered:** 2026-05-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add real LLM-proxy semantic-readiness supervision to the central health coordinator at `localhost:3034` (semantic-work probe + central network-mode publishing + VPN/CN flap re-detection + auto-heal wiring) AND surgically remove the dead online-learning code path from the ETM hot path (`scripts/enhanced-transcript-monitor.js` + 6 `src/knowledge-management/` and `src/live-logging/` files) that has been firing 2 LLM calls per exchange + 1 per prompt set whose output has been unread since the `[📚]` badge rewire in commit `0049fc179`.

After cutover: the coordinator's `/health/state` carries a new `proxy.{semantic_ok, networkMode, last_round_trip_ms, auto_heal_status}` slice, the proxy launchd plist is auto-kickstarted on `networkMode` flip, the ETM stops doing dead work (~80 LoC removed + 6 source files deleted), the statusline gets a new `[🧠]` badge mirroring the `[📚]` pattern, and the dashboard surfaces a small proxy-health card. Three Phase 33 leftovers (AC #6 latency run, AC #11 destructive respawn, plist dead-key cleanup) close inline as part of Phase 34 verification.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**7 requirements are locked.** See `34-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `34-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Coordinator semantic-work probe (every 60s) + new `state.proxy.{semantic_ok, last_round_trip_ms, networkMode, auto_heal_status}` fields
- VPN-flap re-exec via `launchctl kickstart` (driven by coordinator)
- Proxy auto-heal flip + cooldown policy (3 kickstarts / 5 min, then alert-only)
- ETM hot-path cleanup (~80 LoC out of `enhanced-transcript-monitor.js`) + 6 source files deleted
- Dead-reader cleanup in `combined-status-line.js`
- Inline verification of Phase 33 AC #6 + AC #11
- Coordinator plist cosmetic cleanup (3 dead env keys)

**Out of scope (from SPEC.md):**
- In-process undici dispatcher swap for the proxy — deferred until re-exec downtime proves intolerable
- Multi-provider semantic probe (round-robin per cycle) — copilot-only is enough
- AC #2 deviation (LLM-CLI-proxy as separate `com.coding.*` entry) — out of scope, same as Phase 33
- Restructuring `KnowledgeRetriever` / VKB consumers — keep working modules untouched
- Replacement test files for removed modules
- Removing the per-project `.health/<project>-transcript-monitor-state.json` file (still written, different from deleted `-health.json`)

</spec_lock>

<decisions>
## Implementation Decisions

### Probe Protocol (Coordinator → Proxy)

- **D-01: Tier-pinned tiny payload.** Coordinator POSTs every 60s:
  ```json
  {
    "messages": [{"role": "user", "content": "reply with the single token: OK"}],
    "provider": "copilot",
    "tier": "haiku",
    "maxTokens": 5
  }
  ```
  Cheapest copilot tier; deterministic 1-token response; ~5 tokens/probe × 60/h = ~300 tokens/h cost. Self-documenting in proxy logs (the prompt explains itself). No `/api/liveness` shortcut endpoint — we test the actual completion path.

- **D-02: Strict 4-mode failure classification.** `state.proxy.semantic_ok=false` if ANY of:
  - HTTP 4xx/5xx from `POST /api/complete` (catches OAuth-expired 401, rate-limit 429, all-providers-unavailable 503)
  - Network timeout >10s round-trip (catches stuck CLI / hung copilot; 10s = ~5× typical RTT)
  - HTTP 200 but response missing/empty content field (catches degraded providers returning `{choices:[{message:{content:null}}]}` silently)
  - HTTP 200 but content does not contain substring "OK" (catches model going off-script — "I cannot help with that")

  Rationale for including the last mode: the prompt is explicit ("reply with the single token: OK") so a missing-OK substring genuinely indicates the proxy is returning something but degraded. Brittle if the model is updated to a refusal-prone variant — flagged as a known-fragile check that the planner should add a `relaxed_oksub` config knob for if it becomes flaky.

- **D-03: Trace logging mirrors knowledge_pipeline pattern.** Default INFO log on transition (`semantic_ok` flips false→true or true→false), DEBUG log per probe. Coordinator already has `log()` with severity filter and 10MB inline rotation (Phase 33 D-X). Flip DEBUG via env var `HEALTH_COORDINATOR_PROBE_DEBUG=1` when investigating. No separate `.logs/proxy-probe.log` file — keeps the rotation surface count flat.

### Auto-Heal State Machine

- **D-04: In-memory cooldown state.** Consecutive-failure counter and `kickstart_timestamps[]` array live in coordinator's existing in-memory `state.proxy` slice — same memory location as `semantic_ok` / `networkMode`. Lost on coordinator restart; that's acceptable because launchd KeepAlive already covers the gap and the cooldown is only 5 min. No JSON checkpoint file (rejected as overkill for a 5-min window).

- **D-05: Exact kickstart command.** Coordinator spawns:
  ```bash
  launchctl kickstart -k gui/$UID/com.coding.llm-cli-proxy
  ```
  `-k` signals SIGTERM → SIGKILL after 5s, then respawns. Inherits launchd plist `EnvironmentVariables` (PATH, LLM_PROXY_PORT). Re-runs `start-llm-proxy.sh` from scratch — PAC re-fetched, `HTTPS_PROXY` refreshed. NOT `kill <pid>` (avoid race with launchd respawn). NOT `bootout/bootstrap` (only used for the plist edit itself in Plan 6).

- **D-06: Cooldown engages after 3 kickstarts in 5 min.** State machine:
  - Failure 1, 2 → kickstart, increment counter, append timestamp
  - Failure 3 (within 5 min of failure 1) → kickstart, set `state.proxy.auto_heal_status="cooldown"`, suppress further kickstarts
  - Cooldown clears when `kickstart_timestamps[]` rolls past 5 min (sliding window) AND probe succeeds
  - During cooldown: probe still runs; semantic_ok still flips; coordinator logs WARN every probe-failure but does NOT kickstart
  - `state.proxy.auto_heal_status` enum: `"healthy" | "kickstart_pending" | "cooldown" | "disabled"`

- **D-07: Kill-switch via existing /health/refresh.** When auto-heal misbehaves, operator sets `rules.services.llm_cli_proxy.auto_heal=false` in `config/health-verification-rules.json` and calls `POST http://localhost:3034/health/refresh` — coordinator already calls `loadRules()` on this endpoint per `health-coordinator.js:988`. No new SIGHUP handler, no new endpoint, no coordinator restart. `state.proxy.auto_heal_status` flips to `"disabled"`. Auditable via git log of the config file. Re-enable: revert config edit + same `POST /health/refresh`.

### ETM Strip Strategy

- **D-08: Two atomic plans for cleanup.**
  - **Plan A (strip):** Strip lines 66–83 (imports), 187–213 (init), 736–846 (extractor methods + status getter), 3681–3698 (per-exchange trajectory call), 3808 (per-prompt-set extractKnowledgeAsync), 4257–4258 (stopHeartbeat), 4372–4373 (`trajectory:` and `knowledgeExtraction:` health output fields) from `scripts/enhanced-transcript-monitor.js`. ~80 LoC. Smoke test: ETM imports clean, starts, posts heartbeat.
  - **Plan B (delete):** Delete `src/live-logging/RealTimeTrajectoryAnalyzer.js` + `src/knowledge-management/{StreamingKnowledgeExtractor,KnowledgeExtractor,KnowledgeDecayTracker,ConceptAbstractionAgent,TrajectoryAnalyzer}.js`. Clean dead readers in `combined-status-line.js` lines 593, 1114, 1324, 1871, 1880. Delete or skip-mark `tests/unit/knowledge-management/KnowledgeExtraction.test.ts` + `scripts/test-knowledge-extraction.js`. Grep-clean acceptance.

  Rationale for two plans (not one or five): minimal bisect window if something breaks (revert Plan B = restore deletions; revert Plan A = restore strips), one logical unit per plan (behavior-changing strip vs. file-system delete), atomic per plan.

- **D-09: Hard restart both ETMs in Plan A cutover.** Operator (or coordinator-driven later phase) sends SIGTERM to PID 30761 (coding) and PID 54103 (rapid-automations) after Plan A merges. `bin/coding`'s tmux launcher already includes ETM in startup; restart happens on next launcher tick. Verify within 30s: both ETMs back up, both posting `lsl_heartbeat` (`state.lsl[<sid>].lastBeat` advances), `state.knowledge_pipeline.lastObservationAt` advances on next prompt. NOT waiting for natural session restart (would leave dead LLM calls firing for hours).

- **D-10: Coding ETM verified first.** Cutover order: kill coding ETM → verify restart + heartbeat → ONLY THEN kill rapid-automations ETM → verify restart + heartbeat. If coding ETM fails to restart or stops heartbeating, ABORT before touching rapid. This protects the cross-project failure-mode locked in SPEC Requirement 6.

### Surface (Dashboard + Statusline)

- **D-11: Dashboard adds proxy-health card.** Small card in `integrations/system-health-dashboard/` UI showing `state.proxy.semantic_ok` (green/red), `state.proxy.networkMode` (text badge), `state.proxy.auto_heal_status` (text badge with cooldown countdown when in cooldown). Triggers a dashboard frontend rebuild + bind-mount cache flush per the project Docker FUSE caveat (`CLAUDE.md`). One added UI plan, ~50 LoC React/Tailwind.

- **D-12: New `[🧠]` statusline badge** for proxy semantic state, mirroring the `[📚]` knowledge-pipeline pattern in `combined-status-line.js`. States: `healthy 🧠✅` · `degraded 🧠⚠️` (semantic_ok=false but auto_heal not in cooldown) · `cooling 🧠🚫` (auto_heal_status=cooldown) · `disabled 🧠🔇` (rule.auto_heal=false manually) · `unknown 🧠❓` (proxy state never observed) · `unreachable 🧠❌` (coordinator unreachable). Bundled into the same plan that cleans dead `transcript-monitor-health.json` readers in `combined-status-line.js` (Plan B), since both touch the same file.

### Rollback + Soak

- **D-13: git revert per-plan + independent config flip.** Each of the ~6 plans is one atomic commit. Revert path: `git revert <commit-sha>` + restart coordinator/ETM as appropriate. Auto-heal misbehavior is independently revertable via D-07 kill-switch (config edit + `POST /health/refresh`) without code revert. NO feature-flag env-var approach — would defeat Option B cleanup motivation by leaving permanent dead-code surface.

- **D-14: 24h soak gate.** Phase 34 declared verified ONLY after a 24h continuous soak with `state.proxy.kickstart_count == 0` (i.e., no spurious auto-heal fires on stable network). Even one unexplained kickstart triggers investigation before phase close. Catches false-positive cooldowns and flap-miscount edge cases. Mirrors the lesson from Phase 33 AC #6 deferral — short soaks miss timing-window bugs.

### Phase 33 Leftovers (closed inline in Phase 34)

- **D-15: AC #6 detection-latency run** — Phase 34 verification budget includes 10 min for `bash scripts/__tests__/health-coordinator/detection-latency.test.sh` (50 trials, P95 / P99 measured). Pass = P95 ≤ 10s. The deferred-to-user flag from `33-VERIFICATION.md` clears.

- **D-16: AC #11 destructive respawn run** — Phase 34 verification includes inline `kill -9 <coordinator-pid>` test, expect respawn ≤ 30s via launchd KeepAlive. Brief coordinator outage during test — runs LAST in verification suite to minimize impact on other tests. The deferred flag from `33-VERIFICATION.md` clears.

- **D-17: Coordinator plist dead-key cleanup** — Edit `~/Library/LaunchAgents/com.coding.health-coordinator.plist` to remove the `HEALTH_COORDINATOR_INJECT_THROW`, `HEALTH_COORDINATOR_INJECT_FAIL`, `TICK_MS` empty-default keys added by the falsified 33-12 attempt. Apply via `launchctl bootout gui/$UID ~/Library/LaunchAgents/com.coding.health-coordinator.plist && launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.coding.health-coordinator.plist`. Verify `coordinator_uptime_s` increments from 0 (proves bootout/bootstrap worked, not just kickstart).

### Claude's Discretion

The following lower-impact decisions are left to the planner/researcher to recommend; they were intentionally not pinned in discussion:

- **Probe HTTP client choice:** native `fetch()` (Node 22 stable) vs `axios` (already a project dep) — leaning toward native fetch, no new dep, sufficient for localhost POST. Planner may pick axios if it offers better timeout semantics.
- **Probe interval implementation:** `setInterval(60_000)` vs piggyback on existing 5s tick (12 ticks per probe). `setInterval` is simpler; tick-piggyback gives slightly better cadence accuracy. Either acceptable.
- **`launchctl kickstart` exec strategy:** `child_process.execFile()` vs `spawn()` — `execFile` is shorter for fire-and-forget; `spawn` gives better error attribution. Either acceptable.
- **Dashboard card placement:** which existing card grid the proxy card slots into. Planner picks based on layout coherence.
- **Statusline `[🧠]` badge position:** before or after `[📚]`. Planner picks based on visual grouping.

### Folded Todos

No todos were folded into Phase 34 scope (`gsd-sdk query todo.match-phase 34` returned 0 matches with score ≥ 0.4).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SPEC and Roadmap

- `.planning/phases/34-proxy-supervision-and-etm-cleanup/34-SPEC.md` — **Locked requirements — MUST read before planning.** 7 requirements + 13 acceptance checks + 7 in-scope / 6 out-of-scope items. Cross-project ETM (rapid-automations PID 54103) is the locked must-not-break failure mode.
- `.planning/ROADMAP.md` — Phase 34 entry under v7.0 milestone heading.

### Phase 33 carry-forward (decisions and code patterns ratified)

- `.planning/phases/33-health-monitoring-consolidation/33-CONTEXT.md` — D-01..D-11 (D-02 HEALTH_COORDINATOR_URL env contract, D-05 coordinator-owned rule registry, D-09 reporter session_id from CLAUDE_SESSION_ID, D-11 per-pane statusline semantics) all carry forward to Phase 34 unmodified.
- `.planning/phases/33-health-monitoring-consolidation/33-SPEC.md` — referenced for AC #2 deviation reasoning.
- `.planning/phases/33-health-monitoring-consolidation/33-VERIFICATION.md` — AC #6 / AC #11 deferred-to-user status; cleared in Phase 34.

### Project codebase maps

- `.planning/codebase/STACK.md` — Node 22 / ES modules / Express / Jest 29.7 — coordinator + ETM both follow these.
- `.planning/codebase/ARCHITECTURE.md` § "LLM Service Layer" — `lib/llm/circuit-breaker.ts` and `lib/llm/provider-registry.ts` patterns reused for D-04/D-06 cooldown state machine.
- `.planning/codebase/CONVENTIONS.md` — naming, error handling, `[ClassName]` log prefix, JSDoc patterns.

### Coordinator (proxy supervision touchpoints)

- `scripts/health-coordinator.js:160-175` — existing `state.knowledge_pipeline` slice + comments — TEMPLATE for new `state.proxy` slice (D-01..D-06 mirror this pattern).
- `scripts/health-coordinator.js:984-996` — existing `POST /health/refresh` endpoint that already calls `loadRules()` — kill-switch path per D-07.
- `scripts/health-coordinator.js:998-1015` — existing `POST /health/remediate` (added in Phase 33 33-15) — auto-heal kickstart per D-05 dispatches through this dispatcher.
- `config/health-verification-rules.json` — `services.llm_cli_proxy` rule definition. Edit per Plan 1: add `auto_heal_action: "restart_llm_cli_proxy"`, flip `auto_heal: true`, add `cooldown.{max_kickstarts: 3, window_seconds: 300}`.

### Proxy (network detection + provider routing)

- `_work/rapid-llm-proxy/proxy-bridge/server.mjs:76-83` — `detectNetworkMode()` cached 5 min — already returns `vpn|public` per LLM_NETWORK_MODE override priority.
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs:624-642` — proxy `/health` endpoint (already returns `networkMode`) — coordinator polls this, surfaces under `state.proxy.networkMode`.
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs:660-670` — auto-route logic (uses `networkMode` for provider preference) — DO NOT TOUCH; coordinator just observes.
- `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` — launchd wrapper that fetches PAC + sets HTTPS_PROXY + exports LLM_NETWORK_MODE — re-runs on every kickstart per D-05.
- `~/Library/LaunchAgents/com.coding.llm-cli-proxy.plist` — launchd plist; targets `start-llm-proxy.sh`. NOT edited in Phase 34 (already correct).

### ETM (cleanup target)

- `scripts/enhanced-transcript-monitor.js` — strip target. Lines: 66–83 (imports), 187–213 (init), 736–846 (extractor methods + status getter), 3681–3698 (per-exchange trajectory call), 3808 (per-prompt-set extractKnowledgeAsync), 4257–4258 (stopHeartbeat), 4372–4373 (health output fields).
- `src/live-logging/RealTimeTrajectoryAnalyzer.js` — DELETE (only ETM imports it).
- `src/knowledge-management/StreamingKnowledgeExtractor.js` — DELETE (only ETM imports it).
- `src/knowledge-management/KnowledgeExtractor.js` — DELETE (only StreamingKnowledgeExtractor imports it).
- `src/knowledge-management/KnowledgeDecayTracker.js` — DELETE (only StreamingKnowledgeExtractor imports it).
- `src/knowledge-management/ConceptAbstractionAgent.js` — DELETE (only StreamingKnowledgeExtractor imports it).
- `src/knowledge-management/TrajectoryAnalyzer.js` — DELETE (the `src/knowledge-management/` one, only StreamingKnowledgeExtractor imports it; not the same file as `src/live-logging/RealTimeTrajectoryAnalyzer.js`).
- `tests/unit/knowledge-management/KnowledgeExtraction.test.ts` — delete or skip-mark (exercises removed code).
- `scripts/test-knowledge-extraction.js` — delete or skip-mark.
- `tests/unit/ontology/integration.test.js` — has refs; update or skip the affected sections.
- `tests/acceptance/knowledge-system-acceptance.test.js` — has refs; update or skip the affected sections.

### KEEP-list (audit-confirmed live consumers — DO NOT touch)

- `src/knowledge-management/KnowledgeRetriever.js` — used by `lib/vkb-server/api-routes.js`, `lib/ukb-database/cli.js`.
- `src/knowledge-management/UKBDatabaseWriter.js` — used by `lib/ukb-database/cli.js`.
- `src/knowledge-management/QdrantSyncService.js` — used by `scripts/sync-graph-to-qdrant.js`, `scripts/test-import-merge.js`, MCP semantic-analysis (persistence-agent).
- `src/knowledge-management/{KnowledgeStorageService,GraphKnowledge*,GraphDatabaseService,KnowledgeQueryService,KnowledgeExportService}.js` — used by UKB pipeline / VKB / MCP semantic-analysis.

### Statusline + dashboard surface

- `scripts/combined-status-line.js:593` — dead-reader comment block (clean per Plan B).
- `scripts/combined-status-line.js:1114` — `transcript-monitor-health.json` join (dead reader, clean).
- `scripts/combined-status-line.js:1324` — second `transcript-monitor-health.json` join (dead reader, clean).
- `scripts/combined-status-line.js:1871,1880` — directory-scan loop for `*-transcript-monitor-health.json` files (dead, clean).
- `scripts/combined-status-line.js` — getKnowledgeSystemStatus() (existing, the [📚] pattern) — TEMPLATE for getProxySystemStatus() per D-12.
- `integrations/system-health-dashboard/` — UI components — new proxy-health card per D-11. Dashboard rebuild required (`npm run build` + supervisorctl restart per CLAUDE.md FUSE caveat).

### Phase 33 leftover targets

- `~/Library/LaunchAgents/com.coding.health-coordinator.plist` — remove 3 dead env keys per D-17. Bootout/bootstrap to apply.
- `scripts/__tests__/health-coordinator/detection-latency.test.sh` — Phase 34 inline run per D-15.
- `scripts/__tests__/health-coordinator/run-all.sh` — full Phase 33 acceptance suite re-run as part of Phase 34 verification.

### Reusable patterns from `lib/llm/`

- `lib/llm/circuit-breaker.ts` — proven failure-counter + cooldown-state-machine pattern. Don't reimport (it's an LLM-service circuit breaker, not generic), but mirror the state-transition shape (`closed → half-open → open` ↔ `healthy → kickstart_pending → cooldown`) for D-06.
- `lib/llm/provider-registry.ts` — provider preference + fallback ordering — already in the proxy auto-route logic; coordinator does not duplicate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`state.knowledge_pipeline` slice** in `health-coordinator.js:160-175` — the EXACT template for `state.proxy.{semantic_ok, networkMode, last_round_trip_ms, auto_heal_status}`. Same JSON shape style, same `last_probe_end` timestamp pattern, same enum-status field, same comment style explaining the slice's purpose.
- **`pollKnowledgePipeline()` function** in `health-coordinator.js:372-425` — the EXACT template for `pollProxySemantic()` (probe + classify + write `state.proxy`). Mirror the catch-all error handler that always sets `status:'unknown'` (never silently 'healthy') per Phase 33 SPEC R6.
- **`POST /health/refresh` endpoint** at `health-coordinator.js:984` — already calls `loadRules()`. Used as kill-switch per D-07; no new endpoint needed.
- **`POST /health/remediate` endpoint** at `health-coordinator.js:998` — auto-heal dispatcher already exists from Phase 33 33-15. Coordinator's auto-heal kickstart per D-05 dispatches through this rather than spawning launchctl directly inline (consistent surface; one place to test).
- **Express + ESM patterns** — already established in `health-coordinator.js`. Coordinator additions follow same style.
- **Dashboard `[📚]` knowledge_pipeline card** (if any exists) and the `getKnowledgeSystemStatus()` function in `combined-status-line.js` — TEMPLATE for the `[🧠]` proxy badge per D-12.
- **10MB inline log rotation pattern** — already in `health-coordinator.js`. Coordinator's probe-trace logs reuse this; no separate `.logs/` file.

### Established Patterns

- **`state.<slice>.status: 'unknown' | <good> | <bad>`** — coordinator never emits `'healthy'` on a probe error; always falls back to `'unknown'`. Phase 34's `state.proxy.semantic_ok` follows the boolean variant of this (false on probe error, never silently true).
- **`HEALTH_COORDINATOR_URL` env-var contract** (D-02 from Phase 33) — any new client (probe, kill-switch caller) reads this env var; defaults to `http://localhost:3034`.
- **`launchctl kickstart -k`** for graceful service respawn — already used in coordinator's existing remediation actions; pattern is proven.
- **Atomic-commit-per-plan** — Phase 33 followed this for all 15 plans. Phase 34's ~6 plans do the same.

### Integration Points

- **Coordinator → Proxy:** new HTTP client in coordinator (`pollProxySemantic()`) hits `POST http://localhost:12435/api/complete` every 60s. New HTTP client in coordinator (`pollProxyMode()`) hits `GET http://localhost:12435/health` every tick (5s). Both fail-open with `state.proxy.{semantic_ok:false, networkMode:'unknown'}` on error.
- **Coordinator → launchd:** `child_process.execFile('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/com.coding.llm-cli-proxy`])` invoked from the auto-heal action.
- **Coordinator → Coordinator (self-mutation):** `POST /health/remediate {action:'restart_llm_cli_proxy'}` is the actual auto-heal entry point. The remediation action handler dispatches to the launchctl kickstart spawn. Lets the dashboard's "Restart" button (Phase 33 33-15) work the same path.
- **Statusline → Coordinator:** new `getProxySystemStatus()` in `combined-status-line.js` does `fetch(${HEALTH_COORDINATOR_URL}/health/state)` and reads `state.proxy.{semantic_ok, networkMode, auto_heal_status}` to render the `[🧠]` badge. Mirrors `getKnowledgeSystemStatus()` for `[📚]`.
- **Dashboard → Coordinator:** new proxy-health card React component fetches `/api/health-verifier/status` (the existing reverse-proxy endpoint added in Phase 33 D-03) which already passes through coordinator state. Plus a small dist/ rebuild + supervisorctl restart per the FUSE caveat in CLAUDE.md.
- **ETM (post-cleanup) → Coordinator:** unchanged — D-09 contract preserved (POST `/signals` `{kind:'lsl_heartbeat', session_id, source, status, ts}` per heartbeat tick).

</code_context>

<specifics>
## Specific Ideas

- **Probe prompt is self-documenting** — "reply with the single token: OK" both elicits the response AND tells a future reader (in proxy logs) why the request exists. Cheaper than a code comment.
- **`state.proxy.last_round_trip_ms`** — record this on every probe so the dashboard card can show a sparkline of probe latency. Useful trend data for diagnosing slow-but-working states.
- **`state.proxy.kickstart_count`** — running counter (since coordinator boot) of how many times auto-heal has fired. Visible in `/health/state.proxy`. The 24h soak gate per D-14 = `kickstart_count == 0` after 24h on stable network.
- **`[🧠]` icon** is mnemonic for "brain" → semantic work. Mirrors `[📚]` for knowledge. Together: brain (live inference) + library (accumulated knowledge). Reserve `[🩺]` if a future phase ever wants a generic "deep health" badge.

</specifics>

<deferred>
## Deferred Ideas

- **In-process undici dispatcher swap** for proxy HTTPS_PROXY rotation (no downtime on VPN flap) — Phase 34 chose `launchctl kickstart -k` instead (~3-5s downtime, simple). Revisit only if downtime proves intolerable.
- **Multi-provider semantic probe** (round-robin across copilot, claude-code, anthropic per cycle) — Phase 34 uses copilot-only. Per-provider failover is already the proxy's job; the probe just verifies the proxy can do work end-to-end.
- **AC #2 deviation closure** — two `com.coding.*` launchctl entries (`health-coordinator` + `llm-cli-proxy`) is documented as out of scope per Phase 33 33-07 Deviation #2. Not Phase 34.
- **Replacement test files for removed modules** — Phase 34 deletes/skips the broken tests; new test coverage for the live observation/digest/insight pipeline is its own future phase.
- **Removing `.health/<project>-transcript-monitor-state.json`** — this state-resume artifact is still written (line 284 of ETM). Distinct from the deleted `-health.json` writer. Keep for now; revisit if Phase 33's session-id contract is ever rewritten.
- **Generic `[🩺]` deep-health statusline badge** — reserved for a future phase that wants to surface aggregate system health (not just proxy or knowledge pipeline).
- **Coordinator-driven ETM respawn endpoint** — adding a `restart_etm` action to `/health/remediate` would automate D-09's hard-restart step. Out of scope; manual SIGTERM is fine for Phase 34.

</deferred>

---

*Phase: 34-proxy-supervision-and-etm-cleanup*
*Context gathered: 2026-05-09*
