# CLI Commands Reference

Complete reference for all command-line tools in the coding toolkit.

## Core Commands

### `coding`

Start Claude Code with all features enabled.

**Usage**:
```bash
coding [options]
```

**Options**:
- `--claude` - Start Claude Code agent
- `--copilot` - Start GitHub CoPilot mode
- `--project <path>` - Specify project path

**Examples**:
```bash
# Start with all features
coding

# Specific agent
coding --claude
coding --copilot

# Specific project
coding --project /path/to/project
```

## Knowledge Management

### `ukb`

Update Knowledge Base - capture development insights.

**Usage**:
```bash
ukb [options]
```

**Options**:
- `-i, --interactive` - Interactive capture mode
- `-a, --auto` - Automatic git analysis
- `-d, --depth <n>` - Analysis depth (default: 25)
- `-s, --significance <n>` - Min significance (default: 6)

**Examples**:
```bash
# Automatic git analysis
ukb

# Interactive mode
ukb --interactive

# Custom depth
ukb --depth 50 --significance 3
```

### `vkb`

Visualize Knowledge Base - interactive graph visualization.

**Usage**:
```bash
vkb [options]
```

**Options**:
- `-p, --port <port>` - Server port (default: 8080)
- `-o, --open` - Open browser automatically
- `-f, --file <path>` - Knowledge base file

**Examples**:
```bash
# Start visualization server
vkb

# Custom port
vkb --port 3000

# Open browser automatically
vkb --open
```

## Session Management

### Enhanced Transcript Monitor

Monitor Claude Code sessions in real-time.

**Usage**:
```bash
# Automatic via coding command
# Manual start:
TRANSCRIPT_DEBUG=true node scripts/enhanced-transcript-monitor.js
```

**Environment Variables**:
- `TRANSCRIPT_DEBUG` - Enable debug mode
- `TRANSCRIPT_SOURCE_PROJECT` - Source project path
- `CODING_REPO` - Coding repository path

## Service Management

### Start Services

```bash
# All services
./bin/coding --services

# Specific services
./bin/start-vkb-server.sh
./bin/start-constraint-monitor.sh
```

### Status Check

```bash
# System status
./scripts/test-coding.sh

# Service health
curl http://localhost:8080/health  # VKB
curl http://localhost:3030/         # Constraint Monitor Dashboard
curl http://localhost:3031/api/status  # Constraint Monitor API
```

## Testing & Validation

### Run Tests

```bash
# All tests
npm test

# Specific test suites
cd integrations/mcp-server-semantic-analysis && npm test
cd integrations/mcp-constraint-monitor && npm test

# Interactive constraint testing
cd integrations/mcp-constraint-monitor
./test-individual-constraints.sh
```

### Constraint Monitor

```bash
# Start dashboard
npm run dashboard  # http://localhost:3030

# Start API
npm run api  # http://localhost:3031

# Test constraints
./test-individual-constraints.sh
```

## Batch Processing

### LSL Batch Processor

Process multiple session logs.

**Usage**:
```bash
PROJECT_PATH=<path> CODING_REPO=<coding-path> node scripts/batch-lsl-processor.js <mode> [args]
```

**Modes**:
- `foreign-only <date>` - Process coding logs for specific date
- `retroactive <start> <end>` - Process date range
- `from-transcripts <dir>` - Process from transcript directory
- `recover <file>` - Recover from specific transcript
- `rebuild-missing <date>` - Rebuild missing LSL files

**Examples**:
```bash
# Process foreign logs
PROJECT_PATH=/path/to/project CODING_REPO=/Users/q284340/Agentic/coding \
  node scripts/batch-lsl-processor.js foreign-only 2025-10-05

# Retroactive processing
PROJECT_PATH=/path/to/project CODING_REPO=/Users/q284340/Agentic/coding \
  node scripts/batch-lsl-processor.js retroactive 2025-10-01 2025-10-05
```

## Semantic Analysis

### Repository Analysis

```bash
# Via MCP (in Claude Code)
execute_workflow {
  "workflow_name": "repository-analysis",
  "parameters": {
    "repository": ".",
    "depth": 25
  }
}

# Via HTTP API (for CoPilot)
curl -X POST http://localhost:8765/api/semantic/analyze-repository \
  -H "Content-Type: application/json" \
  -d '{"repository": ".", "depth": 25}'
```

### Code Analysis

```bash
# Via MCP
analyze_code {
  "code": "...",
  "language": "typescript",
  "analysis_focus": "security"
}

# Via HTTP API
curl -X POST http://localhost:8765/api/semantic/analyze-code \
  -H "Content-Type: application/json" \
  -d '{"code": "...", "language": "typescript"}'
```

## PlantUML Diagram Generation

### Generate Diagrams

```bash
# Single diagram
plantuml docs/puml/my-diagram.puml

# All diagrams
plantuml docs/puml/*.puml

# With output directory
plantuml -o ../images docs/puml/*.puml
```

### Standard Style

All diagrams should include the standard style:

```plantuml
@startuml my-diagram
!include _standard-style.puml

' Your diagram content here

@enduml
```

## Utility Commands

### Status Line

Real-time system health monitoring.

```bash
# Combined status
CODING_REPO=/Users/q284340/Agentic/coding node scripts/combined-status-line.js

# Watch mode
watch -n 1 'CODING_REPO=/Users/q284340/Agentic/coding node scripts/combined-status-line.js'
```

### Git Operations

```bash
# Commit with template
git commit -m "feat: description

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

# Create PR
gh pr create --title "Title" --body "Description"
```

## Environment Variables

### Required

- `ANTHROPIC_API_KEY` - Anthropic API key (required)
- `OPENAI_API_KEY` - OpenAI API key (optional fallback)

### Optional

- `CODING_AGENT` - Preferred agent ("claude" or "copilot")
- `CODING_REPO` - Path to coding repository
- `PROJECT_PATH` - Current project path
- `TRANSCRIPT_DEBUG` - Enable transcript debugging
- `DEBUG` - Enable debug logging (e.g., `semantic-analysis:*`)
- `NODE_OPTIONS` - Node.js options (e.g., `--max-old-space-size=4096`)

## Configuration Files

### MCP Configuration

Location: `~/.config/claude-code/mcp.json`

```json
{
  "mcpServers": {
    "semantic-analysis": {
      "command": "node",
      "args": ["/path/to/coding/integrations/mcp-server-semantic-analysis/build/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

### Shell Configuration

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export ANTHROPIC_API_KEY="your-key"
export PATH="$HOME/Agentic/coding/bin:$PATH"
```

## See Also

- [Getting Started](../getting-started.md) - Installation guide
- [System Overview](../system-overview.md) - Architecture
- [Troubleshooting](../troubleshooting.md) - Problem resolution
- [API Reference](api-keys-setup.md) - API configuration
