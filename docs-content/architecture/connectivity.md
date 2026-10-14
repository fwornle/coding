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
| LLM proxy `:12435` | launchd `com.coding.llm-cli-proxy`, KeepAlive | always | launcher gate; coordinator probes | launch stops; agent API errors |
| Health coordinator `:3034` | launchd `com.coding.health-coordinator`, KeepAlive | always | launchd | no network verdict (the proxy keeps its pin), no healing |
| Agent account | the agent's own login / keychain | always | the provider | the provider's auth error |
| Local proxy `:3128` | proxydetox, launchd socket activation (started on demand) | VPN, office | coordinator: port + bare `CONNECT api.github.com:443` every 15 s | `P:OFF`; "fetch failed" |
| Kerberos ticket | macOS Kerberos SSO extension | VPN, office | coordinator: `klist -s` | `K:NO`; 502 for every call |
| Corporate proxy | corporate infrastructure | VPN, office | the LLM proxy's egress test | 502 naming the proxy |
| Qwen cluster | on-prem | small calls on VPN, office | LLM proxy re-probe, 60 s | dropped from chains; Copilot answers |

The status line shows the network part as `N:{CN|VPN|OPEN} P:{ON|AUTO|OFF}`, with `K:NO` on CN /
VPN when the ticket is missing.

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
    - At once on a macOS network-change event (`notifyutil`, `lib/network/network-change-watcher.mjs`).
    - At once after waking from sleep.
3. **Hysteresis** (`lib/network/location-hysteresis.mjs`). Moving *to* VPN or corporate is
   immediate. Moving *to* open needs three readings in a row, unless macOS reported a change
   within the last 60 s.
4. **On a class change** (open ↔ VPN / corporate):
    - The coordinator nudges the LLM proxy to decide its egress again.
    - It marks one proxydetox restart as due if `:3128` does not forward.

## Recovery

![What breaks, who notices, what happens](../images/agent-connectivity-recovery.png)

| Failure | Noticed by | What happens | Guard | Where |
|---|---|---|---|---|
| You change networks | coordinator | egress nudge; one proxydetox restart if `:3128` does not forward | once per change, within 3 min of it | `health-coordinator.js`, `proxydetox-heal-decision.mjs` rule 3b |
| `:3128` not listening | coordinator | `launchctl kickstart -k cc.colorto.proxydetox` (bootstrap / load if unloaded) | 45 s cooldown after any restart | rules 1b, 3 |
| `:3128` listening but not forwarding | coordinator | restart after 3 failed probes in a row | not while the network is changing, the host is offline, internal hosts still answer, or the ticket is missing | rules 4–6 |
| Kerberos ticket missing on CN / VPN | coordinator | asks macOS: `app-sso -a <realm> -R -q`; no proxydetox restart | at most every 2 min | `location-probe.mjs` `requestKerberosTicket`; rule 3a |
| Network blip, 502 / 503 / 504 | LLM proxy | up to 3 attempts (0, 300, 900 ms), before the first byte only; then `502 proxy forward failed after 3 attempts` | `LLM_PROXY_FORWARD_ATTEMPTS` | `anthropic-forward.mjs` |
| A request through the pin cannot connect | LLM proxy | egress decided again; retried once if the pin moved | one re-check at a time | `server.mjs` `proxyFetch` |
| Provider fails (quota, down, timeout, 5xx) | LLM proxy | next provider in `llm-fallback.yaml`; one same-provider retry on network errors | tools requests only to tools-capable providers | routing config |
| Qwen cluster unreachable | LLM proxy | dropped from every chain | re-probed every 60 s | `server.mjs` |
| LLM proxy wedged | coordinator | `launchctl kickstart -k com.coding.llm-cli-proxy` | 60 s between restarts, at most 3 in 5 min; probes paused while you are away | `kickstart-gate.mjs` |
| `:3128` healed | coordinator | LLM proxy restarted to drop stale connections | at most every 10 min | `health-coordinator.js` |
| LLM proxy or coordinator exits | launchd | restarted | `ThrottleInterval` 10 s / 30 s | `launchd/*.plist` |
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

## Known gaps

- **5 s healing probe interval never applies.** The coordinator checks
  `network.proxy_enabled`, which is never written (the field is
  `proxy_enabled_by_user`), so it stays at 15 s.
- **The claude CLI fallback can use a stale proxy.** When the Max token is rejected, the
  LLM proxy falls back to a claude CLI subprocess, which inherits `HTTPS_PROXY` from
  startup. The runtime egress pin only moves the proxy's own connections.
- **The status-line network popup overstates claude's fallback.** It lists a fallback for
  `claude`, but foreground claude is a passthrough with none.
