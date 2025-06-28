# Semantic Analysis System

The Semantic Analysis System is an advanced AI-powered knowledge management enhancement that provides intelligent code analysis, web search, and automated knowledge extraction capabilities through a multi-agent architecture.

## Overview

The system extends the traditional `ukb` (Update Knowledge Base) workflow with AI-powered agents that can:

- **Automatically analyze code repositories** for patterns and insights
- **Extract knowledge from conversations** and documentation
- **Search the web** for relevant technical information
- **Orchestrate complex workflows** across multiple analysis tasks
- **Seamlessly integrate** with existing ukb and vkb tools

## Architecture

![Semantic Analysis Architecture](../images/semantic-analysis-system-overview.png)

The system consists of four specialized agents that communicate through a hybrid protocol:

### Core Agents

1. **Semantic Analysis Agent**
   - Analyzes Git commits and code patterns
   - Extracts insights from conversation logs
   - Supports Claude (primary) and OpenAI (fallback) LLMs
   - Provides significance scoring and pattern detection

2. **Web Search Agent**
   - Performs context-aware web searches
   - Specializes in technical documentation discovery
   - Filters and ranks results by relevance
   - Supports multiple search engines (DuckDuckGo, Bing, Google)

3. **Knowledge Graph Agent**
   - Manages entities and relationships
   - Syncs with existing shared-memory.json
   - Automatically extracts entities from analysis results
   - Provides UKB integration for backward compatibility

4. **Coordinator Agent**
   - Orchestrates multi-agent workflows
   - Schedules recurring analysis tasks
   - Provides failure recovery and retry logic
   - Manages agent discovery and routing

### Communication Infrastructure

The system uses a **hybrid communication architecture**:

- **MQTT**: Event-driven asynchronous communication between agents
- **JSON-RPC**: Synchronous request-response for immediate operations
- **MCP**: Tool exposure for Claude Code integration

## Integration with Claude Code

The semantic analysis system is fully integrated into your Claude Code setup through the MCP (Model Context Protocol) server. When you start `claude-mcp`, the following tools become available:

### Available MCP Tools

| Tool | Description | Use Case |
|------|-------------|----------|
| `analyze_repository` | Analyzes code repositories for patterns | Code review, architecture analysis |
| `analyze_conversation` | Extracts insights from conversations | Knowledge capture from discussions |
| `search_web` | Intelligent technical documentation search | Research, problem-solving |
| `search_technical_docs` | Targeted documentation search | API reference, tutorials |
| `create_knowledge_entity` | Adds entities to knowledge graph | Manual knowledge capture |
| `search_knowledge` | Searches existing knowledge base | Knowledge discovery |
| `start_workflow` | Orchestrates complex analysis tasks | Comprehensive analysis |
| `sync_with_ukb` | Syncs with traditional ukb system | Data migration, backup |
| `get_system_status` | Shows agent and system health | Monitoring, debugging |

### Example Usage in Claude Code

```
analyze_repository {
  "repository": "/path/to/project",
  "depth": 10,
  "significanceThreshold": 7
}
```

```
start_workflow {
  "workflowType": "technology-research",
  "parameters": {
    "technology": "Next.js",
    "aspects": ["documentation", "best-practices", "comparison"]
  }
}
```

## Knowledge Management Workflow Comparison

### Traditional UKB Workflow
```
1. Manual analysis of code/conversations
2. Manual extraction of insights
3. Manual entry via ukb --interactive
4. Manual knowledge organization
```

### Enhanced AI-Powered Workflow
```
1. Automatic analysis via analyze_repository
2. AI extraction of patterns and insights
3. Automatic entity creation in knowledge graph
4. AI-powered search and enrichment
5. Automatic sync with ukb system
```

## Relationship to Existing Tools

### UKB Integration

The semantic analysis system **complements** rather than **replaces** the traditional ukb command:

| Scenario | Recommended Tool | Reason |
|----------|------------------|---------|
| **Automatic Analysis** | AI Tools (MCP) | Faster, more comprehensive |
| **Manual Insight Entry** | `ukb --interactive` | Human-curated knowledge |
| **Bulk Processing** | AI Workflows | Handles large datasets |
| **Quick Manual Entry** | `ukb --interactive` | Direct, familiar interface |
| **Complex Research** | AI + Web Search | Comprehensive analysis |

### Migration Strategy

**You can continue using ukb for manual entries**, but the AI tools provide enhanced capabilities:

1. **Immediate benefit**: Use AI tools for analysis and research
2. **Gradual adoption**: Replace manual analysis with AI workflows
3. **Full integration**: Use AI tools as primary knowledge capture method
4. **Backup compatibility**: ukb remains available for direct entry

## Getting Started

### Prerequisites

- ANTHROPIC_API_KEY configured in your environment
- Optional: OPENAI_API_KEY for fallback LLM support
- Existing ukb/vkb setup (will be automatically enhanced)

### Quick Start

1. **Start Claude with enhanced capabilities**:
   ```bash
   claude-mcp
   ```

2. **Analyze your current project**:
   ```
   analyze_repository {
     "repository": ".",
     "depth": 15,
     "significanceThreshold": 6
   }
   ```

3. **Search for related information**:
   ```
   search_web {
     "query": "architecture patterns for [your technology]",
     "maxResults": 5
   }
   ```

4. **Create knowledge entities**:
   ```
   create_knowledge_entity {
     "name": "Pattern Name",
     "entityType": "ArchitecturalPattern",
     "significance": 8,
     "observations": ["Description of the pattern"]
   }
   ```

### Advanced Workflows

For complex analysis tasks, use the workflow orchestration:

```
start_workflow {
  "workflowType": "repository-analysis",
  "parameters": {
    "repository": "/path/to/large/project",
    "depth": 50,
    "includeSearch": true
  }
}
```

This will:
1. Analyze the repository code
2. Search for related best practices
3. Create knowledge entities automatically
4. Sync with your ukb knowledge base

## Configuration

The system is automatically configured through your existing setup. Advanced configuration can be modified in:

- `semantic-analysis-system/config/agents.yaml` - Agent-specific settings
- `.env` - Environment variables and API keys
- `claude-code-mcp.json` - MCP server configuration

## Monitoring and Troubleshooting

### System Status

Check the health of all agents:
```
get_system_status {}
```

### Command Line Tools

- `semantic-cli status` - Check system health
- `semantic-cli --help` - View available commands
- `ukb --help` - Traditional ukb commands still available

### Logs

System logs are available in the console when running `claude-mcp`. For debugging:

```bash
export LOG_LEVEL=debug
claude-mcp
```

## Migration from Traditional UKB

### No Migration Required

The semantic analysis system is designed to work alongside your existing ukb setup:

- **Existing knowledge**: Automatically loaded and accessible
- **UKB commands**: Continue to work as before
- **VKB visualization**: Enhanced with AI-generated entities
- **Data format**: Backward compatible with shared-memory.json

### Enhanced Capabilities

While ukb continues to work, the AI system provides:

- **10x faster analysis** for code repositories
- **Automatic pattern detection** without manual review
- **Web research integration** for comprehensive insights
- **Workflow orchestration** for complex analysis tasks
- **Multi-agent coordination** for parallel processing

### Recommended Workflow

1. **For new analysis**: Use AI tools (`analyze_repository`, `start_workflow`)
2. **For manual insights**: Continue using `ukb --interactive`
3. **For visualization**: Use enhanced `vkb` with AI-generated entities
4. **For research**: Use `search_web` and `search_technical_docs`

## Next Steps

1. **Explore the tools**: Try each MCP tool with your current project
2. **Set up workflows**: Use `start_workflow` for comprehensive analysis
3. **Customize configuration**: Adjust agent settings for your needs
4. **Monitor and optimize**: Use status tools to ensure optimal performance

## Related Documentation

### Semantic Analysis System
- [Architecture Details](./architecture.md) - Comprehensive technical architecture
- [API Reference](./api-reference.md) - Complete API documentation
- [Workflow Guide](./workflows.md) - Workflow configuration and usage
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions

### Traditional Tools
- [UKB Documentation](../ukb/README.md) - Traditional knowledge base management
- [VKB Documentation](../vkb/README.md) - Knowledge visualization tools

### System Integration
- [Installation Guide](../installation/quick-start.md) - System setup and installation
- [MCP Configuration](../installation/mcp-configuration.md) - Claude Code integration setup