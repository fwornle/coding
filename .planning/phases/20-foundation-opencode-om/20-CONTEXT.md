# Phase 20: Foundation & OpenCode OM - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning

<domain>
## Phase Boundary

LibSQL observation storage setup, @mastra/opencode plugin installation via install.sh/uninstall.sh, LLM proxy routing for observer/reflector agents (OKM proxy pattern from rapid-automations), and token budget configuration. This phase establishes the foundation that all subsequent phases depend on.

</domain>

<decisions>
## Implementation Decisions

### LLM Routing
- **D-01:** Use the EXISTING `lib/llm/` LLMService infrastructure in this repo — it already has all subscription providers (claude-code-provider, copilot-provider), SDK loader, subscription quota tracker, provider registry. Do NOT create a separate proxy.
- **D-02:** Network-adaptive SDK routing: inside VPN -> Copilot Enterprise subscription, outside VPN -> Claude subscription (same pattern as `config/agents/opencode.sh` agent_pre_launch). Already implemented in `lib/llm/providers/`.
- **D-03:** Configure mastra's observer/reflector to use `LLMService` (or the Docker `llm-proxy.mjs` bridge from OKM if mastra needs HTTP-based access). The Docker proxy bridge is at `rapid-automations/OKM/docker/llm-proxy.mjs` — port ONLY this bridge if needed, NOT the full LLM lib (already here).

### Storage Location & Schema
- **D-04:** Observation DB lives at per-project `.observations/` directory (alongside `.specstory/`)
- **D-05:** Single shared LibSQL DB per project across all agents (Claude, OpenCode, Mastra) -- unified observation history
- **D-06:** Existing `.data/` convention is for pipeline data; observations are session data, hence separate `.observations/`

### Plugin Installation
- **D-07:** `install.sh` installs `@mastra/opencode` via npm (try npm first, fall back to monorepo build if not published)
- **D-08:** `uninstall.sh` removes the plugin and cleans up
- **D-09:** `scripts/test-coding.sh` runs a full smoke test: start OpenCode briefly, verify observation DB is created, plugin hooks fire

### Token Budget Design
- **D-10:** Token budgets configured via JSON config file at `.observations/config.json` per project
- **D-11:** Default model tier is fast/cheap (flash models -- Groq llama, gemini-flash) since observations are background work
- **D-12:** Config includes per-agent budgets, observer/reflector thresholds, model selection

### OpenCode Plugin Hooks
- **D-13:** LSL and mastra operate independently in parallel -- LSL captures verbatim via enhanced-transcript-monitor, mastra observes via its own plugin hooks. No coordination needed between them.

### Observation Data Model
- **D-14:** Long-term vision: observations replace LSL as primary record, LSL becomes raw backup. For THIS milestone: both run additively (no LSL removal).
- **D-15:** Observations and LSL files share session IDs for cross-referencing during the transition period.

### Claude's Discretion
- Schema migration strategy for LibSQL (mastra handles this internally)
- Exact observation fields/structure (determined by mastra's MastraDBMessage type)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Mastra Integration
- `integrations/opencode/src/index.ts` in mastra repo (github.com/mastra-ai/mastra) -- OpenCode plugin API and hook registration
- `.planning/research/STACK.md` -- Package versions (@mastra/memory@^1.6.1, @mastra/libsql@^0.16.4)
- `.planning/research/ARCHITECTURE.md` -- Integration architecture and data flow
- `.planning/research/FEATURES.md` -- Observer/reflector agent behavior, observe() API

### Existing LLM Infrastructure (MUST USE, NOT DUPLICATE)
- `lib/llm/` -- Full LLM lib with providers (claude-code, copilot, groq, anthropic, etc.), SDK loader, circuit breaker, caching, subscription quota tracker, provider registry. THIS IS THE LLM LIB.
- `lib/llm/providers/claude-code-provider.ts` -- Claude Max subscription access
- `lib/llm/providers/copilot-provider.ts` -- Copilot Enterprise subscription access
- `src/inference/UnifiedInferenceEngine.js` -- High-level facade that delegates to LLMService from lib/llm/
- `config/agents/opencode.sh` -- Agent adapter pattern (network-adaptive model selection)
- `install.sh` -- Installation patterns for new integrations
- `scripts/test-coding.sh` -- Validation patterns for installed components

### Docker LLM Proxy (port only if needed)
- `rapid-automations/OKM/docker/llm-proxy.mjs` -- HTTP bridge for containers to access host agent SDKs. Port this ONLY if mastra needs HTTP-based LLM access from Docker context.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `config/agents/opencode.sh` -- Agent adapter template with network-adaptive model selection (reuse pattern for mastra)
- `install.sh` functions (`install_semantic_analysis`, `install_code_graph_rag`) -- Installation patterns with npm install + validation
- `scripts/test-coding.sh` -- Validation harness that tests installed components

### Established Patterns
- Agent adapters: `config/agents/<name>.sh` with `AGENT_NAME`, `AGENT_COMMAND`, `agent_check_requirements()`, `agent_pre_launch()`
- Data storage: `.data/` for pipeline data, `.specstory/` for session logs
- Network detection: VPN detection in agent_pre_launch for model routing
- Docker services: coding-services container with bind-mounted config

### Integration Points
- `install.sh` / `uninstall.sh` -- Add mastra plugin install/uninstall functions
- `scripts/test-coding.sh` -- Add mastra plugin validation
- `.observations/` -- New per-project directory for LibSQL observation DB
- `.observations/config.json` -- New config file for token budgets and model selection

</code_context>

<specifics>
## Specific Ideas

- User explicitly wants the OKM proxy from rapid-automations ported (not a new implementation)
- Observations should eventually replace LSL as primary record (strategic direction for future milestones)
- Fast/cheap models for background observation work (not premium models)
- Full smoke test in test-coding.sh, not just import validation

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 20-foundation-opencode-om*
*Context gathered: 2026-03-29*
