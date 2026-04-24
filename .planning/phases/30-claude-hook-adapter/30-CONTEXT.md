# Phase 30: Claude Hook Adapter - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire a UserPromptSubmit hook script that calls the retrieval service (POST /api/retrieve on port 3033), filters irrelevant prompts, and injects the returned knowledge markdown into Claude's conversation context via the hook's stdout additionalContext mechanism.

</domain>

<decisions>
## Implementation Decisions

### Hook Architecture
- **D-01:** Create a separate hook script (NOT extending the existing constraint hook). Claude Code supports multiple hooks per event -- both run independently. The new script lives at `src/hooks/knowledge-injection-hook.js`.
- **D-02:** Register the new hook in `.claude/settings.local.json` under `hooks.UserPromptSubmit` as a second entry alongside the existing constraint monitor hook.

### Prompt Filtering
- **D-03:** Skip knowledge injection for short prompts (<20 tokens). Simple confirmations like "yes", "continue", "ok" don't benefit from knowledge context.
- **D-04:** Skip knowledge injection for slash commands (prompts starting with `/`). These are tool invocations, not knowledge queries.
- **D-05:** Skip knowledge injection for empty or whitespace-only prompts.
- **D-06:** When a prompt is filtered out, exit 0 immediately with no stdout (clean pass-through, no context injection).

### Output Format
- **D-07:** Use Claude Code's native hook output format: write JSON to stdout with `additionalContext` field. This appears as `<system-reminder>` context visible to Claude but not the user.
- **D-08:** The additionalContext content is the pre-formatted markdown from the retrieval service (tier headers, source attribution, relevance scores). No additional wrapping needed -- the retrieval service already formats it.

### Fail-Open Behavior
- **D-09:** If the retrieval service is unreachable, slow (>2s timeout), or returns an error, exit 0 with no stdout. Never block Claude from proceeding. Log errors to stderr only.
- **D-10:** If the retrieval service returns no results (all below threshold), exit 0 with no stdout. Don't inject empty context.

### Claude's Discretion
- Exact token counting method for the <20 token filter (character-based heuristic vs gpt-tokenizer)
- curl vs native http.request vs fetch for calling the retrieval endpoint
- Whether to pass the full prompt or first N characters to the retrieval service
- Timeout value (research suggests 2s, but could be 1s or 3s)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Hook Infrastructure
- `.claude/settings.local.json` -- Current hook registration (lines 293-311). Shows UserPromptSubmit + PreToolUse hook format.
- `integrations/mcp-constraint-monitor/src/hooks/pre-prompt-hook-wrapper.js` -- Existing hook pattern: reads stdin JSON, processes, exits 0/1. Reference for stdin parsing.

### Retrieval Service (Phase 29)
- `src/retrieval/retrieval-service.js` -- RetrievalService class with retrieve(query, options) method
- Health API endpoint: POST http://localhost:3033/api/retrieve -- accepts `{query, budget, threshold}`, returns `{markdown, meta}`

### Claude Code Hook API
- Hook stdin format: JSON with `{prompt_text}` (or similar -- check Claude Code docs)
- Hook stdout format: JSON with `{additionalContext: "..."}` for system-reminder injection
- 10,000 character cap on stdout output
- Hooks run synchronously before prompt processing

### Research
- `.planning/research/PITFALLS.md` -- Hook latency constraints, fail-open requirements
- `.planning/research/FEATURES.md` -- UserPromptSubmit hook details, 10K char cap

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pre-prompt-hook-wrapper.js`: Reference pattern for stdin JSON parsing, exit code handling, error logging
- Retrieval endpoint already returns pre-formatted markdown -- hook just pipes it through

### Established Patterns
- Hooks read JSON from stdin via `process.stdin` chunks
- Hooks use `process.exit(0)` for pass, `process.exit(1)` for block
- Error logging via `console.error` (hooks are exempt from no-console-log constraint since they run outside the main process)

### Integration Points
- `.claude/settings.local.json` hooks.UserPromptSubmit array -- add second entry
- Retrieval service at localhost:3033 -- called via HTTP from the hook script

</code_context>

<specifics>
## Specific Ideas

No specific requirements -- standard hook wiring with the retrieval service.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 30-claude-hook-adapter*
*Context gathered: 2026-04-24*
