# Coding

Development environment with MCP services, knowledge management, and Live Session Logging.

![System Architecture](images/coding-system-architecture.png)

## Quick Start

```bash
# Clone and install
git clone --recurse-submodules https://github.com/fwornle/coding ~/Agentic/coding
cd ~/Agentic/coding && ./install.sh

# Launch Claude Code with all integrations (--claude is default)
coding

# View knowledge graph
vkb
```

## Core Capabilities

| System | Purpose | Command |
|--------|---------|---------|
| **LSL** | Real-time session logging with intelligent classification | Automatic |
| **UKB/VKB** | Knowledge capture and visualization | `vkb` |
| **Constraints** | Code quality enforcement via PreToolUse hooks | Automatic |
| **Trajectories** | Development state tracking | Status line |

## MCP Integrations

- **Semantic Analysis** - 14-agent AI-powered code analysis
- **Constraint Monitor** - Real-time violation detection
- **Browser Access** - Stagehand browser automation
- **Code Graph RAG** - AST-based code search via Memgraph

## Deployment Modes

=== "Docker (Default)"

    MCP servers run as HTTP/SSE services in containers with persistent state.

    ```bash
    coding
    ```

=== "Native"

    MCP servers run as stdio processes managed by Claude CLI.

    ```bash
    rm -f .docker-mode
    coding
    ```

## Documentation

- [Getting Started](getting-started/index.md) - Installation and configuration
- [Core Systems](core-systems/index.md) - LSL, UKB/VKB, Constraints, Trajectories
- [Architecture](architecture/index.md) - System design and data flow
- [Integrations](integrations/index.md) - MCP servers and tools
- [Reference](reference/index.md) - Commands, API, troubleshooting
