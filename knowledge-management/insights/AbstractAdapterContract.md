# AbstractAdapterContract

**Type:** Detail

TranscriptAdapter in lib/agent-api/transcript-api.js defines these five methods as the sole extension point for adding new agent integrations, meaning any new agent (e.g., Claude Code, Copilot CLI) must provide concrete implementations of all five.

# AbstractAdapterContract

## What It Is

The `AbstractAdapterContract` is the formal interface contract defined within `TranscriptAdapter` in `lib/agent-api/transcript-api.js`. It is composed of five abstract methods — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, and `getCurrentSession()` — that collectively establish the mandatory surface area every concrete agent integration must satisfy. Rather than being a standalone class, this contract exists as the abstract portion of its parent component `TranscriptAdapterBase`, serving as the sole, well-defined extension point through which new agent backends (such as Claude Code, Copilot CLI, or future agent integrations) can be wired into the broader LiveLoggingSystem.

In effect, the contract codifies the minimum behavioral commitment of any adapter: it must declare its identity, locate its persistent transcript storage, read those transcripts from disk, normalize them into a shared representation, and report on the currently active session. Any class that intends to plug into the agent-api layer must provide concrete implementations of all five methods — no partial conformance is permitted by design.

## Architecture and Design

The architectural approach is a classic **Template Method / Abstract Adapter** pattern realized in JavaScript. The parent `TranscriptAdapterBase` provides the shared scaffolding and invariant behavior, while `AbstractAdapterContract` carves out the variant surface — the five methods whose implementations differ per agent. This separation creates a clean polymorphism boundary: the rest of the LiveLoggingSystem depends only on the contract, never on the specifics of any particular agent's transcript format or storage layout.

A deliberate design decision is visible in how responsibilities are partitioned within the five methods. `getTranscriptDirectory()` and `readTranscripts()` are kept as **distinct** abstract methods rather than collapsed into a single "load everything" call. This split implies adapters should cleanly separate **path resolution** (where transcripts live on disk for this agent) from **I/O and parsing** (how to actually read and structure them). This separation enables independent reasoning, testing, and overriding — for example, a test harness can stub the directory path without replacing the read logic, and vice versa.

The presence of `convertToLSL()` as a mandatory abstract method enforces a strict **normalization-at-the-edge** architecture. Each adapter is solely responsible for translating its agent-specific transcript format into the common **LSL (Live Session Log)** structure consumed downstream. This means the LiveLoggingSystem core remains format-agnostic; all heterogeneity is absorbed at the adapter boundary. The contract thus functions as both a structural interface and a semantic guarantee about data shape flowing out of the adapter layer.

## Implementation Details

The contract is declared inside `TranscriptAdapter` in `lib/agent-api/transcript-api.js`. The five abstract methods serve the following technical roles:

- **`getAgentType()`** — Returns the adapter's identity (e.g., a string discriminator). This is used by registries or factories to route requests to the correct adapter and to tag emitted LSL records with their origin.
- **`getTranscriptDirectory()`** — Resolves the filesystem location where this agent persists its transcript artifacts. The fact that this is an abstract method confirms each agent has its own storage layout, and the adapter encapsulates that knowledge.
- **`readTranscripts()`** — Reads raw transcript content from the directory resolved above. Keeping this distinct from path resolution means adapters can implement agent-specific file traversal, parsing, and decoding logic without entangling it with location discovery.
- **`convertToLSL()`** — Performs the normalization step that transforms the raw agent-specific transcript into the canonical LSL structure. This is where format divergence between agents is reconciled into the shared representation.
- **`getCurrentSession()`** — Reports the adapter's view of the currently active session, enabling live tailing or session-scoped <USER_ID_REDACTED> against the agent's ongoing activity.

Because the contract is purely abstract, the base class itself does not provide working implementations; concrete subclasses must override all five. Conformance is enforced by convention and runtime expectation rather than by static typing, which is typical for this style of JavaScript abstract-base-class pattern.

## Integration Points

The contract sits at the seam between the LiveLoggingSystem and the diverse universe of agent backends. Upstream, the system invokes adapters polymorphically through these five methods — it knows nothing about the specific agent on the other side. Downstream, the contract is the only API surface that concrete adapter subclasses must satisfy to participate in the system.

The most significant integration point is the LSL normalization channel: `convertToLSL()` is the contractual handshake that bridges agent-specific data into the shared session log structure consumed by the rest of the LiveLoggingSystem. Anything that reads, displays, persists, or analyzes session logs downstream relies on the guarantee that every adapter emits valid LSL via this method.

Sibling abstract methods within the same contract — `getTranscriptDirectory()` and `readTranscripts()` — typically integrate with the host filesystem and the agent's on-disk storage conventions. Meanwhile, `getAgentType()` and `getCurrentSession()` integrate with higher-level orchestration: routing, registry lookup, live session tracking, and any UI or API surface that needs to identify or follow a specific agent's activity.

## Usage Guidelines

When adding a new agent integration (for example, a Claude Code or Copilot CLI adapter), developers must implement **all five** methods declared by `AbstractAdapterContract`. Partial implementations break the polymorphism guarantee and will fail at the points where the LiveLoggingSystem invokes the missing behavior. The contract is intentionally minimal — five methods, no more — so the cost of adding a new adapter is bounded and well-understood.

Respect the deliberate separation between `getTranscriptDirectory()` and `readTranscripts()`. Do not collapse them by hardcoding paths inside the read method; keeping them distinct preserves the ability to test, mock, and override path resolution independently of I/O. Similarly, treat `convertToLSL()` as a pure transformation step — it should consume what `readTranscripts()` produces and emit valid LSL without performing additional I/O or side effects beyond normalization.

`getAgentType()` should return a stable, unique identifier for the adapter; downstream routing and tagging depend on it being deterministic. `getCurrentSession()` should reflect the live state of the agent — adapters that cannot determine a current session must document and handle that case explicitly rather than fabricating a value.

Finally, because `AbstractAdapterContract` is the single extension point declared by `TranscriptAdapterBase`, all agent-specific complexity should be contained within concrete implementations of these five methods. Resist the temptation to add new abstract methods to the base or to bypass the contract by exposing agent specifics elsewhere in the codebase — doing so erodes the format-agnostic guarantee that the rest of the LiveLoggingSystem relies upon.

---

### Summary of Key Insights

1. **Architectural patterns identified:** Abstract Adapter / Template Method pattern; normalization-at-the-edge; single, minimal extension-point design.
2. **Design decisions and trade-offs:** Splitting path resolution from reading (greater testability vs. slightly more methods to implement); mandating LSL conversion in every adapter (uniform downstream consumption vs. per-adapter implementation cost); enforcing all-or-nothing conformance (clear contract vs. no graceful degradation).
3. **System structure insights:** The contract is the only seam between heterogeneous agent backends and the LiveLoggingSystem core, making it the architectural pivot for the entire agent-api layer.
4. **Scalability considerations:** Adding new agents scales linearly with implementation of the five methods; the core system requires no modification, supporting open-ended growth of supported agents without central churn.
5. **Maintainability assessment:** High — the contract is small, explicit, and located in a single file (`lib/agent-api/transcript-api.js`). Changes to one adapter cannot leak into others, and the LSL normalization boundary insulates downstream code from agent format drift.


## Hierarchy Context

### Parent
- [TranscriptAdapterBase](./TranscriptAdapterBase.md) -- TranscriptAdapter in lib/agent-api/transcript-api.js declares five abstract methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), and getCurrentSession() — that every concrete adapter must implement, providing a single extension point for adding new agent integrations


---

*Generated from 3 observations*
