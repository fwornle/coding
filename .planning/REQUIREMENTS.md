# Requirements: Knowledge Context Injection (v6.0)

**Defined:** 2026-04-24
**Core Value:** A self-learning coding environment that captures every session, builds knowledge, prevents mistakes, and makes observations browsable -- across all AI coding agents.

## v1 Requirements

Requirements for v6.0 milestone. Each maps to roadmap phases.

### Embedding Pipeline

- [ ] **EMBED-01**: All existing observations (558) are embedded into Qdrant with metadata (agent, project, date, quality)
- [ ] **EMBED-02**: All existing digests (132) are embedded into Qdrant with metadata (date, theme, agents, quality)
- [ ] **EMBED-03**: All existing insights (12) are embedded into Qdrant with metadata (topic, confidence, digestIds)
- [ ] **EMBED-04**: All existing KG entities (160+) are embedded into Qdrant with metadata (type, level, parentId)
- [ ] **EMBED-05**: New observations/digests/insights are embedded automatically on creation (write-time hook)
- [ ] **EMBED-06**: Embedding model is pinned and versioned, using fastembed with all-MiniLM-L6-v2 (384-dim)

### Retrieval Service

- [ ] **RETR-01**: HTTP endpoint accepts query string and returns token-budgeted relevant knowledge
- [ ] **RETR-02**: Hybrid retrieval combines semantic search (Qdrant) + keyword search (SQLite FTS) + recency weighting
- [ ] **RETR-03**: Tier-weighted scoring prioritizes insights > digests > KG entities > observations
- [ ] **RETR-04**: Token budget enforcement caps injected context (configurable, default ~1000 tokens)
- [ ] **RETR-05**: Context assembly formats results as structured markdown with source attribution
- [ ] **RETR-06**: Relevance threshold prevents injection of low-confidence results (configurable, default 0.75)
- [ ] **RETR-07**: Service responds in <500ms p95 latency

### Agent Adapters

- [ ] **HOOK-01**: Claude Code UserPromptSubmit hook calls retrieval service and injects results as system-reminder context
- [ ] **HOOK-02**: Claude hook fails open -- if retrieval is down or slow, agent proceeds without injection
- [ ] **HOOK-03**: Short prompts (<20 tokens) skip injection to avoid noise on simple commands
- [ ] **HOOK-04**: OpenCode adapter injects knowledge via plugin system or config-based context
- [ ] **HOOK-05**: Copilot adapter injects knowledge via workspace context file or VS Code extension

### Working Memory

- [ ] **WMEM-01**: Persistent working memory template captures current project state, conventions, known issues
- [ ] **WMEM-02**: Working memory is injected as a fixed prefix alongside retrieval results
- [ ] **WMEM-03**: Working memory stays under 500 tokens

### Agent Profiles & Continuity

- [ ] **PROF-01**: Per-agent scoring profiles bias retrieval toward each agent's typical work patterns
- [ ] **PROF-02**: Cross-agent continuity injects recent observations from previous agent on agent switch

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Advanced Retrieval

- **ADVR-01**: KG traversal augmentation -- after semantic retrieval, traverse graph relationships to pull in connected entities
- **ADVR-02**: Feedback signal collection -- track which injected knowledge the agent actually references
- **ADVR-03**: LLM-based reranking -- cross-encoder reranking for higher retrieval precision
- **ADVR-04**: Deduplication and conflict resolution across tiers

### Additional Agents

- **AGNT-01**: Mastra adapter -- integrate with Mastra's native memory provider system

## Out of Scope

| Feature | Reason |
|---------|--------|
| Custom embedding model training | Premature optimization -- off-the-shelf models sufficient for ~900 items |
| Per-turn prompt embedding | Pollutes vector space -- observation pipeline already distills sessions |
| LLM-based auto-update of working memory | Feedback loop risk -- hallucinations amplify over time |
| Always-on injection for every prompt | Context rot -- relevance threshold + short prompt skip handles this |
| Fine-grained access control per knowledge item | Over-engineering -- all agents work on same codebase |
| Streaming injection | Hook requires complete output -- retrieval is fast enough (<500ms) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EMBED-01 | Phase 28 | Pending |
| EMBED-02 | Phase 28 | Pending |
| EMBED-03 | Phase 28 | Pending |
| EMBED-04 | Phase 28 | Pending |
| EMBED-05 | Phase 28 | Pending |
| EMBED-06 | Phase 28 | Pending |
| RETR-01 | Phase 29 | Pending |
| RETR-02 | Phase 29 | Pending |
| RETR-03 | Phase 29 | Pending |
| RETR-04 | Phase 29 | Pending |
| RETR-05 | Phase 29 | Pending |
| RETR-06 | Phase 29 | Pending |
| RETR-07 | Phase 29 | Pending |
| HOOK-01 | Phase 30 | Pending |
| HOOK-02 | Phase 30 | Pending |
| HOOK-03 | Phase 30 | Pending |
| HOOK-04 | Phase 32 | Pending |
| HOOK-05 | Phase 32 | Pending |
| WMEM-01 | Phase 31 | Pending |
| WMEM-02 | Phase 31 | Pending |
| WMEM-03 | Phase 31 | Pending |
| PROF-01 | Phase 32 | Pending |
| PROF-02 | Phase 32 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23
- Unmapped: 0

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 after roadmap creation*
