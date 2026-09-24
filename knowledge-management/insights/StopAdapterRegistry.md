# StopAdapterRegistry

**Type:** Detail

## What It Is

`StopAdapterRegistry` is implemented in `lib/lsl/token/stop-adapter-registry.mjs`, centered on the `STOP_ADAPTERS` keyed map (lines 112-153) that defines per-agent behavior for `claude`, `copilot`, `opencode`, and `pi`. It is the concrete data structure underlying the parent component `TokenUsageAdapters`, and serves as the lookup table that `captureForegroundTokens` consults to decide, per agent, whether and how to reconstruct token usage from a transcript at session-stop time.

## Architecture and Design

The registry is a Strategy/Adapter hybrid: rather than branching on agent type, callers perform a table lookup into `STOP_ADAPTERS`. Three entries (`claude`, `copilot`, `opencode`) declare `mode: 'transcript'` with paired `build`/`locate` functions (`buildClaudeTokenRows`/`locateMainSessionJsonl`, `buildCopilotTokenRows`/`locateCopilotSessionForSpan`, `buildOpencodeTokenRows`/`locateOpencodeStoreForSpan`); `pi` declares only `{ mode: 'stamp-only' }` with no `build` key at all. This is a deliberate design choice: the D-04 invariant (agents routed through rapid-llm-proxy must never get a transcript rebuild, to avoid double-counting) is encoded structurally in the data shape — the absence of a key — rather than as a boolean flag a caller could misread or bypass.

A second recurring pattern is fail-open locating: `locateMainSessionJsonl` and `locateCopilotSessionForSpan` each wrap their body in try/catch, log a non-fatal `[stop-adapter]` line to stderr, and return `''` on failure instead of throwing. This reflects the operating assumption (documented in the "Observation Pipeline — Outage, Backfill, and Data-Loss Modes" work record) that the measurement-stop close path must never crash even when artifact extraction silently fails.

A third pattern is deliberate duplication over shared abstraction, applied in two places: `encodeCwd` (duplicated from `ClaudeJsonlTreeAdapter`'s `claude-jsonl-tree.mjs:64-66`) and the mtime-grace-window locator logic shared conceptually, but not in code, between the claude and copilot locators.

## Implementation Details

`locateMainSessionJsonl` and `locateCopilotSessionForSpan` (lines 206-256 and 265-296) independently implement the same selection algorithm — mtime falling inside `[started_at, ended_at + GRACE_MS]` with `GRACE_MS = 5 * 60 * 1000`, most-recent-wins — each hardcoded rather than factored into a shared helper. `locateOpencodeStoreForSpan` (lines 305-320) breaks this pattern: because OpenCode keeps a single SQLite store for all sessions instead of per-session files, it degenerates to a bare `fs.existsSync` check, pushing actual span-window filtering downstream into sibling `OpencodeTokenRows`'s `withinSpanWindow` logic inside `buildOpencodeTokenRows`.

`locateMainSessionJsonl` resolves the transcript directory via `span?.<COMPANY_NAME_REDACTED>?.cwd || process.cwd()`, encoding two provenance assumptions behind one ternary: sandboxed experiment cells (which carry `<COMPANY_NAME_REDACTED>.cwd` distinct from the stop process's own directory, per a documented ~530× claude undercount incident) and interactive `/gsd` sessions (which carry no `<COMPANY_NAME_REDACTED>.cwd` and legitimately share the stop process's directory).

The module-level `encodeCwd` (lines 186-198) is a byte-for-byte duplicate of the exported `encodeCwd` in `ClaudeJsonlTreeAdapter`, with an inline comment cross-referencing the other file rather than importing it — both copies must independently apply `/[/._]/g` including the underscore, after a documented incident where `~/Agentic/_work/` paths encoded incorrectly.

Provenance tagging is handled via two conventions applied at row-insertion time (lines 69-79): `SUBAGENT_PROCESS` (`'token-adapter-claude-subagent'`) and `fallbackProcessFor(agent)` (`token-adapter-<agent>-fallback`). `SUBAGENT_PROCESS` deliberately does not match `BACKGROUND_PROCESS_RE`, so Task sub-agent rows count as foreground for fg/bg accounting while remaining excludable from canonical chat-model selection.

## Integration Points

The registry's `build` functions delegate directly to sibling adapters `ClaudeTokenRows` (`buildClaudeTokenRows`) and `OpencodeTokenRows` (`buildOpencodeTokenRows`), and to an equivalent copilot builder. Its `encodeCwd` duplicates logic owned by `ClaudeJsonlTreeAdapter`. The `fallbackProcessFor` tagging mirrors, on the token-capture path, the same class of silent-failure problem documented for `ObservationWriter`'s `[Raw]` fallback rows — instead of trusting a log line, both systems stamp a distinct queryable identifier so state can be verified after the fact. DB close is guaranteed via a `finally` block, ensuring a capture failure never blocks the measurement-stop close that every agent's session teardown depends on.

## Usage Guidelines

Any modification to `encodeCwd` must be mirrored in both this file and `claude-jsonl-tree.mjs`, since the duplication is intentional but unsynchronized — fixing one without the other reintroduces the `~/Agentic/_work/` encoding bug. Similarly, changes to the mtime-grace-window algorithm must be applied to both `locateMainSessionJsonl` and `locateCopilotSessionForSpan` independently. New agent entries in `STOP_ADAPTERS` should omit the `build` key entirely (not set a flag) if the agent routes through rapid-llm-proxy, preserving the D-04 invariant structurally. New locator functions should follow the fail-open contract: catch all errors, log via `[stop-adapter]` to stderr, and return `''` rather than throwing.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- `SUBAGENT_PROCESS` ('token-adapter-claude-subagent') and `fallbackProcessFor(agent)` (returning `token-adapter-<agent>-fallback`) are two distinct provenance-tagging conventions applied at row-insertion time, both designed so a downstream consumer can distinguish row classes purely by querying the `process` column rather than needing a schema migration. `SUBAGENT_PROCESS` deliberately does NOT match `BACKGROUND_PROCESS_RE`, keeping Task sub-agent rows classified as foreground for fg/bg accounting while still being excludable from canonical chat-model selection — the comment explicitly calls out that a cheap sub-agent sweep model must not hijack the canonical model attributed to the interactive chat session.

**Other:**
- `STOP_ADAPTERS` in lib/lsl/token/stop-adapter-registry.mjs is a keyed-map registry (`claude`, `copilot`, `opencode`, `pi`) where three entries carry `mode: 'transcript'` with a `build`/`locate` pair (`buildClaudeTokenRows`/`locateMainSessionJsonl`, `buildCopilotTokenRows`/`locateCopilotSessionForSpan`, `buildOpencodeTokenRows`/`locateOpencodeStoreForSpan`) and one, `pi`, carries only `{ mode: 'stamp-only' }` with no build property at all. This asymmetry encodes the hard D-04 invariant directly in the data shape rather than in a branch some caller could get wrong: an agent is only eligible for transcript reconstruction if it bypasses rapid-llm-proxy, and the absence of a `build` key (not a flag check) is what prevents `captureForegroundTokens` from ever double-counting a proxy-routed agent's tokens.
- `locateMainSessionJsonl` and `locateCopilotSessionForSpan` are two independent implementations of the identical 'mtime inside `[started_at, ended_at + GRACE_MS]`, most-recent-wins' selection algorithm, each hardcoding `GRACE_MS = 5 * 60 * 1000` and each documented as mirroring the other rather than sharing a helper. The `locateOpencodeStoreForSpan` function breaks this pattern entirely — since OpenCode keeps one SQLite store for all sessions rather than per-session files, this locator degenerates to a bare `fs.existsSync` check and pushes the actual per-message span-window clamp downstream into `buildOpencodeTokenRows`'s `withinSpanWindow` logic, meaning the three locators are only superficially uniform (same call signature) but structurally different in where the time-filtering happens.
- The module-level `encodeCwd` function in stop-adapter-registry.mjs is a byte-for-byte duplicate of the exported `encodeCwd` in lib/lsl/adapters/claude-jsonl-tree.mjs, and the registry's copy contains an explicit comment acknowledging this and cross-referencing the other file by name rather than importing it. This is a documented, deliberate duplication rather than an oversight — both copies must independently include underscore in `/[/._]/g` after a documented incident where `~/Agentic/_work/` projects encoded to a non-existent directory (`-Users-<USER_ID_REDACTED>-Agentic-_work-...` vs the real `--work-` double-dash form), so any future fix to one copy without the other reintroduces that exact bug on whichever surface got missed.
- `locateMainSessionJsonl` resolves the transcript directory from `span?.<COMPANY_NAME_REDACTED>?.cwd || process.cwd()` instead of unconditionally using the stop-process's own cwd, with an inline comment attributing this to a measured '~530× claude undercount' when a sandboxed experiment cell's agent ran in a throwaway worktree distinct from the stop process's directory. The fallback to `process.cwd()` is preserved specifically because interactive `/gsd` sessions carry no `<COMPANY_NAME_REDACTED>.cwd` and legitimately share the stop process's own directory — so the function encodes two different provenance assumptions (sandboxed experiment vs. interactive session) behind one ternary, rather than requiring callers to specify which case they're in.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Per the 'ObservationWriter — Semantic Dedup, Snapshot Promotion, and Raw Fallback Silent' work record, ObservationWriter.js has a known failure mode where [Raw] fallback rows are logged as 'storing' yet silently fail to persist; `fallbackProcessFor`'s provenance tag is this same registry's independent answer to that class of problem on the token-capture path — instead of a log line asserting success, a transcript row inserted without a wire match is stamped with a distinct, queryable `process` value so its fallback state can be verified after the fact rather than trusted from a log statement.
- The 'Observation Pipeline — Outage, Backfill, and Data-Loss Modes' work record documents that this pipeline must be assumed capable of appearing 'down' or losing data due to real gaps in artifact extraction, not just crashes; the registry's `locateMainSessionJsonl` and `locateCopilotSessionForSpan` both wrap their entire body in try/catch, write a non-fatal `[stop-adapter]` line to stderr on failure, and return `''` rather than throwing — reflecting the same operating assumption that degrading silently to zero captured rows is preferable to crashing the measurement-stop close that every agent's session teardown depends on.

## Hierarchy Context

### Parent
- [TokenUsageAdapters](./TokenUsageAdapters.md) -- [LLM] `STOP_ADAPTERS` (lib/lsl/token/stop-adapter-registry.mjs) is the component's core data structure: a per-agent keyed registry where each entry declares `mode: 'transcript'` (claude, copilot, opencode) or `mode: 'stamp-only'` (pi), with only 'transcript' entries carrying a `build`/`locate` pair. This is a deliberate Strategy/Adapter hybrid — the keyed-map shape lets `captureForegroundTokens` treat all four agents uniformly while the mode flag encodes a hard invariant (D-04): only agents that bypass rapid-llm-proxy get a transcript rebuild, because building one for a proxy-routed agent would double-count tokens already present in `token_usage`.

### Siblings
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Path B sub-agent sweep adapter: SUBAGENT_PATH_RE anchors on `.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`, and buildRow() gates each candidate through a uid ownership check before any parsing occurs, matching the fs uid-check gate referenced as T-51-02-FI in the module header.
- [ClaudeTokenRows](./ClaudeTokenRows.md) -- [CGR] buildClaudeTokenRows (function) in claude-token-rows.mjs
- [OpencodeTokenRows](./OpencodeTokenRows.md) -- [CGR] buildOpencodeTokenRows (function) in opencode-token-rows.mjs


---

*Generated from 10 observations*
