# SessionWindowing

**Type:** SubComponent

The getCurrentSession() contract in TranscriptAdapter (transcript-api.js) implicitly depends on SessionWindowing to distinguish live session entries from historical ones, since the polling loop uses the returned session object to filter by current window boundaries.

# SessionWindowing — Technical Insight Document

## What It Is

SessionWindowing is a SubComponent within the `LiveLoggingSystem` that defines how agent conversation sessions are partitioned into discrete time buckets for storage and retrieval in the LSL (Live Session Log) pipeline. Its presence is encoded primarily through the `LSLMetadata.timeWindow` field, which is referenced across two key files: `lib/agent-api/transcript-api.js` (home of the `TranscriptAdapter` plugin contract) and `lib/agent-api/lsl-converter.js` (home of the LSL normalization logic). The `timeWindow` field encodes session time boundaries as hour-range strings such as `'0800-0900'`, establishing a fixed 60-minute bucketing granularity rather than supporting variable-length sessions.

![SessionWindowing — Architecture](images/session-windowing-architecture.png)

The component is decomposed into two children: `HourlyBucketEncoder`, which is responsible for producing the canonical hour-range string format consumed by the LSL pipeline, and `SessionBoundaryDetector`, which determines whether the current moment still falls within a previously-assigned window. Together, these children implement the read and write halves of the windowing contract, while SessionWindowing itself acts as the schema authority that both the adapter layer and the serialization layer must honor.

## Architecture and Design

SessionWindowing follows a **shared-schema contract pattern**. Because both `transcript-api.js` and `lsl-converter.js` reference the `LSLMetadata.timeWindow` field, the windowing schema functions as a cross-cutting contract between the adapter layer (which owns session lifecycle through `getCurrentSession()`) and the serialization layer (which owns format normalization through `convertToLSL()`). Neither file owns the schema in isolation — they cooperate around it, which means any change to bucket granularity is by definition a cross-file breaking change.

The architectural decision to perform window assignment **at conversion time** is significant. `lsl-converter.js` participates in window assignment during the `convertToLSL()` normalization step, meaning the `timeWindow` metadata is stamped onto each LSL typed-entry as it is produced, not patched in post-hoc by a separate batch job. This "stamp-on-write" design ensures that every entry in the LSL stream carries its own self-describing temporal coordinate, removing the need for downstream consumers to re-derive window membership from raw timestamps.

The choice of a **fixed 60-minute hourly bucket** (rather than session-length-aware windows) is a deliberate trade-off. Hourly buckets give the system predictable storage partitioning and trivial cross-session query semantics — you can ask "what happened between 0800 and 0900" without needing to understand individual session boundaries. The cost is that long sessions crossing an hour boundary are mechanically split into multiple window segments, which `SessionBoundaryDetector` and the `getCurrentSession()` implementations in `TranscriptAdapter` subclasses must handle correctly during hour-edge and midnight rollover.

## Implementation Details

The core data structure is `LSLMetadata.timeWindow`, a string field formatted as `HHMM-HHMM` (e.g., `'0800-0900'`). The `HourlyBucketEncoder` child component, which the parent context locates in `lsl-converter.js`, is responsible for producing these strings — likely by taking a `Date` or timestamp input, rounding the start down to the hour, and computing the end as start + 1 hour, then formatting both as zero-padded `HHMM` values joined by a hyphen.

The `SessionBoundaryDetector` child component implements the read-side counterpart. Per the hierarchy context, this logic is most likely embedded in or invoked by `getCurrentSession()` within `TranscriptAdapter` in `transcript-api.js`. Its job is to read the existing `timeWindow` value on a candidate session and test whether `Date.now()` still falls within the encoded hour range. When the test fails (i.e., the clock has rolled past the upper bound of the window), the session is no longer "current" and the adapter must either begin a new window segment or signal that the live session has rotated.

The `getCurrentSession()` contract in `TranscriptAdapter` implicitly depends on SessionWindowing to distinguish live session entries from historical ones. The polling loop described in the parent `LiveLoggingSystem` documentation uses the session object returned by `getCurrentSession()` to filter entries by current window boundaries — so a correctly-implemented `SessionBoundaryDetector` is essential for the polling loop to avoid both replaying historical entries and missing live ones at hour edges.

## Integration Points

![SessionWindowing — Relationship](images/session-windowing-relationship.png)

SessionWindowing integrates with its parent `LiveLoggingSystem` through the `TranscriptAdapter` base class in `lib/agent-api/transcript-api.js`. Specifically, the five abstract methods that adapters must implement — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()` — touch SessionWindowing at two points: `convertToLSL()` invokes the `HourlyBucketEncoder` to stamp `timeWindow` onto each typed entry, and `getCurrentSession()` invokes the `SessionBoundaryDetector` to determine session liveness.

The sibling component `RedactionLayer` operates orthogonally to SessionWindowing: redaction rules from `.specstory/config/redaction-config.yaml` apply to entry content regardless of which window an entry falls into. The two SubComponents share the same LSL typed-entry pipeline but contribute different metadata facets — `RedactionLayer` modifies content, while SessionWindowing modifies temporal metadata. Both run during or around `convertToLSL()`, making that method the primary integration seam for cross-cutting concerns.

On the serialization side, `lsl-converter.js` is the sole producer of `timeWindow` values, while `transcript-api.js` is the primary consumer for liveness checks. Any concrete adapter subclass (such as the Claude Code adapter reading from `~/.claude/projects/<project>/conversation.jsonl`, or the Copilot CLI adapter targeting its own directory) inherits this contract automatically — they do not need to implement windowing logic themselves, only ensure that timestamps fed into `convertToLSL()` are accurate.

## Usage Guidelines

When implementing a new `TranscriptAdapter` subclass, developers must ensure that `getCurrentSession()` correctly accounts for hour-boundary rollover. Because the windowing scheme is fixed at 60 minutes, a session that begins at 08:55 and continues to 09:10 will be split into two segments: one with `timeWindow: '0800-0900'` and another with `timeWindow: '0900-1000'`. Adapters that naively cache a single "current session" object without re-checking the window against the wall clock will return stale results to the polling loop after an hour edge.

Do not attempt to introduce variable-length windows, sub-hour granularity, or multi-hour buckets without coordinated changes to both `lib/agent-api/transcript-api.js` and `lib/agent-api/lsl-converter.js`. The schema contract is shared, and partial changes will produce `timeWindow` values that one side cannot parse. If a different granularity is genuinely required, treat it as a versioned schema migration — introduce a new field rather than overloading the existing `timeWindow`.

Always rely on `HourlyBucketEncoder` (in `lsl-converter.js`) to produce window strings rather than constructing them manually in adapter code. The canonical zero-padded `HHMM-HHMM` format is brittle to ad-hoc string concatenation — off-by-one errors at midnight (where the next window after `'2300-2400'` should arguably be `'0000-0100'`, not `'2400-2500'`) are exactly the kind of bug a centralized encoder prevents.

Finally, when debugging missing or duplicate live entries, inspect the `timeWindow` field on the latest LSL entries first. Because the window is stamped at conversion time, mismatches between the stamped window and the wall-clock-derived window used by `getCurrentSession()` are the most common source of polling-loop filtering errors. A correct implementation will show monotonically advancing `timeWindow` values that align with the system clock as time progresses.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The TranscriptAdapter class in lib/agent-api/transcript-api.js establishes a strict plugin contract for integrating new agent conversation sources into the LSL pipeline. It requires five abstract methods: getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession(). This design cleanly separates concerns — the base class owns the lifecycle and dispatch logic, while subclasses own the format-specific parsing. Claude Code transcripts live at ~/.claude/projects/<project>/conversation.jsonl, a JSONL file that grows append-only during a session; the Copilot CLI adapter targets a different directory structure. The convertToLSL() method is the normalization seam, responsible for mapping each agent's native message structure into the unified LSL typed-entry format with types: user, assistant, tool_use, tool_result, system, and error. A new developer adding a third agent integration (e.g., Cursor, Aider) only needs to subclass TranscriptAdapter and implement these five methods — no changes to the core LSL infrastructure are required. The getCurrentSession() method is particularly important: it must return the 'live' session object so the polling loop knows which entries are part of the current conversation versus a historical one, which implies adapters must implement their own session-boundary detection logic appropriate to their agent's format.

### Children
- [HourlyBucketEncoder](./HourlyBucketEncoder.md) -- The L2 parent context explicitly identifies lsl-converter.js as a primary file that references LSLMetadata.timeWindow, making it the likely home of the encoding logic that produces strings like '0800-0900'.
- [SessionBoundaryDetector](./SessionBoundaryDetector.md) -- The L2 parent description references 'session time boundaries' encoded in LSLMetadata.timeWindow, implying that at least one function — likely getCurrentSession() in transcript-api.js — reads the existing timeWindow value and tests whether the current moment still falls within it.

### Siblings
- [RedactionLayer](./RedactionLayer.md) -- Redaction rules are declared in .specstory/config/redaction-config.yaml, externalizing privacy policy from code so operators can update patterns without modifying the adapter or converter logic.


---

*Generated from 5 observations*
