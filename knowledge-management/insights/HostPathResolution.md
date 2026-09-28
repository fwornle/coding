# HostPathResolution

**Type:** Detail

## What It Is

HostPathResolution is implemented as a single guard function, `resolveHostCodingPath()`, defined at the top of `scripts/enhanced-transcript-monitor.js`, immediately after dotenv setup and before any other import or initialization. It is not a separate file, class, or module — it is a self-contained resolution routine whose sole output is the module-level constant `HOST_CODING_PATH`, computed once via `const HOST_CODING_PATH = resolveHostCodingPath();`. As a child concept of the parent component `TranscriptMonitor` (the `EnhancedTranscriptMonitor` class), it exists to solve one narrow but critical problem: ensuring the monitor, which runs on the host, does not accidentally inherit a container-oriented filesystem path.

## Architecture and Design

The core architectural pattern is environment-variable trust boundary enforcement via shape validation rather than blind inheritance. Instead of trusting `process.env.CODING_REPO || process.env.CODING_TOOLS_PATH` outright, the function only accepts these values when they look like genuine host paths — prefixed with `/Users/` or `/home/`. Anything else (notably the container path `/coding` exported by the `claude-mcp` launcher for Dockerized tools) falls through to a computed default: `codingRoot`, derived from `dirname(fileURLToPath(import.<COMPANY_NAME_REDACTED>.url))` walked up one level.

This reflects a fail-safe-default-with-escape-hatch design: the safe fallback is always available, but developers running against a non-default repo checkout can still override it via `CODING_REPO`, provided the override plausibly denotes a host location. The validation is intentionally shape-based rather than a hardcoded denylist of `/coding`, making it robust to any container-path convention, not just the one currently in use.

The second architectural decision is single computation at module load — constant hoisting rather than repeated per-call resolution. This guarantees resolution happens exactly once per process lifetime, ordered strictly before `EnhancedTranscriptMonitor`'s class body or methods execute, reinforcing an initialization philosophy of "resolve environment ambiguity first."

## Implementation Details

Mechanically, `resolveHostCodingPath()` performs a two-step check: first it evaluates the `CODING_REPO`/`CODING_TOOLS_PATH` environment variables, testing their string prefix against `/Users/` or `/home/`. If neither is set or neither passes the shape test, it falls back to `codingRoot`, itself computed from the running script's own file URL location, giving a host-relative, self-referential default that requires no external configuration or IPC handshake.

The comment embedded alongside this function documents the concrete failure mode it prevents: the `claude-mcp` launcher exports `CODING_TOOLS_PATH=/coding` for its Dockerized tools, but ETM runs directly on the host. Without the guard, ETM would attempt operations like `mkdir('/coding/.health')` or reading `/coding/.specstory/config/redaction-patterns.json` against paths that simply don't exist on the host filesystem — failing silently, with no thrown exception and no log line, on every polling cycle.

Because `HOST_CODING_PATH` is a top-level constant, its value is frozen for the lifetime of the process; a mid-process environment change (e.g., in a long-running daemon) would not be picked up without a restart. This is a deliberate simplicity trade-off — favoring predictability and single-evaluation cost over dynamic reconfigurability.

## Integration Points

HostPathResolution sits upstream of nearly all filesystem-dependent behavior in `enhanced-transcript-monitor.js`. LSL path resolution (`lslWritePath`, `resolveLslPath` from `./lsl-paths.js`), the `ProcessStateManager` singleton-lock machinery, and the health/heartbeat writes that the STALL-DETECT logic depends on all implicitly rely on `HOST_CODING_PATH` being correct. If resolution fails silently, the downstream singleton-reclaim logic (`evaluateHolderLiveness`/`decideReclaim` in `lib/live-logging/singleton-reclaim.mjs`) may eventually detect anomalies, but only after significant silent data loss has already occurred — the process appears healthy while writing/reading against nonexistent paths.

Within the same file, HostPathResolution is a sibling concern to ToolCallArtifactExtraction (`toolCallArgs()`) and RawFallbackReceipt (`raw-fallback.js`, `ObservationWriter`, `ObservationExporter`). All three share a common architectural motif: guarding against silent, undetected data loss caused by shape mismatches — whether in environment variables, tool-call argument formats across agent readers, or fallback summary flagging during LLM proxy outages.

## Usage Guidelines

Developers should never assume `CODING_TOOLS_PATH` is safe to use directly within host-side processes like ETM — it is designed for container consumers, and its presence alone is not sufficient evidence of correctness. When intentionally overriding the coding root (e.g., testing against an alternate checkout), use `CODING_REPO` with a genuine absolute host path beginning `/Users/` or `/home/`; anything else will be silently ignored in favor of the computed default. Because resolution occurs once at module load, any environment variable change requires a process restart to take effect. Finally, given that failures here are silent by design (no exceptions, no logs), maintainers extending this file should treat `HOST_CODING_PATH` correctness as a precondition to verify early — for instance by asserting the resolved path exists — rather than relying on downstream stall-detection to eventually surface the problem.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Relationships:**
- The `resolveHostCodingPath()` function in `scripts/enhanced-transcript-monitor.js` is the concrete implementation of the HostPathResolution component. The code graph's parent context establishes that `EnhancedTranscriptMonitor` lives in this file and imports `process-state-manager.js`, and the supplied source confirms `resolveHostCodingPath()` is defined at the top of that same file, immediately after dotenv setup and before any other import or initialization — placing host/container path confusion as the very first failure mode the module guards against.


## Hierarchy Context

### Parent
- [TranscriptMonitor](./TranscriptMonitor.md) -- [CGR] EnhancedTranscriptMonitor (class) in enhanced-transcript-monitor.js

### Siblings
- [ToolCallArtifactExtraction](./ToolCallArtifactExtraction.md) -- [LLM] `toolCallArgs()` in `scripts/enhanced-transcript-monitor.js` is the component's core normalization function: it checks `tc.input` first (the shape `StreamingTranscriptReader` and `AdaptiveExchangeExtractor` produce for Claude and opencode), then falls back to parsing `tc.arguments` or `tc.content` as a JSON string (the shape `PiSessionReader` produces: `{name, type, content}` with content pre-serialized). The docstring states this was reactive to a measured defect — 0 of 21 pi observations since 2026-09-01 carried any artifact — meaning the original code silently dropped an entire agent's tool-call arguments rather than erroring, and the fix generalizes to three input shapes precisely so no agent-specific reader can structurally starve the extractor again.
- [RawFallbackReceipt](./RawFallbackReceipt.md) -- [LLM] The 'RawFallbackReceipt' concept is concretely implemented across raw-fallback.js, ObservationWriter.js, and ObservationExporter.js: raw-fallback.js defines RAW_FALLBACK_PREFIX ('[Raw]') and isRawFallbackSummary() as the single shared contract, ObservationWriter._fallbackSummary() (referenced in comments, not shown in the truncated excerpt) presumably stamps this prefix when the LLM proxy is unreachable, and ObservationExporter.keepInExport() consumes isRawFallbackSummary() to prevent these receipt rows from being silently dropped from the JSON export despite carrying quality:'low'.


---

*Generated from 9 observations*
