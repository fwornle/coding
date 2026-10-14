# Connectivity & Recovery

Every path an LLM call takes from a coding agent to a model, everything that has to be
up for it to arrive, and every mechanism that brings a broken path back on its own.
[Connectivity](../connectivity.md) is the same material as slides (also the
network button in the header).

## The paths

![Every path from a coding agent to a model, and what each hop needs](../images/agent-connectivity-paths.png)

All foreground and background LLM traffic goes through the **LLM proxy** on `:12435`. From
there a call goes:

- **directly** to the model host when the health coordinator reports you are at home
  (`open`);
- through the **local proxy** `:3128` (proxydetox) and the **corporate proxy** on VPN or in
  the office. proxydetox logs in to the corporate proxy with your **Kerberos ticket**;
- **directly** to the on-prem **Qwen cluster** for small calls on VPN or in the office: a
  private address always bypasses the proxy.

### Agent → LLM proxy

The launcher (`scripts/launch-agent-common.sh`, rules in `lib/agents/proxy-routing.mjs`)
wires each agent before it starts:

| Agent | Seam | Proxy route | Answered by |
|---|---|---|---|
| claude | `ANTHROPIC_BASE_URL=http://127.0.0.1:12435`; API keys unset | `POST /v1/messages`, a verbatim passthrough to `api.anthropic.com` | Claude subscription (Max OAuth) — **no provider fallback** |
| copilot | BYOK: `COPILOT_PROVIDER_BASE_URL=…/v1/copilot[/p/<project>][/b/<band>][/t/<task>]` | `/v1/copilot/chat/completions` → `fg-chat/copilot` | GitHub Copilot (`copilot-api.<tenant>.ghe.com`) |
| opencode | `OPENCODE_CONFIG_CONTENT` providers | `/v1/opencode/…/chat/completions` → `fg-chat/opencode` | GitHub Copilot |
| pi | `models.json` provider `rapid-proxy-pi` | `/v1/chat/completions` → `fg-chat/pi` | GitHub Copilot |

Before launch, the proxy's `/health` is probed 5 times, 2 s apart. If it never answers, the
launch **stops** with the command that restarts it: no silent unmeasured fallback.

Bypassing the proxy:

- `CODING_PROXY_ROUTE=off` (direct and unmeasured);
- `COPILOT_AMBIENT_ROUTE=0` (copilot talks to GitHub directly);
- pi's `qwen-laptop` provider (a local model server on `127.0.0.1:8081`);
- an agent started outside `coding`.

The agent's own non-LLM traffic (sign-in, GitHub API) uses the session's
`HTTPS_PROXY=http://127.0.0.1:3128`, with `NO_PROXY` for loopback and corporate hosts.

### LLM proxy → the model host

The egress pin (`rapid-llm-proxy/proxy-bridge/egress-decision.mjs`):

| Coordinator says | Pinned proxy answers | Decision |
|---|---|---|
| nothing (unreachable) | — | keep the current pin |
| `open` | — | direct |
| `corporate` / `vpn` | yes | keep it |
| `corporate` / `vpn` | no | hand over to another candidate that answers, else direct (**DEGRADED**) |
| `corporate` / `vpn`, nothing pinned | — | pin the first candidate that answers, else direct (**DEGRADED**) |

- **Candidates**, in order: `LLM_CORPORATE_PROXY_URL`, `HTTPS_PROXY`, `http://127.0.0.1:3128`,
  then the last proxy that worked.
- **Testing a candidate**: `curl --max-time 4 --proxy <candidate> https://api.github.com`.
  Nothing is pinned without passing this test.
- **When it decides again**:
  - every 30 s (`LLM_EGRESS_RECHECK_MS`);
  - at once on `POST /api/egress/reevaluate`, which is how the coordinator nudges it;
  - when a request through the pin fails to connect. That request is retried once if the
    pin moved.
- **Watching it**: transitions are logged as `egress DEGRADED` / `egress recovered`, and
  `/health` → `egress` shows the current pin.

Providers by network:

| Provider | Endpoint | open | VPN / office |
|---|---|---|---|
| Claude subscription (`claude-code-max`) | `api.anthropic.com` | yes | foreground passthrough only; not offered in fallback chains |
| GitHub Copilot (`gh-copilot`) | `copilot-api.<tenant>.ghe.com` | default for copilot, opencode, pi and background | same |
| OpenAI (`openai`) | `api.openai.com` | fallback | fallback |
| Qwen cluster (`qwen-local`) | `10.x` on-prem | never probed, never routed | small calls offloaded; re-probed every 60 s |

## What must be up

| Element | Runs as | Needed | Watched by | If it is missing |
|---|---|---|---|---|
| LLM proxy `:12435` | launchd `com.coding.llm-cli-proxy` / systemd `llm-cli-proxy.service`, always restarted | always | launcher gate; coordinator probes | launch stops; agent API errors |
| Health coordinator `:3034` | launchd `com.coding.health-coordinator` / systemd `health-coordinator.service`, always restarted | always | launchd / systemd | no network verdict (the proxy keeps its pin), no healing |
| Agent account | the agent's own login / keychain | always | the provider | the provider's auth error |
| Local proxy `:3128` | proxydetox: launchd socket activation on macOS, systemd user unit on Linux / WSL | VPN, office | coordinator: port + bare `CONNECT api.github.com:443` every 15 s | `P:OFF`; "fetch failed" |
| Kerberos ticket | macOS: Kerberos SSO extension · Linux / WSL: `kinit` · Windows: the logon | VPN, office | coordinator: `klist -s` | `K:NO`; 502 for every call |
| Corporate proxy | corporate infrastructure | VPN, office | the LLM proxy's egress test | 502 naming the proxy |
| Qwen cluster | on-prem | small calls on VPN, office | LLM proxy re-probe, 60 s | dropped from chains; Copilot answers |

The status line shows the network part as `N:{CN|VPN|OPEN} P:{ON|AUTO|OFF}`, with `K:NO` on CN /
VPN when the ticket is missing.

## By platform

coding runs on macOS, Linux and WSL 2 (on Windows, inside WSL); glass also runs natively on
Windows. The rules on this page hold everywhere — what differs is how a step is carried out.

| | macOS | Linux | WSL 2 | Windows (glass) |
|---|---|---|---|---|
| Keeps the LLM proxy and coordinator running | launchd, `KeepAlive` | systemd user units, `Restart=always` | systemd user units (systemd on in `/etc/wsl.conf`) | — |
| proxydetox, and its restart | launchd agent `cc.colorto.proxydetox`, socket-activated; `launchctl kickstart -k` | the `.deb`'s user unit `proxydetox.service`; `systemctl --user restart`. Anything else on `:3128` (cntlm, a hand-started binary) is left alone | as Linux, inside the distro | started from the Run key; glass never restarts it |
| VPN signal | Cisco `vpn state` | Cisco `vpn state` | the Windows host's `vpncli.exe state`, through interop | `vpncli.exe state` |
| PAC host lookup | `dig` | `dig`, else the OS resolver | `dig`, else the OS resolver | the OS resolver |
| Network-change events | `notifyutil` (configd) | `ip monitor`, container interfaces ignored | `ip monitor`; under the default NAT networking the host joining VPN is not visible, so the 15 s poll notices | none — the 15 s poll |
| Kerberos ticket check | `klist -s` | `klist -s` | `klist -s` — the distro's own cache, not the Windows logon's | not checked (Windows' `klist` has no `-s`); no `K:NO` |
| Missing ticket | asks the Kerberos SSO extension | `K:NO` until you run `kinit` | `K:NO` until you run `kinit` | Windows renews the logon's ticket |
| LLM proxy restart | `launchctl kickstart -k` | `systemctl --user try-restart` | as Linux | — |
| Launcher heals `:3128` | yes | yes, with the systemd unit | yes, with the systemd unit | — |

When the launcher cannot get proxydetox working it drops only its own `:3128` pin. A proxy you
set yourself — the usual Linux setup without proxydetox — is kept.

## Where am I?

The health coordinator (`scripts/health-coordinator.js`, probes in
`lib/network/location-probe.mjs`) decides the network:

1. **Signals.**
    - Cisco Secure Client `vpn state` reports connected → `vpn`.
    - The PAC host resolves: `vpn`, or `corporate` when it also answers in under 100 ms
      (physically on site).
    - Otherwise `open`.
2. **When it looks.**
    - Every 15 s.
    - At once on an OS network-change event (macOS `notifyutil`, Linux `ip monitor`;
      `lib/network/network-change-watcher.mjs`).
    - At once after waking from sleep.
3. **Hysteresis** (`lib/network/location-hysteresis.mjs`). Moving *to* VPN or corporate is
   immediate. Moving *to* open needs three readings in a row, unless the OS reported a change
   within the last 60 s.
4. **On a class change** (open ↔ VPN / corporate):
    - The coordinator nudges the LLM proxy to decide its egress again.
    - It marks one proxydetox restart as due if `:3128` does not forward.

## Recovery

![What breaks, who notices, what happens](../images/agent-connectivity-recovery.png)

| Failure | Noticed by | What happens | Guard | Where |
|---|---|---|---|---|
| You change networks | coordinator | egress nudge; one proxydetox restart if `:3128` does not forward | once per change, within 3 min of it | `health-coordinator.js`, `proxydetox-heal-decision.mjs` rule 3b |
| `:3128` not listening | coordinator | restart proxydetox: `launchctl kickstart -k cc.colorto.proxydetox` (bootstrap / load if unloaded), or `systemctl --user restart proxydetox.service`; a proxy that is neither is left alone (`proxydetox-restart.mjs`) | 45 s cooldown after any restart | rules 1b, 3 |
| `:3128` listening but not forwarding | coordinator | restart after 3 failed probes in a row | not while the network is changing, the host is offline, internal hosts still answer, or the ticket is missing | rules 4–6 |
| Kerberos ticket missing on CN / VPN | coordinator | macOS: asks the SSO extension, `app-sso -a <realm> -R -q`; Linux / WSL: `K:NO` until you run `kinit`. No proxydetox restart | at most every 2 min | `location-probe.mjs` `requestKerberosTicket`; rule 3a |
| Network blip, 502 / 503 / 504 | LLM proxy | up to 3 attempts (0, 300, 900 ms), before the first byte only; then `502 proxy forward failed after 3 attempts` | `LLM_PROXY_FORWARD_ATTEMPTS` | `anthropic-forward.mjs` |
| A request through the pin cannot connect | LLM proxy | egress decided again; retried once if the pin moved | one re-check at a time | `server.mjs` `proxyFetch` |
| Provider fails (quota, down, timeout, 5xx) | LLM proxy | next provider in `llm-fallback.yaml`; one same-provider retry on network errors | tools requests only to tools-capable providers | routing config |
| Qwen cluster unreachable | LLM proxy | dropped from every chain | re-probed every 60 s | `server.mjs` |
| LLM proxy wedged | coordinator | `launchctl kickstart -k com.coding.llm-cli-proxy`, or `systemctl --user try-restart llm-cli-proxy.service` | 60 s between restarts, at most 3 in 5 min; probes paused while you are away | `kickstart-gate.mjs` |
| `:3128` healed | coordinator | LLM proxy restarted to drop stale connections | at most every 10 min | `health-coordinator.js` |
| LLM proxy or coordinator exits | launchd / systemd | restarted | 10 s / 30 s apart (`ThrottleInterval`, `RestartSec`) | `launchd/*.plist`, `systemd/*.service` |
| LLM proxy down at launch | launcher | waits 5 × 2 s, then stops with the restart command | — | `proxy-routing.mjs` |
| `:3128` broken at launch | launcher | defers to the coordinator's cause; waits up to 20 s for a restart in progress; heals itself only if the coordinator blames the daemon or does not answer | one attempt | `detect-network.sh` `ensure_proxydetox_up` |

Every proxydetox decision is logged in `.logs/health-coordinator.log` with its cause, and
published in `/health/state` as `network.proxy_heal_cause`:

- `healthy`
- `restarting`
- `daemon`
- `no-ticket`
- `stale-after-change`
- `offline`
- `upstream`
- `network-change`
- `indeterminate`

## Diagnosing

```bash
coding --health                                    # everything, green or not
curl -s localhost:3034/health/state | jq .network   # location, ticket, heal cause
curl -s localhost:12435/health | jq .egress         # direct or which proxy, DEGRADED?
klist                                              # the Kerberos ticket
```

## Recently fixed

The research behind this page (2026-10-14) found four gaps. All are fixed now:

- **5 s healing probe interval.** The coordinator used to check `network.proxy_enabled`,
  which nothing ever set, so it always probed every 15 s. `networkProbeIntervalMs()` now
  probes every 5 s on CN / VPN while `:3128` does not forward or the ticket is missing.
- **claude CLI fallback proxy.** The `claude` subprocess used to inherit `HTTPS_PROXY` from
  the LLM proxy's startup. `buildClaudeEnv()` now sets it from the current egress pin
  (`subprocessProxyEnv()`).
- **Status-line network popup.** The popup used to list a fallback for `claude`.
  `/api/llm/routing/resolve` now names `transport: anthropic-passthrough` for
  `fg-chat/claude`, and the popup says "no fallback".
- **glass daemon proxy settings.** The glass daemon used to keep the proxy settings of the
  shell that started it. It now adopts those of each new `glass <agent>` session.
