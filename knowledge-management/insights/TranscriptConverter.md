# TranscriptConverter

**Type:** Detail

The TranscriptManager sub-component uses the TranscriptAdapter class in lib/agent-api/transcript-api.js to convert between different transcript formats, indicating a design decision to leverage adapters for format compatibility.

## What It Is  

`TranscriptConverter` lives inside the **TranscriptManager** sub‑component and its concrete work is delegated to the **TranscriptAdapter** class found at `lib/agent-api/transcript-api.js`.  The manager calls the adapter to translate a raw transcript into the internal representation required by the rest of the system, and likewise to emit a transcript in a format expected by external consumers.  By centralising the conversion logic in a dedicated adapter, the codebase isolates format‑specific concerns from the higher‑level business logic that lives in `TranscriptManager`.  The naming hierarchy—*TranscriptManager → TranscriptConverter → TranscriptAdapter*—makes it clear that the manager owns a converter, and the converter relies on an adapter that implements a well‑defined interface for format handling.

## Architecture and Design  

The observations point directly to an **Adapter** architectural pattern.  `TranscriptAdapter` acts as a thin façade that presents a uniform API (the “adapter interface”) to `TranscriptConverter` while hiding the details of each transcript format (e.g., JSON, CSV, proprietary logs).  Because the adapter is defined as an **interface**, the system also embraces an **Interface‑Based Design** that standardises the contract for any future format‑specific implementation.  This combination enables a **Strategy‑like** approach: each concrete adapter encapsulates a distinct conversion algorithm, and swapping one for another does not ripple changes through the manager or other consumers.

Interaction flow is straightforward: `TranscriptManager` invokes a method on its `TranscriptConverter`, which in turn delegates to the injected `TranscriptAdapter`.  The adapter returns a canonical transcript object that the manager can process further.  The design therefore separates concerns cleanly—*manager* handles orchestration, *converter* handles request routing, and *adapter* handles the nitty‑gritty of parsing and serialising.

## Implementation Details  

- **File location:** All conversion‑related code resides in `lib/agent-api/transcript-api.js`.  The file exports the `TranscriptAdapter` class (or interface) that defines at least one method such as `convert(rawTranscript)` (the exact signature is not enumerated in the observations but is implied by the “methods for converting transcripts” comment).  
- **Interface contract:** The adapter interface declares the operations any concrete format handler must provide.  This contract guarantees that `TranscriptConverter` can call the same method regardless of the underlying format.  
- **Encapsulation:** By wrapping format‑specific parsing logic inside a concrete implementation of `TranscriptAdapter`, the system avoids scattering conditional branches (e.g., `if (type === 'json') …`) throughout `TranscriptManager`.  Adding a new format simply means creating a new class that implements the adapter interface and registering it with the converter.  
- **Dependency direction:** `TranscriptManager` → `TranscriptConverter` → `TranscriptAdapter`.  The manager does not know the details of the adapter; it only knows that a converter exists.  The converter, in turn, holds a reference to an adapter instance that satisfies the interface.

## Integration Points  

`TranscriptConverter` is a child of **TranscriptManager**, so any component that interacts with the manager (e.g., the agent orchestration layer, logging services, or external APIs) indirectly depends on the conversion capability.  The adapter itself is the only outward‑facing contract for format handling; therefore, any external module that wishes to supply a new transcript format must implement the `TranscriptAdapter` interface and be injected into the converter.  Because the adapter lives in `lib/agent-api/transcript-api.js`, other agent‑API modules can import it without pulling in the full manager, facilitating reuse in contexts where only format translation is needed (e.g., batch processing scripts).

## Usage Guidelines  

1. **Prefer the manager’s public API** – callers should request transcript conversion through `TranscriptManager` rather than invoking the adapter directly.  This ensures that any future orchestration steps (validation, enrichment, audit logging) remain enforced.  
2. **Implement the adapter interface for new formats** – when a new transcript source appears, create a class in `lib/agent-api/transcript-api.js` (or a sibling file) that implements the same method signatures defined by `TranscriptAdapter`.  Register the new class with `TranscriptConverter` so the manager can discover it automatically.  
3. **Keep conversion logic pure** – adapters should avoid side effects such as network I/O or database writes; they should focus solely on translating data structures.  This makes them easier to test and swap.  
4. **Version the adapter contract** – if the interface evolves (e.g., adding a `metadata` field), bump the version and provide backward‑compatible adapters to avoid breaking existing manager code.  

---

### Architectural Patterns Identified  
1. **Adapter Pattern** – `TranscriptAdapter` normalises disparate transcript formats.  
2. **Interface‑Based Design** – a shared contract defines required conversion methods.  
3. **Strategy‑Like Encapsulation** – each concrete adapter encapsulates a distinct conversion algorithm.

### Design Decisions and Trade‑offs  
- **Decision:** Centralise format conversion behind an adapter.  
  **Trade‑off:** Introduces an extra indirection layer, but greatly improves extensibility and isolates format‑specific bugs.  
- **Decision:** Use an interface to enforce a uniform API.  
  **Trade‑off:** Requires disciplined implementation of the contract; however, it prevents runtime errors caused by missing methods.  

### System Structure Insights  
The hierarchy (`TranscriptManager → TranscriptConverter → TranscriptAdapter`) reflects a clean separation of orchestration, routing, and low‑level transformation responsibilities.  The adapter lives in a shared library (`lib/agent-api`) making it reusable across any component that needs transcript handling, while the manager remains the authoritative entry point for business‑level operations.

### Scalability Considerations  
Because each format is handled by an independent adapter, scaling the system to support many formats does not increase the complexity of the manager or converter.  Adding a new format is a O(1) operation: implement the adapter and register it.  The design also lends itself to parallelisation—multiple adapters can run concurrently on separate transcript streams without contention, as they share no mutable state.

### Maintainability Assessment  
The adapter‑centric approach yields high maintainability.  Bugs are isolated to the specific adapter that handles a given format, and unit tests can target each adapter in isolation.  The explicit interface acts as living documentation, reducing the cognitive load for new developers.  The only maintenance overhead is ensuring that the adapter contract remains stable; versioning the interface mitigates breaking changes.


## Hierarchy Context

### Parent
- [TranscriptManager](./TranscriptManager.md) -- TranscriptManager uses the TranscriptAdapter class in lib/agent-api/transcript-api.js to convert between different transcript formats.


---

*Generated from 3 observations*
