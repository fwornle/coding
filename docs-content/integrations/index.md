# Integrations

The MCP servers and services that run alongside your agent, what each one is for, and
which port it answers on.

=== "⚡ Quick (~3 min)"

    ## What runs alongside the agent

    | Integration | Gives the agent |
    |-------------|-----------------|
    | [Semantic Analysis](semantic-analysis.md) | The 14-agent knowledge extraction workflows |
    | [Constraint Monitor](constraint-monitor.md) | Rule checking on every tool call |
    | [Graphify](graphify.md) | A tree-sitter code graph — ask about structure instead of grepping |
    | [Dashboard](dashboard.md) | Health, tokens, measurement, all at `:3032` |
    | [LLM CLI Proxy](llm-cli-proxy.md) | One routed, accounted path for every LLM call |

    ## The ports worth remembering

    | Port | Service |
    |------|---------|
    | 3032 | Health dashboard — the one you open |
    | 3033 | Health API |
    | 3030 | Constraint dashboard |
    | 3848 | Semantic Analysis (workflows) |
    | 8080 | Knowledge viewer (`vkb`) |
    | 12435 | LLM proxy |

    `3848` runs workflows and `3033` does not — sending a workflow to the health API returns a
    confusing 404, and it is the single most common mix-up here.

    ## Check they are up

    ```bash
    coding --health         # every service at once
    curl -s localhost:3033/health | jq .
    ```

=== "📖 Standard (~15 min)"

    ## The services

    Everything below runs as a container and is started for you by `coding`.

    **Semantic Analysis** hosts the multi-agent knowledge workflows — the extraction pass that
    builds the knowledge graph, plus ontology management and entity refresh. It speaks HTTP/SSE
    on `3848`, which is also what feeds the dashboard's live workflow view. Reach it with the
    `semantic` CLI rather than by hand.

    **Constraint Monitor** evaluates rules against tool calls and records what fired. Its
    dashboard is on `3030`, its API on `3031`. The `constraints` CLI works even when the
    container is down, because it runs the check in-process.

    **Graphify** builds a static tree-sitter graph of the codebase and serves it over MCP on
    `3851`. It answers structural questions — what calls this, where is that defined — without a
    database and without guessing. Rebuild it when it goes stale; it is a snapshot, not a live
    index.

    **The dashboard** on `3032` is the single front-end for health, token usage, routing,
    measurement and benchmarks. The health API behind it is on `3033`.

    **The LLM CLI proxy** on `12435` is the one path every LLM call takes, which is what makes
    routing, fallback and token accounting possible at all. Its endpoint is `POST /api/complete`
    — not the OpenAI-shaped `/v1/chat/completions`.

    ## Ports

    | Service | Port | Health check |
    |---------|------|--------------|
    | Constraint dashboard / API | 3030 / 3031 | `/health` |
    | Health dashboard | 3032 | `/health` |
    | Health API | 3033 | `/health` |
    | Semantic Analysis | 3848 | `/health` |
    | Constraint Monitor SSE | 3849 | `/health` |
    | Graphify | 3851 | — |
    | Qdrant | 6333 / 6334 | `/health` |
    | VKB server | 8080 | `/health` |
    | LLM proxy | 12435 | `/health` |
    | Observations API | 12436 | `/health` |

    Two pairs are easy to confuse and worth committing to memory: **3848 runs workflows, 3033
    reports health**; and **12435 is the proxy, 12436 is observations**. Both mistakes fail as a
    404 rather than an error that names the problem.

    ## Configuration

    MCP servers are declared in the agent's own MCP configuration, pointing at the containerised
    endpoints through stdio proxies. The containers are brought up by `coding`, so in normal use
    there is nothing to start by hand — if a tool is missing from the agent, check the container
    is running before suspecting the config.

    ## When something is not answering

    ```bash
    coding --health                                  # the summary
    docker compose -f docker/docker-compose.yml ps   # which containers are actually up
    curl -s localhost:3033/health | jq .             # what the API believes
    ```

    A service that is up but not answering its health check is usually mid-restart; one that is
    absent from `docker ps` never started, which is a Docker problem rather than a coding one.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/integrations/index.deep.md"
