# Semantic Analysis

14-agent AI-powered code analysis via MCP.

![Semantic Analysis Overview](../images/semantic-analysis-system-overview.png)

## Overview

| Property | Value |
|----------|-------|
| Component | `mcp-server-semantic-analysis` |
| Type | MCP Server (Node.js) |
| Port (Docker) | 3848 |
| Startup Time | ~2s |
| Memory | ~200MB |

## 14 Intelligent Agents

### Orchestration (1)

| Agent | Function |
|-------|----------|
| CoordinatorAgent | Orchestrates all agents via workflow definitions |

### LLM-Powered (10)

| Agent | Function |
|-------|----------|
| SemanticAnalysisAgent | Deep code analysis using 3-tier LLM chain |
| InsightGenerationAgent | Generates insights with PlantUML diagrams |
| QualityAssuranceAgent | LLM-powered validation with feedback loops |
| VibeHistoryAgent | Processes conversation files for context |
| ObservationGenerationAgent | Creates UKB-compatible observations |
| ContentValidationAgent | Staleness detection and entity refresh |
| GitHistoryAgent | Commit pattern analysis and theme extraction |
| WebSearchAgent | External research via DuckDuckGo |
| OntologyClassificationAgent | Semantic ontology classification |
| DocumentationLinkerAgent | Links docs to code with semantic matching |

### Embedding/External (2)

| Agent | Function |
|-------|----------|
| DeduplicationAgent | Duplicate detection using embeddings |
| CodeGraphAgent | AST indexing via Memgraph |

### Non-LLM (1)

| Agent | Function |
|-------|----------|
| PersistenceAgent | Saves to Graphology + LevelDB |

## MCP Tools

| Tool | Description |
|------|-------------|
| `heartbeat` | Connection health monitoring |
| `test_connection` | Server connectivity verification |
| `determine_insights` | AI-powered content analysis |
| `analyze_code` | Code pattern and quality analysis |
| `analyze_repository` | Repository-wide architecture analysis |
| `extract_patterns` | Design pattern identification |
| `create_ukb_entity_with_insight` | Knowledge base entity creation |
| `execute_workflow` | Coordinated multi-agent workflows |
| `generate_documentation` | Automated documentation generation |
| `create_insight_report` | Detailed analysis reports |
| `generate_plantuml_diagrams` | Architecture diagram generation |
| `reset_analysis_checkpoint` | Reset analysis checkpoints |
| `refresh_entity` | Refresh specific knowledge entity |
| `analyze_code_graph` | AST-based code analysis |

## Workflows

### Complete Analysis

```
execute_workflow { "workflow_name": "complete-analysis" }
```

Steps:

1. GitHistory.analyze()
2. VibeHistory.analyze()
3. Semantic.analyze()
4. WebSearch.research()
5. Insights.generate()
6. Observations.generate()
7. Ontology.classify()
8. CodeGraph.index()
9. DocLinker.analyze()
10. QA.validate()
11. Persistence.save()
12. Deduplication.merge()
13. ContentValidation.refresh()

### Incremental Analysis

```
execute_workflow { "workflow_name": "incremental-analysis" }
```

Faster analysis focusing on recent changes.

## Quality Assurance

The QA agent implements feedback loops:

1. **Iteration 1**: Standard parameters, initial quality check
2. **Iteration 2**: Stricter requirements, rejects generic patterns
3. **Iteration 3**: Maximum threshold, requires concrete evidence

**Entity Evaluation Criteria**:

- Specificity
- Actionability
- Evidence
- Uniqueness
- Naming

## Configuration

**Native Mode**:

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["/path/to/mcp-server-semantic-analysis/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key",
        "OPENAI_API_KEY": "optional-fallback"
      }
    }
  }
}
```

**Docker Mode**:

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["/path/to/mcp-server-semantic-analysis/dist/stdio-proxy.js"],
      "env": {
        "SEMANTIC_ANALYSIS_SSE_URL": "http://localhost:3848"
      }
    }
  }
}
```

## Usage Examples

```
# Analyze repository
determine_insights {
  "repository": ".",
  "conversationContext": "Current refactoring work",
  "depth": 10
}

# Execute complete analysis
execute_workflow {
  "workflow_name": "complete-analysis"
}

# Extract patterns
extract_patterns {
  "source": "authentication module",
  "pattern_types": ["design", "security"]
}
```

## Storage

- Entities: `.data/knowledge-graph/` (Graphology + LevelDB)
- Auto-export: `shared-memory-coding.json` every 30 seconds
- Insights: `knowledge-management/insights/`

## Health Check

```bash
# Docker mode
curl http://localhost:3848/health

# View logs
docker compose -f docker/docker-compose.yml logs -f coding-services | grep semantic
```
