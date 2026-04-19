# SemanticAnalysisWorkflowIssue

**Type:** MCPAgent

Uses multi-agent architecture: GitHistoryAgent, VibeHistoryAgent, ObservationGenerationAgent, InsightGenerationAgent, ContentValidationAgent, QualityAssuranceAgent

## What It Is

- shared-memory.json has been REMOVED from the codebase

- JSON exports are at .data/knowledge-export (auto-synced from GraphDB)

- Orchestrated by Coordinator agent which manages agent lifecycle, parallel execution, and result aggregation

- Knowledge storage uses Graphology + LevelDB at .data/knowledge-graph


## How It Works

- SemanticAnalysisWorkflowIssue is implemented across: src/knowledge-management, lib/ukb-unified, integrations/mcp-server-semantic-analysis/src


---

*Generated from 6 observations*
