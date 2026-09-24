# ClaudeJsonlTreeAdapter

**Type:** Detail

# ClaudeJsonlTreeAdapter: Technical Insight Document

## What It Is

ClaudeJsonlTreeAdapter is implemented in `lib/lsl/adapters/claude-jsonl-tree.mjs` as the "Path B sub-agent sweep adapter" — a discovery-and-enrichment module responsible for locating and validating Claude sub-agent transcript files matching the pattern `.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`. It sits within LiveLoggingSystem and, more specifically, is one of the concrete strategies registered under TokenUsageAdapters, alongside sibling adapters StopAdapterRegistry, ClaudeTokenRows, and OpencodeTokenRows. Rather than owning full token-usage row construction, it scopes itself to discovery, path parsing, gating, and enrichment, delegating final conversion to `convertTranscriptsToObservations()` in `scan-and-convert.mjs`.

## Architecture and Design

The module exhibits defense-in-depth gating: `buildRow()` applies a uid ownership check (T-51-02-FI) before any parsing occurs, layered with an isSidechain filter and project-name allowlist — no row is constructed from unvalidated input. This is paired with a two-tier fallback extraction strategy: `projectFromClaudeSubagentPath()` first attempts regex-based decoding via `SUBAGENT_PATH_RE`, falling back to reading the transcript's first JSONL line's `cwd` field through `readFirstLine()` when path-walk fails ("landmine #1"). Across the module, a consistent "never crash, lose completeness instead" posture governs error handling — malformed input degrades to null/empty defaults rather than throwing, a posture explicitly mirrored in sibling module `stop-adapter-registry.mjs`.

## Implementation Details

Key functions include `SUBAGENT_PATH_RE` (the anchoring regex), `encodeCwd()` (normalizes '/', '.', and '_' as equivalent separators, with an added underscore rule fixing collisions under `~/Agentic/_work/` that previously produced ENOENT-causing double-dash paths), `computeSubIndexes()` (groups rows by `parent_session_id` and assigns 1-based sub_index by ascending first-message timestamp rather than filename order, per "RESEARCH-claude.md landmine #8"), and `buildRow()` (tolerates malformed first lines by setting `firstObj` to null, letting `Date.parse('') === NaN → 0` drive lexicographic fallback ordering).

The child component SubagentPathParser encapsulates the regex-matching surface: `SUBAGENT_PATH_RE` plus `projectFromClaudeSubagentPath()`, `parentSessionFromClaudeSubagentPath()`, and `agentIdFromClaudeSubagentPath()` each independently re-run the same match, extended further by `subHashFromAgentId()`. This is a known maintainability liability — four functions must be manually reconciled if the regex's capture groups change, rather than parsing once into a shared object.

TranscriptTimestampReader as a named component doesn't exist verbatim; the closest implementation is `readFirstMessageTimestamp()` and internal helper `readFirstLine()`, module-private utilities feeding `computeSubIndexes()`.

EncodeCwdConvention documents that `encodeCwd()` is deliberately duplicated (not shared via import) between this adapter and `stop-adapter-registry.mjs`, with the adapter's version treated as canonical (extensive JSDoc, exported) and the registry's version explicitly commented as "kept character-for-character identical" — though this claim is undermined by the adapter's additional trailing-slash stripping (`.replace(/\/+$/, '')`) absent from the registry copy.

## Integration Points

Downstream, rows produced by this adapter feed dashboard reasoning distinguishing "unmeasured" from defective capture states (per 'v7.2 Performance Measurement System' / 'OpenCode Measurement Gaps'), and cache-metadata absence in Claude sub-agent rows must be interpreted per-backend rather than as a gap (per 'GSD v7.4 Milestone State'). Within TokenUsageAdapters, the parent's `STOP_ADAPTERS` registry encodes the D-04 invariant — only agents bypassing rapid-llm-proxy get transcript rebuilds — via presence/absence of a `build`/`locate` pair rather than a branch, and this adapter is one such transcript-mode implementation alongside ClaudeTokenRows and OpencodeTokenRows.

## Usage Guidelines

Developers must not assume `encodeCwd()` is safely shared — changes to the adapter's version require manually propagating to `stop-adapter-registry.mjs`, and the trailing-slash divergence should be resolved or explicitly documented. Any modification to `SUBAGENT_PATH_RE`'s capture groups requires updating all four SubagentPathParser functions in lockstep. Ordering logic must always use `computeSubIndexes()`'s timestamp-based approach, never filename order. Finally, zero-cache or malformed-row conditions are expected degrade states, not necessarily bugs — callers should preserve this best-effort semantics rather than tightening to hard failures.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the 'v7.2 Performance Measurement System' and 'OpenCode Measurement Gaps' records, dashboards distinguish expected 'unmeasured' chat-model states from real capture defects for OpenCode — this class of measured/unmeasured attribution reasoning is the downstream consumer context for rows this adapter and its sibling stop-adapter-registry.mjs produce.
- The 'GSD v7.4 Milestone State' record documents that cache metadata availability varies structurally by agent backend, meaning a zero-cache observation from a Claude sub-agent transcript row built by this adapter is not necessarily a capture gap but an expected per-backend asymmetry.

## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.

### Children
- [SubagentPathParser](./SubagentPathParser.md) -- [LLM+CGR] The component named 'SubagentPathParser' maps directly onto the path-parsing surface of lib/lsl/adapters/claude-jsonl-tree.mjs: the module-level `SUBAGENT_PATH_RE` regex (matching `.../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`) plus the three extractor functions `projectFromClaudeSubagentPath()`, `parentSessionFromClaudeSubagentPath()`, and `agentIdFromClaudeSubagentPath()` that each independently re-run `transcriptPath.match(SUBAGENT_PATH_RE)` against the same string. This confirms the parent observation's critique: three call sites duplicate one regex match instead of parsing once into a shared object. `subHashFromAgentId()` extends the chain by deriving a 7-char `sub_hash` from whatever `agentIdFromClaudeSubagentPath()` returns, so a change to the capture-group layout in `SUBAGENT_PATH_RE` has to be manually reconciled across four functions rather than one parse boundary.
- [TranscriptTimestampReader](./TranscriptTimestampReader.md) -- [LLM] No file or function named 'TranscriptTimestampReader' appears anywhere in the supplied code. The closest thematic matches are `readFirstMessageTimestamp()` and the internal `readFirstLine()` helper in lib/lsl/adapters/claude-jsonl-tree.mjs, which read a single timestamp field from the first JSONL line of a Claude sub-agent transcript for use in `computeSubIndexes()` ordering. These are narrowly scoped, module-private helpers embedded in a larger adapter file, not a standalone reader component with the requested name.
- [EncodeCwdConvention](./EncodeCwdConvention.md) -- [LLM+CGR] `encodeCwd()` is implemented twice with the same transformation rule but different signatures and different specificity of comment. In `lib/lsl/adapters/claude-jsonl-tree.mjs` it is `encodeCwd(dir)` — exported, with an extensive JSDoc block explaining the historical landmine where the missing underscore case broke every `~/Agentic/_work/` path (fixed 2026-09-17), and explicitly noting it is NOT the same convention as pi's `encodePiSessionDir`. In `lib/lsl/token/stop-adapter-registry.mjs` it is a private, non-exported `encodeCwd(cwd)` used only inside `locateMainSessionJsonl()`, whose comment states it is 'kept character-for-character identical' to the adapter's version and points back at that file for the rationale rather than restating it. Both apply `.replace(/[/._]/g, '-')`, but the adapter version additionally strips trailing slashes first (`.replace(/\/+$/, '')`) — a divergence the 'kept character-for-character identical' claim does not actually hold if a caller passes a directory with a trailing slash.

### Siblings
- [StopAdapterRegistry](./StopAdapterRegistry.md) -- [LLM+CGR] `STOP_ADAPTERS` in lib/lsl/token/stop-adapter-registry.mjs is a keyed-map registry (`claude`, `copilot`, `opencode`, `pi`) where three entries carry `mode: 'transcript'` with a `build`/`locate` pair (`buildClaudeTokenRows`/`locateMainSessionJsonl`, `buildCopilotTokenRows`/`locateCopilotSessionForSpan`, `buildOpencodeTokenRows`/`locateOpencodeStoreForSpan`) and one, `pi`, carries only `{ mode: 'stamp-only' }` with no build property at all. This asymmetry encodes the hard D-04 invariant directly in the data shape rather than in a branch some caller could get wrong: an agent is only eligible for transcript reconstruction if it bypasses rapid-llm-proxy, and the absence of a `build` key (not a flag check) is what prevents `captureForegroundTokens` from ever double-counting a proxy-routed agent's tokens.
- [ClaudeTokenRows](./ClaudeTokenRows.md) -- [CGR] buildClaudeTokenRows (function) in claude-token-rows.mjs
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs


---

*Generated from 10 observations*
