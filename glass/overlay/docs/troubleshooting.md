# Troubleshooting

Start with `glass doctor`; most problems show up there.

=== "⚡ Quick (~3 min)"

    ## Common problems

    | Symptom | Fix |
    |---|---|
    | "daemon not reachable … running unmeasured" | See `~/.glass/logs/daemon.log`; port taken → `GLASS_PORT=<free port>` |
    | No rows for copilot | `copilot --version` must be ≥ 1.0.93, and the npm CLI first on `PATH` |
    | Certificate error in an agent | Try `--no-intercept`, then send the daemon log to the maintainers |
    | No status line | Install tmux, or use Claude Code's status line / `glass watch` |
    | `glass doctor` warns about another local proxy | Start glass from a plain terminal; for pi add `--model <provider>/<model>` with one of pi's own providers (opencode is relayed and measured) — see *glass next to another local LLM proxy* |

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/troubleshooting.deep.md"
