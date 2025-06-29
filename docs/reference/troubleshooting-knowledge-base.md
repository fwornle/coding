# Knowledge Base Troubleshooting Guide

## Common Issues and Solutions

### 1. Excessive Relations in shared-memory.json

**Symptoms:**
- File grows very large (>10,000 lines)
- Logs show thousands of relations for few entities
- Example: `Synced 21 entities and 5114 relations`
- @KM vkb shows fewer relations than logged

**Cause:**
The memory service was creating duplicate relations due to improper deduplication in Graphology graph operations.

**Solution:**
```bash
# Quick fix - run the repair tool
fix-knowledge-base

# Comprehensive cleanup - removes garbage and duplicates
clean-knowledge-base

# Manual fix - individual cleanup scripts
node scripts/cleanup-shared-memory.js      # Deduplicate relations
node scripts/remove-garbage-patterns.js    # Remove auto-discovered patterns
node scripts/deduplicate-observations.js   # Deduplicate observations

# Check if fixed
jq '.relations | length' shared-memory.json
jq '.entities | length' shared-memory.json
```

**Prevention:**
- Updated memory service now properly deduplicates relations
- Sync operations are throttled to prevent excessive writes
- Relations are deduplicated during export to shared-memory.json

### 2. Sync Throttling and Performance

**New Behavior (Fixed):**
- Minimum 5 seconds between sync operations
- Duplicate relations prevented at creation time
- Background sync every 30 seconds instead of after every operation

**Performance Improvements:**
- Relations reduced from ~5000 to ~50-100 for typical knowledge bases
- File size reduced from ~15MB to ~1MB
- Faster startup and visualization loading

### 3. Inconsistent Viewer Statistics

**Issue:**
VKB viewer shows different entity/relation counts than logged.

**Explanation:**
- Logs show what's in the Graphology in-memory graph (may include duplicates)
- Viewer shows what's in shared-memory.json (deduplicated)
- Fixed memory service now ensures consistency

### 4. Memory Service Debugging

**Check Current Status:**
```bash
# View current database stats
jq '.metadata' shared-memory.json

# Check for duplicate relations
jq '.relations | group_by(.from + "-" + .relationType + "-" + .to) | map(select(length > 1)) | length' shared-memory.json

# Monitor sync frequency
tail -f /tmp/copilot-server.log | grep "Synced"
```

**Healthy Database Indicators:**
- Relation count roughly 2-5x entity count
- File size under 1MB for typical usage
- Sync messages appear every 30+ seconds, not constantly
- No duplicate relations detected

### 5. Duplicate Observations Issue

**Symptoms:**
- Entities have hundreds/thousands of duplicate observations
- File size becomes massive (>1MB for small knowledge base)
- Same observation content repeated with different timestamps
- Example: Entity has 720 observations but only 10 unique ones

**Cause:**
Background sync processes were adding identical observations with new timestamps on each sync operation.

**Solution:**
```bash
# Check for duplicates
jq '[.entities[] | select(.observations and (.observations | length) > (.observations | unique | length)) | {name: .name, obs_count: (.observations | length), unique_count: (.observations | unique | length)}]' shared-memory.json

# Fix duplicates
node scripts/deduplicate-observations.js

# Or use comprehensive cleanup
clean-knowledge-base
```

**Results:**
- Typical reduction: 7,000+ observations → 130 observations (98% reduction)
- File size: 1.5MB → 44KB
- Preserves all unique content, removes timestamp duplicates

**Prevention:**
- Kill background processes: `pkill -f "browser-access\|memory-fallback"`
- Ensure only one memory service runs at a time
- Use `clean-knowledge-base` periodically for maintenance

### 6. Background Process Cleanup

**Symptoms:**
- Multiple `browser-access` or `memory-fallback` processes running
- Continuous duplicate creation despite fixes
- High CPU usage from background services

**Solution:**
```bash
# Check for rogue processes
ps aux | grep -E "(browser-access|memory-fallback|copilot-http)" | grep -v grep

# Kill all background processes
pkill -f "browser-access/dist/index.js"
pkill -f "memory-fallback"

# Restart clean
vkb restart
```

### 7. Recovery Commands

**Complete Reset (Nuclear Option):**
```bash
# Backup first
cp shared-memory.json shared-memory.json.backup

# Reset to minimal structure
echo '{"entities":[],"relations":[],"metadata":{"version":"1.0.0"}}' > shared-memory.json

# Restart services
pkill -f copilot-http-server
coding --copilot
```

**Partial Recovery:**
```bash
# Keep entities, clear relations
jq '.relations = [] | .metadata.total_relations = 0' shared-memory.json > shared-memory-fixed.json
mv shared-memory-fixed.json shared-memory.json
```

## Prevention and Monitoring

### Regular Health Checks
```bash
# Add to cron or run weekly
fix-knowledge-base --check-only

# Monitor file growth
ls -lh shared-memory.json
```

### Best Practices
- Use `ukb` command instead of direct file editing
- Restart services after major updates
- Monitor logs for excessive sync messages
- Keep backups before major changes

## Technical Details

### Fixed Issues (v2.0+)
1. **Relation Deduplication**: Proper checking before adding relations
2. **Sync Throttling**: Minimum 5-second intervals between syncs
3. **Export Deduplication**: Map-based deduplication during export
4. **Error Handling**: Better handling of existing relations

### Architecture Changes
- Graphology graph allows multi-edges but exports deduplicate
- Sync operations are throttled and batched
- Background sync replaces immediate sync after operations
- Proper cleanup tools provided for maintenance

This resolves the issue where knowledge bases would grow from ~100 relations to 5000+ relations due to duplication bugs.