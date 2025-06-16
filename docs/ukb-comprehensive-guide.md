# UKB (Update Knowledge Base) - Comprehensive Guide

## Overview

UKB (Update Knowledge Base) is an intelligent knowledge management system that captures, analyzes, and structures insights from development activities. It transforms raw development data (git commits, conversations, code changes) into transferable patterns and actionable knowledge.

## Table of Contents

1. [Key Features](#key-features)
2. [Installation & Setup](#installation--setup)
3. [Core Concepts](#core-concepts)
4. [Usage Modes](#usage-modes)
5. [Full History Analysis](#full-history-analysis)
6. [Incremental Processing](#incremental-processing)
7. [Schema Management](#schema-management)
8. [Workflow Examples](#workflow-examples)
9. [Advanced Features](#advanced-features)
10. [Architecture](#architecture)

## Key Features

### 🔍 **Comprehensive Analysis Modes**
- **Incremental Processing**: Only analyzes new changes since last run
- **Full History Analysis**: Comprehensively analyzes entire git history
- **Interactive Mode**: Deep insight capture with guided prompts
- **Agent Mode**: AI-assisted semantic analysis

### 📊 **Multi-Source Intelligence**
- **Git History**: Commit analysis with categorization and significance scoring
- **Conversation Logs**: .specstory file analysis for problem-solution patterns
- **Code Changes**: Diff analysis for architectural patterns
- **Manual Insights**: Interactive deep knowledge capture

### 🔄 **Smart Processing**
- **Incremental State Tracking**: Prevents reprocessing of analyzed data
- **Schema Versioning**: Automatic migration of knowledge base formats
- **Significance Scoring**: Ranks insights by importance (1-10 scale)
- **Domain Context Extraction**: Identifies specific technologies and frameworks

### 🌐 **Team Collaboration**
- **Cross-Project Knowledge Sharing**: Transferable patterns across projects
- **Version Control Integration**: Git-tracked knowledge base
- **MCP Memory Integration**: Real-time knowledge graph storage
- **Web Visualization**: Interactive knowledge base browser

## Installation & Setup

### Prerequisites
```bash
# Required tools
node --version    # Node.js for migration scripts
jq --version      # JSON processing
git --version     # Git for history analysis
```

### Installation
```bash
# Install the coding knowledge management system
./install.sh

# Activate commands in current shell
source .activate

# Verify installation
ukb --help
vkb --help
```

### Configuration
The system automatically detects repository structure and configures paths. No manual configuration needed for basic usage.

## Core Concepts

### Knowledge Entities
```json
{
  "name": "PatternName", 
  "entityType": "TransferablePattern|EvolutionPattern|WorkflowPattern",
  "problem": "Clear problem description",
  "solution": "Solution approach", 
  "approach": "Implementation details",
  "applicability": "Where this can be applied",
  "technologies": ["Tech1", "Tech2"],
  "significance": 8,
  "metadata": {
    "source": "git-history|specstory|interactive",
    "created": "2025-06-16T07:30:00Z"
  }
}
```

### Significance Scoring
- **10**: Critical architectural decisions, paradigm shifts
- **8-9**: Major features, significant patterns, important refactoring
- **6-7**: Useful patterns, moderate improvements
- **4-5**: Minor improvements, bug fixes
- **1-3**: Trivial changes, documentation updates

### Entity Types
- **TransferablePattern**: Reusable solutions applicable across projects
- **EvolutionPattern**: Historical development insights from git analysis
- **WorkflowPattern**: Process and methodology patterns
- **System**: Core system entities and hubs

## Usage Modes

### 1. Automatic Mode (Default)
```bash
# Quick analysis of recent changes
ukb

# Equivalent to
ukb --auto
```
**Use Case**: Regular development sessions, quick insight capture

### 2. Interactive Mode
```bash
# Deep insight capture with guided prompts
ukb --interactive
```
**Use Case**: After major architectural decisions, complex problem solving

### 3. Full History Mode
```bash
# Analyze entire git history
ukb --full-history

# Analyze with depth limit
ukb --full-history --history-depth 500

# Interactive analysis of history
ukb --full-history --interactive
```
**Use Case**: New team members, comprehensive codebase understanding

### 4. Agent Mode
```bash
# AI-assisted semantic analysis
ukb --agent
```
**Use Case**: Complex pattern extraction, automated analysis

### 5. Upgrade Mode
```bash
# Migrate to latest schema format
ukb --upgrade
```
**Use Case**: Schema version updates, format migrations

## Full History Analysis

### Purpose
Full history analysis provides comprehensive understanding of how a codebase evolved, capturing:

- **Architectural Evolution**: How system design evolved over time
- **Feature Development Timeline**: When and how features were added
- **Technology Adoption**: Migration patterns and technology decisions
- **Performance Improvements**: Optimization history and impact
- **Refactoring Events**: Major code restructuring events

### Usage Examples

#### New Team Member Onboarding
```bash
# Complete codebase understanding
ukb --full-history --interactive

# Results in knowledge base:
# - 150+ evolution patterns
# - Technology adoption timeline  
# - Architectural decision history
# - Feature development progression
```

#### Technical Debt Assessment
```bash
# Analyze refactoring patterns
ukb --full-history --history-depth 200

# Identify:
# - Frequently modified areas
# - Recurring technical debt patterns
# - Performance improvement opportunities
```

#### Architecture Review
```bash
# Comprehensive architectural analysis
ukb --full-history

# Extract:
# - Design pattern evolution
# - Scalability decision points
# - Technology trade-offs
```

### Output Example
```
📊 FULL HISTORY: Analyzing entire git history (1,247 commits)
🔍 Analyzing 1247 commits for comprehensive understanding...
  Progress: 250/1247 commits processed...
  Progress: 500/1247 commits processed...
  Progress: 750/1247 commits processed...
  Progress: 1000/1247 commits processed...
  Progress: 1247/1247 commits processed...
✅ Comprehensive history analysis completed
   📐 Architecture events: 23
   🚀 Feature developments: 156  
   🔧 Technology adoptions: 34
   ⚡ Performance improvements: 12
   🔄 Refactoring events: 45
```

## Incremental Processing

### State Management
UKB maintains processing state in `~/.ukb-processing-state.json`:

```json
{
  "projects": {
    "your-project": {
      "last_commit_analyzed": "abc123def456",
      "specstory_files_analyzed": ["2025-06-16_session.md"],
      "last_analysis": "2025-06-16T07:30:00Z",
      "schema_version": "2.0.0"
    }
  },
  "global": {
    "last_updated": "2025-06-16T07:30:00Z",
    "version": "3.0.0"
  }
}
```

### Incremental Benefits
- **Efficiency**: Only processes new data since last run
- **Consistency**: Prevents duplicate analysis
- **Performance**: Scales to large repositories
- **Reliability**: Maintains state across sessions

### Force Reprocessing
```bash
# Override incremental state
ukb --force-reprocess

# Reprocess everything including specstory files
ukb --force-reprocess --full-history
```

## Schema Management

### Automatic Migration
```bash
# UKB automatically detects schema version and migrates if needed
ukb  # Will auto-migrate if schema is outdated

# Manual migration
ukb --upgrade
```

### Schema Evolution
- **v1.0**: Basic string observations
- **v2.0**: Structured observations with types (problem, solution, metric, etc.)
- **v3.0**: Enhanced metadata and evolution tracking

### Backward Compatibility
All schema migrations preserve existing data while adding new capabilities.

## Workflow Examples

### 1. Daily Development Workflow
```bash
# Start development session
claude-mcp

# After coding session
ukb  # Captures recent changes incrementally

# View results
vkb  # Open knowledge base visualizer
```

### 2. New Project Analysis
```bash
# Comprehensive project understanding
cd /path/to/project
ukb --full-history --interactive

# Results: Complete knowledge base of project evolution
```

### 3. Architecture Review Preparation
```bash
# Generate comprehensive analysis for review
ukb --full-history --history-depth 300

# Extract key patterns for presentation
ukb --interactive  # Add manual insights about architecture
```

### 4. Team Knowledge Transfer
```bash
# Team member leaving - capture knowledge
ukb --interactive  # Deep insight capture session

# New team member - understand codebase  
ukb --full-history  # Complete evolution understanding
```

## Advanced Features

### Custom Analysis Depth
```bash
# Analyze specific commit range
ukb --history-depth 100

# Focus on recent significant changes
ukb --full-history --history-depth 50 --interactive
```

### Multi-Project Analysis
```bash
# Analyze multiple projects
for project in project1 project2 project3; do
  cd $project
  ukb --full-history
done

# Results: Cross-project pattern identification
```

### Pattern Filtering
UKB automatically filters patterns by:
- **Domain Context**: Must identify specific technologies
- **Problem-Solution Pairs**: Must extract meaningful insights
- **Significance Threshold**: Minimum significance score of 7/10
- **Uniqueness**: Avoids duplicate or generic patterns

## Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Git History   │    │  Conversation   │    │  Interactive    │
│   Analysis      │    │   Logs (.md)    │    │    Input        │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                         ┌───────▼───────┐
                         │      UKB      │
                         │   Processing  │
                         │    Engine     │
                         └───────┬───────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────▼─────┐         ┌──────▼──────┐         ┌─────▼─────┐
    │ MCP Memory│         │ Shared      │         │ Knowledge │
    │  Server   │         │ Memory JSON │         │ Insights  │
    │(Runtime)  │         │(Git-tracked)│         │   (MD)    │
    └───────────┘         └─────────────┘         └───────────┘
```

### Data Flow

1. **Input Sources**: Git commits, conversation logs, manual input
2. **Processing Engine**: Pattern extraction, significance scoring, categorization
3. **Output Targets**: MCP memory, shared-memory.json, insight pages
4. **Visualization**: Web-based knowledge graph browser

### Key Algorithms

#### Commit Categorization
```bash
# Architecture & Design
if [[ "$message" =~ (architect|design|structure|pattern|refactor) ]]; then
  category="architecture"; significance=8

# Feature Development  
elif [[ "$message" =~ ^(feat|add|implement) ]]; then
  category="feature"; significance=6

# Technology Changes
elif [[ "$message" =~ (upgrade|update|migrate|dependency) ]]; then
  category="technology"; significance=7
```

#### Domain Context Extraction
```bash
# Extract specific technologies/frameworks
domain_context=$(echo "$content" | grep -oiE "(react|redux|mcp|claude|three\.js|animation|...)" | head -3)

# Only create insights with meaningful domain context
if [[ -n "$domain_context" ]] && [[ -n "$problem_line" ]] && [[ -n "$solution_line" ]]; then
  create_insight
fi
```

## Best Practices

### 1. Regular Usage
```bash
# Daily development
ukb  # Quick incremental analysis

# Weekly deep dive
ukb --interactive  # Capture architectural insights
```

### 2. Team Collaboration
```bash
# Shared knowledge base via git
git add shared-memory.json
git commit -m "docs: update knowledge base with new patterns"
git push
```

### 3. Large Repositories
```bash
# Use depth limits for large histories
ukb --full-history --history-depth 500

# Process in batches for very large repos
ukb --history-depth 100  # Analyze recent commits first
```

### 4. Quality Control
- Focus on **architectural decisions** and **transferable patterns**
- Use **interactive mode** for complex insights requiring human judgment
- Review generated patterns for **specificity and applicability**

## Troubleshooting

### Common Issues

#### No Insights Generated
```bash
# Check if commits exist
git log --oneline -10

# Force reprocessing
ukb --force-reprocess

# Use interactive mode for manual insights
ukb --interactive
```

#### Schema Migration Issues
```bash
# Manual schema upgrade
ukb --upgrade

# Check current schema version
jq '.metadata.schema_version' shared-memory.json
```

#### Performance Issues
```bash
# Limit analysis depth
ukb --history-depth 100

# Use incremental mode instead of full history
ukb  # Default incremental mode
```

## Integration with Other Tools

### MCP Memory Server
```bash
# Knowledge automatically synced to MCP
claude-mcp  # Access knowledge in Claude sessions
```

### Knowledge Visualization
```bash
# Web-based knowledge browser
vkb  # Opens http://localhost:8080
```

### Git Integration
```bash
# Knowledge base is git-tracked
git status  # Shows shared-memory.json changes
git diff shared-memory.json  # Review knowledge changes
```

## Contributing

The UKB system is designed for extensibility:

- **Pattern Recognition**: Add new commit message patterns
- **Domain Extraction**: Extend technology detection  
- **Significance Scoring**: Refine scoring algorithms
- **Output Formats**: Add new export formats

For development details, see the source code in `knowledge-management/ukb`.