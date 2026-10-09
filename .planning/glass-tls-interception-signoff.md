# Request for IT-security sign-off: local TLS interception in glass

**Requested by:** Frank Wörnle · **Tool:** glass v0.1.2 ([AIMAAD/glass](https://bmw.ghe.com/AIMAAD/glass), private) · **Date:** 2026-10-09

## 1. What we ask

Approval to use **local TLS interception of AI model API hosts** on developer machines,
performed by glass (a token-measurement tool for coding agents), within the scope and
safeguards below. If approval needs conditions, we would like to know them; section 8
lists the parts we can change.

Until a decision, glass offers `--no-intercept` per run and the request can be scoped to
it (section 7).

## 2. What glass is and why it intercepts

glass measures how many tokens coding agents use (GitHub Copilot CLI, OpenCode, pi,
Claude Code) and what fills their context window. Users put `glass` in front of the
agent (`glass copilot …`); a local background process (the daemon) records each model
call's token counts.

- **Claude Code** needs no interception: it accepts a base URL (`ANTHROPIC_BASE_URL`) and
  sends its calls to the daemon over plain HTTP on 127.0.0.1.
- **Copilot CLI, OpenCode, pi** cannot be pointed at another endpoint without giving up
  their own login (Copilot / GitHub OAuth). The only way to see their per-call token
  usage without borrowing their credentials is to read their HTTPS traffic to the model
  host. Their own telemetry is incomplete (Copilot CLI ≥ 1.0.63 writes only session
  totals; pi has none).

## 3. How the interception works — scope

| Property | Implementation |
|---|---|
| Who is intercepted | Only agent processes started by `glass <agent>`. glass sets `HTTPS_PROXY` (pointing at the daemon) and `NODE_EXTRA_CA_CERTS` (glass's CA) **in that process's environment only**, for that run. No shell profile, agent configuration, system proxy or OS trust store is changed. |
| What is decrypted | Only these hosts: `copilot-api.*.ghe.com`, `api.githubcopilot.com`, `api.*.githubcopilot.com`, `api.openai.com`, `api.anthropic.com` (`*` = exactly one DNS label). |
| Everything else | Tunnelled byte-for-byte (blind CONNECT), never decrypted — GitHub, package registries, MCP servers, any other host. |
| What is done with decrypted calls | Forwarded unchanged to the real host; the response is streamed back unchanged. Token counts and a context-size breakdown are read from the request / response and stored locally (section 5). |
| Upstream connection | A new TLS connection to the real host, **verified** against the system roots plus the user's own `NODE_EXTRA_CA_CERTS` (e.g. the corporate CA). No code path disables certificate verification. It goes through the user's corporate proxy (`HTTPS_PROXY` / `NO_PROXY`), as the agent's own traffic would. |
| Network exposure | The daemon listens on **127.0.0.1 only** (default port 12445). Nothing is reachable from the network. |
| Opt-out | `glass <agent> --no-intercept` per run: no proxy, no CA; glass then reads the agent's own session files (session totals only). |

## 4. The interception CA

| Property | Value |
|---|---|
| Creation | On first use, locally, per user installation. Never shipped, never shared between machines. |
| Key | RSA 2048, generated with Node.js's built-in crypto. |
| Validity | CA 10 years; per-host leaf certificates 30 days, generated in memory, not written to disk. |
| Subject | `glass local interception CA <random id>` — unique per installation. Leaves carry the CA's key identifier. |
| Storage | `~/.glass/ca/ca.pem` and `ca.key`. The key file is written with mode 0600 (owner-only) on macOS / Linux; on Windows it relies on the user-profile ACLs. |
| Trust | **Never added to any OS or browser trust store.** Only processes that receive `NODE_EXTRA_CA_CERTS` from glass trust it. |
| Removal | `glass uninstall` deletes `~/.glass`, CA included. CI verifies that install → measure → uninstall leaves the home directory byte-identical (Linux, Windows). |

## 5. Data handling

Everything is stored locally under `~/.glass`; no telemetry, nothing is sent anywhere
except the agent's own calls to their usual host.

| Data | Kept |
|---|---|
| One row per model call: time, agent, model, token counts, latency, session id, project folder name, a short redacted prompt preview | until uninstall |
| Session records: id, agent, start / end, working directory | until uninstall |
| Context captures: size of each part of the context window plus **redacted** previews (≤ 2 KB) of system prompt, tool descriptions, messages | 7 days, then deleted |
| Daemon log (no request content, no headers) | until uninstall |

- **Credentials in transit.** The agents' bearer tokens pass through the daemon's memory
  on the way to the model host. They are forwarded, **never logged or stored**.
- **Full request / response bodies are not stored.**
- **Redaction** runs before anything is written: API keys (Anthropic, OpenAI, xAI, Groq,
  AWS, generic), bearer tokens, JWTs, credentials in URLs, e-mail addresses, corporate
  user ids (27 patterns). It is pattern-based. A gap here was found and fixed on
  2026-10-09 (captures previously stored previews unredacted); a regression test now
  covers it.

## 6. Risks and mitigations

| Risk | Assessment / mitigation |
|---|---|
| Theft of `ca.key` lets an attacker impersonate the model hosts | Only to processes that trust glass's CA, i.e. agents started by glass on that machine — an attacker who can read the user's home directory can already read the agents' own tokens. Per-installation key, owner-only file mode, not in any trust store. |
| Child processes of an agent inherit the environment | Tools and MCP servers an agent starts also get `HTTPS_PROXY` and the CA. Their traffic is still decrypted only for the five model hosts; all else is tunnelled. |
| The host list can be changed | A user can replace it in `~/.glass/config.json` (`interceptHosts`). This is a local, deliberate user action on their own traffic. We can remove the option or restrict it to the model domains if required. |
| Local, unauthenticated daemon API | Other processes **of any local user** can read the usage data (token counts, redacted previews), stop the daemon, and use its forwarder. Low impact on single-user developer machines; can be closed with a per-installation token if required. |
| Pattern-based redaction misses a secret | Previews are capped and deleted after 7 days; the README tells users not to paste secrets into prompts. |
| Supply chain | Two runtime dependencies (undici, node-forge — the latter only builds certificates), bundled in the release tarball, no install scripts. Repository and releases are private on bmw.ghe.com; every change passes the AIMAAD Wiz IaC / Secret / Vulnerability scans and CI on Ubuntu and Windows. The repository is generated from source repositories and CI rejects hand edits. |

## 7. Without interception

If interception is not approved, glass still works:

- Claude Code is measured fully (base URL, no interception).
- Copilot CLI, OpenCode and pi run with `--no-intercept`: session totals from their own
  files, no per-call numbers and no context-window breakdown for them.

## 8. What we can change on request

- Shorter CA validity (e.g. 1 year, regenerated automatically).
- Fixed host list (no user override).
- Authentication on the local daemon API.
- Interception off by default, enabled per run (`--intercept`) instead of disabled per run.

## 9. References

- README (install, privacy, uninstall): https://bmw.ghe.com/AIMAAD/glass#readme
- Interception implementation: `proxy/proxy-bridge/intercept.mjs` in the glass repository
- Release with CI evidence: https://bmw.ghe.com/AIMAAD/glass/releases/tag/v0.1.2
