# Configuration

API keys, port assignments, and MCP server configuration.

## API Keys

Create `.env` file with your provider keys:

```bash
cp .env.example .env
```

```env
# LLM Providers (configure at least ONE)
GROQ_API_KEY=your-groq-key           # Recommended - fastest
ANTHROPIC_API_KEY=sk-ant-...         # High quality
OPENAI_API_KEY=sk-...                # GPT models
GOOGLE_API_KEY=...                   # Gemini

# Auto-configured by installer
CODING_TOOLS_PATH=/Users/<username>/Agentic/coding
CODING_REPO=/Users/<username>/Agentic/coding
```

!!! note "Port Configuration"
    All ports (including DMR, browser automation, etc.) are centralized in `.env.ports`.
    See the Port Configuration section below for details.

## Port Configuration

All ports are centralized in `.env.ports`:

| Port | Service |
|------|---------|
| 8080 | VKB Server (Knowledge visualization) |
| 3030 | Constraint Dashboard UI |
| 3031 | Constraint Monitor API |
| 3032 | System Health Dashboard UI |
| 3033 | System Health API |
| 7687 | Memgraph (Bolt protocol) |
| 3100 | Memgraph Lab UI |
| 12434 | Docker Model Runner |

### Docker Mode Ports

| Port | Service |
|------|---------|
| 3847 | Browser Access SSE |
| 3848 | Semantic Analysis SSE |
| 3849 | Constraint Monitor SSE |
| 3850 | Code Graph RAG SSE |
| 6333 | Qdrant HTTP |
| 6379 | Redis |

## MCP & Hook Configuration

MCP servers and hooks are **configured automatically** by the installer. No manual configuration required.

!!! info "Troubleshooting"
    If you need to inspect or repair configurations:

    - **MCP config**: `~/.claude/claude_desktop_config.json` (macOS/Linux) or `%APPDATA%/Claude/` (Windows)
    - **Hooks config**: `~/.claude/settings.json`
    - **Re-run installer**: `./install.sh` will repair any missing configuration

## Key Directories

| Path | Purpose |
|------|---------|
| `~/Agentic/coding/` | Main repository |
| `~/.coding-tools/` | Installed binaries |
| `~/.claude/` | Claude Code configs |
| `.data/knowledge-graph/` | GraphDB storage |
| `.data/knowledge-export/` | Git-tracked JSON exports |
| `.specstory/history/` | LSL session logs |
