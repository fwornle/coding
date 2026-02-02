# Reference

Quick reference for commands, APIs, and troubleshooting.

## Quick Links

| Section | Description |
|---------|-------------|
| [Commands](commands.md) | CLI commands and shell usage |
| [API](api.md) | MCP tools and REST endpoints |
| [Troubleshooting](troubleshooting.md) | Common issues and solutions |

## Essential Commands

```bash
# Launch Claude Code with all integrations
coding --claude

# View knowledge graph
vkb

# Test installation
./scripts/test-coding.sh
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CODING_TOOLS_PATH` | Path to coding repository |
| `CODING_REPO` | Same as above (alias) |
| `CODING_DOCKER_MODE` | Enable Docker mode (`true`) |
| `LSL_ENABLED` | Enable Live Session Logging |
| `TRANSCRIPT_SOURCE_PROJECT` | Current project path |

## Port Reference

| Port | Service |
|------|---------|
| 8080 | VKB Server |
| 3030 | Constraint Dashboard |
| 3031 | Constraint API |
| 3032 | Health Dashboard |
| 3033 | Health API |
| 3847 | Browser Access SSE |
| 3848 | Semantic Analysis SSE |
| 3849 | Constraint Monitor SSE |
| 3850 | Code Graph RAG SSE |
| 6333 | Qdrant |
| 6379 | Redis |
| 7687 | Memgraph |
| 3100 | Memgraph Lab |

## Key Directories

| Path | Purpose |
|------|---------|
| `.specstory/history/` | LSL session logs |
| `.data/knowledge-graph/` | GraphDB storage |
| `.data/knowledge-export/` | Git-tracked JSON exports |
| `.health/` | Health status files |
| `.cache/` | SQLite databases, embeddings |

## Configuration Files

| File | Purpose |
|------|---------|
| `.env` | API keys and secrets |
| `.env.ports` | Port assignments |
| `config/live-logging-config.json` | LSL configuration |
| `constraints.yaml` | Constraint definitions |
| `~/.claude/settings.json` | Hook configuration |
