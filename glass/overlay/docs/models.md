# Models & Accounts

Which models your agents used, which account answered each call, and which calls were the
agent's own loop rather than side requests.

=== "⚡ Quick (~2 min)"

    ## What the agents chose, who answered

    Open `glass ui` → **Models**. One row per agent, model, account and kind for the chosen
    time window (24 h, 7 days, 30 days, all), with sessions, calls and tokens:

    ![Models tab: OpenCode and Claude Code over 24 hours, with OpenCode's title calls marked as side calls](images/ui-models.png)

    | Column | Meaning |
    |---|---|
    | Kind | **main** — the agent's loop (the call carried tool definitions); **side** — a call without tools: a session title, a summary, an intent check; **subagent** — a Claude Code sub-agent |
    | Answered by | The account that served the call (GitHub Copilot, Anthropic, OpenAI, or the account an LLM proxy names) |
    | Via | The host the call went to — the agent's own API host, or a proxy it is configured to use |

    The headline says how many calls were side calls and what share of the tokens they
    took. Above, OpenCode asked a small model for a session title in both of its sessions.

    For **one session**, open **Sessions** and select its row: the same columns appear in a
    Models card above the session's timeline, with its calls one by one.

    ![Models card of an OpenCode session](images/ui-session-models.png)

    glass **routes nothing**: every model on this card is one the agent chose, and every call
    went to the agent's own provider. **Next:** what filled the main calls —
    [Context Window](context-window.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/models.deep.md"
