# Tasks Document

<!-- AI Instructions: For each task, generate a _Prompt field with structured AI guidance following this format:
_Prompt: Role: [specialized developer role] | Task: [clear task description with context references] | Restrictions: [what not to do, constraints] | Success: [specific completion criteria]_
This helps provide better AI agent guidance beyond simple "work on this task" prompts. -->

## Phase 1: Foundation - Unified Inference Engine

- [ ] 1. Create UnifiedInferenceEngine core class
  - File: src/inference/UnifiedInferenceEngine.js
  - Create the central LLM inference engine shared by all components (trajectory, knowledge extraction, etc.)
  - Implement multi-provider support (Groq, Anthropic, OpenAI, Local via Ollama/vLLM)
  - Integrate circuit breaker pattern, LRU caching, budget checking, and sensitivity routing
  - Purpose: Provide unified inference engine to prevent code duplication across components
  - _Leverage: integrations/mcp-constraint-monitor/src/engines/semantic-validator.js (multi-provider pattern, circuit breaker, caching)_
  - _Requirements: FR-1.1, FR-1.2, FR-1.3_
  - _Prompt: Role: Senior Backend Developer specializing in LLM inference systems and multi-provider orchestration | Task: Create UnifiedInferenceEngine class following requirements FR-1.1, FR-1.2, FR-1.3 that (1) supports local models via Ollama/vLLM and remote models via Groq/Anthropic/OpenAI, (2) implements circuit breaker pattern for provider failover, (3) integrates LRU caching with 40%+ hit rate, (4) routes sensitive content to local models automatically, (5) checks budget before remote inference, extending the multi-provider pattern from semantic-validator.js | Restrictions: Must not duplicate code from semantic-validator.js - extract and reuse common patterns; must support streaming responses; must handle provider-specific rate limits; must log all inference operations for cost tracking | Success: Engine successfully routes inference requests to appropriate providers, circuit breaker prevents cascading failures, caching reduces costs by 40%+, sensitive data never reaches remote APIs, budget limits are enforced_

- [ ] 2. Create BudgetTracker component
  - File: src/inference/BudgetTracker.js
  - Track LLM costs in real-time using DuckDB budget_events table
  - Enforce configurable monthly budget limits ($100/year default = $8.33/month)
  - Estimate costs before API calls and send alerts at 80% threshold
  - Purpose: Enforce budget constraints and provide cost analytics
  - _Leverage: DuckDB for temporal cost tracking, token estimation patterns_
  - _Requirements: FR-2.1, FR-2.2, FR-2.3_
  - _Prompt: Role: FinOps Engineer with expertise in cost tracking and resource management | Task: Implement BudgetTracker following requirements FR-2.1, FR-2.2, FR-2.3 that (1) tracks all LLM API costs in DuckDB budget_events table, (2) enforces configurable monthly limits ($100/year default = $8.33/month), (3) estimates costs before API calls using token counting, (4) sends alerts at 80% threshold, (5) provides cost analytics by project/provider/operation, (6) automatically triggers fallback to local models when budget exceeded | Restrictions: Must persist all cost events to DuckDB for historical analysis; must support per-developer and per-project budget limits; cost estimation must be accurate within 10%; must not block development work when budget exceeded (graceful degradation to local models) | Success: All API costs tracked with <1% error rate, budget limits enforced automatically, developers receive timely alerts, cost analytics available for optimization decisions, system automatically uses local models when budget exceeded_

- [ ] 3. Create SensitivityClassifier component
  - File: src/inference/SensitivityClassifier.js
  - Reuse LSL 5-layer classification for sensitivity detection (SessionFilter, PathClassifier, KeywordClassifier, EmbeddingClassifier, SemanticAnalyzer)
  - Support configurable sensitivity topics in .specstory/config/sensitivity-topics.json
  - Classify data as public/internal/confidential/secret and route sensitive data to local models
  - Purpose: Protect privacy by detecting sensitive data and routing to local models
  - _Leverage: scripts/enhanced-transcript-monitor.js (5-layer classification system)_
  - _Requirements: FR-3.1, FR-3.2, FR-3.3_
  - _Prompt: Role: Security Engineer with expertise in data classification and privacy protection | Task: Implement SensitivityClassifier following requirements FR-3.1, FR-3.2, FR-3.3 that (1) reuses LSL 5-layer classification system for sensitivity detection, (2) supports configurable sensitivity topics in .specstory/config/sensitivity-topics.json, (3) classifies data as public/internal/confidential/secret, (4) integrates with UnifiedInferenceEngine to route sensitive data to local models, (5) provides confidence scores for classification, extending the layer architecture from enhanced-transcript-monitor.js | Restrictions: Must not send sensitive data to remote APIs even during classification; must complete classification in <100ms for real-time use; must support custom sensitivity rules per project; false negative rate must be <1% (better to over-classify as sensitive) | Success: Sensitive data correctly classified with >99% accuracy, classification completes in <100ms, zero sensitive data leaks to remote APIs, custom rules work correctly, integrates seamlessly with inference engine_

- [ ] 4. Create provider implementations (Groq, Local, Anthropic, OpenAI)
  - File: src/inference/providers/GroqProvider.js, LocalProvider.js, AnthropicProvider.js, OpenAiProvider.js
  - Implement provider-specific adapters with consistent interface (infer, estimateCost, checkHealth)
  - Handle provider-specific authentication, rate limits, and streaming responses
  - Implement retry logic with exponential backoff and accurate cost estimation
  - Purpose: Enable multi-provider LLM inference with consistent interface
  - _Leverage: Existing API client patterns, provider SDK documentation_
  - _Requirements: FR-1.4, FR-1.5_
  - _Prompt: Role: Integration Engineer with expertise in API clients and SDK integration | Task: Create provider adapter classes following requirements FR-1.4, FR-1.5 that (1) implement consistent interface for all providers (infer, estimateCost, checkHealth), (2) handle provider-specific authentication and rate limits, (3) support streaming responses, (4) implement retry logic with exponential backoff, (5) provide accurate cost estimation per provider pricing, for Groq (llama-3.3-70b, qwen-2.5-32b), Anthropic (claude-3-haiku), OpenAI (gpt-4o-mini), and Local (Ollama/vLLM) | Restrictions: Must not hard-code API keys (use environment variables); must handle network failures gracefully; must log all API interactions for debugging; streaming must work for real-time trajectory updates | Success: All providers work correctly with consistent interface, streaming responses functional, cost estimation accurate within 5%, rate limits respected, authentication secure, retry logic prevents transient failures_

- [ ] 5. Create AgentAgnosticCache
  - File: src/caching/AgentAgnosticCache.js
  - Replace MCP Memory with agent-agnostic caching supporting file, HTTP, and MCP backends
  - Implement LRU eviction with configurable size limits and cache statistics (hit rate, size, evictions)
  - Work with any CLI-based coding agent (not just Claude)
  - Purpose: Provide universal caching solution to replace Claude-specific MCP Memory
  - _Leverage: Existing MCP Memory patterns, LRU cache implementation_
  - _Requirements: FR-4.1, FR-4.2_
  - _Prompt: Role: Cache Architect specializing in distributed caching and multi-backend systems | Task: Implement AgentAgnosticCache following requirements FR-4.1, FR-4.2 that (1) supports file-based caching for non-MCP agents, (2) supports HTTP API caching for remote agents, (3) supports MCP caching for Claude Code, (4) implements LRU eviction with configurable size limits, (5) provides cache statistics (hit rate, size, evictions), (6) works with any CLI-based coding agent (not just Claude), extending the caching patterns from MCP Memory but with multi-backend support | Restrictions: Must not depend on Claude-specific features; cache must be thread-safe for concurrent access; must handle cache corruption gracefully; cache keys must be deterministic and collision-free | Success: Cache works correctly with Claude, CoPilot, and other CLI agents; hit rate >40%; cache operations complete in <10ms; statistics accurate; no data corruption; seamless backend switching_

## Phase 2: Database Infrastructure

- [ ] 6. Create DatabaseManager for Qdrant + DuckDB
  - File: src/databases/DatabaseManager.js
  - Unified interface for managing both Qdrant (vectors) and DuckDB (temporal/analytics)
  - Handle connection pooling, health checks, and graceful degradation if databases unavailable
  - Provide query interfaces for both semantic search (Qdrant) and temporal queries (DuckDB)
  - Purpose: Manage dual database architecture with unified interface
  - _Leverage: integrations/mcp-constraint-monitor/src/databases/qdrant-client.js_
  - _Requirements: FR-5.1, FR-5.2_
  - _Prompt: Role: Database Architect with expertise in vector databases and analytical databases | Task: Create DatabaseManager following requirements FR-5.1, FR-5.2 that (1) manages connections to both Qdrant and DuckDB, (2) provides unified transaction semantics across both databases, (3) handles connection pooling and health checks, (4) implements graceful degradation if databases unavailable, (5) provides query interfaces for both semantic search (Qdrant) and temporal queries (DuckDB), extending the Qdrant client patterns but adding DuckDB integration | Restrictions: Must handle database failures without blocking development; must support read replicas for scaling; must implement connection retry logic; must clean up connections on shutdown | Success: Both databases managed correctly with unified interface, transactions work across databases, health checks detect issues promptly, graceful degradation works, connection pooling improves performance_

- [ ] 7. Create Qdrant collections with dual vector sizes
  - File: src/databases/QdrantCollectionManager.js
  - Create knowledge_concepts collection (1024-dim for accuracy), code_patterns (384-dim for speed), trajectory_intents (384-dim)
  - Configure HNSW indexing (m=16, ef_construct=100) and int8 quantization for memory efficiency
  - Provide methods for upserting, searching, and managing collections
  - Purpose: Create vector collections optimized for different use cases (accuracy vs speed)
  - _Leverage: Existing Qdrant configuration (384-dim, HNSW, int8 quantization)_
  - _Requirements: FR-5.3, FR-5.4_
  - _Prompt: Role: Vector Database Engineer with expertise in Qdrant and embedding optimization | Task: Implement QdrantCollectionManager following requirements FR-5.3, FR-5.4 that (1) creates knowledge_concepts collection with 1024-dim vectors for accuracy, (2) creates code_patterns collection with 384-dim vectors for speed, (3) creates trajectory_intents collection with 384-dim vectors, (4) configures HNSW indexing (m=16, ef_construct=100), (5) enables int8 quantization for memory efficiency, (6) provides methods for upserting, searching, and managing collections, extending existing Qdrant configuration but with dual vector sizes | Restrictions: Must support incremental updates without full reindex; must handle vector dimension mismatches gracefully; must implement batch upsert for efficiency; HNSW parameters must balance accuracy and speed | Success: Collections created with correct configurations, search accuracy >95% for concepts, search speed <100ms for patterns, quantization reduces memory by 4x, batch operations efficient_

- [ ] 8. Create DuckDB schema and tables
  - File: src/databases/DuckDBSchemaManager.js
  - Create knowledge_events, trajectory_history, budget_events tables with proper indexes and partitioning
  - Add indexes on timestamp and project columns for query performance
  - Implement partitioning by month for historical data and query methods for temporal analytics
  - Purpose: Create analytical database schema for temporal queries
  - _Leverage: DuckDB embedded database capabilities, existing schema patterns_
  - _Requirements: FR-5.5, FR-5.6_
  - _Prompt: Role: Data Engineer with expertise in DuckDB and time-series analytics | Task: Implement DuckDBSchemaManager following requirements FR-5.5, FR-5.6 that (1) creates knowledge_events table for tracking knowledge creation/modification/access, (2) creates trajectory_history table for session trajectory analysis, (3) creates budget_events table for cost tracking, (4) adds indexes on timestamp and project columns for query performance, (5) implements partitioning by month for historical data, (6) provides query methods for temporal analytics, using DuckDB's embedded analytical capabilities | Restrictions: Must support schema migrations for version upgrades; must handle concurrent writes safely; indexes must improve query performance by >10x; partitioning must support efficient historical queries | Success: All tables created with correct schema, indexes improve query performance >10x, concurrent writes work correctly, migrations tested, temporal queries execute in <500ms_

- [ ] 9. Create embedding generation service
  - File: src/databases/EmbeddingGenerator.js
  - Generate 384-dim embeddings using all-MiniLM-L6-v2 for speed (code patterns, trajectories)
  - Generate 1024-dim embeddings using larger model for accuracy (concepts)
  - Batch embedding generation for efficiency and run in worker threads to avoid blocking
  - Purpose: Generate embeddings for vector search with appropriate accuracy/speed tradeoff
  - _Leverage: Transformers.js library, LSL layer 3 embedding model (sentence-transformers/all-MiniLM-L6-v2)_
  - _Requirements: FR-5.7, FR-5.8_
  - _Prompt: Role: ML Engineer with expertise in transformer models and embedding generation | Task: Implement EmbeddingGenerator following requirements FR-5.7, FR-5.8 that (1) generates 384-dim embeddings using all-MiniLM-L6-v2 for speed-critical operations (code patterns, trajectories), (2) generates 1024-dim embeddings using larger model for accuracy-critical operations (concepts), (3) batches embedding generation for efficiency, (4) caches embeddings to avoid recomputation, (5) runs embedding generation in worker threads to avoid blocking, leveraging Transformers.js and LSL embedding patterns | Restrictions: Must not block main thread during generation; must handle out-of-memory errors gracefully; batch size must optimize throughput without exceeding memory; cache must use content hash for keys | Success: 384-dim embeddings generated in <50ms, 1024-dim in <200ms, batching improves throughput >5x, caching reduces redundant computation, worker threads prevent blocking_

## Phase 3: Knowledge Extraction & Management

- [ ] 10. Create StreamingKnowledgeExtractor agent
  - File: integrations/mcp-server-semantic-analysis/src/agents/StreamingKnowledgeExtractor.ts
  - Monitor live session transcripts via LSL system and extract knowledge in real-time
  - Buffer observations to reduce LLM calls (configurable buffer size, default 10 observations)
  - Extract code patterns, implementation decisions, problem-solution pairs with confidence scores
  - Purpose: Extract knowledge from live development sessions without blocking work
  - _Leverage: integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts (workflow patterns)_
  - _Requirements: FR-6.1, FR-6.2_
  - _Prompt: Role: AI/ML Engineer specializing in NLP and knowledge extraction systems | Task: Create StreamingKnowledgeExtractor agent in TypeScript following requirements FR-6.1, FR-6.2 that (1) monitors live session transcripts via LSL system, (2) buffers observations to reduce LLM calls (configurable buffer size, default 10 observations), (3) extracts code patterns, implementation decisions, and problem-solution pairs, (4) classifies observations by domain (frontend, backend, infrastructure, etc.), (5) assigns confidence scores to extractions, (6) uses UnifiedInferenceEngine for LLM analysis, extending the coordinator workflow patterns for streaming operation | Restrictions: Must not block live development session; must handle partial/incomplete transcripts; must deduplicate similar observations; confidence threshold >0.7 for storage; must respect budget limits | Success: Extracts knowledge from live sessions without blocking, buffering reduces LLM calls >80%, extractions have >90% relevance, classifications accurate >85%, confidence scores reliable, budget limits respected_

- [ ] 11. Create ConceptAbstractionAgent
  - File: integrations/mcp-server-semantic-analysis/src/agents/ConceptAbstractionAgent.ts
  - Analyze observations to identify recurring patterns and abstract into reusable concepts
  - Generate implementations list, identify tradeoffs, document common pitfalls, and link related concepts
  - Validate concepts have >3 supporting observations before creation
  - Purpose: Generalize specific observations into reusable knowledge
  - _Leverage: Existing agent patterns, concept abstraction techniques from requirements_
  - _Requirements: FR-6.3, FR-6.4_
  - _Prompt: Role: Knowledge Engineer with expertise in concept modeling and ontology design | Task: Implement ConceptAbstractionAgent in TypeScript following requirements FR-6.3, FR-6.4 that (1) analyzes observations to identify recurring patterns across sessions/projects, (2) abstracts patterns into reusable concepts with clear definitions, (3) generates implementations list (how to apply concept), (4) identifies tradeoffs (pros/cons of concept), (5) documents common pitfalls (mistakes to avoid), (6) links related concepts to build knowledge graph, (7) validates concepts have >3 supporting observations before creation, using UnifiedInferenceEngine for generalization | Restrictions: Must not create concepts from single observation; must validate concept quality before storage; must link to source observations for traceability; must support concept evolution as more observations added | Success: Concepts are well-formed and reusable, >3 observations per concept, implementations actionable, tradeoffs balanced, pitfalls accurate, related concepts linked correctly, concept quality >85%_

- [ ] 12. Create KnowledgeStorageService
  - File: src/knowledge-management/KnowledgeStorageService.js
  - Store concepts in Qdrant knowledge_concepts (1024-dim), code patterns in code_patterns (384-dim)
  - Track knowledge events in DuckDB knowledge_events table
  - Support semantic search, temporal queries, and deduplication (similarity >0.95)
  - Purpose: Persist knowledge to dual database with semantic and temporal access
  - _Leverage: DatabaseManager, QdrantCollectionManager, DuckDBSchemaManager_
  - _Requirements: FR-6.5, FR-6.6_
  - _Prompt: Role: Backend Developer with expertise in data persistence and retrieval systems | Task: Implement KnowledgeStorageService following requirements FR-6.5, FR-6.6 that (1) stores concepts in Qdrant knowledge_concepts collection with 1024-dim embeddings, (2) stores code patterns in code_patterns collection with 384-dim embeddings, (3) tracks knowledge events in DuckDB knowledge_events table, (4) supports semantic search by concept similarity, (5) supports temporal queries (recent knowledge, trending concepts), (6) implements deduplication to prevent storing similar knowledge, (7) provides batch operations for efficiency, leveraging DatabaseManager for unified access | Restrictions: Must prevent duplicate knowledge storage (similarity >0.95); must handle concurrent writes safely; must support transactional updates; must provide rollback on failure | Success: Knowledge stored correctly in both databases, semantic search returns relevant results >90%, temporal queries execute <500ms, deduplication works >95% accuracy, concurrent writes safe, transactions reliable_

- [ ] 13. Create KnowledgeDecayTracker
  - File: src/knowledge-management/KnowledgeDecayTracker.js
  - Track knowledge access patterns and calculate freshness scores (fresh <30d, aging 30-90d, stale 90-180d, deprecated >180d)
  - Adjust search ranking based on freshness and suggest knowledge for review/deprecation
  - Run decay analysis daily in background without impacting live queries
  - Purpose: Maintain knowledge quality by tracking lifecycle and freshness
  - _Leverage: DuckDB temporal queries, knowledge access patterns_
  - _Requirements: FR-6.7, FR-6.8_
  - _Prompt: Role: Data Scientist with expertise in temporal analysis and knowledge lifecycle management | Task: Implement KnowledgeDecayTracker following requirements FR-6.7, FR-6.8 that (1) tracks knowledge access patterns in DuckDB, (2) calculates freshness scores based on recency of use and creation date, (3) classifies knowledge as fresh (<30 days), aging (30-90 days), stale (90-180 days), deprecated (>180 days unused), (4) adjusts search ranking based on freshness, (5) suggests knowledge for review/deprecation, (6) runs decay analysis daily in background, using DuckDB temporal queries for efficient analysis | Restrictions: Must not delete knowledge automatically (only mark as deprecated); must consider context-specific freshness (some knowledge timeless); decay analysis must complete <5 minutes; must not impact live queries | Success: Freshness scores accurate and meaningful, classifications reflect actual knowledge lifecycle, search ranking improved by freshness weighting, deprecation suggestions reviewed and accurate >80%, background analysis efficient_

## Phase 4: Enhanced Trajectory System

- [ ] 14. Extend RealTimeTrajectoryAnalyzer with intent classification
  - File: src/live-logging/RealTimeTrajectoryAnalyzer.js (extend existing)
  - Add intent classification (learning, debugging, feature-dev, refactoring, testing) alongside existing trajectory states
  - Extract session goal from conversation context and identify active concepts being used/learned
  - Share UnifiedInferenceEngine with knowledge system (no code duplication)
  - Purpose: Enhance trajectory tracking with intent understanding
  - _Leverage: Existing trajectory analyzer, UnifiedInferenceEngine_
  - _Requirements: FR-7.1, FR-7.2_
  - _Prompt: Role: System Architect specializing in behavior analysis and intent recognition | Task: Extend RealTimeTrajectoryAnalyzer following requirements FR-7.1, FR-7.2 by (1) adding intent classification alongside existing trajectory states, (2) classifying session intent as learning/debugging/feature-dev/refactoring/testing/exploration, (3) extracting session goal from conversation context, (4) identifying active concepts being used/learned, (5) tracking intent transitions over session timeline, (6) sharing UnifiedInferenceEngine with knowledge system (no code duplication), (7) maintaining backward compatibility with existing trajectory states | Restrictions: Must not break existing trajectory functionality; must complete intent classification in <2s; must handle ambiguous intents gracefully; must persist intent history for analysis | Success: Intent classification accurate >85%, existing trajectory features still work, inference engine shared correctly, intent transitions tracked, session goals identified correctly, backward compatible_

- [ ] 15. Add concept extraction to trajectory analysis
  - File: src/live-logging/TrajectoryConceptExtractor.js
  - Monitor conversation for concept mentions and link to existing concepts via semantic search
  - Track new concepts being learned vs. existing concepts being applied
  - Provide concept context to trajectory analyzer and update concept access timestamps
  - Purpose: Connect trajectory tracking with knowledge base concepts
  - _Leverage: KnowledgeStorageService for concept lookup, UnifiedInferenceEngine_
  - _Requirements: FR-7.3, FR-7.4_
  - _Prompt: Role: Knowledge Graph Engineer with expertise in entity extraction and linking | Task: Create TrajectoryConceptExtractor following requirements FR-7.3, FR-7.4 that (1) monitors conversation for concept mentions (patterns, technologies, architectures), (2) links mentions to existing concepts in knowledge base via semantic search, (3) tracks new concepts being learned vs. existing concepts being applied, (4) provides concept context to trajectory analyzer for better state classification, (5) updates concept access timestamps for decay tracking, using KnowledgeStorageService for concept lookup and UnifiedInferenceEngine for extraction | Restrictions: Must not slow down trajectory updates (async processing acceptable); must handle concept ambiguity (multiple matches); must distinguish between casual mention vs. active use; must support concept evolution | Success: Concepts extracted with >80% accuracy, linked to knowledge base correctly, learning vs. application distinguished, trajectory context improved, concept access tracked, processing completes in <1s_

- [ ] 16. Enhance trajectory state schema
  - File: .specstory/trajectory/live-state.json (schema update)
  - Add intent, goal, concepts array, confidence score, and intent_history to schema
  - Maintain backward compatibility with existing trajectory tools
  - Support schema versioning for future updates
  - Purpose: Extend trajectory state to include intent and concept information
  - _Leverage: Existing live-state.json schema_
  - _Requirements: FR-7.5_
  - _Prompt: Role: Data Modeling Specialist with expertise in schema design and versioning | Task: Extend .specstory/trajectory/live-state.json schema following requirement FR-7.5 to (1) add intent field (learning/debugging/feature-dev/refactoring/testing/exploration), (2) add goal field (extracted session objective), (3) add concepts array (active concepts being used/learned), (4) add confidence score for trajectory classification, (5) add intent_history array for tracking intent transitions, (6) maintain backward compatibility with existing trajectory tools, (7) support schema versioning for future updates | Restrictions: Must not break existing trajectory visualization; must support gradual migration from old schema; must validate schema changes don't cause data loss; must document schema changes | Success: Schema extended correctly, backward compatible, new fields validated, migration path clear, visualization tools updated, documentation complete_

- [ ] 17. Store trajectory history in DuckDB
  - File: src/live-logging/TrajectoryHistoryService.js
  - Persist trajectory state changes to DuckDB trajectory_history table
  - Support queries for trajectory patterns across sessions and cross-session learning
  - Provide trajectory analytics (time in each state, success patterns)
  - Purpose: Enable historical trajectory analysis and cross-session learning
  - _Leverage: DuckDBSchemaManager, trajectory_history table_
  - _Requirements: FR-7.6_
  - _Prompt: Role: Data Engineer with expertise in time-series data and historical analysis | Task: Implement TrajectoryHistoryService following requirement FR-7.6 that (1) persists trajectory state changes to DuckDB trajectory_history table, (2) supports queries for trajectory patterns across sessions (common intents, typical flows), (3) enables cross-session learning (what worked before in similar contexts), (4) provides trajectory analytics (time in each state, success patterns), (5) supports efficient queries by project, session, intent, (6) implements data retention policies (archive old trajectories), using DuckDB for efficient temporal storage | Restrictions: Must not impact live trajectory updates (async persistence); must handle high write volume efficiently; must support flexible querying; must implement data archival for old sessions | Success: Trajectory history persisted correctly, queries execute <500ms, cross-session patterns identified, analytics meaningful, retention policies work, async persistence reliable_

## Phase 5: Integration & Migration

- [ ] 18. Create migration script for JSON to DuckDB/Qdrant
  - File: scripts/migrate-knowledge-to-databases.js
  - Read existing shared-memory-*.json files and transform to new schema
  - Generate embeddings for all knowledge items and load into Qdrant collections and DuckDB tables
  - Preserve entity IDs and relationships for VKB compatibility with rollback mechanism
  - Purpose: Migrate existing knowledge base without breaking VKB visualization
  - _Leverage: Existing JSON knowledge structure, DatabaseManager_
  - _Requirements: FR-8.1, FR-8.2_
  - _Prompt: Role: Database Migration Specialist with expertise in data transformation and migration | Task: Create migration script following requirements FR-8.1, FR-8.2 that (1) reads existing shared-memory-*.json files, (2) transforms knowledge to new schema (concepts, patterns, events), (3) generates embeddings for all knowledge items, (4) loads knowledge into Qdrant collections and DuckDB tables, (5) preserves entity IDs and relationships for VKB compatibility, (6) supports incremental migration (partial loads), (7) validates migration correctness (data integrity checks), (8) provides rollback mechanism if migration fails | Restrictions: Must not delete original JSON files until migration validated; must handle large JSON files efficiently; must preserve all knowledge relationships; must validate embedding quality | Success: All knowledge migrated correctly, entity IDs preserved, relationships maintained, VKB visualization works with new backend, migration reversible, data integrity validated_

- [ ] 19. Adapt VKB visualization for database backend
  - File: scripts/vkb-visualizer.js (extend existing)
  - Query knowledge from Qdrant/DuckDB instead of JSON files
  - Transform database results to VKB graph format and add freshness visualization
  - Maintain backward compatibility with existing VKB command
  - Purpose: Update VKB to work with database backend while maintaining existing features
  - _Leverage: Existing VKB visualization code, DatabaseManager_
  - _Requirements: FR-8.3_
  - _Prompt: Role: Full-stack Developer with expertise in data visualization and graph rendering | Task: Adapt VKB visualizer following requirement FR-8.3 to (1) query knowledge from Qdrant/DuckDB instead of JSON files, (2) transform database results to VKB graph format, (3) support same visualization features (node types, relationships, search), (4) add new features (freshness visualization, concept clustering), (5) maintain backward compatibility with existing VKB command, (6) optimize queries for large knowledge bases, extending existing visualization code with database backend | Restrictions: Must not break existing VKB workflows; must handle large graphs efficiently; must maintain visual consistency; queries must execute <2s for rendering | Success: VKB visualization works with new backend, all existing features functional, new features integrated, performance acceptable, backward compatible_

- [ ] 20. Create agent adapter integration tests
  - File: tests/integration/agent-adapters.test.js
  - Test knowledge system works with different coding agents (Claude, CoPilot, others)
  - Verify AgentAgnosticCache works with file/HTTP/MCP backends
  - Test graceful degradation when agent-specific features unavailable
  - Purpose: Validate agent-agnostic architecture works across different agents
  - _Leverage: Existing agent adapter patterns from docs/agent-integration-guide.md_
  - _Requirements: FR-9.1, FR-9.2_
  - _Prompt: Role: QA Engineer specializing in integration testing and multi-agent systems | Task: Create integration tests following requirements FR-9.1, FR-9.2 that (1) verify AgentAgnosticCache works with file/HTTP/MCP backends, (2) test knowledge extraction with different agent transcript formats, (3) validate trajectory tracking across different agents, (4) ensure budget tracking works regardless of agent, (5) test graceful degradation when agent-specific features unavailable, (6) simulate multi-agent scenarios (team with mixed agents), leveraging agent adapter patterns from integration guide | Restrictions: Must not require all agents installed for tests (use mocks); must test edge cases (network failures, partial transcripts); must validate cross-agent knowledge sharing; must ensure tests run in CI/CD | Success: All agent adapters tested, knowledge extraction works across agents, trajectory tracking agent-agnostic, budget enforcement universal, graceful degradation verified, tests reliable in CI/CD_

- [ ] 21. Create performance benchmarks
  - File: tests/performance/knowledge-system-benchmarks.js
  - Benchmark inference latency (<2s p95), database queries (<500ms p95), embedding speed (384-dim <50ms, 1024-dim <200ms)
  - Measure cache hit rates (>40%), budget tracking overhead (<10ms), and end-to-end pipeline performance
  - Identify performance bottlenecks and provide optimization recommendations
  - Purpose: Validate system meets performance requirements
  - _Leverage: Existing performance testing patterns_
  - _Requirements: NFR-1, NFR-2, NFR-3_
  - _Prompt: Role: Performance Engineer with expertise in benchmarking and optimization | Task: Create performance benchmarks following requirements NFR-1, NFR-2, NFR-3 that (1) measure inference latency (target <2s p95), (2) measure database query performance (target <500ms p95), (3) measure embedding generation speed (384-dim <50ms, 1024-dim <200ms), (4) measure cache hit rates (target >40%), (5) measure budget tracking overhead (<10ms), (6) measure end-to-end knowledge extraction pipeline, (7) identify performance bottlenecks and optimization opportunities | Restrictions: Must run on realistic data volumes; must measure p50, p95, p99 latencies; must test under load (concurrent operations); must provide actionable optimization recommendations | Success: Benchmarks comprehensive and realistic, performance meets requirements, bottlenecks identified, optimization recommendations actionable, benchmarks run in CI/CD_

## Phase 6: Testing & Quality Assurance

- [ ] 22. Create unit tests for UnifiedInferenceEngine
  - File: tests/unit/inference/UnifiedInferenceEngine.test.js
  - Test provider routing, circuit breaker, caching, budget enforcement, sensitivity routing, and streaming
  - Use mocked providers to isolate inference engine logic
  - Achieve >90% code coverage with fast test execution
  - Purpose: Ensure inference engine reliability
  - _Leverage: Jest testing framework, provider mocks_
  - _Requirements: All FR-1 requirements_
  - _Prompt: Role: QA Engineer with expertise in unit testing and mocking frameworks | Task: Create comprehensive unit tests for UnifiedInferenceEngine covering all FR-1 requirements, testing (1) provider routing logic (local vs. remote based on privacy/budget), (2) circuit breaker behavior (failover on provider errors), (3) caching functionality (cache hits/misses), (4) budget enforcement (blocks when exceeded), (5) sensitivity routing (sensitive data to local models), (6) streaming response handling, (7) error handling and recovery, using mocked providers to isolate inference engine logic | Restrictions: Must not make real API calls; must test all code paths; must verify error conditions; must test concurrent requests | Success: All inference engine logic tested, >90% code coverage, mocks realistic, error cases covered, concurrent scenarios tested, tests run fast (<5s)_

- [ ] 23. Create unit tests for knowledge extraction
  - File: tests/unit/knowledge-management/KnowledgeExtraction.test.ts
  - Test observation extraction, buffering, pattern detection, concept abstraction, and confidence scoring
  - Use sample transcripts and mocked LLM responses
  - Validate concept quality requirements (>3 observations) and knowledge graph integrity
  - Purpose: Ensure knowledge extraction produces quality results
  - _Leverage: TypeScript testing framework, sample transcripts_
  - _Requirements: All FR-6 requirements_
  - _Prompt: Role: QA Engineer with expertise in TypeScript testing and NLP systems | Task: Create TypeScript unit tests for knowledge extraction covering all FR-6 requirements, testing (1) observation extraction from transcripts, (2) observation buffering and batching, (3) pattern detection across observations, (4) concept abstraction logic, (5) confidence scoring, (6) deduplication, (7) knowledge graph construction, using sample transcripts and mocked LLM responses | Restrictions: Must test with realistic transcript samples; must verify concept quality requirements (>3 observations); must test edge cases (incomplete transcripts, ambiguous patterns); must validate knowledge graph integrity | Success: All extraction logic tested, concept quality validated, edge cases covered, knowledge graph integrity verified, confidence scores reliable, tests comprehensive_

- [ ] 24. Create integration tests for database operations
  - File: tests/integration/databases/DatabaseOperations.test.js
  - Test Qdrant vector search accuracy, DuckDB temporal queries, concurrent operations, and transactions
  - Use test instances of Qdrant and DuckDB with isolated test databases
  - Validate data consistency after failures and query performance under load
  - Purpose: Ensure database operations work correctly
  - _Leverage: Test databases (Qdrant in-memory, DuckDB temp file)_
  - _Requirements: All FR-5 requirements_
  - _Prompt: Role: Database QA Engineer with expertise in database testing and data integrity | Task: Create integration tests for database operations covering all FR-5 requirements, testing (1) Qdrant vector search accuracy, (2) DuckDB temporal queries, (3) concurrent read/write operations, (4) transaction semantics across databases, (5) data consistency after failures, (6) query performance under load, (7) schema migrations, using test instances of Qdrant and DuckDB | Restrictions: Must use isolated test databases; must clean up after tests; must test failure scenarios (database down, connection loss); must validate data integrity | Success: All database operations tested, search accuracy validated, concurrent operations safe, transactions reliable, failure handling works, performance acceptable, tests isolated_

- [ ] 25. Create end-to-end workflow tests
  - File: tests/e2e/knowledge-learning-workflow.test.js
  - Test complete workflow from session transcript to knowledge retrieval
  - Simulate realistic development sessions and validate user value
  - Test multi-session scenarios and cross-agent compatibility
  - Purpose: Validate complete system integration provides user value
  - _Leverage: Sample development sessions, full system integration_
  - _Requirements: All functional requirements_
  - _Prompt: Role: QA Automation Engineer with expertise in end-to-end testing and workflow validation | Task: Create E2E tests for complete knowledge learning workflow covering all functional requirements, testing (1) live session monitoring and transcript processing, (2) knowledge extraction from conversations, (3) concept abstraction and storage, (4) knowledge retrieval and search, (5) trajectory tracking with intent classification, (6) budget tracking and enforcement, (7) cross-session knowledge sharing, simulating realistic development sessions end-to-end | Restrictions: Must use realistic session scenarios; must validate end-user value (knowledge actually useful); must test multi-session scenarios; must verify cross-agent compatibility | Success: Complete workflow tested end-to-end, knowledge extraction produces useful results, retrieval finds relevant knowledge, trajectory tracking accurate, budget enforcement works, cross-session learning validated, tests reflect real usage_

## Phase 7: Documentation & Deployment

- [ ] 26. Create developer documentation
  - File: docs/knowledge-management/continuous-learning-system.md
  - Document system architecture, configuration, usage examples, and integration guide
  - Include troubleshooting guide, performance tuning, and complete API reference
  - Provide clear configuration instructions with code examples
  - Purpose: Enable developers to configure and use the system
  - _Leverage: Existing docs structure, design document_
  - _Requirements: All requirements_
  - _Prompt: Role: Technical Writer with expertise in developer documentation and system architecture | Task: Create comprehensive developer documentation covering all requirements, including (1) system architecture overview with diagrams, (2) configuration guide (budget limits, sensitivity topics, provider selection), (3) usage examples for knowledge extraction and retrieval, (4) integration guide for new coding agents, (5) troubleshooting common issues, (6) performance tuning recommendations, (7) API reference for all components, based on design document and implementation | Restrictions: Must include code examples; must provide clear configuration instructions; must explain architectural decisions; must document all APIs | Success: Documentation comprehensive and clear, developers can configure and use system, troubleshooting guide helpful, API reference complete, examples functional_

- [ ] 27. Create operator documentation
  - File: docs/operations/knowledge-system-ops.md
  - Document health monitoring, database maintenance, cost monitoring, and scaling guidelines
  - Provide disaster recovery procedures, performance tuning, and troubleshooting guides
  - Include actionable procedures with monitoring setup and backup/recovery
  - Purpose: Enable operations team to monitor and maintain system
  - _Leverage: Existing operational docs_
  - _Requirements: NFR requirements_
  - _Prompt: Role: DevOps Engineer with expertise in operational documentation and system administration | Task: Create operational documentation covering NFR requirements, including (1) system health monitoring (metrics, alerts), (2) database maintenance (backups, migrations, indexing), (3) cost monitoring and optimization, (4) scaling guidelines (when/how to scale), (5) disaster recovery procedures, (6) performance tuning, (7) troubleshooting production issues, based on operational requirements | Restrictions: Must provide actionable procedures; must include monitoring setup; must document backup/recovery; must explain scaling decisions | Success: Operations team can monitor and maintain system, health metrics tracked, backups automated, scaling procedures clear, troubleshooting effective, documentation actionable_

- [ ] 28. Create configuration templates
  - File: .specstory/config/knowledge-system.template.json, sensitivity-topics.template.json
  - Provide templates for knowledge system settings, sensitivity topics, embedding models, and decay policies
  - Include clear comments explaining each setting with reasonable defaults
  - Validate against JSON schema and provide examples for common scenarios
  - Purpose: Enable projects to customize system behavior
  - _Leverage: Design document configuration examples_
  - _Requirements: FR-10 (configurability)_
  - _Prompt: Role: Configuration Management Specialist with expertise in JSON schemas and templating | Task: Create configuration templates following requirement FR-10 for (1) knowledge system settings (budget limits, provider priorities, caching settings), (2) sensitivity topics (custom privacy rules per project), (3) embedding models (384-dim vs 1024-dim selection), (4) decay policies (freshness thresholds), (5) agent-specific settings, with clear comments explaining each setting and reasonable defaults | Restrictions: Must validate against JSON schema; must include inline documentation; must provide examples for common scenarios; must set safe defaults | Success: Templates comprehensive and documented, defaults safe and reasonable, examples clear, projects can customize easily, validation catches errors_

- [ ] 29. Create deployment checklist
  - File: docs/deployment/knowledge-system-checklist.md
  - Provide step-by-step deployment checklist with verification at each step
  - Include prerequisites, installation, migration, verification, rollback, training, and go-live criteria
  - Define clear go/no-go criteria for production deployment
  - Purpose: Ensure smooth deployment to production
  - _Leverage: Deployment best practices_
  - _Requirements: All requirements_
  - _Prompt: Role: Release Manager with expertise in deployment planning and system rollout | Task: Create deployment checklist covering all requirements, including (1) prerequisites (database setup, API keys, system requirements), (2) installation steps (dependencies, configuration, database init), (3) migration procedures (JSON to database), (4) verification steps (health checks, test queries), (5) rollback procedures if issues occur, (6) team training requirements, (7) go-live criteria, ensuring smooth deployment to production | Restrictions: Must be step-by-step with verification at each step; must include rollback plan; must define clear go/no-go criteria; must consider team readiness | Success: Deployment checklist complete and actionable, all steps verified, rollback plan tested, go-live criteria clear, teams prepared, deployments successful_

## Phase 8: Final Integration & Validation

- [ ] 30. Integrate with existing LSL system
  - File: scripts/enhanced-transcript-monitor.js (extend existing)
  - Add knowledge extraction hooks to transcript monitor
  - Trigger StreamingKnowledgeExtractor on new transcript events asynchronously
  - Provide status visibility in status line without blocking LSL processing
  - Purpose: Enable live knowledge extraction from session transcripts
  - _Leverage: Existing LSL monitoring, StreamingKnowledgeExtractor_
  - _Requirements: FR-11.1, FR-11.2_
  - _Prompt: Role: Integration Engineer with expertise in event-driven systems and real-time processing | Task: Integrate knowledge extraction into LSL pipeline following requirements FR-11.1, FR-11.2 by (1) adding knowledge extraction hooks to transcript monitor, (2) triggering StreamingKnowledgeExtractor on new transcript events, (3) ensuring knowledge extraction doesn't block LSL processing, (4) handling errors gracefully (knowledge extraction failures don't break LSL), (5) providing status visibility (knowledge extraction progress in status line), extending existing LSL monitoring system | Restrictions: Must not break existing LSL functionality; must process events asynchronously; must handle high transcript volume; must provide clear error messages | Success: Knowledge extraction integrated with LSL, processing asynchronous and non-blocking, errors handled gracefully, status visible, existing LSL features unaffected, high-volume handling validated_

- [ ] 31. Update StatusLine with knowledge system metrics
  - File: scripts/combined-status-line.js (extend existing)
  - Display knowledge extraction status, budget usage, cache hit rate, recent concepts, and trajectory intent
  - Show database health (Qdrant/DuckDB) with color-coded indicators
  - Update in real-time without cluttering display
  - Purpose: Provide visibility into knowledge system health
  - _Leverage: Existing status line system_
  - _Requirements: NFR-4 (observability)_
  - _Prompt: Role: Frontend Developer with expertise in CLI interfaces and real-time monitoring | Task: Extend status line following requirement NFR-4 to display (1) knowledge extraction status (idle/processing/error), (2) budget usage percentage for current month, (3) cache hit rate, (4) recent concepts learned, (5) trajectory intent and confidence, (6) database health (Qdrant/DuckDB status), (7) color-coded indicators for system health, extending existing status line system with knowledge metrics | Restrictions: Must not clutter status line (concise display); must update in real-time; must handle metric unavailability gracefully; must be visually consistent | Success: Status line shows knowledge system health clearly, metrics accurate and real-time, display concise and informative, color coding intuitive, consistent with existing status line_

- [ ] 32. Create acceptance test scenarios
  - File: tests/acceptance/knowledge-system-acceptance.test.js
  - Validate all user stories (US-1 through US-6) with realistic scenarios
  - Test from user perspective and verify actual user value
  - Cover all success criteria with consistent test execution
  - Purpose: Validate system meets user requirements
  - _Leverage: Requirements document user stories_
  - _Requirements: All user stories (US-1 through US-6)_
  - _Prompt: Role: Product QA Engineer with expertise in acceptance testing and user story validation | Task: Create acceptance tests validating all user stories covering (1) US-1: Tool interaction learning from repeated patterns, (2) US-2: Architecture decisions captured with context, (3) US-3: Cross-session knowledge reuse, (4) US-4: Local model deployment for sensitive data, (5) US-5: Budget tracking and cost optimization, (6) US-6: Multi-agent team knowledge sharing, simulating real user scenarios and verifying success criteria | Restrictions: Must test from user perspective (not implementation details); must validate actual user value; must cover all success criteria; must use realistic scenarios | Success: All user stories validated, success criteria met, user value demonstrated, scenarios realistic, tests pass consistently, system ready for production_

- [ ] 33. Performance optimization based on benchmarks
  - File: Multiple files based on bottlenecks identified in task 21
  - Address identified bottlenecks, tune cache configurations, optimize database queries and indexes
  - Improve embedding throughput and reduce inference latency through batching/parallelization
  - Validate optimizations meet all performance requirements
  - Purpose: Ensure system meets performance requirements
  - _Leverage: Performance benchmark results from task 21_
  - _Requirements: All NFR requirements_
  - _Prompt: Role: Performance Optimization Engineer with expertise in profiling and tuning | Task: Optimize system performance based on benchmark results from task 21 following all NFR requirements by (1) addressing identified bottlenecks (slow queries, high latency operations), (2) tuning cache configurations for higher hit rates, (3) optimizing database queries and indexes, (4) improving embedding generation throughput, (5) reducing inference latency through batching/parallelization, (6) minimizing memory usage and preventing leaks, (7) validating optimizations meet all performance requirements | Restrictions: Must not sacrifice correctness for performance; must measure improvement after each optimization; must document optimization rationale; must test performance under load | Success: All performance requirements met (inference <2s, queries <500ms, etc.), bottlenecks eliminated, optimizations validated with benchmarks, system performant under realistic load, documentation updated_

- [ ] 34. Security review and hardening
  - File: Multiple files for security improvements
  - Verify no sensitive data leaks, secure API key management, implement authentication for cache backends
  - Validate all inputs, prevent SQL injection, scan dependencies for vulnerabilities, and encrypt data
  - Ensure all privacy and security requirements met
  - Purpose: Ensure system is secure and respects privacy
  - _Leverage: Security best practices, privacy requirements_
  - _Requirements: NFR-5 (privacy and security)_
  - _Prompt: Role: Security Engineer with expertise in application security and privacy protection | Task: Conduct security review and implement hardening following requirement NFR-5 covering (1) sensitive data handling (verify no leaks to remote APIs), (2) API key management (secure storage, rotation), (3) authentication for cache backends (HTTP/MCP), (4) input validation for all user/transcript data, (5) SQL injection prevention (DuckDB queries), (6) dependency vulnerability scanning, (7) data encryption at rest/in transit, ensuring privacy and security requirements met | Restrictions: Must not break existing functionality; must validate all security controls; must document security architecture; must test security measures | Success: No sensitive data leaks validated, API keys secure, authentication enforced, inputs validated, SQL injection prevented, dependencies secure, encryption implemented, privacy requirements met_

- [ ] 35. Final system validation and sign-off
  - File: .spec-workflow/specs/continuous-learning-knowledge-system/validation-report.md
  - Create comprehensive validation report with requirements traceability and test results summary
  - Document known issues, assess deployment readiness, analyze risks, and provide go-live recommendation
  - Include sign-off checklist for stakeholders
  - Purpose: Validate system is ready for production deployment
  - _Leverage: All tests, benchmarks, and acceptance criteria_
  - _Requirements: All requirements_
  - _Prompt: Role: Quality Assurance Lead with expertise in system validation and release management | Task: Create comprehensive validation report covering all requirements, including (1) requirements traceability (all requirements implemented and tested), (2) test results summary (unit, integration, E2E, acceptance, performance), (3) known issues and limitations, (4) deployment readiness assessment, (5) risk analysis for production rollout, (6) recommendations for go-live or additional work needed, (7) sign-off checklist for stakeholders, validating system is production-ready | Restrictions: Must be objective and comprehensive; must document all test results; must identify any gaps; must provide clear go/no-go recommendation | Success: Validation report complete and accurate, all requirements traced to tests, test results documented, issues identified and triaged, deployment readiness assessed, go-live decision clear, stakeholders can make informed decision_
