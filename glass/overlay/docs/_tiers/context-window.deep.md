## Sessions

![Sessions](images/ui-sessions.png)

Each `glass <agent>` run is one session: start time, agent, project (the git checkout's
folder name), main model, number of calls, tokens and duration.

## Timeline of a session

Select a row to see its turns in order:

![Session timeline](images/ui-session-timeline.png)

- Each line is one model call: its prompt (redacted), the tools used in that turn, fresh
  input, output and cache reads.
- The small bar on the right is the turn's context composition; hatched parts were
  served from cache.
- The lanes *Knowledge capture* and *Infrastructure* come from the measurement code glass
  is built from and stay empty with glass — all agent turns are *Foreground development*.

## Detail of a turn

Click a turn:

![Turn detail](images/ui-turn-detail.png)

- **This turn's context composition** — the window of this call by category.
- **Whole-run growth** — how the window grew over the session.
- **The messages** — system prompt, your input, the assistant's tool calls and the tool
  results, each with its size and a redacted preview. Above, a user id inside a file path
  was replaced by `<USER_ID_REDACTED>` before it was stored.

## The context explainer

**Context** on a session row opens the explainer:

![Context explainer, opencode](images/ui-context-explainer.png)

From top to bottom:

1. **The path** — agent → glass daemon → provider, and where the cache lives (at the
   provider, not in the agent or in glass).
2. **The verdict** — whether the session re-used its context through prompt caching, and
   what share of all prompt tokens came from cache (66 % above).
3. **Anatomy of the context window** — the largest turn, in exact bytes per category:
   system instructions, tool descriptions, retrieved knowledge, conversation history,
   tool outputs, user input. Everything left of the dashed line is the cacheable prefix;
   only the tail is new each turn.
4. **Biggest turn** — how its tokens were billed: matched from cache, written to cache,
   or processed fresh.
5. **How caching works** — why a stateless API still gets cheap repeated context.

The same view for a Claude Code session, which writes the cache on one turn and reads it
on the next:

![Context explainer, claude](images/ui-context-explainer-claude.png)

## The same in the terminal

Clicking `[ctx]` in the [status line](status-line.md) opens this explainer for the live
session. `glass report ctx` prints the same breakdown in the terminal:

![Context report](images/terminal-report-ctx.png)

## What the categories mean

| Category | Contains |
|---|---|
| System Instructions | The agent's system prompt, plus instruction files it loads (e.g. `CLAUDE.md`) |
| Tool Descriptions | The definitions of every tool the agent offers the model — often the largest part |
| Retrieved Knowledge | Content the agent injected from search or memory |
| Conversation History | Earlier turns of the session |
| Tool Outputs | Results of tool calls (file contents, command output) |
| User Input | What you typed this turn |

## Retention

Context captures — the previews above — are deleted after 7 days. Token counts stay until
you uninstall. See [Privacy & Data](privacy.md).
