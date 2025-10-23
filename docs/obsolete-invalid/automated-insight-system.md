# Automated Insight Extraction System

## Overview

The automated insight extraction system has been **simplified** as of 2025-09-28. The complex InsightOrchestrator was deprecated in favor of a more reliable, lightweight approach that integrates with the existing session logging infrastructure.

## System Architecture

### Core Components

1. **~~Insight Orchestrator~~ (DEPRECATED 2025-09-24)**
   - ❌ The 900+ line complex analysis pipeline was archived
   - ✅ Replaced with simplified session logging in auto-insight-trigger.js

2. **MCP Semantic Analysis** (`scripts/mcp-semantic-analysis.js`)
   - Provides semantic analysis capabilities
   - Conversation content analysis
   - Repository change analysis
   - Technology pattern extraction

3. **Auto Insight Trigger** (`scripts/auto-insight-trigger.js`) - **SIMPLIFIED**
   - ✅ Graceful fallback for session completion
   - ✅ Maintains API compatibility with post-session logger
   - ✅ Simplified logging instead of complex analysis
   - ❌ Complex multi-source analysis removed

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

## Features Status

### ❌ Multi-Source Analysis Pipeline (DEPRECATED)
- **Session logs analysis**: ~~Removed~~ → Basic session logging only
- **Codebase analysis**: ~~Removed~~ → Git integration not active  
- **Web search integration**: ~~Removed~~ → No external research
- **Pattern extraction**: ~~Removed~~ → Manual knowledge management only

### ✅ Knowledge Base Integration
- **UKB integration**: Proper 9-point synopsis creation via UKB CLI
- **Detailed insight files**: Comprehensive markdown with TOC and embedded content
- **MCP memory sync**: Automatic sync to shared-memory-*.json files
- **Cross-team compatibility**: Works with coding, ui, resi teams

### ⚠️ Automated Diagram Generation (LIMITED)
- **PlantUML diagrams**: Manual generation via separate tools
- **Mermaid diagrams**: Manual generation via separate tools
- **PNG generation**: Available but not automated
- **Source preservation**: Manual workflow required

### ✅ Cross-Platform Compatibility
- **Claude Code integration**: Native MCP tool support
- **GitHub Copilot support**: VS Code extension bridge ready
- **Manual triggering**: CLI interface for on-demand analysis
- **Scheduled analysis**: Cron/systemd integration support

### ⚠️ Intelligent Triggering (SIMPLIFIED)
- **Significance detection**: ~~Removed~~ → All sessions logged equally
- **Cooldown management**: ✅ Still active (default: 30 min)
- **Session correlation**: ❌ No longer links with git commits
- **State tracking**: ✅ Basic state tracking maintained

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

The system is **simplified and stable** as of 2025-09-28. Core functionality maintained with reduced complexity:

- ✅ Session monitoring and basic logging
- ❌ Multi-source data integration (deprecated)
- ⚠️ Knowledge base updates via UKB (manual)
- ❌ Automated insight file generation (deprecated)
- ❌ Automated diagram creation (deprecated)
- ✅ Cross-platform compatibility
- ✅ Post-session integration (graceful fallback)

## Next Steps

1. **Current status**: Simplified system prevents session shutdown errors
2. **Manual workflows**: Use UKB and VKB commands for knowledge management
3. **Consider restoration**: Re-implement specific features if needed
4. **Alternative approaches**: Explore lighter-weight automation options

## Testing

Test basic functionality:

```bash
# Test auto-insight-trigger works without errors
node scripts/auto-insight-trigger.js status
```

---

**ℹ️ The automated insight extraction system has been simplified to ensure reliability and prevent session shutdown errors.**