# Coding - AI Development Toolkit

A comprehensive AI-powered development toolkit featuring live session logging, real-time constraint monitoring, semantic knowledge management, and multi-agent analysis — supporting Claude Code, GitHub Copilot CLI, and OpenCode. **Zero-cost LLM routing** via existing Claude Code and GitHub Copilot subscriptions.

---

## 🚀 Quick Start

```bash
# Install the system (safe - prompts before any system changes)
./install.sh

# Start Claude Code with all features
coding

# Or use specific agent
coding --claude
coding --copilot
coding --agent opencode

# Query local LLM from command line (Docker Model Runner)
llm "Explain this error message"
cat file.js | llm "Review this code"
```

### 🐳 Docker Deployment (Optional)

For containerized deployment with persistent services:

```bash
# Switch to Docker mode (safe transition with health monitoring)
coding --switch-to-docker

# Start Claude or CoPilot - Docker services are already running
coding --claude
coding --copilot

# Check current mode
coding --mode-status
```

The transition system ensures safe mode switching with:
- Automatic pause of health monitors during transition
- Graceful service shutdown with data flush
- Automatic rollback on failure
- Multi-session support
- Docker-aware health verification (CGR cache, service restarts)

**Benefits**: Persistent MCP servers, shared browser automation across sessions, isolated database containers, no duplicate containers when switching agents.

**MCP Configuration**: Automatically selects the correct MCP config based on deployment mode:
- Docker mode: Uses stdio-proxy → SSE bridge to communicate with containerized servers
- Native mode: Runs MCP servers directly as Node.js processes
- Configuration selection is centralized in `claude-mcp-launcher.sh`

**Unified Agent Launching**: All agents are wrapped in tmux sessions via the shared `scripts/tmux-session-wrapper.sh`, providing a consistent status bar across Claude, CoPilot, and future agents. The shared orchestrator (`scripts/launch-agent-common.sh`) handles Docker mode detection, service startup, monitoring, and session management — adding a new agent requires only a single config file in `config/agents/`. The service orchestrator (`start-services-robust.js`) automatically skips standalone containers (Redis, Qdrant, Memgraph) when Docker mode is active, preventing duplicate containers and port conflicts.

![Coding Environment — Tmux Status Bar](docs/images/status-line.png)

**Multi-Agent Support**: While Claude Code is the primary and default agent (`coding` or `coding --claude`), the system is fully agent-agnostic. Any coding agent can be integrated with a single config file in `config/agents/`. Currently supported:

| Agent | Launch Command | Detection |
|-------|---------------|-----------|
| **Claude Code** (default) | `coding` or `coding --claude` | Native transcript support |
| **GitHub Copilot CLI** | `coding --copilot` | Pipe-pane I/O capture |
| **OpenCode** | `coding --agent opencode` | Pipe-pane I/O capture |

All agents get the same infrastructure: tmux session wrapping, status line, health monitoring, LSL session logging, knowledge management, and constraint enforcement.

![GitHub Copilot CLI running in coding](docs/images/coding-copilot-cli.png)

![OpenCode running in coding](docs/images/coding-opencode.png)

See [Agent Integration Guide](docs/agent-integration-guide.md) for adding new agents.

**Health System Adaptation**: The health verifier automatically detects Docker mode and adapts:
- CGR cache staleness uses `cache-metadata.json` fallback (no `.git` access)
- Service restarts use Docker-appropriate commands
- Dashboard shows cached commit info instead of staleness count

**To switch back to native mode**:
```bash
coding --switch-to-native
```

The Docker stack runs 4 containers (coding-services, Qdrant, Memgraph, Redis) with 8 internal services managed by supervisord, using ~1.75 GB memory total.

![Docker Container Architecture](docs/images/dockerized-system-architecture.png)

See [Architecture Report](docs/architecture-report.md) for full system overview, [Docker Mode Transition](docs/docker-mode-transition.md) for switching details, and [Docker Deployment Guide](docker/README.md) for container configuration.

### Environment Resilience

The launcher automatically adapts to your network environment:
- **Corporate network detection** — 3-layer detection (environment variable, SSH probe, HTTPS fallback) with 5-second timeouts
- **Proxy auto-configuration** — Detects local proxy services (proxydetox) and configures environment variables automatically
- **Docker auto-start** — Launches Docker Desktop on demand with hung-process recovery and 45-second timeout
- **Tested in all combinations** — CN/public network, with/without proxy, Claude/CoPilot — validated by 17 end-to-end tests

No manual network configuration needed for most environments. See [Getting Started - Network Setup](docs/getting-started.md#network-setup-corporateproxy) for details.

### Installation Safety

The installer follows a **non-intrusive policy** - it will NEVER modify system tools without explicit consent:

- **Confirmation prompts** before installing any system packages (Node.js, Python, jq)
- **Skip options**: `y` (approve), `N` (skip), `skip-all` (skip all system changes)
- **Shell config backup** with timestamped files before any modifications
- **Syntax verification** after shell config changes

![Installation Flow](docs/images/installation-flow.png)

**Next Steps**: [Getting Started Guide](docs/getting-started.md)

---

## 🎯 What It Provides

### Core Capabilities

- **🏥 Health System** - Real-time monitoring, auto-healing, and status line indicators
- **📋 Live Session Logging** - Real-time conversation classification and routing
- **🛡️ Constraint Monitoring** - PreToolUse hook enforcement for code quality
- **🧠 Knowledge Management** - Capture, visualize, and share development insights
- **📈 Trajectory Generation** - Automated project analysis and documentation
- **🤖 Multi-Agent Analysis** - 11 specialized AI agents for comprehensive code analysis

### LLM Providers (Zero-Cost Routing)

The unified LLM layer (`lib/llm/`) intelligently routes requests to maximize cost savings:

- **Subscription-First**: Claude Code → GitHub Copilot → Groq → Anthropic → OpenAI
- **10 Providers**: 2 subscription (CLI), 5 cloud API, 2 local, 1 mock
- **Automatic Fallback**: Quota exhausted? Seamlessly fall back to paid APIs
- **Quota Tracking**: Persistent usage tracking with exponential backoff
- **Cost Savings**: ~$50-100/month for active development (all UKB/LSL analysis is $0)

**Provider Status**:
- ✅ Claude Code (sonnet/opus) - **Zero cost** via subscription
- ✅ GitHub Copilot (gpt-4o-mini/gpt-4o) - **Zero cost** via subscription
- ✅ Groq (llama-3.1/3.3) - Fast, low-cost API fallback
- ✅ Anthropic, OpenAI, Gemini, GitHub Models - Cloud API fallback
- ✅ DMR, Ollama - Local fallback (no API costs)

See [LLM Architecture](docs-content/architecture/llm-architecture.md) for details.

### Integration Support

- **Claude Code** - Full MCP server integration (default agent)
- **GitHub Copilot CLI** - Pipe-pane capture with session logging
- **OpenCode** - Pipe-pane capture with session logging
- **Agent Abstraction API** - Unified adapter system for any coding agent
- **Docker Support** - Containerized deployment with HTTP/SSE transport for MCP servers

### Agent Abstraction Architecture

The system uses a unified Agent Abstraction API (`lib/agent-api/`) that enables consistent features across different coding agents:

- **BaseAdapter** - Common interface for all agent adapters
- **StatuslineProvider** - Unified status display (rendered via tmux status bar)
- **HooksManager** - Bridge between native hook systems and unified hooks
- **TranscriptAdapter** - Unified session log format (LSL)

![Agent Abstraction Architecture](docs/images/agent-abstraction-architecture.png)

See [Agent Abstraction API](docs/architecture/agent-abstraction-api.md) for details.

---

## 📚 Documentation

### Core Systems

#### [🏥 Health System](docs/health-system/)
Automatic health monitoring and self-healing with real-time dashboard
- Pre-prompt health verification with 3-layer resilience
- Auto-healing failed services (Docker-aware)
- Dashboard at `http://localhost:3032`
- Service supervision hierarchy ensures services stay running
- **[📊 Status Line System](docs/health-system/status-line.md)** - Real-time indicators via unified tmux status bar (all agents)

![Health Supervision Hierarchy](docs/images/supervisor-restart-hierarchy.png)

#### [📋 Live Session Logging (LSL)](docs/lsl/)
Real-time conversation classification and routing with security redaction
- 5-layer classification system
- Multi-project support with foreign session tracking
- 98.3% security effectiveness
- Zero data loss architecture

#### [📈 Trajectories](docs/trajectories/)
Real-time development state tracking and comprehensive project analysis
- AI-powered activity classification (exploring, implementing, verifying, etc.)
- Status line integration
- Automated project capability documentation

#### [🛡️ Constraints](docs/constraints/)
Real-time code quality enforcement through PreToolUse hooks
- 18 active constraints (security, architecture, code quality, PlantUML, documentation)
- Severity-based enforcement (CRITICAL/ERROR blocks, WARNING/INFO allows)
- Dashboard monitoring at `http://localhost:3030`
- Compliance scoring (0-10 scale)

#### [🧠 Knowledge Management](docs/knowledge-management/)
**Two Complementary Approaches** for knowledge capture and retrieval:
- **Manual/Batch (UKB)**: Git analysis and interactive capture for team sharing
- **Online (Continuous Learning)**: Real-time session learning with semantic search
- **Visualization (VKB)**: Web-based graph visualization at `http://localhost:8080`
- **Ontology Classification**: 4-layer classification pipeline

### Integration Components

- **[System Health Dashboard](integrations/system-health-dashboard/)** - Real-time health visualization
- **[MCP Constraint Monitor](integrations/mcp-constraint-monitor/)** - PreToolUse hook enforcement
- **[MCP Semantic Analysis](integrations/mcp-semantic-analysis/)** - 11-agent AI analysis system
- **[VKB Visualizer](integrations/vkb-visualizer/)** - Knowledge graph visualization
- **[Serena MCP](integrations/mcp-serena/)** - Structure-aware code search
- **[All Integrations](integrations/)** - Complete integration list

### Getting Started

- **[Installation & Setup](docs/getting-started.md)** - Complete installation guide
- **[Provider Configuration](docs/provider-configuration.md)** - LLM provider setup
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

---

## 🔧 Core Features

### Live Session Logging (LSL)

Real-time conversation classification and routing with enterprise-grade security:

- **3-Layer Classification**: Path analysis → Keyword matching → Semantic analysis
- **98.3% Security Effectiveness**: Enhanced redaction with bypass protection
- **Multi-User Support**: Secure user isolation with SHA-256 hash generation
- **Zero Data Loss**: Every exchange properly classified and preserved
- **200x Performance**: Optimized bulk processing with sub-millisecond tracking

**Status**: ✅ Production Ready

### Constraint Monitoring

PreToolUse hook integration for real-time code quality enforcement:

- **18 Active Constraints**: Security, architecture, code quality, PlantUML, documentation
- **Severity-Based**: CRITICAL/ERROR blocks, WARNING/INFO allows with feedback
- **Dashboard Monitoring**: Live violation feed (port 3030)
- **REST API**: Programmatic access (port 3031)
- **Testing Framework**: Automated and interactive constraint testing

**Status**: ✅ Production Ready

### Knowledge Management

Capture, organize, and visualize development insights with git-based team collaboration:

- **UKB (Update Knowledge Base)**: Auto git analysis + interactive capture
- **VKB (Visualize Knowledge Base)**: Web-based graph visualization
- **Graph Database**: Agent-agnostic persistent storage (Graphology + Level)
- **Git-Tracked JSON**: Team collaboration via pretty JSON exports
- **graph-sync CLI**: Manual export/import/status operations
- **Auto-Sync**: Import on startup, export on changes (5s debounce)
- **Team Isolation**: Multi-team support with conflict resolution
- **Domain-Specific**: Automatic domain knowledge bases per team

**Status**: ✅ Production Ready

### Multi-Agent Semantic Analysis

11 specialized agents for comprehensive code analysis:

1. **CoordinatorAgent** - Workflow orchestration
2. **GitHistoryAgent** - Git commits and architectural decisions
3. **VibeHistoryAgent** - Conversation file processing
4. **SemanticAnalysisAgent** - Deep code analysis (uses LLM)
5. **WebSearchAgent** - External pattern research
6. **InsightGenerationAgent** - Insight generation with PlantUML (uses LLM)
7. **ObservationGenerationAgent** - Structured UKB-compatible observations
8. **QualityAssuranceAgent** - Output validation with auto-correction (uses LLM)
9. **ContentValidationAgent** - Stale entity detection and knowledge refresh
10. **PersistenceAgent** - Knowledge base persistence
11. **DeduplicationAgent** - Semantic duplicate detection

**Debug Mode**: Full debugging support with single-step execution, substep inspection, and mock LLM mode for cost-free testing. See [UKB Workflow System](docs/health-system/ukb-workflow-system.md).

**Status**: ✅ Production Ready

---

## ⚡ Usage Examples

### Knowledge Management

```bash
# Start visualization server
vkb

# View at http://localhost:8080

# Manual sync operations
graph-sync status      # View sync status
graph-sync export      # Export all teams to JSON
graph-sync import      # Import all teams from JSON
graph-sync sync        # Full bidirectional sync
```

### Constraint Monitoring

```bash
# Start dashboard (automatic with install)
cd integrations/mcp-constraint-monitor
npm run dashboard  # http://localhost:3030

# API access
curl http://localhost:3031/api/status
curl http://localhost:3031/api/violations
```

### Live Session Logging

```bash
# Automatic during Claude Code sessions
# Session files in .specstory/history/

# Status line shows:
📋🟠2130-2230(3min) →coding
# 📋 = logging, 🟠 = window closing, →coding = activity detected
```

### Semantic Analysis Workflows

**Claude Code:**
```
# Repository analysis workflow
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": ".",
    "depth": 25,
    "significanceThreshold": 6
  }
}
```

**VSCode CoPilot:**
```bash
# Via HTTP API
curl -X POST http://localhost:8765/api/semantic/analyze-repository \
  -H "Content-Type: application/json" \
  -d '{"repository": ".", "depth": 25}'
```

---

## 🛠️ Configuration

### Quick Configuration

```bash
# Set API keys
export ANTHROPIC_API_KEY="your-key-here"
export OPENAI_API_KEY="optional-fallback"

# Configure preferred agent
export CODING_AGENT="claude"  # or "copilot"
```

### Detailed Configuration

See [Getting Started](docs/getting-started.md) for:
- API key setup
- MCP configuration
- Network setup (proxies/firewalls)
- Verification steps

---

## 📊 System Status

### Quick Health Check

```bash
# Test all components (check-only mode - safe, no modifications)
./scripts/test-coding.sh

# Interactive mode - prompts before each repair
./scripts/test-coding.sh --interactive

# Auto-repair mode - fixes coding-internal issues only
./scripts/test-coding.sh --auto-repair

# Check MCP servers
cd integrations/mcp-server-semantic-analysis && npm test

# Check constraint monitor
cd integrations/mcp-constraint-monitor && npm test
```

**Note**: The test script defaults to `--check-only` mode and will NEVER auto-install system packages.

### Current Status

✅ **Health System** - 4-layer monitoring with auto-healing
✅ **Live Session Logging** - Real-time classification with 98.3% security
✅ **Constraint Monitoring** - 18 active constraints with PreToolUse hooks
✅ **Knowledge Management** - UKB/VKB with MCP integration
✅ **Multi-Agent Analysis** - 11 agents with workflow orchestration
✅ **Status Line System** - Real-time indicators via unified tmux status bar
✅ **Cross-Platform** - macOS, Linux, Windows support

---

## 🤝 Contributing

This is a personal development toolkit. For issues or suggestions:

1. Check [Troubleshooting](docs/troubleshooting.md)
2. Review [Architecture Documentation](docs/architecture/README.md)
3. Create an issue with detailed information

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Copyright © 2025 Frank Wornle

---

## 🔗 Quick Links

- **Documentation Hub**: [docs/README.md](docs/README.md)
- **Installation Guide**: [docs/getting-started.md](docs/getting-started.md)
- **LLM Providers & Local Models**: [docs/provider-configuration.md](docs/provider-configuration.md)
- **Agent Abstraction API**: [docs/architecture/agent-abstraction-api.md](docs/architecture/agent-abstraction-api.md)
- **Adding Agents**: [docs/agent-integration-guide.md](docs/agent-integration-guide.md)
- **Docker Architecture**: [docs/architecture-report.md](docs/architecture-report.md)
- **Docker Mode Transition**: [docs/docker-mode-transition.md](docs/docker-mode-transition.md)
- **Docker Deployment**: [docker/README.md](docker/README.md)
- **System Overview**: [docs/system-overview.md](docs/system-overview.md)
- **Core Systems**: [docs/core-systems/](docs/core-systems/)
- **Integrations**: [docs/integrations/](docs/integrations/)
- **Knowledge Management**: [docs/knowledge-management/](docs/knowledge-management/)
