# Plan 34-03 SUMMARY — Auto-heal FSM + VPN/CN flap kickstart + restartLLMCLIProxy() rewrite

**Status:** Complete pending two destructive live tests (R3 / R4) deferred to operator window.
**Files modified:** `scripts/health-coordinator.js`, `scripts/health-remediation-actions.js`.

## What landed

### Task 1 — `restartLLMCLIProxy()` rewrite

`scripts/health-remediation-actions.js:569` — entire body replaced. The
previous implementation killed the proxy via `lsof -ti:<port> | kill` and
respawned it directly via `spawn('node', [distEntry], …)` — bypassing
`start-llm-proxy.sh`, so PAC was never re-fetched and `HTTPS_PROXY`
stayed stale across VPN/CN network changes (the very condition R3 needs
to heal). Rewritten to use:

```
launchctl kickstart -k gui/${process.getuid()}/com.coding.llm-cli-proxy
```

Inherits the plist's `EnvironmentVariables`, re-runs `start-llm-proxy.sh`
from scratch, and respawns via launchd KeepAlive. Result shape preserved
for the dashboard "Restart" button consumer.

### Task 2 — auto-heal FSM + VPN/CN flap branch

`scripts/health-coordinator.js`:

- **`evaluateAutoHealFSM()`** added immediately after `pollProxySemantic`. Four
  states: `healthy` | `kickstart_pending` | `cooldown` | `disabled`.
  Transitions per D-06 + D-07.
- **`pollProxySemantic` body wrapped in `try { … } finally { evaluateAutoHealFSM(); }`** —
  every probe outcome (success, all four D-02 failure modes, throw)
  triggers exactly one FSM evaluation.
- **`pollProxyMode` networkMode flap branch** added: real-value-to-real-value
  transitions (`vpn` ↔ `public`) dispatch
  `restart_llm_cli_proxy` with `reason: 'networkMode-flip'`. Transitions
  involving `'unknown'` are noise and explicitly excluded. Flap kickstart
  does NOT push to `kickstart_timestamps` — the cooldown is for
  proxy-failure runaway, not for user-initiated network changes.
- **`/health/refresh` calls `evaluateAutoHealFSM()` directly** (deviation —
  see below) so D-07 kill-switch toggles take effect within the spec's 5s
  budget rather than the next 60s probe.

## Deviations from the plan

**`/health/refresh` direct FSM call.** The plan's Task 2(b) wires the FSM
into `pollProxySemantic` only. But `pollProxySemantic` is gated to run
every `PROXY_PROBE_INTERVAL_MS` (60s), while the D-07 acceptance gate
requires `auto_heal_status` to flip to `'disabled'` within one tick (5s)
of `POST /health/refresh`. To satisfy both: `evaluateAutoHealFSM()` is
called directly from the `/health/refresh` handler immediately after
`RULES = reloaded`. Two safety arguments:

1. The kill-switch branch (`rule.auto_heal !== true`) is a no-op increment-wise;
   it just sets `auto_heal_status = 'disabled'` and returns.
2. The recovery path (`semantic_ok === true`) is also no-op increment-wise;
   it resets `consecutive_failures = 0` and sets `'healthy'`.
3. The only path that increments `consecutive_failures` is the one where
   `semantic_ok === false`. A user-initiated `/health/refresh` while the
   proxy is failing causes one extra increment (~1 probe-interval worth)
   — bounded, not silent, and aligns with the user's intent to re-evaluate.

Verified live: kill-switch round-trip (flip → refresh → `disabled`;
restore → refresh → `healthy`) takes <1s end-to-end.

## Live verification

| Test | Status | Evidence |
|---|---|---|
| Task 1 dispatcher PID-change | **PASS** | `OLD_PID=67019` → `POST /health/remediate` → `success:true, message:"launchctl kickstart -k gui/502/com.coding.llm-cli-proxy dispatched"` → `NEW_PID=54631` after 8s sleep. |
| D-07 kill-switch round-trip | **PASS** | `auto_heal_status: healthy` → flip rule + refresh → `disabled` → restore + refresh → `healthy`. End-to-end <2s including curl latency. |
| `node --check` both files | **PASS** | Clean syntax on `health-coordinator.js` and `health-remediation-actions.js`. |
| Task 1 grep gate | **PASS** | `launchctl`, `kickstart`, `'-k'`, `process.getuid()`, `com.coding.llm-cli-proxy` all present in body; `lsof` and `spawn(` absent. |
| Task 2 grep gate | **PASS** | All 14 token checks (FSM function, all four states, kickstart push, both reasons, dispatcher invocation, finally block, FSM call site, RULES lookup, both constants) green. |
| **R3 networkMode flap kickstart** | **DEFERRED** | Requires forcing the proxy to publish `LLM_NETWORK_MODE=vpn` then flipping to `public` and restarting it. Disrupts the live proxy mid-session; deferred to operator window with the test plan recorded below. |
| **R4 cooldown after 3 kickstarts in 5min** | **DEFERRED** | Requires deliberately breaking copilot OAuth (`COPILOT_OAUTH_BAD=1`) so probes fail for 5+ minutes. Destructive — disrupts every consumer of the proxy for the duration. Deferred to operator window. |

## Deferred destructive tests — operator runbook

### R3 networkMode flap (SPEC AC #3)

```bash
# Get proxy plist's current LLM_NETWORK_MODE; default behaviour publishes
# 'public' on home wifi, 'vpn' once muc.proxy-pac.bmwgroup.net is reachable.
# Force a flip by toggling the env in the plist or via launchctl setenv,
# then kickstart the proxy.
launchctl setenv LLM_NETWORK_MODE vpn
launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"
# wait for state.proxy.networkMode = 'vpn'
sleep 10 && curl -fs http://localhost:3034/health/state | jq -r .proxy.networkMode
# now flip to public
launchctl setenv LLM_NETWORK_MODE public
launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"
# within 30s coordinator log MUST contain "networkMode flip vpn -> public, dispatching restart_llm_cli_proxy"
sleep 30 && tail -200 /Users/Q284340/Agentic/coding/.data/health-coordinator.log | grep "networkMode flip vpn -> public"
# clean up
launchctl unsetenv LLM_NETWORK_MODE
```

### R4 cooldown after 3 kickstarts (SPEC AC #4 + AC #5)

```bash
# Force semantic failures by breaking copilot auth path. Use a sentinel
# env that the proxy honours, OR if a test-inject endpoint is wired up
# (Phase 33 33-15 added /test/inject for coordinator slices, but proxy
# may not have an equivalent), patch the proxy's auth to return 401.
launchctl setenv COPILOT_OAUTH_BAD 1
launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"

# Wait ~70s for the first probe to fail, then watch the FSM
for i in 1 2 3 4 5 6; do
  sleep 70
  echo "round $i:"
  curl -fs http://localhost:3034/health/state | jq '.proxy | {auto_heal_status, kickstart_count, kickstart_timestamps_len: (.kickstart_timestamps | length), consecutive_failures}'
done
# After the 3rd kickstart attempt, auto_heal_status MUST be 'cooldown';
# kickstart_timestamps length MUST be 3; further probes still flip
# semantic_ok=false but DO NOT push to kickstart_timestamps.

# Clean up
launchctl unsetenv COPILOT_OAUTH_BAD
launchctl kickstart -k "gui/$(id -u)/com.coding.llm-cli-proxy"
# wait for cooldown window to slide past, semantic_ok=true → status returns to 'healthy'
```

## Phase 34 progress after this plan

| Plan | Status |
|---|---|
| 34-01 | ✅ landed on main (cherry-picked) |
| 34-02 | ✅ landed on main (cherry-picked) |
| **34-03** | **✅ this plan** — pending R3/R4 deferred tests |
| 34-04 | 🟡 work exists on `worktree-agent-a2ca353f2ad671350` — not yet on main (conflicts with this session's per-exchange tranche routing in ETM; needs manual merge) |
| 34-05 | ❌ not started — depends on 34-04 |
| 34-06 | ⏸ paused at Task 1 gate awaiting operator approval on plist cleanup approach |

## Threat-model notes

- `process.getuid()` consistently used; no hard-coded UID. `gui/$UID/...` targets user domain only — never `system/`. (T-34-03-01 mitigated.)
- Cooldown caps semantic-failure-driven kickstarts at 3/5min via sliding-window `kickstart_timestamps`. After cap, log WARN per probe-failure, no kickstart fires. (T-34-03-02 mitigated.)
- Flap kickstart is intentionally NOT cooldown-gated by design (rare, user-initiated). T-34-03-03 accepted; bounded by tick interval (~5s).
- All FSM transitions logged at INFO; cooldown engagement at WARN. Reason strings are bounded enums (`'semantic_ok=false sustained'`, `'networkMode-flip'`, `'manual-test'`, etc.) — no env / token leak. (T-34-03-05/06.)

## Commit IDs

- `<this commit>` — feat(34-03): auto-heal FSM + VPN/CN flap kickstart + restartLLMCLIProxy launchctl rewrite
