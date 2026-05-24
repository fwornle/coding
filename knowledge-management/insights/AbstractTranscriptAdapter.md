# AbstractTranscriptAdapter

**Type:** Detail

The separation of getTranscriptDirectory() and readTranscripts() as distinct abstract methods suggests the framework intentionally decouples filesystem path resolution from file parsing logic, allowing adapters to handle agent-specific directory layouts independently.

# AbstractTranscriptAdapter — Technical Insight Document

## What It Is

`AbstractTranscriptAdapter` is the abstract base contract defined by `TranscriptAdapter` in `lib/agent-api/transcript-api.js`. It establishes the mandatory five-method interface that every concrete adapter must implement in order to integrate a new agent into the broader `TranscriptAdapterFramework`. The five required methods are `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()`.

In architectural terms, this entity functions as the formal extension point of the transcript ingestion subsystem. Rather than hard-coding agent-specific behavior into the framework, the abstraction forces each integration to declare its agent identity, expose where its transcripts live on disk, parse those transcripts, normalize them into the canonical LSL (Live Session Log) format, and report the currently active session. This contract is the seam where new agent ecosystems plug into the rest of the pipeline.

As a child of `TranscriptAdapterFramework`, `AbstractTranscriptAdapter` defines the *what* (the obligations of an adapter), while its sibling `PollingCursorCycle` defines the *when* (the temporal cadence at which adapters are invoked). Together, these components form the contract-and-driver pair that powers transcript ingestion.

## Architecture and Design

The architecture follows a classic **plugin/strategy pattern** layered on top of a **template method** sensibility. By declaring all five methods as abstract in `lib/agent-api/transcript-api.js`, the framework leaves concrete behavior to subclasses while preserving a uniform invocation surface for upstream code. This is a deliberate inversion of control: the framework owns orchestration, and adapters own agent-specific knowledge.

A key design decision is the **separation of `getTranscriptDirectory()` from `readTranscripts()`**. These could plausibly have been collapsed into a single "load transcripts" method, but keeping them distinct decouples filesystem path resolution from file parsing logic. This allows each adapter to handle agent-specific directory layouts independently — for example, one agent may store transcripts in nested per-session folders while another flattens them — without that complexity leaking into parsing routines. It also enables external tooling to discover transcript locations without forcing a full parse.

`convertToLSL()` is the **canonicalization boundary** of the system. Each adapter is responsible for translating its agent's native transcript format into LSL (Live Session Log), which is the lingua franca consumed downstream by the `LiveLoggingSystem`. This design centralizes format diversity at the adapter edge and guarantees that everything past `convertToLSL()` operates on a single, predictable representation. The trade-off is that every new agent integration incurs the cost of writing a faithful format translator, but the benefit is that downstream consumers remain stable regardless of how many agents are added.

The relationship to the sibling `PollingCursorCycle` reinforces this separation of concerns: `PollingCursorCycle.watchTranscripts()` provides a `setInterval`-driven loop that invokes adapter methods on a configurable tick frequency, while `AbstractTranscriptAdapter` defines what those invocations actually do. Latency between transcript writes and LSL emission is controlled by the polling cadence, not by the adapter contract itself.

## Implementation Details

The implementation lives in `lib/agent-api/transcript-api.js` as the `TranscriptAdapter` class. Its five abstract methods carry well-defined semantic responsibilities:

- **`getAgentType()`** — Returns an identifier for the agent the adapter targets. This is used by the framework to route, register, or differentiate adapters at runtime.
- **`getTranscriptDirectory()`** — Resolves and returns the filesystem path where the agent persists transcript data. By keeping this pure (path resolution only), adapters can support agent-specific layout conventions without bundling parsing logic.
- **`readTranscripts()`** — Reads and parses the raw transcript files from the directory exposed by `getTranscriptDirectory()`. The split between the two methods means that reading can be reasoned about, tested, and overridden independently from path discovery.
- **`convertToLSL()`** — Translates the agent's native transcript representation into the canonical Live Session Log format. This is the format-normalization step that the rest of the pipeline depends on.
- **`getCurrentSession()`** — Identifies the currently active session for the agent, which is essential for live, in-progress transcript handling rather than purely historical replay.

Because these methods are abstract, the class itself is not instantiated directly. Concrete adapters extend `TranscriptAdapter` and supply implementations tailored to a specific agent's storage conventions and transcript schema. The framework discovers and invokes these implementations through the parent `TranscriptAdapterFramework`.

## Integration Points

The most immediate integration is with the parent `TranscriptAdapterFramework`, which contains `AbstractTranscriptAdapter` and is responsible for instantiating, registering, and dispatching to concrete adapter implementations. The framework relies on the stability of the five-method contract to remain agnostic to the specifics of any particular agent.

Downstream, the output of `convertToLSL()` flows into the `LiveLoggingSystem`, which consumes the canonical LSL format. This is the contract that justifies the existence of `convertToLSL()` as a first-class abstract method: without a guaranteed common format at the adapter boundary, the downstream logging system would need agent-specific branches.

The sibling `PollingCursorCycle` is the temporal driver that activates adapter methods. Its `watchTranscripts()` function, implemented in the same `transcript-api.js` file, uses `setInterval` to repeatedly trigger the ingestion cycle. Each tick effectively asks every registered adapter — via methods inherited from `AbstractTranscriptAdapter` — to surface new transcript content. The polling cadence is configurable, providing a direct lever for tuning end-to-end latency between transcript writes and LSL emission.

## Usage Guidelines

When integrating a new agent, developers should subclass `TranscriptAdapter` from `lib/agent-api/transcript-api.js` and implement all five abstract methods. Skipping or stubbing any of them undermines the framework's assumptions: `getAgentType()` is needed for adapter identity; `getTranscriptDirectory()` and `readTranscripts()` must remain logically separable so that path resolution and parsing can evolve independently; `convertToLSL()` must produce well-formed LSL that the `LiveLoggingSystem` can ingest without special-casing; and `getCurrentSession()` must accurately reflect the live session to support real-time use cases.

Adapter authors should avoid leaking agent-specific concerns past the `convertToLSL()` boundary. The canonical LSL format is the agreed contract with the rest of the system; introducing agent-specific fields or semantics into downstream consumers would erode the value of the abstraction. Similarly, `getTranscriptDirectory()` should not perform parsing or side effects — it is purely a path resolver, and conflating it with `readTranscripts()` defeats the deliberate decoupling the framework provides.

Finally, adapter implementations should be efficient at the granularity of the `PollingCursorCycle` tick. Because `watchTranscripts()` invokes the ingestion cycle on a recurring `setInterval`, any expensive work inside `readTranscripts()` or `convertToLSL()` is paid repeatedly. Incremental parsing strategies — reading only what has changed since the last cycle — are the natural fit for this polling-driven architecture.

---

### Summary

1. **Architectural patterns identified**: Plugin/strategy pattern via abstract base class; clear separation-of-concerns between path resolution, parsing, and format canonicalization; contract-driven extensibility paired with a separate polling driver (`PollingCursorCycle`).
2. **Design decisions and trade-offs**: Splitting `getTranscriptDirectory()` from `readTranscripts()` adds two methods to the contract but enables independent evolution; mandating `convertToLSL()` per adapter pushes integration cost to adapter authors but keeps downstream consumers uniform.
3. **System structure insights**: `AbstractTranscriptAdapter` is the *what*, `PollingCursorCycle` is the *when*, `TranscriptAdapterFramework` is the *how-orchestrated*, and `LiveLoggingSystem` is the downstream consumer of canonical LSL output.
4. **Scalability considerations**: Adding new agents scales linearly with adapter implementations; latency and throughput scale with the configurable `setInterval` tick in `PollingCursorCycle.watchTranscripts()`; incremental reads inside `readTranscripts()` are advisable to control per-tick cost.
5. **Maintainability assessment**: Strong — the five-method contract is small, focused, and well-bounded; the canonical LSL format insulates downstream code from agent diversity; concerns are cleanly partitioned across siblings and the parent framework, minimizing ripple effects when adding or modifying adapters.


## Hierarchy Context

### Parent
- [TranscriptAdapterFramework](./TranscriptAdapterFramework.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js declares five abstract methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession() — forming the mandatory interface for any new agent integration

### Siblings
- [PollingCursorCycle](./PollingCursorCycle.md) -- watchTranscripts() in transcript-api.js establishes a setInterval loop that drives the recurring transcript ingestion cycle, with tick frequency configurable to control latency between transcript writes and LSL emission.


---

*Generated from 3 observations*
