How the Coding launcher, the health coordinator and the LLM proxy handle the corporate VPN,
the local proxy and each agent's API traffic. [Connectivity & Recovery](../architecture/connectivity.md)
has the full path map and every recovery mechanism in one place.

---

## Overview

The Coding system operates in three network environments:

- **VPN** — connected to the corporate network through the Cisco VPN; external APIs need the
  corporate proxy.
- **Corporate Network (CN)** — physically on the corporate network (office LAN / Wi-Fi);
  external APIs need the corporate proxy.
- **Home / public network** — direct internet access.

Everything reaches the corporate proxy through **proxydetox** on `127.0.0.1:3128`, which logs in
with your **Kerberos ticket**. It runs on every network: off the corporate network it goes
DIRECT (`--direct-fallback`), so a session pinned to it is correct everywhere, including
mid-session network changes.

The **health coordinator** (`:3034`) is the single authority on where you are. It probes every
15 s (5 s while the corporate path is broken), at once on a macOS network-change event and after
sleep, and publishes the result at `GET /health/state` → `network`. The status line, the LLM
proxy and the launcher read it rather than detecting independently.

![Network-Aware Agent Selection](../images/network-aware-agent-selection.png)

---

## Connectivity Matrix

Every agent's LLM traffic goes to the LLM proxy on `:12435`; the proxy decides the route and the
egress. Which network you are on changes the *egress*, not the agent's configuration.

| Agent | Into the LLM proxy | Answered by | At home | On VPN / CN |
|---|---|---|---|---|
| `coding --claude` | `ANTHROPIC_BASE_URL`, `/v1/messages` passthrough | Claude subscription (Max OAuth) | direct | via `:3128` → corporate proxy |
| `coding --copilot` | BYOK, `/v1/copilot` | GitHub Copilot | direct | via `:3128` → corporate proxy |
| `coding --opencode` | provider config, `/v1/opencode` | GitHub Copilot | direct | via `:3128` → corporate proxy |
| `coding --pi` | provider config, `/v1` | GitHub Copilot | direct | via `:3128` → corporate proxy |

Small background calls (and small foreground ones) are offloaded to the on-prem Qwen cluster on
VPN / CN; a private address always bypasses the proxy. The agent's own non-LLM traffic (sign-in,
GitHub API) uses the session's `HTTPS_PROXY=http://127.0.0.1:3128`.

---

## Detection Flow

### Unified Detection (Health Coordinator)

The coordinator (`scripts/health-coordinator.js`, probes in `lib/network/location-probe.mjs`)
decides `location` from three probes:

| Probe | Method | Result |
|-------|--------|--------|
| **Cisco VPN CLI** | `/opt/cisco/secureclient/bin/vpn state` reports `state: Connected` | `vpn` |
| **PAC host DNS** | `dig +short muc.proxy-pac.bmwgroup.net` (fresh subprocess; getaddrinfo fallback) | resolves → corporate or VPN, see below |
| **On-site latency** | only if the PAC host resolved and there is no VPN tunnel: TCP connect to it on :80 | < 100 ms → `corporate`, else `vpn` |
| — | nothing resolves | `open` |

**Hysteresis** (`lib/network/location-hysteresis.mjs`): moving *to* VPN / CN is immediate; moving
*to* `open` needs three consecutive readings (~45 s), unless macOS reported a network change in
the last 60 s. A short DNS blip therefore does not flip the badge or the proxy's egress.

**When it looks again** — besides the 15 s timer:

- a macOS network-change event (`notifyutil`, `lib/network/network-change-watcher.mjs`);
- waking from sleep;
- `POST /health/refresh` (what `px` sends).

On a change between `open` and VPN / CN, the coordinator **nudges the LLM proxy** to re-decide
its egress at once (`POST :12435/api/egress/reevaluate`). If `:3128` then still does not
forward, it **restarts proxydetox once**, unless the Kerberos ticket is missing.

!!! warning "Why `dig` instead of Node.js `dns.Resolver`"
    Node.js caches the system DNS servers at process start. If the coordinator starts on a hotspot (public DNS like `8.8.8.8`) and the user later connects to the office LAN (corporate DNS `160.50.x.x`), `dns.getServers()` returns the **stale startup servers** — BMW internal hostnames can't resolve, and the coordinator reports `open` indefinitely. Spawning `dig` as a subprocess reads the current OS DNS config on every probe, eliminating this class of bugs.

`utun` interfaces are no longer a signal; older versions of this page listed them.

### Launcher Bootstrap (`detect-network.sh`)

The launcher runs a **one-time** DNS-based check, so it works before the coordinator answers:

```bash
# DNS-based — works without proxy (no chicken-and-egg)
dig +short +timeout=2 +tries=1 muc.proxy-pac.bmwgroup.net
dig +short +timeout=2 +tries=1 cc-github.bmwgroup.net
```

If either resolves to an IP → `INSIDE_CN=true`; otherwise it asks the coordinator. Then it pins
the session's proxy environment (next section) and checks that the agent's API is reachable.

![Network Detection Flow](../images/network-detection-flow.png)

### Startup Sequence

![Launcher Startup Sequence](../images/launcher-startup-sequence.png)

---

## Proxy Management

### The session's proxy environment

Every agent session is pinned to proxydetox, on every network:

```bash
export HTTP_PROXY="http://127.0.0.1:3128"  HTTPS_PROXY="http://127.0.0.1:3128"
export http_proxy="http://127.0.0.1:3128"  https_proxy="http://127.0.0.1:3128"
export NO_PROXY="localhost,127.0.0.1,::1,.bmwgroup.net"
```

Before pinning, `ensure_proxydetox_up` makes sure `:3128` actually answers. If it does not, it
asks the coordinator why (`network.proxy_heal_cause`) and defers when the coordinator is already
on it — a restart in progress, a network still changing, a missing Kerberos ticket — rather than
restarting proxydetox on top of it. Only if proxydetox cannot be brought up is the session left
direct: correct off-CN, and on CN a loud warning, since nothing pinnable would work either.

### The `px` toggle

`px` (`source ~/proxy.sh`) toggles **your shell's** proxy setting and records the intent in
`~/.bash_profile` (an uncommented `http_proxy=` line). It does **not** stop proxydetox any
more: agent sessions are pinned to `:3128`, and unloading it broke `/login` and every egress in
running sessions.

```bash
px          # toggle: on → loads proxydetox if needed, sets the shell env; off → clears the shell env
px s        # status: intent, port 3128, shell env
```

The intent is what `P:` shows: `P:ON` (proxydetox working, `px` on) or `P:AUTO` (working, `px`
off). `P:OFF` means proxydetox is down or cannot open a tunnel, whatever `px` says.

![Proxy Toggle Flow](../images/proxy-toggle-flow.png)

The status line reflects a toggle within **≤5 seconds**:

| Step | Latency | Mechanism |
|------|---------|-----------|
| Shell env + `~/.bash_profile` intent | instant | `px` |
| proxydetox loaded (`px` on only) | instant | `launchctl load` if not running |
| Cache invalidation | instant | `rm .logs/combined-status-line-cache-*.txt` |
| Coordinator re-probe | instant | `POST /health/refresh` |
| tmux renders | ≤5s | `status-interval 5` picks up fresh state |

### LLM Proxy Egress

The LLM proxy (`rapid-llm-proxy`, `:12435`) keeps an **egress pin** and moves it at runtime, no
restart needed (`proxy-bridge/egress-decision.mjs`):

| Coordinator says | Decision |
|---|---|
| `open` | direct |
| `vpn` / `corporate` | the first candidate proxy that passes `curl --proxy <p> https://api.github.com` (4 s): `LLM_CORPORATE_PROXY_URL`, `HTTPS_PROXY`, `http://127.0.0.1:3128`, the last one that worked; none → direct, logged as **egress DEGRADED** |
| no answer | keep the current pin |

It decides again every 30 s, at once on the coordinator's nudge, and when a request through the
pin fails to connect (that request is retried once if the pin moved). A private address — the
Qwen cluster — always goes direct. `curl -s localhost:12435/health | jq .egress` shows the pin.

### Kerberos

proxydetox logs in to the corporate proxy with your Kerberos ticket (Negotiate). Without one,
every tunnel is refused: a 502 for every call, `K:NO` in the status line. The ticket lasts about
10 hours, so one that expired overnight off the network is the common case on joining VPN.

On VPN / CN with no ticket (`klist -s` fails), the coordinator asks the macOS Kerberos SSO
extension for one (`app-sso -a <realm> -R -q`, at most every 2 minutes) instead of restarting
proxydetox, which cannot help. Measured: ~12 s, against 2 min 20 s for macOS on its own. With
no password in the keychain, the extension shows its own login dialog.

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

---

## Agent API Endpoints

After pinning, the launcher checks that the agent's API answers. A failure is a warning, not a
blocker (the agent may still work through the proxy's fallbacks):

| Agent | Endpoint Tested |
|---|---|
| Claude Code | `https://api.anthropic.com` |
| OpenCode (inside CN) | `https://api.github.com` |
| OpenCode (outside CN) | `https://api.anthropic.com` |
| Copilot CLI | `https://api.github.com` |

---

## Testing & Debugging

### Dry Run

Test network detection without launching an agent:

```bash
coding --claude --dry-run
```

Output includes:

```
[Claude] 🏢 Inside Corporate Network (PAC DNS resolves to 160.50.180.101)
[Claude] ✅ Session pinned to local adaptive proxy http://127.0.0.1:3128 (survives CN/VPN/home transitions)
[Claude] ✅ External access working (via proxy)
[Claude] DRY-RUN: Network: CN=true, Proxy=true, Required=true
```

### Force Network Mode

Override the launcher's detection for testing (the coordinator is unaffected):

```bash
CODING_FORCE_CN=false coding --opencode --dry-run   # simulate outside CN
CODING_FORCE_CN=true  coding --opencode --dry-run   # simulate inside CN
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `502 proxy forward failed after 3 attempts` right after joining VPN, `K:NO` | No Kerberos ticket (expired overnight) | Wait ~15 s for the automatic request, or run `klist` / the Kerberos SSO menu |
| Same 502, ticket present, `P:OFF` | proxydetox stale after the network change | The coordinator restarts it (once per change, 45 s apart); `tail .logs/health-coordinator.log` shows the cause |
| Every call fails on VPN with "fetch failed", `egress DEGRADED` in the proxy log | No proxy answered the LLM proxy's egress test | Fix `:3128` (above); the pin follows within 30 s, or at once on the coordinator's nudge |
| `N:OPEN` when on office LAN | Coordinator running old code, or the PAC host does not resolve | `launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator`; check `dig +short muc.proxy-pac.bmwgroup.net` |
| `P:AUTO` instead of `P:ON` | `px` is off — expected; proxydetox still serves every session | `px` if you want your shell's own commands proxied too |
| Status line slow to show a `px` change | Caches not invalidated, or the coordinator not told | `px` does both; otherwise `curl -s -X POST localhost:3034/health/refresh` |
| "Credit balance too low" | Using an API key instead of OAuth | `claude auth login` for the Max subscription |
| OpenCode reaches the wrong API at launch | Launcher detection mismatch | `--dry-run` to check, or `CODING_FORCE_CN=true/false` |

---

## Environment Variables

| Variable | Set By | Purpose |
|---|---|---|
| `HTTP_PROXY` / `HTTPS_PROXY` (+ lowercase) | detect-network.sh | Pin the session to proxydetox `:3128` |
| `NO_PROXY` | detect-network.sh | Keep loopback services and corporate hosts direct |
| `INSIDE_CN` | detect-network.sh | `true` on VPN / CN (launcher's own check) |
| `PROXY_WORKING` | detect-network.sh | `true` when external APIs are reachable |
| `PROXY_REQUIRED` | detect-network.sh | `true` when the corporate proxy is needed (= inside CN) |
| `CODING_FORCE_CN` | User override | Force `true`/`false` to skip the launcher's detection |
| `HEALTH_PROXY_PROBE_HOST` | User override | Host the `P:` probe opens a tunnel to (default `api.github.com`) |
| `LLM_EGRESS_RECHECK_MS` | User override | How often the LLM proxy re-decides its egress (default 30 s) |

---

## Health Coordinator Network State

The coordinator exposes live network state at `GET http://localhost:3034/health/state` → `network`:

```json
{
  "network": {
    "location": "vpn",
    "location_demotion_pending": 0,
    "proxy_port_listening": true,
    "proxy_running": true,
    "proxy_functional": true,
    "proxy_enabled_by_user": false,
    "consecutive_functional_failures": 0,
    "kerberos_ticket": true,
    "proxy_heal_cause": "healthy",
    "proxy_heal_reason": "a request through :3128 reached the internet",
    "internet_reachable": true,
    "last_network_change_at": 1792044460000,
    "last_probe_end": "2026-10-14T07:41:12.408Z"
  }
}
```

| Field | Description |
|-------|-------------|
| `location` | `vpn`, `corporate`, `open` or `unknown` |
| `location_demotion_pending` | readings toward `open` still being confirmed (hysteresis) |
| `proxy_port_listening` | `:3128` accepts TCP connections |
| `proxy_functional` | a bare `CONNECT api.github.com:443` through `:3128` answered 200 (debounced over 3 failures) |
| `proxy_enabled_by_user` | the `px` intent (`ON` vs `AUTO`) |
| `kerberos_ticket` | `klist -s`: `true`, `false`, or `null` when it cannot be told |
| `proxy_heal_cause` / `proxy_heal_reason` | the last proxydetox heal verdict: `healthy`, `restarting`, `daemon`, `no-ticket`, `stale-after-change`, `offline`, `upstream`, `network-change`, `indeterminate` |
| `last_network_change_at` | last macOS network-change event (ms) |
| `last_probe_end` | last completed network probe |

`POST /health/refresh` triggers an immediate re-probe.

The status line renders this as `N:{CN|VPN|OPEN|??} P:{ON|AUTO|OFF}` plus `K:NO` on VPN / CN
without a ticket. **N** reflects `location`; **P** combines `proxy_functional` with
`proxy_enabled_by_user`.
