# TranscriptAdapterFactory

**Type:** Detail

The use of a factory pattern in TranscriptAdapterFactory enables loose coupling between the adapter and the specific reader implementations, making it easier to maintain and extend the codebase.

## What It Is  

The **`TranscriptAdapterFactory`** is a dedicated factory class whose sole responsibility is to instantiate the appropriate *transcript reader* for a given agent format.  It lives inside the **`TranscriptAdapter`** component – the parent that coordinates the overall transcript‑handling workflow.  Although the source repository does not expose an explicit file path in the supplied observations, the class name itself is the primary identifier we rely on.  The factory is deliberately thin: it receives a format identifier (e.g., *JSON*, *XML*, *plain‑text*) and returns an implementation of the **`TranscriptReader`** interface that knows how to parse that format.  By encapsulating the creation logic here, the surrounding system can request a reader without needing to know which concrete class will be used.

## Architecture and Design  

The design of `TranscriptAdapterFactory` is anchored in two classic object‑oriented patterns:

1. **Factory Method / Simple Factory** – The class exposes a single method (often called `createReader` or similar) that decides, at runtime, which concrete `TranscriptReader` to instantiate.  This centralises object creation and isolates the decision logic from callers, satisfying the *Open/Closed Principle*: new formats can be added by introducing a new `TranscriptReader` subclass and extending the factory’s selection logic, without touching existing client code.

2. **Strategy Pattern** – Each concrete `TranscriptReader` embodies a distinct parsing strategy for a specific agent format.  The factory acts as the *strategy selector*, handing the appropriate strategy object to the `TranscriptAdapter`.  This enables the adapter to operate against a uniform `TranscriptReader` interface while delegating the format‑specific details to the selected strategy.

The interaction flow is straightforward: `TranscriptAdapter` asks the factory for a reader based on the incoming transcript’s declared format; the factory evaluates the format (using a simple conditional or a registration map) and returns the matching `TranscriptReader`.  The adapter then invokes the reader’s common methods (e.g., `read()`, `parse()`) without caring about the underlying representation.  This loose coupling also aligns `TranscriptAdapterFactory` with its sibling components—`TranscriptReader` (the family of concrete readers) and `TranscriptConverter` (which consumes the unified transcript model produced by the readers).  Together they form a pipeline: **Factory → Reader → Converter**.

## Implementation Details  

Even though the repository snapshot does not expose concrete source files, the observations give us the essential mechanics:

* **Factory Method** – The factory likely defines a method such as `public TranscriptReader getReader(String format)`.  Inside, a **selection block** (if/else chain, switch statement, or a map of format strings to constructor references) determines which concrete reader class to instantiate.  For example, a `"json"` key would yield `new JsonTranscriptReader()`, an `"xml"` key would produce `new XmlTranscriptReader()`, and a `"txt"` key would return `new PlainTextTranscriptReader()`.

* **Loose Coupling** – The factory returns the result as the abstract `TranscriptReader` type.  This ensures that callers (the `TranscriptAdapter`) depend only on the interface, not on any concrete implementation.  Adding a new format therefore involves two steps: (1) implement a new `TranscriptReader` subclass that adheres to the existing interface, and (2) register the new format in the factory’s selection logic.  No existing client code needs to be altered.

* **Strategy Encapsulation** – Each `TranscriptReader` encapsulates all parsing logic for its format.  They may internally use format‑specific parsers (e.g., a JSON library for `JsonTranscriptReader`, an XML DOM/SAX parser for `XmlTranscriptReader`, or simple line‑by‑line processing for `PlainTextTranscriptReader`).  Because the factory abstracts away the creation, the `TranscriptAdapter` can treat all readers uniformly.

* **Extensibility Hooks** – While not explicitly mentioned, a common extension point is a **registration API** (`registerReader(String format, Supplier<TranscriptReader>)`) that lets external modules plug in additional readers without modifying the factory’s source.  This would preserve the factory’s open nature while keeping the core code unchanged.

## Integration Points  

`TranscriptAdapterFactory` sits at the nexus of three major components:

1. **Parent – `TranscriptAdapter`** – The adapter orchestrates the end‑to‑end transcript processing.  Its first step is to request a reader from the factory based on the incoming transcript’s metadata.  The adapter then delegates parsing to the returned `TranscriptReader` and subsequently passes the parsed transcript to the **`TranscriptConverter`** for normalization.

2. **Sibling – `TranscriptReader`** – All concrete readers implement a common contract (e.g., `TranscriptReader.read(InputStream)`), enabling the factory to return any of them interchangeably.  The factory’s responsibility is solely to map a format identifier to the correct reader implementation.

3. **Sibling – `TranscriptConverter`** – After a reader produces a transcript object in its native representation, the converter maps that object onto a unified internal model.  Because the factory guarantees that the reader adheres to the expected interface, the converter can operate without format‑specific conditionals.

External modules that produce transcripts (e.g., ingestion services, API endpoints) interact with the system through the `TranscriptAdapter`.  They supply the raw transcript data and a format hint, which flows through the factory‑reader‑converter pipeline.  No direct dependencies on concrete readers are exposed beyond the factory, preserving a clean public API.

## Usage Guidelines  

* **Always go through the factory.**  When a component needs to read a transcript, it should request a `TranscriptReader` from `TranscriptAdapterFactory` rather than instantiating a concrete reader directly.  This guarantees that the selected reader is the one registered for the supplied format and keeps the codebase aligned with the Open/Closed principle.

* **Register new formats centrally.**  If a new agent format must be supported, implement a new `TranscriptReader` subclass that conforms to the existing interface, then add the format‑to‑reader mapping inside the factory (or via a registration API if one exists).  Do not modify existing reader implementations; they remain stable and tested.

* **Prefer immutable format identifiers.**  Pass format strings or enum values that are well‑defined and documented (e.g., `Format.JSON`, `Format.XML`).  This reduces the risk of misspelling and makes the factory’s selection logic deterministic.

* **Handle unsupported formats gracefully.**  The factory should throw a clear, domain‑specific exception (e.g., `UnsupportedTranscriptFormatException`) when a format is not recognised.  Callers can catch this exception to provide user‑friendly error messages or fallback behaviour.

* **Keep readers focused on parsing only.**  Business‑level transformations belong in `TranscriptConverter`.  Readers should limit themselves to converting raw input into a structured transcript object; any enrichment, validation, or mapping should be delegated downstream.

---

### Summary of Key Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns** | Factory Method (object creation) and Strategy (format‑specific parsing) |
| **Design decisions** | Centralised reader creation for extensibility; loose coupling via the `TranscriptReader` interface |
| **Trade‑offs** | Adding a new format requires a factory update (or registration hook) but avoids widespread code changes; runtime selection adds minimal overhead |
| **System structure** | `TranscriptAdapter` → **`TranscriptAdapterFactory`** → `TranscriptReader` (strategy) → `TranscriptConverter` (normalisation) |
| **Scalability** | New formats scale linearly – each new format adds one reader class and a factory entry, without impacting existing readers |
| **Maintainability** | High, due to isolated responsibilities and adherence to SOLID principles; unit‑testing can target the factory’s mapping logic separately from each reader’s parsing logic |

These observations collectively illustrate that `TranscriptAdapterFactory` is a purpose‑built, pattern‑driven component that enables the transcript processing subsystem to stay modular, extensible, and easy to maintain.


## Hierarchy Context

### Parent
- [TranscriptAdapter](./TranscriptAdapter.md) -- TranscriptAdapter uses a factory pattern to create transcript readers for different agent formats, as seen in the TranscriptAdapterFactory class

### Siblings
- [TranscriptReader](./TranscriptReader.md) -- The TranscriptReader is designed to work with various agent formats, providing a common interface for reading transcripts regardless of the underlying format.
- [TranscriptConverter](./TranscriptConverter.md) -- The TranscriptConverter uses a mapping approach to convert transcripts from various formats to a unified format, ensuring consistency and compatibility across the system.


---

*Generated from 3 observations*
