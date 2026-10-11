## Where the card comes from

Each measured call is one row in the token database. Since glass 0.1.16 a row also
records two facts about the call, taken from the request as the agent sent it:

| Fact | How glass decides |
|---|---|
| **Kind** | The request carried tool definitions → **main**. None → **side**. For Claude Code, a tool set without its spawner tool (`Agent` / `Task`) → **subagent**. |
| **Via** | The host the request was forwarded to — `host[:port]` only, never a path, a query or credentials. |

Rows recorded before 0.1.16, and rows that come from an agent's own files rather than from
the wire, show **not recorded** and **—**. glass does not guess them afterwards.

## Reading the card

- **Model** is the model that *answered*, from the response. It is normally the one the
  agent asked for. When the agent talks to an LLM proxy that picks the model itself, the
  answering model can differ from the request. The card shows what was actually used.
- **Answered by** is the account. For calls through such a proxy it is the account the proxy
  names in its response (`x-llm-provider`), not the proxy's own name. **Anthropic (own
  login)** is Claude Code's own login: a subscription or an API key. glass cannot tell which.
- Side calls are usually cheap but frequent: titles, summaries, prompt checks on a small
  model. The headline's share of tokens tells you whether they matter in a session.
- **Newest calls, one by one** lists the last 200 calls of the session with their kind and
  latency. Side calls are greyed out.

## Calls without a session

Below the session table, glass counts the calls it measured but could not bind to a
session. That happens when an intercepted request names no session and more than one
intercepting session is open. glass never guesses which session such a call belongs to.
These calls count in **Token Usage** but not in any session row.

## Why glass does not route

coding, the project glass is extracted from, has a router that moves calls between accounts
and to local models. glass leaves that out on purpose: the agent keeps its own login, model
catalogue and routing, and glass only measures. This card shows the agent's own choices
for the same reason.

## Reading it programmatically

```bash
curl -s http://127.0.0.1:12445/api/experiments/runs/<session id>/models
curl -s http://127.0.0.1:12445/api/calls/unbound
```

The first returns `groups` (model × account × host × kind, with calls and token sums) and
`calls` (the newest 200, newest first). The second returns `calls`, `tokens`, `first` and
`last` for the unbound calls.
