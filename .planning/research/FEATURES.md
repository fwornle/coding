# Feature Landscape: Knowledge Context Injection

**Domain:** Knowledge context injection for multi-agent coding environment
**Researched:** 2026-04-24
**Confidence:** HIGH (well-established patterns from Mem0, Zep, Mastra, Anthropic context engineering guidance)

## Table Stakes

Features users expect. Missing any of these = injection system is useless or actively harmful.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Embedding pipeline for all knowledge tiers | Cannot do semantic retrieval without embeddings. Observations, digests, insights, and KG entities must all be searchable. | MEDIUM | Qdrant already running in Docker stack. Embed on write (fire-and-forget) so retrieval is always current. Use a single embedding model (e.g., `all-MiniLM-L6-v2` or `nomic-embed-text`) for consistency. Separate Qdrant collections per tier for independent scoring. |
| Hybrid retrieval (semantic + keyword + recency) | Semantic-only misses exact identifiers (error codes, file paths, config keys). Keyword-only misses conceptual matches. Recency matters because a fix from yesterday is more relevant than one from 3 months ago. | MEDIUM | Industry consensus: hybrid with RRF fusion hits 91% recall vs 78% for vector-only (Pinecone/Superlinked benchmarks). Qdrant supports payload filtering for recency. BM25 via SQLite FTS (already built for observation dashboard). |
| Token budget enforcement | Injected context that exceeds available space causes truncation of the user's actual work, degrading agent performance. Must never blow the context window. | MEDIUM | Allocate a fixed token budget (e.g., 4K-8K tokens) for injected knowledge. Count tokens before assembly. Truncate or drop lowest-priority items to fit. Anthropic's guidance: "smallest possible set of high-signal tokens." |
| Retrieval service (HTTP endpoint) | Agent adapters need a single, agent-agnostic API to call. Without this, every agent reimplements retrieval logic. | LOW | Simple HTTP endpoint: `POST /api/knowledge/retrieve` accepting `{query, budget, agent?, filters?}`, returning formatted context block. Runs inside existing coding-services container. |
| Context formatting and assembly | Raw retrieval results are useless without assembly into a coherent, scannable block the LLM can parse. Must include source attribution so the agent knows where knowledge came from. | LOW | Render as structured markdown with headers per tier (Insights > Digests > Observations > KG Entities). Include metadata (date, source, confidence). Order by relevance score descending within each tier. |
| Claude hook adapter (UserPromptSubmit) | Claude Code is the primary agent. If injection does not work with Claude, the system has zero users. | LOW | UserPromptSubmit hook fires before processing, stdout injected as context, 10K char cap. Hook script calls retrieval endpoint with user prompt as query, prints result to stdout. Deterministic (fires every time, unlike CLAUDE.md which is advisory). |
| Incremental embedding (write-time) | Knowledge generated during a session (new observations, digests) must be retrievable within that same session. Batch-only embedding creates a stale knowledge problem. | MEDIUM | Hook into observation writer and consolidation daemon. On new observation/digest/insight creation, embed and upsert to Qdrant immediately. Idempotent upserts (use content hash as point ID). |

## Differentiators

Features that set this apart from generic RAG. These leverage the unique multi-agent, multi-tier knowledge architecture.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tier-weighted scoring | Not all knowledge is equal. An insight (distilled from many observations) is more valuable per token than a raw observation. Weight: insights > digests > KG entities > observations. | LOW | Simple multiplier on relevance scores per collection. Insights get 1.5x, digests 1.2x, KG entities 1.0x, observations 0.8x. Ensures the token budget is spent on the most distilled knowledge first. |
| Working memory template | A persistent, structured document capturing current project state (active components, recent decisions, known issues, team conventions) that is always injected alongside semantic results. Like Mastra's working memory but project-scoped, not conversation-scoped. | MEDIUM | Stored as a markdown file (`.data/working-memory.md`), manually curated or auto-updated by consolidation daemon. Injected as a fixed prefix before semantic results. Budget: ~1K tokens. Updated when insights or KG entities change. Anthropic calls this "structured note-taking." |
| Agent-specific relevance profiles | Different agents work on different tasks. Claude often does architecture work, Copilot does inline completions, OpenCode does refactoring. Each agent's injection should be biased toward its typical work patterns. | MEDIUM | Per-agent configuration with default topic weights and filter preferences. Claude: architectural patterns + pitfalls. Copilot: code conventions + API patterns. OpenCode: refactoring patterns + component structure. Not hard filtering, just soft scoring bias. |
| Knowledge graph traversal augmentation | After semantic retrieval finds relevant entities, traverse KG relationships to pull in connected entities (parent components, related sub-components, dependent patterns). | HIGH | Query Graphology graph for 1-hop neighbors of retrieved KG entities. Include parent entity context for hierarchy awareness. Deduplicate against already-retrieved items. This is what Zep's Graphiti does -- graph traversal alongside vector search. |
| Feedback signal collection | Track which injected knowledge the agent actually references in its response. Use this to improve future retrieval relevance (implicit relevance feedback). | HIGH | PostToolUse / response analysis hook. Detect when injected knowledge terms appear in agent output. Log (query, retrieved_items, referenced_items) tuples. Over time, use these signals to adjust scoring weights. Mem0 does this with their "memory reinforcement" system. |
| Cross-agent knowledge continuity | When switching from Claude to OpenCode mid-task, inject a "handoff context" summarizing what the previous agent was working on, drawing from recent observations. | MEDIUM | On session start, detect last active agent session. Retrieve last N observations from previous agent. Format as "Previous session context" block. Prevents repeating context that was already established. |
| Deduplication and conflict resolution | Multiple tiers may contain overlapping or contradictory information about the same topic (an observation says X, but a later insight says Y). Inject only the most authoritative version. | MEDIUM | During assembly, detect overlapping content via embedding similarity between retrieved items. When overlap > threshold, keep the higher-tier item (insight over observation). For contradictions, prefer the newer item. This is critical for preventing confused agent behavior. |

## Anti-Features

Features to explicitly NOT build. Each represents a common trap in knowledge injection systems.

| Anti-Feature | Why Tempting | Why Avoid | What to Do Instead |
|--------------|-------------|-----------|-------------------|
| Always-on injection for every prompt | "More context is always better" | Anthropic's context engineering guidance is clear: context rot degrades model performance as context grows. Injecting irrelevant knowledge wastes tokens and confuses the agent. Simple prompts like "list files" do not need knowledge injection. | Relevance threshold: only inject when retrieval confidence exceeds a minimum score. Short prompts (under ~20 tokens) skip injection entirely. Let the agent pull knowledge via MCP tools when it needs more. |
| LLM-based reranking at query time | "Use a cross-encoder for better relevance" | Adds 200-500ms latency per query. UserPromptSubmit hook has a timeout constraint. The latency is felt on every single prompt. Zep documents that cross-encoder reranking is their "highest computational cost" retrieval method. | Use lightweight scoring (cosine similarity + BM25 + recency decay) with static weights. Reserve LLM reranking for batch indexing, not real-time retrieval. |
| Auto-updating working memory with LLM | "Let the LLM summarize the project state automatically" | Creates a feedback loop: LLM writes context that LLM reads, amplifying any hallucinations or drift. Working memory becomes unreliable. Manus blog explicitly warns about this. | Working memory is manually curated or updated by deterministic rules (new KG entity added = update component list). Human reviews changes. LLM can propose updates, but a human approves. |
| Per-turn embedding of the user prompt | "Embed every user message for future retrieval" | User prompts are noisy, repetitive, and ephemeral ("fix the bug", "run tests", "try again"). Embedding them pollutes the vector space. The observation pipeline already distills sessions into meaningful content. | Rely on the existing observation pipeline for knowledge capture. Only embed the distilled outputs (observations, digests, insights), never raw prompts. |
| Fine-grained access control per knowledge item | "Different agents should only see certain knowledge" | Massive implementation complexity for marginal benefit. All four agents work on the same codebase. Knowledge about the codebase is universally relevant. Access control is a multi-tenant concern, not a single-project concern. | Use soft agent-specific scoring biases (differentiator above) rather than hard access control. All agents can see all knowledge, but each agent's results are weighted toward its typical needs. |
| Custom embedding model training | "Train embeddings on our codebase for better retrieval" | Requires significant training data, GPU infrastructure, ongoing retraining. Off-the-shelf models are good enough for a single-project knowledge base of ~200 entities. Premature optimization. | Use a proven general-purpose model (`all-MiniLM-L6-v2` for speed, `nomic-embed-text` for quality). Evaluate retrieval quality first. Only consider fine-tuning if retrieval quality is demonstrably poor after tuning scoring weights. |
| Streaming injection (inject as retrieval completes) | "Start injecting results as they come back to reduce latency" | Hook mechanism requires complete output before the agent processes. Partial injection creates inconsistent context. The retrieval is fast enough (sub-100ms for Qdrant) that streaming is unnecessary. | Return complete, assembled context block from the retrieval endpoint. Total latency target: under 200ms including embedding the query, searching, scoring, and formatting. |

## Feature Dependencies

```
[Embedding Pipeline]
    |
    +---> [Retrieval Service (HTTP)]
    |         |--requires--> [Hybrid Scoring (semantic + keyword + recency)]
    |         |--requires--> [Token Budget Enforcement]
    |         |--requires--> [Context Assembly & Formatting]
    |         |
    |         +---> [Claude UserPromptSubmit Hook]
    |         +---> [Copilot Adapter]
    |         +---> [OpenCode Adapter]
    |         +---> [Mastra Adapter]
    |
    +---> [Incremental Embedding (write-time)]
    |         |--requires--> [Observation Writer hook]
    |         |--requires--> [Consolidation daemon hook]
    |
    +---> [Tier-Weighted Scoring]
    |         |--enhances--> [Retrieval Service]
    |
    +---> [KG Traversal Augmentation]
              |--requires--> [Graphology graph loaded]
              |--enhances--> [Retrieval Service]

[Working Memory Template] --- independent, no retrieval dependency ---
    |--injected alongside--> [Retrieval Results]

[Agent-Specific Profiles]
    |--configures--> [Retrieval Service]

[Feedback Signal Collection]
    |--requires--> [Claude PostToolUse hook or response analysis]
    |--improves--> [Scoring Weights over time]

[Cross-Agent Continuity]
    |--requires--> [Observation store with agent metadata]
    |--enhances--> [Session Start injection]

[Deduplication & Conflict Resolution]
    |--requires--> [Multi-tier retrieval working]
    |--enhances--> [Context Assembly]
```

### Dependency Notes

- **Embedding pipeline is the foundational dependency.** Nothing works without embeddings in Qdrant. Build this first.
- **Retrieval service is the integration point.** All agent adapters depend on it. Build it second.
- **Claude hook is the first adapter.** Claude is the primary agent. Prove value here before building other adapters.
- **Working memory template is independent.** Can be built in parallel with embedding pipeline since it is a static file injection, not a retrieval feature.
- **KG traversal augmentation requires a working retrieval baseline.** Add it as an enhancement after basic retrieval is proven.
- **Feedback signals are a Phase 2+ concern.** Requires enough usage data to be meaningful. Do not build prematurely.

## MVP Recommendation

### Phase 1: Foundation (must ship together)

1. **Embedding pipeline** -- embed all existing observations, digests, insights, KG entities into Qdrant. Batch job + write-time hooks.
2. **Retrieval service** -- HTTP endpoint with hybrid search (semantic + FTS + recency), token budgeting, tier-weighted scoring, context formatting.
3. **Claude UserPromptSubmit hook** -- call retrieval service, inject results. This is the minimum to prove value.
4. **Working memory template** -- static structured document injected as prefix. Manually maintained initially.

### Phase 2: Polish and expand

5. **Agent-specific relevance profiles** -- configure per-agent scoring biases.
6. **Other agent adapters** (Copilot, OpenCode, Mastra) -- same retrieval service, different injection mechanisms.
7. **Deduplication and conflict resolution** -- clean up assembly when multi-tier results overlap.
8. **Cross-agent continuity** -- handoff context on agent switch.

### Defer

- **KG traversal augmentation** -- high complexity, marginal benefit until KG has richer relationships.
- **Feedback signal collection** -- requires usage volume to be meaningful. Revisit after 2-4 weeks of live injection.
- **LLM-based reranking** -- only if lightweight scoring proves insufficient.

## Framework Feature Comparison

How existing frameworks handle these features, informing our design.

| Feature | Mem0 | Zep/Graphiti | Mastra OM | LangChain Memory | Our Approach |
|---------|------|-------------|-----------|-----------------|--------------|
| **Retrieval** | Hybrid (vector + graph) | Hybrid (semantic + BM25 + graph traversal) | Semantic recall via embeddings | Deprecated (moved to LangGraph checkpoints) | Hybrid (semantic + FTS + recency) via Qdrant + SQLite FTS |
| **Token budgeting** | Implicit (90% token savings claimed) | Not explicit | Token thresholds for observer/reflector triggers | ConversationSummaryBuffer with max_token_limit | Explicit budget allocation with tier-weighted priority |
| **Context assembly** | API returns formatted memories | Returns ranked facts with temporal metadata | Observation block + message block in system prompt | History variable injection into prompt template | Structured markdown with tier headers, source attribution |
| **Multi-agent** | Actor-aware memories (Group-Chat v2) | Single-agent focused | Resource-scoped observations | Per-agent memory instances | Agent-specific scoring profiles, shared retrieval service |
| **Working memory** | User/agent/session scoping | Temporal knowledge graph | Working memory markdown in system prompt | ConversationBuffer (deprecated) | Static project-state document, manually curated |
| **Feedback** | Memory reinforcement via usage | Temporal invalidation (facts expire) | None (append-only observations) | None | Implicit feedback via response analysis (deferred) |
| **Write-time indexing** | Real-time extraction + embedding | Continuous graph updates | Observation on token threshold | Per-turn buffer append | Fire-and-forget embedding on observation/digest/insight creation |

### Key Takeaways from Competitors

1. **Mem0's insight:** Memory types matter. Episodic (what happened), semantic (what we know), procedural (how to do things). Our tiers map naturally: observations=episodic, digests=semantic, insights=procedural.
2. **Zep's insight:** Temporal awareness is valuable. A fact that was true last week may not be true today. Our recency scoring serves this purpose without full temporal graph complexity.
3. **Mastra's insight:** Compression is the key innovation. 5-40x compression with structured observations. We already have this via the observation pipeline. Injection is the missing piece.
4. **Anthropic's insight:** Less is more. "Smallest possible set of high-signal tokens." Aggressive filtering and budgeting beats exhaustive retrieval every time.
5. **LangChain's lesson:** Simple memory abstractions get deprecated. The industry is moving toward purpose-built retrieval systems, not generic memory wrappers.

## Multi-Agent Implications

### Unique Challenges

| Challenge | Impact | Mitigation |
|-----------|--------|------------|
| Different hook mechanisms per agent | Claude uses UserPromptSubmit (stdout injection, 10K char cap). Copilot uses VS Code extension API. OpenCode uses plugin system. Mastra uses memory providers. | Single retrieval service, adapter pattern per agent. Adapters are thin -- just hook wiring + HTTP call + format output. |
| Varying context window sizes | Claude Code: 200K tokens. Copilot: varies by model. OpenCode: varies. Mastra: configurable. | Token budget is a parameter to the retrieval service. Each adapter passes its agent's available budget. Default: 4K tokens. |
| Agent switching mid-task | User switches from Claude to OpenCode. New agent has no context about current task. | Cross-agent continuity feature (Phase 2). Detect agent switch, inject recent observations from previous agent. |
| Concurrent agent sessions | User might run Claude and Copilot simultaneously on different tasks. | Agent isolation by default. Each hook invocation is independent. No shared state between concurrent sessions. |

### Agent-Specific Adapter Notes

| Agent | Injection Mechanism | Max Context | Latency Constraint | Notes |
|-------|--------------------|----|-------|-------|
| Claude Code | UserPromptSubmit hook (stdout to context) | 10,000 chars (~2,500 tokens) | Hook timeout (configurable) | Primary agent. Build first. Hook fires every prompt -- need relevance threshold to avoid noise. |
| GitHub Copilot | VS Code extension API or custom LSP adapter | TBD (model-dependent) | Must not delay completion suggestions | Copilot context injection is less documented. May need workspace-level context file instead of per-prompt injection. |
| OpenCode | Plugin system / custom middleware | TBD | Similar to Claude | OpenCode has `@mastra/opencode` plugin. May be able to inject via Mastra memory provider. |
| Mastra/Mastracode | Memory provider + system prompt injection | Configurable | Built into Mastra lifecycle | Mastra already has working memory + semantic recall. Our retrieval service could serve as a custom memory provider. |

## Sources

- [Anthropic: Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) -- HIGH confidence, official engineering guidance
- [Mem0 Paper (arXiv)](https://arxiv.org/abs/2504.19413) -- HIGH confidence, peer-reviewed architecture
- [Mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) -- MEDIUM confidence, vendor perspective but well-sourced
- [Zep/Graphiti Temporal Knowledge Graph (arXiv)](https://arxiv.org/html/2501.13956v1) -- HIGH confidence, peer-reviewed
- [Mastra Observational Memory Research](https://mastra.ai/research/observational-memory) -- HIGH confidence, benchmarked (94.87% LongMemEval)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- HIGH confidence, official documentation
- [Superlinked/Pinecone: Hybrid Search + Reranking](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking) -- HIGH confidence, benchmarked
- [Manus: Context Engineering Lessons](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus) -- MEDIUM confidence, practitioner report
- [Agno: Context Engineering in Multi-Agent Systems](https://www.agno.com/blog/context-engineering-in-multi-agent-systems) -- MEDIUM confidence, framework vendor
- [Best AI Agent Memory Frameworks 2026](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/) -- MEDIUM confidence, survey article

### Confidence Notes

| Area | Confidence | Notes |
|------|------------|-------|
| Retrieval strategies (hybrid search) | HIGH | Well-benchmarked, production-proven across Qdrant, Pinecone, Zep |
| Token budgeting | HIGH | Anthropic guidance + Mastra implementation + industry consensus |
| Claude hook mechanism | HIGH | Official docs, 10K char cap documented, deterministic execution |
| Multi-agent injection | MEDIUM | Claude hook is well-documented; Copilot/OpenCode injection mechanisms less clear |
| Feedback signals | MEDIUM | Mem0 and Zep do this in production; our implementation would be custom |
| Working memory patterns | HIGH | Anthropic + Mastra + OpenAI Agents SDK all converge on structured state documents |

---
*Feature research for: Knowledge Context Injection (v6.0)*
*Researched: 2026-04-24*
