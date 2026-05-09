# Phase 34: Proxy Supervision and ETM Legacy Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 34-proxy-supervision-and-etm-cleanup
**Areas discussed:** Probe protocol, Auto-heal state machine, ETM strip strategy, Rollback + observability

---

## Probe protocol

### Probe payload to /api/complete

| Option | Description | Selected |
|--------|-------------|----------|
| Tiny + tier-pinned | `{messages:[{role:'user',content:'reply with the single token: OK'}], provider:'copilot', maxTokens:5, tier:'haiku'}` — cheapest tier, deterministic, ~5 tokens/probe | ✓ |
| Just 'ping' | `{messages:[{role:'user',content:'ping'}], provider:'copilot', maxTokens:10}` — slightly variable response | |
| Empty-message liveness check (custom endpoint) | Add `/api/liveness` to proxy that does auth/CLI check without LLM call. Zero LLM cost but tests less | |

**User's choice:** Tiny + tier-pinned (Recommended)
**Notes:** Self-documenting in proxy logs (the prompt explains itself). Locked in D-01.

### Failure classification (semantic_ok=false when…)

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP error (4xx/5xx) | Catches OAuth-expired (401), rate-limit (429), all-providers-unavailable (503) | ✓ |
| Network timeout (>10s round-trip) | Catches stuck CLI / hung copilot. 10s = 5× typical RTT | ✓ |
| 200 but empty/missing content field | Catches degraded providers returning `{choices:[{message:{content:null}}]}` silently | ✓ |
| 200 but content doesn't contain 'OK' | Strictest — catches model going off-script | ✓ |

**User's choice:** All four (multi-select)
**Notes:** All four modes are now failure conditions. Strictest mode (missing-OK substring) is brittle if model goes refusal-prone — flagged in D-02 as a known-fragile check that planner should add a `relaxed_oksub` config knob for if it becomes flaky.

### Probe trace logging

| Option | Description | Selected |
|--------|-------------|----------|
| Coordinator log only — INFO on transition, DEBUG on every probe | Mirrors `knowledge_pipeline` pattern. Default INFO quiet; DEBUG via env | ✓ |
| Always log every probe at INFO | Verbose. ~60 lines/hour | |
| Separate file: `.logs/proxy-probe.log` | Isolated trace stream | |

**User's choice:** Coordinator log only (Recommended)
**Notes:** Reuses existing 10MB rotation. DEBUG flip via env var `HEALTH_COORDINATOR_PROBE_DEBUG=1`. Locked in D-03.

---

## Auto-heal state machine

### Cooldown counter location

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory only — lost on coordinator restart | Mirrors Phase 33 default. Simple. launchd KeepAlive covers gap | ✓ |
| JSON file at `.logs/proxy-auto-heal-state.json` | Survives coordinator restart. Adds I/O + concurrent-write surface | |
| Push into existing in-memory `state.proxy` slice | Same memory location as `semantic_ok` / `networkMode`. Cleanest | |

**User's choice:** In-memory only (Recommended)
**Notes:** Implementation note added in D-04 — counter lives WITHIN the `state.proxy` slice (the cleanest variant of "in-memory") so all proxy-related state is in one place.

### Kickstart command

| Option | Description | Selected |
|--------|-------------|----------|
| `launchctl kickstart -k gui/$UID/com.coding.llm-cli-proxy` | Standard launchd respawn. -k signals SIGTERM→SIGKILL after 5s, then restart | ✓ |
| `kill <pid>` + rely on KeepAlive | Functionally equivalent but extra surface (read+verify pid first) | |
| `launchctl bootout + bootstrap` | Heavier; needed only for plist edits | |

**User's choice:** launchctl kickstart -k (Recommended)
**Notes:** Re-runs `start-llm-proxy.sh` from scratch — PAC re-fetched, HTTPS_PROXY refreshed. Locked in D-05.

### Kill-switch when auto-heal misbehaves

| Option | Description | Selected |
|--------|-------------|----------|
| `auto_heal: false` in config + SIGHUP coordinator | Edit config, SIGHUP to reload. No code change | ✓ (modified) |
| Env var `HEALTH_COORDINATOR_PROXY_AUTO_HEAL=disabled` at boot | Persistent until restart. Less granular | |
| `POST /health/auto-heal/disable` endpoint with TTL | Most flexible but new HTTP surface | |

**User's choice:** Config edit + signal (Recommended)
**Notes:** **Verification adjusted the mechanism** — coordinator does NOT have a SIGHUP handler, but DOES already call `loadRules()` on `POST /health/refresh` (verified at `health-coordinator.js:988`). So kill-switch is `edit config + POST /health/refresh` instead of SIGHUP. Same outcome, no new code. Locked in D-07.

---

## ETM strip strategy

### Plan slicing

| Option | Description | Selected |
|--------|-------------|----------|
| Two plans: strip + delete | Plan A: strip ~80 LoC + smoke. Plan B: delete 6 files + clean readers + grep-clean | ✓ |
| One big plan | All in one commit. Fastest, harder to bisect | |
| Five plans (per change-class) | Imports / init / per-exchange / per-prompt-set / health-output each separate | |

**User's choice:** Two plans (Recommended)
**Notes:** Atomic per plan, minimal bisect window. Locked in D-08.

### ETM restart approach

| Option | Description | Selected |
|--------|-------------|----------|
| Kill both ETM PIDs, let bin/coding launchers respawn | SIGTERM 30761 + 54103. Verify within 30s | ✓ |
| Wait for natural restart (next session start) | Old ETM keeps running with old code. Slowest verification | |
| Add coordinator-driven respawn endpoint | Most automated but new remediation action | |

**User's choice:** Kill both PIDs (Recommended)
**Notes:** Captured as D-09. Coordinator-driven respawn endpoint deferred (in `<deferred>`).

### Smoke-test order

| Option | Description | Selected |
|--------|-------------|----------|
| Coding first, rapid-automations second | Coding is dev-loop, catch issues immediately. Rapid is the cross-project guard | ✓ |
| Both simultaneously | Faster but loses fault isolation | |
| Rapid-automations first | Defensive — verify cross-project case before dev-loop | |

**User's choice:** Coding first (Recommended)
**Notes:** Locked in D-10. Abort before touching rapid-automations if coding ETM fails to restart.

---

## Rollback + observability

### Revert path

| Option | Description | Selected |
|--------|-------------|----------|
| git revert per-plan + config flip | ~6 atomic commits revertable independently. Auto-heal kill via D-07 | ✓ |
| Feature-flag everything behind `PHASE_34` env var | Permanent dead-code surface; defeats Option B cleanup motivation | |
| Force-push to revert SPEC commit | Lose verification artifacts. Avoid | |

**User's choice:** git revert per-plan (Recommended)
**Notes:** Locked in D-13.

### Soak duration

| Option | Description | Selected |
|--------|-------------|----------|
| 24h soak with kickstart count = 0 | Real-world soak. semantic_ok stays true. Spurious kickstart triggers investigation | ✓ |
| 1h soak after acceptance tests pass | Faster phase close. Misses flap edge cases needing longer to manifest | |
| No soak — close as soon as 13 ACs pass | Riskiest. Don't repeat Phase 33 AC #6 mistake | |

**User's choice:** 24h soak (Recommended)
**Notes:** Locked in D-14.

### Surface (dashboard / statusline)

| Option | Description | Selected |
|--------|-------------|----------|
| JSON-only via `/health/state`, no widget | Adds the data; statusline already consumes coordinator state. Dashboard widget = own UX phase | |
| Bundle a small proxy-health card into the dashboard | semantic_ok / networkMode / cooldown at a glance. React work + dashboard rebuild | ✓ |
| Statusline gets a new badge (e.g., 🧠✅/⚠️/🚫) | Mirrors `[📚]` knowledge_pipeline pattern. ~30 LoC in combined-status-line.js | ✓ |

**User's choice:** Both #2 and #3 (free-text "2 and 3")
**Notes:** Real scope additions but don't change SPEC requirements (just surface choices for already-published data). Locked in D-11 (dashboard card) + D-12 (statusline `[🧠]` badge). Bundled into the same plan as the dead-reader cleanup since both touch combined-status-line.js.

---

## Claude's Discretion

The following lower-impact decisions were intentionally not pinned in discussion (captured in CONTEXT.md):

- Probe HTTP client choice: native `fetch()` vs `axios` (no new dep preferred — leaning native fetch)
- Probe interval implementation: `setInterval(60_000)` vs piggyback on existing 5s tick
- `launchctl kickstart` exec strategy: `child_process.execFile()` vs `spawn()`
- Dashboard card placement in existing layout
- Statusline `[🧠]` badge position relative to `[📚]`

## Deferred Ideas

- In-process undici dispatcher swap (zero-downtime VPN flap) — revisit if `kickstart -k` downtime proves intolerable
- Multi-provider semantic probe (round-robin) — copilot-only is enough
- AC #2 deviation closure (two `com.coding.*` launchctl entries) — out of scope per Phase 33 33-07 Dev #2
- Replacement test files for removed modules — its own future phase
- Removing `.health/<project>-transcript-monitor-state.json` (state-resume artifact, still in use)
- Generic `[🩺]` deep-health statusline badge — future phase
- Coordinator-driven ETM respawn endpoint (`restart_etm` action) — manual SIGTERM is fine for Phase 34
