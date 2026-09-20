# ConfigurableRedactorIntegration

**Type:** Detail

# ConfigurableRedactorIntegration — Technical Insight Document

## What It Is

ConfigurableRedactorIntegration describes how `src/live-logging/ObservationWriter.js` incorporates `ConfigurableRedactor` — a PII/secret redaction component — into the observation write pipeline. The concrete evidence is thin but specific: a single import at ObservationWriter.js:19 (`import ConfigurableRedactor from './ConfigurableRedactor.js';`) and a class-level `init()` docstring claiming that initialization "opens the km-core GraphKMStore ... and the PII/secret redactor." No call site in the reviewed excerpt (e.g., `this.redactor = new ConfigurableRedactor(...)` or an explicit `redact(...)` invocation) confirms how or when redaction actually executes. As the parent entity RedactionEngine's own notes state, ConfigurableRedactor's internals — rule sets, regex patterns, PII categories — are not defined anywhere in the reviewed files; it is consumed, not implemented, here.

## Architecture and Design

The dominant architectural signal is that `this.dbPath` (constructor, ObservationWriter.js ~line 200), originally a SQLite handle path, has been repurposed per the Phase 44 Plan 13 comment block as the input used to derive `projectRoot` for the redactor. This is a constructor/config-passthrough pattern: rather than changing the constructor signature or adding a new field, an existing field is overloaded to avoid a breaking change. The trade-off is a latent readability hazard — `dbPath` still reads as a database path even though it now doubles as redactor configuration input, making the write pipeline harder to trace for future maintainers.

The `init()` docstring implies redaction is wired at construction time rather than per-write, suggesting ConfigurableRedactor is stateful/pre-compiled once (e.g., regexes compiled at construction) and then invoked repeatedly during writes — a fail-loud-at-construction philosophy consistent with ObservationWriter's other guards (e.g., the retentionDays floor that throws for values below 1). This positions redaction as a gate that must succeed before writes proceed, though no fallback path is visible if construction fails.

A publish-subscribe pattern via the module-level `_observationEmitter` (with `setMaxListeners(32)`) decouples the write path from SSE consumers like `/api/coding/observations/stream`. Critically, the redaction guarantee is a property of the code path (`writeObservation`) calling `emit('written', row)`, not of the emitter itself — a structural distinction with direct security implications.

## Implementation Details

The exported test helper `_emitObservationWrittenForTests(row)` constructs and emits a `written` event directly, bypassing `writeObservation` entirely. This demonstrates concretely that `_observationEmitter.emit()` enforces nothing about redaction — any code that builds a `row` and calls `emit('written', row)` skips ConfigurableRedactor by construction, not by mistake. This is a legitimate test seam but also a documented risk vector if reused outside test harnesses.

Contrast this with two adjacent, redaction-free write surfaces: `opencode-token-rows.mjs`'s `summarizeParts()` (lines ~90-114) extracts `p.text`, `input.filePath`, `input.description`, `input.pattern`, `input.command`, and `input.url`, truncating via `snip(s, n)` (240/140/52-char caps) before writing to `prompt_preview` in `buildOpencodeTokenRows`. Truncation bounds length, not content sensitivity — credentials embedded in a shell command would persist verbatim up to the cap. Similarly, `copilot-events-tail.mjs`'s `buildStubObservation()` (lines ~192-210) embeds caller-supplied `agentDescription` (capped at 200 chars) verbatim into synthetic `summary` and `asstMsg.content`, with no content filter, because Copilot CLI only emits lifecycle events per the module's header comment.

## Integration Points

ConfigurableRedactorIntegration sits within RedactionEngine, its parent, but the parent's own analysis confirms no RedactionEngine implementation file appears in the reviewed set — the relationship is inferred purely from the ObservationWriter import and comment. Sibling concerns in the same codebase handle content sensitivity through entirely different, non-interchangeable mechanisms: `token-db.mjs`'s `insertTokenRow`/`baseValues`/`routingValues` use `text()`/`num()` coalescers and parameterized `?`-bound SQL (documented as V5/T-69-sql mitigation) — this guards against SQL injection and malformed types, not sensitive-content leakage. The `BYPASS_PROVIDERS` gating in `opencode-token-rows.mjs` and Copilot's degraded-parity stub construction both branch on which agent/provider produced data, indirectly affecting what content needs redaction, without ConfigurableRedactor being a shared dependency.

## Usage Guidelines

Developers extending ObservationWriter must treat `writeObservation` as the sole sanctioned entry point for redacted content reaching `_observationEmitter`; any new direct-emit path (mirroring `_emitObservationWrittenForTests`) silently bypasses PII/secret scrubbing. When modifying `dbPath`, remember its dual role as both a legacy path default (`.observations/observations.db`) and redactor `projectRoot` derivation input — renaming or restructuring it requires updating both consumers. Because redaction coverage is agent-path-dependent (Copilot's metadata-only stubs structurally can't leak transcript PII, while opencode/claude paths carry full content contingent on ConfigurableRedactor actually running), audits of PII exposure must be done per-producer, not assumed uniform. Finally, do not conflate `snip()` truncation or token-db.mjs's parameterized binding with redaction — these are orthogonal safety mechanisms addressing length and injection risk respectively, and neither substitutes for ConfigurableRedactor's PII/secret-specific scrubbing.


## Hierarchy Context

### Parent
- [RedactionEngine](./RedactionEngine.md) -- [LLM] None of the code excerpts supplied for this analysis (lib/lsl/live/copilot-events-tail.mjs, lib/lsl/token/opencode-token-rows.mjs, lib/lsl/token/token-db.mjs, src/live-logging/ObservationWriter.js, tests/agents/copilot-session-command.test.mjs) contain the RedactionEngine's own implementation — no class or module literally named RedactionEngine appears. The only concrete evidence of a redaction component is the import `import ConfigurableRedactor from './ConfigurableRedactor.js';` at src/live-logging/ObservationWriter.js:19 and the constructor comment noting `this.dbPath` is retained specifically 'as a path string used to derive `projectRoot` for the redactor' (ObservationWriter.js, Phase 44 Plan 13 comment block). This means the redaction subsystem is consumed, not defined, inside the files under review — any deeper architectural claim about RedactionEngine's internals (rule sets, regex patterns, PII categories) cannot be grounded in this evidence set and should be treated as external to what was reviewed.


---

*Generated from 10 observations*
