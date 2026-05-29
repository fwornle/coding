# TimeWindowFormatter

**Type:** Detail

Per the SubComponent context, the LSLMetadata type includes a timeWindow field formatted as e.g. '0800-0900', and the TranscriptAdapter contract in lib/agent-api/transcript-api.js assigns window computation to the adapter layer at ingestion time.

# TimeWindowFormatter — Technical Insight Document

## What It Is

`TimeWindowFormatter` is a focused utility component implemented within the `TranscriptAdapter` layer, referenced via `lib/agent-api/transcript-api.js`. Its sole responsibility is converting a Unix timestamp into a human-readable hourly bucket string formatted as `'HHMM-HHMM'` (e.g., `'0800-0900'`), and assigning the result to the `LSLMetadata.timeWindow` field during transcript ingestion. It lives as a contained unit within its parent, `SessionWindowManager`, which governs the broader concerns of session-scoped windowing across the transcript pipeline.

## Architecture and Design

The design of `TimeWindowFormatter` reflects a clear **eager computation** strategy: window labels are stamped onto each `LSLEntry` at ingestion time inside `convertToLSL()`, rather than being derived lazily at query or routing time. This is an explicit contract enforced by the `TranscriptAdapter` layer — the adapter bears full responsibility for populating `LSLMetadata.timeWindow` before an entry is routed or persisted anywhere downstream.

This eager-stamping pattern has meaningful architectural consequences. Any consumer of an `LSLEntry` — whether a router, a persistence layer, or an analytics pipeline — can treat `timeWindow` as a guaranteed, fully-resolved field. There is no deferred resolution logic scattered across consumers, which simplifies downstream contracts considerably.

The decision to assign this responsibility to the adapter layer (rather than, say, a query-time formatter or a persistence decorator) reflects a separation-of-concerns principle: the shape of an `LSLEntry` is fully determined at the point of ingestion, and `TimeWindowFormatter` is the mechanism that makes `timeWindow` part of that canonical shape. Within `SessionWindowManager`, `TimeWindowFormatter` acts as a well-scoped sub-component — handling the formatting concern cleanly without bleeding session-management logic into its implementation.

## Implementation Details

The core of `TimeWindowFormatter` is the `formatWindow(timestamp)` function. It accepts a Unix timestamp and produces a `'HHMM-HHMM'` string representing the hourly window that timestamp falls within — for example, a timestamp at 08:34 would yield `'0800-0900'`. This result is directly assigned to `LSLMetadata.timeWindow` as part of the `convertToLSL()` transformation.

The formatting convention — zero-padded four-digit hour-minute pairs separated by a hyphen — is a fixed schema contract. The `LSLMetadata` type carries `timeWindow` as a string field, meaning the formatting logic in `formatWindow()` is the authoritative source of that field's shape. Any change to the format string would require coordinated updates across anything that reads or indexes `timeWindow`.

The computation is straightforward: derive the start-of-hour from the timestamp, format both the start and end of that hour as `HHMM` strings, and concatenate them. Because this happens inside `convertToLSL()`, it executes synchronously during the ingestion pipeline — there are no async concerns or external dependencies evident in the design.

## Integration Points

`TimeWindowFormatter` integrates directly into the `TranscriptAdapter` contract defined in `lib/agent-api/transcript-api.js`. Its output — the `timeWindow` string — is a field on the `LSLMetadata` type, which is part of every `LSLEntry` produced by `convertToLSL()`. This means anything downstream that consumes `LSLEntry` objects implicitly depends on `TimeWindowFormatter` having run correctly at ingestion time.

Its parent, `SessionWindowManager`, provides the broader session-windowing context. `TimeWindowFormatter` handles the low-level timestamp-to-string formatting slice of that concern, while `SessionWindowManager` presumably coordinates how those windows relate to session boundaries and lifecycle. The tight containment — `TimeWindowFormatter` inside `SessionWindowManager` — keeps the formatting logic co-located with the component most directly responsible for understanding what windows mean semantically.

## Usage Guidelines

Developers working in the `TranscriptAdapter` layer should treat `formatWindow(timestamp)` as the **single, canonical way** to produce a `timeWindow` value. Inline formatting or ad-hoc string construction for this field should be avoided — the format string `'HHMM-HHMM'` is a schema contract, and consistency is enforced by routing all formatting through this function.

Because window assignment happens eagerly in `convertToLSL()`, developers should never assume `timeWindow` needs to be computed or back-filled after an `LSLEntry` has been created. If an entry exists, its `timeWindow` is already resolved. Conversely, any ingestion path that bypasses `convertToLSL()` would produce entries with an unpopulated `timeWindow`, which would violate the `LSLMetadata` contract and break downstream consumers that depend on this field being present.

When modifying `formatWindow()` or the `'HHMM-HHMM'` format convention, treat it as a **breaking schema change** — audit all consumers of `LSLMetadata.timeWindow` before making changes, as there is no runtime indirection between the formatter's output and the field value stored or routed downstream.

---

### Key Architectural Patterns and Trade-offs

| Dimension | Decision | Trade-off |
|---|---|---|
| **Computation timing** | Eager (at ingestion) | Simplifies consumers; couples format to ingestion path |
| **Responsibility placement** | Adapter layer | Clean separation from persistence/query; adapter must be correct |
| **Format contract** | Fixed string schema (`HHMM-HHMM`) | Predictable for consumers; format changes are breaking |
| **Containment** | Sub-component of `SessionWindowManager` | Co-location with session logic; formatting concern is well-scoped |


## Hierarchy Context

### Parent
- [SessionWindowManager](./SessionWindowManager.md) -- The LSLMetadata type defined in the transcript pipeline includes a `timeWindow` field (formatted as e.g. '0800-0900'), and the TranscriptAdapter contract in `lib/agent-api/transcript-api.js` assigns responsibility for populating this field to the adapter layer, meaning window computation happens at ingestion time


---

*Generated from 3 observations*
