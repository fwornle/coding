# Health Monitoring

## Overview

The coding system uses a multi-layered health monitoring architecture to ensure
all services remain operational. The health coordinator is the central component,
running as a launchd-managed daemon (`com.coding.health-coordinator`) that
continuously monitors services, network connectivity, and proxy health.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 tmux Status Line                │
│  N:OPEN/CN  P:ON/OFF  C:●  LLM:●  SEM:●       │
└──────────────────────┬──────────────────────────┘
                       │ polls every 5s
                       ▼
┌─────────────────────────────────────────────────┐
│            Health Coordinator (:3034)            │
│  - Service health checks                        │
│  - Network/proxy monitoring                     │
│  - Auto-heal (proxy kickstart)                  │
│  - Sleep/wake detection                         │
└──────┬──────────┬──────────┬───────────┬────────┘
       ▼          ▼          ▼           ▼
   Docker    Proxydetox   LLM Proxy   Semantic
  Services   (:3128)      (:12435)    Analysis
                                      (:3848)
```

## Health Coordinator

- **Endpoint:** `http://localhost:3034`
- **Tick interval:** 5 seconds
- **Managed by:** launchd (`com.coding.health-coordinator`)

### Monitored Systems

| System | Check | Indicator |
|--------|-------|-----------|
| Docker services | Container health via Docker API | C:● |
| Proxy (Proxydetox) | Functional probe via `api.github.com` | P:ON/OFF |
| LLM CLI Proxy | Provider availability check | LLM:● |
| Semantic Analysis | SSE endpoint liveness | SEM:● |
| Network | DNS probe for CN detection | N:OPEN/CN |

### Status Colors

| Color | Meaning |
|-------|---------|
| Green (●) | All checks passing |
| Yellow (●) | Degraded — service running but not fully functional |
| Red (●) | Down or unreachable |

## Proxy Auto-Heal

The health coordinator automatically recovers from proxy failures caused by
sleep/wake cycles or network transitions.

![Proxy Auto-Heal Sequence](../images/proxy-auto-heal-sequence.png)

See [Network Configuration — Auto-Heal](../guides/network-configuration.md#auto-heal-proxy-recovery)
for details on each scenario.

### Failure Modes

| Failure | Cause | Detection | Recovery |
|---------|-------|-----------|----------|
| Stale socket | Sleep/wake, launchd socket not re-bound | Port 3128 not responding | `launchctl kickstart -k` Proxydetox |
| Broken proxy | VPN disconnect, PAC fetch fails mid-session | Functional probe fails (port alive but requests error) | `launchctl kickstart -k` Proxydetox |
| Stale LLM proxy | Network change, HTTP connections held to old route | Semantic probe fails after proxy heal | `launchctl kickstart -k` LLM proxy |

### Recovery Timing

| Phase | Duration |
|-------|----------|
| Detect proxy broken (functional probe) | 5s (next tick) |
| Kickstart Proxydetox + verify | ~3s |
| Detect LLM stale (immediate re-probe) | 0s (forced) |
| Kickstart LLM proxy + verify | ~3s |
| **Total end-to-end recovery** | **~10s** |

### Sleep/Wake Detection

The coordinator compares timestamps between ticks. If the gap exceeds 15 seconds
(normal is 5s), it infers a wake-from-sleep event and forces an immediate
network re-probe and proxy health check.

## Service Management

All critical services are managed by launchd with auto-respawn:

| Label | Service | Logs |
|-------|---------|------|
| `com.coding.health-coordinator` | Health Coordinator | `.logs/health-coordinator.log` |
| `com.coding.obs-api` | Observation API | `.logs/obs-api.log` |
| `com.coding.llm-cli-proxy` | LLM CLI Proxy | `.logs/llm-cli-proxy.log` |
| `com.coding.lsl-resolver` | LSL Resolver | `.logs/lsl-resolver.log` |
| `com.coding.etm` | Event-Trace Monitor | `.logs/etm.log` |

### Common Commands

```bash
# List all coding services
launchctl list | grep com.coding

# Restart a service
launchctl kickstart -k gui/$(id -u)/com.coding.health-coordinator

# Check service logs
tail -f .logs/health-coordinator.log
```
