# SpecstoryAdapter

**Type:** SubComponent

[Architecture Notes] Abstract base class (TranscriptAdapter) enforces implementation of five abstract methods via runtime Error throws rather than compile-time interfaces, since the codebase is plain JS with JSDoc typing; Mandatory classification/redaction schema gate (per parent LiveLoggingSystem observations) implies all adapters, including SpecstoryAdapter, must route output through classification-validated paths rather than writing directly to session storage; Format heterogeneity (pi/.jsonl vs specstory/markdown) is handled downstream in the dashboard (lsl-sessions.mjs) via live in-memory conversion rather than upstream normalization at ingestion time, creating two places where format-specific logic must stay in sync; Fixed six-value LSLEntryType enum constrains all adapters to a lowest-common-denominator entry vocabulary, pushing format-specific richness into generic metadata/tool fields; Cursor/diffing for live-watch is entry-count-based rather than id- or timestamp-based, a fragility noted as a recurring dedup bug source elsewhere in the LSL subsystem

# SpecstoryAdapter — Technical Insight Document

## What It Is

SpecstoryAdapter is a class defined in `specstory-adapter.js`, functioning as the format-specific parser responsible for ingesting Specstory-style transcripts (markdown-based) into the Live Logging System (LSL). It is one of the concrete implementations of the abstract `TranscriptAdapter` base class declared in `lib/agent-api/transcript-api.js`, sitting alongside `ClaudeParser` (`lib/agent-api/transcripts/claude-parser.js`) as a sibling format handler within the broader `TranscriptAdapterFramework`. As a child of `LiveLoggingSystem`, SpecstoryAdapter inherits the system's overarching mandate: transcripts must ultimately conform to a unified `LSLSession`/`LSLEntry` model regardless of their native format.

## Architecture and Design

The adapter's design is grounded in a Template Method pattern: `TranscriptAdapter` defines the contract via abstract methods that throw runtime `Error`s when not overridden (constructor guard at `lib/agent-api/transcript-api.js:79-84`, using `new.target` to prevent direct instantiation of the base class). Because the codebase is plain JavaScript with JSDoc typing rather than a compiled type system, this runtime-enforced abstraction substitutes for compile-time interfaces. SpecstoryAdapter, as an inferred subclass, must implement these five abstract methods to participate in the framework.

![SpecstoryAdapter — Architecture](images/specstory-adapter-architecture.png)

Layered on top of this Template Method structure is a Strategy pattern: each adapter encapsulates format-specific parsing behavior behind the same interface, allowing the rest of LSL to treat Claude-format and Specstory-format transcripts interchangeably. Actual raw-to-LSL translation is delegated to a dedicated `LSLConverter` class rather than inlined into the adapter — a Converter/Adapter pattern visible in `ClaudeParser` at `lib/agent-api/transcripts/claude-parser.js:18`, and presumably mirrored in SpecstoryAdapter. Live transcript monitoring uses a polling-based Observer pattern (`watchTranscripts`/`stopWatching`) backed by an in-memory Set of callback watchers, with diffing implemented via entry-count slicing (`lib/agent-api/transcript-api.js:167-197`) rather than id- or timestamp-based cursors — a known fragility flagged as a recurring source of deduplication bugs elsewhere in the LSL subsystem. A time-boxed caching layer (`getCachedSession`/`cacheSession`), keyed by sessionId with TTL invalidation, rounds out the adapter's operational model.

## Implementation Details

All output entries produced by adapters are constrained to a fixed six-value `LSLEntryType` enum (`USER`, `ASSISTANT`, `TOOL_USE`, `TOOL_RESULT`, `SYSTEM`, `ERROR`), defined at `lib/agent-api/transcript-api.js:32-38`. This lowest-common-denominator vocabulary forces any Specstory-specific richness (markdown structure, formatting cues) into generic metadata or tool fields rather than first-class entry types. Path-derivation logic — exemplified in `ClaudeParser.getTranscriptDirectory()` (`lib/agent-api/transcripts/claude-parser.js:33-40`), which maps project paths to transcript directory names — represents a pattern SpecstoryAdapter likely mirrors for locating its own source data, given that `.specstory/history` is established as the canonical transcript root (`integrations/system-health-dashboard/lsl-sessions.mjs:53-66`, `discoverProjects()`).

## Integration Points

Downstream, the system-health dashboard (`integrations/system-health-dashboard/lsl-sessions.mjs:98-104`) performs per-chain format detection distinguishing `'pi'`, `'markdown'`, and `'mixed'` transcript types, converting formats live and in-memory at the presentation layer rather than normalizing upstream at ingestion. This means format-specific logic exists in two places — the adapter layer and the dashboard layer — that must be kept in sync, a maintainability risk directly relevant to SpecstoryAdapter's markdown-format role.

![SpecstoryAdapter — Relationship](images/specstory-adapter-relationship.png)

Within the parent `LiveLoggingSystem`, configuration and classification are gated centrally by `LSLConfigValidator` (`scripts/validate-lsl-config.js`), which enforces a fail-closed schema requiring five top-level sections including `classification`. This implies SpecstoryAdapter's output must route through classification/redaction-validated paths rather than writing directly to session storage — the same governance sibling components like `RedactionConfigManager` and `OperationalLogger` are subject to.

## Usage Guidelines

Developers extending or invoking SpecstoryAdapter should never instantiate `TranscriptAdapter` directly; the `new.target` guard exists precisely to force use of concrete subclasses. Any new entry data must be mapped into the fixed six-value `LSLEntryType` enum — resist the urge to introduce new types without updating the shared vocabulary. Given the noted plaintext-username leak pattern observed in `ClaudeParser.parseFile()` (`userHash: process.env.USER || 'unknown'`, contradicting LSL's hash+truncate pseudonymization convention), SpecstoryAdapter's own metadata handling should be audited for the same issue before assuming its output is safe for redaction-sensitive downstream consumers. Finally, because live-watch diffing is entry-count-based, any modification to polling logic should consider migrating toward id/timestamp-based cursors to avoid the deduplication bugs already documented elsewhere in the LSL subsystem, and any format-specific parsing changes should be cross-checked against the dashboard's independent format-detection logic in `lsl-sessions.mjs`.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- SpecstoryAdapter (class) in specstory-adapter.js


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem's configuration validation is centralized in scripts/validate-lsl-config.js through the LSLConfigValidator class, which acts as a schema enforcement gatekeeper for two distinct config artifacts: .specstory/config/lsl-config.json (structural/behavioral settings) and .specstory/config/redaction-config.yaml (privacy/classification rules). This separation reflects a deliberate architectural decision to decouple 'how the logger behaves' from 'what the logger is allowed to record', allowing redaction policy to be iterated on independently from file-management or session-windowing logic. The initializeSchemas() method enumerates five required top-level sections (version, multiUser, fileManager, operationalLogger, classification), meaning any config missing even one of these fails validation outright—this is a strict fail-closed design rather than a permissive fail-open one, which is notable for a system handling potentially sensitive session transcripts.

### Siblings
- [LSLConfigValidator](./LSLConfigValidator.md) -- [CGR] LSLConfigValidator (class) in validate-lsl-config.js
- [RedactionConfigManager](./RedactionConfigManager.md) -- [LLM] lib/agent-api/transcripts/claude-parser.js:parseFile() sets session metadata `userHash: process.env.USER || 'unknown'` — this is the RAW, unhashed OS username, not a SHA-256 truncated hash. This directly contradicts the pseudonymization pattern described for LSL's `validateUserEnvironment()` (hash+truncate to 6 chars) referenced in the parent LiveLoggingSystem context. If ClaudeParser's output metadata is persisted or surfaced without passing back through a redaction/hashing step, this is a plaintext-username leak in exactly the kind of session transcript metadata the classification schema is meant to guard, and is worth verifying against whatever RedactionConfigManager rules apply downstream of this adapter.
- [MultiUserSessionRouter](./MultiUserSessionRouter.md) -- [LLM] [object Object]
- [OperationalLogger](./OperationalLogger.md) -- [CGR] OperationalLogger (class) in OperationalLogger.js
- [TranscriptAdapterFramework](./TranscriptAdapterFramework.md) -- [LLM] [object Object]
- [SessionDashboardViewer](./SessionDashboardViewer.md) -- [LLM] [object Object]


---

*Generated from 10 observations*
