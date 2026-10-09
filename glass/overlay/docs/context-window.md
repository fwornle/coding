# Context Window

What your agent actually sent to the model on each turn, and how much of it the provider
served from its prompt cache.

=== "⚡ Quick (~3 min)"

    ## See what filled the window

    Open `glass ui` → **Sessions**. One row per `glass <agent>` run.

    - **Click a row** for its timeline: every model call (turn) with its tokens.
    - **Click a turn** for its detail: the messages that were sent and their sizes.
    - **Click Context** for the explainer: what the window is made of, and whether the
      session re-used its prompt cache.

    ![Context explainer](images/ui-context-explainer.png)

    Typical finding: tool definitions and the system prompt are most of the window, and
    a well-cached session pays for them only once. **Next:**
    [compare two runs](comparing-runs.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/context-window.deep.md"
