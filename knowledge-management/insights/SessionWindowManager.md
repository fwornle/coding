# SessionWindowManager

**Type:** SubComponent

The windowing scheme is referenced across transcript adapter modules, suggesting each TranscriptAdapter implementation populates LSLMetadata window fields via a shared utility rather than per-adapter logic

## What It Is

`SessionWindowManager` is a SubComponent of LiveLoggingSystem responsible for assigning hourly window labels to transcript sessions. It operates as a shared utility within the `lib/agent-api/transcript-api.js` ecosystem, producing string labels of the form `'0800-0900'` that serve as routing keys embedded in `LSLMetadata`. Rather than being an adapter-specific concern, window assignment is centralized here and consumed across all `TranscriptAdapter` implementations, ensuring consistent bucketing regardless of which agent backend is producing transcripts.

## Architecture and Design

![SessionWindowManager — Architecture](images/session-window-manager-architecture.png)

The core design decision is deliberate simplicity: window boundaries are fixed at 60-minute intervals with no overlap or dynamic sizing. This "fixed-bucket" scheme makes window arithmetic trivially deterministic — given any timestamp, the correct label can be computed with integer division, requiring no state lookups or external configuration. The tradeoff is explicit: sessions that straddle an hour boundary (e.g., starting at 08:55 and ending at 09:10) will have their entries split across two window files. The system accepts this fragmentation in exchange for the operational simplicity of never needing to resolve variable-length or overlapping windows.

This design also reflects a conscious separation of concerns within LiveLoggingSystem. The `TranscriptAdapterRegistry` manages which adapter handles which agent type, and `RedactionEngine` handles PII scrubbing via `.specstory/config/redaction-config.yaml` — neither touches windowing logic. By isolating window assignment in `SessionWindowManager`, the parent system avoids scattering bucket arithmetic across every adapter implementation.

![SessionWindowManager — Relationship](images/session-window-manager-relationship.png)

## Implementation Details

The windowing logic integrates directly with `getCurrentSession()` in `lib/agent-api/transcript-api.js`. When an active session's metadata is being constructed, `SessionWindowManager` computes the appropriate window label and stamps it onto the `LSLMetadata` object at capture time — not at read time. This is a meaningful choice: the window assignment travels with the metadata record itself, so downstream consumers never need to re-derive window membership from raw timestamps. The label becomes a first-class field in `LSLMetadata`, usable directly as a routing key.

The implied file routing structure is a directory hierarchy keyed by window label. A transcript written during the `0800-0900` window is stored under a path containing that label, allowing consumers to retrieve all transcripts for a specific hour by navigating directly to the corresponding directory rather than scanning a flat index of all sessions. This is particularly important given that LiveLoggingSystem's `watchTranscripts()` operates via `setInterval` polling rather than filesystem watchers — efficient directory-scoped retrieval reduces the cost of each poll cycle when only a specific time range is of interest.

## Integration Points

The primary integration is with `getCurrentSession()` in `lib/agent-api/transcript-api.js`, which is one of the five mandatory methods defined by the `TranscriptAdapter` base class. Every concrete adapter — regardless of agent type — must implement `getCurrentSession()`, and in doing so, each implicitly relies on `SessionWindowManager` to populate the window field in the returned `LSLMetadata`. This makes `SessionWindowManager` a shared dependency across the entire adapter ecosystem, even though no adapter contains windowing logic directly. The `TranscriptAdapterRegistry`, which maps agent types to their adapter implementations, does not interact with `SessionWindowManager` directly, but every adapter it manages will produce metadata stamped by this component.

Downstream consumers of the transcript directory hierarchy depend on window labels being stable and consistently formatted. Any change to the label format (e.g., switching from `'0800-0900'` to a different scheme) would break directory routing assumptions held by those consumers, making the label format a de facto public interface.

## Usage Guidelines

Developers adding new `TranscriptAdapter` implementations should treat window label population as handled infrastructure — `getCurrentSession()` should delegate window assignment to `SessionWindowManager` rather than computing it independently. Per-adapter windowing logic would break the consistency guarantee that makes directory-scoped retrieval reliable.

The fixed 60-minute boundary is a known constraint, not a bug. When debugging sessions that appear split across two files, the first diagnostic step is checking whether the session straddled an hour boundary. There is no merging or stitching mechanism; downstream consumers that need cross-window continuity must retrieve both adjacent window directories and join entries by session identifier themselves.

Because window labels feed directly into filesystem paths, they must remain filesystem-safe strings. The `'HHMM-HHMM'` format satisfies this on all target platforms, but any future extension of the label scheme (e.g., adding date prefixes) should be validated against the directory hierarchy assumptions before deployment.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem is built around a strict abstract interface defined by the `TranscriptAdapter` class in `lib/agent-api/transcript-api.js`. Every agent-specific adapter must implement five methods: `getAgentType()` (returns a string identifier like `'claude-code'`), `getTranscriptDirectory()` (returns the filesystem path where raw agent transcripts reside), `readTranscripts()` (reads and parses raw transcript files), `convertToLSL()` (transforms raw entries into the unified LSL typed format), and `getCurrentSession()` (returns metadata for the active session). Live capture is achieved not through filesystem watchers (like `fs.watch`) but through a polling loop: `watchTranscripts()` uses `setInterval` to periodically invoke `readTranscripts()` and diff against previously seen entries. This design trades immediacy for portability—`fs.watch` has known cross-platform inconsistencies, especially in Docker containers and network-mounted filesystems, so polling avoids those failure modes at the cost of introducing a configurable latency between an agent writing a transcript entry and the LSL system capturing it.

### Siblings
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine reads its rule set from `.specstory/config/redaction-config.yaml`, externalizing secret and PII patterns so new redaction rules can be added without code changes
- [TranscriptAdapterRegistry](./TranscriptAdapterRegistry.md) -- The `TranscriptAdapter` base class in `lib/agent-api/transcript-api.js` defines the five mandatory methods: `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`, making it the single contract point for all agent integrations


---

*Generated from 5 observations*
