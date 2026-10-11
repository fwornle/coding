# Models & Accounts

Which models one session used, which account answered each call, and which calls were the
agent's own loop rather than side requests.

=== "⚡ Quick (~2 min)"

    ## What the agent chose, who answered

    Open `glass ui` → **Sessions** and select a session. The **Models** card lists every
    model the session used, with its calls and tokens:

    ![Models card of an OpenCode session](images/ui-session-models.png)

    | Column | Meaning |
    |---|---|
    | Kind | **main** — the agent's loop (the call carried tool definitions); **side** — a call without tools: a session title, a summary, an intent check; **subagent** — a Claude Code sub-agent |
    | Answered by | The account that served the call (GitHub Copilot, Anthropic, OpenAI, or the account an LLM proxy names) |
    | Via | The host the call went to — the agent's own API host, or a proxy it is configured to use |

    The headline says how many calls were side calls and what share of the tokens they
    took. Above, OpenCode asked a small model for a title before its main loop started.

    glass **routes nothing**: every model on this card is one the agent chose, and every call
    went to the agent's own provider. **Next:** what filled the main calls —
    [Context Window](context-window.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/models.deep.md"
