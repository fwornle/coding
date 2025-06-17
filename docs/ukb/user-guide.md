# UKB (Update Knowledge Base) - User Guide

## Overview

UKB (Update Knowledge Base) is an intelligent knowledge management system that captures, analyzes, and structures insights from development activities. It transforms raw development data (git commits, conversations, code changes) into transferable patterns and actionable knowledge.

## Table of Contents

1. [Key Features](#key-features)
2. [Quick Start](#quick-start)
3. [Usage Modes](#usage-modes)
4. [Analysis Types](#analysis-types)
5. [Schema Management](#schema-management)
6. [Workflow Examples](#workflow-examples)
7. [Advanced Features](#advanced-features)

## Key Features

### 🔍 **Comprehensive Analysis Modes**
- **Incremental Processing**: Only analyzes new changes since last run
- **Full History Analysis**: Comprehensively analyzes entire git history
- **Interactive Mode**: Deep insight capture with guided prompts
- **Agent Mode**: AI-assisted semantic analysis within coding sessions

### 📊 **Multi-Source Intelligence**
- **Git History**: Commit analysis with categorization and significance scoring
- **Conversation Logs**: .specstory file analysis for problem-solution patterns
- **Code Changes**: Architectural pattern detection in recent modifications
- **Cross-Session Learning**: Knowledge accumulation across AI interactions

### 🎯 **Agent Integration**
- **Works with any coding agent** (Claude, CoPilot, etc.)
- **Semantic conversation analysis** from .specstory history files
- **Code pattern extraction** from recent file changes
- **Automated reference enrichment** with documentation links

## Quick Start

### Basic Usage
```bash
# Auto-analysis mode (incremental)
ukb

# Interactive deep insight capture
ukb --interactive

# Full history analysis
ukb --full-analysis

# Agent-powered semantic analysis
ukb --agent
```

### Interactive Mode Example
```bash
ukb --interactive
# Prompts for:
# - Problem description
# - Solution approach
# - Rationale for the solution
# - Key learnings
# - Applicability context
# - Technologies used
# - Reference URLs
# - Related files
```

## Usage Modes

### 1. Auto Mode (Default)
```bash
ukb
```
- Analyzes git commits since last run
- Extracts transferable patterns automatically
- Conservative filtering to avoid noise
- Updates knowledge base incrementally

### 2. Interactive Mode
```bash
ukb --interactive
```
- Guided prompts for deep insight capture
- Manual pattern entry with structured format
- Best for capturing complex learnings
- Includes significance scoring

### 3. Agent Mode
```bash
ukb --agent
```
- Semantic analysis of conversation logs
- Code pattern extraction from changes
- Reference enrichment with documentation
- Works within coding agent sessions

### 4. Full Analysis Mode
```bash
ukb --full-analysis
```
- Comprehensive analysis of entire git history
- Rebuilds knowledge base from scratch
- Use for initial setup or major reviews
- Can be time-intensive for large repositories

## Analysis Types

### Git Commit Analysis
- **Commit categorization**: Feature, fix, refactor, docs, etc.
- **Significance scoring**: Based on file changes and commit message
- **Pattern extraction**: Identifies recurring solutions
- **Technology detection**: Recognizes frameworks and tools used

### Conversation Analysis
- **Problem-solution extraction**: From .specstory history files
- **Code pattern identification**: From AI coding conversations
- **Cross-session learning**: Connects insights across sessions
- **Reference enhancement**: Adds authoritative documentation links

### Code Change Analysis
- **Architectural patterns**: Detects design patterns in code
- **Best practices**: Identifies good coding practices
- **Anti-patterns**: Flags problematic code patterns
- **Technology usage**: Tracks framework and library usage

## Schema Management

### Knowledge Base Structure
```json
{
  "entities": [
    {
      "name": "PatternName",
      "entityType": "Pattern|Solution|Architecture|Tool",
      "significance": 1-10,
      "problem": {
        "description": "What problem this solves",
        "context": "When this problem occurs"
      },
      "solution": {
        "approach": "How to solve it",
        "implementation": "Specific implementation details",
        "code_example": "Working code snippet"
      },
      "observations": ["Key insights", "Lessons learned"],
      "metadata": {
        "technologies": ["React", "Node.js"],
        "files": ["src/component.js"],
        "references": ["https://docs.example.com"]
      }
    }
  ],
  "relations": [
    {
      "from": "PatternA",
      "to": "PatternB", 
      "relationType": "depends_on|similar_to|implements"
    }
  ]
}
```

### Entity Types
- **Pattern**: Reusable solutions and approaches
- **Solution**: Specific problem fixes
- **Architecture**: System design insights
- **Tool**: Technology and framework usage
- **Workflow**: Process and methodology insights

## Workflow Examples

### Daily Development Workflow
```bash
# Morning: Check what's been learned
vkb  # View knowledge base

# Throughout day: Normal development
git add . && git commit -m "implement user authentication"

# End of day: Capture insights
ukb  # Auto-analysis of day's commits

# Weekly: Review and enhance
ukb --interactive  # Deep insight capture
```

### Team Knowledge Sharing
```bash
# Team lead captures architecture decisions
ukb --interactive
# Problem: Service communication complexity
# Solution: Event-driven architecture with message queues

# Team members learn from insights
vkb  # Browse shared knowledge
ukb search "event driven"  # Find relevant patterns

# Knowledge base syncs via git
git pull  # Get team insights
git push  # Share your insights
```

### AI Coding Session Enhancement
```bash
# Start coding session
claude-mcp  # or your preferred AI

# During session, capture insights
ukb --agent  # Analyzes conversation and code

# Review insights immediately
vkb  # See what was learned
```

## Advanced Features

### Filtering and Search
```bash
# Search for specific patterns
ukb search "authentication"
ukb search "React patterns"

# Filter by significance
ukb --min-significance 7

# Filter by technology
ukb --tech React,Node.js
```

### Backup and Migration
```bash
# Create backup
ukb --backup

# Migrate to new schema version
ukb --migrate

# Verify data integrity
ukb --verify
```

### Integration with Tools
```bash
# Export for documentation
ukb --export-markdown > team-knowledge.md

# Generate architecture diagrams
ukb --export-puml > architecture.puml

# API access for custom tools
ukb --export-json | jq '.entities[] | select(.significance > 8)'
```

### Configuration
```bash
# Set default significance threshold
export UKB_MIN_SIGNIFICANCE=6

# Configure analysis depth
export UKB_ANALYSIS_DEPTH=full

# Set custom templates
export UKB_TEMPLATE_PATH=/path/to/templates
```

## Common Use Cases

### Architecture Documentation
- Capture design decisions with reasoning
- Document pattern evolution over time
- Share architectural insights across teams
- Create searchable knowledge base

### Code Review Enhancement
- Reference established patterns during reviews
- Suggest improvements based on past learnings
- Identify when to deviate from patterns
- Build consistency across team

### Onboarding New Team Members
- Provide searchable history of decisions
- Show evolution of system architecture
- Demonstrate proven solutions
- Accelerate learning curve

### Cross-Project Learning
- Transfer patterns between projects
- Avoid repeating past mistakes
- Build organizational knowledge
- Standardize approaches

## Troubleshooting

### Common Issues
```bash
# UKB not finding git repository
cd /path/to/git/repo && ukb

# Knowledge base corruption
ukb --verify && ukb --repair

# Missing dependencies
./install.sh --update

# Performance issues with large repos
ukb --incremental  # Use incremental mode
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=1 ukb --verbose

# Check analysis results
cat ~/.ukb/debug.log
```

## Next Steps

- **[Use Cases](ukb-use-cases.md)** - Detailed workflow examples
- **[VSCode Integration](../integrations/vscode-extension.md)** - IDE integration
- **[System Architecture](../architecture/system-overview.md)** - Technical details