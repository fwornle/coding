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

| Port | Service | Location |
|------|---------|----------|
| 3030 | Constraint Dashboard UI | Docker |
| 3031 | Constraint Monitor API | Docker |
| 3032 | System Health Dashboard UI | Docker |
| 3033 | System Health API | Docker |
| 3848 | Semantic Analysis SSE | Docker |
| 3849 | Constraint Monitor SSE | Docker |
| 3850 | Code Graph RAG SSE | Docker |
| 8080 | VKB Server (Knowledge visualization) | Docker |
| 6333 | Qdrant HTTP | Docker |
| 6379 | Redis | Docker |
| 7687 | Memgraph (Bolt protocol) | Docker |
| 3100 | Memgraph Lab UI | Docker |
| 12435 | LLM CLI Proxy | Host |
| 12434 | Docker Model Runner | Host |

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
