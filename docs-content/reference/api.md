# API Reference

The tools and HTTP endpoints the system exposes, and how each is reached.

=== "⚡ Quick (~3 min)"

    ## One MCP server, two CLIs

    **Graphify** is the only remaining MCP server. The semantic-analysis and constraint-monitor
    tools still exist and do the same work — they are reached by running a command instead:

    | Surface | Reached by |
    |---------|------------|
    | Semantic analysis | `semantic <command>`; `semantic tools` lists them |
    | Constraint monitor | `constraints <command>` — works with the container down |
    | Graphify | MCP at `http://localhost:3851/mcp` |

    Retiring those two as MCP servers removed roughly **14 KB of tool schema from every context
    window**.

    ## The endpoints you will actually use

    ```bash
    curl -s localhost:3034/health/state | jq .    # live health, the source of truth
    curl -s localhost:12435/health | jq .         # LLM proxy
    curl -s localhost:3033/health | jq .          # health API (backs the dashboard)
    ```

    ## The port pairs that get confused

    **12435** is the LLM proxy, **12436** is observations. **3848** runs workflows, **3033** does
    not. Both mistakes fail as a bare 404 that names nothing.

    ## Generic tool access

    ```bash
    semantic tools                            # everything available
    semantic tool <name> '{"key":"value"}'    # invoke one directly
    ```

=== "📖 Standard (~15 min)"

    ## Why the MCP servers became CLIs

    Every MCP tool a server exposes costs tool-schema tokens in **every** context window, whether
    or not it is used. Nineteen semantic-analysis tools and four constraint-monitor tools came to
    roughly 14 KB per window, permanently, for capabilities used occasionally.

    Both are now CLIs and neither lost functionality. The `semantic` CLI posts to the running
    workflow server, so it drives the same state machine that feeds the dashboard's live view. The
    `constraints` CLI evaluates in-process, which makes it strictly more available than the MCP
    server was — it works when the container is down.

    Graphify stays on MCP because structural code queries are genuinely per-turn work, where the
    schema cost buys something on most turns.

    ## HTTP surfaces

    | Port | Service | Notes |
    |------|---------|-------|
    | 3030 / 3031 | Constraint dashboard / API | |
    | 3032 / 3033 | Health dashboard / API | The dashboard's backend, **not** workflows |
    | 3034 | Health coordinator | `/health/state` — the single source of truth |
    | 3848 | Semantic analysis | Workflow execution over HTTP/SSE |
    | 3851 | Graphify | MCP |
    | 8080 | VKB server | |
    | 12435 | LLM proxy | `POST /api/complete` |
    | 12436 | Observations API | Also mounts km-core's `/api/km/` |

    Two pairs cause nearly all the confusion here, and both fail as a bare 404 rather than
    anything diagnostic: **12435 versus 12436**, and **3848 versus 3033**.

    ## The LLM proxy's endpoint

    ```bash
    curl -s localhost:12435/api/complete \
      -H 'content-type: application/json' \
      -d '{"process":"my-service","messages":[{"role":"user","content":"hi"}],"complexity":"small"}'
    ```

    Not the OpenAI-shaped path. `process` is what makes token accounting attributable, and
    `complexity` is the band that decides cost — a `taskType` field is read by nothing.

    ## Health as an API

    `GET localhost:3034/health/state` returns the whole document: container state, per-service
    status, per-project session logging, database sub-checks, network location and proxy state.
    Everything else — the dashboards, the status line, the prompt hooks — renders that one
    document, which is why they agree, and why a disagreement means something is reading a stale
    copy rather than that two things are broken.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/reference/api.deep.md"
