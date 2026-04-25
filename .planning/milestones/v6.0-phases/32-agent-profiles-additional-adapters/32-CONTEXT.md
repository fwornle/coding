# Phase 32: Agent Profiles & Additional Adapters - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Add per-agent scoring profiles that bias retrieval results toward each agent's typical work patterns, and cross-agent continuity via a session state file so switching agents mid-task carries context forward. The agent adapters themselves (HOOK-04, HOOK-05) were already built in Phase 30.1 -- this phase focuses on the intelligence layer on top.

</domain>

<decisions>
## Implementation Decisions

### Scope Adjustment
- **D-01:** Phase 30.1 already built OpenCode, Copilot, and Mastra adapters with context-aware retrieval. HOOK-04 and HOOK-05 requirements are satisfied. This phase focuses ONLY on PROF-01 (per-agent scoring) and PROF-02 (cross-agent continuity).
- **D-02:** SC1 and SC2 from the original roadmap are already met by Phase 30.1. This phase addresses SC3 (cross-agent continuity) and SC4 (per-agent scoring profiles).

### Per-Agent Scoring Profiles (PROF-01)
- **D-03:** Claude's discretion on the approach. Simplest effective mechanism -- likely tier weight overrides per agent (e.g., `{ claude: { insights: 1.5 }, copilot: { observations: 1.3 } }`) applied as multipliers in the RRF fusion step.
- **D-04:** Profiles stored as a JSON config file (e.g., `config/agent-profiles.json`) so they can be tuned without code changes.
- **D-05:** The retrieval service already receives `context.project` and `context.cwd` from Phase 30.1. Add an `agent` field to the context object so the retrieval service can select the right profile.
- **D-06:** Each adapter (`knowledge-injection-{agent}.js`) passes its agent name in the retrieval call context. Claude's hook sends `agent: "claude"`, OpenCode's sends `agent: "opencode"`, etc.

### Cross-Agent Continuity (PROF-02)
- **D-07:** Session state file approach. Each agent writes a `.coding/session-state.json` on session exit with key decisions, changes, and a brief summary. The next agent reads it on session start and includes it in the injected context.
- **D-08:** The session state file is written by the agent launcher (`launch-agent-common.sh`) in the `agent_post_exit()` hook, not by the coding agent itself. This ensures it's always written even if the agent crashes.
- **D-09:** The session state file contains: `{ agent: string, project: string, timestamp: string, summary: string, recent_files: string[], key_decisions: string[] }`.
- **D-10:** On session start, each adapter reads `.coding/session-state.json`. If the previous agent is different from the current one AND the timestamp is within the last 2 hours, inject a "Previous Session" section into the context.
- **D-11:** The `.coding/` directory is in the project root (created by `bin/coding` launcher). It's gitignored.

### Claude's Discretion
- Default profile weights for each agent (initial calibration values)
- Whether to use query rewriting in addition to weight overrides, or weights alone
- Exact format of the "Previous Session" injection section
- How to extract "key decisions" from the session -- observation DB, git log, or manual

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Retrieval Service
- `src/retrieval/retrieval-service.js` -- RetrievalService class, `retrieve()` method, context parameter
- `src/retrieval/rrf-fusion.js` -- RRF fusion with `TIER_WEIGHTS` constant (where agent profile weights apply)
- `src/retrieval/working-memory.js` -- Working memory module (continuity section appended here or alongside)

### Agent Adapters (Phase 30.1)
- `src/hooks/retrieval-client.js` -- Shared retrieval client (add `agent` to context here)
- `src/hooks/knowledge-injection-hook.js` -- Claude adapter
- `src/hooks/knowledge-injection-opencode.js` -- OpenCode adapter
- `src/hooks/knowledge-injection-copilot.js` -- Copilot adapter
- `src/hooks/knowledge-injection-mastra.js` -- Mastra adapter

### Agent Launch System
- `scripts/launch-agent-common.sh` -- Agent lifecycle hooks (agent_post_exit for session state write)
- `config/agents/*.sh` -- Agent configs (AGENT_NAME available for profile selection)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `rrf-fusion.js` has `TIER_WEIGHTS = { insights: 1.5, digests: 1.2, kg_entities: 1.0, observations: 0.8 }` -- agent profiles would multiply these per-agent
- `retrieval-client.js` `callRetrieval()` already sends `context` object -- just add `agent` field
- `launch-agent-common.sh` exports `CODING_AGENT` env var with the agent name -- available to all hooks

### Established Patterns
- Config files in `config/` directory (JSON, sourced at startup)
- Fail-open on missing config (use defaults if `agent-profiles.json` doesn't exist)
- Agent lifecycle: `agent_pre_launch()` → agent runs → `agent_post_exit()` in launch-agent-common.sh

### Integration Points
- `rrf-fusion.js` TIER_WEIGHTS -- multiply by agent profile weights
- `retrieval-client.js` -- add `agent` to context
- `launch-agent-common.sh` -- add session state write in post-exit

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- standard extension of the retrieval and launch infrastructure.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 32-agent-profiles-additional-adapters*
*Context gathered: 2026-04-25*
