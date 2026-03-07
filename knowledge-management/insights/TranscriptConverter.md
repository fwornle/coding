# TranscriptConverter

**Type:** Detail

The TranscriptConverter uses a mapping approach to convert transcripts from various formats to a unified format, ensuring consistency and compatibility across the system.

## What It Is  

The **TranscriptConverter** is the component responsible for turning raw transcript data—produced by a variety of agent‑specific readers—into a single, unified representation that the rest of the system can consume.  It lives inside the **TranscriptAdapter** package (the exact file path is not disclosed in the observations, but the component is referenced as a member of `TranscriptAdapter`).  Its core responsibility is to apply a **mapping table** that describes how fields from each source format correspond to the canonical transcript schema.  Because the mapping is data‑driven, adding support for a new source format does not require changes to the conversion algorithm itself; developers only need to supply a new set of mapping rules.

The converter is invoked by the **TranscriptAdapterFactory** after a **TranscriptReader** has read a raw transcript.  The factory orchestrates the flow: it selects the appropriate reader for the incoming format, obtains the raw transcript, and then hands that payload to the `TranscriptConverter` so that the downstream pipeline receives a normalized object.

---

## Architecture and Design  

The observations reveal two explicit architectural choices:

1. **Factory Pattern** – The `TranscriptAdapterFactory` encapsulates the creation of `TranscriptReader` instances and the subsequent hand‑off to `TranscriptConverter`.  By centralising object creation, the factory makes it straightforward to introduce new reader implementations (for new agent formats) without touching the conversion logic.  This aligns with the classic *Factory Method* pattern, where the factory decides which concrete reader to instantiate based on the input format.

2. **Mapping‑Driven Conversion** – The `TranscriptConverter` itself follows a **configuration‑driven** or **data‑mapping** approach.  Rather than hard‑coding conversion code for each source format, it stores a set of *mapping rules* (likely key‑value pairs or a small DSL) that describe how source fields map onto the unified transcript model.  When a new format appears, developers add a new rule set; the conversion engine remains unchanged.  This design resembles a lightweight *Strategy* where each rule set can be seen as a strategy for a particular format, but the strategy is expressed declaratively rather than through separate classes.

Interaction flow:

```
Client → TranscriptAdapterFactory
          ├─ selects appropriate TranscriptReader
          └─ reads raw transcript
               ↓
          TranscriptConverter.applyMapping(raw) → UnifiedTranscript
               ↓
          TranscriptAdapter (uses the unified transcript)
```

The `TranscriptAdapter` acts as the parent component that aggregates the converter (and, indirectly, the reader) to present a consistent API to callers.  The sibling components—`TranscriptAdapterFactory` and `TranscriptReader`—share the same overarching goal of format‑agnostic handling, but each occupies a distinct layer: factory for orchestration, reader for I/O, converter for data transformation.

---

## Implementation Details  

Although no concrete code symbols were listed, the observations give us the essential building blocks:

* **Mapping Repository** – The converter likely maintains a collection (e.g., a `Map<String, MappingRule>` or a JSON/YAML file) where each key identifies a source format and the value holds the field‑to‑field translation table.  This repository is the only place that must be extended when supporting a new format.

* **Conversion Engine** – The `TranscriptConverter` exposes a method (conceptually `convert(rawTranscript, formatId)`) that looks up the appropriate rule set, iterates over the source fields, and populates a `UnifiedTranscript` object.  Because the algorithm is generic, it can handle any number of source fields as long as the mapping is defined.

* **Error Handling** – When a mapping rule is missing or a required source field is absent, the converter probably raises a domain‑specific exception (e.g., `MappingNotFoundException` or `InvalidTranscriptException`).  This keeps the failure mode explicit for the calling `TranscriptAdapter`.

* **Extensibility Hook** – Adding a new format does not involve subclassing `TranscriptConverter`; instead, a developer adds a new entry to the mapping repository (e.g., `agentXMapping.json`).  The factory does not need to be altered because it already delegates conversion to the same `TranscriptConverter` instance.

* **Dependency Injection** – In a typical implementation, `TranscriptAdapterFactory` would receive the `TranscriptConverter` (and possibly the mapping repository) via constructor injection, allowing unit tests to replace them with mocks.

---

## Integration Points  

* **TranscriptAdapterFactory** – The factory is the primary consumer of `TranscriptConverter`.  After a `TranscriptReader` produces a raw transcript, the factory calls the converter to obtain the normalized object before returning it to the caller or passing it downstream.

* **TranscriptReader** – Readers are format‑specific parsers that expose a common interface (e.g., `read(InputStream) → RawTranscript`).  The output of any reader is fed directly into the converter, meaning the converter must be tolerant of varying field names and data types as described by the mapping rules.

* **TranscriptAdapter** – As the parent component, `TranscriptAdapter` holds a reference to the converter (and indirectly to the factory).  It provides the public API that other system parts use, abstracting away the details of reading and conversion.

* **Configuration Layer** – The mapping rules themselves constitute an integration point with external configuration files or a database.  Changes to these files are the only required steps to extend format support, meaning the system can be re‑configured without recompilation.

* **Error Propagation** – Exceptions raised by the converter propagate up through the factory to the adapter, allowing higher‑level error handling (logging, fallback mechanisms) to be centralised.

---

## Usage Guidelines  

1. **Never modify the conversion algorithm** – When a new transcript format must be supported, create or update the appropriate mapping rule set rather than altering the `TranscriptConverter` code.  This preserves the stability of the conversion engine.

2. **Keep mapping rules declarative and version‑controlled** – Store each format’s mapping in a separate, self‑contained file (e.g., `format‑X‑mapping.yaml`).  Commit these files to source control so that changes are auditable and can be rolled back if a mapping proves incorrect.

3. **Validate mappings early** – Before deploying a new rule set, run unit tests that feed representative raw transcripts through the converter and assert that the resulting `UnifiedTranscript` matches expectations.  This guards against silent data loss due to missing or mis‑typed fields.

4. **Leverage the factory for new readers** – If a completely new source format requires a custom parsing step, implement a new `TranscriptReader` subclass and register it with `TranscriptAdapterFactory`.  The factory will automatically route the raw output to the existing converter.

5. **Handle conversion failures explicitly** – Catch the converter’s domain exceptions at the factory or adapter level and translate them into user‑friendly error messages or retry logic as appropriate.  Do not let unchecked exceptions leak into higher layers.

---

### Architectural Patterns Identified  
* **Factory Method** – Implemented by `TranscriptAdapterFactory` to create appropriate `TranscriptReader` instances and coordinate conversion.  
* **Configuration‑Driven Mapping** – The core of `TranscriptConverter` uses a data‑driven mapping table to achieve format‑agnostic transformation.  

### Design Decisions and Trade‑offs  
* **Pros:** Adding new formats is a low‑risk, code‑free activity (just a mapping file).  The conversion engine stays simple and testable.  
* **Cons:** Complex transformations that cannot be expressed as simple field mappings may require additional logic or custom converters, potentially complicating the mapping files.  

### System Structure Insights  
* The system is layered: **Reader → Converter → Adapter**, with the factory orchestrating the first two layers.  This separation enforces single responsibility and eases future extensions.  

### Scalability Considerations  
* Because the conversion work is driven by lightweight look‑ups, the component scales linearly with the number of transcripts processed.  If the mapping repository grows large, caching the parsed rule sets in memory will keep per‑conversion overhead minimal.  

### Maintainability Assessment  
* The declarative mapping approach dramatically reduces the maintenance surface: most changes are confined to configuration files.  The clear contract between `TranscriptReader`, `TranscriptConverter`, and `TranscriptAdapterFactory` further isolates concerns, making the overall subsystem easy to understand, test, and evolve.


## Hierarchy Context

### Parent
- [TranscriptAdapter](./TranscriptAdapter.md) -- TranscriptAdapter uses a factory pattern to create transcript readers for different agent formats, as seen in the TranscriptAdapterFactory class

### Siblings
- [TranscriptAdapterFactory](./TranscriptAdapterFactory.md) -- The TranscriptAdapterFactory class uses a factory method to create transcript readers, allowing for easy addition of new formats without modifying existing code.
- [TranscriptReader](./TranscriptReader.md) -- The TranscriptReader is designed to work with various agent formats, providing a common interface for reading transcripts regardless of the underlying format.


---

*Generated from 3 observations*
