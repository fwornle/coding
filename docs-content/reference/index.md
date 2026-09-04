# Reference

Commands, ports, paths and environment variables — the things you look up rather than read.

=== "⚡ Quick (~3 min)"

    ## The five commands

    ```bash
    coding                  # launch the default agent with everything wired up
    coding --health         # check every service
    vkb                     # knowledge viewer at localhost:8080
    semantic workflow run wave-analysis --team coding    # refresh the knowledge base
    ./scripts/test-coding.sh                             # verify the installation
    ```

    ## Ports

    | Port | Service | | Port | Service |
    |------|---------|-|------|---------|
    | 3030 | Constraint dashboard | | 3849 | Constraint SSE |
    | 3031 | Constraint API | | 3851 | Graphify |
    | 3032 | **Health dashboard** | | 6333 | Qdrant |
    | 3033 | Health API | | 6379 | Redis |
    | 3848 | **Semantic Analysis** | | 8080 | VKB viewer |

    Bold are the two you will open most. Note that **3848 runs workflows and 3033 does not** —
    the health API answers a workflow request with a bare 404.

    ## Going deeper

    [Commands](commands.md) · [API](api.md) · [Troubleshooting](troubleshooting.md)

=== "📖 Standard (~15 min)"

    ## Commands

    ```bash
    coding                   # launch the default agent (Claude Code)
    coding --copilot         # or Copilot CLI / --opencode / --pi
    coding --health          # check every service
    coding --project ~/p     # run against another directory

    vkb                      # knowledge viewer at localhost:8080
    semantic workflow run wave-analysis --team coding    # knowledge extraction pass
    semantic workflow status                             # progress of that pass
    constraints              # constraint status and violation history

    ./scripts/test-coding.sh --interactive               # guided install verification
    ```

    ## Ports and where they lead

    | Port | Service | Notes |
    |------|---------|-------|
    | 3030 | Constraint dashboard | Rules, violations, compliance |
    | 3031 | Constraint API | |
    | 3032 | Health dashboard | Health, tokens, measurement, benchmarks |
    | 3033 | Health API | Backs the dashboard — **not** workflows |
    | 3848 | Semantic Analysis | Workflow execution over HTTP/SSE |
    | 3849 | Constraint Monitor SSE | |
    | 3851 | Graphify | Code graph over MCP |
    | 6333 | Qdrant | Vector store |
    | 6379 | Redis | |
    | 8080 | VKB server | What `vkb` opens |
    | 12435 | LLM proxy | Every LLM call goes through here |
    | 12436 | Observations API | |

    ## Environment

    | Variable | Purpose |
    |----------|---------|
    | `CODING_REPO` | Path to the coding checkout |
    | `CODING_TOOLS_PATH` | Alias of the above |
    | `LSL_ENABLED` | Enable Live Session Logging |
    | `TRANSCRIPT_SOURCE_PROJECT` | The project a session belongs to |

    ## Directories

    | Path | Holds |
    |------|-------|
    | `.specstory/history/` | Session logs, `YYYY/MM/` |
    | `.data/knowledge-graph/` | The knowledge graph (LevelDB) |
    | `.data/knowledge-export/` | Git-tracked JSON exports of it |
    | `.health/` | Health status files |
    | `.cache/` | SQLite databases and embeddings |
    | `.logs/` | Per-service logs |

    ## Files that configure it

    | File | Configures |
    |------|------------|
    | `.env` | API keys and secrets |
    | `.env.ports` | Port assignments |
    | `config/live-logging-config.json` | Session logging |
    | `constraints.yaml` | Constraint rules |
    | `~/.claude/settings.json` | Hooks and permissions |

    ## The three reference pages

    - **[Commands](commands.md)** — every CLI command with its flags
    - **[API](api.md)** — MCP tools and REST endpoints
    - **[Troubleshooting](troubleshooting.md)** — indexed by symptom

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/reference/index.deep.md"
