## What is stored

| What | Where (under `~/.glass`) | Kept |
|---|---|---|
| One row per model call: time, agent, model, token counts, latency, session id, project folder name, a short redacted prompt preview | `data/llm-proxy/token-usage.db` | until uninstall |
| Session records: session id, agent, start / end, working directory | `data/measurements/<session>.json` | until uninstall |
| Context captures: per call, the size of each part of the window plus redacted previews (≤ 2 KB each) of system prompt, tool descriptions and messages | `data/measurements/<session>/context-turns.jsonl`, `data/llm-proxy/context-breakdown/` | 7 days |
| glass's CA certificate and private key | `ca/` | until uninstall |
| Daemon log (no request content) | `logs/daemon.log` | until uninstall |

Set `GLASS_HOME` to keep it somewhere else. Full request and response bodies are not
stored.

## Redaction

Before anything is written, every string in a capture goes through a set of 27 patterns:
API keys (Anthropic, OpenAI, xAI, Groq, AWS, generic), bearer tokens, JWTs, credentials
in URLs, e-mail addresses and corporate user ids. A match is replaced by a marker such as
`<SECRET_REDACTED>` or `<USER_ID_REDACTED>`.

Redaction is pattern-based: a secret in an unusual format can get through. Do not paste
secrets into prompts.

## Credentials in transit

Your agents' bearer tokens pass through the daemon's memory on the way to the model host.
They are forwarded, never logged and never stored.

## The interception CA

| | |
|---|---|
| Created | On first use, on your machine, unique per installation |
| Key | RSA 2048, owner-only file permissions on macOS / Linux |
| Validity | CA 10 years; per-host certificates 30 days, kept in memory only |
| Trust | Never added to a system or browser trust store. Only processes glass starts receive `NODE_EXTRA_CA_CERTS` |
| Scope | Decrypts only `copilot-api.*.ghe.com`, `api.githubcopilot.com`, `api.*.githubcopilot.com`, `api.openai.com`, `api.anthropic.com` |
| Removed | With `glass uninstall` |

Tools and MCP servers that an agent starts inherit its environment. Their traffic is still
decrypted only for the five model hosts; everything else is tunnelled untouched.

If your policy does not allow local TLS interception, run `glass <agent> --no-intercept`:
copilot, OpenCode and pi then run without the proxy, and glass reads their own session
files instead (session totals, no per-call detail). Claude Code is measured without
interception in any case.

## The local daemon

The daemon listens on 127.0.0.1 only and is not reachable from the network. Its API has no
authentication: other processes on the same machine can read the usage data (token
counts, redacted previews). On a shared multi-user machine, keep that in mind.

## Removing everything

```sh
glass uninstall      # stops the daemon, deletes ~/.glass
npm rm -g glass
```
