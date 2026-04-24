# Technology Stack: Knowledge Context Injection Pipeline

**Project:** Coding v6.0 - Knowledge Context Injection
**Researched:** 2026-04-24
**Confidence:** HIGH (all packages verified via npm registry + Context7 docs)

## Recommended Stack Additions

### 1. Qdrant Client (Vector Database Access)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@qdrant/js-client-rest` | ^1.17.0 | TypeScript client for Qdrant vector DB | Official Qdrant JS SDK. Qdrant is already running in Docker (coding-qdrant, ports 6333/6334). No client is currently installed -- the existing `embedding_generator.py` generates vectors but nothing pushes them to Qdrant. REST client over gRPC because the existing Docker setup exposes port 6333 (REST) and the JS REST client has better TypeScript types than the gRPC alternative. |

**Integration point:** Connect to `http://qdrant:6333` inside Docker (env var `QDRANT_URL` already set in docker-compose.yml). From host, `http://localhost:6333`.

**Collection schema:** Use ONE collection named `knowledge` with 384-dim Cosine vectors and payload-based filtering for knowledge tiers. Payload fields: `tier` (observation/digest/insight/entity), `agent`, `project`, `createdAt`, `quality`. Single collection is simpler to query across tiers and Qdrant handles mixed-tier searches efficiently with payload indexes.

### 2. Embedding Model (Vector Generation)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `fastembed` | ^2.1.0 | Local ONNX-based embedding generation in Node.js | Replaces the existing Python `embedding_generator.py` (sentence-transformers, spawned as subprocess). Same model quality (supports `all-MiniLM-L6-v2`, 384-dim) but runs natively in Node.js via ONNX Runtime -- no Python dependency, no subprocess spawn overhead, no numpy/torch install issues in Docker. Built by Qdrant team, designed to pair with their vector DB. |

**Why not keep the Python embedding generator:**
- Current `embedding_generator.py` requires `sentence-transformers` + `numpy` + `torch` in Docker -- these were never successfully installed (noted in MEMORY.md as "non-fatal error")
- Subprocess spawning adds ~2-5s cold start per batch
- fastembed-js uses ONNX Runtime (C++ backend), runs in-process, no Python needed

**Why not `@xenova/transformers` (now `@huggingface/transformers`):**
- General-purpose ML library, much larger dependency surface
- fastembed is purpose-built for embeddings, smaller footprint, same model support
- fastembed is maintained by Qdrant team -- guaranteed compatibility with Qdrant vector format

**Model choice:** `BAAI/bge-small-en-v1.5` (default in fastembed, 384-dim). Top of MTEB leaderboard for its size class. Compatible with existing `EmbeddingCache` (already expects 384-dim vectors). Alternatively `all-MiniLM-L6-v2` to match existing Python generator -- same dimensionality, slightly lower quality.

### 3. HTTP Retrieval Service (Lightweight Server)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `express` | ^4.21.0 | HTTP server for retrieval endpoint | **Already installed** in mcp-server-semantic-analysis. The SSE server (`sse-server.ts`) already runs Express on port 3848. Add retrieval routes to the EXISTING Express app rather than spinning up a new service. Zero new dependencies. |

**Architecture decision: Extend existing Express app, do NOT create a new service.**

The SSE server at port 3848 already handles health checks, workflow SSE events, and MCP transport. Adding `/api/retrieve` and `/api/embed` routes is trivial and avoids another port to manage, another process in supervisord, another Docker port mapping, and another health check endpoint.

Routes to add to `sse-server.ts`:
- `POST /api/retrieve` -- Query text in, ranked knowledge chunks out
- `POST /api/embed` -- Text in, embed and store in Qdrant
- `GET /api/retrieve/health` -- Retrieval subsystem health

**Why not Fastify, Hono, or a separate microservice:**
- Express is already a dependency and running. Adding Fastify means two HTTP frameworks in one process.
- A separate microservice adds Docker complexity for a single-developer project with ~700 knowledge items total.
- The retrieval endpoint is lightweight (query Qdrant, format results, return JSON) -- not compute-heavy enough to justify isolation.

### 4. Token Counting / Context Budget

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `gpt-tokenizer` | ^3.4.0 | Fast token counting for context window budgeting | Pure JS, zero native dependencies, synchronous API. Fastest tokenizer on npm (benchmarked). Supports cl100k_base encoding which gives a close-enough approximation for Claude's tokenizer (~5-10% variance). For context budgeting, exact counts are unnecessary -- we need "will this fit in 10K tokens?" not "exactly 9,847 tokens." |

**Why not `@anthropic-ai/sdk` countTokens:**
- Requires an API call to Anthropic's server -- adds latency (100-300ms) to every injection decision
- The retrieval hook fires on every prompt submission -- must be fast (<50ms)
- gpt-tokenizer runs locally, ~1ms for typical text

**Why not `js-tiktoken`:**
- gpt-tokenizer is a superset with better DX (synchronous API, `encodeChat`, smaller bundle)
- js-tiktoken requires WASM initialization step

**Why not exact Claude token counting:**
- Context budgeting is fuzzy by nature -- we are deciding "inject top-K results that fit in N tokens"
- A 5-10% approximation error means injecting one fewer/more observation -- acceptable
- If exact counts become necessary later, add a calibration step that compares gpt-tokenizer output to Anthropic API counts and applies a multiplier

**Budget strategy by agent:**
- Claude Code: 8,000 tokens (200K context window, inject up to 8K)
- Note: Claude hook stdout is capped at 10,000 characters (~2,500 tokens) -- this is the hard ceiling
- Copilot: 4,000 tokens (instructions are more constrained)
- OpenCode: 6,000 tokens (moderate context)
- Mastra: 8,000 tokens (has OM built-in, generous budget)

### 5. Agent Adapter Mechanisms (No New Dependencies)

Each agent has a different injection mechanism. None require new npm packages.

| Agent | Mechanism | How It Works | New Code Needed |
|-------|-----------|--------------|-----------------|
| **Claude Code** | `UserPromptSubmit` hook | Hook script calls retrieval API, writes to stdout (injected as context). Existing `pre-prompt-hook-wrapper.js` pattern. Claude Code caps hook output at 10,000 chars. | New hook script: `knowledge-injection-hook.js` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | Script regenerates this file periodically with top-K relevant knowledge items based on recent file changes. Static file, refreshed by daemon. | Extend `generate-agent-instructions.sh` or new daemon script |
| **OpenCode** | `.opencode/agents/*.md` or context plugin | Agent markdown files in `.opencode/agents/` inject system prompt. Create a `knowledge.md` agent with dynamic context. Or use `@opencode-ai/plugin` (already installed at v1.3.17) to intercept chat turns. | New agent file or plugin hook |
| **Mastra** | OM built-in + MCP tool | Mastra has observational memory natively. Expose retrieval as MCP tool so mastracode can call it explicitly. | MCP tool registration in existing server |

**Claude Code hook details:**
The hook reads the user prompt from stdin (JSON), POSTs prompt text to `http://localhost:3848/api/retrieve`, receives ranked knowledge chunks, formats as structured context block, and writes to stdout. Claude sees this as additional context. Total budget: 10,000 chars (Claude Code hook limit).

**Key constraint:** Claude Code hook stdout is capped at 10,000 characters. At ~4 chars/token, that is roughly 2,500 tokens of injectable context. This is the hard ceiling for Claude injection. The retrieval service must respect this limit.

## What Already Exists (DO NOT ADD)

| Existing | Where | Status |
|----------|-------|--------|
| `express` ^4.21.0 | mcp-server-semantic-analysis | Running on port 3848 |
| `EmbeddingCache` | `src/utils/embedding-cache.ts` | Disk-backed cache for 384-dim vectors, 7-day TTL |
| `embedding_generator.py` | `src/utils/` | Python subprocess -- REPLACE with fastembed |
| `better-sqlite3` ^11.x | observation store | SQLite with 558 observations, 132 digests |
| `@anthropic-ai/sdk` ^0.57.0 | LLM calls | Keep for analysis pipeline, NOT for token counting |
| Qdrant Docker container | docker-compose.yml | Running, ports 6333/6334 exposed, volume-persisted |
| `.github/copilot-instructions.md` | repo root | Auto-generated from CLAUDE.md by existing script |
| `.opencode/` with `@opencode-ai/plugin` | repo root | Plugin v1.3.17 installed |
| Hook infrastructure | `.claude/settings.local.json` | UserPromptSubmit + PreToolUse hooks wired |

## Installation

```bash
cd integrations/mcp-server-semantic-analysis

# New dependencies (3 packages)
npm install @qdrant/js-client-rest@^1.17.0 fastembed@^2.1.0 gpt-tokenizer@^3.4.0

# Verify versions
npm ls @qdrant/js-client-rest fastembed gpt-tokenizer
```

**Docker note:** fastembed downloads ONNX model files (~25MB for bge-small-en-v1.5) on first use. In Docker, cache these in a volume or pre-download during build to avoid cold-start delay. Add to Dockerfile:

```dockerfile
# Pre-download embedding model during build
RUN node -e "const { EmbeddingModel } = require('fastembed'); new EmbeddingModel({ model: 'BAAI/bge-small-en-v1.5' })"
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Embedding | `fastembed` (JS, ONNX) | Keep `embedding_generator.py` (Python) | Python deps never installed successfully in Docker; subprocess overhead |
| Embedding | `fastembed` | `@huggingface/transformers` | Larger footprint, general-purpose; fastembed is embedding-specific |
| Embedding | `fastembed` | OpenAI embeddings API | Adds API dependency, latency, cost; local is free and fast |
| HTTP server | Extend existing Express | New Fastify service | Two frameworks in one process; separate service adds Docker complexity |
| HTTP server | Extend existing Express | Standalone Hono microservice | Over-engineering for ~700 knowledge items |
| Token counting | `gpt-tokenizer` | `@anthropic-ai/sdk` countTokens | API call latency (100-300ms) unacceptable for per-prompt hook |
| Token counting | `gpt-tokenizer` | `js-tiktoken` | WASM init step, worse DX, gpt-tokenizer is faster |
| Token counting | `gpt-tokenizer` | Character-based estimation | Too inaccurate (3-5x variance); token counting is cheap enough to do properly |
| Qdrant client | `@qdrant/js-client-rest` | Raw HTTP via `axios` | SDK provides TypeScript types, retry logic, proper error handling |
| Qdrant client | `@qdrant/js-client-rest` | `@qdrant/qdrant-js` (gRPC) | REST is simpler, gRPC adds protobuf deps, REST port already exposed |
| Claude injection | UserPromptSubmit hook | MCP tool | Hooks are automatic (every prompt); MCP tools require explicit invocation |
| Copilot injection | Static `.md` file refresh | VS Code extension | Extension development is out of scope; static file works with existing infra |

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `langchain` / `llamaindex` | Massive dependency trees, abstract away Qdrant/embedding details that we need to control directly | Direct Qdrant client + fastembed |
| `chromadb` / `weaviate` client | Qdrant is already running in Docker with volume persistence | `@qdrant/js-client-rest` |
| `@mastra/rag` or `@mastra/vector-store` | Adds Mastra framework dependency for a simple retrieve-and-format operation | Direct Qdrant queries |
| OpenAI/Anthropic embedding APIs | Cost per call, latency, network dependency for a local-first project | `fastembed` local inference |
| Separate retrieval microservice | Over-engineering; 700 items, single developer, Docker already has enough services | Routes on existing Express app |
| `redis` for caching retrieval results | Already have `EmbeddingCache` on disk; retrieval is fast enough without caching | Direct Qdrant queries (sub-10ms for 1K vectors) |
| Custom tokenizer trained on Claude data | Approximate counting is fine for budget decisions; training a tokenizer is weeks of work | `gpt-tokenizer` with cl100k_base |

## Data Flow Summary

Knowledge tiers (558 observations, 132 digests, 12 insights, 160 KG entities) flow through fastembed (bge-small-en-v1.5, 384d) into the EmbeddingCache (disk, 7d TTL), then upsert into Qdrant's `knowledge` collection. On retrieval, user prompts are embedded via fastembed, searched against Qdrant (cosine similarity), ranked results are token-budgeted via gpt-tokenizer, then formatted per agent: Claude gets hook stdout, Copilot gets regenerated `.md` file, OpenCode gets agent/plugin context, Mastra gets MCP tool results.

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@qdrant/js-client-rest@^1.17.0` | Qdrant Docker image `latest` | Client auto-checks server compatibility. Pin Qdrant image to a specific version in production. |
| `fastembed@^2.1.0` | Node.js 25.x | Uses ONNX Runtime native addon. Tested on macOS ARM64 + Linux x64. |
| `fastembed@^2.1.0` | Existing `EmbeddingCache` | Both use 384-dim vectors. Cache hash-based invalidation works regardless of embedding source. |
| `gpt-tokenizer@^3.4.0` | Node.js 25.x | Pure JS, no native deps, universal compatibility. |
| All three | Docker Alpine/Debian | fastembed needs glibc (not musl) -- use Debian-based Node image, not Alpine. Check existing Dockerfile base image. |

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| `@qdrant/js-client-rest` API | HIGH | Context7 docs verified, npm v1.17.0 confirmed, TypeScript types checked |
| `fastembed` JS capabilities | HIGH | npm v2.1.0 verified, supports bge-small-en-v1.5 and all-MiniLM-L6-v2 |
| `gpt-tokenizer` accuracy for Claude | MEDIUM | cl100k_base is GPT-4 tokenizer, not Claude's; ~5-10% variance expected. Acceptable for budgeting. |
| Claude hook injection mechanism | HIGH | Verified from official docs + existing working hook in project |
| Claude hook 10K char limit | HIGH | Documented in official Claude Code hooks reference |
| Copilot `.md` injection | HIGH | Official GitHub docs, existing auto-generated file in project |
| OpenCode plugin injection | MEDIUM | `@opencode-ai/plugin` v1.3.17 installed but plugin API surface needs runtime validation |
| Mastra MCP tool injection | HIGH | MCP server infrastructure already exists, tool registration is standard |
| fastembed Docker compatibility | MEDIUM | Needs glibc (Debian), not Alpine. Must verify existing Dockerfile base image. |

## Sources

- [@qdrant/js-client-rest npm](https://www.npmjs.com/package/@qdrant/js-client-rest) -- v1.17.0 verified (HIGH)
- [Qdrant JS SDK docs via Context7](https://context7.com/qdrant/qdrant-js) -- TypeScript API, collection creation, search (HIGH)
- [fastembed npm](https://www.npmjs.com/package/fastembed) -- v2.1.0 verified, model list (HIGH)
- [fastembed-js GitHub](https://github.com/Anush008/fastembed-js) -- ONNX Runtime, batch support (HIGH)
- [gpt-tokenizer npm](https://www.npmjs.com/package/gpt-tokenizer) -- v3.4.0 verified (HIGH)
- [Token counting guide](https://www.propelcode.ai/blog/token-counting-tiktoken-anthropic-gemini-guide-2025) -- Anthropic tokenizer differences (MEDIUM)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) -- UserPromptSubmit, stdout injection, 10K char limit (HIGH)
- [GitHub Copilot custom instructions](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot) -- `.github/copilot-instructions.md` (HIGH)
- [OpenCode config docs](https://opencode.ai/docs/config/) -- Agent files, plugin system (MEDIUM)
- [OpenCode context management](https://tuts.alexmercedcoder.dev/2026/2026-03-ctx-10-context-management-strategies-for-opencode-a-complete-guide/) -- Context injection patterns (MEDIUM)

---
*Stack research for: Knowledge Context Injection Pipeline (v6.0)*
*Researched: 2026-04-24*
