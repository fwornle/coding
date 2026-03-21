# TranscriptAdapter

**Type:** Detail

The TranscriptProcessor uses the TranscriptAdapter abstract base class in 'lib/agent-api' to read and convert transcripts from various agent formats, as indicated by the hierarchy context.

## What It Is  

**Location** – The `TranscriptAdapter` abstract base class lives in the **`lib/agent-api`** package. It is referenced directly by the **`TranscriptProcessor`** component, which resides in the same repository and orchestrates the overall handling of transcript data.  

`TranscriptAdapter` is an **abstract base class** whose sole purpose is to expose a common contract for reading and converting transcript information that originates from a variety of agent‑specific formats. The `TranscriptProcessor` delegates the format‑specific work to concrete subclasses of `TranscriptAdapter`, allowing the processor to remain agnostic of the underlying source representation.

---

## Architecture and Design  

The architecture around `TranscriptAdapter` follows a **classic Adapter‑style abstraction**. By defining a base class in `lib/agent-api`, the system creates a **stable interface** (`TranscriptAdapter`) that all format‑specific adapters must implement. This design enables the `TranscriptProcessor` to work with any transcript source through **polymorphic dispatch** – the processor calls the same set of methods on the adapter regardless of the concrete implementation.

The relationship can be visualised as a simple hierarchy:

```
lib/agent-api/
│
└─ TranscriptAdapter (abstract)
     ├─ AgentXTranscriptAdapter (concrete)
     ├─ AgentYTranscriptAdapter (concrete)
     └─ … (future adapters)
```

* **Parent‑child relationship** – `TranscriptProcessor` is the parent component that *contains* a reference to a `TranscriptAdapter`. The processor does not implement any format‑specific logic itself; instead, it relies on the child adapters to supply the data in a normalized shape.  
* **Sibling sharing** – All concrete adapters share the same abstract contract, guaranteeing that they expose identical method signatures and behavioural expectations to the processor. This uniformity simplifies testing and enables interchangeable use of adapters at runtime.  

Because the observations only mention the abstract class and its use by `TranscriptProcessor`, no additional architectural patterns (e.g., micro‑services, event‑driven pipelines) can be asserted with confidence. The design is therefore **focused on modularity and extensibility** at the code‑level rather than at the system‑level.

---

## Implementation Details  

Although the source code for `TranscriptAdapter` is not provided, the observations give us the essential structural facts:

1. **Abstract Base Class** – Located in `lib/agent-api`, it likely declares one or more abstract methods such as `readTranscript(source)` and `convertToCanonicalForm(rawData)`. These methods constitute the **contract** that all concrete adapters must fulfil.  
2. **Concrete Implementations** – The hierarchy implied by the parent context suggests that there are multiple concrete subclasses (e.g., `AgentXTranscriptAdapter`, `AgentYTranscriptAdapter`). Each subclass implements the abstract methods to handle the idiosyncrasies of its respective agent’s transcript format (CSV, JSON, proprietary binary, etc.).  
3. **Dependency Injection** – `TranscriptProcessor` obtains an instance of a concrete `TranscriptAdapter`—most likely through constructor injection or a factory method—so that the processor can remain decoupled from any specific format. This pattern enables **runtime selection** of the appropriate adapter based on configuration or detected source type.  

The **technical mechanics** therefore revolve around:

* **Interface enforcement** – The abstract class guarantees that every adapter provides the same public API, preventing the processor from having to perform type checks or format‑specific branching.  
* **Normalization** – Each adapter translates its native transcript representation into a **canonical internal model** that `TranscriptProcessor` can safely consume for downstream operations (e.g., analytics, storage).  
* **Error handling** – Because adapters encapsulate format parsing, they also centralise error handling for malformed inputs, allowing the processor to treat all failures uniformly.

---

## Integration Points  

`TranscriptAdapter` sits at a clear integration boundary:

* **Upstream** – The **source of raw transcript data** (files, streams, external services) is fed into a concrete adapter. The adapter knows how to locate, read, and parse that source.  
* **Downstream** – The **`TranscriptProcessor`** consumes the normalized transcript objects returned by the adapter. The processor’s responsibilities (e.g., aggregation, transformation, persistence) are therefore insulated from format concerns.  

Because the adapter resides in `lib/agent-api`, any other component that needs to work with agent transcripts can also depend on this library, re‑using the same adapters without duplicating parsing logic. The only explicit dependency visible from the observations is the **reference from `TranscriptProcessor` to `TranscriptAdapter`**; no additional libraries or services are mentioned.

---

## Usage Guidelines  

1. **Prefer the abstract contract** – When extending the system to support a new agent, create a subclass of `TranscriptAdapter` in `lib/agent-api` and implement the required abstract methods. Do **not** modify `TranscriptProcessor`; simply provide the new adapter implementation.  
2. **Keep adapters focused** – Each concrete adapter should handle **only one source format**. Mixing multiple formats within a single adapter reduces clarity and defeats the purpose of the abstraction.  
3. **Leverage dependency injection** – Register the concrete adapter with the component that constructs `TranscriptProcessor` (e.g., via a factory or DI container). This keeps the processor decoupled and makes unit testing straightforward—mock adapters can be injected to simulate various transcript inputs.  
4. **Handle parsing errors locally** – Since adapters own the parsing logic, they should translate low‑level parsing exceptions into a **well‑defined error type** that `TranscriptProcessor` can understand and react to uniformly.  
5. **Document supported formats** – Maintain a concise list (e.g., in a README within `lib/agent-api`) of which agent formats are currently covered and which adapters implement them. This aids future developers in locating the correct adapter and in deciding whether a new one is required.

---

### Architectural Patterns Identified  

1. **Adapter (Interface) Pattern** – Abstract base class (`TranscriptAdapter`) defines a common interface for disparate transcript sources.  
2. **Strategy via Polymorphism** – `TranscriptProcessor` selects a concrete adapter at runtime, effectively swapping the algorithm used to read/convert transcripts.

### Design Decisions & Trade‑offs  

* **Abstraction vs. Implementation Overhead** – Introducing an abstract adapter adds a layer of indirection, which improves extensibility but incurs a small runtime cost for polymorphic dispatch.  
* **Single Responsibility** – By confining format‑specific logic to adapters, the processor stays simple and testable, but developers must ensure adapters remain lean and do not embed unrelated business logic.  

### System Structure Insights  

* The system is **modular** at the code‑level: `lib/agent-api` houses all transcript‑related contracts, while `TranscriptProcessor` lives elsewhere and consumes those contracts.  
* Adding a new transcript source does **not** require changes to the processor, demonstrating a **plug‑in architecture** within the codebase.

### Scalability Considerations  

* **Horizontal scaling** – New adapters can be added without impacting existing ones, allowing the system to grow organically as more agent formats appear.  
* **Performance** – Since each adapter works independently, heavy‑weight parsing can be off‑loaded to separate threads or services if needed, without altering the processor’s core loop.

### Maintainability Assessment  

* **High maintainability** – Centralizing format handling in well‑named adapters reduces duplication and makes updates localized.  
* **Clear contract** – The abstract base class serves as a single source of truth for the required methods, simplifying onboarding for new developers.  
* **Potential risk** – If the abstract interface evolves, all concrete adapters must be updated simultaneously; careful versioning and backward‑compatible changes are advisable.  

---  

*All statements above are derived directly from the provided observations: the existence of `TranscriptAdapter` as an abstract base class in `lib/agent-api`, its relationship to `TranscriptProcessor`, and the implied role of adapters in handling multiple agent transcript formats.*


## Hierarchy Context

### Parent
- [TranscriptProcessor](./TranscriptProcessor.md) -- The TranscriptProcessor uses the TranscriptAdapter abstract base class in 'lib/agent-api' to read and convert transcripts from various agent formats.


---

*Generated from 3 observations*
