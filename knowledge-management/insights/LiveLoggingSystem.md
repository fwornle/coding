# LiveLoggingSystem

**Type:** Component

The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude Code—into a unified format. It handles session windowing (time-window identifiers like '0800-0900'), multi-user support via SHA-256 user hashing, file routing with rotation thresholds, and transcript capture from agent-native formats. The system bridges raw agent transcripts to a normalized LSL format used downstream by semantic analysis and knowledge management pipelines.

# LiveLoggingSystem — Technical Reference

## What It Is

LiveLoggingSystem (LSL) is a session logging infrastructure implemented across `lib/agent-api/` and `integrations/mcp-server-semantic-analysis/src/`, responsible for capturing, normalizing, and persisting AI agent conversations—primarily from Claude Code—into a unified LSL format. It acts as the ingestion boundary for the broader Coding project's knowledge and analysis pipelines: raw agent transcripts enter LSL and emerge as structured, classified, enriched records consumed by SemanticAnalysis and KnowledgeManagement downstream.

Configuration lives under `.specstory/config/` (notably `lsl-config.json` and `redaction-config.yaml`), validated at startup by `scripts/validate-lsl-config.js`.

## Architecture and Design

![LiveLoggingSystem — Architecture](images/live-logging-system-architecture.png)

LSL is structured around three clear concerns: **capture** (adapter layer), **serialization** (converter layer), and **persistence with enrichment** (buffer + classification layer). These map to distinct code boundaries that can evolve independently.

The capture layer uses an abstract adapter contract (`TranscriptAdapter` in `lib/agent-api/transcript-api.js`) enforcing `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. This is a classic **Strategy/Template Method pattern**: agent-specific implementations (claude, copilot) fulfill the contract without requiring changes to downstream consumers. The parent Coding project explicitly supports multiple agent backends (Claude, Copilot, Mastra, OpenCode), and `TranscriptAdapter` is the mechanism that makes LSL agent-agnostic in parallel with LLMAbstraction's provider-agnostic model calls.

Session identity is structured around **time-window identifiers** (e.g., `0800-0900`) rather than arbitrary UUIDs, which encodes temporal locality directly into the file routing scheme. This decision trades global uniqueness for human-legibility and natural grouping by hour-long windows—a deliberate ergonomic choice for a system whose outputs are also consumed by humans (via Markdown) not just machines.

The persistence path uses a non-blocking async write buffer (`SemanticLoggingBuffer` in `integrations/mcp-server-semantic-analysis/src/logging.ts`) with a 100ms flush interval and `MAX_BUFFER_SIZE=50`, preventing event-loop stalls. The design mirrors patterns common in the sibling ConstraintSystem's `ViolationCaptureService`, which also batches writes to JSONL rather than writing synchronously on each event.

## Implementation Details

`LSLConverter` (`lib/agent-api/transcripts/lsl-converter.js`) provides **dual serialization**: `toMarkdown()` for human-readable role-labeled session logs, and `toJSONL()`/`fromJSONL()` for machine interchange. The JSONL format mandates the metadata record as the first line—a structural convention that allows consumers to read session context without streaming the entire file. This is a sensible framing: metadata-first JSONL is a well-known pattern for log formats where partial reads must remain useful.

Multi-user support anonymizes identity via SHA-256 hashing of the `USER` environment variable (in `scripts/validate-lsl-config.js`, `validateUserEnvironment()`), producing a short hex token stored in `LSLMetadata.userHash`. The hash length is configurable but constrained to 6–12 characters by `LSLConfigValidator`, balancing collision resistance against readability. Raw usernames never appear in persisted records.

`LSLConfigValidator` enforces typed range guards on `lsl-config.json`: `multiUser.userHashLength` (6–12), `fileManager.maxFileSize` (1MB–100MB), and `operationalLogger.batchSize` (10–1000). These explicit numeric bounds make the configuration contract self-documenting and catch misconfiguration before runtime.

PII scrubbing is governed by `redaction-config.yaml` under `.specstory/config/`, which gates scrubbing per category. This is a separate layer from identity hashing—the former handles structured identity, the latter handles freeform PII in transcript content—reflecting a clear separation of concerns.

The child component `OntologyClassificationAgent` (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) operates as a **post-capture enrichment step**, not an inline interceptor. It runs a five-method classification pipeline (heuristic, llm, hybrid, auto-assigned, unclassified) and attaches `OntologyMetadata` including `classificationConfidence` and `llmUsage` token counts. Decoupling classification from capture means the write path stays fast and classification failures cannot block logging.

## Integration Points

![LiveLoggingSystem — Relationship](images/live-logging-system-relationship.png)

LSL sits at the ingestion boundary of the Coding project's knowledge infrastructure. Its normalized output feeds SemanticAnalysis (the MCP server orchestrating multi-agent analysis pipelines) and ultimately KnowledgeManagement (the Graphology/LevelDB knowledge graph). The `SemanticLoggingBuffer` child component is the handoff point: it receives normalized LSL entries and persists them via `fsp.appendFile()` for downstream consumption.

`OntologyClassificationAgent` consumes already-persisted LSL entries, integrating with LLMAbstraction for its `llm` and `hybrid` classification modes—LLM token usage is tracked per classification in `llmUsage`, linking LSL's enrichment cost back to the provider abstraction layer.

The `TranscriptAdapter` interface is the primary extension point for adding new agent sources. A new adapter (e.g., for Mastra or OpenCode) needs only to implement the five-method contract; no changes to `LSLConverter`, `SemanticLoggingBuffer`, or downstream consumers are required.

DockerizedServices packages the semantic analysis MCP (which hosts `SemanticLoggingBuffer` and `OntologyClassificationAgent`) as a containerized service, meaning LSL's persistence layer runs in the same supervised container environment as the rest of the analysis infrastructure.

## Usage Guidelines

**Configuration validation must pass before deployment.** `LSLConfigValidator` should be run (`scripts/validate-lsl-config.js`) against any modified `lsl-config.json` to catch out-of-range values early. The `userHashLength` floor of 6 is a minimum collision-resistance threshold; prefer 8–10 for multi-user environments.

**New agent adapters extend `TranscriptAdapter`**, not `LSLConverter`. The converter is format-agnostic; the adapter is agent-specific. Mixing these concerns would break the downstream consumers' ability to remain agent-unaware.

**The metadata-first JSONL convention must be preserved** in any extension to `LSLConverter.toJSONL()`. Consumers that stream-read session files rely on the first line being a complete metadata record.

**Redaction config (`redaction-config.yaml`) should be reviewed before enabling new transcript categories.** PII scrubbing is category-gated, so new transcript types are unredacted by default until explicitly configured.

**Classification is asynchronous and best-effort.** Because `OntologyClassificationAgent` runs post-capture, `classificationConfidence` may be absent or `unclassified` for recently written records. Downstream consumers in KnowledgeManagement and SemanticAnalysis should treat missing ontology metadata as a valid transient state rather than an error.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 7 major components: LiveLoggingSystem: The LiveLoggingSystem (LSL) is a session logging infrastructure that captures, classifies, and persists AI agent conversations—primarily from Claude C; LLMAbstraction: LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local ; DockerizedServices: DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint mo; KnowledgeManagement: The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lif; CodingPatterns: CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design pattern; ConstraintSystem: The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interac; SemanticAnalysis: The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized a.

### Children
- [SemanticLoggingBuffer](./SemanticLoggingBuffer.md) -- SemanticLoggingBuffer resides in integrations/mcp-server-semantic-analysis/src/logging.ts and serves as the primary write path for normalized LSL log entries produced during Claude Code sessions.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent lives in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and operates as a post-capture enrichment step, consuming already-persisted LSL entries rather than intercepting them during capture.

### Siblings
- [LLMAbstraction](./LLMAbstraction.md) -- LLMAbstraction is a multi-layered abstraction over LLM providers that enables provider-agnostic model calls across Anthropic, OpenAI, Groq, and local inference backends. It provides three distinct execution modes (mock, local, public) with per-agent overrides stored in a workflow-progress.json file, allowing dynamic routing without code changes. The architecture consists of a mock service for testing, a DMR (Docker Model Runner) provider for local inference, and a direct-fetch wrapper (llm-with-process.ts) that bypasses the SDK to inject telemetry process tags into the rapid-llm-proxy endpoint.
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component provides the core knowledge graph infrastructure for the Coding project, encompassing persistent storage, entity lifecycle management, and graph query capabilities. It is built on a Graphology in-memory graph with LevelDB as the persistence backend, exposing entities with typed attributes (System, Project, Pattern) and relationships. The system supports both local graph operations and integration with external graph databases like Memgraph via the CodeGraphAgent, which uses Tree-sitter AST parsing to index repositories into a queryable knowledge graph.
- [CodingPatterns](./CodingPatterns.md) -- CodingPatterns serves as the architectural catch-all component for the Coding project, capturing cross-cutting programming conventions, design patterns, and best practices that permeate the entire codebase. The project follows consistent patterns visible across its configuration, tooling, and documentation: agent abstractions use a constructor+initialize+execute lifecycle, shell scripts in bin/ follow a proxy/delegation pattern to underlying services, and configuration is externalized into config/ YAML/JSON files rather than hardcoded values. The system emphasizes agent-agnostic design, enabling multiple AI backends (Claude, Copilot, Mastra, OpenCode) to operate under a unified interface.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem is a multi-layered constraint monitoring and enforcement framework that validates code actions, file operations, and tool interactions against configured rules during Claude Code sessions. It operates through a hook-based interception architecture where pre-tool and post-tool hook events capture agent actions, evaluate them against constraint rules, and record violations for persistence and dashboard display. The system bridges live session activity with persistent storage via the ViolationCaptureService, which writes violations to JSONL logs and maintains a JSON history file in the .mcp-sync directory for dashboard consumption.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a pipeline of specialized agents to extract, classify, validate, and persist structured knowledge from git history and LSL (Live Session Log) sessions. It combines AST-based code graph construction, LLM-powered semantic insight generation, ontology classification, and content validation into a coordinated batch-analysis workflow. The pipeline produces structured knowledge entities enriched with ontology metadata before persisting them to a graph-based knowledge store.


---

*Generated from 8 observations*
