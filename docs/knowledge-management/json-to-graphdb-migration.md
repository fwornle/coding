# Migration Guide: JSON → GraphDB Architecture (v1.x → v2.0)

**Document Version**: 1.0
**Migration Date**: November 2025
**Target Version**: v2.0.0

---

## Executive Summary

This guide documents the architectural migration from file-based JSON storage (`shared-memory*.json`) to a unified GraphDB-based knowledge management system with ontology integration.

### Key Changes

| Aspect | v1.x (Legacy) | v2.0 (Current) |
|--------|---------------|----------------|
| **Primary Storage** | `shared-memory*.json` files | GraphDB (Graphology + LevelDB) |
| **MCP Integration** | MCP Memory Server (runtime only) | Direct GraphDB + optional JSON export |
| **Ontology Support** | None | 5-layer hybrid classification pipeline |
| **UKB Command** | JSON file writes via Knowledge API | Direct database writes via UKBDatabaseWriter |
| **VKB Command** | JSON file reads (batch mode) | GraphDB queries (online mode) default |
| **Data Persistence** | Manual JSON file management | Auto-persist LevelDB (1s interval) |
| **Cross-Project** | Separate JSON files per project | Centralized GraphDB at `~/.../coding/.data/knowledge-graph/` |

---

## Architecture Evolution

### Legacy Architecture (v1.x)

```
┌─────────────────────────────────────────┐
│  Knowledge Capture (UKB)                │
│  - lib/knowledge-api (JS implementation)│
└───────────────┬─────────────────────────┘
                │ Writes
                ▼
┌─────────────────────────────────────────┐
│  shared-memory*.json Files              │
│  - One file per team                    │
│  - Git-tracked                          │
│  - Manual sync required                 │
└───────────────┬─────────────────────────┘
                │ Reads
                ▼
┌─────────────────────────────────────────┐
│  VKB Visualizer (--batch mode)          │
│  - D3.js graph rendering                │
│  - Static JSON parsing                  │
└─────────────────────────────────────────┘

Problems:
- No ontology classification
- Manual file management
- Cross-project sync complexity
- MCP Memory Server (separate runtime graph)
- Dual storage systems (JSON + runtime)
```

### Current Architecture (v2.0)

```
┌──────────────────────────────────────────────────────┐
│  Knowledge Sources                                   │
│  - Live Sessions (StreamingKnowledgeExtractor)       │
│  - Manual Input (UKB Command)                       │
└────────────────┬─────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
    ▼                         ▼
┌─────────────┐    ┌──────────────────────┐
│  Online     │    │  Manual Learning     │
│  Learning   │    │  (UKB)              │
│  + Ontology │    │  Direct DB writes    │
└──────┬──────┘    └──────────┬───────────┘
       │                      │
       └──────────┬───────────┘
                  ▼
┌──────────────────────────────────────────────────────┐
│  Unified GraphDB (Graphology + LevelDB)              │
│  - Entities with ontology metadata                   │
│  - Relationships                                     │
│  - Team isolation                                     │
│  - Auto-persist (1s interval)                        │
│  Location: ~/.../coding/.data/knowledge-graph/       │
└────────────────┬─────────────────────────────────────┘
                 │
    ┌────────────┴────────────────┐
    ▼                             ▼
┌──────────────┐        ┌──────────────────┐
│  VKB         │        │  Optional Export │
│  (--online)  │        │  to JSON         │
│  GraphDB     │        │  (backup)       │
│  queries     │        │                  │
└──────────────┘        └──────────────────┘

Benefits:
✅ Single source of truth
✅ Ontology classification (5-layer pipeline)
✅ Automatic persistence
✅ Cross-project sharing
✅ Unified online + manual learning
✅ Optional JSON export for backups
```

---

## Component Migration Status

### ✅ **MIGRATED** (No Action Required)

1. **UKB Command** (`bin/ukb`)
   - **Old**: `lib/knowledge-api` → `shared-memory*.json`
   - **New**: `lib/ukb-database/cli.js` → GraphDB
   - **Status**: ✅ Complete (Oct 2024)

2. **VKB Command** (`knowledge-management/vkb`)
   - **Old**: `--batch` mode (JSON files)
   - **New**: `--online` mode (GraphDB) **default**
   - **Status**: ✅ Complete (Oct 2024)
   - **Legacy Mode**: `--with-batch` flag still available for compatibility

3. **Streaming Knowledge Extractor** (`src/knowledge-management/StreamingKnowledgeExtractor.js`)
   - **Old**: No ontology support
   - **New**: 5-layer ontology classification pipeline
   - **Status**: ✅ Complete (Nov 2024)

4. **GraphDB Integration** (`src/knowledge-management/GraphDatabaseService.js`)
   - **Status**: ✅ Complete (Oct 2024)
   - **Features**:
     - Graphology (in-memory graph)
     - LevelDB (persistent storage)
     - Ontology metadata per entity
     - Team-scoped queries
     - Auto-persist

---

### ⚠️ **DEPRECATED** (Legacy Components)

1. **lib/knowledge-api** (17 references found)
   - **Status**: DEPRECATED
   - **Replacement**: Direct GraphDB writes via `UKBDatabaseWriter`
   - **Action**: Marked for removal in v3.0
   - **Compatibility**: Still available for legacy integrations

2. **shared-memory*.json Files**
   - **Status**: DEPRECATED
   - **Replacement**: GraphDB `.data/knowledge-graph/`
   - **Action**: Optional JSON export available via `GraphDatabaseService.exportToJSON()`
   - **VKB Compatibility**: Use `--with-batch` flag to read legacy files

---

## User-Facing Changes

### UKB Command

**No changes required** - Command syntax remains the same:

```bash
# v1.x (old - still works)
ukb status
ukb add-entity    # writes to JSON

# v2.0 (new - same syntax, different backend)
ukb status        # queries GraphDB
ukb add-entity    # writes to GraphDB
```

**What Changed Under the Hood**:
- ❌ Was: `lib/knowledge-api` → `shared-memory.json`
- ✅ Now: `lib/ukb-database/cli.js` → GraphDB

### VKB Command

**Default mode changed**:

```bash
# v2.0 Default: --online mode (GraphDB)
vkb               # starts with GraphDB data
vkb start         # visualizes online+manual knowledge

# Legacy compatibility
vkb --with-batch  # reads shared-memory*.json files
vkb --batch-only  # ONLY reads JSON files
```

### Environment Variables

```bash
# v2.0 Configuration
export VKB_DATA_SOURCE="online"      # Default: GraphDB
export VKB_DATA_SOURCE="batch"       # Legacy: JSON files
export VKB_DATA_SOURCE="combined"    # Both (for migration)

# Database paths
export GRAPH_DB_PATH="$CODING_REPO/.data/knowledge-graph"  # Default
export SQLITE_PATH="$CODING_REPO/.data/knowledge.db"       # Default
```

---

## Migration Scenarios

### Scenario 1: Fresh Installation (No Action)

If you're installing v2.0 fresh:
1. GraphDB will be created automatically at `.data/knowledge-graph/`
2. Use UKB/VKB commands normally
3. No migration needed

### Scenario 2: Existing JSON Files (Optional Import)

If you have existing `shared-memory*.json` files you want to preserve:

```bash
# Option 1: Import to GraphDB
cd $CODING_REPO
node -e "
import { GraphDatabaseService } from './src/knowledge-management/GraphDatabaseService.js';
const db = new GraphDatabaseService();
await db.initialize();
await db.importFromJSON('shared-memory-coding.json');
await db.close();
console.log('Import complete');
"

# Option 2: Use VKB in combined mode during transition
vkb start --with-batch  # Visualizes both GraphDB + JSON
```

### Scenario 3: Backup Existing Knowledge

Export current GraphDB knowledge to JSON for backup:

```bash
# Export all teams
node -e "
import { GraphDatabaseService } from './src/knowledge-management/GraphDatabaseService.js';
const db = new GraphDatabaseService();
await db.initialize();

// Export each team
for (const team of ['coding', 'raas', 'resi', 'agentic', 'ui']) {
  await db.exportToJSON(team, \`backup-\${team}.json\`);
  console.log(\`Exported \${team}\`);
}

await db.close();
"
```

---

## Ontology Integration (New in v2.0)

### What is the Ontology System?

The **5-layer hybrid classification pipeline** automatically classifies knowledge entities during capture:

| Layer | Method | Throughput | Latency | Use Case |
|-------|--------|------------|---------|----------|
| **0** | Team Context Filter | >50,000/sec | <0.01ms | Team-specific routing |
| **1** | Pattern Analyzer | >10,000/sec | <0.1ms | Structural patterns |
| **2** | Keyword Matcher | >10,000/sec | <0.1ms | Keyword-based classification |
| **3** | Semantic Embeddings | ~1,000/sec | ~10ms | Semantic similarity |
| **4** | LLM Analyzer (fallback) | ~10/sec | <500ms | Ambiguous cases |

### Ontology Classification Example

```javascript
// Before v2.0: No ontology
{
  "name": "React Hook Pattern",
  "entityType": "Pattern",
  "observations": ["Use useState for component state"]
}

// v2.0: With ontology
{
  "name": "React Hook Pattern",
  "entityType": "Pattern",
  "observations": ["Use useState for component state"],
  "ontology": {
    "entityClass": "ImplementationPattern",      // ← NEW
    "confidence": 0.92,                          // ← NEW
    "team": "coding",                            // ← NEW
    "method": "keyword",                         // ← NEW (layer 2)
    "layer": 2,                                  // ← NEW
    "properties": {                              // ← NEW
      "domain": "frontend",
      "language": "javascript"
    }
  }
}
```

### Querying by Ontology

```javascript
// New in v2.0: Ontology-aware queries
const patterns = await graphDB.queryByOntologyClass({
  entityClass: 'ImplementationPattern',
  team: 'coding',
  minConfidence: 0.8,
  limit: 10
});

// Returns entities classified as "ImplementationPattern" with confidence ≥ 0.8
```

---

## Breaking Changes

### ⚠️ None for End Users

The v2.0 migration maintains **100% backward compatibility** for:
- UKB command syntax
- VKB command syntax (with `--with-batch` flag for legacy mode)
- Existing workflows

### ⚠️ For Developers/Integrations

If you have custom code that:

1. **Directly reads `shared-memory*.json` files**:
   - **Solution**: Use GraphDB API or `GraphDatabaseService.exportToJSON()`

2. **Uses `lib/knowledge-api` directly**:
   - **Solution**: Migrate to `lib/ukb-database/cli.js` or GraphDB Service

3. **Integrates with MCP Memory Server**:
   - **Status**: MCP Memory Server is deprecated
   - **Solution**: Use GraphDB directly

---

## Rollback Procedure

If you need to revert to v1.x behavior:

```bash
# Option 1: Export current GraphDB to JSON
node scripts/export-all-teams-to-json.js

# Option 2: Use VKB in batch-only mode
vkb start --batch-only  # Only reads shared-memory*.json

# Option 3: Downgrade to v1.x
git checkout v1.9.x
npm install
```

---

## Performance Comparison

| Operation | v1.x (JSON) | v2.0 (GraphDB) | Improvement |
|-----------|-------------|----------------|-------------|
| Entity lookup | O(n) file scan | O(1) hash lookup | **100-1000x** |
| Relationship query | O(n²) nested loops | O(k) where k=edges | **50-500x** |
| Ontology classification | N/A | <500ms p95 | **NEW** |
| Heuristic classification | N/A | >10,000/sec | **NEW** |
| Cross-project query | Multiple file reads | Single DB query | **10-50x** |
| Persistence | Manual file write | Auto-persist (1s) | **Automatic** |

---

## FAQ

### Q1: What happens to my existing `shared-memory-*.json` files?

**A**: They are preserved but no longer actively used. You can:
- Keep them as backup
- Import to GraphDB using `GraphDatabaseService.importFromJSON()`
- Continue using with VKB `--with-batch` flag

### Q2: Can I still use the old UKB command?

**A**: The `ukb` command syntax is unchanged, but the backend now writes to GraphDB instead of JSON.

### Q3: How do I view knowledge captured during live sessions (online learning)?

**A**: Use `vkb` command in default `--online` mode:
```bash
vkb start  # Shows both online + manual knowledge from GraphDB
```

### Q4: Can I export GraphDB knowledge to JSON?

**A**: Yes, using `GraphDatabaseService.exportToJSON(team, filePath)`:
```bash
node -e "
import { GraphDatabaseService } from './src/knowledge-management/GraphDatabaseService.js';
const db = new GraphDatabaseService();
await db.initialize();
await db.exportToJSON('coding', 'backup-coding.json');
await db.close();
"
```

### Q5: Where is the GraphDB stored?

**A**: `.data/knowledge-graph/` in your coding project directory:
```
~/.../coding/.data/knowledge-graph/
  ├── 000097.ldb  (LevelDB data files)
  ├── 000098.log  (Write-ahead log)
  ├── CURRENT     (Current version pointer)
  ├── LOCK        (Database lock)
  └── MANIFEST-*  (Metadata)
```

### Q6: How does the ontology classification work?

**A**: See [Ontology Integration Guide](./ontology.md) for details. Short version:
- 5-layer pipeline with early exit
- Heuristics (>10,000/sec) for common patterns
- LLM fallback (<500ms) for ambiguous cases
- Confidence scoring (0-1)

### Q7: Can I disable ontology classification?

**A**: Yes, in `config/knowledge-management.json`:
```json
{
  "ontology": {
    "enabled": false
  }
}
```

---

## Support & Resources

### Documentation
- **Architecture Diagrams**: `docs/images/knowledge-architecture.png`, `docs/images/system-architecture.png`
- **Ontology Guide**: `docs/knowledge-management/ontology.md`
- **API Reference**: `docs/knowledge-management/ontology.md`
- **Migration Guide**: This document

### Troubleshooting
- **Database Locked**: Another process has GraphDB open - check with `lsof .data/knowledge-graph/*.log`
- **Empty VKB**: Ensure VKB is in `--online` mode (default), not `--batch-only`
- **Import Errors**: Check JSON format matches schema in `docs/knowledge-schema.md`

### Contact
- **GitHub Issues**: Report bugs or questions
- **Release Notes**: See `docs/RELEASE-2.0.md`

---

## Timeline

| Date | Milestone |
|------|-----------|
| **Oct 2024** | GraphDB implementation complete |
| **Oct 2024** | UKB/VKB migration to GraphDB |
| **Nov 2024** | Ontology integration (5-layer pipeline) |
| **Nov 2024** | v2.0.0 Release |
| **Future (v3.0)** | Remove lib/knowledge-api (deprecated) |

---

**Migration Status**: ✅ **COMPLETE**
**User Action Required**: ❌ **NONE** (backward compatible)
**Developer Action**: ⚠️ **Review if using knowledge-api directly**
