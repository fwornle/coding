# MCP Semantic Analysis Integration

**Component**: [mcp-server-semantic-analysis](../../integrations/mcp-server-semantic-analysis/)
**Type**: MCP Server (Node.js)
**Purpose**: AI-powered code analysis with 13 specialized agents, code graph analysis, and Graphology+LevelDB persistence

---

## What It Provides

The MCP Semantic Analysis Server is a standalone Node.js application that provides comprehensive AI-powered code analysis through the Model Context Protocol.

### 14 Intelligent Agents

**Orchestration (1 agent):**
1. **CoordinatorAgent** - Orchestrates ALL agents via workflow definitions with step dependencies, data flow, and GraphDB integration

**LLM-Powered Agents (10 core agents - via SemanticAnalyzer):**
2. **SemanticAnalysisAgent** - Deep code analysis using 3-tier LLM chain
3. **InsightGenerationAgent** - Generates insights with PlantUML diagrams using LLMs
4. **QualityAssuranceAgent** - Enhanced validation with:
    - LLM-powered semantic value filtering (removes low-value entities)
    - Quality-based feedback loops (up to 3 iterations with progressive strictness)
    - Entity evaluation on 5 criteria: Specificity, Actionability, Evidence, Uniqueness, Naming
5. **VibeHistoryAgent** - Processes conversation files using LLM for context extraction
6. **ObservationGenerationAgent** - Creates UKB-compatible observations using LLM structuring
7. **ContentValidationAgent** - LLM-powered staleness detection and entity refresh
8. **GitHistoryAgent** - LLM-powered commit pattern analysis, code evolution extraction, and theme identification
9. **WebSearchAgent** - External research via DuckDuckGo with optional LLM summarization and result ranking
10. **OntologyClassificationAgent** - LLM-powered ontology classification with semantic inference
11. **DocumentationLinkerAgent** - Links documentation to code entities with LLM-powered semantic matching

**Embedding/External LLM Agents (2 agents):**
12. **DeduplicationAgent** - Semantic duplicate detection using OpenAI embeddings (text-embedding-3-small)
13. **CodeGraphAgent** - AST-based code indexing via Memgraph with LLM queries (requires code-graph-rag)

**Non-LLM Agent (1 agent):**
14. **PersistenceAgent** - Persists entities to Graphology+LevelDB (no LLM needed - pure data storage)

**Note**: SynchronizationAgent has been removed - GraphDatabaseService handles all persistence automatically via Graphology (in-memory) + LevelDB (persistent storage)

**LLM Provider Chain:** Custom LLM (primary) → Anthropic Claude (secondary) → OpenAI GPT (fallback)

### 14 MCP Tools

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
- `reset_analysis_checkpoint` - Reset analysis checkpoints
- `refresh_entity` - Refresh specific knowledge entity
- `analyze_code_graph` - AST-based code analysis via Memgraph

---

## Integration with Coding

### How It Connects

The MCP server integrates with any MCP-compatible coding agent through the Model Context Protocol:

```
Coding Agent → MCP Protocol → Semantic Analysis Server → CoordinatorAgent → 14 Worker Agents → Analysis Results
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

**Example Data Flow (complete-analysis workflow):**

```text
Step 1: GitHistory.analyze() → {{git_results}}
Step 2: VibeHistory.analyze() → {{vibe_results}}
Step 3: Semantic.analyze({{git_results}}, {{vibe_results}}) → {{semantic_results}}
Step 4: WebSearch.research({{semantic_results}}) → {{web_results}}
Step 5: Insights.generate({{semantic_results}}, {{web_results}}) → {{insights}}
Step 6: Observations.generate({{insights}}) → {{observations}}
Step 7: Ontology.classify({{observations}}) → {{ontology_results}}
Step 8: CodeGraph.index() → {{code_graph_results}}
Step 9: DocLinker.analyze() → {{doc_links}}
Step 10: QA.validate({{all_results}}) → {{qa_results}}
Step 11: Persistence.save({{all_results}}) → saved
Step 12: Deduplication.merge() → deduplicated
Step 13: ContentValidation.refresh() → validated
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

**Within coding agent session:**

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

### Quality-Based Feedback Loops

The QA agent implements intelligent quality loops that ensure high-value knowledge entities:

![QA Feedback Loop](../images/qa-feedback-loop.png)

**Semantic Value Filtering:**
- LLM evaluates each entity on 5 criteria: Specificity, Actionability, Evidence, Uniqueness, Naming
- Entities scoring below threshold are automatically removed (e.g., generic "ArchitecturalEvolutionPattern")
- Low-value entities flagged for improvement or removal

**Progressive Retry Mechanism:**
1. **Iteration 1**: Standard parameters, initial quality check
2. **Iteration 2**: Stricter requirements, rejects generic patterns
3. **Iteration 3**: Maximum quality threshold, requires concrete evidence

**Coordinator Integration:**
- Failed QA triggers retry with enhanced parameters per iteration
- Feedback provided to agents about what needs improvement
- Maximum 3 iterations before workflow fails (prevents infinite loops)

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
