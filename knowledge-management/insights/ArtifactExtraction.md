# ArtifactExtraction

**Type:** Detail

## What It Is

ArtifactExtraction is implemented as a trio of free functions in `scripts/enhanced-transcript-monitor.js` — `toolCallArgs()`, `bashWriteTargets()`, and `extractFileChanges()` — living alongside sibling functions (`generateLSLFilename`, `initialize`, `redact`) within the same file rather than a dedicated module. It sits under the parent `EnhancedTranscriptMonitor` class but is deliberately decoupled from any class instance: `extractFileChanges()` is documented in-code as "a FREE FUNCTION, not just a method," so that offline backfill tools can re-derive artifacts using exactly the rules the live monitoring tap uses. The class's `_extractFileChanges` method exists only as a thin delegator to this free function, ensuring a single source of truth for artifact derivation between live capture and repair/backfill paths.

## Architecture and Design

The core architectural pattern is strategy-by-tool-type branching: shell-based tools are resolved via command-string parsing (`bashWriteTargets()`), while structured tools are resolved via key-based argument lookup (`PATH_ARG_KEYS` against `MODIFY_TOOL_NAMES`/`READ_TOOL_NAMES`). `extractFileChanges()` implements this as a two-tier dispatch: `SHELL_TOOL_NAMES` (bash/shell/run_command/etc.) route straight into `bashWriteTargets()` and `continue`, skipping the generic path-argument lookup entirely, while everything else falls into `PATH_ARG_KEYS.map(...).find(Boolean)`. Both paths merge into shared `modifiedFiles`/`readFiles` output arrays, deduplicated with `.includes()` rather than a `Set` — an accepted O(n²) trade-off given typical per-turn tool-call volumes.

A second pattern is defensive multi-shape argument normalization, embodied in `toolCallArgs()`, which unifies divergent per-agent tool-call payload shapes (Claude/opencode's `input` object vs. PiSessionReader's `content` JSON-string blob) into one usable structure before extraction proceeds. This reflects a broader design philosophy documented directly in code and confirmed by the corpus data referenced in the observations: artifact extraction is agent-agnostic in intent but implemented as a series of per-agent compatibility patches (input/content shape, notebook_path key, name casing) layered onto one common code path, rather than per-agent extractor classes. This is an iteratively hardened surface, not a stable design finalized up front — three distinct agent-heterogeneity bugs (pi's missing `input`, `notebookedit`'s `notebook_path`, opencode's lowercase tool names) were each fixed in place within the same functions.

## Implementation Details

`toolCallArgs()` tries `tc.input` first, then falls back to `tc.arguments` or `tc.content`, JSON-parsing string payloads defensively. This directly resolves a measured production bug: a code comment states "0 of 21 pi observations since 2026-09-01" carried an `input` key, confirming the parent's data-loss finding numerically.

`bashWriteTargets()` implements a narrow shell-redirection heuristic (`>`, `>>`, `tee`, `sed -i`) tuned against corpus measurements documented in the code: of 1667 sampled bash calls, only 136 carried any write signal, with most naive matches being heredoc bodies, scratchpad/tmp throwaways, or misparsed shell keywords. To avoid these false positives, it performs multi-pass sanitization — stripping heredoc bodies via regex, blanking quoted spans and command substitutions (to dodge collisions like `awk 'length>80'`) — before regex-matching targets, and excludes system directories, `.git` internals, `.log` outputs, and paths matching `SCRATCH_PATH_RE` (`/tmp`, `/private/var/folders`, `scratchpad/`). This embodies an explicit "missed artifact is preferable to an invented one" philosophy, favoring false-negative safety over recall.

`extractFileChanges()` orchestrates both paths, and `PATH_ARG_KEYS` — which includes `notebook_path`/`notebookPath` alongside `file_path`/`filePath`/`path` — exists specifically because `notebookedit` is a recognized mutation tool whose path lives under a different key; without it, notebook edits would be silently dropped despite correct tool-name recognition. All name matching is case-insensitive (`String(tc.name || '').toLowerCase()`), compensating for Claude's capitalized names (Edit/Write/Read/MultiEdit) versus opencode's verbatim-lowercase `part.tool`, a mismatch previously responsible for opencode sessions reporting "Artifacts: none."

## Integration Points

ArtifactExtraction's only structural integration point noted is with its parent, `EnhancedTranscriptMonitor`, whose `_extractFileChanges` method delegates entirely into the free function. Its free-function design also anticipates a consumer outside the class hierarchy: external backfill scripts, which need identical extraction semantics without instantiating the monitor. Within the same file, sibling logic like ProgressFireLogic (imported from `../lib/live-logging/progress-fire.mjs`) governs when progress observations fire during long turns, but ArtifactExtraction has no direct dependency on it — they are parallel concerns within `EnhancedTranscriptMonitor`, one governing observation cadence and the other governing what artifacts each observation records. Upstream, ArtifactExtraction depends implicitly on the shape of tool-call data produced by StreamingTranscriptReader, AdaptiveExchangeExtractor, and PiSessionReader, since `toolCallArgs()` exists purely to reconcile their differing payload conventions.

## Usage Guidelines

Any change to argument-shape handling should go through `toolCallArgs()`, not be duplicated inline elsewhere — the explicit rationale for its free-function status is preventing exactly that kind of drift between live and backfill logic. When adding support for a new tool that mutates files, both `MODIFY_TOOL_NAMES` and `PATH_ARG_KEYS` need review together: a tool can be correctly classified as a mutator yet still fail to yield an artifact if its path argument uses an uncovered key, as happened with `notebookedit`. New agent integrations should be checked against the casing and payload-shape assumptions baked into `toolCallArgs()` and the lowercase comparisons in `extractFileChanges()`, since agent heterogeneity has been the dominant source of extraction bugs to date. For shell-command heuristics, any adjustment to `bashWriteTargets()` should preserve its bias toward false negatives over false positives, and should be validated against real corpus samples rather than first-principles parsing, consistent with how its existing thresholds were derived.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- toolCallArgs() resolves the documented cross-agent data-loss bug from the parent context directly: StreamingTranscriptReader/AdaptiveExchangeExtractor (claude, opencode) produce tool calls with an object-typed `input` key, while PiSessionReader produces `{ name, type, content }` where `content` is a JSON-stringified arguments blob with no `input` key at all. The function tries `tc.input` first, then falls back to `tc.arguments` or `tc.content`, JSON-parsing string payloads defensively. The code comment states this was measured — '0 of 21 pi observations since 2026-09-01 carry one' — confirming the parent's [LLM+CGR] observation numerically and grounding the fix's necessity in production telemetry rather than speculation.
- bashWriteTargets() implements the narrow shell-redirection heuristic described in the parent record, and the code itself documents the corpus measurement behind it: bash calls dominate the tool mix (1667 sampled), yet only 136 carried any write signal, with the bulk of naive matches being heredoc bodies, scratchpad/tmp throwaways, and shell keywords misparsed as filenames. The implementation embodies a 'missed artifact is preferable to an invented one' philosophy operationally — it strips heredoc bodies via regex before scanning, blanks quoted spans and command substitutions to avoid false positives from `awk 'length>80'`-style operator collisions, and explicitly excludes system directories, .git internals, .log outputs, and SCRATCH_PATH_RE matches (/tmp, /private/var/folders, scratchpad/).

**Other:**
- The component's implementation lives in scripts/enhanced-transcript-monitor.js as a trio of free functions — toolCallArgs(), bashWriteTargets(), and extractFileChanges() — matching the parent's [Calls] edge list (generateLSLFilename, initialize, redact) as siblings within the same file rather than a separate module. extractFileChanges() is explicitly documented as 'a FREE FUNCTION, not just a method' so that backfill tools can re-derive artifacts with exactly the rules the live tap uses, since prior inline copies (Edit/Write only, file_path/filePath only) could disagree with the daemon that originally wrote a row. This is a deliberate single-source-of-truth pattern: `_extractFileChanges` delegates to the free function and stays the monitor's entry point, avoiding logic drift between live capture and offline repair.


## Hierarchy Context

### Parent
- [EnhancedTranscriptMonitor](./EnhancedTranscriptMonitor.md) -- [CGR] EnhancedTranscriptMonitor (class) in enhanced-transcript-monitor.js

### Siblings
- [ProgressFireLogic](./ProgressFireLogic.md) -- [LLM+CGR] scripts/enhanced-transcript-monitor.js imports `DEFAULT_PROGRESS_TOKEN_DELTA, sumOutputTokens, progressFireDecision` from `../lib/live-logging/progress-fire.mjs`, with an inline comment describing the purpose as firing 'an extra observation each time a turn accumulates another token-delta of model output, so a 40-min turn isn't collapsed into a single prompt-time row.' This is the only trace of ProgressFireLogic in the supplied files — the import site, not the implementation.


---

*Generated from 9 observations*
