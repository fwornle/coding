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
  names in its response (`x-llm-provider`), not the proxy's own name. For Claude Code,
  **Claude subscription** is a sign-in with a Claude plan (Max or Pro — the request does
  not say which) and **Anthropic API (metered)** is an API key. glass tells them apart by
  which header carries the login, never by reading it. Before glass 0.1.26 both were
  recorded the same way and show as Claude subscription.
- Side calls are usually cheap but frequent: titles, summaries, prompt checks on a small
  model. The headline's share of tokens tells you whether they matter in a session.
- **Newest calls, one by one** lists the last 200 calls of the session with their kind and
  latency. Side calls are greyed out.

## Reading the flow

The **Flow** card on the Models tab draws the same rows as the table, in three columns:

| Column | Node | Number on the node |
|---|---|---|
| **Agents** — who asked | one per agent; **no session** = calls glass measured but could not tie to a session (see below) | tokens, calls |
| **Models** — what the agent chose | one per model, split into loop and side calls | — |
| **Accounts** — who answered | one per account, with the hosts its calls went to | tokens |

- **Thickness** is tokens (square-root scale, so a small agent stays visible next to a large one).
- **Colour** is the account that answered; **dashed** edges are side calls.
- Hovering an agent lights the models it used and those models' paths to the account that
  answered it. A model shared by several agents shows its *total* on the right-hand edge;
  the per-agent split is in the table.
- Accounts are merged by who answered, not by spelling: `github-copilot` and `gh-copilot`
  rows are one Copilot node.

coding's dashboard has a flow with the same left and right columns and a decision column in
the middle — the router choosing an account per call. glass has no router, so the middle
column is the models the agent itself picked.

## On-prem offload — planned, not in this release

Where an on-prem Qwen3.8-27B cluster is available, the next phase (G8)
lets glass hand **some** calls to it — **opt-in, off by default**. What is decided so far,
from measurements with coding's own router against that cluster:

| | |
|---|---|
| Which calls | Small ones only: opencode's session titles and side calls. An agent's first turn carries 20–28k tokens of system prompt and tools; uncached, the cluster needs ~40–55 s for that, so it stays on the paid account. |
| Which agents | opencode first: its calls already reach glass by configuration (the relay), so glass can answer them without decrypting anything. Copilot CLI and pi stay measure-only. |
| Gates | at most a few thousand input tokens, a short time budget (~8 s), one call in flight to the cluster; a dead cluster is skipped without a per-call timeout |
| Fallback | the original call, unchanged, to the host the agent addressed, with the agent's own login — what glass does today. Your GitHub or Anthropic credentials never reach the cluster. |
| Trade-off | Qwen answers small calls in ~2–10 s against ~1–2 s on Copilot: offload saves paid tokens, not time. |

With the option on, the Models flow would show offloaded calls arriving at an on-prem account
node; with it off, glass stays exactly as described on this page.

## Calls without a session

Below the session table, glass counts the calls it measured but could not bind to a
session. That happens when an intercepted request names no session and more than one
intercepting session is open. glass never guesses which session such a call belongs to.
These calls count in **Token Usage** but not in any session row; on the Models tab their
agent shows as **no session**.

## Why glass does not route

coding, the project glass is extracted from, has a router that moves calls between accounts
and to local models. glass leaves that out on purpose: the agent keeps its own login, model
catalogue and routing, and glass only measures. This card shows the agent's own choices
for the same reason. The one planned exception is the opt-in on-prem offload above.

## Reading it programmatically

```bash
curl -s 'http://127.0.0.1:12445/api/models?hours=24'      # 0 = all time
curl -s http://127.0.0.1:12445/api/experiments/runs/<session id>/models
curl -s http://127.0.0.1:12445/api/calls/unbound
```

The first returns `groups` for all sessions (agent × model × account × host × kind, with
sessions, calls and token sums). The second returns one session's `groups` and `calls` (the
newest 200, newest first). The third returns `calls`, `tokens`, `first` and
`last` for the unbound calls.
