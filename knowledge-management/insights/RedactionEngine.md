# RedactionEngine

**Type:** SubComponent

The YAML-driven configuration implies pattern-matching rules (likely regex or keyword lists) for common secret shapes such as API keys, tokens, and email addresses referenced in project env vars like `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`

# RedactionEngine — Technical Insight Document

## What It Is

RedactionEngine is a SubComponent of LiveLoggingSystem responsible for sanitizing transcript data before it reaches persistent storage. Its rule set is externalized in `.specstory/config/redaction-config.yaml`, making it the authoritative privacy enforcement boundary within the LSL pipeline. The engine sits between the in-memory transcript data produced by `readTranscripts()` and the final write to LSL output files, ensuring secrets never touch disk.

![RedactionEngine — Relationship](images/redaction-engine-relationship.png)

RedactionEngine contains one child component, PatternSanitizer, which is the runtime enforcement mechanism that iterates over materialized rule objects and applies each pattern against log entry fields.

## Architecture and Design

The central design decision is **pre-persistence redaction**: raw in-memory transcript entries are sanitized after `readTranscripts()` but before LSL output is written. This placement means no secret can reach storage regardless of which agent produced the transcript. The alternative—per-adapter redaction inside each `TranscriptAdapter`—would scatter privacy logic across every agent integration and risk inconsistent guarantees as new adapters are added. By centralizing in RedactionEngine, all agent types including `claude-code` and any future adapters registered through TranscriptAdapterRegistry receive identical treatment.

![RedactionEngine — Architecture](images/redaction-engine-architecture.png)

The YAML-driven rule configuration is a deliberate extensibility choice. New secret shapes (API keys, tokens, email addresses, patterns matching env vars like `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`) can be added to `.specstory/config/redaction-config.yaml` without touching application code. This separates the *policy* of what counts as sensitive from the *mechanism* that enforces it—a clean separation of concerns that keeps PatternSanitizer stable while the rule set evolves freely.

## Implementation Details

RedactionEngine operates on the unified LSL typed format produced by `convertToLSL()` in `lib/agent-api/transcript-api.js`, not on raw agent-specific transcript bytes. This is a meaningful design constraint: redaction logic only needs to understand the LSL schema, not the idiosyncratic formats of individual agents. The format-aware approach means PatternSanitizer can make reliable assumptions about field names and data types when iterating over log entries.

The pipeline flows as follows: LiveLoggingSystem's polling loop (via `watchTranscripts()` and `setInterval`) detects new entries, `readTranscripts()` loads raw agent data, `convertToLSL()` normalizes it into LSL typed entries, RedactionEngine receives those entries and passes them through PatternSanitizer, and only the sanitized output proceeds to file writes. PatternSanitizer, as the consumer of rules loaded from the YAML configuration, applies each pattern rule against the relevant LSL entry fields, acting as the final enforcement boundary before persistence.

The rule configuration in `.specstory/config/redaction-config.yaml` likely encodes regex or keyword-list patterns given the reference to "common secret shapes." The YAML format implies structured rule objects with at minimum a pattern field and likely a replacement or masking directive, which PatternSanitizer materializes at runtime.

## Integration Points

RedactionEngine's primary upstream dependency is the LSL typed format from `convertToLSL()` in `lib/agent-api/transcript-api.js`. Any change to the LSL schema affects what fields PatternSanitizer must cover. Its sibling SessionWindowManager operates independently on routing metadata (hourly window labels in `LSLMetadata`) and does not interact with redaction directly, though both contribute to the same final LSL output structure.

The engine's configuration dependency on `.specstory/config/redaction-config.yaml` is an external integration point: deployment environments must provide this file with rules appropriate to the secrets in use. The explicit mention of `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` in the project environment suggests these are among the patterns explicitly enumerated in the config.

## Usage Guidelines

**Rule maintenance is the primary operational concern.** When new secret types are introduced to the project (new API keys, tokens, or PII fields), the corresponding patterns must be added to `.specstory/config/redaction-config.yaml` before those secrets appear in agent transcripts. Because redaction is pre-persistence, any secret that reaches a transcript file was either not matched by an existing rule or was introduced before the rule was added—there is no retroactive redaction pass described in the observations.

**New TranscriptAdapter implementations require no redaction code.** The centralized design guarantees that any adapter fulfilling the `TranscriptAdapter` contract (implementing `getAgentType()`, `readTranscripts()`, `convertToLSL()`, etc.) automatically benefits from RedactionEngine's sanitization without adapter-level changes. Developers adding new agent integrations via TranscriptAdapterRegistry should not implement redaction inside the adapter.

**Format compliance is a prerequisite.** RedactionEngine operates on LSL typed entries, so adapters must produce well-formed output from `convertToLSL()` for pattern matching to work reliably. Entries that deviate from the LSL schema may have fields that PatternSanitizer does not cover, creating potential gaps in redaction coverage.

---

**Architectural Patterns:** Configuration-externalized policy (YAML rule set), pipeline stage with single responsibility (pre-persistence sanitization), centralized cross-cutting concern replacing duplicated per-component logic.

**Key Trade-off:** Centralizing redaction after `convertToLSL()` means the LSL format is the redaction surface—simpler and more consistent than per-adapter redaction, but requires that `convertToLSL()` faithfully preserves all sensitive fields from the raw transcript rather than discarding them silently before RedactionEngine can act.

**Maintainability:** High, due to the YAML externalization of rules and the single enforcement point in PatternSanitizer. Adding coverage for new secret types requires no code changes, only config updates.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem is built around a strict abstract interface defined by the `TranscriptAdapter` class in `lib/agent-api/transcript-api.js`. Every agent-specific adapter must implement five methods: `getAgentType()` (returns a string identifier like `'claude-code'`), `getTranscriptDirectory()` (returns the filesystem path where raw agent transcripts reside), `readTranscripts()` (reads and parses raw transcript files), `convertToLSL()` (transforms raw entries into the unified LSL typed format), and `getCurrentSession()` (returns metadata for the active session). Live capture is achieved not through filesystem watchers (like `fs.watch`) but through a polling loop: `watchTranscripts()` uses `setInterval` to periodically invoke `readTranscripts()` and diff against previously seen entries. This design trades immediacy for portability—`fs.watch` has known cross-platform inconsistencies, especially in Docker containers and network-mounted filesystems, so polling avoids those failure modes at the cost of introducing a configurable latency between an agent writing a transcript entry and the LSL system capturing it.

### Children
- [PatternSanitizer](./PatternSanitizer.md) -- As the runtime consumer of RedactionRuleLoader output, PatternSanitizer iterates over materialized rule objects and applies each pattern against log entry fields, making it the enforcement boundary within the RedactionEngine pipeline.

### Siblings
- [SessionWindowManager](./SessionWindowManager.md) -- SessionWindowManager produces hourly window labels (e.g., '0800-0900') used as routing keys in LSLMetadata, enabling time-based file retrieval without scanning entire transcript directories
- [TranscriptAdapterRegistry](./TranscriptAdapterRegistry.md) -- The `TranscriptAdapter` base class in `lib/agent-api/transcript-api.js` defines the five mandatory methods: `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`, making it the single contract point for all agent integrations


---

*Generated from 5 observations*
