# System Overview

The Coding system provides a unified semantic analysis and knowledge management platform that learns from every development interaction across all AI coding assistants.

## What is Coding?

Coding is an intelligent development infrastructure that:

- **Captures** every conversation and code change across projects
- **Classifies** content to route knowledge appropriately
- **Analyzes** patterns using 14 specialized AI agents
- **Enforces** code quality through real-time constraint monitoring
- **Accumulates** knowledge that improves over time
- **Works** seamlessly with Claude Code, GitHub CoPilot, and other AI assistants

![Complete System Overview](../images/complete-system-overview.png)

*The complete coding system showing all capabilities: real-time monitoring (LSL, Constraints, Trajectory, Status Line), knowledge management (Continuous Learning, UKB/VKB), MCP integrations, LLM providers, and storage architecture.*

---

## Core Capabilities

### 1. Live Session Logging (LSL)

**Real-time conversation classification and intelligent routing**

- **4-Layer Classification**: Path analysis → Keywords → Embeddings → Semantic LLM
- **Smart Routing**: Automatically separates infrastructure work from project-specific content
- **Zero Data Loss**: Every exchange captured and properly organized
- **Multi-Project Support**: Simultaneous monitoring across multiple projects
- **Performance**: <50ms classification with 95%+ accuracy

**Learn more:** [Live Session Logging Documentation](lsl/README.md)

### 2. Constraint Monitoring

**Real-time code quality enforcement through PreToolUse hooks**

- **18 Active Constraints**: Security, architecture, code quality, documentation
- **Severity-Based Enforcement**: Critical/Error blocks, Warning/Info guides
- **PreToolUse Interception**: Blocks violations before execution
- **Dashboard Monitoring**: Live violation feed and compliance metrics
- **Testing Framework**: Automated and interactive testing with 44% detection rate

**Learn more:** [Constraint Monitoring Documentation](constraints/README.md)

### 3. Trajectory Generation

**Automated project analysis and living documentation**

- **Repository Scanning**: Multi-layered code analysis
- **MCP-Powered Analysis**: Deep semantic understanding using 14 agents
- **Two-Tier System**: Light (quick insights) and Deep (comprehensive reports)
- **Real-Time Updates**: Integrates with LSL for continuous trajectory updates
- **Capability Focus**: Documents what the project does vs. historical activities

**Learn more:** [Trajectory Generation Documentation](trajectories/README.md)

### 4. Status Line System

**Visual system health and activity indicators**

- **Real-Time Status**: Shows LSL activity, constraint compliance, trajectory state
- **Health Monitoring**: 4-layer monitoring with automatic recovery
- **Session Windows**: Time-based session boundaries with activity indicators
- **Activity Detection**: Distinguishes coding infrastructure vs. project work
- **Visual Feedback**: Icons show system state at a glance

**Learn more:** [Status Line Documentation](health-system/README.md)

---

## Integration Architecture

The system is built on **self-contained integration components**, each with its own repository and documentation:

### MCP Semantic Analysis Server

**14-agent AI analysis system for deep code understanding**

- CoordinatorAgent (orchestration)
- GitHistoryAgent, VibeHistoryAgent, SemanticAnalysisAgent (uses LLM)
- WebSearchAgent, InsightGenerationAgent (uses LLM), ObservationGenerationAgent
- QualityAssuranceAgent (uses LLM), PersistenceAgent, DeduplicationAgent

**Documentation:** [integrations/mcp-server-semantic-analysis/](../integrations/mcp-server-semantic-analysis/)

### MCP Constraint Monitor

**Real-time constraint enforcement with dashboard**

- PreToolUse hook interception
- 18 configurable constraints across 4 severity levels
- REST API (port 3031) and Next.js Dashboard (port 3030)
- Compliance scoring and violation tracking

**Documentation:** [integrations/mcp-constraint-monitor/](../integrations/mcp-constraint-monitor/)

### Serena AST Analysis

**AST-based semantic code search and analysis**

- Structure-based code search (not text patterns)
- Semantic relationship understanding
- Security vulnerability detection through structure
- Refactoring support with dependency analysis

**Documentation:** [integrations/serena/](../integrations/serena/)

### Browser Access (Stagehand)

**Browser automation for web research and testing**

- MCP server for browser control
- Web scraping and interaction
- Automated testing support

**Documentation:** [integrations/browser-access/](../integrations/browser-access/)

### VSCode CoPilot Integration

**Enhanced GitHub CoPilot with knowledge management**

- Knowledge base access from CoPilot chat
- Command palette integration
- Seamless UKB/VKB access

**Documentation:** [integrations/vscode-km-copilot/](../integrations/vscode-km-copilot/)

---

## Knowledge Management

### Update Knowledge Base (UKB)

**Capture insights from development work**

- Interactive insight capture
- Automatic git commit analysis
- Pattern extraction from conversations
- Significance scoring (1-10)
- PlantUML diagram generation

**Usage:**
```bash
# Manual insight
ukb "Problem: X, Solution: Y, Technologies: Z"

# Auto-analyze git history
cd /path/to/project
ukb  # Analyzes recent commits
```

### Visualize Knowledge Base (VKB)

**Interactive web-based knowledge graph**

- 3D force-directed graph visualization
- Entity and relationship exploration
- Search and filtering
- Export capabilities
- Real-time updates

**Usage:**
```bash
vkb  # Opens http://localhost:8080
```

**Learn more:** [Knowledge Management Documentation](knowledge-management/README.md)

---

## Architecture Highlights

### 4-Layer Monitoring System

Bulletproof reliability through redundant monitoring:

1. **System-Level Watchdog** - macOS launchd, runs every 60s (ultimate failsafe)
2. **Global Service Coordinator** - Self-healing daemon with exponential backoff
3. **Monitoring Verifier** - Mandatory session-level verification (blocks Claude startup if unhealthy)
4. **Service-Level Health** - Individual service self-monitoring and auto-restart

**Learn more:** [4-Layer Monitoring Architecture](health-system/README.md#architecture)

### Classification & Routing

Intelligent content classification for proper knowledge organization:

- **Layer 0**: Session filter (detects session continuations)
- **Layer 1**: Path analyzer (file operation patterns) - <1ms
- **Layer 2**: Keyword matcher (coding-related terms) - <10ms
- **Layer 3**: Embedding classifier (vector similarity) - <50ms
- **Layer 4**: Semantic analyzer (LLM-powered) - <100ms when needed

**Learn more:** [LSL Classification System](lsl/README.md#reliablecodingclassifier)

### Storage Architecture

The coding project uses a **three-tier storage architecture** optimized for different data types:

1. **Graph Database** (Graphology + Level) - `.data/knowledge-graph/`
   - **Primary knowledge storage** for entities and relations
   - Used by both Continuous Learning (automatic) and UKB/VKB (manual)
   - Persistent local storage (binary LevelDB format)
   - Auto-persists every 5 seconds

2. **Qdrant Vector Database**
   - Semantic similarity search via embeddings
   - Written by Continuous Learning, queryable by UKB/VKB
   - 384-dim (fast) and 1536-dim (accurate) collections

3. **SQLite Analytics Database** - `.data/knowledge.db`
   - Budget tracking, session metrics, embedding cache
   - **NOT for knowledge storage** (moved to Graph DB as of 2025-10-22)

**Optional**: Manual export to `.data/knowledge-export/*.json` for git-tracked team collaboration.

**Learn more:** [Storage Architecture](architecture/memory-systems.md) | [Knowledge Management](knowledge-management/README.md)

---

## Workflow Examples

### Daily Development Workflow

```bash
# Start Claude Code with all systems
coding --project ~/Agentic/my-project

# Work on code...
# LSL automatically captures and classifies conversations
# Constraint monitor blocks quality violations
# Trajectory system tracks project evolution

# At end of day, capture key insights
ukb  # Auto-analyzes git commits since last run

# View accumulated knowledge
vkb
```

### Cross-Project Learning

```bash
# Work on project A
cd ~/projects/auth-service
coding
# Learn patterns about authentication...

# Switch to project B
cd ~/projects/api-gateway
coding
# Knowledge from project A is available!
# Search for "authentication" in knowledge base
```

### Semantic Analysis Workflow

Within Claude Code session:
```
# Analyze codebase
determine_insights {
  "repository": ".",
  "conversationContext": "Refactoring authentication",
  "depth": 10
}

# Generate comprehensive report
execute_workflow {
  "workflow_name": "complete-analysis"
}

# Extract reusable patterns
extract_patterns {
  "source": "authentication module",
  "pattern_types": ["design", "security"]
}
```

---

## Key Benefits

### For Individual Developers

- **Learn from Every Session**: Captures insights automatically
- **Never Lose Knowledge**: All conversations and decisions preserved
- **Faster Problem Solving**: Search accumulated patterns and solutions
- **Quality Enforcement**: Real-time feedback on code quality
- **Cross-Project Intelligence**: Learn once, apply everywhere

### For Teams

- **Shared Knowledge Base**: Team learning accumulates in git
- **Consistent Standards**: Enforced constraints across team
- **Pattern Library**: Reusable solutions for common problems
- **Onboarding Acceleration**: New members learn from team history
- **Architectural Insights**: Understand system evolution over time

### For AI Assistants

- **Context Enrichment**: Access to accumulated project knowledge
- **Constraint Awareness**: Learns from blocked violations
- **Pattern Recognition**: Applies learned patterns to new situations
- **Cross-Session Learning**: Maintains context across sessions
- **Quality Improvement**: Adapts to enforce standards

---

## Deployment Options

The Coding system supports two deployment modes:

### Native Mode (Default)

MCP servers run as native stdio processes, started and managed by Claude CLI.

```bash
coding --claude
```

**Characteristics:**
- Simple setup, no Docker required
- Lower memory footprint
- Processes restart with each session
- Best for individual developers

### Docker Mode (Containerized)

MCP servers run as HTTP/SSE services in Docker containers with persistent operation.

```bash
touch .docker-mode
docker compose -f docker/docker-compose.yml up -d
coding --claude
```

![Docker Architecture](images/docker-architecture.png)

**Architecture:**
- **Host**: Claude CLI + lightweight stdio proxies
- **Containers**: MCP SSE servers on ports 3847-3850
- **Databases**: Qdrant (6333), Redis (6379), Memgraph (7687)

**Characteristics:**
- Persistent services across sessions
- Shared browser automation across parallel Claude sessions
- Better resource isolation
- Best for teams and multi-session workflows

See [Docker Deployment Guide](../docker/README.md) for detailed setup.

---

## System Requirements

- **Node.js 18+** - All components are Node.js based
- **Git** - Version control and knowledge base storage
- **3GB RAM minimum** - For MCP servers and monitoring
- **macOS, Linux, or Windows** (WSL/Git Bash)

### Optional Components

- **Chrome/Chromium** - For browser automation
- **VSCode** - For CoPilot integration
- **Docker** - For containerized deployments

---

## Performance Characteristics

- **LSL Classification**: <50ms per tool call
- **Constraint Checking**: <5ms per tool call
- **Knowledge Base Queries**: <100ms
- **Semantic Analysis**: 1-5 minutes for full repository
- **Memory Footprint**: ~500MB for all systems

---

## Next Steps

- **[Getting Started](getting-started.md)** - Install and configure
- **[Core Systems](.)** - Deep dive into each system
- **[Integrations](integrations/)** - External component documentation
- **[Knowledge Management](knowledge-management/)** - UKB/VKB workflows
- **[Architecture](architecture/)** - System design and internals

---

*The goal: Make AI-assisted development more intelligent by learning from every interaction and accumulating knowledge across projects and team members.*
