# Architecture & Documentation Audit Findings

**Date**: 2025-10-22
**Auditor**: Claude Code (comprehensive codebase analysis)
**Scope**: Knowledge system architecture, data flows, and documentation accuracy

---

## Executive Summary

**Critical Finding**: Documentation claims Graph DB exports to `shared-memory-*.json` files for git persistence, but **this is false**. The Graph DB:
- ✅ **IS** persisted to `.data/knowledge-graph/` (Level database - binary format)
- ❌ **NOT** automatically exported to JSON files
- ❌ **NOT** persisted in git (Level DB is in `.gitignore`)

Additionally, `system-overview.md` describes an outdated architecture with "Unified Memory Systems" that no longer reflects reality.

---

## 1. JSON Export Investigation

### Code Analysis

**File**: `src/knowledge-management/GraphDatabaseService.js`

**Method Found**: `exportToJSON(team, filePath)` (lines 611-695)
- Purpose: Export Graph DB entities/relations to JSON in shared-memory format
- Parameters: `team` (string), `filePath` (string)
- Returns: Success object with counts and file path

**References**: ZERO production code references
- Only called in test files:
  - `scripts/test-graph-import-export.js`
  - `tests/unit/GraphDatabaseService.test.js`

**Conclusion**: JSON export exists as a feature but is **NOT automated or integrated** into any workflow.

### Actual Persistence Mechanism

**File**: `src/knowledge-management/GraphDatabaseService.js`

**Method**: `_persistGraphToLevel()` (lines 888-921)
```javascript
async _persistGraphToLevel() {
  if (!this.levelDB || this.inMemoryOnly) {
    return; // Skip if Level unavailable
  }

  // Serialize graph to JSON
  const graphData = {
    nodes: this.graph.mapNodes((node, attributes) => ({ key: node, attributes })),
    edges: this.graph.mapEdges((edge, attributes, source, target) => ({
      source, target, attributes
    })),
    metadata: {
      lastSaved: new Date().toISOString(),
      nodeCount: this.graph.order,
      edgeCount: this.graph.size
    }
  };

  // Store in Level database
  await this.levelDB.put('graph', graphData);
}
```

**Auto-persist**: Enabled via `_startAutoPersist()` - runs every 5 seconds
**Storage location**: `.data/knowledge-graph/` (binary LevelDB format)
**Git tracking**: NO - `.data/` is in `.gitignore`

---

## 2. Documentation Inaccuracies

### docs/operations/knowledge-system-ops.md

**Lines 51-72**: Service Dependencies section

**Claims**:
> **Git-tracked JSON exports**: Team collaboration via `shared-memory-*.json`

**Reality**:
- Graph DB is NOT exported to JSON automatically
- `.data/knowledge-graph/` is NOT in git
- No automatic JSON export workflow exists

**Recommendation**:
- Update notes to clarify JSON export is **manual/on-demand only**
- Explain Graph DB persistence is **local binary format**
- Add instructions for manual export if git tracking is desired

### docs/system-overview.md

**Lines 197-206**: Unified Memory Systems

**Claims**:
> Three synchronized knowledge stores:
> - **MCP Memory** - Runtime graph database (fast, volatile)
> - **Graphology** - In-process graph (local analysis)
> - **shared-memory.json** - Persistent git-tracked storage

**Reality** (as of 2025-10-22):
- ❌ MCP Memory server **removed** (no longer used)
- ✅ Graph DB (Graphology + Level) is **primary persistent storage**
- ❌ shared-memory.json is **NOT automatically updated**

**Recommendation**: Complete rewrite of this section to reflect:
- Graph DB as single source of truth
- Level DB for persistence (local, binary)
- Optional JSON export for git tracking (manual)

**Line 16**: Diagram reference

**Claims**:
> ![Unified Semantic Architecture](images/unified-semantic-architecture.png)

**Concern**: This diagram likely shows the old 11-agent system architecture, not the complete "coding" project capabilities

**Recommendation**: Create new top-level architecture diagram showing:
- All core capabilities (LSL, Constraint Monitoring, Trajectory, Knowledge Management)
- Integration points
- Storage architecture (Graph DB + Qdrant + SQLite analytics)

### docs/complete-knowledge-system-dependencies.puml

**Status**: ✅ FIXED (updated in this session)

**Changes Made**:
- Shows Graph DB as shared storage
- Both Continuous Learning and UKB/VKB write to Graph DB
- SQLite marked as "Analytics Only"
- Qdrant noted as queryable by both systems

---

## 3. Line Art Diagrams Found

**Files with ASCII/line art diagrams** (need conversion to PlantUML/Mermaid):

1. `docs/knowledge-management/README.md`
2. `docs/constraint-monitoring-system.md`
3. `docs/integrations/README.md`
4. `docs/integrations/vscode-extension.md`
5. `docs/enhanced-health-monitoring.md`
6. `docs/core-systems/constraint-monitoring.md`
7. `docs/core-systems/live-session-logging.md`
8. `docs/reference/portable-paths.md`
9. `docs/adaptive-transcript-format-detection.md`
10. `docs/obsolete-invalid/constraint-monitoring-validation.md`

**Recommendation**: Convert all to PlantUML (preferred) or Mermaid, following `docs/puml/_standard-style.puml`

---

## 4. Missing Documentation

### JSON Export Workflow

**Current State**: Feature exists but undocumented

**Needed Documentation**:
```bash
# Manual export to JSON (for git tracking)
ukb export shared-memory-coding.json --team coding

# Manual import from JSON
ukb import shared-memory-coding.json --team coding
```

**Missing**:
- UKB CLI documentation for export/import commands
- Workflow for team collaboration via JSON
- Explanation of when/why to use JSON vs Graph DB

### Graph DB Persistence

**Current State**: Works automatically but not explained

**Needed Documentation**:
- Explain `.data/knowledge-graph/` structure
- Level DB format and persistence mechanism
- Auto-persist frequency (5 seconds)
- Backup/restore procedures for Graph DB
- Migration between environments

---

## 5. System Architecture Reality Check

### What the "coding" Project Actually Is

**NOT just**: An 11-agent semantic analysis system
**NOT just**: A knowledge management tool

**ACTUALLY**: A comprehensive AI-assisted development platform with:

1. **Live Session Logging** (4-layer classification, multi-project routing)
2. **Constraint Monitoring** (18 constraints, PreToolUse enforcement, dashboard)
3. **Trajectory Generation** (light & deep analysis, living documentation)
4. **Status Line System** (4-layer health monitoring, visual feedback)
5. **Knowledge Management** (Graph DB storage, UKB/VKB tools)
6. **11-Agent Semantic Analysis** (MCP server, one component among many)
7. **Integration Hub** (Serena AST, Browser automation, VSCode extension)

### Current Documentation Gap

`system-overview.md` does mention all these systems but:
- The top diagram (`unified-semantic-architecture.png`) appears to focus on one aspect
- "Unified Memory Systems" section is outdated
- Data flow architecture is unclear
- No clear diagram showing how all components interact

---

## 6. Recommended Actions

### Priority 1: Critical Documentation Fixes

1. **Fix system-overview.md**:
   - Remove "Unified Memory Systems" section (outdated)
   - Add "Storage Architecture" section explaining Graph DB + Qdrant + SQLite
   - Create new top-level architecture diagram showing all components

2. **Fix knowledge-system-ops.md**:
   - Remove claims about automatic JSON export
   - Clarify Graph DB persistence is local binary (Level)
   - Add manual JSON export workflow documentation

3. **Update complete-knowledge-system-dependencies diagram**:
   - ✅ Already done (shows Graph DB as shared)
   - Need to verify PNG is regenerated

### Priority 2: Add Missing Documentation

4. **Document JSON Export Workflow**:
   - Add to `docs/knowledge-management/README.md`
   - Explain manual export for git tracking
   - Show import/export commands

5. **Document Graph DB Persistence**:
   - Explain Level DB storage
   - Backup/restore procedures
   - Migration between environments

### Priority 3: Convert Line Art Diagrams

6. **Replace ASCII diagrams with PlantUML**:
   - Convert 10 files identified above
   - Follow `_standard-style.puml`
   - Generate PNG files in `docs/images/`

### Priority 4: Create Comprehensive Top-Level Diagrams

7. **New Architecture Diagrams**:
   - Overall system architecture (all components)
   - Storage architecture (Graph DB + Qdrant + SQLite)
   - Data flow diagram (how knowledge flows through system)
   - Integration diagram (how external tools connect)

---

## 7. Verification Commands

To verify current state:

```bash
# Check if JSON files are being created automatically
ls -la *.json 2>/dev/null | grep shared-memory

# Check Graph DB persistence
ls -la .data/knowledge-graph/

# Search for exportToJSON usage in production code
grep -r "exportToJSON" --include="*.js" --exclude-dir=tests --exclude-dir=scripts

# Find all line art diagrams
cd docs && grep -r "^[│├└─]" --include="*.md" -l
```

---

## Conclusion

The "coding" project has evolved significantly but documentation hasn't kept pace. Key issues:

1. **False claim**: JSON files are automatically exported/git-tracked (they're not)
2. **Outdated architecture**: "Unified Memory Systems" no longer accurate
3. **Incomplete picture**: system-overview.md doesn't show full system architecture
4. **Line art diagrams**: Need conversion to PlantUML for consistency

**Impact**: Medium-High
- Developers may expect JSON files to exist (they don't)
- New users get incomplete picture of system capabilities
- Documentation doesn't match code reality

**Effort to Fix**: Medium (8-12 hours)
- Most issues are documentation updates
- Some require new PlantUML diagrams
- No code changes needed
