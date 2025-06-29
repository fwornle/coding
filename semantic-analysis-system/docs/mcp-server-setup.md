# Semantic Analysis MCP Server Setup Guide

## Quick Start

### 1. Configure API Keys

You need **at least one** API key configured. Edit `.env`:

```bash
# Option A: Use only Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
DEFAULT_LLM_PROVIDER=claude

# Option B: Use only OpenAI
OPENAI_API_KEY=sk-your-actual-key-here  
DEFAULT_LLM_PROVIDER=openai

# Option C: Use both (recommended for fallback)
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
OPENAI_API_KEY=sk-your-actual-key-here
DEFAULT_LLM_PROVIDER=claude
```

### 2. Start the System

The `coding` command now **automatically starts** the agent system if API keys are configured:

```bash
# Just run this - agents start automatically!
coding --claude
# or
claude-mcp
```

### 3. Check Status

Use the new `mcp-status` command to check configuration:

```bash
mcp-status
```

This shows:
- ✓/✗ API key configuration
- ✓/✗ Agent system status  
- ✓/✗ MCP server configuration
- Quick start instructions

## Manual Control

If you prefer manual control:

```bash
# Start agents manually
cd semantic-analysis-system
npm run start:agents

# Stop agents
../scripts/stop-semantic-agents.sh
```

## Troubleshooting

### "MCP Server Failed" Error

The MCP server now provides detailed error messages:

1. **"Agent system not running"**
   - The semantic agents must be started first
   - Check API keys are configured
   - Run `mcp-status` for details

2. **"No valid API keys found"**
   - Configure at least one API key in `.env`
   - Either ANTHROPIC_API_KEY or OPENAI_API_KEY

### Using Only One API Provider

To use only Anthropic (no OpenAI key needed):

1. Set in `.env`:

   ```bash
   ANTHROPIC_API_KEY=your-key
   DEFAULT_LLM_PROVIDER=claude
   ```

2. Edit `config/agents.yaml`:

   ```yaml
   llm:
     primaryProvider: claude
     fallbackProvider: null  # Remove fallback
   ```

## Architecture

```text
coding --claude
    ↓
launch-claude.sh
    ↓
Auto-starts semantic agents (if API keys configured)
    ↓
Starts Claude with MCP
    ↓
MCP server connects to agents
```

The system is designed to be zero-configuration after initial API key setup.
