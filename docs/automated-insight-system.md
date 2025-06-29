# Automated Insight Extraction System

## Overview

The automated insight extraction system is now **fully implemented** and provides comprehensive analysis of coding sessions, repository changes, and technology research to automatically generate knowledge base entries with detailed insights and diagrams.

## System Architecture

### Core Components

1. **Insight Orchestrator** (`scripts/insight-orchestrator.js`)
   - Monitors session completion and triggers analysis
   - Coordinates multi-source analysis pipeline
   - Creates knowledge base entries with detailed insight files

2. **MCP Semantic Analysis** (`scripts/mcp-semantic-analysis.js`)
   - Provides semantic analysis capabilities
   - Conversation content analysis
   - Repository change analysis
   - Technology pattern extraction

3. **Auto Insight Trigger** (`scripts/auto-insight-trigger.js`)
   - Automatic session detection and triggering
   - Cooldown management and state tracking
   - Integration with post-session logger

4. **Diagram Generator** (`scripts/diagram-generator.js`)
   - Automated PlantUML and Mermaid diagram generation
   - Architecture, workflow, pattern, and integration diagrams
   - PNG rendering with source code preservation

5. **Cross-Platform Bridge** (`scripts/cross-platform-bridge.js`)
   - Unified API for Claude Code and GitHub Copilot
   - MCP tool integration
   - Multiple trigger mechanisms

6. **Post-Session Logger Integration**
   - Automatic triggering after session completion
   - Smart content routing (coding vs project-specific)

## Features Implemented

### ✅ Multi-Source Analysis Pipeline
- **Session logs analysis**: Current and past sessions up to analyzed logs
- **Codebase analysis**: Git commit history and associated code changes  
- **Web search integration**: Key technology research (configurable)
- **Pattern extraction**: Architectural patterns, anti-patterns, best practices

### ✅ Knowledge Base Integration
- **UKB integration**: Proper 9-point synopsis creation via UKB CLI
- **Detailed insight files**: Comprehensive markdown with TOC and embedded content
- **MCP memory sync**: Automatic sync to shared-memory-*.json files
- **Cross-team compatibility**: Works with coding, ui, resi teams

### ✅ Automated Diagram Generation
- **PlantUML diagrams**: Architecture, workflow, pattern diagrams
- **Mermaid diagrams**: Alternative rendering with modern syntax
- **PNG generation**: Automatic image rendering when tools available
- **Source preservation**: Both source and rendered images stored

### ✅ Cross-Platform Compatibility
- **Claude Code integration**: Native MCP tool support
- **GitHub Copilot support**: VS Code extension bridge ready
- **Manual triggering**: CLI interface for on-demand analysis
- **Scheduled analysis**: Cron/systemd integration support

### ✅ Intelligent Triggering
- **Significance detection**: Configurable threshold (default: 7/10)
- **Cooldown management**: Prevents excessive analysis (default: 30 min)
- **Session correlation**: Links conversations with git commits
- **State tracking**: Remembers analyzed sessions and commits

## Usage Examples

### Automatic Operation
```bash
# System works automatically via post-session logger
# When you finish a Claude Code session, insights are extracted automatically
```

### Manual Triggering  
```bash
# Check for new sessions and trigger if needed
node scripts/auto-insight-trigger.js check

# Force analysis regardless of cooldown
node scripts/auto-insight-trigger.js force

# Check system status
node scripts/auto-insight-trigger.js status
```

### Cross-Platform Bridge
```bash
# Test all integration points
node scripts/cross-platform-bridge.js test

# Extract insights from content
node scripts/cross-platform-bridge.js extract "session content here"

# Check bridge status
node scripts/cross-platform-bridge.js status
```

## Configuration

### Environment Variables
```bash
# Enable/disable automatic insights
AUTO_INSIGHT_ENABLED=true

# Set significance threshold (1-10)
INSIGHT_SIGNIFICANCE_THRESHOLD=7

# Cooldown period in minutes
INSIGHT_COOLDOWN_MINUTES=30

# Enable web search
WEB_SEARCH_ENABLED=true

# Enable debug logging
DEBUG=true
```

### Integration with CLAUDE.md
The system is designed to work with the existing `claude-mcp` workflow:

1. Start Claude Code with `claude-mcp` (enables MCP features)
2. Work on coding tasks normally
3. When session ends, post-session-logger.js runs automatically
4. If significant activity detected, insight extraction triggers
5. New knowledge entries appear in knowledge base and VKB visualizer

## Generated Outputs

### Knowledge Base Entries
- **UKB entities**: Properly formatted 9-point synopsis
- **Relations**: Connections to existing knowledge
- **Metadata**: Timestamps, significance scores, source tracking

### Detailed Insight Files
- **Location**: `knowledge-management/insights/[PatternName].md`
- **Content**: Problem, solution, implementation, benefits, applicability
- **Code examples**: Extracted from session analysis
- **Diagrams**: Embedded PlantUML/Mermaid diagrams
- **References**: Git commits, web research, related files

### Diagram Files
- **PlantUML source**: `knowledge-management/insights/puml/[name].puml`
- **Mermaid source**: `knowledge-management/insights/puml/[name].mmd`
- **Rendered images**: `knowledge-management/insights/images/[name].png`

## Status Check

The system is **fully operational** and ready for use. All core components are implemented and tested:

- ✅ Session monitoring and analysis
- ✅ Multi-source data integration  
- ✅ Knowledge base updates via UKB
- ✅ Detailed insight file generation
- ✅ Automated diagram creation
- ✅ Cross-platform compatibility
- ✅ Post-session integration

## Next Steps

1. **Enable in production**: The system is ready for daily use
2. **Monitor performance**: Check logs and adjust thresholds as needed  
3. **Customize patterns**: Add domain-specific analysis patterns
4. **Extend integrations**: Add more MCP tools or external APIs

## Testing

Run the comprehensive test suite:
```bash
node scripts/test-insight-workflow.js
```

The test verifies all components work together correctly and generates a detailed report.

---

**🎉 The automated insight extraction system is now complete and ready to revolutionize your development workflow!**