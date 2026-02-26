# Technology Stack

**Analysis Date:** 2026-02-26

## Languages

**Primary:**
- JavaScript/ES2020 - MCP servers, CLI tools, web services
- TypeScript 5.8+ - Type-safe development across lib/, integrations/
- Python 3.12 - Code analysis and graph traversal via integrations/code-graph-rag/

**Compiled:**
- Target: ES2020 modules with strict type checking
- Module system: ES modules (type: "module" in package.json)

## Runtime

**Environment:**
- Node.js 22 (Debian Bookworm) in Docker
- Python 3.12 installed via `uv` package manager
- macOS development environment (darwin)

**Package Manager:**
- npm (Node.js packages) - Root and integration-level package.json files
- uv (Python packages) - code-graph-rag and serena integrations
- Lockfile: package-lock.json present

## Frameworks

**Core:**
- Express 4.18+ - HTTP servers for SSE endpoints, dashboards, REST APIs
- Model Context Protocol (MCP) SDK 1.0.3+ - Agent communication framework

**Web UI:**
- React 18.3 - system-health-dashboard UI components
- Vite 5.3 - Build tool for dashboard (ts, tsx compilation)
- Tailwind CSS 3.4 - Styling with Post CSS
- Radix UI - Component library (@radix-ui/react-*)
- Redux Toolkit 2.9 - State management for dashboard
- Recharts 3.2 - Data visualization

**Testing:**
- Jest 29.7 - Unit and integration testing (with ts-jest 29.4)
- NODE_OPTIONS='--experimental-vm-modules --no-warnings' required for ESM support
- node --test - Native Node.js test runner for some modules

**Build/Dev:**
- TypeScript 5.8+ - Language and type checking
- TSC - TypeScript compiler
- Shx 0.3 - Cross-platform shell commands in npm scripts
- TypeDoc 0.28 - API documentation generation

## Key Dependencies

**Critical:**
- @anthropic-ai/sdk 0.65+ - Claude API client (optional, loaded dynamically)
- @google/generative-ai 0.24+ - Google Gemini API (optional)
- groq-sdk 0.36+ - Groq LLM API (optional)
- openai 4.52+ - OpenAI API (optional)
- @modelcontextprotocol/sdk 1.0.3+ - MCP protocol implementation

**Database/Knowledge:**
- @qdrant/js-client-rest 1.15+ - Vector database client (Qdrant)
- better-sqlite3 11.7+ - SQLite database with binary support
- level 10.0+ - LevelDB key-value store (for graph database)
- levelgraph 4.0+ - Graph database on LevelDB
- graphology 0.25+ - Graph manipulation and analysis library
- graphology-utils 2.5+ - Graph utilities

**Code Analysis:**
- @xenova/transformers 2.17+ - HuggingFace transformers for local embeddings
- cheerio 1.0+ - HTML/XML parsing (browser-access)
- playwright 1.40+ - Browser automation
- @browserbasehq/stagehand 2.0+ - High-level browser control (Browserbase integration)
- tree-sitter 0.25+ - AST parsing (Python, code-graph-rag)

**Infrastructure:**
- axios 1.10+ - HTTP client for external APIs
- cors 2.8+ - CORS middleware for Express
- ws 8.16+ - WebSocket server
- express-cors - CORS support
- chokidar 4.0+ - File system watcher
- js-yaml 4.1+ - YAML parsing
- yaml 2.8+ - Alternative YAML library
- proper-lockfile 4.1+ - File locking for concurrent operations
- dotenv 17.2+ - Environment variable loading
- winston 3.11+ - Logging framework (constraint-monitor)
- gpt-tokenizer 3.2+ - Token counting for LLM budgeting

**Python (code-graph-rag):**
- pydantic-ai 1.27+ - AI framework with Pydantic
- pymgclient 1.4+ - Memgraph database client
- starlette 0.41+ - ASGI web framework
- uvicorn 0.32+ - ASGI server
- loguru - Logging
- tree-sitter 0.25+ - AST parsing
- python-dotenv - Environment variable loading
- watchdog 6.0+ - File system monitoring
- typer - CLI framework
- rich - Terminal formatting

## Configuration

**Environment:**
- `.env` file with API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, GROQ_API_KEY
- `.env.ports` - Port configuration for all services (3032, 3847, 3848, 3849, 3850, 8080)
- `.env.example` - Reference configuration
- Process environment variables override defaults

**Build:**
- `tsconfig.json` - TypeScript compiler configuration (ES2020 target, strict mode)
- Express port mapping via environment variables
- Docker environment variables: SEMANTIC_ANALYSIS_PORT, BROWSER_ACCESS_PORT, CONSTRAINT_MONITOR_PORT, etc.

**Database Configuration:**
- QDRANT_URL - Vector database host:port (default: http://localhost:6333)
- REDIS_URL - Redis cache (optional, default: redis://localhost:6379)
- MEMGRAPH_HOST/PORT - Graph database (default: localhost:7687)
- SQLITE_PATH - SQLite database file location (default: .data/knowledge.db)
- GRAPH_DB_PATH - LevelDB graph store location (default: .data/knowledge-graph)

## Platform Requirements

**Development:**
- Node 22+
- Python 3.12+ (via uv)
- macOS or Linux with bash/zsh shell
- Docker and Docker Compose for services
- 4GB+ available memory

**Production:**
- Docker container: node:22-bookworm
- 4GB memory limit, 1GB reserved
- Services: Qdrant, Redis, Memgraph
- Health check on port 8080 (/health endpoint)
- Supervisor process management in container

## Port Assignments

- **8080** - VKB Server (knowledge base viewer)
- **3032** - Health Dashboard HTTP API
- **3033** - Health Dashboard WebSocket
- **3847** - Browser Access SSE stream
- **3848** - Semantic Analysis SSE stream (workflows)
- **3849** - Constraint Monitor SSE stream
- **3850** - Code-Graph-RAG SSE stream
- **6333/6334** - Qdrant HTTP/gRPC
- **6379** - Redis
- **7687** - Memgraph Bolt protocol
- **3100** - Memgraph Lab UI

## Service Architecture

**Single Container (coding-services):**
- All MCP servers run in single container
- Supervisor manages multiple Node.js/Python processes
- Entrypoint: `/coding/docker/entrypoint.sh`
- Supervisord config: `/coding/docker/supervisord.conf`

**External Services (Docker Compose):**
- Qdrant (vector DB) - qdrant:6333
- Redis (cache) - redis:6379
- Memgraph (graph DB) - memgraph:7687

**Local Development (Host):**
- DMR (Docker Model Runner) - host.docker.internal:12434
- Ollama (local LLM fallback) - host.docker.internal:11434
- LLM CLI Proxy - host.docker.internal:12435

---

*Stack analysis: 2026-02-26*
