# Phase 22: Transcript Converters - Context

**Gathered:** 2026-04-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Build CLI commands that convert historical transcripts from all three agents (Claude JSONL, Copilot events.jsonl, .specstory LSL files) into mastra observations stored in LibSQL. A shared normalization layer (MastraDBMessage format) ensures all three converters share parsing logic, not three separate implementations. Batch conversion of .specstory files uses manifest-based idempotency to avoid double-processing.

</domain>

<decisions>
## Implementation Decisions

### CLI Interface
- **D-01:** Single CLI script (`scripts/convert-transcripts.js` or `bin/convert-transcripts`) with subcommands: `claude`, `copilot`, `specstory`, and `batch` (for .specstory bulk conversion).
- **D-02:** Invocation pattern: `node scripts/convert-transcripts.js claude <path-to-jsonl>`, `node scripts/convert-transcripts.js copilot <path-to-events.jsonl>`, `node scripts/convert-transcripts.js specstory <path-to-specstory-dir> [--batch]`
- **D-03:** Output goes to the per-project LibSQL database at `.observations/observations.db` (per Phase 20 D-04/D-05).

### Normalization Architecture
- **D-04:** Single normalizer module (`src/live-logging/TranscriptNormalizer.js` or similar) with format-specific parsers that all output `MastraDBMessage` objects.
- **D-05:** Each format parser: `parseClaude(jsonlLine) → MastraDBMessage`, `parseCopilot(eventLine) → MastraDBMessage`, `parseSpecstory(mdContent) → MastraDBMessage[]`.
- **D-06:** Reuse existing readers where possible — `StreamingTranscriptReader.js` already parses Claude JSONL, `AdaptiveTranscriptFormatDetector.js` handles format detection. Don't reinvent parsing.

### LLM Routing for observe()
- **D-07:** The observe() API calls (which summarize/classify transcripts into observations) MUST route through the coding LLM proxy — same as Phase 20 D-01/D-03. No direct Google/Anthropic API keys in converter config.
- **D-08:** Use the LLM proxy bridge at `src/llm-proxy/llm-proxy.mjs` (port 8089) for observe() calls. This gives network-adaptive routing (VPN → Copilot, outside → Claude subscription).
- **D-09:** Fix the current mastra observation failure (`GOOGLE_GENERATIVE_AI_API_KEY not found`) by routing observe() through our proxy instead of directly to Google.

### Batch Processing & Idempotency
- **D-10:** Manifest file at `.observations/conversion-manifest.json` tracks which .specstory files have been converted, with content hashes for change detection.
- **D-11:** `--force` flag to re-process already-converted files.
- **D-12:** Process files in chronological order (oldest first) to maintain temporal consistency in observations.

### Claude's Discretion
- Exact MastraDBMessage type shape (determined by @mastra/core's type definitions)
- Internal chunking strategy for large transcripts (split by exchange or by token count)
- Progress reporting format during batch conversion (stderr log lines vs progress bar)
- Whether to use observe() directly or buffer and batch observations

### Folded Todos
- **LLM-based semantic deduplication** — from pipeline backlog. Observations from overlapping transcripts (e.g. Claude JSONL + .specstory from same session) may produce duplicate observations. Dedup should happen at observe() time or as a post-processing pass.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Transcript Readers (MUST reuse patterns)
- `src/live-logging/StreamingTranscriptReader.js` — Claude JSONL parsing
- `src/live-logging/MastraTranscriptReader.js` — Mastra NDJSON parsing (Phase 21)
- `src/live-logging/AdaptiveTranscriptFormatDetector.js` — Format detection logic
- `scripts/enhanced-transcript-monitor.js` — ETM that orchestrates all readers

### LLM Proxy Infrastructure (MUST use for observe())
- `src/llm-proxy/llm-proxy.mjs` — HTTP bridge to LLMService
- `config/llm-providers.yaml` — Provider definitions
- `.observations/config.json` — Token budgets and model config

### Phase 20 Decisions (carry forward)
- `.planning/phases/20-foundation-opencode-om/20-CONTEXT.md` — LibSQL storage, LLM routing, token budgets
- `.planning/phases/20-foundation-opencode-om/20-01-SUMMARY.md` — LLM proxy implementation details

### Mastra Core Types
- `node_modules/@mastra/core/` — MastraDBMessage type, observe() API
- `node_modules/@mastra/memory/` — Memory storage interface
- `node_modules/@mastra/libsql/` — LibSQL storage adapter

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StreamingTranscriptReader.js` — Already parses Claude JSONL, can be imported for claude converter
- `AdaptiveTranscriptFormatDetector.js` — Detects transcript format from file content, useful for auto-detection mode
- `MastraTranscriptReader.js` — NDJSON parsing pattern, can inform copilot parser
- `LSLFileManager.js` — File management patterns for .specstory files

### Established Patterns
- All live-logging modules use Node.js ESM (`import`/`export default`)
- `process.stderr.write()` for logging (no console.log per CLAUDE.md)
- EventEmitter pattern for streaming data through pipeline
- Config loading from `.observations/config.json`

### Integration Points
- LibSQL at `.observations/observations.db` — write destination
- LLM proxy at `localhost:8089` — observe() LLM calls
- `.specstory/history/` — source files for batch conversion
- `~/.claude/projects/` — source for Claude JSONL transcripts
- `~/.copilot/session-state/` — source for Copilot events

</code_context>

<specifics>
## Specific Ideas

- The user flagged that mastra's observation system currently fails with `GOOGLE_GENERATIVE_AI_API_KEY not found` — D-09 addresses this by routing through the LLM proxy
- Converters should be usable standalone (not require a full `coding --mastra` session) since they process historical data
- The .specstory batch converter is the highest-value converter since there's months of historical session data

</specifics>

<deferred>
## Deferred Ideas

- Real-time observation tap during live sessions (Phase 23)
- Dashboard REST endpoint for browsing observations (Phase 23)
- OpenCode SQLite → observations converter (could extend the normalizer, but not in requirements)

### Reviewed Todos (not folded)
- Replace console.log with proper logging — too broad for this phase, applies across codebase

</deferred>

---

*Phase: 22-transcript-converters*
*Context gathered: 2026-04-03 via auto mode*
