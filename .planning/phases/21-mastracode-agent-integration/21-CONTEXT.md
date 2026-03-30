# Phase 21: Mastracode Agent Integration - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Add mastracode as a fully integrated coding agent accessible via `coding --mastra`. This includes: agent adapter config, launch script, tmux session management with standard layout, LSL logging via mastra lifecycle hooks, statusline integration, and health monitoring. Mastracode joins Claude, Copilot, and OpenCode as the fourth agent in the coding infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Session Launch Flow
- **D-01:** Use the same launch-agent-common.sh framework as Claude/Copilot/OpenCode. Create `config/agents/mastra.sh` agent adapter + `scripts/launch-mastra.sh` thin wrapper. Add `coding --mastra` flag to the main launcher.
- **D-02:** Standard 2-pane tmux layout (left = mastracode TUI, right = services/health). Same layout as all other agents.
- **D-03:** Full coding services startup (Docker containers, health API, dashboard) — same as claude/copilot. No reduced service set.
- **D-04:** Launch in user's current working directory (same as all other agents).
- **D-05:** Parallel session capable — multiple agents can run simultaneously with separate session IDs, tmux windows, and LSL streams.
- **D-06:** Agent adapter handles first-run setup — agent_pre_launch() detects missing config/auth and guides user through inline setup.
- **D-07:** All LLM calls route through Phase 20's llm-proxy.mjs only — no direct API key fallback in mastra config.

### LSL Capture Method
- **D-08:** Mastra lifecycle hooks write to a transcript file (file-based pattern). ETM gets a new reader for this format. Same approach as Claude JSONL but through mastra hooks, NOT pipe-pane.
- **D-09:** Use native mastra format for transcript files — ETM gets a dedicated reader for this format rather than forcing JSONL conversion.
- **D-10:** LSL output goes to standard `.specstory/history/` directory with the same `YYYY-MM-DD_HHMM-HHMM_<hash>.md` naming convention. Cross-agent session browsing works seamlessly.
- **D-11:** No filename distinction for mastracode LSL files — agent identity is captured inside the file (header/metadata), not in the filename.

### Tmux Statusline
- **D-12:** Same combined statusline as all other agents — no mastra-specific indicators. Uses `scripts/combined-status-line.js` and tmux-provided segments.
- **D-13:** Unique color + icon to distinguish mastracode from Claude/Copilot/OpenCode at a glance.

### Error & Recovery
- **D-14:** Same recovery infrastructure as other agents — auto-restart watcher + health remediation + process supervisor. No special handling.
- **D-15:** If LLM proxy unreachable at startup, warn and continue (not block). Agent is usable for coding even without observation capability.
- **D-16:** Observations written to LibSQL as they happen (not batched). Crash loses at most the current in-flight message. Durable by default.

### Claude's Discretion
- Which binary/CLI mastracode actually uses (opencode with mastra plugin vs separate mastracode binary) — researcher determines from @mastra/opencode package
- Specific mastra lifecycle hook types and event schema
- Icon/color choice for statusline (as long as it's unique and distinct)
- ETM reader implementation details for native mastra format

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Agent Infrastructure (MUST follow these patterns)
- `config/agents/opencode.sh` — Agent adapter template (copy pattern for mastra.sh)
- `config/agents/claude.sh` — Another agent adapter reference
- `scripts/launch-agent-common.sh` — Shared launcher framework (mastra.sh sources this)
- `scripts/launch-claude.sh` — Thin wrapper pattern to follow
- `scripts/launch-copilot.sh` — Another thin wrapper reference

### LSL & ETM
- `scripts/enhanced-transcript-monitor.js` — ETM that needs new mastra reader
- `src/live-logging/StreamingTranscriptReader.js` — Existing transcript reader pattern
- `src/live-logging/AdaptiveExchangeExtractor.js` — Exchange extraction pattern
- `scripts/combined-status-line.js` — Statusline integration point
- `scripts/statusline-health-monitor.js` — Health monitoring pattern

### Phase 20 Infrastructure (MUST USE)
- `src/llm-proxy/llm-proxy.mjs` — LLM proxy bridge (all mastra LLM calls route here)
- `.observations/config.json` — Token budget config
- `.opencode/mastra.json` — Plugin config with LibSQL storage path
- `config/llm-providers.yaml` — Provider tiers

### Process Management
- `scripts/global-process-supervisor.js` — Process supervision (add mastra)
- `scripts/auto-restart-watcher.js` — Auto-restart infrastructure
- `scripts/health-remediation-actions.js` — Health remediation (add mastra checks)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `launch-agent-common.sh`: Full agent lifecycle framework — just create adapter + thin wrapper
- `combined-status-line.js`: Already supports multiple agents, needs mastra registration
- `global-process-supervisor.js`: Process monitoring, needs mastra agent type added
- `StreamingTranscriptReader.js`: File-watching transcript reader, pattern for mastra reader

### Established Patterns
- Agent adapters: `config/agents/<name>.sh` with `AGENT_NAME`, `AGENT_COMMAND`, hooks
- Launch wrappers: `scripts/launch-<name>.sh` sourcing `launch-agent-common.sh`
- Network-adaptive LLM: VPN detection in `agent_pre_launch()` for model routing
- LSL file management: `LSLFileManager.js` handles file creation, rotation, naming

### Integration Points
- `install.sh` — Already has `install_mastra_opencode()` from Phase 20
- `scripts/test-coding.sh` — Already has `test_mastra_opencode()` from Phase 20
- `scripts/agent-common-setup.sh` — Agent name registration
- Main launcher script (where `--mastra` flag needs to be added)

</code_context>

<specifics>
## Specific Ideas

- Follow the exact same patterns as existing agents — mastracode should be indistinguishable in terms of infrastructure quality
- First-run OAuth handling is important since mastracode may need it in headless tmux (research flag from Phase 20)
- The researcher should determine what binary @mastra/opencode actually provides and what lifecycle hooks are available

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-mastracode-agent-integration*
*Context gathered: 2026-03-30*
