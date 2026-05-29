# TranscriptAdapterRegistry

**Type:** SubComponent

The TranscriptAdapter abstract class in `lib/agent-api/transcript-api.js` enforces five mandatory methods — `getAgentType()`, `getTranscriptDirectory()`, `readTranscripts()`, `convertToLSL()`, `getCurrentSession()` — forming a strict interface contract all agent adapters must satisfy

# TranscriptAdapterRegistry — Technical Insight Document

## What It Is

TranscriptAdapterRegistry is a SubComponent of LiveLoggingSystem, responsible for managing the collection of agent-specific transcript adapters that feed data into the unified LSL pipeline. Its canonical interface contract is defined in `lib/agent-api/transcript-api.js`, where the `TranscriptAdapter` abstract class establishes the mandatory shape every adapter must satisfy. The registry is architecturally significant enough to warrant two dedicated documentation artifacts: `docs/architecture/agent-abstraction-api.md` (interface reference) and `docs/architecture/adding-new-agent.md` (extension guide), signaling that this is the system's primary designed extension point for onboarding new AI agent sources.

The registry's child component, TranscriptAdapterContract, encapsulates the five-method interface enforced by `lib/agent-api/transcript-api.js`. Within LiveLoggingSystem, TranscriptAdapterRegistry operates alongside sibling components SessionWindowManager and RedactionEngine, each owning a distinct cross-cutting concern over the data flowing through the pipeline.

![TranscriptAdapterRegistry — Architecture](images/transcript-adapter-registry-architecture.png)

---

## Architecture and Design

The central architectural decision is an **adapter pattern** applied to agent-native transcript formats. Each agent (Claude, Copilot, and prospective agents like Cursor or Gemini CLI) stores transcripts in its own filesystem layout and proprietary format. TranscriptAdapterRegistry provides a uniform seam between that heterogeneity and the downstream LSL pipeline, which need not be aware of agent-specific concerns. The contract enforced through TranscriptAdapterContract ensures that any conforming adapter is fully substitutable from the pipeline's perspective.

A key design trade-off is the deliberate placement of several cross-cutting responsibilities inside the adapter layer itself rather than centralizing them. Specifically, `getTranscriptDirectory()` keeps filesystem path logic encapsulated per adapter rather than in a shared path resolver, and the adapter is responsible for populating the `timeWindow` field on `LSLMetadata` (formatted as e.g. `'0800-0900'`). This means hourly-bucketing logic — which drives file routing downstream and directly interfaces with what SessionWindowManager consumes — is owned at ingestion time by each adapter. The trade-off is tighter cohesion per adapter at the cost of distributing window-computation logic across implementations.

`getAgentType()` returning a string identifier such as `'claude'` or `'copilot'` functions as a self-describing key. This is a lightweight identity mechanism that avoids a central type enum, keeping each adapter self-contained while still allowing downstream components to tag, route, or filter LSL output by source agent.

![TranscriptAdapterRegistry — Relationship](images/transcript-adapter-registry-relationship.png)

---

## Implementation Details

The TranscriptAdapterContract, as defined in `lib/agent-api/transcript-api.js`, mandates five methods:

- **`getAgentType()`** — Returns a string identifier for the agent (e.g., `'claude'`, `'copilot'`). Acts as the adapter's self-describing key throughout the pipeline.
- **`getTranscriptDirectory()`** — Returns the filesystem path where the agent's native transcripts reside, encapsulating per-agent storage layout differences entirely within the adapter.
- **`readTranscripts()`** — Reads raw agent-native files from the directory resolved above.
- **`convertToLSL()`** — Transforms raw agent data into the unified `LSLSession`/`LSLEntry` format. This is where agent-specific schema differences are normalized. The adapter must also populate `LSLMetadata.timeWindow` here, making window bucketing an adapter-layer concern.
- **`getCurrentSession()`** — Returns the active session for live ingestion, supporting the real-time logging use case within LiveLoggingSystem.

The strict enforcement of all five methods means partial implementations are structurally invalid. There is no optional method surface — every adapter, regardless of the agent's simplicity, must provide all five behaviors. This keeps the downstream pipeline's assumptions unconditional.

---

## Integration Points

**With LiveLoggingSystem (parent):** TranscriptAdapterRegistry is the entry gate through which agent data enters LiveLoggingSystem. The registry's adapters produce `LSLSession`/`LSLEntry` objects and populated `LSLMetadata` that the rest of the system consumes.

**With SessionWindowManager (sibling):** The `timeWindow` field on `LSLMetadata` is computed and populated by each adapter during `convertToLSL()`. SessionWindowManager consumes this field downstream, meaning the correctness of window-based routing is a direct dependency on adapter-layer implementation accuracy. There is an implicit coupling here: changes to the `timeWindow` format or bucketing semantics would require coordinated updates across all adapter implementations and SessionWindowManager.

**With RedactionEngine (sibling):** RedactionEngine operates on LSL output after adapters have produced it, using `.specstory/config/redaction-config.yaml` as its pattern registry. Adapters do not interact with redaction configuration directly — the separation means adapters produce full-fidelity LSL data and redaction is applied as a subsequent, independent concern.

**With TranscriptAdapterContract (child):** The contract is the structural core of the registry. Every adapter registered must fully satisfy the five-method interface in `lib/agent-api/transcript-api.js`. The registry's value is entirely contingent on the integrity of this contract.

---

## Usage Guidelines

**Adding a new agent adapter** is documented in `docs/architecture/adding-new-agent.md` and follows a clear procedure: implement a subclass of `TranscriptAdapter` satisfying all five methods of TranscriptAdapterContract, then register it with TranscriptAdapterRegistry. No downstream pipeline code requires modification — this is the explicit guarantee of the adapter pattern as applied here.

When implementing `convertToLSL()`, developers must correctly compute and assign `LSLMetadata.timeWindow` in the format `'HHMM-HHMM'` (e.g., `'0800-0900'`). Errors here will silently propagate into incorrect file routing downstream via SessionWindowManager, making this the highest-risk implementation detail in a new adapter.

`getAgentType()` return values should be treated as stable identifiers. Since downstream components may use these strings for tagging or routing, changing an existing adapter's return value is a breaking change to any consumer that keys off agent type.

Developers should consult `docs/architecture/agent-abstraction-api.md` as the authoritative interface reference before implementing a new adapter, and validate that all five contract methods are fully implemented — partial implementations are not architecturally supported and will violate the registry's substitutability guarantee.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The TranscriptAdapter abstract class in `lib/agent-api/transcript-api.js` enforces a strict interface contract that all agent-specific adapters must satisfy. Subclasses must implement five methods: `getAgentType()` (returns a string identifier like 'claude' or 'copilot'), `getTranscriptDirectory()` (returns the filesystem path where native transcripts are stored), `readTranscripts()` (reads raw agent-native files), `convertToLSL()` (transforms them into the unified LSLSession/LSLEntry format), and `getCurrentSession()` (returns the active session for live ingestion). This adapter pattern means that adding a new agent source — say, a Cursor or Gemini CLI — requires only implementing this interface without touching any downstream pipeline code. The LSLMetadata type includes a `timeWindow` field (formatted as e.g. '0800-0900') that the adapter is responsible for populating, meaning the adapter layer also owns the hourly-bucketing logic that drives file routing downstream.

### Children
- [TranscriptAdapterContract](./TranscriptAdapterContract.md) -- The five mandatory methods — getAgentType(), getTranscriptDirectory(), readTranscripts(), convertToLSL(), getCurrentSession() — are defined in lib/agent-api/transcript-api.js as the canonical interface all adapters must satisfy

### Siblings
- [SessionWindowManager](./SessionWindowManager.md) -- The LSLMetadata type defined in the transcript pipeline includes a `timeWindow` field (formatted as e.g. '0800-0900'), and the TranscriptAdapter contract in `lib/agent-api/transcript-api.js` assigns responsibility for populating this field to the adapter layer, meaning window computation happens at ingestion time
- [RedactionEngine](./RedactionEngine.md) -- RedactionEngine is configured via `.specstory/config/redaction-config.yaml`, which acts as the authoritative pattern registry for what constitutes sensitive data across all agent adapters


---

*Generated from 5 observations*
