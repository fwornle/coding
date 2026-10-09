# glass

Token measurement and context-window insight for coding agents — GitHub Copilot CLI,
OpenCode, pi and Claude Code. Put `glass` in front of the agent you already use; glass
records every model call and shows where your tokens go.

=== "⚡ Quick (~3 min)"

    ## What glass gives you

    - **Token measurement** — every model call's input, output and cache tokens, per agent,
      per session, per model, with no change to how you work.
    - **Context-window analysis** — what filled the window on each turn (system prompt,
      tools, history, your input) and how much the provider served from its prompt cache.
    - **A status line** — context gauge and session tokens live in your terminal.
    - **Run comparisons** — the same task with two agents or models, side by side.

    ```sh
    glass claude          # or: glass copilot · glass opencode · glass pi
    glass ui              # open the dashboards
    ```

    ![Token Usage overview](images/ui-token-usage-overview.png)

    Everything stays on your machine. **Next:** [install glass](getting-started.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/index.deep.md"
