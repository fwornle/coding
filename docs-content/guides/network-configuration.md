# Network Configuration

How the Coding launcher handles corporate VPN, proxy detection, and agent-specific API routing.

---

## Overview

The Coding system operates in three network environments:

- **VPN** — connected to corporate network via VPN tunnel; proxy (proxydetox on `127.0.0.1:3128`) is running and required for external API calls
- **Corporate Network (CN)** — physically on the corporate network (e.g. office ethernet/Wi-Fi); PAC URL resolves but proxy is not needed
- **Home / Public Network** — direct internet access, no proxy needed

The launcher automatically detects the environment and configures each agent accordingly. The health coordinator also tracks the network state and exposes it via `/health/state` → `network` slice.

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

### Launcher Detection (`detect-network.sh`)

The detection runs early in the startup pipeline, before any agent-specific configuration:

1. **Corporate network probe** — `curl https://cc-github.bmwgroup.net` (2s timeout)
2. **Proxy configuration**:
    - Inside CN/VPN: verify/auto-configure proxydetox (`127.0.0.1:3128`)
    - Outside CN: **clear** proxy env vars (`unset HTTP_PROXY HTTPS_PROXY`)
3. **Connectivity test** — verify the chosen API endpoint is actually reachable
4. **Agent model selection** — OpenCode picks GitHub Copilot or Anthropic

### Coordinator Network Detection (`health-coordinator.js`)

The health coordinator independently detects the network environment on every tick and exposes it in the `/health/state` response under the `network` key. The detection logic distinguishes three states:

| Condition | Location | Rationale |
|-----------|----------|-----------|
| PAC URL resolves **AND** proxy running | `vpn` | On VPN — the proxy is only needed when tunnelling in remotely |
| PAC URL resolves **AND** proxy NOT running | `corporate` | Physically on the corporate network — proxy not required |
| PAC URL does NOT resolve | `home` | Off-network — direct internet |

The `network` slice is consumed by the dashboard's **LLM Proxy Health** card and the statusline's `[N:xx]` / `[P:xx]` badges.

### Startup Sequence

![Launcher Startup Sequence](../images/launcher-startup-sequence.png)

---

## Proxy Configuration

### Inside VPN (Corporate Network)

The corporate proxy (proxydetox) runs on `127.0.0.1:3128`. The launcher:

1. Checks if `HTTP_PROXY` is already set in the environment
2. If not, probes `127.0.0.1:3128` and auto-configures:

```bash
export HTTP_PROXY="http://127.0.0.1:3128"
export HTTPS_PROXY="http://127.0.0.1:3128"
export NO_PROXY="localhost,127.0.0.1,.bmwgroup.net"
```

All external API calls (Anthropic, GitHub, OpenAI) **require** this proxy when inside VPN. Direct connections time out.

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
| 502 Bad Gateway in OpenCode | Proxy interfering with streaming API | Check proxydetox is running: `lsof -i :3128` |
| All API calls timeout (000) | Inside VPN without proxy | Start proxydetox or set `HTTP_PROXY` |
| "Credit balance too low" | Using API key instead of OAuth | Log in via `claude auth login` for Max subscription |
| OpenCode uses wrong model | Network detection mismatch | Use `--dry-run` to check, or `CODING_FORCE_CN=true/false` |

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
    "location": "vpn",
    "last_check": "2026-05-14T10:48:52.982Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `internet_reachable` | boolean | Whether external endpoints (PAC URL) are reachable |
| `proxy_running` | boolean | Whether proxydetox is listening on `:3128` |
| `location` | string | `vpn`, `corporate`, `home`, or `unknown` |

The dashboard's **LLM Proxy Health** card reads this state and displays Internet reachability, proxy status, and network location. The statusline renders `[N:VPN]` / `[N:CN]` / `[N:HM]` and `[P:ON]` / `[P:OFF]` from the same data.
