# CRITICAL: UKB System Issues Analysis

**Date**: 2025-11-07
**Session**: Knowledge Base Health Check
**Status**: 🚨 CRITICAL ISSUES IDENTIFIED

---

## Executive Summary

Running `ukb status` revealed three critical system failures that violate the design principles of our robust monitoring infrastructure:

1. **Qdrant Database Unavailable** - Despite PSM/watchdog systems
2. **SQLite Schema Creation in UKB** - Unexpected behavior
3. **JSON/LevelDB Data Discrepancy** - 5 missing relations

## Issue #1: Qdrant Database Unavailable

### Current Behavior

```
[DatabaseManager] Qdrant not available: fetch failed
[DatabaseManager] Vector search features will be disabled
Failed to obtain server version. Unable to check client-server compatibility.
```

### Root Cause Analysis

#### Docker Not Running
```bash
$ docker ps
Cannot connect to the Docker daemon at unix:///Users/q284340/.docker/run/docker.sock.
Is the docker daemon running?
```

**Docker Desktop is completely stopped.**

#### Missing Service Definition

Analyzed the startup chain:
1. `bin/coding` → `scripts/launch-claude.sh`
2. `launch-claude.sh:97` → `start-services.sh`
3. `start-services.sh:16` → `scripts/start-services-robust.js` (if ROBUST_MODE=true)

**CRITICAL FINDING**: The startup scripts start Qdrant ONLY for the Constraint Monitor (port 6333), **NOT for the knowledge base!**

**Evidence from `start-services.sh`**:
- **Lines 116-287**: Docker/Qdrant startup is ONLY for constraint-monitor-qdrant container
- **Line 193**: Starts `constraint-monitor-qdrant` container
- **No code**: for starting knowledge base Qdrant instance

#### What Qdrant is Used For

**From `DatabaseManager.js:45-56`**:
```javascript
qdrantConfig: {
  collections: {
    knowledge_patterns: { vectorSize: 1536, distance: 'Cosine' },
    knowledge_patterns_small: { vectorSize: 384, distance: 'Cosine' },
    trajectory_analysis: { vectorSize: 384, distance: 'Cosine' },
    session_memory: { vectorSize: 384, distance: 'Cosine' }
  }
}
```

**Purpose**:
- Vector embeddings for semantic search
- Knowledge pattern similarity matching
- Trajectory analysis
- Session memory persistence

### Why This Violates System Design

**From `docs/robust-startup-system.md`**:
> "Optional Services (Degrade gracefully if failed)
> 1. VKB Server - Knowledge visualization (port 8080)
> 2. Constraint Monitor - Live guardrails system
> 3. Semantic Analysis - MCP semantic analysis server"

**Qdrant is NOT listed as a service to start!**

**From `docs/enhanced-health-monitoring.md`**:
> "4-Layer Protection Architecture
> 1. Layer 1: Watchdog - Global service monitoring and recovery
> 2. Layer 2: Coordinator - Multi-project session coordination
> 3. Layer 3: Verifier - Health verification and reporting
> 4. Layer 4: Monitor - Individual session transcript monitoring"

**Qdrant is NOT mentioned in health monitoring!**

### Impact Assessment

**Current State**:
- ❌ No vector search capabilities
- ❌ No semantic knowledge retrieval
- ❌ No pattern similarity matching
- ❌ No trajectory analysis
- ✅ Graph DB still works (basic knowledge storage)
- ✅ SQLite still works (budget tracking, session metrics)

**Degraded Functionality**:
- Knowledge queries work but only via exact matching
- No semantic "find similar patterns" capability
- No embedding-based retrieval
- No intelligent knowledge suggestions

### Proposed Solutions

#### Solution 1: Dedicated Knowledge Base Qdrant Container

**Add to `start-services.sh` (after line 287)**:

```bash
# Start Knowledge Base Qdrant (separate from Constraint Monitor)
echo "🟢 Starting Knowledge Base Qdrant (port 6334)..."

if check_docker; then
    # Check if knowledge-base-qdrant container already running
    if docker ps --filter "name=knowledge-base-qdrant" | grep -q knowledge-base-qdrant; then
        echo "✅ Knowledge Base Qdrant already running"
        QDRANT_STATUS="✅ OPERATIONAL"
    else
        # Start knowledge base Qdrant container
        docker run -d --name knowledge-base-qdrant \
            -p 6334:6333 \
            -v "$CODING_DIR/.data/qdrant:/qdrant/storage" \
            qdrant/qdrant:latest || {
            echo "⚠️ Failed to start Knowledge Base Qdrant"
            QDRANT_STATUS="⚠️ DEGRADED"
        }

        # Wait for Qdrant to be ready
        sleep 3
        if curl -f http://localhost:6334/health >/dev/null 2>&1; then
            echo "✅ Knowledge Base Qdrant started on port 6334"
            QDRANT_STATUS="✅ OPERATIONAL"
        else
            echo "⚠️ Knowledge Base Qdrant not responding"
            QDRANT_STATUS="⚠️ DEGRADED"
        fi
    fi
else
    echo "⚠️ Docker not running - Qdrant unavailable"
    QDRANT_STATUS="⚠️ DEGRADED"
fi
```

**Register with PSM**:
```bash
node scripts/psm-register.js knowledge-base-qdrant $(docker inspect -f '{{.State.Pid}}' knowledge-base-qdrant) global docker-qdrant
```

#### Solution 2: Auto-Start Docker on macOS

**Add to `launch-claude.sh` (before line 87)**:

```bash
# Ensure Docker is running (macOS)
ensure_docker_running() {
  if ! docker info >/dev/null 2>&1; then
    log "🐳 Docker not running - attempting to start Docker Desktop..."

    # Try to start Docker Desktop on macOS
    if [ -f "/Applications/Docker.app/Contents/MacOS/Docker Desktop.app/Contents/MacOS/Docker Desktop" ]; then
      open -a "Docker Desktop"

      log "⏳ Waiting for Docker to start (max 60 seconds)..."
      for i in {1..60}; do
        if docker info >/dev/null 2>&1; then
          log "✅ Docker started successfully"
          return 0
        fi
        sleep 1
      done

      log "❌ Docker failed to start after 60 seconds"
      log "💡 Please start Docker Desktop manually and retry"
      return 1
    else
      log "❌ Docker Desktop not found at expected location"
      log "💡 Please install Docker Desktop: https://www.docker.com/products/docker-desktop"
      return 1
    fi
  fi

  log "✅ Docker is already running"
  return 0
}

# Call before starting services
if ! ensure_docker_running; then
  log "⚠️ WARNING: Docker not available - vector search features will be disabled"
  log "   Continuing in DEGRADED mode without Qdrant..."
fi
```

#### Solution 3: Update Documentation

**Update `docs/robust-startup-system.md`**:

Add new section after line 83:

```markdown
#### Critical Services (Must be running but optional features)

1. **Docker Desktop** - Required for Qdrant vector search
2. **Knowledge Base Qdrant** - Vector embeddings and semantic search (port 6334)
3. **Constraint Monitor Qdrant** - Pattern learning and persistence (port 6333)

If Docker fails to start → **Continue in DEGRADED mode** with warning
If Qdrant fails to start → **Continue in DEGRADED mode** without vector search
```

**Update `docs/enhanced-health-monitoring.md`**:

Add to "Core Components" section:

```markdown
#### 5. Docker Health Monitor (`scripts/docker-health-monitor.js`)
- Detects Docker daemon status
- Auto-starts Docker Desktop on macOS
- Monitors Docker container health
- Reports Qdrant availability for both knowledge base and constraint monitor
```

---

## Issue #2: SQLite Schema Creation in UKB

### Current Behavior

```
[DatabaseManager] SQLite schemas created
[DatabaseManager] SQLite initialized successfully
```

### Analysis

**From `DatabaseManager.js:308-363` (`createSQLiteSchemas`)**:

SQLite is used for:
1. **`budget_events`** - Cost tracking (tokens, USD, provider, model)
2. **`session_metrics`** - Session analytics (exchanges, extractions, budget)
3. **`embedding_cache`** - Cached embeddings to avoid regeneration

**Critical Comment in Code**:
```javascript
// NOTE: knowledge_extractions and knowledge_relations tables REMOVED
// Knowledge is now stored in Graph DB (see GraphDatabaseService)
// SQLite is now ONLY for analytics: budget_events, session_metrics, embedding_cache
```

### Why This Happens

**UKB calls `DatabaseManager.initialize()`** which:
1. Initializes SQLite (`initializeSQLite()`)
2. Creates schemas (`createSQLiteSchemas()`)
3. Initializes GraphDB (`initializeGraphDB()`)
4. Initializes Qdrant (`initializeQdrant()`)

### Is This Correct Behavior?

**YES** - This is by design. SQLite is used for:
- Budget tracking across sessions
- Session metrics (useful for analytics)
- Embedding cache (performance optimization)

**UKB SHOULD create these schemas** because:
- Knowledge queries may need budget tracking
- Future features may use session metrics
- Embedding cache improves performance

### Recommendation

**✅ NO ACTION NEEDED** - This is correct behavior. SQLite schemas are lightweight and necessary for analytics.

**Optional Enhancement**: Add comment to UKB output:
```
[DatabaseManager] SQLite schemas created (for budget tracking & analytics)
```

---

## Issue #3: JSON/LevelDB Data Discrepancy

### Current Behavior

**From UKB output**:
```
Loaded 31 nodes and 59 edges from Level
✓ Imported team "coding": 14 entities, 29 relations
✓ Imported team "resi": 4 entities, 5 relations
✓ Imported team "ui": 12 entities, 20 relations
```

**Verification**:
```bash
$ jq '.relations | length' .data/knowledge-export/*.json
29  # coding.json
5   # resi.json
20  # ui.json
---
Total: 54 relations in JSON files
```

### The Discrepancy

- **JSON Files**: 54 relations (29 + 5 + 20)
- **LevelDB**: 59 edges
- **Missing**: 5 relations are in LevelDB but NOT in JSON files

### Why This is CRITICAL

**User's Requirement**:
> "JSONs MUST ALWAYS fully reflect what's in LevelDB. If there is more content in the JSONs (can happen after a git fetch), the LevelDB must be updated immediately. LevelDB > JSON should be impossible!"

**Current State Violates This**:
- LevelDB has MORE data than JSON files
- This means 5 relations were added to LevelDB but never exported to JSON
- If user does `git fetch`, they'll get outdated JSON files
- Collaborative development will have stale data

### Root Cause Analysis

**Two possible causes**:

#### Cause 1: Manual Graph Updates Without Export

Someone used:
- GraphDB API directly
- VKB UI to add relations
- UKB commands without triggering export

**Solution**: Add auto-export hook to all graph mutations.

#### Cause 2: Export Script Not Including All Relations

The export logic may have filtering that excludes certain relations.

**Investigation needed**: Check `GraphKnowledgeImporter.js` export logic.

### Proposed Solutions

#### Solution 1: Auto-Export on Every Mutation

**Add to `GraphDatabaseService.js`**:

```javascript
async addRelation(from, to, type, team) {
  // Add relation to graph
  const result = await this._addRelationInternal(from, to, type, team);

  // CRITICAL: Auto-export to JSON after mutation
  await this.exportTeamToJSON(team);

  return result;
}
```

#### Solution 2: Validation Check on Startup

**Add to `lib/vkb-server/cli.js`**:

```javascript
async function validateDataConsistency() {
  const graphData = await graphDB.getAllRelations();
  const jsonData = await loadAllJSONFiles();

  const graphCount = graphData.length;
  const jsonCount = jsonData.length;

  if (graphCount !== jsonCount) {
    console.warn(`⚠️  DATA INCONSISTENCY DETECTED`);
    console.warn(`   GraphDB: ${graphCount} relations`);
    console.warn(`   JSON Files: ${jsonCount} relations`);
    console.warn(`   Difference: ${Math.abs(graphCount - jsonCount)} relations`);

    // Auto-repair: Export from GraphDB to JSON
    console.log(`🔧 Auto-repairing: Exporting GraphDB to JSON files...`);
    await exportGraphDBToJSON();
    console.log(`✅ Data consistency restored`);
  }
}
```

#### Solution 3: Periodic Sync Check

**Add to `scripts/knowledge-sync-monitor.js`**:

```javascript
// Run every 5 minutes
setInterval(async () => {
  const isConsistent = await checkDataConsistency();

  if (!isConsistent) {
    console.warn(`🚨 DATA DRIFT DETECTED - Auto-syncing...`);
    await syncGraphDBToJSON();
  }
}, 5 * 60 * 1000);
```

#### Solution 4: Git Pre-Commit Hook

**Add to `.husky/pre-commit`**:

```bash
#!/bin/bash

# Ensure GraphDB and JSON are in sync before commit
echo "🔍 Checking knowledge base consistency..."

if ! node scripts/validate-knowledge-consistency.js; then
  echo "❌ Knowledge base inconsistency detected"
  echo "💡 Run: node scripts/sync-graph-to-json.js"
  exit 1
fi

echo "✅ Knowledge base consistent"
```

---

## Immediate Actions Required

### Priority 1: Fix Qdrant Availability (CRITICAL)

1. ✅ Document the issue (this file)
2. ⏳ Add Docker auto-start to `launch-claude.sh`
3. ⏳ Add knowledge-base-qdrant container to `start-services.sh`
4. ⏳ Register with PSM for health monitoring
5. ⏳ Update documentation

**Estimated Time**: 2-3 hours
**Blocking**: Vector search features unavailable until fixed

### Priority 2: Fix JSON/LevelDB Sync (HIGH)

1. ✅ Document the issue (this file)
2. ⏳ Investigate which 5 relations are missing
3. ⏳ Implement auto-export on graph mutations
4. ⏳ Add validation check on startup
5. ⏳ Add periodic sync monitor

**Estimated Time**: 3-4 hours
**Blocking**: Collaborative development data integrity

### Priority 3: SQLite Schema Documentation (LOW)

1. ✅ Document the purpose (this file)
2. ⏳ Add clearer log messages
3. ⏳ Update user documentation

**Estimated Time**: 30 minutes
**Blocking**: None (working as intended)

---

## Updated System Architecture Diagram

**Proposed Enhancement to** `docs/robust-startup-system.md`:

```
┌─────────────────────────────────────────────────────────┐
│ bin/coding → launch-claude.sh                           │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 1. Check Docker Status                             │  │
│ │    ├─ Docker Running?                              │  │
│ │    │   ├─ YES → Continue                           │  │
│ │    │   └─ NO → Auto-start Docker Desktop (macOS)  │  │
│ │    └─ Timeout: 60 seconds                          │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 2. start-services.sh → start-services-robust.js   │  │
│ │                                                     │  │
│ │ Required Services:                                 │  │
│ │  ✅ Transcript Monitor                            │  │
│ │  ✅ Live Logging Coordinator                      │  │
│ │                                                     │  │
│ │ Critical Services (auto-start Docker if needed):  │  │
│ │  🐳 Docker Desktop (macOS auto-start)             │  │
│ │  📊 Knowledge Base Qdrant (port 6334)             │  │
│ │  🔒  Constraint Monitor Qdrant (port 6333)        │  │
│ │                                                     │  │
│ │ Optional Services:                                 │  │
│ │  📡 VKB Server (port 8080)                        │  │
│ │  🔍 Semantic Analysis MCP                         │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 3. Verify Monitoring Systems (mandatory)          │  │
│ │    └─ monitoring-verifier.js --strict             │  │
│ └────────────────────────────────────────────────────┘  │
│                                                          │
│ ┌────────────────────────────────────────────────────┐  │
│ │ 4. Launch Claude with MCP                         │  │
│ │    └─ claude-mcp (with all services ready)       │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Conclusion

**All three issues stem from incomplete startup orchestration**:

1. **Qdrant**: Not included in service definitions → Docker not auto-started
2. **SQLite**: Working as intended → No action needed (just documentation)
3. **JSON/LevelDB**: No sync validation → Data drift allowed to occur

**The PSM/watchdog systems can only monitor services that are actually started.** If a service is never started in the first place, no amount of health monitoring will catch it.

**Next Steps**:
1. Implement Docker auto-start
2. Add knowledge-base-qdrant service definition
3. Implement JSON/LevelDB sync validation
4. Update documentation

---

**Generated**: 2025-11-07
**Author**: Claude (Sonnet 4.5)
**Session**: coding/VKB Health Check Analysis
