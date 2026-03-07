# TranscriptProcessor

**Type:** SubComponent

The TranscriptProcessor module uses a configuration file, transcript-processor-config.json, to store settings and parameters for transcript processing.

## What It Is  

The **TranscriptProcessor** is a sub‑component that lives inside the *LiveLoggingSystem* package. Its concrete implementation can be found in the source tree alongside the files **transcript‑adapter.py**, **queue.py**, **ontology‑classification‑agent.py**, **transcript‑processor‑config.json**, **logging.py**, **database‑connection.py**, and **retry.py**. The class `TranscriptProcessor` orchestrates the end‑to‑end handling of raw transcripts: it receives a transcript payload, uses **TranscriptAdapter** to normalise the data, hands the normalised record to a queued work‑item, classifies the content via **OntologyClassificationAgent**, and finally persists the enriched transcript through the database connection defined in **database‑connection.py**. All operational parameters (e.g., queue size, retry limits, classification thresholds) are externalised in **transcript‑processor‑config.json**, allowing the component to be re‑configured without code changes.  

## Architecture and Design  

The design of **TranscriptProcessor** is deliberately *modular* and *pipeline‑oriented*. The most visible architectural pattern is a **queue‑based processing pipeline**: incoming transcripts are wrapped as tasks and placed onto a queue managed by the `queue.py` module. Workers dequeue items, apply a deterministic sequence of steps (adaptation → classification → storage), and acknowledge completion. This decouples the producer (the part of *LiveLoggingSystem* that captures live logs) from the consumer (the classification and storage logic), smoothing bursts of incoming data and providing back‑pressure control.  

A complementary **retry mechanism** is provided by **retry.py**. When a task fails—whether due to a transient database error, a malformed transcript, or a classification exception—the retry wrapper automatically re‑queues the task according to the policy defined in the JSON config. This adds resilience without scattering retry logic throughout the codebase.  

The component also follows a **configuration‑driven** approach. All tunable values (queue capacity, retry count, logging levels, database connection strings) are stored in **transcript‑processor‑config.json** and read at start‑up, ensuring that environment‑specific behaviour can be altered without recompiling.  

Finally, **cross‑cutting concerns** such as observability and persistence are handled by dedicated modules: `logging.py` supplies structured logs for every processing stage, while `database-connection.py` encapsulates the DB client, exposing a clean API for the **TranscriptStorage** child component. The **OntologyClassificationAgent** (shared with the sibling **ClassificationEngine**) is injected into the processor, reinforcing *dependency inversion* and allowing the same classification logic to be reused across the system.

## Implementation Details  

The heart of the sub‑component is the `TranscriptProcessor` class (defined in the main **transcript‑processor** module). Its constructor reads **transcript‑processor-config.json**, instantiates a `Queue` object from **queue.py**, and wires up the following collaborators:

* **TranscriptAdapter** (`transcript‑adapter.py`) – Provides the method `adapt(raw_transcript) → unified_transcript`. This class defines the canonical schema used throughout *LiveLoggingSystem* and is also referenced by the child **TranscriptConverter**.  

* **OntologyClassificationAgent** (`ontology‑classification‑agent.py`) – Exposes `classify(unified_transcript) → classification_result`. The same agent is used by the sibling **ClassificationEngine**, guaranteeing consistent ontology‑based tagging across the platform.  

* **DatabaseConnection** (`database‑connection.py`) – Supplies `save(processed_transcript)`. The underlying schema is described in **transcript‑storage.sql**, which the child **TranscriptStorage** relies on for table creation and migrations.  

* **RetryHandler** (`retry.py`) – Wraps the processing function with `@retry(max_attempts, backoff)`. When an exception bubbles up from any stage, the handler re‑queues the task up to the configured limit.  

* **Logger** (`logging.py`) – All major events (task enqueued, adaptation success, classification outcome, DB write, retry attempt, final failure) are logged with contextual metadata (transcript ID, timestamps, error codes).  

The processing flow is roughly:

1. **Enqueue** – The parent *LiveLoggingSystem* pushes a raw transcript onto the queue via `TranscriptProcessor.enqueue(raw)`.  
2. **Worker Loop** – A background worker fetches the next task, invokes the retry‑decorated `process(task)`.  
3. **Adaptation** – `TranscriptAdapter.adapt` normalises the raw payload.  
4. **Classification** – `OntologyClassificationAgent.classify` tags observations according to the shared ontology.  
5. **Persistence** – `DatabaseConnection.save` writes the enriched transcript; the child **TranscriptStorage** may perform additional post‑processing (e.g., indexing).  
6. **Acknowledgement** – On success the task is marked complete; on failure the retry handler decides whether to re‑queue or drop the item.  

The child components (**TranscriptConverter**, **TranscriptClassifier**, **TranscriptStorage**) are thin wrappers around the core adapters and agents, exposing higher‑level APIs to the rest of *LiveLoggingSystem* while keeping the processor’s internal workflow isolated.

## Integration Points  

**TranscriptProcessor** sits at the intersection of several system boundaries:

* **Parent – LiveLoggingSystem** – The parent captures live session logs and forwards raw transcripts to the processor via the `enqueue` method. The parent also supplies the configuration file path, ensuring that the processor respects system‑wide settings.  

* **Siblings – LoggingManager, ClassificationEngine, OntologyManager, LSLConfigValidator** –  
  * The **LoggingManager** shares the same `logging.py` module, guaranteeing uniform log formatting across components.  
  * The **ClassificationEngine** re‑uses the **OntologyClassificationAgent**, meaning any updates to the ontology or classification rules automatically propagate to the processor.  
  * The **OntologyManager** provides the underlying ontology entities that the agent consults, establishing a data‑flow link from ontology definition to transcript tagging.  
  * The **LSLConfigValidator** validates the JSON configuration before the processor starts, preventing misconfiguration at runtime.  

* **Children – TranscriptConverter, TranscriptClassifier, TranscriptStorage** – These expose simplified interfaces (`convert`, `classify`, `store`) for other modules that may need to invoke a single step without running the full pipeline. They directly depend on the same adapter, agent, and DB connection classes used by the processor, reinforcing code reuse.  

* **External Services** – The database connection defined in **database‑connection.py** may point to a relational store (as hinted by **transcript‑storage.sql**). Any change in the DB driver or schema will affect both the processor and the **TranscriptStorage** child.  

## Usage Guidelines  

1. **Configuration First** – Always validate **transcript‑processor‑config.json** with the **LSLConfigValidator** before starting the system. Mis‑typed queue sizes or retry limits can cause deadlocks or unbounded retries.  

2. **Enqueue Correctly** – Call `TranscriptProcessor.enqueue(raw_transcript)` with a payload that matches the expectations of **TranscriptAdapter** (e.g., JSON with required fields). The adapter is the single source of truth for the unified schema; feeding malformed data will trigger retries and eventually be dropped.  

3. **Monitor Logs** – The `logging.py` integration emits structured entries for each stage. Set the logging level to `INFO` for normal operation and `DEBUG` when troubleshooting adaptation or classification failures.  

4. **Handle Back‑Pressure** – The queue is bounded (size defined in the config). If the system is under heavy load, producers should respect `QueueFull` exceptions and optionally apply exponential back‑off before retrying the enqueue operation.  

5. **Graceful Shutdown** – On service termination, drain the queue first to allow in‑flight tasks to complete. The retry handler will continue to respect its max‑attempt policy during shutdown, ensuring no partial writes.  

6. **Reuse Shared Agents** – When extending classification logic, modify **OntologyClassificationAgent** rather than creating a new classifier. This keeps the behavior consistent with the sibling **ClassificationEngine** and the rest of the platform.  

---

### Architectural patterns identified  
* Queue‑based processing pipeline (producer‑consumer)  
* Retry wrapper for fault tolerance  
* Configuration‑driven behaviour (external JSON)  
* Separation of concerns via dedicated modules (adapter, classifier, storage, logging)  

### Design decisions and trade‑offs  
* **Decoupling via queue** improves scalability and smooths spikes but adds latency for real‑time use cases.  
* **Centralised retry** reduces duplicated error‑handling code but can mask underlying systematic failures if the max‑retry count is set too high.  
* **Shared OntologyClassificationAgent** promotes consistency across siblings but creates a tight coupling; changes to the agent affect multiple components simultaneously.  

### System structure insights  
* **TranscriptProcessor** is the orchestrator within *LiveLoggingSystem*, delegating to three child components that each encapsulate a single responsibility (conversion, classification, storage).  
* Sibling components share cross‑cutting utilities (logging, config validation), indicating a common infrastructure layer.  

### Scalability considerations  
* The bounded queue can be horizontally scaled by running multiple worker processes that share the same queue backend (e.g., Redis or in‑process `queue.Queue`).  
* Database write throughput may become a bottleneck; consider batching or async DB drivers if transcript volume grows.  
* Retry back‑off parameters should be tuned to avoid overwhelming downstream services during outage periods.  

### Maintainability assessment  
* Clear module boundaries and single‑responsibility children make the codebase approachable.  
* Externalising settings in **transcript‑processor‑config.json** simplifies environment‑specific tweaks.  
* Reuse of shared agents and logging utilities reduces duplication but requires coordinated versioning; a change in the ontology model must be communicated across all dependent siblings.  
* The lack of explicit type hints or interface definitions in the observations suggests potential for future refactoring toward more explicit contracts, which would further improve testability and maintainability.


## Hierarchy Context

### Parent
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is designed to capture and process live session logging data from various agents, including Claude Code conversations. It handles session windowing, file routing, classification layers, and transcript capture. The system's architecture involves multiple modules and classes, such as the OntologyClassificationAgent, LSLConfigValidator, and TranscriptAdapter, which work together to classify observations, validate configurations, and convert transcripts into a unified format.

### Children
- [TranscriptConverter](./TranscriptConverter.md) -- The TranscriptAdapter class in transcript-adapter.py defines the unified format for transcripts, which is used by the TranscriptConverter.
- [TranscriptClassifier](./TranscriptClassifier.md) -- The classification process in the TranscriptClassifier involves applying predefined rules and patterns to identify key observations in the transcripts.
- [TranscriptStorage](./TranscriptStorage.md) -- The TranscriptStorage uses a database schema defined in the transcript-storage.sql file to store processed transcripts, which includes fields for transcript metadata and classified observations.

### Siblings
- [LoggingManager](./LoggingManager.md) -- LoggingManager uses the LSLConfigValidator class to validate logging configurations, as defined in the lsl-config-validator.py file.
- [ClassificationEngine](./ClassificationEngine.md) -- ClassificationEngine uses the OntologyClassificationAgent class to classify observations, as defined in the ontology-classification-agent.py file.
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the OntologyEntity class to represent ontology entities, as defined in the ontology-entity.py file.
- [LSLConfigValidator](./LSLConfigValidator.md) -- LSLConfigValidator uses the LSLConfig class to represent the LSL configuration, as defined in the lsl-config.py file.


---

*Generated from 7 observations*
