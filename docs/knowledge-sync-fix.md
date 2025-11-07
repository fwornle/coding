# Knowledge Graph Sync Fix: Timestamp-Based Merge

## Problem

Prior to this fix, the GraphKnowledgeImporter had a critical race condition during system initialization:

1. `GraphDatabaseService.initialize()` loaded existing data from LevelDB
2. `GraphKnowledgeImporter.initialize()` then imported from JSON files
3. JSON imports **overwrote** LevelDB data unconditionally
4. Result: **Data loss** if LevelDB had newer entities than JSON

### Symptom

Users reported mismatches between:
- Entities in LevelDB/Graphology (in-memory graph)
- Entities in `.data/knowledge-export/*.json` files

The JSON files (git-tracked for team collaboration) were being treated as **source of truth on startup**, even when LevelDB had more recent changes.

## Root Cause

The import counter was incrementing regardless of whether entities were actually imported or skipped:

```javascript
// BEFORE (Bug)
for (const entity of data.entities || []) {
  try {
    await this._importEntity(entity, team);
    entitiesImported++;  // ❌ Always increments, even if skipped
  } catch (error) {
    console.warn(`Failed to import entity "${entity.name}":`, error.message);
  }
}
```

While `_importEntity()` had timestamp comparison logic, it:
- Returned `void` (no indication of skip/import)
- Had no logging of skip decisions
- Made debugging impossible

## Solution

### 1. Return Import Result

Modified `_importEntity()` and `_importRelation()` to return explicit results:

```javascript
// AFTER (Fixed)
async _importEntity(entity, team) {
  // ... timestamp comparison logic ...

  if (existingDate > importDate) {
    console.log(`  ⏭ Skipping "${entity.name}" - DB version (${existingDate.toISOString()}) is newer than JSON (${importDate.toISOString()})`);
    return { imported: false, reason: 'db-newer' };
  }

  // ... store entity ...
  return { imported: true };
}
```

### 2. Track Skip vs Import

Updated `importTeam()` to accurately track skipped vs imported entities:

```javascript
let entitiesImported = 0;
let entitiesSkipped = 0;

for (const entity of data.entities || []) {
  try {
    const result = await this._importEntity(entity, team);
    if (result.imported) {
      entitiesImported++;
    } else {
      entitiesSkipped++;
    }
  } catch (error) {
    console.warn(`Failed to import entity "${entity.name}":`, error.message);
  }
}
```

### 3. Detailed Logging

Added comprehensive logging for all merge decisions:

```
⏭ Skipping "Coding" - DB version (2025-11-07) is newer than JSON (2025-06-18)
⏭ Skipping "Entity" - same timestamp (2025-11-07)
⬆️  Updating "Entity" - JSON version (2025-11-08) is newer than DB (2025-11-07)
➕ Adding new entity "NewEntity"
```

## Behavior

### Before Fix

| Scenario | JSON Timestamp | DB Timestamp | Result |
|----------|---------------|--------------|---------|
| JSON older | June 2025 | November 2025 | ❌ DB overwritten (data loss) |
| JSON newer | November 2025 | June 2025 | ✅ DB updated |
| Same timestamp | June 2025 | June 2025 | ❌ Unnecessary write |

### After Fix

| Scenario | JSON Timestamp | DB Timestamp | Result |
|----------|---------------|--------------|---------|
| JSON older | June 2025 | November 2025 | ✅ **Skipped** (DB preserved) |
| JSON newer | November 2025 | June 2025 | ✅ DB updated |
| Same timestamp | June 2025 | June 2025 | ✅ **Skipped** (no write) |

## Testing

Run the test script to verify:

```bash
node scripts/test-import-merge.js
```

Expected output:
```
✓ Created "Coding" entity with timestamp: 2025-11-07T15:24:28.529Z
⏭ Skipping "Coding" - DB version (2025-11-07) is newer than JSON (2025-06-18)
✅ SUCCESS: DB entity with newer timestamp was preserved!
```

## Impact

### Positive Changes

1. ✅ **No data loss** - LevelDB entities with newer timestamps are preserved
2. ✅ **Accurate statistics** - Import logs show actual imported vs skipped counts
3. ✅ **Debugging visibility** - Clear logs explain every merge decision
4. ✅ **Performance** - Avoids unnecessary writes for same-timestamp entities

### Files Modified

- `src/knowledge-management/GraphKnowledgeImporter.js`:
  - `importTeam()` - Track skip vs import accurately
  - `_importEntity()` - Return result, add logging
  - `_importRelation()` - Return result, add logging

### Files Created

- `scripts/test-import-merge.js` - Comprehensive test for merge behavior
- `docs/knowledge-sync-fix.md` - This documentation

## Future Improvements

Consider:
1. **Conflict resolution strategies** - Add "manual-review" mode for conflicts
2. **Merge reports** - Generate summary of all merge decisions
3. **Metadata preservation** - Preserve additional metadata during updates
4. **Bidirectional sync** - Detect and sync changes in both directions

## Related Issues

- VSCode crash during mismatch investigation
- Graph database showing different counts than JSON exports
- Entities disappearing after system restart
