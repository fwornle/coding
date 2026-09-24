# EncodeCwdConvention

**Type:** Detail

# EncodeCwdConvention — Technical Insight Document

## What It Is

EncodeCwdConvention is a string-transformation rule for turning a working-directory path into a directory name used under `~/.claude/projects/`. It exists as **two separate implementations**: an exported `encodeCwd(dir)` in `lib/lsl/adapters/claude-jsonl-tree.mjs` (the child of parent component ClaudeJsonlTreeAdapter), and a private, non-exported `encodeCwd(cwd)` in `lib/lsl/token/stop-adapter-registry.mjs`, used only inside `locateMainSessionJsonl(span)`. Both apply the core rule `.replace(/[/._]/g, '-')`, but the adapter's version additionally strips trailing slashes first (`.replace(/\/+$/, '')`) — a real divergence despite a comment in the registry copy claiming the two are "kept character-for-character identical."

## Architecture and Design

The dominant pattern is **convention-by-duplication**: identical logic reimplemented in two modules, synchronized only by a human-maintained comment cross-reference rather than a shared import, generated constant, or test. This is compounded by a **lossy encode/decode pair** — `encodeCwd` maps three distinct characters (`/`, `.`, `_`) onto one (`-`), making the adapter's inverse function `decodeEncodedCwd(encoded)` structurally incapable of round-tripping arbitrary paths, even though `projectFromClaudeSubagentPath()` (part of sibling SubagentPathParser) gets away with it because typical project names survive the lossy step.

The two copies serve **structurally different pipelines**: the adapter's public `encodeCwd()` supports forward discovery (cwd → directory name to search), while the registry's private copy is embedded in `locateMainSessionJsonl`, which resolves `span?.<COMPANY_NAME_REDACTED>?.cwd || process.cwd()` — deliberately preferring the sandboxed agent's cwd to avoid a documented "~530× claude undercount" bug caused by using the stop-process's own cwd. This locator also layers a **best-effort/fail-open** pattern on top: a 5-minute `GRACE_MS` mtime window with most-recent-wins tiebreak, and any `fs.readdirSync` failure is swallowed, returning `''` per the module's D-08 guarantee — making an encoding error indistinguishable from "no matching session."

## Implementation Details

The adapter's `encodeCwd(dir)` carries an extensive JSDoc explaining a historical landmine: a missing underscore in the character class once broke every `~/Agentic/_work/` path, and the comment explicitly disclaims equivalence to pi's `encodePiSessionDir`. The registry's copy omits this rationale, instead pointing back at the adapter file. `decodeEncodedCwd` inverts naively (`.replace(/^-/, '/').replace(/-/g, '/')`), always reconstituting `-` as `/`, regardless of whether the original character was `/`, `.`, or `_`.

Validation is temporally decoupled from encoding: `PROJECT_NAME_ALLOW` (`/^[a-z0-9-]+$/i`), defined only in the adapter file, is checked solely inside `buildRow()`'s allowlist gate — long after `encodeCwd` has already produced a disk-search path. A directory name with disallowed characters can be encoded, searched via `walkSubAgentJsonl()`, matched against `SUBAGENT_PATH_RE` (owned by sibling SubagentPathParser), and only rejected once a decoded candidate fails the allowlist in `buildRow()` — an entire discovery-and-read cycle later than encode time.

## Integration Points

EncodeCwdConvention sits beneath its parent, ClaudeJsonlTreeAdapter, which drives `walkSubAgentJsonl()` and downstream extractors. It shares no code with sibling SubagentPathParser but is consumed by it indirectly: `projectFromClaudeSubagentPath()` depends on `decodeEncodedCwd`'s lossy behavior holding for typical inputs. It has no relationship with TranscriptTimestampReader-equivalent helpers (`readFirstMessageTimestamp`/`readFirstLine`), which operate on a separate ordering concern. Its second consumer, `stop-adapter-registry.mjs`, integrates the convention into a locator with its own independent bug history (the agentCwd-preference fix) — meaning the two `encodeCwd` copies belong to two separate regression-test surfaces despite sharing a rule.

## Usage Guidelines

Any change to the transformation rule (e.g., adding a character to the replaced set) must be manually propagated to both files — there is no structural safeguard, only comment discipline, and this has already failed once historically. Trailing-slash handling differs between copies, so callers must not assume interchangeability; only the adapter's version normalizes trailing slashes. Do not treat `decodeEncodedCwd` as a true inverse — it is safe only for extracting terminal path segments, not for reconstructing full original paths containing `.` or `_`. Validation via `PROJECT_NAME_ALLOW` should ideally happen at encode time rather than after disk traversal; until that changes, callers should be aware that malformed cwds fail silently and late. Finally, because `locateMainSessionJsonl` fails open (returns `''`), a drifted or incorrect `encodeCwd` output is silent and easily misdiagnosed as "no session found" rather than "encoding bug."


## Code Evidence

Key code artifacts grounding this entity's analysis:

- `encodeCwd()` is implemented twice with the same transformation rule but different signatures and different specificity of comment. In `lib/lsl/adapters/claude-jsonl-tree.mjs` it is `encodeCwd(dir)` — exported, with an extensive JSDoc block explaining the historical landmine where the missing underscore case broke every `~/Agentic/_work/` path (fixed 2026-09-17), and explicitly noting it is NOT the same convention as pi's `encodePiSessionDir`. In `lib/lsl/token/stop-adapter-registry.mjs` it is a private, non-exported `encodeCwd(cwd)` used only inside `locateMainSessionJsonl()`, whose comment states it is 'kept character-for-character identical' to the adapter's version and points back at that file for the rationale rather than restating it. Both apply `.replace(/[/._]/g, '-')`, but the adapter version additionally strips trailing slashes first (`.replace(/\/+$/, '')`) — a divergence the 'kept character-for-character identical' claim does not actually hold if a caller passes a directory with a trailing slash.
- The two copies are consumed in structurally different pipelines. `claude-jsonl-tree.mjs`'s `encodeCwd()` feeds forward-direction discovery: turning a known cwd into a directory name to search under `~/.claude/projects/`. `stop-adapter-registry.mjs`'s private copy is used inside `locateMainSessionJsonl(span)`, which resolves `span?.<COMPANY_NAME_REDACTED>?.cwd || process.cwd()` — explicitly preferring the sandboxed agent's cwd over the stop-process's own cwd, with a comment calling out a measured '~530× claude undercount' bug that resulted from using `process.cwd()` for a worktree/experiment-cell session. This makes the two `encodeCwd` copies part of two independent bug-fix histories (the underscore fix in one file, the trailing-slash + agentCwd fix in the other) that happen to share an encoding rule but not a shared regression-test surface.
- `claude-jsonl-tree.mjs`'s inverse function `decodeEncodedCwd(encoded)` (`.replace(/^-/, '/').replace(/-/g, '/')`) is lossy relative to `encodeCwd`'s forward direction: because `encodeCwd` maps three distinct source characters (`/`, `.`, `_`) onto one output character (`-`), `decodeEncodedCwd` cannot invert it faithfully — it always reconstitutes `-` as `/`, so a decoded path derived from an encoded cwd containing an original `.` or `_` will not round-trip to the original string. `projectFromClaudeSubagentPath()` relies on this decode only to extract the last path segment for a project name, which happens to survive the lossy step for typical project names, but the asymmetry means `encodeCwd`/`decodeEncodedCwd` is a one-way convention dressed as a pair.


## Hierarchy Context

### Parent
- [ClaudeJsonlTreeAdapter](./ClaudeJsonlTreeAdapter.md) -- [LLM] lib/lsl/adapters/claude-jsonl-tree.mjs implements the Claude sub-agent transcript discovery path via `walkSubAgentJsonl()`, which recursively visits `~/.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl` and filters every candidate through `SUBAGENT_PATH_RE` at the candidate stage rather than after conversion. The regex captures three groups — encoded-cwd, parent session UUID, and agent hex id — that are re-extracted downstream by three separate single-purpose functions (`projectFromClaudeSubagentPath`, `parentSessionFromClaudeSubagentPath`, `agentIdFromClaudeSubagentPath`) instead of being threaded through as a parsed object, so every caller that needs row metadata re-runs the same regex against the same path.

### Siblings
- [SubagentPathParser](./SubagentPathParser.md) -- [LLM+CGR] The component named 'SubagentPathParser' maps directly onto the path-parsing surface of lib/lsl/adapters/claude-jsonl-tree.mjs: the module-level `SUBAGENT_PATH_RE` regex (matching `.../.claude/projects/<encoded-cwd>/<parent-uuid>/subagents/agent-<hex>.jsonl`) plus the three extractor functions `projectFromClaudeSubagentPath()`, `parentSessionFromClaudeSubagentPath()`, and `agentIdFromClaudeSubagentPath()` that each independently re-run `transcriptPath.match(SUBAGENT_PATH_RE)` against the same string. This confirms the parent observation's critique: three call sites duplicate one regex match instead of parsing once into a shared object. `subHashFromAgentId()` extends the chain by deriving a 7-char `sub_hash` from whatever `agentIdFromClaudeSubagentPath()` returns, so a change to the capture-group layout in `SUBAGENT_PATH_RE` has to be manually reconciled across four functions rather than one parse boundary.
- [TranscriptTimestampReader](./TranscriptTimestampReader.md) -- [LLM] No file or function named 'TranscriptTimestampReader' appears anywhere in the supplied code. The closest thematic matches are `readFirstMessageTimestamp()` and the internal `readFirstLine()` helper in lib/lsl/adapters/claude-jsonl-tree.mjs, which read a single timestamp field from the first JSONL line of a Claude sub-agent transcript for use in `computeSubIndexes()` ordering. These are narrowly scoped, module-private helpers embedded in a larger adapter file, not a standalone reader component with the requested name.


---

*Generated from 9 observations*
