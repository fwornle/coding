# Claude Knowledge Management Scripts

This directory contains scripts for managing coding knowledge and insights, designed to work with Claude Code and the MCP (Model Context Protocol) memory system.

## Scripts Overview

### 1. **vkb** - Visual Knowledge Base Viewer
Quick launcher for the knowledge graph visualization.
- Usage: `vkb` (aliased in .zshrc)
- Opens browser with interactive knowledge graph
- Automatically loads latest memory.json

### 2. **capture-coding-insight.sh** - Main Knowledge Capture Tool
Captures coding insights and solutions in a structured format.
- Usage: `capture-coding-insight.sh`
- Interactive prompts for problem/solution/tags
- Stores insights in local knowledge base

### 3. **capture-insight-mcp.sh** - MCP Integration Wrapper
Wrapper for capturing insights that integrates with MCP memory graph.
- Usage: Called by Claude Code for MCP integration
- Creates entities in the knowledge graph

### 4. **install-git-hooks.sh** - Git Hook Installer
Installs post-commit hooks to automatically capture insights from commits.
- Usage: `install-git-hooks.sh [repo-path]`
- Extracts insights from conventional commit messages
- Integrates with capture-coding-insight.sh

### 5. **query-coding-knowledge.sh** - Knowledge Search Tool
Search and query the local coding knowledge base.
- Usage: `query-coding-knowledge.sh [search-term]`
- Supports keyword search and filtering
- Displays results in formatted output

### 6. **summarize-coding-session.sh** - Session Summary Generator
Generates summaries of coding sessions based on recent insights.
- Usage: `summarize-coding-session.sh`
- Analyzes recent entries
- Creates markdown summaries

### 7. **view-knowledge-base.sh** - Knowledge Base Viewer
Text-based viewer for the knowledge base.
- Usage: `view-knowledge-base.sh`
- Shows recent insights
- Provides filtering options

### 8. **test-mcp-availability.sh** - MCP Testing Tool
Tests if MCP tools are available in the current environment.
- Usage: `test-mcp-availability.sh`
- Checks for MCP memory tools
- Verifies Claude Code integration

### 9. **vkb-alias.sh** - VKB Alias Setup
Helper script for setting up the vkb alias.
- Usually not called directly
- Used during initial setup

## Installation

All scripts are already set up. The `vkb` command is aliased in `~/.zshrc`:
```bash
alias vkb="~/Claude/vkb"
```

## Knowledge Base Locations

- **Local Knowledge Base**: `~/coding-knowledge-base/`
- **MCP Memory Graph**: `~/.npm/_npx/*/node_modules/@modelcontextprotocol/server-memory/dist/memory.json`
- **Visualizer**: `~/Agentic/memory-visualizer/`

## Usage Examples

### Capture a new insight:
```bash
~/Claude/capture-coding-insight.sh
```

### View knowledge graph:
```bash
vkb
```

### Search for React performance tips:
```bash
~/Claude/query-coding-knowledge.sh "react performance"
```

### Install git hooks in a project:
```bash
~/Claude/install-git-hooks.sh ~/my-project
```

## Notes

- The scripts are designed to work together as a comprehensive knowledge management system
- MCP integration requires Claude Code to be running with MCP tools available
- The visual knowledge base (vkb) provides an interactive graph view of all captured knowledge