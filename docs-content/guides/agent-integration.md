# Agent Integration

Adding a coding agent takes one config file. This is what that file contains and what it
buys you.

=== "⚡ Quick (~3 min)"

    ## One file

    Create `config/agents/<name>.sh`:

    ```bash
    AGENT_NAME="myagent"
    AGENT_DISPLAY_NAME="MyAgent"
    AGENT_COMMAND="myagent"
    AGENT_SESSION_PREFIX="myagent"
    AGENT_SESSION_VAR="MYAGENT_SESSION_ID"
    AGENT_TRANSCRIPT_FMT="myagent"
    AGENT_ENABLE_PIPE_CAPTURE=true
    AGENT_PROMPT_REGEX='>\s+([^\n\r]+)[\n\r]'
    AGENT_REQUIRES_COMMANDS="myagent"

    agent_check_requirements() {
      command -v myagent &>/dev/null || { _agent_log "myagent not on PATH"; exit 1; }
    }
    ```

    ## Try it

    ```bash
    coding --agent myagent --dry-run    # is the config discovered
    coding --agent myagent              # launch it
    ```

    ## What you get without writing it

    Container startup, session logging, tmux wrapping with the shared status bar, knowledge
    injection, constraint enforcement, health monitoring, pipe-pane I/O capture, and session
    registration and cleanup.

    The proof that one file is really enough: the OpenCode integration is 25 lines.

=== "📖 Standard (~15 min)"

    ## Why one file is sufficient

    Everything shared lives in layers the agent does not own, so an agent contributes only what
    is genuinely specific to it — its binary, how its prompts look on the wire, and any checks it
    needs before launching.

    ![Agent-Agnostic Architecture](../images/agent-agnostic-architecture-components.png)

    From the top: the agent itself; the tmux wrapper that gives every agent the same status bar;
    your config file; the shared orchestrator that handles Docker, services and session
    management; common setup; the shared services; and an adapter interface resolved by naming
    convention.

    ## What happens at launch

    1. `bin/coding` checks that `config/agents/<name>.sh` exists
    2. The orchestrator sources it
    3. Network detection runs and configures the proxy for wherever you are
    4. Services come up
    5. Your `agent_check_requirements` and `agent_pre_launch` hooks run
    6. Connectivity is validated
    7. The agent launches inside tmux with the shared status bar

    Network detection runs at step 3, **before** your hooks, so by the time they execute the
    proxy environment is already correct for the current network.

    ## The variables that matter

    | Variable | What it is for |
    |----------|----------------|
    | `AGENT_NAME` | Internal identifier, used in environment variable names |
    | `AGENT_COMMAND` | The binary to exec inside tmux |
    | `AGENT_SESSION_PREFIX` | Prefix for the tmux session name |
    | `AGENT_TRANSCRIPT_FMT` | Which transcript format the session logger should expect |
    | `AGENT_ENABLE_PIPE_CAPTURE` | Capture terminal I/O — needed for agents with no native transcript |
    | `AGENT_PROMPT_REGEX` | How to recognise a user prompt in that captured stream |
    | `AGENT_REQUIRES_COMMANDS` | Binaries that must exist before launching |

    `AGENT_ENABLE_PIPE_CAPTURE` and `AGENT_PROMPT_REGEX` go together. An agent that writes its
    own session transcript does not need them; one that only prints to the terminal does, and the
    regex is what turns that stream back into discrete prompts.

    ## Hooks you can define

    `agent_check_requirements` runs before anything expensive and should fail loudly if the agent
    cannot run. `agent_pre_launch` is for anything the agent needs set up immediately before it
    starts. Both are optional — an agent whose binary is simply on the PATH needs neither.

    ## Testing a new agent

    ```bash
    coding --agent myagent --dry-run
    ```

    That resolves the config and reports what would happen without launching. Once it runs, check
    that sessions appear in the status line and that logs are being written for the project — if
    the agent is absent from the status line, it has no session monitor, which usually means the
    transcript format or pipe capture is not configured correctly.

=== "📚 Deep Dive (full)"

    --8<-- "_tiers/guides/agent-integration.deep.md"
