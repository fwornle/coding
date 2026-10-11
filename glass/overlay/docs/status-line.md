# Status Line

Context gauge and session tokens, live, in the terminal you work in.

=== "⚡ Quick (~3 min)"

    ## Four fields

    `[glass ●] [ctx ▋ 9%] [↑258.6K ↓233 ⚡66%] [N:CN P:ON]`

    | Field | Shows | Click |
    |---|---|---|
    | `glass ●` | daemon running (✗ = down) | opens the UI |
    | `ctx` | latest turn's size vs. the model's window | context report |
    | `↑ ↓ ⚡` | session tokens sent / received, cache share | the session in the UI |
    | `N:` | egress: `direct` or via `proxy` | network report |

    ![Status line in tmux](images/terminal-statusline-tmux.png)

    With tmux it is the bar at the bottom; without tmux Claude Code shows it as its own
    status line, and `glass watch` shows it for any agent.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/status-line.deep.md"
