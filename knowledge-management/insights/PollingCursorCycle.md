# PollingCursorCycle

**Type:** Detail

This stateful cursor pattern means the adapter framework is not purely stateless — each watching instance maintains its own read-position state, which has implications for restart behavior and missed-entry recovery if the process is interrupted.

# PollingCursorCycle - Technical Insight Document

## What It Is

PollingCursorCycle is a recurring polling mechanism implemented in `lib/agent-api/transcript-api.js`, specifically within the `watchTranscripts()` function. It represents the temporal heartbeat of the transcript ingestion pipeline, using a `setInterval` loop to drive periodic checks against transcript sources and emit new entries downstream as LSL (Linear Stream Language) output.

The cycle combines two essential primitives: a **time-based trigger** (the interval tick) and a **stateful cursor** (the `lastEntryCount` variable). Together, these enable incremental processing where each tick only handles transcript entries that have appeared since the previous poll, rather than reprocessing the entire transcript history on every iteration.

As a Detail-level component within the `TranscriptAdapterFramework`, PollingCursorCycle operationalizes the abstract contract defined by its parent. While its sibling `AbstractTranscriptAdapter` establishes the structural interface (the five-method contract: `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`), PollingCursorCycle provides the runtime behavior that actually invokes these methods on a recurring schedule.

## Architecture and Design

The design follows a **polling with cursor** pattern — a classic approach for tailing append-only data sources without requiring filesystem watchers or event notifications. The architectural decision to use `setInterval` rather than reactive primitives (like `fs.watch` or push-based event streams) trades some latency for simplicity, portability across operating systems, and predictable resource usage. The tick frequency is explicitly configurable, allowing operators to tune the trade-off between latency (how <USER_ID_REDACTED> new transcripts reach LSL emission) and overhead (how often the poll loop fires).

The relationship with the parent `TranscriptAdapterFramework` is one of orchestration: the framework defines *what* an adapter must do via the abstract `TranscriptAdapter` interface, and PollingCursorCycle defines *when and how often* the adapter's methods (`readTranscripts()`, `convertToLSL()`) are invoked. This separation cleanly divides interface concerns from temporal/scheduling concerns, leaving sibling `AbstractTranscriptAdapter` free to focus purely on the plugin contract for agent integrations.

A key architectural property emerging from the observations is that **the adapter framework is not purely stateless**. Each invocation of `watchTranscripts()` produces a closure that owns its own `lastEntryCount` cursor — this state lives in memory for the duration of the watching session. This is an intentional design choice that simplifies the per-tick logic (a single slice operation suffices to extract new entries) but pushes durability and recovery concerns onto the caller.

## Implementation Details

The core implementation centers on `watchTranscripts()` in `lib/agent-api/transcript-api.js`. When invoked, it sets up a `setInterval` loop whose callback executes the polling cycle. Each tick performs roughly the following steps: read the current transcript state via the adapter's `readTranscripts()` method, compare its length to the persisted `lastEntryCount`, slice out only the newly appended entries, convert those entries to LSL via `convertToLSL()`, emit the result, and finally update `lastEntryCount` to reflect the new high-water mark.

The `lastEntryCount` state variable is the crux of the cursor mechanism. It persists across ticks via closure scope within `watchTranscripts()`, which means it is private to that particular watching session — multiple concurrent calls to `watchTranscripts()` would each maintain independent cursors. The slice operation (extracting entries from index `lastEntryCount` onwards) is a constant-time pointer arithmetic in conceptual terms, though the underlying `readTranscripts()` call may itself be O(n) over the transcript size depending on its implementation.

Tick frequency is the primary tuning knob exposed by this design. A shorter interval reduces end-to-end latency between a new transcript line being written and its corresponding LSL emission, but it increases the CPU and I/O load proportionally. Because the cycle calls `readTranscripts()` on every tick regardless of whether new entries exist, the cost of an "empty" tick is non-trivial — it still incurs the full read of the transcript directory specified by `getTranscriptDirectory()`.

## Integration Points

PollingCursorCycle integrates tightly with the `TranscriptAdapter` abstract interface, invoking three of its five methods on each cycle: `readTranscripts()` to fetch the current transcript state, `convertToLSL()` to transform new entries into the output format, and implicitly `getCurrentSession()` and `getAgentType()` for contextual metadata. The remaining method, `getTranscriptDirectory()`, is typically consumed once at setup time to know where to read from.

Downstream, the cycle's output flows into whatever LSL consumer is wired up — the observations describe this as "LSL emission" without specifying the consumer, but the contract is that converted LSL strings are produced at each tick that finds new entries. Upstream, the cycle depends on the filesystem (or whatever backing store the adapter's `readTranscripts()` implementation uses) being readable on every tick.

Within the framework hierarchy, PollingCursorCycle sits as a behavioral counterpart to its sibling `AbstractTranscriptAdapter`. Where `AbstractTranscriptAdapter` provides the structural contract that concrete adapters fulfill, PollingCursorCycle provides the runtime engine that drives those adapters. Together they constitute the operational semantics of the `TranscriptAdapterFramework`: structure plus temporal execution.

## Usage Guidelines

Developers extending the system with new transcript sources should be aware that PollingCursorCycle assumes transcripts are **append-only** — the cursor mechanism via `lastEntryCount` is fundamentally a "skip the first N entries" operation, which silently breaks if entries are deleted, reordered, or inserted mid-history. Adapter implementations of `readTranscripts()` should therefore guarantee monotonic, append-only behavior of the returned entry list.

The stateful cursor pattern has important **restart implications**: because `lastEntryCount` lives only in process memory, a process interrupt or restart resets the cursor. Depending on how `watchTranscripts()` is re-invoked, this can lead to either reprocessing all historical entries (if the cursor starts at zero) or missing entries that arrived during the downtime (if it starts at the current length). Operators concerned with durability should layer external bookkeeping — for example, persisting the LSL emission state externally — rather than expecting the cycle itself to provide at-least-once or exactly-once guarantees.

Tick frequency should be chosen deliberately. For interactive or near-real-time use cases, shorter intervals (sub-second) are appropriate, but be mindful of the I/O overhead — every tick calls `readTranscripts()` even when nothing has changed. For batch-style aggregation, longer intervals (multi-second) reduce overhead at the cost of latency. There is no built-in adaptive backoff, so the chosen frequency is the actual polling cadence.

Finally, when writing new adapters that conform to the `AbstractTranscriptAdapter` interface, remember that PollingCursorCycle will invoke `readTranscripts()` and `convertToLSL()` repeatedly and predictably. These methods should be idempotent (the same input produces the same output) and side-effect-free with respect to the transcript source — the cycle is the orchestrator of state changes, and adapter methods should remain pure readers and transformers.


## Hierarchy Context

### Parent
- [TranscriptAdapterFramework](./TranscriptAdapterFramework.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js declares five abstract methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession() — forming the mandatory interface for any new agent integration

### Siblings
- [AbstractTranscriptAdapter](./AbstractTranscriptAdapter.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js defines the five-method contract that all concrete adapters must fulfill, establishing a plugin-style extensibility pattern for agent integrations.


---

*Generated from 3 observations*
