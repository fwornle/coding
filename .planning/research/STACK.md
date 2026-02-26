# Stack Research

**Domain:** Multi-agent knowledge graph pipeline (UKB)
**Researched:** 2026-02-26
**Confidence:** HIGH — sourced entirely from current codebase, no inference required

---

## Current Production Stack

This documents the **actual existing stack** in `integrations/mcp-server-semantic-analysis`. All findings are from direct code inspection.

---

### Agent Framework

**Pattern:** Custom multi-agent framework — NOT LangChain, AutoGen, or any third-party agent library.

The pipeline implements its own agent architecture:

- **`BaseAgent<TInput, TOutput>`** — abstract base class (`src/agents/base-agent.ts`). Every agent implements `process()` and optionally overrides `calculateConfidence()`, `detectIssues()`, `generateRouting()`, `applyCorrections()`.
- **`AgentResponse<T>` envelope** — all agents return a typed response with `data`, `metadata` (confidence, issues, processingTimeMs), `routing` (retry/escalation recommendations), and `corrections`.
- **`CoordinatorAgent`** — the central orchestrator (`src/agents/coordinator.ts`). Loads workflow YAML, executes steps as a DAG, manages agent instances, handles batch iteration loops.
- **`SmartOrchestrator`** — routing layer (`src/orchestrator/smart-orchestrator.ts`). Wraps CoordinatorAgent with LLM-assisted retry guidance, confidence propagation, dynamic step skipping.
- **`AgentAdapter`** — compatibility shim for agents that predate BaseAgent.

**Agent count:** 14 workflow agents + 1 orchestrator node.

| Agent | ID | LLM? | Tier |
|---|---|---|---|
| Batch Scheduler | batch_scheduler | No | fast |
| Git History | git_history | Yes | standard |
| Vibe History | vibe_history | Yes | standard |
| Semantic Analysis | semantic_analysis | Yes | standard (premium for batch) |
| Observation Generation | observation_generation | Yes | premium |
| Ontology Classification | ontology_classification | Yes | standard |
| KG Operators | kg_operators | Yes | mixed per operator |
| Quality Assurance | quality_assurance | Yes | premium |
| Batch Checkpoint | batch_checkpoint_manager | No | fast |
| Code Graph | code_graph | Yes (external) | standard |
| Documentation Linker | documentation_linker | Yes | standard |
| Web Search | web_search | Yes (optional) | fast |
| Insight Generation | insight_generation | Yes | premium |
| Persistence | persistence | No | fast |
| Deduplication | deduplication | No (embeddings only) | standard |
| Content Validation | content_validation | Yes | standard |

---

### LLM Integration Layer

**Library:** Custom `@coding/llm` shared library at `lib/llm/` — NOT a third-party routing library.

Key components:

- **`LLMService`** — singleton service with `complete()` and `completeForTask()` methods. Handles mode routing (mock/local/public), caching, circuit breaking, budget tracking.
- **`ProviderRegistry`** — registers all providers, returns ordered fallback chains.
- **`CircuitBreaker`** — per-provider circuit breaker (threshold=5, reset=60s).
- **`LLMCache`** — in-memory cache (maxSize=1000, TTL=1h).
- **`MetricsTracker`** — token usage and latency tracking.

**Mode system** (controlled via `.data/workflow-progress.json`):
- `mock` — fake deterministic responses, no API calls
- `local` — Docker Model Runner (DMR) via OpenAI-compatible API at localhost:12434
- `public` — cloud APIs per provider priority chain

**SemanticAnalyzer:** Main LLM call entry point for most agents (`src/agents/semantic-analyzer.ts`). Delegates to `LLMService`. Static methods for repository path and current agent ID context.

---

### LLM Providers

All configured in `config/llm-providers.yaml`. Priority chain (first available wins):

**Subscription (zero marginal cost):**

| Provider | Models | Notes |
|---|---|---|
| copilot | claude-haiku-4.5 / claude-sonnet-4.5 / claude-opus-4.6 | Primary — scales well with parallelism |
| claude-code | sonnet / opus | Secondary subscription provider, CLI-based |

**API (per-token cost):**

| Provider | API Key | Fast | Standard | Premium |
|---|---|---|---|---|
| groq | GROQ_API_KEY | llama-3.1-8b-instant | llama-3.3-70b-versatile | openai/gpt-oss-120b |
| anthropic | ANTHROPIC_API_KEY | claude-haiku-4-5 | claude-sonnet-4-5 | claude-opus-4-6 |
| openai | OPENAI_API_KEY | gpt-4.1-mini | gpt-4.1 | o4-mini |
| gemini | GOOGLE_API_KEY | gemini-2.5-flash | gemini-2.5-flash | gemini-2.5-pro |
| github-models | GITHUB_TOKEN | gpt-4.1-mini | gpt-4.1 | o4-mini |

**Local (Docker Model Runner):**

| Provider | Endpoint | Notes |
|---|---|---|
| DMR | localhost:12434/engines/v1 | OpenAI-compatible API, uses openai SDK |

**KG operator tier assignments:**

| Operator | Tier |
|---|---|
| conv (context convolution) | premium |
| aggr (entity aggregation) | standard |
| embed (embedding generation) | fast |
| dedup (deduplication) | standard |
| pred (edge prediction) | premium |
| merge (graph merge) | standard |

---

### SDK Bindings

All providers use official SDKs directly — no LangChain or additional abstraction layer:

| SDK | Package | Version | Used By |
|---|---|---|---|
| Anthropic SDK | @anthropic-ai/sdk | ^0.57.0 | anthropic provider, claude-code provider |
| OpenAI SDK | openai | ^4.52.0 | openai provider, DMR provider, deduplication embeddings |
| Groq SDK | groq-sdk | ^0.36.0 | groq provider |
| Google Generative AI | @google/generative-ai | ^0.24.1 | gemini provider |

**Embeddings:** OpenAI text-embedding-3-small via openai SDK — used exclusively in `DeduplicationAgent` for cosine similarity. Falls back to text similarity when OPENAI_API_KEY is absent.


---

### Workflow Execution

**Pattern:** YAML-defined DAG workflows executed by `CoordinatorAgent`.

Workflow definitions live in `config/workflows/`:
- `batch-analysis.yaml` — primary production workflow (14 agents, iterative type)
- `complete-analysis.yaml` — non-batched full analysis
- `incremental-analysis.yaml` — incremental updates only

**Batch execution mechanism:**

1. `BatchScheduler` reads git log via execSync, divides commits into 50-commit windows chronologically (oldest first)
2. Each batch runs: git extraction → vibe session extraction → semantic analysis → observation generation → ontology classification → KG operators (6 sequential operators) → QA → checkpoint
3. Checkpoints written to `.data/batch-checkpoints.json` after each batch — supports resume from any batch
4. Finalization phase (after all batches): code graph indexing → doc linking → insight generation → web search → persistence → deduplication → validation

**Concurrency:** max_concurrent_steps: 3 at orchestrator level. Individual agents use Promise.all internally for sub-tasks.

**Progress tracking:** `.data/workflow-progress.json` — single JSON file for live status, LLM mode, mock config, batch progress, step statuses. Dashboard and SSE server read this for real-time display.

**Workflow runner:** `src/workflow-runner.ts` — spawned as a separate Node.js process by the MCP server via child_process. Survives MCP client disconnections. Has SIGINT/SIGTERM/SIGHUP signal handlers for graceful cleanup.

---

### Knowledge Graph Storage

**In-memory graph:** Graphology ^0.25.4 — multi-edge directed graph.

**Persistence:** Level (LevelDB) ^10.0.0 — single key `graph` stores serialized Graphology state as JSON.

**Node ID schema:** {team}:{entityName} pattern for team isolation.

**Access pattern:**
- `GraphDatabaseService` — core service (`src/knowledge-management/GraphDatabaseService.js`). EventEmitter-based. Auto-persists to LevelDB every 30s or on mutation.
- `GraphDatabaseAdapter` — wrapper used by MCP agents. Uses VKB HTTP API when vkb-server is running (lock-free), falls back to direct GraphDatabaseService when VKB server is stopped. Prevents LevelDB lock conflicts.
- JSON export: `.data/knowledge-export/{team}.json` — kept in sync for external tooling.

**Database path:** `.data/knowledge-graph/` (relative to CODING_ROOT).

---

### Code Graph (AST Layer)

**Tool:** code-graph-rag — separate Python integration at `integrations/code-graph-rag/`.

**Tech stack:** Tree-sitter for AST parsing, Memgraph graph database, pydantic_ai framework.

**Invocation:** `CodeGraphAgent` spawns the Python tool via Node.js child_process.spawn:
  uv run python -m codebase_rag.main start --repo-path <path> --update-graph --no-confirm

The `uv` CLI must be in PATH. Gracefully degrades if unavailable (workflow continues with skipped: true).

**Memgraph access:** Docker container code-graph-rag-memgraph-1, queried via docker exec with Cypher.

**Synthesis:** After indexing, synthesizeInsights runs LLM analysis on up to 30 entities in parallel batches of 5 concurrent calls using premium-tier models.

---

### Insight Document Generation

**Output:** Markdown files in `knowledge-management/insights/` — named in kebab-case (enforced by toKebabCase() in InsightGenerationAgent).

**Structure of a generated insight document:**
- Multi-section markdown: executive summary, pattern analysis, architectural implications, PlantUML diagram, code examples, practical guidance, significance rating
- PlantUML diagram: .puml file + .png generated via the plantuml CLI tool
- Metadata block with significance score, tags, generation timestamp

**PlantUML CLI integration:**
- Availability checked via: plantuml -version
- Validation via: plantuml -checkonly <file.puml>
- PNG generation via: plantuml -tpng <file.puml> -o <outputDir>
- Standard style from: docs/puml/_standard-style.puml

**Content pipeline:**
1. Input: persisted entities + accumulated git/vibe analysis + code graph results + web search results
2. LLM call (premium tier) to InsightGenerationAgent.generateInsightContent() via SemanticAnalyzer
3. toKebabCase() normalization for filenames
4. PlantUML diagram generation (if plantuml CLI is available)
5. Written to knowledge-management/insights/{name}.md

---

### Ontology System

**Custom ontology engine** (`src/ontology/`):

- `OntologyManager` — loads upper/lower ontology JSON configs
- `OntologyClassifier` — LLM + heuristic classification against ontology classes
- `OntologyConfigManager` — config loading with validation
- `OntologyValidator` — validates classifications against ontology constraints
- `OntologyQueryEngine` — query interface for ontology traversal
- Heuristics sub-system (`src/ontology/heuristics/`) — fast pre-classification before LLM fallback

Classification method priority: heuristic first, then LLM fallback, then hybrid. minConfidence: 0.6 threshold.

---

### MCP Server Layer

**Protocol:** MCP (Model Context Protocol) SDK @modelcontextprotocol/sdk ^1.0.3.

**Transport options:**

| Mode | File | Port |
|---|---|---|
| SSE (production) | src/sse-server.ts | 3848 |
| stdio | src/index.ts | — |
| stdio proxy | src/stdio-proxy.ts | — |

**SSE server:** Express ^4.21.0 app. Heartbeat every 15s to keep connections alive. Session-based transport management. Health endpoint at /health. Workflow runner spawned as a child process from MCP tool calls.

---

### Infrastructure and Deployment

| Component | Technology | Port |
|---|---|---|
| MCP SSE server | Node.js 20 + Express | 3848 |
| VKB server | Node.js | 8080 |
| System health dashboard | React (bind-mounted) | 3032 |
| Memgraph (code graph) | Memgraph graph DB | Docker internal |
| Qdrant | Vector DB (optional) | 6333 |
| Redis | Cache (optional) | 6379 |
| Docker Model Runner | llama.cpp local LLM | 12434 |

**Container orchestration:** Docker Compose + Supervisord inside coding-services container. All backend services run under supervisord with stdout_logfile rotation.

**Memory limit:** 4GB RAM / 4 CPUs for coding-services container.

**Runtime environment variables:**
- ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, GITHUB_TOKEN
- CODING_ROOT=/coding (Docker path, differs from host path)
- SEMANTIC_ANALYSIS_PORT=3848
- DMR_HOST, DMR_PORT (for local model runner)

---

### Supporting Libraries

| Library | Version | Purpose |
|---|---|---|
| express | ^4.21.0 | SSE server HTTP layer |
| yaml | ^2.8.2 | Config file parsing (all YAML configs) |
| graphology | ^0.25.4 | In-memory knowledge graph |
| level | ^10.0.0 | LevelDB persistence for knowledge graph |
| axios | ^1.6.0 | HTTP client (web search, VKB API calls) |
| cheerio | ^1.0.0-rc.12 | HTML parsing for web search result scraping |
| typescript | ^5.8.3 | Language (strict mode, ES2022 target, ESNext modules) |

---

### Development Tooling

| Tool | Purpose |
|---|---|
| TypeScript ^5.8.3 | Language with strict mode enabled |
| tsc | Build (npm run build outputs to dist/) |
| shx | Cross-platform chmod on built entry points |
| ES modules | type: module — all imports use .js extensions |
| Node.js 20 | Runtime (ES2022 target in tsconfig) |

---

### Key Configuration Files

| File | Purpose |
|---|---|
| config/llm-providers.yaml | Provider priority chain, model assignments, DMR config, cost limits |
| config/agents.yaml | Agent registry — IDs, tiers, descriptions, step mappings, substep definitions |
| config/model-tiers.yaml | Legacy model tier config (superseded by llm-providers.yaml) |
| config/orchestrator.yaml | SmartOrchestrator settings, mock mode timing, single-step debug polling |
| config/agent-tuning.yaml | Agent-specific batch sizes and timeouts |
| config/workflows/batch-analysis.yaml | Primary workflow DAG (14 agents, batch + finalization phases) |
| .data/workflow-progress.json | Runtime state: LLM mode, mock config, batch progress, step statuses |
| .data/batch-checkpoints.json | Per-batch completion state for resume support |

---

### What Is Out of Scope (Per PROJECT.md)

| Component | Status |
|---|---|
| Knowledge graph storage (Graphology + LevelDB) | Working correctly — do not touch |
| VKB viewer | Working correctly — do not touch |
| MCP server interface (execute_workflow tool signature) | Must remain unchanged |
| Agent count (13-14 agents) | Architecture stays — fix quality, not structure |
| Batched execution mode | Working and wanted — preserve |

---

## Sources

All sources are local codebase files — confidence is HIGH (direct inspection, no inference):

- integrations/mcp-server-semantic-analysis/package.json
- integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts
- integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts
- integrations/mcp-server-semantic-analysis/src/orchestrator/smart-orchestrator.ts
- integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts
- integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts
- integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts
- integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts
- integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts
- integrations/mcp-server-semantic-analysis/src/knowledge-management/GraphDatabaseService.js
- integrations/mcp-server-semantic-analysis/src/sse-server.ts
- integrations/mcp-server-semantic-analysis/config/llm-providers.yaml
- integrations/mcp-server-semantic-analysis/config/agents.yaml
- integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml
- integrations/mcp-server-semantic-analysis/config/orchestrator.yaml
- lib/llm/llm-service.ts
- lib/llm/config.ts
- lib/llm/providers/ (10 provider implementations)
- docker/supervisord.conf
- .planning/PROJECT.md

---
*Stack research for: UKB multi-agent analysis pipeline*
*Researched: 2026-02-26*
