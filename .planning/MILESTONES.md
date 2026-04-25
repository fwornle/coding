# Milestones

## v6.0 v6.0 (Shipped: 2026-04-25)

**Phases completed:** 7 phases, 11 plans, 25 tasks

**Key accomplishments:**

- fastembed ONNX embedding service with all-MiniLM-L6-v2 (384-dim), content hashing for idempotency, and Qdrant collection management for 4 knowledge tiers
- One-shot CLI backfill of 1464 knowledge items (645 observations, 132 digests, 12 insights, 675 KG entities) into 4 Qdrant collections with content-hash idempotency
- Redis pub/sub event bus wiring ObservationWriter to embedding listener for automatic Qdrant upserts within seconds of observation creation
- Hybrid retrieval engine combining RRF-fused semantic (Qdrant) + keyword (FTS5/LIKE) + recency search with tier-weighted scoring and gpt-tokenizer budget enforcement
- POST /api/retrieve endpoint wired into health API server with input validation, latency tracking, and Docker bind-mount for retrieval modules
- UserPromptSubmit hook injecting Qdrant-retrieved knowledge (insights, digests, entities, observations) as system-reminder context into Claude Code conversations with fail-open design
- Shared fail-open HTTP retrieval client with context-aware scoring (project 1.15x, cwd 1.10x, recent_files 1.20x cumulative boosts)
- Migrated Claude hook to global settings with shared retrieval client; created OpenCode/Copilot/Mastra session-start adapters; wired all into agent launch pipeline with fail-open timeout
- Live working memory from VKB KG entities + STATE.md frontmatter, token-budgeted to 300 tokens, prepended to every retrieval response
- Per-agent RRF scoring profiles with tier weight multipliers flowing from all four adapters through retrieval service to fusion layer
- Session state writer on agent exit with cross-agent injection via working memory using 2-hour staleness window and fail-open design

---

## v4.0 Mastra Integration & LSL Observational Memory (Shipped: 2026-04-05)

**Phases completed:** 4 phases, 11 plans, 22 tasks

**Key accomplishments:**

- LLM proxy bridge server ported from OKM, delegating to existing lib/llm/LLMService with network-adaptive routing. Token budget and plugin config files created.
- Mastra OpenCode install/uninstall/test functions added to lifecycle scripts with Node 22+ gate, LibSQL storage at .observations/, and 5-check smoke test
- Mastracode agent adapter, launch wrapper, and --mastra CLI flag enabling `coding --mastra` to start mastracode in standard tmux layout
- Mastra agent registered in tmux statusline (magenta M: prefix), health monitor, process supervisor, and remediation with non-blocking LLM proxy checks
- MastraTranscriptReader watching NDJSON lifecycle hook transcripts with full ETM pipeline integration -- mastra conversations flow through exchange extraction, classification, and LSL output
- hooks.json populated with 6 lifecycle hook commands writing NDJSON transcript events to .observations/transcripts/ for MastraTranscriptReader consumption
- Three-format transcript normalizer (Claude JSONL, Copilot events, specstory markdown) with LLM-proxy-routed observation writer and CLI skeleton
- Claude JSONL and Copilot events.jsonl converter handlers with hardened parsers, exchange grouping, and streaming progress reporting
- Batch .specstory converter with SHA-256 manifest idempotency, chronological processing, and --force override
- ETM fires per-exchange observations via ObservationWriter (fire-and-forget) and health API serves GET /api/observations with agent/time/project/FTS5 filtering
- Observations dashboard with sidebar filters, agent-colored expandable cards, pagination, and 30s auto-refresh via react-router-dom routing

---

## v2.1 Wave Pipeline Quality Restoration (Shipped: 2026-03-10)

**Phases completed:** 6 phases (9-14), 20 plans
**Audit status:** tech_debt (Plan 14-03 deferred — workflow state management needs redesign before E2E verification is meaningful)

**Key accomplishments:**

- Full agent pipeline integration (semantic analysis, persistence, insight generation, ontology classification) into wave architecture
- All 6 KG operators restored (conv, aggr, embed, dedup, pred, merge)
- Content quality gate with QA validation and coordinator retry-with-feedback
- Pipeline observability with trace modal (LLM counts, timing, model info, data flow)
- Code-graph-rag integration as code-evidence source for wave agents
- Relationship diagrams and constraint validation gate (Plans 14-01, 14-02)

**Deferred to v3.0:**

- Plan 14-03: Wave 4 diagram wiring + Docker E2E verification
- Workflow state management redesign (fundamental architecture issue)
- Dashboard substep coloring (blocked by state management issues)
- "Batch" label rename (cosmetic, bundled with state machine work)

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 9 | Agent Pipeline Integration | 3/3 | Complete (2026-03-07) |
| 10 | KG Operations Restoration | 5/5 | Complete (2026-03-08) |
| 11 | Content Quality Gate | 3/3 | Complete (2026-03-09) |
| 12 | Pipeline Observability | 4/4 | Complete (2026-03-09) |
| 13 | Code Graph Agent Integration | 3/3 | Complete (2026-03-09) |
| 14 | Documentation Generation | 2/3 | Partial (14-03 deferred) |

## v1.0 UKB Pipeline Fix & Improvement (Shipped: 2026-03-03)

**Phases completed:** 2 phases (1 + 4), 9 plans
**Audit status:** tech_debt (12/12 executed requirements satisfied, Phases 2-3 deferred)

**Key accomplishments:**

- Multi-format pattern extraction parser (JSON + markdown + LLM retry) with generic name filtering
- Correct PascalCase entity naming across all 7 naming paths
- LLM-synthesized observations in all 4 observation creation methods
- Configurable analysisDepth parameter (surface/deep/comprehensive)
- TypeScript interfaces extended with hierarchy fields across 4 systems (KGEntity, SharedMemoryEntity, VKB Entity/Node)
- Component manifest (8 L1 + 5 L2 components) and ontology types (Component/SubComponent)

**Deferred to future milestones:**

- Phase 2: Insight Generation & Data Routing (7 requirements)
- Phase 3: Significance & Quality Ranking (2 requirements)

**Known gaps:**

- SC-2 (hierarchy field round-trip persistence) deferred to Phase 5
- 4 human verification items pending runtime confirmation

### Phases

| Phase | Name | Plans | Status |
|-------|------|-------|--------|
| 1 | Core Pipeline Data Quality | 7/7 | Complete (2026-03-02) |
| 2 | Insight Generation & Data Routing | 0/? | Deferred |
| 3 | Significance & Quality Ranking | 0/? | Deferred |
| 4 | Schema & Configuration Foundation | 2/2 | Complete (2026-03-01) |
