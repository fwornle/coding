# SessionWindowManager

**Type:** SubComponent

SessionWindowManager assigns LSL session entries to hourly time-window buckets (e.g., '0800-0900') that are embedded directly in LSL metadata, meaning the window label becomes part of the persisted file identity rather than a query-time annotation

# SessionWindowManager — Technical Insight Document

## What It Is

SessionWindowManager is a SubComponent of the `LiveLoggingSystem` responsible for assigning LSL (Live Session Log) session entries to hourly time-window buckets — labels of the form `'0800-0900'` — and embedding those labels directly into LSL metadata so that the window identifier becomes part of the persisted file's identity. Rather than treating the window as a query-time annotation applied during read operations, SessionWindowManager makes the routing decision at write time, meaning the bucket label is materialized into the file system layout itself.

It sits within the broader live-logging pipeline alongside its siblings `RedactionEngine` and `TranscriptAdapterBase`. By the time SessionWindowManager processes a session entry, the content has already passed through `RedactionEngine` (whose configuration is gated by `LSLConfigValidator`), so SessionWindowManager operates exclusively on validated, redacted content — never on raw transcripts. It delegates the actual stamping of the window label onto persisted metadata to its child component, `WindowLabelFileIdentityEmbedder`.

![SessionWindowManager — Architecture](images/session-window-manager-architecture.png)

## Architecture and Design

The architectural approach is a **write-time routing / file-identity embedding** pattern. Instead of writing all entries to a single rolling log and partitioning later via <USER_ID_REDACTED>, SessionWindowManager computes the destination bucket at the moment of write, and the bucket name is stored as part of the LSL metadata. This makes the file system itself an index — the hourly partition is materialized rather than computed.

The component sits downstream of `RedactionEngine` in the pipeline. As described in the parent `LiveLoggingSystem` context, the polling infrastructure is provided by `TranscriptAdapter.watchTranscripts()` in `lib/agent-api/transcript-api.js`, which fires registered callbacks whenever new transcript entries are detected. SessionWindowManager is positioned to consume those entries after `RedactionEngine` has applied the validated rule set from `.specstory/config/redaction-config.yaml`. This ordering — validate → redact → window-route → persist — means SessionWindowManager never sees raw transcripts and is decoupled from the concerns of content sanitization.

The window-assignment strategy uses **wall-clock hour alignment** rather than session-duration alignment. A session starting at 08:59 and ending at 09:10 spans the 0800-0900 / 0900-1000 boundary, and this is a known design tension. The observations indicate SessionWindowManager uses the session's start timestamp — obtained from the adapter's `getCurrentSession()` method (one of the five abstract methods of `TranscriptAdapterBase`) — as the assignment key. This keeps all entries from a single session in one file regardless of where they fall in real time, which is a deliberate trade-off: temporal precision at the entry level is sacrificed for session-level cohesion.

The child component `WindowLabelFileIdentityEmbedder` carries out the actual embedding step. Because the label "becomes part of the persisted file identity," this embedder runs before the LSL entry is flushed to disk, tightly coupling it to whatever hourly calculation logic SessionWindowManager applies.

## Implementation Details

SessionWindowManager's core mechanic is timestamp-to-bucket conversion. For each session it processes, it reads the session start time via `getCurrentSession()` and computes an hourly window label in the `HHMM-HHMM` format. The first half of the label is the floor of the start hour; the second half is the next hour. That label is then attached to the LSL metadata via `WindowLabelFileIdentityEmbedder` before persistence, making it part of the file's discoverable identity.

Because all entries from a single session share the start-timestamp-derived label, individual entry timestamps are not used for routing. This is a deliberate simplification: it avoids the per-entry routing overhead and guarantees that a session's transcript is never fragmented across files purely because the conversation extended past an hour mark. However, it does mean the file label may not accurately describe the wall-clock time of later entries in a long session.

A critical implementation concern arises from how `TranscriptAdapter.watchTranscripts()` manages state. The polling loop in `lib/agent-api/transcript-api.js` resets its `lastEntryCount` cursor only on adapter instantiation, never persisting it across process restarts. Consequently, after a restart, all entries are replayed from the beginning of the transcript. SessionWindowManager must therefore be **idempotent with respect to replay**: re-processing the same session entries must not create duplicate window-file segments. This implies the file-write path must use the embedded window label plus session identity as a deduplication key, or the persistence layer must overwrite/merge rather than append blindly.

Boundary-crossing sessions are another implementation hotspot. Because routing happens at write time and uses the session start timestamp, a session that spans 08:59 → 09:10 is assigned to `0800-0900` in its entirety. There is no automatic split. The observation explicitly flags that "sessions that span an hourly boundary would require explicit handling to avoid being silently truncated or duplicated across two window files" — meaning callers and maintainers must be aware that the natural file identity will not subdivide such sessions unless explicit logic is added.

![SessionWindowManager — Relationship](images/session-window-manager-relationship.png)

## Integration Points

SessionWindowManager integrates with three principal collaborators. Upstream, it depends on the polling and session-discovery contract provided by `TranscriptAdapterBase` in `lib/agent-api/transcript-api.js`. Specifically, it consumes the output of `getCurrentSession()` to obtain the start timestamp used for bucket assignment, and it relies on `watchTranscripts()` to deliver newly observed entries. Any concrete adapter — for Claude Code, Copilot CLI, or future agents — must implement these methods to be compatible.

Laterally, it is coupled to `RedactionEngine`, its sibling under `LiveLoggingSystem`. The pipeline ordering ensures that by the time SessionWindowManager assigns a window, the content has already been sanitized according to `.specstory/config/redaction-config.yaml`. Indirectly, this means SessionWindowManager is also dependent on `LSLConfigValidator` — if validation rejects the redaction configuration, the persistence pipeline halts before SessionWindowManager would normally act. SessionWindowManager itself does not interact with `LSLConfigValidator` directly; the relationship is mediated through `RedactionEngine`.

Downstream, SessionWindowManager owns and drives `WindowLabelFileIdentityEmbedder`. The embedder is responsible for writing the computed window label into LSL metadata such that the file system reflects the bucket assignment. This child relationship is tight: any change to the label format (e.g., switching from hourly to half-hourly) would necessarily ripple into the embedder's behavior.

## Usage Guidelines

Developers extending or interacting with SessionWindowManager should treat the window label as **a stable element of file identity**, not as a re-derivable annotation. Once embedded, the label is part of the persisted artifact, and downstream consumers may rely on it for file discovery. Changing the labeling scheme is therefore a breaking change requiring a migration plan for existing log files.

When implementing new `TranscriptAdapterBase` concrete classes, ensure `getCurrentSession()` returns a stable, reliable start timestamp. SessionWindowManager uses this value as the sole input for window assignment; an unreliable or shifting start time would cause session entries to migrate between window files unpredictably. Additionally, because `lastEntryCount` in `watchTranscripts()` is reset on every process restart, adapter authors should either filter already-processed entries in their `readTranscripts()` implementation or rely on SessionWindowManager's idempotency guarantees — but should not assume the polling loop alone prevents replay.

Be explicit about hour-boundary behavior. The current design routes an entire session to the window of its start timestamp, even if it spans into the next hour. If you need entries from after 09:00 in the example session to land in the `0900-1000` file, you must add explicit boundary-split logic — SessionWindowManager will not do it automatically.

Finally, never bypass `RedactionEngine` when feeding content to SessionWindowManager. The pipeline assumes redacted input, and writing raw transcripts directly through the window-routing stage would persist unsanitized content into LSL files, defeating the validation guarantees enforced upstream by `LSLConfigValidator`.

---

## Summary of Analytical Findings

**1. Architectural patterns identified:** Write-time routing with materialized file-identity partitioning; pipeline composition (validate → redact → window-route → persist); delegation to a single-purpose child (`WindowLabelFileIdentityEmbedder`); polling-driven consumer pattern via `TranscriptAdapterBase.watchTranscripts()`.

**2. Design decisions and trade-offs:** Wall-clock hour alignment over session-duration alignment trades temporal entry-level precision for session-level cohesion. Using session start time as the sole routing key trades per-entry accuracy for atomicity. Embedding the window into file identity trades query-time flexibility for filesystem-as-index simplicity. The replay tolerance requirement (driven by non-persistent `lastEntryCount`) trades restart resilience for idempotency complexity in the write path.

**3. System structure insights:** SessionWindowManager is a narrow, downstream stage in `LiveLoggingSystem`'s pipeline. It sits parallel to `RedactionEngine` (which it depends on transitively for clean input) and consumes from `TranscriptAdapterBase`'s polling output. Its single child, `WindowLabelFileIdentityEmbedder`, exists solely to materialize the routing decision into persisted metadata.

**4. Scalability considerations:** Hourly partitioning naturally bounds file size growth per bucket, aiding scalability of downstream readers. However, long-running sessions that span many hours but stay in a single file (due to start-timestamp routing) can produce unbalanced bucket sizes. The replay-on-restart behavior could create scalability concerns for adapters with large transcript histories — restart cost is O(total entries), not O(new entries).

**5. Maintainability assessment:** The component has clear boundaries — input contract from `TranscriptAdapterBase.getCurrentSession()`, output delegation to `WindowLabelFileIdentityEmbedder`, lateral dependency on `RedactionEngine`'s output. Risks to maintainability include implicit assumptions (boundary-crossing not handled automatically, idempotency required for replay) that are not enforced by types or interfaces and must be respected by convention. Documenting the hour-boundary policy and the replay-tolerance requirement is essential for new contributors, especially given the absence of code symbols in the current observation set, which suggests this component's contract is currently behavioral rather than explicitly typed.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The TranscriptAdapter abstract base class in lib/agent-api/transcript-api.js enforces a strict interface contract via five abstract methods: getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession(). Concrete adapters for Claude Code and Copilot CLI must implement all five. The base class itself provides the polling infrastructure via watchTranscripts(), which calls setInterval at a default 1000ms cadence, reads transcripts, compares the new entry count against an in-memory lastEntryCount cursor, and fires all registered callbacks (stored in a Set) only when new entries are detected. This design means the polling loop is entirely stateless with respect to entry content — it tracks only counts, not hashes or timestamps — so any adapter that reorders or replaces existing entries without changing the total count would silently suppress callbacks. New developers should be aware that lastEntryCount is reset only on adapter instantiation, not across process restarts persisted to disk, meaning a restart always replays all entries from the beginning unless the adapter's readTranscripts() implementation itself filters already-processed entries.

### Children
- [WindowLabelFileIdentityEmbedder](./WindowLabelFileIdentityEmbedder.md) -- Inferred from parent context (no source files available): the parent description states the window label is 'embedded directly in LSL metadata' and 'becomes part of the persisted file identity', meaning this embedder runs before the LSL entry is flushed to disk, coupling it tightly to HourlyWindowCalculator's output.

### Siblings
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine reads its rule set from .specstory/config/redaction-config.yaml, meaning redaction behavior is fully externalized and can be changed without code deployment, but an invalid config can block all persistence if LSLConfigValidator rejects it
- [TranscriptAdapterBase](./TranscriptAdapterBase.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js declares five abstract methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession() — that every concrete adapter must implement, providing a single extension point for adding new agent integrations


---

*Generated from 6 observations*
