# UKB Unified CLI User Guide (v2.0)

Practical guide for using lib/ukb-unified - the current implementation with lock-free architecture and intelligent routing.

**Version**: 2.0.0
**Location**: `lib/ukb-unified/`

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Workflows](#core-workflows)
3. [Advanced Features](#advanced-features)
4. [Team Collaboration](#team-collaboration)
5. [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

1. **VKB Server running**: UKB Unified CLI requires VKB Server for full functionality

```bash
# Start VKB Server (in separate terminal)
vkb server start

# Or via coding infrastructure
./bin/coding --vkb
```

2. **Verify server is running**:
```bash
ukb status
```

Expected output:
```
VKB Status:
  Server: Running (port 8080)
  Entities: 0
  Relations: 0
```

### Basic Commands

```bash
# Incremental update (default)
ukb

# Check status
ukb status

# Manage entities
ukb entity list
ukb entity add "PatternName" "Type" 8
ukb entity remove "PatternName"

# Manage relations
ukb relation list
ukb relation add "EntityA" "EntityB" "relationType" 9
```

## Core Workflows

### 1. Incremental Update Workflow

The default command runs intelligent incremental processing.

```bash
# Run incremental update
ukb
```

**What happens:**
1. TeamCheckpointManager loads last checkpoint for current project
2. GapAnalyzer identifies what changed since last run
3. VkbApiClient routes operations to VKB Server
4. New checkpoint saved with timestamp

**Output:**
```
✅ Incremental update complete
   Processed 5 items
   Next run will continue from: 2024-11-22T12:00:00.000Z
```

**When to use:**
- Daily workflow at end of coding session
- After completing a feature or fix
- Periodically to capture project knowledge

### 2. Entity Management Workflow

#### Adding Technical Patterns

```bash
# Add a caching pattern
ukb entity add "RedisCachingPattern" "TechnicalPattern" 9

# Add with observation
ukb entity add "ErrorHandling" "Solution" 8 --observation "Implement try-catch with logging"
```

#### Searching and Discovery

```bash
# Search for authentication patterns
ukb entity search "auth"

# List high-significance patterns
ukb entity list --min-significance 8

# Filter by type
ukb entity list --type TechnicalPattern
```

**Output:**
```
Found 3 entities matching 'auth':
- UserAuthentication (TechnicalPattern, significance: 9)
- AuthErrorHandling (Solution, significance: 8)
- JWTValidation (TechnicalPattern, significance: 8)
```

### 3. Relation Management Workflow

#### Creating Relationships

```bash
# Link solution to problem
ukb relation add "ErrorHandlingSolution" "MemoryLeakProblem" "solves" 9

# Show pattern usage
ukb relation add "MyComponent" "RedisCachingPattern" "uses" 8

# Document dependencies
ukb relation add "AuthService" "TokenValidator" "depends_on" 7
```

#### Querying Relationships

```bash
# List all relations from an entity
ukb relation list --from "AuthService"

# Find all "solves" relations
ukb relation list --type "solves"
```

### 4. Checkpoint Management

#### Viewing Checkpoints

```bash
# Show current checkpoint
ukb checkpoint
```

**Output:**
```
Checkpoint for project 'coding':
  Last run: 2024-11-22T12:00:00.000Z
  Processed: 234 items
```

#### Clearing Checkpoints

```bash
# Clear checkpoint (forces full reprocess next run)
ukb checkpoint clear
```

**When to clear:**
- After major refactoring
- When switching between branches
- If checkpoint becomes corrupted

## Advanced Features

### Intelligent Routing

UKB Unified CLI automatically routes between VKB Server API and direct database access.

**When Server Running:**
- Uses HTTP API (port 8080)
- Lock-free concurrent operations
- Real-time updates

**When Server Stopped:**
- Direct database access
- Requires server restart for full functionality

**Check routing:**
```bash
ukb status
```

### Team Checkpoints

Multiple team members can work concurrently without conflicts.

**How it works:**
- Each project has its own checkpoint
- Checkpoints tracked per-project-key
- No file locking or race conditions

**Example:**
```bash
# Developer A works on project 'app'
cd /path/to/app
ukb  # Checkpoint: app

# Developer B works on project 'api'
cd /path/to/api
ukb  # Checkpoint: api

# No conflicts - separate checkpoints
```

### GraphDB Storage

Entities and relations stored in Graphology + LevelDB.

**Benefits:**
- Efficient graph operations
- No JSON file locking
- Fast relationship queries
- Persistent storage

**Location:**
```
.data/knowledge-graph/
├── db/          # LevelDB files
└── metadata     # Graph metadata
```

## Team Collaboration

### Daily Development Workflow

```bash
# Morning: Check knowledge base status
ukb status

# Throughout day: Normal development
# ... coding ...

# End of day: Capture insights
ukb  # Incremental update

# Optional: Add specific patterns
ukb entity add "MyNewPattern" "TechnicalPattern" 8
```

### Knowledge Sharing Workflow

```bash
# Team lead captures architecture decision
ukb entity add "EventDrivenArchitecture" "ArchitecturePattern" 9

# Link to related patterns
ukb relation add "EventDrivenArchitecture" "MessageQueue" "uses" 9

# Team members discover pattern
ukb entity search "event"
ukb relation list --from "EventDrivenArchitecture"
```

### Code Review Enhancement

```bash
# During review, reference established patterns
ukb entity search "caching"

# Check if pattern is already documented
ukb entity list --type TechnicalPattern | grep "Redis"

# Add new pattern discovered during review
ukb entity add "RedisSessionStore" "TechnicalPattern" 8
```

## Workflow Examples

### Scenario 1: Implementing New Feature

```bash
# 1. Search for related patterns
ukb entity search "authentication"

# 2. Review pattern details and relations
ukb relation list --from "JWTAuthentication"

# 3. Implement feature using pattern
# ... coding ...

# 4. Document new insights
ukb entity add "RefreshTokenPattern" "TechnicalPattern" 8
ukb relation add "RefreshTokenPattern" "JWTAuthentication" "extends" 9

# 5. Run incremental update
ukb
```

### Scenario 2: Troubleshooting Issue

```bash
# 1. Search for similar problems
ukb entity search "memory leak"

# 2. Find related solutions
ukb relation list --type "solves"

# 3. After fixing, document solution
ukb entity add "MemoryLeakFix" "Solution" 9
ukb relation add "MemoryLeakFix" "MemoryLeakProblem" "solves" 10

# 4. Capture in checkpoint
ukb
```

### Scenario 3: Onboarding New Team Member

```bash
# Show project knowledge base status
ukb status

# List key patterns
ukb entity list --min-significance 8

# Explore architecture decisions
ukb entity list --type ArchitecturePattern

# Understand pattern relationships
ukb relation list --from "MicroservicePattern"
```

## Troubleshooting

### VKB Server Not Running

**Symptom:**
```
Error: VKB Server not responding
Suggestion: Start server with: vkb server start
```

**Solution:**
```bash
# Start VKB server
vkb server start

# Verify it's running
ukb status
```

### Checkpoint Issues

**Symptom:**
- Incremental update processing too many items
- Gaps not calculated correctly

**Solution:**
```bash
# Clear checkpoint and start fresh
ukb checkpoint clear
ukb  # Next run will reprocess from beginning
```

### Entity Already Exists

**Symptom:**
```
Error: Entity "MyPattern" already exists
```

**Solution:**
```bash
# Update existing entity instead
ukb entity remove "MyPattern"
ukb entity add "MyPattern" "TechnicalPattern" 9

# Or search for it first
ukb entity search "MyPattern"
```

### Server Connection Timeout

**Symptom:**
```
Error: Request exceeded timeout
```

**Solution:**
```bash
# Check server is responsive
curl http://localhost:8080/api/health

# Increase timeout if needed
export VKB_TIMEOUT=10000
ukb status
```

## Tips and Best Practices

### 1. Regular Incremental Updates
Run `ukb` at the end of each coding session to keep knowledge base current.

### 2. Use Descriptive Names
```bash
# Good
ukb entity add "PostgresConnectionPooling" "TechnicalPattern" 8

# Not recommended
ukb entity add "Pattern1" "TechnicalPattern" 8
```

### 3. Set Appropriate Significance
- 1-3: Minor details
- 4-6: Useful information
- 7-8: Important patterns
- 9-10: Critical architecture decisions

### 4. Document Relationships
Always link solutions to problems and patterns to implementations.

```bash
ukb relation add "Solution" "Problem" "solves" 9
ukb relation add "Implementation" "Pattern" "uses" 8
```

### 5. Keep Server Running
For best performance, keep VKB server running during development.

```bash
# Start in tmux/screen session
tmux new -s vkb
vkb server start
# Detach: Ctrl+B, D
```

## Command Reference

### Quick Command Summary

```bash
# Default/Incremental
ukb                                  # Run incremental update

# Status
ukb status                          # Show system status

# Entities
ukb entity list                     # List all entities
ukb entity add NAME TYPE SIG        # Add entity
ukb entity remove NAME              # Remove entity
ukb entity search QUERY             # Search entities

# Relations
ukb relation list                   # List all relations
ukb relation add FROM TO TYPE SIG   # Add relation
ukb relation remove FROM TO         # Remove relation

# Checkpoints
ukb checkpoint                      # View checkpoint
ukb checkpoint clear                # Clear checkpoint
```

## Integration Examples

### With Git Workflow

```bash
# After feature branch merge
git checkout main
git pull
ukb  # Capture new patterns from merged code
```

### With CI/CD

```yaml
# .github/workflows/knowledge-capture.yml
jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Start VKB Server
        run: vkb server start &
      - name: Capture knowledge
        run: ukb
      - name: Commit changes
        run: |
          git add .data/knowledge-graph/
          git commit -m "Update knowledge base"
```

### With IDE Integration

```bash
# VS Code task (.vscode/tasks.json)
{
  "label": "Update Knowledge Base",
  "type": "shell",
  "command": "ukb",
  "problemMatcher": []
}
```

## See Also

- **[README](./README.md)** - Overview and architecture
- **[API Reference](./api-reference.md)** - Complete API documentation
- **[Lock-Free Architecture](../ukb-lock-free-architecture.md)** - Technical implementation
- **[VKB Server Documentation](../../vkb-server/README.md)** - Server setup and API

## Architecture Diagrams

For visual understanding of the system:

- [System Architecture](../images/ukb-cli-architecture.png)
- [Class Diagram](../images/ukb-cli-class-diagram.png)
- [Data Flow](../images/ukb-cli-data-flow.png)
- [Entity Creation Sequence](../images/ukb-cli-sequence-entity-creation.png)
- [Incremental Workflow](../images/ukb-cli-sequence-insight-processing.png)
