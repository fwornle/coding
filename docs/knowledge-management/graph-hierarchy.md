# Knowledge Graph Hierarchical Structure

## Overview

The VKB knowledge graph uses a **hierarchical structure** to organize knowledge entities across different projects and teams. This structure provides clean separation, intuitive navigation, and efficient filtering.

## Hierarchy Levels

```
CollectiveKnowledge (System)
    |
    +-- includes --> Coding (Project)
    |                   |
    |                   +-- contains/implemented_in --> Patterns/Topics
    |
    +-- includes --> Ui (Project)
    |                   |
    |                   +-- contains/implemented_in --> Patterns/Topics
    |
    +-- includes --> Resi (Project)
                        |
                        +-- contains/implemented_in --> Patterns/Topics
```

### Level 1: System Node (CollectiveKnowledge)

- **Entity Type**: `System`
- **Color**: Green (#3cb371)
- **Purpose**: Root node representing the collective knowledge base
- **Connections**: `includes` relations to all Project nodes

### Level 2: Project Nodes

- **Entity Type**: `Project`
- **Color**: Dark blue (#1e3a5f)
- **Examples**: Coding, Ui, Resi, DynArch, Timeline, Normalisa
- **Purpose**: Team/project containers that group related knowledge
- **Connections**:
  - Incoming: `includes` from CollectiveKnowledge
  - Outgoing: `contains`, `implemented_in` to Topic nodes

### Level 3: Topic/Pattern Nodes

- **Entity Types**: Various (Pattern, Insight, Workflow, etc.)
- **Color**: Light blue (batch/manual) or Light red (online/auto)
- **Purpose**: Actual knowledge entities with observations
- **Connections**: Various relations to Projects and other Topics

## Relation Types

### Hierarchical Relations

| Relation | From | To | Purpose |
|----------|------|-----|---------|
| `includes` | CollectiveKnowledge | Project | Links system to projects |
| `contains` | Project | Topic | Project contains knowledge |
| `implemented_in` | Topic | Project | Knowledge implemented in project |

### Topic-to-Topic Relations

| Relation | Purpose |
|----------|---------|
| `extends` | Topic extends another |
| `related_to` | General relationship |
| `uses` | Topic uses another |

## Team Filtering

The hierarchical structure supports team-based filtering:

1. **Select team(s)** in the viewer sidebar
2. **Filter shows**:
   - All Topics belonging to selected team(s)
   - Project nodes connected to filtered Topics
   - CollectiveKnowledge if any Projects are included

This maintains the hierarchy while filtering by team context.

## Migration from Star Topology

Prior to the hierarchical structure, the graph used a "star topology" where all topics had `contributes_to` relations directly to CollectiveKnowledge. This created visual clutter and didn't reflect the actual project organization.

### Migration Script

To migrate existing data to the hierarchical structure:

```bash
# Dry run - see what would change
node scripts/migrate-to-hierarchical-graph.js --dry-run

# Apply migration
node scripts/migrate-to-hierarchical-graph.js

# Migrate specific team only
node scripts/migrate-to-hierarchical-graph.js --team=coding
```

### What the Migration Does

1. **Removes** all `contributes_to` relations from topics to CollectiveKnowledge
2. **Creates** `includes` relations from CollectiveKnowledge to each Project node

## Implementation Details

### GraphDatabaseService

When entities are created, the service automatically:
- Creates `includes` relation when a Project node is added
- Links CollectiveKnowledge to existing Projects when it's created
- Does NOT create direct topic-to-CollectiveKnowledge relations

### Semantic Analysis Agents

The persistence and observation generation agents:
- Create `implemented_in` relations from topics to Projects
- Do NOT create `contributes_to` relations to CollectiveKnowledge

### VKB Viewer

The visualization component:
- Shows hierarchical structure with appropriate colors
- Maintains hierarchy during search/filter operations
- Includes Project and System nodes when showing related topics
