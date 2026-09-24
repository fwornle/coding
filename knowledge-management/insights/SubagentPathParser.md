# SubagentPathParser

**Type:** Detail

## What It Is

SubagentPathParser is not a distinct class or file but a conceptual grouping of the path-parsing surface within `lib/lsl/adapters/claude-jsonl-tree.mjs`, the same file that implements its parent, ClaudeJsonlTreeAdapter. It centers on the module-level regex `SUBAGENT_PATH_RE`, which matches transcript paths of the shape `.../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` and captures three groups: encoded cwd, parent session UUID, and agent hex id. Four functions consume this regex: `projectFromClaudeSubagentPath()`, `parentSessionFromClaudeSubagentPath()`, `agentIdFromClaudeSubagentPath()`, and `subHashFromAgentId()` (which derives a 7-char hash from the agent id). Together these constitute the "parser" — though, as detailed below, it is not a single cohesive parse step but a family of independent extractors sharing one regex.

## Architecture and Design

The dominant pattern is regex-based path parsing via per-field extractor functions rather than a single parse-into-object step. Each of the three primary extractors independently calls `transcriptPath.match(SUBAGENT_PATH_RE)`, meaning the same string is matched up to three times to obtain three different fields for one logical file. This is the central architectural critique surfaced across observations: a shared parse boundary would let one match populate an object once, but instead each function re-derives it.

A second pattern is two-tier parsing: `projectFromClaudeSubagentPath()` is not purely regex-driven. When the structural match fails, it falls back to content-sniffing — reading the transcript's first JSONL line via `readFirstLine()` and extracting `obj.cwd` with `path.basename()`, ultimately returning the literal `'unknown'` if both routes fail. This trades parser purity for resilience against transcripts whose paths don't match `SUBAGENT_PATH_RE` but are still valid.

A third pattern, filter-at-discovery, ties this component directly to its parent: `walkSubAgentJsonl()`'s recursive `visit()` closure applies `SUBAGENT_PATH_RE.test(full)` to gate candidate files before any row is built, meaning the path parser functions as the first correctness/security boundary in the pipeline — ahead of the uid/sidechain/allowlist gates inside `buildRow()`.

Finally, the encode/decode pair `encodeCwd()`/`decodeEncodedCwd()` is maintained as two separately-evolving functions rather than one bidirectional codec, which the regex's first capture group silently depends on.

## Implementation Details

`SUBAGENT_PATH_RE`'s capture groups map directly to extractor return values: `parentSessionFromClaudeSubagentPath()` returns capture group 2 (parent UUID) or `null`; `agentIdFromClaudeSubagentPath()` returns capture group 3 (agent hex id) or `null`; `subHashFromAgentId()` chains off whichever value the latter returns to compute `sub_hash`. Because these functions read from fixed capture-group positions, any change to the regex's group layout requires manually reconciling four separate call sites rather than one parse boundary.

`projectFromClaudeSubagentPath()` diverges by depending on `decodeEncodedCwd()`, the inverse of `encodeCwd()`'s three-separator rule (`/`, `.`, `_` all become `-`). The docstring above `encodeCwd()` documents a historical bug where a missing underscore case broke every path under `~/Agentic/_work/`, producing an ENOENT from a nonexistent directory — evidence that this encode/decode symmetry is fragile and any future asymmetry would silently misparse the project segment without raising an error.

Return-value semantics are inconsistent across the family: `parentSessionFromClaudeSubagentPath()` and `agentIdFromClaudeSubagentPath()` return `null` on no match, while `projectFromClaudeSubagentPath()` returns `'unknown'`. Callers building generic "is this field present" logic must special-case the project extractor.

## Integration Points

The parser's primary integration point is upstream, with `walkSubAgentJsonl()`/`visit()` in the parent ClaudeJsonlTreeAdapter, which uses `SUBAGENT_PATH_RE.test()` as a discovery-stage filter before any row-building or content read occurs. Downstream, row construction (implied by the module's row-shape contract `{ agent, sub_hash, parent_session_id, sub_index, transcript_path, project, ... }`) calls `parentSessionFromClaudeSubagentPath()` and `agentIdFromClaudeSubagentPath()` separately to populate `parent_session_id` and derive `sub_hash`, rather than reading from one shared parsed object.

The parser also depends on `encodeCwd()`/`decodeEncodedCwd()` for the encoded-cwd capture group's semantics. This creates cross-file coupling with the sibling EncodeCwdConvention: `encodeCwd()` is duplicated in `lib/lsl/token/stop-adapter-registry.mjs` (private, non-exported, used inside `locateMainSessionJsonl()`) with only a comment asserting it is "kept character-for-character identical" — a claim the observations show doesn't strictly hold, since the adapter's version additionally strips trailing slashes before replacement. The sibling TranscriptTimestampReader (`readFirstMessageTimestamp()`/`readFirstLine()`) is thematically adjacent — also reading the first JSONL line — and shares the `readFirstLine()` helper that `projectFromClaudeSubagentPath()`'s fallback path also uses.

## Usage Guidelines

Developers extending or calling this parser family should be aware that no current caller combines all three extractor calls into a single parsed-object read for one path; each is invoked independently wherever that field is needed, meaning a full sweep of `~/.claude/projects/` re-executes the same regex match up to three times per file — a small but avoidable and multiplied CPU cost. Anyone touching `SUBAGENT_PATH_RE`'s capture-group layout must update all four dependent functions (`projectFromClaudeSubagentPath`, `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`, `subHashFromAgentId`) in lockstep, since there is no shared parse step enforcing consistency.

Callers should not treat the three extractors' "not found" sentinels as uniform — `'unknown'` versus `null` requires explicit handling. Anyone modifying `encodeCwd()` must also update `decodeEncodedCwd()` in the same file and the duplicated private copy in `stop-adapter-registry.mjs`, since the latter's synchronization is comment-only, not a shared import, and is already known to diverge on trailing-slash handling. Finally, because `projectFromClaudeSubagentPath()` performs file I/O as a fallback, callers should not assume it is a pure, side-effect-free string function.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The component named 'SubagentPathParser' maps directly onto the path-parsing surface of lib/lsl/adapters/claude-jsonl-tree.mjs: the module-level `SUBAGENT_PATH_RE` regex (matching `.../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`) plus the three extractor functions `projectFromClaudeSubagentPath()`, `parentSessionFromClaudeSubagentPath()`, and `agentIdFromClaudeSubagentPath()` that each independently re-run `transcriptPath.match(SUBAGENT_PATH_RE)` against the same string. This confirms the parent observation's critique: three call sites duplicate one regex match instead of parsing once into a shared object. `subHashFromAgentId()` extends the chain by deriving a 7-char `sub_hash` from whatever `agentIdFromClaudeSubagentPath()` returns, so a change to the capture-group layout in `SUBAGENT_PATH_RE` has to be manually reconciled across four functions rather than one parse boundary.
- `projectFromClaudeSubagentPath()` is not a pure regex parser — it has an explicit fallback path (landmine #1) that reads the transcript's first JSONL line via the local `readFirstLine()` helper and parses `obj.cwd` with `path.basename()` when the path-based regex match fails, finally returning the literal string `'unknown'` if both routes fail. This makes the 'parser' component a two-tier system (structural path parsing, then content-sniffing fallback) rather than a single regex-driven extractor, which is a meaningful trade-off: it trades parser purity for resilience against paths that technically don't match `SUBAGENT_PATH_RE` but are still valid transcripts.
- The regex itself hard-codes format assumptions that the rest of the file explicitly documents as fragile: the encoded-cwd capture group `(-[^/]+)` depends on `encodeCwd()`'s three-separator rule (`/`, `.`, `_` all become `-`), and the docstring above `encodeCwd()` recounts a concrete historical bug where the missing underscore case broke every path under `~/Agentic/_work/` (producing a directory that doesn't exist, causing ENOENT). `decodeEncodedCwd()` (used by `projectFromClaudeSubagentPath()`) is the inverse of that same rule and is equally exposed: any future asymmetry between `encodeCwd()`'s encode direction and `decodeEncodedCwd()`'s decode direction would silently misparse the project segment without either extractor function raising an error.
- `walkSubAgentJsonl()` — the tree-walking driver that ultimately feeds paths into these parser functions — applies `SUBAGENT_PATH_RE.test(full)` as a filter at the candidate-discovery stage inside its recursive `visit()` closure, before any row is built. This means malformed or non-subagent `.jsonl` files (e.g. top-level parent session transcripts) are excluded purely by regex shape, never reaching `buildRow()`'s uid/sidechain/allowlist gates. The path parser therefore functions as the FIRST security/correctness boundary in the pipeline, ahead of the file-content and ownership checks described in the parent context's `buildRow()` observation.


## Hierarchy Context

### Parent
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Claude sub-agent transcript discovery path via `walkSubAgentJsonl()`, which recursively visits `~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` and filters every candidate through `SUBAGENT_PATH_RE` at the candidate stage rather than after conversion. The regex captures three groups — encoded-cwd, parent session UUID, and agent hex id — that are re-extracted downstream by three separate single-purpose functions (`projectFromClaudeSubagentPath`, `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`) instead of being threaded through as a parsed object, so every caller that needs row metadata re-runs the same regex against the same path.

### Siblings
- [TranscriptTimestampReader](./TranscriptTimestampReader.md) -- [LLM] No file or function named 'TranscriptTimestampReader' appears anywhere in the supplied code. The closest thematic matches are `readFirstMessageTimestamp()` and the internal `readFirstLine()` helper in lib/lsl/adapters/claude-jsonl-tree.mjs, which read a single timestamp field from the first JSONL line of a Claude sub-agent transcript for use in `computeSubIndexes()` ordering. These are narrowly scoped, module-private helpers embedded in a larger adapter file, not a standalone reader component with the requested name.
- [EncodeCwdConvention](./EncodeCwdConvention.md) -- [LLM+CGR] `encodeCwd()` is implemented twice with the same transformation rule but different signatures and different specificity of comment. In `lib/lsl/adapters/claude-jsonl-tree.mjs` it is `encodeCwd(dir)` — exported, with an extensive JSDoc block explaining the historical landmine where the missing underscore case broke every `~/Agentic/_work/` path (fixed 2026-09-17), and explicitly noting it is NOT the same convention as pi's `encodePiSessionDir`. In `lib/lsl/token/stop-adapter-registry.mjs` it is a private, non-exported `encodeCwd(cwd)` used only inside `locateMainSessionJsonl()`, whose comment states it is 'kept character-for-character identical' to the adapter's version and points back at that file for the rationale rather than restating it. Both apply `.replace(/[/._]/g, '-')`, but the adapter version additionally strips trailing slashes first (`.replace(/\/+$/, '')`) — a divergence the 'kept character-for-character identical' claim does not actually hold if a caller passes a directory with a trailing slash.


---

*Generated from 9 observations*
