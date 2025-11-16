# UKB - Update Knowledge Base

**Component**: [ukb-cli](../../lib/knowledge-api/)
**Type**: Command-line tool (Node.js)
**Purpose**: Capture and manage development insights

---

## Overview

UKB-CLI is a modern Node.js-based knowledge management system that captures, analyzes, and organizes technical knowledge across projects. It provides intelligent knowledge capture through automatic git analysis and interactive prompts.

![UKB Fallback Knowledge Capture Workflow](../images/fallback-knowledge-capture.png)

The UKB system provides a manual fallback mechanism for knowledge capture when automated systems are unavailable or insufficient. It supports both automatic git-based analysis and interactive modes for capturing insights.

### Key Features

- **Cross-Platform**: Pure Node.js with no OS-specific dependencies
- **Intelligent Git Analysis**: Incremental commit processing with pattern detection
- **Interactive Mode**: Guided prompts with real-time validation
- **Quality Assurance**: Content filtering and URL validation
- **Agent Integration**: Programmatic API for coding agents
- **MCP Synchronization**: Automatic memory graph updates

---

## Quick Reference

### Basic Commands

```bash
# Auto-analysis mode (incremental git analysis)
ukb

# Interactive deep insight capture
ukb --interactive

# List all entities
ukb --list-entities

# Search knowledge base
ukb search "pattern name"

# Add specific entity
ukb --add-entity "EntityName" --type TransferablePattern
```

### Interactive Mode

```bash
ukb --interactive

# Enhanced prompts with validation:
# - Problem description (with content filtering)
# - Solution approach (with implementation details)
# - Rationale for the solution
# - Key learnings and insights
# - Applicability context
# - Technologies used (validated list)
# - Reference URLs (automatically verified)
# - Related code files
# - Custom entity naming support
```

---

## Usage Modes

### 1. Auto Mode (Default) - Intelligent Git Analysis

```bash
ukb
```

**What it does:**
- Analyzes recent git commits for patterns
- Incremental processing to avoid duplicate work
- Automatic pattern detection with significance scoring
- Categorizes commits (feature, fix, refactor, etc.)
- Updates knowledge base automatically

**Use when:**
- End of development session
- After implementing significant changes
- Daily knowledge accumulation
- Automated CI/CD integration

### 2. Interactive Mode - Structured Capture

```bash
ukb --interactive
```

**What it does:**
- Structured problem-solution-rationale capture
- Real-time URL verification for reference links
- Custom entity naming support
- Technology validation against known frameworks
- Content quality filters

**Use when:**
- Documenting architectural decisions
- Capturing complex solutions
- Recording lessons learned
- Deep insight capture

### 3. Search and Query

```bash
# Search by keyword
ukb search "authentication pattern"

# List entities by type
ukb --list-entities --type TransferablePattern

# Show specific entity details
ukb entity show "ReactHookPattern" --verbose
```

### 4. Management Operations

```bash
# Remove entity
ukb --remove-entity "EntityName"

# Rename entity
ukb --rename-entity "OldName" "NewName"

# Remove relation
ukb --remove-relation "Entity1" "Entity2"

# Validate knowledge base
ukb --validate

# Export knowledge base
ukb --export-json
```

---

## Architecture

### Modern Node.js Design

UKB-CLI follows a layered architecture:

- **CLI Layer**: Command-line interface with comprehensive argument parsing
- **Core Services**: Knowledge management, git analysis, and insight extraction
- **Validation Layer**: Content quality assurance and schema compliance
- **Integration Layer**: MCP synchronization and visualizer updates

### Backward Compatibility

100% backward compatible with legacy bash UKB:
- All existing `ukb` commands work unchanged
- Legacy script preserved as `ukb-original`
- Transparent delegation to Node.js implementation
- Same data format and git integration

---

## Knowledge Structure

### Entity Schema

```json
{
  "name": "PatternName",
  "entityType": "Pattern|Solution|Architecture|Tool",
  "significance": 8,
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
```

### Entity Types

- **Pattern**: Reusable solutions and approaches
- **Solution**: Specific problem fixes
- **Architecture**: System design insights
- **Tool**: Technology and framework usage
- **Workflow**: Process and methodology insights

---

## Programmatic API

### KnowledgeAPI Class

```javascript
const { KnowledgeManager } = require('ukb-cli');

// Initialize knowledge manager
const manager = new KnowledgeManager({
  knowledgeBasePath: './knowledge-graph (GraphDB)',
  mcpIntegration: true
});

// Capture structured insight
await manager.captureInsight({
  name: "ReactHookPattern",
  problem: "Stateful logic duplication across components",
  solution: "Extract logic into custom hooks",
  rationale: "DRY principle and improved testability",
  learnings: "Hooks enable better separation of concerns",
  applicability: "Any React app with duplicated state logic",
  technologies: ["React", "TypeScript"],
  references: ["https://reactjs.org/docs/hooks-custom.html"],
  significance: 8
});

// Git analysis
const insights = await manager.analyzeGitHistory({
  depth: 20,
  sinceCommit: 'abc123',
  includeCategories: ['feature', 'refactor']
});

// Search and query
const results = await manager.search("authentication pattern");
const entities = await manager.getEntitiesByType("TransferablePattern");
```

---

## Common Use Cases

### 1. Capturing Bug Fix Patterns

**Scenario**: You fixed a tricky bug with React hooks dependency arrays

```bash
# Interactive capture
ukb --interactive

? Insight type: Problem-Solution
? Problem description: useEffect infinite loop due to object dependency
? Solution description: Use useMemo to memoize object dependencies

# Quick non-interactive capture
ukb entity add -n "ReactHooksDependencyPattern" -t "TechnicalPattern" -s 9 \
  -o "Always memoize object and array dependencies in hooks"
```

### 2. Documenting Architecture Decisions

**Scenario**: Team decided to migrate from Redux to Zustand

```bash
# Create problem entity
ukb entity add -n "ReduxComplexityProblem" -t "Problem" -s 7 \
  -o "Redux boilerplate becoming unmaintainable with 50+ slices"

# Create solution entity
ukb entity add -n "ZustandMigrationSolution" -t "Solution" -s 8 \
  -o "Migrate to Zustand for simpler state management"

# Create relationship
ukb relation add -f "ZustandMigrationSolution" -t "ReduxComplexityProblem" \
  -r "solves" -s 8
```

### 3. Post-Mortem Analysis

**Scenario**: After production incident, capture learnings

```bash
# Create incident entity
ukb entity add -n "DatabaseConnectionPoolIncident2024" -t "Problem" -s 10 \
  -o "Production outage due to connection pool exhaustion"

# Add root cause
ukb entity add -n "MissingConnectionPoolMonitoring" -t "Problem" -s 9 \
  -o "No alerts configured for connection pool usage"

# Add solution
ukb entity add -n "ConnectionPoolMetricsSolution" -t "Solution" -s 9 \
  -o "Implement Prometheus metrics for connection pool monitoring"

# Create relationships
ukb relation add -f "MissingConnectionPoolMonitoring" \
  -t "DatabaseConnectionPoolIncident2024" -r "causes"

ukb relation add -f "ConnectionPoolMetricsSolution" \
  -t "MissingConnectionPoolMonitoring" -r "solves"
```

### 4. Onboarding New Team Members

**Scenario**: Create knowledge trail for new developers

```bash
# Export project-specific patterns
ukb entity list -t "WorkflowPattern" > onboarding-patterns.txt

# Create onboarding checklist
ukb entity add -n "NewDeveloperOnboardingChecklist" -t "Documentation" -s 8

# Link to key patterns
ukb relation add -f "NewDeveloperOnboardingChecklist" \
  -t "LocalDevelopmentSetupPattern" -r "references"
```

---

## Domain-Specific Knowledge Bases

### Automatic Domain Detection

When working in a project directory, UKB automatically creates domain-specific knowledge bases:

```bash
# Navigate to domain project
cd /path/to/raas-project

# First ukb command creates domain-specific file
ukb --list-entities
# Creates: /Users/<username>/Agentic/coding/shared-memory-raas.json

# Add domain entity using piped input
echo "StreamProcessingPipeline
TechnicalPattern
8
Core pattern for real-time data reprocessing
Handles high-throughput data streams with fault tolerance
Implemented using Apache Kafka + Apache Flink" | ukb --add-entity
```

### Cross-Domain Pattern Discovery

```bash
# Search across all team knowledge bases
cd /Users/<username>/Agentic/coding
grep -l "MicroserviceArchitecture" team-specific JSON exports

# Extract domain-specific implementations
ukb --print --team raas | jq '.entities[] | select(.name | contains("Microservice"))'

# Create cross-domain pattern in shared knowledge
cd /any/project
ukb entity add -n "CrossDomainMicroservicePattern" -t "ArchitecturePattern" -s 10 \
  -o "Microservice patterns applicable across RaaS and Resilience domains"
```

---

## Migration from Legacy UKB

### Automatic Migration

All existing `ukb` commands continue to work unchanged. The system automatically delegates to the new Node.js implementation while maintaining full compatibility.

#### What Changed

- **Internal Architecture**: Bash → Node.js modular design
- **Performance**: 3x faster processing, 50% memory reduction
- **Features**: Enhanced validation, custom naming, batch operations
- **API**: Stable programmatic interface for agent integration

#### What Stayed the Same

- **Commands**: All existing commands work identically
- **Data Format**: knowledge-graph (GraphDB) format unchanged
- **Workflows**: Existing team workflows unaffected
- **Git Integration**: Same git-based knowledge sharing

#### Verification Steps

```bash
# Verify migration success
ukb --validate

# Check performance improvement
time ukb --list-entities

# Test new features
ukb --add-entity "TestPattern" --type TransferablePattern
ukb --remove-entity "TestPattern"
```

---

## Advanced Features

### Batch Operations

```bash
# Add multiple entities from file
ukb --add-multiple-entities entities.json

# Import relations from file
ukb --import-relations relations.json

# Export with filters
ukb export --type TechnicalPattern --min-significance 8
```

### Data Management

```bash
# Comprehensive validation
ukb --validate --detailed

# Data integrity checks
ukb --check-integrity

# Performance analysis
ukb --analyze-performance
```

### CI/CD Integration

```bash
# Automated knowledge updates
ukb --analyze-git --auto-commit --webhook-url "https://api.example.com"

# Custom agent integration
UKB_API_MODE=true ukb --capture --stdin < insight.json
```

---

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
ukb --incremental
```

### Debug Mode

```bash
# Enable debug logging
DEBUG=1 ukb --verbose

# Check analysis results
cat ~/.ukb/debug.log
```

---

## Full Documentation

For complete technical documentation, see:

**[lib/knowledge-api/README.md](../../lib/knowledge-api/README.md)**

Topics covered:
- Complete architecture documentation
- API reference with all methods
- Plugin architecture details
- Advanced configuration options
- Development guide

---

## See Also

- [VKB - Visualize Knowledge Base](./vkb-visualize.md)
- [Knowledge Workflows](./workflows.md)
- [Knowledge Management Overview](./README.md)
