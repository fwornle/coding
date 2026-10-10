# Commands & Configuration

Every command, environment variable and setting.

=== "⚡ Quick (~3 min)"

    ## Commands

    | Command | |
    |---|---|
    | `glass claude\|copilot\|opencode\|pi [args…]` | run the agent, measured |
    | `glass ui` | open the dashboards |
    | `glass status` | daemon, live sessions, latest calls |
    | `glass doctor` | check the setup |
    | `glass watch` | live status line for the newest session |
    | `glass stop` | stop the daemon |
    | `glass update [--check]` | install the latest release |
    | `glass uninstall [--yes]` | stop the daemon, delete `~/.glass` |

    Per run: `--no-tmux`, `--no-intercept`. Data: `GLASS_HOME`. Port: `GLASS_PORT`.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/reference.deep.md"
