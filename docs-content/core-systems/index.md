# Core Systems

Six systems run behind every session. This is what each one is for and how they feed each
other.

=== "⚡ Quick (~3 min)"

    ## The seven systems at a glance

    | System | Does | You interact with it via |
    |--------|------|--------------------------|
    | **Live Session Logging** | Records every prompt, tool call and response | Nothing — it is automatic |
    | **Knowledge Management** | Extracts a searchable graph from history and git | `semantic`, and `vkb` to browse |
    | **Observational Memory** | Captures observations across all four agents, consolidated into digests and insights | The knowledge base |
    | **OKB** | Cross-repo root-cause analyses and runbooks | Its own viewer |
    | **Constraints** | Blocks a violating tool call before it executes | The dashboard at `:3030` |
    | **Health Monitoring** | Supervises services and restarts what dies | `coding --health`, `:3032` |
    | **Status Line** | Live health, cost and logging state | Your tmux bar |

    ## Commands you will actually type

    ```bash
    coding --health                                      # is everything up
    vkb                                                  # browse the knowledge graph
    semantic workflow run wave-analysis --team coding     # refresh that graph
    semantic workflow status                              # how far it has got
    ```

    Logging and constraints need no commands at all — they are hooks and daemons that start with
    the session.

    ## Reading the room

    If the status bar shows red, or `coding --health` disagrees with what you are seeing, start
    at [Health Monitoring](../architecture/health-monitoring.md). If a tool call was blocked and
    you think it should not have been, [Constraints](constraints.md) explains the rule and the
    override.

=== "📖 Standard (~15 min)"

    ## What each system is for

    **[Live Session Logging](lsl.md)** captures every conversation into `.specstory/history/`
    without being asked. A five-layer classifier decides which project each piece of content
    belongs to, so work that spans repositories is filed where it will be found again, and a
    redactor strips secrets before anything is written.

    **[Knowledge Management](ukb-vkb.md)** is a 14-agent extraction pass over your git history
    and session logs, producing a knowledge graph. Persistence goes through `@fwornle/km-core`,
    the kernel shared by all three knowledge systems.

    **[Constraints](constraints.md)** are PreToolUse hooks: they see a tool call *before* it
    runs and can block it. That timing is the whole design — a rule that reports afterwards
    documents damage instead of preventing it.

    **[Observational Memory](observational-memory.md)** watches for patterns across sessions and
    feeds them back into the knowledge base, so repeated friction becomes something the system
    knows rather than something you re-discover.

    **Health monitoring** and the **status line** close the loop by making the state of all of
    the above visible without asking.

    ## How a session flows through them

    A prompt enters the agent. The session monitor records it and everything that follows. Each
    tool call passes the constraint hook first, which either blocks it with a suggested fix or
    lets it through. The resulting session log becomes input to the next knowledge extraction
    pass, whose graph is what the viewer shows and what gets injected back into later sessions.
    Health monitoring supervises every service in that chain and reports to the status line.

    That is the self-improving loop: today's session is tomorrow's context.

    ## Commands

    | System | Command | Description |
    |--------|---------|-------------|
    | Logging | *(none)* | Runs in the background |
    | Knowledge | `semantic workflow run wave-analysis --team coding` | Extraction pass, async, 10–20 min |
    | Knowledge | `semantic workflow status` | Progress of the current run |
    | Knowledge | `vkb` | Viewer at `localhost:8080` |
    | Constraints | *(dashboard)* | `localhost:3030` |
    | Health | `coding --health` | Check every service |
    | Health | *(dashboard)* | `localhost:3032` |

    Add `--debug` to the extraction pass to run it with a mocked LLM, single-stepped — useful for
    watching the agent workflow without spending tokens.

    ## Reading the system state

    The dashboards and the status line agree by construction — they read the same health files.
    When they disagree, that is itself the diagnosis: a stale status line means the process
    writing it has stopped, not that the service it describes is down. Detail on the supervision
    layers is in [Health Monitoring](../architecture/health-monitoring.md), and the data path
    between all six systems is drawn in [Data Flow](../architecture/data-flow.md).

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/core-systems/index.deep.md"
