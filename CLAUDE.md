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
  workflow_name: "wave-analysis"
  async_mode: true
  parameters: {team: "coding"}
```

**"ukb full debug", "ukb debug"** → DEBUG mode (mock LLM, single-step):
```
mcp__semantic-analysis__execute_workflow
  workflow_name: "wave-analysis"
  async_mode: true
  debug: true
  parameters: {team: "coding", singleStepMode: true, mockLLM: true, stepIntoSubsteps: true}
```

**Fallback — ONLY if MCP tool is unavailable**, use direct SSE call on port 3848 (see `memory/ukb-workflow.md`).

- NEVER run `ukb` as a bash command
- NEVER use port 3033 for workflows
- NEVER default to debug mode unless user explicitly says "debug"

## Rebuilding After Code Changes

**CRITICAL: This project uses git submodules.** Code changes to submodule TS source do NOT take effect until BOTH steps are done:

1. **`npm run build`** inside the submodule (compiles TS → `dist/`)
2. **Docker rebuild** if the service runs in a container

Forgetting step 1 is a recurring issue — committed source looks correct but `dist/` stays stale and the container runs old code.

**Submodules requiring both steps:**
- `integrations/mcp-server-semantic-analysis`
- `integrations/mcp-constraint-monitor`
- `integrations/code-graph-rag`

**After ANY code change to a submodule:**
```bash
cd integrations/<submodule> && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

**Dashboard UI** (`integrations/system-health-dashboard/`): Bind-mounted, no Docker rebuild needed:
```bash
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard && npm run build
```

**Config files** (`integrations/mcp-server-semantic-analysis/config/`): Bind-mounted read-only, no rebuild needed.

## Knowledge Management

- **Storage**: `.data/knowledge-graph/` (Graphology + LevelDB)
- **Purge entities**: `node scripts/purge-knowledge-entities.js <YYYY-MM-DD> [--dry-run] [--team=coding] [--verbose]`

## Session Logging

- **Location**: `.specstory/history/`
- **Format**: `YYYY-MM-DD_HHMM-HHMM-<hash>.md`
- Use `/sl` command to read session history for continuity

## Code Graph Analysis

`mcp__semantic-analysis__analyze_code_graph` with actions: `nl_query`, `query`, `call_graph`, `similar`. Requires Memgraph running.








## Available Skills (Auto-Generated)

These skills are defined in `.claude/commands/` and provide reusable workflows.
Read the full skill file when a task matches its description.

- **/documentation-style** (`.claude/commands/documentation-style.md`): Enforce consistent styling for documentation artifacts (PlantUML, Mermaid, markdown, PNG diagrams).
- **/playwright-cli** (`.claude/commands/playwright-cli.md`): Use this skill whenever the user wants to automate a browser, scrape web content, take screenshots or PDFs of pages, fill out forms, click through UI flows, or run end-to-end tests — without using an MCP server. This skill drives Playwright directly from the bash_tool via Node.js scripts. Trigger whenever the user says things like "open this URL", "screenshot this page", "scrape this site", "automate this form", "test this UI", "extract data from", "click through", "check if this page works", or any task that requires real browser interaction. Prefer this skill over web_fetch when JavaScript rendering, authentication, interaction, or visual output is needed.
- **/sl** (`.claude/commands/sl.md`): Load session logs (LSL) from current and coding projects for continuity

