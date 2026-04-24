# Project Research Summary

**Project:** Coding v6.0 - Knowledge Context Injection Pipeline
**Domain:** RAG-based knowledge retrieval and injection for multi-agent coding environments
**Researched:** 2026-04-24
**Confidence:** HIGH

## Executive Summary

This project adds a semantic retrieval and injection layer to an existing multi-agent coding environment (Claude Code, GitHub Copilot, OpenCode, Mastracode). The knowledge base is already mature — 558 observations, 132 digests, 12 insights, and 160 KG entities stored across SQLite and a Graphology/LevelDB knowledge graph — but none of this knowledge is currently surfaced to agents at prompt time. The v6.0 goal is to make the knowledge graph actionable by injecting contextually relevant, token-budgeted knowledge into each agent's conversation on every prompt submission.

The recommended approach is an incremental, host-side retrieval service that queries the existing Qdrant vector database (already running in Docker) via hybrid search (semantic cosine similarity + SQLite FTS5 keyword matching + recency decay). Three new npm packages are needed: `@qdrant/js-client-rest` for Qdrant access, `fastembed` for local ONNX-based embedding generation (replacing the broken Python subprocess), and `gpt-tokenizer` for fast token budget enforcement. The retrieval service should run on the host (not inside Docker) to avoid SQLite WAL lock contention with the existing ETM and ObservationWriter processes, and should be integrated into the existing Express app on port 3848 rather than creating a new service. Claude Code's `UserPromptSubmit` hook is the primary injection mechanism; other agent adapters follow as a thin adapter pattern on top of a shared HTTP endpoint.

The highest risks are context rot (semantically adjacent but task-irrelevant results actively degrade agent performance), hook latency (any retrieval over 500ms makes Claude Code feel sluggish), and stale embeddings (the embed-on-write mechanism must be built from day one, not deferred). Research from Chroma (2025) confirms that irrelevant injected context degrades LLM performance worse than no injection at all. Start with digests and insights only (~144 items, not all 700+), apply a hard similarity threshold of 0.75, and cap injected context at 800-1000 tokens initially. Prove value before scaling complexity.

## Key Findings

### Recommended Stack

The stack additions are minimal because the infrastructure is already in place. Qdrant is running in Docker with ports exposed, Express is already serving on port 3848, and the EmbeddingCache is already built for 384-dim vectors. The three additions are purpose-specific and avoid large framework dependencies like LangChain or LlamaIndex.

**Core technologies:**
- `@qdrant/js-client-rest@^1.17.0`: TypeScript Qdrant client — official SDK with proper types, retry logic; Qdrant already running at localhost:6333
- `fastembed@^2.1.0`: Local ONNX embedding generation — replaces broken Python subprocess, runs in-process at <100ms, maintained by Qdrant team, compatible with existing EmbeddingCache (384-dim)
- `gpt-tokenizer@^3.4.0`: Token budget enforcement — pure JS, synchronous, ~1ms per call, necessary because the hook fires on every prompt and cannot afford API-based token counting
- `express` (existing): Extend existing SSE server on port 3848 with `/api/retrieve` and `/api/embed` routes — zero new dependencies
- `better-sqlite3` (existing): Read-only SQLite access from retrieval service, already used by ObservationWriter

**Critical constraint:** fastembed requires a glibc-based Node.js Docker image (Debian), not Alpine. Verify the existing Dockerfile base image before assuming compatibility. Pre-download the ONNX model (~25MB) during Docker build to avoid cold-start delay.

**What NOT to add:** LangChain, LlamaIndex, separate vector databases, OpenAI/Anthropic embedding APIs, or a new standalone microservice.

### Expected Features

Research converges on a clear two-phase feature set. The Anthropic context engineering guidance, Mem0 architecture paper, Zep/Graphiti research, and Mastra observational memory benchmarks all agree: retrieval quality and token budget discipline are the foundation; everything else is enhancement.

**Must have (table stakes):**
- Embedding pipeline for all knowledge tiers — nothing works without vectors in Qdrant
- Hybrid retrieval (semantic + keyword + recency) — pure semantic retrieval alone achieves only 78% recall vs 91% for hybrid (Pinecone/Superlinked benchmarks)
- Token budget enforcement — the 10,000 char hook cap is a hard wall; inject 800-1000 tokens initially
- Retrieval HTTP endpoint — agent-agnostic API that all adapters call
- Context formatting and assembly — structured markdown with tier headers, not raw text dumps
- Claude UserPromptSubmit hook adapter — primary agent, must work first
- Incremental embedding on write — new observations must be retrievable within the same session

**Should have (differentiators):**
- Tier-weighted scoring — insights (1.5x) outrank digests (1.2x) outrank observations (0.8x) per token of budget
- Working memory template — auto-generated from KG state, ~500 tokens, injected as fixed prefix
- Agent-specific relevance profiles — soft scoring biases per agent (Claude: architecture/pitfalls, Copilot: code conventions)
- Deduplication and conflict resolution — when multi-tier results overlap, keep higher-tier item
- Cross-agent continuity — handoff context when switching agents mid-task
- Additional agent adapters (Copilot, OpenCode, Mastra)

**Defer (v2+):**
- KG graph traversal augmentation — high complexity, marginal benefit until KG has richer relationships
- Feedback signal collection — requires weeks of usage volume before signals are meaningful
- LLM-based reranking — adds 200-500ms latency; only if lightweight scoring proves insufficient

### Architecture Approach

The architecture is host-side first. The retrieval service runs on the host (not inside Docker) because SQLite WAL locks make concurrent Docker/host access unreliable, and host-side placement eliminates a Docker network hop from the hook's critical path. Qdrant and Redis stay in Docker but are already port-forwarded to localhost. The hook script is intentionally thin — parse stdin, POST to retrieval service, write JSON to stdout, exit — with all logic in the persistent HTTP service.

**Major components:**
1. **Embedding Daemon** (host, new) — polls SQLite for unembedded knowledge items every 30s, generates vectors via fastembed, upserts to Qdrant with embedded_at timestamp tracking
2. **Retrieval Service** (host, port 3848 existing Express, new routes) — accepts POST /retrieve, performs parallel Qdrant semantic search across 4 collections + SQLite FTS5, applies hybrid scoring, enforces token budget, returns assembled markdown context block
3. **Injection Hook** (host, new) — thin Node.js script wired to UserPromptSubmit; calls retrieval service with 2s timeout; exits 0 on any failure (fail-open)
4. **Working Memory Store** (host, new) — auto-generated from KG state at query time, ~500 tokens, injected as fixed prefix
5. **Qdrant** (Docker, existing) — 4 new collections: knowledge_observations, knowledge_digests, knowledge_insights, knowledge_kg_entities (all 384-dim Cosine)
6. **Agent Adapters** (host, thin wrappers) — per-agent scripts translating agent hook mechanism to the shared retrieval HTTP API

**Build order:** Embedding Pipeline → Retrieval Service → Claude Hook (strict sequential critical path). Working Memory and additional adapters follow after.

### Critical Pitfalls

1. **Context rot from semantically adjacent but irrelevant results** — Apply similarity threshold of 0.75; implement result diversity (max 1 result per topic cluster); add keyword-overlap gate after vector search. Start with digests/insights only (144 items). Log every retrieval for manual sampling.

2. **Hook latency makes Claude Code unusable** — Hook must complete in <500ms total. Persistent HTTP service (already done via existing Express app), not per-call subprocess. Fast-path: skip retrieval for prompts under 20 chars or noise patterns. Cache last 10 query embeddings. Time p95 on 20 consecutive invocations before shipping.

3. **Token budget overshoot buries injected context** — Start at 800-1000 tokens, not the 2,500-token hook ceiling. Inject digests and insights first; raw observations only as fallback. Place context at the top of the prompt. Include a one-line instruction for the agent to ignore if not relevant.

4. **Stale embeddings serve outdated knowledge** — Embed on write from day one. Store content hash per Qdrant point. Health endpoint must report oldest embedding age. Nightly reconciliation compares Qdrant point count against source counts.

5. **Embedding model mismatch destroys retrieval quality** — Pin model (name + version + dimensions) in a single config value. Store model metadata in Qdrant collection definition. Verify model matches at query time. Use new collection for migration, never overwrite in place.

## Implications for Roadmap

Based on the strict dependency chain discovered in research, the work falls into 6 phases with a 3-phase critical path.

### Phase 1: Embedding Pipeline
**Rationale:** Everything depends on vectors existing in Qdrant. This is the true foundation with no upstream dependencies.
**Delivers:** All knowledge tiers embedded in Qdrant; embed-on-write hooks wired to ETM and ObservationWriter; nightly reconciliation job; embedded_at tracking per knowledge item; project-scoped Qdrant payloads
**Addresses:** Table stakes: embedding pipeline + incremental embedding on write
**Avoids:** Pitfall 4 (stale embeddings), Pitfall 7 (model mismatch — centralized config from day one), Pitfall 11 (start with digests/insights only), Pitfall 9 (project tagging in payload)

### Phase 2: Retrieval Service
**Rationale:** All agent adapters call the same HTTP endpoint. Build it once, correctly, before connecting any agent.
**Delivers:** POST /retrieve with hybrid scoring (semantic + FTS5 + recency + tier weights), token budget enforcement, structured markdown assembly, /health endpoint reporting embedding freshness
**Uses:** @qdrant/js-client-rest, fastembed, gpt-tokenizer, better-sqlite3, existing Express on port 3848
**Avoids:** Pitfall 1 (similarity threshold + keyword gate), Pitfall 2 (token budget at 800-1000 tokens), Pitfall 8 (max 3 retrieval stages), Anti-Pattern 3 (4 separate collections), Anti-Pattern 4 (no LLM in hot path)

### Phase 3: Claude Code Hook Adapter
**Rationale:** Claude Code is the primary agent with the most well-defined injection mechanism. Prove end-to-end value here before building other adapters.
**Delivers:** injection-hook.js wired in .claude/settings.local.json; 2s timeout with fail-open; fast-path skip for short/noise prompts; circuit breaker; integration test harness (10 real prompts, A/B comparison)
**Avoids:** Pitfall 3 (latency — thin curl wrapper), Pitfall 6 (cold start — circuit breaker + graceful degradation), Pitfall 5 (Claude-specific format only, no universal adapter)

### Phase 4: Working Memory and Agent Profiles
**Rationale:** Once the retrieval loop is proven with Claude, enhance quality with working memory and per-agent scoring profiles.
**Delivers:** Auto-generated working-memory from KG state (~500 tokens, regenerated at query time); per-agent scoring bias configuration; deduplication logic in context assembly
**Avoids:** Pitfall 10 (under 500 tokens, 100% auto-generated, no manual maintenance)

### Phase 5: Additional Agent Adapters
**Rationale:** Claude hook is the reference implementation. Other adapters are thin wrappers on the same retrieval service.
**Delivers:** Mastra MCP tool adapter; OpenCode plugin/agent file adapter; Copilot copilot-instructions.md refresh daemon; cross-agent continuity (handoff context on session start)
**Avoids:** Pitfall 5 (per-agent format adapters, not a universal format)

### Phase 6: Feedback Loop Hardening
**Rationale:** Optimization of Phase 1. Replace 30-second poll with event-driven embedding on observation write. Correctness hardening, not new functionality.
**Delivers:** Event-driven embed-on-write; consolidator integration for immediate digest/insight embedding; KG entity sync on KG update
**Avoids:** Pitfall 4 (closes the gap between poll-based and event-driven embedding)

### Phase Ordering Rationale

- Phases 1 → 2 → 3 are strictly sequential: embeddings must exist before retrieval service, retrieval service must exist before hook. No parallelism possible on critical path.
- Phase 4 can begin immediately after Phase 2 (no dependency on Phase 3).
- Phase 5 can begin immediately after Phase 3 (reference implementation proven).
- Phase 6 can begin immediately after Phase 1 (it is an optimization of Phase 1).
- Each phase has a concrete, independently testable deliverable. This avoids the over-engineering trap (Pitfall 8) where complexity accumulates before value is proven.

### Research Flags

Phases needing deeper research during planning:
- **Phase 5 (OpenCode adapter):** @opencode-ai/plugin v1.3.17 is installed but the plugin lifecycle and context injection hooks need runtime validation before planning implementation. Short research spike (30 min) required before writing Phase 5 OpenCode tasks.
- **Phase 5 (Copilot adapter):** Official Copilot docs only document copilot-instructions.md (session-level). Per-prompt dynamic injection may not be supported. Confirm scope before planning Phase 5 Copilot tasks — may be a refresh daemon, not a hook.

Phases with standard patterns (no research-phase needed):
- **Phase 1:** fastembed + Qdrant upsert is documented, model is pinned, schema is decided.
- **Phase 2:** Hybrid RAG with Qdrant multi-collection search is well-documented. Express route extension is trivial.
- **Phase 3:** UserPromptSubmit hook pattern exists in this project already. Thin wrapper + fail-open is a 50-line script.
- **Phase 4:** Auto-generation from KG state is deterministic logic, no external unknowns.
- **Phase 6:** ETM hook wiring is well-understood; event-driven vs poll is an implementation detail.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified via npm registry + Context7; existing infrastructure validated against live running services |
| Features | HIGH | Retrieval strategies and token budgeting are well-benchmarked; Copilot/OpenCode injection mechanisms are MEDIUM |
| Architecture | HIGH | Based on direct codebase analysis (live Qdrant, SQLite, docker-compose.yml); host-side placement rationale is definitive |
| Pitfalls | HIGH | Context rot supported by Chroma 2025 empirical research; hook latency by production bug reports (ruflo #1530) |

**Overall confidence:** HIGH

### Gaps to Address

- **OpenCode plugin injection API:** Plugin API surface not fully verified. During Phase 5 planning, run plugin in isolation and inspect available hooks before committing to implementation approach.
- **Copilot per-prompt injection feasibility:** If not available, Phase 5 Copilot adapter must be scoped as a refresh daemon (periodic file update), not a hook. Confirm before planning Phase 5 Copilot tasks.
- **fastembed Docker base image:** Verify existing Dockerfile base image (Alpine vs Debian) before Phase 1. fastembed requires glibc (Debian/Ubuntu), not musl libc (Alpine). A base image change is a Docker rebuild dependency.
- **gpt-tokenizer vs Claude tokenizer variance:** The ~5-10% variance between cl100k_base and Claude's tokenizer should be empirically validated during Phase 2. If variance exceeds 15%, apply a calibration multiplier.

## Sources

### Primary (HIGH confidence)
- `@qdrant/js-client-rest` npm v1.17.0 + Context7 docs — TypeScript API, collection creation, upsert, search
- `fastembed` npm v2.1.0 + fastembed-js GitHub — ONNX Runtime, model list, batch embedding
- `gpt-tokenizer` npm v3.4.0 — pure JS, cl100k_base, synchronous API
- Claude Code Hooks Reference (official) — UserPromptSubmit, additionalContext, 10K char limit
- Chroma Context Rot Research (2025) — empirical LLM degradation from semantically adjacent context
- Anthropic: Effective Context Engineering for AI Agents — token budgeting, "smallest possible set of high-signal tokens"
- Mem0 Paper (arXiv 2504.19413) — memory type taxonomy, retrieval architecture
- Zep/Graphiti Temporal Knowledge Graph (arXiv 2501.13956) — hybrid retrieval, temporal weighting
- Mastra Observational Memory Research — 94.87% LongMemEval benchmark, compression approach
- Superlinked/Pinecone Hybrid Search benchmarks — 91% recall (hybrid) vs 78% (vector-only)
- Existing codebase direct analysis — docker-compose.yml, SQLite schema (650 obs, 132 digests, 12 insights), live Qdrant query (5 collections), embedding-cache.ts, settings.local.json

### Secondary (MEDIUM confidence)
- OpenCode config docs — agent files, plugin system (plugin API surface not fully verified)
- Manus Context Engineering blog — working memory warnings, feedback loop risks
- GitHub Copilot custom instructions docs — copilot-instructions.md (per-prompt injection undocumented)

### Tertiary (LOW confidence — needs validation)
- OpenCode context management guide — third-party, not official OpenCode docs; plugin hook surface needs runtime verification

---
*Research completed: 2026-04-24*
*Ready for roadmap: yes*
