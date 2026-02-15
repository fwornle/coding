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

When user says "ukb", "full ukb", or "ukb full debug" -- start a workflow via the semantic-analysis server:

**Method 1**: `mcp__semantic-analysis__execute_workflow` MCP tool (when available)
**Method 2**: Direct SSE call to port 3848 (see `memory/ukb-workflow.md` for script)

**"ukb full debug" flags**: `debug: true`, `singleStepMode: true`, `mockLLM: true`, `stepIntoSubsteps: true`

- NEVER run `ukb` as a bash command -- it doesn't exist as CLI
- NEVER use curl to port 3033 for workflows (that's health API)
- ALWAYS use `mockLLM: true` in debug mode

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
