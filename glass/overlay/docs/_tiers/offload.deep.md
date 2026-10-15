## Which calls move

A call is offloaded only when every one of these holds; the first that fails keeps it on
the agent's own provider, and the reason is recorded on the call's row:

| Gate | Why |
|---|---|
| Offload is on, for this agent | Off is the default; each agent is switched separately. |
| An endpoint is set and **reachable** | It is probed every 60 s while offload is on; an unreachable endpoint costs no call a timeout. |
| It is a chat call (`/chat/completions`) | The Responses API is not translated. |
| The turn carries no tool results yet | A turn inside a tool loop can look trivial and is not. |
| Its **band** is ticked and has a model | small / medium / high, from the call's reasoning effort, else the model the agent picked: mini / nano / haiku / flash → small, opus / pro → high, anything else → medium. |
| It is small enough | At most **Largest call** input tokens (default 3,000): an agent's first turn with all its tools is 20–28k tokens, which a shared server takes long to start on. |
| The endpoint is not busy | At most **Calls at once** (default 1) in flight; another call goes to its provider instead of queueing. |

With **Ask the endpoint…** on, a first turn whose model suggests medium or high is shown to
the endpoint's small model with a three-line rubric; a "small" verdict lowers its band —
never raises it. Code, paths, long or multi-step requests are never asked about.

In practice this moves an agent's **side calls and short first turns**, not its tool loop.
It saves paid tokens, not time: a self-hosted model usually answers in seconds where the
paid provider takes one.

## Which agents

| Agent | How its calls reach glass | Offloaded |
|---|---|---|
| opencode | by its configuration (the relay) | yes |
| pi | intercepted (HTTPS_PROXY) | yes — glass answers in place of the provider |
| Copilot CLI | intercepted (HTTPS_PROXY) | yes — glass answers in place of the provider |
| Claude Code | `ANTHROPIC_BASE_URL` | no — it speaks the Anthropic wire, which the endpoint does not |

For pi and Copilot CLI, offload means glass answers on a connection it intercepted. That is
why it is per agent and off until you tick it.

## When the endpoint fails

The endpoint has until **Answer within** (default 8 s) to send its first byte. Until that
byte reaches the agent, any failure — connection refused, an error status, the time limit —
sends the original request, unchanged, to the provider the agent addressed, with the
agent's own credentials. The row records the failed attempt (`attempt_trail`). After the
first byte the answer is the endpoint's: an error then reaches the agent like any provider
error.

## What the endpoint receives

The request body the agent sent, with the model replaced by the one you chose for its band,
plus your endpoint key. None of the agent's headers are copied — no login, no organisation
or editor headers. The endpoint key goes to the endpoint only, never to a provider.

## Where it is kept

| File | Content |
|---|---|
| `~/.glass/offload.json` | the settings (owner-only) |
| `~/.glass/offload.key` | the endpoint key, on its own (owner-only); no API returns it |

An endpoint on a private address (loopback, `10.x`, `172.16–31.x`, `192.168.x`, a single
label or `.local` name) is reached directly; any other through your egress proxy, like the
model hosts.

## In the UI and the rows

Rows the endpoint answered carry its name as the account, `offloaded_from` = the provider
the agent addressed, and the band. Models → Flow draws them in green to the endpoint's
node; the node is dashed while offload is off or has no calls in the window, and a click
on it opens its card with the switch.

## API

The UI's calls, on `http://127.0.0.1:12445`:

| Call | Does |
|---|---|
| `GET /api/offload` | settings (without the key), whether a key is set, reachability, counts |
| `PATCH /api/offload` | change settings (only the fields sent) |
| `PUT /api/offload/key` | set (`{"key": "…"}`) or clear (`{"key": ""}`) the key |
| `POST /api/offload/test` | probe the endpoint now |

Writes need the header `x-glass-ui: 1` and a JSON body, and are refused from any other web
origin — a page in your browser cannot change them.
