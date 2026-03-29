# Feature Research

**Domain:** Mastra.ai Observational Memory Integration & Mastracode Agent for Coding Infrastructure
**Researched:** 2026-03-28
**Confidence:** MEDIUM (mastra OM docs are HIGH confidence; batch conversion of historical LSL is LOW confidence -- no official batch API exists yet)

## Feature Landscape

### Table Stakes (Users Expect These)

Features required for a working mastra integration. Missing these = integration feels broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Mastra OpenCode plugin (`@mastra/opencode`) | Official plugin exists; `coding --opencode` must gain observational memory alongside existing LSL | MEDIUM | Plugin hooks into OpenCode lifecycle, injects observations into system prompt, discards already-observed messages. Needs `.opencode/mastra.json` config + credential resolution from OpenCode provider store. Storage: LibSQL (already used by OpenCode for SQLite). |
| Mastracode agent launch (`coding --mastra`) | Third coding agent alongside Claude and OpenCode; must integrate with existing tmux-based launcher | MEDIUM | `npm install -g mastracode`, Node 22.13+. Needs tmux pane setup, statusline integration, coding-services Docker access. Config in `.mastracode/` dir. Mastracode uses LibSQL internally for threads/messages/OM. |
| LSL capture for mastracode sessions | All three agents produce LSL logs; mastracode cannot be the exception | HIGH | Mastracode stores conversations in LibSQL (local SQLite). LSL must read from mastracode's SQLite DB (threads + messages tables) and produce `.specstory/history/` markdown files matching existing format. This is a new transcript source -- no existing parser exists. |
| Observation generation from live sessions | Core value of mastra OM: compress verbose tool-call-heavy transcripts into dense observations | LOW | Already built into mastra Memory class. For OpenCode: `@mastra/opencode` plugin handles this. For mastracode: built-in OM. For Claude: requires standalone `observe()` API call with external messages. |
| Transcript-to-observation converter for Claude JSONL | Claude Code produces `.specstory/history/*.md` files (JSONL-style). Must convert to mastra observations | HIGH | No official mastra batch API. Must: (1) parse Claude JSONL transcripts into MastraDBMessage format (user/assistant roles only), (2) call standalone `observe()` with external messages, (3) store observations in LibSQL. Custom converter needed. |
| Transcript-to-observation converter for Copilot events.jsonl | Copilot produces `events.jsonl` event stream format | HIGH | Similar to Claude converter but different source format. Parse Copilot event stream, extract user/assistant exchanges, convert to MastraDBMessage, feed to `observe()`. Custom converter needed. |
| Transcript-to-observation converter for OpenCode SQLite | OpenCode stores sessions in SQLite DB | MEDIUM | OpenCode already has `@mastra/opencode` plugin for live observation. Converter for historical sessions: read from SQLite, replay through `observe()`. Simpler than Claude/Copilot since messages are already structured. |

### Differentiators (Competitive Advantage)

Features that make this integration uniquely valuable beyond basic mastra usage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cross-agent observation unification | All 3 agents (Claude, Copilot, OpenCode) produce observations in identical mastra format, queryable from single store | MEDIUM | Use shared LibSQL database with resource-scoped observations. Each agent gets a resourceId (`coding-claude`, `coding-opencode`, `coding-mastra`), threads scoped per session. Enables cross-agent knowledge. |
| Historical LSL batch converter | Convert existing `.specstory/history/` archive into observations -- retroactive knowledge extraction from months of sessions | HIGH | No official mastra batch API. Must build custom pipeline: (1) glob all historical LSL files, (2) parse per agent format, (3) chunk into token-budget-sized batches, (4) call `observe()` per batch, (5) call reflector on accumulated observations. LLM cost concern: months of transcripts = many LLM calls. |
| Observation-enriched knowledge graph | Feed mastra observations into existing UKB pipeline as a new input source alongside code analysis | HIGH | Bridge between mastra LibSQL observations and existing Graphology+LevelDB knowledge graph. Observations become inputs to wave-analysis, producing entities like "UserPreferences", "RecurringPatterns", "ArchitecturalDecisions". |
| Dual-write mode (LSL + observations) | Keep verbatim LSL for audit trail while simultaneously generating observations for AI consumption | LOW | Run both systems in parallel. LSL continues writing raw transcripts to `.specstory/`. Mastra OM generates compressed observations to LibSQL. No replacement, just augmentation. |
| Memory status diagnostics | Dashboard showing observation accumulation, compression ratios, token budgets per agent | MEDIUM | Mastra provides `memory_status` and `memory_observations` diagnostic tools. Surface these in existing health dashboard (port 3032). |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Replace LSL with observations entirely | "Observations are better, remove verbatim logging" | Observations are lossy by design (3-40x compression). Exact tool call arguments, error messages, timestamps lost. Audit trail destroyed. Cannot reproduce sessions. | Dual-write: keep LSL verbatim logs alongside observation generation. LSL = source of truth, observations = AI-consumable summary. |
| Real-time cross-agent memory sharing | "When I switch from Claude to OpenCode, it should know what I did" | Resource-scoped OM is experimental in mastra. Cross-thread observation mixing risks context pollution -- observations from Claude's tool-call patterns confuse OpenCode's different interaction model. | Thread-scoped observations per agent. Build explicit "handoff" command that generates a session summary for the next agent, rather than sharing raw observation state. |
| Auto-select LLM for observations based on content | "Use cheap models for simple stuff, expensive for complex" | ModelByInputTokens exists in mastra but adds configuration complexity and unpredictable costs. Observation quality varies across models -- cheap models produce low-quality observations that compound errors during reflection. | Use single model for all observations: `google/gemini-2.5-flash` (mastra's default, tested extensively). Fast, cheap, 128K context. Only switch if quality issues emerge. |
| Observe every tool call result in detail | "Don't lose tool output details in compression" | Tool outputs are the noisiest part (5-40x compression ratio exists because tool outputs are verbose). Keeping them defeats OM's purpose and blows up context. | Use retrieval mode (`retrieval: true`) to keep observation-to-source-message links. Agents can call `recall` tool when they need exact tool output. |
| Build custom OM from scratch instead of using mastra | "We already have LSL, just add summarization" | Mastra OM is SOTA (94.87% on LongMemEval). Custom implementation would need Observer + Reflector agents, token estimation, async buffering, three-tier memory structure, prompt caching optimization. Months of work to match mastra quality. | Use mastra as-is. Extend with custom converters for transcript formats. Focus engineering effort on integration, not reimplementation. |

## Feature Dependencies

```
[LibSQL Storage Setup]
    |
    +---> [Mastra OpenCode Plugin]
    |         |--requires--> [@mastra/opencode package]
    |         |--enhances--> [LSL dual-write]
    |
    +---> [Mastracode Agent Launch]
    |         |--requires--> [Node 22.13+, tmux integration]
    |         |--enables---> [LSL Capture for Mastracode]
    |
    +---> [Transcript Converters (Claude/Copilot/OpenCode)]
              |--requires--> [Standalone observe() API from @mastra/memory]
              |--requires--> [Per-agent transcript parser]
              |--enables---> [Historical Batch Converter]
              |--enables---> [Cross-Agent Observation Unification]
                                 |--enables--> [Observation-Enriched KG]
```

### Dependency Notes

- **LibSQL storage setup is the foundational dependency:** Both mastracode and the OpenCode plugin use LibSQL. All converters write to it. Set this up first.
- **Transcript converters are independent per agent:** Claude, Copilot, and OpenCode converters can be built in parallel. Each parses a different format but outputs to the same observe() API.
- **Historical batch converter depends on live converters working:** The parsers are the same; batch just adds iteration over file archives and token budget management.
- **Knowledge graph bridge is a stretch goal:** Requires observation store to be populated and stable before bridging to existing UKB pipeline.
- **Mastracode launch and OpenCode plugin are independent:** Can be built in parallel since they use different agent runtimes.

## MVP Definition

### Launch With (v1)

Minimum viable integration -- prove mastra OM works with existing infrastructure.

- [ ] LibSQL storage setup shared across agents -- foundational; everything depends on it
- [ ] Mastra OpenCode plugin (`@mastra/opencode`) for `coding --opencode` -- lowest friction, official plugin exists
- [ ] Mastracode agent launch (`coding --mastra`) with tmux integration -- new agent, independent of OM
- [ ] LSL capture for mastracode sessions (SQLite reader) -- maintains LSL contract for new agent
- [ ] Dual-write mode: keep existing LSL + generate observations for OpenCode sessions -- proves value without risk

### Add After Validation (v1.x)

Features to add once live observation is working.

- [ ] Claude JSONL transcript converter -- when live OM is proven, convert Claude sessions
- [ ] Copilot events.jsonl converter -- same pattern as Claude, different parser
- [ ] OpenCode historical session converter -- replay old SQLite sessions through observe()
- [ ] Memory status in health dashboard -- visibility into OM health

### Future Consideration (v2+)

- [ ] Historical LSL batch converter (full archive) -- expensive (LLM calls per session), defer until ROI proven on recent sessions
- [ ] Cross-agent observation unification -- resource-scoped OM is experimental in mastra; wait for stability
- [ ] Observation-enriched knowledge graph -- bridge to UKB pipeline; requires mature observation store
- [ ] Retrieval mode with semantic search -- `recall` tool for exact wording; nice-to-have, not critical

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| LibSQL storage setup | HIGH | LOW | P1 |
| Mastra OpenCode plugin | HIGH | MEDIUM | P1 |
| Mastracode agent launch | HIGH | MEDIUM | P1 |
| LSL capture for mastracode | HIGH | HIGH | P1 |
| Dual-write mode (LSL + OM) | HIGH | LOW | P1 |
| Claude transcript converter | MEDIUM | HIGH | P2 |
| Copilot transcript converter | MEDIUM | HIGH | P2 |
| OpenCode historical converter | MEDIUM | MEDIUM | P2 |
| Memory status dashboard | MEDIUM | MEDIUM | P2 |
| Historical batch converter | MEDIUM | HIGH | P3 |
| Cross-agent unification | MEDIUM | HIGH | P3 |
| Observation-enriched KG | LOW | HIGH | P3 |
| Retrieval mode + recall tool | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch -- proves integration works
- P2: Should have -- completes the picture for all agents
- P3: Nice to have -- advanced features for later

## Mastra OM Technical Reference

Key technical details that inform implementation:

### Observer/Reflector Architecture
- **Observer** activates at 30,000 token threshold (configurable via `messageTokens`)
- **Reflector** activates at 40,000 observation tokens (configurable via `observationTokens`)
- Async buffering: pre-computes observations at 20% intervals (`bufferTokens: 0.2`)
- Three-tier memory: recent messages + observations + reflections
- Token estimation via `tokenx` library (fast local estimation)

### Observation Format
```
Date: 2026-01-15
- [red] 12:10 User is building a Next.js app with Supabase auth
  - [red] 12:10 App uses server components with client-side hydration
  - [yellow] 12:12 User asked about middleware configuration
```
Emoji-based priority (red=high, yellow=medium, green=low). Timestamped. Hierarchical two-level bullets.

### Standalone observe() API (Key for Converters)
```typescript
await om.observe({
  threadId,
  resourceId?,
  messages?,         // External messages (MastraDBMessage format)
  hooks?: {          // Lifecycle callbacks
    onObservationStart, onObservationEnd,
    onReflectionStart, onReflectionEnd
  }
});
```
This is the critical API for transcript converters -- accepts external messages without requiring a live agent session. Messages must have `role: 'user' | 'assistant'` only.

### Mastracode Configuration
- Config dirs: `.mastracode/` (project) and `~/.mastracode/` (global)
- Also reads `.claude/` dirs for Claude Code compatibility
- Key files: `mcp.json`, `hooks.json`, `database.json`, `AGENTS.md`
- Auth: API keys via env vars or OAuth via `/login`
- Storage: LibSQL local SQLite (threads, messages, token usage, OM)
- Custom commands in `commands/` dir, skills in `skills/` dir

### Storage Requirements
- Requires `@mastra/libsql` (SQLite-based, local, no data leaves machine)
- Also supports `@mastra/pg` and `@mastra/mongodb` but LibSQL is best for local dev
- Mastracode already uses LibSQL internally

### Compression Ratios
- Text-only: 3-6x compression
- Tool-heavy (typical for coding agents): 5-40x compression
- Average context window stays ~30K tokens regardless of session length

## Competitor Feature Analysis

| Feature | Claude Code (native) | Cursor | Mastra OM | Our Approach |
|---------|---------------------|--------|-----------|--------------|
| Session memory | Conversation compaction (lossy, no structure) | Tab-scoped, lost on close | Structured observations with reflections, persisted | Mastra OM for structured memory + LSL for verbatim audit trail |
| Cross-session recall | CLAUDE.md manual notes | None | Thread-scoped or resource-scoped observations | Thread-scoped per session, explicit handoff between agents |
| Context compression | Hard truncation at window limit | Summarization (proprietary) | 5-40x structured compression, prompt-cacheable | Mastra OM (proven SOTA on LongMemEval) |
| Multi-agent support | Single agent | Single agent | Multi-agent via resource scoping | Three agents (Claude, OpenCode, Mastra) with shared observation store |
| Historical analysis | None | None | Not built-in | Custom batch converter using standalone observe() API |

## Sources

- [Observational Memory Docs](https://mastra.ai/docs/memory/observational-memory) -- HIGH confidence, official documentation
- [Observational Memory Research](https://mastra.ai/research/observational-memory) -- HIGH confidence, benchmark results
- [Announcing Mastra Code](https://mastra.ai/blog/announcing-mastra-code) -- HIGH confidence, official announcement
- [@mastra/opencode Plugin PR #12925](https://github.com/mastra-ai/mastra/pull/12925) -- MEDIUM confidence, implementation details from merged PR
- [Mastra Code Configuration](https://code.mastra.ai/configuration) -- HIGH confidence, official docs
- [Memory Overview](https://mastra.ai/docs/memory/overview) -- HIGH confidence, official docs
- [Mastra Code npm](https://www.npmjs.com/package/mastracode) -- HIGH confidence, package registry
- [VentureBeat Coverage](https://venturebeat.com/data/observational-memory-cuts-ai-agent-costs-10x-and-outscores-rag-on-long) -- MEDIUM confidence, press coverage

### Confidence Notes

| Area | Confidence | Notes |
|------|------------|-------|
| Mastra OM architecture | HIGH | Official docs + research paper + benchmarks |
| OpenCode plugin | HIGH | Official PR merged, documented API |
| Mastracode setup | HIGH | Official docs, npm package, blog post |
| Standalone observe() for batch use | MEDIUM | API exists (PR #12925) but not documented for batch/historical use cases. No examples of feeding archived transcripts. |
| Historical batch conversion | LOW | No official support. Must be custom-built using observe() API. Token budget management and cost control are open questions. |
| Cross-agent observation sharing | LOW | Resource-scoped OM is marked "experimental" in mastra docs. No production examples of multi-agent shared observations. |

---
*Feature research for: Mastra.ai Observational Memory + Mastracode Integration*
*Researched: 2026-03-28*
