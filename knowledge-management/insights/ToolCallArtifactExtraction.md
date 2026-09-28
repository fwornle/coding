# ToolCallArtifactExtraction

**Type:** Detail

## What It Is

ToolCallArtifactExtraction is implemented entirely within `scripts/enhanced-transcript-monitor.js`, as a cluster of functions — `toolCallArgs()`, `PATH_ARG_KEYS`, `bashWriteTargets()`, `extractFileChanges()`, and the classification constants `MODIFY_TOOL_NAMES` / `READ_TOOL_NAMES` / `SHELL_TOOL_NAMES` — that together turn raw, agent-specific tool-call payloads into a normalized list of modified/read file artifacts. It is a child capability of the `TranscriptMonitor` component (concretely `EnhancedTranscriptMonitor`), sitting alongside siblings `HostPathResolution` and `RawFallbackReceipt` within the same file. Where `HostPathResolution`'s `resolveHostCodingPath()` guards against host/container path confusion at the top of the file, ToolCallArtifactExtraction guards against a different class of failure: silently losing or misattributing tool-call arguments across heterogeneous agent transcript formats.

## Architecture and Design

The design is a layered normalization pipeline rather than one monolithic parser. `toolCallArgs()` first resolves *shape* — Claude/opencode's `tc.input`, versus `PiSessionReader`'s serialized `{name, type, content}` — before any path extraction happens. `PATH_ARG_KEYS` then resolves *key naming* independently, mapping whatever normalized object comes back against a list of known path-bearing keys (`file_path`, `filePath`, `path`, `notebook_path`, `notebookPath`). This stacked-layer approach (Architecture Notes #8) means new agents can be onboarded by extending one layer without touching the other.

A second architectural strand is calibration-driven filtering, exemplified by `bashWriteTargets()`. Rather than a generic sanitizer, it implements a progressive text-sanitization pipeline — heredoc-body stripping, iterative `$(...)` blanking up to four levels deep, then quoted-span blanking — each stage justified by specific false-positive patterns measured against a 1667-call bash corpus. The overarching philosophy, stated verbatim in code comments ("a missed artifact is a gap, an invented one is a lie"), is precision over recall: every exclusion (system dirs, `.log` files, `.git/` internals, directories, bare words) is tied to an observed false positive rather than applied as blanket sanitization.

Structurally, this component is upstream of and decoupled from the write/consolidate/export pipeline (`ObservationWriter.js`, `ObservationConsolidator.js`, `ObservationExporter.js`). None of those modules reference `toolCallArgs`, `bashWriteTargets`, or `extractFileChanges`; they consume already-summarized rows via km-core's `GraphKMStore`. ToolCallArtifactExtraction is a pure, synchronous, in-memory transform with no dependency on km-core, Redis, or the `_observationEmitter` event bus that `ObservationWriter.js` uses.

## Implementation Details

`toolCallArgs()` is the entry normalization function: it checks `tc.input` first, then falls back to parsing `tc.arguments` or `tc.content` as JSON. Its existence is directly reactive to a measured defect — 0 of 21 pi observations since 2026-09-01 carried any artifact, because the original code only handled the Claude/opencode shape and silently dropped pi's serialized-content shape.

`extractFileChanges()` consumes `toolCallArgs()`'s output and applies `PATH_ARG_KEYS` to locate the actual path field, regardless of which key name an agent used. The comment on this constant documents a concrete historical gap: `notebookedit` (in `MODIFY_TOOL_NAMES`) carries its path under `notebook_path`, so before that key was added, every notebook edit matched the tool-name check but failed path lookup, silently producing zero artifacts.

`bashWriteTargets()` handles the shell-command case separately, since write intent there is expressed via redirects (`>`, `>>`), `tee`, and `sed -i` rather than structured arguments. Its pipeline reduced 175 naive regex candidates down to 15 confirmed targets on the calibration corpus with no measured true-positive loss, by blanking quoted spans (avoiding false matches inside `awk 'length>80'` or inline scripts) and pre-handling nested command substitutions like `"$(wc -l < "$F")"` that would otherwise desynchronize quote-pair matching.

The classification constants (`MODIFY_TOOL_NAMES`, `READ_TOOL_NAMES`, `SHELL_TOOL_NAMES`, `PATH_ARG_KEYS`) centralize agent/tool-name-to-behavior coupling at module scope rather than scattering conditionals throughout the logic, making the addition of new agents or tools a localized change.

## Integration Points

`extractFileChanges()` is deliberately exposed as a free function, not a class method, specifically so offline backfill tools can re-derive artifacts using identical rules to the live monitor tap. Prior to this, backfill tooling inlined a weaker duplicate (Edit/Write-only matching, `file_path`/`filePath`-only key lookup), causing recomputed artifacts to disagree with what the live daemon originally captured — this shared-parser pattern guarantees retroactive consistency between live capture and any later reprocessing pass.

Downstream, the write/consolidate/export pipeline (`ObservationWriter.js`, `ObservationConsolidator.js`, `ObservationExporter.js`) consumes already-summarized observation rows rather than calling into this extraction logic directly, confirming ToolCallArtifactExtraction's role as a pre-summarization transcript-parsing stage feeding the `EnhancedTranscriptMonitor` parent, not a participant in the km-core/Redis/event-bus machinery those sibling-adjacent modules use.

## Usage Guidelines

Developers extending agent support should add new tool-call shapes to `toolCallArgs()` and new path-key aliases to `PATH_ARG_KEYS` as independent, additive changes rather than conflating shape-detection with key-lookup logic. When adding new tool names to `MODIFY_TOOL_NAMES` or similar constants, verify the corresponding path key exists in `PATH_ARG_KEYS` — the `notebookedit`/`notebook_path` gap illustrates how a tool-name match without a matching path key silently produces zero artifacts. Any changes to `bashWriteTargets()`'s exclusion lists should be justified by observed corpus false positives, consistent with its established calibration-driven design, rather than added as speculative generic sanitization. Finally, always call `extractFileChanges()` (not a reimplementation) from any new backfill or reprocessing tool to preserve consistency with the live monitor's output.


## Hierarchy Context

### Parent
- [TranscriptMonitor](./TranscriptMonitor.md) -- [CGR] EnhancedTranscriptMonitor (class) in enhanced-transcript-monitor.js

### Siblings
- [HostPathResolution](./HostPathResolution.md) -- [LLM+CGR] The `resolveHostCodingPath()` function in `scripts/enhanced-transcript-monitor.js` is the concrete implementation of the HostPathResolution component. The code graph's parent context establishes that `EnhancedTranscriptMonitor` lives in this file and imports `process-state-manager.js`, and the supplied source confirms `resolveHostCodingPath()` is defined at the top of that same file, immediately after dotenv setup and before any other import or initialization — placing host/container path confusion as the very first failure mode the module guards against.
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] The 'RawFallbackReceipt' concept is concretely implemented across raw-fallback.js, ObservationWriter.js, and ObservationExporter.js: raw-fallback.js defines RAW_FALLBACK_PREFIX ('[Raw]') and isRawFallbackSummary() as the single shared contract, ObservationWriter._fallbackSummary() (referenced in comments, not shown in the truncated excerpt) presumably stamps this prefix when the LLM proxy is unreachable, and ObservationExporter.keepInExport() consumes isRawFallbackSummary() to prevent these receipt rows from being silently dropped from the JSON export despite carrying quality:'low'.


---

*Generated from 9 observations*
