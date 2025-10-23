# graph-sync - Knowledge Base Synchronization Tool

**Purpose**: Manual control over bidirectional knowledge synchronization between LevelDB and git-tracked JSON exports.

---

## Overview

The `graph-sync` CLI tool provides manual control over the knowledge base synchronization system, enabling team collaboration through git-tracked JSON files while maintaining fast runtime performance with LevelDB.

### Architecture

```
Runtime Storage          Git-Tracked Exports
(Fast binary)           (Human-readable)

.data/knowledge-graph/  →  .data/knowledge-export/
  ├── CURRENT              ├── coding.json
  ├── LOCK                 ├── resi.json
  ├── LOG                  └── ui.json
  └── MANIFEST-*
        ↕                         ↕
    LevelDB            ←→    Pretty JSON
    (local)                  (version controlled)
```

**Key Features**:
- ✅ Bidirectional sync (import JSON → LevelDB, export LevelDB → JSON)
- ✅ Team-specific operations (per-team or all teams)
- ✅ Status reporting (entities/relations count, last sync time)
- ✅ Automatic import on startup
- ✅ Automatic export on changes (debounced 5s)
- ✅ Manual override for both directions

---

## Installation

The tool is automatically available after installing the coding toolkit:

```bash
# Install coding toolkit
cd /Users/<username>/Agentic/coding
./install.sh

# graph-sync is now in PATH via bin/graph-sync
```

---

## Commands

### `status` - View Sync Status

Shows the current synchronization state for all teams:

```bash
graph-sync status
```

**Output**:
```
Graph Knowledge Sync Status
============================================================

Team: coding (Coding project infrastructure and patterns)
  Export file: ✓ exists
  Location:    /path/to/.data/knowledge-export/coding.json
  Entities:    14
  Relations:   29
  Last export: 2025-10-23T08:22:16.432Z
  In LevelDB:  14 entities

Team: resi (Resilience patterns)
  Export file: ✓ exists
  Location:    /path/to/.data/knowledge-export/resi.json
  Entities:    4
  Relations:   5
  Last export: 2025-10-23T08:22:16.433Z
  In LevelDB:  4 entities

Overall Graph Statistics
  Total nodes: 18
  Total edges: 34
```

### `export [team]` - Export to JSON

Export knowledge from LevelDB to git-tracked JSON files:

**Export specific team**:
```bash
graph-sync export coding
```

**Export all teams**:
```bash
graph-sync export
```

**Output**:
```
Exporting team "coding"...
✓ Exported team "coding": 14 entities, 29 relations → .data/knowledge-export/coding.json
✓ Export complete
```

**Use cases**:
- Manual export after bulk knowledge updates
- Prepare knowledge for git commit
- Create backup before major changes

### `import [team]` - Import from JSON

Import knowledge from git-tracked JSON files into LevelDB:

**Import specific team**:
```bash
graph-sync import coding
```

**Import all teams**:
```bash
graph-sync import
```

**Output**:
```
Importing team "coding"...
✓ Imported team "coding": 14 entities, 29 relations from .data/knowledge-export/coding.json
✓ Import complete: 14 entities, 29 relations
```

**Use cases**:
- Load knowledge after git pull
- Restore from JSON backup
- Initialize new development environment
- Resolve conflicts manually

**Conflict Resolution**:
- Strategy: **newest-wins** (based on `last_updated` timestamp)
- Automatic: Compares entity timestamps and keeps newer version
- No manual intervention required

### `sync` - Bidirectional Sync

Perform complete bidirectional synchronization:

```bash
graph-sync sync
```

**Process**:
```
Step 1: Import from JSON to LevelDB
✓ coding: 14 entities, 29 relations
✓ resi: 4 entities, 5 relations
✓ ui: 12 entities, 20 relations

Step 2: Export from LevelDB to JSON
✓ coding
✓ resi
✓ ui

✓ Sync complete
```

**Use cases**:
- Initial setup of new environment
- Resolve sync inconsistencies
- Manual refresh after complex git operations

---

## Configuration

### Team Configuration

Configuration is stored in `.data/knowledge-config.json`:

```json
{
  "version": "1.0.0",
  "defaultTeam": "coding",
  "teams": {
    "coding": {
      "exportPath": ".data/knowledge-export/coding.json",
      "description": "Coding project infrastructure and patterns",
      "enabled": true
    },
    "resi": {
      "exportPath": ".data/knowledge-export/resi.json",
      "description": "Resilience team patterns",
      "enabled": true
    }
  },
  "export": {
    "format": "pretty-json",
    "autoExport": true,
    "debounceMs": 5000,
    "includeMetadata": true
  },
  "import": {
    "autoImportOnStartup": true,
    "conflictResolution": "newest-wins"
  }
}
```

### Adding New Team

1. **Edit configuration**:
```bash
# Edit .data/knowledge-config.json
{
  "teams": {
    "new-team": {
      "exportPath": ".data/knowledge-export/new-team.json",
      "description": "New team knowledge",
      "enabled": true
    }
  }
}
```

2. **Create initial export** (if JSON exists):
```bash
# Import from existing JSON
graph-sync import new-team
```

3. **Or create empty and add entities**:
```bash
# Use UKB to add entities
ukb --interactive
# Specify team when prompted
```

---

## Automatic Synchronization

### Auto-Import on Startup

When the GraphKnowledgeImporter is initialized (happens automatically on coding session start):

```javascript
// Automatic import from JSON to LevelDB
const importer = new GraphKnowledgeImporter(graphService, {
  autoImportOnStartup: true  // Default
});

await importer.initialize();
// → Loads all team knowledge from .data/knowledge-export/*.json
```

**Behavior**:
- Runs once per session initialization
- Imports all enabled teams from config
- Uses newest-wins conflict resolution
- Logs import statistics

### Auto-Export on Changes

The GraphKnowledgeExporter monitors for entity/relationship changes:

```javascript
// Automatic export from LevelDB to JSON (debounced)
const exporter = new GraphKnowledgeExporter(graphService, {
  autoExport: true,       // Default
  debounceMs: 5000        // 5 second delay
});

await exporter.initialize();
// → Exports to JSON automatically 5s after last change
```

**Behavior**:
- Debounced: Waits 5s after last change before export
- Per-team: Only exports modified team's knowledge
- Pretty formatting: JSON formatted for git diffs
- Event-driven: Triggered by entity:stored and relationship:stored events

**Disable auto-sync** (if needed):
```javascript
// Manual control only
const exporter = new GraphKnowledgeExporter(graphService, {
  autoExport: false
});
const importer = new GraphKnowledgeImporter(graphService, {
  autoImportOnStartup: false
});
```

---

## Team Collaboration Workflow

### Workflow: Share New Knowledge

**Developer A**:
```bash
# 1. Capture knowledge
ukb --interactive
# → Auto-export creates .data/knowledge-export/coding.json

# 2. Review changes
git diff .data/knowledge-export/coding.json

# 3. Commit and push
git add .data/knowledge-export/
git commit -m "docs: add API design pattern insight"
git push
```

**Developer B**:
```bash
# 1. Pull changes
git pull

# 2. Start new session (auto-imports)
coding
# → GraphKnowledgeImporter loads new knowledge

# 3. Or manually import
graph-sync import coding

# 4. View in visualization
vkb
```

### Workflow: Resolve Conflicts

**Scenario**: Both developers modified same entity

```bash
# 1. Pull creates merge conflict
git pull
# → Conflict in .data/knowledge-export/coding.json

# 2. Resolve conflict manually (edit JSON)
# Keep both changes or merge observations

# 3. Import resolved JSON
graph-sync import coding

# 4. Export to confirm
graph-sync export coding

# 5. Commit resolution
git add .data/knowledge-export/coding.json
git commit -m "docs: resolve knowledge conflict"
```

**Automatic resolution**: If timestamps differ, newest-wins on import.

### Workflow: Team Onboarding

**New team member**:
```bash
# 1. Clone repository
git clone <repo-url>
cd <repo>

# 2. Install coding toolkit
cd /Users/<username>/Agentic/coding
./install.sh

# 3. Start session (auto-imports all team knowledge)
coding

# 4. Verify import
graph-sync status

# 5. View knowledge
vkb
```

---

## File Locations

### Git-Tracked Files

**Always commit**:
```
.data/
├── knowledge-export/          # Team knowledge (JSON)
│   ├── coding.json
│   ├── resi.json
│   └── ui.json
└── knowledge-config.json      # Team configuration
```

### Gitignored Files

**Never commit** (in .gitignore):
```
.data/
├── knowledge-graph/           # Binary LevelDB
│   ├── CURRENT
│   ├── LOCK
│   ├── LOG
│   └── MANIFEST-*
├── knowledge.db*              # SQLite analytics
└── backups/                   # Automatic backups
```

---

## Troubleshooting

### Database Lock Error

**Error**: `Database failed to open`

**Solution**:
```bash
# 1. Check for stale lock
lsof .data/knowledge-graph/LOCK

# 2. Kill holding process
kill -9 <PID>

# 3. Retry operation
graph-sync status
```

### Import/Export Mismatch

**Problem**: Different entity counts in LevelDB vs JSON

**Diagnosis**:
```bash
# Check sync status
graph-sync status

# Look for discrepancies:
# - "In LevelDB: 14 entities"
# - "Entities: 10"  # In JSON
```

**Solution**:
```bash
# Full resync
graph-sync sync
```

### Missing Team Export

**Error**: `No export file found for team "xyz"`

**Solution**:
```bash
# 1. Check configuration
cat .data/knowledge-config.json

# 2. Create export
graph-sync export xyz

# 3. Or import if JSON exists elsewhere
cp /path/to/backup/xyz.json .data/knowledge-export/
graph-sync import xyz
```

---

## Advanced Usage

### Programmatic Access

```typescript
import { GraphDatabaseService } from './src/knowledge-management/GraphDatabaseService.js';
import { GraphKnowledgeExporter } from './src/knowledge-management/GraphKnowledgeExporter.js';
import { GraphKnowledgeImporter } from './src/knowledge-management/GraphKnowledgeImporter.js';

// Initialize services
const graphService = new GraphDatabaseService({
  dbPath: '.data/knowledge-graph'
});
await graphService.initialize();

const exporter = new GraphKnowledgeExporter(graphService, {
  exportDir: '.data/knowledge-export',
  configPath: '.data/knowledge-config.json'
});
await exporter.initialize();

const importer = new GraphKnowledgeImporter(graphService, {
  exportDir: '.data/knowledge-export',
  configPath: '.data/knowledge-config.json'
});
await importer.initialize();

// Manual operations
await importer.importTeam('coding');
await exporter.exportTeam('coding');
```

### Custom Export Path

```bash
# Export to custom location
graph-sync export coding --output /tmp/backup-coding.json
```

### Dry Run

```bash
# Preview import without changes
graph-sync import coding --dry-run
```

---

## See Also

- [Knowledge Management Overview](./README.md)
- [UKB - Update Knowledge Base](./ukb-update.md)
- [VKB - Visualize Knowledge Base](./vkb-visualize.md)
- [System Overview](../system-overview.md)
