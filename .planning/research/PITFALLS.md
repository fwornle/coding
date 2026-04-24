# Domain Pitfalls: Knowledge Context Injection

**Domain:** Automated knowledge retrieval and injection into multi-agent coding conversations
**Researched:** 2026-04-24
**Confidence:** HIGH (verified via Claude Code hooks docs, Chroma context rot research, Qdrant production patterns, existing codebase analysis)

---

## Critical Pitfalls

Mistakes that cause rewrites, user frustration, or silent quality degradation.

### Pitfall 1: Context Rot from Semantically Similar but Irrelevant Results

**What goes wrong:**
Qdrant returns knowledge chunks that are semantically close to the query but factually irrelevant to the current task. For example, querying "Docker build timeout" retrieves observations about Docker networking, Docker volumes, and Docker compose syntax -- all semantically adjacent but useless for the specific problem. The LLM treats these as authoritative context and produces worse answers than it would with no injection at all.

**Why it happens:**
Chroma's 2025 research across 18 major LLMs found that semantically similar but irrelevant content actively misleads models -- the degradation is worse than simply adding random filler tokens. Embedding similarity conflates topical relatedness with task relevance. The existing 558 observations span many overlapping topics (Docker, LSL, knowledge graph, agents) that share vocabulary and concepts.

**Consequences:**
- Agent responses become confidently wrong, citing injected context as justification
- Users lose trust in the system and disable injection
- Debugging becomes harder because the error source (bad retrieval) is invisible in the conversation

**Warning signs:**
- Agent references knowledge that seems tangentially related but misses the point
- Retrieval returns 5+ results from the same topic cluster with no diversity
- User manually corrects the agent about something the injected context "told" it

**Prevention:**
1. Use hybrid retrieval: combine vector similarity with keyword/BM25 matching and recency weighting. Pure semantic search alone is insufficient.
2. Set a hard similarity threshold (start at 0.75, tune empirically) -- return fewer results rather than padding with marginal matches.
3. Implement result diversity: if top-5 results all come from the same entity/digest cluster, deduplicate to top-1 from that cluster and fill remaining slots from other clusters.
4. Add a "relevance gate": after retrieval, run a fast scoring pass (keyword overlap between query and result) to filter out topically adjacent but task-irrelevant results.

**Detection:**
Log every retrieval alongside the query. Periodically sample 20 query-result pairs and manually score relevance (1-5). If average drops below 3.5, the retrieval pipeline needs tuning.

**Phase to address:** Phase 1 (embedding pipeline) and Phase 2 (retrieval service). The embedding model and similarity threshold choices in Phase 1 directly determine retrieval quality in Phase 2.

---

### Pitfall 2: Token Budget Overshoot Degrades Agent Performance

**What goes wrong:**
Injecting 2K tokens of knowledge context sounds small, but it compounds with existing context: CLAUDE.md (~4K), MEMORY.md (~6K), system prompts, conversation history, and tool results. The injected knowledge lands in the prompt's "middle zone" where LLM attention is weakest. Research shows LLMs pay most attention to the beginning and end of input, with significant drop-off in the middle. Injected context gets buried and ignored -- or worse, confuses the model.

**Why it happens:**
The 2K budget was set in isolation without accounting for what else occupies the context window. Claude Code's UserPromptSubmit hook cap is 10,000 characters (~2,500 tokens), which tempts implementers to use the full budget. Additionally, different knowledge tiers (observations, digests, insights, KG entities) have different information densities -- 2K tokens of raw observations is far less useful than 2K tokens of curated digests.

**Consequences:**
- Agent ignores injected context entirely (wasted computation, no harm)
- Agent gets confused by contradictory or redundant injected snippets
- Performance degrades unpredictably -- some queries work fine, others break

**Warning signs:**
- Agent never references injected context in its responses
- Agent responses become longer and less focused after enabling injection
- Quality difference between injection-on and injection-off is negligible or negative

**Prevention:**
1. Start at 800-1000 tokens, not 2K. Measure impact before increasing.
2. Prioritize information density: inject digests and insights first (pre-compressed), raw observations only as fallback.
3. Place injected context at the top of the prompt (via `systemMessage` in hook output, not `additionalContext`) to avoid the "lost in the middle" problem.
4. Structure as a labeled block: `## Relevant Project Knowledge\n- [item]\n- [item]` -- structured lists outperform prose dumps.
5. Include a one-line instruction: "Use the following knowledge only if directly relevant to the current task. Ignore if not applicable."

**Detection:**
A/B test: run 20 identical prompts with and without injection. If injection-on produces equal or worse results, the budget is too high or retrieval quality is poor.

**Phase to address:** Phase 2 (retrieval service) -- the token budget and formatting must be tuned during retrieval service design, not after agent integration.

---

### Pitfall 3: Hook Latency Makes Claude Code Unusable

**What goes wrong:**
The UserPromptSubmit hook runs synchronously before Claude processes the prompt. If the hook calls a retrieval service that queries Qdrant, generates an embedding for the query, and formats results, latency easily reaches 2-5 seconds. This adds a noticeable pause to every single prompt submission. At 95 hooks (as documented in one production setup), cumulative latency reached 18-21 seconds per prompt.

**Why it happens:**
The hook spawns a new process for each invocation. That process must: (1) parse the prompt, (2) call an embedding API to vectorize the query, (3) query Qdrant, (4) format and rank results, (5) output JSON. Steps 2-3 involve network calls with cold-start overhead. Even with a local Qdrant, embedding generation requires an API call unless using a local model.

**Consequences:**
- Users experience a perceptible delay on every prompt (even when no relevant knowledge exists)
- Users disable the hook entirely, negating all injection value
- Claude Code issue #1530 documents this exact failure mode with 11 hooks causing ~20s delays

**Warning signs:**
- Time between pressing Enter and seeing Claude's "thinking" indicator increases
- Users report Claude Code feels "sluggish" after enabling injection
- Hook stderr logs show timeout warnings

**Prevention:**
1. Target sub-500ms total hook execution time. This is the budget for everything: process startup, embedding, retrieval, formatting.
2. Use a local embedding model (e.g., sentence-transformers running in the Docker container) instead of API calls. Eliminates network latency for query embedding.
3. Pre-compute a "session query cache": cache the last 10 query embeddings and results. If a new query is similar to a cached one, return cached results instantly.
4. Make the retrieval service a persistent HTTP server (already running in Docker) rather than spawning a new process per hook invocation. The hook script becomes a simple `curl` call.
5. Implement a fast-path: if the prompt is short (< 20 chars) or matches a known non-knowledge pattern (e.g., "yes", "continue", "/command"), skip retrieval entirely.

**Detection:**
Time the hook execution. Log `start` and `end` timestamps in the hook script. Alert if p95 exceeds 500ms.

**Phase to address:** Phase 3 (agent adapters). The retrieval service must be designed as a persistent process in Phase 2, but the latency is experienced and measured during agent integration in Phase 3.

---

### Pitfall 4: Stale Embeddings Silently Serve Outdated Knowledge

**What goes wrong:**
Knowledge evolves -- observations get new digests, entities get updated observations, insights get revised -- but their embeddings in Qdrant remain frozen at the time of initial embedding. The retrieval service returns results based on stale vectors that no longer represent the current knowledge state. Worse, the text payload in Qdrant may also be stale if not updated alongside the embedding.

**Why it happens:**
The existing `EmbeddingCache` has a 7-day TTL, which is reasonable for the UKB batch pipeline but wrong for a live retrieval system. New observations are created per-exchange via ETM, but embedding them requires an explicit pipeline step. The "feedback loop" (auto-embed on creation) is a stated v6.0 goal but is the feature most likely to be deferred or implemented incompletely.

**Consequences:**
- Agent receives outdated knowledge that contradicts recent work
- User corrected an issue yesterday but the agent still warns about it today
- Knowledge graph shows correct state, but retrieval returns the pre-correction version

**Warning signs:**
- Retrieved context references things the user fixed in recent sessions
- Embedding count in Qdrant diverges from observation/entity count in LibSQL/Graphology
- `entity-embeddings.json` last-modified date is days old despite active knowledge creation

**Prevention:**
1. Embed on write, not on read. When ETM creates an observation, immediately queue it for embedding. Use a lightweight async job queue (not the full UKB pipeline).
2. Store a content hash alongside each Qdrant point. Before serving a result, compare the stored hash against the current knowledge item's hash. If they differ, mark the result as potentially stale and re-embed in background.
3. Track a `lastEmbeddedAt` timestamp per knowledge item. The retrieval service should log warnings when serving items with embeddings older than 24 hours.
4. Run a nightly reconciliation job: compare Qdrant point count against source-of-truth counts. Flag discrepancies.

**Detection:**
Add a `/health` endpoint to the retrieval service that reports: total Qdrant points, total source items, oldest embedding age, items pending re-embedding.

**Phase to address:** Phase 1 (embedding pipeline) must include the embed-on-write mechanism. Phase 4 (feedback loop) formalizes it, but the architecture must support it from day one.

---

## Moderate Pitfalls

### Pitfall 5: Agent Format Assumptions Break Cross-Agent Injection

**What goes wrong:**
Claude Code expects hook output as JSON with `additionalContext` or plain stdout. Copilot expects context in its system prompt via workspace configuration. OpenCode has its own plugin lifecycle. Mastra has an agent middleware pattern. Building one injection format and shoehorning it into all four agents produces either: (a) format errors that silently drop context, or (b) context that appears but is poorly structured for the specific agent's prompt template.

**Why it happens:**
Each agent has fundamentally different injection points:
- **Claude Code**: UserPromptSubmit hook, 10,000 char cap, JSON or plain text stdout
- **Copilot**: .github/copilot-instructions.md or VS Code settings, no dynamic per-prompt injection
- **OpenCode**: Plugin lifecycle hooks (if available in the custom build)
- **Mastra**: Agent middleware, memory integration, system prompt injection

The temptation is to build a "universal adapter" that serves one format. But the injection mechanism (hook vs file vs middleware) and timing (per-prompt vs per-session vs static) differ fundamentally.

**Prevention:**
1. Build the retrieval service as agent-agnostic (HTTP API returning JSON). Build agent-specific adapter scripts that format the response for each agent.
2. Start with Claude Code only (best-defined injection point via hooks). Add other agents in later phases.
3. For Copilot, accept that injection is session-level (write to a file that Copilot reads), not per-prompt. This is a feature difference, not a bug.
4. Define a minimal response schema from the retrieval service: `{ items: [{ title, content, relevance, source }], tokenCount, query }`. Each adapter formats `items` appropriately.

**Phase to address:** Phase 3 (agent adapters). Do NOT attempt a universal adapter in Phase 2.

---

### Pitfall 6: Cold Start When Qdrant Is Down or Empty

**What goes wrong:**
On first run (no embeddings yet), after Docker restart (Qdrant not ready), or during embedding migration (collection recreated), the retrieval service has no data to return. If the hook treats "no results" as an error, it blocks the agent. If it returns empty context, it wastes the hook invocation. If Qdrant is completely unreachable, the hook may hang until timeout (30 seconds by default).

**Why it happens:**
The retrieval service is a new dependency in the critical path of every prompt. Unlike the existing knowledge graph (which is only accessed during UKB batch runs), the retrieval service is accessed on every user interaction. Any downtime directly impacts the user experience.

**Consequences:**
- Agent startup blocked for 30 seconds waiting for Qdrant timeout
- Users see hook error messages on every prompt until Qdrant is healthy
- First-time setup requires running the full embedding pipeline before injection works at all

**Prevention:**
1. The hook script must have a sub-1-second timeout for the retrieval call. If the service is unreachable, return exit code 0 with no context (graceful degradation). Never exit code 2 (blocking error).
2. Implement a circuit breaker: after 3 consecutive failures, stop calling the retrieval service for 60 seconds. This prevents 30-second hangs on every prompt.
3. Cache the last successful retrieval results in a local file (`~/.cache/coding-knowledge/last-results.json`). Serve from cache when the service is down, with a staleness warning.
4. On first run (empty Qdrant), the hook should detect this condition and skip injection silently -- no error, no warning, just no context. Log to stderr for debugging.

**Phase to address:** Phase 3 (agent adapters) must implement circuit breaker and graceful degradation. Phase 1 must include a "bootstrap embed" script for initial population.

---

### Pitfall 7: Embedding Model Mismatch Between Index and Query Time

**What goes wrong:**
Embeddings generated at indexing time use one model (e.g., `text-embedding-3-small` via OpenAI API). The query embedding at retrieval time uses a different model, a different version, or the same model with different parameters (e.g., different `dimensions` setting). Qdrant returns zero or garbage results because the vector spaces are incompatible.

**Why it happens:**
The existing `embedding-cache.ts` stores embeddings with a `contentHash` but does not store the model name/version used. If the embedding model is upgraded or the provider changes (e.g., switching from OpenAI to a local model for latency reasons), all existing embeddings become incompatible. The Qdrant collection's vector dimension is fixed at creation time -- inserting vectors of a different dimension causes hard errors.

**Consequences:**
- Retrieval returns zero results despite Qdrant being full of embeddings
- Retrieval returns low-quality results because similarity scores are meaningless across different vector spaces
- Qdrant throws dimension mismatch errors that crash the retrieval service

**Warning signs:**
- All similarity scores are clustered near 0.5 (random) instead of showing a clear distribution
- Retrieval quality drops after an "unrelated" change to the embedding configuration
- Qdrant errors in logs mentioning dimension mismatch

**Prevention:**
1. Store the embedding model identifier (name + version + dimensions) in Qdrant collection metadata and in the embedding cache.
2. At query time, verify the query embedding model matches the collection's model. If mismatched, return an error with a clear message ("Embedding model mismatch: collection uses X, query uses Y. Re-embed required.").
3. If switching embedding models, create a new Qdrant collection (e.g., `knowledge_v2`) and re-embed everything. Do not overwrite the existing collection until the new one is fully populated.
4. Pin the embedding model version in configuration, not in code. Make it a single config value referenced by both the indexing and query paths.

**Phase to address:** Phase 1 (embedding pipeline). The model configuration must be centralized from the start.

---

### Pitfall 8: Over-Engineering the Pipeline Before Proving Value

**What goes wrong:**
Teams build sophisticated multi-stage retrieval pipelines (query expansion, re-ranking, cross-encoder scoring, MMR diversity, reciprocal rank fusion) before validating that basic keyword search over 558 observations would already provide value. The pipeline becomes complex, fragile, and slow -- and delivers marginal improvement over a simple approach.

**Why it happens:**
RAG literature emphasizes advanced techniques. Engineers read about hybrid search, re-ranking, and query decomposition and implement all of them simultaneously. With only 558 observations and 132 digests, the dataset is small enough that simple approaches work well. Sophisticated retrieval adds value at 100K+ documents, not at 700.

**Consequences:**
- Weeks of engineering on retrieval sophistication that could have been spent on proving the basic value proposition
- Complex pipeline that is hard to debug when retrieval quality is poor
- Latency increases from multi-stage processing, compounding Pitfall 3

**Warning signs:**
- More than 3 stages in the retrieval pipeline before any user testing
- Retrieval service code exceeds 500 lines before a single agent has been connected
- Discussion of re-ranking models before measuring baseline retrieval quality

**Prevention:**
1. Phase 1 MVP: embed everything with a single model, query with cosine similarity, return top-3 results. Measure whether agents find the results useful.
2. Only add complexity when you can demonstrate (with examples) that the simple approach fails. "BM25 returns X but the user needed Y" is a valid motivation. "Best practices say to use re-ranking" is not.
3. Set a complexity budget: the retrieval path from query to results should have at most 3 stages for v6.0. Re-ranking and query expansion are v7.0 concerns.

**Phase to address:** Every phase. Resist complexity escalation throughout the milestone.

---

## Minor Pitfalls

### Pitfall 9: Privacy Leakage Through Cross-Session Context Injection

**What goes wrong:**
Observations from one project or one user's session get injected into a different project's agent conversation. The existing observation store is project-scoped (`team: "coding"`) but the retrieval service may not enforce this boundary, especially if the Qdrant collection is shared across projects.

**Prevention:**
1. Tag every Qdrant point with a `project` metadata field. Filter by project at query time.
2. Never embed secrets, API keys, or credentials into Qdrant. The existing redaction pipeline (`.specstory/config/redaction-patterns.json`) should be applied before embedding.
3. The retrieval service must accept a `project` parameter and refuse to serve unscoped queries.

**Phase to address:** Phase 1 (embedding pipeline) -- project tagging must be built into the embedding schema.

---

### Pitfall 10: Working Memory Template Becomes a Maintenance Burden

**What goes wrong:**
The "working memory template" (persistent structured project state document) sounds useful but becomes a manually maintained artifact that drifts from reality. If auto-updated, the update logic is complex and error-prone. If manually maintained, users stop updating it within a week.

**Prevention:**
1. Start with zero manual maintenance: the working memory template should be 100% auto-generated from knowledge graph state (active entities, recent observations, current project state).
2. Keep it under 500 tokens. It is a "project snapshot," not a "project encyclopedia."
3. Regenerate it on demand (when the hook fires) rather than maintaining a persistent file. This avoids staleness entirely.

**Phase to address:** Phase 4 (working memory). Do NOT over-invest in this before the core retrieval loop is proven.

---

### Pitfall 11: Embedding All Knowledge Tiers Equally

**What goes wrong:**
Treating observations, digests, insights, and KG entities as equals in the embedding pipeline wastes compute and pollutes retrieval. Raw observations are noisy and repetitive (558 items, many overlapping). Digests are already compressed summaries. Insights are high-level patterns. Embedding all 700+ items with equal priority creates a retrieval pool dominated by low-value observations.

**Prevention:**
1. Embed in priority order: insights first, then digests, then KG entity summaries, then observations.
2. Weight results by tier: an insight match at 0.70 similarity should rank above an observation match at 0.85 similarity.
3. Consider not embedding raw observations at all in v6.0. Digests already compress 4-5 observations each -- embed the digest, not the sources.

**Phase to address:** Phase 1 (embedding pipeline) -- tier prioritization is an embedding-time decision.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Embedding pipeline (Phase 1) | Embedding all 558 observations individually wastes compute and creates noise | Start with digests + insights only (~144 items). Add observations only if retrieval quality is insufficient |
| Embedding pipeline (Phase 1) | Choosing an API-based embedding model adds latency and cost for every query | Use a local model (e.g., `all-MiniLM-L6-v2` via sentence-transformers in Docker) for query-time embedding. API model acceptable for batch indexing |
| Retrieval service (Phase 2) | Building the service as a standalone process that must be separately started/monitored | Integrate into the existing coding-services Docker container. One more HTTP endpoint, not one more service |
| Retrieval service (Phase 2) | Returning raw text without structure | Return structured JSON with title/content/source/relevance fields. Let agent adapters format |
| Agent adapters (Phase 3) | Trying to support all 4 agents simultaneously | Ship Claude Code hook first. Other agents in subsequent phases |
| Agent adapters (Phase 3) | Not testing with real conversations | Build a test harness: 10 real prompts from recent sessions, measure retrieval relevance and agent response quality with/without injection |
| Feedback loop (Phase 4) | Embedding every new observation synchronously blocks ETM | Queue embeddings asynchronously. A 30-second delay between observation creation and embedding availability is acceptable |
| Working memory (Phase 4) | Over-investing in a complex template system | Auto-generate from KG state. If it takes more than 50 lines of code, it is over-engineered |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Hook process spawn overhead | 200-500ms added to every prompt just from process creation | Make hook a thin `curl` wrapper calling a persistent service | Immediately on first use |
| Embedding API cold start | First query after idle period takes 3-5 seconds | Keep embedding model warm in Docker container; use local model | After container restart or 10+ minutes of inactivity |
| Qdrant cold query | First vector search after restart is slow while index loads into memory | Pre-warm Qdrant on container start with a dummy query | After Docker restart |
| Full-text search fallback storm | When vector search returns poor results, falling back to FTS on every query adds load | Cache FTS results; only fall back when vector similarity < threshold | Under heavy concurrent agent use (unlikely for single-user) |

## "Looks Done But Isn't" Checklist

- [ ] **Retrieval works without injection**: Verify the retrieval HTTP endpoint returns correct results via `curl` before connecting any agent hook
- [ ] **Hook returns in < 500ms**: Time 20 consecutive hook invocations. p95 must be under 500ms
- [ ] **Graceful degradation verified**: Kill Qdrant, submit a prompt to Claude Code. The agent must work normally (no error, no delay)
- [ ] **Embedding model matches**: Query a known item. Verify similarity score is > 0.8, not clustered around 0.5
- [ ] **Project scoping works**: If multiple projects exist, verify retrieval only returns items from the current project
- [ ] **Token budget respected**: Measure the actual token count of injected context across 20 queries. Must stay under the budget
- [ ] **Stale detection works**: Update an observation in LibSQL, verify the retrieval service eventually returns the updated version (not the old embedding's text)
- [ ] **Agent actually uses the context**: In at least 5 of 10 test queries where relevant knowledge exists, the agent's response should reference or reflect the injected knowledge

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Context rot / irrelevant results | LOW | Raise similarity threshold, add keyword filter, re-test. No data loss |
| Token budget overshoot | LOW | Reduce budget in hook config, switch to digest-only retrieval. Immediate effect |
| Hook latency | MEDIUM | Refactor hook from process-per-call to persistent service + curl wrapper. Requires code change |
| Stale embeddings | MEDIUM | Run full re-embedding job (batch process all knowledge items). Takes minutes, not hours at current scale |
| Embedding model mismatch | HIGH | Recreate Qdrant collection, re-embed everything with consistent model. All existing embeddings are invalidated |
| Over-engineered pipeline | HIGH | Simplify by removing stages. Difficult because each stage has its own tests, config, and dependencies |

## Sources

- [Context Rot: How Increasing Input Tokens Impacts LLM Performance (Chroma, 2025)](https://research.trychroma.com/context-rot) -- empirical evidence that more context degrades quality
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) -- 10,000 char cap, timeout behavior, additionalContext format
- [Hooks causing ~20s latency (ruflo #1530)](https://github.com/ruvnet/ruflo/issues/1530) -- real-world hook latency issue with 11+ hooks
- [UserPromptSubmit hooks not firing in git worktree (claude-code #49989)](https://github.com/anthropics/claude-code/issues/49989) -- hook reliability issue
- [RAG in Production: What Actually Breaks (Medium, 2025)](https://alwyns2508.medium.com/retrieval-augmented-generation-rag-in-production-what-actually-breaks-and-how-to-fix-it-5f76c94c0591)
- [Common RAG Mistakes (ChatNexus)](https://articles.chatnexus.io/knowledge-base/common-retrieval-augmented-generation-rag-implementation-mistakes-and-how-to-avoid-them/)
- [Seven RAG Pitfalls (Label Studio)](https://labelstud.io/blog/seven-ways-your-rag-system-could-be-failing-and-how-to-fix-them/)
- [Why 72% of Enterprise RAG Implementations Fail](https://ragaboutit.com/why-72-of-enterprise-rag-implementations-fail-in-the-first-year-and-how-to-avoid-the-same-fate/)
- [Context Engineering for Multi-Agent LLM Code Assistants (arXiv 2508.08322)](https://arxiv.org/abs/2508.08322)
- [Context Engineering for Coding Agents (Martin Fowler)](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Qdrant Vector Search in Production](https://qdrant.tech/articles/vector-search-production/)
- Existing codebase: `embedding-cache.ts` (7-day TTL, content hash), `.data/observation-export/metadata.json` (558 obs, 132 digests, 12 insights), `.data/entity-embeddings.json` (1553 lines)

---
*Pitfalls research for: Knowledge context injection in multi-agent coding environment (v6.0)*
*Researched: 2026-04-24*
