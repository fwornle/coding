# RedactionEngine

**Type:** SubComponent

The RedactionEngine reads category-based pattern rules from `.specstory/config/redaction-config.yaml`, allowing secrets and PII patterns to be organized by category (e.g., API keys, email addresses) without modifying application code.

# RedactionEngine — Technical Insight Document

## What It Is

RedactionEngine is a sub-component of LiveLoggingSystem responsible for stripping secrets and PII from log output before persistence. It is configured via `.specstory/config/redaction-config.yaml`, which defines category-based pattern rules (e.g., API keys, email addresses). This externalized configuration means redaction behavior can be modified without code changes.

## Architecture and Design

RedactionEngine follows a **configuration-driven transformation** pattern. Rather than embedding redaction logic directly into format conversion, it exists as a separable, configurable step that LSLConverter references during log processing. LSLConfigValidator validates the redaction options, ensuring correctness before runtime.

![RedactionEngine — Architecture](images/redaction-engine-architecture.png)

This separation from LSLConverter is a key design decision: redaction is a cross-cutting concern applied as a pipeline stage, not a hardcoded behavior. This allows the same converter logic to operate with or without redaction, or with different redaction profiles.

## Implementation Details

The redaction configuration in `redaction-config.yaml` organizes patterns by category. Each category groups related sensitive data patterns (API keys, emails, etc.), enabling selective enable/disable of entire categories. LSLConverter consumes these as options during its format translation process (`lib/agent-api/transcripts/lsl-converter.js`), applying pattern matching and replacement as a transformation step.

No code symbols were provided, so internal implementation details beyond this architectural relationship cannot be further specified.

## Integration Points

RedactionEngine integrates with two sibling-level concerns within LiveLoggingSystem:

- **LSLConverter** references RedactionEngine options during conversion, making redaction an optional transformation layer in the logging pipeline.
- **LSLConfigValidator** validates redaction configuration, ensuring pattern rules are well-formed before they reach the converter.

![RedactionEngine — Relationship](images/redaction-engine-relationship.png)

It operates alongside SessionWindowingManager as a peer sub-component of LiveLoggingSystem, though the two appear to address orthogonal concerns (time-based session segmentation vs. content sanitization).

## Usage Guidelines

Edit `.specstory/config/redaction-config.yaml` to add or modify redaction patterns by category. No application code changes are needed. Ensure configurations pass LSLConfigValidator before deployment. When adding new sensitive data categories, group patterns logically to allow category-level toggling.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem is the infrastructure responsible for capturing, converting, and routing Claude Code (and other agent) conversation sessions into a unified LSL (Live Session Logging) format. It handles session windowing with time-based identifiers (e.g., '0800-0900'), multi-user support via SHA-256 user hashing, file routing with size/rotation thresholds, and transcript format conversion between agent-native formats (JSONL conversation files) and LSL markdown or JSON-Lines output. The system is configured primarily through `.specstory/config/lsl-config.json` and a companion `redaction-config.yaml`, with validation tooling in `scripts/validate-lsl-config.js`.

The architecture follows an adapter pattern: `TranscriptAdapter` (lib/agent-api/transcript-api.js) is an abstract base class that agent-specific implementations must extend, requiring `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`. The `LSLConverter` class (lib/agent-api/transcripts/lsl-converter.js) handles the actual format translation — converting sessions to markdown, JSONL, or parsing JSONL back — with configurable content truncation, secret redaction, and tool result inclusion. The system also integrates a 5-layer ontology classification pipeline (referenced in `lsl-5-layer-classification.puml`) for categorizing captured log entries.

Key operational concerns include async buffered file I/O (100ms flush interval, 50-entry max buffer in `integrations/mcp-server-semantic-analysis/src/logging.ts`), schema-constrained configuration validation (file size bounds of 1MB–100MB, rotation thresholds, batch sizes), and a watch/poll mechanism in `TranscriptAdapter.watchTranscripts()` that polls `getCurrentSession()` on a configurable interval to emit new entries to registered callbacks.

### Siblings
- [SessionWindowingManager](./SessionWindowingManager.md) -- SessionWindowingManager is a sub-component of LiveLoggingSystem


---

*Generated from 3 observations*
