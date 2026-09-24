# OpencodeTokenRows

**Type:** Detail

## What It Is

`OpencodeTokenRows` is centered on `buildOpencodeTokenRows`, a function defined in `opencode-token-rows.mjs`. Its defining file is not present in the supplied code corpus; everything known about it is inferred from its call graph and from its consumer, `lib/lsl/token/stop-adapter-registry.mjs`, which imports `buildOpencodeTokenRows` and `DEFAULT_OPENCODE_DB` from `./opencode-token-rows.mjs` (line 44) and wires them into the `STOP_ADAPTERS.opencode` entry alongside `locateOpencodeStoreForSpan`. As a child of the `TokenUsageAdapters` component, it is one of the transcript-mode build functions in the `STOP_ADAPTERS` registry, sitting next to siblings `ClaudeTokenRows` (`buildClaudeTokenRows`) and the copilot equivalent, and structurally parallel to `ClaudeJsonlTreeAdapter`'s sub-agent sweep logic.

## Architecture and Design

The component participates in the Adapter/Strategy registry pattern that defines the parent `TokenUsageAdapters`: each agent in `STOP_ADAPTERS` declares a `build`/`locate` pair under `mode: 'transcript'`, and `buildOpencodeTokenRows` is the `build` half of the `opencode` entry. What distinguishes it architecturally from its siblings is where two cross-cutting concerns are enforced. First, provider-gating (the no-double-count guarantee, D-04) — elsewhere expressed structurally via presence/absence of a `build` key — is, for OpenCode, enforced *inside* `buildOpencodeTokenRows` itself: the registry's comment states it emits a row only for a bypass provider (`github-copilot`) and skips proxy-backed providers (`anthropic` via `ANTHROPIC_BASE_URL`), since proxy-routed rows are already captured in `token_usage` by rapid-llm-proxy. Second, temporal filtering is pushed downstream: unlike `locateMainSessionJsonl` and `locateCopilotSessionForSpan`, which select per-session files by mtime against a `[started_at, ended_at + GRACE_MS]` window, `locateOpencodeStoreForSpan` is reduced to a simple existence check against one shared SQLite store (`DEFAULT_OPENCODE_DB`, `~/.local/share/opencode/opencode.db`). The span-window clamp instead happens per-row inside `buildOpencodeTokenRows` via a `withinSpanWindow` check against each message's own timestamp — a locate-then-build split where the filtering stage is chosen based on data shape (one store vs many files).

## Implementation Details

The code graph shows `buildOpencodeTokenRows` calling `summarizeParts`, `ownedDbPath`, `extractTokens`, `snip`, and `num`. None of these five functions appear in the supplied files, so their roles are inferred purely from naming and call position: `ownedDbPath` likely performs a uid-ownership gate on the SQLite path, mirroring the uid-check pattern used elsewhere (e.g., the uid gate in `ClaudeJsonlTreeAdapter`'s `buildRow()`); `extractTokens` and `summarizeParts` likely read OpenCode's native per-message row shape from `opencode.db` and reduce it to row-level token counts; `snip` and `num` read as small formatting helpers (string truncation and numeric coercion) supporting diagnostics or row payload construction. Notably, the registry frames OpenCode's source as native, per-message granularity ("records native PER-MESSAGE tokens (per-turn granularity)"), contrasting with claude/copilot's whole-transcript JSONL rebuild — implying `buildOpencodeTokenRows` iterates individual message rows rather than parsing a transcript file, though this cannot be confirmed without the actual source.

## Integration Points

The sole confirmed integration point is `lib/lsl/token/stop-adapter-registry.mjs`, which imports `buildOpencodeTokenRows` and `DEFAULT_OPENCODE_DB` and registers them as the `build`/`locate` pair for `STOP_ADAPTERS.opencode` (`subagents: false`). Through this registry it participates in the same uniform interface that `captureForegroundTokens` uses across all four agents. Downstream, dashboard behavior depends on this function's gating: the "OpenCode Measurement Gaps" work record confirms that "unmeasured" chat-model states in Compare/Runs/Timeline views for proxy-backed OpenCode sessions are valid (VALID-01, closed), a direct consequence of provider-gating producing zero rows deliberately. Separately, the "GSD v7.4 Milestone State" record notes cache-metadata availability varies by backend, suggesting `extractTokens`/`summarizeParts` may operate on an OpenCode native store lacking cache-token fields present in proxy `token_usage` rows — though this is unconfirmed against actual source.

## Usage Guidelines

Given the missing source file, any change to `opencode-token-rows.mjs` should preserve two invariants documented at the registry level: provider-gating must remain internal to the build function (not migrated to the locator or registry) to keep the no-double-count guarantee intact, and span-window filtering must stay per-row (via `withinSpanWindow`) since the shared single-DB locate stage cannot perform file-level windowing. A zero-row or zero-cache result for an OpenCode session should not be treated as a capture bug without first checking whether the session was proxy-routed or whether the backend simply lacks cache-metadata fields — both are documented as valid, non-defect states.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- buildOpencodeTokenRows (function) in opencode-token-rows.mjs

**Relationships:**
- Calls: summarizeParts, ownedDbPath, extractTokens

**Other:**
- Call chain: OpencodeTokenRows -> summarizeParts
- Call chain: OpencodeTokenRows -> ownedDbPath
- Call chain: OpencodeTokenRows -> extractTokens
- Call chain: OpencodeTokenRows -> snip
- Call chain: OpencodeTokenRows -> num
- The code graph's call edges for `buildOpencodeTokenRows` — `summarizeParts`, `ownedDbPath`, `extractTokens`, `snip`, `num` — sketch a five-stage pipeline that is not visible in any of the supplied files: `ownedDbPath` implies a uid-ownership check on the SQLite path (mirroring the uid-gate pattern `buildClaudeTokenRows` and `buildCopilotTokenRows` apply to their own transcript sources per the parent's D-04 invariant), `extractTokens` and `summarizeParts` imply OpenCode's native per-message row shape is read and reduced to a row-level token count, and `snip`/`num` read as small formatting helpers (string truncation, numeric coercion) used when building the stderr diagnostics or the row payload itself. None of these five functions appear in the code files provided, so this is inferred from naming and call position alone.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'OpenCode Measurement Gaps' work record establishes that the 'unmeasured' chat-model state seen for OpenCode runs in the Compare/Runs/Timeline dashboard views is validated correct behavior (tracked as VALID-01, fully closed) rather than a capture defect — directly relevant to `buildOpencodeTokenRows`, since its provider-gating is the mechanism that deliberately produces zero rows for proxy-backed OpenCode sessions.
- The 'GSD v7.4 Milestone State' record documents that cache-metadata availability varies structurally by backend, so a zero-cache observation on an OpenCode row is not necessarily a capture gap — this bears on `extractTokens`/`summarizeParts` (per the code graph) if OpenCode's native per-message store does not carry cache-token fields the way the proxy's `token_usage` rows do for other agents, though the code files here do not confirm that detail.

## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.

### Siblings
- [StopAdapterRegistry](./StopAdapterRegistry.md) -- [LLM+CGR] `STOP_ADAPTERS` in lib/lsl/token/stop-adapter-registry.mjs is a keyed-map registry (`claude`, `copilot`, `opencode`, `pi`) where three entries carry `mode: 'transcript'` with a `build`/`locate` pair (`buildClaudeTokenRows`/`locateMainSessionJsonl`, `buildCopilotTokenRows`/`locateCopilotSessionForSpan`, `buildOpencodeTokenRows`/`locateOpencodeStoreForSpan`) and one, `pi`, carries only `{ mode: 'stamp-only' }` with no build property at all. This asymmetry encodes the hard D-04 invariant directly in the data shape rather than in a branch some caller could get wrong: an agent is only eligible for transcript reconstruction if it bypasses rapid-llm-proxy, and the absence of a `build` key (not a flag check) is what prevents `captureForegroundTokens` from ever double-counting a proxy-routed agent's tokens.
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Path B sub-agent sweep adapter: SUBAGENT_PATH_RE anchors on `.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`, and buildRow() gates each candidate through a uid ownership check before any parsing occurs, matching the fs uid-check gate referenced as T-51-02-FI in the module header.
- [ClaudeTokenRows](./ClaudeTokenRows.md) -- [CGR] buildClaudeTokenRows (function) in claude-token-rows.mjs


---

*Generated from 16 observations*
