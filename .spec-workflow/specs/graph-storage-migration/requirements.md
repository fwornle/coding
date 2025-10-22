# Requirements Document

## Introduction

This specification addresses the migration of the knowledge management storage architecture from a SQLite-based relational model to a graph-based architecture. The current implementation suffers from **impedance mismatch** - knowledge is naturally a graph (entities with rich relationships), but SQLite forces this into tables, resulting in complex queries, poor traversal performance, and schema rigidity.

### Problem Statement

The `coding` project currently uses 6+ persistence mechanisms, creating unnecessary complexity:

1. **SQLite**: Stores knowledge entities and relationships in tables, requiring expensive JOINs for graph traversal
2. **MCP Memory server**: Anthropic's memory service creates agent lock-in (only works with Claude Code)
3. **Qdrant**: Vector search (works well, no changes needed)
4. **JSON files**: Git-tracked knowledge exports (manual process)
5. **Graphology**: In-memory graph library (underutilized)
6. **DuckDB**: Never implemented (was placeholder)

### Value Proposition

By migrating to a graph-first architecture:

- **Developer Productivity**: 10x faster knowledge queries through index-free adjacency
- **Agent Agnostic**: Remove MCP Memory dependency, enabling any AI assistant (Claude Code, Copilot, Cursor, Aider)
- **Simplified Architecture**: Reduce from 6 mechanisms to 4 well-defined systems
- **Better Data Model**: Graph structure matches the natural shape of knowledge
- **Maintainability**: Auto-sync to JSON eliminates manual export processes

## Alignment with Product Vision

This migration directly supports the core product vision:

### 1. Agent-Agnostic Design (Product Vision §1)
- **Current State**: MCP Memory server locks us into Claude Code
- **After Migration**: Direct graph database access works with any AI agent
- **Benefit**: Developers can switch between Claude Code, Copilot, Cursor without losing knowledge

### 2. Comprehensive Knowledge Management System (Product Vision §2)
- **Current State**: SQLite's relational model creates impedance mismatch for graph data
- **After Migration**: Native graph storage enables natural representation of entities and relationships
- **Benefit**: Faster queries, richer relationships, flexible schema evolution

### 3. Technical Standards (Tech Standards §2.3)
- **Configuration-Driven Architecture**: Maintains existing config patterns
- **Performance Standards**: <100ms for knowledge operations (graph databases excel here)
- **Agent-Agnostic Design Pattern**: Removes MCP-specific dependencies

### 4. Product Principle: Universal Compatibility (Product §4.2)
- **Current**: MCP Memory only works with Claude Code
- **After**: Graph database accessible from any development environment
- **Benefit**: True universal compatibility across all AI coding assistants

## Requirements

### Requirement 1: Graph Database Implementation

**User Story**: As a developer using any AI coding assistant, I want knowledge stored in a graph database so that relationship queries are fast and natural.

#### Acceptance Criteria

1. WHEN the system initializes THEN it SHALL create a Graphology graph instance with Level persistence
2. WHEN an entity is stored THEN the system SHALL create a graph node with all entity attributes
3. WHEN a relationship is stored THEN the system SHALL create a graph edge with relationship metadata
4. WHEN querying for related entities THEN the system SHALL traverse the graph using index-free adjacency
5. IF the database file doesn't exist THEN the system SHALL create it automatically
6. WHEN the graph is modified THEN the system SHALL persist changes to Level storage within 1 second

**Technical Constraints**:
- Must use Graphology (already installed: v0.25.4)
- Must use Level for persistence (v10.0.0, compatible with Node.js 24+)
- Must NOT use LevelGraph (incompatible with Node.js 24)
- Database location: `.data/knowledge-graph/`

### Requirement 2: Remove MCP Memory Server

**User Story**: As a developer who might use different AI assistants, I want the knowledge system to work without agent-specific dependencies so that I can switch tools freely.

#### Acceptance Criteria

1. WHEN the system starts THEN it SHALL NOT require MCP Memory server
2. WHEN knowledge is accessed THEN the system SHALL use the graph database directly
3. WHEN migrating THEN the system SHALL preserve all entities and relationships from MCP Memory
4. IF MCP Memory was previously used THEN the migration script SHALL extract all data
5. WHEN cleanup is complete THEN `claude-code-mcp.json` SHALL NOT contain the `memory` server entry

**Migration Path**:
- Export all data from MCP Memory before removal
- Verify data integrity after migration
- Remove MCP Memory from service configuration
- Update documentation to reflect removal

### Requirement 3: Maintain Vector Search with Qdrant

**User Story**: As a developer searching for knowledge, I want semantic search to continue working so that I can find relevant information by meaning.

#### Acceptance Criteria

1. WHEN semantic search is performed THEN Qdrant collections SHALL remain unchanged
2. WHEN an entity is stored THEN embeddings SHALL still be generated and stored in Qdrant
3. WHEN searching THEN the system SHALL return results from both graph and vector search
4. IF Qdrant is unavailable THEN the system SHALL fall back to graph-only search
5. WHEN migrating THEN all existing vectors SHALL remain accessible

**Qdrant Collections** (unchanged):
- `knowledge_patterns` (1536-dim, OpenAI embeddings)
- `knowledge_patterns_small` (384-dim, nomic-embed-text)
- `trajectory_analysis` (384-dim)
- `session_memory` (384-dim)

### Requirement 4: Auto-Sync to JSON Files

**User Story**: As a team member, I want knowledge automatically exported to JSON files so that it's version controlled and shareable.

#### Acceptance Criteria

1. WHEN a graph modification occurs THEN the system SHALL schedule a JSON export
2. WHEN multiple modifications occur within 5 seconds THEN the system SHALL batch them into one export
3. WHEN exporting THEN the system SHALL write to `shared-memory-{team}.json` files
4. WHEN export completes THEN the JSON file SHALL contain all entities and relationships for that team
5. IF export fails THEN the system SHALL retry up to 3 times with exponential backoff
6. WHEN export succeeds THEN the system SHALL emit an event for potential git auto-commit

**Export Format** (maintain compatibility):
```json
{
  "entities": [
    {
      "name": "PatternName",
      "entityType": "TechnicalPattern",
      "observations": [...],
      "significance": 8,
      "tags": ["authentication", "security"]
    }
  ],
  "relations": [
    {
      "from": "Pattern:JWT",
      "to": "Problem:StatelessAuth",
      "type": "solves",
      "confidence": 0.9
    }
  ],
  "metadata": {
    "last_updated": "2025-10-21T10:30:00Z",
    "team": "coding",
    "entity_count": 47,
    "relation_count": 123
  }
}
```

### Requirement 5: Preserve Analytics Capabilities

**User Story**: As a project manager, I want budget tracking and session analytics to continue working so that I can monitor development metrics.

#### Acceptance Criteria

1. WHEN migrating THEN SQLite SHALL retain only analytics tables (budget_events, session_metrics, embedding_cache)
2. WHEN knowledge tables are removed THEN analytics queries SHALL continue working
3. WHEN storing budget events THEN the system SHALL use SQLite as before
4. WHEN querying session metrics THEN performance SHALL be equivalent to current implementation
5. IF analytics are queried THEN response time SHALL be <50ms for standard queries

**SQLite Tables to KEEP**:
- ✅ `budget_events` (cost tracking)
- ✅ `session_metrics` (session analytics)
- ✅ `embedding_cache` (embedding reuse)

**SQLite Tables to REMOVE**:
- 🔴 `knowledge_extractions` (migrate to graph nodes)
- 🔴 `knowledge_relations` (migrate to graph edges)
- 🔴 `trajectory_history` (migrate to graph)

### Requirement 6: Migration Data Integrity

**User Story**: As a developer with existing knowledge, I want all my current knowledge preserved during migration so that I don't lose accumulated insights.

#### Acceptance Criteria

1. WHEN migration starts THEN the system SHALL export all current SQLite knowledge to backup files
2. WHEN migrating entities THEN the system SHALL preserve all attributes (name, type, observations, confidence, tags, team)
3. WHEN migrating relationships THEN the system SHALL preserve all edges with metadata
4. WHEN migration completes THEN the system SHALL verify entity count matches source count
5. IF verification fails THEN the system SHALL restore from backup and abort migration
6. WHEN verification succeeds THEN the system SHALL create a migration report with statistics

**Verification Checks**:
- Entity count: SQLite rows = Graph nodes
- Relationship count: SQLite rows = Graph edges
- Random sampling: 10 entities checked for attribute integrity
- Relationship sampling: 10 edges checked for metadata integrity

### Requirement 7: Rollback Capability

**User Story**: As a system administrator, I want the ability to rollback if migration fails so that the system remains operational.

#### Acceptance Criteria

1. WHEN migration starts THEN the system SHALL create timestamped backups of all data
2. IF migration fails THEN the system SHALL provide a rollback command
3. WHEN rollback is executed THEN the system SHALL restore SQLite from backup
4. WHEN rollback completes THEN all services SHALL use the restored SQLite database
5. IF rollback fails THEN the system SHALL provide manual recovery instructions
6. WHEN rollback succeeds THEN the system SHALL be in the exact pre-migration state

**Backup Strategy**:
- SQLite: Copy `.data/knowledge.db` → `.data/backups/knowledge.db.{timestamp}`
- JSON: Copy `shared-memory-*.json` → `.data/backups/shared-memory-*.json.{timestamp}`
- Config: Copy service configs → `.data/backups/config.{timestamp}/`

### Requirement 8: Performance Standards

**User Story**: As a developer using the knowledge system, I want fast query responses so that knowledge retrieval doesn't slow down my workflow.

#### Acceptance Criteria

1. WHEN querying a single entity THEN response time SHALL be <10ms
2. WHEN traversing 2-hop relationships THEN response time SHALL be <50ms
3. WHEN traversing 3+ hop relationships THEN response time SHALL be <100ms
4. WHEN storing an entity THEN persistence SHALL complete within 100ms
5. WHEN exporting to JSON THEN the operation SHALL complete within 500ms for <1000 entities
6. IF performance degrades THEN the system SHALL log performance metrics for analysis

**Performance Benchmarks**:
- **Current (SQLite)**: 2-hop relationship query = ~200ms (3 JOINs + recursive CTE)
- **Target (Graph)**: 2-hop relationship query = ~50ms (index-free adjacency)
- **Expected Improvement**: 4x faster for relationship queries

## Non-Functional Requirements

### Code Architecture and Modularity

#### Single Responsibility Principle
- **GraphDatabaseService**: Manages graph database operations (Graphology + Level)
- **GraphMigrationService**: Handles one-time migration from SQLite to graph
- **GraphExportService**: Auto-syncs graph to JSON files
- **KnowledgeStorageService**: Orchestrates graph + Qdrant operations (existing, will be updated)

#### Modular Design
- Graph database module is standalone and reusable
- Export service can work with any graph implementation
- Migration service is one-time use, isolated from core functionality
- All services communicate through well-defined events

#### Dependency Management
- Graphology: Already installed (v0.25.4)
- Level: Will be added (v10.0.0)
- LevelGraph: Will NOT be used (incompatibility confirmed)
- No new external dependencies beyond Level

#### Clear Interfaces
```javascript
// GraphDatabaseService interface
class GraphDatabaseService {
  async initialize()
  async storeEntity(entity, options)
  async getEntity(name, team)
  async storeRelationship(from, to, type, metadata)
  async findRelated(entityName, depth, filter)
  async exportToJSON(team)
  async getHealth()
  async close()
}
```

### Performance

**Response Time Requirements**:
- Single entity retrieval: <10ms (p95)
- 2-hop traversal: <50ms (p95)
- 3-hop traversal: <100ms (p95)
- Entity storage: <100ms (p95)
- JSON export: <500ms for <1000 entities

**Resource Usage**:
- Memory: <150MB for graph database (up from <100MB, acceptable for in-memory graph)
- Disk: Efficient binary storage via Level (estimated 2x compression vs JSON)
- CPU: <5% during normal operation, <20% during intensive queries

**Scalability**:
- Support for 10,000+ entities without degradation
- Support for 50,000+ relationships without degradation
- Graceful performance degradation beyond these limits

### Security

**Data Protection**:
- Graph database files must have appropriate file permissions (600)
- JSON exports maintain existing secret redaction patterns
- No sensitive data in graph database file names or paths

**Access Control**:
- Team-based isolation (entities scoped by team attribute)
- No cross-team data leakage
- Migration preserves team boundaries

**Audit Trail**:
- Migration creates detailed logs of all operations
- Export operations logged with timestamps
- Rollback operations fully auditable

### Reliability

**Data Integrity**:
- Graph modifications are atomic (node + persistence)
- Level provides ACID guarantees for persistence
- JSON exports maintain referential integrity (no dangling relationship references)

**Fault Tolerance**:
- Graceful degradation if Level is unavailable (in-memory only mode with warning)
- Retry logic for JSON exports (3 attempts with exponential backoff)
- Comprehensive error handling with context preservation

**Monitoring**:
- Health checks for graph database service
- Performance metrics logged for all operations
- Export success/failure rates tracked

### Usability

**Migration Process**:
- Single command migration with progress reporting
- Clear success/failure messages
- Automatic verification with detailed report
- Simple rollback command if needed

**Developer Experience**:
- Consistent API with existing KnowledgeStorageService
- Backward compatible JSON export format
- No changes required to VKB visualization
- Comprehensive logging for debugging

**Documentation**:
- Migration guide with step-by-step instructions
- Rollback procedures clearly documented
- Architecture diagrams showing before/after state
- Performance comparison benchmarks

### Compatibility

**Node.js Version**:
- Must work with Node.js 24.5.0 (current environment)
- Target compatibility: Node.js 18+
- No native dependencies beyond Level (which is well-maintained)

**Agent Agnostic**:
- Works with Claude Code (MCP integration)
- Works with GitHub Copilot (HTTP API)
- Works with Cursor (HTTP API)
- Works with Aider (direct file access)
- Works with any tool that can access Node.js modules

**Operating Systems**:
- macOS (primary development environment)
- Linux (server deployments)
- Windows (via WSL2, best effort)

### Maintainability

**Code Quality**:
- ESLint compliance with project standards
- JSDoc comments for all public methods
- Comprehensive error messages with context
- Structured logging with appropriate log levels

**Testing**:
- Unit tests for GraphDatabaseService (>90% coverage)
- Integration tests for migration process
- Performance tests validating <100ms requirement
- End-to-end tests for auto-sync functionality

**Documentation**:
- Architecture decision records (ADRs) for key choices
- API documentation for all public interfaces
- Migration runbook for operations team
- Troubleshooting guide for common issues

## Success Criteria

This specification will be considered successfully implemented when:

1. ✅ All knowledge entities are stored in graph database with full attribute preservation
2. ✅ All relationships are stored as graph edges with metadata
3. ✅ Relationship queries are 4x faster than current SQLite implementation
4. ✅ MCP Memory server is removed from configuration
5. ✅ Auto-sync to JSON files works reliably with <5s latency
6. ✅ VKB visualization works with new graph database
7. ✅ Zero knowledge loss during migration (verified by entity/relationship counts)
8. ✅ Rollback capability tested and documented
9. ✅ All acceptance criteria met
10. ✅ Performance benchmarks achieved (p95 <100ms for 3-hop queries)

## Out of Scope

The following are explicitly **not** part of this specification:

- ❌ Changes to Qdrant vector search functionality
- ❌ Modifications to VKB visualization UI
- ❌ Changes to UKB command-line interface
- ❌ Alterations to secret redaction patterns
- ❌ Changes to SQLite analytics tables (budget_events, session_metrics)
- ❌ Modifications to live session logging system
- ❌ Integration with external graph databases (Neo4j, ArangoDB)
- ❌ Graph visualization enhancements beyond current VKB capabilities

## Dependencies

**External Libraries**:
- Graphology v0.25.4 (already installed)
- Level v10.0.0 (new dependency, to be added)
- graphology-utils (already installed)

**Internal Dependencies**:
- KnowledgeStorageService (will be updated)
- DatabaseManager (will be updated)
- VKB server (no changes, reads JSON files)
- UKB command (no changes, uses KnowledgeStorageService)

**Data Dependencies**:
- Existing SQLite database: `.data/knowledge.db`
- Existing JSON files: `shared-memory-*.json`
- Qdrant collections (read-only dependency)

## Risk Mitigation

**Risk 1: Data Loss During Migration**
- **Mitigation**: Comprehensive backup before migration, verification checks, rollback capability
- **Probability**: Low (with proper testing)
- **Impact**: High

**Risk 2: Performance Degradation**
- **Mitigation**: Performance benchmarks, load testing, comparison with SQLite baseline
- **Probability**: Low (graph databases excel at relationship queries)
- **Impact**: Medium

**Risk 3: Level Compatibility Issues**
- **Mitigation**: Level v10 explicitly supports Node.js 18+, verified in testing
- **Probability**: Very Low
- **Impact**: High

**Risk 4: JSON Export Failure**
- **Mitigation**: Retry logic, error handling, manual export command as fallback
- **Probability**: Low
- **Impact**: Medium (doesn't affect core functionality)

**Risk 5: Team Resistance to New Architecture**
- **Mitigation**: Clear documentation, performance improvements, gradual rollout option
- **Probability**: Medium
- **Impact**: Low (technical benefits are clear)

---

**Document Status**: ✅ Ready for Review
**Next Phase**: Design Document (after approval)
**Estimated Implementation Time**: 12-16 hours
**Breaking Changes**: None (backward compatible JSON format, API consistency)
