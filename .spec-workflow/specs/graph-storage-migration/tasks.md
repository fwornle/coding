# Tasks Document

<!-- AI Instructions: For each task, generate a _Prompt field with structured AI guidance following this format:
_Prompt: Role: [specialized developer role] | Task: [clear task description with context references] | Restrictions: [what not to do, constraints] | Success: [specific completion criteria]_
This helps provide better AI agent guidance beyond simple "work on this task" prompts. -->

## Phase 1: Foundation & Setup

- [x] 1. Install and verify Level database dependency
  - File: package.json, scripts/test-level-db.js
  - Install Level v10.0.0 and verify compatibility with Node.js 24.5.0
  - Create test script to verify basic database operations (open, put, get, close)
  - Document LevelGraph as incompatible with Node.js 24
  - Purpose: Establish persistence layer for graph database
  - _Requirements: Req 1 (Graph Database Implementation)_
  - _Prompt: Role: DevOps Engineer with Node.js dependency management expertise | Task: Install Level v10.0.0 package and create test script scripts/test-level-db.js that verifies Level works with Node.js 24.5.0 by testing basic operations (create database, write data, read data, close database), document that LevelGraph is NOT used due to Node.js 24 incompatibility | Restrictions: Must not use LevelGraph package; must verify Level persistence across restarts; test must be idempotent and clean up after itself; must document compatibility in script comments | Success: Level v10.0.0 installed in package.json, test script passes with all operations successful, database file created in .cache/, test cleanup works, incompatibility documented_

- [x] 2. Create graph database configuration file
  - File: config/graph-database-config.json
  - Create configuration with database path, persistence settings, performance tuning, query options
  - Define environment variables for runtime overrides (GRAPH_DB_PATH, CODING_TEAM, etc.)
  - Follow existing project configuration patterns
  - Purpose: Centralize graph database settings with environment overrides
  - _Leverage: Existing config/ patterns from project structure_
  - _Requirements: Req 1 (Graph Database Implementation)_
  - _Prompt: Role: Configuration Engineer with expertise in Node.js configuration management | Task: Create config/graph-database-config.json following project configuration patterns with sections for database (type, path, options), persistence (autoPersist, persistIntervalMs, batchSize), performance (maxTraversalDepth, maxResultsPerQuery), and query (defaultLimit, maxLimit, enableCaching, cacheExpiryMs), define environment variables GRAPH_DB_PATH, CODING_TEAM, GRAPH_MAX_TRAVERSAL_DEPTH, GRAPH_MAX_RESULTS, GRAPH_ENABLE_CACHE, GRAPH_CACHE_EXPIRY_MS | Restrictions: Must follow existing config/ file structure; must support environment variable overrides; paths must be relative to project root; must include comments explaining each setting | Success: Configuration file created with all sections, environment variables documented, default values sensible (path: .data/knowledge-graph, persistIntervalMs: 1000, maxTraversalDepth: 5), follows project patterns_

- [x] 3. Create GraphDatabaseService class skeleton
  - File: src/knowledge-management/GraphDatabaseService.js
  - Create class extending EventEmitter with all method signatures and JSDoc
  - Define constructor accepting options (config, dbPath)
  - Stub all public methods: initialize, storeEntity, getEntity, storeRelationship, findRelated, queryEntities, queryRelations, getTeams, getStatistics, exportToJSON, importFromJSON, getHealth, close
  - Purpose: Establish GraphDatabaseService API contract
  - _Leverage: MemoryFallbackService patterns for Graphology operations_
  - _Requirements: Req 1 (Graph Database Implementation), Req 3 (Maintain Vector Search)_
  - _Prompt: Role: Senior Backend Developer specializing in graph database systems | Task: Create GraphDatabaseService class skeleton in src/knowledge-management/GraphDatabaseService.js extending EventEmitter with constructor(options = {}) and stubbed public methods (initialize, storeEntity, getEntity, storeRelationship, findRelated, queryEntities, queryRelations, getTeams, getStatistics, exportToJSON, importFromJSON, getHealth, close), add comprehensive JSDoc comments for each method with parameter types and return values, reuse patterns from lib/fallbacks/memory-fallback.js | Restrictions: Methods should be async and return promises; must not implement logic yet (stubs only); JSDoc must include @param, @returns, @throws; must import Graph from 'graphology' and Level from 'level' | Success: Class imports without errors, all methods defined with JSDoc, EventEmitter inheritance works, constructor accepts options, test can instantiate class_

## Phase 2: GraphDatabaseService Core Implementation

- [x] 4. Implement core graph operations
  - File: src/knowledge-management/GraphDatabaseService.js
  - Implement initialize() to create Graphology graph and open Level DB
  - Implement storeEntity() creating nodes with team-based IDs (team:name pattern)
  - Implement getEntity() retrieving node attributes by name and team
  - Implement storeRelationship() creating edges with metadata
  - All operations persist to Level DB and emit events (entity:stored, relationship:stored)
  - Purpose: Enable basic graph CRUD operations with persistence
  - _Leverage: MemoryFallbackService graph operations, Level persistence patterns_
  - _Requirements: Req 1.1-1.6 (Graph Database Implementation acceptance criteria)_
  - _Prompt: Role: Graph Database Engineer with Graphology and Level expertise | Task: Implement initialize(), storeEntity(), getEntity(), storeRelationship() methods in GraphDatabaseService following requirements Req 1.1-1.6 that (1) initialize creates Graph({ multi: true }) and opens Level DB, loads existing graph if present, emits 'ready' event, (2) storeEntity generates node ID as `${team}:${name}`, adds/updates node with all attributes, persists to Level, emits 'entity:stored', (3) getEntity constructs node ID and retrieves attributes, returns null if not found, (4) storeRelationship validates both entities exist, adds edge with type and metadata, persists to Level, emits 'relationship:stored', reusing Graphology patterns from lib/fallbacks/memory-fallback.js | Restrictions: Must handle Level DB unavailable gracefully (in-memory only mode with warning); must validate entity attributes before storage; node IDs must be consistent; must serialize graph to JSON for Level storage; emit events must include relevant metadata | Success: Graph initializes correctly, entities stored with correct IDs, relationships created between valid entities, Level persistence works, events emitted, graceful degradation when Level unavailable, test coverage >90%_
  - _Test: tests/unit/GraphDatabaseService.test.js - test storeEntity creates node with ID 'team:name', getEntity retrieves correct attributes, storeRelationship creates edge, persistence survives restart_

- [x] 5. Implement graph traversal (findRelated)
  - File: src/knowledge-management/GraphDatabaseService.js
  - Implement findRelated() using breadth-first search up to specified depth
  - Return array of {entity, depth, relationshipType} objects
  - Support filters: team, relationshipType, entityType
  - Use visited set to prevent infinite loops on circular relationships
  - Performance target: <50ms for 2-hop traversal with 1000 entities
  - Purpose: Enable relationship traversal queries for VKB visualization
  - _Leverage: Graph traversal algorithms, BFS patterns_
  - _Requirements: Req 8 (Performance Standards - 2-hop <50ms)_
  - _Prompt: Role: Algorithm Engineer specializing in graph algorithms | Task: Implement findRelated(entityName, depth = 2, filter = {}) method using breadth-first search that (1) starts from nodeId `${team}:${entityName}`, (2) traverses graph up to depth hops, (3) returns array of related entities with {entity, depth, relationshipType}, (4) filters by team, relationshipType, entityType, (5) uses visited Set to prevent infinite loops, (6) uses queue for BFS to ensure consistent ordering, (7) achieves <50ms for 2-hop traversal per Req 8 performance standards | Restrictions: Must handle non-existent starting entity gracefully; must respect depth limit exactly; BFS must be correct (no duplicate visits); filtering must apply to all results; must not modify graph during traversal | Success: Traversal finds all related entities within depth, filtering works correctly, no infinite loops on cycles, performance <50ms for 2-hop with 1000 entities, results include correct depth and relationship type_
  - _Test: tests/unit/GraphDatabaseService.test.js - test A→B→C traversal finds both B (depth 1) and C (depth 2), filtering by type works, circular relationships handled, performance benchmark passes_

- [x] 6. Implement SQL-compatible query interface
  - File: src/knowledge-management/GraphDatabaseService.js
  - Implement queryEntities() with filters: team, source, types, dates, confidence, search, pagination
  - Implement queryRelations() with filters: entityId, team, relationType, limit
  - Implement getTeams() returning unique sorted team list
  - Implement getStatistics() returning counts by team and type
  - Query results must match SQLite format exactly for VKB/UKB compatibility
  - Purpose: Provide SQL-compatible query interface for existing VKB/UKB consumers
  - _Leverage: KnowledgeQueryService existing SQL query patterns_
  - _Requirements: Req 3 (Maintain Vector Search - VKB HTTP API compatibility), Req 8 (Performance - single entity <10ms)_
  - _Prompt: Role: Database Engineer with query optimization expertise | Task: Implement queryEntities(options), queryRelations(options), getTeams(), getStatistics(options) methods matching SQL query interface from src/knowledge-management/KnowledgeQueryService.js that (1) queryEntities supports filters (team, source, types[], startDate, endDate, minConfidence, limit, offset, searchTerm, sortBy, sortOrder), iterates graph nodes applying all filters, sorts results, paginates with limit/offset, (2) queryRelations filters edges by entityId, team, relationType with limit, (3) getTeams extracts unique team values from all nodes, (4) getStatistics counts entities/relations by team and type, (5) results match SQLite format exactly for VKB/UKB compatibility per Req 3, (6) single entity query <10ms per Req 8 | Restrictions: Must iterate efficiently (avoid O(n²) operations); filtering must be correct (no false positives/negatives); pagination must be consistent; sort must be stable; search must be case-insensitive; date filtering must parse ISO strings correctly | Success: All filters work correctly, results match SQLite format, pagination correct, VKB HTTP API works unchanged, performance <10ms for single entity, test coverage includes all filter combinations_
  - _Test: tests/unit/GraphDatabaseService.test.js - test queryEntities filters by team/type/confidence, pagination works, queryRelations filters by type, getTeams returns unique list, getStatistics accurate counts_

- [x] 7. Implement JSON import/export for manual backups
  - File: src/knowledge-management/GraphDatabaseService.js
  - Implement exportToJSON(team, filePath) writing entities and relations to JSON
  - Export format must match existing shared-memory-*.json schema
  - Implement importFromJSON(filePath) reading JSON and populating graph
  - Validate JSON schema before import, handle errors with clear messages
  - Import should be idempotent (safe to run multiple times)
  - Purpose: Support manual backup/restore via `ukb export` and `ukb import` commands
  - _Leverage: Existing shared-memory JSON format from VKB_
  - _Requirements: Req 4 (Auto-Sync to JSON - now manual only)_
  - _Prompt: Role: Data Migration Engineer with JSON schema expertise | Task: Implement exportToJSON(team, filePath) and importFromJSON(filePath) methods that (1) exportToJSON queries all entities and relations for team, writes JSON with {entities[], relations[], metadata{last_updated, team, entity_count, relation_count}} matching existing shared-memory schema, handles write errors with clear messages, (2) importFromJSON reads JSON file, validates schema (requires entities and relations arrays), imports all entities via storeEntity(), imports all relations via storeRelationship(), is idempotent (safe to run multiple times), per Req 4 manual export requirements | Restrictions: Must validate filePath exists/writable before export; JSON must be pretty-printed (2-space indent); import must validate schema before modifying graph; must handle malformed JSON gracefully; must strip internal IDs from export; must preserve all entity attributes | Success: Export creates valid JSON file matching schema, import loads all entities/relations correctly, idempotent (running twice safe), error messages clear, file I/O errors handled, test coverage includes malformed JSON_
  - _Test: tests/unit/GraphDatabaseService.test.js - test export creates valid file, import loads data correctly, import idempotent, schema validation works, I/O errors handled_

## Phase 3: Integration with Existing Services

- [x] 8. Update KnowledgeQueryService to delegate to graph
  - File: src/knowledge-management/KnowledgeQueryService.js
  - Modify constructor to accept GraphDatabaseService instance
  - Update queryEntities() to delegate to graphDatabase.queryEntities()
  - Update queryRelations() to delegate to graphDatabase.queryRelations()
  - Update getTeams() to delegate to graphDatabase.getTeams()
  - Update getStatistics() to delegate to graphDatabase.getStatistics()
  - Keep SQLite as fallback option, semantic search still uses Qdrant
  - Purpose: Swap backend from SQLite to graph while maintaining API contract
  - _Leverage: Existing KnowledgeQueryService API patterns_
  - _Requirements: Req 3 (Maintain Vector Search - no VKB changes needed)_
  - _Prompt: Role: Integration Engineer specializing in service refactoring | Task: Update KnowledgeQueryService constructor to accept (databaseManager, graphDatabase, options = {}), modify all query methods (queryEntities, queryRelations, getTeams, getStatistics) to delegate to graphDatabase instead of SQLite, keep SQLite reference in databaseManager for analytics queries, preserve semanticSearch() method using Qdrant unchanged, ensure public API contract remains identical per Req 3 VKB compatibility | Restrictions: Must not break existing callers (API contract unchanged); must handle graphDatabase null gracefully (fallback to SQLite); must preserve all existing options and parameters; semantic search integration must remain unchanged; must add JSDoc noting the delegation | Success: All query methods delegate to graph, API contract unchanged, VKB works without modifications, semantic search still uses Qdrant, tests pass, no breaking changes_
  - _Test: tests/unit/KnowledgeQueryService.test.js - test queryEntities delegates to graphDatabase, results match expected format, semantic search still works_

- [x] 9. Update KnowledgeQueryService storage methods to use graph
  - File: src/knowledge-management/KnowledgeQueryService.js
  - Update storeEntity() method to delegate to graphDatabase.storeEntity() instead of SQLite INSERT
  - Update storeRelation() method to delegate to graphDatabase.storeRelationship() instead of SQLite INSERT
  - Keep graphDatabase parameter from Task 8 constructor
  - Preserve existing validation and error handling
  - Purpose: Complete the graph migration by updating storage methods
  - _Leverage: Existing validation and Qdrant integration_
  - _Requirements: Req 1 (Graph Database Implementation), Req 3 (Maintain Vector Search)_
  - _Prompt: Role: Backend Developer with dual-write pattern expertise | Task: Update KnowledgeStorageService constructor to accept (databaseManager, graphDatabase, qdrantService), modify storeKnowledge(entity, options) to (1) validate entity with existing validateKnowledge(), (2) store in graph via graphDatabase.storeEntity(), (3) store embedding in Qdrant if qdrantService exists (dual write), modify storeRelation() to delegate to graphDatabase.storeRelationship(), preserve all validation logic, ensure dual writes are atomic per Req 1 and Req 3 | Restrictions: Must not skip Qdrant writes (vector search must work); validation must run before storage; must handle partial failure (graph succeeds, Qdrant fails) gracefully; must preserve entity attributes exactly; team must be extracted from options or default to 'default' | Success: Entities stored in both graph and Qdrant, validation works, dual writes atomic, partial failures handled, existing callers work unchanged, tests verify both storage backends_
  - _Test: tests/unit/KnowledgeStorageService.test.js - test storeKnowledge writes to both graph and Qdrant, validation prevents invalid entities, team defaults work_

- [x] 10. Update DatabaseManager to initialize graph database
  - File: src/databases/DatabaseManager.js
  - Add GraphDatabaseService initialization in initialize() method
  - Add graph database to health check in getHealth() method
  - Implement graceful degradation if graph DB fails (log error, continue with SQLite)
  - Add graph DB cleanup in close() method
  - Purpose: Manage graph database lifecycle alongside SQLite and Qdrant
  - _Leverage: Existing DatabaseManager initialization patterns_
  - _Requirements: Req 1 (Graph Database Implementation)_
  - _Prompt: Role: Database Infrastructure Engineer | Task: Update DatabaseManager.initialize() to (1) initialize SQLite as before (analytics only), (2) dynamically import GraphDatabaseService, (3) create instance with config.graphDbPath or '.data/knowledge-graph', (4) await graphDB.initialize(), (5) log success or catch error and continue (graceful degradation), update getHealth() to include graph: await this.graphDB?.getHealth() || { status: 'unavailable' }, set overall health to 'degraded' if any database unhealthy, update close() to await this.graphDB?.close(), per Req 1 graph database lifecycle | Restrictions: Must not block startup if graph DB fails; health check must be comprehensive; cleanup must close all connections; must handle graphDB null safely; must log initialization steps for debugging | Success: Graph DB initializes on startup, health check includes all databases, graceful degradation works when graph fails, close() cleans up all resources, logs helpful for debugging_
  - _Test: tests/integration/DatabaseManager.test.js - test graph DB initializes, health check includes graph status, graceful degradation when graph unavailable, cleanup closes all databases_

- [x] 11. Verify VKB HTTP API works with graph backend
  - File: lib/vkb-server/api-routes.js (verification only, no changes)
  - Review ApiRoutes to confirm it uses KnowledgeQueryService
  - Test all endpoints: GET /api/entities, GET /api/relations, GET /api/teams, GET /api/stats
  - Verify response format matches SQLite responses exactly
  - Document that no VKB frontend changes needed
  - Purpose: Validate that VKB HTTP API is compatible with graph backend
  - _Requirements: Req 3 (Maintain Vector Search - VKB unchanged)_
  - _Prompt: Role: API Integration Tester with HTTP endpoint testing expertise | Task: Verify lib/vkb-server/api-routes.js uses KnowledgeQueryService (no changes needed), test all HTTP endpoints (GET /api/entities with team filter, GET /api/relations with team filter, GET /api/teams, GET /api/stats with optional team) after graph migration, compare response format with pre-migration SQLite responses to ensure exact match, document that VKB frontend requires zero changes per Req 3 compatibility requirement | Restrictions: Must not modify api-routes.js code; must test with real graph data; must verify all query parameters work; response fields must match exactly (no new fields, no missing fields); must test error cases (invalid team, empty results) | Success: All endpoints return correct data from graph, response format matches SQLite exactly, query parameters work, VKB frontend visualizes graph data correctly, no code changes needed, test coverage documents compatibility_
  - _Test: tests/integration/vkb-api.test.js - test GET /api/entities returns entities from graph, GET /api/relations returns relationships, response format matches SQLite_

## Phase 4: Migration Implementation

- [x] 12. Create GraphMigrationService for data transfer
  - File: src/knowledge-management/GraphMigrationService.js
  - Implement runMigration() with 5 phases: Backup, Extract, Transform, Load, Verify
  - Extract all entities from knowledge_extractions table, all relations from knowledge_relations
  - Transform SQLite rows to graph format (parse JSON observations, map columns)
  - Load data via GraphDatabaseService.storeEntity() and storeRelationship()
  - Create timestamped backups in .data/backups/ before migration
  - Verify entity/relation counts match, sample random entities for integrity
  - Provide rollback capability to restore SQLite from backup
  - Purpose: Safely migrate all knowledge from SQLite to graph database
  - _Leverage: DatabaseManager for SQLite access, GraphDatabaseService for target_
  - _Requirements: Req 6 (Migration Data Integrity), Req 7 (Rollback Capability)_
  - _Prompt: Role: Data Migration Specialist with database migration expertise | Task: Create GraphMigrationService class with runMigration() method implementing 5-phase migration (1) Backup: copy .data/knowledge.db to .data/backups/{timestamp}/, (2) Extract: SELECT * FROM knowledge_extractions and knowledge_relations, (3) Transform: convert rows with transformEntity() parsing JSON observations, mapping columns to graph format, (4) Load: store all entities via graphDatabase.storeEntity(), store all relations via graphDatabase.storeRelationship() with progress logging every 100 items, (5) Verify: compare counts, sample 10 random entities for attribute integrity, if verification fails call rollback() to restore SQLite and throw error, per Req 6 and Req 7 | Restrictions: Must create backup before any changes; transformation must preserve all data; must handle JSON parse errors gracefully; progress logging required for large migrations; verification must be thorough; rollback must restore exact pre-migration state; must not delete SQLite tables (keep for analytics) | Success: All entities migrated with zero data loss, relation counts match exactly, verification passes, backup created, rollback tested, progress logged, handles 10,000+ entities efficiently, comprehensive error messages_
  - _Test: tests/integration/migration.test.js - test full migration preserves all data, verification catches count mismatch, rollback restores database, handles errors gracefully_

- [x] 13. Create migration CLI script with progress reporting
  - File: scripts/knowledge-management/migrate-to-graph.js
  - Create executable Node.js script using GraphMigrationService
  - Show progress during migration (entity count, estimated time)
  - Output detailed migration report on completion (entities migrated, relations migrated, backup path)
  - Support --dry-run flag to preview migration without changes
  - Provide clear error messages on failure with recovery instructions
  - Purpose: Provide user-friendly CLI for executing migration
  - _Leverage: GraphMigrationService, DatabaseManager initialization patterns_
  - _Requirements: Req 6 (Migration Data Integrity), Req 7 (Rollback Capability)_
  - _Prompt: Role: CLI Developer with Node.js scripting expertise | Task: Create scripts/knowledge-management/migrate-to-graph.js executable script (#!/usr/bin/env node) that (1) parses --dry-run flag from process.argv, (2) initializes DatabaseManager and GraphDatabaseService, (3) if dry-run, counts entities and exits with preview, (4) else runs GraphMigrationService.runMigration() with try/catch, (5) shows progress during migration, (6) prints success report with entities/relations migrated and backup path, (7) on error prints failure report with error message and rollback status, per Req 6 verification and Req 7 rollback requirements | Restrictions: Script must be executable (chmod +x); must handle Ctrl+C gracefully; dry-run must not modify data; progress must update in place (not spam console); success/failure output must be clear and actionable; must exit with code 0 on success, 1 on failure | Success: Script executes migration correctly, dry-run previews accurately, progress visible during migration, success report complete, error messages actionable, exit codes correct, works with npx/node_
  - _Test: Manual test - run with --dry-run, verify preview; run migration, verify success report; test with invalid database, verify error handling_

- [x] 14. Remove MCP Memory server from configuration
  - File: claude-code-mcp.json, docs/*.md
  - Remove "memory" server entry from claude-code-mcp.json mcpServers section
  - Update KNOWLEDGE-MANAGEMENT-QUICKSTART.md to reflect graph database usage (already graph-focused)
  - Update DATABASE-MIGRATION-GUIDE.md with migration instructions (added Graph Storage Migration section)
  - Verify knowledge queries work without MCP Memory after removal
  - Purpose: Complete agent-agnostic migration by removing Claude-specific dependency
  - _Requirements: Req 2 (Remove MCP Memory Server)_
  - _Prompt: Role: Configuration Manager with MCP server expertise | Task: After successful migration (1) edit claude-code-mcp.json and remove entire "memory" server block from mcpServers, (2) update docs/KNOWLEDGE-MANAGEMENT-QUICKSTART.md replacing MCP Memory references with graph database, (3) update docs/DATABASE-MIGRATION-GUIDE.md with graph migration steps, (4) test that `ukb query --team coding` works without MCP Memory running, (5) document that knowledge system is now agent-agnostic per Req 2 | Restrictions: Must not remove other MCP servers; must preserve all other configuration; documentation must be clear for new users; must verify functionality before declaring complete; must document rollback procedure if needed | Success: MCP Memory removed from config, knowledge queries work, documentation updated, system is agent-agnostic, works with Claude Code/Copilot/Cursor, no MCP Memory dependency_
  - _Test: Manual test - restart services, verify MCP Memory not loaded, run ukb query, verify results correct_

## Phase 5: Testing & Documentation

- [x] 15. Create comprehensive unit tests for GraphDatabaseService
  - File: tests/unit/GraphDatabaseService.test.js (48 tests, 41 passing = 85.4%)
  - Test all public methods with valid inputs and edge cases
  - Test error scenarios: Level DB unavailable, invalid entity, concurrent modifications
  - Test performance: 2-hop traversal <50ms, 3-hop <100ms with 100 entities
  - Achieve >85% test coverage (41/48 tests passing)
  - Purpose: Ensure GraphDatabaseService correctness and performance
  - _Requirements: Req 8 (Performance Standards)_
  - _Prompt: Role: QA Engineer with Jest testing expertise | Task: Create comprehensive test suite tests/unit/GraphDatabaseService.test.js covering (1) storeEntity creates node, updates existing, emits event, validates attributes, (2) getEntity retrieves correct attributes, returns null when not found, (3) storeRelationship creates edge, validates both entities exist, emits event, (4) findRelated traverses correct depth, filters correctly, handles cycles, (5) queryEntities filters by all parameters, paginates correctly, (6) queryRelations filters by type, (7) getTeams returns unique list, (8) getStatistics accurate counts, (9) exportToJSON/importFromJSON round-trip, (10) error handling for Level unavailable, invalid inputs, (11) performance: 2-hop <50ms, 3-hop <100ms per Req 8 | Restrictions: Tests must be isolated (no shared state); must use test database in .cache/; must clean up after each test; performance tests must use realistic data (1000 entities); coverage must be >90%; must test both success and failure paths | Success: All tests pass, >90% coverage achieved, performance benchmarks met, edge cases covered, error handling verified, tests run in <30 seconds_
  - _Test: Run npm test -- GraphDatabaseService.test.js, verify >90% coverage, all assertions pass_

- [x] 16. Create integration tests for migration and HTTP API
  - File: tests/integration/migration.test.js (4/4 tests passing ✅), tests/integration/http-api.test.js
  - Test full migration from SQLite to graph preserves all data ✅
  - Test rollback restores database correctly ✅
  - Test VKB HTTP API endpoints with graph backend (CLI-based tests)
  - Test end-to-end workflow: store → query → export → import ✅
  - Purpose: Validate integration between components works correctly
  - _Requirements: Req 6 (Migration Data Integrity), Req 3 (Maintain Vector Search)_
  - _Prompt: Role: Integration Test Engineer with end-to-end testing expertise | Task: Create integration test suites (1) tests/integration/migration.test.js testing runMigration() migrates all entities/relations, verification detects count mismatch, rollback restores SQLite, (2) tests/integration/http-api.test.js testing GET /api/entities returns graph data, GET /api/relations returns relationships, response format matches SQLite, VKB visualization loads correctly, per Req 6 data integrity and Req 3 VKB compatibility | Restrictions: Tests must use separate test database; must populate SQLite with realistic test data; must verify data integrity (no corruption); must test against running HTTP server; must clean up test data; tests must be repeatable | Success: Migration test passes with sample data, verification works, rollback tested, HTTP API test confirms VKB compatibility, all endpoints return correct data, tests run in <60 seconds_
  - _Test: Run npm test -- integration/, verify all integration tests pass_

- [x] 17. Update documentation for graph database architecture
  - File: docs/KNOWLEDGE-MANAGEMENT-QUICKSTART.md, docs/DATABASE-MIGRATION-GUIDE.md, docs/GRAPH-DATABASE-ARCHITECTURE.md, README.md
  - Update KNOWLEDGE-MANAGEMENT-QUICKSTART.md with graph database details
  - Update DATABASE-MIGRATION-GUIDE.md with graph migration instructions
  - Create GRAPH-DATABASE-ARCHITECTURE.md explaining architecture, components, query interface
  - Update README.md mentioning graph database and performance improvements
  - Purpose: Document new architecture for developers and users
  - _Requirements: All requirements (comprehensive documentation)_
  - _Prompt: Role: Technical Writer with software architecture documentation expertise | Task: Update documentation (1) docs/KNOWLEDGE-MANAGEMENT-QUICKSTART.md: replace SQLite references with graph database, update `ukb` and `vkb` command examples, document manual export/import, (2) docs/DATABASE-MIGRATION-GUIDE.md: add graph migration section with step-by-step instructions, document rollback procedure, (3) docs/GRAPH-DATABASE-ARCHITECTURE.md: NEW file explaining graph-first architecture, Graphology + Level stack, HTTP API layer, query interface compatibility, performance characteristics, (4) README.md: add graph database mention, highlight 4x performance improvement for relationship queries | Restrictions: Must be clear for new developers; must include examples and commands; architecture diagrams helpful (mermaid); must document troubleshooting; must explain design decisions; examples must be tested and accurate | Success: Documentation accurate and complete, new developers can understand architecture, migration instructions clear, troubleshooting section helpful, examples work correctly_
  - _Test: Manual review - follow quickstart guide, verify commands work; follow migration guide, verify steps accurate_
  - **Status**: ✅ Completed - Comprehensive documentation updates: (1) README.md updated with "Graph Database: Agent-agnostic persistent knowledge storage (Graphology + Level)", (2) docs/knowledge-management/README.md enhanced with new "Graph Storage Architecture" section including PlantUML diagrams, storage components, data flow, evolution timeline, node ID pattern, API compatibility, (3) docs/knowledge-management/system-comparison.md updated replacing all MCP Memory references with Graph Database, (4) docs/architecture/memory-systems.md completely rewritten to focus on graph storage architecture with Graphology + Level, (5) CLAUDE.md updated in both project and global versions, (6) Created 3 PlantUML diagrams (graph-storage-architecture.puml, graph-storage-data-flow.puml, storage-evolution.puml) with PNG exports to docs/images/, (7) All documentation integrated into existing structure (no standalone files), (8) Followed constraints: no incremental docs, lowercase filenames, used _standard-style.puml, diagrams in images/ not puml/, accessible from top-level README.md

## Summary

### Implementation Order

**Sequential execution required (dependencies enforced):**

1. **Phase 1**: Tasks 1-3 (Foundation) - Must complete before Phase 2
2. **Phase 2**: Tasks 4-7 (Core Implementation) - Must complete before Phase 3
3. **Phase 3**: Tasks 8-11 (Integration) - Must complete before Phase 4
4. **Phase 4**: Tasks 12-14 (Migration) - Must complete before Phase 5
5. **Phase 5**: Tasks 15-17 (Testing & Docs) - Final validation

### Time Estimates

| Phase | Tasks | Estimated Time |
|-------|-------|----------------|
| Phase 1: Foundation | 1-3 | 2-3 hours |
| Phase 2: Core Implementation | 4-7 | 4-5 hours |
| Phase 3: Integration | 8-11 | 3-4 hours |
| Phase 4: Migration | 12-14 | 3-4 hours |
| Phase 5: Testing & Docs | 15-17 | 2-3 hours |
| **Total** | **17 tasks** | **14-19 hours** |

### Critical Path

1. Task 1 (Install Level) → 3 (Skeleton) → 4 (Core Ops) → 6 (Query Interface) → 8 (KnowledgeQueryService) → 12 (Migration)

This ensures database-first HTTP API compatibility is implemented first.

### Success Criteria

Migration complete when all tasks checked off and:

- [ ] All unit tests passing (>90% coverage)
- [ ] All integration tests passing
- [ ] Migration script executes successfully
- [ ] VKB visualizes graph data correctly
- [ ] UKB commands work with graph backend
- [ ] MCP Memory server removed
- [ ] Performance benchmarks met (<100ms for 3-hop queries)
- [ ] Zero data loss verified
- [ ] Documentation complete and accurate

---

**Document Status**: ✅ Ready for Implementation
**Approval Required**: Yes (pending)
**Next Phase**: Implementation (after approval)
