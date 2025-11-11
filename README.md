# Coding - AI Development Toolkit

A comprehensive AI-powered development toolkit featuring live session logging, real-time constraint monitoring, semantic knowledge management, and multi-agent analysis — supporting both Claude Code and GitHub CoPilot.

---

## 🚀 Quick Start

```bash
# Install the system
./install.sh

# Start Claude Code with all features
coding

# Or use specific agent
coding --claude
coding --copilot
```

**Next Steps**: [Getting Started Guide](docs/getting-started.md)

---

## 🎯 What It Provides

### Core Capabilities

- **📋 Live Session Logging** - Real-time conversation classification and routing
- **🛡️ Constraint Monitoring** - PreToolUse hook enforcement for code quality
- **🧠 Knowledge Management** - Capture, visualize, and share development insights
- **🤖 Multi-Agent Analysis** - 10 specialized AI agents for comprehensive code analysis
- **📊 Status Line System** - Real-time health monitoring and activity indicators
- **🏥 Pre-Prompt Health Verification** - Automatic system health checks on every Claude prompt (self-healing)
- **🚀 Trajectory Generation** - Automated project analysis and documentation

### Integration Support

- **Claude Code** - Full MCP server integration
- **GitHub CoPilot** - Enhanced VSCode integration with fallback services
- **Agent-Agnostic** - Same features regardless of AI assistant

---

## 📚 Documentation

### Getting Started

- **[Installation & Setup](docs/getting-started.md)** - Complete installation guide with configuration
- **[Provider Configuration](docs/provider-configuration.md)** - LLM provider setup (Groq, Anthropic, OpenAI, Gemini, Local)
- **[System Overview](docs/system-overview.md)** - High-level architecture and capabilities
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

### Core Systems

- **[Live Session Logging](docs/core-systems/live-session-logging.md)** - Real-time conversation classification (98.3% security effectiveness)
- **[Constraint Monitoring](docs/core-systems/constraint-monitoring.md)** - Real-time code quality enforcement (18 active constraints)
- **[Status Line System](docs/core-systems/status-line.md)** - Visual health monitoring and activity indicators
- **[Health Verification System](integrations/system-health-dashboard/README.md)** - Pre-prompt health checks with self-monitoring and auto-healing
- **[Trajectory Generation](docs/core-systems/trajectory-generation.md)** - Automated project analysis

### Knowledge Management

- **[Knowledge Management Overview](docs/knowledge-management/README.md)** - UKB, VKB, and workflows
- **[UKB - Update Knowledge Base](docs/knowledge-management/ukb-update.md)** - Capture development insights
- **[VKB - Visualize Knowledge Base](docs/knowledge-management/vkb-visualize.md)** - Interactive graph visualization
- **[Workflows](docs/knowledge-management/workflows.md)** - Orchestrated analysis workflows

### Integration Components

- **[Integrations Overview](docs/integrations/README.md)** - All integration components
- **[MCP Semantic Analysis](docs/integrations/mcp-semantic-analysis.md)** - 10-agent AI analysis system
- **[MCP Constraint Monitor](docs/integrations/mcp-constraint-monitor.md)** - Real-time constraint enforcement
- **[Serena AST Analysis](docs/integrations/serena-ast-analysis.md)** - Structure-aware code search
- **[Browser Access](docs/integrations/browser-access.md)** - Browser automation (Stagehand)
- **[VSCode CoPilot](docs/integrations/vscode-copilot.md)** - Enhanced GitHub CoPilot

### Architecture

- **[Architecture Overview](docs/architecture/README.md)** - System architecture and design patterns
- **[Reference Documentation](docs/reference/README.md)** - API keys, troubleshooting, advanced topics

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

10 specialized agents for comprehensive code analysis:

1. **CoordinatorAgent** - Workflow orchestration
2. **GitHistoryAgent** - Git commits and architectural decisions
3. **VibeHistoryAgent** - Conversation file processing
4. **SemanticAnalysisAgent** - Deep code analysis (uses LLM)
5. **WebSearchAgent** - External pattern research
6. **InsightGenerationAgent** - Insight generation with PlantUML (uses LLM)
7. **ObservationGenerationAgent** - Structured UKB-compatible observations
8. **QualityAssuranceAgent** - Output validation with auto-correction (uses LLM)
9. **PersistenceAgent** - Knowledge base persistence
10. **DeduplicationAgent** - Semantic duplicate detection

**Status**: ✅ Production Ready

---

## ⚡ Usage Examples

### Knowledge Management

```bash
# Capture insights from recent git commits
ukb

# Interactive structured capture
ukb --interactive

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
# Test all components
./scripts/test-coding.sh

# Check MCP servers
cd integrations/mcp-server-semantic-analysis && npm test

# Check constraint monitor
cd integrations/mcp-constraint-monitor && npm test
```

### Current Status

✅ **Live Session Logging** - Real-time classification with 98.3% security
✅ **Constraint Monitoring** - 18 active constraints with PreToolUse hooks
✅ **Knowledge Management** - UKB/VKB with MCP integration
✅ **Multi-Agent Analysis** - 10 agents with workflow orchestration
✅ **Status Line System** - 4-layer health monitoring
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
- **System Overview**: [docs/system-overview.md](docs/system-overview.md)
- **Core Systems**: [docs/core-systems/](docs/core-systems/)
- **Integrations**: [docs/integrations/](docs/integrations/)
- **Knowledge Management**: [docs/knowledge-management/](docs/knowledge-management/)
