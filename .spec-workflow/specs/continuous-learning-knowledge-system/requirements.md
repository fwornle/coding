# Requirements Specification
**Spec Name**: `continuous-learning-knowledge-system`
**Created**: 2025-01-18
**Status**: Draft - Awaiting Approval
**Budget Constraint**: $100/year LLM inference costs
**Team Size**: 10-50 developers per team
**Scope**: Cross-project knowledge management system hosted in "coding" project

---

## Executive Summary

Transform the knowledge management system from **batch-oriented pattern storage** into a **continuous learning and trajectory-aware system** that learns from developer activity in real-time, generalizes concepts across projects, and provides proactive recommendations while respecting privacy and budget constraints.

### Key Objectives

1. **Continuous Learning**: Extract knowledge in real-time from development sessions, not just batch processing
2. **Concept Generalization**: Move from storing specific patterns to learning transferable concepts
3. **Trajectory Awareness**: Understand developer intent (learning, debugging, building) to contextualize knowledge
4. **Cross-Project Intelligence**: Share knowledge across all projects from centralized "coding" hub
5. **Budget Compliance**: Operate within $100/year using local models + strategic remote inference
6. **Privacy-First**: Sensitive data stays local using dev container Ollama infrastructure
7. **Agent-Agnostic**: Work with any CLI-based coding agent (Claude, Copilot, etc.)

---

## 1. USER STORIES

### US-1: Real-Time Intent-Aware Knowledge Extraction
**As a** developer working in a coding session (eg. Claude Code session, CoPilot session, ...)
**I want** the system to understand my current intent (learning, debugging, feature development)
**So that** knowledge extracted is contextualized with what I was trying to accomplish

**Acceptance Criteria**:
- WHEN I start a development session, the system SHALL classify my intent in real-time
- WHEN I switch between activities (e.g., learning → implementing), the system SHALL detect the transition
- WHEN knowledge is extracted, it SHALL be tagged with intent context
- WHEN I search knowledge base, I SHALL be able to filter by intent ("show me debugging patterns")
- WHERE intent classification is uncertain, the system SHALL use conversation history for context

**EARS Notation**:
- WHEN a tool interaction occurs, the system SHALL extract micro-observations with intent tags
- WHERE privacy is detected, the system SHALL use local models for classification
- IF budget is exceeded, the system SHALL fallback to cached results or local inference

### US-2: Cross-Project Pattern Discovery
**As a** developer working across multiple projects (nano-degree, curriculum-alignment)
**I want** to discover patterns and solutions from my other projects
**So that** I don't repeat mistakes or reinvent solutions

**Acceptance Criteria**:
- WHEN I encounter a problem, the system SHALL search for similar patterns across all projects
- WHEN multiple projects use the same pattern, the system SHALL generalize it into a reusable concept
- WHEN a pattern is project-specific, it SHALL be clearly attributed
- WHERE patterns conflict, the system SHALL explain the context differences
- IF a deprecated pattern exists, the system SHALL warn and suggest alternatives

**EARS Notation**:
- WHEN searching knowledge base, the system SHALL return results from all projects
- WHERE similarity threshold is met (>0.85, configurable), the system SHALL suggest pattern reuse
- IF a newer pattern supersedes an older one, the system SHALL mark the old pattern as deprecated

### US-3: Budget-Conscious Privacy-First Operations
**As a** team lead managing infrastructure costs
**I want** to control LLM costs while keeping sensitive code local
**So that** we stay within budget without compromising security

**Acceptance Criteria**:
- WHEN monthly LLM costs approach the configurable limit (eg. $10), the system SHALL send alerts
- WHEN budget is exceeded, the system SHALL automatically use local models only
- WHEN sensitive data is detected, the system SHALL route to local models regardless of budget
- WHERE local models are unavailable, the system SHALL degrade gracefully
- IF privacy-critical code is processed, the system SHALL log which models were used

**EARS Notation**:
- WHEN estimating token costs, the system SHALL check budget before remote inference
- WHERE `privacy: 'local'` flag is set, the system SHALL use dev container Ollama
- IF sensitivity is detected via LSL classification, the system SHALL override budget routing

### US-4: Concept Generalization Across Teams
**As a** developer learning from team experience
**I want** the system to identify common patterns and generalize them
**So that** I can apply proven solutions instead of specific examples

**Acceptance Criteria**:
- WHEN similar patterns appear 3+ times, the system SHALL create a generalized concept
- WHEN a concept is created, it SHALL include: name, implementations, use cases, tradeoffs, pitfalls
- WHEN I implement a pattern, the system SHALL track its effectiveness
- WHERE a pattern frequently fails, the system SHALL downrank or deprecate it
- IF alternative patterns exist, the system SHALL present comparisons

**EARS Notation**:
- WHEN weekly generalization workflow runs, the system SHALL cluster similar observations
- WHERE embedding similarity exceeds 0.85 (configurable), the system SHALL merge observations
- IF semantic analysis is needed, the system SHALL use UnifiedInferenceEngine

### US-5: Stale Knowledge Prevention
**As a** developer
**I want** to avoid using outdated patterns and technologies
**So that** I implement current best practices, not deprecated approaches

**Acceptance Criteria**:
- WHEN knowledge hasn't been used in 90  (configurable), it SHALL be marked as "aging"
- WHEN a pattern is superseded, the system SHALL create explicit "supersedes" relationship
- WHEN I search, results SHALL show freshness indicators (fresh, aging, stale, deprecated)
- WHERE I attempt to use stale knowledge, the system SHALL warn and suggest alternatives
- IF I query historical patterns, the system SHALL support temporal queries ("what was used for auth in 2024?")

**EARS Notation**:
- WHEN monthly decay detection runs, the system SHALL update freshness scores
- WHERE last access > 90 days (configurable), the system SHALL mark knowledge as "aging"
- IF a newer pattern exists, the system SHALL link via "superseded_by" relationship

### US-6: Agent-Agnostic Compatibility
**As a** system administrator supporting multiple coding agents
**I want** the knowledge system to work with any CLI-based coding agent
**So that** teams can choose their preferred tools without losing knowledge management

**Acceptance Criteria**:
- WHEN a new agent is integrated, the knowledge system SHALL work without modification
- WHEN agents write different transcript formats, the adapter pattern SHALL normalize them
- WHEN caching is needed, the solution SHALL be agent-agnostic (not MCP-specific)
- WHERE agents have different capabilities, the system SHALL adapt gracefully
- IF an agent doesn't support transcripts, the system SHALL degrade to manual knowledge entry

**EARS Notation**:
- WHEN an agent writes transcripts, the AgentAdapter SHALL normalize to common format
- WHERE MCP Memory is unavailable, the system SHALL use generic caching layer
- IF LSL classification is needed, the system SHALL work with any transcript source

---

## 2. FUNCTIONAL REQUIREMENTS

### FR-1: Unified Inference Engine (Shared Code Architecture)
**Priority**: CRITICAL
**Component**: `src/inference/UnifiedInferenceEngine.js`

**Description**: Single inference engine shared by ALL components (trajectory, learning, recommendations) to avoid duplicate code.

**EARS Requirements**:
- WHEN any component needs LLM inference, it SHALL use UnifiedInferenceEngine
- WHERE privacy is required, the engine SHALL route to local models (Ollama or vLLM in dev containers), if configured/activated
- WHERE budget is available, the engine SHALL route to remote models (Groq, Anthropic)
- IF providers fail, the engine SHALL implement circuit breaker pattern with failover
- WHEN caching is possible, the engine SHALL cache results for 5-minute windows

**Acceptance Criteria**:
- [ ] Single `UnifiedInferenceEngine` class used by all components
- [ ] Support for local models via Ollama or vLLM (dev container integration)
- [ ] Support for remote models (Groq primary, Anthropic fallback)
- [ ] Provider selection based on:
  - [ ] Privacy flag: `privacy: 'local' | 'remote' | 'auto'`
  - [ ] Budget availability (checked via BudgetTracker)
  - [ ] Performance requirements (fast vs accurate)
- [ ] Caching layer with 5-minute TTL
- [ ] Circuit breaker for failed providers (5 failures → 1 min timeout)
- [ ] Token counting and cost tracking
- [ ] Reuses semantic-validator.js pattern (extend, don't duplicate)

**Dependencies**:
- BudgetTracker (FR-2)
- LocalModelProvider (Ollama or vLLM integration)
- GroqProvider, AnthropicProvider, OpenAiProvider

**Integration Points**:
- RealTimeTrajectoryAnalyzer (trajectory + intent)
- StreamingKnowledgeExtractor (observation extraction)
- ConceptAbstractionAgent (generalization)
- ContextRecommender (proactive suggestions)

---

### FR-2: Budget Tracking and Enforcement
**Priority**: CRITICAL
**Component**: `src/inference/BudgetTracker.js`

**Description**: Enforce $100/year/developer (configurable) budget constraint ($8.33/month/developer, configurable) with automatic fallback.

**EARS Requirements**:
- WHEN an inference request is made, the system SHALL check budget before proceeding
- WHERE estimated cost + used cost > monthly limit, the system SHALL deny remote inference
- WHERE budget is exceeded, the system SHALL fallback to local models
- IF fallback is unavailable, the system SHALL return cached results or error gracefully
- WHEN 80% of budget is consumed, the system SHALL alert administrators
- The constraint dashboard shall offer a menu which brings up a budget overview

**Acceptance Criteria**:
- [ ] Track monthly LLM costs in DuckDB `budget_events` table
- [ ] Calculate costs based on token counts: Groq (~$0.10/1M), Anthropic (~$0.25/1M)
- [ ] Enforce monthly limit ($8.33) before allowing remote inference
- [ ] Automatic fallback to local models when budget exceeded
- [ ] Alert system at 80% threshold
- [ ] Dashboard showing:
  - [ ] Current month usage ($X.XX / $8.33 / developer, configurable)
  - [ ] Projected end-of-month cost
  - [ ] Cost breakdown by operation type
  - [ ] Local vs remote inference ratio

**Cost Optimization**:
- Smart sampling (not every tool call → only significant events)
- Aggressive caching (deduplicate similar requests)
- Batch processing (group observations before inference)
- Model routing (cheap models for simple tasks, expensive for critical)

---

### FR-3: Enhanced Trajectory Understanding (Extend Existing)
**Priority**: CRITICAL
**Component**: `src/live-logging/RealTimeTrajectoryAnalyzer.js` (EXTEND, don't replace)

**Description**: Add intent classification and concept tracking to existing trajectory analysis.

**EARS Requirements**:
- WHEN a conversation exchange occurs, the system SHALL classify BOTH trajectory state AND user intent
- WHERE existing trajectory states apply (exploring, implementing, verifying), they SHALL be preserved
- WHERE new intent categories apply (learning, problem-solving, feature-dev), they SHALL be added
- IF concepts are mentioned (technologies, patterns), they SHALL be extracted and tracked
- WHEN intents change, the system SHALL maintain context chain for continuity

**Acceptance Criteria**:
- [ ] **Existing trajectory states preserved**:
  - [ ] `exploring` (🔍 EX)
  - [ ] `on_track` (📈 ON)
  - [ ] `off_track` (📉 OFF)
  - [ ] `implementing` (⚙️ IMP)
  - [ ] `verifying` (✅ VER)
  - [ ] `blocked` (🚫 BLK)
- [ ] **New intent classification added**:
  - [ ] `learning` - Exploring/understanding codebase
  - [ ] `problem-solving` - Debugging specific issue
  - [ ] `feature-development` - Implementing new functionality
  - [ ] `refactoring` - Improving existing code
  - [ ] `knowledge-sharing` - Documenting/teaching
  - [ ] `research` - Investigating technologies/approaches
- [ ] **Concept extraction**: Extract entities (JWT, React, DuckDB, etc.)
- [ ] **Goal inference**: Infer developer's goal ("Add authentication", "Fix login bug")
- [ ] **Context chain**: Track sequence of intents within session
- [ ] **Shared inference**: Use UnifiedInferenceEngine (not duplicate code)

**Storage**:
- Real-time state → `.specstory/trajectory/live-state.json` (existing)
- Historical states → DuckDB `trajectory_history` table (new)
- Embeddings → Qdrant `session_intents` collection (new)

**Enhanced State Schema**:
```json
{
  "currentState": "implementing",
  "intent": "feature-development",
  "goal": "Add JWT authentication",
  "concepts": ["JWT", "passport.js", "middleware"],
  "patterns_applied": ["middleware-pattern"],
  "learning_points": ["JWT vs sessions tradeoff"],
  "context_chain": [
    {"intent": "research", "timestamp": "2025-01-18T10:00:00Z"},
    {"intent": "feature-development", "timestamp": "2025-01-18T10:15:00Z"}
  ],
  "timestamp": "2025-01-18T10:30:00Z",
  "confidence": 0.92
}
```

---

### FR-4: Continuous Knowledge Extraction
**Priority**: HIGH
**Component**: `integrations/mcp-server-semantic-analysis/src/agents/streaming-knowledge-extractor.ts`

**Description**: Extract knowledge in real-time from tool interactions, not just batch processing.

**EARS Requirements**:
- WHEN a tool interaction occurs (Read, Edit, Grep, Write), the system SHALL extract micro-observations
- WHERE observations are related, the system SHALL buffer them for clustering
- WHERE buffer reaches threshold (10 observations OR 5 minutes, configurable), the system SHALL flush to knowledge base
- IF insights can be generated, the system SHALL create provisional insights
- WHEN privacy is detected, the system SHALL use local models for extraction

**Acceptance Criteria**:
- [ ] Subscribe to tool-interaction-hook events (existing PostToolUse hook)
- [ ] Extract micro-observations:
  - [ ] **Search patterns**: "User searched for X pattern" (from Grep/Glob)
  - [ ] **Implementation patterns**: "User implemented Y solution" (from Edit/Write)
  - [ ] **Blockers**: "User blocked on A when doing B" (from error patterns)
  - [ ] **Constraints**: "Constraint X fired, user wanted Y" (from constraint-monitor)
  - [ ] **Intent context**: Tag observations with current intent
- [ ] Buffer observations in KnowledgeStreamBuffer
- [ ] Flush triggers:
  - [ ] 10 observations accumulated, configurable
  - [ ] 5 minutes elapsed, configurable
  - [ ] Session ends
- [ ] Cluster related observations using semantic similarity
- [ ] Generate provisional insights via UnifiedInferenceEngine
- [ ] Store in databases (Qdrant + DuckDB)

**Integration Points**:
- Tool interaction hooks (existing)
- RealTimeTrajectoryAnalyzer (get current intent)
- ObservationGenerationAgent (existing, feed observations)
- DatabaseManager (Qdrant + DuckDB storage)

**Performance**:
- Async buffering (non-blocking for developer)
- Batch processing (reduce LLM calls)
- Cache frequently seen patterns

---

### FR-5: Database Architecture (Replace JSON)
**Priority**: CRITICAL
**Component**: `src/databases/DatabaseManager.js`

**Description**: Migrate from JSON files to Qdrant (vectors) + DuckDB (temporal analytics).

**EARS Requirements**:
- WHERE knowledge has embeddings, it SHALL be stored in Qdrant for semantic search
- WHERE knowledge has temporal aspects, it SHALL be stored in DuckDB for time-series queries
- WHERE real-time access is needed, caching layer SHALL serve frequently accessed data
- IF databases are unavailable, the system SHALL degrade gracefully (read-only mode)
- WHEN VKB visualization is requested, it SHALL read from databases (not JSON)

**Database Assignments**:

**Qdrant (Vector/Semantic Search)**:
- [ ] Collection: `knowledge_concepts`
  - Purpose: Generalized concept embeddings
  - Model: Larger embedding model (1024-dim for better semantic understanding)
  - Fields: concept_name, description, implementations[], use_cases[], tradeoffs[], embeddings
- [ ] Collection: `code_patterns`
  - Purpose: Specific code pattern embeddings
  - Model: 384-dim (fast, existing sentence-transformers/all-MiniLM-L6-v2)
  - Fields: pattern_name, code_snippet, project, language, embeddings
- [ ] Collection: `session_intents`
  - Purpose: Historical intent classifications
  - Model: 384-dim (fast classification)
  - Fields: session_id, intent, trajectory, concepts[], timestamp, embeddings
- [ ] Collection: `recommendations`
  - Purpose: Recommendation effectiveness tracking
  - Model: 384-dim
  - Fields: recommendation_id, was_followed, outcome, context, embeddings

**DuckDB (Temporal/Analytical Queries)**:
```sql
-- Knowledge events (all changes over time)
CREATE TABLE knowledge_events (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  event_type VARCHAR NOT NULL, -- created, modified, accessed, deprecated, superseded
  entity_id VARCHAR NOT NULL,
  entity_type VARCHAR NOT NULL, -- concept, pattern, observation, recommendation
  project VARCHAR NOT NULL,
  confidence FLOAT,
  metadata JSON -- flexible storage for event-specific data
);

-- Trajectory history (session states over time)
CREATE TABLE trajectory_history (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  session_id VARCHAR NOT NULL,
  project VARCHAR NOT NULL,
  trajectory_state VARCHAR NOT NULL,
  intent VARCHAR NOT NULL,
  concepts JSON, -- array of concepts
  goal TEXT,
  confidence FLOAT,
  metadata JSON
);

-- Budget tracking
CREATE TABLE budget_events (
  id UUID PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  operation_type VARCHAR NOT NULL,
  provider VARCHAR NOT NULL, -- groq, anthropic, local
  tokens_used INTEGER NOT NULL,
  cost_usd DECIMAL(10, 4),
  project VARCHAR,
  metadata JSON
);

-- Pattern effectiveness (success tracking)
CREATE TABLE pattern_effectiveness (
  id UUID PRIMARY KEY,
  pattern_id VARCHAR NOT NULL,
  applied_timestamp TIMESTAMP NOT NULL,
  outcome VARCHAR, -- success, failure, abandoned
  session_id VARCHAR,
  project VARCHAR,
  effectiveness_score FLOAT,
  metadata JSON
);

-- Indexes for performance
CREATE INDEX idx_knowledge_time ON knowledge_events(timestamp);
CREATE INDEX idx_knowledge_entity ON knowledge_events(entity_id);
CREATE INDEX idx_trajectory_time ON trajectory_history(timestamp);
CREATE INDEX idx_trajectory_session ON trajectory_history(session_id);
CREATE INDEX idx_budget_time ON budget_events(timestamp);
CREATE INDEX idx_budget_provider ON budget_events(provider);
CREATE INDEX idx_effectiveness_time ON pattern_effectiveness(applied_timestamp);
```

**Migration Strategy**:
- [ ] One-time bulk migration from `shared-memory-*.json` to databases
- [ ] Migration script: `scripts/migrate-json-to-databases.js`
- [ ] Validation: Compare before/after counts, spot-check samples
- [ ] VKB visualization adapted to read from Qdrant + DuckDB
- [ ] Backward compatibility during transition (dual-read for 1 month)
- [ ] Decommission JSON files after validation

**VKB Visualization Adaptation**:
- [ ] Read nodes from Qdrant (concepts, patterns)
- [ ] Read relationships from DuckDB (temporal edges)
- [ ] Read freshness scores from DuckDB (last_accessed)
- [ ] Format nodes per database schema (not JSON structure)
- [ ] Maintain visual hierarchy: Specific → Pattern → Concept → Principle

---

### FR-6: Privacy-Aware Classification (Reuse LSL 5-Layer System)
**Priority**: CRITICAL
**Component**: `src/knowledge-management/SensitivityClassifier.js`

**Description**: Reuse LSL 5-layer classification system to detect sensitive topics and route to local models.

**EARS Requirements**:
- WHEN content needs classification, the system SHALL use existing LSL classification layers
- WHERE sensitivity configuration defines sensitive topics, the system SHALL detect them
- WHERE sensitivity is detected, the system SHALL override all routing to use local models
- IF local models unavailable, the system SHALL fail-safe (no remote inference for sensitive data)
- WHEN sensitivity is detected, the system SHALL log the decision for audit

**Reuse LSL 5-Layer Classification**:

Layers (from LSL documentation):
0. **SessionFilter** (pre-filter): Session continuation detection
1. **PathClassifier**: File path-based detection
2. **KeywordClassifier**: Keyword/term matching (<10ms)
3. **EmbeddingClassifier**: Semantic similarity (384-dim, ~50ms)
4. **SemanticAnalyzer**: LLM-powered deep understanding (<10ms with caching)

**Sensitivity Adaptation**:
```javascript
// Configuration: .specstory/config/sensitivity-topics.json
{
  "sensitive_topics": [
    {
      "name": "credentials",
      "keywords": ["API_KEY", "password", "secret", "token", "credentials"],
      "paths": ["**/config/secrets/**", "**/.env"],
      "embedding_threshold": 0.75
    },
    {
      "name": "proprietary_algorithms",
      "keywords": ["proprietary", "patent", "trade secret"],
      "paths": ["**/core/algorithms/**"],
      "embedding_threshold": 0.80
    },
    {
      "name": "customer_data",
      "keywords": ["PII", "SSN", "credit card", "personal data"],
      "embedding_threshold": 0.85
    }
  ],
  "default_action": "local_only"
}
```

**Classification Process**:
1. Run PathClassifier (check file paths against sensitivity config)
2. Run KeywordClassifier (check for sensitive keywords)
3. If uncertain, run EmbeddingClassifier (semantic similarity to sensitive topics)
4. If still uncertain, run SemanticAnalyzer (LLM classification)
5. If ANY layer detects sensitivity → route to local models

**Acceptance Criteria**:
- [ ] Reuse existing LSL classification infrastructure (no duplication)
- [ ] Configuration-driven sensitivity detection
- [ ] Layer-based detection (fast → expensive progression)
- [ ] Audit logging of sensitivity decisions
- [ ] Override routing: sensitivity → local models always
- [ ] Fail-safe: no remote inference if local unavailable

---

### FR-7: Agent-Agnostic Caching (Replace MCP Memory)
**Priority**: HIGH
**Component**: `src/caching/AgentAgnosticCache.js`

**Description**: Replace MCP Memory server with generic caching solution compatible with any coding agent.

**EARS Requirements**:
- WHEN any agent needs caching, the cache SHALL work regardless of agent type
- WHERE MCP Memory was used, the new cache SHALL provide equivalent functionality
- WHERE agents don't support MCP, the cache SHALL work via file-based or HTTP API
- IF cache is unavailable, the system SHALL fallback to direct database queries
- WHEN cache is hit, the system SHALL avoid redundant LLM calls

**Acceptance Criteria**:
- [ ] **Multi-backend support**:
  - [ ] File-based cache (universal compatibility)
  - [ ] HTTP API (for programmatic access)
  - [ ] MCP protocol (for MCP-compatible agents)
- [ ] **Cache Operations**:
  - [ ] `set(key, value, ttl)` - Store with TTL
  - [ ] `get(key)` - Retrieve cached value
  - [ ] `invalidate(key)` - Force refresh
  - [ ] `search(query)` - Semantic search in cache
- [ ] **Performance**:
  - [ ] In-memory cache for hot data (LRU eviction)
  - [ ] Disk persistence for cold data
  - [ ] 5-minute default TTL (configurable)
  - [ ] Cache hit rate > 40%
- [ ] **Agent Adapters**:
  - [ ] ClaudeAdapter (MCP + file-based)
  - [ ] CopilotAdapter (HTTP API)
  - [ ] GenericAdapter (file-based fallback)

**Cache Structure**:
```javascript
{
  "cache_entries": {
    "intent_classification_{hash}": {
      "value": {"intent": "feature-development", "confidence": 0.92},
      "timestamp": "2025-01-18T10:30:00Z",
      "ttl": 300, // 5 minutes
      "hits": 12
    },
    "pattern_search_{hash}": {
      "value": [/* Qdrant results */],
      "timestamp": "2025-01-18T10:25:00Z",
      "ttl": 300,
      "hits": 3
    }
  },
  "statistics": {
    "total_requests": 1523,
    "cache_hits": 687,
    "cache_misses": 836,
    "hit_rate": 0.451
  }
}
```

**Migration from MCP Memory**:
- [ ] Identify all MCP Memory calls in current codebase
- [ ] Replace with AgentAgnosticCache calls
- [ ] Maintain backward compatibility (MCP backend still available)
- [ ] Test with multiple agent types (Claude, hypothetical others)

---

### FR-8: Concept Generalization
**Priority**: HIGH
**Component**: `integrations/mcp-server-semantic-analysis/src/agents/concept-abstraction-agent.ts`

**Description**: Generalize specific patterns into reusable concepts across projects.

**EARS Requirements**:
- WHEN similar observations occur 3+ times, the system SHALL create a generalized concept
- WHERE observations share semantic similarity >0.85, the system SHALL group them
- WHERE generalization is possible, the system SHALL use UnifiedInferenceEngine
- IF privacy is detected, the system SHALL use local models for generalization
- WHEN a concept is created, the system SHALL store in Qdrant with full context

**Acceptance Criteria**:
- [ ] Weekly batch generalization workflow
- [ ] Group similar observations using Qdrant semantic search (>0.85 similarity)
- [ ] Generate generalized concepts via LLM:
  - [ ] Concept name (e.g., "Stateless Authentication Pattern")
  - [ ] Implementations (e.g., JWT, OAuth2, SAML)
  - [ ] When to use (e.g., APIs, microservices, mobile apps)
  - [ ] Tradeoffs (e.g., stateless vs database sessions)
  - [ ] Common pitfalls (e.g., token expiration handling)
  - [ ] Related concepts (e.g., Session Management, RBAC)
- [ ] Create hierarchy in Qdrant:
  - Specific observation → Pattern → Concept → Principle
- [ ] Deduplicate using enhanced DeduplicationAgent
- [ ] Store embeddings (1024-dim for better semantic understanding)

**Example Transformation**:
```
INPUT (Observations):
- "Used JWT for API auth in nano-degree project"
- "Implemented passport.js with JWT in curriculum-alignment"
- "OAuth2 flow for third-party API in coding project"

OUTPUT (Generalized Concept):
{
  "name": "Stateless Authentication Pattern",
  "description": "Authentication approach that doesn't maintain server-side session state",
  "implementations": [
    {"name": "JWT", "use_case": "Stateless API authentication", "complexity": "low"},
    {"name": "OAuth2", "use_case": "Third-party authorization", "complexity": "medium"},
    {"name": "SAML", "use_case": "Enterprise SSO", "complexity": "high"}
  ],
  "when_to_use": [
    "Microservices architectures",
    "Mobile app backends",
    "Stateless APIs",
    "Distributed systems"
  ],
  "tradeoffs": {
    "pros": ["No server-side state", "Scales horizontally", "Language-agnostic"],
    "cons": ["Token size overhead", "Harder to invalidate", "Expiration complexity"]
  },
  "common_pitfalls": [
    "Not handling token refresh properly",
    "Storing tokens insecurely (localStorage XSS)",
    "Not validating token signatures"
  ],
  "related_concepts": ["Session Management", "RBAC", "API Security"],
  "confidence": 0.91,
  "projects": ["nano-degree", "curriculum-alignment", "coding"]
}
```

---

### FR-9: Temporal Knowledge Management
**Priority**: MEDIUM
**Component**: `src/knowledge-management/KnowledgeDecayTracker.js`

**Description**: Track knowledge freshness and prevent stale recommendations.

**EARS Requirements**:
- WHEN knowledge hasn't been accessed in 30  (configurable), the system SHALL mark it as "aging"
- WHEN knowledge hasn't been accessed in 90 days (configurable), the system SHALL mark it as "stale"
- WHERE a pattern is superseded, the system SHALL create explicit relationship
- WHERE temporal queries are made, the system SHALL use DuckDB for efficient time-series access
- IF stale knowledge is recommended, the system SHALL warn the user

**Acceptance Criteria**:
- [ ] **Freshness States**:
  - [ ] `fresh` - accessed/validated in last 30 days (configurable)
  - [ ] `aging` - not accessed in 30-90 days (configurable)
  - [ ] `stale` - not accessed in 90+ days (configurable)
  - [ ] `deprecated` - explicitly superseded by newer pattern
- [ ] **Temporal Relationships** (stored in Qdrant payload):
  - [ ] `supersedes` - pattern B replaced pattern A
  - [ ] `evolved_from` - pattern B is refined version of A
  - [ ] `valid_from` / `valid_until` - time bounds for applicability
- [ ] **Monthly Decay Detection**:
  - [ ] Query DuckDB for last access timestamps
  - [ ] Update freshness scores in Qdrant
  - [ ] Create deprecation links where applicable
- [ ] **Search Prioritization**:
  - [ ] Fresh knowledge ranked higher
  - [ ] Aging knowledge shown with warning
  - [ ] Stale knowledge requires explicit selection
  - [ ] Deprecated knowledge shows "superseded by" link
- [ ] **Temporal Queries** (DuckDB):
  ```sql
  -- What patterns were used for authentication in 2024?
  SELECT DISTINCT entity_id, metadata
  FROM knowledge_events
  WHERE entity_type = 'pattern'
    AND metadata->>'category' = 'authentication'
    AND timestamp BETWEEN '2024-01-01' AND '2024-12-31'
    AND event_type = 'created';
  ```

---

## 3. NON-FUNCTIONAL REQUIREMENTS

### NFR-1: Performance
**Priority**: HIGH

**EARS Requirements**:
- WHEN real-time operations are requested, the system SHALL respond within defined latency bounds
- WHERE performance degrades, the system SHALL log metrics for investigation
- IF performance SLAs are violated, the system SHALL alert administrators

**Acceptance Criteria**:
- [ ] **Real-Time Trajectory/Intent Classification**: < 2s (p95)
- [ ] **Knowledge Query Response**: < 500ms (p95)
- [ ] **Observation Buffering**: Async, non-blocking for developer
- [ ] **Qdrant Queries**: < 100ms (p95)
- [ ] **DuckDB Analytical Queries**: < 1s (p95)
- [ ] **Cache Hit Rate**: > 40% (reduces LLM calls)
- [ ] **LLM Inference** (cached): < 50ms
- [ ] **LLM Inference** (uncached remote): < 3s
- [ ] **LLM Inference** (uncached local): < 5s (Ollama in dev container)

**Performance Monitoring**:
- [ ] Dashboard showing p50, p95, p99 latencies
- [ ] Alerts for SLA violations
- [ ] Performance regression detection

---

### NFR-2: Scalability
**Priority**: HIGH

**EARS Requirements**:
- WHEN 10-50 developers are active, the system SHALL maintain performance
- WHERE load increases, the system SHALL scale horizontally (Qdrant clustering)
- IF concurrent requests exceed capacity, the system SHALL queue gracefully

**Acceptance Criteria**:
- [ ] **Concurrent Developer Support**: 10-50 developers per team
- [ ] **Qdrant Performance**: 100+ QPS (already optimized with HNSW + int8 quantization)
- [ ] **DuckDB Concurrency**: Support concurrent reads (analytical queries)
- [ ] **Inference Queue**: Prevent provider overload (max 10 concurrent remote calls)
- [ ] **Cache Sharing**: Distributed cache for multi-developer environments
- [ ] **Horizontal Scaling**: Qdrant clustering for future growth (>50 developers)

**Load Testing**:
- Simulate 50 concurrent developers
- Verify latency SLAs maintained
- Identify bottlenecks

---

### NFR-3: Cost Efficiency
**Priority**: CRITICAL

**EARS Requirements**:
- WHEN monthly costs approach $8.33, the system SHALL enforce strict limits
- WHERE local inference is possible, the system SHALL prefer it for cost savings
- IF budget is exceeded, the system SHALL block remote inference until next month

**Acceptance Criteria**:
- [ ] **Monthly Budget**: Strict $8.33/month/developer (configurabe) limit ($100/year/developer)
- [ ] **Token Usage**: < 2.7M tokens/day (averaged monthly)
- [ ] **Local vs Remote Ratio**: > 60% local inference
- [ ] **Smart Sampling**: Only analyze significant events (not every tool call)
- [ ] **Aggressive Caching**: 40%+ hit rate
- [ ] **Batch Processing**: Group observations to reduce LLM calls
- [ ] **Model Routing**:
  - Groq llama-3.3-70b: Trajectory, intent (~$0.10/1M tokens)
  - Groq qwen-2.5-32b: Cheap pattern extraction (~$0.05/1M tokens)
  - Local Ollama or vLLM: Privacy-critical, bulk operations (~$0/1M tokens)
  - Anthropic Haiku: Fallback only (~$0.25/1M tokens)

**Cost Reporting**:
- Monthly cost dashboard
- Projected end-of-month estimate
- Cost breakdown by operation type
- Alert at 80% threshold

---

### NFR-4: Privacy & Security
**Priority**: CRITICAL

**EARS Requirements**:
- WHEN sensitive data is detected, the system SHALL route to local models only
- WHERE privacy flag is set, the system SHALL never use remote inference
- IF audit is requested, the system SHALL provide complete history of inference routing

**Acceptance Criteria**:
- [ ] **Sensitivity Detection**: Reuse LSL 5-layer classification with sensitive topics config
- [ ] **Privacy Routing**:
  - `privacy: 'local'` → Ollama or vLLM in dev container (no remote calls)
  - `privacy: 'remote'` → Remote models allowed (budget permitting)
  - `privacy: 'auto'` → Automatic detection via sensitivity classifier
- [ ] **Local Model Support**: Ollama or vLLM in AWS dev containers (CODER infrastructure)
- [ ] **Audit Logging**: All remote LLM calls logged with content hash (not content)
- [ ] **Fail-Safe**: If local models unavailable for sensitive data, fail (no remote fallback)
- [ ] **Sensitive Topics Config**: `.specstory/config/sensitivity-topics.json`

**Privacy Compliance**:
- No sensitive code sent to remote LLMs
- Audit trail for compliance verification
- User transparency (know what goes remote)

---

### NFR-5: Reliability
**Priority**: HIGH

**EARS Requirements**:
- WHEN components fail, the system SHALL degrade gracefully without blocking development
- WHERE critical services are down, the system SHALL retry with exponential backoff
- IF all providers fail, the system SHALL return cached results or skip analysis

**Acceptance Criteria**:
- [ ] **Graceful Degradation**: LLM failures don't block development
- [ ] **Circuit Breakers**: 5 failures → 1 minute timeout
- [ ] **Fallback Hierarchy**:
  1. Remote LLM (Groq)
  2. Remote LLM (Anthropic)
  3. Remote LLM (OpenAI)
  4. Local LLM (Ollama or vLLM)
  5. Cached results
  6. Skip analysis (continue working)
- [ ] **Database Resilience**: Connection pooling, automatic retry
- [ ] **Health Checks**: Monitor all components (LSL pattern)
- [ ] **Automatic Recovery**: Restart failed processes (Global Service Coordinator pattern)

**Monitoring**:
- Service health dashboard
- Error rate tracking
- Automatic alerting

---

### NFR-6: Maintainability
**Priority**: MEDIUM

**EARS Requirements**:
- WHEN developers need to understand the system, documentation SHALL be comprehensive
- WHERE code is duplicated, it SHALL be refactored into shared components
- IF changes are needed, the system SHALL be modular and loosely coupled

**Acceptance Criteria**:
- [ ] **No Code Duplication**: UnifiedInferenceEngine shared by all components
- [ ] **Clear Separation**: Inference, Storage, Analysis as separate modules
- [ ] **Configuration-Driven**: Local vs remote routing via config, not code
- [ ] **Comprehensive Logging**: All decisions logged with reasoning
- [ ] **Metrics Dashboard**: Cost, performance, freshness, effectiveness
- [ ] **Documentation**: Architecture diagrams, API contracts, integration guides
- [ ] **Testing**: Unit tests, integration tests, load tests

**Code Quality**:
- TypeScript for type safety
- ESLint/Prettier for consistency
- Code review for all changes

---

## 4. TECHNICAL CONSTRAINTS

### TC-1: Reuse Existing Infrastructure
**Constraint**: Must extend existing systems, not replace them

**Impacts**:
- [ ] Extend `RealTimeTrajectoryAnalyzer` (add intent, don't replace trajectory)
- [ ] Reuse `semantic-validator.js` pattern → `UnifiedInferenceEngine`
- [ ] Keep existing MCP agents (GitHistoryAgent, VibeHistoryAgent, etc.)
- [ ] Maintain LSL system compatibility (5-layer classification)
- [ ] Preserve VKB visualization (adapt to read from databases)

### TC-2: Database Technology Fixed
**Constraint**: Qdrant (vectors) + DuckDB (temporal) only

**Rationale**:
- Qdrant already integrated and optimized
- DuckDB perfect for temporal analytics, embedded (no server)
- No PostgreSQL, MongoDB, or other databases

**Impacts**:
- [ ] All vector operations use Qdrant
- [ ] All time-series queries use DuckDB
- [ ] Migration from JSON must target these databases

### TC-3: Local Model Infrastructure
**Constraint**: Ollama in AWS dev containers (CODER)

**Rationale**:
- Dev containers already include Ollama
- Centralized deployment for teams
- GPU acceleration available

**Impacts**:
- [ ] Local models accessed via Ollama API
- [ ] Dev container health checks required
- [ ] Network latency to dev containers acceptable (<100ms)

### TC-4: Agent-Agnostic Design
**Constraint**: Must work with ANY CLI-based coding agent

**Rationale**:
- Project "coding" is not Claude-specific
- Teams may use different agents
- Future-proof for new agent technologies

**Impacts**:
- [ ] No MCP-specific dependencies (replace MCP Memory)
- [ ] Generic transcript format (AgentAdapter pattern)
- [ ] File-based or HTTP API caching (not just MCP)
- [ ] Documentation for integrating new agents

### TC-5: Cross-Project Operation
**Constraint**: Coding hosts system, all projects use it

**Rationale**:
- Centralized knowledge management
- Shared learning across projects
- Consistent infrastructure

**Impacts**:
- [ ] Knowledge tagged by project
- [ ] VKB teams concept preserved (domain-specific knowledge bases)
- [ ] Cross-project queries supported
- [ ] Attribution to source project

---

## 5. INTEGRATION REQUIREMENTS

### INT-1: Real-Time Trajectory System
**Integration Point**: `src/live-logging/RealTimeTrajectoryAnalyzer.js`

**Requirements**:
- [ ] Share `UnifiedInferenceEngine` (no duplicate inference code)
- [ ] Add intent classification (preserve trajectory states)
- [ ] Store enhanced states in DuckDB
- [ ] Embeddings in Qdrant
- [ ] Maintain existing status line integration

### INT-2: MCP Semantic Analysis
**Integration Point**: `integrations/mcp-server-semantic-analysis/`

**Requirements**:
- [ ] Add `StreamingKnowledgeExtractor` agent
- [ ] Extend `ConceptAbstractionAgent` with generalization
- [ ] Use existing `DeduplicationAgent` with Qdrant similarity
- [ ] Preserve existing workflow orchestration (CoordinatorAgent)

### INT-3: Constraint Monitor
**Integration Point**: `integrations/mcp-constraint-monitor/`

**Requirements**:
- [ ] Feed violation data to knowledge extraction
- [ ] Use violations as learning signals ("user wanted X but violated Y")
- [ ] Integrate with budget tracker (shared cost pool)
- [ ] Reuse Qdrant client (already integrated)

### INT-4: LSL System
**Integration Point**: `scripts/enhanced-transcript-monitor.js`

**Requirements**:
- [ ] Tool interaction hooks feed `StreamingKnowledgeExtractor`
- [ ] Session logs analyzed for long-term patterns
- [ ] Cross-project session analysis (existing redirect detection)
- [ ] Reuse 5-layer classification for sensitivity detection

### INT-5: VKB/UKB Commands
**Integration Point**: `bin/vkb`, `bin/ukb`

**Requirements**:
- [ ] `vkb` visualize knowledge graph (read from Qdrant + DuckDB, not JSON)
- [ ] `ukb` update knowledge base (trigger workflows)
- [ ] Dashboard shows real-time metrics (cost, performance, freshness)
- [ ] Preserve existing CLI interface (no breaking changes)

---

## 6. SUCCESS METRICS

### Knowledge Quality Metrics
- [ ] **Abstraction Ratio**: Generalized concepts / Total observations (target: > 0.3)
- [ ] **Reuse Rate**: Patterns recommended and applied (target: > 40%)
- [ ] **Freshness Score**: % knowledge validated in last 90 days (target: > 70%)
- [ ] **Deduplication Rate**: Similar concepts merged (target: > 85%)
- [ ] **Concept Hierarchy Depth**: Average depth of concept abstraction (target: 3-4 levels)

### Developer Experience Metrics
- [ ] **Time to Insight**: Query to answer (target: < 30s)
- [ ] **Cache Hit Rate**: Reduced redundant LLM calls (target: > 40%)
- [ ] **Recommendation Acceptance**: Developers follow suggestions (target: > 30%)
- [ ] **Session Continuity**: Context preserved across sessions (target: > 90%)

### System Performance Metrics
- [ ] **Trajectory Classification Latency**: < 2s (p95)
- [ ] **Knowledge Query Latency**: < 500ms (p95)
- [ ] **Database Query Performance**: Qdrant < 100ms, DuckDB < 1s (p95)
- [ ] **System Uptime**: > 99.5% (LSL monitoring ensures reliability)

### Cost Metrics
- [ ] **Monthly LLM Spend**: < $8.33/month (strict limit, no exceptions)
- [ ] **Token Usage**: < 2.7M tokens/day (averaged monthly)
- [ ] **Local vs Remote Ratio**: > 60% local inference
- [ ] **Cost Per Developer**: < $0.17/month (at 50 developers)

---

## 7. RISKS & MITIGATION

### RISK-1: LLM Budget Overrun
**Probability**: MEDIUM
**Impact**: HIGH (blocks all remote inference)

**Mitigation**:
- [ ] Strict budget enforcement via BudgetTracker
- [ ] Automatic fallback to local models (Ollama)
- [ ] Aggressive caching (40%+ hit rate target)
- [ ] Smart sampling (only significant events)
- [ ] Monthly cost alerts at 80% threshold

### RISK-2: Local Model Performance
**Probability**: MEDIUM
**Impact**: MEDIUM (slower inference times)

**Mitigation**:
- [ ] Use fast local models (Qwen 2.5 32B, LLaMA 3.3 70B)
- [ ] GPU acceleration in dev containers
- [ ] Batch processing for bulk operations
- [ ] Async inference (non-blocking)
- [ ] Cache local model results aggressively

### RISK-3: Database Performance Degradation
**Probability**: LOW
**Impact**: HIGH (slow knowledge queries)

**Mitigation**:
- [ ] Qdrant already optimized (HNSW + int8 quantization)
- [ ] DuckDB indexes on temporal columns
- [ ] Regular database maintenance (vacuum, analyze)
- [ ] Query optimization (limit result sets, use indexes)
- [ ] Monitor query performance (alert on slow queries)

### RISK-4: Knowledge Quality Decline
**Probability**: MEDIUM
**Impact**: MEDIUM (bad recommendations)

**Mitigation**:
- [ ] QA agent validation (existing, from semantic analysis)
- [ ] Manual review dashboard
- [ ] Feedback loop (track recommendation effectiveness)
- [ ] Decay detection (remove stale knowledge)
- [ ] Human-in-the-loop for critical concepts

### RISK-5: Privacy Breach
**Probability**: LOW
**Impact**: CRITICAL (sensitive data leaked)

**Mitigation**:
- [ ] Sensitivity detection via LSL 5-layer classification
- [ ] Fail-safe: no remote inference for sensitive data
- [ ] Audit logging (all remote calls tracked)
- [ ] Manual review of sensitive topic configuration
- [ ] Regular privacy audits

---

## 8. OPEN QUESTIONS (RESOLVED)

### Q1: Embedding Model
**Question**: Which model for generating embeddings?
- Option A: sentence-transformers/all-MiniLM-L6-v2 (384-dim, fast)
- Option B: Larger model for better semantic understanding

**Resolution**:
- **1024-dim model for knowledge concepts** (better semantic understanding, worth the cost)
- **384-dim model for fast operations** (pattern matching, intent classification)
- Rationale: Balance accuracy vs speed based on use case

### Q2: Local Model Deployment
**Question**: How to deploy local models for teams?
- Option A: Each developer runs Ollama locally
- Option B: Shared local inference server per team

**Resolution**:
- **Dev containers with Ollama in CODER/AWS infrastructure**
- Already deployed, GPU acceleration available
- Centralized management, consistent environment

### Q3: Migration Strategy
**Question**: How to migrate existing JSON knowledge base?
- Option A: One-time bulk migration
- Option B: Gradual migration (dual-write during transition)

**Resolution**:
- **One-time bulk migration**
- Ensure VKB visualization adapted to read from databases (not JSON)
- Node format adapted to database table fields
- Validation before decommissioning JSON files

### Q4: Privacy Detection
**Question**: How to automatically detect sensitive data?
- Option A: Regex patterns (API keys, credentials)
- Option B: LLM-based classification
- Option C: Manual tagging

**Resolution**:
- **Reuse LSL 5-layer classification system**
- Configuration-driven sensitive topics (`.specstory/config/sensitivity-topics.json`)
- Progressive detection: Path → Keyword → Embedding → Semantic → LLM
- Same proven approach as existing LSL classification

### Q5: MCP Memory Replacement
**Question**: How to replace MCP Memory for agent-agnostic compatibility?

**Resolution**:
- **Create AgentAgnosticCache.js**
- Multi-backend support: File-based (universal), HTTP API (programmatic), MCP (compatibility)
- Generic interface works with any CLI-based coding agent
- Maintains MCP backend for Claude compatibility

---

## 9. IMPLEMENTATION PHASES

### Phase 1: Unified Infrastructure (Weeks 1-2)
**Goal**: Build shared foundation, no duplicate code

**Components**:
- [ ] `UnifiedInferenceEngine.js` - Shared LLM inference (extends semantic-validator pattern)
- [ ] `BudgetTracker.js` - Cost enforcement ($8.33/month limit)
- [ ] `DatabaseManager.js` - Qdrant + DuckDB integration
- [ ] `AgentAgnosticCache.js` - Replace MCP Memory
- [ ] `SensitivityClassifier.js` - Reuse LSL 5-layer classification

**Integration**:
- Wire UnifiedInferenceEngine into RealTimeTrajectoryAnalyzer
- Test budget enforcement with mock LLM calls
- Validate Qdrant + DuckDB connectivity

**Success Criteria**:
- All components use UnifiedInferenceEngine (no duplicate inference code)
- Budget tracking working (test with small limit)
- Databases accessible and performant

---

### Phase 2: Enhanced Trajectory & Intent (Weeks 3-4)
**Goal**: Add intent classification to existing trajectory system

**Components**:
- [ ] Extend `RealTimeTrajectoryAnalyzer` (preserve existing trajectory states)
- [ ] Add intent classification (learning, debugging, feature-dev, etc.)
- [ ] Concept extraction from conversation
- [ ] Goal inference
- [ ] Context chain tracking

**Storage**:
- [ ] Real-time: `.specstory/trajectory/live-state.json` (enhanced schema)
- [ ] Historical: DuckDB `trajectory_history` table
- [ ] Embeddings: Qdrant `session_intents` collection

**Success Criteria**:
- Intent classification accuracy > 85%
- Trajectory states still work (backward compatible)
- Status line shows enhanced state (trajectory + intent)

---

### Phase 3: Continuous Knowledge Extraction (Weeks 5-6)
**Goal**: Extract knowledge in real-time, not just batch

**Components**:
- [ ] `StreamingKnowledgeExtractor` agent (new)
- [ ] `KnowledgeStreamBuffer` (buffering + clustering)
- [ ] Tool interaction hook integration
- [ ] Real-time observation storage (Qdrant + DuckDB)

**Integration**:
- Subscribe to PostToolUse hooks
- Buffer observations (10 observations OR 5 minutes)
- Cluster related observations
- Store in databases

**Success Criteria**:
- Observations captured within 1 second of tool interaction
- Clustering groups related observations (>0.85 similarity)
- No blocking of developer workflow (async processing)

---

### Phase 4: Concept Generalization (Weeks 7-9)
**Goal**: Generalize patterns into reusable concepts

**Components**:
- [ ] `ConceptAbstractionAgent` (new)
- [ ] Enhance `DeduplicationAgent` with Qdrant similarity
- [ ] Weekly generalization workflow
- [ ] Concept hierarchy in Qdrant

**Processing**:
- Group similar observations (Qdrant semantic search)
- Generate concepts via UnifiedInferenceEngine
- Create hierarchy (Specific → Pattern → Concept → Principle)
- Deduplicate and merge

**Success Criteria**:
- Abstraction ratio > 0.3 (generalized concepts / observations)
- Semantic deduplication > 85% accuracy
- Concepts include all required fields (implementations, tradeoffs, pitfalls)

---

### Phase 5: Temporal Knowledge Management (Weeks 10-11)
**Goal**: Track knowledge freshness, prevent stale recommendations

**Components**:
- [ ] `KnowledgeDecayTracker` (freshness scoring)
- [ ] Temporal edges in Qdrant (supersedes, evolved_from)
- [ ] DuckDB temporal queries
- [ ] Search prioritization by freshness

**Processing**:
- Monthly decay detection (mark aging/stale)
- Create deprecation links where applicable
- Prioritize fresh knowledge in search results
- Support temporal queries ("auth patterns in 2024")

**Success Criteria**:
- Freshness score > 70% (knowledge validated in last 90 days)
- Temporal queries work (DuckDB performance < 1s)
- Stale recommendations show warnings

---

### Phase 6: Database Migration & VKB Adaptation (Weeks 12-13)
**Goal**: Migrate JSON to databases, adapt VKB visualization

**Components**:
- [ ] `migrate-json-to-databases.js` script
- [ ] VKB visualization reads from Qdrant + DuckDB
- [ ] Node formatting per database schema
- [ ] Validation and testing

**Migration Process**:
1. Backup existing JSON files
2. Parse and transform to database schema
3. Bulk insert to Qdrant + DuckDB
4. Validate counts and spot-check samples
5. Test VKB visualization with database backend
6. Decommission JSON files (after 1 month dual-read validation)

**Success Criteria**:
- All knowledge migrated (0 data loss)
- VKB visualization works with databases
- Performance acceptable (queries < 500ms)

---

## 10. ACCEPTANCE CRITERIA SUMMARY

### Critical Must-Haves (Phase 1-3)
- [ ] UnifiedInferenceEngine shared by all components (no duplicate code)
- [ ] Budget tracking enforces $100/year limit
- [ ] Privacy detection routes sensitive data to local models
- [ ] Intent classification added to trajectory system
- [ ] Continuous knowledge extraction from tool interactions
- [ ] Agent-agnostic caching replaces MCP Memory

### Important Features (Phase 4-5)
- [ ] Concept generalization from patterns
- [ ] Temporal knowledge management (freshness tracking)
- [ ] Deduplication with semantic similarity
- [ ] Cross-project knowledge sharing

### Nice-to-Haves (Phase 6+)
- [ ] VKB visualization reading from databases
- [ ] Proactive recommendations (future)
- [ ] Advanced analytics dashboard (future)

---

## 11. COMPLIANCE & CONSTRAINTS

### Budget Compliance
- [ ] Monthly spend tracked in DuckDB
- [ ] Alert at 80% of $8.33/month limit
- [ ] Automatic fallback to local models when budget exceeded
- [ ] Cost breakdown by operation type

### Privacy Compliance
- [ ] Sensitive data never sent to remote LLMs
- [ ] Audit log of all remote inference calls
- [ ] Configuration-driven sensitivity detection
- [ ] Fail-safe: block remote if local unavailable

### Performance Compliance
- [ ] All SLAs met (see NFR-1)
- [ ] Dashboard monitoring with alerts
- [ ] Degradation gracefully (no blocking)

### Agent-Agnostic Compliance
- [ ] Works with any CLI-based coding agent
- [ ] No MCP-specific dependencies (except compatibility layer)
- [ ] Generic caching solution
- [ ] Documentation for agent integration

---

## 12. DEPENDENCIES

### External Dependencies
- [ ] **Qdrant**: Vector database (already integrated)
- [ ] **DuckDB**: Analytical database (add new)
- [ ] **Ollama**: Local LLM orchestrator (CODER dev containers)
- [ ] **Groq API**: Remote inference (llama-3.3-70b, qwen-2.5-32b)
- [ ] **Anthropic API**: Fallback inference (claude-3-haiku)

### Internal Dependencies
- [ ] **LSL System**: 5-layer classification, tool hooks
- [ ] **Trajectory System**: RealTimeTrajectoryAnalyzer
- [ ] **Constraint Monitor**: Violation data, budget integration
- [ ] **MCP Semantic Analysis**: Existing agents, workflows
- [ ] **VKB System**: Visualization, CLI commands

---

## 13. GLOSSARY

**Agentic RAG**: Multi-agent Retrieval-Augmented Generation system with specialized agents (Librarian, Analyst, Scout)

**Concept**: Generalized pattern abstracted from specific observations (e.g., "Stateless Authentication Pattern")

**Dev Container**: Docker container in AWS/CODER with Ollama for local model inference

**Intent**: Developer's current goal (learning, debugging, feature-development, etc.)

**LSL**: Live Session Logging - real-time transcript monitoring system with 5-layer classification

**Observation**: Single unit of extracted knowledge from development activity

**Pattern**: Specific implementation of a solution (e.g., "JWT authentication in nano-degree")

**Trajectory**: Developer's current state (exploring, implementing, verifying, etc.)

**UnifiedInferenceEngine**: Shared LLM inference component used by all knowledge management features

**VKB**: Visualize Knowledge Base - graph visualization of knowledge relationships

---

## APPROVAL CHECKLIST

Before approving this requirements specification, verify:

- [ ] Business requirements align with goals (cross-project learning, budget compliance)
- [ ] User stories cover key workflows (intent-aware extraction, cross-project discovery)
- [ ] Functional requirements are complete and testable
- [ ] Non-functional requirements include performance, cost, privacy, reliability
- [ ] Technical constraints are acknowledged (reuse existing, Qdrant+DuckDB, Ollama)
- [ ] Integration points identified for all existing systems
- [ ] Success metrics defined with measurable targets
- [ ] Risks identified with mitigation strategies
- [ ] Open questions resolved
- [ ] Implementation phases are realistic
- [ ] Dependencies listed and available

---

**Document Status**: DRAFT - Awaiting User Approval
**Next Phase**: Design (technical architecture, API contracts, database schemas)
**Approval Method**: Spec-workflow dashboard or VS Code extension (NOT verbal)

---

*This requirements specification follows the spec-workflow process. After approval, the Design phase will create detailed technical architecture, API contracts, and database schemas. The Tasks phase will then break down the design into implementation tasks with specific prompts and success criteria.*
