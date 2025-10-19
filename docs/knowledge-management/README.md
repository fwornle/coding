# Knowledge Management

**Purpose**: Comprehensive knowledge management through **three complementary systems**.

---

## 🚀 Quick Navigation

**New to knowledge management?** Start here:

| Document | Purpose | Audience |
|----------|---------|----------|
| **[System Comparison](system-comparison.md)** | **START HERE** - Understand all three knowledge systems | All users |
| **[Continuous Learning System](continuous-learning-system.md)** | Real-time session learning (NEW) | Developers |
| **UKB/VKB** (this document) | Manual knowledge capture & visualization | Team leads |
| **[MCP Semantic Analysis](../integrations/mcp-semantic-analysis.md)** | Deep code analysis with 11 agents | Architects |

---

## Three Complementary Knowledge Systems

The coding project provides **three knowledge management systems** that work together:

### 1. UKB/VKB (Manual Knowledge Capture)

**This Document** - Manual knowledge capture and visualization:

- **UKB**: Command-line tool for capturing and updating knowledge
- **VKB**: Web-based visualization server for exploring knowledge graphs
- **MCP Memory**: Runtime knowledge graph storage and querying
- **Multi-Project Support**: Domain-specific knowledge bases with centralized storage

**When to use**: Manual capture of architectural decisions, team-wide knowledge sharing

### 2. Continuous Learning System (Automatic Real-Time)

**[Documentation](continuous-learning-system.md)** - Automatic real-time learning:

- **Automatic extraction** from live coding sessions
- **Budget-conscious** ($8.33/month limit)
- **Privacy-first** (sensitive data → local models)
- **Agent-agnostic** (Claude/Copilot/Cursor)

**When to use**: Real-time learning, budget control, privacy-critical work

### 3. MCP Semantic Analysis (Deep Code Analysis)

**[Documentation](../integrations/mcp-semantic-analysis.md)** - 11-agent deep analysis:

- **11 specialized agents** for comprehensive code analysis
- **On-demand analysis** via MCP tools
- **Repository-wide** pattern extraction
- **Architecture diagrams** with PlantUML

**When to use**: Full repository analysis, architecture review, pattern extraction

---

## How the Three Systems Work Together

```
┌─────────────────────────────────────────────────┐
│  CONTINUOUS LEARNING (Automatic Real-Time)      │
│  • Extracts knowledge during coding             │
│  • Budget: $8.33/month strict limit             │
│  • Storage: Qdrant + SQLite                     │
└────────────────┬────────────────────────────────┘
                 │
                 │ When deeper analysis needed
                 ▼
┌─────────────────────────────────────────────────┐
│  MCP SEMANTIC ANALYSIS (On-Demand)              │
│  • 11 specialized agents                        │
│  • Repository-wide analysis                     │
│  • Architecture diagrams                        │
└────────────────┬────────────────────────────────┘
                 │
                 │ Insights stored in
                 ▼
┌─────────────────────────────────────────────────┐
│  UKB/VKB (Manual + Git-Tracked)                 │
│  • shared-memory.json                           │
│  • Team-wide sharing                            │
│  • Visual knowledge graph                       │
└─────────────────────────────────────────────────┘
```

**See [System Comparison](system-comparison.md) for detailed comparison.**

---

## What This Document Covers (UKB/VKB)

This document focuses on the **UKB/VKB system** for manual knowledge capture and visualization.

### Core Capabilities

- **Knowledge Capture** - Interactive and automated insight extraction
- **Graph Visualization** - Interactive web-based knowledge graph explorer
- **Cross-Project Learning** - Share patterns across multiple projects
- **Semantic Search** - Find relevant knowledge quickly
- **Git Integration** - Automatic knowledge updates from commits

---

## Quick Start

### Basic Usage

```bash
# Update knowledge base (auto-analyzes recent git commits)
ukb

# Interactive deep insight capture
ukb --interactive

# Start visualization server
vkb

# View knowledge graph at http://localhost:8080
```

### Common Workflows

**Daily Development:**
```bash
# Morning - view accumulated knowledge
vkb

# Throughout day - normal development
git commit -m "implement feature"

# End of day - capture insights
ukb
```

**Team Knowledge Sharing:**
```bash
# Capture architectural decisions
ukb --interactive

# Share via git
git add shared-memory*.json
git commit -m "docs: update knowledge base"
git push

# Team members get updates
git pull
vkb restart  # Refresh visualization
```

---

## Knowledge Management Components

### [UKB - Update Knowledge Base](./ukb-update.md)

Command-line tool for capturing development insights:

- **Auto Mode**: Analyzes recent git commits for patterns
- **Interactive Mode**: Guided prompts for structured insight capture
- **Search**: Find relevant knowledge by keyword
- **Management**: Add, remove, rename entities and relations

**Key Features:**
- Cross-platform Node.js implementation
- Git history analysis with pattern detection
- Structured problem-solution-rationale capture
- Real-time validation and quality assurance
- MCP synchronization for runtime access

### [VKB - Visualize Knowledge Base](./vkb-visualize.md)

Web-based knowledge graph visualization server:

- **Interactive Visualization**: Explore knowledge graphs in browser
- **Server Management**: Start, stop, restart with automatic recovery
- **Real-time Updates**: Refresh data without restart
- **Health Monitoring**: Automatic health checks and status reporting
- **Programmatic API**: Control server from Node.js code

**Key Features:**
- Cross-platform server management
- Process lifecycle control with PID tracking
- Port conflict resolution
- Comprehensive logging and diagnostics
- Browser integration (auto-open on start)

### [Knowledge Workflows](./workflows.md)

Orchestrated analysis workflows for comprehensive knowledge gathering:

- **Repository Analysis**: Comprehensive codebase analysis
- **Conversation Analysis**: Extract insights from discussions
- **Technology Research**: Automated research on technologies
- **Cross-Project Learning**: Share knowledge across projects

---

## Domain-Specific Knowledge Bases

The system automatically creates domain-specific knowledge bases for multi-project teams:

```
/Users/<username>/Agentic/coding/
├── shared-memory-coding.json     # Cross-team patterns
├── shared-memory-raas.json       # RaaS domain knowledge
├── shared-memory-ui.json         # UI team knowledge
└── shared-memory-resi.json       # Resilience team knowledge
```

**Benefits:**
- Domain isolation - specialized knowledge per team
- Cross-project patterns - shared architectural patterns
- Team-specific expertise - domain expert knowledge repositories
- Onboarding efficiency - domain-specific guidance for new members

### Creating Domain Knowledge Base

```bash
# Navigate to domain project directory
cd /path/to/raas-project

# First ukb command automatically creates domain-specific file
ukb --list-entities
# Creates: /Users/<username>/Agentic/coding/shared-memory-raas.json

# Add domain entity
ukb --interactive
```

---

## Knowledge Types

### Entity Types

- **Pattern**: Reusable solutions and approaches
- **Solution**: Specific problem fixes
- **Architecture**: System design insights
- **Tool**: Technology and framework usage
- **Workflow**: Process and methodology insights
- **Problem**: Challenges and issues encountered

### Relation Types

- **implements**: Pattern implements architecture
- **solves**: Solution solves problem
- **uses**: Component uses tool
- **depends_on**: Dependency relationship
- **related_to**: General relationship
- **improves**: Enhancement relationship

---

## Integration with Coding Workflows

### Claude Code Integration

```javascript
// MCP tools available in Claude Code
const tools = [
  'mcp__memory__create_entities',      // Create knowledge entities
  'mcp__memory__search_nodes',         // Search knowledge graph
  'mcp__semantic-analysis__analyze_repository',  // Analyze codebase
  'mcp__semantic-analysis__analyze_conversation' // Extract insights
];
```

### VSCode CoPilot Integration

```bash
# Start CoPilot with knowledge management
coding --copilot

# HTTP endpoints
POST /api/knowledge/update      # Update knowledge base
GET  /api/knowledge/search      # Search knowledge
GET  /api/knowledge/stats       # Get statistics
POST /api/semantic/analyze-repository  # Analyze code
```

### Direct CLI Fallback

```bash
# Direct knowledge management
ukb --interactive              # Capture knowledge
ukb --auto                    # Analyze git commits
vkb                          # View knowledge graph
```

---

## Data Structure

### Entity Structure

```json
{
  "id": "unique-identifier",
  "name": "EntityName",
  "entityType": "Pattern|Solution|Architecture|Tool",
  "significance": 8,
  "observations": [
    {
      "type": "insight",
      "content": "Key learning or observation",
      "date": "ISO-8601 timestamp"
    }
  ],
  "metadata": {
    "technologies": ["React", "Node.js"],
    "files": ["src/component.js"],
    "references": ["https://docs.example.com"]
  }
}
```

### Relation Structure

```json
{
  "id": "unique-identifier",
  "from": "SourceEntityName",
  "to": "TargetEntityName",
  "relationType": "implements|solves|uses",
  "significance": 7,
  "created": "ISO-8601 timestamp"
}
```

---

## Full Documentation

### Detailed Guides

- **[UKB - Update Knowledge Base](./ukb-update.md)** - Complete UKB documentation with API reference and use cases
- **[VKB - Visualize Knowledge Base](./vkb-visualize.md)** - Complete VKB documentation with server management and API reference
- **[Knowledge Workflows](./workflows.md)** - Orchestrated analysis workflows and cross-project learning

### Integration Documentation

- **[MCP Semantic Analysis](../integrations/mcp-semantic-analysis.md)** - 11-agent AI-powered analysis system
- **[VSCode CoPilot](../integrations/vscode-copilot.md)** - VSCode extension with knowledge management
- **[Browser Access](../integrations/browser-access.md)** - Web research and data extraction

---

## See Also

- [System Overview](../system-overview.md#knowledge-management)
- [Getting Started](../getting-started.md)
- [Integration Overview](../integrations/README.md)
