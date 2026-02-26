# CLAUDE.md - Coding Project Guidelines

## Mandatory Rules

- **Documentation skill**: ALWAYS invoke `documentation-style` skill before creating/modifying PlantUML, Mermaid, or documentation artifacts
- **PlantUML**: Use `plantuml` CLI command. NEVER `java -jar plantuml.jar`
- **TypeScript**: Mandatory with strict type checking
- **Serena MCP**: ONLY for reading/searching code. Use Edit/Write for file operations
- **API design**: Never modify working APIs for TypeScript compliance; fix types instead

## Startup & Services

- **Command**: `claude-mcp` or `coding --claude` (starts all services). Never use bare `claude`
- **Dashboard**: http://localhost:3032 | **Health API**: http://localhost:3033
- **Semantic Analysis SSE**: http://localhost:3848 (workflow execution)
- **VKB**: `vkb` command opens http://localhost:8080

## UKB Workflow Control

**CRITICAL: Match parameters to what user actually says!**

**"ukb", "full ukb", "ukb full"** → PRODUCTION mode (real LLM calls, runs continuously):
```
mcp__semantic-analysis__execute_workflow
  workflow_name: "batch-analysis"
  async_mode: true
  parameters: {team: "coding"}
```

**"ukb full debug", "ukb debug"** → DEBUG mode (mock LLM, single-step):
```
mcp__semantic-analysis__execute_workflow
  workflow_name: "batch-analysis"
  async_mode: true
  debug: true
  parameters: {team: "coding", singleStepMode: true, mockLLM: true, stepIntoSubsteps: true}
```

**Fallback — ONLY if MCP tool is unavailable**, use direct SSE call on port 3848 (see `memory/ukb-workflow.md`).

- NEVER run `ukb` as a bash command
- NEVER use port 3033 for workflows
- NEVER default to debug mode unless user explicitly says "debug"

## Rebuilding After Code Changes

**Dashboard UI** (`integrations/system-health-dashboard/`): Bind-mounted, no Docker rebuild needed:
```bash
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard && npm run build
```

**Backend services** (require Docker rebuild): `mcp-server-semantic-analysis`, `mcp-constraint-monitor`, `browser-access`, `vkb-server`
```bash
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

## Knowledge Management

- **Storage**: `.data/knowledge-graph/` (Graphology + LevelDB)
- **Purge entities**: `node scripts/purge-knowledge-entities.js <YYYY-MM-DD> [--dry-run] [--team=coding] [--verbose]`

## Session Logging

- **Location**: `.specstory/history/`
- **Format**: `YYYY-MM-DD_HHMM-HHMM-<hash>.md`
- Use `/sl` command to read session history for continuity

## Code Graph Analysis

`mcp__semantic-analysis__analyze_code_graph` with actions: `nl_query`, `query`, `call_graph`, `similar`. Requires Memgraph running.
