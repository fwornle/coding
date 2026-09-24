# ClaudeTokenRows

**Type:** Detail

## What It Is

ClaudeTokenRows is the `buildClaudeTokenRows` function, implemented in `claude-token-rows.mjs`. Its own source body is not present in the supplied observations — only its call sites and dependencies are visible: it is invoked from `lib/lsl/token/stop-adapter-registry.mjs` as the `build` half of the `claude` entry in `STOP_ADAPTERS`, and it calls into `parentSessionFromClaudeSubagentPath` (defined in `lib/lsl/adapters/claude-jsonl-tree.mjs`), plus two helpers, `estimateReasoningTokens` and `num`. Functionally, it is the transcript-to-token-row builder for the Claude agent within the broader TokenUsageAdapters registry, converting raw JSONL transcript records (main session and sub-agent) into token rows destined for DB insertion.

## Architecture and Design

ClaudeTokenRows participates in the Adapter/Strategy hybrid pattern established by its parent, TokenUsageAdapters: `STOP_ADAPTERS.claude` declares `mode: 'transcript'` and pairs `buildClaudeTokenRows` with `locateMainSessionJsonl`, with `subagents: true` enabling the builder to run against both the main session transcript and every sub-agent transcript reachable under a parent UUID. This build/locate pairing mirrors sibling adapters `OpencodeTokenRows` (`buildOpencodeTokenRows`) and the copilot equivalent, letting `captureForegroundTokens` treat all transcript-mode agents uniformly while the `pi` entry's absence of a `build` key enforces the D-04 invariant against double-counting proxy-routed tokens.

A second pattern is path-based provenance extraction via regex capture groups: `parentSessionFromClaudeSubagentPath` anchors on the sub-agent path convention `.../projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` (governed by `SUBAGENT_PATH_RE` in `claude-jsonl-tree.mjs`, also used by sibling `ClaudeJsonlTreeAdapter`'s `buildRow()`). This creates tight structural coupling between ClaudeTokenRows and the on-disk layout convention rather than a typed contract — a design trade-off favoring simplicity over resilience to Claude Code layout changes.

## Implementation Details

The visible call graph shows `buildClaudeTokenRows` calling three functions: `parentSessionFromClaudeSubagentPath` (parent session UUID resolution), `estimateReasoningTokens` (token estimation), and `num` (a bare one-letter helper, likely numeric coercion/defaulting on raw JSONL fields before estimation — consistent with defensive parsing patterns elsewhere in the codebase, such as `readFirstLine`/`readFirstAssistantRecord`'s try/catch swallow and bounded reads in `claude-jsonl-tree.mjs`). `parentSessionFromClaudeSubagentPath` itself is a thin accessor returning capture group 2 of `SUBAGENT_PATH_RE` or `null` on no match, tying parent-session attribution directly to the sub-agent path shape.

Because the actual row-shaping body isn't in the supplied excerpt, the mechanics of how a transcript record becomes a token row — where `num` and `estimateReasoningTokens` are invoked relative to each other — must be inferred from consumers rather than read directly.

## Integration Points

ClaudeTokenRows sits downstream of file-locator functions (`locateMainSessionJsonl`) and upstream of DB insertion (`insertTokenRowDeduped`) in the stop-adapter pipeline, wired via `stop-adapter-registry.mjs`. It depends on `claude-jsonl-tree.mjs` for `parentSessionFromClaudeSubagentPath` and the `SUBAGENT_PATH_RE` convention, and is itself invoked against both main and sub-agent transcripts when `subagents: true`, using the parent-session linkage for provenance back to the main session. Downstream interpretation must account for backend-dependent cache metadata gaps (per the GSD v7.4 Milestone State record) and known measurement anomalies documented for sibling adapters (OpenCode Measurement Gaps record) — a zero-cache row from ClaudeTokenRows is not necessarily a defect.

## Usage Guidelines

Any change to Claude Code's on-disk sub-agent path layout will silently break parent-session attribution in ClaudeTokenRows since the coupling is regex-based, not typed — this should be treated as a fragile integration point requiring test coverage tied to `SUBAGENT_PATH_RE`. When investigating anomalies in ClaudeTokenRows output, consult the OpenCode Measurement Gaps and GSD v7.4 records before assuming a bug, since backend-dependent data absence is expected. Finally, because the builder's own source wasn't available in this analysis, future work should retrieve `claude-token-rows.mjs` directly to confirm the numeric coercion (`num`) and estimation ordering rather than relying on this inferred call-graph description.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- buildClaudeTokenRows (function) in claude-token-rows.mjs

**Relationships:**
- Calls: parentSessionFromClaudeSubagentPath, estimateReasoningTokens, num
- The code graph shows buildClaudeTokenRows calling parentSessionFromClaudeSubagentPath, estimateReasoningTokens, and num, but the actual body of buildClaudeTokenRows is not present in the supplied claude-token-rows.mjs excerpt — only its call sites in claude-jsonl-tree.mjs (which defines parentSessionFromClaudeSubagentPath) and stop-adapter-registry.mjs (which imports buildClaudeTokenRows as the 'transcript' build function for the claude adapter entry) are visible. This means the row-shaping logic itself (how a transcript record becomes a token row, where estimateReasoningTokens and num are invoked) must be inferred from its consumers rather than read directly.

**Other:**
- Call chain: ClaudeTokenRows -> parentSessionFromClaudeSubagentPath
- Call chain: ClaudeTokenRows -> estimateReasoningTokens
- Call chain: ClaudeTokenRows -> num
- parentSessionFromClaudeSubagentPath, one of buildClaudeTokenRows' two direct dependencies, is a thin regex accessor over SUBAGENT_PATH_RE defined in claude-jsonl-tree.mjs, returning capture group 2 (the parent session UUID) or null on no match. This ties ClaudeTokenRows structurally to the sub-agent path convention `.../projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`, meaning any change to that path shape (e.g. Claude Code changing its on-disk layout) breaks token-row parent attribution silently rather than through a typed contract.
- stop-adapter-registry.mjs wires buildClaudeTokenRows into STOP_ADAPTERS.claude as the 'build' half of a build/locate pair (the other being locateMainSessionJsonl), with `subagents: true` — meaning ClaudeTokenRows is invoked not only against the main session transcript but also against each sub-agent transcript reachable under the parent UUID, with parentSessionFromClaudeSubagentPath supplying the linkage back to the main session for provenance.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'GSD v7.4 Milestone State' record establishes that cache metadata availability varies structurally by backend, so not all zero-cache observations from a token-row builder represent capture gaps — this bears directly on how ClaudeTokenRows' output should be interpreted downstream (a Claude row lacking cache fields is not necessarily a bug in buildClaudeTokenRows, but backend-dependent data absence).
- The 'OpenCode Measurement Gaps — Model Attribution and Token Scoping' record documents confirmed and active measurement anomalies affecting attribution and token scoping across agent adapters in this same family as ClaudeTokenRows; it is the reference for distinguishing a genuine defect in a token-row builder from an already-validated 'unmeasured' state, a distinction that cannot be recovered from buildClaudeTokenRows' source alone.

## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.

### Siblings
- [StopAdapterRegistry](./StopAdapterRegistry.md) -- [LLM+CGR] `STOP_ADAPTERS` in lib/lsl/token/stop-adapter-registry.mjs is a keyed-map registry (`claude`, `copilot`, `opencode`, `pi`) where three entries carry `mode: 'transcript'` with a `build`/`locate` pair (`buildClaudeTokenRows`/`locateMainSessionJsonl`, `buildCopilotTokenRows`/`locateCopilotSessionForSpan`, `buildOpencodeTokenRows`/`locateOpencodeStoreForSpan`) and one, `pi`, carries only `{ mode: 'stamp-only' }` with no build property at all. This asymmetry encodes the hard D-04 invariant directly in the data shape rather than in a branch some caller could get wrong: an agent is only eligible for transcript reconstruction if it bypasses rapid-llm-proxy, and the absence of a `build` key (not a flag check) is what prevents `captureForegroundTokens` from ever double-counting a proxy-routed agent's tokens.
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Path B sub-agent sweep adapter: SUBAGENT_PATH_RE anchors on `.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`, and buildRow() gates each candidate through a uid ownership check before any parsing occurs, matching the fs uid-check gate referenced as T-51-02-FI in the module header.
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs


---

*Generated from 14 observations*
