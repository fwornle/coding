## What you can compare

Anything you can vary between two `glass <agent>` runs:

| Variant A | Variant B |
|---|---|
| `glass claude` | `glass opencode` — different agents, same task |
| `--model …-haiku…` | `--model …-sonnet…` — different models |
| a project with a long `CLAUDE.md` | the same project without it — instruction-file cost |
| many MCP servers enabled | few — tool-definition cost |

## Recipe

1. **Fix the task.** Use the same prompt, the same repository state and non-interactive
   mode (`-p`, `run`) so both runs do the same work.
2. **Run each variant** through glass, one after the other.
3. **Compare in Sessions** — one row per run:

    ![Sessions, four agents on one task](images/ui-sessions.png)

    Above, four rows ran the same task: Claude Code (10:02) used 2 calls and 116K tokens,
    OpenCode (10:03) 4 calls and 88K, pi (10:03) 2 calls and 6.8K, copilot (19:09) 2
    calls and 58K — mostly a difference in how much context (system prompt, tool
    definitions) each agent sends. The 10:09 and 10:11 rows are interactive Claude Code
    sessions with other prompts.

4. **Compare the windows** — **Context** on each row:

    | | OpenCode | Claude Code |
    |---|---|---|
    | Explainer | ![opencode](images/ui-context-explainer.png) | ![claude](images/ui-context-explainer-claude.png) |

5. **Repeat** each variant a few times. A single run is an anecdote: agents are
   non-deterministic, and the first run of a session writes the cache that later runs
   read.

## Reading the result

- **Tokens per run** — the total cost of doing the task.
- **Cache share** — a variant that keeps its prefix stable re-uses the cache; one that
  changes the prompt early in the window pays full price every turn.
- **Window anatomy** — where the bytes go. Tool descriptions and instruction files are
  the usual levers.

## Not included

glass does not schedule runs, repeat them, judge the answers or compute statistics. Those
belong to an experiment runner, which glass does not include.
