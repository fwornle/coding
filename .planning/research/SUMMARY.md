# Project Research Summary

**Project:** Mastra.ai Integration — Observational Memory, Mastracode Agent, LSL-to-Observations Conversion
**Domain:** AI coding agent infrastructure — memory layer integration
**Researched:** 2026-03-28
**Confidence:** MEDIUM (core stack HIGH, batch conversion LOW, cross-agent sharing LOW)

## Executive Summary

This project integrates Mastra.ai's Observational Memory (OM) engine into the existing multi-agent coding infrastructure (Claude Code, OpenCode, Copilot) to provide structured, persistent, compressed session memory alongside the existing verbatim LSL logging system. Mastra OM achieves 95% on LongMemEval benchmarks with 5-40x context compression — addressing the core problem that raw verbatim transcripts are too large for effective AI recall. The recommended approach is a phased augmentation: add mastra OM as a parallel output stream to the existing pipeline, never replacing verbatim LSL logs, and proving the system works on live sessions before investing in historical batch conversion.

The critical design constraint is that observations must run in parallel with — not instead of — verbatim LSL logging. Mastra's Observer compresses at 5-40x ratios, which means exact tool call arguments, file paths, and error traces are discarded by design. The UKB wave-analysis pipeline depends on these exact details. The integration must define a clear ownership boundary: Mastra owns observation/reflection lifecycle in LibSQL, the existing pipeline owns knowledge entities in Graphology/LevelDB, and a one-directional feed from observations into the UKB pipeline is a v4.1+ concern.

The three highest-impact risks are: (1) observer blocking conversations synchronously when the 30k token threshold is hit during tool-heavy sessions — mitigate by raising thresholds to 50-60k and using async buffering from day one; (2) silent cost explosion from using expensive models (Opus/Sonnet) for background observation calls — mitigate by locking observer/reflector to Gemini Flash or GPT-4o-mini and integrating with BudgetTracker from the start; (3) pi-tui/tmux mouse capture conflicts breaking LSL pipe-pane capture for mastracode — mitigate by not using `AGENT_ENABLE_PIPE_CAPTURE` for mastracode and instead tapping mastra's own lifecycle hooks for LSL output.

## Key Findings

### Recommended Stack

The stack is local-first and additive to the existing infrastructure. Mastra OM packages (`@mastra/memory@^1.6.1`, `@mastra/core@^1.10.0`, `@mastra/libsql@^0.16.4`) install alongside existing packages with no version conflicts. Mastracode is a global npm install (`npm install -g mastracode@^0.9.2`) with Node.js >= 22.13.0 (project uses Node 25.x — compatible). The `@mastra/opencode` plugin for the OpenCode agent has an uncertain npm publication status (PR merged Feb 2026 but npm availability unconfirmed); it may need to be built from the mastra monorepo.

**Core technologies:**
- `@mastra/memory@^1.6.1`: Observational Memory engine (Observer + Reflector agents) — 95% LongMemEval, the only SOTA OM implementation; reimplementing custom would take months
- `@mastra/libsql@^0.16.4`: SQLite-backed observation storage — local-first, no server process, consistent with existing project philosophy (LevelDB for KG)
- `@mastra/core@^1.10.0`: Required peer dependency for @mastra/memory; model routing to 1800+ models
- `mastracode@^0.9.2`: TUI coding agent with built-in OM, LibSQL storage, MCP support — third agent alongside Claude and OpenCode
- `@mastra/opencode` plugin: Hooks OpenCode lifecycle for auto-observation; publication status is LOW confidence

**Key API:** The standalone `observe()` API (added in @mastra/memory v1.4.0, confirmed via PR #12925) is the critical integration point for both the batch converter and the live LSL observation tap. It accepts external messages without requiring a live agent session.

### Expected Features

The MVP proves mastra OM works with the existing infrastructure. Live observation for OpenCode (via plugin) and mastracode (built-in) are the highest-priority deliverables. Historical batch conversion is a P3 feature — valuable but expensive in LLM calls and should only be built once live OM quality is validated.

**Must have (table stakes):**
- LibSQL shared observation storage setup — foundational; all other features depend on it
- Mastra OpenCode plugin (`@mastra/opencode`) for `coding --opencode` — official plugin, lowest integration friction
- Mastracode agent launch (`coding --mastra`) with tmux integration — third agent, independent of OM itself
- LSL capture for mastracode sessions (SQLite reader, not pipe-pane) — maintains LSL contract for the new agent
- Dual-write mode: LSL verbatim continues unchanged, observations are additive — non-negotiable architectural constraint

**Should have (differentiators):**
- Claude JSONL transcript converter — extends OM coverage to the primary coding agent
- Copilot events.jsonl converter — parity across all three agents
- OpenCode historical session converter — replay old SQLite sessions through observe()
- Memory status visibility in health dashboard — operational transparency
- Cross-agent observation unification (resource-scoped) — when mastra resource-scope exits experimental status

**Defer (v2+):**
- Historical LSL batch converter (full archive) — expensive (LLM calls per session); ROI unknown until live OM is proven
- Observation-enriched knowledge graph (UKB bridge) — requires mature observation store; v4.1+ concern
- Retrieval mode with `recall` tool — nice-to-have for exact wording lookup

### Architecture Approach

The architecture is additive: four new components (mastracode agent adapter, OpenCode OM plugin, batch converter, observation store config) and three minor modifications (bin/coding `--mastra` flag, enhanced-transcript-monitor.js optional tap, transcript-formats.json). The core pattern throughout is parallel output streams — observations run alongside verbatim LSL, never replacing it. Per-agent storage isolation (separate SQLite files per agent) avoids write-lock contention since mastracode holds its DB connection open continuously.

**Major components:**
1. `config/agents/mastra.sh` — agent adapter following existing convention (claude.sh, copilot.sh, opencode.sh pattern); low complexity; no launcher changes needed
2. `@mastra/opencode` plugin in `.opencode/plugins/mastra-memory/` — live OM for OpenCode via lifecycle hooks (`session.compacting`, `message.updated`); medium complexity; `session.compacting` hook is the critical one (fires before OpenCode discards old messages)
3. `scripts/transcript-to-observations.js` — batch converter with per-format readers (ClaudeJSONL, CopilotEvents, OpenCodeSQLite, SpecstoryMarkdown), MessageNormalizer, ObservationWriter, and manifest.json idempotency tracking; high complexity
4. `.data/observations/` store — per-agent SQLite files (`mastra.db`, `opencode.db`, `batch.db`) with `manifest.json`; low complexity

**Key anti-patterns to avoid:**
- Replacing LSL before OM is proven (observations are lossy by design)
- Sharing a single LibSQL DB across agents (SQLite write-lock contention)
- Running batch conversion with Opus/Sonnet-class models (cost explosion)
- Modifying mastracode internals (breaks on updates)

### Critical Pitfalls

1. **Observer blocking conversations** — Synchronous observation at 30k token threshold causes 10-30s freezes in tool-heavy coding sessions. Avoid by raising `messageTokens` to 50-60k, enabling async buffering, and testing with real file operations during Phase 1. Note: async buffering may still block in subagent/plugin contexts per GitHub Issue #14082 — have a worker thread fallback ready.

2. **Cost explosion from expensive observer models** — Mastra defaults to the agent's primary model for observation; using Opus/Sonnet for background summarization silently doubles API spend. Avoid by explicitly configuring `gemini-2.5-flash` for observer/reflector and integrating `onObservationEnd` hooks with BudgetTracker from Phase 1. Note: Claude 4.5 models reportedly do not work well as observer/reflector — use Gemini Flash or GPT-4o-mini.

3. **pi-tui/tmux mouse capture conflict** — `AGENT_ENABLE_PIPE_CAPTURE=true` produces garbled output or empty captures from mastracode's alt-screen TUI. Avoid by setting `AGENT_ENABLE_PIPE_CAPTURE=false` for mastracode and instead using mastra's `onObservationEnd` hook to feed the LSL system.

4. **Double-observation of mastracode sessions** — The batch converter must NOT process mastracode's already-observed conversations through observe() again. Avoid by adding a `"preObserved": true` flag to the mastra format definition in `transcript-formats.json` and having the converter skip these.

5. **Dual storage divergence** — Observations in LibSQL and knowledge entities in Graphology/LevelDB drifting silently out of sync. Avoid by defining ownership boundaries up front: mastra owns observations, existing pipeline owns entities, feed is one-directional and explicit.

## Implications for Roadmap

Based on the dependency graph from ARCHITECTURE.md and the pitfall-to-phase mapping from PITFALLS.md:

### Phase 1: Foundation — Storage, Cost Controls, and OpenCode OM
**Rationale:** Storage architecture must be decided before any integration code is written (Pitfall 1 — storage divergence). Observer blocking (Pitfall 3) and cost explosion (Pitfall 6) must be addressed at the point where the first OM code is introduced — not as a future optimization. OpenCode plugin is the lowest-friction OM integration (official plugin, no custom parsers needed). Proving live OM quality here validates the investment in converters.
**Delivers:** Working observational memory for `coding --opencode` sessions; LibSQL observation store at `.data/observations/`; BudgetTracker integration via hooks; confirmed async buffering behavior
**Addresses:** LibSQL storage setup (P1), Mastra OpenCode plugin (P1), Dual-write mode (P1)
**Avoids:** Pitfalls 1 (storage divergence), 3 (observer blocking), 6 (cost explosion)

### Phase 2: Mastracode Agent Integration
**Rationale:** Mastracode TUI/tmux conflict (Pitfall 4) is non-trivial and requires dedicated attention. Auth model conflict (Pitfall 7) also surfaces here. This phase is largely independent of Phase 1 convergence — can start after mastracode npm install — but must complete before Phase 3 (which needs the mastra.sh adapter pattern to define the `preObserved` flag requirement).
**Delivers:** `coding --mastra` working in tmux with LSL capture via observation hooks (not pipe-pane); `config/agents/mastra.sh` following established adapter pattern; first-run OAuth documented with pre-auth workaround
**Addresses:** Mastracode agent launch (P1), LSL capture for mastracode (P1)
**Avoids:** Pitfalls 4 (pi-tui/tmux), 5 (double-observation setup), 7 (auth model conflict)
**Uses:** mastracode@^0.9.2, per-agent LibSQL storage isolation (`mastra.db` separate from `opencode.db`)

### Phase 3: Transcript Converters (Claude + Copilot)
**Rationale:** Transcript converters depend on @mastra/memory and @mastra/libsql being available and tested (Phase 1). Building them after live OM quality is validated avoids investing in batch conversion infrastructure that may need redesign. Pitfall 5 (double-observation) must be designed in from the start, which requires the `preObserved` flag established in Phase 2.
**Delivers:** Converters for Claude JSONL (v1 + v2) and Copilot events.jsonl; `preObserved` flag in transcript-formats.json preventing double-observation; ModelByInputTokens cost control for batch runs; manifest.json idempotency tracking
**Addresses:** Claude transcript converter (P2), Copilot transcript converter (P2)
**Avoids:** Pitfalls 2 (verbatim detail loss — parallel output, not replacement), 5 (double-observation)
**Implements:** TranscriptReader per-format adapter architecture, MessageNormalizer to MastraDBMessage shape

### Phase 4: Live Claude OM Tap + OpenCode Historical Converter + Dashboard
**Rationale:** The enhanced-transcript-monitor.js modification is the riskiest change (Pitfall 2 — modifying the proven LSL pipeline). Deferring it until all additive integrations are validated reduces risk. The async ObservationTap must never block verbatim LSL output.
**Delivers:** Real-time observation generation alongside verbatim LSL for `coding --claude` sessions; OpenCode historical SQLite converter; memory status endpoint surfaced in health dashboard at port 3032
**Addresses:** Claude live observation tap, OpenCode historical converter (P2), memory status dashboard (P2)
**Avoids:** Pitfall 2 (verbatim data loss — additive ObservationTap, no blocking, no removal)

### Phase 5: Historical Batch Conversion + Cross-Agent Unification (v2)
**Rationale:** Full historical batch conversion across the `.specstory/` archive is expensive in LLM calls and should only be built once per-session converters (Phase 3) are proven on recent sessions. Cross-agent resource-scoped OM should only be attempted after mastra removes the "experimental" label.
**Delivers:** Observations for historical session archive (date-range batched, checkpointed); cross-agent shared observation store when stable
**Addresses:** Historical batch converter (P3), cross-agent unification (P3)

### Phase Ordering Rationale

- Phase 1 before everything: Storage and cost controls are shared infrastructure; changing storage architecture after converters are built is expensive. OpenCode plugin proves OM works before investing in converters.
- Phase 2 overlaps Phase 1: Mastracode agent work is self-contained and can start after npm install; the tmux conflict investigation is independent of Phase 1 OM quality testing.
- Phase 3 after Phase 1 validation: Converters use the same `observe()` API as the OpenCode plugin. Seeing live observation quality first means batch conversion design decisions are informed.
- Phase 4 last for existing-pipeline modification: enhanced-transcript-monitor.js is the highest-risk edit; all other work is additive and complete before touching it.
- Phase 5 deferred to v2: ROI on historical batch conversion is unproven; resource-scoped OM is experimental.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** `@mastra/opencode` plugin npm publication status is LOW confidence — must verify `npm view @mastra/opencode version` before Phase 1 can be planned. If not on npm, monorepo build becomes a dependency. OpenCode plugin hook points need validation against the actual `coding --opencode` variant in this project.
- **Phase 2:** Mastracode first-run OAuth flow in headless tmux is untested. pi-tui `--no-mouse` or equivalent config flag needs verification from pi-tui docs/source before claiming the tmux conflict is solvable via config alone.
- **Phase 3:** `MastraDBMessage` exact type shape is MEDIUM confidence — needs Context7 lookup or mastra source inspection before the MessageNormalizer can be designed. Wrong shape = hard error from `observe()`.

Phases with standard patterns (skip research-phase):
- **Phase 2 (agent adapter):** `config/agents/mastra.sh` follows a fully established, tested convention. Implementation is mechanical — three existing adapters provide the template.
- **Phase 4 (health dashboard):** mastra provides `memory_status` and `memory_observations` diagnostic tools. Surfacing them in the existing Express health API follows standard REST endpoint patterns.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core packages (memory, core, libsql, mastracode) are HIGH — npm verified. `@mastra/opencode` publication status is LOW. `MastraDBMessage` type shape is MEDIUM — referenced but not fully documented. |
| Features | MEDIUM | Live OM architecture is HIGH confidence. Batch conversion feasibility is LOW — no official mastra support, must be custom-built. Cross-agent sharing is LOW — experimental in mastra, no production examples. |
| Architecture | HIGH | Component boundaries are well-defined. Existing adapter pattern removes ambiguity for mastracode integration. Storage isolation rationale is solid. Build order dependency graph is clear from codebase analysis. |
| Pitfalls | MEDIUM-HIGH | Observer blocking and cost explosion are verified via changelog and GitHub issues. pi-tui/tmux conflict sourced from actual OpenCode GitHub issues. Storage divergence and double-observation are architectural deductions from verified system behavior. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **`@mastra/opencode` npm availability:** Verify `npm view @mastra/opencode version` before Phase 1 planning. If not published, plan for monorepo build step as a Phase 1 dependency.
- **`MastraDBMessage` type shape:** The exact fields required for the transcript converters must be confirmed via Context7 or mastra source before Phase 3 implementation. Proceeding without this risks building the wrong MessageNormalizer.
- **Async buffering in OpenCode plugin context:** GitHub Issue #14082 reports async buffer still blocks in subagent contexts. Verify whether the OpenCode plugin is treated as a subagent by mastra's runtime. If so, Phase 1 must include a background worker thread wrapper from the start.
- **Mastracode tmux scroll behavior:** Must be tested manually before Phase 2 can be declared complete. No remote verification possible — requires hands-on test with `coding --mastra` in the actual tmux environment.
- **Observer quality on coding transcripts:** The 95% LongMemEval benchmark is measured on conversational memory. Coding sessions (dominated by tool call outputs) may compress differently. Validate observation quality on 2-3 real coding sessions before committing to the batch converter investment.

## Sources

### Primary (HIGH confidence)
- [Observational Memory Docs](https://mastra.ai/docs/memory/observational-memory) — API, thresholds, storage backends, code examples
- [Memory Overview](https://mastra.ai/docs/memory/overview) — package requirements, storage options
- [OM Research Paper](https://mastra.ai/research/observational-memory) — 95% LongMemEval benchmark, compression ratios
- [Mastra Code Announcement](https://mastra.ai/blog/announcing-mastra-code) — architecture, pi-tui, LibSQL storage, Node >= 22.13.0 requirement
- [mastracode npm](https://www.npmjs.com/package/mastracode) — version 0.9.2 verified
- [@mastra/memory npm](https://www.npmjs.com/package/@mastra/memory) — version 1.6.1 verified
- [@mastra/libsql npm](https://www.npmjs.com/package/@mastra/libsql) — version 0.16.4 verified
- [OpenCode Plugin API Docs](https://opencode.ai/docs/plugins/) — lifecycle hook names and signatures

### Secondary (MEDIUM confidence)
- [PR #12925: @mastra/opencode plugin + standalone observe()](https://github.com/mastra-ai/mastra/pull/12925) — plugin API, hooks, observe() standalone, MastraDBMessage type reference
- [Mastra Code site](https://code.mastra.ai/) — installation, configuration capabilities, MCP config format
- [Mastra Changelog 2026-03-23](https://mastra.ai/blog/changelog-2026-03-23) — `previousObserverTokens` budget cap
- [Mastra Changelog 2026-02-04](https://mastra.ai/blog/changelog-2026-02-04) — async buffering shipped
- [pi-mono GitHub](https://github.com/badlogic/pi-mono) — pi-tui architecture (upstream of mastracode)
- [Mastra Memory Storage Docs](https://mastra.ai/docs/memory/storage) — libSQL, pg, mongodb backend details

### Tertiary (LOW confidence)
- [GitHub Issue #14082: OM async buffer blocking in subagent](https://github.com/mastra-ai/mastra/issues/14082) — async buffer still blocks in subagent; needs validation in OpenCode plugin context
- [OpenCode Issue #16967: TUI broken in tmux](https://github.com/anomalyco/opencode/issues/16967) — TUI rendering failures in tmux; confirms pi-tui/tmux conflict exists
- [OpenCode Issue #7926: Mouse capture in multiplexers](https://github.com/anomalyco/opencode/issues/7926) — mouse capture disabling; confirms mechanism of pi-tui/tmux conflict
- `@mastra/opencode` npm publication status — unverified; inferred from PR merge, not confirmed npm listing

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
