# External Integrations

**Analysis Date:** 2026-02-26

## APIs & External Services

**LLM Providers:**
- Claude (Anthropic) - Primary provider
  - SDK: @anthropic-ai/sdk 0.65+
  - Auth: ANTHROPIC_API_KEY
  - Models: claude-haiku-4-5, claude-sonnet-4-5, claude-opus-4-6
  - Usage: Premium insights, quality assurance, semantic analysis

- OpenAI - Alternative provider
  - SDK: openai 4.52+
  - Auth: OPENAI_API_KEY
  - Models: GPT-4, GPT-3.5-turbo
  - Usage: Cost-effective fallback, optional dependency

- Groq - Fast inference provider
  - SDK: groq-sdk 0.36+
  - Auth: GROQ_API_KEY
  - Usage: Low-latency completions, optional

- Google Gemini - Alternative provider
  - SDK: @google/generative-ai 0.24+
  - Auth: GOOGLE_AI_API_KEY
  - Usage: Optional alternative

- xAI (Grok) - Alternative provider
  - Auth: XAI_API_KEY, XAI_MANAGEMENT_KEY, XAI_TEAM_ID
  - Usage: Real-time balance tracking via Management API

**Browser Automation:**
- Browserbase - Managed browser platform
  - SDK: @browserbasehq/stagehand 2.0+
  - Auth: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
  - Purpose: Web scraping, automated testing
  - Location: `integrations/browser-access/`

- Playwright - Browser automation library
  - Package: playwright 1.40+
  - Purpose: Direct browser control, cross-browser testing
  - Features: Chromium, Firefox, WebKit support

## Data Storage

**Databases:**

- Qdrant (Vector Database)
  - Type: Vector embeddings
  - Connection: http://QDRANT_URL:6333 (default: http://localhost:6333)
  - Client: @qdrant/js-client-rest 1.15+
  - Collections:
    - knowledge_patterns (1536-dim OpenAI embeddings)
    - knowledge_patterns_small (384-dim sentence-transformers)
    - trajectory_analysis (384-dim trajectory patterns)
    - session_memory (384-dim session knowledge)
  - Purpose: Semantic search, knowledge pattern storage, trajectory analysis
  - Location in Docker: container service "qdrant" with persistent volume

- SQLite (Analytics & Budgeting)
  - Type: Relational database
  - Connection: SQLITE_PATH (default: .data/knowledge.db)
  - Client: better-sqlite3 11.7+
  - Tables: budget_events, knowledge_extractions, session_metrics, embedding_cache
  - Purpose: Cost tracking, session analytics, pattern storage
  - Location in Docker: mounted volume .data/.sqlite/

- Memgraph (Graph Database)
  - Type: Property graph database
  - Connection: memgraph:7687 (Bolt protocol)
  - Client: pymgclient 1.4+ (Python), @qdrant/js-client-rest (via proxy)
  - Purpose: AST storage, code structure, relationship mapping
  - UI: Memgraph Lab on port 3100
  - Location in Docker: container service "memgraph" with persistent volume
  - Used by: code-graph-rag, semantic-analysis server

- LevelDB (Graph Store)
  - Type: Key-value embedded database
  - Path: GRAPH_DB_PATH (default: .data/knowledge-graph)
  - Client: level 10.0+, levelgraph 4.0+
  - Purpose: Lightweight graph persistence for knowledge entities
  - Location: Host volume .data/knowledge-graph/

- Redis (Caching)
  - Type: In-memory cache
  - Connection: REDIS_URL (default: redis://localhost:6379)
  - Client: redis 4.6+ (Python), optional
  - Purpose: Session caching, temporary state
  - Location in Docker: container service "redis" with persistent volume

**File Storage:**
- Local filesystem only
  - Knowledge exports: `.data/knowledge-export/coding.json`
  - Graphs: `.data/knowledge-graph/`
  - Database: `.data/knowledge.db`
  - Spec workflow: `.specstory/`
  - Logs: `.logs/`

## Authentication & Identity

**Auth Provider:**
- Custom / MCP-based authentication
- Implementation: API key environment variables
- No OAuth/OIDC integration
- Per-service auth via environment variables (ANTHROPIC_API_KEY, etc.)

## Monitoring & Observability

**Error Tracking:**
- Not detected - errors logged to stdout/stderr

**Logs:**
- Winston logging framework (mcp-constraint-monitor)
- Console output (most services)
- File-based logs: `.logs/` directory structure
- Per-service log directories: `.logs/capture/`, `.logs/copi/`
- Health checks: Port 8080 /health endpoint

**Metrics:**
- Budget tracking via SQLite budget_events table
- Operation statistics in DatabaseManager
- Session metrics table in SQLite
- Constraint monitor tracks violations and compliance scoring

## CI/CD & Deployment

**Hosting:**
- Docker containerized deployment
- Single container (coding-services) with multiple processes via Supervisor
- External services via Docker Compose (Qdrant, Redis, Memgraph)
- Development: Local Docker Desktop

**CI Pipeline:**
- GitHub Actions workflows (`.github/workflows/`)
- Git hooks (`.github/hooks/`)
- Not detailed in this analysis

## Environment Configuration

**Required env vars (for LLM access):**
- ANTHROPIC_API_KEY - Claude API key
- OPENAI_API_KEY - OpenAI API key (optional)
- GOOGLE_AI_API_KEY - Google Gemini API key (optional)
- GROQ_API_KEY - Groq API key (optional)
- XAI_API_KEY - xAI (Grok) API key (optional)
- XAI_MANAGEMENT_KEY - xAI Management API key (optional, for balance tracking)
- XAI_TEAM_ID - xAI team ID (optional)

**Required env vars (for browser automation):**
- BROWSERBASE_API_KEY - Browserbase API key (optional)
- BROWSERBASE_PROJECT_ID - Browserbase project ID (optional)

**Database connection vars:**
- QDRANT_URL - Vector DB: http://qdrant:6333 (Docker), http://localhost:6333 (local)
- QDRANT_HOST/PORT - Alternative Qdrant config
- MEMGRAPH_HOST/PORT - Graph DB: memgraph:7687 (Docker), localhost:7687 (local)
- REDIS_URL - Cache: redis://redis:6379 (Docker), redis://localhost:6379 (local)
- SQLITE_PATH - SQLite location
- GRAPH_DB_PATH - LevelDB graph location

**Service ports (env vars in .env.ports):**
- SEMANTIC_ANALYSIS_PORT=3848
- BROWSER_ACCESS_PORT=3847
- CONSTRAINT_MONITOR_PORT=3849
- CODE_GRAPH_RAG_PORT=3850
- VKB_PORT=8080
- HEALTH_DASHBOARD_PORT=3032
- HEALTH_DASHBOARD_WS_PORT=3033

**Optional:**
- DMR_HOST/DMR_PORT - Docker Model Runner (local LLM inference)
- OLLAMA_BASE_URL - Ollama local inference fallback
- LLM_CLI_PROXY_URL - HTTP bridge to host CLI tools
- LOG_LEVEL - Logging verbosity
- CODING_TEAM - Team context (default: "coding")

**Secrets location:**
- `.env` file (not committed) contains API keys
- `.env.example` provides template
- Environment variables loaded via `dotenv` package

## Webhooks & Callbacks

**Incoming:**
- SSE (Server-Sent Events) streams on ports 3847, 3848, 3849, 3850
  - `/semantic-analysis/workflow` (port 3848)
  - `/browser-access/*` (port 3847)
  - `/constraint-monitor/*` (port 3849)
  - `/code-graph-rag/*` (port 3850)

**Outgoing:**
- None detected - services are pull-based (clients request via SSE or HTTP)

## MCP Servers (Model Context Protocol)

**Located in:** `integrations/`

**mcp-server-semantic-analysis** (port 3848)
- 14 specialized AI agents for code analysis
- Provides: repository scanning, pattern extraction, ontology classification, diagram generation
- Uses: Memgraph for AST indexing, Qdrant for pattern storage
- Clients: Claude Code (via MCP), orchestrators
- Location: `integrations/mcp-server-semantic-analysis/`

**mcp-constraint-monitor** (port 3849)
- Real-time constraint enforcement
- 18 configurable constraints with severity levels
- REST API and dashboard UI
- Provides: compliance scoring, violation tracking
- Location: `integrations/mcp-constraint-monitor/`

**browser-access** (port 3847)
- Browser automation via Stagehand
- Web scraping and interaction
- MCP protocol communication
- Location: `integrations/browser-access/`

**code-graph-rag** (port 3850)
- Python-based code analysis
- Graph queries via Memgraph
- Semantic code search
- Location: `integrations/code-graph-rag/`

## Code & Integration Patterns

**LLM Provider Pattern:**
Location: `lib/llm/providers/`
- BaseProvider - Abstract base class
- AnthropicProvider, OpenAIProvider, GroqProvider, GoogleProvider, etc.
- Dynamic SDK loading (checks API key availability)
- OpenAICompatibleProvider base for compatible APIs
- Provider registry with failover support

**Database Access Pattern:**
Location: `src/databases/DatabaseManager.js`
- Unified manager for Qdrant + SQLite + Graph
- Single initialize() call sets up all databases
- Health status tracking for each database
- Graceful degradation if databases unavailable
- Async operations with proper error handling

**MCP Server Pattern:**
Location: `integrations/*/src/index.ts`
- `@modelcontextprotocol/sdk` based implementation
- Tools, resources, and prompts exported via MCP
- SSE server variant for HTTP streaming
- Stdio proxy for classic MCP transport

---

*Integration audit: 2026-02-26*
