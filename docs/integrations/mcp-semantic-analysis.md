# MCP Semantic Analysis Integration

**Component**: [mcp-server-semantic-analysis](../../integrations/mcp-server-semantic-analysis/)
**Type**: MCP Server (Node.js)
**Purpose**: AI-powered code analysis with 10 specialized agents and Graphology+LevelDB persistence

---

## What It Provides

The MCP Semantic Analysis Server is a standalone Node.js application that provides comprehensive AI-powered code analysis through the Model Context Protocol.

### 10 Intelligent Agents

**Orchestration (1 agent):**
10. **CoordinatorAgent** - Orchestrates ALL agents via workflow definitions with step dependencies, data flow, and GraphDB integration

**Analysis Agents (5 agents - No LLM):**
1. **GitHistoryAgent** - Analyzes git commits and architectural decisions
2. **VibeHistoryAgent** - Processes conversation files for context
4. **WebSearchAgent** - External pattern research via DuckDuckGo (No LLM)
6. **ObservationGenerationAgent** - Creates structured UKB-compatible observations
8. **PersistenceAgent** - Persists entities to Graphology+LevelDB graph database

**LLM-Powered Agents (3 agents):**
3. **SemanticAnalysisAgent** - Deep code analysis using 3-tier LLM chain
5. **InsightGenerationAgent** - Generates insights with PlantUML diagrams using LLMs
7. **QualityAssuranceAgent** - Validates outputs with auto-correction using LLMs

**Infrastructure Agents (1 agent):**
9. **DeduplicationAgent** - Semantic duplicate detection and merging

**Note**: SynchronizationAgent has been removed - GraphDatabaseService handles all persistence automatically via Graphology (in-memory) + LevelDB (persistent storage)

**LLM Provider Chain:** Custom LLM (primary) → Anthropic Claude (secondary) → OpenAI GPT (fallback)

### 12 MCP Tools

- `heartbeat` - Connection health monitoring
- `test_connection` - Server connectivity verification
- `determine_insights` - AI-powered content insight extraction
- `analyze_code` - Code pattern and quality analysis
- `analyze_repository` - Repository-wide architecture analysis
- `extract_patterns` - Reusable design pattern identification
- `create_ukb_entity_with_insight` - Knowledge base entity creation
- `execute_workflow` - Coordinated multi-agent workflows
- `generate_documentation` - Automated documentation generation
- `create_insight_report` - Detailed analysis reports
- `generate_plantuml_diagrams` - Architecture diagram generation
- `generate_lessons_learned` - Lessons learned document creation

---

## Integration with Coding

### How It Connects

The MCP server integrates with Claude Code through the Model Context Protocol:

```
Claude Code → MCP Protocol → Semantic Analysis Server → CoordinatorAgent → 10 Worker Agents → Analysis Results
```

### Agent Coordination Model

**CRITICAL**: The `CoordinatorAgent` is the **ONLY** component that directly invokes other agents. Agents do NOT call each other directly.

**Workflow Execution:**

1. MCP tool invoked (e.g., `execute_workflow "complete-analysis"`)
2. Coordinator loads workflow definition with steps and dependencies
3. For each step:
   - Resolves dependencies from previous steps
   - Injects results via templating: `{{step_name.result}}`
   - Executes agent with prepared parameters
   - Stores results for dependent steps
4. Returns final aggregated results

**Example Data Flow:**

```text
Step 1: GitHistory.analyze() → {{git_results}}
Step 2: VibeHistory.analyze() → {{vibe_results}}
Step 3: Semantic.analyze({{git_results}}, {{vibe_results}}) → {{semantic_results}}
Step 4: WebSearch.research({{semantic_results}}) → {{web_results}}
Step 5: Insights.generate({{semantic_results}}, {{web_results}}) → {{insights}}
...
```

### Configuration

Configured in `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["/Users/<username>/Agentic/coding/integrations/mcp-server-semantic-analysis/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key-here",
        "OPENAI_API_KEY": "optional-fallback"
      }
    }
  }
}
```

### Usage in Workflows

**Within Claude Code session:**

```json
// Analyze current repository
determine_insights {
  "repository": ".",
  "conversationContext": "Current refactoring work",
  "depth": 10
}

# Execute complete analysis workflow (persists to graph DB)
execute_workflow {
  "workflow_name": "complete-analysis"
}

# Extract patterns from code
extract_patterns {
  "source": "authentication module",
  "pattern_types": ["design", "security"]
}
```

**Storage Architecture:**
- All entities stored to GraphDB: `.data/knowledge-graph/` (Graphology + LevelDB)
- Auto-export to `shared-memory-coding.json` every 30 seconds
- Insight `.md` files written to `knowledge-management/insights/`

---

## Performance & Resources

- **Startup Time**: ~2s
- **Memory**: ~200MB
- **Analysis Time**: 1-5 minutes for full repository
- **LLM Provider**: Anthropic Claude (primary), OpenAI GPT (fallback)

---

## Full Documentation

For complete documentation, see:

**[integrations/mcp-server-semantic-analysis/README.md](https://github.com/fwornle/mcp-server-semantic-analysis/blob/main/README.md)**

Topics covered:

- Detailed agent descriptions
- Complete tool reference
- Configuration options
- Workflow examples
- Troubleshooting guide
- Development guide

---

## See Also

- [System Overview](../system-overview.md#mcp-semantic-analysis-server)
- [Knowledge Management](../knowledge-management/README.md)
- [Integration Overview](README.md)
