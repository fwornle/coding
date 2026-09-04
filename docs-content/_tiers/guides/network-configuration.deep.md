How the Coding launcher handles corporate VPN, proxy detection, and agent-specific API routing.

---

## Overview

The Coding system operates in three network environments:

- **VPN** — connected to corporate network via VPN tunnel; proxy (proxydetox on `127.0.0.1:3128`) is running and required for external API calls
- **Corporate Network (CN)** — physically on the corporate network (e.g. office ethernet/Wi-Fi); proxy is running and required for external API calls
- **Home / Public Network** — direct internet access, no proxy needed

The **health coordinator** is the single source of truth for network state. It probes every **15 seconds** and exposes the result via `GET /health/state` → `network`. The launcher, status line, and LLM proxy all consume this endpoint — there is no independent detection elsewhere.

![Network-Aware Agent Selection](../images/network-aware-agent-selection.png)

---

## Connectivity Matrix

| Agent | Auth Method | Inside VPN (proxy) | Outside VPN (direct) |
|---|---|---|---|
| `coding --claude` | OAuth (Max subscription) | Works via proxy | Works direct |
| `coding --opencode` | Auto-selected | GH Copilot Enterprise via proxy | Anthropic direct |
| `coding --copilot` | VS Code Copilot token | Works via proxy | Works direct |

!!! info "OpenCode Model Switching"
    OpenCode automatically switches its LLM provider based on network location:

    - **VPN**: `github-copilot-enterprise/claude-opus-4.6` (free via corporate subscription)
    - **Public**: `claude-opus-4-6` (personal Anthropic API key or subscription)

---

## Detection Flow

### Unified Detection (Health Coordinator)

The coordinator (`scripts/health-coordinator.js`) is the **single authority** for network location. It probes every 15 seconds using three independent signals — evaluated in order, first match wins:

| Priority | Signal | Method | Result |
|----------|--------|--------|--------|
| 1 | **Cisco VPN CLI** | `/opt/cisco/secureclient/bin/vpn state` → output contains "Connected" | `vpn` |
| 2 | **utun interface** | `ifconfig` → any `utun*` with an `inet` address | `vpn` |
| 3 | **BMW internal DNS** | `dig +short muc.proxy-pac.bmwgroup.net` (spawns a fresh process — never stale) + TCP latency to resolved IP | `corporate` (<100 ms) or `vpn` (≥100 ms) |
| — | None match | DNS resolution fails entirely | `open` |

!!! warning "Why `dig` instead of Node.js `dns.Resolver`"
    Node.js caches the system DNS servers at process start. If the coordinator starts on a hotspot (public DNS like `8.8.8.8`) and the user later connects to the office LAN (corporate DNS `160.50.x.x`), `dns.getServers()` returns the **stale startup servers** — BMW internal hostnames can't resolve, and the coordinator reports `open` indefinitely. Spawning `dig` as a subprocess reads the current OS DNS config on every probe, eliminating this class of bugs.

### Launcher Bootstrap (`detect-network.sh`)

The startup script runs a **one-time** DNS-based check before the coordinator is available:

```bash
# DNS-based — works without proxy (no chicken-and-egg)
dig +short muc.proxy-pac.bmwgroup.net +timeout=2
dig +short cc-github.bmwgroup.net +timeout=2
```

If either resolves to a corporate IP → `INSIDE_CN=true`. This replaced the previous `curl https://cc-github.bmwgroup.net` approach, which required the proxy to already be configured (circular dependency on CN).

Once the coordinator is running, the launcher defers to `GET http://localhost:3034/health/state` for all subsequent network state.

![Network Detection Flow](../images/network-detection-flow.png)

### Startup Sequence

![Launcher Startup Sequence](../images/launcher-startup-sequence.png)

---

## Proxy Management

### The `px` Toggle

The `px` shell alias is the **only** way to toggle the proxy. It performs three actions atomically:

1. **Toggles the proxydetox daemon** via `launchctl unload`/`launchctl load` of the plist — this truly stops/starts the daemon and closes/opens port 3128 (previous implementations used `launchctl stop` which was ineffective due to launchd socket activation respawning the process immediately)
2. **Invalidates status line caches** — deletes all per-pane cache files so the next tmux render reflects the new state
3. **Notifies the health coordinator** — `POST /health/refresh` triggers an immediate network re-probe (bypasses the 15s poll interval)

```bash
px          # Toggle: if proxy running → stop; if stopped → start
```

### Update Propagation After `px`

![Proxy Toggle Flow](../images/proxy-toggle-flow.png)

The status line reflects the new P: state within **≤5 seconds** (one tmux refresh cycle):

| Step | Latency | Mechanism |
|------|---------|-----------|
| proxydetox stop/start | instant | `launchctl unload`/`load` |
| Cache invalidation | instant | `rm .logs/combined-status-line-cache-*.txt` |
| Coordinator re-probe | instant | `POST /health/refresh` resets rate-limiter + forces tick |
| tmux renders | ≤5s | `status-interval 5` picks up fresh state |

### LLM Proxy Dynamic Routing

The LLM proxy (`rapid-llm-proxy`, port 12435) dynamically adapts to proxy availability without restart:

- On each outbound request, `smartFetch()` TCP-probes port 3128 (with 5s cache)
- If proxydetox is **up** → routes via `undici.ProxyAgent` (corporate proxy)
- If proxydetox is **down** → routes via native `fetch` (direct internet)

This means `px off` on a hotspot (direct internet) works immediately — the LLM proxy stops trying to route through the dead proxy within 5 seconds.

### Proxy Auto-Heal

When the coordinator judges the LLM proxy unhealthy it can dispatch `launchctl kickstart`. Three rules constrain that, each added after an incident where the previous behaviour made things worse.

#### A failed probe is not a failed service

`probeHttpHealth`/`probeTcpPort` used to map every failure onto `stopped`, collapsing two facts that are not the same:

| Probe outcome | Actually evidence of |
|---|---|
| `ECONNREFUSED` | Nobody is listening — real evidence of death |
| `timeout` | Nothing at all — a slow target, a loaded machine, a saturated event loop, a network blip |

`lib/network/probe-result-semantics.mjs` softens a timed-out probe to `unknown` rather than `stopped`. `unknown` rather than the previous value, because a failed probe must never *assert* health — and asserting death on no evidence is the same mistake pointed the other way.

Observed twice before it was generalised: on 2026-08-09 the prompt hook reported "service obs_api stopped" about a service that never stopped, and on 2026-08-30 a two-minute host network outage produced `llm_cli_proxy stopped, obs_api stopped, db degraded` while all three were provably fine. Three simultaneous false negatives from one transient is a property of the probe semantics, not of any one service.

#### A proxy that cannot parse its config is not one a restart fixes

A config file that will not parse aborts proxy boot by design. Restarting it produces an identical failure, so the coordinator distinguishes this cause and does not spend a kickstart on it.

#### One incident spends one kickstart, not three

From the coordinator's own log on 2026-08-31:

```
07:02:52.046  proxy auto-heal: dispatching restart (consecutive_failures=1, kickstart_count=1)
07:02:52.063  proxy auto-heal: dispatching restart (consecutive_failures=2, kickstart_count=2)
07:02:52.114  proxy strong-probe escalation: dispatching restart  (kickstart_count=3)
07:04:34      proxy auto-heal cooldown engaged — 3 kickstarts in last 300s
```

One underlying failure, three restarts in 68 ms, and the whole budget spent before the first restart had finished — a genuine fault arriving in the next five minutes would have found no remediation left. At 07:04:33 a kickstart errored outright because the service was still mid-restart.

Two distinct faults produced that, and a debounce alone fixes only one:

1. **The cheap-probe FSM counted invocations, not probe outcomes.** It is called from three places, one of them every tick from `/health/refresh`. Every call while `semantic_ok` was false incremented the counter and, past the 60 s sustained gate, dispatched — two of the three restarts above are one FSM firing twice, 17 ms apart, off a single probe result. `isFreshProbeOutcome()` supplies the missing edge detection, keyed on `last_probe_end`: a caller arriving with the same stamp as last time is re-reading one conclusion, not observing a second failure.
2. **Five independent paths could each dispatch without knowing another just had** (cheap FSM, strong-probe escalation, passthrough frozen-502, `networkMode` flip, location mismatch). They shared a *count* cap and no *time* gate, so "3 in 5 minutes" was satisfiable in 68 ms. `decideKickstart()` is the shared gate.

`lib/network/kickstart-gate.mjs` holds both, as pure functions:

| Constant | Value | Why |
|---|---|---|
| `KICKSTART_MAX_IN_WINDOW` | 3 | Retry a genuine fault a few times |
| `KICKSTART_WINDOW_MS` | 5 min | The budget window |
| `KICKSTART_DEBOUNCE_MS` | 60 s | The cheap probe's interval, so consecutive dispatches are necessarily separated by at least one fresh observation of the restarted process |

A restart takes 3–8 s to come back and a probe cycle to prove anything, so a second dispatch inside that window cannot be acting on evidence about the new process — it is responding to the old one, or to the gap the restart itself created.

Both modules are pure (every input an argument; no env, no I/O, no clock) and live outside `health-coordinator.js`, which binds ports on import and therefore cannot be imported by a test. Covered by `tests/network/kickstart-gate.test.mjs`, which replays the 2026-08-31 cascade, and `tests/network/probe-result-semantics.test.mjs`.

### Inside VPN / Corporate Network

The corporate proxy (proxydetox) runs on `127.0.0.1:3128`. The launcher:

1. Checks if `HTTP_PROXY` is already set in the environment
2. If not, probes `127.0.0.1:3128` and auto-configures:

```bash
export HTTP_PROXY="http://127.0.0.1:3128"
export HTTPS_PROXY="http://127.0.0.1:3128"
export NO_PROXY="localhost,127.0.0.1,.bmwgroup.net"
```

All external API calls (Anthropic, GitHub, OpenAI) **require** this proxy when inside VPN/CN. Direct connections time out.

### Outside VPN (Public Network)

The launcher **clears** any proxy env vars inherited from shell profiles:

```bash
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
```

This prevents opencode/claude from trying to route through a non-existent proxy.

---

## Agent API Endpoints

Each agent validates its required API endpoint before launch:

| Agent | Required API | Endpoint Tested |
|---|---|---|
| Claude Code | Anthropic | `https://api.anthropic.com` |
| OpenCode (VPN) | GitHub Copilot | `https://api.github.com` |
| OpenCode (public) | Anthropic | `https://api.anthropic.com` |
| Copilot CLI | GitHub | `https://api.github.com` |

If validation fails, the launcher logs a warning but does not block startup (the agent may still work via cached tokens or fallback mechanisms).

---

## Testing & Debugging

### Dry Run

Test network detection without launching an agent:

```bash
coding --opencode --dry-run
coding --claude --dry-run
```

Output includes:
```
[OpenCode] 🏢 Inside Corporate Network (cc-github.bmwgroup.net reachable)
[OpenCode] Proxy active: http://127.0.0.1:3128/
[OpenCode] ✅ External access working (via proxy)
[OpenCode] DRY-RUN: Network: CN=true, Proxy=true, Required=true
[OpenCode] 🏢 VPN → GitHub Copilot Enterprise (claude-opus-4.6)
[OpenCode] ✅ GitHub API reachable (for Copilot provider)
```

### Force Network Mode

Override detection for testing:

```bash
# Simulate outside VPN
CODING_FORCE_CN=false coding --opencode --dry-run

# Simulate inside VPN
CODING_FORCE_CN=true coding --opencode --dry-run
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `N:OPEN` when on office LAN | Coordinator started on hotspot; stale DNS servers (pre-`dig` fix) or process running old code | Restart coordinator: `launchctl stop com.coding.health-coordinator && launchctl start com.coding.health-coordinator` |
| `P:ON` after `px off` | Pre-2026-07-26 badge showed daemon truth only | Fixed: badge is now three-state — `px off` with the daemon loaded renders `P:AUTO` (expected; the always-on daemon auto-DIRECTs off-CN). `P:OFF` now only means the daemon is down |
| Status line takes >10s to show P: change | Cache files not invalidated; coordinator not notified | Ensure `px` does `rm .logs/combined-status-line-cache-*.txt` AND `curl -s -X POST http://localhost:3034/health/refresh` |
| LLM proxy 500s after `px off` | Proxy dead but LLM proxy still routing through `ProxyAgent` | LLM proxy now has `smartFetch()` with 5s proxy-alive cache — recovers automatically |
| 502 Bad Gateway in OpenCode | Proxy interfering with streaming API | Check proxydetox is running: `lsof -i :3128` |
| All API calls timeout (000) | Inside VPN/CN without proxy | Run `px` to start proxydetox, or set `HTTP_PROXY` |
| "Credit balance too low" | Using API key instead of OAuth | Log in via `claude auth login` for Max subscription |
| OpenCode uses wrong model | Network detection mismatch | Use `--dry-run` to check, or `CODING_FORCE_CN=true/false` |
| Semantic readiness yellow (brain badge) | `processOverrides` routing health-coordinator through `claude-code` (slow subprocess) | Set override to `copilot`: `curl -X POST http://localhost:12435/api/llm/settings -H 'Content-Type: application/json' -d '{"settings":{"processOverrides":{"health-coordinator":{"provider":"copilot"}}}}'` |

---

## Environment Variables

| Variable | Set By | Purpose |
|---|---|---|
| `HTTP_PROXY` / `HTTPS_PROXY` | detect-network.sh | Route traffic through corporate proxy |
| `NO_PROXY` | detect-network.sh | Bypass proxy for local/internal hosts |
| `INSIDE_CN` | detect-network.sh | `true` when on corporate VPN |
| `PROXY_WORKING` | detect-network.sh | `true` when external APIs are reachable |
| `PROXY_REQUIRED` | detect-network.sh | `true` when proxy is needed (= inside CN) |
| `CODING_FORCE_CN` | User override | Force `true`/`false` to skip detection |
| `OPENCODE_CONFIG_CONTENT` | opencode.sh | JSON config for model/provider selection |

---

## Health Coordinator Network State

The coordinator exposes live network state at `GET http://localhost:3034/health/state` → `network`:

```json
{
  "network": {
    "internet_reachable": true,
    "proxy_running": true,
    "proxy_functional": true,
    "proxy_port_listening": true,
    "location": "vpn",
    "last_check": "2026-05-29T07:48:52.982Z",
    "last_probe_end": "2026-05-29T07:48:52.980Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `internet_reachable` | boolean | Whether external endpoints are reachable (via proxy or direct) |
| `proxy_running` | boolean | Whether proxydetox process is alive |
| `proxy_functional` | boolean | Whether CONNECT through proxy succeeds |
| `proxy_port_listening` | boolean | Whether port 3128 accepts TCP connections |
| `location` | string | `vpn`, `corporate`, `open`, or `unknown` |
| `last_probe_end` | ISO string | Timestamp of last completed network probe |

The `POST /health/refresh` endpoint triggers an immediate network re-probe (resets the rate-limiter so the probe runs on the next tick, regardless of the 15s interval).

The dashboard's **LLM Proxy Health** card and the statusline's `[N:xx]` / `[P:xx]` badges both consume this state. **N** reflects `location`; **P** reflects `proxy_port_listening` (binary ON/OFF — there is no ERR state).
